import { inspect } from 'node:util';

/**
 * 원본 에러(err)를 friendlyMessage로 감싼 Error를 만든다.
 * err.cause로는 원본에 그대로 접근할 수 있지만, console.log/console.error 기본 출력(util.inspect)에는
 * 노출하지 않는다 — Node는 cause가 있으면 enumerable 여부와 무관하게 `[cause]: ...`를 자동으로 붙여서
 * 찍기 때문에, non-enumerable로 만드는 것만으로는 영어 원본 에러/스택트레이스 노출을 막을 수 없다.
 */
/**
 * API 키에 한글 등 비-ASCII 문자가 섞여 있으면, 실제 요청을 보내기도 전에
 * fetch/undici가 "Cannot convert argument to a ByteString..." 같은 저수준 TypeError를 던진다.
 * (HTTP 헤더 값은 ISO-8859-1 범위 문자만 허용되기 때문) 이 에러는 401이 아니라서 기존 인증 에러
 * 판별로는 못 잡는다 — 별도로 감지해서 마찬가지로 친절한 메시지로 감싼다.
 */
export function isInvalidHeaderValueError(err: unknown): boolean {
  return err instanceof TypeError && /ByteString|invalid header|not.*valid.*header/i.test(err.message);
}

export function wrapWithFriendlyMessage(friendlyMessage: string, cause: unknown): Error {
  const wrapped = new Error(friendlyMessage, { cause });

  Object.defineProperty(wrapped, inspect.custom, {
    value: () =>
      `${wrapped.stack}\n  (원인 상세는 err.cause로 접근 가능. 기본 출력에서는 생략됨 — 디버깅 시 console.error(err.cause)를 따로 호출해라.)`,
    enumerable: false,
    configurable: true,
  });

  return wrapped;
}
