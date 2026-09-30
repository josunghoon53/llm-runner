import { vi } from 'vitest';

const initialize = vi.fn(async () => {});
const request = vi.fn();
const close = vi.fn();
// 화살표 함수는 new로 못 부른다 — 일반 함수여야 생성자로 쓸 수 있다.
vi.mock('./codex-app-server-session.js', () => ({
  CodexAppServerPeer: function () {
    return { initialize, request, close };
  },
}));

const { getCodexPlanUsage } = await import('./codex-plan-usage.js');

describe('getCodexPlanUsage', () => {
  beforeEach(() => {
    initialize.mockClear();
    request.mockReset();
    close.mockClear();
  });

  // 실측 응답 그대로: resetsAt은 초 단위 epoch, 창 길이는 분.
  it('두 창을 남은 비율·리셋 시각·창 길이로 정규화한다', async () => {
    request.mockResolvedValue({
      ordinaryUsageAllowed: true,
      rateLimits: {
        planType: 'plus',
        primary: { usedPercent: 12, windowDurationMins: 300, resetsAt: 1790602296 },
        secondary: { usedPercent: 40, windowDurationMins: 10080, resetsAt: 1791189096 },
        credits: { hasCredits: false, unlimited: false, balance: '0' },
      },
    });

    const usage = await getCodexPlanUsage();

    expect(usage.available).toBe(true);
    expect(usage.planType).toBe('plus');
    expect(usage.ordinaryUsageAllowed).toBe(true);
    expect(usage.primary).toMatchObject({ usedPercent: 12, remainingPercent: 88, windowMinutes: 300 });
    expect(usage.primary?.resetsAt?.getTime()).toBe(1790602296 * 1000);
    expect(usage.secondary).toMatchObject({ remainingPercent: 60, windowMinutes: 10080 });
    expect(usage.credits).toEqual({ hasCredits: false, unlimited: false, balance: '0' });
  });

  it('account/rateLimits/read를 부르고 세션을 닫는다', async () => {
    request.mockResolvedValue({ rateLimits: { planType: 'free' } });

    await getCodexPlanUsage();

    expect(initialize).toHaveBeenCalled();
    expect(request).toHaveBeenCalledWith('account/rateLimits/read', { excludeResetCreditDetails: true });
    expect(close).toHaveBeenCalled();
  });

  it('한도 정보가 없으면 available: false', async () => {
    request.mockResolvedValue({ rateLimits: null });

    await expect(getCodexPlanUsage()).resolves.toEqual({ available: false });
  });

  // app-server는 OpenAI가 experimental이라고 표시한 프로토콜이다. 바뀌면 조용히 비워야 한다.
  it('프로토콜이 바뀌어 요청이 실패해도 던지지 않는다', async () => {
    request.mockRejectedValue(new Error('unknown method'));

    await expect(getCodexPlanUsage()).resolves.toEqual({ available: false });
    expect(close).toHaveBeenCalled();
  });

  it('실패해도 프로세스를 반드시 정리한다', async () => {
    initialize.mockRejectedValueOnce(new Error('codex 바이너리를 찾을 수 없다'));

    await expect(getCodexPlanUsage()).resolves.toEqual({ available: false });
    expect(close).toHaveBeenCalled();
  });
});
