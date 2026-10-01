import { DEFAULT_SKILLS } from './physique';
import { defaultMatchups } from './matchups';
import { newId } from './id';
import { BALL_ID, type Player, type Tactic } from './types';

/** 藍隊、紅隊的預設球員（SPEC §3.1、§3.2） */
export function defaultPlayer(team: Player['team'], i: number): Player {
  return team === 'blue'
    ? { id: `b${i}`, team, number: i, name: `球員 ${i}`, skills: { ...DEFAULT_SKILLS } }
    : { id: `r${i}`, team, number: i, name: `對手 ${i}` };
}

/** 新的進攻戰術：藍隊站弧頂與兩翼；紅隊站位由 syncFrames 依對位推算 */
export function createDefaultTactic(): Tactic {
  const players = [1, 2, 3].flatMap((i) => [defaultPlayer('blue', i), defaultPlayer('red', i)]);
  const tactic: Tactic = {
    version: 1,
    id: newId(),
    name: '',
    mode: 'offense',
    setup: { blueSkipped: false, redSkipped: false, matchupsCustomized: false },
    matchups: defaultMatchups(players),
    screenDefense: 'switch',
    players,
    frames: [
      {
        start: {
          b1: { x: 0, y: 8.6 },
          b2: { x: -5.4, y: 6.0 },
          b3: { x: 5.4, y: 6.0 },
          r1: { x: 0, y: 7.6 },
          r2: { x: -4.4, y: 5.1 },
          r3: { x: 4.4, y: 5.1 },
          [BALL_ID]: { x: 0.85, y: 8.7 },
        },
        ballHolderId: 'b1',
        paths: [],
      },
    ],
    updatedAt: Date.now(),
  };
  return tactic;
}
