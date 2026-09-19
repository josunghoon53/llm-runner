import { vi } from 'vitest';
import { CLAUDE_API_MODELS } from '../constants/ai-models.constants.js';

const createMock = vi.fn();
const streamMock = vi.fn();

vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(function AnthropicMock() {
    return { messages: { create: createMock, stream: streamMock } };
  }),
}));

const { ClaudeApiRunner } = await import('./claude-api.runner.js');

describe('ClaudeApiRunner', () => {
  beforeEach(() => {
    createMock.mockReset();
  });

  it('기본 모델로 호출하고 text 블록만 이어붙여 반환한다', async () => {
    createMock.mockResolvedValue({
      content: [
        { type: 'text', text: '안녕' },
        { type: 'tool_use', id: 'x' },
        { type: 'text', text: '하세요' },
      ],
    });

    const runner = new ClaudeApiRunner();
    const result = await runner.run({ prompt: '질문' });

    expect(result.text).toBe('안녕하세요');
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model: CLAUDE_API_MODELS.SONNET,
        max_tokens: 1024,
        messages: [{ role: 'user', content: '질문' }],
      }),
    );
  });

  it('options.model / maxTokens / system을 그대로 전달한다', async () => {
    createMock.mockResolvedValue({ content: [{ type: 'text', text: 'ok' }] });

    const runner = new ClaudeApiRunner();
    await runner.run({
      prompt: '질문',
      model: CLAUDE_API_MODELS.OPUS,
      maxTokens: 200,
      system: '너는 해적이다',
    });

    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model: CLAUDE_API_MODELS.OPUS,
        max_tokens: 200,
        system: '너는 해적이다',
      }),
    );
  });

  it('생성자 옵션의 defaultModel을 기본 모델로 쓴다', async () => {
    createMock.mockResolvedValue({ content: [{ type: 'text', text: 'ok' }] });

    const runner = new ClaudeApiRunner({ defaultModel: CLAUDE_API_MODELS.HAIKU });
    await runner.run({ prompt: '질문' });

    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({ model: CLAUDE_API_MODELS.HAIKU }),
    );
  });

  it('401 에러는 API 키 발급 안내로 감싸고 원본은 cause로 남긴다', async () => {
    const original = Object.assign(new Error('invalid x-api-key'), { status: 401 });
    createMock.mockRejectedValue(original);

    const runner = new ClaudeApiRunner();

    await expect(runner.run({ prompt: '질문' })).rejects.toMatchObject({
      message: expect.stringContaining('console.anthropic.com'),
      cause: original,
    });
  });

  it('401이 아닌 에러는 그대로 전파한다', async () => {
    const original = Object.assign(new Error('rate limited'), { status: 429 });
    createMock.mockRejectedValue(original);

    const runner = new ClaudeApiRunner();

    await expect(runner.run({ prompt: '질문' })).rejects.toBe(original);
  });

  it('API 키에 비-ASCII 문자가 섞여 헤더 인코딩 에러(TypeError)가 나면 키 발급 안내로 감싼다', async () => {
    const original = new TypeError(
      'Cannot convert argument to a ByteString because the character at index 7 has a value of 54620 which is greater than 255.',
    );
    createMock.mockRejectedValue(original);

    const runner = new ClaudeApiRunner();

    await expect(runner.run({ prompt: '질문' })).rejects.toMatchObject({
      message: expect.stringContaining('console.anthropic.com'),
      cause: original,
    });
  });
});

describe('ClaudeApiRunner.stream', () => {
  beforeEach(() => {
    streamMock.mockReset();
  });

  /** Anthropic SDK의 스트림 객체를 흉내 낸다: async iterable + abort() + finalMessage(). */
  function fakeStream(events: unknown[], finalMessage: unknown) {
    const abort = vi.fn();
    return {
      abort,
      finalMessage: vi.fn(async () => finalMessage),
      async *[Symbol.asyncIterator]() {
        for (const event of events) yield event;
      },
    };
  }

  it('text_delta만 증분으로 내보내고 마지막에 done을 준다', async () => {
    streamMock.mockReturnValue(
      fakeStream(
        [
          { type: 'content_block_delta', delta: { type: 'text_delta', text: '안녕' } },
          { type: 'content_block_delta', delta: { type: 'input_json_delta', partial_json: '{' } },
          { type: 'content_block_delta', delta: { type: 'text_delta', text: '하세요' } },
        ],
        { content: [{ type: 'text', text: '안녕하세요' }], usage: { input_tokens: 5, output_tokens: 7 } },
      ),
    );

    const events = [];
    for await (const event of new ClaudeApiRunner().stream({ prompt: '질문' })) events.push(event);

    expect(events).toEqual([
      { type: 'text', text: '안녕' },
      { type: 'text', text: '하세요' },
      {
        type: 'done',
        result: expect.objectContaining({
          text: '안녕하세요',
          usage: expect.objectContaining({ inputTokens: 5, outputTokens: 7 }),
        }),
      },
    ]);
  });

  it('증분을 다 이어붙이면 done의 전체 텍스트와 같다', async () => {
    streamMock.mockReturnValue(
      fakeStream(
        [
          { type: 'content_block_delta', delta: { type: 'text_delta', text: 'ab' } },
          { type: 'content_block_delta', delta: { type: 'text_delta', text: 'cd' } },
        ],
        { content: [{ type: 'text', text: 'abcd' }], usage: { input_tokens: 1, output_tokens: 2 } },
      ),
    );

    let joined = '';
    let final = '';
    for await (const event of new ClaudeApiRunner().stream({ prompt: '질문' })) {
      if (event.type === 'text') joined += event.text;
      else final = event.result.text;
    }

    expect(joined).toBe(final);
  });

  it('정상 완료했으면 abort()를 부르지 않는다 (부르면 finalMessage가 깨진다)', async () => {
    const stream = fakeStream(
      [{ type: 'content_block_delta', delta: { type: 'text_delta', text: 'x' } }],
      { content: [{ type: 'text', text: 'x' }], usage: { input_tokens: 1, output_tokens: 1 } },
    );
    streamMock.mockReturnValue(stream);

    for await (const _ of new ClaudeApiRunner().stream({ prompt: '질문' })) {
      // 끝까지 소비한다
    }

    expect(stream.abort).not.toHaveBeenCalled();
  });

  it('호출자가 중간에 break하면 abort()로 연결을 끊는다', async () => {
    const stream = fakeStream(
      [
        { type: 'content_block_delta', delta: { type: 'text_delta', text: 'a' } },
        { type: 'content_block_delta', delta: { type: 'text_delta', text: 'b' } },
      ],
      { content: [], usage: { input_tokens: 1, output_tokens: 1 } },
    );
    streamMock.mockReturnValue(stream);

    for await (const event of new ClaudeApiRunner().stream({ prompt: '질문' })) {
      if (event.type === 'text') break;
    }

    expect(stream.abort).toHaveBeenCalled();
  });
});

describe('ClaudeApiRunner.runStructured', () => {
  beforeEach(() => {
    createMock.mockReset();
  });

  const schema = { type: 'object', properties: { a: { type: 'number' } }, required: ['a'] };

  it('스키마를 입력으로 받는 도구를 만들고 그 도구를 반드시 쓰게 강제한다', async () => {
    createMock.mockResolvedValue({
      content: [{ type: 'tool_use', name: 'result', input: { a: 1 } }],
      usage: { input_tokens: 2, output_tokens: 3 },
    });

    await new ClaudeApiRunner().runStructured({ prompt: '질문', schema });

    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        tools: [expect.objectContaining({ name: 'result', input_schema: schema })],
        tool_choice: { type: 'tool', name: 'result' },
      }),
    );
  });

  it('도구 입력을 파싱된 결과로 돌려준다', async () => {
    createMock.mockResolvedValue({
      content: [{ type: 'tool_use', name: 'result', input: { a: 42 } }],
      usage: { input_tokens: 2, output_tokens: 3 },
    });

    const result = await new ClaudeApiRunner().runStructured<{ a: number }>({ prompt: '질문', schema });

    expect(result.data).toEqual({ a: 42 });
    expect(result.usage).toEqual(expect.objectContaining({ inputTokens: 2, outputTokens: 3 }));
  });

  it('schemaName을 주면 도구 이름으로 쓴다', async () => {
    createMock.mockResolvedValue({
      content: [{ type: 'tool_use', name: 'sentiment', input: {} }],
      usage: { input_tokens: 1, output_tokens: 1 },
    });

    await new ClaudeApiRunner().runStructured({ prompt: '질문', schema, schemaName: 'sentiment' });

    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({ tool_choice: { type: 'tool', name: 'sentiment' } }),
    );
  });

  it('모델이 도구를 안 쓰면 다음에 뭘 할지 알려주는 에러를 던진다', async () => {
    createMock.mockResolvedValue({
      content: [{ type: 'text', text: '못하겠어요' }],
      usage: { input_tokens: 1, output_tokens: 1 },
    });

    await expect(new ClaudeApiRunner().runStructured({ prompt: '질문', schema })).rejects.toThrow(
      /도구를 쓰지 않았다/,
    );
  });
});
