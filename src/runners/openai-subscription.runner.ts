import { Codex } from '@openai/codex-sdk';
import type { AiRunner, AiRunOptions, AiRunResult } from '../interfaces/ai-runner.interface.js';
import { CODEX_MODELS } from '../constants/ai-models.constants.js';
import { restoreCodexSessionFromEnv } from '../setup/restore-session.js';
import { wrapWithFriendlyMessage } from '../errors/friendly-error.js';

export interface OpenAiSubscriptionRunnerOptions {
  defaultModel?: string;
}

/**
 * 기본 모델이 일시적으로 용량 부족("at capacity")일 때 한 단계 위 모델로 한 번 재시도한다.
 * 호출자가 model을 직접 지정한 경우에는 그 선택을 존중해서 재시도하지 않는다.
 */
const CAPACITY_FALLBACK: Record<string, string> = {
  [CODEX_MODELS.LUNA]: CODEX_MODELS.TERRA,
  [CODEX_MODELS.TERRA]: CODEX_MODELS.SOL,
};

function isCapacityError(err: unknown): boolean {
  return err instanceof Error && /at capacity/i.test(err.message);
}

function wrapCodexError(err: unknown): Error {
  // SDK가 던지는 원인(용량 부족, 모델 미지원, 로그인 만료 등)을 그대로 노출하되,
  // 초보자가 다음에 뭘 해야 하는지 알 수 있게 감싼다. 원본은 cause로 남긴다.
  const reason = err instanceof Error ? err.message : String(err);
  return wrapWithFriendlyMessage(
    `[llm-runner] Codex 호출 실패: ${reason} — 일시적인 용량 문제라면 잠시 후 다시 시도하고, ` +
      `계속되면 model 옵션으로 다른 모델(CODEX_MODELS.TERRA 등)을 지정하거나 \`npx llm-runner-setup\`으로 로그인 상태를 확인해라.`,
    err,
  );
}

/**
 * 로컬에 설치된 Codex CLI의 구독(ChatGPT 로그인) 세션을 그대로 사용한다.
 * 평소엔 공식 SDK만 쓰고 spawn/exec를 직접 호출하지 않는다.
 * 예외: CODEX_ACCESS_TOKEN이 설정된 경우(서버리스 등 파일시스템이 매번 초기화되는 환경)
 * 프로세스당 한 번, 세션 복원을 위해 `codex login`을 spawn한다 — 이건 AI 호출이 아니라
 * 부팅 시 인증 상태를 맞추는 작업이다.
 */
export class OpenAiSubscriptionRunner implements AiRunner {
  private readonly codex: Codex;
  private readonly defaultModel: string;

  constructor(options: OpenAiSubscriptionRunnerOptions = {}) {
    restoreCodexSessionFromEnv();
    this.codex = new Codex();
    this.defaultModel =
      options.defaultModel ?? process.env.OPENAI_SUBSCRIPTION_DEFAULT_MODEL ?? CODEX_MODELS.LUNA;
  }

  async run(options: AiRunOptions): Promise<AiRunResult> {
    const prompt = options.system ? `${options.system}\n\n${options.prompt}` : options.prompt;
    const model = options.model ?? this.defaultModel;

    try {
      return await this.runOnce(model, prompt, options);
    } catch (err) {
      const fallback = options.model ? undefined : CAPACITY_FALLBACK[model];
      if (fallback && isCapacityError(err)) {
        console.warn(`[llm-runner] ${model} 모델이 지금 용량 부족이라 ${fallback}로 한 번 재시도한다.`);
        try {
          return await this.runOnce(fallback, prompt, options);
        } catch (retryErr) {
          throw wrapCodexError(retryErr);
        }
      }
      throw wrapCodexError(err);
    }
  }

  private async runOnce(model: string, prompt: string, options: AiRunOptions): Promise<AiRunResult> {
    const thread = this.codex.startThread({
      model,
      skipGitRepoCheck: true,
      // sandboxMode가 실질적인 방어선이다: read-only는 파일 쓰기/네트워크를
      // 완전히 막지만, ls/pwd 같은 읽기 명령 실행 자체는 policy와 무관하게 통과된다
      // (SDK/CLI 레벨에서 명령 실행 자체를 원천 차단하는 옵션은 없음).
      sandboxMode: 'read-only',
      approvalPolicy: 'on-request',
      // 웹 검색은 네트워크 접근이 있어야 동작하므로 함께 켠다.
      networkAccessEnabled: options.enableWebSearch ?? false,
      webSearchEnabled: options.enableWebSearch ?? false,
      webSearchMode: options.enableWebSearch ? 'live' : 'disabled',
    });

    const turn = await thread.run(prompt);
    return { text: turn.finalResponse, raw: turn };
  }
}
