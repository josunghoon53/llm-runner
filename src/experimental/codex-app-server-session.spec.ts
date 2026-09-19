import { vi } from 'vitest';
import { PassThrough } from 'node:stream';
import { EventEmitter } from 'node:events';

const spawnMock = vi.fn();

vi.mock('node:child_process', () => ({
  spawn: spawnMock,
}));

const { createExperimentalCodexAppServerSession } = await import('./codex-app-server-session.js');

/** 가짜 codex app-server 프로세스. stdin에 쓴 줄을 파싱해서 스크립트대로 stdout에 응답을 흘려보낸다. */
function createFakeCodexAppServerProcess() {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const written: unknown[] = [];
  const child = Object.assign(new EventEmitter(), {
    stdout,
    stderr,
    stdin: { write: vi.fn((line: string) => written.push(JSON.parse(line))) },
    kill: vi.fn(),
  });
  return { child, stdout, written };
}

function respondLine(stdout: PassThrough, message: unknown) {
  stdout.write(`${JSON.stringify(message)}\n`);
}

describe('createExperimentalCodexAppServerSession', () => {
  beforeEach(() => {
    spawnMock.mockReset();
  });

  it('initialize 핸드셰이크(request + notify)를 순서대로 보낸다', async () => {
    const { child, stdout, written } = createFakeCodexAppServerProcess();
    spawnMock.mockReturnValue(child);

    const sessionPromise = createExperimentalCodexAppServerSession({ model: 'gpt-5.6-luna' });
    await new Promise((r) => setImmediate(r));
    respondLine(stdout, { id: written[0]!.id as number, result: {} });
    const session = await sessionPromise;

    expect((written[0] as { method: string }).method).toBe('initialize');
    expect((written[1] as { method: string }).method).toBe('initialized');
    expect((written[1] as { id?: number }).id).toBeUndefined();
    session.close();
  });

  it('send()는 thread/start 후 turn/start를 보내고, turn/completed에서 텍스트를 모아 반환한다', async () => {
    const { child, stdout, written } = createFakeCodexAppServerProcess();
    spawnMock.mockReturnValue(child);

    const sessionPromise = createExperimentalCodexAppServerSession({ model: 'gpt-5.6-luna' });
    await new Promise((r) => setImmediate(r));
    respondLine(stdout, { id: (written[0] as { id: number }).id, result: {} });
    const session = await sessionPromise;

    const sendPromise = session.send('1+1은?');
    await new Promise((r) => setImmediate(r));
    const threadStartReq = written.find((w) => (w as { method?: string }).method === 'thread/start') as { id: number };
    respondLine(stdout, { id: threadStartReq.id, result: { thread: { id: 'thread-1' } } });

    await new Promise((r) => setImmediate(r));
    const turnStartReq = written.find((w) => (w as { method?: string }).method === 'turn/start') as { id: number };
    respondLine(stdout, { id: turnStartReq.id, result: { turn: { id: 'turn-1' } } });
    await new Promise((r) => setImmediate(r)); // send()가 turn/start 응답을 받고 리스너를 등록할 시간을 준다

    respondLine(stdout, { method: 'item/completed', params: { turnId: 'turn-1', item: { type: 'agentMessage', text: '2' } } });
    respondLine(stdout, { method: 'turn/completed', params: { turn: { id: 'turn-1', status: 'completed' } } });

    const result = await sendPromise;
    expect(result.text).toBe('2');
    session.close();
  });

  it('turn 상태가 failed면 예외를 던진다', async () => {
    const { child, stdout, written } = createFakeCodexAppServerProcess();
    spawnMock.mockReturnValue(child);

    const sessionPromise = createExperimentalCodexAppServerSession({ model: 'gpt-5.6-luna' });
    await new Promise((r) => setImmediate(r));
    respondLine(stdout, { id: (written[0] as { id: number }).id, result: {} });
    const session = await sessionPromise;

    const sendPromise = session.send('질문');
    await new Promise((r) => setImmediate(r));
    const threadStartReq = written.find((w) => (w as { method?: string }).method === 'thread/start') as { id: number };
    respondLine(stdout, { id: threadStartReq.id, result: { thread: { id: 'thread-1' } } });
    await new Promise((r) => setImmediate(r));
    const turnStartReq = written.find((w) => (w as { method?: string }).method === 'turn/start') as { id: number };
    respondLine(stdout, { id: turnStartReq.id, result: { turn: { id: 'turn-1' } } });
    await new Promise((r) => setImmediate(r));

    respondLine(stdout, { method: 'turn/completed', params: { turn: { id: 'turn-1', status: 'failed' } } });

    await expect(sendPromise).rejects.toThrow(/턴 실패/);
    session.close();
  });

  it('close()를 호출하면 자식 프로세스를 kill하고, 이후 send()는 거부된다', async () => {
    const { child, stdout, written } = createFakeCodexAppServerProcess();
    spawnMock.mockReturnValue(child);

    const sessionPromise = createExperimentalCodexAppServerSession({ model: 'gpt-5.6-luna' });
    await new Promise((r) => setImmediate(r));
    respondLine(stdout, { id: (written[0] as { id: number }).id, result: {} });
    const session = await sessionPromise;

    session.close();

    expect(child.kill).toHaveBeenCalledOnce();
    await expect(session.send('실패해야 함')).rejects.toThrow(/close\(\)된 세션/);
  });

  it('요청 시간 안에 응답이 없으면 타임아웃 에러로 거부한다', async () => {
    const { child } = createFakeCodexAppServerProcess();
    spawnMock.mockReturnValue(child);

    // initialize 응답을 아예 안 준다 — 20ms 안에 타임아웃나야 한다.
    await expect(
      createExperimentalCodexAppServerSession({ model: 'gpt-5.6-luna', requestTimeoutMs: 20 }),
    ).rejects.toThrow(/ms 안에 응답하지 않았다/);
  });

  it('프로세스가 spawn 자체에 실패하면(예: 바이너리 없음) 바로 실패한다', async () => {
    const { child } = createFakeCodexAppServerProcess();
    spawnMock.mockReturnValue(child);

    const sessionPromise = createExperimentalCodexAppServerSession({ model: 'gpt-5.6-luna', requestTimeoutMs: 5000 });
    await new Promise((r) => setImmediate(r));
    child.emit('error', new Error('spawn codex ENOENT'));

    await expect(sessionPromise).rejects.toThrow(/실행할 수 없다/);
  });

  it('턴 진행 중 프로세스가 예기치 않게 종료되면 send()가 그 즉시 실패한다', async () => {
    const { child, stdout, written } = createFakeCodexAppServerProcess();
    spawnMock.mockReturnValue(child);

    const sessionPromise = createExperimentalCodexAppServerSession({ model: 'gpt-5.6-luna' });
    await new Promise((r) => setImmediate(r));
    respondLine(stdout, { id: (written[0] as { id: number }).id, result: {} });
    const session = await sessionPromise;

    const sendPromise = session.send('질문');
    await new Promise((r) => setImmediate(r));
    const threadStartReq = written.find((w) => (w as { method?: string }).method === 'thread/start') as { id: number };
    respondLine(stdout, { id: threadStartReq.id, result: { thread: { id: 'thread-1' } } });
    await new Promise((r) => setImmediate(r));
    const turnStartReq = written.find((w) => (w as { method?: string }).method === 'turn/start') as { id: number };
    respondLine(stdout, { id: turnStartReq.id, result: { turn: { id: 'turn-1' } } });
    await new Promise((r) => setImmediate(r));

    // turn/completed가 오기 전에 프로세스가 죽어버리는 상황을 흉내낸다.
    child.emit('exit', 1, null);

    await expect(sendPromise).rejects.toThrow(/예기치 않게 종료됐다/);
  });

  it('서버가 승인 요청(요청 형태의 메시지)을 보내면 자동으로 거절 응답을 보낸다', async () => {
    const { child, stdout, written } = createFakeCodexAppServerProcess();
    spawnMock.mockReturnValue(child);

    const sessionPromise = createExperimentalCodexAppServerSession({ model: 'gpt-5.6-luna' });
    await new Promise((r) => setImmediate(r));
    respondLine(stdout, { id: (written[0] as { id: number }).id, result: {} });
    await sessionPromise;

    respondLine(stdout, { id: 999, method: 'item/commandExecution/requestApproval', params: {} });
    await new Promise((r) => setImmediate(r));

    const approvalResponse = written.find((w) => (w as { id?: number }).id === 999) as { result?: { decision: string } };
    expect(approvalResponse.result).toEqual({ decision: 'decline' });
  });
});

describe('codex app-server 세션의 사용량(usage) 수집', () => {
  beforeEach(() => {
    spawnMock.mockReset();
  });

  /** 핸드셰이크 → thread/start → turn/start 까지 진행시키고 turn id를 돌려준다. */
  async function startTurn(stdout: PassThrough, written: unknown[], sessionPromise: Promise<unknown>) {
    await new Promise((r) => setImmediate(r));
    respondLine(stdout, { id: (written[0] as { id: number }).id, result: {} });
    const session = (await sessionPromise) as {
      send: (p: string) => Promise<{ usage?: Record<string, number> }>;
      close: () => void;
    };

    const sent = session.send('질문');
    await new Promise((r) => setImmediate(r));
    const threadStart = written.find((m) => (m as { method?: string }).method === 'thread/start') as { id: number };
    respondLine(stdout, { id: threadStart.id, result: { thread: { id: 'thread-1' } } });
    await new Promise((r) => setImmediate(r));
    const turnStart = written.find((m) => (m as { method?: string }).method === 'turn/start') as { id: number };
    respondLine(stdout, { id: turnStart.id, result: { turn: { id: 'turn-1' } } });
    await new Promise((r) => setImmediate(r));

    return { session, sent };
  }

  it('thread/tokenUsage/updated 알림에서 이번 턴 사용량을 담아준다', async () => {
    const { child, stdout, written } = createFakeCodexAppServerProcess();
    spawnMock.mockReturnValue(child);
    const { session, sent } = await startTurn(stdout, written, createExperimentalCodexAppServerSession());

    respondLine(stdout, {
      method: 'thread/tokenUsage/updated',
      params: {
        turnId: 'turn-1',
        tokenUsage: { last: { inputTokens: 100, cachedInputTokens: 30, outputTokens: 7, reasoningOutputTokens: 2 } },
      },
    });
    respondLine(stdout, { method: 'item/completed', params: { turnId: 'turn-1', item: { type: 'agentMessage', text: '답' } } });
    respondLine(stdout, { method: 'turn/completed', params: { turn: { id: 'turn-1', status: 'completed' } } });

    const result = await sent;
    expect(result.usage).toEqual({
      inputTokens: 100,
      outputTokens: 7,
      cachedInputTokens: 30,
      reasoningTokens: 2,
    });
    session.close();
  });

  it('다른 턴의 사용량 알림은 무시한다', async () => {
    const { child, stdout, written } = createFakeCodexAppServerProcess();
    spawnMock.mockReturnValue(child);
    const { session, sent } = await startTurn(stdout, written, createExperimentalCodexAppServerSession());

    respondLine(stdout, {
      method: 'thread/tokenUsage/updated',
      params: { turnId: '다른-턴', tokenUsage: { last: { inputTokens: 999 } } },
    });
    respondLine(stdout, { method: 'item/completed', params: { turnId: 'turn-1', item: { type: 'agentMessage', text: '답' } } });
    respondLine(stdout, { method: 'turn/completed', params: { turn: { id: 'turn-1', status: 'completed' } } });

    expect((await sent).usage).toBeUndefined();
    session.close();
  });
});
