# 구독 사용량·계정·로그인 (`llm-runner/experimental`)

[← README로 돌아가기](../README.md)

구독 플랜 잔량 조회, 계정 여러 개 굴리기, 한도 실시간 알림, 프로필 로그인/로그아웃, 계정 정보 조회입니다. 모두 토큰을 쓰지 않습니다.

### 구독 플랜이 얼마나 남았는지 — `getClaudePlanUsage()`

터미널에서 `/usage`를 쳤을 때 보는 값을 코드로 읽습니다. **토큰을 쓰지 않습니다** — 프롬프트를 보내지 않고 제어 요청만 보내기 때문입니다(실측: 세션 비용 $0, 약 2~4초).

```ts
import { getClaudePlanUsage } from 'llm-runner/experimental';

const usage = await getClaudePlanUsage();
if (usage.available) {
  console.log(usage.subscriptionType);                 // 'max'
  console.log(usage.fiveHour?.remainingPercent);       // 86
  console.log(usage.sevenDay?.remainingPercent);       // 73
  console.log(usage.fiveHour?.resetsAt);               // Date
}
```

배치를 돌리기 전에 남은 양을 보고 멈출지 정하는 식으로 쓸 수 있습니다.

```ts
const { fiveHour } = await getClaudePlanUsage();
if ((fiveHour?.remainingPercent ?? 100) < 10) {
  throw new Error('5시간 한도가 10% 미만이라 배치를 시작하지 않습니다.');
}
```

⚠️ **`AiRunner` 인터페이스에 없는 이유**가 셋입니다.

- **Claude 구독에서만 됩니다.** Codex SDK에는 한도·잔량 관련 타입이 아예 없고, API 키·Bedrock·Vertex는 플랜 한도 개념이 없어 `available: false`로 옵니다.
- SDK가 이 기능을 `usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET()`라는 이름으로 내놨고, **"안정화되면 이름이 바뀐다"**고 문서에 적어뒀습니다. 이름이 바뀌면 이 함수는 던지지 않고 `available: false`를 돌려줍니다.
- 응답에 **타입 정의에 없는 창이 섞여 옵니다**(실측: `iguana_necktie`, `nimbus_quill`). 알려진 `fiveHour`/`sevenDay`만 따로 담고 나머지는 `others`에 넘기니, 표시 용도로만 쓰고 구조에 의존하지 마세요.

Codex 구독도 같은 모양으로 읽을 수 있습니다.

```ts
import { getCodexPlanUsage } from 'llm-runner/experimental';

const usage = await getCodexPlanUsage();
if (usage.available) {
  console.log(usage.planType);                       // 'plus'
  console.log(usage.primary?.remainingPercent);      // 100   (창 길이 300분)
  console.log(usage.secondary?.remainingPercent);    // 100   (창 길이 10080분)
  console.log(usage.credits);                        // { hasCredits: false, unlimited: false, balance: '0' }
}
```

공식 `@openai/codex-sdk`에는 한도 관련 타입이 없습니다. 대신 `codex app-server`의 `account/rateLimits/read`를 직접 부릅니다 — `createSession()`이 이미 쓰고 있는 채널이라 새로 붙이는 의존성은 없습니다. 이쪽도 **토큰을 쓰지 않습니다.**

⚠️ `ordinaryUsageAllowed`가 `null`이면 **알 수 없음**입니다. 프로토콜 주석이 못 박습니다 — *"퍼센트나 리셋 시각으로 회복을 추론하면 안 된다."*

| | Claude 구독 | Codex 구독 |
|---|---|---|
| 호출당 토큰 | ✅ | ✅ |
| 호출당 금액 | ✅ `costUsd` | ❌ (Codex가 안 줌) |
| 플랜 잔량 | ✅ `getClaudePlanUsage()` | ✅ `getCodexPlanUsage()` |
| 크레딧 잔액 | — | ✅ |

### 계정을 여러 개 굴리기 — `codexHome` / `claudeConfigDir`

두 CLI 모두 자격 증명을 한 디렉터리에 모아 둡니다. 다른 디렉터리를 가리키면 **완전히 다른 계정**이 됩니다. 기존 로그인은 건드리지 않습니다.

```ts
const work     = createAiRunner({ provider: 'openai-subscription', codexHome: '~/.codex-work' });
const personal = createAiRunner({ provider: 'openai-subscription', codexHome: '~/.codex-personal' });

const claudeWork = createAiRunner({ provider: 'claude-subscription', claudeConfigDir: '~/.claude-work' });
```

러너마다 따로 넘기므로 **한 프로세스 안에서 두 계정을 동시에** 쓸 수 있습니다. 한 계정 한도가 차면 다른 구독으로 배치를 돌리는 식으로 씁니다.

조회 함수들도 같은 옵션을 받습니다.

```ts
await getCodexAccountInfo({ codexHome: '~/.codex-work' });
await getCodexPlanUsage({ codexHome: '~/.codex-work' });
await getClaudeAccountInfo({ claudeConfigDir: '~/.claude-work' });
await getClaudePlanUsage({ claudeConfigDir: '~/.claude-work' });
```

**각 프로필에 로그인하는 건 사용자가 한 번씩 직접 해야 합니다.** 브라우저 인증이라 코드로 대신할 수 없습니다.

```bash
CODEX_HOME=~/.codex-work codex login
CLAUDE_CONFIG_DIR=~/.claude-work claude auth login
```

실측(2026-09-30): 빈 디렉터리를 가리키면 Codex는 `401 Unauthorized`, Claude는 `Not logged in`이 나고, 같은 프로세스의 기본 프로필은 그대로 동작했습니다.

> **왜 라이브러리가 감싸는가** — 두 SDK 모두 `env`를 주면 `process.env`를 병합이 아니라 **통째로 교체**합니다(Codex: *"will not inherit variables from process.env"*, Claude: *"REPLACES the subprocess environment entirely"*). 직접 `env: { CODEX_HOME: x }`만 넘기면 `PATH`·`HOME`까지 날아가 "바이너리를 못 찾는다"는 엉뚱한 오류가 납니다. llm-runner가 병합해서 넘깁니다.

### 한도가 차오르는 걸 실시간으로 — `onRateLimits`

`getCodexPlanUsage()`는 물어봐야 답합니다. 긴 배치를 돌리는 중에는 **서버가 알아서 밀어 주는** 쪽이 낫습니다.

```ts
const runner = createAiRunner({
  provider: 'openai-subscription',
  onRateLimits: (usage) => {
    if ((usage.primary?.remainingPercent ?? 100) < 5) 배치를_멈춘다();
  },
});
```

폴링이 아닙니다 — 턴이 도는 동안 서버가 갱신값을 보냅니다(실측: 턴 하나에 3회, 2턴에 2회 수신). `getCodexPlanUsage()`와 **같은 `CodexPlanUsage` 모양**으로 정규화해서 넘깁니다.

빠른 경로(app-server)에서만 흐릅니다. 웹 검색을 켜거나 `reasoningEffort`를 지정하면 안정 경로를 쓰므로 알림이 오지 않습니다. 콜백에서 던진 예외는 삼킵니다 — 알림 때문에 진행 중인 턴이 깨지면 안 되니까요.

`llm-runner/experimental`의 세션에도 같은 옵션이 있습니다.

```ts
await createExperimentalCodexAppServerSession({ onRateLimits: (u) => … });
```

### 프로필에 로그인하기 — `startCodexLogin()` / `startClaudeLogin()`

두 provider의 흐름이 다릅니다. **브라우저는 호출부가 엽니다** — 서버·CI처럼 브라우저가 없는 환경도 있어서, 이 함수들은 URL만 넘깁니다.

**Codex** — 프로토콜이 URL을 주고, 승인이 끝나면 알림이 옵니다.

```ts
import { startCodexLogin } from 'llm-runner/experimental';

const login = await startCodexLogin({ codexHome: '~/.codex-work' });
console.log('브라우저에서 열어주세요:', login.authUrl);

const { success, error } = await login.waitForCompletion();   // 기본 5분 대기
// 도중에 그만두려면: await login.cancel();
```

**Claude** — SDK에 로그인 API가 없어 `claude auth login` CLI를 씁니다. 그 CLI는 **인증 코드를 붙여넣기를 기다리므로** 한 단계가 더 있습니다.

```ts
import { startClaudeLogin } from 'llm-runner/experimental';

const login = await startClaudeLogin({ claudeConfigDir: '~/.claude-work' });
console.log('브라우저에서 승인하세요:', login.authUrl);

login.submitCode(코드);                        // 사용자가 받은 코드를 넣는다
const { success } = await login.waitForCompletion();
```

> CLI가 **스스로 브라우저를 열려고 시도한 뒤**입니다("Opening browser to sign in…"). `authUrl`은 그게 실패했거나 다른 브라우저로 열고 싶을 때 씁니다.

로그아웃도 프로필 단위입니다.

```ts
await codexLogout({ codexHome: '~/.codex-work' });
await claudeLogout({ claudeConfigDir: '~/.claude-work' });
```

⚠️ **프로필을 생략하면 머신 기본 계정에서 로그아웃합니다.** 다른 터미널에서 쓰던 세션까지 끊기고, 되돌리려면 브라우저로 다시 로그인해야 합니다. 프로필을 지정해서 쓰세요.

모든 함수가 실패해도 던지지 않고 `{ success: false, error }` 또는 `{ ok: false, error }`를 돌려줍니다 — 로그인 실패로 앱이 죽으면 안 되니까요. 단 `start*`는 URL조차 못 얻은 경우(실행파일 없음, 응답 형식 변경)에만 던집니다.

### 어느 계정으로 돌고 있는지 — `getClaudeAccountInfo()` / `getCodexAccountInfo()`

두 provider가 **서로 다른 계정**으로 로그인돼 있을 수 있습니다. 의도한 구독을 쓰고 있는지 확인할 때 씁니다.

```ts
import { getClaudeAccountInfo, getCodexAccountInfo } from 'llm-runner/experimental';

const claude = await getClaudeAccountInfo();
// { available: true, email, plan: 'max', organization, organizationId,
//   authKind: 'firstParty', configDirectory: '/Users/…/.claude' }

const codex = await getCodexAccountInfo();
// { available: true, email, plan: 'plus', authKind: 'chatgpt' }
```

`configDirectory`로 **어느 프로필을 보고 있는지** 확인할 수 있습니다. 여러 계정을 굴릴 때 "지금 이 러너가 어느 계정인가"를 화면에 띄우는 용도입니다.

Claude 쪽은 `claude auth status --json`을 먼저 쓰고, 그게 안 되면 Agent SDK로 넘어갑니다. 실측(2026-09-30): CLI가 **308ms에 필드 10개**, SDK는 **2,663ms에 5개**였습니다. 옛 CLI에는 `--json`이 없을 수 있어 대비책을 남겨 뒀습니다.

구독 로그인이 아니면 `available: false`이고 `authKind`만 채워집니다 — Claude는 `'bedrock'`·`'vertex'`·`'gateway'`, Codex는 `'apiKey'`·`'amazonBedrock'`입니다.

⚠️ **이메일은 개인정보입니다.** 로컬 로그인 세션에서 읽어오는 값이니 서버로 보내거나 로그에 남기지 마세요. 화면에 띄운다면 로그인한 본인에게만 보여주는 게 맞습니다. 이 함수들은 **자격 증명 자체(토큰·키)는 읽지 않습니다** — SDK와 CLI가 알아서 씁니다.

이쪽도 **토큰을 쓰지 않습니다.**
