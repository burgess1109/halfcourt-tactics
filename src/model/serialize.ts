import { VIEW_BOUNDS } from '../court/fiba';
import { BALL_HOLD_OFFSET } from './entities';
import { MAX_FRAMES, syncFrames } from './frames';
import { shotControls } from './paths';
import { scoreOf, scoringOf } from './scoring';
import { newId } from './id';
import { HEIGHT_RANGE } from './physique';
import { defaultName } from './defaults';
import { NAME_MAX } from './playerForm';
import { BALL_ID, type Frame, type Grade, type Player, type Rating, type Tactic, type TacticPath, type Vec2 } from './types';
import { MESSAGES, t } from '../i18n';

const F = () => t().format;

// 存檔、JSON 匯出入、分享連結（SPEC §8）。
// 外部來的資料（檔案、網址、localStorage）一律經過 parseTactic 檢查，不直接相信。

/**
 * 資料格式版本；格式改變時加一，並在 parseTactic 裡遷移舊版本。
 * 2：暱稱可以是空字串（= 預設暱稱，顯示時依語系組出來）；第 1 版存的預設暱稱（「球員 1」…）讀取時轉成空字串。
 */
export const SCHEMA_VERSION = 2;
/** 戰術名稱長度上限（SPEC §8） */
export const TACTIC_NAME_MAX = 30;
/** 分享連結的 hash 前綴 */
export const SHARE_PREFIX = '#p=';

/** 資料不正確：訊息直接顯示給使用者 */
export class TacticFormatError extends Error {}

/** 檢查戰術名稱，回傳錯誤訊息；沒問題回傳 null */
export function nameError(name: string): string | null {
  const n = name.trim();
  if (n.length === 0) return t().nameDialog.required;
  if (n.length > TACTIC_NAME_MAX) return t().nameDialog.tooLong(TACTIC_NAME_MAX);
  return null;
}

const BLUE_IDS = ['b1', 'b2', 'b3'] as const;
const RED_IDS = ['r1', 'r2', 'r3'] as const;
const PATH_KINDS = ['cut', 'dribble', 'pass', 'screen', 'shot'] as const;
const GRADES: readonly Grade[] = ['S', 'A', 'B', 'C', 'D'];
const SKILL_KEYS = ['speed', 'iso', 'finishing', 'midRange', 'threePoint'] as const;
/** 座標可以稍微超出畫面（拖曳時圓心最多到邊緣） */
const COORD_SLACK = 1;

type Obj = Record<string, unknown>;

const fail = (what: string): never => {
  throw new TacticFormatError(F().invalid(what));
};
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const obj = (v: unknown, what: string): Obj => (isObj(v) ? v : fail(what));
const arr = (v: unknown, what: string): unknown[] => (Array.isArray(v) ? v : fail(what));
const str = (v: unknown, what: string): string => (typeof v === 'string' ? v : fail(what));
const bool = (v: unknown, what: string): boolean => (typeof v === 'boolean' ? v : fail(what));
const oneOf = <T extends string>(v: unknown, options: readonly T[], what: string): T =>
  options.includes(v as T) ? (v as T) : fail(what);

function rating(v: unknown, what: string): Rating {
  return Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 4 ? (v as Rating) : fail(what);
}

function vec(v: unknown, what: string): Vec2 {
  const o = obj(v, what);
  const { x, y } = o;
  if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) fail(what);
  const p = { x: x as number, y: y as number };
  const b = VIEW_BOUNDS;
  if (p.x < b.minX - COORD_SLACK || p.x > b.maxX + COORD_SLACK || p.y < b.minY - COORD_SLACK || p.y > b.maxY + COORD_SLACK) {
    fail(F().outOfCourt(what));
  }
  return p;
}

function parsePlayer(v: unknown, id: string, version: number): Player {
  const o = obj(v, F().player(id));
  const team = id.startsWith('b') ? 'blue' : 'red';
  if (o.team !== team) fail(F().playerTeam(id));
  const number = o.number;
  if (!Number.isInteger(number) || (number as number) < 0 || (number as number) > 99) fail(F().playerNumber(id));
  let name = str(o.name, F().playerName(id)).trim();
  if (name.length > NAME_MAX || (version < 2 && name.length === 0)) fail(F().playerName(id));
  // 第 1 版把預設暱稱寫進資料（當時只有繁體中文）：轉成空字串，顯示時依目前語系組出來。
  // 其他名字（例如自己取的「Player 1」）都是使用者取的，不動
  if (version < 2 && defaultName({ id, team }, MESSAGES.zh) === name) name = '';
  const p: Player = { id, team, number: number as number, name };
  if (o.heightCm !== undefined) {
    const h = o.heightCm;
    if (!Number.isInteger(h) || (h as number) < HEIGHT_RANGE.min || (h as number) > HEIGHT_RANGE.max) fail(F().playerHeight(id));
    p.heightCm = h as number;
  }
  if (team === 'blue') {
    const s = obj(o.skills, F().playerSkills(id));
    p.skills = {
      speed: rating(s.speed, F().playerSkills(id)),
      iso: rating(s.iso, F().playerSkills(id)),
      finishing: rating(s.finishing, F().playerSkills(id)),
      // 舊資料只有一項「外線投射」（shooting）：中距離與弧外都用它
      midRange: rating(s.midRange ?? s.shooting, F().playerSkills(id)),
      threePoint: rating(s.threePoint ?? s.shooting, F().playerSkills(id)),
    };
    for (const k of Object.keys(s)) if (!SKILL_KEYS.includes(k as never) && k !== 'shooting') fail(F().playerSkills(id));
  } else if (o.speedRating !== undefined && o.speedRating !== 2) {
    p.speedRating = rating(o.speedRating, F().playerSpeed(id));
  }
  return p;
}

function parsePath(v: unknown, frameNo: number): TacticPath {
  const what = F().framePaths(frameNo);
  const o = obj(v, what);
  const kind = oneOf(o.kind, PATH_KINDS, what);
  // 紅隊只有跑位（關閉自動防守時才用得到；啟用時讀進來後會移除）
  const actorId = oneOf(o.actorId, kind === 'cut' ? [...BLUE_IDS, ...RED_IDS] : BLUE_IDS, what);
  // 投籃弧線由出手位置自動產生（resolvePoints），分享連結不帶控制點，還原後再補上
  const points = kind === 'shot' && o.points === undefined ? [] : arr(o.points, what).map((p) => vec(p, what));
  if ((kind !== 'shot' || points.length > 0) && (points.length < 2 || points.length > 200)) fail(what);
  let targetId: string | undefined;
  if (kind === 'pass') {
    targetId = oneOf(o.targetId, BLUE_IDS, what);
    if (targetId === actorId) fail(what);
  }
  // 欄位順序和編輯時建立的路線相同（authoredSignature 依 JSON 比對）
  return {
    id: typeof o.id === 'string' && o.id ? o.id : newId(),
    kind,
    actorId,
    ...(targetId && { targetId }),
    points,
    freehand: o.freehand === undefined ? false : bool(o.freehand, what),
  };
}

function parseRedStarts(v: unknown): Record<string, Vec2> {
  const o = obj(v, F().redStarts);
  const out: Record<string, Vec2> = {};
  for (const [k, p] of Object.entries(o)) out[oneOf(k, RED_IDS, F().redStarts)] = vec(p, F().redStarts);
  return out;
}

export interface ParseResult {
  tactic: Tactic;
  /** 不成立、被移除的路線數量（例如持球者不對的運球） */
  removed: number;
}

/**
 * 檢查並還原一份戰術。會自動推算的部分（後面分鏡的站位、紅隊位置）可以省略，
 * 檢查完一律用 syncFrames 重新推算，所以紅隊位置不會被外部資料左右。
 */
export function parseTactic(data: unknown): ParseResult {
  const o = obj(data, F().notTactic);
  const version = o.version;
  if (typeof version !== 'number') fail(F().noVersion);
  if ((version as number) > SCHEMA_VERSION) throw new TacticFormatError(F().newerVersion);
  if (version !== 1 && version !== SCHEMA_VERSION) fail(F().version);
  if (o.mode !== 'offense') {
    if (o.mode === 'defense') throw new TacticFormatError(F().defenseMode);
    fail(F().mode);
  }

  const name = o.name === undefined ? '' : str(o.name, F().name).trim();
  if (name.length > TACTIC_NAME_MAX) fail(F().nameTooLong);

  const playersIn = arr(o.players, F().players);
  // 保留原本的順序（畫圖的先後順序依陣列）
  const ids: string[] = [...BLUE_IDS, ...RED_IDS];
  if (playersIn.length !== ids.length) fail(F().playerCount);
  const players = playersIn.map((p) => parsePlayer(p, oneOf(isObj(p) ? p.id : undefined, ids, F().players), version as number));
  if (new Set(players.map((p) => p.id)).size !== ids.length) fail(F().duplicatePlayer);
  for (const team of ['blue', 'red'] as const) {
    const numbers = players.filter((p) => p.team === team).map((p) => p.number);
    if (new Set(numbers).size !== numbers.length) fail(F().duplicateNumber);
  }

  const m = obj(o.matchups, F().matchups);
  const matchups: Record<string, string> = {};
  for (const b of BLUE_IDS) matchups[b] = oneOf(m[b], RED_IDS, F().matchups);
  if (new Set(Object.values(matchups)).size !== 3 || Object.keys(m).length !== 3) fail(F().matchups);

  const s = obj(o.setup, F().setup);
  const setup: Tactic['setup'] = {
    blueSkipped: bool(s.blueSkipped, F().setup),
    redSkipped: bool(s.redSkipped, F().setup),
    matchupsCustomized: bool(s.matchupsCustomized, F().setup),
  };
  if (s.lineup !== undefined) {
    const l = obj(s.lineup, F().lineup);
    const pos = obj(l.positions, F().lineup);
    const positions: Record<string, Vec2> = {};
    for (const b of BLUE_IDS) positions[b] = vec(pos[b], F().lineup);
    setup.lineup = { positions, holder: oneOf(l.holder, BLUE_IDS, F().lineupHolder) };
  }

  // 關閉自動防守時，每個分鏡的紅隊位置是使用者設定的，要一起讀進來（舊資料沒有這個欄位：啟用）
  const autoDefense = o.autoDefense === undefined ? true : bool(o.autoDefense, F().autoDefense);
  const framesIn = arr(o.frames, F().frames);
  if (framesIn.length < 1 || framesIn.length > MAX_FRAMES) fail(F().frameCount(MAX_FRAMES));
  const first = obj(framesIn[0], F().frame(1));
  const firstStart = obj(first.start, F().frameStart(1));
  const start: Frame['start'] = {};
  for (const b of BLUE_IDS) start[b] = vec(firstStart[b], F().frameStart(1));
  const holder = first.ballHolderId === null ? null : oneOf(first.ballHolderId, BLUE_IDS, F().holder);
  // 有持球者時球跟著持球者（syncFrames 會放好）；球在地上時需要位置
  if (firstStart[BALL_ID] !== undefined || holder === null) start[BALL_ID] = vec(firstStart[BALL_ID], F().ball);
  const frames: Frame[] = framesIn.map((f, i) => {
    const fo = obj(f, F().frame(i + 1));
    const paths = arr(fo.paths, F().framePaths(i + 1)).map((p) => parsePath(p, i + 1));
    const actors = paths.map((p) => p.actorId);
    if (new Set(actors).size !== actors.length) fail(F().duplicateActor(i + 1));
    if (i < framesIn.length - 1 && paths.some((p) => p.kind === 'shot')) fail(F().shotLastFrame);
    const frame: Frame = i === 0 ? { start, ballHolderId: holder, paths } : { start: {}, ballHolderId: null, paths };
    return frame;
  });
  if (holder && !start[BALL_ID]) {
    const h = start[holder]!;
    start[BALL_ID] = { x: h.x + BALL_HOLD_OFFSET.x, y: h.y + BALL_HOLD_OFFSET.y };
  }

  const tactic: Tactic = {
    version: SCHEMA_VERSION,
    id: typeof o.id === 'string' && /^[a-z0-9]{1,40}$/.test(o.id) ? o.id : newId(),
    name,
    mode: 'offense',
    setup,
    matchups,
    screenDefense: oneOf(o.screenDefense, ['switch', 'fight-over'] as const, F().screenDefense),
    // 舊資料沒有這個欄位：預設沉退
    pickCoverage: o.pickCoverage === undefined ? 'drop' : oneOf(o.pickCoverage, ['drop', 'hedge'] as const, F().pickCoverage),
    pressure: o.pressure === undefined ? 'normal' : oneOf(o.pressure, ['normal', 'tight'] as const, F().pressure),
    driveHelp: o.driveHelp === undefined ? 'off' : oneOf(o.driveHelp, ['off', 'weak-side'] as const, F().driveHelp),
    autoDefense,
    // 舊資料沒有這個欄位：FIBA 3x3
    scoring: o.scoring === undefined ? 'fiba3x3' : oneOf(o.scoring, ['fiba3x3', 'standard'] as const, F().scoring),
    // 關閉自動防守時，使用者拖過的紅隊開局位置（之後的分鏡由紅隊跑位推算）
    ...(o.redStarts !== undefined && !autoDefense && { redStarts: parseRedStarts(o.redStarts) }),
    players,
    frames,
    updatedAt: typeof o.updatedAt === 'number' && Number.isFinite(o.updatedAt) ? o.updatedAt : Date.now(),
  };

  if (o.basedOn !== undefined) {
    const b = obj(o.basedOn, F().basedOn);
    const r = obj(b.roles, F().basedOn);
    const roles = { A: oneOf(r.A, BLUE_IDS, F().roles), B: oneOf(r.B, BLUE_IDS, F().roles), C: oneOf(r.C, BLUE_IDS, F().roles) };
    if (new Set(Object.values(roles)).size !== 3) fail(F().roles);
    tactic.basedOn = {
      playId: str(b.playId, F().basedOn),
      roles,
      modified: bool(b.modified, F().basedOn),
      ...(b.shot !== undefined && { shot: oneOf(b.shot, ['paint', 'mid', 'three'] as const, F().basedOn) }),
    };
  }
  if (o.lastResult !== undefined) {
    const r = obj(o.lastResult, F().result);
    const ep = r.expectedPoints;
    // 一球最多 3 分（一般規則的弧外）
    if (typeof ep !== 'number' || !Number.isFinite(ep) || ep < 0 || ep > 3) fail(F().result);
    // 舊資料沒有 0–100 分：依計分規則換算
    const score = r.score === undefined ? scoreOf(ep as number, scoringOf(tactic)) : r.score;
    if (typeof score !== 'number' || !Number.isFinite(score) || score < 0 || score > 100) fail(F().result);
    tactic.lastResult = { grade: oneOf(r.grade, GRADES, F().result), expectedPoints: ep as number, score: score as number };
  }

  // 啟用自動防守時紅隊路線用不到，移除並算進不成立的路線
  let redPaths = 0;
  if (autoDefense) {
    for (const f of tactic.frames) {
      const before = f.paths.length;
      f.paths = f.paths.filter((p) => !(RED_IDS as readonly string[]).includes(p.actorId));
      redPaths += before - f.paths.length;
    }
  }
  const removed = syncFrames(tactic, true) + redPaths;
  for (const f of tactic.frames) {
    for (const p of f.paths) if (p.kind === 'shot' && p.points.length === 0) p.points = shotControls(f.start[p.actorId]!);
  }
  return { tactic, removed };
}

// ---- JSON 檔 ----

/** 匯出成 JSON 檔的內容（完整資料，排版過方便閱讀） */
export function toJsonFile(tactic: Tactic): string {
  return JSON.stringify(tactic, null, 2) + '\n';
}

/** 讀取 JSON 檔；格式不對時丟出 TacticFormatError */
export function fromJsonFile(text: string): ParseResult {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new TacticFormatError(F().notJson);
  }
  return parseTactic(data);
}

/** 檔名：去掉檔名不能用的字元 */
export function jsonFileName(tactic: Tactic): string {
  const base = tactic.name.trim().replace(/[\\/:*?"<>|\s]+/g, '_') || F().fileName;
  return `${base}.json`;
}

// ---- 分享連結 ----

const cm = (v: number) => Math.round(v * 100) / 100;
const roundVec = (p: Vec2): Vec2 => ({ x: cm(p.x), y: cm(p.y) });

/**
 * 分享用的精簡資料（SPEC §8）：座標四捨五入到公分，
 * 去掉可以重新推算的部分（後面分鏡的站位、紅隊位置）、路線 id、評分與時間。
 * 手繪路線在畫完時已經簡化過。
 */
export function compactForShare(tactic: Tactic): object {
  const first = tactic.frames[0]!;
  const start: Record<string, Vec2> = {};
  for (const b of BLUE_IDS) start[b] = roundVec(first.start[b]!);
  if (first.ballHolderId === null) start[BALL_ID] = roundVec(first.start[BALL_ID]!);
  const lineup = tactic.setup.lineup;
  return {
    version: tactic.version,
    name: tactic.name,
    mode: tactic.mode,
    setup: {
      ...tactic.setup,
      ...(lineup && {
        lineup: { holder: lineup.holder, positions: Object.fromEntries(Object.entries(lineup.positions).map(([k, p]) => [k, roundVec(p)])) },
      }),
    },
    matchups: tactic.matchups,
    screenDefense: tactic.screenDefense,
    pickCoverage: tactic.pickCoverage,
    pressure: tactic.pressure,
    driveHelp: tactic.driveHelp,
    autoDefense: tactic.autoDefense,
    scoring: tactic.scoring,
    ...(!tactic.autoDefense && tactic.redStarts && { redStarts: roundRecord(tactic.redStarts) }),
    ...(tactic.basedOn && { basedOn: tactic.basedOn }),
    players: tactic.players,
    frames: tactic.frames.map((f, i) => ({
      ...(i === 0 && { start, ballHolderId: first.ballHolderId }),
      paths: f.paths.map((p) => ({
        kind: p.kind,
        actorId: p.actorId,
        ...(p.targetId && { targetId: p.targetId }),
        ...(p.kind !== 'shot' && { points: p.points.map(roundVec) }),
        ...(p.freehand && { freehand: true }),
      })),
    })),
  };
}

const roundRecord = (r: Record<string, Vec2>) => Object.fromEntries(Object.entries(r).map(([k, p]) => [k, roundVec(p)]));

function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) throw new TacticFormatError(F().shareBroken);
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}

/** 分享連結的 hash（含 #p=） */
export async function encodeShare(tactic: Tactic): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify(compactForShare(tactic)));
  return SHARE_PREFIX + toBase64Url(await pipe(json, new CompressionStream('deflate-raw')));
}

/** 從分享連結的 hash 還原戰術（新的 id，不會覆蓋使用者已存的戰術） */
export async function decodeShare(hash: string): Promise<ParseResult> {
  if (!hash.startsWith(SHARE_PREFIX)) throw new TacticFormatError(F().notShare);
  let text: string;
  try {
    text = new TextDecoder().decode(await pipe(fromBase64Url(hash.slice(SHARE_PREFIX.length)), new DecompressionStream('deflate-raw')));
  } catch (e) {
    if (e instanceof TacticFormatError) throw e;
    throw new TacticFormatError(F().shareBroken);
  }
  const result = fromJsonFile(text);
  result.tactic.id = newId();
  return result;
}
