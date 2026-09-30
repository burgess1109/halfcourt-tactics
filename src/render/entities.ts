import { BALL_RADIUS, PLAYER_RADIUS } from '../model/entities';
import type { Player, Vec2 } from '../model/types';
import { theme } from './theme';
import { toScreen, type Viewport } from './viewport';

// 這裡的 ctx 使用 CSS px 座標（呼叫端已經乘上 dpr）

export function drawPlayer(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  player: Player,
  pos: Vec2,
  active: boolean,
): void {
  const c = toScreen(vp, pos);
  const r = PLAYER_RADIUS * vp.scale * (active ? 1.08 : 1);
  const colors = player.team === 'blue' ? theme.blue : theme.red;

  ctx.save();
  // 白框 + 陰影
  ctx.shadowColor = 'rgba(0,0,0,0.35)';
  ctx.shadowBlur = r * (active ? 0.6 : 0.35);
  ctx.shadowOffsetY = r * (active ? 0.18 : 0.1);
  ctx.fillStyle = theme.ring;
  ctx.beginPath();
  ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // 本體：由左上往右下的漸層
  const inner = r * 0.86;
  const grad = ctx.createRadialGradient(c.x - inner * 0.3, c.y - inner * 0.4, inner * 0.1, c.x, c.y, inner);
  grad.addColorStop(0, colors.light);
  grad.addColorStop(1, colors.dark);
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(c.x, c.y, inner, 0, Math.PI * 2);
  ctx.fill();

  // 號碼
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `700 ${Math.round(r * 0.78)}px ${theme.font}`;
  ctx.fillText(String(player.number), c.x, c.y + r * 0.04);
}

/** 名字另外畫：所有圓標畫完後才畫，避免被相鄰的球員蓋住 */
export function drawPlayerLabel(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  player: Player,
  pos: Vec2,
  active: boolean,
): void {
  const c = toScreen(vp, pos);
  const r = PLAYER_RADIUS * vp.scale * (active ? 1.08 : 1);
  const labelSize = Math.max(10, Math.round(PLAYER_RADIUS * vp.scale * 0.55));
  ctx.font = `600 ${labelSize}px ${theme.font}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.shadowColor = 'rgba(0,0,0,0.35)';
  ctx.shadowBlur = 3;
  ctx.fillStyle = theme.label;
  ctx.fillText(player.name, c.x, c.y + r + labelSize * 0.2);
  ctx.shadowColor = 'transparent';
}

export function drawBall(ctx: CanvasRenderingContext2D, vp: Viewport, pos: Vec2, active: boolean): void {
  const c = toScreen(vp, pos);
  const r = BALL_RADIUS * vp.scale * (active ? 1.1 : 1);

  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.35)';
  ctx.shadowBlur = r * 0.4;
  ctx.shadowOffsetY = r * 0.12;
  const grad = ctx.createRadialGradient(c.x - r * 0.35, c.y - r * 0.35, r * 0.1, c.x, c.y, r);
  grad.addColorStop(0, theme.ball.light);
  grad.addColorStop(1, theme.ball.dark);
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // 球紋：外框、橫線、直線、兩條弧線
  ctx.save();
  ctx.beginPath();
  ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
  ctx.clip();
  ctx.strokeStyle = theme.ball.seam;
  ctx.lineWidth = Math.max(1, r * 0.06);
  ctx.beginPath();
  ctx.arc(c.x, c.y, r - ctx.lineWidth / 2, 0, Math.PI * 2);
  ctx.moveTo(c.x - r, c.y);
  ctx.lineTo(c.x + r, c.y);
  ctx.moveTo(c.x, c.y - r);
  ctx.lineTo(c.x, c.y + r);
  ctx.moveTo(c.x - r * 0.62, c.y - r * 0.8);
  ctx.quadraticCurveTo(c.x - r * 0.15, c.y, c.x - r * 0.62, c.y + r * 0.8);
  ctx.moveTo(c.x + r * 0.62, c.y - r * 0.8);
  ctx.quadraticCurveTo(c.x + r * 0.15, c.y, c.x + r * 0.62, c.y + r * 0.8);
  ctx.stroke();
  ctx.restore();
}
