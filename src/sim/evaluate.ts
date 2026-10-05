import { fullPoseAt, type Simulation } from '../anim/simulation';
import { possessionSeconds, type Timeline } from '../anim/timeline';
import { BASKET_Y, PAINT_DEPTH, PAINT_HALF_WIDTH, isBeyondArc } from '../court/fiba';
import { PLAYER_RADIUS } from '../model/entities';
import { RATING_LABEL, heightOf, skillsOf, speedOf } from '../model/physique';
import { scoreOf, scoringOf, shotClockOf } from '../model/scoring';
import type { Grade, Player, Tactic, Vec2 } from '../model/types';
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

export type Zone = 'paint' | 'mid' | 'three';
export const ZONE_LABEL: Record<Zone, string> = { paint: '禁區', mid: '中距離', three: '弧外' };

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
  const baseRate = zone === 'paint' ? PAINT_RATE[skills.finishing] : zone === 'mid' ? MID_RATE[skills.shooting] : THREE_RATE[skills.shooting];
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

/** 身高錯位的說明（差距 5 cm 以上、而且確實有受到干擾才說） */
function mismatchText(shot: ShotValue): string {
  if (Math.abs(shot.heightEdge) < 5 || shot.openness >= 1) return '';
  const pct = Math.round(Math.abs(shot.mismatch) * 100);
  return shot.heightEdge > 0
    ? `（比干擾他的防守者高 ${shot.heightEdge} cm，干擾減少 ${pct}%）`
    : `（比干擾他的防守者矮 ${-shot.heightEdge} cm，干擾增加 ${pct}%）`;
}

/** 0–100 分對應的評等 */
export function gradeOf(score: number): Grade {
  return GRADE_THRESHOLDS.find((g) => score >= g.min)?.grade ?? 'D';
}

export interface Comment {
  text: string;
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
  /** 出手時間超過 12 秒（違例，預期得分記 0） */
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

const label = (players: readonly Player[], id: string) => {
  const p = players.find((x) => x.id === id)!;
  return `${p.number} 號 ${p.name}`;
};

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
  const name = (id: string) => label(players, id);
  const fmt = (v: number) => v.toFixed(2);

  // 1. 出手
  const space = shot.allBehind ? `甩開防守者，對方都追在身後（最近 ${edgeGap(shot.defenderDistance)} m），沒有人干擾`
    : shot.openness >= 1 ? `完全空檔（最近的防守者 ${edgeGap(shot.defenderDistance)} m）`
    : shot.openness <= 0.2 ? `被 ${name(shot.defenderId)} 貼身干擾`
    : `${name(shot.defenderId)} 在 ${edgeGap(shot.defenderDistance)} m 外干擾`;
  if (shotPath) {
    comments.push({
      text: `第 ${releaseFrame + 1} 分鏡，${name(shot.playerId)} 在${ZONE_LABEL[shot.zone]}出手（${shot.points} 分），${space}，預期得分 ${fmt(shot.expectedPoints)}`,
      frameIndex: releaseFrame,
      playerIds: [shot.playerId, shot.defenderId],
      priority: 0,
    });
  } else {
    // 沒有投籃：不評分，只提示誰最有機會（不附分數）
    comments.push({
      text: '這套戰術沒有投籃，所以不評分。在最後一個分鏡加入投籃，就會計算預期得分和評等。',
      frameIndex: releaseFrame,
      playerIds: [],
      priority: 0,
    });
    comments.push({
      text: `提示：最後一刻最有機會的是 ${name(shot.playerId)}，在${ZONE_LABEL[shot.zone]}，${space}`,
      frameIndex: releaseFrame,
      playerIds: [shot.playerId],
      priority: 1,
    });
  }

  // 2. 時間
  if (violation) {
    comments.push({
      text: shotPath
        ? `第 ${possessionSeconds(timeline).toFixed(1)} 秒才出手，超過 ${shotClock} 秒進攻時限，違例不計分`
        : `整個戰術 ${possessionSeconds(timeline).toFixed(1)} 秒，超過 ${shotClock} 秒進攻時限，就算最後投籃也是違例`,
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
        text: `其實 ${name(better.playerId)} 在${ZONE_LABEL[better.zone]}更空（${better.allBehind ? '防守者都在身後' : `最近的防守者 ${edgeGap(better.defenderDistance)} m`}），傳給他預期得分 ${fmt(better.expectedPoints)}`,
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
        text: `第 ${fi + 1} 分鏡，${name(e.defenderId)} 從弱邊補防 ${name(e.handlerId)} 的切入 ${e.delay.toFixed(1)} 秒，原本盯的 ${name(e.leftId)} 沒人管`,
        frameIndex: fi,
        playerIds: [e.defenderId, e.leftId],
        priority: 4,
      });
    } else if (e.type === 'fight-over') {
      comments.push({
        text: `第 ${fi + 1} 分鏡，${name(e.screenerId)} 的掩護擋住 ${name(e.defenderId)} ${e.delay.toFixed(2)} 秒`,
        frameIndex: fi,
        playerIds: [e.screenerId, e.defenderId],
        priority: 4,
      });
    } else if (e.type === 'drop' || e.type === 'hedge') {
      // 擋拆擠過時的協防：說明對方怎麼守，空檔會出現在哪裡
      const handler = name(e.handlerId!);
      const text =
        e.type === 'drop'
          ? `${name(e.defenderId)} 沉退保護籃下 ${e.delay.toFixed(1)} 秒：${handler} 往籃下切會被擋，中距離以外急停跳投、或 ${name(e.screenerId)} 拉開到外線比較有空間`
          : `${name(e.defenderId)} 上提干擾 ${handler} ${e.delay.toFixed(1)} 秒：${handler} 不好直接出手，但 ${name(e.screenerId)} 順下或拉開會比較空`;
      comments.push({
        text: `第 ${fi + 1} 分鏡，${text}`,
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
      const detail =
        mismatch && mismatch.edge >= 1
          ? `，形成 ${name(mismatch.blueId)} 對 ${name(mismatch.redId)} 的錯位（${mismatch.dh >= 5 ? `高 ${mismatch.dh} cm` : `快 ${mismatch.dv}%`}）`
          : '';
      comments.push({
        text: `第 ${fi + 1} 分鏡，${name(e.screenerId)} 的掩護逼對方換防${detail}`,
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
          text: `第 ${releaseFrame + 1} 分鏡，${name(a)} 和 ${name(b)} 只距離 ${edgeGap(d)} m，空間太擠，一個防守者就能同時照顧兩人`,
          frameIndex: releaseFrame,
          playerIds: [a, b],
          priority: 5,
        });
      }
    }
  }

  // 6. 命中率：說明分數從哪裡來（沒有投籃就不說）
  const skillName = shot.zone === 'paint' ? '禁區終結' : '外線投射';
  const skillValue = shot.zone === 'paint' ? skillsOf(players.find((p) => p.id === shot.playerId)!).finishing : skillsOf(players.find((p) => p.id === shot.playerId)!).shooting;
  const finalRate = shot.expectedPoints / shot.points;
  if (shotPath) comments.push({
    text: `${name(shot.playerId)} 的${skillName}「${RATING_LABEL[skillValue]}」，${ZONE_LABEL[shot.zone]}空檔命中率 ${Math.round(shot.baseRate * 100)}%${finalRate < shot.baseRate - 0.005 ? `，受干擾後剩 ${Math.round(finalRate * 100)}%` : ''}${mismatchText(shot)}`,
    frameIndex: releaseFrame,
    playerIds: [shot.playerId],
    priority: 2,
  });

  // 7. 出手時間（違例已在前面說明；沒有投籃就沒有出手時間）
  if (shotPath && !violation) {
    comments.push({
      text: `第 ${possessionSeconds(timeline).toFixed(1)} 秒出手，在 ${shotClock} 秒進攻時限內`,
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
