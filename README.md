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

- ESM 패키지입니다. `import { createAiRunner } from 'llm-runner'`로 쓰세요. CommonJS(`require()`)는 Node 22.12 이상에서만 동작합니다.
- 서버(Node.js) 전용입니다. 브라우저 코드에서 import하면 빌드는 되지만 호출 시 "서버에서만 동작한다"는 안내 에러가 납니다 — 아래 [프론트엔드에서 쓰려면](#프론트엔드react-등에서-쓰려면) 참고.

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

**Next.js(Vercel)를 쓴다면 배포 설정에 한 가지를 더 추가해야 합니다.** `claude-agent-sdk`는 플랫폼별 네이티브 실행파일을 optionalDependency로 설치하는데, 이게 동적으로 로드되는 방식이라 Next.js의 빌드 파일 추적(file tracing)이 자동으로 감지하지 못해 배포 결과물에서 빠집니다. 그러면 실제 호출 시 `Native CLI binary for linux-x64 not found` 에러가 납니다. `next.config.ts`에 아래처럼 명시적으로 포함시켜야 합니다(직접 Vercel에 배포해서 검증함):

```ts
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    '/api/ai': ['./node_modules/@anthropic-ai/claude-agent-sdk-linux-x64/**'],
  },
};

export default nextConfig;
```

라우트 경로(`/api/ai`)는 실제 API 라우트 경로에 맞게 바꾸고, Vercel 빌드 서버는 리눅스이므로 보통 `-linux-x64`만 있으면 충분하다(ARM 기반 빌드 환경을 쓴다면 `-linux-arm64`도 추가).

### Codex
```bash
# 로그인된 로컬 머신에서 실행 — auth.json에서 access_token 값 확인
cat ~/.codex/auth.json
```
이 명령 자체는 대화형이 아니라서 AI 어시스턴트가 대신 실행해도 된다(단, `codex login`으로 로그인이 이미 돼 있어야 이 파일이 존재한다 — 로그인 자체는 위와 마찬가지로 사용자가 직접 해야 하는 대화형 작업이다).

`tokens.access_token` 값을 배포 환경의 `CODEX_ACCESS_TOKEN` 비밀 값으로 저장하세요(위 Vercel 예시와 동일한 방식 — Settings → Environment Variables). `OpenAiSubscriptionRunner`가 생성될 때 이 값이 있으면 자동으로 `codex login --with-access-token`을 실행해서 세션을 복원합니다(프로세스당 한 번, 메모이즈).

```ts
// createAiRunner({ provider: 'openai-subscription' })만 호출하면
// 내부적으로 CODEX_ACCESS_TOKEN 유무를 확인해서 알아서 복원합니다.
```

**주의**: Codex 쪽은 개인 액세스 토큰(PAT) 방식이라 자동 갱신되지 않습니다. 만료되면 로컬에서 다시 `cat ~/.codex/auth.json`으로 새 값을 받아 비밀 값을 갱신해야 합니다. Claude의 `setup-token`은 장기 유효 토큰이라 상대적으로 덜 신경 써도 됩니다.

> ⚠️ **Claude와 달리, Codex는 서버리스 Function 환경에서 실제로 동작하지 않을 가능성이 높습니다.** `@anthropic-ai/claude-agent-sdk`는 필요한 네이티브 바이너리를 자체 optionalDependency로 갖고 있어서 `CLAUDE_CODE_OAUTH_TOKEN`만으로 Vercel 같은 곳에서도 동작하는 걸 직접 확인했지만, `@openai/codex-sdk`는 그런 번들 바이너리가 없고 **PATH에 실제 `codex` CLI 실행파일이 있어야만** 동작합니다(`CODEX_ACCESS_TOKEN`은 그 CLI에 주입할 토큰값일 뿐, CLI 자체를 대체하지 않습니다). 즉 `openai-subscription`은 VPS처럼 `codex` CLI를 직접 설치해둘 수 있는 환경에서만 현실적으로 씁니다.

## 구독 사용 시 알아야 할 것

### 설계 원칙: 이 패키지는 OAuth를 직접 구현하지 않습니다

`ClaudeSubscriptionRunner`, `OpenAiSubscriptionRunner`, `llm-runner-setup --login`, `restoreCodexSessionFromEnv` — 이 중 어느 것도 Anthropic/OpenAI의 OAuth 프로토콜을 직접 구현하지 않습니다.

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

- **세션/대화 이어가기(resume)**: 매 호출이 새 세션이다. 여러 턴 대화가 필요하면 상위 레이어에서 세션 ID를 관리하도록 설계했다.
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
