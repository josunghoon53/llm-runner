/**
 * 어느 계정으로 실행되고 있는지 읽는다. 잘못된 계정으로 구독을 쓰는 실수를 막는 용도다.
 *
 * **개인정보** — 이메일이 들어 있다. 로컬 로그인 세션에서 읽어오는 값이므로 서버에 보내거나
 * 로그에 남기지 마라. 화면에 띄울 때도 로그인한 본인에게만 보여주는 게 맞다.
 * 이 함수는 자격 증명 자체(토큰·키)는 절대 읽지 않는다 — SDK와 CLI가 알아서 쓴다.
 *
 * **왜 experimental인가** — `getClaudePlanUsage()` / `getCodexPlanUsage()`와 같은 이유다.
 * Claude는 Agent SDK의 제어 요청, Codex는 `[experimental]`로 표시된 app-server 프로토콜을 쓴다.
 *
 * **비용** — 토큰을 쓰지 않는다. 프롬프트를 보내지 않고 계정 조회 요청만 보낸다.
 */
import { query } from '@anthropic-ai/claude-agent-sdk';
import { spawn } from 'node:child_process';
import { CodexAppServerPeer } from './codex-app-server-session.js';
import { buildProfileEnv } from '../setup/profile-env.js';

export interface LlmAccountInfo {
  /** 계정을 읽을 수 있었는가. 로그인이 안 됐거나 조회에 실패하면 false. */
  available: boolean;
  /**
   * 어느 프로필 디렉터리를 보고 있는지. 여러 계정을 굴릴 때 "지금 이게 어느 프로필인가"를
   * 확인하는 용도다. Claude만 채워진다 — Codex는 호출할 때 준 `codexHome`이 곧 답이다.
   */
  configDirectory?: string;
  /** Claude 전용 — 조직 식별자. */
  organizationId?: string;
  /** 로그인 이메일. 구독이 아닌 인증(API 키·Bedrock 등)에서는 없다. */
  email?: string;
  /** Claude: 'pro' | 'max' | 'team' 등. Codex: 'plus' | 'pro' | 'team' 등. */
  plan?: string;
  /** Claude 전용 — 소속 조직. */
  organization?: string;
  /**
   * 어떤 인증으로 붙어 있는가.
   * Claude: 'firstParty'(구독 로그인) | 'bedrock' | 'vertex' | 'gateway' 등.
   * Codex: 'chatgpt'(구독 로그인) | 'apiKey' | 'amazonBedrock'.
   */
  authKind?: string;
}

/**
 * `claude auth status --json`으로 계정을 읽는다. 실측(2026-09-30): **216ms에 필드 10개**로,
 * SDK의 `accountInfo()`(2,663ms에 5개)보다 12배 빠르고 정보도 많다. 특히 `loggedIn`과
 * `configDirectory`는 SDK 쪽에 없다 — 로그인 안 된 상태를 '이메일이 비었다'로 추측하지 않고
 * 명시적으로 알 수 있고, 어느 프로필을 보고 있는지도 확인된다.
 */
function readClaudeAuthStatus(
  options: { claudeConfigDir?: string; claudePathOverride?: string; timeoutMs?: number },
): Promise<Record<string, unknown> | undefined> {
  const env = buildProfileEnv(options, ['claudeConfigDir']);
  return new Promise((resolve) => {
    const child = spawn(options.claudePathOverride ?? 'claude', ['auth', 'status', '--json'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      ...(env ? { env } : {}),
    });
    let out = '';
    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (c: string) => (out += c));

    const timer = setTimeout(() => {
      child.kill();
      resolve(undefined);
    }, options.timeoutMs ?? 15_000);

    // 실행파일이 없거나 CLI가 옛 버전이라 --json을 모르면 여기로 온다. SDK 경로로 넘긴다.
    child.on('error', () => {
      clearTimeout(timer);
      resolve(undefined);
    });
    child.on('exit', () => {
      clearTimeout(timer);
      try {
        resolve(JSON.parse(out) as Record<string, unknown>);
      } catch {
        resolve(undefined);
      }
    });
  });
}

/**
 * Claude 구독 계정.
 *
 * `claude auth status --json`을 먼저 쓰고, 그게 안 되면 Agent SDK의 `accountInfo()`로 넘어간다.
 * CLI 쪽이 훨씬 빠르고 정보도 많지만, 옛 CLI에는 `--json`이 없을 수 있어서 대비책을 남긴다.
 * 어느 경로든 프롬프트를 보내지 않으므로 토큰을 쓰지 않는다.
 */
export async function getClaudeAccountInfo(
  options: { timeoutMs?: number; claudeConfigDir?: string; claudePathOverride?: string } = {},
): Promise<LlmAccountInfo> {
  const status = await readClaudeAuthStatus(options);
  if (status && typeof status.loggedIn === 'boolean') {
    const str = (key: string) => (typeof status[key] === 'string' ? (status[key] as string) : undefined);
    if (!status.loggedIn) {
      return { available: false, authKind: str('apiProvider'), configDirectory: str('configDirectory') };
    }
    return {
      available: true,
      email: str('email'),
      plan: str('subscriptionType'),
      organization: str('orgName'),
      organizationId: str('orgId'),
      authKind: str('apiProvider'),
      configDirectory: str('configDirectory'),
    };
  }

  return getClaudeAccountInfoViaSdk(options);
}

/** CLI를 못 쓸 때의 대비책. Agent SDK의 제어 요청을 쓴다. */
async function getClaudeAccountInfoViaSdk(
  options: { timeoutMs?: number; claudeConfigDir?: string } = {},
): Promise<LlmAccountInfo> {
  // 입력을 닫지 않고 붙잡아 둬야 제어 요청이 간다. 일회성 호출은 결과를 내는 순간
  // CLI가 끝나서 채널이 닫히고 "Query closed"가 난다(plan-usage에서 겪은 것과 같다).
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  async function* holdOpen() {
    await held;
  }

  const profileEnv = buildProfileEnv(options, ['claudeConfigDir']);
  const stream = query({
    prompt: holdOpen(),
    options: { allowedTools: [], disallowedTools: [], ...(profileEnv ? { env: profileEnv } : {}) },
  });
  try {
    const call = (stream as unknown as Record<string, unknown>).accountInfo;
    if (typeof call !== 'function') return { available: false };

    const info = (await withTimeout(
      (call as () => Promise<Record<string, string | undefined>>).call(stream),
      options.timeoutMs ?? 15_000,
    )) as { email?: string; organization?: string; subscriptionType?: string; apiProvider?: string };

    // 이메일도 플랜도 없으면 보여줄 게 없다 — 조회는 됐지만 쓸모없는 응답으로 본다.
    if (!info?.email && !info?.subscriptionType) return { available: false, authKind: info?.apiProvider };

    return {
      available: true,
      email: info.email,
      plan: info.subscriptionType,
      organization: info.organization,
      authKind: info.apiProvider,
    };
  } catch {
    return { available: false };
  } finally {
    release();
    await stream.return?.(undefined).catch(() => {});
  }
}

/** Codex 구독 계정. app-server의 `account/read`를 쓴다. */
export async function getCodexAccountInfo(
  options: { codexPathOverride?: string; timeoutMs?: number; codexHome?: string } = {},
): Promise<LlmAccountInfo> {
  const peer = new CodexAppServerPeer(
    options.codexPathOverride,
    undefined,
    options.timeoutMs ?? 20_000,
    buildProfileEnv(options, ['codexHome']),
  );
  try {
    await peer.initialize();
    const raw = await peer.request<{
      account?: { type?: string; email?: string | null; planType?: string } | null;
    }>('account/read', {});

    const account = raw?.account;
    if (!account?.type) return { available: false };

    // API 키·Bedrock 계정은 이메일·플랜이 없다. 인증 종류만 알려주고 available은 false로 둔다.
    if (account.type !== 'chatgpt') return { available: false, authKind: account.type };

    return {
      available: true,
      email: account.email ?? undefined,
      plan: account.planType,
      authKind: account.type,
    };
  } catch {
    return { available: false };
  } finally {
    peer.close();
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`계정 조회가 ${ms}ms 안에 끝나지 않았다.`)), ms);
    promise.then(resolve, reject).finally(() => clearTimeout(timer));
  });
}
