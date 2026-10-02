import { fullPoseAt, type Simulation } from '../anim/simulation';
import { SHOT_CLOCK_SECONDS, possessionSeconds, type Timeline } from '../anim/timeline';
import { BASKET_Y, PAINT_DEPTH, PAINT_HALF_WIDTH, isBeyondArc } from '../court/fiba';
import { RATING_LABEL, heightOf, skillsOf, speedOf } from '../model/physique';
import type { Grade, Player, Tactic, Vec2 } from '../model/types';
import {
  BETTER_OPTION_MARGIN,
  BODY_DISTANCE,
  CONTESTED_FACTOR,
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
  TRAILING_BONUS,
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
  points: 1 | 2;
  /** 空檔命中率（只看能力與區域） */
  baseRate: number;
  /** 最近防守者的實際距離（公尺） */
  defenderDistance: number;
  defenderId: string;
  /** 防守者是否被甩在身後 */
  defenderBehind: boolean;
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
  const toRim = { x: RIM.x - at.x, y: RIM.y - at.y };

  // 找干擾最大的防守者：距離越近、越在出手者前方、身高優勢越大，造成的命中率損失越多
  const span = OPEN_DISTANCE - BODY_DISTANCE;
  let best: { id: string; d: number; behind: boolean; openness: number; edge: number; mismatch: number; loss: number } | null = null;
  for (const red of players.filter((p) => p.team === 'red')) {
    const rp = positions[red.id]!;
    const d = dist(rp, at);
    const behind = (rp.x - at.x) * toRim.x + (rp.y - at.y) * toRim.y < 0;
    let effective = d;
    if (behind) effective += TRAILING_BONUS;
    if (dribbled) effective += ISO_SEPARATION[skills.iso];
    const openness = Math.min(1, Math.max(0, (effective - BODY_DISTANCE) / span));
    const edge = heightOf(shooter, players) - heightOf(red, players);
    const mismatch = mismatchEffect(edge, zone);
    const loss = (1 - CONTESTED_FACTOR) * (1 - openness) * (1 - mismatch);
    if (!best || loss > best.loss) best = { id: red.id, d, behind, openness, edge, mismatch, loss };
  }
  const factor = 1 - best!.loss;
  const points = zone === 'three' ? 2 : 1;
  return {
    playerId,
    at: { ...at },
    zone,
    points,
    baseRate,
    defenderDistance: best!.d,
    defenderId: best!.id,
    defenderBehind: best!.behind,
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

export function gradeOf(expectedPoints: number): Grade {
  return GRADE_THRESHOLDS.find((g) => expectedPoints >= g.min)?.grade ?? 'D';
}

export interface Comment {
  text: string;
  /** 點擊後跳到哪個分鏡 */
  frameIndex: number;
  /** 要在場上標示的球員 */
  playerIds: string[];
}

export interface Evaluation {
  grade: Grade;
  expectedPoints: number;
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

const label = (players: readonly Player[], id: string) => {
  const p = players.find((x) => x.id === id)!;
  return `${p.number} 號 ${p.name}`;
};

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

  const violation = possessionSeconds(timeline) > SHOT_CLOCK_SECONDS;
  const expectedPoints = violation ? 0 : shot.expectedPoints;
  const comments: Comment[] = [];
  const name = (id: string) => label(players, id);
  const fmt = (v: number) => v.toFixed(2);

  // 1. 出手
  const space = shot.openness >= 1 ? `完全空檔（最近的防守者 ${shot.defenderDistance.toFixed(1)} m）`
    : shot.defenderBehind ? `甩開防守者，對方追在身後 ${shot.defenderDistance.toFixed(1)} m`
    : shot.openness <= 0.2 ? `被 ${name(shot.defenderId)} 貼身干擾`
    : `${name(shot.defenderId)} 在 ${shot.defenderDistance.toFixed(1)} m 外干擾`;
  comments.push({
    text: `${shotPath ? '' : '這套戰術沒有投籃，系統挑最好的出手評分：'}第 ${releaseFrame + 1} 分鏡，${name(shot.playerId)} 在${ZONE_LABEL[shot.zone]}出手（${shot.points} 分），${space}，預期得分 ${fmt(shot.expectedPoints)}`,
    frameIndex: releaseFrame,
    playerIds: [shot.playerId, shot.defenderId],
  });

  // 2. 時間
  if (violation) {
    comments.push({
      text: `第 ${possessionSeconds(timeline).toFixed(1)} 秒才出手，超過 ${SHOT_CLOCK_SECONDS} 秒進攻時限，違例不計分`,
      frameIndex: releaseFrame,
      playerIds: [shot.playerId],
    });
  }

  // 3. 更好的選擇
  if (shotPath) {
    const better = options
      .filter((o) => o.playerId !== shot.playerId && o.expectedPoints >= shot.expectedPoints + BETTER_OPTION_MARGIN)
      .sort((a, b) => b.expectedPoints - a.expectedPoints)[0];
    if (better) {
      comments.push({
        text: `其實 ${name(better.playerId)} 在${ZONE_LABEL[better.zone]}更空（${better.defenderBehind ? '防守者在身後' : `最近的防守者 ${better.defenderDistance.toFixed(1)} m`}），傳給他預期得分 ${fmt(better.expectedPoints)}`,
        frameIndex: releaseFrame,
        playerIds: [better.playerId],
      });
    }
  }

  // 4. 掩護成效
  for (const e of defense.events) {
    const fi = frameIndexAt(timeline, e.t);
    if (e.type === 'fight-over') {
      comments.push({
        text: `第 ${fi + 1} 分鏡，${name(e.screenerId)} 的掩護擋住 ${name(e.defenderId)} ${e.delay.toFixed(2)} 秒`,
        frameIndex: fi,
        playerIds: [e.screenerId, e.defenderId],
      });
    } else if (e.partnerId) {
      // 換防後的錯位：被掩護的人（原本由 defenderId 盯）改由 partnerId 盯
      const after = defense.finalAssignments;
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
      });
    }
  }

  // 5. 空間配置：出手那一刻，兩名藍隊球員太近（排除出手者與正在掩護的人）
  const screeners = new Set(tactic.frames[releaseFrame - 1]?.paths.filter((p) => p.kind === 'screen').map((p) => p.actorId));
  for (let i = 0; i < blues.length; i++) {
    for (let j = i + 1; j < blues.length; j++) {
      const a = blues[i]!.id;
      const b = blues[j]!.id;
      if (screeners.has(a) || screeners.has(b)) continue;
      const d = dist(pose.positions[a]!, pose.positions[b]!);
      if (d < SPACING_DISTANCE) {
        comments.push({
          text: `第 ${releaseFrame + 1} 分鏡，${name(a)} 和 ${name(b)} 只距離 ${d.toFixed(1)} m，空間太擠，一個防守者就能同時照顧兩人`,
          frameIndex: releaseFrame,
          playerIds: [a, b],
        });
      }
    }
  }

  // 6. 命中率：說明分數從哪裡來
  const skillName = shot.zone === 'paint' ? '禁區終結' : '外線投射';
  const skillValue = shot.zone === 'paint' ? skillsOf(players.find((p) => p.id === shot.playerId)!).finishing : skillsOf(players.find((p) => p.id === shot.playerId)!).shooting;
  const finalRate = shot.expectedPoints / shot.points;
  comments.push({
    text: `${name(shot.playerId)} 的${skillName}「${RATING_LABEL[skillValue]}」，${ZONE_LABEL[shot.zone]}空檔命中率 ${Math.round(shot.baseRate * 100)}%${finalRate < shot.baseRate - 0.005 ? `，受干擾後剩 ${Math.round(finalRate * 100)}%` : ''}${mismatchText(shot)}`,
    frameIndex: releaseFrame,
    playerIds: [shot.playerId],
  });

  // 7. 出手時間（違例已在前面說明）
  if (!violation) {
    comments.push({
      text: `第 ${possessionSeconds(timeline).toFixed(1)} 秒出手，在 ${SHOT_CLOCK_SECONDS} 秒進攻時限內`,
      frameIndex: releaseFrame,
      playerIds: [shot.playerId],
    });
  }

  return {
    grade: gradeOf(expectedPoints),
    expectedPoints,
    shot,
    hasShot: !!shotPath,
    violation,
    releaseAt,
    comments: comments.slice(0, 5),
  };
}
