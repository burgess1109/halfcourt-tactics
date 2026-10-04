import { distToPolyline, polylineLength } from '../geom/polyline';
import { simplify } from '../geom/simplify';
import { sampleSpline, segmentMidpoint } from '../geom/spline';
import { BASKET_Y } from '../court/fiba';
import { dist, normalize, perp, sub } from '../geom/vec';
import { newId } from './id';
import type { Frame, PathKind, Player, TacticPath, Vec2 } from './types';

// 路線規則，對應 SPEC §4：
// - 每位球員每個分鏡最多一條路線
// - 路線起點永遠是球員在分鏡開始時的位置（球員被拖走時，路線跟著走）
// - 運球、傳球、投籃只有持球者可以畫；傳球終點必須是隊友，並指向隊友在本分鏡結束時的位置
// - 投籃只能在最後一個分鏡，終點固定是籃框，代表回合結束

export const FREEHAND_TOLERANCE = 0.1;
/** 短於這個長度的路線視為誤觸 */
export const MIN_PATH_LENGTH = 0.6;
/** 傳球放開時，離隊友多近才算傳給他 */
export const PASS_TARGET_RADIUS = 1.5;

export const PATH_KIND_LABEL: Record<PathKind, string> = {
  cut: '跑位',
  dribble: '運球',
  pass: '傳球',
  screen: '掩護',
  shot: '投籃',
};

/** 籃框中心 */
export const RIM: Vec2 = { x: 0, y: BASKET_Y };
/** 投籃弧線往側邊鼓起的比例（相對於出手距離），讓它和傳球的直線分得開 */
const SHOT_ARC_BULGE = 0.18;

/** 需要持球才能畫的路線 */
export function needsBall(kind: PathKind): boolean {
  return kind === 'dribble' || kind === 'pass' || kind === 'shot';
}

export function isMovement(kind: PathKind): boolean {
  return kind === 'cut' || kind === 'dribble' || kind === 'screen';
}

export function pathOf(frame: Frame, actorId: string): TacticPath | undefined {
  return frame.paths.find((p) => p.actorId === actorId);
}

/** 球員在本分鏡結束時的位置：有移動路線就是終點，否則不動 */
export function endPosition(frame: Frame, playerId: string): Vec2 | undefined {
  const path = pathOf(frame, playerId);
  if (path && isMovement(path.kind)) return path.points.at(-1);
  return frame.start[playerId];
}

/** 實際用來畫的控制點：頭尾依球員位置重新計算 */
export function resolvePoints(frame: Frame, path: TacticPath): Vec2[] {
  const pts = path.points.map((p) => ({ ...p }));
  const start = frame.start[path.actorId];
  if (start) pts[0] = { ...start };
  if (path.kind === 'pass' && path.targetId) {
    const end = endPosition(frame, path.targetId);
    if (end) pts[pts.length - 1] = { ...end };
  }
  if (path.kind === 'shot') return shotControls(pts[0]!);
  return pts;
}

/** 投籃弧線的控制點：出手點 → 側邊鼓起的中點 → 籃框 */
export function shotControls(from: Vec2): Vec2[] {
  const d = dist(from, RIM);
  // 一律往中場那側鼓起，底角出手時弧線才不會跑出底線
  let n = perp(normalize(sub(RIM, from)));
  if (n.y < 0) n = { x: -n.x, y: -n.y };
  const mid = {
    x: (from.x + RIM.x) / 2 + n.x * d * SHOT_ARC_BULGE,
    y: (from.y + RIM.y) / 2 + n.y * d * SHOT_ARC_BULGE,
  };
  return [{ ...from }, mid, { ...RIM }];
}

export function samplePath(frame: Frame, path: TacticPath): Vec2[] {
  return sampleSpline(resolvePoints(frame, path));
}

/** 不能開始畫這種路線時，回傳原因；可以則回傳 null */
export function cannotStart(
  kind: PathKind,
  actorId: string,
  frame: Frame,
  players: readonly Player[],
  isLastFrame: boolean,
): string | null {
  // 紅隊（關閉自動防守時）只能畫跑位
  if (players.find((p) => p.id === actorId)?.team === 'red' && kind !== 'cut') return '紅隊只能畫跑位路線';
  if (needsBall(kind) && frame.ballHolderId !== actorId) {
    return `只有持球者可以${PATH_KIND_LABEL[kind]}`;
  }
  if (kind === 'shot' && !isLastFrame) return '投籃只能在最後一個分鏡';
  if (kind === 'pass') {
    const team = players.find((p) => p.id === actorId)?.team;
    if (!players.some((p) => p.team === team && p.id !== actorId)) return '沒有可以傳球的隊友';
  }
  return null;
}

/** 傳球放開的位置附近最近的隊友 */
export function findPassTarget(
  at: Vec2,
  actorId: string,
  frame: Frame,
  players: readonly Player[],
): string | null {
  const team = players.find((p) => p.id === actorId)?.team;
  let best: string | null = null;
  let bestDist = PASS_TARGET_RADIUS;
  for (const p of players) {
    if (p.team !== team || p.id === actorId) continue;
    const pos = endPosition(frame, p.id);
    if (!pos) continue;
    const d = dist(at, pos);
    if (d <= bestDist) {
      best = p.id;
      bestDist = d;
    }
  }
  return best;
}

/** 投籃不用拖線：點持球者就建立 */
export function makeShot(actorId: string, frame: Frame): TacticPath {
  return { id: newId(), kind: 'shot', actorId, points: shotControls(frame.start[actorId]!), freehand: false };
}

export function hasShot(frame: Frame): boolean {
  return frame.paths.some((p) => p.kind === 'shot');
}

export interface Draft {
  kind: PathKind;
  actorId: string;
  freehand: boolean;
  /** 手指軌跡（第一點是球員位置） */
  points: Vec2[];
}

/** 把手指軌跡變成路線；不成立時回傳錯誤訊息 */
export function finalizeDraft(
  draft: Draft,
  frame: Frame,
  players: readonly Player[],
): { path: TacticPath } | { error: string | null } {
  const raw = draft.points;
  const start = raw[0]!;
  const end = raw.at(-1)!;
  if (polylineLength(raw) < MIN_PATH_LENGTH) return { error: null }; // 誤觸，不提示

  let points = draft.freehand ? simplify(raw, FREEHAND_TOLERANCE) : [start, end];
  let targetId: string | undefined;
  if (draft.kind === 'pass') {
    const target = findPassTarget(end, draft.actorId, frame, players);
    if (!target) return { error: '傳球要拉到隊友身上' };
    targetId = target;
    points = [...points.slice(0, -1), endPosition(frame, target)!];
  }
  return {
    path: {
      id: newId(),
      kind: draft.kind,
      actorId: draft.actorId,
      targetId,
      points,
      freehand: draft.freehand,
    },
  };
}

/** 加入路線；同一位球員原本的路線會被取代 */
export function putPath(frame: Frame, path: TacticPath): void {
  frame.paths = frame.paths.filter((p) => p.actorId !== path.actorId);
  frame.paths.push(path);
}

/**
 * 移除已經不成立的路線，例如球換人拿之後，舊持球者的運球與傳球。
 * 回傳被移除的路線數量。
 */
export function pruneInvalidPaths(frame: Frame, players: readonly Player[]): number {
  const before = frame.paths.length;
  const teamOf = (id: string | undefined) => players.find((p) => p.id === id)?.team;
  frame.paths = frame.paths.filter((p) => {
    if (needsBall(p.kind) && frame.ballHolderId !== p.actorId) return false;
    if (p.kind === 'pass' && (!p.targetId || teamOf(p.targetId) !== teamOf(p.actorId))) return false;
    return true;
  });
  return before - frame.paths.length;
}

// ---- 選取與編輯 ----

/** 找點擊位置附近的路線 */
export function hitTestPath(at: Vec2, frame: Frame, tolerance: number): string | null {
  let best: string | null = null;
  let bestDist = tolerance;
  for (const path of frame.paths) {
    const d = distToPolyline(at, samplePath(frame, path));
    if (d <= bestDist) {
      best = path.id;
      bestDist = d;
    }
  }
  return best;
}

export type Handle =
  /** 既有的控制點：拖曳移動；點一下（中間的點）刪除 */
  | { type: 'point'; index: number; pos: Vec2 }
  /** 兩個控制點中間：拖曳時插入新的控制點 */
  | { type: 'insert'; index: number; pos: Vec2 };

/** 選取中的路線有哪些把手。起點固定在球員身上；傳球的終點固定在隊友身上。 */
export function pathHandles(frame: Frame, path: TacticPath): Handle[] {
  if (path.kind === 'shot') return []; // 投籃弧線自動產生，不能編輯
  const pts = resolvePoints(frame, path);
  const lastEditable = path.kind === 'pass' ? pts.length - 2 : pts.length - 1;
  const handles: Handle[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    handles.push({ type: 'insert', index: i + 1, pos: segmentMidpoint(pts, i) });
  }
  for (let i = 1; i <= lastEditable; i++) handles.push({ type: 'point', index: i, pos: pts[i]! });
  return handles;
}

export function hitTestHandle(at: Vec2, handles: readonly Handle[], radius: number): Handle | null {
  let best: Handle | null = null;
  let bestDist = radius;
  // 控制點優先於插入點（陣列後段），所以倒著找、同距離時先找到的留下
  for (let i = handles.length - 1; i >= 0; i--) {
    const h = handles[i]!;
    const d = dist(at, h.pos);
    if (d < bestDist) {
      best = h;
      bestDist = d;
    }
  }
  return best;
}
