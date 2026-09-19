/**
 * `llm-runner-setup --check-deploy`가 쓰는 순수 판정 로직.
 *
 * CLI 본체(`bin/setup.ts`)에서 떼어낸 이유는 테스트 때문이다. 이 판정에서 한 번 실수가 있었다:
 * AI를 안 쓰는 라우트까지 문제로 세어 종료 코드 1을 내는 바람에, CI에 넣으면 멀쩡한 빌드가
 * 깨지는 상태였다. 외부 사용자가 그걸 지적해서 고쳤고, 다시 안 깨지게 테스트로 고정한다.
 */

/** 라우트 글로브 매칭. picomatch 같은 의존성을 들이지 않으려고 `*`/`**`만 지원한다. */
export function globMatches(pattern: string, path: string): boolean {
  const regex = pattern
    .split('**')
    .map((part) => part.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*'))
    .join('.*');
  return new RegExp(`^${regex}$`).test(path);
}

export interface RouteUnderCheck {
  /** `/api/ai` 같은 라우트 경로. */
  route: string;
  /** 그 라우트가 실제로 llm-runner를 import하는지. */
  usesLlmRunner: boolean;
}

export interface RouteCheckResult {
  /** 설정 범위 밖이지만 llm-runner를 안 써서 문제가 아닌 라우트. */
  harmless: string[];
  /** llm-runner를 쓰는데 설정에 안 걸려서 배포 후 실패할 라우트. */
  problems: string[];
}

/**
 * 선언된 글로브에 안 걸리는 라우트를 "진짜 문제"와 "무해한 것"으로 가른다.
 *
 * 대부분의 앱에는 AI를 안 쓰는 라우트가 있다. 그걸 전부 문제로 세면 점검이 늘 실패해서
 * CI에 넣을 수 없게 되므로, llm-runner를 실제로 import하는 라우트만 문제로 본다.
 */
export function classifyRoutes(declared: string[], routes: RouteUnderCheck[]): RouteCheckResult {
  const unmatched = routes.filter(({ route }) => !declared.some((pattern) => globMatches(pattern, route)));

  return {
    harmless: unmatched.filter((r) => !r.usesLlmRunner).map((r) => r.route),
    problems: unmatched.filter((r) => r.usesLlmRunner).map((r) => r.route),
  };
}
