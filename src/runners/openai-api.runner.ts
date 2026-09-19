import OpenAI from 'openai';
import type {
  AiRunner,
  AiRunOptions,
  AiRunResult,
  AiStreamEvent,
  AiUsage,
} from '../interfaces/ai-runner.interface.js';
import {
  parseJsonFromModelOutput,
  type AiStructuredOptions,
  type AiStructuredResult,
} from '../structured-output.js';
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
        messages: this.messages(options),
      });
    } catch (err) {
      throw isAuthError(err) || isInvalidHeaderValueError(err) ? wrapAuthError(err) : err;
    }

    const text = response.choices[0]?.message?.content ?? '';

    return { text, usage: toUsage(response.usage), raw: response };
  }

  async runStructured<T = unknown>(options: AiStructuredOptions): Promise<AiStructuredResult<T>> {
    let response;
    try {
      response = await this.client.chat.completions.create({
        model: options.model ?? this.defaultModel,
        max_tokens: options.maxTokens ?? 1024,
        messages: this.messages(options),
        // OpenAI는 스키마를 서버에서 직접 강제한다 — strict를 켜면 스키마를 벗어난 출력이 아예 안 나온다.
        response_format: {
          type: 'json_schema',
          json_schema: { name: options.schemaName ?? 'result', schema: options.schema, strict: true },
        },
      });
    } catch (err) {
      throw isAuthError(err) || isInvalidHeaderValueError(err) ? wrapAuthError(err) : err;
    }

    const text = response.choices[0]?.message?.content ?? '';
    return { data: parseJsonFromModelOutput<T>(text), text, usage: toUsage(response.usage), raw: response };
  }

  private messages(options: { prompt: string; system?: string }) {
    return [
      ...(options.system ? [{ role: 'system' as const, content: options.system }] : []),
      { role: 'user' as const, content: options.prompt },
    ];
  }

  async *stream(options: AiRunOptions): AsyncIterable<AiStreamEvent> {
    let stream;
    try {
      stream = await this.client.chat.completions.create({
        model: options.model ?? this.defaultModel,
        max_tokens: options.maxTokens ?? 1024,
        messages: this.messages(options),
        stream: true,
        // 스트리밍은 기본적으로 usage를 안 주므로 명시적으로 켠다 — 마지막 청크에 담겨 온다.
        stream_options: { include_usage: true },
      });
    } catch (err) {
      throw isAuthError(err) || isInvalidHeaderValueError(err) ? wrapAuthError(err) : err;
    }

    let text = '';
    let usage: AiUsage | undefined;
    let lastChunk: unknown;

    for await (const chunk of stream) {
      lastChunk = chunk;
      // usage가 실린 마지막 청크는 choices가 비어 있다.
      if (chunk.usage) usage = toUsage(chunk.usage);
      const delta = chunk.choices[0]?.delta?.content;
      if (delta) {
        text += delta;
        yield { type: 'text', text: delta };
      }
    }

    yield { type: 'done', result: { text, usage, raw: lastChunk } };
  }
}

function toUsage(usage: OpenAI.CompletionUsage | undefined): AiUsage | undefined {
  if (!usage) return undefined;
  return {
    inputTokens: usage.prompt_tokens,
    outputTokens: usage.completion_tokens,
    cachedInputTokens: usage.prompt_tokens_details?.cached_tokens,
    reasoningTokens: usage.completion_tokens_details?.reasoning_tokens,
  };
}
