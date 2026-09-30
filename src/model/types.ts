// 資料模型，對應 docs/SPEC.md §11。座標單位為公尺，原點在底線中點，y 朝中場。

export type Team = 'blue' | 'red'; // blue = 使用者，red = 系統
export type Mode = 'offense-design' | 'defense-design' | 'free';
export type Position = 'PG' | 'SG' | 'SF' | 'PF' | 'C';

export interface Vec2 {
  x: number;
  y: number;
}

export interface Player {
  id: string; // 'b1'..'b3', 'r1'..'r3'
  team: Team;
  number: number;
  name: string;
  position?: Position;
  heightCm?: number;
  weightKg?: number;
}

export type PathKind = 'cut' | 'dribble' | 'pass' | 'screen' | 'shot';

export interface TacticPath {
  id: string;
  kind: PathKind;
  actorId: string; // 傳球時為傳球者
  targetId?: string; // 傳球時為接球者
  points: Vec2[];
  freehand: boolean;
}

/** Frame.start 裡代表球的 key */
export const BALL_ID = 'ball';

export interface Frame {
  /** playerId / 'ball' → 位置。有持球者時，球的位置由持球者推算。 */
  start: Record<string, Vec2>;
  ballHolderId: string | null;
  paths: TacticPath[];
}

export type Grade = 'S' | 'A' | 'B' | 'C' | 'D';

export interface Tactic {
  version: 1;
  id: string;
  name: string;
  mode: Mode;
  screenDefense?: 'fight-over' | 'switch';
  matchups?: Record<string, string>; // 藍隊 id → 紅隊 id
  offensePlayId?: string;
  players: Player[];
  frames: Frame[];
  lastResult?: { grade: Grade; expectedPoints: number };
  updatedAt: number;
}
