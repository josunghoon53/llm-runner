// 서버리스(Vercel 등)는 요청마다 다른 인스턴스가 뜰 수 있어서, 메모리에만 저장하는 rate limit은
// 인스턴스별로 따로 세어져 사실상 무력화된다 (인스턴스 3개면 실질 한도가 3배로 늘어나는 셈).
// UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN이 설정돼 있으면 그 Redis로 카운트를 공유해서
// 이 문제를 해결한다. 없으면 메모리 방식으로 자동 폴백하되, 그 사실을 서버 로그에 명확히 남긴다.
//
// Upstash 무료 플랜(https://upstash.com)이면 추가 npm 패키지 없이 REST API만으로 충분하다.

const memoryStore = new Map<string, number[]>();
let warnedAboutMemoryFallback = false;

function checkWithMemory(key: string, windowMs: number, maxRequests: number): boolean {
  if (!warnedAboutMemoryFallback) {
    warnedAboutMemoryFallback = true;
    console.warn(
      '[rate-limit] UPSTASH_REDIS_REST_URL/TOKEN이 없어서 메모리 기반 rate limit을 씁니다. ' +
        '서버리스(Vercel 등) 배포에서는 인스턴스마다 따로 세어져 실제 한도가 느슨해질 수 있습니다. ' +
        '정확한 제한이 필요하면 Upstash Redis(무료 플랜 가능)를 연결하세요 — README 참고.',
    );
  }

  const now = Date.now();
  const recent = (memoryStore.get(key) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= maxRequests) return true;
  recent.push(now);
  memoryStore.set(key, recent);
  return false;
}

async function checkWithUpstash(
  key: string,
  windowMs: number,
  maxRequests: number,
  url: string,
  token: string,
): Promise<boolean> {
  // INCR로 카운트를 올리고, 그 카운트가 1(=창 시작)이면 TTL을 건다. 파이프라인 하나로 원자적으로 처리한다.
  const windowSeconds = Math.ceil(windowMs / 1000);
  const res = await fetch(`${url}/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify([
      ['INCR', `ratelimit:${key}`],
      ['EXPIRE', `ratelimit:${key}`, String(windowSeconds), 'NX'],
    ]),
  });

  if (!res.ok) {
    console.warn(`[rate-limit] Upstash 호출 실패(${res.status}) — 이번 요청은 통과시킨다.`);
    return false;
  }

  const [incrResult] = (await res.json()) as Array<{ result: number }>;
  return incrResult.result > maxRequests;
}

/**
 * key(보통 IP)가 windowMs 안에 maxRequests번보다 더 요청했으면 true(제한됨)를 반환한다.
 * Upstash 설정이 있으면 여러 서버리스 인스턴스에 걸쳐 정확하게 세고, 없으면 메모리로 폴백한다.
 */
export async function isRateLimited(key: string, windowMs: number, maxRequests: number): Promise<boolean> {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (url && token) {
    return checkWithUpstash(key, windowMs, maxRequests, url, token);
  }

  return checkWithMemory(key, windowMs, maxRequests);
}
