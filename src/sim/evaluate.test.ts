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
