// FIBA 半場尺寸（公尺），對應 docs/SPEC.md §2。
// 座標：原點在底線中點，x 向右，y 朝中場。

export const COURT_HALF_WIDTH = 7.5;
export const COURT_DEPTH = 14;

/** 場外邊距：可視範圍 = 球場 + 邊距 */
export const COURT_MARGIN = 0.8;

export const BASKET_Y = 1.575;
export const RIM_RADIUS = 0.225;
export const BACKBOARD_Y = 1.2;
export const BACKBOARD_HALF_WIDTH = 0.9;

export const PAINT_HALF_WIDTH = 2.45;
export const PAINT_DEPTH = 5.8;

export const FREE_THROW_RADIUS = 1.8;
export const RESTRICTED_RADIUS = 1.25;
export const CENTER_CIRCLE_RADIUS = 1.8;

export const THREE_POINT_RADIUS = 6.75;
/** 底角三分線與邊線的距離 */
export const THREE_POINT_CORNER_INSET = 0.9;
export const THREE_POINT_CORNER_X = COURT_HALF_WIDTH - THREE_POINT_CORNER_INSET;
/** 底角直線與弧線的交接點高度 */
export const THREE_POINT_CORNER_Y =
  BASKET_Y + Math.sqrt(THREE_POINT_RADIUS ** 2 - THREE_POINT_CORNER_X ** 2);

/** 可視範圍（世界座標） */
export const VIEW_BOUNDS = {
  minX: -COURT_HALF_WIDTH - COURT_MARGIN,
  maxX: COURT_HALF_WIDTH + COURT_MARGIN,
  minY: -COURT_MARGIN,
  maxY: COURT_DEPTH + COURT_MARGIN,
} as const;
