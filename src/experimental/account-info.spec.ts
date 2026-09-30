import { vi } from 'vitest';

import { EventEmitter } from 'node:events';

const queryMock = vi.fn();
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({ query: (...a: unknown[]) => queryMock(...a) }));

const spawnMock = vi.fn();
vi.mock('node:child_process', () => ({ spawn: (...a: unknown[]) => spawnMock(...a) }));

/** `claude auth status --json` 흉내. json이 undefined면 CLI를 못 쓰는 상황이다. */
function fakeStatusCli(json: unknown | undefined) {
  const child = new EventEmitter() as EventEmitter & Record<string, unknown>;
  child.stdout = new EventEmitter();
  (child.stdout as EventEmitter & { setEncoding?: unknown }).setEncoding = vi.fn();
  child.kill = vi.fn();
  queueMicrotask(() => {
    if (json === undefined) child.emit('error', new Error('spawn claude ENOENT'));
    else {
      (child.stdout as EventEmitter).emit('data', JSON.stringify(json));
      child.emit('exit', 0);
    }
  });
  return child;
}

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

describe('getClaudeAccountInfo — CLI 경로 (기본)', () => {
  beforeEach(() => {
    queryMock.mockReset();
    spawnMock.mockReset();
  });

  // 실측: CLI가 216ms에 필드 10개, SDK는 2,663ms에 5개. CLI를 먼저 쓴다.
  it('auth status --json을 읽어 정규화한다', async () => {
    spawnMock.mockReturnValue(
      fakeStatusCli({
        loggedIn: true,
        email: 'someone@example.com',
        orgName: "someone's Organization",
        orgId: 'org-1',
        subscriptionType: 'max',
        apiProvider: 'firstParty',
        configDirectory: '/home/u/.claude',
      }),
    );

    await expect(getClaudeAccountInfo()).resolves.toEqual({
      available: true,
      email: 'someone@example.com',
      plan: 'max',
      organization: "someone's Organization",
      organizationId: 'org-1',
      authKind: 'firstParty',
      configDirectory: '/home/u/.claude',
    });
    // SDK는 부르지 않았어야 한다 — 느린 경로다.
    expect(queryMock).not.toHaveBeenCalled();
  });

  // SDK 경로는 이메일이 비었는지로 추측해야 했다. CLI는 명시적으로 알려준다.
  it('loggedIn: false를 그대로 반영한다', async () => {
    spawnMock.mockReturnValue(
      fakeStatusCli({ loggedIn: false, apiProvider: 'firstParty', configDirectory: '/tmp/empty' }),
    );

    await expect(getClaudeAccountInfo()).resolves.toEqual({
      available: false,
      authKind: 'firstParty',
      configDirectory: '/tmp/empty',
    });
  });

  it('프로필을 지정하면 병합된 env로 CLI를 띄운다', async () => {
    spawnMock.mockReturnValue(fakeStatusCli({ loggedIn: false }));

    await getClaudeAccountInfo({ claudeConfigDir: '/tmp/work' });

    const [bin, args, opts] = spawnMock.mock.calls[0] as [string, string[], { env?: NodeJS.ProcessEnv }];
    expect(bin).toBe('claude');
    expect(args).toEqual(['auth', 'status', '--json']);
    expect(opts.env?.CLAUDE_CONFIG_DIR).toBe('/tmp/work');
    expect(opts.env?.PATH).toBe(process.env.PATH);
  });
});

describe('getClaudeAccountInfo — SDK 대비책', () => {
  beforeEach(() => {
    queryMock.mockReset();
    spawnMock.mockReset();
  });

  // 옛 CLI에는 --json이 없을 수 있다. 그때 조용히 실패하지 말고 SDK로 넘어가야 한다.
  it('CLI를 못 쓰면 SDK accountInfo()로 넘어간다', async () => {
    spawnMock.mockReturnValue(fakeStatusCli(undefined));
    queryMock.mockReturnValue(
      claudeStream({ email: 'a@b.com', subscriptionType: 'pro', apiProvider: 'firstParty' }),
    );

    await expect(getClaudeAccountInfo()).resolves.toMatchObject({
      available: true,
      email: 'a@b.com',
      plan: 'pro',
    });
    expect(queryMock).toHaveBeenCalled();
  });

  it('SDK도 못 쓰면 던지지 않는다', async () => {
    spawnMock.mockReturnValue(fakeStatusCli(undefined));
    queryMock.mockReturnValue(claudeStream({}, { method: 'somethingElse' }));

    await expect(getClaudeAccountInfo()).resolves.toEqual({ available: false });
  });

  it('대비책도 프롬프트를 보내지 않는다', async () => {
    spawnMock.mockReturnValue(fakeStatusCli(undefined));
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
