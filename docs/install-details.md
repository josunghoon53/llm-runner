# 설치 상세 — GitHub에서 설치, 수동 CLI 설치, 사전 점검

[← README로 돌아가기](../README.md)

README의 [설치](../README.md#설치) 절에서 넘어온 상세 내용입니다.

### npm 대신 GitHub에서 바로 설치하기

npm 계정 문제 등으로 최신 버전이 npm에 아직 안 올라갔거나, 그냥 GitHub 소스를 바로 쓰고 싶다면:

```bash
pnpm add github:josunghoon53/llm-runner
```

pnpm은 기본적으로 git 의존성의 빌드 스크립트를 막아두므로(보안 정책), 프로젝트 루트의 `pnpm-workspace.yaml`에 아래를 추가해야 `prepare` 스크립트(TypeScript 빌드)가 실행됩니다:

```yaml
onlyBuiltDependencies:
  - "llm-runner"
```

**npm으로 설치하고 싶다면** `npm install github:josunghoon53/llm-runner`도 되지만, npm 버전에 따라 git 의존성 설치 중 `Cannot read properties of null (reading 'edgesOut')`라는, llm-runner와 무관한 npm 자체 버그가 날 수 있습니다(이 경우 pnpm을 쓰거나 npm을 최신 버전으로 올려보세요).

## 구독 provider용 CLI 설치와 로그인

구독 provider(`claude-subscription`, `openai-subscription`)를 쓰려면 로컬에 해당 CLI가 설치되고 로그인되어 있어야 합니다. 아래 명령으로 한 번에 확인·설치·로그인할 수 있습니다.

```bash
npx llm-runner-setup          # 설치/로그인 상태 확인
npx llm-runner-setup --login  # 설치는 됐는데 로그인이 안 된 CLI를 대화형으로 로그인
```

수동으로 하려면:

```bash
npm install -g @anthropic-ai/claude-code && claude login
npm install -g @openai/codex && codex login
```

앱 코드에서 미리 상태를 확인하고 싶으면:

```ts
import { checkSubscriptionSetup } from 'llm-runner';

const { claude, codex } = checkSubscriptionSetup();
if (!claude.loggedIn) {
  console.warn(`Claude 구독 미설정: ${claude.loginCommand} 실행 필요`);
}
```
