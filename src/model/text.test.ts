import { describe, expect, it } from 'vitest';
import { truncateText } from './text';

describe('截斷文字', () => {
  it('沒有超過上限時原樣回傳', () => {
    expect(truncateText('short', 30)).toBe('short');
  });

  it('截在英文單字中間：退到最後一個空格，去掉結尾的冒號', () => {
    expect(truncateText('High pick and roll: Pull-up Jumper (Mid-range)', 30)).toBe('High pick and roll: Pull-up');
    expect(truncateText('High pick and roll: Pull-up Jumper (Mid-range)', 21)).toBe('High pick and roll');
  });

  it('截點剛好在單字結尾（後面是空格或標點）：不會多丟一個單字', () => {
    expect(truncateText('abcdefghij abcdefghij abcdefghi xyz', 31)).toBe('abcdefghij abcdefghij abcdefghi');
    expect(truncateText('High pick and roll: xxxxxxxxxxxx', 18)).toBe('High pick and roll');
    expect(truncateText('Pick and Roll, again and again', 13)).toBe('Pick and Roll');
  });

  it('中文照字元截斷：就算有空格也不往前退', () => {
    const zh = '一二三四五六七八九十'.repeat(2) + ' ' + '一二三四五六七八九十一二';
    expect(truncateText(zh, 30)).toBe(zh.slice(0, 30));
    const leading = 'A ' + '一二三四五六七八九十'.repeat(3) + '一';
    expect(truncateText(leading, 30)).toBe(leading.slice(0, 30));
  });

  it('空格在一半長度以前：照字元截斷，不會只剩開頭幾個字', () => {
    expect(truncateText('Ab ' + 'x'.repeat(40), 30)).toBe('Ab ' + 'x'.repeat(27));
    expect(truncateText('x'.repeat(40), 30)).toBe('x'.repeat(30));
  });

  it('不切開 emoji：落在 emoji 中間時整個不要', () => {
    expect(truncateText('a'.repeat(29) + '🏀' + 'b', 30)).toBe('a'.repeat(29));
  });

  it('結果一定不超過上限', () => {
    for (const text of ['High pick and roll: Pull-up Jumper (Mid-range)', 'a'.repeat(29) + '🏀b', '中 文'.repeat(20)]) {
      for (const max of [5, 18, 30]) expect(truncateText(text, max).length).toBeLessThanOrEqual(max);
    }
  });
});
