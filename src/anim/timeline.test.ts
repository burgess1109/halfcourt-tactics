import { describe, expect, it } from 'vitest';
import { createDefaultTactic } from '../model/defaults';
import { BALL_HOLD_OFFSET } from '../model/entities';
import { insertFrameAfter, removeFrame, syncFrames, MAX_FRAMES } from '../model/frames';
import { putPath } from '../model/paths';
import { BASE_SPEED, DRIBBLE_FACTOR, PASS_SPEED, speedOf } from '../model/physique';
import { EMPTY_FRAME_SECONDS, buildTimeline, poseAt } from './timeline';

describe('速度模型', () => {
  it('未填身高體重時，依位置套用預設值', () => {
    const t = createDefaultTactic();
    const p = { ...t.players[0]! };
    const none = speedOf(p, false); // 198 cm / 95 kg
    expect(none).toBeCloseTo(BASE_SPEED * (1 - 0.004 * 3 - 0.003 * 5));
    expect(speedOf({ ...p, position: 'PG' }, false)).toBeGreaterThan(speedOf({ ...p, position: 'C' }, false));
    expect(speedOf(p, true)).toBeCloseTo(none * DRIBBLE_FACTOR);
  });

  it('速度係數限制在 0.85–1.15', () => {
    const t = createDefaultTactic();
    const p = t.players[0]!;
    expect(speedOf({ ...p, heightCm: 230, weightKg: 150 }, false)).toBeCloseTo(BASE_SPEED * 0.85);
    expect(speedOf({ ...p, heightCm: 150, weightKg: 50 }, false)).toBeCloseTo(BASE_SPEED * 1.15);
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
    const expected = 5 / speedOf(b1, true);
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
    const run = 5 / speedOf(b2, false);
    expect(tl.frames[0]!.pass!.launch + tl.frames[0]!.pass!.flight).toBeCloseTo(run, 3);
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
    expect(tl.frames[0]!.pass!.launch).toBe(0);
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
