import { vi } from 'vitest';

const initialize = vi.fn(async () => {});
const request = vi.fn();
const close = vi.fn();
let notify: ((n: { method: string; params?: unknown }) => void) | undefined;
const onNotification = vi.fn((fn: (n: { method: string; params?: unknown }) => void) => {
  notify = fn;
  return () => {
    notify = undefined;
  };
});
const onFatalError = vi.fn(() => () => {});
vi.mock('./codex-app-server-session.js', () => ({
  CodexAppServerPeer: function () {
    return { initialize, request, close, onNotification, onFatalError };
  },
}));

const { generateCodexImage } = await import('./codex-image.js');

const TURN = 't-1';
const PNG_B64 = Buffer.from('가짜 PNG 바이트').toString('base64');

function wireHappyPath() {
  request.mockImplementation(async (method: string) => {
    if (method === 'thread/start') return { thread: { id: 'th-1' } };
    if (method === 'turn/start') return { turn: { id: TURN } };
    return {};
  });
}
/** 구독이 걸릴 때까지 기다린다 — initialize→thread/start→turn/start를 다 지나야 등록된다. */
async function ready() {
  for (let i = 0; i < 50 && !notify; i++) await new Promise((r) => setTimeout(r, 1));
}
const item = (params: unknown) => notify?.({ method: 'item/completed', params });
const complete = () => notify?.({ method: 'turn/completed', params: { turn: { id: TURN } } });

describe('generateCodexImage', () => {
  beforeEach(() => {
    initialize.mockClear();
    request.mockReset();
    close.mockClear();
    onNotification.mockClear();
    notify = undefined;
  });

  it('완료된 이미지의 base64를 Buffer로 돌려준다', async () => {
    wireHappyPath();
    const promise = generateCodexImage({ prompt: '파란 원' });
    await ready();

    item({ turnId: TURN, item: { type: 'imageGeneration', status: 'completed', result: PNG_B64, revisedPrompt: '다듬은 프롬프트' } });
    complete();

    const r = await promise;
    expect(r.images).toHaveLength(1);
    expect(r.images[0]!.data.toString()).toBe('가짜 PNG 바이트');
    expect(r.images[0]!.revisedPrompt).toBe('다듬은 프롬프트');
  });

  // 실측: 같은 이미지에 in_progress와 completed가 둘 다 온다. 중복으로 세면 안 된다.
  it('in_progress 아이템은 건너뛴다', async () => {
    wireHappyPath();
    const promise = generateCodexImage({ prompt: 'x' });
    await ready();

    item({ turnId: TURN, item: { type: 'imageGeneration', status: 'in_progress', result: '' } });
    item({ turnId: TURN, item: { type: 'imageGeneration', status: 'completed', result: PNG_B64 } });
    complete();

    await expect(promise).resolves.toMatchObject({ images: [expect.anything()] });
  });

  // 이미지는 텍스트와 다른 한도를 쓴다. 초과하면 언제 풀리는지 알려줘야 한다.
  it('한도 초과를 failure로 돌려주고 resetsAt을 Date로 바꾼다', async () => {
    wireHappyPath();
    const promise = generateCodexImage({ prompt: 'x' });
    await ready();

    item({
      turnId: TURN,
      item: {
        type: 'imageGeneration',
        status: 'failed',
        failure: { type: 'usageLimitExceeded', limitId: 'image', resetsAt: 1790786057 },
      },
    });
    complete();

    const r = await promise;
    expect(r.images).toHaveLength(0);
    expect(r.failure).toMatchObject({ type: 'usageLimitExceeded', limitId: 'image' });
    expect(r.failure?.resetsAt?.getTime()).toBe(1790786057 * 1000);
  });

  it('곁들인 설명을 text로 모은다', async () => {
    wireHappyPath();
    const promise = generateCodexImage({ prompt: 'x' });
    await ready();

    item({ turnId: TURN, item: { type: 'agentMessage', text: '그렸습니다.' } });
    complete();

    await expect(promise).resolves.toMatchObject({ text: '그렸습니다.', images: [] });
  });

  it('다른 턴의 아이템은 무시한다', async () => {
    wireHappyPath();
    const promise = generateCodexImage({ prompt: 'x' });
    await ready();

    item({ turnId: '다른-턴', item: { type: 'imageGeneration', status: 'completed', result: PNG_B64 } });
    complete();

    await expect(promise).resolves.toMatchObject({ images: [] });
  });

  // 안전선을 내리지 않는 게 이 모듈의 핵심 설계다 — 회귀하면 바로 드러나야 한다.
  it('읽기 전용 샌드박스로 스레드를 연다', async () => {
    wireHappyPath();
    const promise = generateCodexImage({ prompt: 'x' });
    await ready();
    complete();
    await promise;

    expect(request).toHaveBeenCalledWith('thread/start', expect.objectContaining({ sandboxMode: 'read-only' }));
  });

  it('끝나면 프로세스를 정리한다', async () => {
    wireHappyPath();
    const promise = generateCodexImage({ prompt: 'x' });
    await ready();
    complete();
    await promise;

    expect(close).toHaveBeenCalled();
  });

  it('시간이 지나면 정리하고 던진다', async () => {
    wireHappyPath();

    await expect(generateCodexImage({ prompt: 'x', timeoutMs: 20 })).rejects.toThrow(/끝나지 않았다/);
    expect(close).toHaveBeenCalled();
  });
});
