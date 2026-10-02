import { describe, expect, it } from 'vitest';
import { createDefaultTactic } from '../model/defaults';
import { BALL_HOLD_OFFSET } from '../model/entities';
import { insertFrameAfter, removeFrame, syncFrames, MAX_FRAMES } from '../model/frames';
import { putPath } from '../model/paths';
import { BASE_SPEED, DEFAULT_HEIGHT, DRIBBLE_FACTOR, PASS_SPEED, heightOf, speedOf } from '../model/physique';
import { EMPTY_FRAME_SECONDS, buildTimeline, poseAt } from './timeline';

describe('速度模型', () => {
  it('預設身高（175）、速度平均 = 基準速度；運球打折', () => {
    const t = createDefaultTactic();
    const b1 = t.players.find((p) => p.id === 'b1')!;
    expect(speedOf(b1, t.players, false)).toBeCloseTo(BASE_SPEED);
    expect(speedOf(b1, t.players, true)).toBeCloseTo(BASE_SPEED * DRIBBLE_FACTOR);
  });

  it('速度能力與身高都有影響，身高影響有上下限', () => {
    const t = createDefaultTactic();
    const b1 = t.players.find((p) => p.id === 'b1')!;
    const fast = { ...b1, skills: { ...b1.skills!, speed: 4 as const } };
    const slow = { ...b1, skills: { ...b1.skills!, speed: 0 as const } };
    expect(speedOf(fast, t.players, false)).toBeCloseTo(BASE_SPEED * 1.1);
    expect(speedOf(slow, t.players, false)).toBeCloseTo(BASE_SPEED * 0.9);
    expect(speedOf({ ...b1, heightCm: 230 }, t.players, false)).toBeCloseTo(BASE_SPEED * 0.92);
    expect(speedOf({ ...b1, heightCm: 145 }, t.players, false)).toBeCloseTo(BASE_SPEED * 1.08);
  });

  it('紅隊速度：五個等級，未填 = 平均', () => {
    const t = createDefaultTactic();
    const r1 = t.players.find((p) => p.id === 'r1')!;
    expect(speedOf(r1, t.players, false)).toBeCloseTo(BASE_SPEED);
    expect(speedOf({ ...r1, speedRating: 4 }, t.players, false)).toBeCloseTo(BASE_SPEED * 1.1);
    expect(speedOf({ ...r1, speedRating: 0 }, t.players, false)).toBeCloseTo(BASE_SPEED * 0.9);
    // 紅隊不受藍隊能力欄位影響
    expect(speedOf({ ...r1, skills: { shooting: 2, speed: 4, finishing: 2, iso: 2 } }, t.players, false)).toBeCloseTo(BASE_SPEED);
  });

  it('紅隊沒填身高時跟藍隊同順序球員一樣', () => {
    const t = createDefaultTactic();
    t.players.find((p) => p.id === 'b2')!.heightCm = 210;
    const r2 = t.players.find((p) => p.id === 'r2')!;
    expect(heightOf(r2, t.players)).toBe(210);
    r2.heightCm = 180;
    expect(heightOf(r2, t.players)).toBe(180);
    expect(heightOf(t.players.find((p) => p.id === 'r1')!, t.players)).toBe(DEFAULT_HEIGHT);
    expect(DEFAULT_HEIGHT).toBe(175);
  });
});

describe('分鏡串接', () => {
  it('新分鏡從上一個分鏡的終點開始，傳球後換人持球', () => {
    const t = createDefaultTactic();
    const f0 = t.frames[0]!;
    putPath(f0, { id: 'c', kind: 'cut', actorId: 'b2', points: [f0.start.b2!, { x: -2, y: 2 }], freehand: false });
    putPath(f0, { id: 'p', kind: 'pass', actorId: 'b1', targetId: 'b2', points: [f0.start.b1!, { x: -2, y: 2 }], freehand: false });
    expect(insertFrameAfter(t, 0)).toBe(1);
    const f1 = t.frames[1]!;
    expect(f1.start.b2).toEqual({ x: -2, y: 2 });
    expect(f1.start.b1).toEqual(f0.start.b1);
    expect(f1.ballHolderId).toBe('b2');
  });

  it('改動前面的分鏡，後面的起始位置跟著更新；不成立的路線被移除', () => {
    const t = createDefaultTactic();
    insertFrameAfter(t, 0);
    const f1 = t.frames[1]!;
    putPath(f1, { id: 'd', kind: 'dribble', actorId: 'b1', points: [f1.start.b1!, { x: 2, y: 4 }], freehand: false });
    // 第 1 個分鏡改成傳球給 b3 → 第 2 個分鏡 b1 已經沒球，運球要移除
    const f0 = t.frames[0]!;
    putPath(f0, { id: 'p', kind: 'pass', actorId: 'b1', targetId: 'b3', points: [f0.start.b1!, f0.start.b3!], freehand: false });
    expect(syncFrames(t, false)).toBe(0);
    expect(t.frames[1]!.paths).toHaveLength(1);
    expect(syncFrames(t, true)).toBe(1);
    expect(t.frames[1]!.ballHolderId).toBe('b3');
    expect(t.frames[1]!.paths).toHaveLength(0);
  });

  it(`最多 ${MAX_FRAMES} 個分鏡，至少 1 個`, () => {
    const t = createDefaultTactic();
    for (let i = 0; i < 20; i++) insertFrameAfter(t, t.frames.length - 1);
    expect(t.frames).toHaveLength(MAX_FRAMES);
    while (t.frames.length > 1) removeFrame(t, 0);
    expect(removeFrame(t, 0)).toBeNull();
  });
});

describe('時間軸', () => {
  it('沒有路線的分鏡停留固定時間', () => {
    const t = createDefaultTactic();
    expect(buildTimeline(t).total).toBeCloseTo(EMPTY_FRAME_SECONDS);
  });

  it('分鏡時長 = 最慢的球員；持球者運球時球跟著走', () => {
    const t = createDefaultTactic();
    const f = t.frames[0]!;
    const b1 = t.players.find((p) => p.id === 'b1')!;
    putPath(f, { id: 'd', kind: 'dribble', actorId: 'b1', points: [{ x: 0, y: 8.6 }, { x: 0, y: 3.6 }], freehand: false });
    const tl = buildTimeline(t);
    const expected = 5 / speedOf(b1, t.players, true);
    expect(tl.total).toBeCloseTo(expected, 3);
    const mid = poseAt(t, tl, expected / 2);
    expect(mid.positions.b1!.y).toBeCloseTo(6.1, 1);
    expect(mid.ball.y).toBeCloseTo(6.1 + BALL_HOLD_OFFSET.y, 1);
  });

  it('傳球在接球者跑到位時剛好抵達', () => {
    const t = createDefaultTactic();
    const f = t.frames[0]!;
    const b2 = t.players.find((p) => p.id === 'b2')!;
    putPath(f, { id: 'c', kind: 'cut', actorId: 'b2', points: [f.start.b2!, { x: -5.4, y: 1.0 }], freehand: false });
    putPath(f, { id: 'p', kind: 'pass', actorId: 'b1', targetId: 'b2', points: [f.start.b1!, { x: -5.4, y: 1 }], freehand: false });
    const tl = buildTimeline(t);
    const run = 5 / speedOf(b2, t.players, false);
    expect(tl.frames[0]!.flight!.launch + tl.frames[0]!.flight!.flight).toBeCloseTo(run, 3);
    expect(tl.total).toBeCloseTo(run, 3);
    // 出手前球在 b1 手上；結束時在 b2 手上
    expect(poseAt(t, tl, 0).ball).toEqual({ x: f.start.b1!.x + BALL_HOLD_OFFSET.x, y: f.start.b1!.y + BALL_HOLD_OFFSET.y });
    const end = poseAt(t, tl, tl.total);
    expect(end.ball.x).toBeCloseTo(-5.4 + BALL_HOLD_OFFSET.x);
    expect(end.ball.y).toBeCloseTo(1 + BALL_HOLD_OFFSET.y);
  });

  it('接球者不動時立刻出手，時長 = 飛行時間', () => {
    const t = createDefaultTactic();
    const f = t.frames[0]!;
    putPath(f, { id: 'p', kind: 'pass', actorId: 'b1', targetId: 'b3', points: [f.start.b1!, f.start.b3!], freehand: false });
    const tl = buildTimeline(t);
    expect(tl.frames[0]!.flight!.launch).toBe(0);
    const d = Math.hypot(f.start.b3!.x - f.start.b1!.x, f.start.b3!.y - f.start.b1!.y);
    expect(tl.total).toBeCloseTo(d / PASS_SPEED, 2);
  });

  it('多個分鏡依序播放', () => {
    const t = createDefaultTactic();
    const f0 = t.frames[0]!;
    putPath(f0, { id: 'c', kind: 'cut', actorId: 'b3', points: [f0.start.b3!, { x: 5.4, y: 1 }], freehand: false });
    insertFrameAfter(t, 0);
    const tl = buildTimeline(t);
    expect(tl.frames[1]!.start).toBeCloseTo(tl.frames[0]!.duration);
    const pose = poseAt(t, tl, tl.frames[0]!.duration + 0.1);
    expect(pose.frameIndex).toBe(1);
    expect(pose.positions.b3).toEqual({ x: 5.4, y: 1 });
  });
});

describe('投籃', () => {
  it('只有持球者、只能在最後一個分鏡', async () => {
    const { cannotStart } = await import('../model/paths');
    const t = createDefaultTactic();
    const f = t.frames[0]!;
    expect(cannotStart('shot', 'b2', f, t.players, true)).toMatch('持球者');
    expect(cannotStart('shot', 'b1', f, t.players, false)).toBe('投籃只能在最後一個分鏡');
    expect(cannotStart('shot', 'b1', f, t.players, true)).toBeNull();
  });

  it('投籃後不能在後面新增分鏡，但可以在前面插入', async () => {
    const { makeShot } = await import('../model/paths');
    const { cannotInsertAfter } = await import('../model/frames');
    const t = createDefaultTactic();
    insertFrameAfter(t, 0);
    const last = t.frames[1]!;
    putPath(last, makeShot('b1', last));
    expect(cannotInsertAfter(t, 1)).toMatch('已經投籃');
    expect(insertFrameAfter(t, 1)).toBeNull();
    expect(insertFrameAfter(t, 0)).toBe(1);
    expect(t.frames).toHaveLength(3);
  });

  it('球沿弧線飛進籃框；出手時間用來比對進攻時限', async () => {
    const { makeShot, RIM } = await import('../model/paths');
    const { MIN_SHOT_FLIGHT } = await import('../model/physique');
    const { possessionSeconds } = await import('./timeline');
    const t = createDefaultTactic();
    const f0 = t.frames[0]!;
    putPath(f0, { id: 'c', kind: 'cut', actorId: 'b2', points: [f0.start.b2!, { x: -5.4, y: 1 }], freehand: false });
    insertFrameAfter(t, 0);
    const f1 = t.frames[1]!;
    putPath(f1, makeShot('b1', f1));
    const tl = buildTimeline(t);
    expect(tl.shotReleaseAt).toBeCloseTo(tl.frames[0]!.duration);
    expect(possessionSeconds(tl)).toBeCloseTo(tl.frames[0]!.duration);
    expect(tl.frames[1]!.duration).toBeGreaterThanOrEqual(MIN_SHOT_FLIGHT);
    const end = poseAt(t, tl, tl.total);
    expect(end.ball.x).toBeCloseTo(RIM.x);
    expect(end.ball.y).toBeCloseTo(RIM.y);
  });

  it('投籃者沒球了，投籃會被移除', async () => {
    const { makeShot } = await import('../model/paths');
    const t = createDefaultTactic();
    insertFrameAfter(t, 0);
    putPath(t.frames[1]!, makeShot('b1', t.frames[1]!));
    const f0 = t.frames[0]!;
    putPath(f0, { id: 'p', kind: 'pass', actorId: 'b1', targetId: 'b2', points: [f0.start.b1!, f0.start.b2!], freehand: false });
    expect(syncFrames(t, true)).toBe(1);
    expect(t.frames[1]!.paths).toHaveLength(0);
  });
});

describe('掩護者先站住再移動', () => {
  it('上一個分鏡掩護的人，下一個分鏡先等 0.5 秒才出發', async () => {
    const { SCREEN_HOLD_SECONDS } = await import('./timeline');
    const t = createDefaultTactic();
    const f0 = t.frames[0]!;
    putPath(f0, { id: 's', kind: 'screen', actorId: 'b3', points: [f0.start.b3!, { x: 1.1, y: 7.1 }], freehand: false });
    insertFrameAfter(t, 0);
    const f1 = t.frames[1]!;
    putPath(f1, { id: 'r', kind: 'cut', actorId: 'b3', points: [f1.start.b3!, { x: 0.4, y: 2.8 }], freehand: false });
    const tl = buildTimeline(t);
    const s1 = tl.frames[1]!.start;
    expect(poseAt(t, tl, s1 + SCREEN_HOLD_SECONDS - 0.01).positions.b3).toEqual({ x: 1.1, y: 7.1 });
    expect(poseAt(t, tl, s1 + SCREEN_HOLD_SECONDS + 0.1).positions.b3!.y).toBeLessThan(7.1);
    const b3 = t.players.find((p) => p.id === 'b3')!;
    const run = Math.hypot(1.1 - 0.4, 7.1 - 2.8) / speedOf(b3, t.players, false);
    expect(tl.frames[1]!.duration).toBeCloseTo(SCREEN_HOLD_SECONDS + run, 3);
  });
});
