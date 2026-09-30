import { vi } from 'vitest';

const initialize = vi.fn(async () => {});
const request = vi.fn();
const close = vi.fn();
let notify: ((n: { method: string; params?: unknown }) => void) | undefined;
const onNotification = vi.fn((fn: (n: { method: string; params?: unknown }) => void) => {
  notify = fn;
  return () => {
    notify = undefined;
  };
});
vi.mock('./codex-app-server-session.js', () => ({
  CodexAppServerPeer: function () {
    return { initialize, request, close, onNotification };
  },
}));

const { startCodexLogin, codexLogout } = await import('./codex-login.js');

const OK = { type: 'chatgpt', authUrl: 'https://auth.openai.com/oauth/authorize?x=1', loginId: 'abc-123' };

describe('startCodexLogin', () => {
  beforeEach(() => {
    initialize.mockClear();
    request.mockReset();
    close.mockClear();
    onNotification.mockClear();
    notify = undefined;
  });

  it('authUrl과 loginId를 돌려준다 (브라우저는 호출부가 연다)', async () => {
    request.mockResolvedValue(OK);

    const login = await startCodexLogin({ codexHome: '/tmp/p' });

    expect(login.authUrl).toBe(OK.authUrl);
    expect(login.loginId).toBe('abc-123');
    expect(request).toHaveBeenCalledWith('account/login/start', { type: 'chatgpt' });
  });

  it('완료 알림을 받으면 성공으로 끝나고 세션을 닫는다', async () => {
    request.mockResolvedValue(OK);
    const login = await startCodexLogin();

    const done = login.waitForCompletion();
    notify?.({ method: 'account/login/completed', params: { success: true, loginId: 'abc-123' } });

    await expect(done).resolves.toEqual({ success: true, error: undefined });
    expect(close).toHaveBeenCalled();
  });

  // 같은 프로세스에서 두 프로필에 동시에 로그인할 수 있다 — 남의 완료 알림을 받으면 안 된다.
  it('다른 loginId의 완료 알림은 무시한다', async () => {
    request.mockResolvedValue(OK);
    const login = await startCodexLogin({ timeoutMs: 50 });

    const done = login.waitForCompletion();
    notify?.({ method: 'account/login/completed', params: { success: true, loginId: '다른-로그인' } });

    await expect(done).resolves.toMatchObject({ success: false });
  });

  it('실패 알림의 사유를 그대로 전한다', async () => {
    request.mockResolvedValue(OK);
    const login = await startCodexLogin();

    const done = login.waitForCompletion();
    notify?.({ method: 'account/login/completed', params: { success: false, error: '사용자가 거부함' } });

    await expect(done).resolves.toEqual({ success: false, error: '사용자가 거부함' });
  });

  it('시간이 지나면 던지지 않고 실패로 끝낸다', async () => {
    request.mockResolvedValue(OK);
    const login = await startCodexLogin({ timeoutMs: 30 });

    await expect(login.waitForCompletion()).resolves.toMatchObject({ success: false });
    expect(close).toHaveBeenCalled();
  });

  it('취소하면 cancel 요청을 보내고 세션을 닫는다', async () => {
    request.mockResolvedValue(OK);
    const login = await startCodexLogin();

    await login.cancel();

    expect(request).toHaveBeenCalledWith('account/login/cancel', { loginId: 'abc-123' });
    expect(close).toHaveBeenCalled();
  });

  // CLI가 올라가면서 응답 모양이 바뀔 수 있다. 조용히 망가지지 말고 원인을 알려야 한다.
  it('예상과 다른 응답이면 세션을 닫고 이유를 담아 던진다', async () => {
    request.mockResolvedValue({ type: 'apiKey' });

    await expect(startCodexLogin()).rejects.toThrow(/예상과 다른 응답/);
    expect(close).toHaveBeenCalled();
  });
});

describe('codexLogout', () => {
  beforeEach(() => {
    request.mockReset();
    close.mockClear();
  });

  it('로그아웃 요청을 보내고 세션을 닫는다', async () => {
    request.mockResolvedValue({});

    await expect(codexLogout({ codexHome: '/tmp/p' })).resolves.toEqual({ ok: true });
    expect(request).toHaveBeenCalledWith('account/logout', {});
    expect(close).toHaveBeenCalled();
  });

  it('실패해도 던지지 않고 사유를 돌려준다', async () => {
    request.mockRejectedValue(new Error('연결 끊김'));

    await expect(codexLogout()).resolves.toMatchObject({ ok: false, error: expect.stringContaining('연결 끊김') });
    expect(close).toHaveBeenCalled();
  });
});
