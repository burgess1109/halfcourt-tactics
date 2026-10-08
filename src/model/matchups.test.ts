import { describe, expect, it } from 'vitest';
import { defendPosition, guardPosition } from '../sim/defense';
import { MIN_GAP, OFF_BALL_GAP, ON_BALL_GAP } from '../sim/config';
import { createDefaultTactic } from './defaults';
import { insertFrameAfter, syncFrames } from './frames';
import { assignMatchup, defaultMatchups, setMatchups } from './matchups';
import { RIM, putPath } from './paths';

describe('預設對位', () => {
  it('藍隊沒有全填身高 → 依順序', () => {
    const t = createDefaultTactic();
    t.players.find((p) => p.id === 'b1')!.heightCm = 210;
    expect(defaultMatchups(t.players)).toEqual({ b1: 'r1', b2: 'r2', b3: 'r3' });
  });

  it('藍隊都有身高 → 最高對最高', () => {
    const t = createDefaultTactic();
    const h = { b1: 185, b2: 205, b3: 195, r1: 200, r2: 190, r3: 210 };
    for (const p of t.players) p.heightCm = h[p.id as keyof typeof h];
    expect(defaultMatchups(t.players)).toEqual({ b2: 'r3', b3: 'r1', b1: 'r2' });
  });

  it('紅隊沒填身高時，用跟藍隊一樣的身高排序', () => {
    const t = createDefaultTactic();
    const h = { b1: 185, b2: 205, b3: 195 };
    for (const p of t.players) if (p.team === 'blue') p.heightCm = h[p.id as keyof typeof h];
    expect(defaultMatchups(t.players)).toEqual({ b1: 'r1', b2: 'r2', b3: 'r3' });
  });

  it('改對位時，兩組交換', () => {
    expect(assignMatchup({ b1: 'r1', b2: 'r2', b3: 'r3' }, 'b1', 'r3')).toEqual({ b1: 'r3', b2: 'r2', b3: 'r1' });
    expect(assignMatchup({ b1: 'r1', b2: 'r2', b3: 'r3' }, 'b2', 'r2')).toEqual({ b1: 'r1', b2: 'r2', b3: 'r3' });
  });
});

describe('紅隊站位', () => {
  it('站在對位者與籃框的連線上；持球者貼得比較近', () => {
    const man = { x: 0, y: 8.575 }; // 正對籃框，距離 7 m
    expect(guardPosition(man, true).y).toBeCloseTo(man.y - ON_BALL_GAP);
    expect(guardPosition(man, false).y).toBeCloseTo(man.y - OFF_BALL_GAP);
    expect(guardPosition(man, false).x).toBeCloseTo(0);
  });

  it('對位者靠近籃框時退到兩人中間，但至少保持 MIN_GAP 避免圓標重疊', () => {
    expect(guardPosition({ x: 0, y: RIM.y + 3.6 }, false).y).toBeCloseTo(RIM.y + 1.8);
    expect(guardPosition({ x: 0, y: RIM.y + 1 }, false).y).toBeCloseTo(RIM.y + 1 - MIN_GAP);
  });

  it('每個分鏡都依對位放好紅隊，跟著對位者跑位後的位置', () => {
    const t = createDefaultTactic();
    const f0 = t.frames[0]!;
    putPath(f0, { id: 'c', kind: 'cut', actorId: 'b2', points: [f0.start.b2!, { x: -6.6, y: 1 }], freehand: false });
    insertFrameAfter(t, 0);
    syncFrames(t, true);
    expect(t.frames[0]!.start.r2).toEqual(defendPosition(f0.start.b2!, f0.start.b1!, false));
    expect(t.frames[0]!.start.r1).toEqual(guardPosition(f0.start.b1!, true));
    // 第 2 個分鏡：紅 2 追著跑，但有反應時間，還沒完全到位
    const ideal = guardPosition({ x: -6.6, y: 1 }, false);
    const r2 = t.frames[1]!.start.r2!;
    const before = Math.hypot(f0.start.r2!.x - ideal.x, f0.start.r2!.y - ideal.y);
    const after = Math.hypot(r2.x - ideal.x, r2.y - ideal.y);
    expect(after).toBeGreaterThan(0.1);
    expect(after).toBeLessThan(before / 2);
  });

  it('改對位後紅隊換人盯', () => {
    const t = createDefaultTactic();
    t.matchups = assignMatchup(t.matchups, 'b1', 'r3');
    syncFrames(t, false);
    const f = t.frames[0]!;
    expect(f.start.r3).toEqual(guardPosition(f.start.b1!, true));
    expect(f.start.r1).toEqual(defendPosition(f.start.b3!, f.start.b1!, false));
  });
});

describe('setMatchups', () => {
  it('對位內容相同（只是欄位順序不同）時，保留手動防守拖過的紅隊位置', () => {
    const t = createDefaultTactic();
    t.matchups = { b1: 'r1', b2: 'r2', b3: 'r3' };
    t.redStarts = { r1: { x: 1, y: 5 } };
    setMatchups(t, { b3: 'r3', b1: 'r1', b2: 'r2' });
    expect(t.redStarts).toEqual({ r1: { x: 1, y: 5 } });
  });

  it('對位真的改了才清掉', () => {
    const t = createDefaultTactic();
    t.matchups = { b1: 'r1', b2: 'r2', b3: 'r3' };
    t.redStarts = { r1: { x: 1, y: 5 } };
    setMatchups(t, { b1: 'r2', b2: 'r1', b3: 'r3' });
    expect(t.redStarts).toBeUndefined();
    expect(t.matchups).toEqual({ b1: 'r2', b2: 'r1', b3: 'r3' });
  });
});

describe('關閉自動防守時改對位：紅隊路線跟著對位走', () => {
  it('紅 1、紅 2 交換對位後，原本跟著 1 號跑的路線改由紅 2 接手；播放與評分的對位一致', async () => {
    const { loadPlay } = await import('../plays/instantiate');
    const { PLAYS } = await import('../plays/library');
    const { syncFrames } = await import('./frames');
    const { simulate } = await import('../anim/simulation');
    const base = createDefaultTactic();
    base.autoDefense = false;
    const t = loadPlay(base, PLAYS.find((p) => p.category === 'high-pnr' && p.name === 'Pick and Roll')!, { A: 'b1', B: 'b2', C: 'b3' });
    // 每個分鏡：紅隊在分鏡結束時離自己盯的人多遠
    const gaps = () =>
      t.frames.slice(1).flatMap((f) => Object.entries(t.matchups).map(([b, r]) => Math.hypot(f.start[r]!.x - f.start[b]!.x, f.start[r]!.y - f.start[b]!.y)));
    const before = gaps();
    const r1Paths = t.frames.map((f) => f.paths.filter((p) => p.actorId === 'r1').length);
    setMatchups(t, assignMatchup(t.matchups, 'b1', 'r2'));
    syncFrames(t, true);
    expect(t.frames.map((f) => f.paths.filter((p) => p.actorId === 'r2').length)).toEqual(r1Paths);
    // 交換後每位紅隊仍然跟在自己盯的人身邊（和交換前一樣近），不會斜跨半場跑回舊對位的人
    gaps().forEach((g, i) => expect(g).toBeCloseTo(before[i]!, 0));
    expect(simulate(t).defense.finalAssignments).toEqual({ r2: 'b1', r1: 'b2', r3: 'b3' });
  });
});
