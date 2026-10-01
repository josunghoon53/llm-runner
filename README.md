# llm-runner

[![npm](https://img.shields.io/npm/v/llm-runner?style=flat-square&color=cb3837&logo=npm&logoColor=white)](https://www.npmjs.com/package/llm-runner)
[![CI](https://img.shields.io/github/actions/workflow/status/josunghoon53/llm-runner/ci.yml?style=flat-square&label=CI)](https://github.com/josunghoon53/llm-runner/actions)
[![license](https://img.shields.io/npm/l/llm-runner?style=flat-square)](./LICENSE)
[![node](https://img.shields.io/node/v/llm-runner?style=flat-square&color=339933&logo=nodedotjs&logoColor=white)](https://nodejs.org)

Claude Max / ChatGPT Plus **구독 세션**을 코드에서 그대로 쓰거나, Anthropic/OpenAI **API 키**를 쓰거나 —
같은 인터페이스로 갈아 끼울 수 있게 해주는 프레임워크 독립 러너.

```ts
import { createAiRunner } from 'llm-runner';

const runner = createAiRunner(); // provider 생략 시: .env의 AI_PROVIDER → 없으면 로그인/API 키가 설정된 것을 자동 감지
const { text } = await runner.run({ prompt: '오늘 날씨 요약해줘' });
```

NestJS, Express, 순수 Node, Next.js API route — 어디서든 그대로 씁니다.

## 할 수 있는 것

| | |
|---|---|
| **같은 코드, 네 가지 provider** | Claude 구독 · Codex(ChatGPT 구독) · Claude API 키 · OpenAI API 키 |
| **스트리밍** | `stream()`으로 생성되는 대로 받기 |
| **구조화 출력** | `runStructured()`로 JSON Schema 모양 그대로 받기 |
| **여러 턴 대화** | `createSession()`으로 프로세스 하나를 물고 대화 이어가기 |
| **구독 사용량 조회** | 5시간/주간 한도 잔량, 크레딧. 토큰을 쓰지 않아요 |
| **계정 프로필 분리·로그인** | 앱 전용 계정으로 로그인/로그아웃. 기본 CLI 로그인은 그대로 |
| **이미지 생성** | Codex 구독으로 이미지 생성 (0.10.0) |
| **도구는 기본 잠금** | 파일 쓰기·명령 실행은 막고, 웹 검색만 옵션으로 열기 |

### Provider 4종

| provider | 인증 | 과금 |
|---|---|---|
| `claude-subscription` | 로컬 `claude login` 세션 | 구독 요금에 포함 (개인 사용 전제) |
| `openai-subscription` | 로컬 Codex CLI ChatGPT 로그인 세션 | ChatGPT 구독 요금 |
| `claude-api` | `ANTHROPIC_API_KEY` | 토큰당 과금 |
| `openai-api` | `OPENAI_API_KEY` | 토큰당 과금 |

`.env`의 `AI_PROVIDER`로 전역 기본값을 정하거나, `createAiRunner({ provider: '...' })`로 명시적으로 고를 수 있습니다.

## 뭘 골라야 하는지 30초 안에 정하기

바로 아래 판단 하나만 하면 됩니다. 나머지는 다 이 판단을 뒷받침하는 근거예요.

> **방문자/고객이 버튼을 누르거나 채팅을 보내면 그 즉시 AI가 호출되나요?**
> - **네** → `createAiRunner({ provider: 'claude-api' })` (또는 `'openai-api'`) — API 키 필요
> - **아니오, 저 혼자/우리 팀만 쓰는 자동화예요** → `createAiRunner()` (provider 생략, 로컬 로그인 세션 자동 감지)
> - **잘 모르겠어요** → 일단 `'claude-api'`로 시작하세요. 어디에 배포하든 항상 동작하고, 나중에 문제 될 일이 없습니다.

**흔한 실수**: 로컬 컴퓨터에서 `provider` 생략하고 테스트하면(구독 세션으로) 잘 되길래 그대로 배포했다가, Vercel 등에 올리자마자 안 되는 경우가 많습니다 — 구독형은 배포 서버에 로그인 세션이 없으면 동작하지 않습니다. **방문자가 쓰는 기능을 만드는 거라면 로컬 테스트도 처음부터 `'claude-api'`로 하세요.**

## 왜 필요한가

Claude Code나 Codex CLI는 이미 로그인해서 구독료를 내고 있으면, **API 키 없이** 그 세션으로 개인적으로 코드에서 호출할 수 있습니다 (자세한 사용 조건은 [구독 사용 시 알아야 할 것](#구독-사용-시-알아야-할-것) 참고). 문제는 이걸 쓰려면:

- `@anthropic-ai/claude-agent-sdk`와 `@openai/codex-sdk`는 서로 완전히 다른 SDK라서 각각 배워야 함
- 아무 설정도 안 하면 두 SDK 다 파일 쓰기·명령 실행 같은 **위험한 도구가 기본으로 열려있음**
- 나중에 API 키 방식으로 바꾸고 싶을 때 코드를 다시 짜야 함

이 패키지는 이 네 가지 조합을 하나의 `AiRunner` 인터페이스로 감싸서, `.env` 값 하나로 스위치하듯 바꿀 수 있게 합니다.

## 설치

```bash
npm install llm-runner
```

- Node.js 22 이상이 필요합니다.
- ESM 패키지입니다. `import { createAiRunner } from 'llm-runner'`로 쓰세요. CommonJS(`require()`)는 Node 22.12 이상에서만 동작합니다.
- 서버(Node.js) 전용입니다. 브라우저 코드에서 import하면 빌드는 되지만 호출 시 "서버에서만 동작한다"는 안내 에러가 납니다 — [프론트엔드에서 쓰려면](#프론트엔드react-등에서-쓰려면) 참고.

구독 provider(`claude-subscription`, `openai-subscription`)를 쓰려면 로컬에 해당 CLI가 설치되고 로그인되어 있어야 합니다. 아래 명령으로 한 번에 확인·설치·로그인할 수 있습니다.

```bash
npx llm-runner-setup          # 설치/로그인 상태 확인
npx llm-runner-setup --login  # 설치는 됐는데 로그인이 안 된 CLI를 대화형으로 로그인
```

> GitHub에서 바로 설치하기, 수동 CLI 설치, 앱 코드에서 상태 확인(`checkSubscriptionSetup`)은 [`docs/install-details.md`](docs/install-details.md)에 있습니다.

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

```ts
interface AiRunOptions {
  prompt: string;
  system?: string;
  model?: string;
  maxTokens?: number;        // API 키 provider 전용
  enableWebSearch?: boolean; // 구독 provider 전용
}
```

### 프론트엔드(React 등)에서 쓰려면

`llm-runner`는 Node.js 전용이라 브라우저에서 직접 못 씁니다. 프론트 → 내 백엔드 API → `llm-runner` 구조로 감싸야 합니다. 바로 복붙해서 쓸 수 있는 Next.js 예제: [`examples/nextjs-starter/`](./examples/nextjs-starter/README.md)

NestJS처럼 설정 주입을 쓰는 프레임워크라면 [`docs/nestjs.md`](docs/nestjs.md)를 보세요.

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

- `text` 이벤트는 **증분**입니다. 이어붙이면 마지막 `done`의 전체 텍스트와 정확히 같습니다.
- 마지막에 `done`이 정확히 한 번 오고, `result`는 `run()`이 돌려주는 것과 같은 형태입니다.
- 중간에 `break`로 빠져나오면 내부 연결과 프로세스를 정리합니다.

실측(같은 프롬프트 기준) — 빈 화면으로 기다리는 시간이 이만큼 줄어듭니다:

| provider | 첫 글자까지 | 완료까지 | 조각 수 |
|---|---|---|---|
| `claude-subscription` | 5.5초 | 13.5초 | 145 |
| `openai-subscription` | 5.1초 | 8.9초 | 171 |

> Codex 쪽엔 함정이 있었습니다. 공식 `@openai/codex-sdk`의 `runStreamed()`는 이름과 달리 **증분을 주지 않습니다**. 그래서 `stream()`은 글자 단위 증분을 보내주는 `codex app-server` 경로를 먼저 쓰고, 그게 안 되면 SDK 경로로 자동 폴백합니다(이 경우 텍스트가 한 덩어리로 오지만 동작은 동일).

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

**네 provider 모두 provider 쪽에서 스키마를 강제합니다** — 프롬프트로 부탁하고 결과를 파싱하는 경로는 없습니다. provider별 방식과, 여러 provider에 돌려 쓸 때 맞춰야 할 규칙은 [`docs/structured-output.md`](docs/structured-output.md)에 있습니다.

## 토큰 사용량과 비용

`run()`/`stream()`/`runStructured()`의 결과에 `usage`가 함께 옵니다:

```ts
const result = await runner.run({ prompt: '...' });
console.log(result.usage);
// { inputTokens: 909, outputTokens: 558, cachedInputTokens: 0, reasoningTokens: 0, costUsd: 0.101849 }
```

- **값이 없는 건 0이 아니라 "그 provider가 안 알려준다"는 뜻**입니다. 합산해서 보여줄 때 주의하세요.
- `costUsd`는 provider가 금액을 직접 알려줄 때만 채웁니다(현재 `claude-subscription`). 나머지는 토큰 수만 주기 때문에 **추정치를 지어내지 않습니다.** 금액이 필요하면 토큰 수를 각자의 단가로 곱하세요.
- `createSession()` 안에서도 `usage`는 "그 턴 하나"의 사용량입니다.

## 여러 턴 대화: `createSession()`

`run()`은 매번 새 프로세스를 띄웁니다(5~10초/회). **한 대화가 이어져야 할 때**(상담봇 등)는 프로세스 하나를 계속 물고 있는 세션을 쓸 수 있습니다:

```ts
const runner = createAiRunner({ provider: 'claude-subscription' });
const session = runner.createSession({ system: '너는 친절한 상담원이다' });

const r1 = await session.send('안녕, 나는 김철수야');
const r2 = await session.send('내 이름이 뭐라고 했지?');     // "김철수"라고 정확히 답함

session.close(); // 다 쓰면 반드시 호출 — 안 하면 프로세스가 안 죽는다
```

- 서로 **독립적인 작업**에는 세션을 재사용하지 마세요. 이전 턴 내용이 다음 턴에 섞입니다.
- 답변이 길면 세션의 속도 이득은 거의 없습니다. 사용자가 빈 화면을 보는 시간을 줄이려면 `sendStream()`을 쓰세요.
- Codex(`openai-subscription`)도 같은 방식으로 동작하고, 실험적 경로가 깨지면 공식 SDK로 자동 폴백합니다. `onFallback`으로 폴백을 감지할 수 있습니다.

속도 표, 폴백 동작, 배포 전 시험 방법은 [`docs/sessions.md`](docs/sessions.md)에 있습니다. 동시 실행·대량 배치·Codex 추론 강도(`reasoningEffort`)는 [`docs/performance.md`](docs/performance.md)를 보세요.

### `reasoningEffort` — Codex가 느리다면

`openai-subscription`의 첫 글자까지가 20~40초씩 걸린다면 대개 Codex가 답하기 전에 추론에 시간을 쓰는 탓입니다. `reasoningEffort`로 줄일 수 있지만, **어떤 작업이냐가 전부**입니다. 웹 검색·조사처럼 오래 걸리는 작업에는 `'low'`가 효과적이고(30~48% 단축), 다단계 논리가 섞인 작업에 `'none'`을 쓰면 정답률이 무너집니다. 실측 표와 주의점은 [`docs/performance.md`](docs/performance.md)에 있습니다.

## 이미지 생성: `generateCodexImage()` (0.10.0)

Codex 구독으로 이미지를 만듭니다.

```ts
import { generateCodexImage } from 'llm-runner/experimental';
import { writeFile } from 'node:fs/promises';

const { images, failure, text } = await generateCodexImage({
  prompt: '흰 배경 가운데에 단색 빨간 삼각형 하나',
});

if (failure) console.log('한도 초과 · 리셋:', failure.resetsAt);
else await writeFile('triangle.png', images[0].data);
```

- `data`는 PNG 바이트(`Buffer`)입니다. `revisedPrompt`로 모델이 프롬프트를 어떻게 다듬었는지 볼 수 있습니다.
- 읽기 전용 샌드박스를 그대로 씁니다 — Codex가 base64를 응답에 실어 주므로 안전선을 내릴 필요가 없습니다.
- ⚠️ **텍스트와 다른 사용량 한도**를 씁니다. 한도를 넘기면 던지지 않고 `failure`로 오니 `failure`를 먼저 확인하세요.
- 실측(2026-09-30): 한 번 호출에 약 67초, 2장. Claude에는 대응 기능이 없어 `AiRunner` 인터페이스에는 올리지 않았습니다.

## 구독 사용량·계정·로그인

`llm-runner/experimental`에서 구독 계정 관련 기능을 제공합니다. **모두 토큰을 쓰지 않습니다.**

```ts
import { getClaudePlanUsage, getCodexPlanUsage } from 'llm-runner/experimental';

const claude = await getClaudePlanUsage();
if (claude.available) {
  console.log(claude.subscriptionType);            // 'max'
  console.log(claude.fiveHour?.remainingPercent);  // 86
}

const codex = await getCodexPlanUsage();
console.log(codex.primary?.remainingPercent);      // 100 (창 길이 300분)
```

| | Claude 구독 | Codex 구독 |
|---|---|---|
| 호출당 토큰 | ✅ | ✅ |
| 호출당 금액 | ✅ `costUsd` | ❌ (Codex가 안 줌) |
| 플랜 잔량 | ✅ `getClaudePlanUsage()` | ✅ `getCodexPlanUsage()` |
| 크레딧 잔액 | — | ✅ |

- **계정 여러 개:** `codexHome` / `claudeConfigDir`로 앱 전용 프로필을 가리키면 완전히 다른 계정이 됩니다. 기존 로그인은 건드리지 않습니다.
- **프로필 로그인/로그아웃:** `startCodexLogin()` / `startClaudeLogin()`이 승인 URL을 돌려줍니다. 브라우저는 호출부가 엽니다.
- **한도 실시간 알림:** `onRateLimits`로 긴 배치 도중 한도가 차오르는 걸 받습니다.
- **어느 계정인가:** `getClaudeAccountInfo()` / `getCodexAccountInfo()`. 이메일은 개인정보이니 로그에 남기지 마세요.
- ⚠️ `claudeLogout()` / `codexLogout()`은 프로필을 생략하면 **머신 기본 계정이 로그아웃**됩니다. 항상 프로필을 지정하세요.

전체 사용법과 실측은 [`docs/accounts-and-usage.md`](docs/accounts-and-usage.md)에 있습니다. 이 기능들은 `experimental`이라 SDK/CLI 변경으로 바뀔 수 있고, 실패하면 던지지 않고 `available: false`로 돌아옵니다.

## 서버리스/배포 환경에서 쓰기

구독형 provider는 로그인 세션이 **그 컴퓨터의 파일시스템**(`~/.claude/`, `~/.codex/`)에 저장됩니다. 서버리스처럼 인스턴스가 매번 새로 뜨는 환경에서는 세션이 사라지므로, 로그인 세션을 환경변수(비밀 값)로 옮겨서 복원해야 합니다. 전체 절차는 [`docs/deploy-serverless.md`](docs/deploy-serverless.md)에 있습니다.

- **Claude:** `claude setup-token`으로 발급한 토큰을 `CLAUDE_CODE_OAUTH_TOKEN`으로 저장합니다. 이 명령은 **AI 어시스턴트가 대신 실행할 수 없고** 사람이 자기 터미널에서 직접 해야 합니다.
- **Next.js(Vercel):** `next.config.ts`를 `withLlmRunner()`로 감싸야 네이티브 바이너리가 배포 결과물에 실립니다.
- **방문자가 쓰는 기능이라면:** 구독이 아니라 API 키 provider(`claude-api`/`openai-api`)를 쓰세요.

### Codex

- ⚠️ `CODEX_ACCESS_TOKEN`은 개인 ChatGPT 계정에서 동작하지 않습니다(Business/Enterprise 전용). 개인 계정은 `npx llm-runner-setup --codex-auth-json`으로 만든 `CODEX_AUTH_JSON`을 쓰세요.
- 서버리스에서 Codex 구독을 쓴다면 `codexAuthStore`를 함께 설정하세요. 안 쓰면 토큰 회전 이후 로그인이 조용히 만료됩니다. 동시 인스턴스가 있는 서비스는 조건부 쓰기(CAS)가 되는 저장소가 필요합니다.
- 바이너리는 자동으로 찾습니다. 프로젝트에 `@openai/codex`를 일반 의존성으로 설치하세요.

#### 배포 전에 반드시 확인할 것 (가장 흔한 실패)

네이티브 바이너리는 **OS별로 다른 패키지**라서, 로컬에서 `npm run build`가 성공했다고 리눅스 배포가 된다는 증거는 아닙니다. 그래서:

1. 배포 **전에** `npx llm-runner-setup --check-deploy`로 설정 실수(의존성 누락, `routes` 불일치)를 거르세요.
2. 배포 **후에** 점검용 엔드포인트에서 `tryResolveCodexBinaryPath()`로 바이너리가 실렸는지 확인하세요. 실제로 한 번 호출해 보기 전까지는 된다고 믿지 마세요.

점검용 엔드포인트 코드와 `codexAuthStore` 예제는 [`docs/deploy-serverless.md`](docs/deploy-serverless.md)에 있습니다.

## 구독 사용 시 알아야 할 것

이 패키지는 **OAuth를 직접 구현하지 않습니다.** 로그인은 항상 공식 CLI(`claude login`, `codex login`)가 하고, 호출은 공식 SDK가 이미 로그인된 로컬 세션을 읽어서 처리합니다.

구독을 써도 되는지의 기준은 한 줄입니다.

> **"고객의 특정 행동이 이 LLM 호출을 직접 발생시키는가?"**

- **아니오** (내 cron, CI/CD, 운영자가 검수하는 배치, 사내 관리자 페이지) → 구독 OK
- **예** (고객이 버튼을 누르거나 채팅을 보내는 순간 호출) → API 키 필요

정책은 한 해에 여러 번 바뀐 전례가 있습니다. provider만 바꾸면 되도록 설계했으니, 정책이 바뀌면 `AI_PROVIDER`를 `claude-api`로 전환하세요. 근거, 실무 예시 표, 2026년 타임라인은 [`docs/subscription-terms.md`](docs/subscription-terms.md)에 있습니다.

## 기본적으로 도구는 다 잠겨 있습니다

Claude Code CLI와 Codex CLI는 원래 코딩 에이전트라서, 그냥 두면 파일 쓰기·Bash 명령 실행·웹 검색이 다 가능합니다. 이 패키지는 텍스트 생성 전용으로 쓰기 위해 **기본적으로 모든 도구를 차단**하고, `enableWebSearch: true`를 줬을 때만 웹 검색만 열어줍니다.

직접 테스트하며 확인한 함정들(`allowedTools: []`만으로는 안 막힌다 등)은 [`docs/pitfalls.md`](docs/pitfalls.md)에 있습니다.

## 부팅 시점 CLI 체크

구독 provider를 선택했는데 로컬에 CLI가 없으면 `createAiRunner()` 호출 시점에 바로 에러가 납니다 (기본 동작, `checkCliOnCreate: false`로 끌 수 있음). `PATH`를 파일 시스템 조회만 해서 확인하므로, 로그인 여부까지는 확인하지 못합니다. `createAiRunner()`는 **모듈 최상단이 아니라 요청 핸들러 안에서** 부르세요(빌드 서버에는 CLI가 없어서 빌드가 깨질 수 있습니다).

## 만들지 않은 것

- **Workflow/Graph 오케스트레이션**: 여러 Runner를 조합하는 로직은 이 패키지 밖에서 만든다.
- **로그인/결제/회원별 사용량 관리**: 서비스마다 다르다. 코딩 몰라도 따라할 수 있는 순서는 [`docs/auth-and-payments-guide.md`](docs/auth-and-payments-guide.md) 참고.
- **대화 이력 관리**: `run()`은 매 호출이 새 세션이다. 이어지는 대화는 `createSession()`을 쓰거나 상위 레이어에서 이력을 관리한다.

## 문서

| 주제 | 문서 |
|---|---|
| 설치 상세 (GitHub 설치, 수동 CLI) | [`docs/install-details.md`](docs/install-details.md) |
| NestJS에서 쓰기 | [`docs/nestjs.md`](docs/nestjs.md) |
| 구조화 출력 상세 | [`docs/structured-output.md`](docs/structured-output.md) |
| 여러 턴 대화, 폴백, 속도 | [`docs/sessions.md`](docs/sessions.md) |
| 성능, 동시 실행, `reasoningEffort` | [`docs/performance.md`](docs/performance.md) |
| 구독 사용량·계정·로그인 | [`docs/accounts-and-usage.md`](docs/accounts-and-usage.md) |
| 서버리스/배포 | [`docs/deploy-serverless.md`](docs/deploy-serverless.md) |
| 구독 사용 시 알아야 할 것 | [`docs/subscription-terms.md`](docs/subscription-terms.md) |
| 검증된 함정들 | [`docs/pitfalls.md`](docs/pitfalls.md) |
| 비용 계산 | [`docs/cost-guide.md`](docs/cost-guide.md) |
| 안전(프롬프트 인젝션, 법적 문구) | [`docs/safety-guide.md`](docs/safety-guide.md) |
| 로그인/결제/회원별 사용량 | [`docs/auth-and-payments-guide.md`](docs/auth-and-payments-guide.md) |
| 구독 vs API 판단 기준 | [`docs/subscription-vs-api-guide.md`](docs/subscription-vs-api-guide.md) |

## 라이선스

MIT
