import { spawnSync } from 'node:child_process';
import { isCommandOnPath } from '../ai-cli-check.js';

export interface CliStatus {
  installed: boolean;
  loggedIn: boolean;
  /** 서버리스처럼 로그인 세션 파일이 유지되지 않는 환경에서 쓸 수 있는 환경변수 기반 인증이 설정되어 있는지 */
  portableTokenAvailable: boolean;
  detail?: string;
  installCommand: string;
  loginCommand: string;
}

/**
 * `claude`/`codex` 상태 확인은 개발자가 터미널에서 실행하는 셋업 단계 전용이다.
 * 실제 AiRunner.run() 경로는 spawn/exec를 쓰지 않고 공식 SDK만 사용한다 — 이 파일은 그 예외다.
 */
export function checkClaudeStatus(): CliStatus {
  const installed = isCommandOnPath('claude');
  const portableTokenAvailable = Boolean(process.env.CLAUDE_CODE_OAUTH_TOKEN);
  const base: CliStatus = {
    installed,
    loggedIn: false,
    portableTokenAvailable,
    installCommand: 'npm install -g @anthropic-ai/claude-code',
    loginCommand: 'claude login  (또는 서버리스라면: claude setup-token 결과를 CLAUDE_CODE_OAUTH_TOKEN에 저장)',
  };

  if (portableTokenAvailable) {
    return { ...base, loggedIn: true, detail: 'CLAUDE_CODE_OAUTH_TOKEN 환경변수로 인증됨' };
  }

  if (!installed) return base;

  // Windows에서 npm으로 설치된 CLI는 .cmd 래퍼라서 shell 없이는 spawnSync가 찾지 못한다.
  const result = spawnSync('claude', ['auth', 'status'], { encoding: 'utf-8', shell: process.platform === 'win32' });
  try {
    const status = JSON.parse(result.stdout ?? '');
    if (status.loggedIn) {
      return { ...base, loggedIn: true, detail: `${status.email} (${status.subscriptionType})` };
    }
  } catch {
    // JSON 파싱 실패 시 미로그인으로 취급
  }
  return base;
}

export function checkCodexStatus(): CliStatus {
  const installed = isCommandOnPath('codex');
  const portableTokenAvailable = Boolean(process.env.CODEX_ACCESS_TOKEN);
  const base: CliStatus = {
    installed,
    loggedIn: false,
    portableTokenAvailable,
    installCommand: 'npm install -g @openai/codex',
    loginCommand: 'codex login  (또는 서버리스라면: ~/.codex/auth.json의 access_token을 CODEX_ACCESS_TOKEN에 저장)',
  };

  if (!installed) {
    return portableTokenAvailable ? { ...base, loggedIn: true, detail: 'CODEX_ACCESS_TOKEN 환경변수 설정됨 (codex CLI는 아직 미설치)' } : base;
  }

  const result = spawnSync('codex', ['login', 'status'], { encoding: 'utf-8', shell: process.platform === 'win32' });
  // codex는 이 출력을 stdout이 아니라 stderr로 내보낸다.
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  if (result.status === 0 && output.includes('Logged in')) {
    return { ...base, loggedIn: true, detail: output.trim() };
  }

  if (portableTokenAvailable) {
    return { ...base, loggedIn: true, detail: 'CODEX_ACCESS_TOKEN 환경변수로 콜드스타트 시 자동 복원됨' };
  }

  return base;
}

export interface SubscriptionSetupReport {
  claude: CliStatus;
  codex: CliStatus;
}

/** 프로그램에서 직접 상태를 확인하고 싶을 때 쓰는 API (예: 앱 시작 전 사용자에게 안내 메시지 띄우기). */
export function checkSubscriptionSetup(): SubscriptionSetupReport {
  return { claude: checkClaudeStatus(), codex: checkCodexStatus() };
}
