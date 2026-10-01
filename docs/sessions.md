# 여러 턴 대화: `createSession()`

[← README로 돌아가기](../README.md)

한 대화가 여러 턴 이어져야 할 때(상담봇 등) 쓰는 세션과, 그 내부 동작·폴백·속도에 대한 내용입니다.

`run()`을 여러 번 부르면 매번 새 `claude` 프로세스를 spawn한다(측정 기준 5~10초/회). 여러 개의 **독립적인** 작업을 처리하는 거라면(예: 종목 A 분석 다음에 종목 B 분석) 이게 맞는 동작이다 — 서로 맥락이 섞이면 안 되니까.

하지만 진짜로 **한 대화가 이어져야 하는** 경우(예: 사용자와 여러 턴 주고받는 상담)라면, 매번 새로 spawn하는 대신 프로세스 하나를 계속 물고 있는 세션을 쓸 수 있다:

```ts
const runner = createAiRunner({ provider: 'claude-subscription' });
const session = runner.createSession({ system: '너는 친절한 상담원이다' });

const r1 = await session.send('안녕, 나는 김철수야');
const r2 = await session.send('내 이름이 뭐라고 했지?');     // "김철수"라고 정확히 답함

session.close(); // 다 쓰면 반드시 호출 — 안 하면 프로세스가 안 죽는다
```

### 속도에 대해 (기대치를 정확히 맞추세요)

세션이 없애주는 비용은 **프로세스 시작 비용 하나뿐**입니다(측정 기준 약 5초). 그래서 효과가 답변 길이에 따라 완전히 달라집니다:

| 상황 | 1턴 | 2턴 | 3턴 | 4턴 |
|---|---|---|---|---|
| 답변이 짧을 때 (한두 단어) | 5.0초 | 1.5초 | 1.9초 | — |
| 답변이 길 때 (상담형, 턴당 1,000자 이상) | 24.5초 | 20.8초 | 19.8초 | 17.7초 |

**답변이 길면 생성 시간이 지배해서 세션 재사용 이득이 거의 안 보입니다.** 짧은 답변을 여러 번 주고받는 구조에서만 체감상 빨라집니다.

#### 그래서 상담봇 같은 걸 만든다면 `sendStream()`을 쓰세요

총 시간은 줄일 수 없지만(생성 시간이라서), **사용자가 빈 화면을 보는 시간**은 줄일 수 있습니다:

```ts
for await (const event of session.sendStream('예산 안에서 뭘 사면 좋을까?')) {
  if (event.type === 'text') process.stdout.write(event.text);
}
```

| | `send()` — 다 될 때까지 대기 | `sendStream()` — 첫 글자까지 |
|---|---|---|
| Claude 1턴 | 24.4초 | **6.0초** |
| Claude 2턴 | 20.1초 | **2.5초** |
| Codex 3턴 | 30.9초 | **4.4초** |

`send()`와 완전히 같은 대화에 속하므로 맥락도 그대로 이어집니다. 다만 Codex의 안정 경로(공식 SDK)는 증분을 못 주기 때문에, 폴백된 상태에서는 답변이 한 덩어리로 도착합니다 — 인터페이스는 같으니 코드를 바꿀 필요는 없습니다.

> 이 표는 외부 테스터가 "문서의 숫자가 재현되지 않는다"고 지적해서 다시 측정한 결과입니다. 이전 판에는 짧은 답변 기준 숫자만 적혀 있어서, 실무형 대화를 만드는 사람에게 2~3배 빨라진다는 잘못된 기대를 줬습니다.

또 하나, **구독 provider는 응답 시간의 편차가 큽니다.** 같은 세션 안에서도 턴마다 8초와 48초가 섞여 나오는 걸 실제로 관측했습니다(Codex 기준). 사용자에게 보여주는 기능이라면 로딩 표시와 타임아웃을 반드시 넣으세요.

세션을 쓸 때 지켜야 할 것:

- **`send()`는 반드시 이전 호출의 결과를 기다린 다음에 불러야 한다** (동시에 여러 번 부르지 않는다)
- **서로 무관해야 하는 작업에는 절대 세션을 재사용하지 마라.** 대화가 이어지는 구조라서 이전 턴의 내용이 다음 턴에 그대로 섞인다 — 직접 검증한 결과, "아까 그 종목 목표주가가 얼마였지?"처럼 이전 턴 내용을 정확히 기억해서 답한다. 종목별 분석처럼 독립성이 중요한 작업이면 세션 대신 `run()`을 각각 새로 불러라.
`claude-api`/`openai-api`는 원래 매 호출이 빠르고 stateless라 이 기능이 필요 없다.

### `openai-subscription`(Codex)의 `createSession()`도 같은 방식으로 동작한다

```ts
const runner = createAiRunner({ provider: 'openai-subscription' });
const session = runner.createSession();

const r1 = await session.send('내가 좋아하는 숫자는 47이야');
const r2 = await session.send('내가 좋아하는 숫자가 뭐였지?');  // "47" — 맥락 유지됨
const r3 = await session.send('거기에 3을 더하면?');           // "50"

session.close();
```

Codex는 여기까지 오는 데 우회로가 하나 필요했다. 공식 `@openai/codex-sdk`는 `Thread`를 재사용해도 **매 호출마다 새 `codex exec` 프로세스를 spawn하고 stdin을 즉시 닫는** 구조라(소스 코드로 직접 확인) 재사용 효과가 전혀 없다. 그래서 `createSession()`은 내부적으로 `codex app-server`(OpenAI가 CLI에서 스스로 `[experimental]`이라고 표시한 JSON-RPC 프로토콜)를 직접 말해서 프로세스 하나를 계속 살려둔다.

**그런데 실험적 프로토콜에 기대는 게 왜 괜찮은가?** 깨지면 자동으로 공식 SDK 경로로 내려앉기 때문이다. 즉 최악의 경우가 "앱이 죽는다"가 아니라 **"턴마다 조금 느려진다"**로 한정된다. 두 가지 실패를 모두 실제로 재현해서 검증했다:

| 실패 상황 | 실제 결과 |
| --- | --- |
| Codex CLI가 `app-server`를 아예 모르는 경우 (미래 버전 시뮬레이션) | 경고 한 줄 남기고 공식 SDK 경로로 시작 → 정상 응답, 맥락 유지 (턴당 5.5초) |
| 대화 도중 `app-server` 프로세스를 강제 종료(`pkill`) | 경고 후 자동 전환 + 지금까지의 대화를 복구 프롬프트로 이어붙임 → 이전 턴 내용("47")을 그대로 기억 |

속도보다 예측 가능성이 중요하면 `createSession({ fastMode: 'off' })`로 항상 공식 SDK 경로만 쓰게 할 수 있다. 웹 검색(`enableWebSearch: true`)은 빠른 경로가 지원하지 않아 자동으로 공식 경로를 쓴다.

#### 폴백은 조용히 일어납니다 — 배포했다면 꼭 연결하세요

폴백의 대가는 "앱이 안 죽는 대신 **조용히 느려진다**"는 것입니다. 로컬에서는 stderr 경고가 보이지만 **서버리스에서는 그 경고가 아무 데도 안 남아서**, 몇 달간 느린 경로로만 돌아도 알 수 없습니다. 그래서 두 가지를 제공합니다:

```ts
const runner = createAiRunner({
  provider: 'openai-subscription',
  onFallback: (event) => logger.warn('llm-runner 폴백', event),
  // { feature: 'session', phase: 'start', from: 'codex-app-server', to: 'codex-sdk', reason: '...' }
});

const session = runner.createSession();
await session.send('...');
console.log(session.activePath); // 'fast' | 'stable' (첫 send 전에는 'pending')
```

- `onFallback`: 내려앉는 **순간**을 구조화된 이벤트로 받습니다. `phase`가 `'start'`면 처음부터 못 쓴 것이고 `'mid-session'`이면 쓰다가 끊긴 것이라 원인이 다릅니다.
- `session.activePath`: **지금** 어느 경로인지 확인합니다. 성능이 기대와 다르면 여기부터 보세요.

핸들러를 주면 stderr 경고는 생략되고(같은 내용을 두 번 알리지 않음), 핸들러에서 예외가 나도 AI 호출은 그대로 성공합니다.

이벤트의 전체 모양은 이렇습니다:

```ts
interface AiFallbackEvent {
  feature: 'session' | 'stream';
  phase: 'start' | 'mid-session';
  from: string;          // 예: 'codex-app-server'
  to: string;            // 예: 'codex-sdk'
  reason: string;        // 사람이 읽을 수 있는 사유
  cause?: unknown;       // 원본 Error 객체
}
```

> ⚠️ **로그에 남길 땐 `reason`을 쓰세요.** `cause`는 `Error` 객체라서 `JSON.stringify()`를 거치면 `{}`로 납작해집니다 — JSON으로 직렬화하는 로거에 이벤트를 통째로 넘기면 정작 원인이 사라집니다.
> ```ts
> onFallback: (e) => logger.warn(`llm-runner 폴백: ${e.feature}/${e.phase} — ${e.reason}`)
> ```

#### 배포 전에 이 배선이 진짜 동작하는지 시험하기

`onFallback`을 로거에 연결해두고 **정작 그 배선이 맞는지는 실제 장애가 나야 알게 되는** 상황을 피하려면, 폴백을 일부러 한 번 일으켜보면 됩니다. 빠른 경로는 `codex app-server`를 실행해서 쓰므로, 그 서브커맨드만 실패하는 가짜 `codex`를 만들어 `codexPathOverride`로 가리키면 됩니다:

```bash
# fake-codex — app-server만 모르는 척하고 나머지는 진짜 codex로 넘긴다
cat > /tmp/fake-codex <<'EOF'
#!/bin/sh
[ "$1" = "app-server" ] && { echo "unrecognized subcommand" >&2; exit 2; }
exec "$(which codex)" "$@"
EOF
chmod +x /tmp/fake-codex
```

```ts
const runner = createAiRunner({
  provider: 'openai-subscription',
  codexPathOverride: '/tmp/fake-codex',   // 평소엔 지정하지 마세요 — 시험용입니다
  onFallback: (e) => logger.warn('폴백', e),
});
```

이러면 `phase: 'start'` 이벤트가 실제로 날아오고 `session.activePath`가 `'stable'`이 되는 걸 눈으로 확인할 수 있습니다. 확인이 끝나면 `codexPathOverride`를 지우면 됩니다.

`claude-subscription`의 `createSession()`과 똑같은 오염 규칙이 적용된다 — 직접 검증함: 같은 세션 안에서는 이전 턴 내용을 정확히 기억하고(의도된 동작), 서로 다른 세션 인스턴스는 완전히 격리된다. 그래서 **서로 무관해야 하는 작업(종목 A 분석, 종목 B 분석 등)은 매번 새 세션을 만들어야 하고, 세션 하나를 여러 독립 작업에 재사용하면 안 된다.**

### 빠른 경로를 직접 제어하고 싶다면 — `llm-runner/experimental`

폴백 없이 `codex app-server`만 쓰고 싶다면(예: 느려지느니 차라리 에러를 받고 싶은 경우) 하위 구현을 직접 쓸 수 있다:

```ts
import { createExperimentalCodexAppServerSession } from 'llm-runner/experimental';

const session = await createExperimentalCodexAppServerSession({ model: 'gpt-5.6-luna' });
await session.send('1+1은?');
session.close();
```

⚠️ 이 경로는 폴백이 없으므로 **OpenAI가 프로토콜을 바꾸면 그대로 실패한다.** 특별한 이유가 없다면 `createSession()`을 써라. 10턴 연속 실행, 실무형 긴 프롬프트, 요청/턴 타임아웃, 프로세스 실행 실패 시 즉시 에러 처리까지 실제로 검증했다.
