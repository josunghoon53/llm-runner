/**
 * 구독 계정 프로필을 고르는 환경변수를 만든다.
 *
 * Claude와 Codex는 각각 자격 증명을 한 디렉터리에 모아 두고, 그 위치를 환경변수로 바꿀 수 있다.
 * 다른 디렉터리를 가리키면 **완전히 다른 계정 컨텍스트**가 된다(실측: 빈 CODEX_HOME →
 * `account=null`, 기본 → `account=chatgpt`). 기존 로그인은 전혀 건드리지 않는다.
 *
 * **왜 라이브러리가 감싸는가** — 두 SDK 모두 `env`를 주면 `process.env`를 병합이 아니라
 * **통째로 교체**한다:
 *
 * - Codex: "When provided, the SDK will not inherit variables from `process.env`."
 * - Claude: "this value REPLACES the subprocess environment entirely"
 *
 * 그래서 호출부가 `{ CODEX_HOME: x }`만 넘기면 PATH·HOME까지 날아가 "바이너리를 못 찾는다"는
 * 엉뚱한 오류가 난다. 원인을 찾기 어려운 종류라 여기서 병합해 준다.
 */

/** 프로필 디렉터리를 지정하는 옵션. 둘 다 생략하면 각 CLI의 기본 위치를 쓴다. */
export interface ProfileOptions {
  /**
   * Codex 자격 증명 디렉터리(`CODEX_HOME`). 기본값은 `~/.codex`.
   *
   * 여기 로그인하려면 사용자가 직접 한 번 실행해야 한다 — 브라우저 인증이라 자동화되지 않는다:
   * `CODEX_HOME=<경로> codex login`
   */
  codexHome?: string;
  /**
   * Claude 자격 증명 디렉터리(`CLAUDE_CONFIG_DIR`). 기본값은 `~/.claude`.
   *
   * 여기 로그인하려면: `CLAUDE_CONFIG_DIR=<경로> claude auth login`
   */
  claudeConfigDir?: string;
}

/**
 * `process.env`에 프로필 변수를 얹은 새 환경을 만든다. 원본은 건드리지 않는다.
 *
 * 값이 없으면 `undefined`를 돌려준다 — 그때는 SDK에 `env`를 아예 넘기지 말라는 뜻이다.
 * 빈 객체를 넘기면 환경이 통째로 비워지므로, 이 구분이 중요하다.
 */
export function buildProfileEnv(
  options: ProfileOptions,
  /** 이 변수들만 덮어쓴다. provider마다 쓰는 게 달라서 호출부가 고른다. */
  pick: Array<'codexHome' | 'claudeConfigDir'>,
): NodeJS.ProcessEnv | undefined {
  const overrides: Record<string, string> = {};
  if (pick.includes('codexHome') && options.codexHome) overrides.CODEX_HOME = options.codexHome;
  if (pick.includes('claudeConfigDir') && options.claudeConfigDir) {
    overrides.CLAUDE_CONFIG_DIR = options.claudeConfigDir;
  }

  if (Object.keys(overrides).length === 0) return undefined;
  return { ...process.env, ...overrides };
}

/**
 * Codex SDK는 `Record<string, string>`만 받는다. `process.env`에는 값이 `undefined`인 키가
 * 섞일 수 있어서(삭제된 변수) 그대로 넘기면 타입이 안 맞고, 런타임에도 "undefined" 문자열이
 * 될 수 있다. 그런 키는 빼고 넘긴다.
 */
export function toStringEnv(env: NodeJS.ProcessEnv | undefined): Record<string, string> | undefined {
  if (!env) return undefined;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === 'string') out[key] = value;
  }
  return out;
}
