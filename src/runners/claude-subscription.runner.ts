import { query } from '@anthropic-ai/claude-agent-sdk';
import type { AiRunner, AiRunOptions, AiRunResult } from '../interfaces/ai-runner.interface.js';
import { CLAUDE_SUBSCRIPTION_MODELS } from '../constants/ai-models.constants.js';

/**
 * Claude Code 내장 도구 전체 목록. allowedTools([])만으로는 완전히 막히지 않는 걸 확인했기 때문에
 * disallowedTools로 명시적으로 차단한다 (harness 레벨에서 tool_use 자체를 막음).
 */
const ALL_BUILTIN_TOOLS = [
  'Bash',
  'BashOutput',
  'KillShell',
  'Read',
  'Write',
  'Edit',
  'NotebookEdit',
  'Glob',
  'Grep',
  'WebSearch',
  'WebFetch',
  'Task',
  'TodoWrite',
  'SlashCommand',
];

export interface ClaudeSubscriptionRunnerOptions {
  defaultModel?: string;
}

/**
 * 로컬에 설치된 Claude Code CLI의 구독(로그인) 세션을 그대로 사용한다.
 * API 키가 아니라 `claude login`으로 인증된 세션을 감싸는 공식 SDK를 사용하므로
 * 이 코드는 spawn/exec를 직접 호출하지 않는다.
 */
export class ClaudeSubscriptionRunner implements AiRunner {
  private readonly defaultModel: string;

  constructor(options: ClaudeSubscriptionRunnerOptions = {}) {
    this.defaultModel =
      options.defaultModel ?? process.env.CLAUDE_SUBSCRIPTION_DEFAULT_MODEL ?? CLAUDE_SUBSCRIPTION_MODELS.SONNET;
  }

  async run(options: AiRunOptions): Promise<AiRunResult> {
    const allowedTools = options.enableWebSearch ? ['WebSearch'] : [];
    const disallowedTools = ALL_BUILTIN_TOOLS.filter(
      (tool) => !allowedTools.includes(tool),
    );

    const stream = query({
      prompt: options.prompt,
      options: {
        model: options.model ?? this.defaultModel,
        systemPrompt: options.system,
        allowedTools,
        disallowedTools,
        // permissionMode를 지정하지 않으면 canUseTool 콜백이 없는 headless 호출에서
        // 'ask' 판정이 자동 거부로 처리된다 (bypassPermissions보다 안전).
      },
    });

    let result: { text: string; raw: unknown } | undefined;
    for await (const message of stream) {
      if (message.type === 'result') {
        if (message.subtype === 'success') {
          result = { text: message.result, raw: message };
        } else {
          throw new Error(`Claude Agent SDK 실행 실패: subtype=${message.subtype}`);
        }
      }
    }

    if (!result) {
      throw new Error('Claude Agent SDK가 result 메시지 없이 스트림을 종료했다.');
    }

    return result;
  }
}
