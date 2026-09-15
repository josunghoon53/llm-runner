export interface AiRunOptions {
  prompt: string;
  system?: string;
  model?: string;
  /** API 키 기반 Runner(claude-api, openai-api)에서만 적용된다. 구독 기반 Runner는 무시한다. */
  maxTokens?: number;
  /** 구독 기반 Runner(claude-subscription, openai-subscription)에서만 적용된다. API 키 기반 Runner는 무시한다. */
  enableWebSearch?: boolean;
}

export interface AiRunResult {
  text: string;
  raw?: unknown;
}

export interface AiRunner {
  run(options: AiRunOptions): Promise<AiRunResult>;
}
