import { assertCommandOnPath } from './ai-cli-check.js';
import { checkClaudeStatus, checkCodexStatus } from './setup/check-status.js';
import type { AiFallbackEvent, AiRunner } from './interfaces/ai-runner.interface.js';
import { ClaudeApiRunner } from './runners/claude-api.runner.js';
import { ClaudeSubscriptionRunner } from './runners/claude-subscription.runner.js';
import { OpenAiApiRunner } from './runners/openai-api.runner.js';
import { OpenAiSubscriptionRunner } from './runners/openai-subscription.runner.js';
import { tryResolveCodexBinaryPath } from './setup/resolve-codex-binary.js';
import type { CodexAuthStore } from './setup/restore-session.js';

import { AI_PROVIDERS, type AiProvider } from './constants/ai-providers.constants.js';

export { AI_PROVIDERS };
export type { AiProvider };

function isAiProvider(value: string): value is AiProvider {
  return (AI_PROVIDERS as readonly string[]).includes(value);
}

/** "claude-subscription" 같은 provider 값이 실제로 뭘 가리키는지 사람이 알아보게 풀어쓴다. */
const PROVIDER_LABELS: Record<AiProvider, string> = {
  'claude-subscription': "claude-subscription (방금 감지된, 이미 `claude login`으로 로그인해둔 Claude Code 구독)",
  'openai-subscription': "openai-subscription (방금 감지된, 이미 `codex login`으로 로그인해둔 ChatGPT/Codex 구독)",
  'claude-api': 'claude-api (ANTHROPIC_API_KEY로 쓰는, 사용한 만큼 과금되는 Anthropic API)',
  'openai-api': 'openai-api (OPENAI_API_KEY로 쓰는, 사용한 만큼 과금되는 OpenAI API)',
};

/**
 * provider를 명시하지 않고 AI_PROVIDER도 없으면, 이미 설정되어 있는 것부터 순서대로 찾아서 쓴다.
 * 아무것도 없으면 무엇을 설정해야 하는지 알려주는 에러를 던진다.
 */
function autoDetectProvider(silent: boolean): AiProvider {
  const claudeLoggedIn = checkClaudeStatus().loggedIn;
  const codexLoggedIn = checkCodexStatus().loggedIn;

  const detected = (() => {
    if (claudeLoggedIn) return 'claude-subscription';
    if (codexLoggedIn) return 'openai-subscription';
    if (process.env.ANTHROPIC_API_KEY) return 'claude-api';
    if (process.env.OPENAI_API_KEY) return 'openai-api';
    return undefined;
  })();

  if (!detected) {
    throw new Error(
      '[llm-runner] AI 기능을 쓰려면 설정이 하나 더 필요합니다.\n\n' +
        '이 메시지 전체를 복사해서, 지금 코드를 짜고 있는 AI 어시스턴트(Claude Code, Cursor 등)에게 ' +
        '그대로 보여주고 "이 에러 해결해줘"라고 말하면 대신 처리해줍니다.\n\n' +
        '(AI 어시스턴트용 안내: 이 프로젝트의 node_modules/llm-runner/AGENTS.md를 읽고, 아래 세 가지 중 사용자 상황에 맞는 것을 진행해라. ' +
        '① 터미널에서 `npx llm-runner-setup`을 실행해 상태를 확인하고 안내에 따라 설치/로그인 ' +
        '② .env 파일에 ANTHROPIC_API_KEY 또는 OPENAI_API_KEY 값을 추가 (Anthropic/OpenAI 콘솔에서 발급) ' +
        '③ createAiRunner({ provider: ... })로 직접 지정)',
    );
  }

  // 자동으로 뭘 골랐는지 알린다. stdout이 아니라 stderr로 보내서, 사용자 프로그램의 출력을 오염시키지 않는다.
  if (!silent) {
    if (claudeLoggedIn && codexLoggedIn) {
      console.warn(
        `[llm-runner] provider 자동 감지됨: ${PROVIDER_LABELS[detected]}\n` +
          `  → Claude Code CLI와 Codex CLI가 둘 다 로그인돼 있어서, 우선순위상 claude-subscription을 선택했다. ` +
          `ChatGPT/Codex 쪽을 쓰고 싶으면 createAiRunner({ provider: 'openai-subscription' })로 명시해라.`,
      );
    } else {
      console.warn(
        `[llm-runner] provider 자동 감지됨: ${PROVIDER_LABELS[detected]}\n` +
          `  → 다른 걸 쓰려면 createAiRunner({ provider: '...' })로 명시해라. 가능한 값: ${AI_PROVIDERS.join(', ')}`,
      );
    }
  }

  return detected;
}

/** 옵션 또는 AI_PROVIDER 환경변수로 들어온 값을 검증한다. 오타가 조용히 다른 provider로 흘러가지 않게 한다. */
function resolveExplicitProvider(optionProvider: AiProvider | undefined): AiProvider | undefined {
  if (optionProvider !== undefined) {
    if (!isAiProvider(optionProvider)) {
      throw new Error(`알 수 없는 provider: '${optionProvider}'. 가능한 값: ${AI_PROVIDERS.join(', ')}`);
    }
    return optionProvider;
  }

  const fromEnv = process.env.AI_PROVIDER;
  if (fromEnv === undefined || fromEnv === '') return undefined;
  if (!isAiProvider(fromEnv)) {
    throw new Error(`AI_PROVIDER 환경변수 값이 잘못됐다: '${fromEnv}'. 가능한 값: ${AI_PROVIDERS.join(', ')}`);
  }
  return fromEnv;
}

export interface CreateAiRunnerOptions {
  /**
   * 기본값: process.env.AI_PROVIDER. 그마저 없으면 로그인/API 키가 이미 설정된 것을 자동으로 찾아 쓴다
   * (claude-subscription → openai-subscription → claude-api → openai-api 순으로 확인).
   * 주의: Claude Code CLI와 Codex CLI가 둘 다 로그인돼 있으면 이 순서 때문에 항상 claude-subscription이 선택된다.
   * openai-subscription을 쓰고 싶다면 반드시 이 옵션에 명시해라.
   */
  provider?: AiProvider;

  claudeApiKey?: string;
  claudeApiDefaultModel?: string;

  claudeSubscriptionDefaultModel?: string;

  openAiApiKey?: string;
  openAiApiDefaultModel?: string;

  openAiSubscriptionDefaultModel?: string;
  /**
   * `codex` 실행파일 경로를 직접 지정한다. 보통 지정할 필요가 없다 — PATH에 없으면 프로젝트
   * 의존성으로 설치된 `@openai/codex`의 번들 바이너리를 자동으로 찾는다. README "Codex" 섹션 참고.
   */
  codexPathOverride?: string;
  /**
   * Codex 구독을 서버리스에 배포할 때, 갱신된 로그인 토큰을 보관할 외부 저장소(KV/DB 등).
   * 설정하면 토큰 회전 감지와 저장을 llm-runner가 자동으로 처리한다. README "Codex" 섹션 참고.
   */
  codexAuthStore?: CodexAuthStore;
  /**
   * 내부적으로 빠른 경로에서 안정 경로로 내려앉을 때 호출된다(현재 `openai-subscription`만 해당).
   * **서버리스에 배포한다면 꼭 연결해라** — 기본값은 stderr 경고인데 거기선 아무 데도 안 남아서,
   * 몇 달간 느린 경로로만 돌아도 알 방법이 없다.
   *
   * ```ts
   * createAiRunner({ provider: 'openai-subscription', onFallback: (e) => logger.warn('llm 폴백', e) })
   * ```
   */
  onFallback?: (event: AiFallbackEvent) => void;

  /**
   * 구독 provider를 선택했는데 로컬에 해당 CLI(`claude`/`codex`)가 PATH에 없으면
   * 생성 시점에 바로 예외를 던진다. 기본값 true. spawn/exec 없이 PATH만 조회한다.
   */
  checkCliOnCreate?: boolean;

  /** provider 자동 감지 시 stderr에 찍는 안내를 끈다. 기본값 false. */
  silent?: boolean;
}

/**
 * Claude/Codex 구독 세션과 API 키를 같은 AiRunner 인터페이스로 감싸서 반환한다.
 * 프레임워크에 의존하지 않으므로 Express, 순수 Node, Next.js 등 어디서나 쓸 수 있다.
 */
export function createAiRunner(options: CreateAiRunnerOptions = {}): AiRunner {
  const explicitProvider = resolveExplicitProvider(options.provider);
  const provider = explicitProvider ?? autoDetectProvider(options.silent ?? false);

  // 자동 감지된 경우 이미 로그인/키 상태를 확인했으므로 아래 체크를 다시 할 필요가 없다.
  //
  // claude-subscription: @anthropic-ai/claude-agent-sdk는 플랫폼별 네이티브 바이너리를
  // 자체 optionalDependency로 갖고 있어서, CLAUDE_CODE_OAUTH_TOKEN이 있으면 PATH에 claude CLI가 없어도
  // 실제로 동작한다(Vercel에 배포해서 직접 확인함).
  // openai-subscription: @openai/codex-sdk는 자체 바이너리가 없어서 원래는 PATH의 codex CLI에
  // 의존하지만, codexPathOverride로 번들된 바이너리를 직접 가리키면 PATH가 없어도 동작한다
  // (이것도 Vercel에 배포해서 CODEX_AUTH_JSON과 함께 직접 검증함 — README "Codex" 섹션 참고).
  if (explicitProvider && options.checkCliOnCreate !== false) {
    if (provider === 'claude-subscription' && !process.env.CLAUDE_CODE_OAUTH_TOKEN) {
      assertCommandOnPath(
        'claude',
        "provider='claude-subscription'을 쓰려면 로컬에 Claude Code CLI가 설치되고 `claude login`으로 로그인되어 있어야 한다. " +
          '(배포 환경이라면 CLAUDE_CODE_OAUTH_TOKEN 환경변수를 설정해도 된다 — README의 "서버리스/배포 환경에서 쓰기" 참고)',
      );
    }
    // 번들된 바이너리를 자동으로 찾을 수 있으면 PATH에 codex가 없어도 문제없다 — 서버리스 배포의
    // 정상 경로다. 명시적 override가 있는 경우도 마찬가지로 검사를 건너뛴다.
    if (provider === 'openai-subscription' && !options.codexPathOverride && !tryResolveCodexBinaryPath()) {
      assertCommandOnPath(
        'codex',
        "provider='openai-subscription'을 쓰려면 로컬에 Codex CLI가 설치되고 ChatGPT 계정으로 로그인되어 있어야 한다. " +
          '(배포 환경이라면 `npm install @openai/codex`로 프로젝트 의존성에 추가하면 번들된 바이너리를 자동으로 찾는다 — ' +
          'README의 "Codex" 섹션 참고)',
      );
    }
  }

  switch (provider) {
    case 'claude-api':
      return new ClaudeApiRunner({
        apiKey: options.claudeApiKey,
        defaultModel: options.claudeApiDefaultModel,
      });
    case 'openai-api':
      return new OpenAiApiRunner({
        apiKey: options.openAiApiKey,
        defaultModel: options.openAiApiDefaultModel,
      });
    case 'openai-subscription':
      return new OpenAiSubscriptionRunner({
        defaultModel: options.openAiSubscriptionDefaultModel,
        codexPathOverride: options.codexPathOverride,
        codexAuthStore: options.codexAuthStore,
        onFallback: options.onFallback,
      });
    case 'claude-subscription':
      return new ClaudeSubscriptionRunner({
        defaultModel: options.claudeSubscriptionDefaultModel,
      });
  }
}
