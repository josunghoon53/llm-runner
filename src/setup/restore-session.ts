import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

let codexRestored = false;
let restoredCodexHome: string | undefined;
/** 마지막으로 "알고 있는" auth.json의 해시. 회전 감지용. */
let lastKnownAuthHash: string | undefined;
/** 마지막으로 저장/복원한 base64 값. store가 조건부 쓰기를 걸 수 있게 넘겨주는 용도다. */
let lastKnownAuthBase64: string | undefined;
/** 인증 저장을 프로세스 안에서 직렬화하는 큐 — 동시 호출이 같은 갱신을 중복 저장하는 걸 막는다. */
let persistQueue: Promise<void> = Promise.resolve();

/**
 * 갱신된 Codex 인증 정보를 배포 환경 바깥(KV, DB, 시크릿 매니저 등)에 보관하기 위한 어댑터다.
 *
 * `auth.json`의 `refresh_token`은 1회용(rotating)이라, 배포된 함수가 만료된 access_token을
 * 갱신할 때마다 새 값이 발급되고 예전 값은 무효화된다. 환경변수는 함수가 스스로 고쳐 쓸 수 없어서,
 * 갱신분을 어딘가 바깥에 적어두지 않으면 다음 콜드스타트가 낡은 스냅샷을 다시 쓰고 언젠가 조용히 깨진다.
 *
 * 이 인터페이스만 구현해서 넘기면 **갱신 감지와 저장은 llm-runner가 알아서 한다** — 사용자는
 * "어디에 저장할지"만 정하면 된다.
 *
 * ```ts
 * const runner = createAiRunner({
 *   provider: 'openai-subscription',
 *   codexAuthStore: {
 *     load: () => kv.get<string>('codex-auth'),
 *     save: (value) => kv.set('codex-auth', value),
 *   },
 * });
 * ```
 *
 * 저장되는 값은 `auth.json` 전체를 base64로 인코딩한 문자열이다 — 로그인 세션 그 자체이므로
 * 반드시 비공개 저장소에 넣어야 한다.
 */
export interface CodexAuthStore {
  /** 저장해둔 값을 읽는다. 아직 없으면 `undefined`. */
  load(): Promise<string | undefined> | string | undefined;
  /**
   * 갱신된 값을 저장한다.
   *
   * `context.previous`는 llm-runner가 마지막으로 알고 있던 값이다. 여러 인스턴스가 동시에
   * 토큰을 갱신할 수 있는 환경(서버리스)에서는, 저장소가 "현재 값이 previous와 같을 때만 쓴다"는
   * 조건부 쓰기(CAS)를 걸어서 남의 갱신을 덮어쓰지 않게 만들 수 있다. 처음 저장하는 경우엔 없다.
   */
  save(authJsonBase64: string, context?: { previous?: string }): Promise<void> | void;
}

function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

function decodeAuthJson(base64Value: string): string {
  let content: string;
  let parsed: unknown;
  try {
    content = Buffer.from(base64Value, 'base64').toString('utf-8');
    parsed = JSON.parse(content);
  } catch (err) {
    throw new Error(
      '[llm-runner] Codex 인증값이 올바른 base64/JSON이 아니다. ' +
        '`npx llm-runner-setup --codex-auth-json`으로 값을 다시 만들어서 넣어라.',
      { cause: err },
    );
  }

  // auth.json의 구조는 OpenAI가 문서화한 계약이 아니라서 언제든 바뀔 수 있다. 여기서 최소한의
  // 모양을 확인해두면, 구조가 바뀌었을 때 "Codex 호출이 그냥 실패한다"가 아니라 "인증값 모양이
  // 예상과 다르다"로 드러난다 — 원인을 찾는 데 걸리는 시간이 완전히 달라진다.
  const tokens = (parsed as { tokens?: { access_token?: unknown } } | null)?.tokens;
  if (!tokens || typeof tokens.access_token !== 'string') {
    throw new Error(
      '[llm-runner] Codex 인증값의 구조가 예상과 다르다 (tokens.access_token이 없다). ' +
        '값이 잘린 건 아닌지 확인하고, `npx llm-runner-setup --codex-auth-json`으로 다시 만들어라. ' +
        '그래도 같은 에러가 나면 Codex CLI가 auth.json 형식을 바꾼 것일 수 있다 — llm-runner 업데이트를 확인해라.',
    );
  }

  return content;
}

/** 복원된 auth.json을 쓸 디렉터리를 정하고 실제로 파일을 쓴다. */
function writeAuthJson(base64Value: string): void {
  const content = decodeAuthJson(base64Value);
  const codexHome = process.env.CODEX_HOME || join(tmpdir(), 'llm-runner-codex-home');

  mkdirSync(codexHome, { recursive: true });
  writeFileSync(join(codexHome, 'auth.json'), content, { mode: 0o600 });

  process.env.CODEX_HOME = codexHome;
  restoredCodexHome = codexHome;
  lastKnownAuthHash = hashContent(content);
  lastKnownAuthBase64 = base64Value;
  codexRestored = true;
}

/**
 * 서버리스처럼 매번 새 인스턴스가 뜨는 환경에서는 `~/.codex/auth.json`이 콜드스타트마다 사라진다.
 * 이 함수는 두 가지 복원 방식을 지원한다.
 *
 * ## 1. `CODEX_AUTH_JSON` (개인 ChatGPT Plus/Free 계정 — 권장)
 * 로그인된 로컬 머신의 `~/.codex/auth.json` 파일 **전체 내용을 base64로 인코딩**해서 배포 환경의
 * 비밀 값으로 저장해두면, 콜드스타트마다 그 내용을 그대로 `$CODEX_HOME/auth.json`에 써서 복원한다.
 * 값은 `npx llm-runner-setup --codex-auth-json`으로 만든다.
 *
 * `codex login --with-access-token`을 거치지 않는다 — 실제로 검증한 결과, 그 로그인 방식은
 * **ChatGPT Business/Enterprise 워크스페이스 전용 토큰만 지원**하고, 개인 Plus/Free 계정의
 * 일반 세션 토큰은 "agent identity JWT payload is not valid JSON"라는 에러로 거부한다.
 * 반면 `auth.json` 파일 자체를 그대로 복사하는 건 개인 계정에서도 실제로 동작하는 걸 확인했다.
 *
 * ## 2. `CODEX_ACCESS_TOKEN` (ChatGPT Business/Enterprise 워크스페이스 전용)
 * OpenAI 공식 문서에 따르면 이 방식은 Business/Enterprise 워크스페이스 관리자 콘솔에서 발급한
 * 접근 토큰에서만 동작한다. 개인 계정에서 뽑은 일반 세션 토큰으로는 안 된다 — 직접 검증함.
 *
 * 두 값이 다 없으면 아무 것도 하지 않고 false를 반환한다 — 로컬 개발처럼 이미 `codex login`이
 * 되어 있는 환경에서는 이 함수를 호출해도 동작에 영향이 없다. 프로세스당 한 번만 실행한다(메모이즈).
 *
 * 토큰 회전까지 자동으로 관리하려면 이 함수 대신 {@link restoreCodexSession}에
 * {@link CodexAuthStore}를 넘겨라.
 */
export function restoreCodexSessionFromEnv(codexPathOverride?: string): boolean {
  if (codexRestored) return true;

  const authJsonBase64 = process.env.CODEX_AUTH_JSON;
  if (authJsonBase64) {
    writeAuthJson(authJsonBase64);
    return true;
  }

  const token = process.env.CODEX_ACCESS_TOKEN;
  if (!token) return false;

  const result = spawnSync(codexPathOverride ?? 'codex', ['login', '--with-access-token'], {
    input: token,
    encoding: 'utf-8',
    // Windows에서 npm으로 설치된 CLI는 .cmd 래퍼라서 shell 없이는 찾지 못한다.
    shell: process.platform === 'win32',
  });

  if (result.status !== 0) {
    throw new Error(
      `[llm-runner] CODEX_ACCESS_TOKEN으로 codex 세션 복원 실패: ${result.stderr || result.stdout}\n` +
        '이 방식은 ChatGPT Business/Enterprise 워크스페이스 전용 토큰만 지원한다 — ' +
        '개인 계정이면 대신 CODEX_AUTH_JSON을 써라 (이 파일의 문서 주석 참고).',
    );
  }

  codexRestored = true;
  return true;
}

export interface RestoreCodexSessionOptions {
  /** 갱신된 인증값을 보관할 외부 저장소. 넘기면 회전 감지/저장이 자동으로 동작한다. */
  store?: CodexAuthStore;
  codexPathOverride?: string;
}

/**
 * {@link restoreCodexSessionFromEnv}의 확장판. `store`를 넘기면 다음 순서로 복원한다.
 *
 * 1. `store.load()`에 값이 있으면 그걸 쓴다 — 지금까지 갱신되어 온 **최신** 값이다.
 * 2. 없으면 `CODEX_AUTH_JSON` 환경변수로 복원하고, 그 값을 store에 한 번 심어둔다(seed).
 *    이후부터는 store가 원본 노릇을 하므로, 환경변수는 최초 1회 부트스트랩용으로만 쓰인다.
 *
 * 이 구조 덕분에 "환경변수 스냅샷이 시간이 지나면 조용히 깨진다"는 문제가 해소된다 —
 * 실제 갱신분 저장은 {@link persistRotatedCodexAuth}가 담당하고, 러너가 호출마다 알아서 부른다.
 */
export async function restoreCodexSession(options: RestoreCodexSessionOptions = {}): Promise<boolean> {
  if (codexRestored) return true;

  if (options.store) {
    const stored = await options.store.load();
    if (stored) {
      writeAuthJson(stored);
      return true;
    }

    const seed = process.env.CODEX_AUTH_JSON;
    if (seed) {
      writeAuthJson(seed);
      // 다음 콜드스타트부터는 환경변수가 아니라 store를 원본으로 쓰게 만든다.
      await options.store.save(seed);
      return true;
    }
  }

  return restoreCodexSessionFromEnv(options.codexPathOverride);
}

/**
 * 복원 이후 `auth.json`이 실제로 바뀌었는지(=토큰이 회전됐는지) 확인하고, 바뀐 경우에만
 * `store.save()`로 반영한다. 안 바뀌었으면 아무 것도 하지 않고 `false`를 반환한다.
 *
 * Codex 호출이 끝난 직후에 부르는 걸 전제로 한다 — 러너가 자동으로 부르므로 보통 직접 쓸 일은 없다.
 * 저장 중 오류가 나도 예외를 던지지 않는다: 인증 보관은 부수적인 작업이라, 실패했다고 해서
 * 이미 성공한 AI 호출 결과까지 날려버리면 안 된다. 대신 stderr로 경고만 남긴다.
 */
export function persistRotatedCodexAuth(store: CodexAuthStore): Promise<boolean> {
  // 한 프로세스 안에서는 이 작업을 한 번에 하나씩만 돌린다.
  //
  // 이게 없으면 동시에 들어온 요청 두 개가 같은 변경을 보고 **둘 다 저장**한다:
  // 저장(await)이 끝나기 전에는 lastKnownAuthHash가 갱신되지 않아서, 뒤따라온 호출도
  // "아직 저장 안 된 새 값"으로 판단하기 때문이다. 서버에서 요청이 겹치면 바로 발생한다.
  //
  // 프로세스가 여러 개일 때의 경쟁은 여기서 못 막는다 — 그건 store가 조건부 쓰기(CAS)로
  // 막아야 하고, 그래서 save()에 previous를 함께 넘긴다.
  const next = persistQueue.then(
    () => persistRotatedCodexAuthOnce(store),
    () => persistRotatedCodexAuthOnce(store),
  );
  persistQueue = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

async function persistRotatedCodexAuthOnce(store: CodexAuthStore): Promise<boolean> {
  if (!restoredCodexHome) return false;

  let content: string;
  try {
    content = readFileSync(join(restoredCodexHome, 'auth.json'), 'utf-8');
  } catch {
    return false;
  }

  const hash = hashContent(content);
  if (hash === lastKnownAuthHash) return false;

  const next = Buffer.from(content, 'utf-8').toString('base64');
  try {
    await store.save(next, { previous: lastKnownAuthBase64 });
    lastKnownAuthHash = hash;
    lastKnownAuthBase64 = next;
    return true;
  } catch (err) {
    console.warn(
      '[llm-runner] Codex 인증 토큰이 갱신됐지만 codexAuthStore에 저장하지 못했다. ' +
        '이 상태가 계속되면 언젠가 인증이 만료된다 — store 구현을 확인해라.',
      err,
    );
    return false;
  }
}

/**
 * `CODEX_AUTH_JSON`으로 복원한 세션은 **정적 스냅샷**이라는 한계가 있다: `auth.json` 안의
 * `refresh_token`은 보통 1회용(rotating)이라, 배포된 함수가 access_token을 갱신할 때마다
 * 새로 발급되고 예전 값은 무효화된다. 그 갱신분은 인스턴스가 죽으면 사라진다.
 *
 * `codexAuthStore`를 쓰면 이 저장이 자동으로 이뤄지므로 이 함수를 직접 부를 필요가 없다.
 * store 없이 직접 파이프라인을 짜고 싶을 때만 쓴다.
 *
 * 복원한 적이 없으면(=서버리스가 아니거나 이 메커니즘을 안 썼으면) `undefined`를 반환한다.
 */
export function getRefreshedCodexAuthJson(): string | undefined {
  if (!restoredCodexHome) return undefined;
  try {
    const content = readFileSync(join(restoredCodexHome, 'auth.json'), 'utf-8');
    return Buffer.from(content, 'utf-8').toString('base64');
  } catch {
    return undefined;
  }
}

export interface CodexAuthFreshness {
  /** auth.json을 읽고 해석할 수 있었는지. false면 나머지 필드는 비어 있다. */
  readable: boolean;
  /** access_token의 만료 시각. JWT가 아니거나 exp가 없으면 undefined. */
  accessTokenExpiresAt?: Date;
  /** 지금 기준으로 access_token이 이미 만료됐는지. */
  accessTokenExpired?: boolean;
  /** auth.json에 기록된 마지막 갱신 시각(`last_refresh`). */
  lastRefreshAt?: Date;
  /** 사람이 읽을 수 있는 한 줄 진단. */
  summary: string;
}

/** JWT의 payload에서 exp만 꺼낸다. 서명은 검증하지 않고, 토큰 내용은 반환하지 않는다. */
function readJwtExpiry(token: unknown): Date | undefined {
  if (typeof token !== 'string') return undefined;
  const payloadSegment = token.split('.')[1];
  if (!payloadSegment) return undefined;
  try {
    const payload = JSON.parse(Buffer.from(payloadSegment, 'base64url').toString('utf-8')) as {
      exp?: unknown;
    };
    if (typeof payload.exp !== 'number') return undefined;
    return new Date(payload.exp * 1000);
  } catch {
    return undefined;
  }
}

/**
 * 현재 Codex 인증 상태가 얼마나 "신선한지" 확인한다. 민감한 토큰 값은 절대 반환하지 않고,
 * 만료 시각과 마지막 갱신 시각만 본다.
 *
 * 서버리스 배포에서 `codexAuthStore` 없이 환경변수 스냅샷만 쓰고 있을 때, 그 스냅샷이 언제쯤
 * 깨질지 미리 알려주는 용도다. `npx llm-runner-setup`도 이 정보를 출력한다.
 */
export function checkCodexAuthFreshness(): CodexAuthFreshness {
  const codexHome = restoredCodexHome ?? process.env.CODEX_HOME ?? join(homedir(), '.codex');

  let parsed: { tokens?: Record<string, unknown>; last_refresh?: unknown };
  try {
    parsed = JSON.parse(readFileSync(join(codexHome, 'auth.json'), 'utf-8'));
  } catch {
    return { readable: false, summary: 'auth.json을 읽을 수 없다 — `codex login`이 필요하다.' };
  }

  const accessTokenExpiresAt = readJwtExpiry(parsed.tokens?.['access_token']);
  const lastRefreshRaw = typeof parsed.last_refresh === 'string' ? new Date(parsed.last_refresh) : undefined;
  const lastRefreshAt = lastRefreshRaw && !Number.isNaN(lastRefreshRaw.getTime()) ? lastRefreshRaw : undefined;
  const accessTokenExpired = accessTokenExpiresAt ? accessTokenExpiresAt.getTime() < Date.now() : undefined;

  const summary = (() => {
    if (accessTokenExpired === undefined) {
      return 'access_token의 만료 시각을 해석할 수 없다 — 형식이 예상과 다르다.';
    }
    if (accessTokenExpired) {
      return (
        'access_token이 이미 만료됐다. 다음 호출에서 자동 갱신이 일어나고, 그 과정에서 refresh_token이 ' +
        '새 값으로 교체된다. 서버리스에서 환경변수 스냅샷만 쓰고 있다면 갱신분이 저장되지 않아 ' +
        '언젠가 인증이 깨진다 — codexAuthStore를 설정해라.'
      );
    }
    const hoursLeft = Math.round((accessTokenExpiresAt!.getTime() - Date.now()) / 3_600_000);
    return `access_token이 약 ${hoursLeft}시간 뒤 만료된다. 그 이후 호출부터 refresh_token 회전이 시작된다.`;
  })();

  return { readable: true, accessTokenExpiresAt, accessTokenExpired, lastRefreshAt, summary };
}

/** 테스트용 — 모듈 수준 메모이즈 상태를 초기화한다. */
export function __resetCodexRestoreStateForTests(): void {
  codexRestored = false;
  restoredCodexHome = undefined;
  lastKnownAuthHash = undefined;
  lastKnownAuthBase64 = undefined;
  persistQueue = Promise.resolve();
}

/**
 * 서버리스로 보이는 환경인지 대략 판단한다. 정확할 필요는 없고, "여기서 store 없이 쓰면
 * 언젠가 조용히 깨진다"는 경고를 띄울지 말지만 정하면 된다.
 */
export function looksLikeServerless(): boolean {
  return Boolean(
    process.env.VERCEL ||
      process.env.AWS_LAMBDA_FUNCTION_NAME ||
      process.env.K_SERVICE ||
      process.env.FUNCTION_TARGET,
  );
}
