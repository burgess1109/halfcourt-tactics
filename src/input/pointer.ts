import {
  BALL_RADIUS,
  PLAYER_RADIUS,
  ballPosition,
  clampToView,
  findSnapTarget,
  hitTest,
} from '../model/entities';
import {
  cannotStart,
  finalizeDraft,
  hitTestHandle,
  hitTestPath,
  makeShot,
  pathHandles,
  putPath,
  type Handle,
} from '../model/paths';
import type { Store } from '../model/store';
import { BALL_ID, type Vec2 } from '../model/types';
import { HANDLE_PX } from '../render/paths';
import type { Renderer } from '../render/renderer';
import { toWorld } from '../render/viewport';
import { t } from '../i18n';

type Gesture =
  | {
      type: 'entity';
      id: string;
      grabOffset: Vec2;
      downAt: { x: number; y: number };
      moved: boolean;
      /** 不能拖曳時的原因 */
      locked: string | null;
    }
  /** 畫線；tapId：從球員身上開始（不是球），沒拖動就放開時改成打開球員設定 */
  | { type: 'draw'; tapId: string | null; downAt: { x: number; y: number }; moved: boolean }
  /** 不能做的操作（例如紅隊畫運球）：點一下打開球員設定，拖動時才提示原因 */
  | { type: 'blocked'; id: string | null; reason: string; downAt: { x: number; y: number }; moved: boolean }
  | { type: 'handle'; pathId: string; handle: Handle; downAt: { x: number; y: number }; moved: boolean };

/** 手指移動超過這個距離（CSS px）才算拖曳，否則算點一下 */
const TAP_SLOP_PX = 5;
/** 手繪時，軌跡點之間的最小距離（公尺） */
const FREEHAND_STEP = 0.05;

export function attachPointer(
  canvas: HTMLCanvasElement,
  store: Store,
  renderer: Renderer,
  notify: (message: string) => void,
  onTapPlayer: (playerId: string) => void,
): void {
  let pointerId: number | null = null;
  let gesture: Gesture | null = null;

  const local = (e: PointerEvent) => {
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };
  const worldAt = (e: PointerEvent): Vec2 => {
    const p = local(e);
    return toWorld(renderer.viewport, p.x, p.y);
  };
  /** 把螢幕像素換成公尺 */
  const meters = (px: number) => px / renderer.viewport.scale;

  const startGesture = (e: PointerEvent): Gesture | null => {
    const point = worldAt(e);
    const state = store.get();
    const frame = store.currentFrame();
    const { players } = state.tactic;

    // 1. 選取中路線的把手
    const selected = frame.paths.find((p) => p.id === state.selectedPathId);
    if (selected) {
      const handle = hitTestHandle(point, pathHandles(frame, selected), meters(HANDLE_PX + 12));
      if (handle) {
        store.begin();
        return { type: 'handle', pathId: selected.id, handle, downAt: local(e), moved: false };
      }
    }

    // 2. 球員或球
    const id = hitTest(point, players, frame);
    const isRed = players.find((p) => p.id === id)?.team === 'red';
    const manualDefense = !state.tactic.autoDefense;
    // 紅隊：啟用自動防守時由系統防守；關閉時可以畫跑位（其他路線不行）
    if (id && isRed && state.tool !== 'move' && !(manualDefense && state.tool === 'cut')) {
      const reason = manualDefense ? t().edit.redCutOnly : t().edit.redAuto;
      return { type: 'blocked', id, reason, downAt: local(e), moved: false };
    }
    if (id && state.tool === 'move') {
      const center = id === BALL_ID ? ballPosition(frame) : frame.start[id]!;
      // 紅隊站位由防守 AI 決定（關閉自動防守時和藍隊一樣：第 1 個分鏡可以拖曳）；
      // 第 2 個分鏡之後的站位由上一個分鏡的路線推算
      const locked = isRed && !manualDefense
        ? t().edit.redAutoPosition
        : state.frameIndex > 0
          ? t().board.moveLocked
          : null;
      if (!locked) {
        store.begin();
        store.update((s) => {
          s.draggingId = id;
          s.selectedPathId = null;
        });
      }
      return {
        type: 'entity',
        id,
        grabOffset: { x: center.x - point.x, y: center.y - point.y },
        downAt: local(e),
        moved: false,
        locked,
      };
    }
    if (id && state.tool !== 'move') {
      const kind = state.tool;
      // 點到球等於從持球者開始畫
      const actorId = id === BALL_ID ? frame.ballHolderId : id;
      if (!actorId) {
        notify(t().edit.noBallHolder);
        return null;
      }
      const isLastFrame = state.frameIndex === state.tactic.frames.length - 1;
      const reason = cannotStart(kind, actorId, frame, players, isLastFrame);
      if (reason) {
        // 投籃是點一下就建立，不會拖動：不能投籃的原因要立刻提示（不改成打開球員設定）
        if (kind === 'shot') {
          notify(reason);
          return null;
        }
        return { type: 'blocked', id: id === BALL_ID ? null : id, reason, downAt: local(e), moved: false };
      }
      if (kind === 'shot') {
        // 投籃不用拖線，點一下就建立
        store.commit((s) => {
          const shot = makeShot(actorId, s.tactic.frames[s.frameIndex]!);
          putPath(s.tactic.frames[s.frameIndex]!, shot);
          s.selectedPathId = shot.id;
        });
        return null;
      }
      store.update((s) => {
        s.selectedPathId = null;
        s.draft = { kind, actorId, freehand: s.freehand, points: [{ ...frame.start[actorId]! }] };
      });
      return { type: 'draw', tapId: id === BALL_ID ? null : id, downAt: local(e), moved: false };
    }

    // 3. 點到路線就選取，點到空白處就取消選取
    const pathId = hitTestPath(point, frame, Math.max(0.3, meters(14)));
    store.update((s) => {
      s.selectedPathId = pathId;
    });
    return null;
  };

  canvas.addEventListener('pointerdown', (e) => {
    const { playing, readonly } = store.get();
    if (pointerId !== null || playing || readonly) return; // 只處理單指；播放中、唯讀預覽不能編輯
    gesture = startGesture(e);
    if (gesture) {
      pointerId = e.pointerId;
      canvas.setPointerCapture(e.pointerId);
    }
  });

  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerId !== pointerId || !gesture) return;
    const point = worldAt(e);
    const g = gesture;

    if (g.type === 'entity') {
      if (!g.moved) {
        const at = local(e);
        if (Math.hypot(at.x - g.downAt.x, at.y - g.downAt.y) < TAP_SLOP_PX) return;
        g.moved = true;
        if (g.locked) {
          notify(g.locked);
          return;
        }
        if (g.id === BALL_ID) {
          // 真的開始拖曳球時，才把球從持球者手上拿起來
          store.update((s) => {
            const f = s.tactic.frames[s.frameIndex]!;
            f.start[BALL_ID] = ballPosition(f);
            f.ballHolderId = null;
          });
        }
      }
      if (g.locked) return;
      const radius = g.id === BALL_ID ? BALL_RADIUS : PLAYER_RADIUS;
      const next = clampToView({ x: point.x + g.grabOffset.x, y: point.y + g.grabOffset.y }, radius);
      store.update((s) => {
        s.tactic.frames[s.frameIndex]!.start[g.id] = next;
        // 關閉自動防守時拖過的紅隊：記下來，之後不再依對位重新站位
        if (s.tactic.players.find((p) => p.id === g.id)?.team === 'red') {
          s.tactic.redStarts = { ...s.tactic.redStarts, [g.id]: next };
        }
      });
    } else if (g.type === 'blocked') {
      const at = local(e);
      if (Math.hypot(at.x - g.downAt.x, at.y - g.downAt.y) >= TAP_SLOP_PX) g.moved = true;
    } else if (g.type === 'draw') {
      const at = local(e);
      if (Math.hypot(at.x - g.downAt.x, at.y - g.downAt.y) >= TAP_SLOP_PX) g.moved = true;
      const p = clampToView(point, 0);
      store.update((s) => {
        const d = s.draft!;
        if (!d.freehand) {
          d.points = [d.points[0]!, p];
        } else {
          const last = d.points.at(-1)!;
          if (Math.hypot(p.x - last.x, p.y - last.y) >= FREEHAND_STEP) d.points.push(p);
        }
      });
    } else {
      const at = local(e);
      if (!g.moved && Math.hypot(at.x - g.downAt.x, at.y - g.downAt.y) < TAP_SLOP_PX) return;
      const p = clampToView(point, 0);
      store.update((s) => {
        const path = s.tactic.frames[s.frameIndex]!.paths.find((x) => x.id === g.pathId);
        if (!path) return;
        if (g.handle.type === 'insert') {
          // 第一次拖曳時插入新的控制點，之後就當成一般控制點
          path.points.splice(g.handle.index, 0, p);
          g.handle = { type: 'point', index: g.handle.index, pos: p };
        }
        path.points[g.handle.index] = p;
      });
      g.moved = true;
    }
  });

  const finish = (e: PointerEvent, cancelled: boolean) => {
    if (e.pointerId !== pointerId || !gesture) return;
    pointerId = null;
    const g = gesture;
    gesture = null;

    if (g.type === 'entity') {
      if (!g.locked) {
        store.update((s) => {
          const f = s.tactic.frames[s.frameIndex]!;
          if (g.id === BALL_ID && g.moved) f.ballHolderId = findSnapTarget(f.start[BALL_ID]!, s.tactic.players, f);
          // 持球時也更新球的位置，讓存下來的資料和畫面一致
          f.start[BALL_ID] = ballPosition(f);
          s.draggingId = null;
        });
        store.end(); // 由 store 統一移除不成立的路線並提示
      }
      if (!g.moved && !cancelled && g.id !== BALL_ID) onTapPlayer(g.id);
    } else if (g.type === 'blocked') {
      if (cancelled) return;
      // 點一下球員：打開球員設定（任何工具、任何分鏡都可以）；拖動、或點的是球（沒有設定可開）時提示原因
      if (!g.moved && g.id) onTapPlayer(g.id);
      else notify(g.reason);
    } else if (g.type === 'draw') {
      if (!g.moved && g.tapId && !cancelled) {
        // 沒有拖動：不是畫線，是點一下球員，打開球員設定
        store.update((s) => {
          s.draft = null;
        });
        onTapPlayer(g.tapId);
        return;
      }
      const state = store.get();
      const draft = state.draft!;
      const result = cancelled ? { error: null } : finalizeDraft(draft, store.currentFrame(), state.tactic.players);
      store.update((s) => {
        s.draft = null;
      });
      if ('path' in result) {
        store.commit((s) => {
          putPath(s.tactic.frames[s.frameIndex]!, result.path);
          s.selectedPathId = result.path.id;
        });
      } else if (result.error) {
        notify(result.error);
      }
    } else {
      // 點一下中間的控制點 = 刪除它
      if (!g.moved && !cancelled && g.handle.type === 'point') {
        const { index } = g.handle;
        store.update((s) => {
          const path = s.tactic.frames[s.frameIndex]!.paths.find((x) => x.id === g.pathId);
          if (path && index < path.points.length - 1) path.points.splice(index, 1);
        });
      }
      store.end();
    }
  };
  canvas.addEventListener('pointerup', (e) => finish(e, false));
  canvas.addEventListener('pointercancel', (e) => finish(e, true));
}
