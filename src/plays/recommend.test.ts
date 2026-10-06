import { describe, expect, it } from 'vitest';
import { createDefaultTactic } from '../model/defaults';
import { Store } from '../model/store';
import type { Rating, Skills, Tactic } from '../model/types';
import { loadPlay } from './instantiate';
import { PLAYS, playVariant } from './library';
import { attributeScore, bestAssignment, rankPlays, recommend, scoreAssignment } from './recommend';

function team(skills: Partial<Record<'b1' | 'b2' | 'b3', Partial<Skills>>>, heights?: Record<string, number>): Tactic {
  const t = createDefaultTactic();
  for (const p of t.players) {
    if (p.team === 'blue') p.skills = { midRange: 2, threePoint: 2, speed: 2, finishing: 2, iso: 2, ...skills[p.id as 'b1'] };
    if (heights?.[p.id] !== undefined) p.heightCm = heights[p.id];
  }
  return t;
}

describe('推薦演算法', () => {
  it('能力分數直接用等級；身高、速度跟對位的防守者比', () => {
    const t = team({ b1: { threePoint: 4 } }, { b1: 185, r1: 175 });
    const b1 = t.players.find((p) => p.id === 'b1')!;
    expect(attributeScore(t, b1, 'threePoint')).toBe(4);
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

  it('弧外投射優勢的球員會被排到投籃的角色，推薦投籃類戰術', () => {
    const t = team({ b3: { threePoint: 4 } });
    const top = recommend(t);
    expect(top).toHaveLength(5);
    const first = top[0]!;
    expect(first.play.weights[first.play.finisher].threePoint).toBeGreaterThan(0);
    expect(first.roles[first.play.finisher]).toBe('b3');
    expect(first.reason).toContain('3 號');
    expect(first.reason).toContain('3 號 球員 3 的弧外投射「優勢」');
  });

  it('速度和單打優勢、對上慢的防守者 → 推薦切入、單打類戰術', () => {
    const t = team({ b1: { speed: 4, iso: 4, finishing: 3 } });
    t.players.find((p) => p.id === 'r1')!.speedRating = 0 as Rating;
    const top = recommend(t);
    expect(top.map((r) => r.play.id)).toContain('iso-mismatch');
    for (const r of top) expect(r.roles[r.play.finisher]).toBe('b1');
    // 投籃類戰術（終結者看重外線）都排在後面
    const ranked = rankPlays(t).map((r) => r.play);
    const firstShooting = ranked.findIndex((p) => (p.weights[p.finisher].threePoint ?? 0) > 0);
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
    const t = team({ b3: { threePoint: 4 }, b2: { finishing: 3 } }, { b1: 180, b2: 198, b3: 185, r1: 180, r2: 185, r3: 185 });
    // 預設對位依身高：b2(198)→r2/r3(185)… 讓 b2 有身高優勢
    const s = teamSummary(t);
    const shooter = s.strengths.find((x) => x.playerId === 'b3' && x.key === 'threePoint')!;
    expect(shooter.label).toBe('弧外投射「優勢」');
    expect(shooter.style).toBe('弧外投籃');
    expect(shooter.examples.length).toBeGreaterThan(0);
    for (const p of shooter.examples) expect(p.weights[p.finisher].threePoint).toBeGreaterThan(0);
    expect(s.strengths.some((x) => x.playerId === 'b2' && x.key === 'finishing')).toBe(true);
    expect(s.strengths.some((x) => x.playerId === 'b2' && x.key === 'height')).toBe(true);
    // 最強的是 3 號的弧外投射，第二選擇是另一個人
    expect(s.advice).toMatch(/^建議以 3 號 球員 3 的弧外投籃為主要攻擊點，2 號 球員 2 的.+當第二選擇。最適合的戰術是「.+」（預期 [SABCD]）。$/);
  });
});

describe('空白戰術', () => {
  it('保留球員資料、對位與掩護應對，跑位清空、只剩一個分鏡、不再標示內建戰術', async () => {
    const { createBlankTactic } = await import('../model/defaults');
    const base = team({ b3: { threePoint: 4 } }, { b1: 180, b2: 198, b3: 185 });
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

describe('依實際模擬的預期得分排序', () => {
  it('推薦依預期得分由高到低；每張都有預期評等，和載入後實際評分一致', async () => {
    const { rankBySimulation } = await import('./recommend');
    const { simulate } = await import('../anim/simulation');
    const { evaluate } = await import('../sim/evaluate');
    const t = team({ b1: { iso: 3 }, b2: { finishing: 3 }, b3: { threePoint: 4 } }, { b1: 180, b2: 198, b3: 185 });
    const ranked = rankBySimulation(t);
    expect(ranked).toHaveLength(PLAYS.length);
    for (let i = 1; i < ranked.length; i++) {
      expect(ranked[i - 1]!.expectedPoints!).toBeGreaterThanOrEqual(ranked[i]!.expectedPoints!);
    }
    const top = recommend(t, 5, ranked);
    expect(top).toEqual(ranked.slice(0, 5));
    // 推薦時說的分數 = 點下去播完的分數
    const loaded = loadPlay(t, top[0]!.play, top[0]!.roles);
    const e = evaluate(loaded, simulate(loaded));
    expect(e.expectedPoints).toBeCloseTo(top[0]!.expectedPoints!);
    expect(e.grade).toBe(top[0]!.grade);
  });

  it('同分時看適合度，再維持戰術庫順序', async () => {
    const { sortBySimulation } = await import('./recommend');
    const rec = (i: number, xp: number, score: number) => ({ play: PLAYS[i]!, roles: { A: 'b1', B: 'b2', C: 'b3' }, score, reason: '', expectedPoints: xp });
    const sorted = sortBySimulation([rec(3, 0.5, 2), rec(1, 0.5, 2), rec(2, 0.5, 3), rec(0, 0.7, 1)]);
    expect(sorted.map((r) => PLAYS.indexOf(r.play))).toEqual([0, 2, 1, 3]);
  });

  it('快取鍵只看球員、對位、掩護應對，不看目前畫的路線', async () => {
    const { recommendationKey } = await import('./recommend');
    const t = createDefaultTactic();
    const key = recommendationKey(t);
    t.frames[0]!.start.b1 = { x: 1, y: 7 };
    expect(recommendationKey(t)).toBe(key);
    t.screenDefense = 'fight-over';
    expect(recommendationKey(t)).not.toBe(key);
  });
});

describe('開局站位（自由放置）', () => {
  it('套用陣型：持球者到持球位置，另外兩人依左右順序就位', async () => {
    const { DEFAULT_LINEUP, FORMATIONS, applyFormation } = await import('../model/lineup');
    const corners = FORMATIONS.find((f) => f.id === 'top-corners')!;
    const l = applyFormation({ ...DEFAULT_LINEUP, holder: 'b3' }, corners);
    expect(l.holder).toBe('b3');
    expect(l.positions.b3).toEqual(corners.spots[0]);
    // b2 原本在左（x 較小）→ 左底角；b1 原本在弧頂中間（x = 0）→ 右底角
    expect(l.positions.b2!.x).toBeLessThan(0);
    expect(l.positions.b1!.x).toBeGreaterThan(0);
  });

  it('拖曳限制在可視範圍內；點一下換持球者', async () => {
    const { DEFAULT_LINEUP, moveInLineup, setHolder } = await import('../model/lineup');
    const moved = moveInLineup(DEFAULT_LINEUP, 'b2', { x: -50, y: 3 });
    expect(moved.positions.b2!.x).toBeGreaterThan(-9);
    expect(setHolder(moved, 'b2').holder).toBe('b2');
  });

  it('空白戰術依自訂站位擺人，持球者拿球；換站位套用後仍算空白戰術', async () => {
    const { createBlankTactic } = await import('../model/defaults');
    const { applyLineup, isBlankTactic } = await import('../model/lineup');
    const { BALL_HOLD_OFFSET } = await import('../model/entities');
    const t = createDefaultTactic();
    t.setup.lineup = { positions: { b1: { x: -3, y: 9 }, b2: { x: 4, y: 3 }, b3: { x: 6.6, y: 1.2 } }, holder: 'b2' };
    const blank = createBlankTactic(t);
    const f = blank.frames[0]!;
    expect(f.start.b1).toEqual({ x: -3, y: 9 });
    expect(f.ballHolderId).toBe('b2');
    expect(f.start.ball).toEqual({ x: 4 + BALL_HOLD_OFFSET.x, y: 3 + BALL_HOLD_OFFSET.y });
    expect(isBlankTactic(blank)).toBe(true);
    expect(isBlankTactic(t)).toBe(false); // 還沒套用
    applyLineup(t.frames[0]!, t.setup.lineup);
    expect(isBlankTactic(t)).toBe(true);
  });

  it('拖動球員、畫路線、載入內建戰術後都不是空白戰術', async () => {
    const { isBlankTactic } = await import('../model/lineup');
    const t = createDefaultTactic();
    expect(isBlankTactic(t)).toBe(true);
    const moved = structuredClone(t);
    moved.frames[0]!.start.b1 = { x: 1, y: 1 };
    expect(isBlankTactic(moved)).toBe(false);
    const drawn = structuredClone(t);
    drawn.frames[0]!.paths.push({ id: 'x', kind: 'cut', actorId: 'b1', points: [{ x: 0, y: 8.6 }, { x: -2, y: 3 }], freehand: false });
    expect(isBlankTactic(drawn)).toBe(false);
    expect(isBlankTactic(loadPlay(t, PLAYS[0]!, { A: 'b1', B: 'b2', C: 'b3' }))).toBe(false);
  });
});

describe('小球場拖曳範圍', () => {
  it('傳入小球場的範圍時，往上拖不會超出畫面（圓標留在邊緣內）', async () => {
    const { DEFAULT_LINEUP, moveInLineup } = await import('../model/lineup');
    const { PLAYER_RADIUS } = await import('../model/entities');
    const view = { minX: -8.3, maxX: 8.3, minY: -0.8, maxY: 11.2 };
    const moved = moveInLineup(DEFAULT_LINEUP, 'b2', { x: -5, y: 13 }, view);
    expect(moved.positions.b2!.y).toBeCloseTo(11.2 - PLAYER_RADIUS);
  });
});

describe('跳投戰術的出手點（中距離 / 弧外）', () => {
  const pop = () => PLAYS.find((p) => p.id === 'high-pnr-pop')!;

  it('兩個出手點都模擬，選分數高的；中距離型射手選中距離、弧外型射手選弧外', async () => {
    const { withBestShot } = await import('./recommend');
    const mid = withBestShot(team({ b1: { midRange: 4, threePoint: 0 }, b2: { midRange: 4, threePoint: 0 }, b3: { midRange: 4, threePoint: 0 } }), pop());
    expect(mid.play.shot).toBe('mid');
    const three = withBestShot(team({ b1: { midRange: 0, threePoint: 4 }, b2: { midRange: 0, threePoint: 4 }, b3: { midRange: 0, threePoint: 4 } }), pop());
    expect(three.play.shot).toBe('three');
    // 兩個版本都保留，戰術庫可以切換；選中的是分數比較高的那一個
    expect(mid.alternatives!.map((a) => a.play.shot).sort()).toEqual(['mid', 'three']);
    for (const r of [mid, three]) {
      for (const a of r.alternatives!) expect(r.expectedPoints!).toBeGreaterThanOrEqual(a.expectedPoints!);
    }
  });

  it('終結者依出手點找最適合的人：中距離版給中距離好的人、弧外版給弧外好的人', async () => {
    const { withBestShot } = await import('./recommend');
    const t = team({ b1: { midRange: 4 }, b3: { threePoint: 4 } });
    const r = withBestShot(t, pop());
    const byShot = Object.fromEntries(r.alternatives!.map((a) => [a.play.shot, a]));
    expect(byShot.mid!.roles[byShot.mid!.play.finisher]).toBe('b1');
    expect(byShot.three!.roles[byShot.three!.play.finisher]).toBe('b3');
  });

  it('計分規則會影響選擇：同樣的射手，一般規則下的中距離比 FIBA 3x3 更有利', async () => {
    const { withBestShot } = await import('./recommend');
    const t = team({});
    const fiba = withBestShot(t, pop());
    const std = withBestShot({ ...t, scoring: 'standard' }, pop());
    const gap = (r: typeof fiba) => {
      const by = Object.fromEntries(r.alternatives!.map((a) => [a.play.shot, a.gradeScore!]));
      return by.mid! - by.three!;
    };
    expect(gap(std)).toBeGreaterThan(gap(fiba));
  });

  it('載入時記住出手點，戰術名稱也標示出來', async () => {
    const { playTitle } = await import('../ui/library');
    const alt = playVariant(pop(), 'mid');
    const t = loadPlay(createDefaultTactic(), alt, { A: 'b1', B: 'b2', C: 'b3' });
    expect(t.basedOn).toMatchObject({ playId: 'high-pnr-pop', shot: 'mid' });
    expect(playTitle(alt)).toBe('高位擋拆-Pick and Pop（中距離）');
  });
});

describe('Spain Pick and Roll：依防守選擇傳給外拉的 C 或下順的 B', () => {
  const spain = () => PLAYS.find((p) => p.id === 'high-pnr-spain')!;

  it('三個出手點都模擬；對方擠過沉退時傳給下順的 B（背掩護擋住沉退的防守者），換防時傳給外拉的 C', async () => {
    const { withBestShot } = await import('./recommend');
    const drop = withBestShot({ ...createDefaultTactic(), screenDefense: 'fight-over', pickCoverage: 'drop' }, spain());
    expect(drop.alternatives!.map((a) => a.play.shot).sort()).toEqual(['mid', 'paint', 'three']);
    expect(drop.play.shot).toBe('paint');
    expect(drop.play.finisher).toBe('B');
    const sw = withBestShot({ ...createDefaultTactic(), screenDefense: 'switch' }, spain());
    expect(sw.play.shot).toBe('three');
  });

  it('沉退時，Spain 的下順比一般的 Pick and Roll 空（背掩護真的有效果）', async () => {
    const { withBestShot } = await import('./recommend');
    const t = { ...createDefaultTactic(), screenDefense: 'fight-over' as const, pickCoverage: 'drop' as const };
    const paint = withBestShot(t, spain()).alternatives!.find((a) => a.play.shot === 'paint')!;
    const roll = withBestShot(t, PLAYS.find((p) => p.id === 'high-pnr-roll')!);
    expect(paint.gradeScore!).toBeGreaterThan(roll.gradeScore! + 20);
  });

  it('載入時記住禁區出手點，戰術名稱也標示出來', async () => {
    const { playTitle } = await import('../ui/library');
    const alt = playVariant(spain(), 'paint');
    const t = loadPlay(createDefaultTactic(), alt, { A: 'b1', B: 'b2', C: 'b3' });
    expect(t.basedOn).toMatchObject({ playId: 'high-pnr-spain', shot: 'paint' });
    expect(playTitle(alt)).toBe('高位擋拆-Spain Pick and Roll（禁區）');
  });
});

describe('球隊總評：跳投戰術的另一個出手點也能當例子', () => {
  it('中距離強項的人，即使五套跳投戰術都選了弧外版，也找得到中距離版的例子', async () => {
    const { teamSummary, rankBySimulation } = await import('./recommend');
    const { playTitle } = await import('../ui/library');
    const t = team({ b1: { midRange: 4, threePoint: 2 }, b3: { threePoint: 4, midRange: 2 } }, { b1: 180, b2: 185, b3: 190 });
    const ranked = rankBySimulation(t);
    const s = teamSummary(t, ranked);
    const mid = s.strengths.find((x) => x.playerId === 'b1' && x.key === 'midRange')!;
    expect(mid.examples.length).toBeGreaterThan(0);
    for (const p of mid.examples) {
      expect(p.shot).toBe('mid');
      expect(playTitle(p)).toContain('（中距離）');
    }
  });
});

describe('球隊總評的例子不重複', () => {
  it('同一套戰術的兩個出手點不會同時佔掉例子名額，例子順序和推薦一致', async () => {
    const { teamSummary, rankBySimulation } = await import('./recommend');
    for (const skills of [{ iso: 4, threePoint: 4 }, { speed: 4, threePoint: 4 }] as const) {
      const t = team({ b1: skills }, { b1: 180, b2: 185, b3: 190 });
      const ranked = rankBySimulation(t);
      const s = teamSummary(t, ranked);
      for (const st of s.strengths.filter((x) => x.playerId === 'b1')) {
        const ids = st.examples.map((p) => p.id);
        expect(new Set(ids).size, `${st.key}：${ids.join(', ')}`).toBe(ids.length);
        const order = ids.map((id) => ranked.findIndex((r) => r.play.id === id));
        expect(order, st.key).toEqual([...order].sort((a, b) => a - b));
      }
    }
  });
});
