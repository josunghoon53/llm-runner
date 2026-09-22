# llm-runner — AI 에이전트용 통합 가이드

이 문서는 코딩 에이전트(Claude Code, Codex CLI 등)가 `llm-runner`를 프로젝트에 통합할 때 참고하는 치트시트다. 사용자가 "AI 기능 추가해줘"라고만 말해도 아래 내용을 따라 바로 구현할 수 있어야 한다.

## 이 패키지가 하는 일

Claude/Codex를 **구독 세션**(API 키 없이) 또는 **API 키**로, 같은 인터페이스로 호출한다.

```ts
import { createAiRunner } from 'llm-runner';

const runner = createAiRunner({ provider: 'claude-api' }); // 또는 provider 생략(자동 감지)
const result = await runner.run({ prompt: '...' });
console.log(result.text);
```

## 절대 규칙 1: 프론트엔드에서 직접 import 금지

`llm-runner`는 Node.js 전용이다 (CLI 프로세스 실행, 파일시스템 접근을 씀). **React/Vue 컴포넌트나 클라이언트 번들에 절대 import하지 않는다.**

항상 이 구조로 만든다:
```
프론트 컴포넌트 → fetch('/api/...') → 서버(API 라우트/컨트롤러) → createAiRunner() → 응답
```

Next.js면 `app/api/*/route.ts`, Express/NestJS면 컨트롤러/라우터 핸들러 안에서만 `createAiRunner()`를 호출한다. 실제 예제: `examples/nextjs-starter/`.

## 절대 규칙 2: provider 선택 기준

**질문 하나로 결정한다: "고객의 특정 행동이 이 LLM 호출을 직접 발생시키는가?"**

| 상황 | provider |
|---|---|
| 서버리스(Vercel, Netlify, Lambda 등)에 배포함 | `claude-api` 또는 `openai-api` (무조건) |
| 고객이 버튼을 누르거나 채팅을 보내면 그 순간 LLM이 호출됨 | `claude-api` / `openai-api` |
| 여러 명의 다른 사용자가 쓰는 서비스에 AI 결과를 자동으로 계속 제공함 | `claude-api` / `openai-api` |
| 내(팀)가 쓰는 개발 도구, 사내 자동화, cron 배치(사람이 검수 후 발행) | `claude-subscription` / `openai-subscription` 가능 |
| 확실하지 않으면 | **`claude-api` / `openai-api`로 시작한다** (API 키만 있으면 어디서든 동작하고, 약관 문제 없음) |

기본값(provider 생략)은 로컬에 로그인된 CLI를 자동 감지하지만, **배포용 코드에서는 항상 provider를 명시**한다.

## 절대 규칙 3: 구독 provider는 로그인 필요

`claude-subscription`/`openai-subscription`을 쓰려면 그 코드가 실행되는 머신에 `claude`/`codex` CLI가 설치되고 로그인되어 있어야 한다.

```bash
npx llm-runner-setup          # 상태 확인
npx llm-runner-setup --login  # 로그인
npx llm-runner-setup --init   # provider 골라서 .env에 저장
```

서버리스 환경은 콜드스타트마다 로그인 세션이 사라지므로 구독 provider가 기본적으로 동작하지 않는다 — 그런 환경이면 무조건 API 키를 쓰는 게 기본 권장이다. (예외: `claude-subscription`은 `CLAUDE_CODE_OAUTH_TOKEN`으로, `openai-subscription`은 `CODEX_AUTH_JSON`으로 세션을 복원하면 서버리스에서도 동작한다 — 둘 다 실제 Vercel 배포로 검증됨. Codex 쪽은 바이너리 번들링이 추가로 필요한데, `next.config.ts`를 `llm-runner/next`의 `withLlmRunner()`로 감싸고 `npm install @openai/codex`만 해두면 경로 지정 없이 동작한다.
배포 전에 `npx llm-runner-setup --check-deploy`로 설정 실수(의존성 누락, routes 불일치)를 먼저 거르고, 배포 후에는 **반드시 실제 호출로 한 번 검증해라** — 네이티브 바이너리는 OS별 패키지라서 로컬 빌드 성공이 리눅스 배포 성공을 전혀 보장하지 않는다(README의 "배포 전에 반드시 확인할 것" 참고).
그리고 **서버리스에서 Codex 구독을 쓴다면 `codexAuthStore`를 반드시 함께 제안하되, 동시 인스턴스가 있는 서비스면 잠금이 되는 저장소가 필요하다는 것도 같이 알려라** — 안 쓰면 환경변수에 넣어둔 로그인 스냅샷이 토큰 회전 이후 언젠가 조용히 만료된다. 자세한 절차는 README의 "서버리스/배포 환경에서 쓰기" 참고.)

## 절대 규칙 4: 파이프라인에서 `claude-subscription`을 여러 번 부를 때

한 작업 안에서 `run()`을 반복 호출하는 구조(예: 여러 종목/문서를 순회하며 하나씩 분석)를 만든다면, `claude-subscription`은 **호출마다 새 프로세스를 spawn해서 5~10초씩 걸린다는 걸 반드시 사용자에게 미리 알려라** — "N개 처리하는 데 대략 N×7초 걸릴 수 있다"처럼 구체적으로.

- 각 호출이 **서로 독립적이어야 하는 작업**(종목 A 분석이 종목 B 분석에 영향을 주면 안 됨)이면 → `run()`을 그대로 여러 번 호출한다. 절대 세션으로 묶지 않는다.
- 각 호출이 **진짜 한 대화로 이어져야 하는 작업**(같은 사용자와 여러 턴 주고받는 상담)이면 → `createSession()`을 쓴다.
- **속도를 과장해서 약속하지 마라.** 세션이 없애주는 건 프로세스 시작 비용(약 5초)뿐이다. 답변이 짧으면 체감이 크지만(5초→1.5초), 상담처럼 답변이 길면 생성 시간이 지배해서 거의 차이가 없다(실측 24.5초→17.7초). 사용자에게는 "맥락이 이어진다"를 주된 이점으로 설명하고, 속도는 "답변이 짧을 때만 체감된다"고 정확히 말해라. `send()`는 순차적으로만 호출하고, 다 쓰면 `close()`를 반드시 호출해라.
- 이 두 경우를 헷갈리면 안 된다: 독립적이어야 하는 작업에 세션을 재사용하면 이전 작업의 맥락이 다음 작업에 섞여 들어간다 (직접 검증됨).
- **각 호출이 독립적인 대량 배치라면 세션이 아니라 `Promise.all`로 동시 실행을 제안해라.** 실측 처리량이 claude-subscription 약 3.0배, openai-subscription 약 4.4배로 올라간다(5건 동시 기준). 세션은 이 경우 오히려 쓰면 안 된다 — 맥락이 섞인다.
- 정말 속도가 중요한데 각 호출이 독립적이어야 한다면, 세션이 아니라 애초에 `claude-api`로 provider를 바꾸는 걸 권해라.
- `openai-subscription`(Codex)의 `createSession()`도 같은 방식으로 동작한다. 내부적으로 실험적 `codex app-server` 프로토콜을 쓰지만, 실패하면 공식 SDK 경로로 자동 폴백하므로 **최악의 경우가 "느려짐"이지 "깨짐"이 아니다** — 두 실패 경로 모두 실제로 재현해서 검증됨. 예측 가능성이 더 중요하면 `createSession({ fastMode: 'off' })`를 제안해라.
- 폴백 없이 빠른 경로만 쓰는 `llm-runner/experimental`은 특별한 이유가 있을 때만 제안하고, 그때는 **반드시 "Codex CLI 업데이트로 예고 없이 깨질 수 있다"고 알려라.**

## Codex를 쓰면 추론 강도를 먼저 정해라

`openai-subscription`을 쓰기로 했다면 **`reasoningEffort`를 거의 항상 명시해라.** 지정하지 않으면 Codex 기본값으로 도는데, 프롬프트가 조금만 복잡해져도 첫 글자까지 20~40초가 걸린다(실측). 분류·추출·요약이면 `'none'`이 맞고, 실측으로 4배 빨라진다.

- 코드 생성이나 다단계 추론이 필요한 작업에서만 올려라 — 품질과의 거래다.
- **`reasoningEffort`를 지정하면 세션이 빠른 경로 대신 공식 SDK 경로를 쓴다**(app-server가 이 파라미터를 무시하기 때문). 글자 단위 스트리밍을 잃지만 전체 응답은 오히려 빨라진다.
- Claude는 프롬프트 복잡도에 따른 편차가 거의 없다 — 이 조정이 필요 없다.

## 스트리밍이 필요한지 먼저 물어라

챗봇처럼 **사용자가 화면 앞에서 기다리는** 기능이면 `run()`이 아니라 `stream()`을 쓰게 안내해라. 구독 provider는 응답 완성까지 10초를 넘기는 일이 흔해서, `run()`으로 만들면 그동안 빈 화면이 된다.

- `stream()`의 `text` 이벤트는 증분이다(전체 텍스트 아님). 마지막에 `done`이 한 번 오고 거기에 `usage`가 담긴다.
- **여러 턴 대화(상담봇 등)라면 `session.sendStream()`을 써라.** 세션은 총 시간을 못 줄이지만 스트리밍은 빈 화면 시간을 줄인다 — 실측으로 24초 대기가 첫 글자 6초로 바뀐다. 상담봇을 `session.send()`로 만들면 매 턴 20초씩 정지된 화면을 보여주게 된다.
- 배치/파이프라인처럼 사람이 안 기다리는 작업이면 `run()`이 더 단순하니 그대로 써라.
- 결과를 코드로 다뤄야 하면(분류, 추출 등) 텍스트를 파싱하지 말고 `runStructured()`에 JSON Schema를 줘라. **네 provider 모두 provider 쪽에서 스키마를 강제하므로** provider 선택과 무관하게 믿고 쓸 수 있다.

## 비개발자 사용자를 상대할 때

사용자가 터미널을 몰라도 되게 만드는 게 목표다. 사용자에게 "터미널 열고 이거 치세요"라고 시키지 말고, **네가 도구를 써서 대신 실행**해라 (셸 실행 권한이 있다면).

- **API 키 발급을 안내할 때**: 정확한 URL과 클릭 경로를 알려준다.
  - Anthropic: https://console.anthropic.com → 로그인/가입 → 좌측 메뉴 "API Keys" → "Create Key" → 나온 값을 복사
  - OpenAI: https://platform.openai.com/api-keys → 로그인/가입 → "Create new secret key" → 나온 값을 복사
  - 사용자가 키를 붙여넣으면, 네가 직접 `.env` 파일에 `ANTHROPIC_API_KEY=붙여넣은값` 형태로 써준다. 파일 위치나 문법을 사용자에게 묻지 않는다.
- **구독 로그인/토큰 발급을 안내할 때**: `npx llm-runner-setup --login`, `claude login`, `codex login`, `claude setup-token`은 전부 **브라우저 로그인이 필요한 대화형(인터랙티브) 명령이라서, 백그라운드나 자동화된 방식(예: 결과를 나중에 확인하는 비동기 셸 실행)으로는 실행할 수 없다** — TTY가 없으면 그냥 멈추거나 타임아웃난다. 반드시 **사용자가 지금 보고 있는 그 터미널 화면에서, 실시간으로 출력을 보여주고 입력을 받을 수 있는 방식**으로 실행해라. 이게 안 되는 실행 환경(예: 결과만 나중에 받는 백그라운드 작업)에 있다면, 사용자에게 "터미널에 이 명령을 직접 쳐서 로그인해주세요. 끝나면 알려주세요"라고 명확히 요청해라 — 대신 해줄 수 있는 척하지 마라.
- **`cat ~/.codex/auth.json`처럼 파일만 읽는 명령은 대화형이 아니므로 위 규칙과 무관하게 그냥 대신 실행해도 된다.** 단 로그인 자체(위 항목)가 먼저 끝나 있어야 파일이 존재한다.
- **에러가 나면**: 에러 메시지를 사용자에게 그대로 보여주지 말고, 원인과 다음 행동을 한국어 평서문으로 요약해서 전달한다. "AI 기능을 쓰려면 API 키가 필요해요. 발급받아서 알려주시면 제가 설정해드릴게요" 처럼.
- **모르는 용어를 쓰지 않는다**: "provider", "environment variable", "endpoint" 같은 말 대신 "AI 서비스 종류", "설정값", "주소" 처럼 풀어 쓴다.
- **구독 provider를 쓰기로 했다면 반드시 두 가지를 사용자에게 말로 알려준다**:
  1. "이 방식은 지금 이 컴퓨터에서만 동작해요. 다른 컴퓨터나 서버에 배포하면 별도 설정이 필요해요" (구독 세션은 로컬 파일에 저장되기 때문 — 자세한 건 이 문서의 "서버리스/배포 환경" 부분 참고)
  2. "응답이 API 키 방식보다 오래 걸릴 수 있어요(10초 이상도 흔해요). 챗봇 화면을 만든다면 '생각 중...' 같은 로딩 표시를 꼭 넣어주세요" — 로딩 표시 없이 배포하면 사용자가 멈춘 줄 알고 이탈한다.
- **유료 서비스(상담봇, 유료 회원제 등)를 만드는 거라면 다음도 먼저 짚어준다**:
  - 지금 이 패키지는 로그인/결제/사용량 저장(회원별 쿼터)을 대신 해주지 않는다. NextAuth/Clerk 같은 인증, Stripe/토스페이먼츠 같은 결제, Redis/DB 같은 영속 저장소는 별도로 붙여야 한다는 걸 먼저 말해준다.
  - "얼마 나갈지 감이 안 잡힌다"고 하면 이 저장소의 `docs/cost-guide.md`를 같이 열어서 모델별 단가와 계산법을 설명해준다.
  - 상담 주제가 법률·의료·부동산·재무처럼 잘못된 답이 실제 피해로 이어질 수 있는 영역이면, `docs/safety-guide.md`의 시스템 프롬프트 가드레일 예시를 반드시 참고해서 "확정적인 조언 금지, 담당자 연결" 문구를 넣어준다.

## 구현 체크리스트 (순서대로 실행, 임의로 건너뛰지 않는다)

"AI 기능 추가해줘" 같은 요청을 받으면 아래를 **끝까지 실제로 실행**한다. 코드만 써놓고 "됐다"고 보고하지 않는다 — 마지막 단계(실제 호출 검증)까지 마쳐야 완료다.

**0단계 — provider 판단**
[절대 규칙 2](#절대-규칙-2-provider-선택-기준)의 표를 사용자 상황에 대입해서 provider를 정한다. 애매하면 API 키로 시작한다. 사용자가 비개발자면 이 판단 근거를 한두 문장으로 짧게 알려준다("고객이 직접 누르는 기능이라 API 키 방식으로 할게요" 처럼).

**1단계 — 설치**
```bash
npm install llm-runner
```
(npm이 막혀 있거나 에러가 나면 `npm install github:josunghoon53/llm-runner`로 대체 가능 — pnpm 사용 시 `pnpm-workspace.yaml`에 `onlyBuiltDependencies: ["llm-runner"]` 필요)

**2단계 — 서버 코드 작성**
서버 사이드(API 라우트/컨트롤러) 안에 작성한다:
```ts
let runner: ReturnType<typeof createAiRunner> | undefined;
function getRunner() {
  if (!runner) runner = createAiRunner({ provider: '...' }); // 0단계에서 정한 값
  return runner;
}
```
- **`createAiRunner()`를 파일 최상단에서 바로 호출하지 않는다** — 항상 위처럼 지연 생성한다. Next.js 등에서 빌드 타임에 CLI PATH 체크가 실행돼 빌드 자체가 실패하는 걸 막기 위함이다.
- API 키 provider면 `.env`에 `ANTHROPIC_API_KEY` 또는 `OPENAI_API_KEY` 추가 (`.env.example`에도 반영)
- 프론트는 이 API 엔드포인트를 `fetch`로만 호출한다 (직접 `llm-runner` import 금지 — 절대 규칙 1)

**3단계 — 실제로 한 번 호출해서 검증한다 (생략 금지)**
서버를 띄우고(`npm run dev` 등) 방금 만든 엔드포인트에 실제 요청을 보내서(curl 또는 브라우저) **진짜 응답이 오는지 직접 확인**한다. 코드가 문법적으로 맞아 보인다는 이유로 검증을 생략하지 않는다 — 이 프로젝트의 페르소나 테스트에서 실제로 자주 걸렸던 문제들(자동감지 우선순위, 빌드 타임 크래시, 토큰 형식 오류 등)은 전부 "실행해봐야만" 드러났다.
- 성공하면: 사용자에게 실제로 뭐라고 답했는지 보여준다
- 실패하면: 에러 메시지를 그대로 보여주지 말고, "비개발자 사용자를 상대할 때" 섹션대로 원인과 다음 행동을 요약해서 전달한다 — 그리고 스스로 고칠 수 있는 문제(위 검증된 함정들)면 고치고 나서 다시 검증한다

**4단계 — 에러 핸들링 코드 확정**
`run()`은 실패 시 throw하므로 try/catch로 감싼 최종 코드를 남긴다 (3단계에서 확인한 에러 케이스가 실제로 잡히는지 재확인).

## 타입/모델 참고

```ts
import { CLAUDE_API_MODELS, OPENAI_API_MODELS, CLAUDE_SUBSCRIPTION_MODELS, CODEX_MODELS } from 'llm-runner';
// CLAUDE_API_MODELS.SONNET, OPENAI_API_MODELS.GPT_4O_MINI 등으로 모델 지정 가능 (생략 시 기본값 사용)
```

## 더 깊은 배경이 필요하면

- 전체 설계 이유: `README.md`
- 구독 vs API 판단 기준을 쉽게 설명한 글: `docs/subscription-vs-api-guide.md`
- 비용이 얼마나 나올지 계산하는 법: `docs/cost-guide.md`
- 상담봇 안전장치(프롬프트 인젝션 방어, 법적 책임 문구): `docs/safety-guide.md`
- 로그인/결제/회원별 사용량 붙이는 법: `docs/auth-and-payments-guide.md`
- 프론트엔드 연결 실제 예제: `examples/nextjs-starter/`
