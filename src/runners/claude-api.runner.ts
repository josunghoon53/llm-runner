import Anthropic from '@anthropic-ai/sdk';
import type {
  AiRunner,
  AiRunOptions,
  AiRunResult,
  AiStreamEvent,
  AiUsage,
} from '../interfaces/ai-runner.interface.js';
import type { AiStructuredOptions, AiStructuredResult } from '../structured-output.js';
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

    return { text, usage: toUsage(response.usage), raw: response };
  }

  /**
   * Anthropic Messages API에는 "JSON 스키마로 응답 강제" 옵션이 따로 없다. 대신 스키마를 입력으로
   * 받는 도구를 하나 만들고 `tool_choice`로 그 도구를 **반드시** 쓰게 해서 같은 효과를 낸다 —
   * 이게 Anthropic이 권장하는 구조화 출력 방식이다.
   */
  async runStructured<T = unknown>(options: AiStructuredOptions): Promise<AiStructuredResult<T>> {
    const toolName = options.schemaName ?? 'result';
    let response;
    try {
      response = await this.client.messages.create({
        model: options.model ?? this.defaultModel,
        max_tokens: options.maxTokens ?? 1024,
        system: options.system,
        messages: [{ role: 'user', content: options.prompt }],
        tools: [
          {
            name: toolName,
            description: '요청받은 결과를 이 스키마에 맞춰 돌려준다.',
            input_schema: options.schema as Anthropic.Tool.InputSchema,
          },
        ],
        tool_choice: { type: 'tool', name: toolName },
      });
    } catch (err) {
      throw isAuthError(err) || isInvalidHeaderValueError(err) ? wrapAuthError(err) : err;
    }

    const toolUse = response.content.find((block) => block.type === 'tool_use');
    if (!toolUse) {
      throw new Error(
        '[llm-runner] 구조화 출력을 요청했지만 모델이 도구를 쓰지 않았다. ' +
          'schema를 단순하게 만들거나 프롬프트를 더 명확하게 써봐라.',
      );
    }

    return {
      data: toolUse.input as T,
      text: JSON.stringify(toolUse.input),
      usage: toUsage(response.usage),
      raw: response,
    };
  }

  async *stream(options: AiRunOptions): AsyncIterable<AiStreamEvent> {
    const stream = this.client.messages.stream({
      model: options.model ?? this.defaultModel,
      max_tokens: options.maxTokens ?? 1024,
      system: options.system,
      messages: [{ role: 'user', content: options.prompt }],
    });

    let finishedNormally = false;
    try {
      for await (const event of stream) {
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          yield { type: 'text', text: event.delta.text };
        }
      }
      finishedNormally = true;
    } catch (err) {
      throw isAuthError(err) || isInvalidHeaderValueError(err) ? wrapAuthError(err) : err;
    } finally {
      // 호출자가 도중에 break로 빠져나갔을 때만 끊는다 — 정상 완료했는데 끊으면 finalMessage()가 깨진다.
      if (!finishedNormally) stream.abort();
    }

    const final = await stream.finalMessage();
    const text = final.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('');

    yield { type: 'done', result: { text, usage: toUsage(final.usage), raw: final } };
  }
}

function toUsage(usage: Anthropic.Usage | undefined): AiUsage | undefined {
  if (!usage) return undefined;
  return {
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    cachedInputTokens: usage.cache_read_input_tokens ?? undefined,
  };
}
