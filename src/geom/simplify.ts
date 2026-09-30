import type { Vec2 } from '../model/types';
import { distToSegment } from './vec';

/** Ramer–Douglas–Peucker：保留頭尾，刪掉離直線不到 tolerance 的點 */
export function simplify(points: readonly Vec2[], tolerance: number): Vec2[] {
  if (points.length <= 2) return points.map((p) => ({ ...p }));
  const keep = new Array<boolean>(points.length).fill(false);
  keep[0] = true;
  keep[points.length - 1] = true;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [start, end] = stack.pop()!;
    let maxDist = 0;
    let index = -1;
    for (let i = start + 1; i < end; i++) {
      const d = distToSegment(points[i]!, points[start]!, points[end]!);
      if (d > maxDist) {
        maxDist = d;
        index = i;
      }
    }
    if (index !== -1 && maxDist > tolerance) {
      keep[index] = true;
      stack.push([start, index], [index, end]);
    }
  }
  return points.filter((_, i) => keep[i]).map((p) => ({ ...p }));
}
