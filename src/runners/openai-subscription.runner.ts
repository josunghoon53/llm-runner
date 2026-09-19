import { Codex, type Thread, type Usage } from '@openai/codex-sdk';
import type {
  AiFallbackEvent,
  AiRunner,
  AiRunOptions,
  AiRunResult,
  AiStreamEvent,
  AiUsage,
} from '../interfaces/ai-runner.interface.js';
import type { AiSession } from '../interfaces/ai-session.interface.js';
import { CODEX_MODELS } from '../constants/ai-models.constants.js';
import {
  restoreCodexSession,
  restoreCodexSessionFromEnv,
  persistRotatedCodexAuth,
  looksLikeServerless,
  type CodexAuthStore,
} from '../setup/restore-session.js';
import { resolveCodexExecutable } from '../setup/resolve-codex-binary.js';
import {
  parseJsonFromModelOutput,
  type AiStructuredOptions,
  type AiStructuredResult,
} from '../structured-output.js';
import {
  createExperimentalCodexAppServerSession,
  type CodexAppServerStreamingSession,
} from '../experimental/codex-app-server-session.js';
import { wrapWithFriendlyMessage } from '../errors/friendly-error.js';
import {
  CodexHybridSession,
  CodexThreadSession,
  describeError,
  reportFallback,
  toUsage,
} from './codex-session.js';

export interface OpenAiSubscriptionRunnerOptions {
  defaultModel?: string;
  /**
   * `codex` 실행파일 경로를 직접 지정한다. 보통은 **지정할 필요가 없다** — PATH에 `codex`가 있으면
   * 그걸 쓰고, 없으면 프로젝트 의존성으로 설치된 `@openai/codex`의 번들 바이너리를 자동으로 찾는다.
   * 자동 탐지가 통하지 않는 특이한 배포 구조에서만 직접 지정해라.
   */
  codexPathOverride?: string;
  /**
   * 갱신된 로그인 토큰을 보관할 외부 저장소. 서버리스에 배포한다면 설정하는 걸 강하게 권장한다 —
   * 없으면 환경변수에 넣어둔 스냅샷이 토큰 회전 이후 언젠가 조용히 만료된다.
   */
  codexAuthStore?: CodexAuthStore;
  /**
   * 빠른 경로에서 안정 경로로 내려앉을 때 호출된다. 지정하지 않으면 stderr에 경고만 남기는데,
   * 서버리스에서는 그게 아무 데도 안 남아서 성능 저하를 영영 모를 수 있다.
   */
  onFallback?: (event: AiFallbackEvent) => void;
}

export interface OpenAiSubscriptionSessionOptions {
  model?: string;
  enableWebSearch?: boolean;
  /**
   * `'auto'`(기본): 프로세스를 계속 살려두는 빠른 경로(`codex app-server`)를 먼저 시도하고,
   * 그게 안 되면 공식 SDK 경로로 **자동 전환**한다. 빠른 경로가 깨져도 앱은 느려질 뿐 죽지 않는다.
   *
   * `'off'`: 항상 공식 SDK(`Thread`) 경로만 쓴다. 속도 이점은 없지만 동작이 가장 예측 가능하다.
   */
  fastMode?: 'auto' | 'off';
}

/**
 * 공식 `@openai/codex-sdk`의 `Thread`를 쓰는 **안정 경로** 세션.
 *
 * `Thread`는 "one thread can have multiple consecutive turns"라고 문서화되어 있어서 대화 맥락은
 * 이어진다 — 하지만 실측 결과 속도는 안 빨라진다. (새 Codex+새 Thread) vs (같은 Codex+새 Thread) vs
 * (같은 Codex+같은 Thread 재사용) 세 방식을 나란히 비교했을 때 셋 다 5~8초대에서 차이가 없었다.
 * SDK가 `Thread.run()`마다 `codex exec`를 새로 spawn하기 때문이다(SDK 소스로 확인).
 * 그래서 이 세션의 가치는 "속도"가 아니라 "맥락 유지 + 예측 가능한 동작"이다.
 */

/**
 * 기본 모델이 일시적으로 용량 부족("at capacity")일 때 한 단계 위 모델로 한 번 재시도한다.
 * 호출자가 model을 직접 지정한 경우에는 그 선택을 존중해서 재시도하지 않는다.
 */
const CAPACITY_FALLBACK: Record<string, string> = {
  [CODEX_MODELS.LUNA]: CODEX_MODELS.TERRA,
  [CODEX_MODELS.TERRA]: CODEX_MODELS.SOL,
};

function isCapacityError(err: unknown): boolean {
  return err instanceof Error && /at capacity/i.test(err.message);
}

function wrapCodexError(err: unknown): Error {
  // SDK가 던지는 원인(용량 부족, 모델 미지원, 로그인 만료 등)을 그대로 노출하되,
  // 초보자가 다음에 뭘 해야 하는지 알 수 있게 감싼다. 원본은 cause로 남긴다.
  const reason = err instanceof Error ? err.message : String(err);
  return wrapWithFriendlyMessage(
    `[llm-runner] Codex 호출 실패: ${reason} — 일시적인 용량 문제라면 잠시 후 다시 시도하고, ` +
      `계속되면 model 옵션으로 다른 모델(CODEX_MODELS.TERRA 등)을 지정하거나 \`npx llm-runner-setup\`으로 로그인 상태를 확인해라.`,
    err,
  );
}

/**
 * 로컬에 설치된 Codex CLI의 구독(ChatGPT 로그인) 세션을 그대로 사용한다.
 * 평소엔 공식 SDK만 쓰고 spawn/exec를 직접 호출하지 않는다.
 * 예외 두 가지:
 * - `CODEX_ACCESS_TOKEN`이 설정된 경우 프로세스당 한 번 `codex login`을 spawn해 세션을 복원한다.
 * - `createSession({ fastMode: 'auto' })`의 빠른 경로는 `codex app-server` 프로세스를 직접 띄운다
 *   (실패하면 공식 SDK 경로로 자동 폴백하므로 안전하다).
 */
export class OpenAiSubscriptionRunner implements AiRunner {
  private readonly codex: Codex;
  private readonly defaultModel: string;
  private readonly codexPath: string | undefined;
  private readonly authStore: CodexAuthStore | undefined;
  private readonly onFallback: ((event: AiFallbackEvent) => void) | undefined;
  private readyPromise: Promise<unknown> | undefined;

  constructor(options: OpenAiSubscriptionRunnerOptions = {}) {
    this.authStore = options.codexAuthStore;
    this.onFallback = options.onFallback;
    // PATH의 codex → 번들 바이너리 순으로 자동 결정한다. 사용자가 경로를 직접 쓸 필요가 없다.
    this.codexPath = resolveCodexExecutable(options.codexPathOverride);

    // store가 없으면 예전과 동일하게 생성 시점에 동기로 복원한다.
    // store가 있으면 비동기 조회가 필요하므로 첫 호출 직전으로 미룬다(ensureReady).
    if (!this.authStore) {
      restoreCodexSessionFromEnv(this.codexPath);
      // 서버리스에서 환경변수 스냅샷만 쓰면 토큰이 회전된 뒤 조용히 만료된다.
      // 조용히 깨지는 게 가장 나쁘므로, 최소한 로그에는 남긴다.
      if (process.env.CODEX_AUTH_JSON && looksLikeServerless()) {
        console.warn(
          '[llm-runner] 서버리스 환경에서 CODEX_AUTH_JSON만으로 Codex 세션을 복원했다. ' +
            '토큰이 갱신되면 그 값이 저장되지 않아 언젠가 인증이 만료된다 — ' +
            'createAiRunner({ codexAuthStore })를 설정해라 (README "Codex" 섹션).',
        );
      }
    }

    this.codex = new Codex(this.codexPath ? { codexPathOverride: this.codexPath } : {});
    this.defaultModel =
      options.defaultModel ?? process.env.OPENAI_SUBSCRIPTION_DEFAULT_MODEL ?? CODEX_MODELS.LUNA;
  }

  /** store를 쓰는 경우, 첫 호출 전에 한 번만 비동기 복원을 마친다. */
  private async ensureReady(): Promise<void> {
    if (!this.authStore) return;
    this.readyPromise ??= restoreCodexSession({
      store: this.authStore,
      codexPathOverride: this.codexPath,
    });
    await this.readyPromise;
  }

  private reportStreamFallback(phase: AiFallbackEvent['phase'], err: unknown): void {
    reportFallback(
      this.onFallback,
      {
        feature: 'stream',
        phase,
        from: 'codex-app-server',
        to: 'codex-sdk',
        reason: describeError(err),
        cause: err,
      },
      'Codex 글자 단위 스트리밍(app-server)을 쓸 수 없어 공식 SDK 경로로 전환한다. 텍스트가 한 덩어리로 도착한다.',
    );
  }

  /** 호출 이후 토큰이 회전됐으면 store에 반영한다. 실패해도 호출 결과에는 영향을 주지 않는다. */
  private async persistAuthIfRotated(): Promise<void> {
    if (!this.authStore) return;
    await persistRotatedCodexAuth(this.authStore);
  }

  async run(options: AiRunOptions): Promise<AiRunResult> {
    await this.ensureReady();
    try {
      return await this.runWithCapacityFallback(options);
    } finally {
      await this.persistAuthIfRotated();
    }
  }

  private async runWithCapacityFallback(options: AiRunOptions): Promise<AiRunResult> {
    const prompt = options.system ? `${options.system}\n\n${options.prompt}` : options.prompt;
    const model = options.model ?? this.defaultModel;

    try {
      return await this.runOnce(model, prompt, options);
    } catch (err) {
      const fallback = options.model ? undefined : CAPACITY_FALLBACK[model];
      if (fallback && isCapacityError(err)) {
        console.warn(`[llm-runner] ${model} 모델이 지금 용량 부족이라 ${fallback}로 한 번 재시도한다.`);
        try {
          return await this.runOnce(fallback, prompt, options);
        } catch (retryErr) {
          throw wrapCodexError(retryErr);
        }
      }
      throw wrapCodexError(err);
    }
  }

  private async runOnce(model: string, prompt: string, options: AiRunOptions): Promise<AiRunResult> {
    const thread = this.codex.startThread(this.threadOptions(model, options.enableWebSearch));
    const turn = await thread.run(prompt);
    return { text: turn.finalResponse, usage: toUsage(turn.usage), raw: turn };
  }

  /** Codex는 `outputSchema`로 스키마를 직접 강제한다 — 프롬프트로 부탁하는 방식이 아니다. */
  async runStructured<T = unknown>(options: AiStructuredOptions): Promise<AiStructuredResult<T>> {
    await this.ensureReady();
    const prompt = options.system ? `${options.system}\n\n${options.prompt}` : options.prompt;

    try {
      const thread = this.codex.startThread(this.threadOptions(options.model ?? this.defaultModel, false));
      const turn = await thread.run(prompt, { outputSchema: options.schema });
      return {
        data: parseJsonFromModelOutput<T>(turn.finalResponse),
        text: turn.finalResponse,
        usage: toUsage(turn.usage),
        raw: turn,
      };
    } catch (err) {
      throw wrapCodexError(err);
    } finally {
      await this.persistAuthIfRotated();
    }
  }

  /**
   * 공식 SDK의 `runStreamed()`는 이름과 달리 **증분을 주지 않는다** — 완성된 텍스트를 한 번에
   * 보내는 게 전부라는 걸 실제 이벤트를 찍어서 확인했다. 그래서 진짜 글자 단위 스트리밍이 되는
   * `codex app-server` 경로를 먼저 쓰고, 그게 안 되면 SDK 경로로 내려앉는다(이 경우 텍스트가
   * 한 덩어리로 오지만 동작은 동일하다).
   */
  async *stream(options: AiRunOptions): AsyncIterable<AiStreamEvent> {
    await this.ensureReady();
    const prompt = options.system ? `${options.system}\n\n${options.prompt}` : options.prompt;
    const model = options.model ?? this.defaultModel;

    try {
      // 웹 검색은 빠른 경로가 지원하지 않으므로 그때는 바로 SDK 경로를 쓴다.
      if (!options.enableWebSearch) {
        let session: Awaited<ReturnType<typeof createExperimentalCodexAppServerSession>> | undefined;
        try {
          session = await createExperimentalCodexAppServerSession({ model, codexPathOverride: this.codexPath });
        } catch (err) {
          this.reportStreamFallback('start', err);
        }

        if (session) {
          let emittedAnything = false;
          try {
            for await (const event of session.sendStream(prompt)) {
              emittedAnything = true;
              yield event;
            }
            return;
          } catch (err) {
            // 이미 일부를 내보낸 뒤에 실패하면 폴백할 수 없다 — 다시 처음부터 받으면 중복된다.
            if (emittedAnything) throw wrapCodexError(err);
            this.reportStreamFallback('start', err);
          } finally {
            session.close();
          }
        }
      }

      yield* this.streamViaSdk(prompt, model, options);
    } finally {
      await this.persistAuthIfRotated();
    }
  }

  private async *streamViaSdk(
    prompt: string,
    model: string,
    options: AiRunOptions,
  ): AsyncIterable<AiStreamEvent> {
    try {
      const thread = this.codex.startThread(this.threadOptions(model, options.enableWebSearch));
      const { events } = await thread.runStreamed(prompt);

      // Codex는 증분(delta)이 아니라 **매번 전체 텍스트가 담긴 item**을 다시 보낸다.
      // 그래서 이미 내보낸 길이를 기억해뒀다가 늘어난 부분만 잘라서 내보낸다.
      let emitted = '';
      let usage: AiUsage | undefined;

      for await (const event of events) {
        if (event.type === 'error') {
          throw new Error(event.message);
        }
        if (event.type === 'turn.failed') {
          throw new Error(event.error.message);
        }
        if (event.type === 'turn.completed') {
          usage = toUsage(event.usage);
          continue;
        }
        if (event.type === 'item.updated' || event.type === 'item.completed') {
          const item = event.item as { type?: string; text?: string };
          if (item.type !== 'agent_message' || typeof item.text !== 'string') continue;
          if (item.text.startsWith(emitted) && item.text.length > emitted.length) {
            yield { type: 'text', text: item.text.slice(emitted.length) };
            emitted = item.text;
          } else if (!item.text.startsWith(emitted)) {
            // 텍스트가 이어지지 않고 통째로 바뀐 경우(다시 쓴 경우)는 증분을 계산할 수 없다.
            yield { type: 'text', text: item.text };
            emitted = item.text;
          }
        }
      }

      yield { type: 'done', result: { text: emitted, usage } };
    } catch (err) {
      throw wrapCodexError(err);
    }
  }

  private threadOptions(model: string, enableWebSearch: boolean | undefined) {
    return {
      model,
      skipGitRepoCheck: true,
      // sandboxMode가 실질적인 방어선이다: read-only는 파일 쓰기/네트워크를
      // 완전히 막지만, ls/pwd 같은 읽기 명령 실행 자체는 policy와 무관하게 통과된다
      // (SDK/CLI 레벨에서 명령 실행 자체를 원천 차단하는 옵션은 없음).
      sandboxMode: 'read-only' as const,
      approvalPolicy: 'on-request' as const,
      // 웹 검색은 네트워크 접근이 있어야 동작하므로 함께 켠다.
      networkAccessEnabled: enableWebSearch ?? false,
      webSearchEnabled: enableWebSearch ?? false,
      webSearchMode: (enableWebSearch ? 'live' : 'disabled') as 'live' | 'disabled',
    };
  }

  /**
   * 진짜로 여러 턴이 이어져야 하는 대화에만 쓴다. 이전 턴의 맥락이 다음 턴에 그대로 섞이므로,
   * 서로 무관한 여러 작업에는 절대 재사용하지 말고 매번 새 세션을 만들거나 `run()`을 써라.
   * 다 쓰면 반드시 `close()`를 호출해라.
   *
   * 기본값(`fastMode: 'auto'`)에서는 프로세스를 계속 살려두는 빠른 경로를 먼저 시도하고, 그게
   * 안 되면 공식 SDK 경로로 자동 전환한다 — 즉 최악의 경우에도 "조금 느려질 뿐" 깨지지 않는다.
   * 웹 검색(`enableWebSearch: true`)이 필요하면 빠른 경로가 지원하지 않으므로 자동으로
   * 안정 경로만 쓴다.
   */
  createSession(options: OpenAiSubscriptionSessionOptions = {}): AiSession {
    const model = options.model ?? this.defaultModel;
    const useFastPath = (options.fastMode ?? 'auto') === 'auto' && !options.enableWebSearch;

    const createStable = () =>
      new CodexThreadSession(this.codex.startThread(this.threadOptions(model, options.enableWebSearch)));

    const createFast = async () => {
      await this.ensureReady();
      return await createExperimentalCodexAppServerSession({
        model,
        codexPathOverride: this.codexPath,
      });
    };

    return new CodexHybridSession(createFast, createStable, useFastPath, this.onFallback);
  }
}
