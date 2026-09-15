import { isCommandOnPath } from './ai-cli-check.js';

describe('isCommandOnPath', () => {
  it('PATH에 실제로 존재하는 명령어는 true를 반환한다', () => {
    expect(isCommandOnPath('node')).toBe(true);
  });

  it('존재하지 않는 명령어는 false를 반환한다', () => {
    expect(isCommandOnPath('this-command-definitely-does-not-exist-12345')).toBe(false);
  });
});
