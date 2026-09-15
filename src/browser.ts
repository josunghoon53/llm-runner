/**
 * 브라우저(프론트엔드) 번들용 진입점.
 *
 * 번들러(Next.js, Vite 등)는 클라이언트 코드를 묶을 때 package.json exports의 "browser" 조건을 골라
 * 이 파일을 쓴다. 실제 구현은 CLI 실행·파일시스템 접근이 필요해서 브라우저에서 동작할 수 없으므로,
 * 여기서는 "왜 안 되는지, 어떻게 해야 하는지"를 바로 알려주는 에러만 던진다.
 * (이 스텁이 없으면 SDK 내부의 async_hooks/child_process를 못 찾는다는 알 수 없는 빌드 에러가 난다.)
 *
 * 모델/provider 상수는 Node 의존이 없으므로 브라우저에서도 그대로 쓸 수 있게 내보낸다.
 */
export * from './constants/ai-models.constants.js';
export * from './constants/ai-providers.constants.js';
export type { AiRunner, AiRunOptions, AiRunResult } from './interfaces/ai-runner.interface.js';
export type { CreateAiRunnerOptions } from './create-ai-runner.js';
export type { CliStatus, SubscriptionSetupReport } from './setup/check-status.js';

const MESSAGE =
  '[llm-runner] 브라우저(프론트엔드)에서는 동작하지 않습니다. 이 패키지는 서버(Node.js) 전용입니다. ' +
  '프론트에서는 fetch로 여러분의 API 라우트를 호출하고, 그 라우트 안에서 createAiRunner()를 쓰세요. ' +
  '예제: node_modules/llm-runner/examples/nextjs-starter/';

function browserOnly(name: string): never {
  throw new Error(`${MESSAGE} (${name})`);
}

export function createAiRunner(): never {
  return browserOnly('createAiRunner');
}
export function checkSubscriptionSetup(): never {
  return browserOnly('checkSubscriptionSetup');
}
export function checkClaudeStatus(): never {
  return browserOnly('checkClaudeStatus');
}
export function checkCodexStatus(): never {
  return browserOnly('checkCodexStatus');
}
export function restoreCodexSessionFromEnv(): never {
  return browserOnly('restoreCodexSessionFromEnv');
}
export function isCommandOnPath(): never {
  return browserOnly('isCommandOnPath');
}
export function assertCommandOnPath(): never {
  return browserOnly('assertCommandOnPath');
}

export class ClaudeApiRunner {
  constructor() {
    browserOnly('ClaudeApiRunner');
  }
}
export class ClaudeSubscriptionRunner {
  constructor() {
    browserOnly('ClaudeSubscriptionRunner');
  }
}
export class OpenAiApiRunner {
  constructor() {
    browserOnly('OpenAiApiRunner');
  }
}
export class OpenAiSubscriptionRunner {
  constructor() {
    browserOnly('OpenAiSubscriptionRunner');
  }
}
