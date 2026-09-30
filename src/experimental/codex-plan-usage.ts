/**
 * Codex 구독 플랜의 남은 사용량을 읽는다. `getClaudePlanUsage()`의 Codex판이다.
 *
 * **공식 SDK에는 없다.** `@openai/codex-sdk`의 타입에는 한도·잔량 관련이 하나도 없고,
 * 토큰 수만 준다. 대신 `codex app-server`의 JSON-RPC 프로토콜에 `account/rateLimits/read`가
 * 있어서 그걸 직접 부른다 — llm-runner가 세션에 이미 쓰고 있는 채널이다.
 *
 * **왜 experimental인가** — app-server는 OpenAI가 CLI에서 스스로 `[experimental]`이라고
 * 표시한 프로토콜이다. CLI가 올라가면 예고 없이 바뀔 수 있다.
 *
 * **비용** — 토큰을 쓰지 않는다. 턴을 시작하지 않고 계정 조회 요청만 보낸다.
 */
import { CodexAppServerPeer } from './codex-app-server-session.js';
import { buildProfileEnv } from '../setup/profile-env.js';

export interface CodexPlanWindow {
  /** 창을 얼마나 썼는지, 0~100. */
  usedPercent?: number;
  /** 남은 비율, 0~100. */
  remainingPercent?: number;
  /** 창이 리셋되는 시각. */
  resetsAt?: Date;
  /** 창의 길이(분). 실측: primary 300분(5시간), secondary 10080분(7일). */
  windowMinutes?: number;
}

export interface CodexPlanUsage {
  /** 한도를 조회할 수 있었는가. */
  available: boolean;
  /** 'free' | 'plus' | 'pro' | 'team' | 'business' | 'enterprise' 등. */
  planType?: string;
  /** 짧은 창. 실측으로 300분(5시간)이었다. */
  primary?: CodexPlanWindow;
  /** 긴 창. 실측으로 10080분(7일)이었다. */
  secondary?: CodexPlanWindow;
  /** 추가 크레딧 상태. */
  credits?: { hasCredits: boolean; unlimited: boolean; balance?: string };
  /**
   * 일반 사용이 아직 허용되는가. 프로토콜 주석이 못 박는다 —
   * "null이면 알 수 없음이며, 퍼센트나 리셋 시각으로 회복을 추론하면 안 된다."
   */
  ordinaryUsageAllowed?: boolean;
}

export type RawCodexWindow = { usedPercent?: number; resetsAt?: number | null; windowDurationMins?: number | null } | null;

function toWindow(raw: RawCodexWindow): CodexPlanWindow | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const used = typeof raw.usedPercent === 'number' ? raw.usedPercent : undefined;
  return {
    usedPercent: used,
    remainingPercent: used === undefined ? undefined : Math.max(0, 100 - used),
    // 초 단위 epoch으로 온다(실측: 1790602296).
    resetsAt: typeof raw.resetsAt === 'number' ? new Date(raw.resetsAt * 1000) : undefined,
    windowMinutes: typeof raw.windowDurationMins === 'number' ? raw.windowDurationMins : undefined,
  };
}

/**
 * ```ts
 * import { getCodexPlanUsage } from 'llm-runner/experimental';
 *
 * const usage = await getCodexPlanUsage();
 * if (usage.available) console.log(`5시간 창 ${usage.primary?.remainingPercent}% 남음`);
 * ```
 */
export async function getCodexPlanUsage(
  options: { codexPathOverride?: string; timeoutMs?: number; codexHome?: string } = {},
): Promise<CodexPlanUsage> {
  const peer = new CodexAppServerPeer(
    options.codexPathOverride,
    undefined,
    options.timeoutMs ?? 20_000,
    buildProfileEnv(options, ['codexHome']),
  );
  try {
    await peer.initialize();
    const raw = await peer.request<{
      ordinaryUsageAllowed?: boolean | null;
      rateLimits?: {
        planType?: string | null;
        primary?: RawCodexWindow;
        secondary?: RawCodexWindow;
        credits?: { hasCredits: boolean; unlimited: boolean; balance?: string | null } | null;
      } | null;
    }>('account/rateLimits/read', { excludeResetCreditDetails: true });

    const limits = raw?.rateLimits;
    if (!limits) return { available: false };
    return toPlanUsage(limits, raw.ordinaryUsageAllowed ?? undefined);
  } catch {
    // 잔량 조회는 부가 기능이다. 실패로 호출한 쪽 흐름을 끊지 않는다.
    return { available: false };
  } finally {
    peer.close();
  }
}

/**
 * `RateLimitSnapshot` 하나를 `CodexPlanUsage`로 바꾼다.
 *
 * 조회(`account/rateLimits/read`)와 알림(`account/rateLimits/updated`)이 같은 스냅샷 구조를
 * 쓰므로 한 곳에서 처리한다 — 두 군데로 나뉘면 한쪽만 고치는 일이 생긴다.
 */
export function toPlanUsage(
  limits: {
    planType?: string | null;
    primary?: RawCodexWindow;
    secondary?: RawCodexWindow;
    credits?: { hasCredits: boolean; unlimited: boolean; balance?: string | null } | null;
  },
  ordinaryUsageAllowed?: boolean,
): CodexPlanUsage {
  return {
    available: true,
    planType: limits.planType ?? undefined,
    primary: toWindow(limits.primary ?? null),
    secondary: toWindow(limits.secondary ?? null),
    credits: limits.credits
      ? {
          hasCredits: limits.credits.hasCredits,
          unlimited: limits.credits.unlimited,
          balance: limits.credits.balance ?? undefined,
        }
      : undefined,
    ordinaryUsageAllowed,
  };
}
