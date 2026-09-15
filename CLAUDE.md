# llm-runner

이 프로젝트에서 `llm-runner`를 통합/사용할 때는 [`AGENTS.md`](./AGENTS.md)를 먼저 읽는다. 특히:

- 프론트엔드에서 직접 import 금지 (Node.js 전용, 반드시 백엔드를 거칠 것)
- provider 선택 기준 ("고객 행동이 LLM 호출을 직접 발생시키는가?")
- 서버리스 배포 시 API 키 provider 필수

자세한 내용과 구현 체크리스트는 `AGENTS.md`에 있다.
