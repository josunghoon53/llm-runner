import { createAiRunner, type AiProvider } from 'llm-runner';
import { NextRequest, NextResponse } from 'next/server';
import { isRateLimited } from '../../../lib/rate-limit';

// ⚠️ 이 라우트는 호출될 때마다 돈(API 크레딧)이 나갑니다.
// 아래에 기본적인 남용 방지(같은 출처 확인, IP당 호출 제한, 입력 길이 제한)가 들어있지만,
// 이건 지나가는 봇/스캐너를 막는 최소한의 장치일 뿐입니다.
// 실제 사용자에게 공개하는 서비스라면 배포 전에 반드시 로그인(세션) 인증을 추가하세요.
// (NextAuth, Clerk 등 — 로그인한 사용자만 이 라우트를 호출할 수 있게)

const MAX_PROMPT_LENGTH = 4000;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 10;

// 프론트는 이 API 라우트만 호출한다. llm-runner는 여기(서버)에서만 실행된다.
// 서버리스(Vercel 등)에서도 항상 동작하도록 API 키 provider를 기본값으로 쓴다.
// 구독 provider는 계속 켜져 있는 서버에서만 쓸 수 있다 — 바꾸기 전에 ../../AGENTS.md를 읽을 것.
//
// runner를 모듈 최상단에서 바로 생성하지 않고 함수 안에서 지연 생성하는 이유:
// createAiRunner()가 구독 provider일 때 실행하는 PATH 체크(assertCommandOnPath)가
// Next.js의 "Collecting page data" 빌드 단계에서 이 파일이 import될 때 그대로 실행돼버려서,
// 로컬 PATH에 claude/codex CLI가 없는 빌드 서버(Vercel 등)에서는 빌드 자체가 실패한다.
// 실제 요청이 올 때(런타임)만 생성하면 이 문제를 피할 수 있다.
let runner: ReturnType<typeof createAiRunner> | undefined;
function getRunner() {
  if (!runner) {
    runner = createAiRunner({
      provider: (process.env.AI_PROVIDER as AiProvider | undefined) ?? 'claude-api',
    });
  }
  return runner;
}

export async function POST(req: NextRequest) {
  // 브라우저는 fetch 시 Sec-Fetch-Site 헤더를 자동으로 붙인다. 이 페이지에서 보낸 요청이면 'same-origin'이다.
  // curl/봇처럼 헤더가 없거나 다른 사이트에서 온 요청은 거절한다.
  // (curl로 직접 테스트하려면 -H "Sec-Fetch-Site: same-origin"을 붙이면 된다)
  const fetchSite = req.headers.get('sec-fetch-site');
  if (fetchSite !== 'same-origin') {
    return NextResponse.json({ error: '이 페이지에서만 호출할 수 있습니다.' }, { status: 403 });
  }

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  if (await isRateLimited(ip, RATE_LIMIT_WINDOW_MS, RATE_LIMIT_MAX_REQUESTS)) {
    return NextResponse.json({ error: '요청이 너무 많습니다. 잠시 후 다시 시도하세요.' }, { status: 429 });
  }

  const { prompt } = await req.json().catch(() => ({}));
  if (typeof prompt !== 'string' || prompt.trim() === '') {
    return NextResponse.json({ error: 'prompt가 필요합니다.' }, { status: 400 });
  }
  if (prompt.length > MAX_PROMPT_LENGTH) {
    return NextResponse.json({ error: `prompt는 ${MAX_PROMPT_LENGTH}자 이하여야 합니다.` }, { status: 400 });
  }

  try {
    const result = await getRunner().run({ prompt });
    return NextResponse.json({ text: result.text });
  } catch (err) {
    console.error('[api/ai] 실패:', err);
    // 개발 중에는 원인(예: API 키 누락 → 401)을 그대로 보여주고, 배포 환경에서는 감춘다.
    const detail = process.env.NODE_ENV === 'production' ? undefined : String(err);
    return NextResponse.json({ error: 'AI 호출에 실패했습니다.', detail }, { status: 500 });
  }
}
