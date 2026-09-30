import { vi } from 'vitest';

const queryMock = vi.fn();
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({ query: (...args: unknown[]) => queryMock(...args) }));

const { getClaudePlanUsage } = await import('./claude-plan-usage.js');

const METHOD = 'usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET';

/** SDK가 돌려주는 스트림 흉내. 제어 요청 응답만 있으면 된다. */
function streamWith(response: unknown, opts: { method?: string } = {}) {
  const ret = vi.fn(async () => ({ done: true, value: undefined }));
  return {
    [opts.method ?? METHOD]: vi.fn(async () => response),
    return: ret,
    _ret: ret,
  } as Record<string, unknown> & { _ret: ReturnType<typeof vi.fn> };
}

describe('getClaudePlanUsage', () => {
  beforeEach(() => queryMock.mockReset());

  it('5시간·7일 창을 남은 비율과 리셋 시각으로 정규화한다', async () => {
    queryMock.mockReturnValue(
      streamWith({
        subscription_type: 'max',
        rate_limits_available: true,
        rate_limits: {
          five_hour: { utilization: 13, resets_at: '2026-09-28T10:40:00Z' },
          seven_day: { utilization: 27, resets_at: '2026-09-30T20:00:00Z' },
        },
      }),
    );

    const usage = await getClaudePlanUsage();

    expect(usage.available).toBe(true);
    expect(usage.subscriptionType).toBe('max');
    expect(usage.fiveHour).toMatchObject({ usedPercent: 13, remainingPercent: 87 });
    expect(usage.fiveHour?.resetsAt?.toISOString()).toBe('2026-09-28T10:40:00.000Z');
    expect(usage.sevenDay).toMatchObject({ usedPercent: 27, remainingPercent: 73 });
  });

  // 실측: 타입 정의에 없는 창이 응답에 섞여 온다(iguana_necktie 등). 버리지 않고 others로 넘긴다.
  it('타입에 없는 창도 others에 담는다', async () => {
    queryMock.mockReturnValue(
      streamWith({
        rate_limits_available: true,
        rate_limits: {
          five_hour: { utilization: 1, resets_at: null },
          extra_usage: { utilization: 15.1, resets_at: null },
          iguana_necktie: { utilization: 0, resets_at: '2026-11-05T07:59:00Z' },
          limits: null,
        },
      }),
    );

    const usage = await getClaudePlanUsage();

    expect(Object.keys(usage.others).sort()).toEqual(['extra_usage', 'iguana_necktie']);
    expect(usage.others.extra_usage).toMatchObject({ usedPercent: 15.1, remainingPercent: 84.9 });
    // 값이 하나도 없는 항목은 표에 빈 줄만 만드므로 뺀다.
    expect(usage.others.limits).toBeUndefined();
  });

  it('플랜 한도가 없는 세션(API 키 등)은 available: false로 돌려준다', async () => {
    queryMock.mockReturnValue(streamWith({ subscription_type: null, rate_limits_available: false, rate_limits: null }));

    const usage = await getClaudePlanUsage();

    expect(usage.available).toBe(false);
    expect(usage.fiveHour).toBeUndefined();
  });

  // SDK가 "안정화되면 메서드 이름을 바꾼다"고 예고했다. 그때 던지지 않고 조용히 비워야 한다.
  it('SDK가 메서드 이름을 바꾸면 던지지 않고 available: false로 돌려준다', async () => {
    queryMock.mockReturnValue(streamWith({}, { method: 'usage' }));

    await expect(getClaudePlanUsage()).resolves.toMatchObject({ available: false });
  });

  it('조회가 실패해도 호출한 쪽 흐름을 끊지 않는다', async () => {
    queryMock.mockReturnValue({
      [METHOD]: vi.fn(async () => {
        throw new Error('Query closed before response received');
      }),
      return: vi.fn(async () => ({ done: true, value: undefined })),
    });

    await expect(getClaudePlanUsage()).resolves.toMatchObject({ available: false });
  });

  it('붙잡아 둔 세션을 반드시 닫는다', async () => {
    const stream = streamWith({ rate_limits_available: false });
    queryMock.mockReturnValue(stream);

    await getClaudePlanUsage();

    expect(stream._ret).toHaveBeenCalled();
  });

  it('프롬프트를 보내지 않는다 (토큰을 쓰지 않아야 한다)', async () => {
    queryMock.mockReturnValue(streamWith({ rate_limits_available: false }));

    await getClaudePlanUsage();

    const passed = queryMock.mock.calls[0][0] as { prompt: AsyncGenerator<unknown> };
    // 조회가 끝나면 제너레이터는 아무것도 yield하지 않은 채 완료돼 있어야 한다.
    // value가 하나라도 있었으면 그게 모델에 보낸 프롬프트다.
    await expect(passed.prompt.next()).resolves.toEqual({ done: true, value: undefined });
  });
});
