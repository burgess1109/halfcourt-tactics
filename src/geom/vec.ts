import type { Vec2 } from '../model/types';

export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (a: Vec2, k: number): Vec2 => ({ x: a.x * k, y: a.y * k });
export const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);
export const lerp = (a: Vec2, b: Vec2, t: number): Vec2 => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
});

export function normalize(a: Vec2): Vec2 {
  const len = Math.hypot(a.x, a.y);
  return len === 0 ? { x: 0, y: 0 } : { x: a.x / len, y: a.y / len };
}

/** 逆時針轉 90° */
export const perp = (a: Vec2): Vec2 => ({ x: -a.y, y: a.x });

/** 點到線段的距離 */
export function distToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const ab = sub(b, a);
  const len2 = ab.x * ab.x + ab.y * ab.y;
  if (len2 === 0) return dist(p, a);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * ab.x + (p.y - a.y) * ab.y) / len2));
  return dist(p, { x: a.x + ab.x * t, y: a.y + ab.y * t });
}
