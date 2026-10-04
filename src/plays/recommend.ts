import { RATING_LABEL, SKILL_LABEL, heightOf, skillsOf, speedOf } from '../model/physique';
import { simulate } from '../anim/simulation';
import { evaluate } from '../sim/evaluate';
import type { Grade, Player, Skills, Tactic } from '../model/types';
import { PLAYS, ROLES, type Play, type Role, type RoleWeights } from './library';
import { loadPlay, type RoleAssignment } from './instantiate';

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
  /** 適合度 0–4，2 = 平均（只看能力與權重，用來決定角色分配） */
  score: number;
  reason: string;
  /** 用這個角色分配實際模擬後的預期得分與評等（有跑過模擬才有） */
  expectedPoints?: number;
  grade?: Grade;
}

/**
 * 用推薦的角色分配實際模擬、評分一次；評分自己跑完整模擬，所以載入時不必先算紅隊位置。
 * 一律用自動防守評分（關閉自動防守時紅隊不會動，無法比較戰術的好壞）。
 */
export function withSimulation(tactic: Tactic, rec: Recommendation): Recommendation {
  const loaded = loadPlay({ ...tactic, autoDefense: true }, rec.play, rec.roles, { defense: false });
  const e = evaluate(loaded, simulate(loaded));
  // 內建戰術一定有投籃，所以一定有分數
  return { ...rec, expectedPoints: e.expectedPoints ?? 0, grade: e.grade ?? 'D' };
}

/** 依預期得分排序；同分時看適合度，再維持戰術庫順序 */
export function sortBySimulation(list: readonly Recommendation[]): Recommendation[] {
  const order = (r: Recommendation) => PLAYS.indexOf(r.play);
  return [...list].sort(
    (a, b) =>
      (b.expectedPoints ?? 0) - (a.expectedPoints ?? 0) || b.score - a.score || order(a) - order(b),
  );
}

/** 推薦（SPEC §6.3）：角色分配看適合度，排序看實際模擬的預期得分 */
export function rankBySimulation(tactic: Tactic): Recommendation[] {
  return sortBySimulation(PLAYS.map((play) => withSimulation(tactic, bestAssignment(tactic, play))));
}

/** 推薦結果只和球員、對位、掩護應對有關（和目前畫的路線無關），用來快取 */
export function recommendationKey(tactic: Tactic): string {
  return JSON.stringify({ players: tactic.players, matchups: tactic.matchups, screen: tactic.screenDefense, pick: tactic.pickCoverage, pressure: tactic.pressure, help: tactic.driveHelp });
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

export function recommend(
  tactic: Tactic,
  count = RECOMMEND_COUNT,
  ranked: readonly Recommendation[] = rankBySimulation(tactic),
): Recommendation[] {
  return ranked.slice(0, count);
}

// ---- 球隊總評（SPEC §6.3） ----

/** 強項的門檻：能力「稍強」以上；身高高 5 cm 以上；速度快 5% 以上（都是分數 ≥ 3） */
const STRENGTH_SCORE = 3;

const STYLE: Record<WeightKey, string> = {
  shooting: '外線出手',
  finishing: '切入或下順到籃下終結',
  iso: '持球單打',
  speed: '空切、背切或持球切入',
  height: '低位要位或擋拆下順',
};

export interface Strength {
  playerId: string;
  key: WeightKey;
  score: number;
  /** 例如「外線投射「優勢」」「比對位的防守者高 8 cm」 */
  label: string;
  style: string;
  /** 由這位球員終結、而且看重這一項的戰術，最多 2 套 */
  examples: Play[];
}

export interface TeamSummary {
  strengths: Strength[];
  advice: string;
}

function strengthLabel(tactic: Tactic, blue: Player, key: WeightKey): string {
  const { players } = tactic;
  if (key === 'height') return `比對位的防守者高 ${heightOf(blue, players) - heightOf(defenderOf(tactic, blue), players)} cm`;
  if (key === 'speed') return `比對位的防守者快 ${Math.round((speedRatio(tactic, blue) - 1) * 100)}%`;
  return `${SKILL_LABEL[key]}「${RATING_LABEL[skillsOf(blue)[key]]}」`;
}

/** ranked 預設為依預期得分排序的結果，總評的「最適合的戰術」才會跟推薦清單一致 */
export function teamSummary(tactic: Tactic, ranked: readonly Recommendation[] = rankBySimulation(tactic)): TeamSummary {
  const keys: WeightKey[] = ['shooting', 'finishing', 'iso', 'speed', 'height'];
  const strengths: Strength[] = [];

  for (const blue of tactic.players.filter((p) => p.team === 'blue')) {
    for (const key of keys) {
      const score = attributeScore(tactic, blue, key);
      if (score < STRENGTH_SCORE) continue;
      const examples = ranked
        .filter((r) => r.roles[r.play.finisher] === blue.id && (r.play.weights[r.play.finisher][key] ?? 0) > 0)
        .slice(0, 2)
        .map((r) => r.play);
      strengths.push({ playerId: blue.id, key, score, label: strengthLabel(tactic, blue, key), style: STYLE[key], examples });
    }
  }
  // 越強的排越前面；同分時，對應戰術在推薦裡排越前面的優先（總評才會跟推薦清單一致）
  const rankOf = (s: Strength) => (s.examples[0] ? ranked.findIndex((r) => r.play === s.examples[0]) : ranked.length);
  strengths.sort((a, b) => b.score - a.score || rankOf(a) - rankOf(b));

  const top = ranked[0]!;
  let advice: string;
  if (strengths.length === 0) {
    advice = '球隊能力都在平均水準，沒有特別突出的強項，可以從適合度最高的戰術開始，再依實際比賽調整。';
  } else {
    const first = strengths[0]!;
    const firstName = playerLabel(tactic.players.find((p) => p.id === first.playerId)!);
    const second = strengths.find((s) => s.playerId !== first.playerId);
    advice = `建議以 ${firstName} 的${first.style}為主要攻擊點`;
    if (second) {
      const secondName = playerLabel(tactic.players.find((p) => p.id === second.playerId)!);
      advice += `，${secondName} 的${second.style}當第二選擇`;
    }
    advice += `。最適合的戰術是「${top.play.category}-${top.play.name}」${top.grade ? `（預期 ${top.grade}）` : ''}。`;
  }
  return { strengths, advice };
}
