# NestJS처럼 설정 주입을 쓰는 프레임워크에서 쓰기

[← README로 돌아가기](../README.md)



`llm-runner`는 기본적으로 `process.env`를 읽습니다. NestJS의 `ConfigService`처럼 **설정의 단일 출처가 따로 있는 구조**라면 값을 명시적으로 넘기세요. 아래는 그대로 복사해서 쓸 수 있는 전체 예제입니다(실제 NestJS 서비스에 이식해서 검증한 구성입니다).

**1. 주입 토큰을 정의합니다.** llm-runner가 제공하는 게 아니라, 여러분 앱에서 만드는 심볼입니다:

```ts
// ai/ai.constants.ts
export const AI_RUNNER = Symbol('AI_RUNNER');
```

**2. 모듈에서 팩토리로 만들어 내보냅니다:**

```ts
// ai/ai.module.ts
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createAiRunner, type AiProvider, type AiRunner } from 'llm-runner';
import { AI_RUNNER } from './ai.constants.js';

@Module({
  providers: [
    {
      provide: AI_RUNNER,
      inject: [ConfigService],
      useFactory: (config: ConfigService): AiRunner =>
        createAiRunner({
          provider: config.get<string>('AI_PROVIDER') as AiProvider,
          claudeApiKey: config.get<string>('ANTHROPIC_API_KEY'),
          claudeSubscriptionDefaultModel: config.get<string>('CLAUDE_SUBSCRIPTION_DEFAULT_MODEL'),
        }),
    },
  ],
  exports: [AI_RUNNER],
})
export class AiModule {}
```

**3. 서비스에서 주입받아 씁니다:**

```ts
// ai/ai.service.ts
import { Inject, Injectable } from '@nestjs/common';
import type { AiRunner } from 'llm-runner';
import { AI_RUNNER } from './ai.constants.js';

@Injectable()
export class AiService {
  constructor(@Inject(AI_RUNNER) private readonly runner: AiRunner) {}

  async summarize(text: string): Promise<string> {
    const { text: answer } = await this.runner.run({ prompt: `요약해줘:\n${text}` });
    return answer;
  }
}
```

마지막으로 `AppModule`에 `ConfigModule.forRoot({ isGlobal: true })`와 `AiModule`을 `imports`에 넣으면 끝입니다.

몇 가지 주의점:

- **`createAiRunner()`를 파일 최상단에서 부르지 마세요.** 위처럼 팩토리 안에서 부르면 부팅 시점에 실행되므로 안전합니다. 최상단에서 부르면 모듈을 import하는 것만으로 CLI 설치 검사가 돌아서, 빌드 서버처럼 CLI가 없는 환경에서 빌드가 깨질 수 있습니다.
- **타입은 `AiRunner`, `AiProvider`, `AiSession`, `AiRunResult` 등이 모두 패키지에서 import됩니다** — 위 예제처럼 `import type { AiRunner } from 'llm-runner'`로 가져오세요.
- `ConfigModule.forRoot()`가 `.env`를 `process.env`에도 올려주므로 값을 안 넘겨도 대개 동작하지만, **그러면 설정 출처가 두 개가 됩니다.** 나중에 `.env`가 아닌 곳(시크릿 매니저, DB)에서 설정을 읽도록 바꾸는 순간 조용히 어긋나므로, 처음부터 넘기는 편을 권합니다.
