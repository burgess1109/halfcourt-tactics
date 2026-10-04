import { BALL_HOLD_OFFSET, ballPosition } from './entities';
import { buildTimeline } from '../anim/timeline';
import { defendPosition } from '../sim/defense';
import { redAt, simulateDefense } from '../sim/defenseSim';
import { RIM, endPosition, hasShot, pathOf, pruneInvalidPaths } from './paths';
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
  if (pass?.kind === 'shot') {
    // 投籃後球在籃框，沒有人持球（只會出現在最後一個分鏡）
    start[BALL_ID] = { ...RIM };
    return { start, ballHolderId: null };
  }
  const ballHolderId = pass?.kind === 'pass' && pass.targetId ? pass.targetId : holder;
  const holderPos = ballHolderId ? start[ballHolderId] : undefined;
  start[BALL_ID] = holderPos
    ? { x: holderPos.x + BALL_HOLD_OFFSET.x, y: holderPos.y + BALL_HOLD_OFFSET.y }
    : { ...ballPosition(frame) };
  return { start, ballHolderId };
}

/** 紅隊站到各自的防守位置（SPEC §6.2，含阻絕）；用於第 1 個分鏡 */
function placeDefenders(tactic: Tactic, frame: Frame): void {
  for (const [blueId, redId] of Object.entries(tactic.matchups)) {
    const man = frame.start[blueId];
    const ball = frame.ballHolderId ? (frame.start[frame.ballHolderId] ?? null) : null;
    if (man) frame.start[redId] = defendPosition(man, ball, frame.ballHolderId === blueId, false, tactic.pressure);
  }
}

/**
 * 依第 1 個分鏡重新推算後面所有分鏡的起始狀態，並放好紅隊。
 * prune = true 時，一併移除不再成立的路線（例如球換人之後的運球），回傳移除數量。
 * 拖曳中不要 prune：球暫時離手時，不應該把後面的傳球刪掉。
 */
export function syncFrames(tactic: Tactic, prune: boolean, opts: { defense?: boolean } = {}): number {
  let removed = 0;
  tactic.frames.forEach((frame, i) => {
    if (i > 0) {
      const prev = endState(tactic.frames[i - 1]!);
      frame.start = prev.start;
      frame.ballHolderId = prev.ballHolderId;
    }
    placeDefenders(tactic, frame);
    if (prune) removed += pruneInvalidPaths(frame, tactic.players);
  });

  // 之後的分鏡：紅隊在防守 AI 模擬中、該分鏡開始時的實際位置（可能被甩開或被掩護卡住）。
  // defense: false 時跳過（例如一次建好多個分鏡時，只在最後算一次）
  if (tactic.frames.length > 1 && opts.defense !== false) {
    const timeline = buildTimeline(tactic);
    const red = simulateDefense(tactic, timeline);
    tactic.frames.forEach((frame, i) => {
      if (i === 0) return;
      Object.assign(frame.start, redAt(red, timeline.frames[i]!.start).positions);
    });
  }
  return removed;
}

/** 為什麼不能在 index 後面新增分鏡；可以則回傳 null */
export function cannotInsertAfter(tactic: Tactic, index: number): string | null {
  if (tactic.frames.length >= MAX_FRAMES) return `最多 ${MAX_FRAMES} 個分鏡`;
  // 投籃只能在最後一個分鏡，所以不能在投籃後面再加
  if (index === tactic.frames.length - 1 && hasShot(tactic.frames[index]!)) {
    return '已經投籃，回合結束；要新增分鏡請先刪除投籃';
  }
  return null;
}

/** 在 index 後面插入新分鏡，回傳新分鏡的 index；不能插入則回傳 null */
export function insertFrameAfter(tactic: Tactic, index: number, opts: { defense?: boolean } = {}): number | null {
  if (cannotInsertAfter(tactic, index)) return null;
  const { start, ballHolderId } = endState(tactic.frames[index]!);
  tactic.frames.splice(index + 1, 0, { start, ballHolderId, paths: [] });
  syncFrames(tactic, true, opts);
  return index + 1;
}

/** 刪除分鏡；只剩一個時不能刪。回傳刪除後應該顯示的 index。 */
export function removeFrame(tactic: Tactic, index: number): number | null {
  if (tactic.frames.length <= 1) return null;
  tactic.frames.splice(index, 1);
  syncFrames(tactic, true);
  return Math.min(index, tactic.frames.length - 1);
}
