import { sameData } from './equal';
import { heightOf } from './physique';
import type { Player, Tactic } from './types';

// 對位，對應 SPEC §6.2。

const ofTeam = (players: readonly Player[], team: Player['team']) => players.filter((p) => p.team === team);

/**
 * 預設對位：藍隊三人都有填身高 → 依身高排序配對（最高對最高）；否則依順序配對。
 * 排序是穩定的，同高時維持原本順序。
 */
export function defaultMatchups(players: readonly Player[]): Record<string, string> {
  const blue = ofTeam(players, 'blue');
  const red = ofTeam(players, 'red');
  const byHeight = blue.every((p) => p.heightCm !== undefined);
  const order = (list: Player[]) =>
    byHeight ? [...list].sort((a, b) => heightOf(b, players) - heightOf(a, players)) : list;
  const b = order(blue);
  const r = order(red);
  return Object.fromEntries(b.map((p, i) => [p.id, r[i]!.id]));
}

/** 讓 blueId 改盯 redId；原本盯 redId 的藍隊球員改盯 blueId 原本的對象 */
export function assignMatchup(matchups: Record<string, string>, blueId: string, redId: string): Record<string, string> {
  const next = { ...matchups };
  const previous = next[blueId]!;
  const other = Object.keys(next).find((b) => next[b] === redId);
  next[blueId] = redId;
  if (other && other !== blueId) next[other] = previous;
  return next;
}

/** 紅隊 id → 對位的藍隊 id */
export function defenderAssignments(matchups: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(matchups).map(([b, r]) => [r, b]));
}

/**
 * 改對位（所有改對位的地方都用這個）：內容真的變了才清掉手動防守時拖過的紅隊開局位置（redStarts），
 * 那些位置是照舊對位擺的。用 sameData 比對，不受欄位順序影響（預設對位依身高排序，欄位順序可能不同）。
 */
export function setMatchups(tactic: Tactic, next: Record<string, string>): void {
  if (!sameData(tactic.matchups, next)) delete tactic.redStarts;
  tactic.matchups = { ...next };
}
