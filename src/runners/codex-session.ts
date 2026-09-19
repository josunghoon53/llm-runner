import type { Thread, Usage } from '@openai/codex-sdk';
import type {
  AiFallbackEvent,
  AiRunResult,
  AiStreamEvent,
  AiUsage,
} from '../interfaces/ai-runner.interface.js';
import type { AiSession } from '../interfaces/ai-session.interface.js';
import type { CodexAppServerStreamingSession } from '../experimental/codex-app-server-session.js';

/**
 * Codex 구독 세션 구현과 그 주변 도구들. `OpenAiSubscriptionRunner`에서 분리해 둔 이유는
 * 한 파일에 러너·세션 두 종류·폴백·스트리밍·사용량이 모두 모이면서 읽기 어려워졌기 때문이다.
 */

/**
 * 폴백을 알린다. 핸들러가 있으면 그쪽으로만 보내고(중복 소음 방지), 없으면 stderr에 경고한다.
 * 핸들러에서 예외가 나도 본래 작업을 망치지 않는다 — 알림은 부수적인 일이다.
 */
export function reportFallback(
  handler: ((event: AiFallbackEvent) => void) | undefined,
  event: AiFallbackEvent,
  humanMessage: string,
): void {
  if (!handler) {
    console.warn(`[llm-runner] ${humanMessage} 사유: ${event.reason}`);
    return;
  }
  try {
    handler(event);
  } catch {
    // 사용자 핸들러가 던져도 AI 호출까지 실패시키지 않는다.
  }
}

export function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function toUsage(usage: Usage | null | undefined): AiUsage | undefined {
  if (!usage) return undefined;
  return {
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    cachedInputTokens: usage.cached_input_tokens,
    reasoningTokens: usage.reasoning_output_tokens,
    // Codex 구독은 토큰 수만 알려주고 금액은 안 준다 — 추정치를 지어내지 않는다.
  };
}


export class CodexThreadSession implements AiSession {
  private closed = false;

  constructor(private readonly thread: Thread) {}

  async send(prompt: string): Promise<AiRunResult> {
    if (this.closed) {
      throw new Error('[llm-runner] 이미 close()된 세션에는 send()를 호출할 수 없다.');
    }
    const turn = await this.thread.run(prompt);
    return { text: turn.finalResponse, usage: toUsage(turn.usage), raw: turn };
  }

  /**
   * 공식 SDK는 증분을 주지 않으므로(실제 이벤트로 확인함) 완성된 답변을 조각 하나로 내보낸다.
   * 인터페이스는 같지만 **글자가 흐르지는 않는다** — 진짜 스트리밍은 app-server 경로에서만 된다.
   */
  async *sendStream(prompt: string): AsyncIterable<AiStreamEvent> {
    const result = await this.send(prompt);
    if (result.text) yield { type: 'text', text: result.text };
    yield { type: 'done', result };
  }

  close(): void {
    // Codex SDK가 Thread를 명시적으로 종료하는 API를 공개하고 있지 않다(프로세스 생명주기를
    // SDK가 자체 관리하는 것으로 보임). 여기서는 더 이상 send()를 못 하게 상태만 막는다.
    this.closed = true;
  }
}

/** 빠른 경로가 중간에 죽었을 때, 안정 경로에 지금까지의 대화를 한 번에 되짚어주기 위한 기록. */
interface TranscriptEntry {
  prompt: string;
  response: string;
}

function buildReplayPrompt(transcript: TranscriptEntry[], nextPrompt: string): string {
  if (transcript.length === 0) return nextPrompt;
  const history = transcript
    .map((entry) => `[사용자] ${entry.prompt}\n[너의 이전 답변] ${entry.response}`)
    .join('\n\n');
  return (
    '아래는 우리가 지금까지 나눈 대화다. 이 맥락을 그대로 이어서 대답해라.\n\n' +
    `${history}\n\n---\n\n[사용자] ${nextPrompt}`
  );
}

/**
 * 빠른 경로(`codex app-server`)를 우선 쓰되, 그게 실패하면 안정 경로(공식 SDK `Thread`)로
 * 자동 전환하는 세션. 사용자 코드는 어느 경로가 쓰이는지 몰라도 된다.
 *
 * 전환이 일어나는 경우는 두 가지다.
 * - **시작 시점**: `codex app-server` 핸드셰이크 자체가 실패 (Codex CLI 버전이 프로토콜을 바꿨거나,
 *   애초에 그 서브커맨드가 없는 경우). 아직 대화가 없으므로 그냥 안정 경로로 시작한다.
 * - **대화 도중**: 프로세스가 죽거나 프로토콜 응답이 깨진 경우. 이때는 지금까지의 대화를 한 번에
 *   되짚어주는 프롬프트를 만들어 안정 경로에 넘겨서 맥락을 복구한다.
 *
 * 이 폴백이 있기 때문에 "실험적 프로토콜에 의존한다"는 리스크가 **앱이 죽는 문제**가 아니라
 * **느려지는 문제**로 축소된다.
 */
export class CodexHybridSession implements AiSession {
  private closed = false;
  private fast: CodexAppServerStreamingSession | undefined;
  private stable: AiSession | undefined;
  private initialized = false;
  /** 지금 어느 경로로 도는지. 폴백이 조용히 일어나므로 밖에서 확인할 수 있어야 한다. */
  activePath: 'pending' | 'fast' | 'stable' = 'pending';
  private readonly transcript: TranscriptEntry[] = [];
  /** 빠른 경로에서 안정 경로로 넘어갈 때, 다음 1회 호출에만 대화 기록을 붙인다. */
  private needsReplay = false;

  constructor(
    private readonly createFast: () => Promise<CodexAppServerStreamingSession>,
    private readonly createStable: () => AiSession,
    private readonly useFastPath: boolean,
    private readonly onFallback: ((event: AiFallbackEvent) => void) | undefined,
  ) {}

  private async initialize(): Promise<void> {
    this.initialized = true;
    if (!this.useFastPath) {
      this.stable = this.createStable();
      this.activePath = 'stable';
      return;
    }

    try {
      this.fast = await this.createFast();
      this.activePath = 'fast';
    } catch (err) {
      reportFallback(
        this.onFallback,
        {
          feature: 'session',
          phase: 'start',
          from: 'codex-app-server',
          to: 'codex-sdk',
          reason: describeError(err),
          cause: err,
        },
        'Codex 빠른 세션(app-server)을 시작하지 못해 공식 SDK 경로로 전환한다. 동작엔 문제없고 턴마다 조금 느려진다.',
      );
      this.stable = this.createStable();
      this.activePath = 'stable';
    }
  }

  /** 빠른 경로가 도중에 깨졌을 때 안정 경로로 갈아탄다. 맥락은 다음 호출에서 복구한다. */
  private degradeToStable(err: unknown): void {
    reportFallback(
      this.onFallback,
      {
        feature: 'session',
        phase: 'mid-session',
        from: 'codex-app-server',
        to: 'codex-sdk',
        reason: describeError(err),
        cause: err,
      },
      'Codex 빠른 세션이 대화 도중 끊겨 공식 SDK 경로로 전환한다. 지금까지의 맥락은 복구한다.',
    );
    try {
      this.fast?.close();
    } catch {
      // 이미 죽은 프로세스를 정리하는 중이라 실패해도 의미 없다.
    }
    this.fast = undefined;
    this.stable = this.createStable();
    this.activePath = 'stable';
    this.needsReplay = true;
  }

  private async sendViaStable(prompt: string): Promise<AiRunResult> {
    const stable = this.stable!;
    const effectivePrompt = this.needsReplay ? buildReplayPrompt(this.transcript, prompt) : prompt;
    this.needsReplay = false;
    const result = await stable.send(effectivePrompt);
    this.transcript.push({ prompt, response: result.text });
    return result;
  }

  async send(prompt: string): Promise<AiRunResult> {
    if (this.closed) {
      throw new Error('[llm-runner] 이미 close()된 세션에는 send()를 호출할 수 없다.');
    }
    if (!this.initialized) await this.initialize();

    if (this.fast) {
      try {
        const result = await this.fast.send(prompt);
        this.transcript.push({ prompt, response: result.text });
        return result;
      } catch (err) {
        this.degradeToStable(err);
        // 폴백 경로에서도 실패하면 그 에러를 그대로 올린다 — 더 숨길 이유가 없다.
        return await this.sendViaStable(prompt);
      }
    }

    return await this.sendViaStable(prompt);
  }

  async *sendStream(prompt: string): AsyncIterable<AiStreamEvent> {
    if (this.closed) {
      throw new Error('[llm-runner] 이미 close()된 세션에는 send()를 호출할 수 없다.');
    }
    if (!this.initialized) await this.initialize();

    if (this.fast) {
      let emittedAnything = false;
      let text = '';
      try {
        for await (const event of this.fast.sendStream(prompt)) {
          emittedAnything = true;
          if (event.type === 'text') text += event.text;
          else this.transcript.push({ prompt, response: event.result.text || text });
          yield event;
        }
        return;
      } catch (err) {
        // 이미 일부를 내보낸 뒤라면 폴백할 수 없다 — 처음부터 다시 받으면 글자가 중복된다.
        if (emittedAnything) throw err;
        this.degradeToStable(err);
      }
    }

    const result = await this.sendViaStable(prompt);
    if (result.text) yield { type: 'text', text: result.text };
    yield { type: 'done', result };
  }

  close(): void {
    this.closed = true;
    this.fast?.close();
    this.stable?.close();
  }
}
