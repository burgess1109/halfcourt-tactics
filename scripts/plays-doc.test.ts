import { describe, expect, it } from 'vitest';
import playsMarkdown from '../docs/PLAYS.md?raw';
import { buildPlaysDoc } from './plays-doc';

/** repo 裡的分鏡圖（docs/plays/*.svg） */
const committedSvgs = import.meta.glob<string>('../docs/plays/*.svg', { query: '?raw', import: 'default', eager: true });

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

  // 分鏡圖用遊戲本身的防守模擬畫紅隊：改了戰術資料、防守模擬或評分，都可能讓圖變了
  it('docs/PLAYS.md 與 docs/plays/*.svg 和程式產生的一致（不一致時執行 npm run plays-doc）', () => {
    const { markdown } = buildPlaysDoc();
    expect(markdown, 'docs/PLAYS.md').toBe(playsMarkdown);
    const committed = Object.fromEntries(
      Object.entries(committedSvgs).map(([path, svg]) => [path.replace('../docs/plays/', '').replace('.svg', ''), svg]),
    );
    expect(Object.keys(committed).sort()).toEqual(Object.keys(svgs).sort());
    for (const [id, svg] of Object.entries(svgs)) expect(svg, `docs/plays/${id}.svg`).toBe(committed[id]);
  });
});
