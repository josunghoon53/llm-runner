# llm-runner

Claude Max / ChatGPT Plus **구독 세션**을 코드에서 그대로 쓰거나, Anthropic/OpenAI **API 키**를 쓰거나 —
같은 인터페이스로 갈아 끼울 수 있게 해주는 프레임워크 독립 러너.

```ts
import { createAiRunner } from 'llm-runner';

const runner = createAiRunner(); // provider 생략 시: .env의 AI_PROVIDER → 없으면 로그인/API 키가 설정된 것을 자동 감지
const { text } = await runner.run({ prompt: '오늘 날씨 요약해줘' });
```

NestJS, Express, 순수 Node, Next.js API route — 어디서든 그대로 씁니다.

## 뭘 골라야 하는지 30초 안에 정하기

바로 아래 판단 하나만 하면 됩니다. 나머지는 다 이 판단을 뒷받침하는 근거예요.

> **방문자/고객이 버튼을 누르거나 채팅을 보내면 그 즉시 AI가 호출되나요?**
> - **네** → `createAiRunner({ provider: 'claude-api' })` (또는 `'openai-api'`) — API 키 필요, [발급 안내](#설치)
> - **아니오, 저 혼자/우리 팀만 쓰는 자동화예요** → `createAiRunner()` (provider 생략, 로컬 로그인 세션 자동 감지)
> - **잘 모르겠어요** → 일단 `'claude-api'`로 시작하세요. 어디에 배포하든 항상 동작하고, 나중에 문제 될 일이 없습니다.

**흔한 실수**: 로컬 컴퓨터에서 `provider` 생략하고 테스트하면(구독 세션으로) 잘 되길래 그대로 배포했다가, Vercel 등에 올리자마자 안 되는 경우가 많습니다 — 구독형은 배포 서버에 로그인 세션이 없으면 동작하지 않습니다. **방문자가 쓰는 기능을 만드는 거라면 로컬 테스트도 처음부터 `'claude-api'`로 하세요.**

## 왜 필요한가

Claude Code나 Codex CLI는 이미 로그인해서 구독료를 내고 있으면, **API 키 없이** 그 세션으로 개인적으로 코드에서 호출할 수 있습니다 (자세한 사용 조건은 아래 [구독 사용 시 알아야 할 것](#구독-사용-시-알아야-할-것) 참고). 문제는 이걸 쓰려면:

- `@anthropic-ai/claude-agent-sdk`와 `@openai/codex-sdk`는 서로 완전히 다른 SDK라서 각각 배워야 함
- 아무 설정도 안 하면 두 SDK 다 파일 쓰기·명령 실행 같은 **위험한 도구가 기본으로 열려있음**
- 나중에 API 키 방식으로 바꾸고 싶을 때 코드를 다시 짜야 함

이 패키지는 이 네 가지 조합(Claude 구독/API 키, OpenAI 구독(Codex)/API 키)을 하나의 `AiRunner` 인터페이스로 감싸서, `.env` 값 하나로 스위치하듯 바꿀 수 있게 합니다.

## 설치

```bash
npm install llm-runner
```

- Node.js 22 이상이 필요합니다.
- ESM 패키지입니다. `import { createAiRunner } from 'llm-runner'`로 쓰세요. CommonJS(`require()`)는 Node 22.12 이상에서만 동작합니다.
- **새 프로젝트를 맨바닥에서 시작한다면**(Next.js 같은 프레임워크 없이), `package.json`에 아래 한 줄을 넣어야 `import` 문법이 동작합니다. 없으면 `Cannot use import statement outside a module` 에러가 납니다:
  ```json
  { "type": "module" }
  ```
  Next.js·Vite 등으로 만든 프로젝트는 이미 처리돼 있으니 그냥 쓰면 됩니다.
- 서버(Node.js) 전용입니다. 브라우저 코드에서 import하면 빌드는 되지만 호출 시 "서버에서만 동작한다"는 안내 에러가 납니다 — 아래 [프론트엔드에서 쓰려면](#프론트엔드react-등에서-쓰려면) 참고.

### npm 대신 GitHub에서 바로 설치하기

npm 계정 문제 등으로 최신 버전이 npm에 아직 안 올라갔거나, 그냥 GitHub 소스를 바로 쓰고 싶다면:

```bash
pnpm add github:josunghoon53/llm-runner
```

pnpm은 기본적으로 git 의존성의 빌드 스크립트를 막아두므로(보안 정책), 프로젝트 루트의 `pnpm-workspace.yaml`에 아래를 추가해야 `prepare` 스크립트(TypeScript 빌드)가 실행됩니다:

```yaml
onlyBuiltDependencies:
  - "llm-runner"
```

**npm으로 설치하고 싶다면** `npm install github:josunghoon53/llm-runner`도 되지만, npm 버전에 따라 git 의존성 설치 중 `Cannot read properties of null (reading 'edgesOut')`라는, llm-runner와 무관한 npm 자체 버그가 날 수 있습니다(이 경우 pnpm을 쓰거나 npm을 최신 버전으로 올려보세요).

구독 provider(`claude-subscription`, `openai-subscription`)를 쓰려면 로컬에 해당 CLI가 설치되고 로그인되어 있어야 합니다. 아래 명령으로 한 번에 확인·설치·로그인할 수 있습니다.

```bash
npx llm-runner-setup          # 설치/로그인 상태 확인
npx llm-runner-setup --login  # 설치는 됐는데 로그인이 안 된 CLI를 대화형으로 로그인
```

수동으로 하려면:

```bash
npm install -g @anthropic-ai/claude-code && claude login
npm install -g @openai/codex && codex login
```

앱 코드에서 미리 상태를 확인하고 싶으면:

```ts
import { checkSubscriptionSetup } from 'llm-runner';

const { claude, codex } = checkSubscriptionSetup();
if (!claude.loggedIn) {
  console.warn(`Claude 구독 미설정: ${claude.loginCommand} 실행 필요`);
}
```

## 사용법

```ts
import { createAiRunner, CLAUDE_SUBSCRIPTION_MODELS } from 'llm-runner';

const runner = createAiRunner({ provider: 'claude-subscription' });

const result = await runner.run({
  prompt: '이 코드 리뷰해줘',
  model: CLAUDE_SUBSCRIPTION_MODELS.OPUS,
  enableWebSearch: true,
});

console.log(result.text);
```

### Provider 4종

| provider | 인증 | 과금 |
|---|---|---|
| `claude-subscription` | 로컬 `claude login` 세션 | 구독 요금에 포함 (개인 사용 전제, 아래 참고) |
| `openai-subscription` | 로컬 Codex CLI ChatGPT 로그인 세션 | ChatGPT 구독 요금 |
| `claude-api` | `ANTHROPIC_API_KEY` | 토큰당 과금 |
| `openai-api` | `OPENAI_API_KEY` | 토큰당 과금 |

`.env`의 `AI_PROVIDER`로 전역 기본값을 정하거나, `createAiRunner({ provider: '...' })`로 명시적으로 고를 수 있습니다.

### NestJS처럼 설정 주입을 쓰는 프레임워크라면

llm-runner는 기본적으로 `process.env`를 직접 읽습니다. 하지만 NestJS의 `ConfigService`처럼 **설정의 단일 출처가 따로 있는 구조**라면, 환경변수에 의존하지 말고 값을 명시적으로 넘기세요:

```ts
{
  provide: AI_RUNNER,
  inject: [ConfigService],
  useFactory: (config: ConfigService) =>
    createAiRunner({
      provider: config.get<string>('AI_PROVIDER') as AiProvider,
      claudeApiKey: config.get<string>('ANTHROPIC_API_KEY'),
      claudeSubscriptionDefaultModel: config.get<string>('CLAUDE_SUBSCRIPTION_DEFAULT_MODEL'),
    }),
}
```

`ConfigModule.forRoot()`가 `.env`를 `process.env`에도 올려주므로 안 넘겨도 대개 동작하지만, 설정 출처가 두 개가 되면 나중에 원인을 찾기 어려워집니다. 실제 NestJS 프로젝트에 이식하면서 확인한 부분입니다.

### 프론트엔드(React 등)에서 쓰려면

`llm-runner`는 Node.js 전용이라 브라우저에서 직접 못 씁니다. 프론트 → 내 백엔드 API → `llm-runner` 구조로 감싸야 합니다. 바로 복붙해서 쓸 수 있는 Next.js 예제: [`examples/nextjs-starter/`](./examples/nextjs-starter/README.md)

### 옵션

```ts
interface AiRunOptions {
  prompt: string;
  system?: string;
  model?: string;
  maxTokens?: number;        // API 키 provider 전용
  enableWebSearch?: boolean; // 구독 provider 전용
}
```

## 스트리밍: `stream()`

`run()`은 답변이 완성될 때까지 기다렸다가 한 번에 돌려줍니다. 구독 provider는 이게 10초를 넘기는 일이 흔해서, 챗봇 UI를 만들면 그동안 화면이 비어 있습니다. `stream()`은 생성되는 대로 조각을 내보냅니다:

```ts
for await (const event of runner.stream({ prompt: '긴 설명을 써줘' })) {
  if (event.type === 'text') {
    process.stdout.write(event.text);          // 증분(전체 텍스트가 아님)
  } else if (event.type === 'done') {
    console.log('\n전체 답변:', event.result.text);
    console.log('사용량:', event.result.usage); // 마지막에 정확히 한 번
  }
}
```

이벤트는 이 두 가지가 전부입니다:

```ts
type AiStreamEvent =
  | { type: 'text'; text: string }              // 여러 번
  | { type: 'done'; result: AiRunResult };      // 마지막에 한 번
```

- `text` 이벤트는 **증분**입니다. 이어붙이면 마지막 `done`의 전체 텍스트와 정확히 같습니다.
- 마지막에 `done`이 정확히 한 번 오고, `result`는 `run()`이 돌려주는 것과 같은 형태입니다.
- 중간에 `break`로 빠져나오면 내부 연결과 프로세스를 정리합니다.

실측(같은 프롬프트 기준) — 빈 화면으로 기다리는 시간이 이만큼 줄어듭니다:

| provider | 첫 글자까지 | 완료까지 | 조각 수 |
|---|---|---|---|
| `claude-subscription` | 5.5초 | 13.5초 | 145 |
| `openai-subscription` | 5.1초 | 8.9초 | 171 |

> Codex 쪽엔 함정이 있었습니다. 공식 `@openai/codex-sdk`의 `runStreamed()`는 이름과 달리 **증분을 주지 않습니다** — 실제 이벤트를 찍어보니 완성된 텍스트를 `item.completed`로 한 번에 보내는 게 전부였습니다(조각 1개). 그래서 `stream()`은 글자 단위 증분을 보내주는 `codex app-server` 경로를 먼저 쓰고, 그게 안 되면 SDK 경로로 자동 폴백합니다(이 경우 텍스트가 한 덩어리로 오지만 동작은 동일). 폴백은 실제로 재현해서 확인했습니다.

## 정해진 모양으로 받기: `runStructured()`

텍스트를 받아서 직접 파싱하는 대신, JSON Schema를 주고 그 모양으로 받습니다:

```ts
const { data } = await runner.runStructured<{ sentiment: string; score: number }>({
  prompt: '이 리뷰의 감정을 분석해줘: "배송이 빨라서 좋았어요"',
  schema: {
    type: 'object',
    properties: { sentiment: { type: 'string' }, score: { type: 'number' } },
    required: ['sentiment', 'score'],
    additionalProperties: false,
  },
});

console.log(data.score); // 0.9 — 파싱까지 끝난 값
```

**강제 수준이 provider마다 다릅니다.** 이건 우리가 고를 수 있는 게 아니라 각 provider가 제공하는 장치의 차이입니다:

| provider | 방식 | 강제 주체 |
|---|---|---|
| `openai-api` | `response_format: json_schema` (strict) | 서버가 강제 |
| `claude-api` | 스키마를 입력으로 받는 도구를 강제 호출 | 서버가 강제 |
| `openai-subscription` | Codex `outputSchema` | Codex가 강제 |
| `claude-subscription` | 프롬프트로 지시 + 결과 파싱 | **모델의 선의** |

즉 스키마 준수가 중요한 기능이라면 `claude-subscription`은 피하세요. 그 경로도 코드펜스나 앞뒤 설명이 섞여 오는 흔한 경우는 파싱해내지만, 원천 차단은 아닙니다.

**스키마는 손대지 않고 provider에 그대로 전달됩니다.** 그래서 어떤 JSON Schema 키워드가 통하는지는 provider가 정합니다. 안전하게 쓰려면 `type` / `properties` / `items` / `required` / `enum` / `description` 정도로 제한하세요 — 이 범위는 네 provider 모두에서 확인했습니다.

> ⚠️ `openai-api`는 strict 모드로 보내기 때문에 제약이 가장 빡빡합니다: 모든 객체에 `additionalProperties: false`가 있어야 하고, `properties`의 **모든** 키가 `required`에 들어가야 합니다(선택 항목은 `required`에서 빼는 대신 `type: ['string', 'null']`로 표현). 이 조건을 어기면 호출이 에러로 거부됩니다. 다른 provider는 이만큼 까다롭지 않으므로, 한 스키마를 여러 provider에 돌려 쓸 생각이면 가장 빡빡한 이 규칙에 맞춰 두는 게 안전합니다.

## 토큰 사용량과 비용

`run()`/`stream()`/`runStructured()`의 결과에 `usage`가 함께 옵니다:

```ts
const result = await runner.run({ prompt: '...' });
console.log(result.usage);
// { inputTokens: 909, outputTokens: 558, cachedInputTokens: 0, reasoningTokens: 0, costUsd: 0.101849 }
```

- **값이 없는 건 0이 아니라 "그 provider가 안 알려준다"는 뜻**입니다. 합산해서 보여줄 때 주의하세요.
- **`createSession()` 안에서도 `usage`는 "그 턴 하나"의 사용량입니다.** 그래서 턴마다 더하면 세션 전체 사용량이 됩니다.
  > 참고: Claude SDK는 세션에서 **누적 합계**를 돌려주기 때문에 그대로 쓰면 턴마다 합산했을 때 비용이 몇 배로 부풀려집니다. llm-runner가 직전 값을 빼서 턴별 값으로 바꿔주므로 신경 쓸 필요가 없습니다 — 장시간 테스트에서 한 세션의 캐시 입력이 22만 토큰(컨텍스트 한도보다 큰 값)으로 찍히는 걸 보고 발견해서 고쳤습니다.
- `costUsd`는 provider가 금액을 직접 알려줄 때만 채웁니다(현재 `claude-subscription`). 나머지는 토큰 수만 주기 때문에, 단가표를 들고 곱하면 모델 가격이 바뀔 때 조용히 틀린 값이 됩니다 — **추정치를 지어내지 않습니다.** 금액이 필요하면 토큰 수를 각자의 단가로 곱하세요.

## 여러 턴 대화: `createSession()`

`run()`을 여러 번 부르면 매번 새 `claude` 프로세스를 spawn한다(측정 기준 5~10초/회). 여러 개의 **독립적인** 작업을 처리하는 거라면(예: 종목 A 분석 다음에 종목 B 분석) 이게 맞는 동작이다 — 서로 맥락이 섞이면 안 되니까.

하지만 진짜로 **한 대화가 이어져야 하는** 경우(예: 사용자와 여러 턴 주고받는 상담)라면, 매번 새로 spawn하는 대신 프로세스 하나를 계속 물고 있는 세션을 쓸 수 있다:

```ts
const runner = createAiRunner({ provider: 'claude-subscription' });
const session = runner.createSession({ system: '너는 친절한 상담원이다' });

const r1 = await session.send('안녕, 나는 김철수야');
const r2 = await session.send('내 이름이 뭐라고 했지?');     // "김철수"라고 정확히 답함

session.close(); // 다 쓰면 반드시 호출 — 안 하면 프로세스가 안 죽는다
```

### 속도에 대해 (기대치를 정확히 맞추세요)

세션이 없애주는 비용은 **프로세스 시작 비용 하나뿐**입니다(측정 기준 약 5초). 그래서 효과가 답변 길이에 따라 완전히 달라집니다:

| 상황 | 1턴 | 2턴 | 3턴 | 4턴 |
|---|---|---|---|---|
| 답변이 짧을 때 (한두 단어) | 5.0초 | 1.5초 | 1.9초 | — |
| 답변이 길 때 (상담형, 턴당 1,000자 이상) | 24.5초 | 20.8초 | 19.8초 | 17.7초 |

**답변이 길면 생성 시간이 지배해서 세션 재사용 이득이 거의 안 보입니다.** 짧은 답변을 여러 번 주고받는 구조에서만 체감상 빨라집니다.

#### 그래서 상담봇 같은 걸 만든다면 `sendStream()`을 쓰세요

총 시간은 줄일 수 없지만(생성 시간이라서), **사용자가 빈 화면을 보는 시간**은 줄일 수 있습니다:

```ts
for await (const event of session.sendStream('예산 안에서 뭘 사면 좋을까?')) {
  if (event.type === 'text') process.stdout.write(event.text);
}
```

| | `send()` — 다 될 때까지 대기 | `sendStream()` — 첫 글자까지 |
|---|---|---|
| Claude 1턴 | 24.4초 | **6.0초** |
| Claude 2턴 | 20.1초 | **2.5초** |
| Codex 3턴 | 30.9초 | **4.4초** |

`send()`와 완전히 같은 대화에 속하므로 맥락도 그대로 이어집니다. 다만 Codex의 안정 경로(공식 SDK)는 증분을 못 주기 때문에, 폴백된 상태에서는 답변이 한 덩어리로 도착합니다 — 인터페이스는 같으니 코드를 바꿀 필요는 없습니다.

> 이 표는 외부 테스터가 "문서의 숫자가 재현되지 않는다"고 지적해서 다시 측정한 결과입니다. 이전 판에는 짧은 답변 기준 숫자만 적혀 있어서, 실무형 대화를 만드는 사람에게 2~3배 빨라진다는 잘못된 기대를 줬습니다.

또 하나, **구독 provider는 응답 시간의 편차가 큽니다.** 같은 세션 안에서도 턴마다 8초와 48초가 섞여 나오는 걸 실제로 관측했습니다(Codex 기준). 사용자에게 보여주는 기능이라면 로딩 표시와 타임아웃을 반드시 넣으세요.

세션을 쓸 때 지켜야 할 것:

- **`send()`는 반드시 이전 호출의 결과를 기다린 다음에 불러야 한다** (동시에 여러 번 부르지 않는다)
- **서로 무관해야 하는 작업에는 절대 세션을 재사용하지 마라.** 대화가 이어지는 구조라서 이전 턴의 내용이 다음 턴에 그대로 섞인다 — 직접 검증한 결과, "아까 그 종목 목표주가가 얼마였지?"처럼 이전 턴 내용을 정확히 기억해서 답한다. 종목별 분석처럼 독립성이 중요한 작업이면 세션 대신 `run()`을 각각 새로 불러라.
`claude-api`/`openai-api`는 원래 매 호출이 빠르고 stateless라 이 기능이 필요 없다.

### `openai-subscription`(Codex)의 `createSession()`도 같은 방식으로 동작한다

```ts
const runner = createAiRunner({ provider: 'openai-subscription' });
const session = runner.createSession();

const r1 = await session.send('내가 좋아하는 숫자는 47이야');
const r2 = await session.send('내가 좋아하는 숫자가 뭐였지?');  // "47" — 맥락 유지됨
const r3 = await session.send('거기에 3을 더하면?');           // "50"

session.close();
```

Codex는 여기까지 오는 데 우회로가 하나 필요했다. 공식 `@openai/codex-sdk`는 `Thread`를 재사용해도 **매 호출마다 새 `codex exec` 프로세스를 spawn하고 stdin을 즉시 닫는** 구조라(소스 코드로 직접 확인) 재사용 효과가 전혀 없다. 그래서 `createSession()`은 내부적으로 `codex app-server`(OpenAI가 CLI에서 스스로 `[experimental]`이라고 표시한 JSON-RPC 프로토콜)를 직접 말해서 프로세스 하나를 계속 살려둔다.

**그런데 실험적 프로토콜에 기대는 게 왜 괜찮은가?** 깨지면 자동으로 공식 SDK 경로로 내려앉기 때문이다. 즉 최악의 경우가 "앱이 죽는다"가 아니라 **"턴마다 조금 느려진다"**로 한정된다. 두 가지 실패를 모두 실제로 재현해서 검증했다:

| 실패 상황 | 실제 결과 |
| --- | --- |
| Codex CLI가 `app-server`를 아예 모르는 경우 (미래 버전 시뮬레이션) | 경고 한 줄 남기고 공식 SDK 경로로 시작 → 정상 응답, 맥락 유지 (턴당 5.5초) |
| 대화 도중 `app-server` 프로세스를 강제 종료(`pkill`) | 경고 후 자동 전환 + 지금까지의 대화를 복구 프롬프트로 이어붙임 → 이전 턴 내용("47")을 그대로 기억 |

속도보다 예측 가능성이 중요하면 `createSession({ fastMode: 'off' })`로 항상 공식 SDK 경로만 쓰게 할 수 있다. 웹 검색(`enableWebSearch: true`)은 빠른 경로가 지원하지 않아 자동으로 공식 경로를 쓴다.

#### 폴백은 조용히 일어납니다 — 배포했다면 꼭 연결하세요

폴백의 대가는 "앱이 안 죽는 대신 **조용히 느려진다**"는 것입니다. 로컬에서는 stderr 경고가 보이지만 **서버리스에서는 그 경고가 아무 데도 안 남아서**, 몇 달간 느린 경로로만 돌아도 알 수 없습니다. 그래서 두 가지를 제공합니다:

```ts
const runner = createAiRunner({
  provider: 'openai-subscription',
  onFallback: (event) => logger.warn('llm-runner 폴백', event),
  // { feature: 'session', phase: 'start', from: 'codex-app-server', to: 'codex-sdk', reason: '...' }
});

const session = runner.createSession();
await session.send('...');
console.log(session.activePath); // 'fast' | 'stable' (첫 send 전에는 'pending')
```

- `onFallback`: 내려앉는 **순간**을 구조화된 이벤트로 받습니다. `phase`가 `'start'`면 처음부터 못 쓴 것이고 `'mid-session'`이면 쓰다가 끊긴 것이라 원인이 다릅니다.
- `session.activePath`: **지금** 어느 경로인지 확인합니다. 성능이 기대와 다르면 여기부터 보세요.

핸들러를 주면 stderr 경고는 생략되고(같은 내용을 두 번 알리지 않음), 핸들러에서 예외가 나도 AI 호출은 그대로 성공합니다.

`claude-subscription`의 `createSession()`과 똑같은 오염 규칙이 적용된다 — 직접 검증함: 같은 세션 안에서는 이전 턴 내용을 정확히 기억하고(의도된 동작), 서로 다른 세션 인스턴스는 완전히 격리된다. 그래서 **서로 무관해야 하는 작업(종목 A 분석, 종목 B 분석 등)은 매번 새 세션을 만들어야 하고, 세션 하나를 여러 독립 작업에 재사용하면 안 된다.**

### 빠른 경로를 직접 제어하고 싶다면 — `llm-runner/experimental`

폴백 없이 `codex app-server`만 쓰고 싶다면(예: 느려지느니 차라리 에러를 받고 싶은 경우) 하위 구현을 직접 쓸 수 있다:

```ts
import { createExperimentalCodexAppServerSession } from 'llm-runner/experimental';

const session = await createExperimentalCodexAppServerSession({ model: 'gpt-5.6-luna' });
await session.send('1+1은?');
session.close();
```

⚠️ 이 경로는 폴백이 없으므로 **OpenAI가 프로토콜을 바꾸면 그대로 실패한다.** 특별한 이유가 없다면 `createSession()`을 써라. 10턴 연속 실행, 실무형 긴 프롬프트, 요청/턴 타임아웃, 프로세스 실행 실패 시 즉시 에러 처리까지 실제로 검증했다.

## 대량 배치로 돌릴 때 (수십~수백 건 처리)

문서를 수백 건 분석하는 배치를 만든다면, **세션은 답이 아닙니다.** 각 건이 서로 독립적이어야 하니 세션으로 묶으면 안 되고(맥락이 섞임), `run()`을 순서대로 부르면 건당 5~6초가 그대로 쌓입니다.

실제로 재보니 **답은 동시 실행**이었습니다. 5건씩 동시에 돌렸을 때:

| provider | 순차 1건 | 동시 5건(각각) | 처리량 |
|---|---|---|---|
| `claude-subscription` | 5.7초 | 9.4초 | **약 3.0배** |
| `openai-subscription` | 5.6초 | 6.3초 | **약 4.4배** |

동시 실행하면 건당 시간은 늘지만 전체 처리량은 크게 좋아집니다. 그리고 **Codex 쪽이 동시 실행을 훨씬 잘 견딥니다**(건당 5.6→6.3초로 거의 안 늘어남). 구독으로 배치를 돌려야 한다면 이 차이를 고려하세요.

```ts
// 예: 5건씩 묶어서 처리
for (const batch of chunk(documents, 5)) {
  const results = await Promise.all(batch.map((doc) => runner.run({ prompt: build(doc) })));
  // ...
}
```

동시 실행 수를 계속 올린다고 계속 빨라지지는 않습니다(위 표에서도 5배가 아니라 3~4.4배). 그리고 구독은 사용량 제한이 있으니, 정말 큰 배치라면 애초에 API 키 provider가 맞습니다.

### 누수 걱정 없이 오래 돌려도 되나

구독 provider는 호출마다 자식 프로세스를 띄우기 때문에, 오래 돌리면 프로세스나 파일 핸들이 쌓일 수 있다는 의심이 자연스럽습니다. 그래서 부하 테스트를 만들어 직접 확인했습니다:

```bash
node scripts/load-test.mjs claude-subscription   # 저장소를 클론했다면
```

각 provider당 105회 호출(순차 40 + 스트림 중도 포기 25 + 한 세션 25턴 + 동시 5건×3라운드)을 8분간 돌린 결과, **두 provider 모두 실패 0건, 프로세스 누수 0건, 파일 핸들 누수 0건**이었고 응답 시간도 뒤로 갈수록 느려지지 않았습니다(변화 ±0.7초 이내). 스트림을 첫 글자에서 끊고 버리는 경우에도 프로세스가 남지 않는 것까지 확인했습니다.

> 다만 정직하게 말하면 이건 **8분·105회 규모**입니다. 몇 시간짜리 배치나 수천 건 규모에서도 같은지는 아직 확인하지 않았습니다.

### 오래 열어두는 세션은 괜찮나 (상담봇처럼 뜸하게 오가는 경우)

사용자가 답을 읽고 몇 분 뒤에 다음 질문을 보내는 동안 세션이 끊기지 않는지는, 호출을 많이 한다고 확인되지 않습니다. 그래서 시간을 길게 끄는 테스트를 따로 만들었습니다:

```bash
node scripts/longevity-test.mjs claude-subscription
```

세션을 60초 → 120초 → 180초씩 방치한 뒤 매번 이전 맥락을 물어본 결과, **두 provider 모두 3분 방치 후에도 세션과 맥락이 살아있었고 재연결 지연도 없었습니다**(방치 후 응답 시간이 연속 호출 때와 동일). 400자 답변을 8턴 누적시켰을 때도 응답 시간이 느려지지 않았고 첫 턴 내용을 그대로 기억했습니다.

## 기본적으로 도구는 다 잠겨 있습니다

Claude Code CLI와 Codex CLI는 원래 코딩 에이전트라서, 그냥 두면 파일 쓰기·Bash 명령 실행·웹 검색이 다 가능합니다. 이 패키지는 텍스트 생성 전용으로 쓰기 위해 **기본적으로 모든 도구를 차단**하고, `enableWebSearch: true`를 줬을 때만 웹 검색만 열어줍니다.

## 검증된 함정들

직접 테스트하며 확인한, 문서에 잘 안 나오는 것들:

- **Claude: `allowedTools: []`만으로는 도구가 안 막힌다.** 실제로 Bash를 통해 우회 실행되는 걸 확인했다. `disallowedTools`로 도구 이름을 명시해야 진짜로 막힌다.
- **Codex: `sandboxMode: 'read-only'`도 명령 실행 자체는 못 막는다.** 파일 쓰기·네트워크는 확실히 막지만, `ls`/`pwd` 같은 부작용 없는 명령은 policy와 무관하게 실행된다. SDK/CLI 레벨에서 명령 실행 자체를 원천 차단하는 옵션은 없다.
- **Codex: `approvalPolicy: 'untrusted'`는 타입 정의엔 있지만 실제 CLI(0.154.0+)에서 deprecated라 런타임 에러가 난다.** `on-request`를 쓴다.
- **Claude 모델 별칭(`haiku`/`sonnet`/`opus`)과 API 전체 ID(`claude-sonnet-5`)는 다른 이름 공간이다.** CLI는 별칭을, Messages API는 전체 ID만 받는다.
- **OpenAI는 일반 채팅 완성을 구독으로 헤드리스 호출하는 공식 경로가 없다.** 구독 헤드리스가 공식으로 열려있는 건 Codex(코딩 에이전트) 용도뿐이라, `openai-subscription` provider는 내부적으로 Codex SDK를 쓴다.
- **API 키가 없으면 SDK 생성자가 즉시 예외를 던진다.** 그래서 `claude-api`/`openai-api` provider는 키가 없어도 인스턴스 생성 자체는 통과시키고, 실제 실패는 `run()` 호출 시점으로 미룬다.
- **Codex 기본 모델(`gpt-5.6-luna`)이 "at capacity"로 거절되는 일이 실제로 있다.** 그래서 `openai-subscription`은 `model`을 지정하지 않은 경우에 한해 한 단계 위 모델(`terra`)로 한 번 자동 재시도하고 stderr에 알린다. 모델을 직접 지정했으면 바꿔치기하지 않는다.
- **구독 provider(`claude-subscription`/`openai-subscription`)는 API 키 방식보다 응답이 훨씬 오래 걸릴 수 있다.** CLI 에이전트 하네스를 통째로 띄우는 구조라 실측 기준 10초 이상 걸리는 경우가 흔하다. 챗봇 UI를 만든다면 "생각 중..." 같은 로딩 표시를 반드시 넣어라 — 안 그러면 사용자가 "멈췄나?" 하고 화면을 닫아버린다.
- **`createAiRunner()`를 모듈 최상단(top-level)에서 호출하면 Next.js 빌드 자체가 실패할 수 있다.** 구독 provider를 명시하면 `checkCliOnCreate`가 즉시 PATH에서 CLI를 찾는데, Next.js는 API 라우트 파일을 빌드 중 "Collecting page data" 단계에서 한 번 import해서 실행해본다 — 이때 빌드 서버(Vercel 등)엔 당연히 `claude`/`codex` CLI가 없으니 빌드가 죽는다. `createAiRunner()`는 요청 핸들러 안에서 지연 생성(예: 메모이즈된 함수)하는 걸 권장한다 — `examples/nextjs-starter/app/api/ai/route.ts`가 이 패턴을 쓴다.
- **`claude-agent-sdk`를 Next.js/Vercel에 배포하면 `Native CLI binary for linux-x64 not found` 에러가 난다.** 플랫폼별 네이티브 바이너리가 optionalDependency로 동적 로드되는데, Next.js의 빌드 파일 추적이 이걸 못 잡아서 배포 결과물에서 빠지기 때문이다. `next.config.ts`에 `outputFileTracingIncludes`로 명시적으로 포함시켜야 한다(아래 "서버리스/배포 환경에서 쓰기" 참고). 실제로 Vercel 프로덕션에 배포해서 이 순서(등록 전 실패 → 설정 추가 후 실제 응답 성공)를 확인했다.
- **`CLAUDE_CODE_OAUTH_TOKEN`을 잘못 붙여넣으면 `401 OAuth access token is invalid`가 나는데, 이 메시지만으로는 원인을 알 수 없다.** 터미널의 자동 줄바꿈 표시 때문에 토큰이 일부만 복사되거나 공백이 섞여 들어가기 쉽다. 이 에러가 나면 토큰 자체보다 복사 과정을 먼저 의심하고, 필요하면 새로 발급받아 다시 붙여넣어라.

## 서버리스/배포 환경에서 쓰기

구독형 provider는 원래 로그인 세션이 **그 컴퓨터의 파일시스템**(`~/.claude/`, `~/.codex/`)에 저장됩니다. VPS나 직접 관리하는 서버는 한 번 로그인해두면 계속 살아있어서 문제없지만, 서버리스(Lambda, Vercel Functions)처럼 인스턴스가 매번 새로 뜨는 환경은 콜드스타트마다 세션이 사라집니다.

**해결: 로그인 세션을 환경변수(비밀 값)로 옮겨서 콜드스타트마다 복원합니다.**

> ⚠️ **`claude setup-token`은 AI 어시스턴트가 대신 실행해줄 수 없습니다.** 브라우저 로그인 후 화면에 뜨는 코드를 사람이 직접 터미널에 붙여넣어야 하는 대화형(인터랙티브) 명령이라서, Claude Code 같은 어시스턴트가 백그라운드나 자동화된 방식으로 실행하면 그냥 멈춥니다. **사용자 본인이 자기 터미널(또는 Claude Code와 직접 대화하는 그 터미널 화면)에서 명령을 치고 로그인까지 완료**해야 합니다. AI 어시스턴트는 "이 명령을 터미널에 쳐서 나온 값을 저한테 알려주세요"까지만 안내할 수 있습니다.

### Claude
```bash
# 로그인된 로컬 머신의 실제 터미널에서, 사용자가 직접 실행 — 장기 유효 토큰 발급
claude setup-token
```
출력된 토큰을 배포 환경의 `CLAUDE_CODE_OAUTH_TOKEN` 비밀 값으로 저장하세요. SDK가 이 환경변수를 자동으로 읽어서, 파일 복원 없이 바로 동작합니다.

**"배포 환경의 비밀 값으로 저장"이 구체적으로 뭘 뜻하냐면 (Vercel 기준 예시):**
1. https://vercel.com 에서 내 프로젝트로 들어간다
2. 상단 메뉴 **"Settings"** 클릭 → 왼쪽 메뉴에서 **"Environment Variables"** 클릭
3. Key(이름)에 `CLAUDE_CODE_OAUTH_TOKEN`, Value(값)에 방금 발급받은 토큰을 붙여넣고 **"Save"**
4. 이미 배포돼 있었다면 다시 배포(Redeploy)해야 새 환경변수가 적용된다

다른 서비스(Railway, Render, AWS 등)를 쓴다면 "Environment Variables" 또는 "Secrets" 메뉴를 찾으면 된다 — 이름은 다들 비슷하다.

> ⚠️ **토큰을 붙여넣을 때 줄바꿈/공백이 섞이지 않게 조심하세요.** 터미널이 긴 토큰 문자열을 화면 너비에 맞춰 자동으로 줄바꿈해서 보여주는 경우가 있는데, 그건 화면 표시일 뿐 실제 줄바꿈이 아닙니다. 일부만 복사되거나 앞뒤에 공백/개행이 붙으면 `401 OAuth access token is invalid` 에러가 나는데, 이 에러 메시지만 봐서는 "토큰 자체가 잘못됐다"는 건지 "복사가 잘못됐다"는 건지 구분이 안 됩니다 — 실제로 겪어본 결과, 새로 토큰을 발급받아 다시 깨끗하게 붙여넣으니 해결됐습니다.

**Next.js(Vercel)를 쓴다면 배포 설정에 한 가지를 더 추가해야 합니다.** Claude와 Codex 둘 다 플랫폼별 네이티브 실행파일을 optionalDependency로 설치하는데, 이게 동적으로 로드되는 방식이라 Next.js의 빌드 파일 추적(file tracing)이 자동으로 감지하지 못해 배포 결과물에서 빠집니다. 그러면 실제 호출 시 `Native CLI binary for linux-x64 not found`(Claude)나 `spawn codex ENOENT`(Codex) 에러가 납니다.

`next.config.ts`를 `withLlmRunner()`로 감싸면 필요한 설정이 자동으로 들어갑니다:

```ts
import type { NextConfig } from 'next';
import { withLlmRunner } from 'llm-runner/next';

const nextConfig: NextConfig = withLlmRunner({}, {
  routes: ['/api/ai'],                  // llm-runner를 호출하는 라우트만
  providers: ['claude-subscription'],   // 생략하면 설치된 패키지로 자동 감지
});

export default nextConfig;
```

- `routes`: 기본값은 `['/api/**']`. **바이너리가 라우트마다 따로 복사되므로**(Claude 200MB대, Codex 300MB대) 실제로 호출하는 라우트만 좁혀 적는 게 좋습니다.
- `providers`: 생략하면 Claude는 항상 포함하고, Codex는 `@openai/codex`가 의존성에 있을 때만 포함합니다. API 키 provider만 쓴다면 `providers: []`로 아무것도 넣지 마세요.
- 기존 `outputFileTracingIncludes` 설정이 있으면 덮어쓰지 않고 합칩니다. provider별로 라우트를 다르게 두고 싶으면 아래처럼 중첩해서 쓸 수 있습니다:

```ts
const nextConfig: NextConfig = withLlmRunner(
  withLlmRunner({}, { routes: ['/api/chat'], providers: ['claude-subscription'] }),
  { routes: ['/api/codex'], providers: ['openai-subscription'] },
);
```

### Codex

> ⚠️ **먼저 읽으세요 — 두 가지 함정이 있습니다.**
> 1. **`CODEX_ACCESS_TOKEN`을 쓰지 마세요.** 이름만 보면 이걸 쓸 것 같지만, **개인 ChatGPT 계정에서는 원천적으로 동작하지 않습니다**(ChatGPT Business/Enterprise 전용). 아래 `CODEX_AUTH_JSON`을 쓰세요. 자세한 이유는 이 절 뒤쪽에 있습니다.
> 2. **로컬 빌드가 성공해도 배포가 된다는 뜻이 아닙니다.** 이유는 바로 아래 "배포 전에 반드시 확인할 것"을 보세요.

#### 배포 전에 반드시 확인할 것 (가장 흔한 실패)

네이티브 바이너리는 **OS별로 다른 패키지**로 설치됩니다(`@openai/codex-darwin-arm64`, `@openai/codex-linux-x64` …). 내 맥에서 `npm install`하면 macOS용만 설치되고, Vercel이 실제로 쓰는 **linux-x64용은 내 컴퓨터에 아예 없습니다.**

그래서 **로컬에서 `npm run build`가 성공한 건 리눅스 배포가 된다는 증거가 전혀 아닙니다.** (Vercel은 빌드를 리눅스에서 돌리므로 거기선 리눅스용이 설치됩니다 — 원리상 동작하고 실제 프로덕션 배포로 확인도 했지만, **그 확인을 배포 전에 내 컴퓨터에서 할 방법은 없습니다.**)

그러니 배포 직후 **실제로 한 번 호출해보기 전까지는 된다고 믿지 마세요.** 이런 점검용 엔드포인트를 하나 만들어 두고 배포할 때마다 찔러보는 걸 권합니다:

배포 **전에는** 로컬에서 잡을 수 있는 설정 실수를 이 명령으로 먼저 거르세요:

```bash
npx llm-runner-setup --check-deploy
```

`@openai/codex`가 의존성에 제대로 들어있는지, `withLlmRunner()`의 `routes`가 실제 API 라우트와 맞는지를 확인해줍니다(이 둘이 배포 실패의 대부분입니다). 다만 **리눅스용 바이너리가 실제로 실릴지는 이 명령도 확인할 수 없습니다** — 그건 배포 후에만 알 수 있습니다.

```ts
// app/api/health/route.ts — 배포 후 이걸 먼저 호출해서 바이너리가 실렸는지 확인한다
import { tryResolveCodexBinaryPath } from 'llm-runner';

export async function GET() {
  const codexPath = tryResolveCodexBinaryPath(); // 못 찾으면 undefined
  return Response.json({
    codexBinaryFound: Boolean(codexPath),
    platform: `${process.platform}-${process.arch}`,
  });
}
```

`codexBinaryFound: false`가 나오면 `withLlmRunner()`의 `routes`가 실제 라우트 경로와 안 맞거나 `@openai/codex`가 의존성에 없는 것입니다. 이 점검은 AI를 호출하지 않으므로 비용도 시간도 들지 않습니다.

**개인 ChatGPT Plus/Free 계정이면 `CODEX_AUTH_JSON`을 써라 (권장, 직접 검증됨):**

```bash
# Vercel을 쓴다면 — 값을 화면에 한 번도 띄우지 않고 바로 등록한다 (가장 안전)
npx llm-runner-setup --codex-auth-json --vercel

# 다른 배포 환경이라면 — 값을 출력해서 직접 붙여넣는다
npx llm-runner-setup --codex-auth-json
```

OS별 `base64`/`pbcopy` 명령 차이를 몰라도 되고, 파일 위치도 몰라도 된다. `--vercel`은 값을 터미널에 출력하지 않고 `vercel env add`의 stdin으로 곧장 흘려보내므로, 화면·스크롤백·셸 히스토리 어디에도 시크릿이 남지 않는다(환경을 바꾸려면 `--env preview`, 팀 계정이면 `--scope <팀>`을 덧붙인다). 직접 출력하는 경우엔 민감한 값이니 캡처나 공유는 하지 말 것.

나온 값을 배포 환경의 `CODEX_AUTH_JSON` 비밀 값으로 저장하세요. `createAiRunner({ provider: 'openai-subscription' })`을 만들 때 이 값이 있으면, `codex login`을 거치지 않고 그 내용을 그대로 `$CODEX_HOME/auth.json`에 써서 세션을 복원합니다 — 복원은 자동이라 따로 부를 함수가 없습니다.

> ⚠️ **`CODEX_ACCESS_TOKEN` + `codex login --with-access-token` 방식은 개인 계정에서 동작하지 않습니다** — 직접 검증함. 이 방식은 **ChatGPT Business/Enterprise 워크스페이스 관리자 콘솔에서 발급한 토큰만 지원**하며, 개인 계정의 일반 세션 토큰을 넣으면 `agent identity JWT payload is not valid JSON`라는, 원인을 짐작하기 어려운 에러로 실패합니다. Business/Enterprise 워크스페이스를 쓰는 게 아니라면 `CODEX_ACCESS_TOKEN`을 시도하지 말고 바로 `CODEX_AUTH_JSON`을 쓰세요.

**Business/Enterprise 워크스페이스면 `CODEX_ACCESS_TOKEN`도 여전히 지원합니다:**
```bash
cat ~/.codex/auth.json   # tokens.access_token 값 확인
```
이 값을 `CODEX_ACCESS_TOKEN`으로 저장하면 `codex login --with-access-token`으로 복원합니다. `CODEX_AUTH_JSON`이 있으면 이쪽보다 우선 적용됩니다.

**⚠️ 환경변수 스냅샷만 쓰면 시간이 지나 조용히 깨집니다 — `codexAuthStore`를 설정하세요.** `auth.json` 안의 `refresh_token`은 보통 1회용(rotating)이라서, 배포된 함수가 만료된 토큰을 갱신할 때마다 새로 발급되고 예전 값은 무효화됩니다. 그 갱신분은 함수 인스턴스가 죽으면 사라지고, 다음 콜드스타트는 처음 넣어둔 예전 스냅샷을 다시 씁니다.

`codexAuthStore`에 **"어디에 저장할지"만 알려주면 갱신 감지와 저장은 llm-runner가 알아서 합니다**:

```ts
import { createAiRunner } from 'llm-runner';

const runner = createAiRunner({
  provider: 'openai-subscription',
  codexAuthStore: {
    load: () => kv.get<string>('codex-auth'),      // 없으면 undefined를 주면 된다
    save: (value) => kv.set('codex-auth', value),  // 저장소는 아무거나 — KV, Redis, DB, S3
  },
});
```

동작 순서는 이렇습니다:

1. 첫 호출 직전에 `load()`를 읽는다. 값이 있으면 **그게 최신**이므로 그걸로 세션을 복원한다.
2. 비어 있으면 `CODEX_AUTH_JSON` 환경변수로 복원하고, 그 값을 `save()`로 한 번 심어둔다. 이후로는 store가 원본이 되고, 환경변수는 최초 부트스트랩용으로만 쓰인다.
3. 매 호출 후 `auth.json`이 실제로 바뀌었는지 해시로 비교해서, **바뀌었을 때만** `save()`를 부른다.

`save()`가 실패해도 예외를 던지지 않고 경고만 남깁니다 — 이미 성공한 AI 호출 결과까지 날려버리면 안 되니까요.

> ⚠️ **동시 갱신 경쟁은 두 종류이고, 하나만 llm-runner가 막아줍니다.**
>
> **① 한 프로세스 안에서의 경쟁 — llm-runner가 막습니다.** 요청 두 개가 거의 동시에 끝나면 둘 다 "새 토큰이 생겼다"고 판단해서 `save()`를 중복 호출할 수 있습니다(저장이 끝나기 전엔 서로의 진행을 모르므로). 이건 실제 버그였고, 지금은 저장을 프로세스 안에서 한 번에 하나씩만 돌리도록 직렬화해서 해결했습니다 — 동시 5건으로 재현 테스트까지 넣어뒀습니다.
>
> **② 여러 인스턴스 사이의 경쟁 — 막아줄 수 없습니다.** 서버리스는 인스턴스가 여러 개 동시에 뜨는데, 그중 둘이 같은 낡은 스냅샷에서 출발해 각자 토큰을 갱신하면 **먼저 갱신한 쪽의 refresh_token이 무효화**됩니다. 그러면 나중에 저장된 값이 store를 덮어써서, 무효가 된 값이 최신인 것처럼 남을 수 있습니다. 토큰 회전 자체가 "먼저 쓴 사람이 이긴다" 구조라, 이건 저장소 쪽에서 막아야 합니다.
>
> 그래서 `save()`에는 **직전에 알고 있던 값**이 함께 넘어옵니다. 저장소가 조건부 쓰기를 지원한다면 이걸로 남의 갱신을 덮어쓰는 걸 막을 수 있습니다:
> ```ts
> save: async (value, context) => {
>   // "현재 값이 context.previous일 때만 쓴다" — 아니면 다른 인스턴스가 이미 갱신한 것이니 포기한다
>   await kv.compareAndSet('codex-auth', context?.previous, value);
> },
> ```
>
> 트래픽이 적고 인스턴스가 사실상 하나인 개인용 서비스에서는 거의 문제가 되지 않습니다. 하지만 동시성이 있는 서비스라면 다음 중 하나를 권합니다.
> - **위처럼 조건부 쓰기(CAS)를 지원하는 저장소로 구현**하기
> - 애초에 **`claude-api`/`openai-api`(API 키)로 가기** — 이 문제 자체가 존재하지 않습니다
>
> 덧붙여 정직하게 밝히면, **"refresh_token이 실제로 언제 회전되는지"는 몇 주 단위라 이 기능을 만들면서 실제로 재현해보지 못했습니다.** 회전이 일어난다는 전제 위에 설계된 안전장치이고, 회전 감지·저장 동작 자체는 검증했지만 실서비스에서의 회전 시점은 미검증입니다.

실제 검증: 격리된 `CODEX_HOME`에서 store를 비운 채 시작 → 환경변수로 복원되어 실제 Codex 호출 성공 → store에 값이 심어짐 → `auth.json`을 변조해 회전을 흉내 내니 변경이 감지되어 store가 새 값으로 갱신되는 것까지 확인했습니다. (다만 "리프레시 토큰이 실서비스에서 실제로 로테이션되는 시점"은 몇 주 단위라 이 세션에서 재현하지 못했습니다.)

store 없이 직접 파이프라인을 짜고 싶으면 `getRefreshedCodexAuthJson()`으로 최신 값을 꺼낼 수 있고, 지금 토큰이 언제 만료되는지는 `checkCodexAuthFreshness()`(또는 `npx llm-runner-setup`)로 확인할 수 있습니다 — 토큰 값 자체는 반환하지 않고 만료 시각만 알려줍니다.

**바이너리는 알아서 찾습니다.** `@openai/codex-sdk`(공식 SDK)는 `@anthropic-ai/claude-agent-sdk`와 달리 자체 네이티브 바이너리를 안 쓰고 PATH의 `codex` 실행파일에 의존합니다. 서버리스엔 그게 없으므로 번들된 바이너리가 필요한데, 이 과정은 자동화되어 있습니다:

1. 프로젝트에 `@openai/codex`를 일반 의존성으로 설치한다 (전역 설치 아님): `npm install @openai/codex`
2. `next.config.ts`를 위에서 설명한 `withLlmRunner()`로 감싼다 (`providers`를 생략하면 `@openai/codex` 설치를 감지해 자동 포함).
3. 코드는 평소대로 쓴다 — **경로를 직접 지정할 필요가 없다**:
   ```ts
   const runner = createAiRunner({ provider: 'openai-subscription' });
   ```
   PATH에 `codex`가 있으면 그걸 쓰고(로컬 개발), 없으면 번들된 `@openai/codex-<platform>` 바이너리를 자동으로 찾습니다(서버리스). 자동 탐지가 통하지 않는 특이한 배포 구조에서만 `codexPathOverride`를 직접 주면 되고, 경로는 `resolveCodexBinaryPath()`로 얻을 수 있습니다.

이 절차 전체를 실제 Vercel 프로덕션에 배포해서, 코드에 경로를 한 줄도 쓰지 않은 상태로 개인 ChatGPT Plus 계정의 진짜 응답을 받는 것까지 확인했습니다.

## 구독 사용 시 알아야 할 것

### 설계 원칙: 이 패키지는 OAuth를 직접 구현하지 않습니다

`ClaudeSubscriptionRunner`, `OpenAiSubscriptionRunner`, `llm-runner-setup --login`, `CODEX_AUTH_JSON` 복원 — 이 중 어느 것도 Anthropic/OpenAI의 OAuth 프로토콜을 직접 구현하지 않습니다.

- **로그인**은 항상 공식 CLI 명령(`claude login`, `codex login`)을 `stdio: 'inherit'`로 그대로 실행합니다. 사용자가 직접 브라우저에서 Anthropic/OpenAI에 로그인하고, 우리 코드는 그 과정을 지켜보지도, 개입하지도 않습니다.
- **호출**은 `@anthropic-ai/claude-agent-sdk`/`@openai/codex-sdk`가 이미 로그인된 로컬 세션을 읽어서 처리하며, 우리 코드는 토큰을 직접 보거나 저장하지 않습니다.
- **서버리스 복원**(`CODEX_ACCESS_TOKEN` → `codex login --with-access-token`, `CLAUDE_CODE_OAUTH_TOKEN`)도 자체 OAuth 클라이언트를 만든 게 아니라, **공식 CLI/SDK가 이미 제공하는 토큰 주입 메커니즘**을 그대로 씁니다. `claude setup-token`은 Anthropic이 Enterprise/CI 용도로 공식 문서화한 기능이고, `codex login --with-access-token`도 Codex CLI의 공식 서브커맨드입니다.

**하지 않는 것**: Anthropic/OpenAI OAuth 프로토콜을 리버스엔지니어링해서 우리 패키지가 로그인 제공자(provider) 역할을 하는 것. 이건 하지 않습니다 — 토큰 발급의 주체는 항상 공식 CLI이고, 우리는 그 결과물을 전달만 합니다.

### 경계선: "고객의 행동이 LLM 호출을 직접 발생시키는가"

먼저 헷갈리기 쉬운 것부터 정리합니다: **`claude -p`/`codex exec`(그리고 이 패키지의 구독 Runner)는 "자동화하지 말라"고 있는 게 아니라, 정반대로 Anthropic/OpenAI가 스크립트·CI/CD·cron에서 쓰라고 공식 문서화한 기능입니다.** 심지어 Anthropic은 구독 요금제 안에 `-p`/Agent SDK 사용량을 계산하는 체계까지 만들어뒀습니다 — 회사 스스로 "구독자가 이걸 프로그램적으로, 자동화해서 돌릴 것"을 전제하고 있다는 뜻입니다.

**핵심은 이겁니다: `-p`/`exec`/Agent SDK는 "실행 방법"이고, 구독이냐 API 키냐는 "인증·과금"이라는 완전히 다른 레이어입니다.** 자동화 자체는 문제가 아니고, 그 자동화를 누가 트리거하느냐가 진짜 기준입니다.

> **가장 정확한 질문: "고객의 특정 행동이 이 LLM 호출을 직접 발생시키는가?"**

- **아니오 (내 workflow가 호출)** → 구독 OK. cron, CI/CD, 매일 도는 배치, 운영자가 검수 후 발행하는 콘텐츠 제작 파이프라인 전부 포함됩니다.
- **예 (고객 행동 → 즉시 LLM 호출)** → API 필요. 고객이 버튼을 누르거나 프롬프트를 입력하는 순간 모델이 불려나가는 구조입니다.

**실무 예시:**

| 패턴 | 판정 |
|---|---|
| CI/CD에서 `codex exec`로 코드 리뷰, 테스트 실패 분석 | ✅ 구독형 OK — 내 개발 workflow |
| 매일 크론으로 `claude -p` 돌려서 브리핑 초안 생성 → **운영자가 사실확인·검수** → 발행 | ✅ 구독형 OK — AI는 내 콘텐츠 제작 workflow를 도와줄 뿐, 최종 판단은 사람이 함 |
| 사내 관리자 페이지에서만 보는 자동 요약 | ✅ 구독형 OK |
| 고객이 "삼성전자 분석해줘" 입력 → 그 순간 LLM 호출 → 고객에게 응답 | ❌ API 필요 — 고객 행동이 직접 호출을 발생시킴 |
| 챗봇, "분석하기" 버튼, 고객별 맞춤 리포트 생성 | ❌ API 필요 |
| 검수·판단 없이 AI 출력이 그대로, 즉시 다수 고객에게 노출되는 자동 파이프라인 | ⚠️ 회색지대 — 사람의 편집/판단 개입이 없을수록 "고객에게 모델을 직접 서비스하는 것"에 가까워짐 |

**운영자 검수 단계가 실제로 의미 있게 작동하는지가 중요합니다** — 형식적으로 통과시키는 게 아니라 진짜 사실확인·중요도 판단이 이뤄진다면, 그 파이프라인은 "내 콘텐츠 제작 workflow"이지 "고객에게 모델을 서비스하는 것"이 아닙니다.

이 패키지(`llm-runner`/`ai-service`)의 Runner 구조가 정확히 이 구분에 맞게 설계되어 있습니다 — 내 workflow를 자동화하는 곳엔 `ClaudeSubscriptionRunner`/`OpenAiSubscriptionRunner`를, 고객 행동이 직접 호출을 트리거하는 곳엔 `ClaudeApiRunner`/`OpenAiApiRunner`를 주입하면 됩니다. 비즈니스 로직은 그대로 두고 주입되는 Runner만 바꾸면 되도록 만든 게 이 구조의 핵심 목적입니다.

### 2026년 타임라인 (참고용)

Claude 구독 + Agent SDK 사용이 괜찮은지에 대한 발표가 한 해 동안 여러 번 바뀌었습니다. 이 이력 자체가 "정책이 유동적"이라는 걸 보여주는 참고 자료입니다.

| 시점 | 내용 |
|---|---|
| 2026-02 | 문서 정리 과정에서 "OAuth를 Agent SDK 등에 쓰면 안 된다"는 문구 추가 → 혼란 |
| 2026-02-20 | Anthropic 엔지니어 해명: "개인적인 로컬 실험은 권장한다. 비즈니스면 API 키를 써라." |
| 2026-04 | 서버 단에서 대형 서드파티 도구(OpenClaw 등) 실제 차단 |
| 2026-05 | "Agent SDK 크레딧" 카테고리로 재허용 — 다만 이건 **과금 방식**에 대한 발표였지, 모든 서드파티 제품에 대한 포괄적 승인으로 보기는 어렵습니다 |
| 2026-06-15 | 크레딧 분리 과금 계획을 시행 당일 보류 — Agent SDK/`claude -p`/서드파티 앱 사용은 다시 일반 구독 사용량에 포함되는 것으로 롤백 |

**현재(2026-09) 공식 문서 기준으로는, 여전히 "제3자 제품/서비스는 API 키를 쓰라"는 원칙이 살아있습니다.** 이 패키지가 "구독 인증을 직접 구현/중개하지 않고 로컬 세션만 재사용"하는 설계를 지키는 이유가 이것입니다.

### 참고로 알아둘 것

- **탐지는 트래픽 패턴 기반**이라, 규모가 커지고 눈에 띄기 전까지는 실제로 걸릴 확률이 낮습니다. 다만 "안 걸린다"가 "허용된다"는 뜻은 아닙니다.
- 정책이 1년에 세 번 바뀐 전례가 있으니, 아래 공식 문서를 주기적으로 확인하세요. 이 패키지는 provider를 바꾸기만 하면 되도록 설계했으니, 정책이 바뀌면 `AI_PROVIDER`를 `claude-api`로 전환하면 됩니다.

- [Claude Code: Legal and compliance](https://code.claude.com/docs/en/legal-and-compliance)
- [Claude Help Center: Use the Claude Agent SDK with your Claude plan](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan)

## 부팅 시점 CLI 체크

구독 provider를 선택했는데 로컬에 CLI가 없으면 `createAiRunner()` 호출 시점에 바로 에러가 납니다 (기본 동작, `checkCliOnCreate: false`로 끌 수 있음). `spawn`/`exec`로 실제 실행하지 않고 `PATH` 환경변수를 파일 시스템 조회만 해서 확인하므로, 로그인 여부까지는 확인하지 못합니다.

## 만들지 않은 것

- **세션/대화 이어가기(resume)**: `run()`은 매 호출이 새 세션이다. `claude-subscription`에 한해 진짜로 여러 턴이 이어져야 하는 대화용으로 `createSession()`을 제공한다 — 아래 "여러 턴 대화: `createSession()`" 참고. 나머지 provider는 여전히 상위 레이어에서 대화 이력을 관리해야 한다.
- **스트리밍 응답**: `run()`은 완료된 결과만 반환한다.
- **Workflow/Graph 오케스트레이션**: 여러 Runner를 조합하는 로직은 이 패키지 밖에서 만든다.
- **로그인/결제/회원별 사용량 관리**: 이건 서비스마다 다르다. 코딩 몰라도 따라할 수 있는 순서는 [`docs/auth-and-payments-guide.md`](docs/auth-and-payments-guide.md) 참고.

## 더 필요할 때 볼 문서

- 비용이 얼마나 나올지 계산하는 법: [`docs/cost-guide.md`](docs/cost-guide.md)
- 상담봇이 엉뚱한 말/확정적 조언을 못 하게 막는 법(프롬프트 인젝션 방어, 법적 책임 문구): [`docs/safety-guide.md`](docs/safety-guide.md)
- 로그인/결제/회원별 사용량 붙이는 법: [`docs/auth-and-payments-guide.md`](docs/auth-and-payments-guide.md)
- 구독 vs API 판단 기준을 쉽게 설명한 글: [`docs/subscription-vs-api-guide.md`](docs/subscription-vs-api-guide.md)

## 라이선스

MIT
