import { describe, expect, it } from 'vitest';
import { createDefaultTactic } from './defaults';
import {
  BALL_HOLD_OFFSET,
  PLAYER_RADIUS,
  ballPosition,
  clampToView,
  findSnapTarget,
  hitTest,
} from './entities';
import { VIEW_BOUNDS } from '../court/fiba';
import { BALL_ID } from './types';

describe('球與球員', () => {
  it('預設有 3 藍 3 紅，藍隊 1 號持球', () => {
    const t = createDefaultTactic();
    expect(t.players.filter((p) => p.team === 'blue')).toHaveLength(3);
    expect(t.players.filter((p) => p.team === 'red')).toHaveLength(3);
    expect(t.frames[0]!.ballHolderId).toBe('b1');
  });

  it('持球時，球跟著持球者', () => {
    const t = createDefaultTactic();
    const f = t.frames[0]!;
    f.start.b1 = { x: 2, y: 3 };
    expect(ballPosition(f)).toEqual({ x: 2 + BALL_HOLD_OFFSET.x, y: 3 + BALL_HOLD_OFFSET.y });
  });

  it('沒有持球者時，使用球自己的位置', () => {
    const t = createDefaultTactic();
    const f = t.frames[0]!;
    f.ballHolderId = null;
    f.start[BALL_ID] = { x: 1, y: 1 };
    expect(ballPosition(f)).toEqual({ x: 1, y: 1 });
  });

  it('放開時吸附到範圍內最近的球員，太遠則不吸附', () => {
    const t = createDefaultTactic();
    const f = t.frames[0]!;
    const b2 = f.start.b2!;
    expect(findSnapTarget({ x: b2.x - PLAYER_RADIUS - 0.5, y: b2.y }, t.players, f)).toBe('b2');
    expect(findSnapTarget({ x: b2.x - PLAYER_RADIUS - 0.7, y: b2.y }, t.players, f)).toBeNull();
  });

  it('點擊測試：球優先於球員', () => {
    const t = createDefaultTactic();
    const f = t.frames[0]!;
    expect(hitTest(ballPosition(f), t.players, f)).toBe(BALL_ID);
    expect(hitTest(f.start.r2!, t.players, f)).toBe('r2');
    expect(hitTest({ x: 0, y: 13 }, t.players, f)).toBeNull();
  });

  it('拖曳位置限制在可視範圍內', () => {
    const p = clampToView({ x: 100, y: -100 }, PLAYER_RADIUS);
    expect(p.x).toBeCloseTo(VIEW_BOUNDS.maxX - PLAYER_RADIUS);
    expect(p.y).toBeCloseTo(VIEW_BOUNDS.minY + PLAYER_RADIUS);
  });
});
