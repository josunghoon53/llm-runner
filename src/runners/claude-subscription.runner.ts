import { query, type ModelUsage, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import type {
  AiRunner,
  AiRunOptions,
  AiRunResult,
  AiStreamEvent,
  AiUsage,
} from '../interfaces/ai-runner.interface.js';
import type { AiSession } from '../interfaces/ai-session.interface.js';
import { CLAUDE_SUBSCRIPTION_MODELS } from '../constants/ai-models.constants.js';
import { streamFromCallback } from '../stream-bridge.js';
import {
  parseJsonFromModelOutput,
  type AiStructuredOptions,
  type AiStructuredResult,
} from '../structured-output.js';

/**
 * result 메시지에서 사용량을 뽑는다. SDK 문서가 토큰 집계는 `usage`가 아니라 `modelUsage`를
 * 쓰라고 명시한다(`usage`는 메인 루프만 세고 서브에이전트/내부 호출을 뺀다). 비용은 SDK가
 * 직접 계산해주는 `total_cost_usd`를 그대로 쓴다 — 우리가 단가표를 들고 추정하지 않는다.
 */
function toUsage(message: { total_cost_usd?: number; modelUsage?: Record<string, ModelUsage> }): AiUsage | undefined {
  const entries = Object.values(message.modelUsage ?? {});
  if (entries.length === 0) {
    return message.total_cost_usd === undefined ? undefined : { costUsd: message.total_cost_usd };
  }

  const sum = (pick: (usage: ModelUsage) => number | undefined) =>
    entries.reduce((total, entry) => total + (pick(entry) ?? 0), 0);

  return {
    inputTokens: sum((e) => e.inputTokens),
    outputTokens: sum((e) => e.outputTokens),
    cachedInputTokens: sum((e) => e.cacheReadInputTokens),
    reasoningTokens: sum((e) => e.thinkingTokens),
    costUsd: message.total_cost_usd,
  };
}

/**
 * 세션(streaming input) 모드에서 SDK가 주는 usage는 **그 세션의 누적 합계**다(SDK 문서 명시).
 * 그대로 노출하면 사용자가 턴마다 합산했을 때 비용이 몇 배로 부풀려지고, 턴별 값을 주는
 * `openai-subscription`과 의미도 달라진다. 그래서 직전 누적값을 빼서 **이번 턴의 사용량**으로
 * 바꾼다 — 그래야 provider가 달라도 같은 뜻이 된다.
 *
 * (실제로 한 세션에서 캐시된 입력이 22만 토큰까지 올라가는 걸 보고 발견했다. Claude의 컨텍스트
 * 한도보다 큰 값이라 "이건 누적이구나"를 알 수 있었다.)
 */
function subtractUsage(total: AiUsage | undefined, previous: AiUsage | undefined): AiUsage | undefined {
  if (!total) return undefined;
  if (!previous) return total;

  const diff = (now: number | undefined, before: number | undefined) =>
    now === undefined ? undefined : Math.max(0, now - (before ?? 0));

  return {
    inputTokens: diff(total.inputTokens, previous.inputTokens),
    outputTokens: diff(total.outputTokens, previous.outputTokens),
    cachedInputTokens: diff(total.cachedInputTokens, previous.cachedInputTokens),
    reasoningTokens: diff(total.reasoningTokens, previous.reasoningTokens),
    costUsd: diff(total.costUsd, previous.costUsd),
  };
}

/**
 * Claude Code 내장 도구 전체 목록. allowedTools([])만으로는 완전히 막히지 않는 걸 확인했기 때문에
 * disallowedTools로 명시적으로 차단한다 (harness 레벨에서 tool_use 자체를 막음).
 */
const ALL_BUILTIN_TOOLS = [
  'Bash',
  'BashOutput',
  'KillShell',
  'Read',
  'Write',
  'Edit',
  'NotebookEdit',
  'Glob',
  'Grep',
  'WebSearch',
  'WebFetch',
  'Task',
  'TodoWrite',
  'SlashCommand',
];

export interface ClaudeSubscriptionRunnerOptions {
  defaultModel?: string;
}

export interface ClaudeSubscriptionSessionOptions {
  system?: string;
  model?: string;
  enableWebSearch?: boolean;
}

/**
 * `query()`에 프롬프트를 문자열로 넘기면 호출마다 새 `claude` 프로세스를 spawn한다(측정 기준 5~10초).
 * streaming input(비동기 이터러블)으로 넘기면 프로세스 하나를 계속 물고 여러 턴을 처리해서
 * 두 번째 턴부터 2~3배 빨라진다(측정 기준 2초대) — 단, 대화가 이어지므로 이전 턴의 맥락이
 * 다음 턴에 그대로 섞인다. 서로 무관해야 하는 여러 작업(예: 종목 A 분석 후 종목 B 분석)에는
 * 쓰지 말고, 진짜로 한 대화가 이어져야 하는 경우에만 쓴다.
 */
class ClaudeAgentSdkSession implements AiSession {
  private readonly queue: Array<{
    prompt: string;
    resolve: (r: AiRunResult) => void;
    reject: (e: unknown) => void;
    started: boolean;
    /** sendStream()으로 보낸 턴만 설정된다. 증분 텍스트가 도착할 때마다 불린다. */
    onDelta?: (text: string) => void;
  }> = [];
  private pushToStream: (() => void) | undefined;
  private readonly stream: ReturnType<typeof query>;
  private closed = false;
  /** SDK가 주는 누적 usage에서 이번 턴 몫만 빼내기 위해 직전 누적값을 들고 있는다. */
  private cumulativeUsage: AiUsage | undefined;

  constructor(options: ClaudeSubscriptionSessionOptions, defaultModel: string) {
    const allowedTools = options.enableWebSearch ? ['WebSearch'] : [];
    const disallowedTools = ALL_BUILTIN_TOOLS.filter((tool) => !allowedTools.includes(tool));

    this.stream = query({
      prompt: this.inputGenerator(),
      options: {
        model: options.model ?? defaultModel,
        systemPrompt: options.system,
        allowedTools,
        disallowedTools,
        // 부분 메시지를 항상 켜둔다. sendStream()이 아닌 턴에서는 그냥 무시되므로 결과는 같고,
        // 세션을 만든 뒤에는 이 옵션을 바꿀 수 없어서 나중에 켤 방법이 없다.
        includePartialMessages: true,
      },
    });

    void this.consume();
  }

  private async *inputGenerator(): AsyncGenerator<SDKUserMessage> {
    while (!this.closed) {
      if (this.queue.length === 0 || this.queue[0]!.started) {
        await new Promise<void>((resolve) => (this.pushToStream = resolve));
        continue;
      }
      const pending = this.queue[0]!;
      pending.started = true;
      yield {
        type: 'user',
        message: { role: 'user', content: pending.prompt },
        parent_tool_use_id: null,
      };
    }
  }

  private async consume(): Promise<void> {
    try {
      for await (const message of this.stream) {
        // 증분은 지금 진행 중인 턴(큐의 맨 앞)에만 전달한다. 턴은 순차적으로만 처리되므로
        // 맨 앞 항목이 곧 이 증분의 주인이다.
        if (message.type === 'stream_event') {
          const inFlight = this.queue[0];
          if (!inFlight?.started || !inFlight.onDelta) continue;
          const event = message.event;
          if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
            inFlight.onDelta(event.delta.text);
          }
          continue;
        }
        if (message.type === 'result') {
          const pending = this.queue.shift();
          if (!pending) continue;
          if (message.subtype === 'success') {
            const cumulative = toUsage(message);
            const thisTurn = subtractUsage(cumulative, this.cumulativeUsage);
            this.cumulativeUsage = cumulative;
            pending.resolve({ text: message.result, usage: thisTurn, raw: message });
          } else {
            pending.reject(new Error(`Claude Agent SDK 실행 실패: subtype=${message.subtype}`));
          }
        }
      }
    } catch (err) {
      const pending = this.queue.shift();
      if (pending) pending.reject(err);
    }
  }

  send(prompt: string): Promise<AiRunResult> {
    return this.enqueue(prompt);
  }

  sendStream(prompt: string): AsyncIterable<AiStreamEvent> {
    return streamFromCallback((onDelta) => this.enqueue(prompt, onDelta));
  }

  private enqueue(prompt: string, onDelta?: (text: string) => void): Promise<AiRunResult> {
    if (this.closed) {
      return Promise.reject(new Error('[llm-runner] 이미 close()된 세션에는 send()를 호출할 수 없다.'));
    }
    return new Promise<AiRunResult>((resolve, reject) => {
      this.queue.push({ prompt, resolve, reject, started: false, onDelta });
      this.pushToStream?.();
    });
  }

  close(): void {
    this.closed = true;
    this.pushToStream?.();
    this.stream.close();
  }
}

/**
 * 로컬에 설치된 Claude Code CLI의 구독(로그인) 세션을 그대로 사용한다.
 * API 키가 아니라 `claude login`으로 인증된 세션을 감싸는 공식 SDK를 사용하므로
 * 이 코드는 spawn/exec를 직접 호출하지 않는다.
 */
export class ClaudeSubscriptionRunner implements AiRunner {
  private readonly defaultModel: string;

  constructor(options: ClaudeSubscriptionRunnerOptions = {}) {
    this.defaultModel =
      options.defaultModel ?? process.env.CLAUDE_SUBSCRIPTION_DEFAULT_MODEL ?? CLAUDE_SUBSCRIPTION_MODELS.SONNET;
  }

  private queryOptions(options: AiRunOptions, includePartialMessages: boolean) {
    const allowedTools = options.enableWebSearch ? ['WebSearch'] : [];
    const disallowedTools = ALL_BUILTIN_TOOLS.filter((tool) => !allowedTools.includes(tool));

    return {
      model: options.model ?? this.defaultModel,
      systemPrompt: options.system,
      allowedTools,
      disallowedTools,
      includePartialMessages,
      // permissionMode를 지정하지 않으면 canUseTool 콜백이 없는 headless 호출에서
      // 'ask' 판정이 자동 거부로 처리된다 (bypassPermissions보다 안전).
    };
  }

  async run(options: AiRunOptions): Promise<AiRunResult> {
    const stream = query({ prompt: options.prompt, options: this.queryOptions(options, false) });

    let result: AiRunResult | undefined;
    for await (const message of stream) {
      if (message.type === 'result') {
        if (message.subtype === 'success') {
          result = { text: message.result, usage: toUsage(message), raw: message };
        } else {
          throw new Error(`Claude Agent SDK 실행 실패: subtype=${message.subtype}`);
        }
      }
    }

    if (!result) {
      throw new Error('Claude Agent SDK가 result 메시지 없이 스트림을 종료했다.');
    }

    return result;
  }

  /**
   * Claude Code SDK의 `outputFormat: { type: 'json_schema' }`로 스키마를 **강제**한다.
   * 결과는 `result` 메시지의 `structured_output` 필드에 파싱된 객체로 들어온다.
   *
   * 예전에는 이 경로에 강제 장치가 없는 줄 알고 프롬프트로 지시한 뒤 결과를 파싱했다.
   * 실제로는 SDK가 정식 옵션을 갖고 있었고, 문서에 "모델의 선의에 의존한다"고 적어둔 것도
   * 틀린 설명이었다. 지금은 네 provider 모두 provider 쪽에서 스키마를 강제한다.
   */
  async runStructured<T = unknown>(options: AiStructuredOptions): Promise<AiStructuredResult<T>> {
    const stream = query({
      prompt: options.prompt,
      options: {
        ...this.queryOptions(
          {
            prompt: options.prompt,
            system: options.system,
            model: options.model,
            enableWebSearch: options.enableWebSearch,
          },
          false,
        ),
        outputFormat: { type: 'json_schema', schema: options.schema },
      },
    });

    for await (const message of stream) {
      if (message.type !== 'result') continue;
      if (message.subtype !== 'success') {
        throw new Error(`Claude Agent SDK 실행 실패: subtype=${message.subtype}`);
      }
      // SDK가 파싱까지 해서 structured_output에 넣어준다. 혹시 없으면 본문에서 꺼낸다
      // (모델/CLI 버전에 따라 필드가 비어 올 가능성에 대한 방어선).
      const structured = (message as { structured_output?: unknown }).structured_output;
      return {
        data: (structured ?? parseJsonFromModelOutput<T>(message.result)) as T,
        text: message.result,
        usage: toUsage(message),
        raw: message,
      };
    }

    throw new Error('Claude Agent SDK가 result 메시지 없이 스트림을 종료했다.');
  }

  async *stream(options: AiRunOptions): AsyncIterable<AiStreamEvent> {
    const stream = query({ prompt: options.prompt, options: this.queryOptions(options, true) });

    let result: AiRunResult | undefined;
    try {
      for await (const message of stream) {
        // 부분 메시지(stream_event)는 --include-partial-messages를 켰을 때만 온다.
        // 완성된 assistant 메시지도 따로 한 번 더 오므로, 증분은 여기서만 꺼내야 중복되지 않는다.
        if (message.type === 'stream_event') {
          const event = message.event;
          if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
            yield { type: 'text', text: event.delta.text };
          }
          continue;
        }
        if (message.type === 'result') {
          if (message.subtype !== 'success') {
            throw new Error(`Claude Agent SDK 실행 실패: subtype=${message.subtype}`);
          }
          result = { text: message.result, usage: toUsage(message), raw: message };
        }
      }
    } finally {
      // 호출자가 도중에 break로 빠져나가도 CLI 프로세스가 남지 않게 한다.
      stream.close();
    }

    if (!result) {
      throw new Error('Claude Agent SDK가 result 메시지 없이 스트림을 종료했다.');
    }

    yield { type: 'done', result };
  }

  /**
   * 진짜로 여러 턴이 이어져야 하는 대화에만 쓴다. `run()`을 여러 번 부르는 것과 달리
   * 프로세스 하나를 계속 물고 있어서 두 번째 턴부터 빨라지지만(측정 기준 5~10초 → 2초대),
   * 대신 이전 턴의 맥락이 다음 턴에 그대로 섞인다. 서로 무관한 여러 작업(예: 종목 A 분석 후
   * 종목 B 분석)에는 절대 재사용하지 말고, 매번 새 세션을 만들거나 `run()`을 써라.
   * 다 쓰면 반드시 `close()`를 호출해서 프로세스를 정리해라.
   */
  createSession(options: ClaudeSubscriptionSessionOptions = {}): AiSession {
    return new ClaudeAgentSdkSession(options, this.defaultModel);
  }
}
