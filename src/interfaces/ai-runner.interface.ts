import type { AiStructuredOptions, AiStructuredResult } from '../structured-output.js';

export interface AiRunOptions {
  prompt: string;
  system?: string;
  model?: string;
  /** API 키 기반 Runner(claude-api, openai-api)에서만 적용된다. 구독 기반 Runner는 무시한다. */
  maxTokens?: number;
  /** 구독 기반 Runner(claude-subscription, openai-subscription)에서만 적용된다. API 키 기반 Runner는 무시한다. */
  enableWebSearch?: boolean;
  /**
   * `openai-subscription`에서만 적용된다 — Codex가 답하기 전 추론에 쓰는 노력의 정도.
   * **첫 글자까지 걸리는 시간을 좌우하는 가장 큰 변수다**(실측 `'none'` 5.2초 vs 기본값 11.6초).
   * 값은 `'none' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'`. 자세한 건 `CodexReasoningEffort` 참고.
   */
  reasoningEffort?: string;
}

/**
 * 이번 호출이 쓴 토큰 양. provider마다 제공하는 항목이 달라서 전부 optional이다 —
 * **값이 없는 건 "0"이 아니라 "그 provider가 안 알려준다"는 뜻**이므로, 합산해서 보여줄 때 주의해라.
 *
 * `costUsd`는 실제 금액을 직접 알려주는 provider에서만 채워진다(현재 `claude-subscription`).
 * 나머지는 토큰 수만 주기 때문에, 우리가 단가표를 들고 곱해봐야 모델 가격이 바뀌면 조용히 틀린 값이
 * 된다 — 그래서 **추정치를 지어내지 않고 비워둔다**. 금액이 필요하면 토큰 수를 각자의 단가로 곱해라.
 */
export interface AiUsage {
  inputTokens?: number;
  outputTokens?: number;
  /** 프롬프트 캐시에서 읽은 입력 토큰. 지원하는 provider에서만 채워진다. */
  cachedInputTokens?: number;
  /** 추론(reasoning)에 쓴 출력 토큰. `outputTokens`에 이미 포함되어 있다. */
  reasoningTokens?: number;
  /** provider가 직접 알려준 USD 비용. 추정치는 절대 넣지 않는다. */
  costUsd?: number;
}

export interface AiRunResult {
  text: string;
  /** provider가 알려준 경우에만 채워진다. 안 알려주면 `undefined`. */
  usage?: AiUsage;
  raw?: unknown;
}

/** `stream()`이 내보내는 이벤트. 마지막에 정확히 한 번 `done`이 온다. */
export type AiStreamEvent =
  /** 새로 생성된 텍스트 조각. 지금까지의 전체 텍스트가 아니라 **증분**이다. */
  | { type: 'text'; text: string }
  /** 생성 완료. 전체 텍스트와 (제공되는 경우) 사용량이 들어 있다. */
  | { type: 'done'; result: AiRunResult };

/**
 * 내부적으로 더 빠른 경로를 쓰다가 안정 경로로 내려앉았을 때 알려주는 이벤트.
 *
 * 폴백은 앱을 안 죽이는 대신 **조용히 느려진다**는 게 문제다. 로컬 개발이면 stderr 경고로
 * 눈에 띄지만, 서버리스에서는 그 경고가 아무 데도 안 남아서 몇 달간 느린 경로로만 돌아도
 * 알 방법이 없다. 그래서 구조화된 이벤트로 받아서 각자의 로그/모니터링에 넣을 수 있게 한다.
 */
export interface AiFallbackEvent {
  /** 어떤 기능에서 일어났는지. */
  feature: 'session' | 'stream';
  /** 시작 시점에 못 쓴 건지, 쓰다가 끊긴 건지. 후자는 원인이 다르므로 구분할 가치가 있다. */
  phase: 'start' | 'mid-session';
  /** 원래 쓰려던 경로. */
  from: string;
  /** 실제로 쓰게 된 경로. */
  to: string;
  /** 사람이 읽을 수 있는 사유. */
  reason: string;
  /** 원본 에러. */
  cause?: unknown;
}

export interface AiRunner {
  run(options: AiRunOptions): Promise<AiRunResult>;

  /**
   * 정해진 모양(JSON Schema)의 결과를 받는다. 텍스트를 받아서 직접 파싱하는 것보다 안전하다.
   *
   * ```ts
   * const { data } = await runner.runStructured<{ sentiment: string; score: number }>({
   *   prompt: '이 리뷰의 감정을 분석해줘: "배송이 빨라서 좋았어요"',
   *   schema: {
   *     type: 'object',
   *     properties: { sentiment: { type: 'string' }, score: { type: 'number' } },
   *     required: ['sentiment', 'score'],
   *     additionalProperties: false,
   *   },
   * });
   * ```
   *
   * **강제 수준이 provider마다 다르다**: `claude-api`(도구 호출), `openai-api`(json_schema),
   * `openai-subscription`(outputSchema)은 provider가 스키마를 직접 강제한다. 반면
   * `claude-subscription`은 그런 장치가 없어서 프롬프트로 지시하고 결과를 파싱하는 방식이라
   * 실패할 수 있다 — 스키마가 중요하다면 앞의 세 provider를 써라.
   */
  runStructured<T = unknown>(options: AiStructuredOptions): Promise<AiStructuredResult<T>>;

  /**
   * `run()`과 같은 요청을 보내되, 완성될 때까지 기다리지 않고 생성되는 대로 텍스트 조각을 내보낸다.
   * 챗봇 UI처럼 사용자가 화면 앞에서 기다리는 기능에 쓴다 — 특히 구독 provider는 응답 완성까지
   * 5~10초가 걸려서, 스트리밍 없이는 그동안 빈 화면이 된다.
   *
   * ```ts
   * for await (const event of runner.stream({ prompt: '...' })) {
   *   if (event.type === 'text') process.stdout.write(event.text);
   *   else console.log(event.result.usage);
   * }
   * ```
   *
   * 중간에 `break`로 빠져나오면 내부 스트림도 정리된다. 마지막 `done` 이벤트의 `result`는
   * `run()`이 돌려주는 것과 같은 형태이므로, 전체 텍스트가 필요하면 그걸 쓰면 된다.
   */
  stream(options: AiRunOptions): AsyncIterable<AiStreamEvent>;
}
