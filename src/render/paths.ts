import { polylineLength, trimPolyline } from '../geom/polyline';
import { sampleSpline } from '../geom/spline';
import { normalize, perp, sub } from '../geom/vec';
import { PLAYER_RADIUS } from '../model/entities';
import type { Handle } from '../model/paths';
import type { PathKind, Player, Team, Vec2 } from '../model/types';
import { theme } from './theme';
import { toScreen, type Viewport } from './viewport';

// ctx 使用 CSS px 座標。路線的樣式對應 SPEC §4。

const LINE_PX = 3.5;
const ARROW_LEN = 0.42; // 公尺
const ARROW_HALF_WIDTH = 0.22;
const SCREEN_BAR_HALF = 0.42;
const WAVE_AMPLITUDE = 0.13;
const WAVE_LENGTH = 0.55;
/** 投籃終點在籃框外面畫的圈 */
const SHOT_RING_RADIUS = 0.5;

export interface PathStyle {
  kind: PathKind;
  team: Team;
  selected?: boolean;
  /** 畫線中的預覽 */
  preview?: boolean;
  /** 播放時淡化 */
  faded?: boolean;
}

/** 把控制點畫成路線 */
export function drawPath(ctx: CanvasRenderingContext2D, vp: Viewport, controls: readonly Vec2[], style: PathStyle): void {
  const sampled = sampleSpline(controls);
  // 傳球停在接球者邊緣；移動路線停在終點分身的邊緣，箭頭和 T 字才不會被蓋住
  const endTrim =
    style.kind === 'pass'
      ? PLAYER_RADIUS + 0.05
      : style.kind === 'shot'
        ? SHOT_RING_RADIUS
        : style.preview
          ? 0
          : PLAYER_RADIUS * 0.86;
  const body = trimPolyline(sampled, PLAYER_RADIUS, endTrim);
  if (body.length < 2) return;

  const tipIndex = body.length - 1;
  const tip = body[tipIndex]!;
  const dir = normalize(sub(tip, body[tipIndex - 1]!));
  const hasArrow = style.kind !== 'screen' && style.kind !== 'shot';
  // 線身停在箭頭底部，避免從箭頭尖端穿出去
  const line = hasArrow ? trimPolyline(body, 0, ARROW_LEN * 0.8) : body;
  const color = theme.path[style.team];

  ctx.save();
  ctx.globalAlpha = style.preview ? 0.6 : style.faded ? 0.3 : 1;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const strokeLine = (pts: readonly Vec2[], width: number, strokeStyle: string) => {
    if (pts.length < 2) return;
    ctx.lineWidth = width;
    ctx.strokeStyle = strokeStyle;
    ctx.beginPath();
    pts.forEach((p, i) => {
      const s = toScreen(vp, p);
      if (i === 0) ctx.moveTo(s.x, s.y);
      else ctx.lineTo(s.x, s.y);
    });
    ctx.stroke();
  };

  const shape = style.kind === 'dribble' ? wave(line) : line;
  const decorations: Vec2[][] = [];
  if (style.kind === 'screen') {
    const n = perp(dir);
    decorations.push([
      { x: tip.x + n.x * SCREEN_BAR_HALF, y: tip.y + n.y * SCREEN_BAR_HALF },
      { x: tip.x - n.x * SCREEN_BAR_HALF, y: tip.y - n.y * SCREEN_BAR_HALF },
    ]);
  }

  // 選取時，先在下面畫一層白色外光
  if (style.selected) {
    ctx.setLineDash([]);
    strokeLine(shape, LINE_PX + 6, theme.selection);
    for (const d of decorations) strokeLine(d, LINE_PX + 8, theme.selection);
    if (hasArrow) fillArrow(ctx, vp, tip, dir, theme.selection, 0.12);
  }

  ctx.setLineDash(style.kind === 'pass' ? [9, 7] : style.kind === 'shot' ? [1, 8] : []);
  strokeLine(shape, style.kind === 'shot' ? LINE_PX + 1.5 : LINE_PX, color);
  ctx.setLineDash([]);
  if (style.kind === 'shot') {
    // 籃框外的目標圈
    const rim = controls.at(-1)!;
    const c = toScreen(vp, rim);
    const r = SHOT_RING_RADIUS * vp.scale;
    if (style.selected) {
      ctx.lineWidth = LINE_PX + 6;
      ctx.strokeStyle = theme.selection;
      ctx.beginPath();
      ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.lineWidth = LINE_PX;
    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  for (const d of decorations) strokeLine(d, LINE_PX + 1.5, color);
  if (hasArrow) fillArrow(ctx, vp, tip, dir, color, 0);
  ctx.restore();
}

function fillArrow(ctx: CanvasRenderingContext2D, vp: Viewport, tip: Vec2, dir: Vec2, color: string, grow: number): void {
  const n = perp(dir);
  const len = ARROW_LEN + grow;
  const half = ARROW_HALF_WIDTH + grow;
  const base = { x: tip.x - dir.x * len, y: tip.y - dir.y * len };
  const pts = [
    { x: tip.x + dir.x * grow, y: tip.y + dir.y * grow },
    { x: base.x + n.x * half, y: base.y + n.y * half },
    { x: base.x - n.x * half, y: base.y - n.y * half },
  ].map((p) => toScreen(vp, p));
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(pts[0]!.x, pts[0]!.y);
  ctx.lineTo(pts[1]!.x, pts[1]!.y);
  ctx.lineTo(pts[2]!.x, pts[2]!.y);
  ctx.closePath();
  ctx.fill();
}

/** 運球的波浪線：沿著折線的法向量做正弦位移，頭尾漸弱，讓箭頭和起點乾淨 */
function wave(pts: readonly Vec2[]): Vec2[] {
  const total = polylineLength(pts);
  if (total === 0) return [...pts];
  // 重新取樣成等距的點，波形才會均勻
  const step = WAVE_LENGTH / 10;
  const out: Vec2[] = [];
  for (let s = 0; s <= total; s += step) out.push(sampleAt(pts, s, total));
  out.push(sampleAt(pts, total, total));
  const ramp = 0.35;
  return out.map((p, i) => {
    const s = Math.min(i * step, total);
    const prev = out[Math.max(0, i - 1)]!;
    const next = out[Math.min(out.length - 1, i + 1)]!;
    const n = perp(normalize(sub(next, prev)));
    const fade = Math.min(1, s / ramp, (total - s) / ramp);
    const off = Math.sin((s / WAVE_LENGTH) * Math.PI * 2) * WAVE_AMPLITUDE * Math.max(0, fade);
    return { x: p.x + n.x * off, y: p.y + n.y * off };
  });
}

function sampleAt(pts: readonly Vec2[], s: number, total: number): Vec2 {
  if (s >= total) return pts.at(-1)!;
  let walked = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    const seg = Math.hypot(b.x - a.x, b.y - a.y);
    if (walked + seg >= s && seg > 0) {
      const t = (s - walked) / seg;
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    }
    walked += seg;
  }
  return pts.at(-1)!;
}

/** 移動路線終點的半透明分身，讓使用者知道球員會停在哪 */
export function drawGhost(ctx: CanvasRenderingContext2D, vp: Viewport, player: Player, pos: Vec2): void {
  const c = toScreen(vp, pos);
  const r = PLAYER_RADIUS * vp.scale;
  const colors = player.team === 'blue' ? theme.blue : theme.red;
  ctx.save();
  // 淺色底 + 隊伍色的虛線外框與號碼：在橘色地板上仍分得出藍紅
  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  ctx.beginPath();
  ctx.arc(c.x, c.y, r * 0.86, 0, Math.PI * 2);
  ctx.fill();
  ctx.setLineDash([5, 4]);
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = colors.dark;
  ctx.stroke();
  ctx.fillStyle = colors.dark;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `700 ${Math.round(r * 0.7)}px ${theme.font}`;
  ctx.fillText(String(player.number), c.x, c.y + r * 0.04);
  ctx.restore();
}

export const HANDLE_PX = 9;

export function drawHandles(ctx: CanvasRenderingContext2D, vp: Viewport, handles: readonly Handle[]): void {
  ctx.save();
  for (const h of handles) {
    const c = toScreen(vp, h.pos);
    if (h.type === 'point') {
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = '#1b1b1f';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(c.x, c.y, HANDLE_PX, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    } else {
      const r = HANDLE_PX * 0.75;
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      ctx.beginPath();
      ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#1b1b1f';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(c.x - r * 0.55, c.y);
      ctx.lineTo(c.x + r * 0.55, c.y);
      ctx.moveTo(c.x, c.y - r * 0.55);
      ctx.lineTo(c.x, c.y + r * 0.55);
      ctx.stroke();
    }
  }
  ctx.restore();
}
