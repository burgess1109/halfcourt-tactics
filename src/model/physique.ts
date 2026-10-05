import type { Player, Rating, Skills } from './types';

// 球員能力模型，對應 SPEC §7。

export const RATINGS: readonly Rating[] = [4, 3, 2, 1, 0];
/** 等級名稱：藍隊五項能力與紅隊速度共用，以場上六個人的平均為基準 */
export const RATING_LABEL: Record<Rating, string> = { 4: '優勢', 3: '稍強', 2: '平均', 1: '稍弱', 0: '劣勢' };

export const SKILL_LABEL: Record<keyof Skills, string> = {
  midRange: '中距離投射',
  threePoint: '弧外投射',
  speed: '速度',
  finishing: '禁區終結',
  iso: '單打',
};
export const SKILL_KEYS = Object.keys(SKILL_LABEL) as (keyof Skills)[];

export const DEFAULT_SKILLS: Skills = { midRange: 2, threePoint: 2, speed: 2, finishing: 2, iso: 2 };

export const HEIGHT_RANGE = { min: 150, max: 230 } as const;
/** 沒填身高時使用的值；也是速度公式的身高基準（這個身高 = 基準速度） */
export const DEFAULT_HEIGHT = 175;

/** 無球跑動的基準速度（m/s） */
export const BASE_SPEED = 5.0;
export const DRIBBLE_FACTOR = 0.85;
/** 速度等級的倍率：0 → 4（藍隊能力與紅隊速度共用） */
const SPEED_RATING_FACTOR: Record<Rating, number> = { 0: 0.9, 1: 0.95, 2: 1, 3: 1.05, 4: 1.1 };
/** 傳球速度（m/s），SPEC §5 */
export const PASS_SPEED = 12;
/** 投籃時球的水平速度（m/s）；三分球約 0.9 秒進框 */
export const SHOT_SPEED = 8;
/** 投籃最短飛行時間（秒），讓近距離上籃也看得到球飛 */
export const MIN_SHOT_FLIGHT = 0.5;

/** 對應的另一隊同順序球員：b2 ↔ r2 */
export function counterpartId(id: string): string {
  return (id.startsWith('b') ? 'r' : 'b') + id.slice(1);
}

/**
 * 模型使用的身高（SPEC §7.4）：
 * 藍隊沒填用 175；紅隊沒填則跟藍隊同順序球員一樣（藍隊也沒填則 175）。
 */
export function heightOf(p: Player, players: readonly Player[]): number {
  if (p.heightCm !== undefined) return p.heightCm;
  if (p.team === 'red') {
    const blue = players.find((x) => x.id === counterpartId(p.id));
    if (blue?.heightCm !== undefined) return blue.heightCm;
  }
  return DEFAULT_HEIGHT;
}

export function skillsOf(p: Player): Skills {
  return p.skills ?? DEFAULT_SKILLS;
}

/** speed = base × 身高係數 × 速度等級（藍隊看能力的速度，紅隊看自己的速度設定） */
export function speedOf(p: Player, players: readonly Player[], dribbling: boolean): number {
  const height = Math.min(1.08, Math.max(0.92, 1 - 0.003 * (heightOf(p, players) - DEFAULT_HEIGHT)));
  const rating = SPEED_RATING_FACTOR[p.team === 'blue' ? skillsOf(p).speed : (p.speedRating ?? 2)];
  return BASE_SPEED * height * rating * (dribbling ? DRIBBLE_FACTOR : 1);
}
