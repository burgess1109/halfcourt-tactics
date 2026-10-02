import { describe, expect, it } from 'vitest';
import { simulate } from '../anim/simulation';
import { createDefaultTactic } from '../model/defaults';
import { insertFrameAfter } from '../model/frames';
import { makeShot, putPath } from '../model/paths';
import { loadPlay } from '../plays/instantiate';
import { PLAYS } from '../plays/library';
import type { Tactic, Vec2 } from '../model/types';
import { CONTESTED_FACTOR, PAINT_RATE, THREE_RATE } from './config';
import { evaluate, gradeOf, shotValue, zoneOf } from './evaluate';

const roles = { A: 'b1', B: 'b2', C: 'b3' } as const;

/** 只放一名防守者在指定位置，其他紅隊放到很遠 */
function positions(shooter: Vec2, defender: Vec2): Record<string, Vec2> {
  return {
    b1: shooter,
    b2: { x: -7, y: 13 },
    b3: { x: 7, y: 13 },
    r1: defender,
    r2: { x: -7, y: 14 },
    r3: { x: 7, y: 14 },
  };
}

describe('區域', () => {
  it('弧外（含底角直線段）、禁區、中距離', () => {
    expect(zoneOf({ x: 0, y: 9 })).toBe('three');
    expect(zoneOf({ x: 6.7, y: 1 })).toBe('three');
    expect(zoneOf({ x: 1, y: 2.5 })).toBe('paint');
    expect(zoneOf({ x: 3.5, y: 5 })).toBe('mid');
  });
});

describe('單一出手的預期得分', () => {
  const t = createDefaultTactic();

  it('完全空檔：命中率 × 分數', () => {
    const v = shotValue(t, 'b1', positions({ x: 0, y: 9 }, { x: 0, y: 4 }), false);
    expect(v.zone).toBe('three');
    expect(v.openness).toBe(1);
    expect(v.expectedPoints).toBeCloseTo(THREE_RATE[2] * 2);
  });

  it('防守者貼身在前方：命中率剩一半', () => {
    const v = shotValue(t, 'b1', positions({ x: 0, y: 3 }, { x: 0, y: 1.7 }), false);
    expect(v.zone).toBe('paint');
    expect(v.openness).toBe(0);
    expect(v.expectedPoints).toBeCloseTo(PAINT_RATE[2] * CONTESTED_FACTOR);
  });

  it('同樣距離，防守者在身後的干擾比較小', () => {
    const front = shotValue(t, 'b1', positions({ x: 0, y: 4 }, { x: 0, y: 2.2 }), false);
    const behind = shotValue(t, 'b1', positions({ x: 0, y: 4 }, { x: 0, y: 5.8 }), false);
    expect(behind.defenderBehind).toBe(true);
    expect(behind.expectedPoints).toBeGreaterThan(front.expectedPoints);
  });

  it('防守者比較高時干擾比較大；單打能力在運球後拉開距離', () => {
    const shooter = { x: 0, y: 4 };
    const defender = { x: 0, y: 2 };
    const base = shotValue(t, 'b1', positions(shooter, defender), false);
    const tall = structuredClone(t);
    tall.players.find((p) => p.id === 'r1')!.heightCm = 200;
    expect(shotValue(tall, 'b1', positions(shooter, defender), false).expectedPoints).toBeLessThan(base.expectedPoints);
    const iso = structuredClone(t);
    iso.players.find((p) => p.id === 'b1')!.skills!.iso = 4;
    expect(shotValue(iso, 'b1', positions(shooter, defender), true).expectedPoints).toBeGreaterThan(
      shotValue(iso, 'b1', positions(shooter, defender), false).expectedPoints,
    );
  });

  it('評等門檻', () => {
    expect(gradeOf(0.84)).toBe('S');
    expect(gradeOf(0.66)).toBe('A');
    expect(gradeOf(0.5)).toBe('B');
    expect(gradeOf(0.4)).toBe('C');
    expect(gradeOf(0.2)).toBe('D');
  });
});

describe('整套戰術的評分', () => {
  const run = (t: Tactic) => evaluate(t, simulate(t));

  it('有投籃就評那一球，第一條評價說明出手', () => {
    const t = loadPlay(createDefaultTactic(), PLAYS.find((p) => p.id === 'offball-down')!, roles);
    const e = run(t);
    expect(e.hasShot).toBe(true);
    expect(e.shot.playerId).toBe('b3');
    expect(e.shot.zone).toBe('three');
    expect(e.comments[0]!.text).toContain('3 號 球員 3 在弧外出手（2 分）');
    expect(e.comments.length).toBeLessThanOrEqual(5);
  });

  it('沒有投籃：挑最好的出手，並提醒沒有終結點', () => {
    const e = run(createDefaultTactic());
    expect(e.hasShot).toBe(false);
    expect(e.comments[0]!.text).toContain('沒有投籃');
  });

  it('出手超過 12 秒：違例，預期得分 0、評等 D', () => {
    const t = createDefaultTactic();
    for (let i = 0; i < 11; i++) {
      const f = t.frames[t.frames.length - 1]!;
      const b2 = f.start.b2!;
      putPath(f, { id: `c${i}`, kind: 'cut', actorId: 'b2', points: [b2, { x: -b2.x, y: b2.y }], freehand: false });
      insertFrameAfter(t, t.frames.length - 1);
    }
    putPath(t.frames.at(-1)!, makeShot('b1', t.frames.at(-1)!));
    const e = run(t);
    expect(e.violation).toBe(true);
    expect(e.expectedPoints).toBe(0);
    expect(e.grade).toBe('D');
    expect(e.comments.some((c) => c.text.includes('違例'))).toBe(true);
  });

  it('擠過時列出掩護擋住多久；換防時列出換防', () => {
    for (const scheme of ['fight-over', 'switch'] as const) {
      const base = createDefaultTactic();
      base.screenDefense = scheme;
      const t = loadPlay(base, PLAYS.find((p) => p.id === 'high-pnr-roll')!, roles);
      const texts = run(t).comments.map((c) => c.text).join('\n');
      expect(texts).toContain(scheme === 'fight-over' ? '的掩護擋住' : '的掩護逼對方換防');
    }
  });

  it('有人比出手者空很多時，提示更好的選擇', () => {
    const t = createDefaultTactic();
    putPath(t.frames[0]!, makeShot('b1', t.frames[0]!));
    // 把 b3 的防守者換到很遠：直接讓 b1 出手、b3 在弧外完全空檔
    t.players.find((p) => p.id === 'b3')!.skills!.shooting = 4;
    t.matchups = { b1: 'r1', b2: 'r2', b3: 'r3' };
    const sim = simulate(t);
    sim.defense.red.r3 = sim.defense.red.r3!.map(() => ({ x: -7, y: 14 }));
    const e = evaluate(t, sim);
    expect(e.comments.some((c) => c.text.startsWith('其實 3 號'))).toBe(true);
  });

  it('完全決定性', () => {
    const t = loadPlay(createDefaultTactic(), PLAYS[0]!, roles);
    expect(JSON.stringify(run(t))).toBe(JSON.stringify(run(t)));
  });
});

describe('評價數量與內容', () => {
  it('每套內建戰術都有 3–5 條評價，包含命中率說明', () => {
    for (const play of PLAYS) {
      const t = loadPlay(createDefaultTactic(), play, roles);
      const e = evaluate(t, simulate(t));
      expect(e.comments.length, play.id).toBeGreaterThanOrEqual(3);
      expect(e.comments.length, play.id).toBeLessThanOrEqual(5);
      expect(e.comments.some((c) => c.text.includes('空檔命中率')), play.id).toBe(true);
    }
  });
});

describe('身高錯位', () => {
  it('禁區：高 10 cm 干擾少 40%、高 20 cm 少 80%（上限）；跳投效果減半；防守者比較高時干擾增加', async () => {
    const { mismatchEffect } = await import('./evaluate');
    expect(mismatchEffect(10, 'paint')).toBeCloseTo(0.4);
    expect(mismatchEffect(20, 'paint')).toBeCloseTo(0.8);
    expect(mismatchEffect(30, 'paint')).toBeCloseTo(0.8);
    expect(mismatchEffect(20, 'three')).toBeCloseTo(0.4);
    expect(mismatchEffect(-10, 'paint')).toBeCloseTo(-0.4);
    expect(mismatchEffect(-30, 'paint')).toBeCloseTo(-0.5);
  });

  it('被貼身干擾的禁區出手：高 20 cm 時預期得分大幅提高', () => {
    const shooter = { x: 0, y: 3 };
    const defender = { x: 0, y: 1.7 };
    const even = createDefaultTactic();
    const tall = createDefaultTactic();
    tall.players.find((p) => p.id === 'b1')!.heightCm = 195; // r1 未填 → 跟 b1 一樣高，所以要明確設定
    tall.players.find((p) => p.id === 'r1')!.heightCm = 175;
    const a = shotValue(even, 'b1', positions(shooter, defender), false);
    const b = shotValue(tall, 'b1', positions(shooter, defender), false);
    expect(a.expectedPoints).toBeCloseTo(PAINT_RATE[2] * 0.5);
    expect(b.heightEdge).toBe(20);
    expect(b.expectedPoints).toBeCloseTo(PAINT_RATE[2] * (1 - 0.5 * 0.2));
  });

  it('高位擋拆換防後，高 20 cm 的下順者從 D 進步，評價說明身高優勢', () => {
    const play = PLAYS.find((p) => p.id === 'high-pnr-roll')!;
    const even = loadPlay(createDefaultTactic(), play, roles);
    const base = createDefaultTactic();
    base.players.find((p) => p.id === 'b2')!.heightCm = 195;
    base.players.find((p) => p.id === 'r2')!.heightCm = 195; // 原本盯 b2 的人一樣高；換防後換成 175 的 r1 盯 b2
    base.players.find((p) => p.id === 'r1')!.heightCm = 175;
    const tall = loadPlay(base, play, roles);
    const e0 = evaluate(even, simulate(even));
    const e1 = evaluate(tall, simulate(tall));
    expect(e1.expectedPoints).toBeGreaterThan(e0.expectedPoints + 0.1);
    expect(e1.comments.map((c) => c.text).join('\n')).toContain('高 20 cm，干擾減少 80%');
  });
});

describe('review 修正', () => {
  const run = (t: Tactic) => evaluate(t, simulate(t));

  it('1. 掩護者留在原地繼續擋人，不算空間太擠（Paint Shot）', () => {
    const t = loadPlay(createDefaultTactic(), PLAYS.find((p) => p.id === 'low-pnr-paint')!, roles);
    expect(run(t).comments.some((c) => c.text.includes('空間太擠'))).toBe(false);
  });

  it('2. 換防的錯位說明用「那次換防之後」的對位', () => {
    const t = loadPlay(createDefaultTactic(), PLAYS.find((p) => p.id === 'offball-post-split')!, roles);
    const sim = simulate(t);
    const switches = sim.defense.events.filter((e) => e.type === 'switch');
    expect(switches.length).toBeGreaterThanOrEqual(2);
    const [first, second] = switches;
    // 第 1 次換防後的對位：只交換第 1 次的兩位防守者
    expect(first!.assignmentsAfter![first!.defenderId]).toBe(first!.screenerId);
    expect(first!.assignmentsAfter).not.toEqual(second!.assignmentsAfter);
  });

  it('3. 出手之後才發生的掩護不列入評價', () => {
    const t = loadPlay(createDefaultTactic(), PLAYS.find((p) => p.id === 'offball-down')!, roles);
    const sim = simulate(t);
    const late = sim.timeline.shotReleaseAt! + 0.3;
    sim.defense.events.push({ t: late, type: 'fight-over', defenderId: 'r1', screenerId: 'b1', delay: 0.5 });
    expect(evaluate(t, sim).comments.some((c) => c.text.includes('1 號 球員 1 的掩護'))).toBe(false);
  });

  it('5. 評價超過 5 條時，命中率說明一定保留，顯示順序不變', async () => {
    const { pickComments } = await import('./evaluate');
    const make = (text: string, priority: number) => ({ text, frameIndex: 0, playerIds: [], priority });
    const picked = pickComments([
      make('出手', 0),
      make('掩護 1', 4),
      make('掩護 2', 4),
      make('掩護 3', 4),
      make('空間', 5),
      make('命中率', 2),
      make('時間', 6),
    ]);
    expect(picked.map((c) => c.text)).toEqual(['出手', '掩護 1', '掩護 2', '掩護 3', '命中率']);
    expect(picked[0]).not.toHaveProperty('priority');
  });
});

describe('4. 戰術一改就清掉上次的評分', () => {
  it('lastResult 在下一次修改後被移除', async () => {
    const { Store } = await import('../model/store');
    const store = new Store();
    store.update((s) => {
      s.tactic.lastResult = { grade: 'A', expectedPoints: 0.66 };
    });
    store.commit((s) => {
      s.tactic.frames[0]!.start.b2 = { x: -4, y: 7 };
    });
    expect(store.get().tactic.lastResult).toBeUndefined();
  });
});

describe('載入戰術時保留它自己的評分', () => {
  it('store.load 不會清掉新戰術的 lastResult；之後修改才清掉', async () => {
    const { Store } = await import('../model/store');
    const store = new Store();
    const saved = createDefaultTactic();
    saved.lastResult = { grade: 'B', expectedPoints: 0.5 };
    store.load(saved);
    expect(store.get().tactic.lastResult).toEqual({ grade: 'B', expectedPoints: 0.5 });
    store.commit((s) => {
      s.tactic.frames[0]!.start.b2 = { x: -4, y: 7 };
    });
    expect(store.get().tactic.lastResult).toBeUndefined();
  });
});
