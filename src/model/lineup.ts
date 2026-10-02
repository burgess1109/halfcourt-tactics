import { BALL_HOLD_OFFSET } from './entities';
import { BALL_ID, type Frame, type Tactic, type Vec2 } from './types';

// 開局站位（SPEC §1.1 步驟 ③）：誰站弧頂（持球）、誰站左翼、誰站右翼。
// 只影響空白戰術與自己畫的戰術；載入內建戰術時，站位由角色決定。

export type Slot = 'top' | 'left' | 'right';
export type Lineup = Record<Slot, string>;

export const SLOTS: readonly Slot[] = ['top', 'left', 'right'];
export const SLOT_LABEL: Record<Slot, string> = { top: '弧頂（持球）', left: '左翼', right: '右翼' };
export const SLOT_POSITION: Record<Slot, Vec2> = {
  top: { x: 0, y: 8.6 },
  left: { x: -5.4, y: 6.0 },
  right: { x: 5.4, y: 6.0 },
};
export const DEFAULT_LINEUP: Lineup = { top: 'b1', left: 'b2', right: 'b3' };

export function lineupOf(tactic: Tactic): Lineup {
  return tactic.setup.lineup ?? DEFAULT_LINEUP;
}

/** 讓 playerId 站到 slot；原本站那裡的人換到 playerId 原本的位置 */
export function assignSlot(lineup: Lineup, slot: Slot, playerId: string): Lineup {
  const next = { ...lineup };
  const from = SLOTS.find((s) => next[s] === playerId)!;
  next[from] = next[slot];
  next[slot] = playerId;
  return next;
}

/** 把第 1 個分鏡的藍隊與球擺到開局站位，弧頂的人持球（紅隊由 syncFrames 依對位擺好） */
export function applyLineup(frame: Frame, lineup: Lineup): void {
  for (const slot of SLOTS) frame.start[lineup[slot]] = { ...SLOT_POSITION[slot] };
  const top = SLOT_POSITION.top;
  frame.start[BALL_ID] = { x: top.x + BALL_HOLD_OFFSET.x, y: top.y + BALL_HOLD_OFFSET.y };
  frame.ballHolderId = lineup.top;
}

/** 還沒畫任何路線（只有一個分鏡、沒有路線）時，改站位可以直接套用到目前的戰術 */
export function canApplyLineupNow(tactic: Tactic): boolean {
  return tactic.frames.length === 1 && tactic.frames[0]!.paths.length === 0;
}

const samePoint = (a: Vec2 | undefined, b: Vec2) => !!a && Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.y - b.y) < 1e-9;

/**
 * 目前的戰術是否已經是空白戰術（清空也不會有變化）：不是內建戰術、只有一個分鏡、沒有路線，
 * 藍隊與球都在開局站位、弧頂的人持球。直接比對，不建立複本（工具列每次更新都會呼叫）。
 */
export function isBlankTactic(tactic: Tactic): boolean {
  if (tactic.basedOn || !canApplyLineupNow(tactic)) return false;
  const lineup = lineupOf(tactic);
  const frame = tactic.frames[0]!;
  if (frame.ballHolderId !== lineup.top) return false;
  const top = SLOT_POSITION.top;
  if (!samePoint(frame.start[BALL_ID], { x: top.x + BALL_HOLD_OFFSET.x, y: top.y + BALL_HOLD_OFFSET.y })) return false;
  return SLOTS.every((slot) => samePoint(frame.start[lineup[slot]], SLOT_POSITION[slot]));
}
