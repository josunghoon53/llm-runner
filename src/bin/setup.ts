#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { checkClaudeStatus, checkCodexStatus, type CliStatus } from '../setup/check-status.js';
import { checkCodexAuthFreshness } from '../setup/restore-session.js';
import { classifyRoutes } from '../setup/deploy-check.js';
import type { AiProvider } from '../create-ai-runner.js';

const args = process.argv.slice(2);
const shouldLogin = args.includes('--login');
const shouldInit = args.includes('--init');
const shouldPrintCodexAuthJson = args.includes('--codex-auth-json');
/** 배포 전에 로컬에서 확인 가능한 설정 실수를 잡는다. */
const shouldCheckDeploy = args.includes('--check-deploy');
/** 값을 화면에 찍지 않고 Vercel 환경변수로 곧장 등록한다. */
const shouldPushToVercel = args.includes('--vercel');

function readFlagValue(flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1) return undefined;
  const value = args[index + 1];
  return value && !value.startsWith('--') ? value : undefined;
}

function printStatus(label: string, status: CliStatus): void {
  console.log(`\n=== ${label} ===`);
  if (!status.installed) {
    console.log(`❌ 설치되어 있지 않습니다.`);
    console.log(`   설치: ${status.installCommand}`);
    return;
  }
  console.log(`✅ CLI 설치됨`);
  if (status.loggedIn) {
    console.log(`✅ 로그인됨${status.detail ? ` (${status.detail})` : ''}`);
  } else {
    console.log(`❌ 로그인이 안 되어 있습니다.`);
    console.log(`   로그인: ${status.loginCommand}`);
  }
}

function tryLogin(label: string, status: CliStatus, command: string, args: string[]): void {
  if (!status.installed || status.loggedIn) return;
  console.log(`\n${label} 로그인을 시작합니다 (${command} ${args.join(' ')})...`);
  // Windows에서 npm으로 설치된 CLI는 .cmd 래퍼라서 shell 없이는 찾지 못한다.
  spawnSync(command, args, { stdio: 'inherit', shell: process.platform === 'win32' });
}

function writeEnvProvider(provider: AiProvider): void {
  const envPath = '.env';
  const line = `AI_PROVIDER=${provider}`;
  if (!existsSync(envPath)) {
    writeFileSync(envPath, `${line}\n`);
    console.log(`\n✅ .env 파일을 만들고 ${line}을 썼습니다.`);
    return;
  }
  const content = readFileSync(envPath, 'utf-8');
  if (/^AI_PROVIDER=/m.test(content)) {
    writeFileSync(envPath, content.replace(/^AI_PROVIDER=.*$/m, line));
  } else {
    writeFileSync(envPath, `${content.trimEnd()}\n${line}\n`);
  }
  console.log(`\n✅ .env에 ${line}을 반영했습니다.`);
}

/**
 * `CODEX_AUTH_JSON`(개인 계정용 Codex 서버리스 세션 복원값)을 생성해서 그대로 출력한다.
 * `cat ~/.codex/auth.json | base64`를 직접 치는 것과 같은 결과지만, 파일 위치를 몰라도 되고
 * OS별 base64 명령 차이(macOS `base64`, 일부 Linux는 `base64 -w0` 필요 등)를 신경 안 써도 된다.
 */
function printCodexAuthJson(): void {
  const codexHome = process.env.CODEX_HOME || join(homedir(), '.codex');
  const authJsonPath = join(codexHome, 'auth.json');

  if (!existsSync(authJsonPath)) {
    console.log(`\n❌ ${authJsonPath}를 찾을 수 없습니다. 먼저 \`codex login\`으로 로그인하세요.`);
    process.exitCode = 1;
    return;
  }

  const content = readFileSync(authJsonPath, 'utf-8');
  const encoded = Buffer.from(content, 'utf-8').toString('base64');

  if (shouldPushToVercel) {
    pushCodexAuthJsonToVercel(encoded);
    return;
  }

  console.log('\n아래 값을 배포 환경(Vercel 등)의 CODEX_AUTH_JSON 비밀 값으로 저장하세요.');
  console.log('⚠️  이 값은 로그인 세션 전체를 담고 있는 민감한 값입니다 — 커밋하거나 다른 사람과 공유하지 마세요.');
  console.log('   (Vercel을 쓴다면 `--vercel`을 붙이면 값을 화면에 찍지 않고 바로 등록합니다.)\n');
  console.log(encoded);
  console.log(`\n${freshnessAdvice()}`);
}

/**
 * base64 값을 터미널에 한 번도 노출하지 않고 `vercel env add`의 stdin으로 곧장 흘려보낸다.
 * 화면/셸 히스토리/스크롤백에 시크릿이 남지 않는다는 점에서, 복붙보다 안전한 경로다.
 */
function pushCodexAuthJsonToVercel(encoded: string): void {
  const environment = readFlagValue('--env') ?? 'production';
  const scope = readFlagValue('--scope');
  const vercelArgs = ['vercel', 'env', 'add', 'CODEX_AUTH_JSON', environment];
  if (scope) vercelArgs.push('--scope', scope);

  console.log(`\nVercel에 CODEX_AUTH_JSON을 등록합니다 (환경: ${environment}${scope ? `, scope: ${scope}` : ''})...`);
  console.log('값은 화면에 출력하지 않고 stdin으로 직접 전달합니다.\n');

  const result = spawnSync('npx', vercelArgs, {
    input: encoded,
    stdio: ['pipe', 'inherit', 'inherit'],
    shell: process.platform === 'win32',
  });

  if (result.status !== 0) {
    console.log(
      '\n❌ 등록에 실패했습니다. 이미 같은 이름의 값이 있으면 먼저 지워야 합니다:\n' +
        `   npx vercel env rm CODEX_AUTH_JSON ${environment}${scope ? ` --scope ${scope}` : ''}`,
    );
    process.exitCode = 1;
    return;
  }

  console.log(`\n✅ 등록 완료. 다음 배포부터 적용됩니다.\n${freshnessAdvice()}`);
}

/** 현재 토큰이 언제 만료되는지, 그래서 뭘 해야 하는지 한 줄로 알려준다. */
function freshnessAdvice(): string {
  const freshness = checkCodexAuthFreshness();
  if (!freshness.readable) return `참고: ${freshness.summary}`;
  return (
    `참고: ${freshness.summary}\n` +
    '   이 스냅샷이 언젠가 만료되는 게 걱정된다면 createAiRunner({ codexAuthStore })를 설정하세요 — ' +
    '갱신 감지와 저장을 llm-runner가 자동으로 처리합니다 (README "Codex" 섹션).'
  );
}

async function runInit(): Promise<void> {
  const choices: { key: string; provider: AiProvider; label: string }[] = [
    { key: '1', provider: 'claude-subscription', label: 'Claude 구독 (claude login 세션 재사용) — 개인/내부 workflow용' },
    { key: '2', provider: 'openai-subscription', label: 'Codex 구독 (codex login 세션 재사용) — 개인/내부 workflow용' },
    { key: '3', provider: 'claude-api', label: 'Anthropic API 키 — 고객 대면 기능/프로덕션용' },
    { key: '4', provider: 'openai-api', label: 'OpenAI API 키 — 고객 대면 기능/프로덕션용' },
  ];

  console.log('\n어떤 provider를 기본값으로 쓸까요?');
  for (const choice of choices) {
    console.log(`  [${choice.key}] ${choice.label}`);
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question('\n번호를 입력하세요 (1-4): ');
  rl.close();

  const selected = choices.find((c) => c.key === answer.trim());
  if (!selected) {
    console.log('올바른 번호가 아닙니다. 다시 실행해주세요.');
    process.exitCode = 1;
    return;
  }

  writeEnvProvider(selected.provider);

  if (selected.provider === 'claude-subscription' && !checkClaudeStatus().loggedIn) {
    tryLogin('Claude', checkClaudeStatus(), 'claude', ['login']);
  }
  if (selected.provider === 'openai-subscription' && !checkCodexStatus().loggedIn) {
    tryLogin('Codex', checkCodexStatus(), 'codex', ['login']);
  }

  console.log(`\n완료! AI_PROVIDER=${selected.provider}가 .env에 설정되었습니다.`);
}

/**
 * 배포하기 전에, 로컬에서 확인할 수 있는 것만 확인한다.
 *
 * 배포가 깨지는 가장 흔한 원인은 네이티브 바이너리가 번들에서 빠지는 것인데, 그건 보통
 * 두 가지 실수에서 온다: ① 패키지를 프로젝트 의존성으로 안 넣었거나 ② `withLlmRunner()`의
 * `routes`가 실제 라우트 경로와 안 맞거나. 둘 다 여기서 미리 잡을 수 있다.
 *
 * 잡을 수 **없는** 것도 분명히 알려준다: 플랫폼별 바이너리는 내 OS 것만 설치되므로,
 * 배포 대상(보통 리눅스)용이 제대로 실릴지는 로컬에서 확인할 방법이 없다.
 */
function checkDeploy(): void {
  console.log('\n=== 배포 전 점검 ===');
  let problems = 0;

  const pkg = readJsonIfExists(join(process.cwd(), 'package.json'));
  const deps = { ...(pkg?.dependencies ?? {}), ...(pkg?.optionalDependencies ?? {}) };
  const devDeps = pkg?.devDependencies ?? {};

  if (deps['@openai/codex']) {
    console.log('✅ @openai/codex가 의존성에 있습니다 (Codex 구독을 배포하려면 필요).');
  } else if (devDeps['@openai/codex']) {
    console.log('❌ @openai/codex가 devDependencies에 있습니다 — 배포 빌드에 안 실립니다.');
    console.log('   고치기: npm install @openai/codex   (--save-dev 없이)');
    problems++;
  } else {
    console.log('ℹ️  @openai/codex가 없습니다. Codex 구독을 서버리스에 배포할 게 아니면 정상입니다.');
    console.log('   배포할 거라면: npm install @openai/codex');
  }

  const configPath = ['next.config.ts', 'next.config.mjs', 'next.config.js']
    .map((name) => join(process.cwd(), name))
    .find((path) => existsSync(path));

  if (!configPath) {
    console.log('ℹ️  next.config 파일이 없습니다. Next.js 프로젝트가 아니면 이 점검은 건너뜁니다.');
  } else {
    const config = readFileSync(configPath, 'utf-8');
    if (!config.includes('withLlmRunner') && !config.includes('outputFileTracingIncludes')) {
      console.log(`❌ ${basename(configPath)}에 바이너리 번들링 설정이 없습니다.`);
      console.log("   고치기: withLlmRunner()로 감싸세요 — README의 \"서버리스/배포 환경에서 쓰기\" 참고.");
      problems++;
    } else {
      console.log(`✅ ${basename(configPath)}에 번들링 설정이 있습니다.`);
      problems += checkRouteGlobs(config);
    }
  }

  console.log(
    `\n⚠️  여기서 확인할 수 없는 것: 배포 대상(리눅스)용 바이너리가 실제로 실리는지.\n` +
      `   플랫폼별 패키지는 지금 이 컴퓨터(${process.platform}-${process.arch})용만 설치되기 때문입니다.\n` +
      `   배포 직후 점검용 엔드포인트를 한 번 호출해서 확인하세요 (README의 "배포 전에 반드시 확인할 것").`,
  );

  console.log(problems === 0 ? '\n로컬에서 확인 가능한 항목은 모두 통과했습니다.' : `\n고쳐야 할 항목 ${problems}개.`);
  if (problems > 0) process.exitCode = 1;
}

/** 설정에 적힌 라우트 글로브가 실제로 존재하는 라우트와 맞는지 본다. */
function checkRouteGlobs(config: string): number {
  const declared = [...config.matchAll(/routes\s*:\s*\[([^\]]*)\]/g)]
    .flatMap((match) => [...match[1]!.matchAll(/['"`]([^'"`]+)['"`]/g)].map((m) => m[1]!));

  if (declared.length === 0) {
    console.log('   ℹ️  routes를 읽지 못했습니다(기본값 /api/** 를 쓰는 중일 수 있습니다). 수동으로 확인하세요.');
    return 0;
  }

  const actual = findApiRoutes();
  if (actual.length === 0) {
    console.log('   ℹ️  app/api 아래에서 라우트 파일을 찾지 못했습니다. 수동으로 확인하세요.');
    return 0;
  }

  console.log(`   선언된 라우트: ${declared.join(', ')}`);
  console.log(`   실제 라우트:   ${actual.join(', ')}`);

  const { harmless, problems } = classifyRoutes(
    declared,
    actual.map((route) => ({ route, usesLlmRunner: routeImportsLlmRunner(route) })),
  );

  if (harmless.length === 0 && problems.length === 0) {
    console.log('   ✅ 실제 라우트가 모두 설정 범위 안에 있습니다.');
    return 0;
  }
  if (harmless.length > 0) {
    console.log(`   ℹ️  설정 범위 밖이지만 llm-runner를 안 쓰는 라우트(문제 아님): ${harmless.join(', ')}`);
  }
  if (problems.length === 0) return 0;

  console.log(`   ❌ llm-runner를 호출하는데 설정에 안 걸리는 라우트: ${problems.join(', ')}`);
  console.log('      이대로 배포하면 "실행파일을 찾을 수 없다"로 실패합니다.');
  console.log(`      고치기: withLlmRunner()의 routes에 ${problems.map((r) => `'${r}'`).join(', ')}를 추가하세요.`);
  return 1;
}

/** 그 라우트 파일이 실제로 llm-runner를 import하는지 본다. 안 쓰면 번들링 대상이 아니다. */
function routeImportsLlmRunner(route: string): boolean {
  for (const file of routeFilesFor(route)) {
    try {
      if (/from\s+['"]llm-runner/.test(readFileSync(file, 'utf-8'))) return true;
    } catch {
      // 못 읽으면 판단할 수 없으니 넘어간다.
    }
  }
  return false;
}

function routeFilesFor(route: string): string[] {
  const relative = route.replace(/^\/api\/?/, '');
  const bases = [join(process.cwd(), 'app', 'api'), join(process.cwd(), 'src', 'app', 'api')];
  const names = ['route.ts', 'route.tsx', 'route.js', 'route.mts', 'route.mjs'];
  return bases.flatMap((base) => names.map((name) => join(base, relative, name)));
}

function findApiRoutes(): string[] {
  const roots = [join(process.cwd(), 'app', 'api'), join(process.cwd(), 'src', 'app', 'api')];
  const found: string[] = [];

  const walk = (dir: string, prefix: string): void => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) walk(join(dir, entry.name), `${prefix}/${entry.name}`);
      else if (/^route\.(ts|js|tsx|mts|mjs)$/.test(entry.name)) found.push(prefix);
    }
  };

  for (const root of roots) walk(root, '/api');
  return found;
}

function readJsonIfExists(path: string): Record<string, Record<string, string>> | undefined {
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return undefined;
  }
}

async function main(): Promise<void> {
  if (shouldCheckDeploy) {
    checkDeploy();
    return;
  }

  if (shouldPrintCodexAuthJson) {
    printCodexAuthJson();
    return;
  }

  if (shouldInit) {
    await runInit();
    return;
  }

  const claude = checkClaudeStatus();
  const codex = checkCodexStatus();

  printStatus('Claude Code', claude);
  printStatus('Codex', codex);

  if (shouldLogin) {
    tryLogin('Claude', claude, 'claude', ['login']);
    tryLogin('Codex', codex, 'codex', ['login']);

    console.log('\n다시 확인 중...');
    printStatus('Claude Code', checkClaudeStatus());
    printStatus('Codex', checkCodexStatus());
  } else {
    const notInstalled = [!claude.installed && 'Claude Code', !codex.installed && 'Codex'].filter(Boolean);
    const notLoggedIn = [
      claude.installed && !claude.loggedIn && 'Claude Code',
      codex.installed && !codex.loggedIn && 'Codex',
    ].filter(Boolean);
    if (notInstalled.length > 0) {
      console.log(`\n설치가 필요한 CLI: ${notInstalled.join(', ')} — 위의 설치 명령을 실행한 뒤 다시 확인하세요.`);
    }
    if (notLoggedIn.length > 0) {
      console.log(`\n로그인이 필요한 CLI: ${notLoggedIn.join(', ')} — \`npx llm-runner-setup --login\`으로 바로 로그인할 수 있습니다.`);
    }
  }

  console.log('\n요약:');
  console.log(`  claude-subscription 사용 가능: ${claude.loggedIn ? '✅' : '❌'}`);
  console.log(`  openai-subscription 사용 가능: ${codex.loggedIn ? '✅' : '❌'}`);

  if (codex.loggedIn) {
    const freshness = checkCodexAuthFreshness();
    if (freshness.readable) console.log(`  Codex 토큰 상태: ${freshness.summary}`);
  }
  console.log('\n특정 provider를 .env에 명시적으로 지정하려면: `npx llm-runner-setup --init`');
  console.log('배포 전 설정 점검: `npx llm-runner-setup --check-deploy`');
}

main();
