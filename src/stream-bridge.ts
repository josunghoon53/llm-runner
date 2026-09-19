import type { AiRunResult, AiStreamEvent } from './interfaces/ai-runner.interface.js';

/**
 * "증분은 콜백으로 오고 최종 결과는 Promise로 오는" 구조를 `AsyncIterable<AiStreamEvent>`로 바꾼다.
 * 두 구독 provider의 세션이 모두 이 모양이라서 한 군데로 모았다.
 *
 * 콜백이 우리가 루프를 돌기 전에 먼저 불릴 수 있으므로, 도착한 증분은 버퍼에 쌓아두고
 * 소비자가 따라올 때 꺼내준다 — 이걸 빠뜨리면 앞부분 몇 글자가 조용히 사라진다.
 */
export async function* streamFromCallback(
  start: (onDelta: (text: string) => void) => Promise<AiRunResult>,
): AsyncIterable<AiStreamEvent> {
  const buffered: string[] = [];
  let wake: (() => void) | undefined;
  let finished = false;
  let result: AiRunResult | undefined;
  let failure: unknown;
  let failed = false;

  const nudge = () => {
    wake?.();
    wake = undefined;
  };

  const settled = start((text) => {
    buffered.push(text);
    nudge();
  });

  settled.then(
    (value) => {
      result = value;
      finished = true;
      nudge();
    },
    (error) => {
      failure = error;
      failed = true;
      finished = true;
      nudge();
    },
  );

  while (true) {
    while (buffered.length > 0) yield { type: 'text', text: buffered.shift()! };
    if (finished) break;
    await new Promise<void>((resolve) => {
      wake = resolve;
    });
  }

  if (failed) throw failure;
  yield { type: 'done', result: result ?? { text: '' } };
}
