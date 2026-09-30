/**
 * Claude 구독 로그인/로그아웃. 프로필 단위로 동작한다.
 *
 * **Codex와 흐름이 다르다.** Codex는 프로토콜이 `authUrl`을 돌려주고 승인이 끝나면 알림이 온다.
 * Claude는 SDK에 로그인 API가 없어서 `claude auth login` CLI를 띄우는데, 그 CLI는
 * ① 브라우저를 스스로 열고 ② URL을 stdout에 찍고 ③ **인증 코드를 stdin으로 붙여넣기를 기다린다**
 * (실측). 그래서 이 모듈은 URL을 뽑아 주고, 사용자가 받은 코드를 다시 넣을 통로를 연다.
 *
 * **왜 프로필이 전제인가** — `claudeConfigDir`을 생략하면 머신 기본 계정(`~/.claude`)을 건드린다.
 * 버려도 되는 프로필을 가리키면 기본 계정을 그대로 둔 채 시험할 수 있다.
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { buildProfileEnv } from '../setup/profile-env.js';

export interface ClaudeLoginOptions {
  /** 로그인할 프로필 디렉터리. 생략하면 머신 기본(`~/.claude`)에 로그인한다. */
  claudeConfigDir?: string;
  /** `claude` 실행파일 경로. 생략하면 PATH에서 찾는다. */
  claudePathOverride?: string;
  /** 구독 로그인(기본) 대신 Anthropic Console(API 과금)으로 로그인한다. */
  useConsole?: boolean;
  /** 로그인 페이지에 이메일을 미리 채운다. */
  email?: string;
  /** URL이 나올 때까지 기다리는 최대 시간. 기본 30초. */
  urlTimeoutMs?: number;
  /** 코드를 넣은 뒤 완료까지 기다리는 최대 시간. 기본 5분. */
  completionTimeoutMs?: number;
}

export interface ClaudeLoginHandle {
  /**
   * 브라우저에서 열어야 하는 OAuth URL.
   *
   * CLI가 **이미 브라우저를 열려고 시도한 뒤**다("Opening browser to sign in…"). 브라우저가
   * 없는 환경이거나 다른 브라우저로 열고 싶을 때 이 URL을 쓴다.
   */
  authUrl: string;
  /** 브라우저에서 받은 인증 코드를 넣는다. */
  submitCode(code: string): void;
  /** 로그인이 끝날 때까지 기다린다. 실패해도 던지지 않는다. */
  waitForCompletion(): Promise<{ success: boolean; error?: string }>;
  /** 중단한다. 진행 중이던 로그인은 완료되지 않는다. */
  cancel(): void;
}

/** OSC 8 하이퍼링크 이스케이프(`\x1b]8;;URL\x1b\\텍스트\x1b]8;;\x1b\\`)를 걷어낸다. */
function stripAnsi(text: string): string {
  return text
    .replace(/\u001b\]8;;[^\u0007\u001b]*(?:\u0007|\u001b\\)/g, '')
    .replace(/\u001b\[[0-9;]*[A-Za-z]/g, '');
}

/**
 * 로그인을 시작하고 `authUrl`을 돌려준다.
 *
 * ```ts
 * const login = await startClaudeLogin({ claudeConfigDir: '~/.claude-work' });
 * console.log('브라우저에서 승인하세요:', login.authUrl);
 * login.submitCode(await 사용자가_붙여넣은_코드());
 * const { success } = await login.waitForCompletion();
 * ```
 */
export async function startClaudeLogin(options: ClaudeLoginOptions = {}): Promise<ClaudeLoginHandle> {
  const args = ['auth', 'login', options.useConsole ? '--console' : '--claudeai'];
  if (options.email) args.push('--email', options.email);

  const env = buildProfileEnv(options, ['claudeConfigDir']);
  const child: ChildProcessWithoutNullStreams = spawn(options.claudePathOverride ?? 'claude', args, {
    stdio: ['pipe', 'pipe', 'pipe'],
    ...(env ? { env } : {}),
  }) as ChildProcessWithoutNullStreams;

  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');

  let output = '';
  let exited: { code: number | null } | undefined;
  const cancel = () => {
    if (!child.killed) child.kill();
  };

  child.on('exit', (code) => {
    exited = { code };
  });

  let found = false;
  const authUrl = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      cancel();
      reject(new Error(`[llm-runner] Claude 로그인 URL이 ${options.urlTimeoutMs ?? 30_000}ms 안에 나오지 않았다.`));
    }, options.urlTimeoutMs ?? 30_000);

    const onChunk = (chunk: string) => {
      output += chunk;
      if (found) return;
      // URL은 OSC 8 링크 안에 한 번, 표시 텍스트로 한 번 — 두 번 나온다. 첫 것만 쓴다.
      const match = stripAnsi(output).match(/https:\/\/\S*oauth\/authorize\S*/);
      if (!match) return;
      found = true;
      clearTimeout(timer);
      resolve(match[0]);
    };
    // URL을 찾은 뒤에도 계속 모은다 — 실패 사유가 그 뒤에 나오기 때문이다(테스트로 확인).
    child.stdout.on('data', onChunk);
    child.stderr.on('data', onChunk);
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(new Error(`[llm-runner] claude 실행파일을 찾을 수 없다: ${err.message}`));
    });
    child.on('exit', () => {
      clearTimeout(timer);
      reject(new Error('[llm-runner] claude auth login이 URL을 내기 전에 종료됐다.'));
    });
  });

  return {
    authUrl,
    submitCode(code: string) {
      child.stdin.write(`${code.trim()}\n`);
    },
    waitForCompletion: () =>
      new Promise((resolve) => {
        if (exited) {
          resolve(
            exited.code === 0
              ? { success: true }
              : { success: false, error: `claude auth login이 코드 ${exited.code}로 종료됐다.` },
          );
          return;
        }
        const timer = setTimeout(() => {
          cancel();
          resolve({ success: false, error: '로그인 완료를 기다리다 시간이 지났다.' });
        }, options.completionTimeoutMs ?? 300_000);

        child.on('exit', (code) => {
          clearTimeout(timer);
          resolve(
            code === 0
              ? { success: true }
              : {
                  success: false,
                  // 실패 사유가 출력에 섞여 있을 수 있어 뒷부분을 붙인다.
                  error: `claude auth login이 코드 ${code}로 종료됐다. ${stripAnsi(output).slice(-200).trim()}`,
                },
          );
        });
      }),
    cancel,
  };
}

/**
 * 프로필에서 로그아웃한다.
 *
 * ⚠️ `claudeConfigDir`을 생략하면 **머신 기본 계정**에서 로그아웃한다.
 */
export async function claudeLogout(
  options: { claudeConfigDir?: string; claudePathOverride?: string; timeoutMs?: number } = {},
): Promise<{ ok: boolean; error?: string }> {
  const env = buildProfileEnv(options, ['claudeConfigDir']);
  return new Promise((resolve) => {
    const child = spawn(options.claudePathOverride ?? 'claude', ['auth', 'logout'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      ...(env ? { env } : {}),
    });
    let out = '';
    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (c: string) => (out += c));
    child.stderr?.on('data', (c: string) => (out += c));

    const timer = setTimeout(() => {
      child.kill();
      resolve({ ok: false, error: '로그아웃이 시간 안에 끝나지 않았다.' });
    }, options.timeoutMs ?? 20_000);

    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ ok: false, error: `claude 실행파일을 찾을 수 없다: ${err.message}` });
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      resolve(code === 0 ? { ok: true } : { ok: false, error: stripAnsi(out).slice(-200).trim() });
    });
  });
}
