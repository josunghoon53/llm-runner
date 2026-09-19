import { withLlmRunner } from './next.js';

describe('withLlmRunner', () => {
  it('지정한 라우트에 Claude 플랫폼 바이너리 패턴을 넣는다', () => {
    const config = withLlmRunner({}, { routes: ['/api/ai'], providers: ['claude-subscription'] });
    const includes = config.outputFileTracingIncludes as Record<string, string[]>;

    expect(includes['/api/ai']).toContain('./node_modules/@anthropic-ai/claude-agent-sdk-linux-x64/**');
    expect(includes['/api/ai']?.some((p) => p.includes('@openai/codex'))).toBe(false);
  });

  it('Codex를 지정하면 codex 플랫폼 패키지 패턴도 넣는다', () => {
    const config = withLlmRunner({}, { routes: ['/api/ai'], providers: ['openai-subscription'] });
    const includes = config.outputFileTracingIncludes as Record<string, string[]>;

    expect(includes['/api/ai']).toContain('./node_modules/@openai/codex-linux-x64/**');
  });

  it('라우트를 여러 개 주면 각각에 적용한다', () => {
    const config = withLlmRunner({}, { routes: ['/api/a', '/api/b'], providers: ['claude-subscription'] });
    const includes = config.outputFileTracingIncludes as Record<string, string[]>;

    expect(Object.keys(includes).sort()).toEqual(['/api/a', '/api/b']);
  });

  it('기본 라우트는 /api/** 이다', () => {
    const config = withLlmRunner({}, { providers: ['claude-subscription'] });
    const includes = config.outputFileTracingIncludes as Record<string, string[]>;

    expect(Object.keys(includes)).toEqual(['/api/**']);
  });

  it('기존 outputFileTracingIncludes 설정을 덮어쓰지 않고 합친다', () => {
    const config = withLlmRunner(
      { outputFileTracingIncludes: { '/api/ai': ['./data/**'], '/api/other': ['./x/**'] } },
      { routes: ['/api/ai'], providers: ['claude-subscription'] },
    );
    const includes = config.outputFileTracingIncludes as Record<string, string[]>;

    expect(includes['/api/ai']).toContain('./data/**');
    expect(includes['/api/ai']?.length).toBeGreaterThan(1);
    expect(includes['/api/other']).toEqual(['./x/**']);
  });

  it('기존 Next.js 설정의 다른 옵션은 그대로 보존한다', () => {
    const config = withLlmRunner({ reactStrictMode: true }, { providers: ['claude-subscription'] });

    expect(config.reactStrictMode).toBe(true);
  });

  it('providers가 비어 있으면 설정을 그대로 돌려준다 (API 키만 쓰는 경우)', () => {
    const original = { reactStrictMode: true };
    const config = withLlmRunner(original, { providers: [] });

    expect(config).toEqual(original);
    expect(config.outputFileTracingIncludes).toBeUndefined();
  });

  it('입력 객체를 직접 변경하지 않는다', () => {
    const original: Record<string, unknown> = {};
    withLlmRunner(original, { providers: ['claude-subscription'] });

    expect(original.outputFileTracingIncludes).toBeUndefined();
  });
});
