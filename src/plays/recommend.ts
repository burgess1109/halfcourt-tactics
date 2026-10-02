import { RATING_LABEL, SKILL_LABEL, heightOf, skillsOf, speedOf } from '../model/physique';
import type { Player, Skills, Tactic } from '../model/types';
import { PLAYS, ROLES, type Play, type Role, type RoleWeights } from './library';
import type { RoleAssignment } from './instantiate';

// 推薦演算法（SPEC §6.3）：完全決定性。
// - 外線投射、禁區終結、單打：直接用能力等級（0–4 分）
// - 身高、速度：跟「對位的防守者」比，每差 HEIGHT_STEP_CM / SPEED_STEP 算一級，平均 = 2 分
// - 每套戰術的分數 = Σ 權重 × 分數 ÷ Σ 權重（0–4），權重項目多的戰術不會因此佔便宜

export const HEIGHT_STEP_CM = 5;
export const SPEED_STEP = 0.05;
export const RECOMMEND_COUNT = 5;

type WeightKey = keyof RoleWeights;

const clamp04 = (v: number) => Math.min(4, Math.max(0, v));
const playerLabel = (p: Player) => `${p.number} 號 ${p.name}`;

function defenderOf(tactic: Tactic, blue: Player): Player {
  const redId = tactic.matchups[blue.id];
  return tactic.players.find((p) => p.id === redId)!;
}

/** 藍隊球員跑動速度 ÷ 對位防守者的跑動速度 */
function speedRatio(tactic: Tactic, blue: Player): number {
  return speedOf(blue, tactic.players, false) / speedOf(defenderOf(tactic, blue), tactic.players, false);
}

/** 某位藍隊球員在某一項的分數（0–4） */
export function attributeScore(tactic: Tactic, blue: Player, key: WeightKey): number {
  const { players } = tactic;
  if (key === 'height') {
    const diff = heightOf(blue, players) - heightOf(defenderOf(tactic, blue), players);
    return clamp04(2 + diff / HEIGHT_STEP_CM);
  }
  if (key === 'speed') return clamp04(2 + (speedRatio(tactic, blue) - 1) / SPEED_STEP);
  return skillsOf(blue)[key];
}

/** 一句推薦理由：取「比平均好最多」的那一項 */
function reasonFor(tactic: Tactic, play: Play, roles: RoleAssignment): string {
  let best: { role: Role; key: WeightKey; gain: number } | null = null;
  for (const role of ROLES) {
    const blue = tactic.players.find((p) => p.id === roles[role])!;
    for (const [key, w] of Object.entries(play.weights[role]) as [WeightKey, number][]) {
      // 速度快不到 1%（四捨五入後顯示 0%）時不拿來當理由
      if (key === 'speed' && Math.round((speedRatio(tactic, blue) - 1) * 100) < 1) continue;
      const gain = w * (attributeScore(tactic, blue, key) - 2);
      if (gain > 0 && (!best || gain > best.gain)) best = { role, key, gain };
    }
  }
  if (!best) return `能力都在平均水準，${play.finish}`;
  const blue = tactic.players.find((p) => p.id === roles[best.role])!;
  const { players } = tactic;
  let what: string;
  if (best.key === 'height') {
    const diff = heightOf(blue, players) - heightOf(defenderOf(tactic, blue), players);
    what = ` 比對位的防守者高 ${diff} cm`;
  } else if (best.key === 'speed') {
    what = ` 比對位的防守者快 ${Math.round((speedRatio(tactic, blue) - 1) * 100)}%`;
  } else {
    const key = best.key as keyof Skills;
    what = ` 的${SKILL_LABEL[key]}「${RATING_LABEL[skillsOf(blue)[key]]}」`;
  }
  return `${playerLabel(blue)}${what}，擔任 ${best.role}（${play.roles[best.role]}）`;
}

/** 三名藍隊球員的 6 種排列（固定順序，確保結果決定性） */
function permutations(ids: string[]): string[][] {
  if (ids.length <= 1) return [ids];
  return ids.flatMap((id, i) => permutations([...ids.slice(0, i), ...ids.slice(i + 1)]).map((rest) => [id, ...rest]));
}

export function scoreAssignment(tactic: Tactic, play: Play, roles: RoleAssignment): number {
  let sum = 0;
  let weight = 0;
  for (const role of ROLES) {
    const blue = tactic.players.find((p) => p.id === roles[role])!;
    for (const [key, w] of Object.entries(play.weights[role]) as [WeightKey, number][]) {
      sum += w * attributeScore(tactic, blue, key);
      weight += w;
    }
  }
  return weight === 0 ? 2 : sum / weight;
}

export interface Recommendation {
  play: Play;
  roles: RoleAssignment;
  /** 0–4，2 = 平均 */
  score: number;
  reason: string;
}

/** 這套戰術最適合的角色分配；同分時取排列順序在前的 */
export function bestAssignment(tactic: Tactic, play: Play): Recommendation {
  const blueIds = tactic.players.filter((p) => p.team === 'blue').map((p) => p.id);
  let best: { roles: RoleAssignment; score: number } | null = null;
  for (const [a, b, c] of permutations(blueIds)) {
    const roles: RoleAssignment = { A: a!, B: b!, C: c! };
    const score = scoreAssignment(tactic, play, roles);
    if (!best || score > best.score + 1e-9) best = { roles, score };
  }
  return { play, roles: best!.roles, score: best!.score, reason: reasonFor(tactic, play, best!.roles) };
}

/** 所有戰術依分數排序（同分時維持戰術庫順序） */
export function rankPlays(tactic: Tactic): Recommendation[] {
  return PLAYS.map((play, i) => ({ r: bestAssignment(tactic, play), i }))
    .sort((x, y) => y.r.score - x.r.score || x.i - y.i)
    .map((x) => x.r);
}

export function recommend(tactic: Tactic, count = RECOMMEND_COUNT): Recommendation[] {
  return rankPlays(tactic).slice(0, count);
}
