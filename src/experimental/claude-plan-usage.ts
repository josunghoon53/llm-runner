/**
 * Claude 구독 플랜의 남은 사용량을 읽는다. 터미널에서 `/usage`를 쳤을 때 보는 그 값이다.
 *
 * **왜 experimental인가** — 세 가지가 전부 불안정하다.
 *
 * 1. SDK가 이 기능을 `usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET()`라는
 *    이름으로 내놨다. 문서에 "안정화되면 메서드 이름이 바뀐다"고 적혀 있다.
 * 2. 응답에 타입 정의에 없는 필드가 섞여 온다(실측: `iguana_necktie`, `nimbus_quill`).
 *    그래서 알려진 창만 골라 담고 나머지는 `others`로 흘려보낸다.
 * 3. API 키·Bedrock·Vertex는 플랜 한도 개념이 없어 `available: false`로 온다.
 *
 * Codex 쪽은 `getCodexPlanUsage()`가 따로 있다. 공식 `@openai/codex-sdk` 타입에는
 * 한도 관련이 없지만 app-server 프로토콜에는 있어서, 그쪽을 직접 부른다.
 *
 * 그래서 `AiRunner` 인터페이스에는 올리지 않는다. provider를 바꿔도 같은 코드가 도는 것이
 * 이 패키지의 약속인데, 한쪽만 되는 기능을 거기 넣으면 그 약속이 깨진다.
 *
 * **비용** — 토큰을 쓰지 않는다. 프롬프트를 보내지 않고 제어 요청만 보내기 때문이다
 * (실측: 세션 비용 $0, 약 2초).
 */
import { query } from '@anthropic-ai/claude-agent-sdk';
import { buildProfileEnv } from '../setup/profile-env.js';

/** SDK가 안정화되면서 바뀔 이름. 한 곳에서만 쓰도록 모아 둔다. */
const USAGE_METHOD = 'usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET';

export interface ClaudePlanWindow {
  /** 창을 얼마나 썼는지, 0~100. 값을 못 받으면 undefined. */
  usedPercent?: number;
  /** 남은 비율, 0~100. `usedPercent`에서 계산한 값이다. */
  remainingPercent?: number;
  /** 창이 리셋되는 시각. */
  resetsAt?: Date;
}

export interface ClaudePlanUsage {
  /**
   * 플랜 한도를 조회할 수 있었는가. API 키·Bedrock·Vertex 세션은 `false`이고
   * 이때 창 정보는 전부 비어 있다.
   */
  available: boolean;
  /** 'pro' | 'max' | 'team' | 'enterprise' 등. 구독이 아니면 undefined. */
  subscriptionType?: string;
  /** 5시간 창. */
  fiveHour?: ClaudePlanWindow;
  /** 7일 창. */
  sevenDay?: ClaudePlanWindow;
  /**
   * 위 둘 말고 응답에 실려 온 창들. SDK 타입에 없는 것도 그대로 담는다 —
   * 이름이 언제 바뀔지 모르니 구조에 의존하지 말고 표시 용도로만 써라.
   */
  others: Record<string, ClaudePlanWindow>;
}

type RawWindow = { utilization?: number | null; resets_at?: string | null } | null | undefined;

function toWindow(raw: RawWindow): ClaudePlanWindow | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const used = typeof raw.utilization === 'number' ? raw.utilization : undefined;
  const resets = raw.resets_at ? new Date(raw.resets_at) : undefined;
  return {
    usedPercent: used,
    remainingPercent: used === undefined ? undefined : Math.max(0, 100 - used),
    // 파싱 못 하는 문자열이 오면 Invalid Date를 넘기지 않고 버린다.
    resetsAt: resets && !Number.isNaN(resets.getTime()) ? resets : undefined,
  };
}

/**
 * 플랜 사용량을 한 번 읽는다.
 *
 * ```ts
 * import { getClaudePlanUsage } from 'llm-runner/experimental';
 *
 * const usage = await getClaudePlanUsage();
 * if (usage.available) {
 *   console.log(`5시간 창 ${usage.fiveHour?.remainingPercent}% 남음`);
 * }
 * ```
 */
export async function getClaudePlanUsage(
  options: { timeoutMs?: number; claudeConfigDir?: string } = {},
): Promise<ClaudePlanUsage> {
  const empty: ClaudePlanUsage = { available: false, others: {} };

  // 입력을 닫지 않고 붙잡아 둬야 제어 요청이 간다. 일회성 호출은 결과를 내는 순간
  // CLI 프로세스가 끝나서 채널이 닫히고, 그러면 "Query closed"가 난다(실측).
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
    const call = (stream as unknown as Record<string, unknown>)[USAGE_METHOD];
    // SDK가 이름을 바꾸면 여기서 조용히 빠진다 — 던지지 않고 available: false로 돌려준다.
    if (typeof call !== 'function') return empty;

    const raw = (await withTimeout(
      (call as (opts: { skipBehaviors: boolean }) => Promise<unknown>).call(stream, { skipBehaviors: true }),
      options.timeoutMs ?? 15_000,
    )) as {
      subscription_type?: string | null;
      rate_limits_available?: boolean;
      rate_limits?: Record<string, RawWindow> | null;
    };

    if (!raw?.rate_limits_available || !raw.rate_limits) {
      return { ...empty, subscriptionType: raw?.subscription_type ?? undefined };
    }

    const others: Record<string, ClaudePlanWindow> = {};
    for (const [key, value] of Object.entries(raw.rate_limits)) {
      if (key === 'five_hour' || key === 'seven_day') continue;
      const window = toWindow(value);
      // 값이 하나도 없는 항목은 표에 넣어봐야 빈 줄만 된다.
      if (window?.usedPercent !== undefined || window?.resetsAt) others[key] = window;
    }

    return {
      available: true,
      subscriptionType: raw.subscription_type ?? undefined,
      fiveHour: toWindow(raw.rate_limits.five_hour),
      sevenDay: toWindow(raw.rate_limits.seven_day),
      others,
    };
  } catch {
    // 잔량 조회는 부가 기능이다. 실패했다고 호출한 쪽 흐름을 끊지 않는다.
    return empty;
  } finally {
    release();
    await stream.return?.(undefined).catch(() => {});
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`플랜 사용량 조회가 ${ms}ms 안에 끝나지 않았다.`)), ms);
    promise.then(resolve, reject).finally(() => clearTimeout(timer));
  });
}
