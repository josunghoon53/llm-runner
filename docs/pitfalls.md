# 검증된 함정들

[← README로 돌아가기](../README.md)

직접 테스트하며 확인한, 문서에 잘 안 나오는 것들입니다.

> 아래 항목들은 **2026-09-23에 최신 SDK로 다시 확인**했습니다(`claude-agent-sdk` 0.3.278, `codex-sdk` 0.155.1).
> "이건 안 된다"는 주장은 시간이 지나면 틀릴 수 있어서, 정기적으로 되묻는 편이 낫습니다 —
> 실제로 이 점검에서 `claude-subscription`의 구조화 출력 주장 하나가 틀린 걸로 드러나 0.5.0에서 고쳤습니다.



직접 테스트하며 확인한, 문서에 잘 안 나오는 것들:

- **Claude: `allowedTools: []`만으로는 도구가 안 막힌다.** 실제로 Bash를 통해 우회 실행되는 걸 확인했다. `disallowedTools`로 도구 이름을 명시해야 진짜로 막힌다.
- **Codex: `sandboxMode: 'read-only'`도 명령 실행 자체는 못 막는다.** 파일 쓰기·네트워크는 확실히 막지만, `ls`/`pwd` 같은 부작용 없는 명령은 policy와 무관하게 실행된다. SDK/CLI 레벨에서 명령 실행 자체를 원천 차단하는 옵션은 없다.
- **Codex: `approvalPolicy: 'untrusted'`는 타입 정의엔 있지만 실제 CLI(0.154.0+)에서 deprecated라 런타임 에러가 난다.** `on-request`를 쓴다.
- **Claude 모델 별칭(`haiku`/`sonnet`/`opus`)과 API 전체 ID(`claude-sonnet-5`)는 다른 이름 공간이다.** CLI는 별칭을, Messages API는 전체 ID만 받는다.
- **OpenAI는 일반 채팅 완성을 구독으로 헤드리스 호출하는 공식 경로가 없다.** 구독 헤드리스가 공식으로 열려있는 건 Codex(코딩 에이전트) 용도뿐이라, `openai-subscription` provider는 내부적으로 Codex SDK를 쓴다.
- **API 키가 없으면 SDK 생성자가 즉시 예외를 던진다.** 그래서 `claude-api`/`openai-api` provider는 키가 없어도 인스턴스 생성 자체는 통과시키고, 실제 실패는 `run()` 호출 시점으로 미룬다.
- **Codex 기본 모델(`gpt-5.6-luna`)이 "at capacity"로 거절되는 일이 실제로 있다.** 그래서 `openai-subscription`은 `model`을 지정하지 않은 경우에 한해 한 단계 위 모델(`terra`)로 한 번 자동 재시도하고 stderr에 알린다. 모델을 직접 지정했으면 바꿔치기하지 않는다.
- **구독 provider(`claude-subscription`/`openai-subscription`)는 API 키 방식보다 응답이 훨씬 오래 걸릴 수 있다.** CLI 에이전트 하네스를 통째로 띄우는 구조라 실측 기준 10초 이상 걸리는 경우가 흔하다. 챗봇 UI를 만든다면 "생각 중..." 같은 로딩 표시를 반드시 넣어라 — 안 그러면 사용자가 "멈췄나?" 하고 화면을 닫아버린다.
- **`createAiRunner()`를 모듈 최상단(top-level)에서 호출하면 Next.js 빌드 자체가 실패할 수 있다.** 구독 provider를 명시하면 `checkCliOnCreate`가 즉시 PATH에서 CLI를 찾는데, Next.js는 API 라우트 파일을 빌드 중 "Collecting page data" 단계에서 한 번 import해서 실행해본다 — 이때 빌드 서버(Vercel 등)엔 당연히 `claude`/`codex` CLI가 없으니 빌드가 죽는다. `createAiRunner()`는 요청 핸들러 안에서 지연 생성(예: 메모이즈된 함수)하는 걸 권장한다 — `examples/nextjs-starter/app/api/ai/route.ts`가 이 패턴을 쓴다.
- **`claude-agent-sdk`를 Next.js/Vercel에 배포하면 `Native CLI binary for linux-x64 not found` 에러가 난다.** 플랫폼별 네이티브 바이너리가 optionalDependency로 동적 로드되는데, Next.js의 빌드 파일 추적이 이걸 못 잡아서 배포 결과물에서 빠지기 때문이다. `next.config.ts`에 `outputFileTracingIncludes`로 명시적으로 포함시켜야 한다([서버리스/배포 환경에서 쓰기](deploy-serverless.md) 참고). 실제로 Vercel 프로덕션에 배포해서 이 순서(등록 전 실패 → 설정 추가 후 실제 응답 성공)를 확인했다.
- **`CLAUDE_CODE_OAUTH_TOKEN`을 잘못 붙여넣으면 `401 OAuth access token is invalid`가 나는데, 이 메시지만으로는 원인을 알 수 없다.** 터미널의 자동 줄바꿈 표시 때문에 토큰이 일부만 복사되거나 공백이 섞여 들어가기 쉽다. 이 에러가 나면 토큰 자체보다 복사 과정을 먼저 의심하고, 필요하면 새로 발급받아 다시 붙여넣어라.
