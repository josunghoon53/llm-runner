import { vi } from 'vitest';

const queryMock = vi.fn();
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({ query: (...a: unknown[]) => queryMock(...a) }));

const initialize = vi.fn(async () => {});
const request = vi.fn();
const close = vi.fn();
// 화살표 함수는 new로 못 부른다 — 일반 함수여야 생성자로 쓸 수 있다.
vi.mock('./codex-app-server-session.js', () => ({
  CodexAppServerPeer: function () {
    return { initialize, request, close };
  },
}));

const { getClaudeAccountInfo, getCodexAccountInfo } = await import('./account-info.js');

function claudeStream(info: unknown, opts: { method?: string } = {}) {
  return {
    [opts.method ?? 'accountInfo']: vi.fn(async () => info),
    return: vi.fn(async () => ({ done: true, value: undefined })),
  } as Record<string, unknown>;
}

describe('getClaudeAccountInfo', () => {
  beforeEach(() => queryMock.mockReset());

  it('이메일·플랜·조직·인증종류를 정규화한다', async () => {
    queryMock.mockReturnValue(
      claudeStream({
        email: 'someone@example.com',
        organization: "someone's Organization",
        subscriptionType: 'Claude Max',
        apiProvider: 'firstParty',
      }),
    );

    await expect(getClaudeAccountInfo()).resolves.toEqual({
      available: true,
      email: 'someone@example.com',
      plan: 'Claude Max',
      organization: "someone's Organization",
      authKind: 'firstParty',
    });
  });

  // Bedrock·Vertex는 구독 로그인이 아니라 이메일·플랜이 없다. 인증 종류만 알려준다.
  it('구독이 아닌 인증은 available: false로, 인증 종류만 남긴다', async () => {
    queryMock.mockReturnValue(claudeStream({ apiProvider: 'bedrock' }));

    await expect(getClaudeAccountInfo()).resolves.toEqual({ available: false, authKind: 'bedrock' });
  });

  it('SDK가 accountInfo를 없애면 던지지 않는다', async () => {
    queryMock.mockReturnValue(claudeStream({}, { method: 'somethingElse' }));

    await expect(getClaudeAccountInfo()).resolves.toEqual({ available: false });
  });

  it('붙잡아 둔 세션을 반드시 닫는다', async () => {
    const stream = claudeStream({ email: 'a@b.com', subscriptionType: 'pro' });
    queryMock.mockReturnValue(stream);

    await getClaudeAccountInfo();

    expect(stream.return).toHaveBeenCalled();
  });

  it('프롬프트를 보내지 않는다 (토큰을 쓰지 않아야 한다)', async () => {
    queryMock.mockReturnValue(claudeStream({ email: 'a@b.com', subscriptionType: 'pro' }));

    await getClaudeAccountInfo();

    const passed = queryMock.mock.calls[0][0] as { prompt: AsyncGenerator<unknown> };
    await expect(passed.prompt.next()).resolves.toEqual({ done: true, value: undefined });
  });
});

describe('getCodexAccountInfo', () => {
  beforeEach(() => {
    initialize.mockClear();
    request.mockReset();
    close.mockClear();
  });

  it('chatgpt 계정의 이메일·플랜을 읽는다', async () => {
    request.mockResolvedValue({ account: { type: 'chatgpt', email: 'someone@example.com', planType: 'plus' } });

    await expect(getCodexAccountInfo()).resolves.toEqual({
      available: true,
      email: 'someone@example.com',
      plan: 'plus',
      authKind: 'chatgpt',
    });
    expect(request).toHaveBeenCalledWith('account/read', {});
  });

  it('API 키 계정은 available: false로, 인증 종류만 남긴다', async () => {
    request.mockResolvedValue({ account: { type: 'apiKey' } });

    await expect(getCodexAccountInfo()).resolves.toEqual({ available: false, authKind: 'apiKey' });
  });

  it('로그인이 없으면 available: false', async () => {
    request.mockResolvedValue({ account: null, requiresOpenaiAuth: true });

    await expect(getCodexAccountInfo()).resolves.toEqual({ available: false });
  });

  it('프로토콜이 바뀌어 실패해도 던지지 않고 프로세스를 정리한다', async () => {
    request.mockRejectedValue(new Error('unknown method'));

    await expect(getCodexAccountInfo()).resolves.toEqual({ available: false });
    expect(close).toHaveBeenCalled();
  });
});
