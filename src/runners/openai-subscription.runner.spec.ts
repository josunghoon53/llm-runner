import { vi } from 'vitest';

const runMock = vi.fn();
const runStreamedMock = vi.fn();
const startThreadMock = vi.fn(() => ({ run: runMock, runStreamed: runStreamedMock }));
const codexConstructorMock = vi.fn();
const restoreCodexSessionFromEnvMock = vi.fn();

vi.mock('@openai/codex-sdk', () => ({
  Codex: vi.fn().mockImplementation(function CodexMock(...args: unknown[]) {
    codexConstructorMock(...args);
    return { startThread: startThreadMock };
  }),
}));

const restoreCodexSessionMock = vi.fn(async () => true);
const persistRotatedCodexAuthMock = vi.fn(async () => false);

vi.mock('../setup/restore-session.js', () => ({
  restoreCodexSessionFromEnv: restoreCodexSessionFromEnvMock,
  restoreCodexSession: restoreCodexSessionMock,
  persistRotatedCodexAuth: persistRotatedCodexAuthMock,
}));

// 실행파일 탐지는 머신의 PATH/전역 설치 상태에 좌우되므로 테스트에서 고정한다.
const resolveCodexExecutableMock = vi.fn((override?: string) => override);
vi.mock('../setup/resolve-codex-binary.js', () => ({
  resolveCodexExecutable: (override?: string) => resolveCodexExecutableMock(override),
  tryResolveCodexBinaryPath: vi.fn(),
  resolveCodexBinaryPath: vi.fn(),
}));

const createAppServerSessionMock = vi.fn();
vi.mock('../experimental/codex-app-server-session.js', () => ({
  createExperimentalCodexAppServerSession: (...args: unknown[]) => createAppServerSessionMock(...args),
}));

const { OpenAiSubscriptionRunner } = await import('./openai-subscription.runner.js');

describe('OpenAiSubscriptionRunner', () => {
  beforeEach(() => {
    runMock.mockReset();
    startThreadMock.mockClear();
    codexConstructorMock.mockClear();
    restoreCodexSessionFromEnvMock.mockClear();
    restoreCodexSessionMock.mockClear();
    persistRotatedCodexAuthMock.mockClear();
    resolveCodexExecutableMock.mockClear();
    createAppServerSessionMock.mockReset();
  });

  it('codexPathOverride를 주면 restoreCodexSessionFromEnv와 Codex 생성자 양쪽에 전달한다 (번들된 바이너리로 서버리스 배포하는 시나리오)', () => {
    new OpenAiSubscriptionRunner({ codexPathOverride: '/opt/bundled/codex' });

    expect(restoreCodexSessionFromEnvMock).toHaveBeenCalledWith('/opt/bundled/codex');
    expect(codexConstructorMock).toHaveBeenCalledWith({ codexPathOverride: '/opt/bundled/codex' });
  });

  it('codexPathOverride를 안 주면 Codex 생성자를 빈 옵션으로 부른다 (로컬 개발 기본 동작)', () => {
    new OpenAiSubscriptionRunner();

    expect(restoreCodexSessionFromEnvMock).toHaveBeenCalledWith(undefined);
    expect(codexConstructorMock).toHaveBeenCalledWith({});
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

describe('OpenAiSubscriptionRunner — codexAuthStore (토큰 회전 자동 저장)', () => {
  beforeEach(() => {
    runMock.mockReset();
    startThreadMock.mockClear();
    restoreCodexSessionFromEnvMock.mockClear();
    restoreCodexSessionMock.mockClear();
    persistRotatedCodexAuthMock.mockClear();
  });

  const store = { load: vi.fn(async () => undefined), save: vi.fn(async () => {}) };

  it('store가 있으면 생성 시점에 동기 복원을 하지 않는다 (비동기 조회가 필요하므로 첫 호출로 미룬다)', () => {
    new OpenAiSubscriptionRunner({ codexAuthStore: store });

    expect(restoreCodexSessionFromEnvMock).not.toHaveBeenCalled();
    expect(restoreCodexSessionMock).not.toHaveBeenCalled();
  });

  it('첫 run() 직전에 store로 복원하고, 호출 후 회전분 저장을 시도한다', async () => {
    runMock.mockResolvedValue({ finalResponse: 'ok' });

    const runner = new OpenAiSubscriptionRunner({ codexAuthStore: store });
    await runner.run({ prompt: '질문' });

    expect(restoreCodexSessionMock).toHaveBeenCalledWith(expect.objectContaining({ store }));
    expect(persistRotatedCodexAuthMock).toHaveBeenCalledWith(store);
  });

  it('복원은 여러 번 호출해도 한 번만 수행한다', async () => {
    runMock.mockResolvedValue({ finalResponse: 'ok' });

    const runner = new OpenAiSubscriptionRunner({ codexAuthStore: store });
    await runner.run({ prompt: '1' });
    await runner.run({ prompt: '2' });

    expect(restoreCodexSessionMock).toHaveBeenCalledTimes(1);
    expect(persistRotatedCodexAuthMock).toHaveBeenCalledTimes(2);
  });

  it('호출이 실패해도 회전분 저장은 시도한다 (실패 직전에 토큰이 갱신됐을 수 있다)', async () => {
    runMock.mockRejectedValue(new Error('boom'));

    const runner = new OpenAiSubscriptionRunner({ codexAuthStore: store });
    await expect(runner.run({ prompt: '질문', model: 'gpt-5.6-luna' })).rejects.toThrow();

    expect(persistRotatedCodexAuthMock).toHaveBeenCalledWith(store);
  });
});

describe('OpenAiSubscriptionRunner.createSession — 빠른 경로 실패 시 자동 폴백', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    runMock.mockReset();
    startThreadMock.mockClear();
    createAppServerSessionMock.mockReset();
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('빠른 경로가 되면 그걸 쓰고 공식 SDK Thread는 만들지 않는다', async () => {
    const fastSend = vi.fn(async () => ({ text: '빠른 답', raw: {} }));
    createAppServerSessionMock.mockResolvedValue({ send: fastSend, close: vi.fn() });

    const session = new OpenAiSubscriptionRunner().createSession();
    const result = await session.send('질문');

    expect(result.text).toBe('빠른 답');
    expect(fastSend).toHaveBeenCalledWith('질문');
    expect(startThreadMock).not.toHaveBeenCalled();
  });

  it('빠른 경로 시작이 실패하면 공식 SDK 경로로 자동 전환한다 (예외를 밖으로 던지지 않는다)', async () => {
    createAppServerSessionMock.mockRejectedValue(new Error('app-server 없음'));
    runMock.mockResolvedValue({ finalResponse: '안정 경로 답' });

    const session = new OpenAiSubscriptionRunner().createSession();
    const result = await session.send('질문');

    expect(result.text).toBe('안정 경로 답');
    expect(runMock).toHaveBeenCalledWith('질문');
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('공식 SDK 경로로 전환'));
  });

  it('대화 도중 빠른 경로가 끊기면 지금까지의 맥락을 붙여서 안정 경로로 이어간다', async () => {
    const fastSend = vi
      .fn()
      .mockResolvedValueOnce({ text: '첫 답변', raw: {} })
      .mockRejectedValueOnce(new Error('프로세스 종료됨'));
    createAppServerSessionMock.mockResolvedValue({ send: fastSend, close: vi.fn() });
    runMock.mockResolvedValue({ finalResponse: '복구된 답변' });

    const session = new OpenAiSubscriptionRunner().createSession();
    await session.send('첫 질문');
    const second = await session.send('두번째 질문');

    expect(second.text).toBe('복구된 답변');
    // 끊긴 시점까지의 대화가 복구 프롬프트에 담겨야 맥락이 유지된다.
    const replayPrompt = runMock.mock.calls[0][0] as string;
    expect(replayPrompt).toContain('첫 질문');
    expect(replayPrompt).toContain('첫 답변');
    expect(replayPrompt).toContain('두번째 질문');
  });

  it('전환 이후의 호출에는 맥락을 다시 붙이지 않는다 (Thread가 이미 맥락을 갖고 있다)', async () => {
    const fastSend = vi.fn().mockRejectedValue(new Error('시작 실패'));
    createAppServerSessionMock.mockResolvedValue({ send: fastSend, close: vi.fn() });
    runMock.mockResolvedValue({ finalResponse: 'ok' });

    const session = new OpenAiSubscriptionRunner().createSession();
    await session.send('첫 질문');
    await session.send('두번째 질문');

    expect(runMock.mock.calls[1][0]).toBe('두번째 질문');
  });

  it("fastMode: 'off'면 빠른 경로를 아예 시도하지 않는다", async () => {
    runMock.mockResolvedValue({ finalResponse: 'ok' });

    const session = new OpenAiSubscriptionRunner().createSession({ fastMode: 'off' });
    await session.send('질문');

    expect(createAppServerSessionMock).not.toHaveBeenCalled();
  });

  it('웹 검색이 필요하면 빠른 경로가 지원하지 않으므로 안정 경로만 쓴다', async () => {
    runMock.mockResolvedValue({ finalResponse: 'ok' });

    const session = new OpenAiSubscriptionRunner().createSession({ enableWebSearch: true });
    await session.send('질문');

    expect(createAppServerSessionMock).not.toHaveBeenCalled();
    expect(startThreadMock).toHaveBeenCalledWith(expect.objectContaining({ webSearchEnabled: true }));
  });

  it('close() 이후에는 send()를 막는다', async () => {
    createAppServerSessionMock.mockResolvedValue({ send: vi.fn(), close: vi.fn() });

    const session = new OpenAiSubscriptionRunner().createSession();
    session.close();

    await expect(session.send('질문')).rejects.toThrow(/close\(\)된 세션/);
  });
});

describe('OpenAiSubscriptionRunner.stream', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    runMock.mockReset();
    startThreadMock.mockClear();
    createAppServerSessionMock.mockReset();
    runStreamedMock.mockReset();
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => warnSpy.mockRestore());

  async function* fakeEvents(events: unknown[]) {
    for (const event of events) yield event;
  }

  it('app-server 경로가 되면 글자 단위 증분을 그대로 흘려보낸다', async () => {
    const sendStream = vi.fn(async function* () {
      yield { type: 'text', text: '안' };
      yield { type: 'text', text: '녕' };
      yield { type: 'done', result: { text: '안녕', usage: { outputTokens: 2 } } };
    });
    const close = vi.fn();
    createAppServerSessionMock.mockResolvedValue({ sendStream, close, send: vi.fn() });

    const events = [];
    for await (const event of new OpenAiSubscriptionRunner().stream({ prompt: '질문' })) events.push(event);

    expect(events.filter((e) => e.type === 'text').map((e) => e.text)).toEqual(['안', '녕']);
    expect(startThreadMock).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalled(); // 프로세스를 반드시 정리한다
  });

  it('app-server를 못 띄우면 공식 SDK 경로로 내려앉는다', async () => {
    createAppServerSessionMock.mockRejectedValue(new Error('app-server 없음'));
    runStreamedMock.mockResolvedValue({
      events: fakeEvents([
        { type: 'item.completed', item: { type: 'agent_message', text: '한덩어리' } },
        { type: 'turn.completed', usage: { input_tokens: 1, output_tokens: 2 } },
      ]),
    });

    const events = [];
    for await (const event of new OpenAiSubscriptionRunner().stream({ prompt: '질문' })) events.push(event);

    expect(events).toEqual([
      { type: 'text', text: '한덩어리' },
      {
        type: 'done',
        result: expect.objectContaining({
          text: '한덩어리',
          usage: expect.objectContaining({ inputTokens: 1, outputTokens: 2 }),
        }),
      },
    ]);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('공식 SDK 경로로 전환'));
  });

  it('아무것도 못 내보낸 채 실패하면 폴백하지만, 이미 내보낸 뒤 실패하면 그대로 에러를 올린다 (중복 방지)', async () => {
    const sendStream = vi.fn(async function* () {
      yield { type: 'text', text: '이미나감' };
      throw new Error('중간에 끊김');
    });
    createAppServerSessionMock.mockResolvedValue({ sendStream, close: vi.fn(), send: vi.fn() });

    const events = [];
    await expect(async () => {
      for await (const event of new OpenAiSubscriptionRunner().stream({ prompt: '질문' })) events.push(event);
    }).rejects.toThrow(/중간에 끊김/);

    expect(events).toEqual([{ type: 'text', text: '이미나감' }]);
    expect(runStreamedMock).not.toHaveBeenCalled(); // 폴백해서 처음부터 다시 받지 않는다
  });

  it('웹 검색이 켜져 있으면 app-server를 아예 시도하지 않는다', async () => {
    runStreamedMock.mockResolvedValue({
      events: fakeEvents([{ type: 'item.completed', item: { type: 'agent_message', text: 'ok' } }]),
    });

    for await (const _ of new OpenAiSubscriptionRunner().stream({ prompt: '질문', enableWebSearch: true })) {
      // 소비만 한다
    }

    expect(createAppServerSessionMock).not.toHaveBeenCalled();
  });

  it('SDK 경로는 전체 텍스트가 매번 다시 오므로 늘어난 부분만 증분으로 낸다', async () => {
    createAppServerSessionMock.mockRejectedValue(new Error('없음'));
    runStreamedMock.mockResolvedValue({
      events: fakeEvents([
        { type: 'item.updated', item: { type: 'agent_message', text: '안녕' } },
        { type: 'item.updated', item: { type: 'agent_message', text: '안녕하세' } },
        { type: 'item.completed', item: { type: 'agent_message', text: '안녕하세요' } },
      ]),
    });

    const texts = [];
    for await (const event of new OpenAiSubscriptionRunner().stream({ prompt: '질문' })) {
      if (event.type === 'text') texts.push(event.text);
    }

    expect(texts).toEqual(['안녕', '하세', '요']);
  });
});

describe('OpenAiSubscriptionRunner.runStructured', () => {
  beforeEach(() => {
    runMock.mockReset();
    startThreadMock.mockClear();
  });

  const schema = { type: 'object', properties: { a: { type: 'number' } }, required: ['a'] };

  it('Codex의 outputSchema로 스키마를 직접 강제한다', async () => {
    runMock.mockResolvedValue({ finalResponse: '{"a":1}', usage: null });

    await new OpenAiSubscriptionRunner().runStructured({ prompt: '질문', schema });

    expect(runMock).toHaveBeenCalledWith('질문', { outputSchema: schema });
  });

  it('응답을 파싱해서 data로 주고 사용량도 담는다', async () => {
    runMock.mockResolvedValue({
      finalResponse: '{"a":42}',
      usage: { input_tokens: 5, output_tokens: 6, cached_input_tokens: 1, reasoning_output_tokens: 0 },
    });

    const result = await new OpenAiSubscriptionRunner().runStructured<{ a: number }>({ prompt: '질문', schema });

    expect(result.data).toEqual({ a: 42 });
    expect(result.usage).toEqual(
      expect.objectContaining({ inputTokens: 5, outputTokens: 6, cachedInputTokens: 1 }),
    );
  });

  it('구조화 출력에서도 웹 검색은 켜지 않는다 (스키마 준수가 목적)', async () => {
    runMock.mockResolvedValue({ finalResponse: '{}', usage: null });

    await new OpenAiSubscriptionRunner().runStructured({ prompt: '질문', schema });

    expect(startThreadMock).toHaveBeenCalledWith(expect.objectContaining({ webSearchEnabled: false }));
  });
});

describe('OpenAiSubscriptionRunner 세션 스트리밍 (sendStream)', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    runMock.mockReset();
    startThreadMock.mockClear();
    createAppServerSessionMock.mockReset();
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => warnSpy.mockRestore());

  it('빠른 경로가 되면 글자 단위 증분을 그대로 흘려보낸다', async () => {
    const sendStream = vi.fn(async function* () {
      yield { type: 'text', text: '안' };
      yield { type: 'text', text: '녕' };
      yield { type: 'done', result: { text: '안녕' } };
    });
    createAppServerSessionMock.mockResolvedValue({ sendStream, send: vi.fn(), close: vi.fn() });

    const session = new OpenAiSubscriptionRunner().createSession();
    const texts = [];
    for await (const event of session.sendStream('질문')) {
      if (event.type === 'text') texts.push(event.text);
    }

    expect(texts).toEqual(['안', '녕']);
    expect(startThreadMock).not.toHaveBeenCalled();
  });

  it('빠른 경로를 못 쓰면 공식 SDK로 내려앉아 한 덩어리로 내보낸다 (인터페이스는 동일)', async () => {
    createAppServerSessionMock.mockRejectedValue(new Error('app-server 없음'));
    runMock.mockResolvedValue({ finalResponse: '한덩어리 답변', usage: null });

    const session = new OpenAiSubscriptionRunner().createSession();
    const events = [];
    for await (const event of session.sendStream('질문')) events.push(event);

    expect(events).toEqual([
      { type: 'text', text: '한덩어리 답변' },
      { type: 'done', result: expect.objectContaining({ text: '한덩어리 답변' }) },
    ]);
  });

  it('스트리밍으로 주고받은 내용도 대화 기록에 남아 폴백 시 맥락이 복구된다', async () => {
    const sendStream = vi
      .fn()
      .mockImplementationOnce(async function* () {
        yield { type: 'text', text: '첫 답변' };
        yield { type: 'done', result: { text: '첫 답변' } };
      })
      .mockImplementationOnce(async function* () {
        throw new Error('프로세스 종료됨');
      });
    createAppServerSessionMock.mockResolvedValue({ sendStream, send: vi.fn(), close: vi.fn() });
    runMock.mockResolvedValue({ finalResponse: '복구된 답변', usage: null });

    const session = new OpenAiSubscriptionRunner().createSession();
    for await (const _ of session.sendStream('첫 질문')) {
      // 소비만 한다
    }
    for await (const _ of session.sendStream('두번째 질문')) {
      // 소비만 한다
    }

    const replayPrompt = runMock.mock.calls[0][0] as string;
    expect(replayPrompt).toContain('첫 질문');
    expect(replayPrompt).toContain('첫 답변');
  });

  it('close() 이후에는 sendStream()도 막는다', async () => {
    createAppServerSessionMock.mockResolvedValue({ sendStream: vi.fn(), send: vi.fn(), close: vi.fn() });

    const session = new OpenAiSubscriptionRunner().createSession();
    session.close();

    await expect(async () => {
      for await (const _ of session.sendStream('질문')) {
        // 소비만 한다
      }
    }).rejects.toThrow(/close\(\)된 세션/);
  });
});
