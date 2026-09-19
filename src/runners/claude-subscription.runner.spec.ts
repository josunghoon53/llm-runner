import { vi } from 'vitest';

const queryMock = vi.fn();

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: queryMock,
}));

const { ClaudeSubscriptionRunner } = await import('./claude-subscription.runner.js');

function asyncStream(messages: unknown[]) {
  return {
    [Symbol.asyncIterator]: async function* () {
      for (const message of messages) yield message;
    },
  };
}

describe('ClaudeSubscriptionRunner', () => {
  beforeEach(() => {
    queryMock.mockReset();
  });

  it('success 결과 메시지에서 text를 뽑아 반환한다', async () => {
    queryMock.mockReturnValue(
      asyncStream([{ type: 'result', subtype: 'success', result: '답변' }]),
    );

    const runner = new ClaudeSubscriptionRunner();
    const result = await runner.run({ prompt: '질문' });

    expect(result.text).toBe('답변');
  });

  it('result subtype이 success가 아니면 예외를 던진다', async () => {
    queryMock.mockReturnValue(asyncStream([{ type: 'result', subtype: 'error_max_turns' }]));

    const runner = new ClaudeSubscriptionRunner();

    await expect(runner.run({ prompt: '질문' })).rejects.toThrow(/실행 실패/);
  });

  it('result 메시지 없이 스트림이 끝나면 예외를 던진다', async () => {
    queryMock.mockReturnValue(
      asyncStream([{ type: 'system', subtype: 'init', model: 'claude-sonnet-5' }]),
    );

    const runner = new ClaudeSubscriptionRunner();

    await expect(runner.run({ prompt: '질문' })).rejects.toThrow(/result 메시지 없이/);
  });

  it('enableWebSearch가 false면 모든 도구가 차단된다', async () => {
    queryMock.mockReturnValue(asyncStream([{ type: 'result', subtype: 'success', result: 'ok' }]));

    const runner = new ClaudeSubscriptionRunner();
    await runner.run({ prompt: '질문' });

    const callArg = queryMock.mock.calls[0][0];
    expect(callArg.options.allowedTools).toEqual([]);
    expect(callArg.options.disallowedTools).toContain('WebSearch');
    expect(callArg.options.disallowedTools).toContain('Bash');
  });

  it('enableWebSearch가 true면 WebSearch만 허용된다', async () => {
    queryMock.mockReturnValue(asyncStream([{ type: 'result', subtype: 'success', result: 'ok' }]));

    const runner = new ClaudeSubscriptionRunner();
    await runner.run({ prompt: '질문', enableWebSearch: true });

    const callArg = queryMock.mock.calls[0][0];
    expect(callArg.options.allowedTools).toEqual(['WebSearch']);
    expect(callArg.options.disallowedTools).not.toContain('WebSearch');
  });

  describe('createSession()', () => {
    // 실제 SDK를 흉내낸다: streaming input(비동기 이터러블)으로 들어온 사용자 메시지를
    // 하나씩 소비하면서, 메시지당 result 하나를 즉시 내보낸다 (진짜 SDK처럼 프로세스 하나를
    // 계속 물고 여러 턴을 순서대로 처리하는 것을 흉내냄).
    function mockStreamingSession() {
      const closeFn = vi.fn();
      queryMock.mockImplementation(({ prompt }: { prompt: AsyncIterable<{ message: { content: string } }> }) => {
        const inputIter = prompt[Symbol.asyncIterator]();
        return {
          close: closeFn,
          [Symbol.asyncIterator]() {
            return {
              async next() {
                const { value, done } = await inputIter.next();
                if (done) return { done: true as const, value: undefined };
                return {
                  done: false as const,
                  value: { type: 'result', subtype: 'success', result: `echo:${value.message.content}` },
                };
              },
            };
          },
        };
      });
      return closeFn;
    }

    it('send()를 여러 번 호출하면 순서대로 매칭된 결과를 반환한다', async () => {
      mockStreamingSession();
      const runner = new ClaudeSubscriptionRunner();
      const session = runner.createSession();

      const r1 = await session.send('첫번째');
      const r2 = await session.send('두번째');

      expect(r1.text).toBe('echo:첫번째');
      expect(r2.text).toBe('echo:두번째');
      session.close();
    });

    it('close()를 호출하면 내부 스트림의 close()가 호출되고, 이후 send()는 거부된다', async () => {
      const closeFn = mockStreamingSession();
      const runner = new ClaudeSubscriptionRunner();
      const session = runner.createSession();

      await session.send('한 번');
      session.close();

      expect(closeFn).toHaveBeenCalledOnce();
      await expect(session.send('이건 실패해야 함')).rejects.toThrow(/close\(\)된 세션/);
    });

    it('createSession에 넘긴 system/model 옵션이 query()에 그대로 전달된다', async () => {
      mockStreamingSession();
      const runner = new ClaudeSubscriptionRunner();
      const session = runner.createSession({ system: '너는 해적이다', model: 'opus' });
      await session.send('질문');

      const callArg = queryMock.mock.calls[0][0];
      expect(callArg.options.systemPrompt).toBe('너는 해적이다');
      expect(callArg.options.model).toBe('opus');
      session.close();
    });
  });
});

describe('ClaudeSubscriptionRunner.stream', () => {
  beforeEach(() => {
    queryMock.mockReset();
  });

  function streamWithClose(messages: unknown[]) {
    const close = vi.fn();
    return {
      close,
      [Symbol.asyncIterator]: async function* () {
        for (const message of messages) yield message;
      },
    };
  }

  const successResult = {
    type: 'result',
    subtype: 'success',
    result: '안녕하세요',
    total_cost_usd: 0.0123,
    modelUsage: {
      'claude-sonnet-5': {
        inputTokens: 10,
        outputTokens: 20,
        cacheReadInputTokens: 5,
        thinkingTokens: 2,
        costUSD: 0.0123,
      },
    },
  };

  it('stream_event의 text_delta만 증분으로 내보낸다 (완성 메시지와 중복되면 안 된다)', async () => {
    queryMock.mockReturnValue(
      streamWithClose([
        { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: '안녕' } } },
        { type: 'assistant', message: { content: [{ type: 'text', text: '안녕하세요' }] } },
        { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: '하세요' } } },
        successResult,
      ]),
    );

    const events = [];
    for await (const event of new ClaudeSubscriptionRunner().stream({ prompt: '질문' })) events.push(event);

    expect(events.filter((e) => e.type === 'text').map((e) => e.text)).toEqual(['안녕', '하세요']);
  });

  it('done에 modelUsage 합계와 total_cost_usd를 담는다', async () => {
    queryMock.mockReturnValue(streamWithClose([successResult]));

    const events = [];
    for await (const event of new ClaudeSubscriptionRunner().stream({ prompt: '질문' })) events.push(event);

    expect(events.at(-1)).toEqual({
      type: 'done',
      result: expect.objectContaining({
        text: '안녕하세요',
        usage: {
          inputTokens: 10,
          outputTokens: 20,
          cachedInputTokens: 5,
          reasoningTokens: 2,
          costUsd: 0.0123,
        },
      }),
    });
  });

  it('스트리밍을 켤 때 includePartialMessages를 true로 넘긴다', async () => {
    queryMock.mockReturnValue(streamWithClose([successResult]));

    for await (const _ of new ClaudeSubscriptionRunner().stream({ prompt: '질문' })) {
      // 소비만 한다
    }

    expect(queryMock).toHaveBeenCalledWith(
      expect.objectContaining({ options: expect.objectContaining({ includePartialMessages: true }) }),
    );
  });

  it('run()은 부분 메시지를 요청하지 않는다 (불필요한 오버헤드)', async () => {
    queryMock.mockReturnValue(streamWithClose([successResult]));

    await new ClaudeSubscriptionRunner().run({ prompt: '질문' });

    expect(queryMock).toHaveBeenCalledWith(
      expect.objectContaining({ options: expect.objectContaining({ includePartialMessages: false }) }),
    );
  });

  it('호출자가 중간에 break해도 CLI 프로세스를 정리한다', async () => {
    const stream = streamWithClose([
      { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'a' } } },
      { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'b' } } },
      successResult,
    ]);
    queryMock.mockReturnValue(stream);

    for await (const event of new ClaudeSubscriptionRunner().stream({ prompt: '질문' })) {
      if (event.type === 'text') break;
    }

    expect(stream.close).toHaveBeenCalled();
  });

  it('result 메시지가 실패면 에러를 던진다', async () => {
    queryMock.mockReturnValue(streamWithClose([{ type: 'result', subtype: 'error_max_turns' }]));

    await expect(async () => {
      for await (const _ of new ClaudeSubscriptionRunner().stream({ prompt: '질문' })) {
        // 소비만 한다
      }
    }).rejects.toThrow(/error_max_turns/);
  });
});

describe('ClaudeSubscriptionRunner.runStructured', () => {
  beforeEach(() => {
    queryMock.mockReset();
  });

  const schema = { type: 'object', properties: { a: { type: 'number' } }, required: ['a'] };

  function resultStream(text: string) {
    return {
      close: vi.fn(),
      [Symbol.asyncIterator]: async function* () {
        yield { type: 'result', subtype: 'success', result: text, total_cost_usd: 0.01, modelUsage: {} };
      },
    };
  }

  it('스키마를 강제할 장치가 없으므로 system 지시문으로 넣는다', async () => {
    queryMock.mockReturnValue(resultStream('{"a":1}'));

    await new ClaudeSubscriptionRunner().runStructured({ prompt: '질문', schema });

    const passedSystem = queryMock.mock.calls[0][0].options.systemPrompt as string;
    expect(passedSystem).toContain('JSON Schema');
    expect(passedSystem).toContain('"type": "object"');
  });

  it('호출자가 준 system이 있으면 지시문을 뒤에 덧붙인다 (원래 지시를 덮지 않는다)', async () => {
    queryMock.mockReturnValue(resultStream('{"a":1}'));

    await new ClaudeSubscriptionRunner().runStructured({ prompt: '질문', schema, system: '너는 분석가다' });

    const passedSystem = queryMock.mock.calls[0][0].options.systemPrompt as string;
    expect(passedSystem.startsWith('너는 분석가다')).toBe(true);
    expect(passedSystem).toContain('JSON Schema');
  });

  it('코드펜스를 붙여서 답해도 파싱해낸다 (지시해도 붙이는 경우가 있다)', async () => {
    queryMock.mockReturnValue(resultStream('```json\n{"a":42}\n```'));

    const result = await new ClaudeSubscriptionRunner().runStructured<{ a: number }>({ prompt: '질문', schema });

    expect(result.data).toEqual({ a: 42 });
  });

  it('JSON이 아예 없으면 다른 provider를 권하는 에러를 던진다', async () => {
    queryMock.mockReturnValue(resultStream('죄송하지만 못하겠습니다'));

    await expect(new ClaudeSubscriptionRunner().runStructured({ prompt: '질문', schema })).rejects.toThrow(
      /openai-subscription/,
    );
  });
});

describe('ClaudeSubscriptionRunner 세션 스트리밍 (sendStream)', () => {
  beforeEach(() => {
    queryMock.mockReset();
  });

  /** query()가 돌려주는 스트림을 흉내 내되, 우리가 원할 때 메시지를 밀어 넣을 수 있게 만든다. */
  function controllableStream() {
    const queued: unknown[] = [];
    let wake: (() => void) | undefined;
    let ended = false;
    return {
      close: vi.fn(),
      push(message: unknown) {
        queued.push(message);
        wake?.();
        wake = undefined;
      },
      end() {
        ended = true;
        wake?.();
        wake = undefined;
      },
      [Symbol.asyncIterator]: async function* () {
        while (true) {
          while (queued.length > 0) yield queued.shift();
          if (ended) return;
          await new Promise<void>((resolve) => (wake = resolve));
        }
      },
    };
  }

  it('부분 메시지를 증분으로 흘려보내고 마지막에 done을 준다', async () => {
    const stream = controllableStream();
    queryMock.mockReturnValue(stream);

    // 실제 SDK는 프롬프트(비동기 제너레이터)를 직접 소비한다. 그래야 턴이 "시작됨"으로 표시되고
    // 증분이 그 턴에 귀속된다 — 목이 이걸 안 하면 실제와 다르게 동작한다.
    let promptIterator: AsyncIterator<unknown> | undefined;
    queryMock.mockImplementation((args: { prompt: AsyncIterable<unknown> }) => {
      promptIterator = args.prompt[Symbol.asyncIterator]();
      return stream;
    });

    const session = new ClaudeSubscriptionRunner().createSession();
    const received: unknown[] = [];

    const consumed = (async () => {
      for await (const event of session.sendStream('질문')) received.push(event);
    })();

    // SDK가 사용자 메시지를 꺼내가는 동작을 재현한다.
    await new Promise((r) => setImmediate(r));
    await promptIterator!.next();
    await new Promise((r) => setImmediate(r));
    stream.push({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: '안녕' } } });
    stream.push({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: '하세요' } } });
    stream.push({ type: 'result', subtype: 'success', result: '안녕하세요', total_cost_usd: 0.01, modelUsage: {} });
    await consumed;

    expect(received).toEqual([
      { type: 'text', text: '안녕' },
      { type: 'text', text: '하세요' },
      { type: 'done', result: expect.objectContaining({ text: '안녕하세요' }) },
    ]);
    session.close();
  });

  it('세션은 항상 부분 메시지를 켜서 만든다 (나중에 켤 수 없기 때문)', () => {
    queryMock.mockReturnValue(controllableStream());

    new ClaudeSubscriptionRunner().createSession();

    expect(queryMock).toHaveBeenCalledWith(
      expect.objectContaining({ options: expect.objectContaining({ includePartialMessages: true }) }),
    );
  });

  it('턴이 실패하면 스트림도 에러를 던진다', async () => {
    const stream = controllableStream();
    queryMock.mockReturnValue(stream);

    const session = new ClaudeSubscriptionRunner().createSession();
    const consumed = (async () => {
      for await (const _ of session.sendStream('질문')) {
        // 소비만 한다
      }
    })();

    await new Promise((r) => setImmediate(r));
    stream.push({ type: 'result', subtype: 'error_max_turns' });

    await expect(consumed).rejects.toThrow(/error_max_turns/);
    session.close();
  });
});

describe('ClaudeSubscriptionRunner 세션의 usage는 턴별 값이다 (누적값이 아니라)', () => {
  beforeEach(() => {
    queryMock.mockReset();
  });

  function sessionStream() {
    const queued: unknown[] = [];
    let wake: (() => void) | undefined;
    return {
      close: vi.fn(),
      push(message: unknown) {
        queued.push(message);
        wake?.();
        wake = undefined;
      },
      [Symbol.asyncIterator]: async function* () {
        while (true) {
          while (queued.length > 0) yield queued.shift();
          await new Promise<void>((resolve) => (wake = resolve));
        }
      },
    };
  }

  const cumulativeResult = (input: number, output: number, cost: number) => ({
    type: 'result',
    subtype: 'success',
    result: 'ok',
    total_cost_usd: cost,
    modelUsage: { 'claude-sonnet-5': { inputTokens: input, outputTokens: output, cacheReadInputTokens: 0, costUSD: cost } },
  });

  it('SDK가 누적값을 줘도 각 턴에는 그 턴 몫만 담아서 돌려준다', async () => {
    const stream = sessionStream();
    queryMock.mockReturnValue(stream);
    const session = new ClaudeSubscriptionRunner().createSession();

    const first = session.send('1');
    await new Promise((r) => setImmediate(r));
    stream.push(cumulativeResult(100, 50, 0.01));
    expect((await first).usage).toEqual(expect.objectContaining({ inputTokens: 100, outputTokens: 50, costUsd: 0.01 }));

    const second = session.send('2');
    await new Promise((r) => setImmediate(r));
    // SDK는 누적으로 보고한다: 두 번째 턴 시점의 총합
    stream.push(cumulativeResult(260, 130, 0.03));
    expect((await second).usage).toEqual(
      expect.objectContaining({ inputTokens: 160, outputTokens: 80, costUsd: expect.closeTo(0.02, 5) }),
    );

    session.close();
  });

  it('누적값이 줄어드는 이상한 경우에도 음수를 내보내지 않는다', async () => {
    const stream = sessionStream();
    queryMock.mockReturnValue(stream);
    const session = new ClaudeSubscriptionRunner().createSession();

    const first = session.send('1');
    await new Promise((r) => setImmediate(r));
    stream.push(cumulativeResult(100, 50, 0.01));
    await first;

    const second = session.send('2');
    await new Promise((r) => setImmediate(r));
    stream.push(cumulativeResult(10, 5, 0.001)); // 세션 리셋 등으로 줄어든 상황
    expect((await second).usage).toEqual(expect.objectContaining({ inputTokens: 0, outputTokens: 0 }));

    session.close();
  });
});
