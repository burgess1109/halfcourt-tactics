import { describe, expect, it } from 'vitest';
import { createDefaultTactic } from './defaults';
import {
  cannotStart,
  endPosition,
  finalizeDraft,
  pathHandles,
  pruneInvalidPaths,
  putPath,
  resolvePoints,
  type Draft,
} from './paths';
import type { TacticPath } from './types';

const setup = () => {
  const t = createDefaultTactic();
  return { t, f: t.frames[0]!, players: t.players };
};

const ok = (r: ReturnType<typeof finalizeDraft>): TacticPath => {
  if (!('path' in r)) throw new Error(`expected path, got ${r.error}`);
  return r.path;
};

describe('路線規則', () => {
  it('只有持球者可以運球、傳球', () => {
    const { f, players } = setup();
    expect(cannotStart('dribble', 'b2', f, players, true)).toMatch('持球者');
    expect(cannotStart('pass', 'b2', f, players, true)).toMatch('持球者');
    expect(cannotStart('dribble', 'b1', f, players, true)).toBeNull();
    expect(cannotStart('cut', 'b2', f, players, true)).toBeNull();
    expect(cannotStart('screen', 'r1', f, players, true)).toBeNull();
  });

  it('平滑模式只保留起點與終點', () => {
    const { f, players } = setup();
    const draft: Draft = { kind: 'cut', actorId: 'b2', freehand: false, points: [f.start.b2!, { x: -2, y: 2 }] };
    const path = ok(finalizeDraft(draft, f, players));
    expect(path.points).toHaveLength(2);
    expect(path.freehand).toBe(false);
  });

  it('手繪模式會簡化軌跡但保留轉角', () => {
    const { f, players } = setup();
    const start = f.start.b3!;
    const pts = [start];
    for (let i = 1; i <= 20; i++) pts.push({ x: start.x, y: start.y - i * 0.2 }); // 往下 4 m
    for (let i = 1; i <= 20; i++) pts.push({ x: start.x - i * 0.2, y: start.y - 4 }); // 往左 4 m
    const path = ok(finalizeDraft({ kind: 'cut', actorId: 'b3', freehand: true, points: pts }, f, players));
    expect(path.points).toHaveLength(3);
  });

  it('太短的線視為誤觸，不提示', () => {
    const { f, players } = setup();
    const r = finalizeDraft(
      { kind: 'cut', actorId: 'b2', freehand: false, points: [f.start.b2!, { x: f.start.b2!.x + 0.3, y: f.start.b2!.y }] },
      f,
      players,
    );
    expect(r).toEqual({ error: null });
  });

  it('傳球要放在隊友附近，不能傳給對手', () => {
    const { f, players } = setup();
    const toMate = finalizeDraft({ kind: 'pass', actorId: 'b1', freehand: false, points: [f.start.b1!, { x: -5, y: 6.3 }] }, f, players);
    expect(ok(toMate).targetId).toBe('b2');
    const toRival = finalizeDraft({ kind: 'pass', actorId: 'b1', freehand: false, points: [f.start.b1!, f.start.r1!] }, f, players);
    expect(toRival).toEqual({ error: '傳球要拉到隊友身上' });
  });

  it('傳球指向隊友跑位後的位置', () => {
    const { f, players } = setup();
    putPath(f, { id: 'c', kind: 'cut', actorId: 'b2', points: [f.start.b2!, { x: -2, y: 1.5 }], freehand: false });
    const pass = ok(finalizeDraft({ kind: 'pass', actorId: 'b1', freehand: false, points: [f.start.b1!, { x: -2.3, y: 1.8 }] }, f, players));
    expect(pass.targetId).toBe('b2');
    putPath(f, pass);
    expect(resolvePoints(f, pass).at(-1)).toEqual({ x: -2, y: 1.5 });
    // 隊友改跑別的地方，傳球終點跟著變
    putPath(f, { id: 'c2', kind: 'cut', actorId: 'b2', points: [f.start.b2!, { x: -6, y: 1 }], freehand: false });
    expect(resolvePoints(f, pass).at(-1)).toEqual({ x: -6, y: 1 });
  });

  it('每位球員只有一條路線；起點跟著球員', () => {
    const { f } = setup();
    putPath(f, { id: 'a', kind: 'cut', actorId: 'b2', points: [f.start.b2!, { x: 0, y: 3 }], freehand: false });
    putPath(f, { id: 'b', kind: 'screen', actorId: 'b2', points: [f.start.b2!, { x: -1, y: 7 }], freehand: false });
    expect(f.paths.map((p) => p.id)).toEqual(['b']);
    f.start.b2 = { x: -6, y: 8 };
    expect(resolvePoints(f, f.paths[0]!)[0]).toEqual({ x: -6, y: 8 });
    expect(endPosition(f, 'b2')).toEqual({ x: -1, y: 7 });
  });

  it('球換人後，舊持球者的運球與傳球會被移除', () => {
    const { f, players } = setup();
    putPath(f, { id: 'd', kind: 'dribble', actorId: 'b1', points: [f.start.b1!, { x: 2, y: 5 }], freehand: false });
    putPath(f, { id: 'c', kind: 'cut', actorId: 'b3', points: [f.start.b3!, { x: 2, y: 2 }], freehand: false });
    f.ballHolderId = 'b2';
    expect(pruneInvalidPaths(f, players)).toBe(1);
    expect(f.paths.map((p) => p.id)).toEqual(['c']);
  });

  it('把手：起點不可編輯；傳球終點不可編輯', () => {
    const { f } = setup();
    const cut: TacticPath = { id: 'c', kind: 'cut', actorId: 'b2', points: [f.start.b2!, { x: -3, y: 3 }, { x: 0, y: 2 }], freehand: false };
    const h = pathHandles(f, cut);
    expect(h.filter((x) => x.type === 'point').map((x) => x.index)).toEqual([1, 2]);
    expect(h.filter((x) => x.type === 'insert')).toHaveLength(2);
    const pass: TacticPath = { id: 'p', kind: 'pass', actorId: 'b1', targetId: 'b3', points: [f.start.b1!, f.start.b3!], freehand: false };
    expect(pathHandles(f, pass).filter((x) => x.type === 'point')).toHaveLength(0);
  });
});

describe('投籃弧線', () => {
  it('左右兩個底角出手，弧線都往中場鼓起', async () => {
    const { shotControls, RIM } = await import('./paths');
    for (const x of [-6.6, 6.6]) {
      const mid = shotControls({ x, y: 1 })[1]!;
      expect(mid.y).toBeGreaterThan((1 + RIM.y) / 2);
    }
  });
});
