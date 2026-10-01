import { RIM } from '../model/paths';
import type { Vec2 } from '../model/types';
import {
  BEATEN_COS,
  BEATEN_MARGIN,
  BODY_DISTANCE,
  DENY_MIN_BALL_DISTANCE,
  DENY_MIN_RIM_DISTANCE,
  DENY_TOWARD_BALL,
  DENY_TOWARD_RIM,
  MIN_GAP,
  OFF_BALL_GAP,
  ON_BALL_GAP,
} from './config';

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

/**
 * 防守者要站的位置（SPEC §6.2）：
 * - 防持球者：在對位者與籃框之間
 * - 防外圍無球的人（離籃框超過 DENY_MIN_RIM_DISTANCE）：阻絕，站到傳球路線上、稍微偏向籃框
 * - 防籃下附近、或離持球者很近（例如正在掩護）的無球者，或球在空中（ball 為 null）：在對位者與籃框之間
 */
export function defendPosition(man: Vec2, ball: Vec2 | null, hasBall: boolean): Vec2 {
  if (hasBall || !ball) return guardPosition(man, hasBall);
  const toRim = { x: RIM.x - man.x, y: RIM.y - man.y };
  const rimDist = Math.hypot(toRim.x, toRim.y);
  const toBall = { x: ball.x - man.x, y: ball.y - man.y };
  const ballDist = Math.hypot(toBall.x, toBall.y);
  if (rimDist <= DENY_MIN_RIM_DISTANCE || ballDist < DENY_MIN_BALL_DISTANCE) return guardPosition(man, false);
  return {
    x: man.x + (toBall.x / ballDist) * DENY_TOWARD_BALL + (toRim.x / rimDist) * DENY_TOWARD_RIM,
    y: man.y + (toBall.y / ballDist) * DENY_TOWARD_BALL + (toRim.y / rimDist) * DENY_TOWARD_RIM,
  };
}

const rimDistance = (p: Vec2) => Math.hypot(p.x - RIM.x, p.y - RIM.y);

/**
 * 防守者這一刻要追的點：平常是 defendPosition；
 * 但對位者已經切到防守者前面、擋在防守者和籃框之間時，防守者穿不過去，只能追在對位者身後。
 */
export function chaseTarget(defender: Vec2, man: Vec2, ball: Vec2 | null, hasBall: boolean): Vec2 {
  const dx = defender.x - man.x;
  const dy = defender.y - man.y;
  const d = Math.hypot(dx, dy) || 1;
  const rx = RIM.x - man.x;
  const ry = RIM.y - man.y;
  const rd = Math.hypot(rx, ry) || 1;
  const behind = (dx * rx + dy * ry) / (d * rd) < BEATEN_COS;
  if (!behind || rimDistance(defender) <= rimDistance(man) + BEATEN_MARGIN) return defendPosition(man, ball, hasBall);
  return { x: man.x + (dx / d) * BODY_DISTANCE, y: man.y + (dy / d) * BODY_DISTANCE };
}
