import { BALL_ID, type Player, type Tactic } from './types';

function defaultPlayers(): Player[] {
  const make = (team: Player['team'], i: number): Player => ({
    id: `${team === 'blue' ? 'b' : 'r'}${i}`,
    team,
    number: i,
    name: `球員 ${i}`,
  });
  return [1, 2, 3].flatMap((i) => [make('blue', i), make('red', i)]);
}

/** 新戰術：藍隊站弧頂與兩翼，紅隊站在各自對位者與籃框之間 */
export function createDefaultTactic(): Tactic {
  return {
    version: 1,
    id: crypto.randomUUID(),
    name: '',
    mode: 'free',
    players: defaultPlayers(),
    frames: [
      {
        start: {
          b1: { x: 0, y: 8.6 },
          b2: { x: -5.4, y: 6.0 },
          b3: { x: 5.4, y: 6.0 },
          r1: { x: 0, y: 6.3 },
          r2: { x: -3.6, y: 4.5 },
          r3: { x: 3.6, y: 4.5 },
          [BALL_ID]: { x: 0.8, y: 9.15 },
        },
        ballHolderId: 'b1',
        paths: [],
      },
    ],
    updatedAt: Date.now(),
  };
}
