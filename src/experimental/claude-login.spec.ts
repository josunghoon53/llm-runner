import { vi } from 'vitest';
import { EventEmitter } from 'node:events';

const spawnMock = vi.fn();
vi.mock('node:child_process', () => ({ spawn: (...a: unknown[]) => spawnMock(...a) }));

const { startClaudeLogin, claudeLogout } = await import('./claude-login.js');

/** claude CLI 흉내. stdout으로 URL을 흘리고 stdin을 받는다. */
function fakeCli() {
  const child = new EventEmitter() as EventEmitter & Record<string, unknown>;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  (child.stdout as EventEmitter & { setEncoding?: unknown }).setEncoding = vi.fn();
  (child.stderr as EventEmitter & { setEncoding?: unknown }).setEncoding = vi.fn();
  (child.stdout as EventEmitter & { off?: unknown }).off = (child.stdout as EventEmitter).removeListener;
  (child.stderr as EventEmitter & { off?: unknown }).off = (child.stderr as EventEmitter).removeListener;
  child.stdin = { write: vi.fn() };
  child.kill = vi.fn(() => {
    (child as { killed: boolean }).killed = true;
  });
  child.killed = false;
  return child;
}

// 실측: CLI가 URL을 OSC 8 하이퍼링크에 싸서 두 번 내보낸다.
const URL_TEXT = 'https://claude.com/cai/oauth/authorize?code=true&client_id=abc&state=xyz';
const OSC8 = `If the browser didn't open, visit: \u001b]8;;${URL_TEXT}\u0007${URL_TEXT}\u001b]8;;\u0007\n`;

describe('startClaudeLogin', () => {
  beforeEach(() => spawnMock.mockReset());

  it('OSC 8 이스케이프를 걷어내고 URL을 뽑는다', async () => {
    const child = fakeCli();
    spawnMock.mockReturnValue(child);

    const promise = startClaudeLogin({ claudeConfigDir: '/tmp/p' });
    (child.stdout as EventEmitter).emit('data', 'Opening browser to sign in…\n');
    (child.stdout as EventEmitter).emit('data', OSC8);

    const login = await promise;
    expect(login.authUrl).toBe(URL_TEXT);
  });

  it('프로필과 로그인 방식을 인자로 넘긴다', async () => {
    const child = fakeCli();
    spawnMock.mockReturnValue(child);

    const promise = startClaudeLogin({ claudeConfigDir: '/tmp/p', email: 'a@b.com' });
    (child.stdout as EventEmitter).emit('data', OSC8);
    await promise;

    const [bin, args, opts] = spawnMock.mock.calls[0] as [string, string[], { env?: NodeJS.ProcessEnv }];
    expect(bin).toBe('claude');
    expect(args).toEqual(['auth', 'login', '--claudeai', '--email', 'a@b.com']);
    expect(opts.env?.CLAUDE_CONFIG_DIR).toBe('/tmp/p');
    // env를 주면 CLI가 process.env를 상속하지 않으므로 병합돼 있어야 한다.
    expect(opts.env?.PATH).toBe(process.env.PATH);
  });

  it('useConsole을 주면 --console로 바꾼다', async () => {
    const child = fakeCli();
    spawnMock.mockReturnValue(child);

    const promise = startClaudeLogin({ useConsole: true });
    (child.stdout as EventEmitter).emit('data', OSC8);
    await promise;

    expect((spawnMock.mock.calls[0] as [string, string[]])[1]).toContain('--console');
  });

  it('붙여넣은 코드를 stdin으로 보낸다', async () => {
    const child = fakeCli();
    spawnMock.mockReturnValue(child);
    const promise = startClaudeLogin();
    (child.stdout as EventEmitter).emit('data', OSC8);
    const login = await promise;

    login.submitCode('  코드123  ');

    expect((child.stdin as { write: ReturnType<typeof vi.fn> }).write).toHaveBeenCalledWith('코드123\n');
  });

  it('정상 종료하면 성공으로 본다', async () => {
    const child = fakeCli();
    spawnMock.mockReturnValue(child);
    const promise = startClaudeLogin();
    (child.stdout as EventEmitter).emit('data', OSC8);
    const login = await promise;

    const done = login.waitForCompletion();
    child.emit('exit', 0);

    await expect(done).resolves.toEqual({ success: true });
  });

  it('실패 종료면 출력 끝부분을 사유에 담는다', async () => {
    const child = fakeCli();
    spawnMock.mockReturnValue(child);
    const promise = startClaudeLogin();
    (child.stdout as EventEmitter).emit('data', OSC8);
    const login = await promise;
    (child.stdout as EventEmitter).emit('data', '인증 코드가 올바르지 않습니다\n');

    const done = login.waitForCompletion();
    child.emit('exit', 1);

    await expect(done).resolves.toMatchObject({ success: false, error: expect.stringContaining('올바르지 않') });
  });

  it('URL이 안 나오면 프로세스를 정리하고 던진다', async () => {
    const child = fakeCli();
    spawnMock.mockReturnValue(child);

    const promise = startClaudeLogin({ urlTimeoutMs: 20 });

    await expect(promise).rejects.toThrow(/URL이/);
    expect(child.kill).toHaveBeenCalled();
  });

  it('실행파일이 없으면 이유를 담아 던진다', async () => {
    const child = fakeCli();
    spawnMock.mockReturnValue(child);

    const promise = startClaudeLogin();
    child.emit('error', new Error('spawn claude ENOENT'));

    await expect(promise).rejects.toThrow(/실행파일을 찾을 수 없다/);
  });
});

describe('claudeLogout', () => {
  beforeEach(() => spawnMock.mockReset());

  it('auth logout을 부르고 성공을 돌려준다', async () => {
    const child = fakeCli();
    spawnMock.mockReturnValue(child);

    const promise = claudeLogout({ claudeConfigDir: '/tmp/p' });
    child.emit('exit', 0);

    await expect(promise).resolves.toEqual({ ok: true });
    expect((spawnMock.mock.calls[0] as [string, string[]])[1]).toEqual(['auth', 'logout']);
  });

  it('실패해도 던지지 않는다', async () => {
    const child = fakeCli();
    spawnMock.mockReturnValue(child);

    const promise = claudeLogout();
    (child.stderr as EventEmitter).emit('data', '로그아웃 실패');
    child.emit('exit', 1);

    await expect(promise).resolves.toMatchObject({ ok: false });
  });
});
