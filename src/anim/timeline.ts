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
// - 上一個分鏡設了掩護的人，這個分鏡先站住 SCREEN_HOLD_SECONDS 再移動（掩護者等持球者過了才下順）

/** 沒有任何移動的分鏡，仍停留這麼久，讓畫面看得出換分鏡 */
export const EMPTY_FRAME_SECONDS = 0.5;
/** 掩護者在下一個分鏡先站住多久才開始移動（秒） */
export const SCREEN_HOLD_SECONDS = 0.5;

interface Track {
  samples: Vec2[];
  cumulative: number[];
  length: number;
  /** 移動本身花的時間（不含等待） */
  duration: number;
  /** 分鏡開始後，等多久才出發 */
  delay: number;
}

/** 從分鏡開始到抵達終點的時間 */
const arrivalOf = (track: Track) => track.delay + track.duration;

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

function makeTrack(samples: Vec2[], speed: number, delay = 0): Track {
  const cumulative = [0];
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1]!;
    const b = samples[i]!;
    cumulative.push(cumulative[i - 1]! + Math.hypot(b.x - a.x, b.y - a.y));
  }
  const length = cumulative.at(-1)!;
  return { samples, cumulative, length, duration: length / speed, delay };
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

function timeFrame(tactic: Tactic, frame: Frame, prev: Frame | undefined, start: number): FrameTiming {
  const tracks = new Map<string, Track>();
  let duration = 0;
  for (const player of tactic.players) {
    // 紅隊只有在關閉自動防守時才照自己的跑位路線移動（啟用時由防守模擬決定）
    if (player.team === 'red' && tactic.autoDefense) continue;
    const path = pathOf(frame, player.id);
    if (!path || !isMovement(path.kind)) continue;
    const held = prev && pathOf(prev, player.id)?.kind === 'screen' ? SCREEN_HOLD_SECONDS : 0;
    const speed = speedOf(player, tactic.players, path.kind === 'dribble');
    const track = makeTrack(samplePath(frame, path), speed, held);
    tracks.set(player.id, track);
    duration = Math.max(duration, arrivalOf(track));
  }

  let flight: BallFlight | null = null;
  const holder = frame.ballHolderId;
  const ballPath = holder ? pathOf(frame, holder) : undefined;
  if (holder && ballPath?.kind === 'pass' && ballPath.targetId) {
    const track = makeTrack(samplePath(frame, ballPath), PASS_SPEED);
    const receiver = tracks.get(ballPath.targetId);
    const arrival = receiver ? arrivalOf(receiver) : 0;
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
  for (const [i, frame] of tactic.frames.entries()) {
    const timing = timeFrame(tactic, frame, tactic.frames[i - 1], t);
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
    const moving = track ? Math.min(1, Math.max(0, (local - track.delay) / track.duration)) : 0;
    positions[player.id] = track ? pointAt(track, moving * track.length) : start;
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

/** 時間 t 時誰持球；球在空中（傳球飛行中、投籃後）時為 null */
export function ballHolderAt(tactic: Tactic, timeline: Timeline, t: number): string | null {
  let frameIndex = timeline.frames.findIndex((f) => t < f.start + f.duration);
  if (frameIndex === -1) frameIndex = timeline.frames.length - 1;
  const timing = timeline.frames[frameIndex]!;
  const local = t - timing.start;
  const { flight } = timing;
  if (flight && local >= flight.launch) {
    if (flight.kind === 'shot') return null;
    return local >= flight.launch + flight.flight ? flight.to : null;
  }
  return tactic.frames[frameIndex]!.ballHolderId;
}

/** 一個掩護：掩護者跑到終點後開始生效 */
export interface ScreenSpot {
  screenerId: string;
  spot: Vec2;
  /** 掩護者抵達掩護點的時間 */
  setAt: number;
}

export function screensOf(tactic: Tactic, timeline: Timeline): ScreenSpot[] {
  const out: ScreenSpot[] = [];
  tactic.frames.forEach((frame, i) => {
    const timing = timeline.frames[i]!;
    for (const path of frame.paths) {
      if (path.kind !== 'screen') continue;
      const track = timing.tracks.get(path.actorId);
      if (!track) continue;
      out.push({ screenerId: path.actorId, spot: track.samples.at(-1)!, setAt: timing.start + arrivalOf(track) });
    }
  });
  return out;
}

/** 時間 t 時正在飛行中的傳球（不含投籃）；沒有則回傳 null */
export function passAt(timeline: Timeline, t: number): { from: string; to: string } | null {
  let frameIndex = timeline.frames.findIndex((f) => t < f.start + f.duration);
  if (frameIndex === -1) frameIndex = timeline.frames.length - 1;
  const timing = timeline.frames[frameIndex]!;
  const local = t - timing.start;
  const { flight } = timing;
  if (flight?.kind === 'pass' && local >= flight.launch && local < flight.launch + flight.flight) {
    return { from: flight.from, to: flight.to! };
  }
  return null;
}
