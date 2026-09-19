import { vi } from 'vitest';
import { sep } from 'node:path';

// 모듈 해석과 파일시스템을 둘 다 모킹한다. 실제 해석에 맡기면 이 머신에 설치된 @openai/codex가
// 잡혀서 테스트가 개발 환경에 따라 통과했다 말았다 한다(실제로 겪음 — vitest 안에서는
// createRequire의 기준 경로를 바꿔도 프로젝트 node_modules로 해석된다).
const resolveMock = vi.fn<(request: string) => string>();
vi.mock('node:module', () => ({
  createRequire: () => ({ resolve: resolveMock }),
}));

const existsSyncMock = vi.fn<() => boolean>();
const readdirSyncMock = vi.fn();
const readFileSyncMock = vi.fn();
vi.mock('node:fs', () => ({
  existsSync: existsSyncMock,
  readdirSync: readdirSyncMock,
  readFileSync: readFileSyncMock,
}));

const isCommandOnPathMock = vi.fn<() => boolean>();
vi.mock('../ai-cli-check.js', () => ({ isCommandOnPath: isCommandOnPathMock }));

const { resolveCodexBinaryPath, tryResolveCodexBinaryPath, resolveCodexExecutable } = await import(
  './resolve-codex-binary.js'
);

const originalPlatform = process.platform;
const originalArch = process.arch;

function setPlatform(platform: string, arch: string) {
  Object.defineProperty(process, 'platform', { value: platform });
  Object.defineProperty(process, 'arch', { value: arch });
}

/** 모듈 해석 결과를 이름별로 지정한다. 등록 안 된 이름은 설치돼 있지 않은 것으로 친다. */
function installPackages(paths: Record<string, string>) {
  resolveMock.mockImplementation((request: string) => {
    const found = paths[request];
    if (!found) {
      const err = new Error(`Cannot find module '${request}'`) as Error & { code: string };
      err.code = 'MODULE_NOT_FOUND';
      throw err;
    }
    return found;
  });
}

/** 경로 구분자를 통일해서 Windows CI에서도 같은 단언을 쓸 수 있게 한다. */
function normalize(path: string) {
  return path.split(sep).join('/');
}

beforeEach(() => {
  resolveMock.mockReset();
  existsSyncMock.mockReset();
  readdirSyncMock.mockReset();
  readFileSyncMock.mockReset();
  isCommandOnPathMock.mockReset();
  installPackages({});
});

afterEach(() => {
  setPlatform(originalPlatform, originalArch);
});

describe('resolveCodexBinaryPath — @openai/codex가 선언한 값에서 유도하는 경로', () => {
  it('설치된 플랫폼 패키지를 찾고 vendor 디렉터리를 읽어 트리플을 알아낸다', () => {
    setPlatform('linux', 'x64');
    installPackages({
      '@openai/codex/package.json': '/app/node_modules/@openai/codex/package.json',
      '@openai/codex-linux-x64/package.json': '/app/node_modules/@openai/codex-linux-x64/package.json',
    });
    readFileSyncMock.mockReturnValue(
      JSON.stringify({
        optionalDependencies: { '@openai/codex-darwin-arm64': '1', '@openai/codex-linux-x64': '1' },
      }),
    );
    readdirSyncMock.mockReturnValue([{ name: 'x86_64-unknown-linux-musl', isDirectory: () => true }]);

    const result = resolveCodexBinaryPath('/app');

    expect(normalize(result)).toBe(
      '/app/node_modules/@openai/codex-linux-x64/vendor/x86_64-unknown-linux-musl/bin/codex',
    );
  });

  it('업스트림이 트리플 이름을 바꿔도 그대로 따라간다 (하드코딩된 표를 안 쓴다)', () => {
    setPlatform('linux', 'x64');
    installPackages({
      '@openai/codex/package.json': '/app/node_modules/@openai/codex/package.json',
      '@openai/codex-linux-x64/package.json': '/app/node_modules/@openai/codex-linux-x64/package.json',
    });
    readFileSyncMock.mockReturnValue(JSON.stringify({ optionalDependencies: { '@openai/codex-linux-x64': '1' } }));
    readdirSyncMock.mockReturnValue([{ name: 'x86_64-unknown-linux-gnu-v2', isDirectory: () => true }]);

    expect(normalize(resolveCodexBinaryPath('/app'))).toContain('/vendor/x86_64-unknown-linux-gnu-v2/bin/');
  });

  it('Windows에서는 codex.exe를 가리킨다', () => {
    setPlatform('win32', 'x64');
    installPackages({
      '@openai/codex/package.json': '/app/node_modules/@openai/codex/package.json',
      '@openai/codex-win32-x64/package.json': '/app/node_modules/@openai/codex-win32-x64/package.json',
    });
    readFileSyncMock.mockReturnValue(JSON.stringify({ optionalDependencies: { '@openai/codex-win32-x64': '1' } }));
    readdirSyncMock.mockReturnValue([{ name: 'x86_64-pc-windows-msvc', isDirectory: () => true }]);

    expect(normalize(resolveCodexBinaryPath('/app')).endsWith('/bin/codex.exe')).toBe(true);
  });
});

describe('resolveCodexBinaryPath — 정적 표 폴백', () => {
  it('@openai/codex는 없고 플랫폼 패키지만 있으면 표에 적힌 트리플을 쓴다', () => {
    setPlatform('darwin', 'arm64');
    installPackages({
      '@openai/codex-darwin-arm64/package.json': '/app/node_modules/@openai/codex-darwin-arm64/package.json',
    });

    expect(normalize(resolveCodexBinaryPath('/app'))).toBe(
      '/app/node_modules/@openai/codex-darwin-arm64/vendor/aarch64-apple-darwin/bin/codex',
    );
  });

  it('지원하지 않는 플랫폼이면 명확한 에러를 던진다', () => {
    setPlatform('sunos', 'x64');

    expect(() => resolveCodexBinaryPath('/app')).toThrow(/지원하지 않는 플랫폼/);
  });

  it('아무것도 설치돼 있지 않으면 설치 방법을 안내하는 에러를 던진다', () => {
    setPlatform('linux', 'x64');

    expect(() => resolveCodexBinaryPath('/app')).toThrow(/npm install @openai\/codex/);
  });

  it('vendor 구조가 예상과 다르면(트리플이 여러 개) 정적 표로 넘어간다', () => {
    setPlatform('darwin', 'arm64');
    installPackages({
      '@openai/codex/package.json': '/app/node_modules/@openai/codex/package.json',
      '@openai/codex-darwin-arm64/package.json': '/app/node_modules/@openai/codex-darwin-arm64/package.json',
    });
    readFileSyncMock.mockReturnValue(JSON.stringify({ optionalDependencies: { '@openai/codex-darwin-arm64': '1' } }));
    readdirSyncMock.mockReturnValue([
      { name: 'a', isDirectory: () => true },
      { name: 'b', isDirectory: () => true },
    ]);

    expect(normalize(resolveCodexBinaryPath('/app'))).toContain('/vendor/aarch64-apple-darwin/bin/codex');
  });
});

describe('tryResolveCodexBinaryPath', () => {
  it('찾았고 파일도 실제로 있으면 그 경로를 반환한다', () => {
    setPlatform('linux', 'x64');
    installPackages({
      '@openai/codex-linux-x64/package.json': '/app/node_modules/@openai/codex-linux-x64/package.json',
    });
    existsSyncMock.mockReturnValue(true);

    expect(tryResolveCodexBinaryPath('/app')).toBeTruthy();
  });

  it('경로는 나왔지만 파일이 실제로 없으면 undefined다 (배포 도구가 바이너리를 빠뜨린 경우)', () => {
    setPlatform('linux', 'x64');
    installPackages({
      '@openai/codex-linux-x64/package.json': '/app/node_modules/@openai/codex-linux-x64/package.json',
    });
    existsSyncMock.mockReturnValue(false);

    expect(tryResolveCodexBinaryPath('/app')).toBeUndefined();
  });

  it('지원하지 않는 플랫폼이어도 던지지 않고 undefined를 반환한다', () => {
    setPlatform('sunos', 'x64');

    expect(tryResolveCodexBinaryPath('/app')).toBeUndefined();
  });

  it('패키지를 못 찾아도 던지지 않고 undefined를 반환한다', () => {
    setPlatform('linux', 'x64');

    expect(tryResolveCodexBinaryPath('/app')).toBeUndefined();
  });
});

describe('resolveCodexExecutable', () => {
  it('override가 최우선이다', () => {
    isCommandOnPathMock.mockReturnValue(true);

    expect(resolveCodexExecutable('/opt/bundled/codex')).toBe('/opt/bundled/codex');
  });

  it('PATH에 codex가 있으면 undefined를 반환해 SDK 기본 동작에 맡긴다', () => {
    isCommandOnPathMock.mockReturnValue(true);

    expect(resolveCodexExecutable()).toBeUndefined();
  });

  it('PATH에 없으면 번들된 바이너리를 찾아서 쓴다 (서버리스)', () => {
    setPlatform('linux', 'x64');
    isCommandOnPathMock.mockReturnValue(false);
    installPackages({
      '@openai/codex-linux-x64/package.json': '/var/task/node_modules/@openai/codex-linux-x64/package.json',
    });
    existsSyncMock.mockReturnValue(true);

    expect(normalize(resolveCodexExecutable() ?? '')).toContain('/vendor/x86_64-unknown-linux-musl/bin/codex');
  });

  it('PATH에도 없고 번들도 없으면 undefined다 (호출부가 기존 에러 메시지를 내도록)', () => {
    setPlatform('linux', 'x64');
    isCommandOnPathMock.mockReturnValue(false);
    existsSyncMock.mockReturnValue(false);

    expect(resolveCodexExecutable()).toBeUndefined();
  });
});
