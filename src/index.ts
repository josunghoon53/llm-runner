export type {
  AiRunner,
  AiRunOptions,
  AiRunResult,
  AiStreamEvent,
  AiUsage,
  AiFallbackEvent,
} from './interfaces/ai-runner.interface.js';
export type { AiSession } from './interfaces/ai-session.interface.js';
export { createAiRunner, AI_PROVIDERS } from './create-ai-runner.js';
export type { JsonSchema, AiStructuredOptions, AiStructuredResult } from './structured-output.js';
export type { AiProvider, CreateAiRunnerOptions } from './create-ai-runner.js';

export { ClaudeApiRunner } from './runners/claude-api.runner.js';
export type { ClaudeApiRunnerOptions } from './runners/claude-api.runner.js';
export { ClaudeSubscriptionRunner } from './runners/claude-subscription.runner.js';
export type {
  ClaudeSubscriptionRunnerOptions,
  ClaudeSubscriptionSessionOptions,
} from './runners/claude-subscription.runner.js';
export { OpenAiApiRunner } from './runners/openai-api.runner.js';
export type { OpenAiApiRunnerOptions } from './runners/openai-api.runner.js';
export { OpenAiSubscriptionRunner } from './runners/openai-subscription.runner.js';
export type {
  OpenAiSubscriptionRunnerOptions,
  OpenAiSubscriptionSessionOptions,
} from './runners/openai-subscription.runner.js';

export {
  CLAUDE_SUBSCRIPTION_MODELS,
  CLAUDE_API_MODELS,
  CODEX_MODELS,
  OPENAI_API_MODELS,
} from './constants/ai-models.constants.js';
export type {
  ClaudeSubscriptionModel,
  ClaudeApiModel,
  CodexModel,
  OpenAiApiModel,
} from './constants/ai-models.constants.js';

// --- 설치/배포 상태 점검 ---
// 세션 복원, 토큰 회전 저장, 실행파일 탐지는 러너가 알아서 하므로 공개하지 않는다.
// 여기 있는 건 "사용자가 직접 확인하거나 배선해야 하는 것"뿐이다.
export {
  checkSubscriptionSetup,
  checkClaudeStatus,
  checkCodexStatus,
} from './setup/check-status.js';
export type { CliStatus, SubscriptionSetupReport } from './setup/check-status.js';

/** 갱신된 Codex 토큰을 보관할 저장소를 직접 배선할 때 쓴다 (`createAiRunner({ codexAuthStore })`). */
export type { CodexAuthStore } from './setup/restore-session.js';
/** 배포된 토큰이 언제 만료되는지 진단한다. 토큰 값 자체는 반환하지 않는다. */
export { checkCodexAuthFreshness, getRefreshedCodexAuthJson } from './setup/restore-session.js';
export type { CodexAuthFreshness } from './setup/restore-session.js';
/** 배포 후 "바이너리가 실렸는지" 확인하는 헬스체크용. 못 찾으면 undefined. */
export { tryResolveCodexBinaryPath, resolveCodexBinaryPath } from './setup/resolve-codex-binary.js';
