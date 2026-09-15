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
