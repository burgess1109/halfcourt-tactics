import { describe, expect, it } from 'vitest';
import { createDefaultTactic } from '../model/defaults';
import { Store } from '../model/store';
import type { Rating, Skills, Tactic } from '../model/types';
import { loadPlay } from './instantiate';
import { PLAYS } from './library';
import { attributeScore, bestAssignment, rankPlays, recommend, scoreAssignment } from './recommend';

function team(skills: Partial<Record<'b1' | 'b2' | 'b3', Partial<Skills>>>, heights?: Record<string, number>): Tactic {
  const t = createDefaultTactic();
  for (const p of t.players) {
    if (p.team === 'blue') p.skills = { shooting: 2, speed: 2, finishing: 2, iso: 2, ...skills[p.id as 'b1'] };
    if (heights?.[p.id] !== undefined) p.heightCm = heights[p.id];
  }
  return t;
}

describe('推薦演算法', () => {
  it('能力分數直接用等級；身高、速度跟對位的防守者比', () => {
    const t = team({ b1: { shooting: 4 } }, { b1: 185, r1: 175 });
    const b1 = t.players.find((p) => p.id === 'b1')!;
    expect(attributeScore(t, b1, 'shooting')).toBe(4);
    expect(attributeScore(t, b1, 'height')).toBe(4); // 高 10 cm = 兩級
    // 高 10 cm 的人慢 3%（身高係數 0.97）→ 速度分數 2 − 0.6
    expect(attributeScore(t, b1, 'speed')).toBeCloseTo(1.4);
    // 紅隊速度劣勢 → 藍隊速度分數提高
    t.players.find((p) => p.id === 'r1')!.speedRating = 0 as Rating;
    expect(attributeScore(t, b1, 'speed')).toBeGreaterThan(2);
  });

  it('全部平均時，每套都是 2 分，依戰術庫順序', () => {
    const ranked = rankPlays(createDefaultTactic());
    expect(ranked.every((r) => Math.abs(r.score - 2) < 1e-9)).toBe(true);
    expect(ranked.map((r) => r.play.id)).toEqual(PLAYS.map((p) => p.id));
    expect(ranked[0]!.reason).toContain('能力都在平均水準');
  });

  it('外線優勢的球員會被排到投籃的角色，推薦投籃類戰術', () => {
    const t = team({ b3: { shooting: 4 } });
    const top = recommend(t);
    expect(top).toHaveLength(5);
    const first = top[0]!;
    expect(first.play.weights[first.play.finisher].shooting).toBeGreaterThan(0);
    expect(first.roles[first.play.finisher]).toBe('b3');
    expect(first.reason).toContain('3 號');
    expect(first.reason).toContain('3 號 球員 3 的外線投射「優勢」');
  });

  it('速度和單打優勢、對上慢的防守者 → 推薦切入、單打類戰術', () => {
    const t = team({ b1: { speed: 4, iso: 4, finishing: 3 } });
    t.players.find((p) => p.id === 'r1')!.speedRating = 0 as Rating;
    const top = recommend(t);
    expect(top.map((r) => r.play.id)).toContain('iso-mismatch');
    for (const r of top) expect(r.roles[r.play.finisher]).toBe('b1');
    // 投籃類戰術（終結者看重外線）都排在後面
    const ranked = rankPlays(t).map((r) => r.play);
    const firstShooting = ranked.findIndex((p) => (p.weights[p.finisher].shooting ?? 0) > 0);
    expect(firstShooting).toBeGreaterThanOrEqual(5);
  });

  it('角色分配取最高分，結果完全決定性', () => {
    const t = team({ b2: { finishing: 4 } }, { b1: 180, b2: 200, b3: 185 });
    const play = PLAYS.find((p) => p.id === 'high-pnr-roll')!;
    const best = bestAssignment(t, play);
    expect(best.roles.B).toBe('b2'); // 下順上籃的是禁區終結優勢、又最高的 b2
    for (const a of ['b1', 'b2', 'b3']) for (const b of ['b1', 'b2', 'b3']) for (const c of ['b1', 'b2', 'b3']) {
      if (new Set([a, b, c]).size < 3) continue;
      expect(scoreAssignment(t, play, { A: a, B: b, C: c })).toBeLessThanOrEqual(best.score + 1e-9);
    }
    expect(JSON.stringify(recommend(t))).toBe(JSON.stringify(recommend(t)));
  });
});

describe('載入內建戰術', () => {
  it('載入算一步，可以復原；之後動到分鏡才算已修改', () => {
    const store = new Store();
    const before = store.get().tactic.id;
    const play = PLAYS[0]!;
    store.load(loadPlay(store.get().tactic, play, { A: 'b1', B: 'b2', C: 'b3' }));
    expect(store.get().tactic.basedOn).toMatchObject({ playId: play.id, modified: false });

    // 只改球員資料，不算修改戰術
    store.commit((s) => {
      s.tactic.players.find((p) => p.id === 'b1')!.name = '小明';
    });
    expect(store.get().tactic.basedOn!.modified).toBe(false);

    // 刪掉一條路線 → 已修改
    store.commit((s) => {
      s.tactic.frames[0]!.paths.pop();
    });
    expect(store.get().tactic.basedOn!.modified).toBe(true);

    store.undo();
    store.undo();
    store.undo();
    expect(store.get().tactic.id).toBe(before);
  });

  it('改對位、紅隊身高與速度、掩護應對（紅隊位置會重算）不算修改戰術', () => {
    const store = new Store();
    const play = PLAYS.find((p) => p.id === 'high-pnr-roll')!;
    store.load(loadPlay(store.get().tactic, play, { A: 'b1', B: 'b2', C: 'b3' }));
    const before = JSON.stringify(store.get().tactic.frames.map((f) => f.start.r1));
    store.commit((s) => {
      s.tactic.matchups = { b1: 'r3', b2: 'r2', b3: 'r1' };
      s.tactic.screenDefense = 'fight-over';
      const r2 = s.tactic.players.find((p) => p.id === 'r2')!;
      r2.heightCm = 210;
      r2.speedRating = 0;
    });
    // 紅隊位置確實變了，但沒有動到使用者畫的部分
    expect(JSON.stringify(store.get().tactic.frames.map((f) => f.start.r1))).not.toBe(before);
    expect(store.get().tactic.basedOn!.modified).toBe(false);

    // 拖動第 1 個分鏡的藍隊站位 → 已修改
    store.commit((s) => {
      s.tactic.frames[0]!.start.b3 = { x: -4, y: 7 };
    });
    expect(store.get().tactic.basedOn!.modified).toBe(true);
  });
});

describe('推薦理由', () => {
  it('速度只快不到 1% 時不拿來當理由（不會出現「快 0%」）', () => {
    const t = createDefaultTactic();
    for (const p of t.players) p.heightCm = 180;
    t.players.find((p) => p.id === 'b1')!.heightCm = 179; // 矮 1 cm → 只快約 0.3%
    for (const play of PLAYS) {
      const r = bestAssignment(t, play);
      expect(r.reason, play.id).not.toContain('快 0%');
    }
  });
});

describe('球隊總評', () => {
  it('全部平均：沒有強項，給一般性建議', async () => {
    const { teamSummary } = await import('./recommend');
    const s = teamSummary(createDefaultTactic());
    expect(s.strengths).toEqual([]);
    expect(s.advice).toContain('平均水準');
  });

  it('列出每個人的強項、對應的戰術類型與例子，並給整體建議', async () => {
    const { teamSummary } = await import('./recommend');
    const t = team({ b3: { shooting: 4 }, b2: { finishing: 3 } }, { b1: 180, b2: 198, b3: 185, r1: 180, r2: 185, r3: 185 });
    // 預設對位依身高：b2(198)→r2/r3(185)… 讓 b2 有身高優勢
    const s = teamSummary(t);
    const shooter = s.strengths.find((x) => x.playerId === 'b3' && x.key === 'shooting')!;
    expect(shooter.label).toBe('外線投射「優勢」');
    expect(shooter.style).toBe('外線出手');
    expect(shooter.examples.length).toBeGreaterThan(0);
    for (const p of shooter.examples) expect(p.weights[p.finisher].shooting).toBeGreaterThan(0);
    expect(s.strengths.some((x) => x.playerId === 'b2' && x.key === 'finishing')).toBe(true);
    expect(s.strengths.some((x) => x.playerId === 'b2' && x.key === 'height')).toBe(true);
    // 最強的是 3 號的外線，第二選擇是另一個人
    expect(s.advice).toMatch(/^建議以 3 號 球員 3 的外線出手為主要攻擊點，2 號 球員 2 的.+當第二選擇。最適合的戰術是「.+」。$/);
  });
});

describe('空白戰術', () => {
  it('保留球員資料、對位與掩護應對，跑位清空、只剩一個分鏡、不再標示內建戰術', async () => {
    const { createBlankTactic } = await import('../model/defaults');
    const base = team({ b3: { shooting: 4 } }, { b1: 180, b2: 198, b3: 185 });
    base.matchups = { b1: 'r3', b2: 'r2', b3: 'r1' };
    base.screenDefense = 'fight-over';
    base.players.find((p) => p.id === 'b1')!.name = '小明';
    const loaded = loadPlay(base, PLAYS[0]!, { A: 'b1', B: 'b2', C: 'b3' });
    const blank = createBlankTactic(loaded);
    expect(blank.id).not.toBe(loaded.id);
    expect(blank.basedOn).toBeUndefined();
    expect(blank.frames).toHaveLength(1);
    expect(blank.frames[0]!.paths).toEqual([]);
    expect(blank.frames[0]!.ballHolderId).toBe('b1');
    expect(blank.players).toEqual(loaded.players);
    expect(blank.matchups).toEqual(base.matchups);
    expect(blank.screenDefense).toBe('fight-over');
  });
});
