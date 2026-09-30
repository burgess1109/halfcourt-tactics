import type { Player, Position } from './types';

// 身高體重與速度模型，對應 SPEC §7。

export const POSITIONS: readonly Position[] = ['PG', 'SG', 'SF', 'PF', 'C'];

const DEFAULTS: Record<Position | 'none', { heightCm: number; weightKg: number }> = {
  PG: { heightCm: 185, weightKg: 80 },
  SG: { heightCm: 193, weightKg: 88 },
  SF: { heightCm: 201, weightKg: 98 },
  PF: { heightCm: 206, weightKg: 108 },
  C: { heightCm: 211, weightKg: 115 },
  none: { heightCm: 198, weightKg: 95 },
};

export const HEIGHT_RANGE = { min: 150, max: 230 } as const;
export const WEIGHT_RANGE = { min: 50, max: 150 } as const;

/** 無球跑動的基準速度（m/s） */
export const BASE_SPEED = 5.0;
export const DRIBBLE_FACTOR = 0.85;
/** 傳球速度（m/s），SPEC §5 */
export const PASS_SPEED = 12;

/** 實際使用的身高體重：未填時依位置套用預設值（SPEC §7.3） */
export function physique(p: Player): { heightCm: number; weightKg: number } {
  const d = DEFAULTS[p.position ?? 'none'];
  return { heightCm: p.heightCm ?? d.heightCm, weightKg: p.weightKg ?? d.weightKg };
}

export function speedOf(p: Player, dribbling: boolean): number {
  const { heightCm, weightKg } = physique(p);
  const factor = Math.min(1.15, Math.max(0.85, 1 - 0.004 * (heightCm - 195) - 0.003 * (weightKg - 90)));
  return BASE_SPEED * factor * (dribbling ? DRIBBLE_FACTOR : 1);
}
