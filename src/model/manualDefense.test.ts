import { describe, expect, it } from 'vitest';
import { simulate } from '../anim/simulation';
import { buildTimeline } from '../anim/timeline';
import { loadPlay } from '../plays/instantiate';
import { PLAYS } from '../plays/library';
import { bestAssignment, withSimulation } from '../plays/recommend';
import { redAt, simulateDefense } from '../sim/defenseSim';
import { evaluate } from '../sim/evaluate';
import { createDefaultTactic } from './defaults';
import { clearRedPaths, freezeDefenseAsPaths, insertFrameAfter, syncFrames } from './frames';
import { putPath } from './paths';
import { decodeShare, encodeShare, fromJsonFile, parseTactic, toJsonFile } from './serialize';
import { authoredSignature } from './store';
import type { Tactic } from './types';

const roles = { A: 'b1', B: 'b2', C: 'b3' } as const;
const play = PLAYS.find((p) => p.category === '高位擋拆' && p.name === 'Pick and Roll')!;
const REDS = ['r1', 'r2', 'r3'];
const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

/** 關閉自動防守、兩個分鏡：1 號往右運球，紅 1 畫一條跑位跟過去 */
function manualTactic(): Tactic {
  const t = createDefaultTactic();
  t.autoDefense = false;
  syncFrames(t, true);
  const f0 = t.frames[0]!;
  putPath(f0, { id: 'd', kind: 'dribble', actorId: 'b1', points: [f0.start.b1!, { x: 3, y: 7 }], freehand: false });
  putPath(f0, { id: 'r', kind: 'cut', actorId: 'r1', points: [f0.start.r1!, { x: 2.6, y: 5.6 }], freehand: false });
  insertFrameAfter(t, 0);
  syncFrames(t, true);
  return t;
}

describe('關閉自動防守跑位：紅隊用跑位路線移動', () => {
  it('下一個分鏡的紅隊位置由紅隊跑位的終點推算；沒畫路線的留在原地', () => {
    const t = manualTactic();
    expect(t.frames[1]!.start.r1).toEqual({ x: 2.6, y: 5.6 });
    expect(t.frames[1]!.start.r2).toEqual(t.frames[0]!.start.r2);
  });

  it('第 1 個分鏡拖過的紅隊位置在重新推算後保留', () => {
    const t = manualTactic();
    t.redStarts = { r2: { x: -4, y: 6 } };
    syncFrames(t, true);
    expect(t.frames[0]!.start.r2).toEqual({ x: -4, y: 6 });
    expect(t.frames[1]!.start.r2).toEqual({ x: -4, y: 6 });
  });

  it('播放：紅隊沿著路線、依自己的速度移動；不模擬掩護、換防', () => {
    const t = manualTactic();
    const tl = buildTimeline(t);
    const res = simulateDefense(t, tl);
    expect(res.events).toEqual([]);
    const f0 = tl.frames[0]!;
    expect(f0.tracks.has('r1')).toBe(true);
    expect(redAt(res, 0).positions.r1).toEqual(t.frames[0]!.start.r1);
    expect(dist(redAt(res, f0.start + f0.duration).positions.r1!, { x: 2.6, y: 5.6 })).toBeLessThan(0.05);
    // 沒畫路線的紅 2 一直站著
    expect(redAt(res, tl.total).positions.r2).toEqual(t.frames[0]!.start.r2);
  });

  it('紅隊路線比較長時，分鏡跟著拉長', () => {
    const t = manualTactic();
    const short = buildTimeline(t).frames[0]!.duration;
    const f0 = t.frames[0]!;
    putPath(f0, { id: 'r', kind: 'cut', actorId: 'r1', points: [f0.start.r1!, { x: -6, y: 1.5 }], freehand: false });
    syncFrames(t, true);
    expect(buildTimeline(t).frames[0]!.duration).toBeGreaterThan(short);
  });

  it('啟用自動防守時，紅隊路線不影響時間軸（防守由模擬決定）', () => {
    const t = manualTactic();
    t.autoDefense = true;
    expect(buildTimeline(t).frames[0]!.tracks.has('r1')).toBe(false);
  });

  it('從啟用改成關閉：自動模擬的紅隊移動變成紅隊跑位，每個分鏡的位置不變；改回啟用時移除', () => {
    const t = loadPlay(createDefaultTactic(), play, roles);
    const before = t.frames.map((f) => ({ ...f.start }));
    freezeDefenseAsPaths(t);
    t.autoDefense = false;
    syncFrames(t, true);
    expect(t.frames.some((f) => f.paths.some((p) => REDS.includes(p.actorId) && p.kind === 'cut'))).toBe(true);
    t.frames.forEach((f, i) => {
      for (const r of REDS) expect(dist(f.start[r]!, before[i]![r]!)).toBeLessThan(0.31);
    });
    clearRedPaths(t);
    expect(t.frames.every((f) => f.paths.every((p) => !REDS.includes(p.actorId)))).toBe(true);
  });

  it('關閉時載入內建戰術：紅隊跑位以自動模擬為起點，仍然維持關閉', () => {
    const base = createDefaultTactic();
    const auto = loadPlay(base, play, roles);
    base.autoDefense = false;
    const manual = loadPlay(base, play, roles);
    expect(manual.autoDefense).toBe(false);
    expect(manual.frames[0]!.paths.some((p) => REDS.includes(p.actorId))).toBe(true);
    manual.frames.forEach((f, i) => {
      for (const r of REDS) expect(dist(f.start[r]!, auto.frames[i]!.start[r]!)).toBeLessThan(0.31);
    });
  });

  it('推薦一律用自動防守評分，關閉時預期評等和啟用時相同', () => {
    const base = createDefaultTactic();
    const auto = withSimulation(base, bestAssignment(base, play));
    const manual = withSimulation({ ...base, autoDefense: false }, bestAssignment(base, play));
    expect(manual.expectedPoints).toBe(auto.expectedPoints);
  });

  it('評分用紅隊實際的位置：紅隊都站在遠處、不跑位時，出手是空檔', () => {
    const t = loadPlay(createDefaultTactic(), play, roles);
    t.autoDefense = false;
    clearRedPaths(t);
    t.redStarts = { r1: { x: -7, y: 13 }, r2: { x: 0, y: 13.5 }, r3: { x: 7, y: 13 } };
    syncFrames(t, true);
    expect(t.frames[0]!.start.r1).toEqual({ x: -7, y: 13 });
    const sim = simulate(t);
    expect(sim.defense.events).toEqual([]);
    const e = evaluate(t, sim);
    expect(e.shot.openness).toBe(1);
    const auto = loadPlay(createDefaultTactic(), play, roles);
    expect(e.expectedPoints!).toBeGreaterThan(evaluate(auto, simulate(auto)).expectedPoints!);
  });

  it('移動紅隊的開局位置算修改；啟用自動防守時紅隊位置不算', () => {
    const t = manualTactic();
    const sig = authoredSignature(t);
    t.redStarts = { r3: { x: 5, y: 5 } };
    expect(authoredSignature(t)).not.toBe(sig);
    t.autoDefense = true;
    const autoSig = authoredSignature(t);
    t.redStarts = { r3: { x: 4, y: 4 } };
    expect(authoredSignature(t)).toBe(autoSig);
  });

  it('JSON 與分享連結保留紅隊開局位置與紅隊路線；啟用自動防守時紅隊路線讀進來會移除', async () => {
    const t = manualTactic();
    t.redStarts = { r3: { x: 4.5, y: 4.5 } };
    syncFrames(t, true);
    const json = fromJsonFile(toJsonFile(t)).tactic;
    expect(json.autoDefense).toBe(false);
    expect(json.frames[0]!.start.r3).toEqual({ x: 4.5, y: 4.5 });
    expect(json.frames[1]!.start.r1).toEqual({ x: 2.6, y: 5.6 });
    const shared = (await decodeShare(await encodeShare(t))).tactic;
    expect(shared.autoDefense).toBe(false);
    expect(shared.frames[0]!.start.r3).toEqual({ x: 4.5, y: 4.5 });
    expect(shared.frames[1]!.start.r1).toEqual({ x: 2.6, y: 5.6 });

    const asAuto = JSON.parse(toJsonFile(t)) as Record<string, unknown>;
    asAuto.autoDefense = true;
    const parsed = parseTactic(asAuto);
    expect(parsed.removed).toBe(1);
    expect(parsed.tactic.frames[0]!.paths.some((p) => p.actorId === 'r1')).toBe(false);

    const old = JSON.parse(toJsonFile(createDefaultTactic())) as Record<string, unknown>;
    delete old.autoDefense;
    expect(parseTactic(old).tactic.autoDefense).toBe(true);
  });

  it('沒拖過的紅隊會依對位重新站位：拖藍隊、改對位、改防守距離都會跟著動；拖過的紅隊固定', () => {
    const t = manualTactic();
    t.redStarts = { r3: { x: 4, y: 4 } };
    syncFrames(t, true);
    const before = { ...t.frames[0]!.start };
    t.frames[0]!.start.b2 = { x: -6.6, y: 1.2 }; // 拖藍 2 到底角
    syncFrames(t, true);
    expect(t.frames[0]!.start.r2).not.toEqual(before.r2); // 紅 2 跟著 2 號走
    expect(t.frames[0]!.start.r3).toEqual({ x: 4, y: 4 }); // 紅 3 拖過，固定
    t.pressure = 'tight';
    const normal = { ...t.frames[0]!.start };
    syncFrames(t, true);
    expect(t.frames[0]!.start.r2).not.toEqual(normal.r2);
  });

  it('只有拖過紅隊時，空白戰術也不算空白（可以清空，讓紅隊回到依對位站位）', async () => {
    const { isBlankTactic } = await import('./lineup');
    const { createBlankTactic } = await import('./defaults');
    const t = createDefaultTactic();
    t.autoDefense = false;
    syncFrames(t, true);
    expect(isBlankTactic(t)).toBe(true);
    t.redStarts = { r1: { x: 1, y: 5 } };
    syncFrames(t, true);
    expect(isBlankTactic(t)).toBe(false);
    const blank = createBlankTactic(t);
    expect(blank.redStarts).toBeUndefined();
    expect(isBlankTactic(blank)).toBe(true);
  });

  it('只切換自動防守開關，內建戰術不會被標成已修改', async () => {
    const { Store } = await import('./store');
    const store = new Store();
    store.load(loadPlay(createDefaultTactic(), play, roles));
    store.commit((s) => {
      s.tactic.autoDefense = true;
      syncFrames(s.tactic, false);
      freezeDefenseAsPaths(s.tactic);
      s.tactic.autoDefense = false;
    });
    expect(store.get().tactic.basedOn!.modified).toBe(false);
    store.commit((s) => {
      clearRedPaths(s.tactic);
      s.tactic.autoDefense = true;
    });
    expect(store.get().tactic.basedOn!.modified).toBe(false);
  });

  it('關閉自動防守時只改對位：紅隊路線換人接手，內建戰術不會被標成已修改（和啟用時一致）', async () => {
    const { Store } = await import('./store');
    const { assignMatchup, setMatchups } = await import('./matchups');
    const base = createDefaultTactic();
    base.autoDefense = false;
    const store = new Store();
    store.load(loadPlay(base, play, roles));
    store.commit((s) => {
      setMatchups(s.tactic, assignMatchup(s.tactic.matchups, 'b1', 'r2'));
    });
    expect(store.get().tactic.matchups.b1).toBe('r2');
    expect(store.get().tactic.basedOn!.modified).toBe(false);
    // 真的改了紅隊路線才算修改
    store.commit((s) => {
      const path = s.tactic.frames[0]!.paths.find((p) => REDS.includes(p.actorId))!;
      path.points = [path.points[0]!, { x: 0, y: 3 }];
    });
    expect(store.get().tactic.basedOn!.modified).toBe(true);
  });

  it('刪掉第 1 個分鏡：紅隊和藍隊一樣，留在原本第 2 個分鏡開始時的位置，路線從那裡出發', async () => {
    const { removeFrame } = await import('./frames');
    const t = manualTactic(); // 紅 1 在第 1 個分鏡跑到 (2.6, 5.6)
    t.redStarts = { r1: t.frames[0]!.start.r1! };
    const f1 = t.frames[1]!;
    putPath(f1, { id: 'r1b', kind: 'cut', actorId: 'r1', points: [f1.start.r1!, { x: 1, y: 3 }], freehand: false });
    syncFrames(t, true);
    const before = { ...t.frames[1]!.start };
    removeFrame(t, 0);
    for (const id of ['b1', 'b2', 'b3', 'r1', 'r2', 'r3']) expect(t.frames[0]!.start[id], id).toEqual(before[id]);
    const tl = buildTimeline(t);
    expect(redAt(simulateDefense(t, tl), 0).positions.r1).toEqual({ x: 2.6, y: 5.6 });
  });

  it('啟用自動防守時刪掉第 1 個分鏡：不記錄紅隊開局位置（由模擬決定）', async () => {
    const { removeFrame } = await import('./frames');
    const t = loadPlay(createDefaultTactic(), play, roles);
    removeFrame(t, 0);
    expect(t.redStarts).toBeUndefined();
  });
});
