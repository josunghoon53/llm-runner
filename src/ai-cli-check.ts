import { existsSync } from 'node:fs';
import { delimiter, join } from 'node:path';

/**
 * PATH 상에 실행 파일이 있는지 파일 시스템 조회로만 확인한다.
 * spawn/exec로 직접 실행하지 않으므로 애플리케이션 코드의 spawn/exec 금지 원칙을 지킨다.
 * 로그인 여부까지는 확인하지 못하고, 바이너리 존재 여부만 확인한다.
 */
export function isCommandOnPath(command: string): boolean {
  const pathEnv = process.env.PATH ?? '';
  const candidates =
    process.platform === 'win32' ? [command, `${command}.cmd`, `${command}.exe`] : [command];

  return pathEnv
    .split(delimiter)
    .filter((dir) => dir.length > 0)
    .some((dir) => candidates.some((candidate) => existsSync(join(dir, candidate))));
}

export function assertCommandOnPath(command: string, contextMessage: string): void {
  if (!isCommandOnPath(command)) {
    throw new Error(`'${command}' CLI를 PATH에서 찾을 수 없다. ${contextMessage}`);
  }
}
