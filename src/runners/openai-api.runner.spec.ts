import { vi } from 'vitest';
import { OPENAI_API_MODELS } from '../constants/ai-models.constants.js';

const createMock = vi.fn();

vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(function OpenAiMock() {
    return { chat: { completions: { create: createMock } } };
  }),
}));

const { OpenAiApiRunner } = await import('./openai-api.runner.js');

describe('OpenAiApiRunner', () => {
  beforeEach(() => {
    createMock.mockReset();
  });

  it('기본 모델로 호출하고 첫 번째 choice의 content를 반환한다', async () => {
    createMock.mockResolvedValue({ choices: [{ message: { content: '답변' } }] });

    const runner = new OpenAiApiRunner();
    const result = await runner.run({ prompt: '질문' });

    expect(result.text).toBe('답변');
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model: OPENAI_API_MODELS.GPT_4O_MINI,
        max_tokens: 1024,
        messages: [{ role: 'user', content: '질문' }],
      }),
    );
  });

  it('system이 있으면 system 메시지를 맨 앞에 추가한다', async () => {
    createMock.mockResolvedValue({ choices: [{ message: { content: 'ok' } }] });

    const runner = new OpenAiApiRunner();
    await runner.run({ prompt: '질문', system: '지시사항' });

    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [
          { role: 'system', content: '지시사항' },
          { role: 'user', content: '질문' },
        ],
      }),
    );
  });

  it('choices가 비어있으면 빈 문자열을 반환한다', async () => {
    createMock.mockResolvedValue({ choices: [] });

    const runner = new OpenAiApiRunner();
    const result = await runner.run({ prompt: '질문' });

    expect(result.text).toBe('');
  });

  it('401 에러는 API 키 발급 안내로 감싸고 원본은 cause로 남긴다', async () => {
    const original = Object.assign(new Error('Incorrect API key'), { status: 401 });
    createMock.mockRejectedValue(original);

    const runner = new OpenAiApiRunner();

    await expect(runner.run({ prompt: '질문' })).rejects.toMatchObject({
      message: expect.stringContaining('platform.openai.com'),
      cause: original,
    });
  });

  it('401이 아닌 에러는 그대로 전파한다', async () => {
    const original = Object.assign(new Error('rate limited'), { status: 429 });
    createMock.mockRejectedValue(original);

    const runner = new OpenAiApiRunner();

    await expect(runner.run({ prompt: '질문' })).rejects.toBe(original);
  });

  it('API 키에 비-ASCII 문자가 섞여 헤더 인코딩 에러(TypeError)가 나면 키 발급 안내로 감싼다', async () => {
    const original = new TypeError(
      'Cannot convert argument to a ByteString because the character at index 7 has a value of 54620 which is greater than 255.',
    );
    createMock.mockRejectedValue(original);

    const runner = new OpenAiApiRunner();

    await expect(runner.run({ prompt: '질문' })).rejects.toMatchObject({
      message: expect.stringContaining('platform.openai.com'),
      cause: original,
    });
  });
});

describe('OpenAiApiRunner.stream', () => {
  beforeEach(() => {
    createMock.mockReset();
  });

  async function* fakeChunks(chunks: unknown[]) {
    for (const chunk of chunks) yield chunk;
  }

  it('delta.content를 증분으로 내보내고 마지막 usage 청크를 done에 담는다', async () => {
    createMock.mockResolvedValue(
      fakeChunks([
        { choices: [{ delta: { content: '안녕' } }] },
        { choices: [{ delta: {} }] },
        { choices: [{ delta: { content: '하세요' } }] },
        { choices: [], usage: { prompt_tokens: 3, completion_tokens: 4 } },
      ]),
    );

    const events = [];
    for await (const event of new OpenAiApiRunner().stream({ prompt: '질문' })) events.push(event);

    expect(events).toEqual([
      { type: 'text', text: '안녕' },
      { type: 'text', text: '하세요' },
      {
        type: 'done',
        result: expect.objectContaining({
          text: '안녕하세요',
          usage: expect.objectContaining({ inputTokens: 3, outputTokens: 4 }),
        }),
      },
    ]);
  });

  it('usage를 받으려면 stream_options.include_usage를 켜서 요청한다', async () => {
    createMock.mockResolvedValue(fakeChunks([{ choices: [], usage: { prompt_tokens: 1, completion_tokens: 1 } }]));

    for await (const _ of new OpenAiApiRunner().stream({ prompt: '질문' })) {
      // 소비만 한다
    }

    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({ stream: true, stream_options: { include_usage: true } }),
    );
  });

  it('usage를 안 주는 경우에도 done은 나오고 usage만 undefined다', async () => {
    createMock.mockResolvedValue(fakeChunks([{ choices: [{ delta: { content: 'x' } }] }]));

    const events = [];
    for await (const event of new OpenAiApiRunner().stream({ prompt: '질문' })) events.push(event);

    const done = events.at(-1);
    expect(done).toMatchObject({ type: 'done', result: { text: 'x' } });
    expect((done as { result: { usage?: unknown } }).result.usage).toBeUndefined();
  });
});

describe('OpenAiApiRunner.runStructured', () => {
  beforeEach(() => {
    createMock.mockReset();
  });

  const schema = { type: 'object', properties: { a: { type: 'number' } }, required: ['a'] };

  it('response_format.json_schema로 스키마를 서버에서 강제한다 (strict)', async () => {
    createMock.mockResolvedValue({
      choices: [{ message: { content: '{"a":1}' } }],
      usage: { prompt_tokens: 2, completion_tokens: 3 },
    });

    await new OpenAiApiRunner().runStructured({ prompt: '질문', schema });

    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        response_format: { type: 'json_schema', json_schema: { name: 'result', schema, strict: true } },
      }),
    );
  });

  it('반환된 JSON 문자열을 파싱해서 data로 준다', async () => {
    createMock.mockResolvedValue({
      choices: [{ message: { content: '{"a":42}' } }],
      usage: { prompt_tokens: 2, completion_tokens: 3 },
    });

    const result = await new OpenAiApiRunner().runStructured<{ a: number }>({ prompt: '질문', schema });

    expect(result.data).toEqual({ a: 42 });
    expect(result.text).toBe('{"a":42}');
    expect(result.usage).toEqual(expect.objectContaining({ inputTokens: 2, outputTokens: 3 }));
  });
});
