#!/usr/bin/env node
/**
 * llm-runner 부하 테스트.
 *
 * 단위 테스트와 짧은 수동 확인으로는 절대 안 드러나는 것들을 노린다:
 * 구독 provider는 호출마다 **자식 프로세스를 띄운다**. 수백 번 호출하는 배치를 돌렸을 때
 * 프로세스나 파일 핸들이 쌓이는지, 메모리가 계속 늘어나는지, 뒤로 갈수록 느려지는지는
 * 실제로 그만큼 돌려보기 전에는 알 수 없다.
 *
 * 사용법:
 *   node scripts/load-test.mjs [provider]
 *   PHASE_A=40 PHASE_B=25 PHASE_C=25 node scripts/load-test.mjs claude-subscription
 *
 * 비용/사용량 주의: 구독 계정의 사용량을 실제로 소모한다. 답변이 짧게 나오는 프롬프트만 쓰지만
 * 호출 횟수만큼 쌓이므로, 기본값보다 크게 올릴 때는 감안해라.
 */
import { execFileSync } from 'node:child_process';
import { createAiRunner } from '../dist/index.js';

const provider = process.argv[2] ?? 'claude-subscription';
const PHASE_A = Number(process.env.PHASE_A ?? 40); // 순차 run() — 누수와 지연 증가
const PHASE_B = Number(process.env.PHASE_B ?? 25); // 스트림을 중간에 버리기 — 정리 누락
const PHASE_C = Number(process.env.PHASE_C ?? 25); // 긴 세션 — 세션 수명과 메모리
const PHASE_D_CONCURRENCY = Number(process.env.PHASE_D_CONCURRENCY ?? 5);
const PHASE_D_ROUNDS = Number(process.env.PHASE_D_ROUNDS ?? 3);

/** 우리 프로세스의 자손 개수. `pgrep -f claude`처럼 이름으로 세면 이 터미널을 띄운 놈까지 잡힌다. */
function descendantCount() {
  let rows;
  try {
    rows = execFileSync('ps', ['-eo', 'pid=,ppid=,comm='], { encoding: 'utf-8' });
  } catch {
    return -1;
  }
  const children = new Map();
  for (const line of rows.trim().split('\n')) {
    const [pidText, ppidText, ...rest] = line.trim().split(/\s+/);
    // 측정하려고 우리가 방금 띄운 ps/lsof 자신은 빼야 "남아있는 AI 프로세스" 수가 정확해진다.
    const command = rest.join(' ');
    if (/(^|\/)(ps|lsof)$/.test(command)) continue;
    const pid = Number(pidText);
    const ppid = Number(ppidText);
    if (!children.has(ppid)) children.set(ppid, []);
    children.get(ppid).push(pid);
  }
  let count = 0;
  const stack = [process.pid];
  while (stack.length > 0) {
    for (const child of children.get(stack.pop()) ?? []) {
      count++;
      stack.push(child);
    }
  }
  return count;
}

function openFileDescriptors() {
  try {
    return execFileSync('lsof', ['-p', String(process.pid)], { encoding: 'utf-8' }).trim().split('\n').length - 1;
  } catch {
    return -1;
  }
}

const rssMb = () => Math.round(process.memoryUsage().rss / 1024 / 1024);

function snapshot(label) {
  const snap = { label, procs: descendantCount(), rss: rssMb(), fds: openFileDescriptors() };
  console.log(`  [${label}] 자식프로세스=${snap.procs} RSS=${snap.rss}MB 파일핸들=${snap.fds}`);
  return snap;
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

function summarize(name, timings, errors) {
  if (timings.length === 0) {
    console.log(`  ${name}: 성공 0건 / 실패 ${errors.length}건`);
    return;
  }
  const head = timings.slice(0, Math.min(10, timings.length));
  const tail = timings.slice(-Math.min(10, timings.length));
  const drift = median(tail) - median(head);
  console.log(
    `  ${name}: 성공 ${timings.length}건 / 실패 ${errors.length}건 | ` +
      `중앙값 ${median(timings)}ms (처음10 ${median(head)}ms → 마지막10 ${median(tail)}ms, 변화 ${drift >= 0 ? '+' : ''}${drift}ms)`,
  );
  if (errors.length > 0) console.log(`     첫 실패 사유: ${errors[0]}`);
}

const PROMPT = '1+1은? 숫자만 답해.';

async function phaseA(runner) {
  console.log(`\n[A] run() ${PHASE_A}회 순차 호출 — 프로세스/메모리 누수와 지연 증가 확인`);
  const timings = [];
  const errors = [];
  for (let i = 0; i < PHASE_A; i++) {
    const start = Date.now();
    try {
      await runner.run({ prompt: PROMPT });
      timings.push(Date.now() - start);
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
    if ((i + 1) % 10 === 0) snapshot(`${i + 1}회 완료`);
  }
  summarize('A', timings, errors);
}

async function phaseB(runner) {
  console.log(`\n[B] stream()을 첫 조각에서 ${PHASE_B}회 중도 포기 — 정리 누락(프로세스 좀비) 확인`);
  const errors = [];
  let aborted = 0;
  for (let i = 0; i < PHASE_B; i++) {
    try {
      for await (const event of runner.stream({ prompt: '1부터 30까지 세면서 설명해줘.' })) {
        if (event.type === 'text') break; // 일부러 버린다 — 실사용에서 사용자가 화면을 닫는 상황
      }
      aborted++;
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
    if ((i + 1) % 5 === 0) snapshot(`${i + 1}회 중도포기`);
  }
  console.log(`  B: 중도 포기 ${aborted}건 / 실패 ${errors.length}건`);
  if (errors.length > 0) console.log(`     첫 실패 사유: ${errors[0]}`);
}

async function phaseC(runner) {
  console.log(`\n[C] 세션 하나로 ${PHASE_C}턴 — 긴 대화에서 세션이 버티는지, 메모리가 늘어나는지`);
  const session = runner.createSession();
  const timings = [];
  const errors = [];
  try {
    for (let i = 0; i < PHASE_C; i++) {
      const start = Date.now();
      try {
        await session.send(`${i + 1} 더하기 1은? 숫자만 답해.`);
        timings.push(Date.now() - start);
      } catch (err) {
        errors.push(err instanceof Error ? err.message : String(err));
      }
      if ((i + 1) % 5 === 0) snapshot(`${i + 1}턴 완료`);
    }
  } finally {
    session.close();
  }
  summarize('C', timings, errors);
}

async function phaseD(runner) {
  const total = PHASE_D_CONCURRENCY * PHASE_D_ROUNDS;
  console.log(`\n[D] 동시 ${PHASE_D_CONCURRENCY}건 × ${PHASE_D_ROUNDS}라운드(총 ${total}건) — 동시 호출 안전성`);
  const timings = [];
  const errors = [];
  for (let round = 0; round < PHASE_D_ROUNDS; round++) {
    const results = await Promise.allSettled(
      Array.from({ length: PHASE_D_CONCURRENCY }, async () => {
        const start = Date.now();
        await runner.run({ prompt: PROMPT });
        return Date.now() - start;
      }),
    );
    for (const r of results) {
      if (r.status === 'fulfilled') timings.push(r.value);
      else errors.push(r.reason instanceof Error ? r.reason.message : String(r.reason));
    }
    snapshot(`${round + 1}라운드 완료`);
  }
  summarize('D', timings, errors);
}

async function main() {
  console.log(`=== llm-runner 부하 테스트 (provider=${provider}) ===`);
  const runner = createAiRunner({ provider, silent: true });

  const before = snapshot('시작 전');
  const started = Date.now();

  await phaseA(runner);
  await phaseB(runner);
  await phaseC(runner);
  await phaseD(runner);

  // 정리에 시간이 걸릴 수 있으므로 잠깐 기다렸다가 최종 상태를 본다.
  await new Promise((r) => setTimeout(r, 3000));
  if (global.gc) global.gc();
  const after = snapshot('종료 후');

  console.log(`\n=== 결과 ===`);
  console.log(`총 소요: ${Math.round((Date.now() - started) / 1000)}초`);
  console.log(`자식 프로세스: ${before.procs} → ${after.procs} ${after.procs > before.procs ? '⚠️ 남아있음(누수 의심)' : '✅ 정리됨'}`);
  console.log(`RSS: ${before.rss}MB → ${after.rss}MB (증가 ${after.rss - before.rss}MB)`);
  console.log(`파일핸들: ${before.fds} → ${after.fds} (증가 ${after.fds - before.fds})`);
}

main().catch((err) => {
  console.error('부하 테스트가 중단됐다:', err);
  process.exitCode = 1;
});
