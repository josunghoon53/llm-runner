import { vi } from 'vitest';
import { CLAUDE_API_MODELS } from '../constants/ai-models.constants.js';

const createMock = vi.fn();

vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(function AnthropicMock() {
    return { messages: { create: createMock } };
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
