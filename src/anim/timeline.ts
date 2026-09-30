import { add } from '../geom/vec';
import { BALL_HOLD_OFFSET } from '../model/entities';
import { isMovement, pathOf, samplePath } from '../model/paths';
import { PASS_SPEED, speedOf } from '../model/physique';
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

interface PassPlan {
  from: string;
  to: string;
  launch: number;
  flight: number;
  track: Track;
}

export interface FrameTiming {
  start: number;
  duration: number;
  tracks: Map<string, Track>;
  pass: PassPlan | null;
}

export interface Timeline {
  frames: FrameTiming[];
  total: number;
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

  let pass: PassPlan | null = null;
  const holder = frame.ballHolderId;
  const passPath = holder ? pathOf(frame, holder) : undefined;
  if (holder && passPath?.kind === 'pass' && passPath.targetId) {
    const track = makeTrack(samplePath(frame, passPath), PASS_SPEED);
    const arrival = tracks.get(passPath.targetId)?.duration ?? 0;
    const launch = Math.max(0, arrival - track.duration);
    pass = { from: holder, to: passPath.targetId, launch, flight: track.duration, track };
    duration = Math.max(duration, launch + track.duration);
  }

  return { start, duration: duration > 0 ? duration : EMPTY_FRAME_SECONDS, tracks, pass };
}

export function buildTimeline(tactic: Tactic): Timeline {
  const frames: FrameTiming[] = [];
  let t = 0;
  for (const frame of tactic.frames) {
    const timing = timeFrame(tactic, frame, t);
    frames.push(timing);
    t += timing.duration;
  }
  return { frames, total: t };
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
  const { pass } = timing;
  if (pass && local >= pass.launch) {
    const flown = local - pass.launch;
    ball =
      flown >= pass.flight
        ? add(positions[pass.to]!, BALL_HOLD_OFFSET)
        : add(pointAt(pass.track, (flown / pass.flight) * pass.track.length), BALL_HOLD_OFFSET);
  } else if (frame.ballHolderId) {
    ball = add(positions[frame.ballHolderId]!, BALL_HOLD_OFFSET);
  } else {
    ball = frame.start[BALL_ID]!;
  }
  return { frameIndex, positions, ball };
}
