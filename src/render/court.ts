import {
  BACKBOARD_HALF_WIDTH,
  BACKBOARD_Y,
  BASKET_Y,
  CENTER_CIRCLE_RADIUS,
  COURT_DEPTH,
  COURT_HALF_WIDTH,
  FREE_THROW_RADIUS,
  PAINT_DEPTH,
  PAINT_HALF_WIDTH,
  RESTRICTED_RADIUS,
  RIM_RADIUS,
  THREE_POINT_CORNER_X,
  THREE_POINT_CORNER_Y,
  THREE_POINT_RADIUS,
  VIEW_BOUNDS,
} from '../court/fiba';
import { theme } from './theme';
import type { Viewport } from './viewport';

const LINE_PX = 2.5;

/**
 * 畫半場。ctx 使用裝置像素；函式內部切換成世界座標（y 朝上），
 * 所以下面的圓弧角度都是一般數學座標的角度。
 */
export function drawCourt(ctx: CanvasRenderingContext2D, vp: Viewport, dpr: number): void {
  ctx.save();
  ctx.setTransform(dpr * vp.scale, 0, 0, -dpr * vp.scale, dpr * vp.originX, dpr * vp.originY);
  const px = 1 / vp.scale; // 1 CSS px 換算成公尺

  // 地板（圓角面板）
  ctx.fillStyle = theme.floor;
  ctx.beginPath();
  ctx.roundRect(
    VIEW_BOUNDS.minX,
    VIEW_BOUNDS.minY,
    VIEW_BOUNDS.maxX - VIEW_BOUNDS.minX,
    VIEW_BOUNDS.maxY - VIEW_BOUNDS.minY,
    0.7,
  );
  ctx.fill();

  // 禁區漸層：靠底線深、靠罰球線淺
  const paint = ctx.createLinearGradient(0, 0, 0, PAINT_DEPTH);
  paint.addColorStop(0, theme.paintBottom);
  paint.addColorStop(1, theme.paintTop);
  ctx.fillStyle = paint;
  ctx.fillRect(-PAINT_HALF_WIDTH, 0, PAINT_HALF_WIDTH * 2, PAINT_DEPTH);

  ctx.strokeStyle = theme.line;
  ctx.lineWidth = LINE_PX * px;
  ctx.lineCap = 'butt';

  const stroke = (build: () => void) => {
    ctx.beginPath();
    build();
    ctx.stroke();
  };

  // 邊界（邊線、底線、中線）
  stroke(() => ctx.rect(-COURT_HALF_WIDTH, 0, COURT_HALF_WIDTH * 2, COURT_DEPTH));

  // 中圈（只畫本場這一半）
  stroke(() => ctx.arc(0, COURT_DEPTH, CENTER_CIRCLE_RADIUS, Math.PI, Math.PI * 2));

  // 禁區
  stroke(() => ctx.rect(-PAINT_HALF_WIDTH, 0, PAINT_HALF_WIDTH * 2, PAINT_DEPTH));

  // 罰球圈：禁區外實線，禁區內虛線
  stroke(() => ctx.arc(0, PAINT_DEPTH, FREE_THROW_RADIUS, 0, Math.PI));
  ctx.setLineDash([0.3, 0.25]);
  stroke(() => ctx.arc(0, PAINT_DEPTH, FREE_THROW_RADIUS, Math.PI, Math.PI * 2));
  ctx.setLineDash([]);

  // 三分線：底角直線 + 弧線
  const cornerAngle = Math.atan2(THREE_POINT_CORNER_Y - BASKET_Y, THREE_POINT_CORNER_X);
  stroke(() => {
    ctx.moveTo(THREE_POINT_CORNER_X, 0);
    ctx.lineTo(THREE_POINT_CORNER_X, THREE_POINT_CORNER_Y);
    ctx.arc(0, BASKET_Y, THREE_POINT_RADIUS, cornerAngle, Math.PI - cornerAngle);
    ctx.lineTo(-THREE_POINT_CORNER_X, 0);
  });

  // 合理衝撞區（細線）
  ctx.lineWidth = LINE_PX * 0.7 * px;
  stroke(() => {
    ctx.moveTo(RESTRICTED_RADIUS, BACKBOARD_Y);
    ctx.lineTo(RESTRICTED_RADIUS, BASKET_Y);
    ctx.arc(0, BASKET_Y, RESTRICTED_RADIUS, 0, Math.PI);
    ctx.lineTo(-RESTRICTED_RADIUS, BACKBOARD_Y);
  });

  // 籃板與籃框
  ctx.lineWidth = LINE_PX * 1.2 * px;
  stroke(() => {
    ctx.moveTo(-BACKBOARD_HALF_WIDTH, BACKBOARD_Y);
    ctx.lineTo(BACKBOARD_HALF_WIDTH, BACKBOARD_Y);
  });
  ctx.lineWidth = LINE_PX * px;
  stroke(() => {
    ctx.moveTo(0, BACKBOARD_Y);
    ctx.lineTo(0, BASKET_Y - RIM_RADIUS);
  });
  stroke(() => ctx.arc(0, BASKET_Y, RIM_RADIUS, 0, Math.PI * 2));

  ctx.restore();
}
