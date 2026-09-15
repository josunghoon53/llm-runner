import { vi } from 'vitest';

const spawnSyncMock = vi.fn();
vi.mock('node:child_process', () => ({ spawnSync: spawnSyncMock }));

const { restoreCodexSessionFromEnv } = await import('./restore-session.js');

describe('restoreCodexSessionFromEnv', () => {
  const originalToken = process.env.CODEX_ACCESS_TOKEN;

  beforeEach(() => {
    spawnSyncMock.mockReset();
  });

  afterEach(() => {
    if (originalToken === undefined) {
      delete process.env.CODEX_ACCESS_TOKEN;
    } else {
      process.env.CODEX_ACCESS_TOKEN = originalToken;
    }
  });

  it('CODEX_ACCESS_TOKEN이 없으면 아무것도 안 하고 false를 반환한다', () => {
    delete process.env.CODEX_ACCESS_TOKEN;

    const result = restoreCodexSessionFromEnv();

    expect(result).toBe(false);
    expect(spawnSyncMock).not.toHaveBeenCalled();
  });

  // 성공 케이스는 모듈 내부 상태(codexRestored)를 true로 메모이즈하므로,
  // 이후 테스트에 영향 없게 실패 케이스를 먼저 검증한다.
  it('로그인 실패하면 예외를 던진다', () => {
    process.env.CODEX_ACCESS_TOKEN = 'expired-token';
    spawnSyncMock.mockReturnValue({ status: 1, stdout: '', stderr: 'invalid token' });

    expect(() => restoreCodexSessionFromEnv()).toThrow(/복원 실패/);
  });

  it('토큰이 있으면 codex login --with-access-token에 stdin으로 주입한다', () => {
    process.env.CODEX_ACCESS_TOKEN = 'fake-token';
    spawnSyncMock.mockReturnValue({ status: 0, stdout: '', stderr: '' });

    const result = restoreCodexSessionFromEnv();

    expect(result).toBe(true);
    expect(spawnSyncMock).toHaveBeenCalledWith(
      'codex',
      ['login', '--with-access-token'],
      expect.objectContaining({ input: 'fake-token' }),
    );
  });
});
