import { BALL_HOLD_OFFSET, ballPosition } from './entities';
import { endPosition, pathOf, pruneInvalidPaths } from './paths';
import { BALL_ID, type Frame, type Tactic, type Vec2 } from './types';

// 分鏡串接，對應 SPEC §5：下一個分鏡的起始狀態 = 上一個分鏡結束時的狀態。

export const MAX_FRAMES = 12;

/** 分鏡結束時的狀態：球員在路線終點；有傳球時球在接球者手上 */
export function endState(frame: Frame): { start: Record<string, Vec2>; ballHolderId: string | null } {
  const start: Record<string, Vec2> = {};
  for (const id of Object.keys(frame.start)) {
    if (id === BALL_ID) continue;
    start[id] = { ...endPosition(frame, id)! };
  }
  const holder = frame.ballHolderId;
  const pass = holder ? pathOf(frame, holder) : undefined;
  const ballHolderId = pass?.kind === 'pass' && pass.targetId ? pass.targetId : holder;
  const holderPos = ballHolderId ? start[ballHolderId] : undefined;
  start[BALL_ID] = holderPos
    ? { x: holderPos.x + BALL_HOLD_OFFSET.x, y: holderPos.y + BALL_HOLD_OFFSET.y }
    : { ...ballPosition(frame) };
  return { start, ballHolderId };
}

/**
 * 依第 1 個分鏡重新推算後面所有分鏡的起始狀態。
 * prune = true 時，一併移除不再成立的路線（例如球換人之後的運球），回傳移除數量。
 * 拖曳中不要 prune：球暫時離手時，不應該把後面的傳球刪掉。
 */
export function syncFrames(tactic: Tactic, prune: boolean): number {
  let removed = 0;
  tactic.frames.forEach((frame, i) => {
    if (i > 0) {
      const prev = endState(tactic.frames[i - 1]!);
      frame.start = prev.start;
      frame.ballHolderId = prev.ballHolderId;
    }
    if (prune) removed += pruneInvalidPaths(frame, tactic.players);
  });
  return removed;
}

/** 在 index 後面插入新分鏡，回傳新分鏡的 index；已達上限則回傳 null */
export function insertFrameAfter(tactic: Tactic, index: number): number | null {
  if (tactic.frames.length >= MAX_FRAMES) return null;
  const { start, ballHolderId } = endState(tactic.frames[index]!);
  tactic.frames.splice(index + 1, 0, { start, ballHolderId, paths: [] });
  syncFrames(tactic, true);
  return index + 1;
}

/** 刪除分鏡；只剩一個時不能刪。回傳刪除後應該顯示的 index。 */
export function removeFrame(tactic: Tactic, index: number): number | null {
  if (tactic.frames.length <= 1) return null;
  tactic.frames.splice(index, 1);
  syncFrames(tactic, true);
  return Math.min(index, tactic.frames.length - 1);
}
