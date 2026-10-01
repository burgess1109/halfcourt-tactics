import { describe, expect, it } from 'vitest';
import { buildTimeline } from '../anim/timeline';
import { createDefaultTactic } from '../model/defaults';
import { insertFrameAfter } from '../model/frames';
import { putPath } from '../model/paths';
import type { Tactic } from '../model/types';
import { SWITCH_DELAY } from './config';
import { guardPosition } from './defense';
import { fightOverDelay, redAt, simulateDefense } from './defenseSim';

const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

/** 藍 2 從左翼跑到左底角 */
function cutTactic(): Tactic {
  const t = createDefaultTactic();
  const f = t.frames[0]!;
  putPath(f, { id: 'c', kind: 'cut', actorId: 'b2', points: [f.start.b2!, { x: -6.6, y: 1 }], freehand: false });
  return t;
}

/**
 * 高位擋拆：分鏡 1 藍 3 到紅 1 右側掩護；分鏡 2 藍 1 往右下運球，紅 1 要追就會撞到掩護。
 */
function pickTactic(scheme: Tactic['screenDefense'], kind: 'screen' | 'cut' = 'screen'): Tactic {
  const t = createDefaultTactic();
  t.screenDefense = scheme;
  const f0 = t.frames[0]!;
  putPath(f0, { id: 's', kind, actorId: 'b3', points: [f0.start.b3!, { x: 1.1, y: 7.1 }], freehand: false });
  insertFrameAfter(t, 0);
  const f1 = t.frames[1]!;
  putPath(f1, { id: 'd', kind: 'dribble', actorId: 'b1', points: [f1.start.b1!, { x: 4.6, y: 5.0 }], freehand: false });
  return t;
}

describe('防守 AI', () => {
  it('沒有人移動時，紅隊一直站在理想位置', () => {
    const t = createDefaultTactic();
    const tl = buildTimeline(t);
    const res = simulateDefense(t, tl);
    const f = t.frames[0]!;
    for (const tt of [0, tl.total / 2, tl.total]) {
      expect(dist(redAt(res, tt).positions.r2!, guardPosition(f.start.b2!, false))).toBeLessThan(1e-9);
    }
  });

  it('對位者跑走時會追，但有反應時間，會落後一段', () => {
    const t = cutTactic();
    const tl = buildTimeline(t);
    const res = simulateDefense(t, tl);
    const end = redAt(res, tl.total).positions.r2!;
    const ideal = guardPosition({ x: -6.6, y: 1 }, false);
    const start = guardPosition(t.frames[0]!.start.b2!, false);
    expect(dist(end, ideal)).toBeGreaterThan(0.3);
    expect(dist(end, ideal)).toBeLessThan(dist(start, ideal));
  });

  it('比較高的防守者比較慢，落後比較多', () => {
    // 藍 2 從左翼橫向空切到右側，理想位置幾乎跟著等速移動
    const lagWith = (cm: number) => {
      const t = createDefaultTactic();
      const f = t.frames[0]!;
      putPath(f, { id: 'c', kind: 'cut', actorId: 'b2', points: [f.start.b2!, { x: 5.4, y: 3.5 }], freehand: false });
      t.players.find((p) => p.id === 'r2')!.heightCm = cm;
      const tl = buildTimeline(t);
      return dist(redAt(simulateDefense(t, tl), tl.total).positions.r2!, guardPosition({ x: 5.4, y: 3.5 }, false));
    };
    expect(lagWith(205)).toBeGreaterThan(lagWith(160));
  });

  it('擠過：撞到掩護會被卡住，比沒有掩護時落後更多', () => {
    const lag = (t: Tactic) => {
      const tl = buildTimeline(t);
      const res = simulateDefense(t, tl);
      const ideal = guardPosition({ x: 4.6, y: 5.0 }, true);
      return { res, d: dist(redAt(res, tl.total).positions.r1!, ideal) };
    };
    const screened = lag(pickTactic('fight-over'));
    const free = lag(pickTactic('fight-over', 'cut'));
    expect(screened.res.events).toHaveLength(1);
    expect(screened.res.events[0]).toMatchObject({ type: 'fight-over', defenderId: 'r1', screenerId: 'b3' });
    expect(free.res.events).toHaveLength(0);
    expect(screened.d).toBeGreaterThan(free.d + 0.3);
    expect(screened.res.stuck.some((s) => s.has('r1'))).toBe(true);
  });

  it('擠過的延遲：掩護者越高卡越久，有上下限', () => {
    expect(fightOverDelay(200, 180)).toBeGreaterThan(fightOverDelay(180, 200));
    expect(fightOverDelay(230, 150)).toBe(0.9);
    expect(fightOverDelay(150, 230)).toBe(0.25);
  });

  it('換防：撞到掩護後兩位防守者交換對位', () => {
    const t = pickTactic('switch');
    const tl = buildTimeline(t);
    const res = simulateDefense(t, tl);
    expect(res.events[0]).toMatchObject({ type: 'switch', defenderId: 'r1', screenerId: 'b3', partnerId: 'r3' });
    expect(res.events[0]!.delay).toBe(SWITCH_DELAY);
    expect(res.finalAssignments).toMatchObject({ r1: 'b3', r3: 'b1' });
  });

  it('完全決定性', () => {
    const run = () => {
      const t = pickTactic('switch');
      return JSON.stringify(simulateDefense(t, buildTimeline(t)).red);
    };
    expect(run()).toBe(run());
  });
});

describe('擋拆後下順', () => {
  it('掩護者下一個分鏡同時下順，掩護仍然有效（先站住再走）', () => {
    for (const scheme of ['switch', 'fight-over'] as const) {
      const t = pickTactic(scheme);
      const f1 = t.frames[1]!;
      putPath(f1, { id: 'roll', kind: 'cut', actorId: 'b3', points: [f1.start.b3!, { x: 0.4, y: 2.8 }], freehand: false });
      const res = simulateDefense(t, buildTimeline(t));
      expect(res.events.map((e) => e.type)).toEqual([scheme]);
    }
  });
});
