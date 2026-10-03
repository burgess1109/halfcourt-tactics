import { DEFAULT_SKILLS } from './physique';
import { defaultMatchups } from './matchups';
import { syncFrames } from './frames';
import { newId } from './id';
import { DEFAULT_LINEUP, applyLineup, lineupOf } from './lineup';
import type { Frame, Player, Tactic } from './types';

/** 藍隊、紅隊的預設球員（SPEC §3.1、§3.2） */
export function defaultPlayer(team: Player['team'], i: number): Player {
  return team === 'blue'
    ? { id: `b${i}`, team, number: i, name: `球員 ${i}`, skills: { ...DEFAULT_SKILLS } }
    : { id: `r${i}`, team, number: i, name: `對手 ${i}` };
}

/** 新的進攻戰術：藍隊依開局站位站弧頂與兩翼；紅隊站位由 syncFrames 依對位推算 */
export function createDefaultTactic(): Tactic {
  const players = [1, 2, 3].flatMap((i) => [defaultPlayer('blue', i), defaultPlayer('red', i)]);
  const frame: Frame = { start: {}, ballHolderId: null, paths: [] };
  applyLineup(frame, DEFAULT_LINEUP);
  const tactic: Tactic = {
    version: 1,
    id: newId(),
    name: '',
    mode: 'offense',
    setup: { blueSkipped: false, redSkipped: false, matchupsCustomized: false },
    matchups: defaultMatchups(players),
    screenDefense: 'switch',
    pickCoverage: 'drop',
    players,
    frames: [frame],
    updatedAt: Date.now(),
  };
  syncFrames(tactic, false); // 放好紅隊
  return tactic;
}

/**
 * 空白戰術：保留球員資料、對位、掩護應對與開局站位，跑位清空、只有一個分鏡（SPEC §6.3）。
 */
export function createBlankTactic(base: Tactic): Tactic {
  const frame: Frame = { start: {}, ballHolderId: null, paths: [] };
  applyLineup(frame, lineupOf(base));
  const tactic: Tactic = {
    ...structuredClone(base),
    id: newId(),
    name: '',
    frames: [frame],
    updatedAt: Date.now(),
  };
  delete tactic.basedOn;
  delete tactic.lastResult;
  syncFrames(tactic, true);
  return tactic;
}
