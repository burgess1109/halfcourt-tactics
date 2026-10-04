import { freezeDefenseAsPaths, insertFrameAfter, syncFrames } from '../model/frames';
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
export function loadPlay(base: Tactic, play: Play, roles: RoleAssignment, opts: { defense?: boolean } = {}): Tactic {
  const tactic: Tactic = structuredClone(base);
  tactic.id = newId();
  tactic.name = '';
  tactic.basedOn = { playId: play.id, roles: { ...roles }, modified: false };
  delete tactic.lastResult;
  // 關閉自動防守時：先用自動防守模擬出每個分鏡的紅隊位置，當成使用者調整的起點
  const manual = !tactic.autoDefense;
  tactic.autoDefense = true;

  const start: Frame['start'] = {};
  for (const r of ROLES) start[roles[r]] = { ...play.start[r] };
  const holder = roles[play.ball];
  start[BALL_ID] = { x: start[holder]!.x + BALL_HOLD_OFFSET.x, y: start[holder]!.y + BALL_HOLD_OFFSET.y };
  tactic.frames = [{ start, ballHolderId: holder, paths: [] }];
  // 建分鏡時只需要藍隊的位置；紅隊的防守模擬最後算一次就好（每個分鏡都算會很慢）
  const fast = { defense: false };
  syncFrames(tactic, false, fast);

  play.frames.forEach((data, i) => {
    if (i > 0) insertFrameAfter(tactic, i - 1, fast);
    buildPaths(tactic.frames[i]!, data, roles);
    syncFrames(tactic, false, fast);
  });
  // defense: false 時連最後的紅隊位置都不算（只用來評分時，評分會自己跑一次完整模擬）
  const removed = syncFrames(tactic, true, opts);
  if (removed > 0) throw new Error(`戰術 ${play.id} 有 ${removed} 條路線不成立`);
  if (manual && opts.defense !== false) {
    // 自動模擬的紅隊移動變成紅隊跑位路線，之後使用者可以自己改
    freezeDefenseAsPaths(tactic);
    tactic.autoDefense = false;
    syncFrames(tactic, true);
  } else {
    tactic.autoDefense = !manual;
  }
  tactic.updatedAt = Date.now();
  return tactic;
}
