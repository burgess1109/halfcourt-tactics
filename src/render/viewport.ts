import { VIEW_BOUNDS } from '../court/fiba';
import type { Vec2 } from '../model/types';

/** 世界座標（公尺，y 朝上）與螢幕座標（CSS px，y 朝下）的轉換 */
export interface Viewport {
  /** 每公尺多少 CSS px */
  scale: number;
  /** 世界原點 (0,0) 在螢幕上的位置 */
  originX: number;
  originY: number;
}

/** 讓可視範圍置中並完整塞進 width × height */
export function fitViewport(width: number, height: number): Viewport {
  const viewW = VIEW_BOUNDS.maxX - VIEW_BOUNDS.minX;
  const viewH = VIEW_BOUNDS.maxY - VIEW_BOUNDS.minY;
  const scale = Math.max(0, Math.min(width / viewW, height / viewH));
  const centerX = (VIEW_BOUNDS.minX + VIEW_BOUNDS.maxX) / 2;
  const centerY = (VIEW_BOUNDS.minY + VIEW_BOUNDS.maxY) / 2;
  return {
    scale,
    originX: width / 2 - centerX * scale,
    originY: height / 2 + centerY * scale,
  };
}

export function toScreen(vp: Viewport, p: Vec2): Vec2 {
  return { x: vp.originX + p.x * vp.scale, y: vp.originY - p.y * vp.scale };
}

export function toWorld(vp: Viewport, sx: number, sy: number): Vec2 {
  return { x: (sx - vp.originX) / vp.scale, y: (vp.originY - sy) / vp.scale };
}
