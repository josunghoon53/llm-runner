import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import type { AiSession } from '../interfaces/ai-session.interface.js';
import type { AiRunResult, AiStreamEvent, AiUsage } from '../interfaces/ai-runner.interface.js';
import { restoreCodexSessionFromEnv } from '../setup/restore-session.js';

/**
 * `codex app-server`(OpenAI가 CLI 도움말에서 `[experimental]`이라고 명시한 프로토콜)를 직접
 * JSON-RPC(JSONL, 줄바꿈으로 구분된 JSON)로 통신해서 프로세스 하나를 계속 살려두고 여러 턴을
 * 처리한다. 공식 `@openai/codex-sdk`의 `Thread.run()`은 호출마다 `codex exec`를 새로 spawn해서
 * 재사용 효과가 없다는 게 확인됐지만(README 참고), 이 경로는 실측으로 2턴부터 확실히 빨라지는 걸
 * 확인했다(최초 턴 대비 약 2~3배).
 *
 * ⚠️ 이건 OpenAI가 스스로 실험적이라고 못박은 프로토콜을 직접 구현한 것이다. Codex CLI가 업데이트되면
 * 예고 없이 깨질 수 있다. `experimental/` 아래 있는 이유가 그거다 — 기본 `OpenAiSubscriptionRunner`
 * 에는 안 엮여 있고, 이걸 쓰려면 이 파일을 직접 import해야 한다.
 */

interface JsonRpcRequest {
  id: number;
  method: string;
  params?: unknown;
}

interface JsonRpcNotification {
  method: string;
  params?: unknown;
}

interface JsonRpcResponse {
  id: number;
  result?: unknown;
  error?: { code: number; message: string };
}

export interface CodexAppServerSessionOptions {
  model?: string;
  codexPathOverride?: string;
  cwd?: string;
  /** 요청 하나가 이 시간(ms) 안에 응답이 없으면 실패 처리한다. 기본값 30000. */
  requestTimeoutMs?: number;
  /** 턴 하나가 이 시간(ms) 안에 안 끝나면 실패 처리한다. 기본값 120000(2분). */
  turnTimeoutMs?: number;
}

/**
 * `codex app-server`와 JSONL로 통신하는 최소 클라이언트.
 * 필요한 만큼만 구현했다: initialize 핸드셰이크, thread/start, turn/start, 완료 대기,
 * 그리고 (읽기전용 sandbox라 거의 안 오지만) 도구 승인 요청은 전부 거절한다.
 */
class CodexAppServerPeer {
  private readonly child: ChildProcessWithoutNullStreams;
  private nextId = 1;
  private readonly pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: unknown) => void; timer: ReturnType<typeof setTimeout> }
  >();
  private readonly notificationListeners = new Set<(n: JsonRpcNotification) => void>();
  private readonly fatalErrorListeners = new Set<(err: Error) => void>();
  private closed = false;
  private readonly requestTimeoutMs: number;

  constructor(codexPathOverride: string | undefined, cwd: string | undefined, requestTimeoutMs = 30_000) {
    this.requestTimeoutMs = requestTimeoutMs;
    this.child = spawn(codexPathOverride ?? 'codex', ['app-server', '--listen', 'stdio://'], {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.child.stderr.setEncoding('utf8');

    // 바이너리를 못 찾거나(ENOENT) 프로세스가 죽으면, 대기 중인 요청들이 영원히 안 풀리는 대신
    // 바로 실패하게 한다. 실제로 codexPathOverride를 틀리게 줘서 검증함.
    this.child.on('error', (err) => this.failAllPending(new Error(`codex app-server 프로세스를 실행할 수 없다: ${err.message}`)));
    this.child.on('exit', (code, signal) => {
      if (this.closed) return;
      this.failAllPending(
        new Error(`codex app-server 프로세스가 예기치 않게 종료됐다 (code=${code}, signal=${signal}).`),
      );
    });

    const rl = createInterface({ input: this.child.stdout, crlfDelay: Infinity });
    rl.on('line', (line) => {
      if (!line.trim()) return;
      const message = JSON.parse(line) as JsonRpcResponse | JsonRpcNotification | JsonRpcRequest;
      if ('id' in message && !('method' in message)) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        clearTimeout(pending.timer);
        if (message.error) pending.reject(new Error(`codex app-server 에러: ${message.error.message}`));
        else pending.resolve(message.result);
      } else if ('method' in message && 'id' in message) {
        // 서버가 보낸 요청(주로 도구 실행 승인) — 전부 거절한다. 우리는 sandboxMode: read-only만 쓴다.
        this.write({ id: (message as JsonRpcRequest).id, result: { decision: 'decline' } });
      } else if ('method' in message) {
        for (const listener of this.notificationListeners) listener(message as JsonRpcNotification);
      }
    });
  }

  private failAllPending(err: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(err);
    }
    this.pending.clear();
    for (const listener of this.fatalErrorListeners) listener(err);
  }

  onFatalError(listener: (err: Error) => void): () => void {
    this.fatalErrorListeners.add(listener);
    return () => this.fatalErrorListeners.delete(listener);
  }

  private write(message: unknown): void {
    if (this.closed) return;
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  request<T>(method: string, params?: unknown): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`[llm-runner] codex app-server 요청(${method})이 ${this.requestTimeoutMs}ms 안에 응답하지 않았다.`));
      }, this.requestTimeoutMs);
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
      this.write({ id, method, params });
    });
  }

  notify(method: string, params?: unknown): void {
    this.write({ method, params });
  }

  onNotification(listener: (n: JsonRpcNotification) => void): () => void {
    this.notificationListeners.add(listener);
    return () => this.notificationListeners.delete(listener);
  }

  async initialize(): Promise<void> {
    await this.request('initialize', {
      capabilities: { experimentalApi: true, requestAttestation: false },
      clientInfo: { name: 'llm-runner', title: 'llm-runner (experimental app-server client)', version: '0.0.0' },
    });
    this.notify('initialized');
  }

  close(): void {
    this.closed = true;
    this.child.kill();
  }
}

interface TurnCompletedNotificationParams {
  turn: { id: string; status: 'completed' | 'failed'; error?: { message?: string } | string };
}

interface ItemCompletedNotificationParams {
  turnId: string;
  item: { type: string; text?: string };
}

/** `item/agentMessage/delta` — 공식 SDK엔 없는, app-server만 보내주는 증분 텍스트다. */
interface AgentMessageDeltaParams {
  turnId: string;
  delta: string;
}

/** `thread/tokenUsage/updated` — `last`가 이번 턴에서 쓴 양이다. */
interface TokenUsageNotificationParams {
  turnId: string;
  tokenUsage: {
    last?: {
      inputTokens?: number;
      cachedInputTokens?: number;
      outputTokens?: number;
      reasoningOutputTokens?: number;
    };
  };
}

function toUsage(params: TokenUsageNotificationParams): AiUsage | undefined {
  const last = params.tokenUsage?.last;
  if (!last) return undefined;
  return {
    inputTokens: last.inputTokens,
    outputTokens: last.outputTokens,
    cachedInputTokens: last.cachedInputTokens,
    reasoningTokens: last.reasoningOutputTokens,
    // 구독 사용량이라 금액은 안 알려준다 — 추정치를 지어내지 않는다.
  };
}

class CodexAppServerSession implements AiSession {
  private closed = false;
  private threadId: string | undefined;

  constructor(
    private readonly peer: CodexAppServerPeer,
    private readonly model: string | undefined,
    private readonly turnTimeoutMs: number,
  ) {}

  async ensureThread(): Promise<string> {
    if (this.threadId) return this.threadId;
    const response = await this.peer.request<{ thread: { id: string } }>('thread/start', {
      model: this.model,
      sandboxMode: 'read-only',
      approvalPolicy: 'on-request',
      skipGitRepoCheck: true,
    });
    this.threadId = response.thread.id;
    return this.threadId;
  }

  async send(prompt: string): Promise<AiRunResult> {
    if (this.closed) {
      throw new Error('[llm-runner] 이미 close()된 세션에는 send()를 호출할 수 없다.');
    }
    const threadId = await this.ensureThread();

    const { turn } = await this.peer.request<{ turn: { id: string } }>('turn/start', {
      threadId,
      input: [{ type: 'text', text: prompt, text_elements: [] }],
    });

    return new Promise<AiRunResult>((resolve, reject) => {
      const items: ItemCompletedNotificationParams['item'][] = [];
      let usage: AiUsage | undefined;

      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`[llm-runner] Codex app-server 턴(${turn.id})이 ${this.turnTimeoutMs}ms 안에 끝나지 않았다.`));
      }, this.turnTimeoutMs);

      const unsubscribeNotification = this.peer.onNotification((n) => {
        if (n.method === 'item/completed') {
          const params = n.params as ItemCompletedNotificationParams;
          if (params.turnId === turn.id) items.push(params.item);
        } else if (n.method === 'thread/tokenUsage/updated') {
          // 사용량은 별도 알림으로 온다 — 이걸 안 받으면 세션 호출만 usage가 비어버린다
          // (장시간 테스트에서 8턴 내내 "미제공"으로 찍히는 걸 보고 발견했다).
          const params = n.params as TokenUsageNotificationParams;
          if (params.turnId === turn.id) usage = toUsage(params) ?? usage;
        } else if (n.method === 'turn/completed') {
          const params = n.params as TurnCompletedNotificationParams;
          if (params.turn.id !== turn.id) return;
          cleanup();
          if (params.turn.status === 'failed') {
            const detail =
              typeof params.turn.error === 'string'
                ? params.turn.error
                : params.turn.error?.message ?? JSON.stringify(params.turn);
            reject(new Error(`[llm-runner] Codex app-server 턴 실패: turn=${turn.id} — ${detail}`));
            return;
          }
          const text = items.filter((i) => i.type === 'agentMessage' && i.text).map((i) => i.text).join('');
          resolve({ text, usage, raw: { turn, items } });
        }
      });

      // 프로세스가 죽으면(바이너리 없음, 크래시 등) 여기서도 영원히 안 풀리는 대신 바로 실패한다.
      const unsubscribeFatal = this.peer.onFatalError((err) => {
        cleanup();
        reject(err);
      });

      function cleanup() {
        clearTimeout(timer);
        unsubscribeNotification();
        unsubscribeFatal();
      }
    });
  }

  /**
   * `send()`와 같은 요청이지만, 생성되는 대로 텍스트 증분을 내보낸다.
   *
   * 이게 가능한 이유가 app-server를 직접 쓰는 또 하나의 이유다 — 공식 `@openai/codex-sdk`의
   * `runStreamed()`는 이름과 달리 **증분을 주지 않는다**(`item.completed`로 완성된 텍스트를
   * 한 번에 보내는 게 전부라는 걸 실제 이벤트를 찍어서 확인했다). app-server는
   * `item/agentMessage/delta`로 글자 단위 증분을 보내준다.
   */
  async *sendStream(prompt: string): AsyncIterable<AiStreamEvent> {
    if (this.closed) {
      throw new Error('[llm-runner] 이미 close()된 세션에는 send()를 호출할 수 없다.');
    }
    const threadId = await this.ensureThread();
    const { turn } = await this.peer.request<{ turn: { id: string } }>('turn/start', {
      threadId,
      input: [{ type: 'text', text: prompt, text_elements: [] }],
    });

    const pending: AiStreamEvent[] = [];
    let wake: (() => void) | undefined;
    let finished = false;
    let failure: unknown;
    let text = '';
    let usage: AiUsage | undefined;

    const push = (event: AiStreamEvent) => {
      pending.push(event);
      wake?.();
      wake = undefined;
    };
    const finish = (err?: unknown) => {
      if (err !== undefined) failure = err;
      finished = true;
      wake?.();
      wake = undefined;
    };

    const unsubscribeNotification = this.peer.onNotification((n) => {
      const params = n.params as { turnId?: string } | undefined;

      if (n.method === 'item/agentMessage/delta') {
        const delta = n.params as AgentMessageDeltaParams;
        if (delta.turnId !== turn.id || !delta.delta) return;
        text += delta.delta;
        push({ type: 'text', text: delta.delta });
        return;
      }
      if (n.method === 'thread/tokenUsage/updated') {
        if (params?.turnId !== turn.id) return;
        usage = toUsage(n.params as TokenUsageNotificationParams) ?? usage;
        return;
      }
      if (n.method === 'turn/completed') {
        const completed = n.params as TurnCompletedNotificationParams;
        if (completed.turn.id !== turn.id) return;
        if (completed.turn.status === 'failed') {
          const detail =
            typeof completed.turn.error === 'string'
              ? completed.turn.error
              : completed.turn.error?.message ?? JSON.stringify(completed.turn);
          finish(new Error(`[llm-runner] Codex app-server 턴 실패: turn=${turn.id} — ${detail}`));
          return;
        }
        finish();
      }
    });
    const unsubscribeFatal = this.peer.onFatalError((err) => finish(err));
    const timer = setTimeout(
      () =>
        finish(
          new Error(`[llm-runner] Codex app-server 턴(${turn.id})이 ${this.turnTimeoutMs}ms 안에 끝나지 않았다.`),
        ),
      this.turnTimeoutMs,
    );

    try {
      while (true) {
        while (pending.length > 0) yield pending.shift()!;
        if (finished) break;
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
      }
      if (failure !== undefined) throw failure;
      yield { type: 'done', result: { text, usage } };
    } finally {
      clearTimeout(timer);
      unsubscribeNotification();
      unsubscribeFatal();
    }
  }

  close(): void {
    this.closed = true;
    this.peer.close();
  }
}

/** `createExperimentalCodexAppServerSession()`이 돌려주는, 스트리밍까지 가능한 세션. */
export interface CodexAppServerStreamingSession extends AiSession {
  sendStream(prompt: string): AsyncIterable<AiStreamEvent>;
}

/**
 * `codex app-server`로 통신하는 세션을 만든다. `send()`는 반드시 순차적으로(이전 결과를 기다린 후)
 * 호출해야 한다. 다 쓰면 반드시 `close()`를 호출해라 — 안 하면 spawn된 프로세스가 안 죽는다.
 *
 * ⚠️ 실험적 기능이다 — OpenAI가 이 프로토콜을 언제든 바꿀 수 있고, 그러면 이 함수가 깨질 수 있다.
 * 공식 `@openai/codex-sdk`가 이 기능을 정식 지원하기 시작하면 이 함수는 그쪽으로 대체될 예정이다.
 */
export async function createExperimentalCodexAppServerSession(
  options: CodexAppServerSessionOptions = {},
): Promise<CodexAppServerStreamingSession> {
  // CODEX_ACCESS_TOKEN이 있는 배포 환경(서버리스 등)이면 `codex login --with-access-token`으로
  // 세션을 복원한다. OpenAiSubscriptionRunner와 동일한 메커니즘 — 여기서도 빠뜨리면 안 된다
  // (실제로 한 번 빠뜨렸다가 Vercel에서 "턴 실패"로만 나오고 원인이 안 보이는 걸 겪었다).
  restoreCodexSessionFromEnv(options.codexPathOverride);
  const peer = new CodexAppServerPeer(options.codexPathOverride, options.cwd, options.requestTimeoutMs);
  await peer.initialize();
  return new CodexAppServerSession(peer, options.model, options.turnTimeoutMs ?? 120_000);
}
