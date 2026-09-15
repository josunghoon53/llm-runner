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
});
