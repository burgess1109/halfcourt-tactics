import type { ScoringRule, Tactic } from './types';

// 計分規則（SPEC §6.4）：比賽設定頁選擇，存在戰術裡（分享連結才能重現同樣的評分）。

export interface ScoringSpec {
  label: string;
  /** 說明（設定頁顯示） */
  description: string;
  /** 弧內一球幾分 */
  inside: number;
  /** 弧外一球幾分 */
  outside: number;
  /** 進攻時限（秒） */
  shotClock: number;
}

export const SCORING_RULES: Record<ScoringRule, ScoringSpec> = {
  fiba3x3: { label: 'FIBA 3x3', description: '弧內 1 分、弧外 2 分，進攻時限 12 秒', inside: 1, outside: 2, shotClock: 12 },
  standard: { label: '一般規則', description: '弧內 2 分、弧外 3 分，進攻時限 24 秒', inside: 2, outside: 3, shotClock: 24 },
};

export const scoringOf = (tactic: Tactic): ScoringSpec => SCORING_RULES[tactic.scoring];

/** 進攻時限（秒） */
export const shotClockOf = (tactic: Tactic): number => scoringOf(tactic).shotClock;

/**
 * 0–100 分的評分：預期得分 ÷ 弧內一球的分數 × 100，也就是「有效命中率」（eFG%）。
 * 兩種計分規則可以直接比較，評等門檻共用。理論上可能超過 100（例如 FIBA 規則下命中率超過 50% 的弧外球），顯示時上限 100。
 */
export function scoreOf(expectedPoints: number, rule: ScoringSpec): number {
  return Math.min(100, (expectedPoints / rule.inside) * 100);
}
