import { describe, expect, it } from 'vitest';
import { sameData, stableStringify } from './equal';

describe('與欄位順序無關的比對', () => {
  it('巢狀物件的欄位順序不影響結果，陣列順序有影響', () => {
    expect(sameData({ a: 1, b: { x: 1, y: 2 } }, { b: { y: 2, x: 1 }, a: 1 })).toBe(true);
    expect(sameData([1, 2], [2, 1])).toBe(false);
    expect(sameData({ a: 1 }, { a: 2 })).toBe(false);
  });

  it('值為 undefined 的欄位視為不存在（和 JSON 相同）', () => {
    expect(sameData({ a: 1, t: undefined }, { a: 1 })).toBe(true);
    expect(stableStringify({ b: 1, a: [{ d: 1, c: 2 }] })).toBe('{"a":[{"c":2,"d":1}],"b":1}');
  });
});
