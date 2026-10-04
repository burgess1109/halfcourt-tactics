import { BALL_HOLD_OFFSET, ballPosition } from './entities';
import { buildTimeline } from '../anim/timeline';
import { MIN_RED_PATH } from '../sim/config';
import { defendPosition } from '../sim/defense';
import { redAt, simulateDefense } from '../sim/defenseSim';
import { RIM, endPosition, hasShot, pathOf, pruneInvalidPaths } from './paths';
import { newId } from './id';
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

/**
 * 紅隊站到各自的防守位置（SPEC §6.2，含阻絕）；用於第 1 個分鏡。
 * 關閉自動防守時，使用者拖過的紅隊（tactic.redStarts）站在拖過的位置。
 */
function placeDefenders(tactic: Tactic, frame: Frame): void {
  const pinned = tactic.autoDefense ? undefined : tactic.redStarts;
  for (const [blueId, redId] of Object.entries(tactic.matchups)) {
    const at = pinned?.[redId];
    if (at) {
      frame.start[redId] = { ...at };
      continue;
    }
    const man = frame.start[blueId];
    const ball = frame.ballHolderId ? (frame.start[frame.ballHolderId] ?? null) : null;
    if (man) frame.start[redId] = defendPosition(man, ball, frame.ballHolderId === blueId, false, tactic.pressure);
  }
}

const redIdsOf = (tactic: Tactic) => tactic.players.filter((p) => p.team === 'red').map((p) => p.id);


/**
 * 從自動防守改成手動時（SPEC §6.2）：把目前自動模擬出的紅隊移動，變成每個分鏡一條直線的紅隊跑位，
 * 當成使用者編輯的起點。呼叫前 frames 的紅隊位置要是自動防守算好的（syncFrames 啟用自動防守時）。
 */
export function freezeDefenseAsPaths(tactic: Tactic): void {
  const reds = redIdsOf(tactic);
  tactic.frames.forEach((frame, i) => {
    frame.paths = frame.paths.filter((p) => !reds.includes(p.actorId));
    const next = tactic.frames[i + 1];
    if (!next) return; // 最後一個分鏡停在原地
    for (const id of reds) {
      const from = frame.start[id];
      const to = next.start[id];
      if (!from || !to || Math.hypot(to.x - from.x, to.y - from.y) < MIN_RED_PATH) continue;
      frame.paths.push({ id: newId(), kind: 'cut', actorId: id, points: [{ ...from }, { ...to }], freehand: false });
    }
  });
}

/** 改回自動防守時：紅隊跑位路線用不到了，移除 */
export function clearRedPaths(tactic: Tactic): void {
  const reds = redIdsOf(tactic);
  for (const frame of tactic.frames) frame.paths = frame.paths.filter((p) => !reds.includes(p.actorId));
}

/**
 * 依第 1 個分鏡重新推算後面所有分鏡的起始狀態，並放好紅隊。
 * prune = true 時，一併移除不再成立的路線（例如球換人之後的運球），回傳移除數量。
 * 拖曳中不要 prune：球暫時離手時，不應該把後面的傳球刪掉。
 */
export function syncFrames(tactic: Tactic, prune: boolean, opts: { defense?: boolean } = {}): number {
  let removed = 0;
  // 關閉自動防守：紅隊和藍隊規則一樣，第 1 個分鏡的位置由使用者拖曳（沒拖過的依對位放好），
  // 之後的分鏡由上一個分鏡的紅隊跑位路線推算（endState）
  const manual = !tactic.autoDefense;
  tactic.frames.forEach((frame, i) => {
    if (i > 0) {
      const prev = endState(tactic.frames[i - 1]!);
      frame.start = prev.start;
      frame.ballHolderId = prev.ballHolderId;
    }
    if (!manual || i === 0) placeDefenders(tactic, frame);
    if (prune) removed += pruneInvalidPaths(frame, tactic.players);
  });

  // 之後的分鏡：紅隊在防守 AI 模擬中、該分鏡開始時的實際位置（可能被甩開或被掩護卡住）。
  // defense: false 時跳過（例如一次建好多個分鏡時，只在最後算一次）；關閉自動防守時不模擬
  if (!manual && tactic.frames.length > 1 && opts.defense !== false) {
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
  // 刪掉第 1 個分鏡：藍隊留在原本第 2 個分鏡開始時的位置（frame.start 不會被重算）。
  // 關閉自動防守時紅隊也一樣，把那時的位置全部記成開局位置，否則會跳回被刪掉的分鏡裡的開局位置
  if (index === 0 && !tactic.autoDefense) {
    const next = tactic.frames[1]!;
    tactic.redStarts = Object.fromEntries(
      redIdsOf(tactic).filter((id) => next.start[id]).map((id) => [id, { ...next.start[id]! }]),
    );
  }
  tactic.frames.splice(index, 1);
  syncFrames(tactic, true);
  return Math.min(index, tactic.frames.length - 1);
}
