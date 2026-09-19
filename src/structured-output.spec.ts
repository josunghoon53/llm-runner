import { buildSchemaInstruction, parseJsonFromModelOutput } from './structured-output.js';

describe('parseJsonFromModelOutput', () => {
  it('깨끗한 JSON은 그대로 파싱한다', () => {
    expect(parseJsonFromModelOutput('{"a":1}')).toEqual({ a: 1 });
  });

  it('앞뒤 공백/줄바꿈이 있어도 파싱한다', () => {
    expect(parseJsonFromModelOutput('\n  {"a":1}  \n')).toEqual({ a: 1 });
  });

  it('```json 코드펜스로 감싸도 벗겨내고 파싱한다', () => {
    expect(parseJsonFromModelOutput('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it('언어 표시 없는 코드펜스도 처리한다', () => {
    expect(parseJsonFromModelOutput('```\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it('앞뒤에 설명을 붙여도 JSON 구간만 잘라서 파싱한다', () => {
    expect(parseJsonFromModelOutput('분석 결과입니다:\n{"a":1}\n도움이 되었길 바랍니다.')).toEqual({ a: 1 });
  });

  it('최상위가 배열이어도 파싱한다', () => {
    expect(parseJsonFromModelOutput('결과: [1,2,3]')).toEqual([1, 2, 3]);
  });

  it('중첩된 객체에서도 가장 바깥 구간을 잡는다', () => {
    expect(parseJsonFromModelOutput('앞말 {"a":{"b":[1,2]}} 뒷말')).toEqual({ a: { b: [1, 2] } });
  });

  it('JSON이 전혀 없으면 다음에 뭘 할지 알려주는 에러를 던진다', () => {
    expect(() => parseJsonFromModelOutput('죄송하지만 답변할 수 없습니다.')).toThrow(
      /JSON으로 파싱하지 못했다/,
    );
  });

  it('에러 메시지에 실제 응답 앞부분을 포함해서 원인을 알 수 있게 한다', () => {
    expect(() => parseJsonFromModelOutput('이건 JSON이 아님')).toThrow(/이건 JSON이 아님/);
  });
});

describe('buildSchemaInstruction', () => {
  it('스키마 전문과 함께 코드펜스 없이 JSON만 내라고 지시한다', () => {
    const instruction = buildSchemaInstruction({ type: 'object', properties: { a: { type: 'number' } } });

    expect(instruction).toContain('"type": "object"');
    expect(instruction).toContain('코드펜스');
    expect(instruction).toContain('JSON 본문만');
  });
});
