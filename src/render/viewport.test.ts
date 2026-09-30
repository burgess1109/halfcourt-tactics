import { describe, expect, it } from 'vitest';
import { VIEW_BOUNDS } from '../court/fiba';
import { fitViewport, toScreen, toWorld } from './viewport';

describe('viewport', () => {
  it('直式：可視範圍寬度剛好塞滿，並垂直置中', () => {
    const vp = fitViewport(390, 700);
    const left = toScreen(vp, { x: VIEW_BOUNDS.minX, y: 0 });
    const right = toScreen(vp, { x: VIEW_BOUNDS.maxX, y: 0 });
    expect(left.x).toBeCloseTo(0);
    expect(right.x).toBeCloseTo(390);
    const top = toScreen(vp, { x: 0, y: VIEW_BOUNDS.maxY });
    const bottom = toScreen(vp, { x: 0, y: VIEW_BOUNDS.minY });
    expect(top.y).toBeCloseTo(700 - bottom.y);
  });

  it('籃框在下：y 越大，螢幕上越高', () => {
    const vp = fitViewport(800, 600);
    expect(toScreen(vp, { x: 0, y: 1.575 }).y).toBeGreaterThan(toScreen(vp, { x: 0, y: 14 }).y);
  });

  it('toWorld 是 toScreen 的反函數', () => {
    const vp = fitViewport(1024, 768);
    const p = { x: -3.2, y: 6.75 };
    const s = toScreen(vp, p);
    const back = toWorld(vp, s.x, s.y);
    expect(back.x).toBeCloseTo(p.x);
    expect(back.y).toBeCloseTo(p.y);
  });
});
