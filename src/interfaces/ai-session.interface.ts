import type { AiRunResult, AiStreamEvent } from './ai-runner.interface.js';

export interface AiSession {
  /**
   * 이전에 이 세션에서 주고받은 대화를 그대로 이어서 새 메시지를 보낸다.
   * 반드시 이전 send()의 결과를 기다린 다음에 호출한다 (동시에 여러 번 부르지 않는다).
   */
  send(prompt: string): Promise<AiRunResult>;

  /**
   * `send()`와 같지만 답변을 생성되는 대로 흘려보낸다. 상담봇처럼 **사람이 화면 앞에서 기다리는**
   * 여러 턴 대화에서는 이걸 써라 — 답변이 길면 `send()`는 한 턴에 20초 넘게 아무것도 안 보여준다.
   *
   * ```ts
   * for await (const event of session.sendStream('예산 안에서 뭘 사면 좋을까?')) {
   *   if (event.type === 'text') process.stdout.write(event.text);
   * }
   * ```
   *
   * `send()`와 마찬가지로 **순차적으로만** 호출한다. 스트림을 끝까지 소비하거나 `break`로
   * 빠져나온 다음에 다음 턴을 보내라.
   */
  sendStream(prompt: string): AsyncIterable<AiStreamEvent>;

  /**
   * 지금 어느 경로로 동작 중인지. 폴백이 있는 provider(`openai-subscription`)에서만 채워진다.
   *
   * - `'pending'`: 아직 첫 `send()` 전이라 결정되지 않음
   * - `'fast'`: 프로세스를 계속 살려두는 빠른 경로
   * - `'stable'`: 공식 SDK 경로(느리지만 예측 가능)
   *
   * 폴백은 조용히 일어나므로, 성능이 기대와 다르면 여기부터 확인해라.
   * 폴백이 **일어나는 순간**을 알고 싶으면 `createAiRunner({ onFallback })`을 쓴다.
   */
  readonly activePath?: 'pending' | 'fast' | 'stable';

  /** 세션이 물고 있는 프로세스를 종료한다. 세션을 더 안 쓸 때 반드시 호출한다. */
  close(): void;
}
