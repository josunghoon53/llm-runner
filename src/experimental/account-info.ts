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
import { CodexAppServerPeer } from './codex-app-server-session.js';

export interface LlmAccountInfo {
  /** 계정을 읽을 수 있었는가. 로그인이 안 됐거나 조회에 실패하면 false. */
  available: boolean;
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

/** Claude 구독 계정. 프롬프트를 보내지 않으므로 토큰을 쓰지 않는다. */
export async function getClaudeAccountInfo(options: { timeoutMs?: number } = {}): Promise<LlmAccountInfo> {
  // 입력을 닫지 않고 붙잡아 둬야 제어 요청이 간다. 일회성 호출은 결과를 내는 순간
  // CLI가 끝나서 채널이 닫히고 "Query closed"가 난다(plan-usage에서 겪은 것과 같다).
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  async function* holdOpen() {
    await held;
  }

  const stream = query({ prompt: holdOpen(), options: { allowedTools: [], disallowedTools: [] } });
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
  options: { codexPathOverride?: string; timeoutMs?: number } = {},
): Promise<LlmAccountInfo> {
  const peer = new CodexAppServerPeer(options.codexPathOverride, undefined, options.timeoutMs ?? 20_000);
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
