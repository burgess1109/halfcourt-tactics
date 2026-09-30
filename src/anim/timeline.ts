import { add } from '../geom/vec';
import { BALL_HOLD_OFFSET } from '../model/entities';
import { isMovement, pathOf, samplePath } from '../model/paths';
import { lerp } from '../geom/vec';
import { PASS_SPEED, SHOT_SPEED, MIN_SHOT_FLIGHT, speedOf } from '../model/physique';
import { BALL_ID, type Frame, type Tactic, type Vec2 } from '../model/types';

// 播放用的時間軸，對應 SPEC §5：
// - 分鏡內所有球員同時出發，依各自的速度沿路線移動
// - 傳球的出手時間會讓球剛好在接球者跑到終點時抵達（接球者不動則立刻出手）
// - 所有移動都結束後才進入下一個分鏡

/** 沒有任何移動的分鏡，仍停留這麼久，讓畫面看得出換分鏡 */
export const EMPTY_FRAME_SECONDS = 0.5;
/** SPEC §5：3x3 進攻時限 */
export const SHOT_CLOCK_SECONDS = 12;

interface Track {
  samples: Vec2[];
  cumulative: number[];
  length: number;
  duration: number;
}

interface BallFlight {
  kind: 'pass' | 'shot';
  from: string;
  /** 接球者；投籃時為 null（球飛向籃框） */
  to: string | null;
  launch: number;
  flight: number;
  track: Track;
}

export interface FrameTiming {
  start: number;
  duration: number;
  tracks: Map<string, Track>;
  flight: BallFlight | null;
}

export interface Timeline {
  frames: FrameTiming[];
  total: number;
  /** 投籃出手的時間點；沒有投籃時為 null。進攻時限看的是出手時間。 */
  shotReleaseAt: number | null;
}

/** 進攻時限要比較的時間：有投籃看出手時間，沒有則看總時間 */
export function possessionSeconds(tl: Timeline): number {
  return tl.shotReleaseAt ?? tl.total;
}

function makeTrack(samples: Vec2[], speed: number): Track {
  const cumulative = [0];
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1]!;
    const b = samples[i]!;
    cumulative.push(cumulative[i - 1]! + Math.hypot(b.x - a.x, b.y - a.y));
  }
  const length = cumulative.at(-1)!;
  return { samples, cumulative, length, duration: length / speed };
}

/** 走了 distance 公尺之後的位置 */
function pointAt(track: Track, distance: number): Vec2 {
  const { samples, cumulative } = track;
  if (distance <= 0) return samples[0]!;
  if (distance >= track.length) return samples.at(-1)!;
  let lo = 0;
  let hi = cumulative.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cumulative[mid]! <= distance) lo = mid;
    else hi = mid;
  }
  const a = samples[lo]!;
  const b = samples[hi]!;
  const seg = cumulative[hi]! - cumulative[lo]!;
  const t = seg === 0 ? 0 : (distance - cumulative[lo]!) / seg;
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

function timeFrame(tactic: Tactic, frame: Frame, start: number): FrameTiming {
  const tracks = new Map<string, Track>();
  let duration = 0;
  for (const player of tactic.players) {
    const path = pathOf(frame, player.id);
    if (!path || !isMovement(path.kind)) continue;
    const track = makeTrack(samplePath(frame, path), speedOf(player, path.kind === 'dribble'));
    tracks.set(player.id, track);
    duration = Math.max(duration, track.duration);
  }

  let flight: BallFlight | null = null;
  const holder = frame.ballHolderId;
  const ballPath = holder ? pathOf(frame, holder) : undefined;
  if (holder && ballPath?.kind === 'pass' && ballPath.targetId) {
    const track = makeTrack(samplePath(frame, ballPath), PASS_SPEED);
    const arrival = tracks.get(ballPath.targetId)?.duration ?? 0;
    const launch = Math.max(0, arrival - track.duration);
    flight = { kind: 'pass', from: holder, to: ballPath.targetId, launch, flight: track.duration, track };
    duration = Math.max(duration, launch + track.duration);
  } else if (holder && ballPath?.kind === 'shot') {
    // 投籃者在這個分鏡不移動，分鏡一開始就出手；很近的上籃也至少飛一段時間
    const track = makeTrack(samplePath(frame, ballPath), SHOT_SPEED);
    track.duration = Math.max(MIN_SHOT_FLIGHT, track.duration);
    flight = { kind: 'shot', from: holder, to: null, launch: 0, flight: track.duration, track };
    duration = Math.max(duration, track.duration);
  }

  return { start, duration: duration > 0 ? duration : EMPTY_FRAME_SECONDS, tracks, flight };
}

export function buildTimeline(tactic: Tactic): Timeline {
  const frames: FrameTiming[] = [];
  let t = 0;
  let shotReleaseAt: number | null = null;
  for (const frame of tactic.frames) {
    const timing = timeFrame(tactic, frame, t);
    if (timing.flight?.kind === 'shot') shotReleaseAt = t + timing.flight.launch;
    frames.push(timing);
    t += timing.duration;
  }
  return { frames, total: t, shotReleaseAt };
}

export interface Pose {
  frameIndex: number;
  positions: Record<string, Vec2>;
  ball: Vec2;
}

/** 時間 t（秒）時場上所有物件的位置 */
export function poseAt(tactic: Tactic, timeline: Timeline, t: number): Pose {
  let frameIndex = timeline.frames.findIndex((f) => t < f.start + f.duration);
  if (frameIndex === -1) frameIndex = timeline.frames.length - 1;
  const timing = timeline.frames[frameIndex]!;
  const frame = tactic.frames[frameIndex]!;
  const local = Math.min(Math.max(0, t - timing.start), timing.duration);

  const positions: Record<string, Vec2> = {};
  for (const player of tactic.players) {
    const track = timing.tracks.get(player.id);
    const start = frame.start[player.id]!;
    positions[player.id] = track ? pointAt(track, (local / track.duration) * track.length) : start;
  }

  let ball: Vec2;
  const { flight } = timing;
  if (flight && local >= flight.launch) {
    const u = Math.min(1, (local - flight.launch) / flight.flight);
    const along = pointAt(flight.track, u * flight.track.length);
    if (flight.kind === 'pass') {
      ball = add(u >= 1 ? positions[flight.to!]! : along, BALL_HOLD_OFFSET);
    } else {
      // 投籃：從手上的位置漸漸收斂到籃框中心
      ball = add(along, lerp(BALL_HOLD_OFFSET, { x: 0, y: 0 }, u));
    }
  } else if (frame.ballHolderId) {
    ball = add(positions[frame.ballHolderId]!, BALL_HOLD_OFFSET);
  } else {
    ball = frame.start[BALL_ID]!;
  }
  return { frameIndex, positions, ball };
}
