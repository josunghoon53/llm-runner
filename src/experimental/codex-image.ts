/**
 * Codex로 이미지를 생성한다.
 *
 * **공식 SDK에는 없다.** `@openai/codex-sdk`에는 이미지 *입력*(`local_image`)만 있고 생성은
 * app-server 프로토콜에만 있다 — 추론 강도·플랜 잔량·계정 정보와 같은 패턴이다.
 *
 * **읽기 전용 샌드박스를 그대로 쓴다.** 이미지 생성은 파일을 쓰는 일처럼 보이지만, Codex가
 * 자기 디렉터리(`~/.codex/generated_images/`)에 저장하고 **base64를 응답에 실어 준다**(실측).
 * 그래서 llm-runner의 안전선(`sandboxMode: 'read-only'`, 도구 전면 차단)을 내릴 필요가 없다.
 * 워크스페이스에 저장하고 싶으면 호출부가 받은 바이트를 쓰면 된다.
 *
 * **별도 사용량 한도를 쓴다.** 텍스트 호출과 다른 한도이고, 실측으로 이미지 두 장에 5시간 창이
 * 0% → 4% 올랐다. 실패는 `usageLimitExceeded`로 오며 `resetsAt`이 함께 온다.
 *
 * **Claude에는 대응 기능이 없다.** 그래서 `AiRunner` 인터페이스가 아니라 여기 둔다.
 */
import { CodexAppServerPeer } from './codex-app-server-session.js';
import { buildProfileEnv } from '../setup/profile-env.js';

export interface CodexImageOptions {
  /** 그리고 싶은 것. 모델이 이걸 더 자세한 프롬프트로 다듬는다(`revisedPrompt`로 돌려준다). */
  prompt: string;
  model?: string;
  /** 프로필 디렉터리. 계정마다 이미지 한도가 따로다. */
  codexHome?: string;
  codexPathOverride?: string;
  /** 한 장 그리는 데 걸리는 시간이 길다. 기본 5분. */
  timeoutMs?: number;
}

export interface CodexImage {
  /** PNG 바이트. 파일로 저장하든 base64로 실어 보내든 호출부가 정한다. */
  data: Buffer;
  /** 모델이 다듬은 프롬프트. 왜 이런 그림이 나왔는지 볼 때 쓴다. */
  revisedPrompt?: string;
  /** Codex가 저장해 둔 경로. 프로토콜이 줄 때만 채워진다. */
  savedPath?: string;
}

export interface CodexImageResult {
  images: CodexImage[];
  /** 모델이 곁들인 설명. 이미지가 없을 때 이유가 여기 있을 수 있다. */
  text: string;
  /**
   * 한도 초과 등으로 실패했을 때. `resetsAt`은 초 단위 epoch이라 Date로 바꿔 준다.
   */
  failure?: { type: string; limitId?: string; resetsAt?: Date };
}

type ImageItem = {
  type: string;
  status?: string;
  result?: string;
  revisedPrompt?: string | null;
  savedPath?: string | null;
  failure?: { type?: string; limitId?: string; resetsAt?: number | null } | null;
};

/**
 * ```ts
 * import { generateCodexImage } from 'llm-runner/experimental';
 *
 * const { images, failure } = await generateCodexImage({ prompt: '흰 배경에 파란 원 하나' });
 * if (failure) console.log('한도 초과, 리셋:', failure.resetsAt);
 * else await writeFile('circle.png', images[0].data);
 * ```
 */
export async function generateCodexImage(options: CodexImageOptions): Promise<CodexImageResult> {
  const peer = new CodexAppServerPeer(
    options.codexPathOverride,
    undefined,
    30_000,
    buildProfileEnv(options, ['codexHome']),
  );

  try {
    await peer.initialize();
    const { thread } = await peer.request<{ thread: { id: string } }>('thread/start', {
      ...(options.model ? { model: options.model } : {}),
      skipGitRepoCheck: true,
      // 이미지 생성에도 읽기 전용으로 충분하다(실측). 저장은 Codex가 자기 디렉터리에 한다.
      sandboxMode: 'read-only',
      approvalPolicy: 'on-request',
    });

    const { turn } = await peer.request<{ turn: { id: string } }>('turn/start', {
      threadId: thread.id,
      input: [{ type: 'text', text: options.prompt, text_elements: [] }],
    });

    return await new Promise<CodexImageResult>((resolve, reject) => {
      const items: ImageItem[] = [];
      const texts: string[] = [];

      const done = () => {
        clearTimeout(timer);
        unsubscribe();
        unsubscribeFatal();
      };
      const timer = setTimeout(() => {
        done();
        reject(new Error(`[llm-runner] 이미지 생성이 ${options.timeoutMs ?? 300_000}ms 안에 끝나지 않았다.`));
      }, options.timeoutMs ?? 300_000);

      const unsubscribe = peer.onNotification((n) => {
        if (n.method === 'item/completed') {
          const params = n.params as { turnId?: string; item?: ImageItem & { text?: string } };
          if (params.turnId !== turn.id || !params.item) return;
          if (params.item.type === 'imageGeneration') items.push(params.item);
          else if (params.item.type === 'agentMessage' && params.item.text) texts.push(params.item.text);
        } else if (n.method === 'turn/completed') {
          const params = n.params as { turn?: { id?: string } };
          if (params.turn?.id !== turn.id) return;
          done();
          resolve(collect(items, texts.join('')));
        }
      });
      const unsubscribeFatal = peer.onFatalError((err) => {
        done();
        reject(err);
      });
    });
  } finally {
    peer.close();
  }
}

/**
 * 같은 이미지에 대해 `in_progress`와 `completed`가 둘 다 온다(실측). 완료된 것만 쓴다.
 */
function collect(items: ImageItem[], text: string): CodexImageResult {
  const images: CodexImage[] = [];
  let failure: CodexImageResult['failure'];

  for (const item of items) {
    if (item.failure?.type) {
      failure = {
        type: item.failure.type,
        limitId: item.failure.limitId,
        // 초 단위 epoch으로 온다.
        resetsAt: typeof item.failure.resetsAt === 'number' ? new Date(item.failure.resetsAt * 1000) : undefined,
      };
      continue;
    }
    if (item.status !== 'completed' || !item.result) continue;
    images.push({
      data: Buffer.from(item.result, 'base64'),
      revisedPrompt: item.revisedPrompt ?? undefined,
      savedPath: item.savedPath ?? undefined,
    });
  }

  return { images, text, ...(failure ? { failure } : {}) };
}
