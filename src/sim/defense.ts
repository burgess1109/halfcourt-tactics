import { RIM } from '../model/paths';
import type { Vec2 } from '../model/types';
import { MIN_GAP, OFF_BALL_GAP, ON_BALL_GAP } from './config';

/**
 * 防守者的理想位置：在對位球員與籃框的連線上，離對位球員 gap 公尺（SPEC §6.2）。
 * 對位球員靠近籃框時，最多退到兩人中間；但至少保持 MIN_GAP，圓標才不會疊在一起。
 */
export function guardPosition(man: Vec2, hasBall: boolean): Vec2 {
  const dx = RIM.x - man.x;
  const dy = RIM.y - man.y;
  const d = Math.hypot(dx, dy);
  if (d === 0) return { ...man };
  const gap = Math.min(hasBall ? ON_BALL_GAP : OFF_BALL_GAP, Math.max(d / 2, MIN_GAP));
  return { x: man.x + (dx / d) * gap, y: man.y + (dy / d) * gap };
}
