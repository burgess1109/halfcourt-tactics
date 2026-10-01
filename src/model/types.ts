// 資料模型，對應 docs/SPEC.md §11。座標單位為公尺，原點在底線中點，y 朝中場。

export type Team = 'blue' | 'red'; // blue = 使用者，red = 系統
export type Mode = 'offense' | 'defense';

/**
 * 等級 0–4（SPEC §3.1、§3.2）。
 * 藍隊能力：0 大幅劣勢 … 2 持平 … 4 大幅優勢（跟這場對手的平均水準比）。
 * 紅隊速度：0 慢很多 … 2 普通 … 4 快很多（跟他隊友的平均比）。
 */
export type Rating = 0 | 1 | 2 | 3 | 4;

export interface Skills {
  shooting: Rating; // 外線投射
  speed: Rating; // 速度
  finishing: Rating; // 禁區終結
  iso: Rating; // 單打
}

export interface Vec2 {
  x: number;
  y: number;
}

export interface Player {
  id: string; // 'b1'..'b3', 'r1'..'r3'
  team: Team;
  number: number;
  /** 暱稱 */
  name: string;
  heightCm?: number;
  /** 只有藍隊 */
  skills?: Skills;
  /** 只有紅隊：速度（跟隊友平均比），未填 = 普通 */
  speedRating?: Rating;
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
  setup: {
    /** 藍隊、紅隊設定頁是否按了「略過」 */
    blueSkipped: boolean;
    redSkipped: boolean;
    /** 使用者改過對位後，就不再自動套用預設對位 */
    matchupsCustomized: boolean;
  };
  /** 藍隊 id → 紅隊 id */
  matchups: Record<string, string>;
  screenDefense: 'switch' | 'fight-over';
  basedOn?: { playId: string; roles: Record<'A' | 'B' | 'C', string>; modified: boolean };
  players: Player[];
  frames: Frame[];
  lastResult?: { grade: Grade; expectedPoints: number };
  updatedAt: number;
}
