#!/usr/bin/env node
/**
 * llm-runner 장시간(longevity) 테스트.
 *
 * 부하 테스트(`load-test.mjs`)는 "짧은 시간에 많이" 호출해서 누수를 본다. 이 테스트는 반대로
 * **호출은 적게 하되 시간을 길게 끈다.** 실제 챗봇은 사용자가 답을 읽고 몇 분 생각하다 다음
 * 질문을 보내기 때문에, 세션이 유휴 상태로 방치되는 시간이 길다 — 그동안 밑에 깔린 CLI 프로세스가
 * 유휴 타임아웃으로 끊겨버리면 대화가 통째로 날아간다. 호출을 아무리 많이 해도 이건 안 잡힌다.
 *
 * 같이 보는 것: 턴이 쌓이며 맥락이 커질 때 입력 토큰과 응답 시간이 어떻게 변하는지.
 *
 * 사용법:
 *   node scripts/longevity-test.mjs [provider]
 *   IDLE_GAPS=60,120,180 GROWTH_TURNS=8 node scripts/longevity-test.mjs openai-subscription
 */
import { createAiRunner } from '../dist/index.js';

const provider = process.argv[2] ?? 'claude-subscription';
/** 턴 사이에 쉬는 시간(초). 사용자가 답을 읽고 생각하는 시간을 흉내 낸다. */
const IDLE_GAPS = (process.env.IDLE_GAPS ?? '60,120,180').split(',').map(Number);
const GROWTH_TURNS = Number(process.env.GROWTH_TURNS ?? 8);

/** llm-runner가 내부적으로 경로를 바꿨는지(폴백) 알아내려면 경고를 가로채야 한다. */
const warnings = [];
const originalWarn = console.warn;
console.warn = (...args) => {
  warnings.push(args.map(String).join(' '));
  originalWarn(...args);
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clock = () => new Date().toTimeString().slice(0, 8);

async function idlePhase(runner) {
  const totalIdle = IDLE_GAPS.reduce((a, b) => a + b, 0);
  console.log(`\n[1] 유휴 방치 테스트 — 턴 사이에 ${IDLE_GAPS.join('초, ')}초씩 쉰다 (총 유휴 ${totalIdle}초)`);
  console.log('    실제 상담봇에서 사용자가 답을 읽고 생각하는 동안 세션이 살아있는지 본다.');

  const session = runner.createSession();
  let survived = true;
  try {
    const first = await session.send('내 예산은 300만원이고 개발용 노트북을 찾고 있어. "알겠다"라고만 답해.');
    console.log(`  [${clock()}] 1턴 완료: ${JSON.stringify(first.text.slice(0, 30))}`);

    for (const [index, gap] of IDLE_GAPS.entries()) {
      console.log(`  [${clock()}] ${gap}초 유휴 대기...`);
      await sleep(gap * 1000);

      const start = Date.now();
      try {
        const answer = await session.send('내 예산이 얼마라고 했지? 숫자만 답해.');
        const remembered = answer.text.includes('300');
        console.log(
          `  [${clock()}] ${gap}초 방치 후 ${index + 2}턴: ${Date.now() - start}ms, ` +
            `맥락 ${remembered ? '유지됨 ✅' : `깨짐 ❌ (${answer.text.slice(0, 40)})`}`,
        );
        if (!remembered) survived = false;
      } catch (err) {
        console.log(`  [${clock()}] ${gap}초 방치 후 실패 ❌: ${err instanceof Error ? err.message : err}`);
        survived = false;
        break;
      }
    }
  } finally {
    session.close();
  }

  console.log(`  결과: ${survived ? '✅ 긴 유휴 후에도 세션과 맥락이 살아있다' : '❌ 유휴 중 세션이 끊겼다'}`);
  return survived;
}

async function contextGrowthPhase(runner) {
  console.log(`\n[2] 맥락 증가 테스트 — 긴 답변을 ${GROWTH_TURNS}턴 쌓으면서 입력 토큰과 응답 시간을 본다`);

  const topics = [
    'CPU와 GPU의 차이', '메모리(RAM)의 역할', 'SSD와 HDD의 차이', '디스플레이 해상도',
    '노트북 발열 관리', '배터리 수명', '키보드와 입력감', '무게와 휴대성',
    '포트 구성', '운영체제 선택',
  ];

  const session = runner.createSession();
  const rows = [];
  try {
    for (let i = 0; i < GROWTH_TURNS; i++) {
      const topic = topics[i % topics.length];
      const start = Date.now();
      const result = await session.send(`${topic}에 대해 400자 정도로 설명해줘.`);
      // 맥락이 커져도 입력 토큰이 그대로면 프롬프트 캐시가 먹고 있다는 뜻이다 — 둘 다 봐야 한다.
      const input = result.usage?.inputTokens;
      const cached = result.usage?.cachedInputTokens;
      rows.push({ turn: i + 1, ms: Date.now() - start, input, cached, chars: result.text.length });
      console.log(
        `  ${i + 1}턴: ${Date.now() - start}ms / 입력토큰 ${input ?? '미제공'} / 캐시된 입력 ${cached ?? '미제공'} / 답변 ${result.text.length}자`,
      );
    }

    const recall = await session.send('내가 맨 처음 물어본 주제가 뭐였지? 주제만 짧게 답해.');
    const kept = recall.text.includes('CPU') || recall.text.includes('GPU');
    console.log(`  맥락 누적 후 첫 주제 기억: ${kept ? '✅' : `❌ (${recall.text.slice(0, 40)})`}`);

    const first = rows[0];
    const last = rows[rows.length - 1];
    if (first && last) {
      const total = (row) => (row.input ?? 0) + (row.cached ?? 0);
      console.log(
        `  전체 입력(캐시 포함) ${total(first)} → ${total(last)} 토큰, 응답 시간 ${first.ms}ms → ${last.ms}ms`,
      );
    }
    return kept;
  } finally {
    session.close();
  }
}

async function main() {
  console.log(`=== llm-runner 장시간 테스트 (provider=${provider}) ===`);
  console.log(`시작 ${clock()}`);
  const runner = createAiRunner({ provider, silent: true });

  const idleOk = await idlePhase(runner);
  const growthOk = await contextGrowthPhase(runner);

  console.log(`\n=== 결과 (${provider}) ===`);
  console.log(`유휴 방치 후 세션 생존: ${idleOk ? '✅' : '❌'}`);
  console.log(`맥락 누적 후 기억 유지: ${growthOk ? '✅' : '❌'}`);
  console.log(`내부 경고(폴백 등): ${warnings.length}건`);
  for (const w of warnings.slice(0, 5)) console.log(`  - ${w.slice(0, 160)}`);
  console.log(`종료 ${clock()}`);
}

main().catch((err) => {
  console.error('장시간 테스트가 중단됐다:', err);
  process.exitCode = 1;
});
