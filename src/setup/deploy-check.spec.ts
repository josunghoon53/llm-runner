import { classifyRoutes, globMatches } from './deploy-check.js';

describe('globMatches', () => {
  it('정확히 일치하는 경로를 매칭한다', () => {
    expect(globMatches('/api/ai', '/api/ai')).toBe(true);
    expect(globMatches('/api/ai', '/api/chat')).toBe(false);
  });

  it('*는 한 구간만 매칭한다 (슬래시를 넘지 않는다)', () => {
    expect(globMatches('/api/*', '/api/ai')).toBe(true);
    expect(globMatches('/api/*', '/api/ai/stream')).toBe(false);
  });

  it('**는 여러 구간을 매칭한다', () => {
    expect(globMatches('/api/**', '/api/ai')).toBe(true);
    expect(globMatches('/api/**', '/api/ai/stream')).toBe(true);
  });

  it('정규식 특수문자가 들어간 경로를 문자 그대로 다룬다', () => {
    expect(globMatches('/api/[id]', '/api/[id]')).toBe(true);
    expect(globMatches('/api/a.b', '/api/axb')).toBe(false);
  });
});

describe('classifyRoutes', () => {
  it('모든 라우트가 설정 범위 안이면 아무 것도 보고하지 않는다', () => {
    const result = classifyRoutes(
      ['/api/**'],
      [
        { route: '/api/ai', usesLlmRunner: true },
        { route: '/api/health', usesLlmRunner: false },
      ],
    );

    expect(result).toEqual({ harmless: [], problems: [] });
  });

  it('llm-runner를 쓰는데 설정에 없으면 문제로 잡는다 (가장 흔한 실수)', () => {
    const result = classifyRoutes(['/api/ai'], [{ route: '/api/chat', usesLlmRunner: true }]);

    expect(result.problems).toEqual(['/api/chat']);
  });

  // 이 동작이 없어서 CI에 넣으면 멀쩡한 빌드가 깨졌다 — 외부 사용자가 지적해서 고친 부분이다.
  it('llm-runner를 안 쓰는 라우트는 설정 밖이어도 문제가 아니다', () => {
    const result = classifyRoutes(['/api/ai'], [{ route: '/api/health', usesLlmRunner: false }]);

    expect(result.problems).toEqual([]);
    expect(result.harmless).toEqual(['/api/health']);
  });

  it('둘이 섞여 있으면 각각으로 가른다', () => {
    const result = classifyRoutes(
      ['/api/ai'],
      [
        { route: '/api/ai', usesLlmRunner: true },
        { route: '/api/health', usesLlmRunner: false },
        { route: '/api/chat', usesLlmRunner: true },
        { route: '/api/ping', usesLlmRunner: false },
      ],
    );

    expect(result.problems).toEqual(['/api/chat']);
    expect(result.harmless).toEqual(['/api/health', '/api/ping']);
  });

  it('여러 패턴 중 하나라도 걸리면 통과시킨다', () => {
    const result = classifyRoutes(
      ['/api/ai', '/api/chat/**'],
      [
        { route: '/api/chat/stream', usesLlmRunner: true },
        { route: '/api/ai', usesLlmRunner: true },
      ],
    );

    expect(result.problems).toEqual([]);
  });
});
