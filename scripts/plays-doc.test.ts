import { describe, expect, it } from 'vitest';
import { buildPlaysDoc } from './plays-doc';

// PhpStorm 的 SVG 檢視器用嚴格的 SVG 1.1 / XML 解析：重複屬性或 rgba() 顏色都會讓圖無法載入。
describe('戰術說明的分鏡圖', () => {
  const { svgs } = buildPlaysDoc();

  it('每張圖都是合法的 XML（沒有重複屬性）', () => {
    for (const [id, svg] of Object.entries(svgs)) {
      for (const tag of svg.match(/<[a-z]+\s[^>]*>/g) ?? []) {
        const names = [...tag.matchAll(/\s([a-z-]+)="/g)].map((m) => m[1]);
        expect(new Set(names).size, `${id}: ${tag.slice(0, 80)}`).toBe(names.length);
      }
    }
  });

  it('不使用 rgba() 等 SVG 1.1 不支援的顏色寫法', () => {
    for (const [id, svg] of Object.entries(svgs)) expect(svg, id).not.toMatch(/rgba?\(|hsla?\(/);
  });
});
