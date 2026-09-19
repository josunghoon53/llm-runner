/**
 * JSON Schema 객체. 외부 검증 라이브러리를 의존성으로 들이지 않기 위해 구조를 강제하지 않는다 —
 * provider에 그대로 전달되고, 실제 강제는 provider 쪽에서 이뤄진다(가능한 경우).
 */
export type JsonSchema = Record<string, unknown>;

export interface AiStructuredOptions {
  prompt: string;
  system?: string;
  model?: string;
  maxTokens?: number;
  /** 원하는 출력 모양. 최상위는 `{ type: 'object', properties: {...} }` 형태를 권장한다. */
  schema: JsonSchema;
  /** 일부 provider가 스키마 이름을 요구한다. 기본값 `result`. */
  schemaName?: string;
}

export interface AiStructuredResult<T = unknown> {
  /** 파싱된 결과. */
  data: T;
  /** 모델이 실제로 돌려준 원문(JSON 문자열). 디버깅용. */
  text: string;
  usage?: import('./interfaces/ai-runner.interface.js').AiUsage;
  raw?: unknown;
}

/**
 * 스키마를 네이티브로 강제하지 못하는 provider(현재 `claude-subscription`)에서 쓸 지시문.
 * 모델이 설명문이나 코드펜스를 붙이는 걸 최대한 막는다.
 */
export function buildSchemaInstruction(schema: JsonSchema): string {
  return (
    '아래 JSON Schema를 정확히 만족하는 JSON **하나만** 출력해라.\n' +
    '설명, 머리말, 코드펜스(```) 없이 JSON 본문만 출력해야 한다.\n\n' +
    `JSON Schema:\n${JSON.stringify(schema, null, 2)}`
  );
}

/**
 * 모델 출력에서 JSON을 꺼낸다. 지시해도 코드펜스나 앞뒤 설명을 붙이는 경우가 있어서,
 * 그대로 파싱해보고 실패하면 가장 바깥 중괄호/대괄호 구간을 잘라서 한 번 더 시도한다.
 */
export function parseJsonFromModelOutput<T>(text: string): T {
  const direct = tryParse<T>(text.trim());
  if (direct.ok) return direct.value;

  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced?.[1]) {
    const parsed = tryParse<T>(fenced[1].trim());
    if (parsed.ok) return parsed.value;
  }

  const sliced = sliceOutermostJson(text);
  if (sliced) {
    const parsed = tryParse<T>(sliced);
    if (parsed.ok) return parsed.value;
  }

  throw new Error(
    '[llm-runner] 모델이 돌려준 응답을 JSON으로 파싱하지 못했다. ' +
      'schema를 더 단순하게 만들거나, 스키마를 네이티브로 강제하는 provider' +
      "(claude-api / openai-api / openai-subscription)를 쓰는 걸 고려해라.\n" +
      `받은 응답 앞부분: ${text.slice(0, 200)}`,
  );
}

function tryParse<T>(candidate: string): { ok: true; value: T } | { ok: false } {
  if (!candidate) return { ok: false };
  try {
    return { ok: true, value: JSON.parse(candidate) as T };
  } catch {
    return { ok: false };
  }
}

/** 텍스트에서 가장 바깥쪽 `{...}` 또는 `[...]` 구간을 잘라낸다. */
function sliceOutermostJson(text: string): string | undefined {
  const firstObject = text.indexOf('{');
  const firstArray = text.indexOf('[');
  const candidates = [firstObject, firstArray].filter((index) => index >= 0);
  if (candidates.length === 0) return undefined;

  const start = Math.min(...candidates);
  const closing = text[start] === '{' ? '}' : ']';
  const end = text.lastIndexOf(closing);
  if (end <= start) return undefined;

  return text.slice(start, end + 1);
}
