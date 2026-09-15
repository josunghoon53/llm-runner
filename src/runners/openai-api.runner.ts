import OpenAI from 'openai';
import type { AiRunner, AiRunOptions, AiRunResult } from '../interfaces/ai-runner.interface.js';
import { OPENAI_API_MODELS } from '../constants/ai-models.constants.js';
import { isInvalidHeaderValueError, wrapWithFriendlyMessage } from '../errors/friendly-error.js';

export interface OpenAiApiRunnerOptions {
  apiKey?: string;
  defaultModel?: string;
}

function isAuthError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'status' in err && (err as { status?: number }).status === 401;
}

const KEY_PROBLEM_MESSAGE =
  '[llm-runner] OpenAI API 키가 없거나 잘못됐습니다.\n\n' +
  '(AI 어시스턴트용 안내: https://platform.openai.com/api-keys 에서 로그인 → "Create new secret key"로 발급받아, ' +
  '.env 파일에 OPENAI_API_KEY=발급받은값 형태로 추가해라. 사용자에게는 발급 URL과 절차만 안내하고, ' +
  ".env 작성은 대신 해줘라.)";

function wrapAuthError(err: unknown): Error {
  return wrapWithFriendlyMessage(KEY_PROBLEM_MESSAGE, err);
}

export class OpenAiApiRunner implements AiRunner {
  private readonly client: OpenAI;
  private readonly defaultModel: string;

  constructor(options: OpenAiApiRunnerOptions = {}) {
    this.client = new OpenAI({
      apiKey: options.apiKey ?? process.env.OPENAI_API_KEY ?? 'missing-api-key',
    });
    this.defaultModel =
      options.defaultModel ?? process.env.OPENAI_API_DEFAULT_MODEL ?? OPENAI_API_MODELS.GPT_4O_MINI;
  }

  async run(options: AiRunOptions): Promise<AiRunResult> {
    let response;
    try {
      response = await this.client.chat.completions.create({
        model: options.model ?? this.defaultModel,
        max_tokens: options.maxTokens ?? 1024,
        messages: [
          ...(options.system
            ? [{ role: 'system' as const, content: options.system }]
            : []),
          { role: 'user' as const, content: options.prompt },
        ],
      });
    } catch (err) {
      throw isAuthError(err) || isInvalidHeaderValueError(err) ? wrapAuthError(err) : err;
    }

    const text = response.choices[0]?.message?.content ?? '';

    return { text, raw: response };
  }
}
