import { assertCommandOnPath } from './ai-cli-check.js';
import { checkClaudeStatus, checkCodexStatus } from './setup/check-status.js';
import type { AiRunner } from './interfaces/ai-runner.interface.js';
import { ClaudeApiRunner } from './runners/claude-api.runner.js';
import { ClaudeSubscriptionRunner } from './runners/claude-subscription.runner.js';
import { OpenAiApiRunner } from './runners/openai-api.runner.js';
import { OpenAiSubscriptionRunner } from './runners/openai-subscription.runner.js';

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
  // claude-subscription만 예외 처리한다: @anthropic-ai/claude-agent-sdk는 플랫폼별 네이티브 바이너리를
  // 자체 optionalDependency로 갖고 있어서, CLAUDE_CODE_OAUTH_TOKEN이 있으면 PATH에 claude CLI가 없어도
  // 실제로 동작한다(Vercel에 배포해서 직접 확인함). 반면 @openai/codex-sdk는 자체 바이너리가 없고
  // PATH의 codex CLI에 그대로 의존하므로(우리 restoreCodexSessionFromEnv도 spawnSync('codex', ...)를 쓴다),
  // CODEX_ACCESS_TOKEN이 있어도 PATH에 codex가 없으면 어차피 실패한다 — 이쪽은 예외를 두지 않는다.
  if (explicitProvider && options.checkCliOnCreate !== false) {
    if (provider === 'claude-subscription' && !process.env.CLAUDE_CODE_OAUTH_TOKEN) {
      assertCommandOnPath(
        'claude',
        "provider='claude-subscription'을 쓰려면 로컬에 Claude Code CLI가 설치되고 `claude login`으로 로그인되어 있어야 한다. " +
          '(배포 환경이라면 CLAUDE_CODE_OAUTH_TOKEN 환경변수를 설정해도 된다 — README의 "서버리스/배포 환경에서 쓰기" 참고)',
      );
    }
    if (provider === 'openai-subscription') {
      assertCommandOnPath(
        'codex',
        "provider='openai-subscription'을 쓰려면 로컬에 Codex CLI가 설치되고 ChatGPT 계정으로 로그인되어 있어야 한다.",
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
      });
    case 'claude-subscription':
      return new ClaudeSubscriptionRunner({
        defaultModel: options.claudeSubscriptionDefaultModel,
      });
  }
}
