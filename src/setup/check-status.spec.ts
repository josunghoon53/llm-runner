import { vi } from 'vitest';

const isCommandOnPathMock = vi.fn();
const spawnSyncMock = vi.fn();

vi.mock('../ai-cli-check.js', () => ({ isCommandOnPath: isCommandOnPathMock }));
vi.mock('node:child_process', () => ({ spawnSync: spawnSyncMock }));

const { checkClaudeStatus, checkCodexStatus } = await import('./check-status.js');

describe('checkClaudeStatus', () => {
  beforeEach(() => {
    isCommandOnPathMock.mockReset();
    spawnSyncMock.mockReset();
  });

  it('CLI가 없으면 installed: false를 반환하고 상태 조회를 하지 않는다', () => {
    isCommandOnPathMock.mockReturnValue(false);

    const status = checkClaudeStatus();

    expect(status.installed).toBe(false);
    expect(status.loggedIn).toBe(false);
    expect(spawnSyncMock).not.toHaveBeenCalled();
  });

  it('auth status JSON의 loggedIn을 그대로 반영한다', () => {
    isCommandOnPathMock.mockReturnValue(true);
    spawnSyncMock.mockReturnValue({
      status: 0,
      stdout: JSON.stringify({ loggedIn: true, email: 'a@b.com', subscriptionType: 'max' }),
      stderr: '',
    });

    const status = checkClaudeStatus();

    expect(status.installed).toBe(true);
    expect(status.loggedIn).toBe(true);
    expect(status.detail).toBe('a@b.com (max)');
  });

  it('JSON 파싱에 실패하면 미로그인으로 취급한다', () => {
    isCommandOnPathMock.mockReturnValue(true);
    spawnSyncMock.mockReturnValue({ status: 1, stdout: '', stderr: 'error' });

    const status = checkClaudeStatus();

    expect(status.loggedIn).toBe(false);
  });
});

describe('checkCodexStatus', () => {
  beforeEach(() => {
    isCommandOnPathMock.mockReset();
    spawnSyncMock.mockReset();
  });

  it('CLI가 없으면 installed: false를 반환한다', () => {
    isCommandOnPathMock.mockReturnValue(false);

    const status = checkCodexStatus();

    expect(status.installed).toBe(false);
    expect(spawnSyncMock).not.toHaveBeenCalled();
  });

  it('stderr에 출력되는 "Logged in" 메시지도 감지한다', () => {
    isCommandOnPathMock.mockReturnValue(true);
    spawnSyncMock.mockReturnValue({ status: 0, stdout: '', stderr: 'Logged in using ChatGPT\n' });

    const status = checkCodexStatus();

    expect(status.loggedIn).toBe(true);
    expect(status.detail).toContain('Logged in using ChatGPT');
  });

  it('exit code가 0이 아니면 미로그인으로 취급한다', () => {
    isCommandOnPathMock.mockReturnValue(true);
    spawnSyncMock.mockReturnValue({ status: 1, stdout: '', stderr: 'not logged in' });

    const status = checkCodexStatus();

    expect(status.loggedIn).toBe(false);
  });
});
