import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isCommandOnPath } from '../ai-cli-check.js';

/**
 * `@openai/codex`의 `bin/codex.js`가 내부적으로 쓰는 것과 동일한 플랫폼→패키지 매핑이다
 * (그 파일을 직접 읽어서 확인함). 여기서 재구현하는 이유는 우리가 `codex.js` 셸 스크립트를
 * 거치지 않고 네이티브 바이너리 경로를 직접 알아내야 하기 때문이다(서버리스에서
 * `codexPathOverride`로 지정하려면 실제 실행파일 경로가 필요하다).
 */
const TARGET_TRIPLE_BY_PLATFORM: Record<string, Record<string, string>> = {
  linux: { x64: 'x86_64-unknown-linux-musl', arm64: 'aarch64-unknown-linux-musl' },
  darwin: { x64: 'x86_64-apple-darwin', arm64: 'aarch64-apple-darwin' },
  win32: { x64: 'x86_64-pc-windows-msvc', arm64: 'aarch64-pc-windows-msvc' },
};

const PLATFORM_PACKAGE_BY_TARGET: Record<string, string> = {
  'x86_64-unknown-linux-musl': '@openai/codex-linux-x64',
  'aarch64-unknown-linux-musl': '@openai/codex-linux-arm64',
  'x86_64-apple-darwin': '@openai/codex-darwin-x64',
  'aarch64-apple-darwin': '@openai/codex-darwin-arm64',
  'x86_64-pc-windows-msvc': '@openai/codex-win32-x64',
  'aarch64-pc-windows-msvc': '@openai/codex-win32-arm64',
};

/**
 * `npm install @openai/codex`로 설치된 플랫폼별 네이티브 `codex` 실행파일의 실제 경로를 찾는다.
 * `process.cwd() + 'node_modules/...'`처럼 직접 경로를 하드코딩하지 않고 `require.resolve`로
 * 찾기 때문에, pnpm/모노레포처럼 `node_modules`가 평평하지 않은 구조에서도 동작한다.
 *
 * `createAiRunner({ provider: 'openai-subscription', codexPathOverride })`나
 * `createExperimentalCodexAppServerSession({ codexPathOverride })`에 그대로 넘기면 된다 —
 * Vercel 등 서버리스에 Codex 구독을 배포할 때 필요하다 (README "Codex" 섹션 참고).
 *
 * @param fromPath 탐색을 시작할 기준 경로. 기본값은 `process.cwd()`.
 */
export function resolveCodexBinaryPath(fromPath: string = process.cwd()): string {
  const require = createRequire(join(fromPath, 'package.json'));
  const binaryName = process.platform === 'win32' ? 'codex.exe' : 'codex';

  // 1순위: `@openai/codex`가 스스로 선언한 optionalDependencies에서 설치된 플랫폼 패키지를 찾고,
  // 그 안의 vendor 디렉터리를 실제로 읽어서 타깃 트리플을 알아낸다. 아래 하드코딩된 표와 달리
  // 업스트림이 패키지명이나 트리플을 바꿔도 따라간다.
  const discovered = discoverInstalledPlatformPackage(require);
  if (discovered) {
    return join(discovered.packageDir, 'vendor', discovered.triple, 'bin', binaryName);
  }

  // 2순위: `@openai/codex` 자체는 없고 플랫폼 패키지만 설치된 경우를 위한 정적 표.
  const triple = TARGET_TRIPLE_BY_PLATFORM[process.platform]?.[process.arch];
  if (!triple) {
    throw new Error(
      `[llm-runner] resolveCodexBinaryPath: 지원하지 않는 플랫폼이다 (${process.platform}-${process.arch}).`,
    );
  }

  const platformPackage = PLATFORM_PACKAGE_BY_TARGET[triple]!;
  let packageJsonPath: string;
  try {
    packageJsonPath = require.resolve(`${platformPackage}/package.json`);
  } catch (err) {
    throw new Error(
      `[llm-runner] resolveCodexBinaryPath: '${platformPackage}'를 찾을 수 없다. ` +
        "이 패키지의 npm 의존성에 '@openai/codex'를 추가해라 (전역 설치가 아니라 " +
        '`npm install @openai/codex`로 프로젝트 의존성으로 넣어야, 배포 시 함께 번들링된다).',
      { cause: err },
    );
  }

  return join(dirname(packageJsonPath), 'vendor', triple, 'bin', binaryName);
}

/**
 * `@openai/codex`의 optionalDependencies를 읽어서, 이 머신에 실제로 설치된 플랫폼 패키지를 찾는다.
 * 플랫폼별 패키지는 해당 OS/아키텍처에서만 설치되므로, 해석에 성공하는 것이 곧 현재 플랫폼용이다.
 * 타깃 트리플도 `vendor/` 아래 디렉터리를 직접 읽어서 알아내므로 이름을 외우지 않는다.
 */
function discoverInstalledPlatformPackage(
  require: NodeJS.Require,
): { packageDir: string; triple: string } | undefined {
  let optionalDependencies: Record<string, string> | undefined;
  try {
    const cliPackageJson = require.resolve('@openai/codex/package.json');
    optionalDependencies = JSON.parse(readFileSync(cliPackageJson, 'utf-8')).optionalDependencies;
  } catch {
    return undefined;
  }

  for (const name of Object.keys(optionalDependencies ?? {})) {
    let packageDir: string;
    try {
      packageDir = dirname(require.resolve(`${name}/package.json`));
    } catch {
      continue; // 다른 플랫폼용이라 설치 안 된 것 — 정상이다.
    }

    try {
      const triples = readdirSync(join(packageDir, 'vendor'), { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name);
      if (triples.length === 1) return { packageDir, triple: triples[0]! };
    } catch {
      continue; // vendor가 없으면 우리가 아는 구조가 아니다 — 정적 표로 넘긴다.
    }
  }

  return undefined;
}

/**
 * 번들된 `codex` 바이너리를 "찾아지면 쓰고 아니면 말고" 방식으로 조회한다.
 * `resolveCodexBinaryPath()`와 달리 실패해도 던지지 않고 `undefined`를 반환한다.
 *
 * 탐색 기준점을 두 군데 쓴다: 실행 중인 프로세스의 cwd(보통 앱 루트)와 이 라이브러리 파일의 위치.
 * 서버리스 번들처럼 cwd가 앱 루트가 아닐 수 있는 환경에서도 찾을 수 있게 하기 위함이다.
 */
export function tryResolveCodexBinaryPath(fromPath?: string): string | undefined {
  const searchRoots = fromPath ? [fromPath] : [process.cwd(), dirname(fileURLToPath(import.meta.url))];

  for (const root of searchRoots) {
    try {
      const candidate = resolveCodexBinaryPath(root);
      // require.resolve가 package.json을 찾았어도 vendor 바이너리가 실제로 딸려왔는지는 별개다
      // (배포 도구가 파일 추적에서 바이너리를 빠뜨리는 경우가 실제로 있다).
      if (existsSync(candidate)) return candidate;
    } catch {
      // 이 기준점에서는 못 찾은 것뿐이다 — 다음 후보로 넘어간다.
    }
  }

  return undefined;
}

/**
 * 실제로 `codex`를 실행할 때 쓸 경로를 정한다. 우선순위는:
 *
 * 1. 호출자가 명시한 `override` — 항상 최우선으로 존중한다.
 * 2. PATH 상의 `codex` — 로컬 개발 환경. 사용자가 `codex login`으로 로그인해둔 바로 그 설치본이라
 *    번들 바이너리보다 이걸 쓰는 게 안전하다. (`undefined`를 반환해서 SDK 기본 동작에 맡긴다.)
 * 3. 프로젝트 의존성으로 설치된 `@openai/codex-<platform>`의 번들 바이너리 — 서버리스 환경.
 *
 * 3번 덕분에 사용자가 `codexPathOverride`를 직접 코드에 써넣지 않아도 서버리스에서 동작한다.
 * (예전에는 이걸 손으로 지정해야만 했고, 그게 Codex 배포가 어렵던 주된 이유 중 하나였다.)
 */
export function resolveCodexExecutable(override?: string): string | undefined {
  if (override) return override;
  if (isCommandOnPath('codex')) return undefined;
  return tryResolveCodexBinaryPath();
}
