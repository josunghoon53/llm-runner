import Anthropic from '@anthropic-ai/sdk';
import type { AiRunner, AiRunOptions, AiRunResult } from '../interfaces/ai-runner.interface.js';
import { CLAUDE_API_MODELS } from '../constants/ai-models.constants.js';
import { isInvalidHeaderValueError, wrapWithFriendlyMessage } from '../errors/friendly-error.js';

export interface ClaudeApiRunnerOptions {
  apiKey?: string;
  defaultModel?: string;
}

function isAuthError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'status' in err && (err as { status?: number }).status === 401;
}

const KEY_PROBLEM_MESSAGE =
  '[llm-runner] Claude API 키가 없거나 잘못됐습니다.\n\n' +
  '(AI 어시스턴트용 안내: https://console.anthropic.com 에서 로그인 → "API Keys" → "Create Key"로 발급받아, ' +
  '.env 파일에 ANTHROPIC_API_KEY=발급받은값 형태로 추가해라. 사용자에게는 발급 URL과 절차만 안내하고, ' +
  ".env 작성은 대신 해줘라.)";

function wrapAuthError(err: unknown): Error {
  return wrapWithFriendlyMessage(KEY_PROBLEM_MESSAGE, err);
}

export class ClaudeApiRunner implements AiRunner {
  private readonly client: Anthropic;
  private readonly defaultModel: string;

  constructor(options: ClaudeApiRunnerOptions = {}) {
    this.client = new Anthropic({
      apiKey: options.apiKey ?? process.env.ANTHROPIC_API_KEY ?? 'missing-api-key',
    });
    this.defaultModel =
      options.defaultModel ?? process.env.CLAUDE_API_DEFAULT_MODEL ?? CLAUDE_API_MODELS.SONNET;
  }

  async run(options: AiRunOptions): Promise<AiRunResult> {
    let response;
    try {
      response = await this.client.messages.create({
        model: options.model ?? this.defaultModel,
        max_tokens: options.maxTokens ?? 1024,
        system: options.system,
        messages: [{ role: 'user', content: options.prompt }],
      });
    } catch (err) {
      throw isAuthError(err) || isInvalidHeaderValueError(err) ? wrapAuthError(err) : err;
    }

    const text = response.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('');

    return { text, raw: response };
  }
}
