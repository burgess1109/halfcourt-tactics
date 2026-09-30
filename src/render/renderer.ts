import { ballPosition } from '../model/entities';
import type { EditorState } from '../model/store';
import { BALL_ID } from '../model/types';
import { drawCourt } from './court';
import { drawBall, drawPlayer, drawPlayerLabel } from './entities';
import { drawGhost, drawHandles, drawPath } from './paths';
import { isMovement, pathHandles, resolvePoints } from '../model/paths';
import { fitViewport, type Viewport } from './viewport';

/** 管理 canvas 尺寸、高解析度縮放，以及球場的離屏快取 */
export class Renderer {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly courtCache = document.createElement('canvas');
  private dpr = 1;
  viewport: Viewport = fitViewport(0, 0);

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
  }

  /** 以 CSS px 設定大小；會重畫球場快取 */
  resize(width: number, height: number): void {
    this.dpr = window.devicePixelRatio || 1;
    for (const c of [this.canvas, this.courtCache]) {
      c.width = Math.round(width * this.dpr);
      c.height = Math.round(height * this.dpr);
    }
    this.viewport = fitViewport(width, height);
    const cctx = this.courtCache.getContext('2d')!;
    cctx.clearRect(0, 0, this.courtCache.width, this.courtCache.height);
    drawCourt(cctx, this.viewport, this.dpr);
  }

  draw(state: EditorState): void {
    const { ctx } = this;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.drawImage(this.courtCache, 0, 0);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    const frame = state.tactic.frames[state.frameIndex]!;
    const playerById = new Map(state.tactic.players.map((p) => [p.id, p]));
    const teamOf = (id: string) => playerById.get(id)?.team ?? 'blue';

    // 1. 移動路線終點的分身
    for (const path of frame.paths) {
      const player = playerById.get(path.actorId);
      const end = path.points.at(-1);
      if (player && end && isMovement(path.kind)) drawGhost(ctx, this.viewport, player, end);
    }

    // 2. 路線（選取中的最後畫）與畫線中的預覽
    const paths = [...frame.paths].sort(
      (a, b) => Number(a.id === state.selectedPathId) - Number(b.id === state.selectedPathId),
    );
    for (const path of paths) {
      drawPath(ctx, this.viewport, resolvePoints(frame, path), {
        kind: path.kind,
        team: teamOf(path.actorId),
        selected: path.id === state.selectedPathId,
      });
    }
    if (state.draft) {
      const { draft } = state;
      const controls = draft.freehand ? draft.points : [draft.points[0]!, draft.points.at(-1)!];
      drawPath(ctx, this.viewport, controls, { kind: draft.kind, team: teamOf(draft.actorId), preview: true });
    }

    // 3. 球員、名字、球
    // 拖曳中的球員最後畫，才會在最上層
    const players = [...state.tactic.players].sort(
      (a, b) => Number(a.id === state.draggingId) - Number(b.id === state.draggingId),
    );
    for (const p of players) {
      const pos = frame.start[p.id];
      if (pos) drawPlayer(ctx, this.viewport, p, pos, p.id === state.draggingId);
    }
    for (const p of players) {
      const pos = frame.start[p.id];
      if (pos) drawPlayerLabel(ctx, this.viewport, p, pos, p.id === state.draggingId);
    }
    drawBall(ctx, this.viewport, ballPosition(frame), state.draggingId === BALL_ID);

    // 4. 選取路線的編輯把手
    const selected = frame.paths.find((p) => p.id === state.selectedPathId);
    if (selected && !state.draft) drawHandles(ctx, this.viewport, pathHandles(frame, selected));
  }
}
