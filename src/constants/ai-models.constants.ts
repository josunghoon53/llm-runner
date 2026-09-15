/**
 * 각 provider가 실제로 지원하는 모델 목록. AiRunOptions.model에 넣을 값을 여기서 고른다.
 * 최신 목록은 각 회사 문서를 참고해서 주기적으로 갱신한다 (2026-09 기준).
 */

export const CLAUDE_SUBSCRIPTION_MODELS = {
  HAIKU: 'haiku', // claude-haiku-4-5 — 빠르고 저렴
  SONNET: 'sonnet', // claude-sonnet-5 — 균형(기본값)
  OPUS: 'opus', // claude-opus-5 — 고성능 추론/에이전트
  FABLE: 'fable', // claude-fable-5-1 — 최상위 프론티어
} as const;

export type ClaudeSubscriptionModel = (typeof CLAUDE_SUBSCRIPTION_MODELS)[keyof typeof CLAUDE_SUBSCRIPTION_MODELS];

export const CODEX_MODELS = {
  LUNA: 'gpt-5.6-luna', // 가장 빠르고 저렴
  TERRA: 'gpt-5.6-terra', // 성능·비용 균형
  SOL: 'gpt-5.6-sol', // 최상위 티어(복잡한 전문 작업)
  ASTRA: 'gpt-6-astra', // Pro 플랜 전용, Codex CLI 0.153.0+ 필요
} as const;

export type CodexModel = (typeof CODEX_MODELS)[keyof typeof CODEX_MODELS];

/**
 * Anthropic Messages API(claude-api)는 CLI 별칭(haiku/sonnet/opus)이 아니라
 * 전체 모델 ID를 요구하므로 별도로 정의한다.
 */
export const CLAUDE_API_MODELS = {
  HAIKU: 'claude-haiku-4-5-20251001',
  SONNET: 'claude-sonnet-5', // 균형(기본값)
  OPUS: 'claude-opus-5',
  FABLE: 'claude-fable-5-1', // 최상위 프론티어
} as const;

export type ClaudeApiModel = (typeof CLAUDE_API_MODELS)[keyof typeof CLAUDE_API_MODELS];

/**
 * OpenAI Chat Completions API(openai-api). gpt-5.6 계열은 API로도 제공되며,
 * gpt-4o-mini는 저비용 레거시 모델로 계속 지원된다.
 */
export const OPENAI_API_MODELS = {
  GPT_4O_MINI: 'gpt-4o-mini', // 저비용 레거시(기본값)
  GPT_5_6_LUNA: 'gpt-5.6-luna',
  GPT_5_6_TERRA: 'gpt-5.6-terra',
  GPT_5_6_SOL: 'gpt-5.6-sol',
} as const;

export type OpenAiApiModel = (typeof OPENAI_API_MODELS)[keyof typeof OPENAI_API_MODELS];
