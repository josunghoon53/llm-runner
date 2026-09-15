import { vi } from 'vitest';

const runMock = vi.fn();
const startThreadMock = vi.fn(() => ({ run: runMock }));

vi.mock('@openai/codex-sdk', () => ({
  Codex: vi.fn().mockImplementation(function CodexMock() {
    return { startThread: startThreadMock };
  }),
}));

const { OpenAiSubscriptionRunner } = await import('./openai-subscription.runner.js');

describe('OpenAiSubscriptionRunner', () => {
  beforeEach(() => {
    runMock.mockReset();
    startThreadMock.mockClear();
  });

  it('finalResponse를 text로 반환한다', async () => {
    runMock.mockResolvedValue({ finalResponse: '답변', items: [] });

    const runner = new OpenAiSubscriptionRunner();
    const result = await runner.run({ prompt: '질문' });

    expect(result.text).toBe('답변');
  });

  it('기본값은 read-only 샌드박스 + 검색/네트워크 차단이다', async () => {
    runMock.mockResolvedValue({ finalResponse: 'ok' });

    const runner = new OpenAiSubscriptionRunner();
    await runner.run({ prompt: '질문' });

    expect(startThreadMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sandboxMode: 'read-only',
        networkAccessEnabled: false,
        webSearchEnabled: false,
        webSearchMode: 'disabled',
      }),
    );
  });

  it('enableWebSearch가 true면 네트워크와 검색을 함께 켠다', async () => {
    runMock.mockResolvedValue({ finalResponse: 'ok' });

    const runner = new OpenAiSubscriptionRunner();
    await runner.run({ prompt: '질문', enableWebSearch: true });

    expect(startThreadMock).toHaveBeenCalledWith(
      expect.objectContaining({
        networkAccessEnabled: true,
        webSearchEnabled: true,
        webSearchMode: 'live',
      }),
    );
  });

  it('SDK 호출이 실패하면 원인과 다음 행동을 담은 에러로 감싸고 원본은 cause로 남긴다', async () => {
    const original = new Error('Selected model is at capacity. Please try a different model.');
    runMock.mockRejectedValue(original);

    const runner = new OpenAiSubscriptionRunner();

    await expect(runner.run({ prompt: '질문' })).rejects.toMatchObject({
      message: expect.stringMatching(/Codex 호출 실패: Selected model is at capacity.*다시 시도/),
      cause: original,
    });
  });

  it('모델을 명시하지 않았고 기본 모델이 용량 부족이면 한 단계 위 모델로 한 번 재시도한다', async () => {
    runMock
      .mockRejectedValueOnce(new Error('Selected model is at capacity. Please try a different model.'))
      .mockResolvedValueOnce({ finalResponse: '재시도 성공' });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      const runner = new OpenAiSubscriptionRunner();
      const result = await runner.run({ prompt: '질문' });

      expect(result.text).toBe('재시도 성공');
      expect(startThreadMock).toHaveBeenCalledTimes(2);
      expect(startThreadMock.mock.calls[0][0]).toMatchObject({ model: 'gpt-5.6-luna' });
      expect(startThreadMock.mock.calls[1][0]).toMatchObject({ model: 'gpt-5.6-terra' });
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('gpt-5.6-terra'));
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('모델을 직접 지정했으면 용량 부족이어도 다른 모델로 바꿔치기하지 않는다', async () => {
    runMock.mockRejectedValue(new Error('Selected model is at capacity. Please try a different model.'));

    const runner = new OpenAiSubscriptionRunner();

    await expect(runner.run({ prompt: '질문', model: 'gpt-5.6-luna' })).rejects.toThrow(/Codex 호출 실패/);
    expect(startThreadMock).toHaveBeenCalledTimes(1);
  });

  it('system이 있으면 prompt 앞에 붙여서 전달한다', async () => {
    runMock.mockResolvedValue({ finalResponse: 'ok' });

    const runner = new OpenAiSubscriptionRunner();
    await runner.run({ prompt: '질문', system: '지시사항' });

    expect(runMock).toHaveBeenCalledWith('지시사항\n\n질문');
  });
});
