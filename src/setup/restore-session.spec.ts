import { vi } from 'vitest';

const spawnSyncMock = vi.fn();
vi.mock('node:child_process', () => ({ spawnSync: spawnSyncMock }));

const mkdirSyncMock = vi.fn();
const writeFileSyncMock = vi.fn();
const readFileSyncMock = vi.fn();
vi.mock('node:fs', () => ({
  mkdirSync: mkdirSyncMock,
  writeFileSync: writeFileSyncMock,
  readFileSync: readFileSyncMock,
}));

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

describe('restoreCodexSessionFromEnv — CODEX_AUTH_JSON (개인 계정용)', () => {
  const originalAuthJson = process.env.CODEX_AUTH_JSON;
  const originalCodexHome = process.env.CODEX_HOME;

  afterEach(() => {
    if (originalAuthJson === undefined) delete process.env.CODEX_AUTH_JSON;
    else process.env.CODEX_AUTH_JSON = originalAuthJson;
    if (originalCodexHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = originalCodexHome;
  });

  it('CODEX_AUTH_JSON이 있으면 codex login을 spawn하지 않고 auth.json 파일만 쓴다', async () => {
    vi.resetModules();
    spawnSyncMock.mockReset();
    mkdirSyncMock.mockReset();
    writeFileSyncMock.mockReset();
    const { restoreCodexSessionFromEnv: freshRestore } = await import('./restore-session.js');

    const fakeAuthJson = JSON.stringify({ auth_mode: 'chatgpt', tokens: { access_token: 'a' } });
    process.env.CODEX_AUTH_JSON = Buffer.from(fakeAuthJson).toString('base64');
    delete process.env.CODEX_HOME;

    const result = freshRestore();

    expect(result).toBe(true);
    expect(spawnSyncMock).not.toHaveBeenCalled();
    expect(mkdirSyncMock).toHaveBeenCalledOnce();
    expect(writeFileSyncMock).toHaveBeenCalledWith(
      expect.stringContaining('auth.json'),
      fakeAuthJson,
      expect.objectContaining({ mode: 0o600 }),
    );
    expect(process.env.CODEX_HOME).toBeTruthy();
  });

  it('CODEX_HOME이 이미 지정돼 있으면 그 경로를 그대로 쓴다', async () => {
    vi.resetModules();
    mkdirSyncMock.mockReset();
    writeFileSyncMock.mockReset();
    const { restoreCodexSessionFromEnv: freshRestore } = await import('./restore-session.js');

    process.env.CODEX_AUTH_JSON = Buffer.from('{"tokens":{"access_token":"a"}}').toString('base64');
    process.env.CODEX_HOME = '/custom/codex/home';

    freshRestore();

    expect(writeFileSyncMock).toHaveBeenCalledWith(
      '/custom/codex/home/auth.json',
      '{"tokens":{"access_token":"a"}}',
      expect.anything(),
    );
  });

  it('CODEX_AUTH_JSON이 base64/JSON으로 깨져있으면 명확한 에러를 던진다', async () => {
    vi.resetModules();
    const { restoreCodexSessionFromEnv: freshRestore } = await import('./restore-session.js');

    process.env.CODEX_AUTH_JSON = Buffer.from('이건 JSON이 아니다').toString('base64');

    expect(() => freshRestore()).toThrow(/올바른 base64\/JSON이 아니다/);
  });

  it('CODEX_AUTH_JSON이 있으면 CODEX_ACCESS_TOKEN보다 우선한다', async () => {
    vi.resetModules();
    spawnSyncMock.mockReset();
    const { restoreCodexSessionFromEnv: freshRestore } = await import('./restore-session.js');

    process.env.CODEX_AUTH_JSON = Buffer.from('{"tokens":{"access_token":"a"}}').toString('base64');
    process.env.CODEX_ACCESS_TOKEN = 'should-be-ignored';

    freshRestore();

    expect(spawnSyncMock).not.toHaveBeenCalled();
    delete process.env.CODEX_ACCESS_TOKEN;
  });
});

describe('restoreCodexSessionFromEnv(codexPathOverride)', () => {
  const originalToken = process.env.CODEX_ACCESS_TOKEN;

  afterEach(() => {
    if (originalToken === undefined) delete process.env.CODEX_ACCESS_TOKEN;
    else process.env.CODEX_ACCESS_TOKEN = originalToken;
  });

  it('codexPathOverride를 주면 그 경로로 spawnSync한다 (번들된 바이너리를 쓰는 서버리스 시나리오)', async () => {
    // 모듈 내부 codexRestored 메모이즈 상태를 새로 시작하기 위해 모듈을 리셋하고 새로 import한다.
    vi.resetModules();
    spawnSyncMock.mockReset();
    const { restoreCodexSessionFromEnv: freshRestore } = await import('./restore-session.js');
    process.env.CODEX_ACCESS_TOKEN = 'fake-token';
    spawnSyncMock.mockReturnValue({ status: 0, stdout: '', stderr: '' });

    freshRestore('/opt/bundled/codex');

    expect(spawnSyncMock).toHaveBeenCalledWith(
      '/opt/bundled/codex',
      ['login', '--with-access-token'],
      expect.objectContaining({ input: 'fake-token' }),
    );
  });
});

describe('getRefreshedCodexAuthJson', () => {
  const originalAuthJson = process.env.CODEX_AUTH_JSON;
  const originalCodexHome = process.env.CODEX_HOME;

  afterEach(() => {
    if (originalAuthJson === undefined) delete process.env.CODEX_AUTH_JSON;
    else process.env.CODEX_AUTH_JSON = originalAuthJson;
    if (originalCodexHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = originalCodexHome;
  });

  it('CODEX_AUTH_JSON으로 복원한 적이 없으면 undefined를 반환한다', async () => {
    vi.resetModules();
    const { getRefreshedCodexAuthJson: freshGet } = await import('./restore-session.js');

    expect(freshGet()).toBeUndefined();
  });

  it('복원 이후 현재 auth.json 내용을 다시 읽어서 base64로 반환한다 (토큰 갱신을 반영해 재저장할 수 있게)', async () => {
    vi.resetModules();
    mkdirSyncMock.mockReset();
    writeFileSyncMock.mockReset();
    readFileSyncMock.mockReset();
    const { restoreCodexSessionFromEnv: freshRestore, getRefreshedCodexAuthJson: freshGet } = await import(
      './restore-session.js'
    );

    process.env.CODEX_AUTH_JSON = Buffer.from('{"tokens":{"access_token":"original"}}').toString('base64');
    delete process.env.CODEX_HOME;
    freshRestore();

    // codex CLI가 그 사이 파일을 갱신했다고 가정한다 (access_token/refresh_token 로테이션).
    readFileSyncMock.mockReturnValue('{"original":true,"tokens":{"access_token":"refreshed"}}');

    const result = freshGet();

    expect(result).toBe(Buffer.from('{"original":true,"tokens":{"access_token":"refreshed"}}').toString('base64'));
    expect(readFileSyncMock).toHaveBeenCalledWith(expect.stringContaining('auth.json'), 'utf-8');
  });

  it('파일을 못 읽으면(삭제됨 등) undefined를 반환한다', async () => {
    vi.resetModules();
    const { restoreCodexSessionFromEnv: freshRestore, getRefreshedCodexAuthJson: freshGet } = await import(
      './restore-session.js'
    );

    process.env.CODEX_AUTH_JSON = Buffer.from('{"tokens":{"access_token":"a"}}').toString('base64');
    freshRestore();
    readFileSyncMock.mockImplementation(() => {
      throw new Error('ENOENT');
    });

    expect(freshGet()).toBeUndefined();
  });
});

describe('restoreCodexSession — codexAuthStore', () => {
  const validAuth = Buffer.from(JSON.stringify({ tokens: { access_token: 'a' } }), 'utf-8').toString('base64');

  beforeEach(() => {
    spawnSyncMock.mockReset();
    mkdirSyncMock.mockClear();
    writeFileSyncMock.mockClear();
    readFileSyncMock.mockReset();
    delete process.env.CODEX_AUTH_JSON;
    delete process.env.CODEX_ACCESS_TOKEN;
  });

  async function freshModule() {
    vi.resetModules();
    const mod = await import('./restore-session.js');
    mod.__resetCodexRestoreStateForTests();
    return mod;
  }

  it('store에 값이 있으면 그 값으로 복원하고 환경변수는 쳐다보지 않는다', async () => {
    const mod = await freshModule();
    const otherValue = Buffer.from(JSON.stringify({ tokens: { access_token: 'env' } }), 'utf-8').toString('base64');
    process.env.CODEX_AUTH_JSON = otherValue;
    const store = { load: vi.fn(async () => validAuth), save: vi.fn(async () => {}) };

    const result = await mod.restoreCodexSession({ store });

    expect(result).toBe(true);
    expect(writeFileSyncMock).toHaveBeenCalledWith(
      expect.stringContaining('auth.json'),
      JSON.stringify({ tokens: { access_token: 'a' } }),
      { mode: 0o600 },
    );
    // store가 원본이므로 다시 저장할 필요가 없다.
    expect(store.save).not.toHaveBeenCalled();
  });

  it('store가 비어 있으면 환경변수로 복원하고 그 값을 store에 심어둔다(seed)', async () => {
    const mod = await freshModule();
    process.env.CODEX_AUTH_JSON = validAuth;
    const store = { load: vi.fn(async () => undefined), save: vi.fn(async () => {}) };

    const result = await mod.restoreCodexSession({ store });

    expect(result).toBe(true);
    expect(store.save).toHaveBeenCalledWith(validAuth);
  });

  it('store도 환경변수도 없으면 기존 동작으로 떨어진다(false)', async () => {
    const mod = await freshModule();
    const store = { load: vi.fn(async () => undefined), save: vi.fn(async () => {}) };

    const result = await mod.restoreCodexSession({ store });

    expect(result).toBe(false);
  });
});

describe('persistRotatedCodexAuth', () => {
  const authContent = JSON.stringify({ tokens: { access_token: 'first' } });

  beforeEach(() => {
    mkdirSyncMock.mockClear();
    writeFileSyncMock.mockClear();
    readFileSyncMock.mockReset();
    delete process.env.CODEX_AUTH_JSON;
  });

  async function restoredModule() {
    vi.resetModules();
    const mod = await import('./restore-session.js');
    mod.__resetCodexRestoreStateForTests();
    process.env.CODEX_AUTH_JSON = Buffer.from(authContent, 'utf-8').toString('base64');
    const store = { load: vi.fn(async () => undefined), save: vi.fn(async () => {}) };
    await mod.restoreCodexSession({ store });
    store.save.mockClear();
    return { mod, store };
  }

  it('auth.json이 그대로면 저장하지 않는다', async () => {
    const { mod, store } = await restoredModule();
    readFileSyncMock.mockReturnValue(authContent);

    const changed = await mod.persistRotatedCodexAuth(store);

    expect(changed).toBe(false);
    expect(store.save).not.toHaveBeenCalled();
  });

  it('auth.json이 바뀌었으면(토큰 회전) 새 값을 저장한다', async () => {
    const { mod, store } = await restoredModule();
    const rotated = JSON.stringify({ tokens: { access_token: 'rotated' } });
    readFileSyncMock.mockReturnValue(rotated);

    const changed = await mod.persistRotatedCodexAuth(store);

    expect(changed).toBe(true);
    // 조건부 쓰기(CAS)를 걸 수 있게, 직전에 알고 있던 값도 함께 넘겨야 한다.
    expect(store.save).toHaveBeenCalledWith(
      Buffer.from(rotated, 'utf-8').toString('base64'),
      { previous: Buffer.from(authContent, 'utf-8').toString('base64') },
    );
  });

  it('같은 회전분을 두 번 저장하지 않는다', async () => {
    const { mod, store } = await restoredModule();
    readFileSyncMock.mockReturnValue(JSON.stringify({ tokens: { access_token: 'rotated' } }));

    await mod.persistRotatedCodexAuth(store);
    const secondCall = await mod.persistRotatedCodexAuth(store);

    expect(secondCall).toBe(false);
    expect(store.save).toHaveBeenCalledTimes(1);
  });

  it('store 저장이 실패해도 예외를 던지지 않는다 (이미 성공한 AI 호출을 망치면 안 된다)', async () => {
    const { mod } = await restoredModule();
    readFileSyncMock.mockReturnValue(JSON.stringify({ tokens: { access_token: 'rotated' } }));
    const failingStore = {
      load: vi.fn(async () => undefined),
      save: vi.fn(async () => {
        throw new Error('KV 장애');
      }),
    };
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      await expect(mod.persistRotatedCodexAuth(failingStore)).resolves.toBe(false);
      expect(warnSpy).toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });
});

describe('checkCodexAuthFreshness', () => {
  beforeEach(() => {
    readFileSyncMock.mockReset();
  });

  function authWithExpiry(secondsFromNow: number): string {
    const payload = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + secondsFromNow })).toString(
      'base64url',
    );
    return JSON.stringify({
      tokens: { access_token: `header.${payload}.signature` },
      last_refresh: '2026-01-01T00:00:00.000Z',
    });
  }

  it('파일을 못 읽으면 readable: false를 반환한다', async () => {
    vi.resetModules();
    const mod = await import('./restore-session.js');
    mod.__resetCodexRestoreStateForTests();
    readFileSyncMock.mockImplementation(() => {
      throw new Error('ENOENT');
    });

    expect(mod.checkCodexAuthFreshness().readable).toBe(false);
  });

  it('아직 유효하면 만료까지 남은 시간을 알려준다', async () => {
    vi.resetModules();
    const mod = await import('./restore-session.js');
    mod.__resetCodexRestoreStateForTests();
    readFileSyncMock.mockReturnValue(authWithExpiry(7200));

    const freshness = mod.checkCodexAuthFreshness();

    expect(freshness.accessTokenExpired).toBe(false);
    expect(freshness.summary).toContain('2시간');
    expect(freshness.lastRefreshAt?.toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });

  it('이미 만료됐으면 회전 위험을 경고하고 store 설정을 권한다', async () => {
    vi.resetModules();
    const mod = await import('./restore-session.js');
    mod.__resetCodexRestoreStateForTests();
    readFileSyncMock.mockReturnValue(authWithExpiry(-60));

    const freshness = mod.checkCodexAuthFreshness();

    expect(freshness.accessTokenExpired).toBe(true);
    expect(freshness.summary).toContain('codexAuthStore');
  });

  it('토큰 값 자체는 절대 반환하지 않는다', async () => {
    vi.resetModules();
    const mod = await import('./restore-session.js');
    mod.__resetCodexRestoreStateForTests();
    readFileSyncMock.mockReturnValue(authWithExpiry(3600));

    const serialized = JSON.stringify(mod.checkCodexAuthFreshness());

    expect(serialized).not.toContain('signature');
    expect(serialized).not.toContain('header.');
  });
});

describe('persistRotatedCodexAuth — 동시 호출 (서버에서 요청이 겹칠 때)', () => {
  const authContent = JSON.stringify({ tokens: { access_token: 'first' } });

  beforeEach(() => {
    mkdirSyncMock.mockClear();
    writeFileSyncMock.mockClear();
    readFileSyncMock.mockReset();
    delete process.env.CODEX_AUTH_JSON;
  });

  async function restored() {
    vi.resetModules();
    const mod = await import('./restore-session.js');
    mod.__resetCodexRestoreStateForTests();
    process.env.CODEX_AUTH_JSON = Buffer.from(authContent, 'utf-8').toString('base64');
    const store = {
      load: vi.fn(async () => undefined),
      // 저장이 느린 저장소(네트워크 KV 등)를 흉내 낸다 — 경쟁은 이 지연 구간에서 생긴다.
      save: vi.fn(async () => {
        await new Promise((r) => setTimeout(r, 20));
      }),
    };
    await mod.restoreCodexSession({ store });
    store.save.mockClear();
    return { mod, store };
  }

  it('같은 갱신에 대해 동시에 여러 번 불려도 한 번만 저장한다', async () => {
    const { mod, store } = await restored();
    readFileSyncMock.mockReturnValue(JSON.stringify({ tokens: { access_token: 'rotated' } }));

    // 동시에 들어온 요청 5개가 각자 호출 직후 저장을 시도하는 상황
    const results = await Promise.all([1, 2, 3, 4, 5].map(() => mod.persistRotatedCodexAuth(store)));

    expect(store.save).toHaveBeenCalledTimes(1);
    expect(results.filter(Boolean)).toHaveLength(1); // 실제로 저장한 건 하나뿐
  });

  it('직렬화된 뒤에도 이후의 진짜 갱신은 정상적으로 저장한다', async () => {
    const { mod, store } = await restored();
    readFileSyncMock.mockReturnValue(JSON.stringify({ tokens: { access_token: 'rotated-1' } }));
    await Promise.all([mod.persistRotatedCodexAuth(store), mod.persistRotatedCodexAuth(store)]);

    readFileSyncMock.mockReturnValue(JSON.stringify({ tokens: { access_token: 'rotated-2' } }));
    await expect(mod.persistRotatedCodexAuth(store)).resolves.toBe(true);

    expect(store.save).toHaveBeenCalledTimes(2);
  });
});
