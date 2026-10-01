import { insertFrameAfter, syncFrames } from '../model/frames';
import { endPosition, makeShot, putPath } from '../model/paths';
import { newId } from '../model/id';
import { BALL_HOLD_OFFSET } from '../model/entities';
import { BALL_ID, type Frame, type Tactic, type TacticPath } from '../model/types';
import { ROLES, type Play, type PlayFrame, type Role } from './library';

/** 角色 → 藍隊球員 id */
export type RoleAssignment = Record<Role, string>;

function buildPaths(frame: Frame, data: PlayFrame, roles: RoleAssignment): void {
  for (const p of data.paths) {
    const actorId = roles[p.actor];
    const from = frame.start[actorId]!;
    let path: TacticPath;
    if (p.kind === 'shot') {
      path = makeShot(actorId, frame);
    } else if (p.kind === 'pass') {
      const targetId = roles[p.target!];
      path = { id: newId(), kind: 'pass', actorId, targetId, points: [{ ...from }, { ...endPosition(frame, targetId)! }], freehand: false };
    } else {
      path = { id: newId(), kind: p.kind, actorId, points: [{ ...from }, ...(p.via ?? []), { ...p.to! }], freehand: false };
    }
    putPath(frame, path);
  }
}

/**
 * 把內建戰術載入成一份新的戰術（複本，SPEC §6.3：不會改到內建戰術）。
 * 沿用 base 的球員、對位與掩護應對設定。
 */
export function loadPlay(base: Tactic, play: Play, roles: RoleAssignment): Tactic {
  const tactic: Tactic = structuredClone(base);
  tactic.id = newId();
  tactic.name = '';
  tactic.basedOn = { playId: play.id, roles: { ...roles }, modified: false };
  delete tactic.lastResult;

  const start: Frame['start'] = {};
  for (const r of ROLES) start[roles[r]] = { ...play.start[r] };
  const holder = roles[play.ball];
  start[BALL_ID] = { x: start[holder]!.x + BALL_HOLD_OFFSET.x, y: start[holder]!.y + BALL_HOLD_OFFSET.y };
  tactic.frames = [{ start, ballHolderId: holder, paths: [] }];
  syncFrames(tactic, false);

  play.frames.forEach((data, i) => {
    if (i > 0) insertFrameAfter(tactic, i - 1);
    buildPaths(tactic.frames[i]!, data, roles);
    syncFrames(tactic, false);
  });
  const removed = syncFrames(tactic, true);
  if (removed > 0) throw new Error(`戰術 ${play.id} 有 ${removed} 條路線不成立`);
  tactic.updatedAt = Date.now();
  return tactic;
}
