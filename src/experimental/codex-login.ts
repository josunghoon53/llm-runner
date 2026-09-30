/**
 * Codex 구독 로그인/로그아웃. 프로필 단위로 동작한다.
 *
 * **왜 프로필이 전제인가** — `codexHome`을 지정하지 않으면 머신 기본 계정(`~/.codex`)을
 * 건드린다. 로그아웃은 되돌리려면 브라우저를 다시 거쳐야 하고, 그 사이 다른 터미널 세션까지
 * 끊긴다. 버려도 되는 프로필을 가리키면 기본 계정을 그대로 둔 채 시험할 수 있다.
 *
 * **브라우저는 호출부가 연다.** 프로토콜이 `authUrl`을 돌려주므로, 이 모듈은 URL만 넘기고
 * 실제로 열지는 않는다 — 서버·CI처럼 브라우저가 없는 환경도 있고, 링크를 화면에 띄우는 게
 * 나은 경우도 있어서다.
 *
 * **왜 experimental인가** — app-server는 OpenAI가 CLI에서 `[experimental]`이라고 표시한
 * 프로토콜이다. 그리고 이 모듈은 자격 증명을 쓰는 유일한 부분이다.
 */
import { CodexAppServerPeer } from './codex-app-server-session.js';
import { buildProfileEnv } from '../setup/profile-env.js';

export interface CodexLoginOptions {
  /** 로그인할 프로필 디렉터리. 생략하면 머신 기본(`~/.codex`)에 로그인한다. */
  codexHome?: string;
  codexPathOverride?: string;
  /** 브라우저 승인을 기다리는 최대 시간. 기본 5분. */
  timeoutMs?: number;
}

export interface CodexLoginHandle {
  /** 브라우저에서 열어야 하는 OAuth URL. */
  authUrl: string;
  /** 취소할 때 쓰는 식별자. */
  loginId: string;
  /**
   * 승인이 끝날 때까지 기다린다. 성공하면 `{ success: true }`.
   * 실패·시간초과여도 던지지 않고 `success: false`와 사유를 돌려준다.
   */
  waitForCompletion(): Promise<{ success: boolean; error?: string }>;
  /** 기다리는 도중 취소한다. 세션도 함께 정리된다. */
  cancel(): Promise<void>;
  /** 더 안 기다릴 때 세션만 닫는다. 진행 중이던 로그인은 취소되지 않는다. */
  close(): void;
}

/**
 * 로그인을 시작하고 `authUrl`을 돌려준다. **호출부가 그 URL을 열어야** 진행된다.
 *
 * ```ts
 * const login = await startCodexLogin({ codexHome: '~/.codex-work' });
 * console.log('브라우저에서 열어주세요:', login.authUrl);
 * const { success } = await login.waitForCompletion();
 * ```
 *
 * 세션은 `waitForCompletion()`이나 `cancel()`이 끝나면 자동으로 닫힌다. 둘 다 안 부를 거면
 * `close()`로 직접 정리해야 프로세스가 남지 않는다.
 */
export async function startCodexLogin(options: CodexLoginOptions = {}): Promise<CodexLoginHandle> {
  const peer = new CodexAppServerPeer(
    options.codexPathOverride,
    undefined,
    30_000,
    buildProfileEnv(options, ['codexHome']),
  );

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    peer.close();
  };

  try {
    await peer.initialize();
    const started = await peer.request<{ type: string; authUrl?: string; loginId?: string }>(
      'account/login/start',
      { type: 'chatgpt' },
    );

    if (started.type !== 'chatgpt' || !started.authUrl || !started.loginId) {
      close();
      throw new Error(
        `[llm-runner] Codex 로그인을 시작하지 못했다: 예상과 다른 응답(type=${started.type}). ` +
          'CLI 버전이 바뀌었을 수 있다.',
      );
    }

    const { authUrl, loginId } = started;

    return {
      authUrl,
      loginId,
      waitForCompletion: () =>
        new Promise((resolve) => {
          const finish = (result: { success: boolean; error?: string }) => {
            clearTimeout(timer);
            unsubscribe();
            close();
            resolve(result);
          };
          const timer = setTimeout(
            () => finish({ success: false, error: '브라우저 승인을 기다리다 시간이 지났다.' }),
            options.timeoutMs ?? 300_000,
          );
          const unsubscribe = peer.onNotification((n) => {
            if (n.method !== 'account/login/completed') return;
            const params = n.params as { success?: boolean; error?: string | null; loginId?: string | null };
            // 같은 프로세스에서 여러 로그인을 시작했을 수 있다 — 내 것만 받는다.
            if (params.loginId && params.loginId !== loginId) return;
            finish({ success: Boolean(params.success), error: params.error ?? undefined });
          });
        }),
      cancel: async () => {
        try {
          await peer.request('account/login/cancel', { loginId });
        } catch {
          // 이미 끝났거나 프로토콜이 바뀐 경우. 어차피 세션을 닫으므로 더 할 일이 없다.
        } finally {
          close();
        }
      },
      close,
    };
  } catch (err) {
    close();
    throw err;
  }
}

/**
 * 프로필에서 로그아웃한다.
 *
 * ⚠️ `codexHome`을 생략하면 **머신 기본 계정**에서 로그아웃한다. 다른 터미널에서 쓰던 세션까지
 * 끊기고, 되돌리려면 브라우저로 다시 로그인해야 한다. 프로필을 지정해서 쓰는 걸 권한다.
 */
export async function codexLogout(
  options: { codexHome?: string; codexPathOverride?: string; timeoutMs?: number } = {},
): Promise<{ ok: boolean; error?: string }> {
  const peer = new CodexAppServerPeer(
    options.codexPathOverride,
    undefined,
    options.timeoutMs ?? 20_000,
    buildProfileEnv(options, ['codexHome']),
  );
  try {
    await peer.initialize();
    await peer.request('account/logout', {});
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    peer.close();
  }
}
