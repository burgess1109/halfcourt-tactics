// 資料模型，對應 docs/SPEC.md §11。座標單位為公尺，原點在底線中點，y 朝中場。

export type Team = 'blue' | 'red'; // blue = 使用者，red = 系統
export type Mode = 'offense' | 'defense';

/**
 * 等級 0–4（SPEC §3.1、§3.2）。
 * 0 劣勢、1 稍弱、2 平均、3 稍強、4 優勢，以場上六個人的平均為基準。
 * 藍隊有四項能力，紅隊只有速度。
 */
export type Rating = 0 | 1 | 2 | 3 | 4;

export interface Skills {
  speed: Rating; // 速度
  iso: Rating; // 單打
  finishing: Rating; // 禁區終結
  midRange: Rating; // 中距離投射（弧內、禁區外的跳投）
  threePoint: Rating; // 弧外投射
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
  /** 只有紅隊：速度等級，未填 = 平均 */
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

/** 戰術的出手點：禁區、中距離（弧內、禁區外）或弧外 */
export type ShotZone = 'paint' | 'mid' | 'three';

/** 計分規則（SPEC §6.4）：fiba3x3 = 弧內 1 分、弧外 2 分、12 秒；standard = 弧內 2 分、弧外 3 分、24 秒 */
export type ScoringRule = 'fiba3x3' | 'standard';

/** 防守距離（SPEC §6.2）：normal = 一般；tight = 緊貼（距離較小、外圍一律阻絕） */
export type Pressure = 'normal' | 'tight';

/** 持球者切入時（SPEC §6.2）：off = 不補防；weak-side = 來得及的無球防守者補到切入路線上 */
export type DriveHelp = 'off' | 'weak-side';

/** drop = 沉退：退到球和籃框之間保護籃下；hedge = 上提：踏出去擋在持球者前面 */
export type PickCoverage = 'drop' | 'hedge';

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
    /** 開局站位：三名藍隊球員的位置與持球者；未設定時為 1 號弧頂持球、2 號左翼、3 號右翼 */
    lineup?: { positions: Record<string, Vec2>; holder: string };
  };
  /** 藍隊 id → 紅隊 id */
  matchups: Record<string, string>;
  screenDefense: 'switch' | 'fight-over';
  /** 擠過時，擋拆（掩護持球者的防守者）由掩護者的防守者沉退或上提（SPEC §6.2） */
  pickCoverage: PickCoverage;
  /** 防守距離：一般 / 緊貼（SPEC §6.2） */
  pressure: Pressure;
  /** 持球者切入時：不補防 / 弱邊補防（SPEC §6.2） */
  driveHelp: DriveHelp;
  /**
   * 自動防守跑位（SPEC §6.2）。false 時紅隊不會自動移動，規則和藍隊一樣：
   * 第 1 個分鏡拖曳開局位置（redStarts），用跑位路線（kind: 'cut'）移動。
   */
  autoDefense: boolean;
  /** 計分規則（SPEC §6.4），預設 FIBA 3x3 */
  scoring: ScoringRule;
  /**
   * 關閉自動防守時，使用者在第 1 個分鏡拖過的紅隊開局位置（紅隊 id → 位置）。
   * 沒拖過的紅隊每次都依對位、防守距離重新站位；改對位、清空戰術、載入內建戰術時清空。
   */
  redStarts?: Record<string, Vec2>;
  /** 從戰術庫載入時；shot：有多個出手點的戰術用的出手點 */
  basedOn?: { playId: string; roles: Record<'A' | 'B' | 'C', string>; modified: boolean; shot?: ShotZone };
  players: Player[];
  frames: Frame[];
  /** 上次播放的評分：評等、預期得分、0–100 分 */
  lastResult?: { grade: Grade; expectedPoints: number; score: number };
  updatedAt: number;
}
