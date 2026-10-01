# 구독 사용 시 알아야 할 것

[← README로 돌아가기](../README.md)

구독 provider를 어디까지 써도 되는지에 대한 설계 원칙과 판단 기준입니다.

### 설계 원칙: 이 패키지는 OAuth를 직접 구현하지 않습니다

`ClaudeSubscriptionRunner`, `OpenAiSubscriptionRunner`, `llm-runner-setup --login`, `CODEX_AUTH_JSON` 복원 — 이 중 어느 것도 Anthropic/OpenAI의 OAuth 프로토콜을 직접 구현하지 않습니다.

- **로그인**은 항상 공식 CLI 명령(`claude login`, `codex login`)을 `stdio: 'inherit'`로 그대로 실행합니다. 사용자가 직접 브라우저에서 Anthropic/OpenAI에 로그인하고, 우리 코드는 그 과정을 지켜보지도, 개입하지도 않습니다.
- **호출**은 `@anthropic-ai/claude-agent-sdk`/`@openai/codex-sdk`가 이미 로그인된 로컬 세션을 읽어서 처리하며, 우리 코드는 토큰을 직접 보거나 저장하지 않습니다.
- **서버리스 복원**(`CODEX_ACCESS_TOKEN` → `codex login --with-access-token`, `CLAUDE_CODE_OAUTH_TOKEN`)도 자체 OAuth 클라이언트를 만든 게 아니라, **공식 CLI/SDK가 이미 제공하는 토큰 주입 메커니즘**을 그대로 씁니다. `claude setup-token`은 Anthropic이 Enterprise/CI 용도로 공식 문서화한 기능이고, `codex login --with-access-token`도 Codex CLI의 공식 서브커맨드입니다.

**하지 않는 것**: Anthropic/OpenAI OAuth 프로토콜을 리버스엔지니어링해서 우리 패키지가 로그인 제공자(provider) 역할을 하는 것. 이건 하지 않습니다 — 토큰 발급의 주체는 항상 공식 CLI이고, 우리는 그 결과물을 전달만 합니다.

### 경계선: "고객의 행동이 LLM 호출을 직접 발생시키는가"

먼저 헷갈리기 쉬운 것부터 정리합니다: **`claude -p`/`codex exec`(그리고 이 패키지의 구독 Runner)는 "자동화하지 말라"고 있는 게 아니라, 정반대로 Anthropic/OpenAI가 스크립트·CI/CD·cron에서 쓰라고 공식 문서화한 기능입니다.** 심지어 Anthropic은 구독 요금제 안에 `-p`/Agent SDK 사용량을 계산하는 체계까지 만들어뒀습니다 — 회사 스스로 "구독자가 이걸 프로그램적으로, 자동화해서 돌릴 것"을 전제하고 있다는 뜻입니다.

**핵심은 이겁니다: `-p`/`exec`/Agent SDK는 "실행 방법"이고, 구독이냐 API 키냐는 "인증·과금"이라는 완전히 다른 레이어입니다.** 자동화 자체는 문제가 아니고, 그 자동화를 누가 트리거하느냐가 진짜 기준입니다.

> **가장 정확한 질문: "고객의 특정 행동이 이 LLM 호출을 직접 발생시키는가?"**

- **아니오 (내 workflow가 호출)** → 구독 OK. cron, CI/CD, 매일 도는 배치, 운영자가 검수 후 발행하는 콘텐츠 제작 파이프라인 전부 포함됩니다.
- **예 (고객 행동 → 즉시 LLM 호출)** → API 필요. 고객이 버튼을 누르거나 프롬프트를 입력하는 순간 모델이 불려나가는 구조입니다.

**실무 예시:**

| 패턴 | 판정 |
|---|---|
| CI/CD에서 `codex exec`로 코드 리뷰, 테스트 실패 분석 | ✅ 구독형 OK — 내 개발 workflow |
| 매일 크론으로 `claude -p` 돌려서 브리핑 초안 생성 → **운영자가 사실확인·검수** → 발행 | ✅ 구독형 OK — AI는 내 콘텐츠 제작 workflow를 도와줄 뿐, 최종 판단은 사람이 함 |
| 사내 관리자 페이지에서만 보는 자동 요약 | ✅ 구독형 OK |
| 고객이 "삼성전자 분석해줘" 입력 → 그 순간 LLM 호출 → 고객에게 응답 | ❌ API 필요 — 고객 행동이 직접 호출을 발생시킴 |
| 챗봇, "분석하기" 버튼, 고객별 맞춤 리포트 생성 | ❌ API 필요 |
| 검수·판단 없이 AI 출력이 그대로, 즉시 다수 고객에게 노출되는 자동 파이프라인 | ⚠️ 회색지대 — 사람의 편집/판단 개입이 없을수록 "고객에게 모델을 직접 서비스하는 것"에 가까워짐 |

**운영자 검수 단계가 실제로 의미 있게 작동하는지가 중요합니다** — 형식적으로 통과시키는 게 아니라 진짜 사실확인·중요도 판단이 이뤄진다면, 그 파이프라인은 "내 콘텐츠 제작 workflow"이지 "고객에게 모델을 서비스하는 것"이 아닙니다.

이 패키지(`llm-runner`/`ai-service`)의 Runner 구조가 정확히 이 구분에 맞게 설계되어 있습니다 — 내 workflow를 자동화하는 곳엔 `ClaudeSubscriptionRunner`/`OpenAiSubscriptionRunner`를, 고객 행동이 직접 호출을 트리거하는 곳엔 `ClaudeApiRunner`/`OpenAiApiRunner`를 주입하면 됩니다. 비즈니스 로직은 그대로 두고 주입되는 Runner만 바꾸면 되도록 만든 게 이 구조의 핵심 목적입니다.

### 2026년 타임라인 (참고용)

Claude 구독 + Agent SDK 사용이 괜찮은지에 대한 발표가 한 해 동안 여러 번 바뀌었습니다. 이 이력 자체가 "정책이 유동적"이라는 걸 보여주는 참고 자료입니다.

| 시점 | 내용 |
|---|---|
| 2026-02 | 문서 정리 과정에서 "OAuth를 Agent SDK 등에 쓰면 안 된다"는 문구 추가 → 혼란 |
| 2026-02-20 | Anthropic 엔지니어 해명: "개인적인 로컬 실험은 권장한다. 비즈니스면 API 키를 써라." |
| 2026-04 | 서버 단에서 대형 서드파티 도구(OpenClaw 등) 실제 차단 |
| 2026-05 | "Agent SDK 크레딧" 카테고리로 재허용 — 다만 이건 **과금 방식**에 대한 발표였지, 모든 서드파티 제품에 대한 포괄적 승인으로 보기는 어렵습니다 |
| 2026-06-15 | 크레딧 분리 과금 계획을 시행 당일 보류 — Agent SDK/`claude -p`/서드파티 앱 사용은 다시 일반 구독 사용량에 포함되는 것으로 롤백 |

**현재(2026-09) 공식 문서 기준으로는, 여전히 "제3자 제품/서비스는 API 키를 쓰라"는 원칙이 살아있습니다.** 이 패키지가 "구독 인증을 직접 구현/중개하지 않고 로컬 세션만 재사용"하는 설계를 지키는 이유가 이것입니다.

### 참고로 알아둘 것

- **탐지는 트래픽 패턴 기반**이라, 규모가 커지고 눈에 띄기 전까지는 실제로 걸릴 확률이 낮습니다. 다만 "안 걸린다"가 "허용된다"는 뜻은 아닙니다.
- 정책이 1년에 세 번 바뀐 전례가 있으니, 아래 공식 문서를 주기적으로 확인하세요. 이 패키지는 provider를 바꾸기만 하면 되도록 설계했으니, 정책이 바뀌면 `AI_PROVIDER`를 `claude-api`로 전환하면 됩니다.

- [Claude Code: Legal and compliance](https://code.claude.com/docs/en/legal-and-compliance)
- [Claude Help Center: Use the Claude Agent SDK with your Claude plan](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan)
