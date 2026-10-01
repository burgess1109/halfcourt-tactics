import { VIEW_BOUNDS } from '../court/fiba';
import { BALL_ID, type Frame, type Player, type Vec2 } from './types';

// 場上物件的尺寸（公尺）。圓標比真人大，是為了在手機上好點、好讀。
export const PLAYER_RADIUS = 0.72;
export const BALL_RADIUS = 0.5;
/** 球放開時，與球員邊緣距離在這個範圍內就吸附（SPEC §3.2） */
export const BALL_SNAP_DISTANCE = 0.6;
/** 持球時，球相對持球者中心的位置 */
export const BALL_HOLD_OFFSET: Vec2 = { x: 0.85, y: 0.1 };
/** 觸控時的額外點擊容差 */
const HIT_SLOP = 0.2;

export function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** 目前球的實際位置：有持球者時跟著持球者走 */
export function ballPosition(frame: Frame): Vec2 {
  const holder = frame.ballHolderId ? frame.start[frame.ballHolderId] : undefined;
  if (holder) return { x: holder.x + BALL_HOLD_OFFSET.x, y: holder.y + BALL_HOLD_OFFSET.y };
  return frame.start[BALL_ID] ?? { x: 0, y: 0 };
}

/** 找出球放開時要吸附的藍隊球員：範圍內最近的一位，沒有則回傳 null */
export function findSnapTarget(ball: Vec2, players: readonly Player[], frame: Frame): string | null {
  let best: string | null = null;
  let bestDist = PLAYER_RADIUS + BALL_SNAP_DISTANCE;
  for (const p of players) {
    if (p.team !== 'blue') continue; // 進攻模式只有藍隊能持球
    const pos = frame.start[p.id];
    if (!pos) continue;
    const d = distance(ball, pos);
    if (d <= bestDist) {
      best = p.id;
      bestDist = d;
    }
  }
  return best;
}

/** 點擊測試：球畫在最上層所以優先，再來是球員（後畫的優先） */
export function hitTest(point: Vec2, players: readonly Player[], frame: Frame): string | null {
  if (distance(point, ballPosition(frame)) <= BALL_RADIUS + HIT_SLOP) return BALL_ID;
  for (let i = players.length - 1; i >= 0; i--) {
    const p = players[i]!;
    const pos = frame.start[p.id];
    if (pos && distance(point, pos) <= PLAYER_RADIUS + HIT_SLOP) return p.id;
  }
  return null;
}

/** 把物件中心限制在可視範圍內，讓圓標不會被切掉 */
export function clampToView(p: Vec2, radius: number): Vec2 {
  return {
    x: Math.min(VIEW_BOUNDS.maxX - radius, Math.max(VIEW_BOUNDS.minX + radius, p.x)),
    y: Math.min(VIEW_BOUNDS.maxY - radius, Math.max(VIEW_BOUNDS.minY + radius, p.y)),
  };
}
