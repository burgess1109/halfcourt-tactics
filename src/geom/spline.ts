import type { Vec2 } from '../model/types';
import { dist, lerp, sub, add } from './vec';

// 向心 Catmull-Rom（alpha = 0.5）：曲線一定通過每個控制點，而且不會在控制點附近打結。

const ALPHA = 0.5;

function knot(a: Vec2, b: Vec2): number {
  return Math.max(dist(a, b) ** ALPHA, 1e-4);
}

/** 單一段 p1→p2 上，參數 t ∈ [0,1] 的點（Barry–Goldman 金字塔公式） */
export function segmentPoint(p0: Vec2, p1: Vec2, p2: Vec2, p3: Vec2, t: number): Vec2 {
  const t0 = 0;
  const t1 = t0 + knot(p0, p1);
  const t2 = t1 + knot(p1, p2);
  const t3 = t2 + knot(p2, p3);
  const u = t1 + (t2 - t1) * t;
  const a1 = lerp(p0, p1, (u - t0) / (t1 - t0));
  const a2 = lerp(p1, p2, (u - t1) / (t2 - t1));
  const a3 = lerp(p2, p3, (u - t2) / (t3 - t2));
  const b1 = lerp(a1, a2, (u - t0) / (t2 - t0));
  const b2 = lerp(a2, a3, (u - t1) / (t3 - t1));
  return lerp(b1, b2, (u - t1) / (t2 - t1));
}

/** 取第 i 段（points[i] → points[i+1]）的四個控制點，兩端用外插補上虛擬點 */
function segmentControls(points: readonly Vec2[], i: number): [Vec2, Vec2, Vec2, Vec2] {
  const p1 = points[i]!;
  const p2 = points[i + 1]!;
  const p0 = points[i - 1] ?? add(p1, sub(p1, p2));
  const p3 = points[i + 2] ?? add(p2, sub(p2, p1));
  return [p0, p1, p2, p3];
}

/** 第 i 段中間的點（用來放「新增控制點」的把手） */
export function segmentMidpoint(points: readonly Vec2[], i: number): Vec2 {
  const [p0, p1, p2, p3] = segmentControls(points, i);
  return segmentPoint(p0, p1, p2, p3, 0.5);
}

/** 把控制點平滑成折線；每公尺約 8 個取樣點 */
export function sampleSpline(points: readonly Vec2[], samplesPerMeter = 8): Vec2[] {
  if (points.length < 2) return points.map((p) => ({ ...p }));
  const out: Vec2[] = [{ ...points[0]! }];
  for (let i = 0; i < points.length - 1; i++) {
    const [p0, p1, p2, p3] = segmentControls(points, i);
    const steps = Math.max(2, Math.ceil(dist(p1, p2) * samplesPerMeter));
    for (let s = 1; s <= steps; s++) out.push(segmentPoint(p0, p1, p2, p3, s / steps));
  }
  return out;
}
