import { RIM } from '../model/paths';
import type { Vec2 } from '../model/types';
import { OFF_BALL_GAP, ON_BALL_GAP } from './config';

/**
 * 防守者的理想位置：在對位球員與籃框的連線上，離對位球員 gap 公尺（SPEC §6.2）。
 * 對位球員很靠近籃框時，最多只退到兩人中間，不會站到籃框後面。
 */
export function guardPosition(man: Vec2, hasBall: boolean): Vec2 {
  const dx = RIM.x - man.x;
  const dy = RIM.y - man.y;
  const d = Math.hypot(dx, dy);
  if (d === 0) return { ...man };
  const gap = Math.min(hasBall ? ON_BALL_GAP : OFF_BALL_GAP, d / 2);
  return { x: man.x + (dx / d) * gap, y: man.y + (dy / d) * gap };
}
