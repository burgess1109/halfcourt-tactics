import { describe, expect, it } from 'vitest';
import { distToPolyline, polylineLength, trimPolyline } from './polyline';
import { simplify } from './simplify';
import { sampleSpline, segmentMidpoint } from './spline';
import { dist } from './vec';

describe('sampleSpline', () => {
  it('兩點時就是直線', () => {
    const pts = sampleSpline([{ x: 0, y: 0 }, { x: 4, y: 0 }]);
    expect(pts[0]).toEqual({ x: 0, y: 0 });
    expect(pts.at(-1)!.x).toBeCloseTo(4);
    for (const p of pts) expect(p.y).toBeCloseTo(0);
  });

  it('曲線通過每個控制點', () => {
    const ctrl = [{ x: 0, y: 0 }, { x: 2, y: 3 }, { x: 5, y: 1 }, { x: 6, y: 6 }];
    const pts = sampleSpline(ctrl);
    for (const c of ctrl) expect(Math.min(...pts.map((p) => dist(p, c)))).toBeLessThan(1e-9);
  });

  it('重複的控制點不會產生 NaN', () => {
    const pts = sampleSpline([{ x: 1, y: 1 }, { x: 1, y: 1 }, { x: 3, y: 2 }]);
    for (const p of pts) expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
  });

  it('segmentMidpoint 落在兩個控制點之間', () => {
    const m = segmentMidpoint([{ x: 0, y: 0 }, { x: 4, y: 0 }], 0);
    expect(m.x).toBeCloseTo(2);
    expect(m.y).toBeCloseTo(0);
  });
});

describe('simplify (RDP)', () => {
  it('幾乎是直線的手繪軌跡只剩頭尾', () => {
    const raw = Array.from({ length: 50 }, (_, i) => ({ x: i * 0.1, y: (i % 2) * 0.03 }));
    const s = simplify(raw, 0.1);
    expect(s).toHaveLength(2);
    expect(s[0]).toEqual(raw[0]);
    expect(s[1]).toEqual(raw.at(-1));
  });

  it('保留轉角', () => {
    const raw = [
      ...Array.from({ length: 20 }, (_, i) => ({ x: i * 0.2, y: 0 })),
      ...Array.from({ length: 20 }, (_, i) => ({ x: 3.8, y: (i + 1) * 0.2 })),
    ];
    const s = simplify(raw, 0.1);
    expect(s).toHaveLength(3);
    expect(s[1]!.x).toBeCloseTo(3.8);
    expect(s[1]!.y).toBeCloseTo(0);
  });
});

describe('polyline', () => {
  const L = [{ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 3, y: 4 }];

  it('長度與距離', () => {
    expect(polylineLength(L)).toBeCloseTo(7);
    expect(distToPolyline({ x: 1.5, y: 1 }, L)).toBeCloseTo(1);
  });

  it('頭尾裁切', () => {
    const t = trimPolyline(L, 1, 2);
    expect(t[0]).toEqual({ x: 1, y: 0 });
    expect(t.at(-1)!.y).toBeCloseTo(2);
    expect(polylineLength(t)).toBeCloseTo(4);
  });

  it('裁切超過全長時回傳空陣列', () => {
    expect(trimPolyline(L, 4, 4)).toEqual([]);
  });
});
