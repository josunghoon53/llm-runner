# 정해진 모양으로 받기: `runStructured()`

[← README로 돌아가기](../README.md)

provider별 강제 방식과 스키마 작성 시 주의점입니다.

텍스트를 받아서 직접 파싱하는 대신, JSON Schema를 주고 그 모양으로 받습니다:

```ts
const { data } = await runner.runStructured<{ sentiment: string; score: number }>({
  prompt: '이 리뷰의 감정을 분석해줘: "배송이 빨라서 좋았어요"',
  schema: {
    type: 'object',
    properties: { sentiment: { type: 'string' }, score: { type: 'number' } },
    required: ['sentiment', 'score'],
    additionalProperties: false,
  },
  // 웹에서 찾아온 내용을 스키마에 담고 싶으면 켜세요 (구독 provider 전용).
  // enableWebSearch: true,
});

console.log(data.score); // 0.9 — 파싱까지 끝난 값
```

**강제 수준이 provider마다 다릅니다.** 이건 우리가 고를 수 있는 게 아니라 각 provider가 제공하는 장치의 차이입니다:

| provider | 방식 |
|---|---|
| `openai-api` | `response_format: json_schema` (strict) |
| `claude-api` | 스키마를 입력으로 받는 도구를 강제 호출 |
| `openai-subscription` | Codex `outputSchema` |
| `claude-subscription` | Agent SDK `outputFormat: json_schema` |

**네 provider 모두 provider 쪽에서 스키마를 강제합니다** — 프롬프트로 부탁하고 결과를 파싱하는 경로는 없습니다.

> 이전 판에는 `claude-subscription`이 "모델의 선의에 의존한다"고 적혀 있었습니다. **틀린 설명이었습니다** — Agent SDK에 `outputFormat` 옵션이 있는데 제가 못 찾고 프롬프트 방식으로 구현했던 것입니다. 0.5.0에서 네이티브 방식으로 바꿨습니다.

**스키마는 손대지 않고 provider에 그대로 전달됩니다.** 그래서 어떤 JSON Schema 키워드가 통하는지는 provider가 정합니다. 안전하게 쓰려면 `type` / `properties` / `items` / `required` / `enum` / `description` 정도로 제한하세요 — 이 범위는 네 provider 모두에서 확인했습니다.

> ⚠️ `openai-api`는 strict 모드로 보내기 때문에 제약이 가장 빡빡합니다: 모든 객체에 `additionalProperties: false`가 있어야 하고, `properties`의 **모든** 키가 `required`에 들어가야 합니다(선택 항목은 `required`에서 빼는 대신 `type: ['string', 'null']`로 표현). 이 조건을 어기면 호출이 에러로 거부됩니다. 다른 provider는 이만큼 까다롭지 않으므로, 한 스키마를 여러 provider에 돌려 쓸 생각이면 가장 빡빡한 이 규칙에 맞춰 두는 게 안전합니다.
