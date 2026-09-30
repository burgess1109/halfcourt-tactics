import {
  BALL_RADIUS,
  PLAYER_RADIUS,
  ballPosition,
  clampToView,
  findSnapTarget,
  hitTest,
} from '../model/entities';
import type { Store } from '../model/store';
import { BALL_ID, type Vec2 } from '../model/types';
import type { Renderer } from '../render/renderer';
import { toWorld } from '../render/viewport';

/** 拖曳球員與球。持球者移動時球跟著走；把球拖離後放開，會吸附到範圍內最近的球員。 */
export function attachDrag(canvas: HTMLCanvasElement, store: Store, renderer: Renderer): void {
  let pointerId: number | null = null;
  /** 按下的位置與物件中心的差，讓物件不會瞬移到手指下 */
  let grabOffset: Vec2 = { x: 0, y: 0 };

  const worldAt = (e: PointerEvent): Vec2 => {
    const rect = canvas.getBoundingClientRect();
    return toWorld(renderer.viewport, e.clientX - rect.left, e.clientY - rect.top);
  };

  canvas.addEventListener('pointerdown', (e) => {
    if (pointerId !== null) return; // 只處理單指
    const point = worldAt(e);
    const { tactic } = store.get();
    const frame = store.currentFrame();
    const id = hitTest(point, tactic.players, frame);
    if (!id) return;

    const center = id === BALL_ID ? ballPosition(frame) : frame.start[id]!;
    grabOffset = { x: center.x - point.x, y: center.y - point.y };
    pointerId = e.pointerId;
    canvas.setPointerCapture(e.pointerId);
    store.update((s) => {
      s.draggingId = id;
      if (id === BALL_ID) {
        // 把球從持球者手上拿起來
        const f = s.tactic.frames[s.frameIndex]!;
        f.start[BALL_ID] = center;
        f.ballHolderId = null;
      }
    });
  });

  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerId !== pointerId) return;
    const id = store.get().draggingId;
    if (!id) return;
    const point = worldAt(e);
    const radius = id === BALL_ID ? BALL_RADIUS : PLAYER_RADIUS;
    const next = clampToView({ x: point.x + grabOffset.x, y: point.y + grabOffset.y }, radius);
    store.update((s) => {
      s.tactic.frames[s.frameIndex]!.start[id] = next;
    });
  });

  const end = (e: PointerEvent) => {
    if (e.pointerId !== pointerId) return;
    pointerId = null;
    store.update((s) => {
      const f = s.tactic.frames[s.frameIndex]!;
      if (s.draggingId === BALL_ID) {
        f.ballHolderId = findSnapTarget(f.start[BALL_ID]!, s.tactic.players, f);
      }
      // 持球時也更新球的位置，讓存下來的資料和畫面一致
      f.start[BALL_ID] = ballPosition(f);
      s.draggingId = null;
      s.tactic.updatedAt = Date.now();
    });
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
}
