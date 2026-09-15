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

서버리스 환경은 콜드스타트마다 로그인 세션이 사라지므로 구독 provider가 동작하지 않는다 — 그런 환경이면 무조건 API 키를 쓴다.

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

## 구현 체크리스트

새 AI 기능을 추가할 때:

1. `npm install llm-runner` (또는 `pnpm add llm-runner`)
2. 서버 사이드 코드(API 라우트/컨트롤러)에 `createAiRunner({ provider: '...' })` 작성
   - 배포 대상이 서버리스/불명확하면 `claude-api` 또는 `openai-api` 사용
   - API 키 provider면 `.env`에 `ANTHROPIC_API_KEY` 또는 `OPENAI_API_KEY` 필요 — `.env.example`에 추가
   - **Next.js(App Router) 등 프레임워크에서는 `createAiRunner()`를 파일 최상단에서 바로 호출하지 말고, 요청 핸들러 안에서 지연 생성(메모이즈)해라.** 구독 provider는 생성 시점에 PATH에서 CLI를 찾는데, 이게 빌드 타임에 실행되면 CLI가 없는 빌드 서버에서 빌드 자체가 실패한다. `examples/nextjs-starter/app/api/ai/route.ts`의 `getRunner()` 패턴을 그대로 따라 해라.
3. 프론트는 그 API 엔드포인트를 `fetch`로 호출하도록 작성 (직접 `llm-runner` import 금지)
4. `runner.run({ prompt, system?, model?, maxTokens?, enableWebSearch? })`로 호출
5. 에러 핸들링: `run()`은 실패 시 throw하므로 try/catch로 감싼다

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
