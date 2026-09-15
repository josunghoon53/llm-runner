# llm-runner + Next.js 최소 예제

프론트(React)에서 AI 기능을 쓰고 싶을 때, `llm-runner`는 프론트에서 직접 못 부릅니다(브라우저는 CLI를 실행할 수 없어요). 대신 **백엔드(API 라우트) 하나를 거쳐서** 씁니다.

```
프론트 (page.tsx)
   │  fetch('/api/ai', { prompt })
   ▼
API 라우트 (app/api/ai/route.ts)   ← llm-runner는 여기서만 실행됨
   │
   ▼
Claude API
```

## 파일 설명

- `app/api/ai/route.ts` — 실제 AI 호출이 일어나는 곳. `createAiRunner()`가 여기 있습니다.
- `app/page.tsx` — 프론트. `/api/ai`한테 fetch로 요청만 보냅니다. `llm-runner`를 import하지 않습니다.
- `lib/rate-limit.ts` — IP당 호출 제한. Upstash Redis 설정이 있으면 그걸 쓰고, 없으면 메모리로 자동 폴백합니다.

## 실행

```bash
npm install llm-runner
cp .env.example .env.local
# .env.local에 ANTHROPIC_API_KEY 채우기
npm run dev
```

브라우저에서 `http://localhost:3000` 열면 됩니다.

## ⚠️ 공개 배포 전에 꼭 할 것: 인증 추가

`/api/ai`는 호출될 때마다 **여러분의 API 크레딧이 소모**됩니다. `route.ts`에는 최소한의 남용 방지가 들어있습니다:

- 같은 페이지에서 온 요청만 허용 (`Sec-Fetch-Site: same-origin` 확인)
- IP당 1분에 10회 제한
- prompt 4,000자 제한

하지만 이건 지나가는 봇을 막는 수준입니다. **실제 사용자에게 공개할 서비스라면 로그인(세션) 인증을 추가해서, 로그인한 사용자만 호출할 수 있게 하세요** (NextAuth, Clerk 등). 그렇지 않으면 누군가 이 엔드포인트를 반복 호출해서 크레딧을 소진시킬 수 있습니다.

curl로 직접 테스트할 때는 브라우저가 자동으로 붙이는 헤더를 직접 넣어야 합니다:

```bash
curl -X POST http://localhost:3000/api/ai \
  -H "Content-Type: application/json" \
  -H "Sec-Fetch-Site: same-origin" \
  -d '{"prompt":"안녕"}'
```

### 서버리스에 여러 인스턴스로 배포한다면: rate limit이 정확하지 않을 수 있음

기본 rate limit(`lib/rate-limit.ts`)은 메모리에 카운트를 저장합니다. 트래픽이 적어서 인스턴스가 하나뿐이면 문제없지만, Vercel 등에서 트래픽이 늘어 여러 인스턴스가 동시에 뜨면 **인스턴스마다 따로 세어져서 실제 한도가 느슨해집니다** (인스턴스 3개면 사실상 한도가 3배로 늘어나는 셈).

정확한 제한이 필요하면 아래 순서대로 Upstash에 무료 Redis를 하나 만들면 됩니다(신용카드 등록 불필요, 5분 정도 걸립니다):

1. https://console.upstash.com 접속 → 우측 상단 **"Sign in"**(회원 아니면 자동으로 가입 화면으로 이동) → Google/GitHub 계정 등으로 로그인
2. 로그인 후 대시보드에서 **"Create Database"** 버튼 클릭
3. 이름은 아무거나(예: `my-app-ratelimit`) 입력, Type은 기본값(**Regional**) 그대로, Region은 서비스 배포 지역과 가까운 곳(예: 한국이면 `ap-northeast-1` 계열) 선택 → **"Create"**
4. 생성된 데이터베이스 상세 화면으로 들어가면 **"REST API"** 탭(또는 섹션)이 있습니다. 거기 있는 두 값을 그대로 복사:
   - `UPSTASH_REDIS_REST_URL`
   - `UPSTASH_REDIS_REST_TOKEN`
5. 그 두 값을 `.env.local`에 붙여넣기:

```bash
UPSTASH_REDIS_REST_URL=https://...
UPSTASH_REDIS_REST_TOKEN=...
```

6. 서버 재시작(`npm run dev` 다시 실행, 또는 Vercel이면 재배포)

이게 전부입니다 — 코드는 한 줄도 안 고쳐도 됩니다. 두 값이 다 있으면 `lib/rate-limit.ts`가 자동으로 Upstash를 쓰고, 없으면 메모리로 조용히 폴백합니다(서버 로그에 경고가 한 번 찍힙니다). 추가 npm 패키지 설치 없이 REST API 호출만으로 동작합니다.

화면 메뉴 이름(버튼 위치 등)은 Upstash가 개편하면 바뀔 수 있습니다 — 위 이름과 정확히 다르더라도, "Create Database"와 "REST API" 정도의 키워드로 찾으면 됩니다. 막히면 이 문서 전체를 복사해서 코딩 AI 어시스턴트에게 "Upstash 대시보드 화면을 설명해줄 테니 다음 단계를 알려줘"라고 요청하세요.

## 왜 `claude-api` provider를 기본으로 썼나

이 템플릿은 Vercel 같은 서버리스 배포를 기본 전제로 합니다. API 키는 별도 설정 없이 어디에 배포하든 항상 동작하므로 기본값으로 뒀습니다.

**구독형(`claude-subscription`)도 서버리스에서 실제로 동작합니다** (직접 Vercel에 배포해서 검증함) — 다만 API 키 방식보다 설정할 게 몇 가지 더 있습니다:
1. `.env.local`에 `AI_PROVIDER=claude-subscription` 추가
2. `claude setup-token`으로 받은 토큰을 배포 환경에 `CLAUDE_CODE_OAUTH_TOKEN`으로 등록
3. `next.config.ts`에 `outputFileTracingIncludes` 설정 추가 (네이티브 바이너리가 빌드 결과물에서 누락되는 걸 방지)

자세한 절차는 [README의 "서버리스/배포 환경에서 쓰기"](../../README.md#서버리스배포-환경에서-쓰기)를 참고하세요. 이 설정들이 부담스럽거나 애초에 "고객이 직접 버튼 눌러서 호출하는 서비스"라면, 구독형은 [README의 "구독 사용 시 알아야 할 것"](../../README.md#구독-사용-시-알아야-할-것)에 나온 사용 조건에 안 맞을 수 있으니 먼저 그 기준부터 확인하세요.
