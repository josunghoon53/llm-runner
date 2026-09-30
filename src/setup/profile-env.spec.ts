import { buildProfileEnv, toStringEnv } from './profile-env.js';

describe('buildProfileEnv', () => {
  // 두 SDK 모두 env를 주면 process.env를 '교체'한다. 병합을 빠뜨리면 PATH·HOME이 날아가
  // "바이너리를 못 찾는다"는 엉뚱한 오류가 난다 — 그래서 이 단언이 핵심이다.
  it('process.env를 통째로 물려주고 그 위에 프로필 변수를 얹는다', () => {
    const env = buildProfileEnv({ codexHome: '/tmp/work' }, ['codexHome']);

    expect(env?.CODEX_HOME).toBe('/tmp/work');
    expect(env?.PATH).toBe(process.env.PATH);
    expect(Object.keys(env ?? {}).length).toBeGreaterThan(1);
  });

  it('원본 process.env는 건드리지 않는다', () => {
    const before = process.env.CODEX_HOME;

    buildProfileEnv({ codexHome: '/tmp/work' }, ['codexHome']);

    expect(process.env.CODEX_HOME).toBe(before);
  });

  // 빈 객체를 넘기면 환경이 통째로 비워진다. '넘기지 마라'와 '비워라'를 구분해야 한다.
  it('지정한 프로필이 없으면 undefined를 준다 (빈 객체가 아니라)', () => {
    expect(buildProfileEnv({}, ['codexHome', 'claudeConfigDir'])).toBeUndefined();
  });

  it('요청한 변수만 덮어쓴다', () => {
    const env = buildProfileEnv({ codexHome: '/a', claudeConfigDir: '/b' }, ['claudeConfigDir']);

    expect(env?.CLAUDE_CONFIG_DIR).toBe('/b');
    expect(env?.CODEX_HOME).toBe(process.env.CODEX_HOME);
  });

  it('둘 다 주면 둘 다 얹는다', () => {
    const env = buildProfileEnv({ codexHome: '/a', claudeConfigDir: '/b' }, ['codexHome', 'claudeConfigDir']);

    expect(env).toMatchObject({ CODEX_HOME: '/a', CLAUDE_CONFIG_DIR: '/b' });
  });
});

describe('toStringEnv', () => {
  // Codex SDK는 Record<string, string>만 받는데 process.env에는 undefined 값이 섞일 수 있다.
  it('값이 undefined인 키는 빼고 넘긴다', () => {
    const out = toStringEnv({ A: 'x', B: undefined, C: 'y' });

    expect(out).toEqual({ A: 'x', C: 'y' });
  });

  it('undefined를 넣으면 undefined가 나온다', () => {
    expect(toStringEnv(undefined)).toBeUndefined();
  });
});
