import { fullPoseAt, type Simulation } from '../anim/simulation';
import { possessionSeconds, type Timeline } from '../anim/timeline';
import { BASKET_Y, PAINT_DEPTH, PAINT_HALF_WIDTH, isBeyondArc } from '../court/fiba';
import { PLAYER_RADIUS } from '../model/entities';
import { heightOf, skillsOf, speedOf } from '../model/physique';
import { scoreOf, scoringOf, shotClockOf } from '../model/scoring';
import type { Grade, Rating, Skills, Tactic, Vec2 } from '../model/types';
import {
  BETTER_OPTION_MARGIN,
  BODY_DISTANCE,
  CONTESTED_FACTOR,
  CONTEST_SIDE_MARGIN,
  DRIVE_HELP_COMMENT_MIN,
  GRADE_THRESHOLDS,
  ISO_SEPARATION,
  MID_RATE,
  MISMATCH_JUMPSHOT_WEIGHT,
  MISMATCH_MAX_INCREASE,
  MISMATCH_MAX_REDUCTION,
  MISMATCH_PER_CM,
  OPEN_DISTANCE,
  PAINT_RATE,
  SPACING_DISTANCE,
  THREE_RATE,
} from './config';

// 評分（SPEC §6.4、§6.5）：完全決定性，只算期望值，不判定進不進。
// 評價只產生「種類＋參數」（CommentMessage），句子由介面依語系組成（i18n/describe.ts 的 commentText）。

export type Zone = 'paint' | 'mid' | 'three';

const RIM: Vec2 = { x: 0, y: BASKET_Y };
const dist = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y);

export function zoneOf(p: Vec2): Zone {
  if (isBeyondArc(p)) return 'three';
  if (Math.abs(p.x) <= PAINT_HALF_WIDTH && p.y <= PAINT_DEPTH) return 'paint';
  return 'mid';
}

export interface ShotValue {
  playerId: string;
  at: Vec2;
  zone: Zone;
  /** 這一球幾分（依計分規則） */
  points: number;
  /** 空檔命中率（只看能力與區域） */
  baseRate: number;
  /** 最近防守者的實際距離（公尺） */
  defenderDistance: number;
  defenderId: string;
  /** 這位代表的防守者是否被甩在身後 */
  defenderBehind: boolean;
  /** 所有防守者都被甩在身後（沒有任何人在出手者與籃框之間） */
  allBehind: boolean;
  /** 0–1，1 = 完全空檔（只看距離，不含身高） */
  openness: number;
  /** 出手者比這位防守者高多少 cm（負數 = 比較矮） */
  heightEdge: number;
  /** 身高錯位讓干擾損失減少的比例（負數 = 增加） */
  mismatch: number;
  expectedPoints: number;
}

/** 身高錯位對干擾損失的影響：正數 = 減少，負數 = 增加 */
export function mismatchEffect(heightEdgeCm: number, zone: Zone): number {
  const weight = zone === 'paint' ? 1 : MISMATCH_JUMPSHOT_WEIGHT;
  return Math.min(MISMATCH_MAX_REDUCTION, Math.max(-MISMATCH_MAX_INCREASE, heightEdgeCm * MISMATCH_PER_CM * weight));
}

/**
 * 某位藍隊球員在某個位置出手的預期得分。
 * dribbled：出手前有運球（單打能力可以額外拉開距離）。
 */
export function shotValue(
  tactic: Tactic,
  playerId: string,
  positions: Record<string, Vec2>,
  dribbled: boolean,
): ShotValue {
  const { players } = tactic;
  const shooter = players.find((p) => p.id === playerId)!;
  const at = positions[playerId]!;
  const zone = zoneOf(at);
  const skills = skillsOf(shooter);
  const baseRate = zone === 'paint' ? PAINT_RATE[skills.finishing] : zone === 'mid' ? MID_RATE[skills.midRange] : THREE_RATE[skills.threePoint];
  const shooterRimDist = dist(at, RIM);

  // 找干擾最大的防守者：距離越近、身高優勢越大，造成的命中率損失越多。
  // 在出手者身後（不在出手者與籃框之間）的防守者已經被甩開，追在後面不算干擾。
  // 都沒有人干擾時：前方有人就記下前方最近的防守者（評價寫「完全空檔（最近的防守者幾公尺）」）；
  // 全部都在身後才記下身後最近的人（評價寫「對方都追在身後幾公尺」），兩種說法才不會配錯距離。
  const span = OPEN_DISTANCE - BODY_DISTANCE;
  let best: { id: string; d: number; behind: boolean; openness: number; edge: number; mismatch: number; loss: number } | null = null;
  let allBehind = true;
  for (const red of players.filter((p) => p.team === 'red')) {
    const rp = positions[red.id]!;
    const d = dist(rp, at);
    const behind = dist(rp, RIM) > shooterRimDist + CONTEST_SIDE_MARGIN;
    if (!behind) allBehind = false;
    const effective = d + (dribbled ? ISO_SEPARATION[skills.iso] : 0);
    const openness = behind ? 1 : Math.min(1, Math.max(0, (effective - BODY_DISTANCE) / span));
    const edge = heightOf(shooter, players) - heightOf(red, players);
    const mismatch = mismatchEffect(edge, zone);
    const loss = (1 - CONTESTED_FACTOR) * (1 - openness) * (1 - mismatch);
    const tie = !!best && Math.abs(loss - best.loss) <= 1e-12;
    const preferred = tie && (best!.behind !== behind ? !behind : d < best!.d);
    if (!best || loss > best.loss + 1e-12 || preferred) {
      best = { id: red.id, d, behind, openness, edge, mismatch, loss };
    }
  }
  const factor = 1 - best!.loss;
  const rule = scoringOf(tactic);
  const points = zone === 'three' ? rule.outside : rule.inside;
  return {
    playerId,
    at: { ...at },
    zone,
    points,
    baseRate,
    defenderDistance: best!.d,
    defenderId: best!.id,
    defenderBehind: best!.behind,
    allBehind,
    openness: best!.openness,
    heightEdge: best!.edge,
    mismatch: best!.mismatch,
    expectedPoints: baseRate * factor * points,
  };
}

/** 身高錯位（差距 5 cm 以上、而且確實有受到干擾才說）：heightEdge 出手者高多少 cm（負數 = 矮），pct 干擾增減幾 % */
function mismatchOf(shot: ShotValue): { heightEdge: number; pct: number } | null {
  if (Math.abs(shot.heightEdge) < 5 || shot.openness >= 1) return null;
  return { heightEdge: shot.heightEdge, pct: Math.round(Math.abs(shot.mismatch) * 100) };
}

/** 0–100 分對應的評等 */
export function gradeOf(score: number): Grade {
  return GRADE_THRESHOLDS.find((g) => score >= g.min)?.grade ?? 'D';
}

/** 出手者的空檔程度（距離都是中心距離，顯示時用 edgeGap 換算） */
export type Space =
  | { kind: 'all-behind'; distance: number }
  | { kind: 'open'; distance: number }
  | { kind: 'tight'; defenderId: string }
  | { kind: 'contested'; defenderId: string; distance: number };

/**
 * 一條評價的內容：種類＋參數。frame 是第幾個分鏡（1 起算）；seconds、delay 是秒數；距離都是中心距離（公尺）。
 */
export type CommentMessage =
  | { kind: 'shot'; frame: number; shooterId: string; zone: Zone; points: number; space: Space; expected: number }
  | { kind: 'no-shot' }
  | { kind: 'best-option'; playerId: string; zone: Zone; space: Space }
  | { kind: 'late-shot'; seconds: number; shotClock: number }
  | { kind: 'too-long'; seconds: number; shotClock: number }
  | { kind: 'better-option'; playerId: string; zone: Zone; allBehind: boolean; distance: number; expected: number }
  | { kind: 'drive-help'; frame: number; defenderId: string; handlerId: string; delay: number; leftId: string }
  | { kind: 'fight-over'; frame: number; screenerId: string; defenderId: string; delay: number }
  | { kind: 'drop' | 'hedge'; frame: number; defenderId: string; handlerId: string; screenerId: string; delay: number }
  | {
      kind: 'switch';
      frame: number;
      screenerId: string;
      /** 換防後的錯位：藍隊比紅隊高 heightCm（≥ 5 時說身高），否則說快 speedPct % */
      mismatch: { blueId: string; redId: string; heightCm: number; speedPct: number } | null;
    }
  | { kind: 'spacing'; frame: number; aId: string; bId: string; distance: number }
  | {
      kind: 'rate';
      playerId: string;
      skill: keyof Skills;
      rating: Rating;
      zone: Zone;
      /** 空檔命中率、受干擾後的命中率（沒有受影響時為 null），0–1 */
      baseRate: number;
      finalRate: number | null;
      mismatch: { heightEdge: number; pct: number } | null;
    }
  | { kind: 'in-time'; seconds: number; shotClock: number };

export interface Comment {
  message: CommentMessage;
  /** 重要性：數字越小越重要；超過 5 條時先保留重要的（顯示仍依加入順序） */
  priority?: number;
  /** 點擊後跳到哪個分鏡 */
  frameIndex: number;
  /** 要在場上標示的球員 */
  playerIds: string[];
}

export interface Evaluation {
  /** 沒有投籃時不評分（SPEC §6.4），為 null */
  grade: Grade | null;
  expectedPoints: number | null;
  /** 0–100 分（有效命中率，model/scoring.ts 的 scoreOf）；沒有投籃時為 null */
  score: number | null;
  shot: ShotValue;
  /** 使用者有畫投籃 */
  hasShot: boolean;
  /** 出手時間超過進攻時限（依計分規則 12 或 24 秒，shotClockOf；違例，預期得分記 0） */
  violation: boolean;
  releaseAt: number;
  comments: Comment[];
}

function frameIndexAt(timeline: Timeline, t: number): number {
  const i = timeline.frames.findIndex((f) => t < f.start + f.duration);
  return i === -1 ? timeline.frames.length - 1 : i;
}

/**
 * 評語裡的距離：兩人圓標邊緣到邊緣（中心距離扣掉兩個半徑，最小 0），比較符合實際的認知。
 * 模擬與評分的規則（貼身 1.3 m、完全空檔 3.0 m…）仍然用中心距離，只有顯示換算。
 */
export const edgeGap = (centerDistance: number) => Math.max(0, centerDistance - 2 * PLAYER_RADIUS).toFixed(1);

/** 這位球員在 frameIndex 之前（含）最近的一條路線是掩護：設完掩護後留在原地也算還在擋人 */
export function isScreening(tactic: Tactic, playerId: string, frameIndex: number): boolean {
  for (let i = Math.min(frameIndex, tactic.frames.length - 1); i >= 0; i--) {
    const path = tactic.frames[i]!.paths.find((p) => p.actorId === playerId);
    if (path) return path.kind === 'screen';
  }
  return false;
}

/** 最多 5 條：依重要性挑選，再依原本的順序顯示 */
export const MAX_COMMENTS = 5;
export function pickComments(all: readonly Comment[]): Comment[] {
  const keep = new Set(
    all
      .map((c, i) => ({ c, i }))
      .sort((a, b) => (a.c.priority ?? 9) - (b.c.priority ?? 9) || a.i - b.i)
      .slice(0, MAX_COMMENTS)
      .map((x) => x.c),
  );
  return all.filter((c) => keep.has(c)).map(({ priority: _p, ...c }) => c);
}

/** 出手者在出手前那個分鏡（或出手的分鏡）有沒有運球 */
function dribbledBefore(tactic: Tactic, playerId: string, frameIndex: number): boolean {
  return [frameIndex - 1, frameIndex].some((i) =>
    tactic.frames[i]?.paths.some((p) => p.actorId === playerId && p.kind === 'dribble'),
  );
}

export function evaluate(tactic: Tactic, sim: Simulation): Evaluation {
  const { timeline, defense } = sim;
  const { players } = tactic;
  const blues = players.filter((p) => p.team === 'blue');
  const lastIndex = tactic.frames.length - 1;
  const shotPath = tactic.frames[lastIndex]!.paths.find((p) => p.kind === 'shot');

  // 評哪一球：有投籃評那一球；沒有則在最後一刻挑預期得分最高的人
  const releaseAt = shotPath ? timeline.shotReleaseAt! : timeline.total;
  const pose = fullPoseAt(tactic, sim, releaseAt);
  const releaseFrame = frameIndexAt(timeline, releaseAt);
  const options = blues.map((b) => shotValue(tactic, b.id, pose.positions, dribbledBefore(tactic, b.id, releaseFrame)));
  const shot = shotPath
    ? options.find((o) => o.playerId === shotPath.actorId)!
    : [...options].sort((a, b) => b.expectedPoints - a.expectedPoints)[0]!;

  const shotClock = shotClockOf(tactic);
  const rule = scoringOf(tactic);
  const violation = possessionSeconds(timeline) > shotClock;
  const expectedPoints = !shotPath ? null : violation ? 0 : shot.expectedPoints;
  const comments: Comment[] = [];

  // 1. 出手
  const distance = shot.defenderDistance;
  const space: Space = shot.allBehind ? { kind: 'all-behind', distance }
    : shot.openness >= 1 ? { kind: 'open', distance }
    : shot.openness <= 0.2 ? { kind: 'tight', defenderId: shot.defenderId }
    : { kind: 'contested', defenderId: shot.defenderId, distance };
  if (shotPath) {
    comments.push({
      message: {
        kind: 'shot',
        frame: releaseFrame + 1,
        shooterId: shot.playerId,
        zone: shot.zone,
        points: shot.points,
        space,
        expected: shot.expectedPoints,
      },
      frameIndex: releaseFrame,
      playerIds: [shot.playerId, shot.defenderId],
      priority: 0,
    });
  } else {
    // 沒有投籃：不評分，只提示誰最有機會（不附分數）
    comments.push({
      message: { kind: 'no-shot' },
      frameIndex: releaseFrame,
      playerIds: [],
      priority: 0,
    });
    comments.push({
      message: { kind: 'best-option', playerId: shot.playerId, zone: shot.zone, space },
      frameIndex: releaseFrame,
      playerIds: [shot.playerId],
      priority: 1,
    });
  }

  // 2. 時間
  if (violation) {
    comments.push({
      message: { kind: shotPath ? 'late-shot' : 'too-long', seconds: possessionSeconds(timeline), shotClock },
      frameIndex: releaseFrame,
      playerIds: [shot.playerId],
      priority: 1,
    });
  }

  // 3. 更好的選擇
  if (shotPath) {
    const better = options
      .filter((o) => o.playerId !== shot.playerId && scoreOf(o.expectedPoints, rule) >= scoreOf(shot.expectedPoints, rule) + BETTER_OPTION_MARGIN)
      .sort((a, b) => b.expectedPoints - a.expectedPoints)[0];
    if (better) {
      comments.push({
        message: {
          kind: 'better-option',
          playerId: better.playerId,
          zone: better.zone,
          allBehind: better.allBehind,
          distance: better.defenderDistance,
          expected: better.expectedPoints,
        },
        frameIndex: releaseFrame,
        playerIds: [better.playerId],
        priority: 3,
      });
    }
  }

  // 4. 掩護成效與補防（只算出手之前發生的）
  for (const e of defense.events.filter((x) => x.t <= releaseAt)) {
    const fi = frameIndexAt(timeline, e.t);
    if (e.type === 'drive-help') {
      // 剛補就傳球（例如傳給順下的人）：補防沒有實際作用，不寫評語
      if (e.delay < DRIVE_HELP_COMMENT_MIN) continue;
      comments.push({
        message: { kind: 'drive-help', frame: fi + 1, defenderId: e.defenderId, handlerId: e.handlerId, delay: e.delay, leftId: e.leftId },
        frameIndex: fi,
        playerIds: [e.defenderId, e.leftId],
        priority: 4,
      });
    } else if (e.type === 'fight-over') {
      comments.push({
        message: { kind: 'fight-over', frame: fi + 1, screenerId: e.screenerId, defenderId: e.defenderId, delay: e.delay },
        frameIndex: fi,
        playerIds: [e.screenerId, e.defenderId],
        priority: 4,
      });
    } else if (e.type === 'drop' || e.type === 'hedge') {
      // 擋拆擠過時的協防：說明對方怎麼守，空檔會出現在哪裡
      comments.push({
        message: {
          kind: e.type,
          frame: fi + 1,
          defenderId: e.defenderId,
          handlerId: e.handlerId!,
          screenerId: e.screenerId,
          delay: e.delay,
        },
        frameIndex: fi,
        playerIds: [e.defenderId, e.screenerId],
        priority: 4,
      });
    } else if (e.partnerId) {
      // 換防後的錯位：用「這次換防之後」的對位，不受之後再換防影響
      const after = e.assignmentsAfter ?? defense.finalAssignments;
      const mismatch = Object.entries(after)
        .map(([redId, blueId]) => {
          const blue = players.find((p) => p.id === blueId)!;
          const red = players.find((p) => p.id === redId)!;
          const dh = heightOf(blue, players) - heightOf(red, players);
          const dv = Math.round((speedOf(blue, players, false) / speedOf(red, players, false) - 1) * 100);
          return { blueId, redId, dh, dv, edge: Math.max(dh / 5, dv / 5) };
        })
        .filter((m) => m.redId === e.defenderId || m.redId === e.partnerId)
        .sort((a, b) => b.edge - a.edge)[0];
      const shown = mismatch && mismatch.edge >= 1 ? mismatch : null;
      comments.push({
        message: {
          kind: 'switch',
          frame: fi + 1,
          screenerId: e.screenerId,
          mismatch: shown && { blueId: shown.blueId, redId: shown.redId, heightCm: shown.dh, speedPct: shown.dv },
        },
        frameIndex: fi,
        playerIds: mismatch && mismatch.edge >= 1 ? [mismatch.blueId, mismatch.redId] : [e.screenerId, e.defenderId],
        priority: 4,
      });
    }
  }

  // 5. 空間配置：出手那一刻，兩名藍隊球員太近。
  // 排除正在掩護的人（最近一條路線是掩護，之後留在原地繼續擋人也算）；
  // 出手者不排除：隊友擠在出手者旁邊，一個防守者就能同時照顧兩人，這也該提醒。
  const screeners = new Set(blues.filter((b) => isScreening(tactic, b.id, releaseFrame)).map((b) => b.id));
  for (let i = 0; i < blues.length; i++) {
    for (let j = i + 1; j < blues.length; j++) {
      const a = blues[i]!.id;
      const b = blues[j]!.id;
      if (screeners.has(a) || screeners.has(b)) continue;
      const d = dist(pose.positions[a]!, pose.positions[b]!);
      if (d < SPACING_DISTANCE) {
        comments.push({
          message: { kind: 'spacing', frame: releaseFrame + 1, aId: a, bId: b, distance: d },
          frameIndex: releaseFrame,
          playerIds: [a, b],
          priority: 5,
        });
      }
    }
  }

  // 6. 命中率：說明分數從哪裡來（沒有投籃就不說）
  // 用到的能力：禁區看禁區終結、中距離看中距離投射、弧外看弧外投射
  const skillKey = shot.zone === 'paint' ? 'finishing' : shot.zone === 'mid' ? 'midRange' : 'threePoint';
  const skillValue = skillsOf(players.find((p) => p.id === shot.playerId)!)[skillKey];
  const finalRate = shot.expectedPoints / shot.points;
  if (shotPath) comments.push({
    message: {
      kind: 'rate',
      playerId: shot.playerId,
      skill: skillKey,
      rating: skillValue,
      zone: shot.zone,
      baseRate: shot.baseRate,
      finalRate: finalRate < shot.baseRate - 0.005 ? finalRate : null,
      mismatch: mismatchOf(shot),
    },
    frameIndex: releaseFrame,
    playerIds: [shot.playerId],
    priority: 2,
  });

  // 7. 出手時間（違例已在前面說明；沒有投籃就沒有出手時間）
  if (shotPath && !violation) {
    comments.push({
      message: { kind: 'in-time', seconds: possessionSeconds(timeline), shotClock },
      frameIndex: releaseFrame,
      playerIds: [shot.playerId],
      priority: 6,
    });
  }

  return {
    grade: expectedPoints === null ? null : gradeOf(scoreOf(expectedPoints, rule)),
    expectedPoints,
    score: expectedPoints === null ? null : scoreOf(expectedPoints, rule),
    shot,
    hasShot: !!shotPath,
    violation,
    releaseAt,
    comments: pickComments(comments),
  };
}
