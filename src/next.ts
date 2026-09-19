import { createRequire } from 'node:module';

/**
 * `llm-runner/next` — Next.js `next.config.ts`용 헬퍼.
 *
 * Claude Code SDK와 Codex CLI는 둘 다 **플랫폼별 네이티브 바이너리**를 optionalDependency로
 * 갖고 있고, 그걸 동적으로 찾아 실행한다. Next.js의 파일 추적(file tracing)은 이런 동적 참조를
 * 못 따라가서, 그냥 배포하면 서버리스 함수 안에 바이너리가 빠진 채로 올라간다 —
 * 런타임에야 "실행파일을 찾을 수 없다"로 터진다.
 *
 * 이 헬퍼는 그 바이너리들을 `outputFileTracingIncludes`에 자동으로 넣어준다.
 */

/** 플랫폼별 바이너리를 담고 있는 패키지들. 설치된 것만 실제로 존재하므로 전부 나열해도 안전하다. */
const CLAUDE_PLATFORM_PACKAGES = [
  '@anthropic-ai/claude-agent-sdk-linux-x64',
  '@anthropic-ai/claude-agent-sdk-linux-arm64',
  '@anthropic-ai/claude-agent-sdk-linux-x64-musl',
  '@anthropic-ai/claude-agent-sdk-linux-arm64-musl',
  '@anthropic-ai/claude-agent-sdk-darwin-x64',
  '@anthropic-ai/claude-agent-sdk-darwin-arm64',
  '@anthropic-ai/claude-agent-sdk-win32-x64',
  '@anthropic-ai/claude-agent-sdk-win32-arm64',
];

const CODEX_PLATFORM_PACKAGES = [
  '@openai/codex-linux-x64',
  '@openai/codex-linux-arm64',
  '@openai/codex-darwin-x64',
  '@openai/codex-darwin-arm64',
  '@openai/codex-win32-x64',
  '@openai/codex-win32-arm64',
];

export type LlmRunnerBundleTarget = 'claude-subscription' | 'openai-subscription';

export interface WithLlmRunnerOptions {
  /**
   * 바이너리를 포함시킬 **라우트 글로브**. 기본값 `['/api/**']`.
   *
   * ⚠️ 여기에 매칭되는 라우트마다 바이너리가 따로 복사된다(Codex는 300MB대, Claude는 200MB대).
   * llm-runner를 실제로 호출하는 라우트만 좁혀서 적는 게 좋다 — 예: `['/api/ai']`.
   */
  routes?: string[];
  /**
   * 어떤 provider의 바이너리를 넣을지. 기본값은 자동 감지다:
   * Claude는 항상 포함하고, Codex는 `@openai/codex`가 의존성에 설치돼 있을 때만 포함한다.
   * API 키 provider(`claude-api`/`openai-api`)만 쓴다면 `[]`를 넘겨서 아무 것도 넣지 마라.
   */
  providers?: LlmRunnerBundleTarget[];
}

/** 이 프로젝트에 해당 패키지가 실제로 설치돼 있는지 확인한다. */
function isPackageInstalled(packageName: string): boolean {
  try {
    createRequire(`${process.cwd()}/package.json`).resolve(`${packageName}/package.json`);
    return true;
  } catch {
    return false;
  }
}

function detectProviders(): LlmRunnerBundleTarget[] {
  const providers: LlmRunnerBundleTarget[] = ['claude-subscription'];
  // Codex는 사용자가 직접 `npm install @openai/codex`를 해야만 쓸 수 있다 —
  // 즉 설치돼 있다는 것 자체가 "Codex를 쓰겠다"는 의사 표시다.
  if (isPackageInstalled('@openai/codex')) providers.push('openai-subscription');
  return providers;
}

/**
 * Next.js 설정에 llm-runner가 필요로 하는 파일 추적 설정을 더해서 돌려준다.
 *
 * ```ts
 * // next.config.ts
 * import { withLlmRunner } from 'llm-runner/next';
 *
 * export default withLlmRunner({
 *   // 기존 Next.js 설정 그대로
 * }, {
 *   routes: ['/api/ai'], // llm-runner를 호출하는 라우트만 지정
 * });
 * ```
 *
 * 기존 `outputFileTracingIncludes` 설정이 있으면 덮어쓰지 않고 합친다.
 */
export function withLlmRunner<T extends Record<string, unknown>>(
  nextConfig: T = {} as T,
  options: WithLlmRunnerOptions = {},
): T {
  const routes = options.routes ?? ['/api/**'];
  const providers = options.providers ?? detectProviders();

  const packages = [
    ...(providers.includes('claude-subscription') ? CLAUDE_PLATFORM_PACKAGES : []),
    ...(providers.includes('openai-subscription') ? CODEX_PLATFORM_PACKAGES : []),
  ];

  if (packages.length === 0 || routes.length === 0) return nextConfig;

  const patterns = packages.map((name) => `./node_modules/${name}/**`);
  const existing = (nextConfig.outputFileTracingIncludes ?? {}) as Record<string, string[]>;
  const merged: Record<string, string[]> = { ...existing };

  for (const route of routes) {
    // 같은 라우트에 이미 설정이 있으면 없애지 않고 뒤에 붙인다.
    merged[route] = [...new Set([...(existing[route] ?? []), ...patterns])];
  }

  return { ...nextConfig, outputFileTracingIncludes: merged };
}
