import { describe, expect, it } from 'vitest';
import { buildTimeline } from '../anim/timeline';
import { createDefaultTactic } from '../model/defaults';
import { insertFrameAfter } from '../model/frames';
import { putPath } from '../model/paths';
import type { Tactic } from '../model/types';
import { SWITCH_DELAY } from './config';
import { defendPosition, guardPosition } from './defense';
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
      expect(dist(redAt(res, tt).positions.r2!, defendPosition(f.start.b2!, f.start.b1!, false))).toBeLessThan(1e-9);
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

describe('阻絕', () => {
  const ball = { x: 0, y: 8.6 };

  it('平常（包含開局）：防外圍無球的人時站在他和籃框之間，稍微偏向持球者，守住內切', () => {
    const wing = { x: 5.4, y: 6.0 };
    const help = defendPosition(wing, ball, false);
    const rim = { x: 0, y: 1.575 };
    expect(dist(help, rim)).toBeLessThan(dist(wing, rim) - 1.5); // 明顯在內側
    expect(dist(help, ball)).toBeLessThan(dist(guardPosition(wing, false), ball)); // 偏向持球者
  });

  it('對位者往外跑想接球時才阻絕：站到傳球路線上', () => {
    const wing = { x: 5.4, y: 6.0 };
    const deny = defendPosition(wing, ball, false, true);
    const help = defendPosition(wing, ball, false, false);
    expect(dist(deny, ball)).toBeLessThan(dist(help, ball));
    expect(dist(deny, wing)).toBeLessThan(dist(help, wing));
  });

  it('阻絕有記憶：往外跑開始阻絕，停下來繼續阻絕，往內切才回到協防', async () => {
    const { nextDenyState } = await import('./defense');
    expect(nextDenyState(false, 0)).toBe(false); // 開局不動：協防
    expect(nextDenyState(false, 3)).toBe(true); // 往外跑：阻絕
    expect(nextDenyState(true, 0)).toBe(true); // 停在外圍等球：繼續阻絕
    expect(nextDenyState(true, -3)).toBe(false); // 往籃框切：回到協防
  });

  it('對位者在籃下附近、或球在空中時，不阻絕', () => {
    const post = { x: 2.4, y: 3.0 };
    expect(defendPosition(post, ball, false)).toEqual(guardPosition(post, false));
    expect(defendPosition({ x: 5.4, y: 6 }, null, false)).toEqual(guardPosition({ x: 5.4, y: 6 }, false));
  });

  it('防持球者時照舊站在人和籃框之間', () => {
    expect(defendPosition(ball, ball, true)).toEqual(guardPosition(ball, true));
  });
});

describe('被甩開只能從後面追', () => {
  it('對位者切到防守者前面（更靠近籃框）時，目標改成對位者身後', async () => {
    const { chaseTarget } = await import('./defense');
    const { BODY_DISTANCE } = await import('./config');
    const man = { x: 1.0, y: 2.6 };
    const defender = { x: 3.0, y: 5.0 };
    const target = chaseTarget(defender, man, { x: 0, y: 8.6 }, false);
    expect(dist(target, man)).toBeCloseTo(BODY_DISTANCE);
    // 在對位者和防守者之間，不會跑到對位者和籃框之間
    expect(dist(target, defender)).toBeLessThan(dist(man, defender));
  });

  it('還沒被甩開時，照常站防守位置', async () => {
    const { chaseTarget } = await import('./defense');
    const man = { x: 5.4, y: 6.0 };
    const ball = { x: 0, y: 8.6 };
    const defender = defendPosition(man, ball, false);
    expect(chaseTarget(defender, man, ball, false)).toEqual(defendPosition(man, ball, false));
  });

  it('背切：有阻絕時，防守者在出手那一刻被甩在身後', () => {
    const t = createDefaultTactic();
    const roles = { A: 'b1', B: 'b2', C: 'b3' } as const;
    return import('../plays/library').then(async ({ PLAYS }) => {
      const { loadPlay } = await import('../plays/instantiate');
      const play = PLAYS.find((p) => p.id === 'cut-backdoor')!;
      const tactic = loadPlay(t, play, roles);
      const tl = buildTimeline(tactic);
      const res = simulateDefense(tactic, tl);
      const { poseAt } = await import('../anim/timeline');
      const at = tl.shotReleaseAt!;
      const shooter = poseAt(tactic, tl, at).positions.b2!;
      const defender = redAt(res, at).positions.r2!;
      const rim = { x: 0, y: 1.575 };
      expect(dist(defender, rim)).toBeGreaterThan(dist(shooter, rim));
    });
  });
});

describe('連續換防', () => {
  it('第二次換防時，前一次換防還在延遲中也要算進去（review 的連續掩護例子）', async () => {
    const { planSwitch, applySwaps } = await import('./defenseSim');
    const assign = { r1: 'b1', r2: 'b2', r3: 'b3' };
    // t：b2 掩護擋到 r1 → r1、r2 換防（還在 0.3 秒延遲中）
    const first = planSwitch(assign, [], 'r1', 'b2');
    expect(first.partnerId).toBe('r2');
    expect(first.after).toEqual({ r1: 'b2', r2: 'b1', r3: 'b3' });
    const pending = [{ at: 0.3, a: 'r1', b: first.partnerId! }];
    // t + 0.1：b1 幫 b3 掩護，擋到 r3 → 交換對象是「換防後盯 b1 的人」r2，不是還沒換完的 r1
    const second = planSwitch(assign, pending, 'r3', 'b1');
    expect(second.partnerId).toBe('r2');
    expect(second.after).toEqual({ r1: 'b2', r2: 'b3', r3: 'b1' });
    // 兩次都生效後的實際對位，和第二次記下的一致
    expect(applySwaps(assign, [...pending, { at: 0.4, a: 'r3', b: 'r2' }])).toEqual(second.after);
  });

  it('換防要依時間順序套用（倒著套結果會不同）', async () => {
    const { applySwaps } = await import('./defenseSim');
    const assign = { r1: 'b1', r2: 'b2', r3: 'b3' };
    const swaps = [
      { at: 1, a: 'r1', b: 'r2' },
      { at: 1, a: 'r2', b: 'r3' },
    ];
    expect(applySwaps(assign, swaps)).toEqual({ r1: 'b2', r2: 'b3', r3: 'b1' });
    expect(applySwaps(assign, [...swaps].reverse())).not.toEqual(applySwaps(assign, swaps));
  });
});

describe('往球的方向靠', () => {
  it('jumpPosition：往接球者方向 2 m，距離太近時最多到兩人中間', async () => {
    const { jumpPosition } = await import('./defense');
    expect(jumpPosition({ x: 0, y: 8 }, { x: 5, y: 8 })).toEqual({ x: 2, y: 8 });
    expect(jumpPosition({ x: 0, y: 8 }, { x: 2, y: 8 })).toEqual({ x: 1, y: 8 });
  });

  it('傳切：傳球後防守者往球靠，傳球者往籃下切時把防守者甩在身後', async () => {
    const { PLAYS } = await import('../plays/library');
    const { loadPlay } = await import('../plays/instantiate');
    const { poseAt } = await import('../anim/timeline');
    const t = loadPlay(createDefaultTactic(), PLAYS.find((p) => p.id === 'cut-give-go')!, { A: 'b1', B: 'b2', C: 'b3' });
    const tl = buildTimeline(t);
    const res = simulateDefense(t, tl);
    const at = tl.shotReleaseAt!;
    const rim = { x: 0, y: 1.575 };
    const shooter = poseAt(t, tl, at).positions.b1!;
    const defender = redAt(res, at).positions.r1!;
    expect(dist(defender, rim)).toBeGreaterThan(dist(shooter, rim));
  });
});
