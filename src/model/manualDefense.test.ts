import { describe, expect, it } from 'vitest';
import { simulate } from '../anim/simulation';
import { buildTimeline } from '../anim/timeline';
import { loadPlay } from '../plays/instantiate';
import { PLAYS } from '../plays/library';
import { bestAssignment, withSimulation } from '../plays/recommend';
import { redAt, simulateDefense } from '../sim/defenseSim';
import { evaluate } from '../sim/evaluate';
import { createDefaultTactic } from './defaults';
import { insertFrameAfter, syncFrames } from './frames';
import { putPath } from './paths';
import { decodeShare, encodeShare, fromJsonFile, parseTactic, toJsonFile } from './serialize';
import { authoredSignature } from './store';
import type { Tactic } from './types';

const roles = { A: 'b1', B: 'b2', C: 'b3' } as const;
const play = PLAYS.find((p) => p.category === '高位擋拆' && p.name === 'Pick and Roll')!;

/** 關閉自動防守、有兩個分鏡（1 號往右運球）的戰術 */
function manualTactic(): Tactic {
  const t = createDefaultTactic();
  t.autoDefense = false;
  const f0 = t.frames[0]!;
  putPath(f0, { id: 'd', kind: 'dribble', actorId: 'b1', points: [f0.start.b1!, { x: 3, y: 7 }], freehand: false });
  insertFrameAfter(t, 0);
  syncFrames(t, true);
  return t;
}

describe('關閉自動防守跑位', () => {
  it('新增的分鏡沿用上一個分鏡的紅隊位置；拖過的位置在重新推算後保留，各分鏡互不影響', () => {
    const t = manualTactic();
    expect(t.frames[1]!.start.r1).toEqual(t.frames[0]!.start.r1);
    t.frames[1]!.start.r1 = { x: 2, y: 6 };
    t.frames[0]!.start.r2 = { x: -4, y: 6 };
    syncFrames(t, true);
    expect(t.frames[1]!.start.r1).toEqual({ x: 2, y: 6 });
    expect(t.frames[0]!.start.r2).toEqual({ x: -4, y: 6 });
    expect(t.frames[1]!.start.r2).not.toEqual({ x: -4, y: 6 });
  });

  it('播放：紅隊在分鏡之間直線移動，最後一個分鏡停在原地；不模擬掩護、換防', () => {
    const t = manualTactic();
    const from = t.frames[0]!.start.r1!;
    t.frames[1]!.start.r1 = { x: from.x + 2, y: from.y - 1 };
    const tl = buildTimeline(t);
    const res = simulateDefense(t, tl);
    expect(res.events).toEqual([]);
    const f0 = tl.frames[0]!;
    expect(redAt(res, 0).positions.r1).toEqual(from);
    const mid = redAt(res, f0.start + f0.duration / 2).positions.r1!;
    expect(mid.x).toBeCloseTo(from.x + 1, 1);
    expect(mid.y).toBeCloseTo(from.y - 0.5, 1);
    expect(redAt(res, tl.total).positions.r1).toEqual(t.frames[1]!.start.r1);
  });

  it('從啟用改成關閉：目前自動模擬的位置就是起點', () => {
    const t = loadPlay(createDefaultTactic(), play, roles);
    const before = t.frames.map((f) => ({ ...f.start }));
    t.autoDefense = false;
    syncFrames(t, true);
    t.frames.forEach((f, i) => {
      for (const r of ['r1', 'r2', 'r3']) expect(f.start[r]).toEqual(before[i]![r]);
    });
  });

  it('關閉時載入內建戰術：每個分鏡的紅隊位置以自動模擬為起點，仍然維持關閉', () => {
    const base = createDefaultTactic();
    const auto = loadPlay(base, play, roles);
    base.autoDefense = false;
    const manual = loadPlay(base, play, roles);
    expect(manual.autoDefense).toBe(false);
    manual.frames.forEach((f, i) => {
      for (const r of ['r1', 'r2', 'r3']) expect(f.start[r]).toEqual(auto.frames[i]!.start[r]);
    });
  });

  it('推薦一律用自動防守評分，關閉時預期評等和啟用時相同', () => {
    const base = createDefaultTactic();
    const auto = withSimulation(base, bestAssignment(base, play));
    const manual = withSimulation({ ...base, autoDefense: false }, bestAssignment(base, play));
    expect(manual.expectedPoints).toBe(auto.expectedPoints);
  });

  it('評分用使用者擺的紅隊位置：紅隊都站在遠處時，出手是空檔', () => {
    const t = loadPlay(createDefaultTactic(), play, roles);
    t.autoDefense = false;
    for (const f of t.frames) {
      f.start.r1 = { x: -7, y: 13 };
      f.start.r2 = { x: 0, y: 13.5 };
      f.start.r3 = { x: 7, y: 13 };
    }
    syncFrames(t, true);
    const sim = simulate(t);
    expect(sim.defense.events).toEqual([]);
    const e = evaluate(t, sim);
    expect(e.shot.openness).toBe(1);
    // 自動防守時同一套戰術沒有這麼空
    const auto = loadPlay(createDefaultTactic(), play, roles);
    expect(e.expectedPoints!).toBeGreaterThan(evaluate(auto, simulate(auto)).expectedPoints!);
  });

  it('拖曳紅隊算修改（內建戰術會標示已修改）', () => {
    const t = manualTactic();
    const sig = authoredSignature(t);
    t.frames[1]!.start.r3 = { x: 5, y: 5 };
    expect(authoredSignature(t)).not.toBe(sig);
    t.autoDefense = true;
    const autoSig = authoredSignature(t);
    t.frames[1]!.start.r3 = { x: 4, y: 4 };
    expect(authoredSignature(t)).toBe(autoSig); // 啟用時紅隊位置是自動算的，不算使用者修改
  });

  it('JSON 與分享連結會保留每個分鏡的紅隊位置；舊資料沒有這個欄位時當作啟用', async () => {
    const t = manualTactic();
    t.frames[1]!.start.r1 = { x: 2.34, y: 6.78 };
    t.frames[0]!.start.r3 = { x: 4.5, y: 4.5 };
    syncFrames(t, true);
    const json = fromJsonFile(toJsonFile(t)).tactic;
    expect(json.autoDefense).toBe(false);
    expect(json.frames[1]!.start.r1).toEqual({ x: 2.34, y: 6.78 });
    expect(json.frames[0]!.start.r3).toEqual({ x: 4.5, y: 4.5 });
    const shared = (await decodeShare(await encodeShare(t))).tactic;
    expect(shared.autoDefense).toBe(false);
    expect(shared.frames[1]!.start.r1).toEqual({ x: 2.34, y: 6.78 });
    expect(shared.frames[0]!.start.r3).toEqual({ x: 4.5, y: 4.5 });

    const old = JSON.parse(toJsonFile(createDefaultTactic())) as Record<string, unknown>;
    delete old.autoDefense;
    expect(parseTactic(old).tactic.autoDefense).toBe(true);
  });
});
