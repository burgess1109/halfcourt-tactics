import type { Vec2 } from '../model/types';
import { dist, distToSegment, lerp } from './vec';

export function polylineLength(pts: readonly Vec2[]): number {
  let len = 0;
  for (let i = 1; i < pts.length; i++) len += dist(pts[i - 1]!, pts[i]!);
  return len;
}

export function distToPolyline(p: Vec2, pts: readonly Vec2[]): number {
  if (pts.length === 1) return dist(p, pts[0]!);
  let best = Infinity;
  for (let i = 1; i < pts.length; i++) best = Math.min(best, distToSegment(p, pts[i - 1]!, pts[i]!));
  return best;
}

/** 從折線頭尾各剪掉指定長度（例如從球員圓標邊緣開始畫）。太短時回傳空陣列。 */
export function trimPolyline(pts: readonly Vec2[], fromStart: number, fromEnd: number): Vec2[] {
  const total = polylineLength(pts);
  const a = Math.max(0, fromStart);
  const b = total - Math.max(0, fromEnd);
  if (b - a <= 1e-6) return [];
  const out: Vec2[] = [];
  let walked = 0;
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i - 1]!;
    const q = pts[i]!;
    const seg = dist(p, q);
    const segStart = walked;
    const segEnd = walked + seg;
    if (segEnd >= a && segStart <= b && seg > 0) {
      const t0 = Math.max(0, (a - segStart) / seg);
      const t1 = Math.min(1, (b - segStart) / seg);
      if (out.length === 0) out.push(lerp(p, q, t0));
      out.push(lerp(p, q, t1));
    }
    walked = segEnd;
  }
  return out;
}
