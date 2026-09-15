#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { checkClaudeStatus, checkCodexStatus, type CliStatus } from '../setup/check-status.js';
import type { AiProvider } from '../create-ai-runner.js';

const args = process.argv.slice(2);
const shouldLogin = args.includes('--login');
const shouldInit = args.includes('--init');

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

async function main(): Promise<void> {
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
  console.log('\n특정 provider를 .env에 명시적으로 지정하려면: `npx llm-runner-setup --init`');
}

main();
