import { vi } from 'vitest';

vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(function AnthropicMock() {
    return { messages: { create: vi.fn() } };
  }),
}));
vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(function OpenAiMock() {
    return { chat: { completions: { create: vi.fn() } } };
  }),
}));
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({ query: vi.fn() }));
vi.mock('@openai/codex-sdk', () => ({
  Codex: vi.fn().mockImplementation(function CodexMock() {
    return { startThread: vi.fn() };
  }),
}));

// 번들 바이너리 자동 탐지를 테스트가 직접 제어한다. 실제 파일시스템/전역 설치 상태에 따라
// 결과가 달라지면(예전에 실제로 겪었다) 테스트가 환경에 따라 흔들린다.
const tryResolveCodexBinaryPathMock = vi.fn<() => string | undefined>();
vi.mock('./setup/resolve-codex-binary.js', () => ({
  tryResolveCodexBinaryPath: tryResolveCodexBinaryPathMock,
  resolveCodexExecutable: (override?: string) => override ?? tryResolveCodexBinaryPathMock(),
  resolveCodexBinaryPath: vi.fn(),
}));

// 세션 복원은 실제로 `codex login`을 spawn할 수 있다 — 테스트에서 진짜 로그인 상태를 건드리면 안 된다.
vi.mock('./setup/restore-session.js', () => ({
  restoreCodexSessionFromEnv: vi.fn(() => false),
  restoreCodexSession: vi.fn(async () => false),
  persistRotatedCodexAuth: vi.fn(async () => false),
}));

const checkClaudeStatusMock = vi.fn();
const checkCodexStatusMock = vi.fn();
vi.mock('./setup/check-status.js', () => ({
  checkClaudeStatus: checkClaudeStatusMock,
  checkCodexStatus: checkCodexStatusMock,
}));

const { createAiRunner } = await import('./create-ai-runner.js');
const { ClaudeApiRunner } = await import('./runners/claude-api.runner.js');
const { ClaudeSubscriptionRunner } = await import('./runners/claude-subscription.runner.js');
const { OpenAiApiRunner } = await import('./runners/openai-api.runner.js');
const { OpenAiSubscriptionRunner } = await import('./runners/openai-subscription.runner.js');

function setLoginState(claudeLoggedIn: boolean, codexLoggedIn: boolean) {
  checkClaudeStatusMock.mockReturnValue({ loggedIn: claudeLoggedIn });
  checkCodexStatusMock.mockReturnValue({ loggedIn: codexLoggedIn });
}

describe('createAiRunner', () => {
  const originalAnthropicKey = process.env.ANTHROPIC_API_KEY;
  const originalOpenAiKey = process.env.OPENAI_API_KEY;

  beforeEach(() => {
    checkClaudeStatusMock.mockReset();
    checkCodexStatusMock.mockReset();
    setLoginState(false, false);
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
  });

  afterEach(() => {
    delete process.env.AI_PROVIDER;
    if (originalAnthropicKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = originalAnthropicKey;
    if (originalOpenAiKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalOpenAiKey;
  });

  describe('provider/AI_PROVIDER를 명시한 경우', () => {
    it.each([
      ['claude-api', ClaudeApiRunner],
      ['claude-subscription', ClaudeSubscriptionRunner],
      ['openai-api', OpenAiApiRunner],
      ['openai-subscription', OpenAiSubscriptionRunner],
    ] as const)('provider=%s면 해당 클래스의 인스턴스를 반환한다', (provider, expectedClass) => {
      const runner = createAiRunner({ provider, checkCliOnCreate: false });
      expect(runner).toBeInstanceOf(expectedClass);
    });

    it('process.env.AI_PROVIDER를 옵션 없을 때 폴백으로 쓴다', () => {
      process.env.AI_PROVIDER = 'openai-api';
      const runner = createAiRunner({ checkCliOnCreate: false });
      expect(runner).toBeInstanceOf(OpenAiApiRunner);
    });

    it('알 수 없는 provider 값이면 조용히 폴백하지 않고 예외를 던진다', () => {
      expect(() =>
        createAiRunner({ provider: 'claude-sub' as never, checkCliOnCreate: false }),
      ).toThrow(/알 수 없는 provider: 'claude-sub'/);
    });

    it('AI_PROVIDER 환경변수에 오타가 있으면 예외를 던진다', () => {
      process.env.AI_PROVIDER = 'claud-api';
      expect(() => createAiRunner({ checkCliOnCreate: false })).toThrow(/AI_PROVIDER 환경변수 값이 잘못됐다: 'claud-api'/);
    });

    it('checkCliOnCreate가 true(기본값)이고 CLI가 없으면 예외를 던진다', () => {
      const originalPath = process.env.PATH;
      process.env.PATH = '';
      try {
        expect(() => createAiRunner({ provider: 'claude-subscription' })).toThrow(/PATH에서 찾을 수 없다/);
      } finally {
        process.env.PATH = originalPath;
      }
    });

    it('CLAUDE_CODE_OAUTH_TOKEN이 있으면 PATH에 CLI가 없어도 예외를 던지지 않는다 (서버리스 배포 시나리오)', () => {
      const originalPath = process.env.PATH;
      process.env.PATH = '';
      process.env.CLAUDE_CODE_OAUTH_TOKEN = 'sk-ant-oat01-dummy';
      try {
        expect(() => createAiRunner({ provider: 'claude-subscription' })).not.toThrow();
      } finally {
        process.env.PATH = originalPath;
        delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
      }
    });

    it('PATH에 codex CLI가 없고 번들된 바이너리도 못 찾으면 예외를 던진다', () => {
      const originalPath = process.env.PATH;
      process.env.PATH = '';
      tryResolveCodexBinaryPathMock.mockReturnValue(undefined);
      try {
        expect(() => createAiRunner({ provider: 'openai-subscription' })).toThrow(/PATH에서 찾을 수 없다/);
      } finally {
        process.env.PATH = originalPath;
      }
    });

    it('PATH에 codex CLI가 없어도 번들된 바이너리를 찾으면 예외를 던지지 않는다 (서버리스 자동 탐지)', () => {
      const originalPath = process.env.PATH;
      process.env.PATH = '';
      tryResolveCodexBinaryPathMock.mockReturnValue('/var/task/node_modules/@openai/codex-linux-x64/vendor/x/bin/codex');
      try {
        expect(() => createAiRunner({ provider: 'openai-subscription' })).not.toThrow();
      } finally {
        process.env.PATH = originalPath;
      }
    });

    it('codexPathOverride를 주면 PATH에 codex CLI가 없어도 예외를 던지지 않는다 (번들된 바이너리로 서버리스 배포하는 시나리오)', () => {
      const originalPath = process.env.PATH;
      process.env.PATH = '';
      try {
        expect(() =>
          createAiRunner({ provider: 'openai-subscription', codexPathOverride: '/opt/bundled/codex' }),
        ).not.toThrow();
      } finally {
        process.env.PATH = originalPath;
      }
    });
  });

  describe('provider/AI_PROVIDER를 둘 다 지정 안 한 경우 (자동 감지)', () => {
    it('claude가 로그인되어 있으면 claude-subscription을 쓰고, 뭘 골랐는지 stderr(console.warn)로 알린다', () => {
      setLoginState(true, false);
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      try {
        const runner = createAiRunner();
        expect(runner).toBeInstanceOf(ClaudeSubscriptionRunner);
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('claude-subscription'));
        expect(logSpy).not.toHaveBeenCalled();
      } finally {
        warnSpy.mockRestore();
        logSpy.mockRestore();
      }
    });

    it('silent: true면 자동 감지 안내를 찍지 않는다', () => {
      setLoginState(true, false);
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        createAiRunner({ silent: true });
        expect(warnSpy).not.toHaveBeenCalled();
      } finally {
        warnSpy.mockRestore();
      }
    });

    it('claude는 안 되고 codex만 로그인되어 있으면 openai-subscription을 쓴다', () => {
      setLoginState(false, true);
      const runner = createAiRunner();
      expect(runner).toBeInstanceOf(OpenAiSubscriptionRunner);
    });

    it('둘 다 로그인 안 됐지만 ANTHROPIC_API_KEY가 있으면 claude-api를 쓴다', () => {
      setLoginState(false, false);
      process.env.ANTHROPIC_API_KEY = 'sk-test';
      const runner = createAiRunner();
      expect(runner).toBeInstanceOf(ClaudeApiRunner);
    });

    it('ANTHROPIC_API_KEY도 없고 OPENAI_API_KEY만 있으면 openai-api를 쓴다', () => {
      setLoginState(false, false);
      process.env.OPENAI_API_KEY = 'sk-test';
      const runner = createAiRunner();
      expect(runner).toBeInstanceOf(OpenAiApiRunner);
    });

    it('아무것도 설정되어 있지 않으면 무엇을 설정해야 하는지 알려주는 에러를 던진다', () => {
      setLoginState(false, false);
      expect(() => createAiRunner()).toThrow(/llm-runner-setup|ANTHROPIC_API_KEY|OPENAI_API_KEY/);
    });
  });
});
