import { VIEW_BOUNDS } from '../court/fiba';
import { BALL_HOLD_OFFSET } from './entities';
import { MAX_FRAMES, syncFrames } from './frames';
import { shotControls } from './paths';
import { scoreOf, scoringOf } from './scoring';
import { newId } from './id';
import { HEIGHT_RANGE } from './physique';
import { NAME_MAX } from './playerForm';
import { BALL_ID, type Frame, type Grade, type Player, type Rating, type Tactic, type TacticPath, type Vec2 } from './types';

// 存檔、JSON 匯出入、分享連結（SPEC §8）。
// 外部來的資料（檔案、網址、localStorage）一律經過 parseTactic 檢查，不直接相信。

/** 資料格式版本；格式改變時加一，並在 parseTactic 裡遷移舊版本 */
export const SCHEMA_VERSION = 1;
/** 戰術名稱長度上限（SPEC §8） */
export const TACTIC_NAME_MAX = 30;
/** 分享連結的 hash 前綴 */
export const SHARE_PREFIX = '#p=';

/** 資料不正確：訊息直接顯示給使用者 */
export class TacticFormatError extends Error {}

/** 檢查戰術名稱，回傳錯誤訊息；沒問題回傳 null */
export function nameError(name: string): string | null {
  const n = name.trim();
  if (n.length === 0) return '請輸入戰術名稱';
  if (n.length > TACTIC_NAME_MAX) return `戰術名稱最多 ${TACTIC_NAME_MAX} 個字`;
  return null;
}

const BLUE_IDS = ['b1', 'b2', 'b3'] as const;
const RED_IDS = ['r1', 'r2', 'r3'] as const;
const PATH_KINDS = ['cut', 'dribble', 'pass', 'screen', 'shot'] as const;
const GRADES: readonly Grade[] = ['S', 'A', 'B', 'C', 'D'];
const SKILL_KEYS = ['midRange', 'threePoint', 'speed', 'finishing', 'iso'] as const;
/** 座標可以稍微超出畫面（拖曳時圓心最多到邊緣） */
const COORD_SLACK = 1;

type Obj = Record<string, unknown>;

const fail = (what: string): never => {
  throw new TacticFormatError(`戰術資料不正確：${what}`);
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
    fail(`${what}超出球場`);
  }
  return p;
}

function parsePlayer(v: unknown, id: string): Player {
  const o = obj(v, `球員 ${id}`);
  const team = id.startsWith('b') ? 'blue' : 'red';
  if (o.team !== team) fail(`球員 ${id} 的隊伍`);
  const number = o.number;
  if (!Number.isInteger(number) || (number as number) < 0 || (number as number) > 99) fail(`球員 ${id} 的號碼`);
  const name = str(o.name, `球員 ${id} 的暱稱`).trim();
  if (name.length === 0 || name.length > NAME_MAX) fail(`球員 ${id} 的暱稱`);
  const p: Player = { id, team, number: number as number, name };
  if (o.heightCm !== undefined) {
    const h = o.heightCm;
    if (!Number.isInteger(h) || (h as number) < HEIGHT_RANGE.min || (h as number) > HEIGHT_RANGE.max) fail(`球員 ${id} 的身高`);
    p.heightCm = h as number;
  }
  if (team === 'blue') {
    const s = obj(o.skills, `球員 ${id} 的能力`);
    p.skills = {
      // 舊資料只有一項「外線投射」（shooting）：中距離與弧外都用它
      midRange: rating(s.midRange ?? s.shooting, `球員 ${id} 的能力`),
      threePoint: rating(s.threePoint ?? s.shooting, `球員 ${id} 的能力`),
      speed: rating(s.speed, `球員 ${id} 的能力`),
      finishing: rating(s.finishing, `球員 ${id} 的能力`),
      iso: rating(s.iso, `球員 ${id} 的能力`),
    };
    for (const k of Object.keys(s)) if (!SKILL_KEYS.includes(k as never) && k !== 'shooting') fail(`球員 ${id} 的能力`);
  } else if (o.speedRating !== undefined && o.speedRating !== 2) {
    p.speedRating = rating(o.speedRating, `球員 ${id} 的速度`);
  }
  return p;
}

function parsePath(v: unknown, frameNo: number): TacticPath {
  const what = `第 ${frameNo} 個分鏡的路線`;
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
  const o = obj(v, '紅隊開局位置');
  const out: Record<string, Vec2> = {};
  for (const [k, p] of Object.entries(o)) out[oneOf(k, RED_IDS, '紅隊開局位置')] = vec(p, '紅隊開局位置');
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
  const o = obj(data, '不是戰術檔');
  const version = o.version;
  if (typeof version !== 'number') fail('缺少版本');
  if ((version as number) > SCHEMA_VERSION) throw new TacticFormatError('這份戰術來自較新的版本，請重新整理頁面後再試');
  if (version !== SCHEMA_VERSION) fail('版本');
  if (o.mode !== 'offense') {
    if (o.mode === 'defense') throw new TacticFormatError('防守模式的戰術還不支援');
    fail('模式');
  }

  const name = o.name === undefined ? '' : str(o.name, '名稱').trim();
  if (name.length > TACTIC_NAME_MAX) fail('名稱太長');

  const playersIn = arr(o.players, '球員');
  // 保留原本的順序（畫圖的先後順序依陣列）
  const ids: string[] = [...BLUE_IDS, ...RED_IDS];
  if (playersIn.length !== ids.length) fail('球員人數');
  const players = playersIn.map((p) => parsePlayer(p, oneOf(isObj(p) ? p.id : undefined, ids, '球員')));
  if (new Set(players.map((p) => p.id)).size !== ids.length) fail('球員重複');
  for (const team of ['blue', 'red'] as const) {
    const numbers = players.filter((p) => p.team === team).map((p) => p.number);
    if (new Set(numbers).size !== numbers.length) fail('號碼重複');
  }

  const m = obj(o.matchups, '對位');
  const matchups: Record<string, string> = {};
  for (const b of BLUE_IDS) matchups[b] = oneOf(m[b], RED_IDS, '對位');
  if (new Set(Object.values(matchups)).size !== 3 || Object.keys(m).length !== 3) fail('對位');

  const s = obj(o.setup, '設定');
  const setup: Tactic['setup'] = {
    blueSkipped: bool(s.blueSkipped, '設定'),
    redSkipped: bool(s.redSkipped, '設定'),
    matchupsCustomized: bool(s.matchupsCustomized, '設定'),
  };
  if (s.lineup !== undefined) {
    const l = obj(s.lineup, '開局站位');
    const pos = obj(l.positions, '開局站位');
    const positions: Record<string, Vec2> = {};
    for (const b of BLUE_IDS) positions[b] = vec(pos[b], '開局站位');
    setup.lineup = { positions, holder: oneOf(l.holder, BLUE_IDS, '開局站位的持球者') };
  }

  // 關閉自動防守時，每個分鏡的紅隊位置是使用者設定的，要一起讀進來（舊資料沒有這個欄位：啟用）
  const autoDefense = o.autoDefense === undefined ? true : bool(o.autoDefense, '自動防守');
  const framesIn = arr(o.frames, '分鏡');
  if (framesIn.length < 1 || framesIn.length > MAX_FRAMES) fail(`分鏡數量要是 1–${MAX_FRAMES} 個`);
  const first = obj(framesIn[0], '第 1 個分鏡');
  const firstStart = obj(first.start, '第 1 個分鏡的站位');
  const start: Frame['start'] = {};
  for (const b of BLUE_IDS) start[b] = vec(firstStart[b], '第 1 個分鏡的站位');
  const holder = first.ballHolderId === null ? null : oneOf(first.ballHolderId, BLUE_IDS, '持球者');
  // 有持球者時球跟著持球者（syncFrames 會放好）；球在地上時需要位置
  if (firstStart[BALL_ID] !== undefined || holder === null) start[BALL_ID] = vec(firstStart[BALL_ID], '球的位置');
  const frames: Frame[] = framesIn.map((f, i) => {
    const fo = obj(f, `第 ${i + 1} 個分鏡`);
    const paths = arr(fo.paths, `第 ${i + 1} 個分鏡的路線`).map((p) => parsePath(p, i + 1));
    const actors = paths.map((p) => p.actorId);
    if (new Set(actors).size !== actors.length) fail(`第 ${i + 1} 個分鏡同一位球員有兩條路線`);
    if (i < framesIn.length - 1 && paths.some((p) => p.kind === 'shot')) fail('投籃只能在最後一個分鏡');
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
    screenDefense: oneOf(o.screenDefense, ['switch', 'fight-over'] as const, '掩護應對'),
    // 舊資料沒有這個欄位：預設沉退
    pickCoverage: o.pickCoverage === undefined ? 'drop' : oneOf(o.pickCoverage, ['drop', 'hedge'] as const, '擋拆協防'),
    pressure: o.pressure === undefined ? 'normal' : oneOf(o.pressure, ['normal', 'tight'] as const, '防守距離'),
    driveHelp: o.driveHelp === undefined ? 'off' : oneOf(o.driveHelp, ['off', 'weak-side'] as const, '補防'),
    autoDefense,
    // 舊資料沒有這個欄位：FIBA 3x3
    scoring: o.scoring === undefined ? 'fiba3x3' : oneOf(o.scoring, ['fiba3x3', 'standard'] as const, '計分規則'),
    // 關閉自動防守時，使用者拖過的紅隊開局位置（之後的分鏡由紅隊跑位推算）
    ...(o.redStarts !== undefined && !autoDefense && { redStarts: parseRedStarts(o.redStarts) }),
    players,
    frames,
    updatedAt: typeof o.updatedAt === 'number' && Number.isFinite(o.updatedAt) ? o.updatedAt : Date.now(),
  };

  if (o.basedOn !== undefined) {
    const b = obj(o.basedOn, '戰術來源');
    const r = obj(b.roles, '戰術來源');
    const roles = { A: oneOf(r.A, BLUE_IDS, '角色'), B: oneOf(r.B, BLUE_IDS, '角色'), C: oneOf(r.C, BLUE_IDS, '角色') };
    if (new Set(Object.values(roles)).size !== 3) fail('角色');
    tactic.basedOn = {
      playId: str(b.playId, '戰術來源'),
      roles,
      modified: bool(b.modified, '戰術來源'),
      ...(b.shot !== undefined && { shot: oneOf(b.shot, ['mid', 'three'] as const, '戰術來源') }),
    };
  }
  if (o.lastResult !== undefined) {
    const r = obj(o.lastResult, '評分');
    const ep = r.expectedPoints;
    // 一球最多 3 分（一般規則的弧外）
    if (typeof ep !== 'number' || !Number.isFinite(ep) || ep < 0 || ep > 3) fail('評分');
    // 舊資料沒有 0–100 分：依計分規則換算
    const score = r.score === undefined ? scoreOf(ep as number, scoringOf(tactic)) : r.score;
    if (typeof score !== 'number' || !Number.isFinite(score) || score < 0 || score > 100) fail('評分');
    tactic.lastResult = { grade: oneOf(r.grade, GRADES, '評分'), expectedPoints: ep as number, score: score as number };
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
    throw new TacticFormatError('這不是 JSON 檔');
  }
  return parseTactic(data);
}

/** 檔名：去掉檔名不能用的字元 */
export function jsonFileName(tactic: Tactic): string {
  const base = tactic.name.trim().replace(/[\\/:*?"<>|\s]+/g, '_') || '戰術';
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
  if (!/^[A-Za-z0-9_-]*$/.test(s)) throw new TacticFormatError('分享連結不完整或已損壞');
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
  if (!hash.startsWith(SHARE_PREFIX)) throw new TacticFormatError('不是分享連結');
  let text: string;
  try {
    text = new TextDecoder().decode(await pipe(fromBase64Url(hash.slice(SHARE_PREFIX.length)), new DecompressionStream('deflate-raw')));
  } catch (e) {
    if (e instanceof TacticFormatError) throw e;
    throw new TacticFormatError('分享連結不完整或已損壞');
  }
  const result = fromJsonFile(text);
  result.tactic.id = newId();
  return result;
}
