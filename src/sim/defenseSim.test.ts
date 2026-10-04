import { describe, expect, it } from 'vitest';
import { simulate } from '../anim/simulation';
import { buildTimeline, poseAt } from '../anim/timeline';
import { createDefaultTactic } from '../model/defaults';
import { insertFrameAfter, syncFrames } from '../model/frames';
import { putPath } from '../model/paths';
import type { Tactic } from '../model/types';
import { SWITCH_DELAY } from './config';
import { loadPlay } from '../plays/instantiate';
import { PLAYS } from '../plays/library';
import { defendPosition, driveHelpDepth, driveHelpPosition, guardPosition, pickHelpPosition } from './defense';
import { fightOverDelay, pickHelpOver, redAt, simulateDefense } from './defenseSim';
import { evaluate } from './evaluate';

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
    // 擋拆：被掩護的人卡住，另外盯掩護者的人沉退（預設）
    expect(screened.res.events.map((e) => e.type)).toEqual(['fight-over', 'drop']);
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
      expect(res.events.map((e) => e.type).filter((x) => x === 'switch' || x === 'fight-over')).toEqual([scheme]);
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

describe('擋拆擠過時的沉退 / 上提', () => {
  const RIM = { x: 0, y: 1.575 };
  /** 協防開始後 0.5 秒（隊友還被卡住）時，盯掩護者的紅 3 的位置與持球者的位置 */
  const helpSnapshot = (coverage: 'drop' | 'hedge') => {
    const t = pickTactic('fight-over');
    t.pickCoverage = coverage;
    const tl = buildTimeline(t);
    const res = simulateDefense(t, tl);
    const help = res.events.find((e) => e.type === coverage)!;
    expect(help).toMatchObject({ defenderId: 'r3', screenerId: 'b3', handlerId: 'b1' });
    return { res, tl, help, at: redAt(res, help.t + 0.5).positions.r3! };
  };

  it('換防時沒有沉退 / 上提；無球掩護也沒有', () => {
    const sw = simulateDefense(pickTactic('switch'), buildTimeline(pickTactic('switch')));
    expect(sw.events.some((e) => e.type === 'drop' || e.type === 'hedge')).toBe(false);
  });

  it('沉退：盯掩護者的人退到籃框附近（罰球線下方），不會上前貼持球者', () => {
    const { at } = helpSnapshot('drop');
    expect(dist(at, RIM)).toBeLessThan(3.6);
  });

  it('上提：盯掩護者的人踏出去，離持球者比沉退時近得多', () => {
    const drop = helpSnapshot('drop');
    const hedge = helpSnapshot('hedge');
    const handlerAt = (s: typeof drop) => {
      const tl = s.tl;
      return poseAt(pickTactic('fight-over'), tl, s.help.t + 0.5).positions.b1!;
    };
    expect(dist(hedge.at, handlerAt(hedge))).toBeLessThan(dist(drop.at, handlerAt(drop)) - 1);
  });

  it('協防至少 1 秒，最後一定回去盯掩護者', () => {
    for (const c of ['drop', 'hedge'] as const) {
      const { res, tl, help } = helpSnapshot(c);
      expect(help.delay).toBeGreaterThanOrEqual(1 - 1e-9);
      expect(help.delay).toBeLessThanOrEqual(2.5 + 1e-9);
      expect(help.t + help.delay).toBeLessThanOrEqual(tl.total + 1e-9);
      expect(res.finalAssignments.r3).toBe('b3');
    }
  });

  it('接球後馬上擋拆：反應時間之前的持球者還是傳球者（或球在空中），不算球傳出去', () => {
    const help = { start: 3, until: 5.5, handler: 'b1' };
    // 協防開始後下一格：seen = t - 0.2 在協防開始之前
    expect(pickHelpOver(help, 3.02, 2.82, 'b2', false)).toBe(false);
    expect(pickHelpOver(help, 3.02, 2.82, null, false)).toBe(false);
    // 協防開始之後才看到球離開持球者：結束
    expect(pickHelpOver(help, 3.6, 3.4, null, false)).toBe(true);
    expect(pickHelpOver(help, 3.6, 3.4, 'b3', false)).toBe(true);
    // 隊友追回來、或時間到：結束
    expect(pickHelpOver(help, 4.2, 4.0, 'b1', true)).toBe(true);
    expect(pickHelpOver(help, 5.5, 5.3, 'b1', false)).toBe(true);
    expect(pickHelpOver(help, 4.2, 4.0, 'b1', false)).toBe(false);
  });

  it('pickHelpPosition：沉退最深到離籃框 3 m，持球者靠近籃框時最多到離他 1.5 m', () => {
    expect(dist(pickHelpPosition('drop', { x: 0, y: 9 }), RIM)).toBeCloseTo(3);
    const near = { x: 0, y: 5 };
    expect(dist(pickHelpPosition('drop', near), near)).toBeCloseTo(1.5);
    expect(pickHelpPosition('hedge', { x: 3, y: 7 })).toEqual(guardPosition({ x: 3, y: 7 }, true));
  });
});

describe('內建戰術：沉退與上提的差別', () => {
  const grade = (name: string, coverage: 'drop' | 'hedge') => {
    const base = createDefaultTactic();
    base.screenDefense = 'fight-over';
    base.pickCoverage = coverage;
    const t = loadPlay(base, PLAYS.find((p) => p.category === '高位擋拆' && p.name === name)!, { A: 'b1', B: 'b2', C: 'b3' });
    return evaluate(t, simulate(t)).expectedPoints!;
  };

  it('擋拆下順：對方上提時順下比較空', () => {
    expect(grade('Pick and Roll', 'hedge')).toBeGreaterThan(grade('Pick and Roll', 'drop') + 0.1);
  });

  it('拋投：對方沉退保護籃下時比較難', () => {
    expect(grade('Floater', 'drop')).toBeLessThan(grade('Floater', 'hedge') - 0.1);
  });

  it('擋拆外拉：對方沉退時外拉比較空', () => {
    expect(grade('Pick and Pop', 'drop')).toBeGreaterThan(grade('Pick and Pop', 'hedge'));
  });
});

describe('防守距離：一般 / 緊貼', () => {
  it('緊貼：防持球者、防籃下附近的無球者時距離比較小', () => {
    const handler = { x: 0, y: 8.6 };
    expect(dist(guardPosition(handler, true, 'tight'), handler)).toBeLessThan(dist(guardPosition(handler, true), handler));
    const post = { x: 3.0, y: 4.5 }; // 離籃框約 4.2 m：在阻絕範圍內側，又不會用到最小距離
    expect(dist(defendPosition(post, handler, false, false, 'tight'), post)).toBeLessThan(dist(defendPosition(post, handler, false), post));
  });

  it('緊貼：外圍無球者就算沒往外跑，也站在傳球路線上阻絕', () => {
    const wing = { x: -5.4, y: 6.0 };
    const ball = { x: 0, y: 8.6 };
    expect(defendPosition(wing, ball, false, false, 'tight')).toEqual(defendPosition(wing, ball, false, true));
    expect(defendPosition(wing, ball, false, false)).not.toEqual(defendPosition(wing, ball, false, true));
  });

  it('開局站位也依防守距離', () => {
    const t = createDefaultTactic();
    const normal = { ...t.frames[0]!.start };
    t.pressure = 'tight';
    syncFrames(t, false);
    expect(dist(t.frames[0]!.start.r2!, t.frames[0]!.start.b2!)).toBeLessThan(dist(normal.r2!, normal.b2!));
  });

  const points = (category: string, name: string, pressure: 'normal' | 'tight') => {
    const base = createDefaultTactic();
    base.pressure = pressure;
    const t = loadPlay(base, PLAYS.find((p) => p.category === category && p.name === name)!, { A: 'b1', B: 'b2', C: 'b3' });
    return evaluate(t, simulate(t)).expectedPoints!;
  };

  it('緊貼的好處：擋拆外拉不容易空檔', () => {
    expect(points('高位擋拆', 'Pick and Pop', 'tight')).toBeLessThan(points('高位擋拆', 'Pick and Pop', 'normal'));
  });

  it('緊貼的代價：假手遞手接背切，被甩開', () => {
    expect(points('手遞手', 'Fake Hand-Off', 'tight')).toBeGreaterThan(points('手遞手', 'Fake Hand-Off', 'normal') + 0.1);
  });
});

describe('弱邊補防', () => {
  const RIM = { x: 0, y: 1.575 };

  it('driveHelpPosition：在切入路線上、離籃框指定距離；切入者已經更近時，站在他前面 1.5 m', () => {
    expect(dist(driveHelpPosition({ x: 0, y: 8 }, 3), RIM)).toBeCloseTo(3);
    const close = { x: 0, y: 4 };
    expect(dist(driveHelpPosition(close, 3), close)).toBeCloseTo(1.5);
  });

  it('driveHelpDepth：比切入者早到才補，選離籃框最遠的點；太遠、或切入者太快就不補', () => {
    const driver = { x: 0, y: 9 }; // 離籃框約 7.4 m
    const spots = [4, 3, 2];
    // 站在罰球線附近的人：迎得最前面
    expect(driveHelpDepth({ x: 1.5, y: 5 }, 4.5, driver, 4, spots, 0.2, 0.1)).toBe(4);
    // 底角外面的人：來不及
    expect(driveHelpDepth({ x: 7, y: 1 }, 4.5, driver, 4, spots, 0.2, 0.1)).toBeNull();
    // 同一個人，切入者快很多：來不及
    expect(driveHelpDepth({ x: 3.5, y: 2.5 }, 4.5, driver, 4, spots, 0.2, 0.1)).not.toBeNull();
    expect(driveHelpDepth({ x: 3.5, y: 2.5 }, 4.5, driver, 12, spots, 0.2, 0.1)).toBeNull();
  });

  const run = (name: string, opts: Partial<Pick<Tactic, 'screenDefense' | 'pressure' | 'driveHelp'>>) => {
    const base = createDefaultTactic();
    Object.assign(base, opts);
    const t = loadPlay(base, PLAYS.find((p) => p.name === name)!, { A: 'b1', B: 'b2', C: 'b3' });
    const sim = simulate(t);
    return { sim, points: evaluate(t, sim).expectedPoints! };
  };

  it('預設不補防：沒有補防事件', () => {
    expect(run('Drive to Rim', { screenDefense: 'fight-over' }).sim.defense.events.some((e) => e.type === 'drive-help')).toBe(false);
  });

  it('擋拆切入：弱邊補防擋住切入，原本盯的人空出來', () => {
    const off = run('Drive to Rim', { screenDefense: 'fight-over' });
    const on = run('Drive to Rim', { screenDefense: 'fight-over', driveHelp: 'weak-side' });
    const help = on.sim.defense.events.find((e) => e.type === 'drive-help')!;
    expect(help).toMatchObject({ handlerId: 'b1' });
    expect(help.type === 'drive-help' && help.leftId).not.toBe('b1');
    expect(on.points).toBeLessThan(off.points - 0.1);
  });

  it('兩邊拉到底角的單打：弱邊離太遠，來不及補', () => {
    const on = run('Top Isolation', { driveHelp: 'weak-side' });
    expect(on.sim.defense.events.some((e) => e.type === 'drive-help')).toBe(false);
  });

  it('補防的代價：緊貼時去補防，順下的人空出來', () => {
    const off = run('Pick and Roll', { pressure: 'tight' });
    const on = run('Pick and Roll', { pressure: 'tight', driveHelp: 'weak-side' });
    expect(on.points).toBeGreaterThan(off.points + 0.1);
  });
});

describe('補防與擋拆協防（18 套戰術 × 各種設定）', () => {
  const combos = (['switch', 'fight-over'] as const).flatMap((screenDefense) =>
    (['normal', 'tight'] as const).flatMap((pressure) =>
      (['drop', 'hedge'] as const).map((pickCoverage) => ({ screenDefense, pressure, pickCoverage, driveHelp: 'weak-side' as const })),
    ),
  );
  const runs = PLAYS.flatMap((play) =>
    combos.map((c) => {
      const base = createDefaultTactic();
      Object.assign(base, c);
      const t = loadPlay(base, play, { A: 'b1', B: 'b2', C: 'b3' });
      const sim = simulate(t);
      return { label: `${play.name} ${JSON.stringify(c)}`, sim, comments: evaluate(t, sim).comments };
    }),
  );

  it('正在補防的人不會被派去擋拆協防', () => {
    for (const { label, sim } of runs) {
      const drives = sim.defense.events.filter((e) => e.type === 'drive-help');
      for (const p of sim.defense.events.filter((e) => e.type === 'drop' || e.type === 'hedge')) {
        const busy = drives.some((d) => d.defenderId === p.defenderId && p.t >= d.t && p.t < d.t + d.delay);
        expect(busy, label).toBe(false);
      }
    }
  });

  it('剛補就傳球（只有反應時間那麼久）不寫補防評語，不受浮點誤差影響', () => {
    let momentary = 0;
    for (const { label, sim, comments } of runs) {
      const drives = sim.defense.events.filter((e) => e.type === 'drive-help');
      if (drives.some((d) => d.delay < 0.25)) momentary++;
      // 有補防評語時，一定是補防超過 0.3 秒的那一次
      for (const c of comments.filter((x) => x.text.includes('從弱邊補防'))) {
        expect(drives.some((d) => d.delay >= 0.3 && c.text.includes(`${d.delay.toFixed(1)} 秒`)), label).toBe(true);
      }
    }
    expect(momentary).toBeGreaterThan(0); // 確實有這種情況
  });
});

it('補防中的人，原本盯的人上來擋拆：不會被派去沉退 / 上提', () => {
  // 1 號往籃下運球，3 號的防守者紅 3 從弱邊補防；3 號同時到 (1, 4) 幫 1 號擋拆
  const t = createDefaultTactic();
  t.screenDefense = 'fight-over';
  t.driveHelp = 'weak-side';
  const f0 = t.frames[0]!;
  f0.start.b3 = { x: 3.5, y: 4.5 };
  syncFrames(t, false);
  putPath(f0, { id: 'd', kind: 'dribble', actorId: 'b1', points: [f0.start.b1!, { x: -1, y: 4.2 }], freehand: false });
  putPath(f0, { id: 's', kind: 'screen', actorId: 'b3', points: [f0.start.b3!, { x: 1, y: 4 }], freehand: false });
  insertFrameAfter(t, 0);
  const f1 = t.frames[1]!;
  putPath(f1, { id: 'd2', kind: 'dribble', actorId: 'b1', points: [f1.start.b1!, { x: 0, y: 2.6 }], freehand: false });
  syncFrames(t, true);
  const events = simulateDefense(t, buildTimeline(t)).events;
  const drives = events.filter((e) => e.type === 'drive-help');
  expect(drives.length).toBeGreaterThan(0);
  expect(events.some((e) => e.type === 'fight-over' && e.screenerId === 'b3')).toBe(true);
  for (const p of events.filter((e) => e.type === 'drop' || e.type === 'hedge')) {
    expect(drives.some((d) => d.defenderId === p.defenderId && p.t >= d.t && p.t < d.t + d.delay)).toBe(false);
  }
});
