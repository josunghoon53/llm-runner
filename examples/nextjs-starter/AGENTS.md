# 이 예제를 기존 Next.js 프로젝트에 통합하는 법 (에이전트용)

사용자 프로젝트가 이미 Next.js(App Router)라면:

1. `npm install llm-runner` (또는 pnpm/yarn 동일)
2. 이 폴더의 `app/api/ai/route.ts`를 사용자 프로젝트의 `app/api/ai/route.ts`로 복사
3. `.env.example`의 `ANTHROPIC_API_KEY=` 줄을 사용자 프로젝트의 `.env`(또는 `.env.local`)에 추가하고, 실제 키 값을 채우도록 사용자에게 안내
4. `app/page.tsx`의 fetch 호출 패턴(`fetch('/api/ai', { method: 'POST', body: JSON.stringify({ prompt }) })`)을 사용자가 원하는 UI 컴포넌트에 맞게 적용

Pages Router(구조가 `pages/`)라면 `app/api/ai/route.ts`의 `POST` 핸들러 로직을 `pages/api/ai.ts`의 `export default function handler(req, res) { ... }` 형태로 옮긴다 — `createAiRunner()` 호출부와 에러 처리 로직은 동일하게 유지한다.

**바꾸지 말아야 할 것**:
- `route.ts`의 기본 provider `'claude-api'`. 사용자가 명시적으로 "구독으로 하고 싶다"고 하지 않는 한 API 키 provider를 유지한다 (서버리스 배포 시 구독 provider는 동작하지 않음 — `../../AGENTS.md` 참고).
- `route.ts`의 남용 방지 코드(같은 출처 확인, IP당 호출 제한, prompt 길이 제한). 이 라우트는 호출마다 사용자의 API 크레딧이 나가므로 제거하지 않는다.

**추가로 해야 할 것**: 사용자가 이 기능을 실제 사용자에게 공개할 계획이라면, 로그인(세션) 인증을 붙여서 로그인한 사용자만 `/api/ai`를 호출할 수 있게 만들 것을 제안한다. 프로젝트에 이미 NextAuth/Clerk 등이 있으면 그 세션 확인을 `POST` 핸들러 맨 앞에 추가한다.
