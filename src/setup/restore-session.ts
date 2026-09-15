import { spawnSync } from 'node:child_process';

let codexRestored = false;

/**
 * 서버리스처럼 매번 새 인스턴스가 뜨는 환경에서는 `~/.codex/auth.json`이 콜드스타트마다 사라진다.
 * `CODEX_ACCESS_TOKEN` 환경변수(비밀 값)가 있으면, 그 토큰을 `codex login --with-access-token`에
 * 주입해서 대화형 로그인 없이 그 프로세스 안에서 세션을 복원한다.
 *
 * 토큰 발급: 로그인된 로컬 머신에서 `~/.codex/auth.json`의 tokens.access_token 값을 꺼내
 * 배포 환경의 비밀 값(CODEX_ACCESS_TOKEN)으로 저장해둔다.
 *
 * 주의: 이 방식은 개인 액세스 토큰(PAT) 방식이라 자동 갱신되지 않는다. 만료되면
 * 로컬에서 다시 발급받아 비밀 값을 갱신해야 한다.
 *
 * 프로세스당 한 번만 실행한다(메모이즈). CODEX_ACCESS_TOKEN이 없으면 아무 것도 하지 않고
 * false를 반환한다 — 로컬 개발처럼 이미 `codex login`이 되어 있는 환경에서는 이 함수를
 * 호출해도 동작에 영향이 없다.
 */
export function restoreCodexSessionFromEnv(): boolean {
  if (codexRestored) return true;

  const token = process.env.CODEX_ACCESS_TOKEN;
  if (!token) return false;

  const result = spawnSync('codex', ['login', '--with-access-token'], {
    input: token,
    encoding: 'utf-8',
    // Windows에서 npm으로 설치된 CLI는 .cmd 래퍼라서 shell 없이는 찾지 못한다.
    shell: process.platform === 'win32',
  });

  if (result.status !== 0) {
    throw new Error(
      `CODEX_ACCESS_TOKEN으로 codex 세션 복원 실패 (토큰 만료 가능성): ${result.stderr || result.stdout}`,
    );
  }

  codexRestored = true;
  return true;
}
