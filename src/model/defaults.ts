import { DEFAULT_SKILLS } from './physique';
import { defaultMatchups } from './matchups';
import { syncFrames } from './frames';
import { newId } from './id';
import { DEFAULT_LINEUP, applyLineup, lineupOf } from './lineup';
import type { Frame, Player, Tactic } from './types';
import { t, type Messages } from '../i18n';

/** 藍隊、紅隊的預設球員（SPEC §3.1、§3.2）；暱稱空白 = 預設暱稱 */
export function defaultPlayer(team: Player['team'], i: number): Player {
  return team === 'blue'
    ? { id: `b${i}`, team, number: i, name: '', skills: { ...DEFAULT_SKILLS } }
    : { id: `r${i}`, team, number: i, name: '' };
}

/** 預設暱稱：依球員的位置（b1 → 球員 1、r2 → 對手 2），不是號碼；messages 預設是目前語系 */
export function defaultName(player: Pick<Player, 'id' | 'team'>, messages: Messages = t()): string {
  const i = Number(player.id.slice(1));
  return player.team === 'blue' ? messages.defaults.blue(i) : messages.defaults.red(i);
}

/**
 * 顯示用的暱稱（SPEC §10.3）：沒有取暱稱時依目前語系顯示預設暱稱。
 * 預設暱稱不寫進資料，所以切換語系、開啟別的語系存的戰術都不用改資料。
 */
export const displayName = (player: Player): string => player.name || defaultName(player);

/** 新的進攻戰術：藍隊依開局站位站弧頂與兩翼；紅隊站位由 syncFrames 依對位推算 */
export function createDefaultTactic(): Tactic {
  const players = [1, 2, 3].flatMap((i) => [defaultPlayer('blue', i), defaultPlayer('red', i)]);
  const frame: Frame = { start: {}, ballHolderId: null, paths: [] };
  applyLineup(frame, DEFAULT_LINEUP);
  const tactic: Tactic = {
    version: 2,
    id: newId(),
    name: '',
    mode: 'offense',
    setup: { blueSkipped: false, redSkipped: false, matchupsCustomized: false },
    matchups: defaultMatchups(players),
    screenDefense: 'switch',
    pickCoverage: 'drop',
    pressure: 'normal',
    driveHelp: 'off',
    autoDefense: true,
    scoring: 'fiba3x3',
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
  delete tactic.redStarts; // 紅隊回到依對位站位
  syncFrames(tactic, true);
  return tactic;
}
