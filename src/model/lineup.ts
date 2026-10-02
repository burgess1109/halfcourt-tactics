import { VIEW_BOUNDS } from '../court/fiba';
import { BALL_HOLD_OFFSET, PLAYER_RADIUS } from './entities';
import { BALL_ID, type Frame, type Tactic, type Vec2 } from './types';

// 開局站位（SPEC §1.1 步驟 ③）：三名藍隊球員的位置與持球者，可以自由放置或套用常用陣型。
// 只影響空白戰術與自己畫的戰術；載入內建戰術時，站位由角色決定。

export interface Lineup {
  /** 藍隊 id → 位置 */
  positions: Record<string, Vec2>;
  /** 持球者（藍隊 id） */
  holder: string;
}

export interface Formation {
  id: string;
  label: string;
  /** spots[0] 是持球的位置，另外兩個依左右順序 */
  spots: readonly [Vec2, Vec2, Vec2];
}

const TOP: Vec2 = { x: 0, y: 8.6 };
const LEFT_WING: Vec2 = { x: -5.4, y: 6.0 };
const RIGHT_WING: Vec2 = { x: 5.4, y: 6.0 };

/** 常用陣型 */
export const FORMATIONS: readonly Formation[] = [
  { id: 'top-wings', label: '弧頂＋兩翼', spots: [TOP, LEFT_WING, RIGHT_WING] },
  { id: 'top-corners', label: '弧頂＋兩底角', spots: [TOP, { x: -6.6, y: 1.2 }, { x: 6.6, y: 1.2 }] },
  { id: 'wings-post', label: '兩翼＋低位', spots: [LEFT_WING, { x: 2.3, y: 2.6 }, RIGHT_WING] },
  { id: 'top-wing-corner', label: '弧頂＋翼＋底角', spots: [TOP, { x: -6.6, y: 1.2 }, RIGHT_WING] },
  { id: 'top-elbows', label: '弧頂＋兩肘', spots: [TOP, { x: -2.4, y: 5.8 }, { x: 2.4, y: 5.8 }] },
];

export const DEFAULT_LINEUP: Lineup = {
  positions: { b1: { ...TOP }, b2: { ...LEFT_WING }, b3: { ...RIGHT_WING } },
  holder: 'b1',
};

export function lineupOf(tactic: Tactic): Lineup {
  return tactic.setup.lineup ?? DEFAULT_LINEUP;
}

/**
 * 套用陣型：持球者站到持球的位置，另外兩人依目前的左右順序站到另外兩個位置
 * （x 較小的站到 x 較小的位置），盡量不讓人大幅交換位置。
 */
export function applyFormation(lineup: Lineup, formation: Formation): Lineup {
  const others = Object.keys(lineup.positions)
    .filter((id) => id !== lineup.holder)
    .sort((a, b) => lineup.positions[a]!.x - lineup.positions[b]!.x || a.localeCompare(b));
  const rest = [formation.spots[1], formation.spots[2]].sort((a, b) => a.x - b.x);
  return {
    holder: lineup.holder,
    positions: {
      [lineup.holder]: { ...formation.spots[0] },
      [others[0]!]: { ...rest[0]! },
      [others[1]!]: { ...rest[1]! },
    },
  };
}

/** 拖曳球員：位置限制在可視範圍內 */
export function moveInLineup(lineup: Lineup, playerId: string, to: Vec2): Lineup {
  const r = PLAYER_RADIUS;
  const p = {
    x: Math.min(VIEW_BOUNDS.maxX - r, Math.max(VIEW_BOUNDS.minX + r, to.x)),
    y: Math.min(VIEW_BOUNDS.maxY - r, Math.max(VIEW_BOUNDS.minY + r, to.y)),
  };
  return { ...lineup, positions: { ...lineup.positions, [playerId]: p } };
}

export function setHolder(lineup: Lineup, playerId: string): Lineup {
  return { ...lineup, holder: playerId };
}

/** 持球時球的位置 */
export function lineupBall(lineup: Lineup): Vec2 {
  const h = lineup.positions[lineup.holder]!;
  return { x: h.x + BALL_HOLD_OFFSET.x, y: h.y + BALL_HOLD_OFFSET.y };
}

/** 把第 1 個分鏡的藍隊與球擺到開局站位（紅隊由 syncFrames 依對位擺好） */
export function applyLineup(frame: Frame, lineup: Lineup): void {
  for (const [id, p] of Object.entries(lineup.positions)) frame.start[id] = { ...p };
  frame.start[BALL_ID] = lineupBall(lineup);
  frame.ballHolderId = lineup.holder;
}

/** 還沒畫任何路線（只有一個分鏡、沒有路線）時，改站位可以直接套用到目前的戰術 */
export function canApplyLineupNow(tactic: Tactic): boolean {
  return tactic.frames.length === 1 && tactic.frames[0]!.paths.length === 0;
}

const samePoint = (a: Vec2 | undefined, b: Vec2) => !!a && Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.y - b.y) < 1e-9;

/**
 * 目前的戰術是否已經是空白戰術（清空也不會有變化）：不是內建戰術、只有一個分鏡、沒有路線，
 * 藍隊與球都在開局站位、持球者相同。直接比對，不建立複本（工具列每次更新都會呼叫）。
 */
export function isBlankTactic(tactic: Tactic): boolean {
  if (tactic.basedOn || !canApplyLineupNow(tactic)) return false;
  const lineup = lineupOf(tactic);
  const frame = tactic.frames[0]!;
  if (frame.ballHolderId !== lineup.holder) return false;
  if (!samePoint(frame.start[BALL_ID], lineupBall(lineup))) return false;
  return Object.entries(lineup.positions).every(([id, p]) => samePoint(frame.start[id], p));
}
