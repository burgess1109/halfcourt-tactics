import { heightOf } from './physique';
import type { Player } from './types';

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
