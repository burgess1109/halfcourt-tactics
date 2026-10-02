import { describe, expect, it } from 'vitest';
import { BASKET_Y, THREE_POINT_CORNER_X, THREE_POINT_CORNER_Y, THREE_POINT_RADIUS, isBeyondArc } from './fiba';

describe('isBeyondArc', () => {
  it('底角直線段：離籃框不到 6.75 m 也可能在線外', () => {
    const corner = { x: 6.7, y: 1.0 };
    expect(Math.hypot(corner.x, corner.y - BASKET_Y)).toBeLessThan(THREE_POINT_RADIUS);
    expect(isBeyondArc(corner)).toBe(true);
    expect(isBeyondArc({ x: -6.7, y: 1.0 })).toBe(true);
    expect(isBeyondArc({ x: 6.5, y: 1.0 })).toBe(false);
  });

  it('圓弧段：以離籃框的距離判斷', () => {
    expect(isBeyondArc({ x: 0, y: BASKET_Y + THREE_POINT_RADIUS + 0.05 })).toBe(true);
    expect(isBeyondArc({ x: 0, y: BASKET_Y + THREE_POINT_RADIUS - 0.05 })).toBe(false);
    expect(isBeyondArc({ x: 4.9, y: 6.6 })).toBe(true); // 右翼
  });

  it('直線和圓弧在交接點連續', () => {
    const y = THREE_POINT_CORNER_Y;
    expect(isBeyondArc({ x: THREE_POINT_CORNER_X + 0.01, y: y - 0.01 })).toBe(true);
    expect(isBeyondArc({ x: THREE_POINT_CORNER_X + 0.01, y: y + 0.01 })).toBe(true);
    expect(isBeyondArc({ x: THREE_POINT_CORNER_X - 0.01, y: y - 0.01 })).toBe(false);
    expect(isBeyondArc({ x: THREE_POINT_CORNER_X - 0.01, y: y + 0.01 })).toBe(false);
  });
});
