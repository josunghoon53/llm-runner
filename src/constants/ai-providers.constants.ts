export const AI_PROVIDERS = [
  'claude-subscription',
  'claude-api',
  'openai-api',
  'openai-subscription',
] as const;

export type AiProvider = (typeof AI_PROVIDERS)[number];
