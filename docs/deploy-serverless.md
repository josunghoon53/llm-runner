# 서버리스/배포 환경에서 쓰기

[← README로 돌아가기](../README.md)



구독형 provider는 원래 로그인 세션이 **그 컴퓨터의 파일시스템**(`~/.claude/`, `~/.codex/`)에 저장됩니다. VPS나 직접 관리하는 서버는 한 번 로그인해두면 계속 살아있어서 문제없지만, 서버리스(Lambda, Vercel Functions)처럼 인스턴스가 매번 새로 뜨는 환경은 콜드스타트마다 세션이 사라집니다.

**해결: 로그인 세션을 환경변수(비밀 값)로 옮겨서 콜드스타트마다 복원합니다.**

> ⚠️ **`claude setup-token`은 AI 어시스턴트가 대신 실행해줄 수 없습니다.** 브라우저 로그인 후 화면에 뜨는 코드를 사람이 직접 터미널에 붙여넣어야 하는 대화형(인터랙티브) 명령이라서, Claude Code 같은 어시스턴트가 백그라운드나 자동화된 방식으로 실행하면 그냥 멈춥니다. **사용자 본인이 자기 터미널(또는 Claude Code와 직접 대화하는 그 터미널 화면)에서 명령을 치고 로그인까지 완료**해야 합니다. AI 어시스턴트는 "이 명령을 터미널에 쳐서 나온 값을 저한테 알려주세요"까지만 안내할 수 있습니다.

### Claude
```bash
# 로그인된 로컬 머신의 실제 터미널에서, 사용자가 직접 실행 — 장기 유효 토큰 발급
claude setup-token
```
출력된 토큰을 배포 환경의 `CLAUDE_CODE_OAUTH_TOKEN` 비밀 값으로 저장하세요. SDK가 이 환경변수를 자동으로 읽어서, 파일 복원 없이 바로 동작합니다.

**"배포 환경의 비밀 값으로 저장"이 구체적으로 뭘 뜻하냐면 (Vercel 기준 예시):**
1. https://vercel.com 에서 내 프로젝트로 들어간다
2. 상단 메뉴 **"Settings"** 클릭 → 왼쪽 메뉴에서 **"Environment Variables"** 클릭
3. Key(이름)에 `CLAUDE_CODE_OAUTH_TOKEN`, Value(값)에 방금 발급받은 토큰을 붙여넣고 **"Save"**
4. 이미 배포돼 있었다면 다시 배포(Redeploy)해야 새 환경변수가 적용된다

다른 서비스(Railway, Render, AWS 등)를 쓴다면 "Environment Variables" 또는 "Secrets" 메뉴를 찾으면 된다 — 이름은 다들 비슷하다.

> ⚠️ **토큰을 붙여넣을 때 줄바꿈/공백이 섞이지 않게 조심하세요.** 터미널이 긴 토큰 문자열을 화면 너비에 맞춰 자동으로 줄바꿈해서 보여주는 경우가 있는데, 그건 화면 표시일 뿐 실제 줄바꿈이 아닙니다. 일부만 복사되거나 앞뒤에 공백/개행이 붙으면 `401 OAuth access token is invalid` 에러가 나는데, 이 에러 메시지만 봐서는 "토큰 자체가 잘못됐다"는 건지 "복사가 잘못됐다"는 건지 구분이 안 됩니다 — 실제로 겪어본 결과, 새로 토큰을 발급받아 다시 깨끗하게 붙여넣으니 해결됐습니다.

**Next.js(Vercel)를 쓴다면 배포 설정에 한 가지를 더 추가해야 합니다.** Claude와 Codex 둘 다 플랫폼별 네이티브 실행파일을 optionalDependency로 설치하는데, 이게 동적으로 로드되는 방식이라 Next.js의 빌드 파일 추적(file tracing)이 자동으로 감지하지 못해 배포 결과물에서 빠집니다. 그러면 실제 호출 시 `Native CLI binary for linux-x64 not found`(Claude)나 `spawn codex ENOENT`(Codex) 에러가 납니다.

`next.config.ts`를 `withLlmRunner()`로 감싸면 필요한 설정이 자동으로 들어갑니다:

```ts
import type { NextConfig } from 'next';
import { withLlmRunner } from 'llm-runner/next';

const nextConfig: NextConfig = withLlmRunner({}, {
  routes: ['/api/ai'],                  // llm-runner를 호출하는 라우트만
  providers: ['claude-subscription'],   // 생략하면 설치된 패키지로 자동 감지
});

export default nextConfig;
```

- `routes`: 기본값은 `['/api/**']`. **바이너리가 라우트마다 따로 복사되므로**(Claude 200MB대, Codex 300MB대) 실제로 호출하는 라우트만 좁혀 적는 게 좋습니다.
- `providers`: 생략하면 Claude는 항상 포함하고, Codex는 `@openai/codex`가 의존성에 있을 때만 포함합니다. API 키 provider만 쓴다면 `providers: []`로 아무것도 넣지 마세요.
- 기존 `outputFileTracingIncludes` 설정이 있으면 덮어쓰지 않고 합칩니다. provider별로 라우트를 다르게 두고 싶으면 아래처럼 중첩해서 쓸 수 있습니다:

```ts
const nextConfig: NextConfig = withLlmRunner(
  withLlmRunner({}, { routes: ['/api/chat'], providers: ['claude-subscription'] }),
  { routes: ['/api/codex'], providers: ['openai-subscription'] },
);
```

### Codex

> ⚠️ **먼저 읽으세요 — 두 가지 함정이 있습니다.**
> 1. **`CODEX_ACCESS_TOKEN`을 쓰지 마세요.** 이름만 보면 이걸 쓸 것 같지만, **개인 ChatGPT 계정에서는 원천적으로 동작하지 않습니다**(ChatGPT Business/Enterprise 전용). 아래 `CODEX_AUTH_JSON`을 쓰세요. 자세한 이유는 이 절 뒤쪽에 있습니다.
> 2. **로컬 빌드가 성공해도 배포가 된다는 뜻이 아닙니다.** 이유는 바로 아래 "배포 전에 반드시 확인할 것"을 보세요.

#### 배포 전에 반드시 확인할 것 (가장 흔한 실패)

네이티브 바이너리는 **OS별로 다른 패키지**로 설치됩니다(`@openai/codex-darwin-arm64`, `@openai/codex-linux-x64` …). 내 맥에서 `npm install`하면 macOS용만 설치되고, Vercel이 실제로 쓰는 **linux-x64용은 내 컴퓨터에 아예 없습니다.**

그래서 **로컬에서 `npm run build`가 성공한 건 리눅스 배포가 된다는 증거가 전혀 아닙니다.** (Vercel은 빌드를 리눅스에서 돌리므로 거기선 리눅스용이 설치됩니다 — 원리상 동작하고 실제 프로덕션 배포로 확인도 했지만, **그 확인을 배포 전에 내 컴퓨터에서 할 방법은 없습니다.**)

그러니 배포 직후 **실제로 한 번 호출해보기 전까지는 된다고 믿지 마세요.** 이런 점검용 엔드포인트를 하나 만들어 두고 배포할 때마다 찔러보는 걸 권합니다:

배포 **전에는** 로컬에서 잡을 수 있는 설정 실수를 이 명령으로 먼저 거르세요:

```bash
npx llm-runner-setup --check-deploy
```

`@openai/codex`가 의존성에 제대로 들어있는지, `withLlmRunner()`의 `routes`가 실제 API 라우트와 맞는지를 확인해줍니다(이 둘이 배포 실패의 대부분입니다). 다만 **리눅스용 바이너리가 실제로 실릴지는 이 명령도 확인할 수 없습니다** — 그건 배포 후에만 알 수 있습니다.

```ts
// app/api/health/route.ts — 배포 후 이걸 먼저 호출해서 바이너리가 실렸는지 확인한다
import { tryResolveCodexBinaryPath } from 'llm-runner';

export async function GET() {
  const codexPath = tryResolveCodexBinaryPath(); // 못 찾으면 undefined
  return Response.json({
    codexBinaryFound: Boolean(codexPath),
    platform: `${process.platform}-${process.arch}`,
  });
}
```

`codexBinaryFound: false`가 나오면 `withLlmRunner()`의 `routes`가 실제 라우트 경로와 안 맞거나 `@openai/codex`가 의존성에 없는 것입니다. 이 점검은 AI를 호출하지 않으므로 비용도 시간도 들지 않습니다.

**개인 ChatGPT Plus/Free 계정이면 `CODEX_AUTH_JSON`을 써라 (권장, 직접 검증됨):**

```bash
# Vercel을 쓴다면 — 값을 화면에 한 번도 띄우지 않고 바로 등록한다 (가장 안전)
npx llm-runner-setup --codex-auth-json --vercel

# 다른 배포 환경이라면 — 값을 출력해서 직접 붙여넣는다
npx llm-runner-setup --codex-auth-json
```

OS별 `base64`/`pbcopy` 명령 차이를 몰라도 되고, 파일 위치도 몰라도 된다. `--vercel`은 값을 터미널에 출력하지 않고 `vercel env add`의 stdin으로 곧장 흘려보내므로, 화면·스크롤백·셸 히스토리 어디에도 시크릿이 남지 않는다(환경을 바꾸려면 `--env preview`, 팀 계정이면 `--scope <팀>`을 덧붙인다). 직접 출력하는 경우엔 민감한 값이니 캡처나 공유는 하지 말 것.

나온 값을 배포 환경의 `CODEX_AUTH_JSON` 비밀 값으로 저장하세요. `createAiRunner({ provider: 'openai-subscription' })`을 만들 때 이 값이 있으면, `codex login`을 거치지 않고 그 내용을 그대로 `$CODEX_HOME/auth.json`에 써서 세션을 복원합니다 — 복원은 자동이라 따로 부를 함수가 없습니다.

> ⚠️ **`CODEX_ACCESS_TOKEN` + `codex login --with-access-token` 방식은 개인 계정에서 동작하지 않습니다** — 직접 검증함. 이 방식은 **ChatGPT Business/Enterprise 워크스페이스 관리자 콘솔에서 발급한 토큰만 지원**하며, 개인 계정의 일반 세션 토큰을 넣으면 `agent identity JWT payload is not valid JSON`라는, 원인을 짐작하기 어려운 에러로 실패합니다. Business/Enterprise 워크스페이스를 쓰는 게 아니라면 `CODEX_ACCESS_TOKEN`을 시도하지 말고 바로 `CODEX_AUTH_JSON`을 쓰세요.

**Business/Enterprise 워크스페이스면 `CODEX_ACCESS_TOKEN`도 여전히 지원합니다:**
```bash
cat ~/.codex/auth.json   # tokens.access_token 값 확인
```
이 값을 `CODEX_ACCESS_TOKEN`으로 저장하면 `codex login --with-access-token`으로 복원합니다. `CODEX_AUTH_JSON`이 있으면 이쪽보다 우선 적용됩니다.

**⚠️ 환경변수 스냅샷만 쓰면 시간이 지나 조용히 깨집니다 — `codexAuthStore`를 설정하세요.** `auth.json` 안의 `refresh_token`은 보통 1회용(rotating)이라서, 배포된 함수가 만료된 토큰을 갱신할 때마다 새로 발급되고 예전 값은 무효화됩니다. 그 갱신분은 함수 인스턴스가 죽으면 사라지고, 다음 콜드스타트는 처음 넣어둔 예전 스냅샷을 다시 씁니다.

`codexAuthStore`에 **"어디에 저장할지"만 알려주면 갱신 감지와 저장은 llm-runner가 알아서 합니다**:

```ts
import { createAiRunner } from 'llm-runner';

const runner = createAiRunner({
  provider: 'openai-subscription',
  codexAuthStore: {
    load: () => kv.get<string>('codex-auth'),      // 없으면 undefined를 주면 된다
    save: (value) => kv.set('codex-auth', value),  // 저장소는 아무거나 — KV, Redis, DB, S3
  },
});
```

동작 순서는 이렇습니다:

1. 첫 호출 직전에 `load()`를 읽는다. 값이 있으면 **그게 최신**이므로 그걸로 세션을 복원한다.
2. 비어 있으면 `CODEX_AUTH_JSON` 환경변수로 복원하고, 그 값을 `save()`로 한 번 심어둔다. 이후로는 store가 원본이 되고, 환경변수는 최초 부트스트랩용으로만 쓰인다.
3. 매 호출 후 `auth.json`이 실제로 바뀌었는지 해시로 비교해서, **바뀌었을 때만** `save()`를 부른다.

`save()`가 실패해도 예외를 던지지 않고 경고만 남깁니다 — 이미 성공한 AI 호출 결과까지 날려버리면 안 되니까요.

> ⚠️ **동시 갱신 경쟁은 두 종류이고, 하나만 llm-runner가 막아줍니다.**
>
> **① 한 프로세스 안에서의 경쟁 — llm-runner가 막습니다.** 요청 두 개가 거의 동시에 끝나면 둘 다 "새 토큰이 생겼다"고 판단해서 `save()`를 중복 호출할 수 있습니다(저장이 끝나기 전엔 서로의 진행을 모르므로). 이건 실제 버그였고, 지금은 저장을 프로세스 안에서 한 번에 하나씩만 돌리도록 직렬화해서 해결했습니다 — 동시 5건으로 재현 테스트까지 넣어뒀습니다.
>
> **② 여러 인스턴스 사이의 경쟁 — 막아줄 수 없습니다.** 서버리스는 인스턴스가 여러 개 동시에 뜨는데, 그중 둘이 같은 낡은 스냅샷에서 출발해 각자 토큰을 갱신하면 **먼저 갱신한 쪽의 refresh_token이 무효화**됩니다. 그러면 나중에 저장된 값이 store를 덮어써서, 무효가 된 값이 최신인 것처럼 남을 수 있습니다. 토큰 회전 자체가 "먼저 쓴 사람이 이긴다" 구조라, 이건 저장소 쪽에서 막아야 합니다.
>
> 그래서 `save()`에는 **직전에 알고 있던 값**이 함께 넘어옵니다. 저장소가 조건부 쓰기를 지원한다면 이걸로 남의 갱신을 덮어쓰는 걸 막을 수 있습니다:
> ```ts
> save: async (value, context) => {
>   // "현재 값이 context.previous일 때만 쓴다" — 아니면 다른 인스턴스가 이미 갱신한 것이니 포기한다
>   await kv.compareAndSet('codex-auth', context?.previous, value);
> },
> ```
>
> 트래픽이 적고 인스턴스가 사실상 하나인 개인용 서비스에서는 거의 문제가 되지 않습니다. 하지만 동시성이 있는 서비스라면 다음 중 하나를 권합니다.
> - **위처럼 조건부 쓰기(CAS)를 지원하는 저장소로 구현**하기
> - 애초에 **`claude-api`/`openai-api`(API 키)로 가기** — 이 문제 자체가 존재하지 않습니다
>
> 덧붙여 정직하게 밝히면, **"refresh_token이 실제로 언제 회전되는지"는 몇 주 단위라 이 기능을 만들면서 실제로 재현해보지 못했습니다.** 회전이 일어난다는 전제 위에 설계된 안전장치이고, 회전 감지·저장 동작 자체는 검증했지만 실서비스에서의 회전 시점은 미검증입니다.

실제 검증: 격리된 `CODEX_HOME`에서 store를 비운 채 시작 → 환경변수로 복원되어 실제 Codex 호출 성공 → store에 값이 심어짐 → `auth.json`을 변조해 회전을 흉내 내니 변경이 감지되어 store가 새 값으로 갱신되는 것까지 확인했습니다. (다만 "리프레시 토큰이 실서비스에서 실제로 로테이션되는 시점"은 몇 주 단위라 이 세션에서 재현하지 못했습니다.)

store 없이 직접 파이프라인을 짜고 싶으면 `getRefreshedCodexAuthJson()`으로 최신 값을 꺼낼 수 있고, 지금 토큰이 언제 만료되는지는 `checkCodexAuthFreshness()`(또는 `npx llm-runner-setup`)로 확인할 수 있습니다 — 토큰 값 자체는 반환하지 않고 만료 시각만 알려줍니다.

**바이너리는 알아서 찾습니다.** `@openai/codex-sdk`(공식 SDK)는 `@anthropic-ai/claude-agent-sdk`와 달리 자체 네이티브 바이너리를 안 쓰고 PATH의 `codex` 실행파일에 의존합니다. 서버리스엔 그게 없으므로 번들된 바이너리가 필요한데, 이 과정은 자동화되어 있습니다:

1. 프로젝트에 `@openai/codex`를 일반 의존성으로 설치한다 (전역 설치 아님): `npm install @openai/codex`
2. `next.config.ts`를 위에서 설명한 `withLlmRunner()`로 감싼다 (`providers`를 생략하면 `@openai/codex` 설치를 감지해 자동 포함).
3. 코드는 평소대로 쓴다 — **경로를 직접 지정할 필요가 없다**:
   ```ts
   const runner = createAiRunner({ provider: 'openai-subscription' });
   ```
   PATH에 `codex`가 있으면 그걸 쓰고(로컬 개발), 없으면 번들된 `@openai/codex-<platform>` 바이너리를 자동으로 찾습니다(서버리스). 자동 탐지가 통하지 않는 특이한 배포 구조에서만 `codexPathOverride`를 직접 주면 되고, 경로는 `resolveCodexBinaryPath()`로 얻을 수 있습니다.

이 절차 전체를 실제 Vercel 프로덕션에 배포해서, 코드에 경로를 한 줄도 쓰지 않은 상태로 개인 ChatGPT Plus 계정의 진짜 응답을 받는 것까지 확인했습니다.
