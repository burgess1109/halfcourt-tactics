import type { PathKind, ShotZone, Skills, Vec2 } from '../model/types';

export type { ShotZone };

// 內建戰術庫（SPEC §6.3）。每套戰術用三個角色 A / B / C 描述，載入時再換成實際球員。
// 座標單位為公尺：原點在底線中點，籃框在 (0, 1.575)，弧線（三分線）半徑 6.75。
// 用詞：說明一律寫「弧內 / 弧外」（分數依計分規則，FIBA 3x3 弧內 1 分、弧外 2 分）。
// 權重：跳投的終結者看出手點的投射能力（中距離投射 / 弧外投射）；拉開空間的人看弧外投射。

export type Role = 'A' | 'B' | 'C';
export const ROLES: readonly Role[] = ['A', 'B', 'C'];

export interface PlayPath {
  kind: PathKind;
  actor: Role;
  /** 移動路線的終點（傳球、投籃不用） */
  to?: Vec2;
  /** 中間經過的點，讓路線轉彎 */
  via?: Vec2[];
  /** 傳球的接球者 */
  target?: Role;
}

export interface PlayFrame {
  note: string;
  paths: PlayPath[];
}

/** 推薦用的權重：能力（0–4 分）與身高（越高越好） */
export type RoleWeights = Partial<Record<keyof Skills | 'height', number>>;


/**
 * 跳投戰術的另一個出手點（SPEC §6.3）：只改終結者在某個分鏡的移動終點與說明，其他跑位、掩護、傳球都一樣
 * （傳球會自動傳到新的位置）。推薦時兩個出手點都模擬，選分數高的。
 */
export interface ShotVariant {
  shot: ShotZone;
  /** 改終結者在第幾個分鏡（0 起算）的移動路線 */
  frame: number;
  to: Vec2;
  via?: Vec2[];
  /** 換掉說明的分鏡（0 起算）→ 新的說明 */
  notes: Record<number, string>;
  summary: string;
  finish: string;
}

export interface Play {
  id: string;
  category: string;
  name: string;
  summary: string;
  roles: Record<Role, string>;
  start: Record<Role, Vec2>;
  ball: Role;
  frames: PlayFrame[];
  finisher: Role;
  finish: string;
  weights: Record<Role, RoleWeights>;
  /** 跳投戰術：這個版本的出手點（切入、禁區終結的戰術沒有） */
  shot?: ShotZone;
  /** 跳投戰術的另一個出手點 */
  alt?: ShotVariant;
}

export const SHOT_LABEL: Record<ShotZone, string> = { mid: '中距離', three: '弧外' };

const SHOT_SKILL = { mid: 'midRange', three: 'threePoint' } as const;

/**
 * 依出手點取得戰術：shot 是另一個出手點時，產生改過終結者路線、說明與權重的版本（不改到 PLAYS）。
 * 終結者的投射權重換成對應出手點的能力（中距離投射 / 弧外投射）。
 */
export function playVariant(play: Play, shot?: ShotZone): Play {
  const alt = play.alt;
  if (!alt || !shot || shot === play.shot) return play;
  const from = SHOT_SKILL[play.shot!];
  const to = SHOT_SKILL[alt.shot];
  const finisherWeights = Object.fromEntries(
    Object.entries(play.weights[play.finisher]).map(([k, v]) => [k === from ? to : k, v]),
  ) as RoleWeights;
  return {
    ...play,
    summary: alt.summary,
    finish: alt.finish,
    shot: alt.shot,
    // 產生出來的版本不再帶另一個出手點；要切換時一律從 PLAYS 裡的原始戰術產生
    alt: undefined,
    weights: { ...play.weights, [play.finisher]: finisherWeights },
    frames: play.frames.map((f, i) => ({
      note: alt.notes[i] ?? f.note,
      paths: f.paths.map((p) =>
        i === alt.frame && p.actor === play.finisher && (p.kind === 'cut' || p.kind === 'dribble')
          ? { ...p, to: alt.to, via: alt.via }
          : p,
      ),
    })),
  };
}

/** 原始戰術（PLAYS 裡的那一份）；切換出手點時從它產生 */
export function basePlay(id: string): Play | undefined {
  return PLAYS.find((p) => p.id === id);
}

/** 這套戰術的所有出手點版本（跳投戰術兩個，其他一個） */
export function playVariants(play: Play): Play[] {
  return play.alt ? [play, playVariant(play, play.alt.shot)] : [play];
}

// 常用站位
const TOP: Vec2 = { x: 0, y: 8.6 };
const LW: Vec2 = { x: -5.4, y: 6.0 };
const LC: Vec2 = { x: -6.6, y: 1.2 };
const RC: Vec2 = { x: 6.4, y: 1.4 };

/** 高位擋拆的第 1 個分鏡：B 到 A 的防守者右側掩護，C 拉到左底角 */
const HIGH_PICK_SET: PlayFrame = {
  note: 'B 上提到 A 的防守者右側設掩護；C 往左底角拉開空間。',
  paths: [
    { kind: 'screen', actor: 'B', to: { x: 1.1, y: 7.2 } },
    { kind: 'cut', actor: 'C', to: LC },
  ],
};
const HIGH_PICK_START: Record<Role, Vec2> = { A: TOP, B: { x: 4.4, y: 6.8 }, C: LW };
const HIGH_PICK_ROLES: Record<Role, string> = { A: '持球者', B: '掩護者', C: '拉開空間' };
/** A 從掩護者外側（靠中場那側）繞過去，路線不會穿過 B */
const AROUND_SCREEN: Vec2 = { x: 2.1, y: 8.5 };

/** 手遞手的第 1 個分鏡：A 往右運球，B 從底角上來接 */
const DHO_START: Record<Role, Vec2> = { A: TOP, B: RC, C: LW };
const DHO_ROLES: Record<Role, string> = { A: '手遞手給球者', B: '接球者', C: '拉開空間' };

export const PLAYS: readonly Play[] = [
  {
    id: 'high-pnr-pullup',
    category: '高位擋拆',
    name: 'Pull-up Jumper',
    summary: '持球者繞過高位掩護後，在罰球線延伸處急停跳投。',
    roles: HIGH_PICK_ROLES,
    start: HIGH_PICK_START,
    ball: 'A',
    frames: [
      HIGH_PICK_SET,
      {
        note: 'A 從 B 外側繞過掩護往右運球，在罰球線延伸處急停；B 先站住擋人，再下順把防守者帶離。',
        paths: [
          { kind: 'dribble', actor: 'A', to: { x: 3.2, y: 5.4 }, via: [AROUND_SCREEN] },
          { kind: 'cut', actor: 'B', to: { x: 1.0, y: 2.8 } },
        ],
      },
      { note: 'A 在弧內急停跳投（1 分）。', paths: [{ kind: 'shot', actor: 'A' }] },
    ],
    finisher: 'A',
    finish: 'A 擋拆後急停跳投',
    weights: { A: { midRange: 3, iso: 2 }, B: { height: 1 }, C: { threePoint: 1 } },
    shot: 'mid',
    alt: {
      shot: 'three',
      frame: 1,
      to: { x: 4.4, y: 7.3 },
      via: [AROUND_SCREEN],
      notes: {
        1: 'A 從 B 外側繞過掩護往右運球，在弧外急停；B 先站住擋人，再下順把防守者帶離。',
        2: 'A 在弧外急停跳投（2 分）。',
      },
      summary: '持球者繞過高位掩護後，在弧外急停跳投。',
      finish: 'A 擋拆後弧外急停跳投',
    },
  },
  {
    id: 'high-pnr-floater',
    category: '高位擋拆',
    name: 'Floater',
    summary: '持球者繞過掩護切進禁區，在長人補防前拋投。',
    roles: HIGH_PICK_ROLES,
    start: HIGH_PICK_START,
    ball: 'A',
    frames: [
      HIGH_PICK_SET,
      {
        note: 'A 從 B 外側繞過掩護，再往禁區運球；B 先站住擋人，再往 A 的右後方（弧頂左側）拉開，不擋切入路線。',
        paths: [
          { kind: 'dribble', actor: 'A', to: { x: 1.4, y: 3.6 }, via: [AROUND_SCREEN, { x: 3.0, y: 6.4 }] },
          { kind: 'cut', actor: 'B', to: { x: -2.4, y: 8.4 } },
        ],
      },
      { note: 'A 在禁區拋投（1 分）。', paths: [{ kind: 'shot', actor: 'A' }] },
    ],
    finisher: 'A',
    finish: 'A 切入拋投',
    weights: { A: { finishing: 3, speed: 2, iso: 1 }, B: { threePoint: 1 }, C: { threePoint: 1 } },
  },
  {
    id: 'high-pnr-drive',
    category: '高位擋拆',
    name: 'Drive to Rim',
    summary: '持球者繞過掩護一路切到籃下上籃。',
    roles: HIGH_PICK_ROLES,
    start: HIGH_PICK_START,
    ball: 'A',
    frames: [
      HIGH_PICK_SET,
      {
        note: 'A 從 B 外側繞過掩護，一路運球切到籃下；B 先站住擋人，再往 A 的右後方（弧頂左側）拉開，清空切入路線。',
        paths: [
          { kind: 'dribble', actor: 'A', to: { x: 0.9, y: 2.4 }, via: [AROUND_SCREEN, { x: 3.0, y: 5.8 }] },
          { kind: 'cut', actor: 'B', to: { x: -2.4, y: 8.4 } },
        ],
      },
      { note: 'A 上籃（1 分）。', paths: [{ kind: 'shot', actor: 'A' }] },
    ],
    finisher: 'A',
    finish: 'A 切入上籃',
    weights: { A: { speed: 3, finishing: 3, iso: 2 }, B: { threePoint: 1 }, C: { threePoint: 1 } },
  },
  {
    id: 'high-pnr-pop',
    category: '高位擋拆',
    name: 'Pick and Pop',
    summary: '掩護後，掩護者往外彈到弧頂，接球投兩分球。',
    roles: HIGH_PICK_ROLES,
    start: HIGH_PICK_START,
    ball: 'A',
    frames: [
      HIGH_PICK_SET,
      {
        note: 'A 從 B 外側繞過掩護往右運球，吸引防守；B 先站住擋人，再往左外彈到弧外。',
        paths: [
          { kind: 'dribble', actor: 'A', to: { x: 3.4, y: 5.6 }, via: [AROUND_SCREEN] },
          { kind: 'cut', actor: 'B', to: { x: -1.6, y: 8.6 } },
        ],
      },
      { note: 'A 回傳給外彈的 B。', paths: [{ kind: 'pass', actor: 'A', target: 'B' }] },
      { note: 'B 弧外投籃（2 分）。', paths: [{ kind: 'shot', actor: 'B' }] },
    ],
    finisher: 'B',
    finish: 'B 外彈接球投籃',
    weights: { A: { iso: 1 }, B: { threePoint: 3 }, C: { threePoint: 1 } },
    shot: 'three',
    alt: {
      shot: 'mid',
      frame: 1,
      to: { x: -2.0, y: 6.2 },
      notes: {
        1: 'A 從 B 外側繞過掩護往右運球，吸引防守；B 先站住擋人，再往左外彈到罰球線左側。',
        3: 'B 在罰球線左側中距離投籃（1 分）。',
      },
      summary: '掩護後，掩護者往外彈到罰球線附近，接球投中距離。',
      finish: 'B 外彈到中距離接球投籃',
    },
  },
  {
    id: 'high-pnr-roll',
    category: '高位擋拆',
    name: 'Pick and Roll',
    summary: '掩護後，掩護者轉身下順到籃下，接球上籃。',
    roles: HIGH_PICK_ROLES,
    start: HIGH_PICK_START,
    ball: 'A',
    frames: [
      HIGH_PICK_SET,
      {
        note: 'A 從 B 外側繞過掩護往右運球；B 先站住擋人，再轉身下順到籃下。',
        paths: [
          { kind: 'dribble', actor: 'A', to: { x: 3.6, y: 5.6 }, via: [AROUND_SCREEN] },
          { kind: 'cut', actor: 'B', to: { x: 0.8, y: 2.6 } },
        ],
      },
      { note: 'A 傳給下順的 B。', paths: [{ kind: 'pass', actor: 'A', target: 'B' }] },
      { note: 'B 上籃（1 分）。', paths: [{ kind: 'shot', actor: 'B' }] },
    ],
    finisher: 'B',
    finish: 'B 下順接球上籃',
    weights: { A: { iso: 1 }, B: { finishing: 3, height: 2 }, C: { threePoint: 1 } },
  },
  {
    id: 'high-pnr-spain',
    category: '高位擋拆',
    name: 'Spain Pick and Roll',
    summary: '高位擋拆後掩護者下順，第三人對下順者的防守者做背掩護，再外拉接球投籃。',
    roles: { A: '持球者', B: '掩護者（下順）', C: '背掩護後外拉投籃' },
    start: { A: TOP, B: { x: 4.4, y: 6.8 }, C: { x: -4.6, y: 6.8 } },
    ball: 'A',
    frames: [
      {
        note: 'B 上提到 A 的防守者右側設掩護；C 從左翼移到罰球線左側，準備背掩護。',
        paths: [
          { kind: 'screen', actor: 'B', to: { x: 1.1, y: 7.2 } },
          { kind: 'cut', actor: 'C', to: { x: -1.4, y: 6.6 } },
        ],
      },
      {
        note: 'A 從 B 外側繞過掩護往右運球；B 先站住擋人，再往籃下順；C 往下對 B 的防守者做背掩護。',
        paths: [
          { kind: 'dribble', actor: 'A', to: { x: 3.4, y: 5.6 }, via: [AROUND_SCREEN] },
          { kind: 'cut', actor: 'B', to: { x: 0.6, y: 2.8 } },
          { kind: 'screen', actor: 'C', to: { x: 0.2, y: 5.4 } },
        ],
      },
      {
        note: 'C 背掩護後外拉到弧頂左側，A 傳給 C（B 下順是第二選擇）。',
        paths: [
          { kind: 'cut', actor: 'C', to: { x: -2.8, y: 8.2 } },
          { kind: 'pass', actor: 'A', target: 'C' },
        ],
      },
      { note: 'C 弧外投籃（2 分）。', paths: [{ kind: 'shot', actor: 'C' }] },
    ],
    finisher: 'C',
    finish: 'C 背掩護後外拉接球投籃（B 下順是第二選擇）',
    weights: { A: { iso: 1 }, B: { finishing: 2, height: 1 }, C: { threePoint: 3 } },
    shot: 'three',
    alt: {
      shot: 'mid',
      frame: 2,
      to: { x: -2.2, y: 6.6 },
      notes: {
        2: 'C 背掩護後外拉到罰球線左側，A 傳給 C（B 下順是第二選擇）。',
        3: 'C 在罰球線左側中距離投籃（1 分）。',
      },
      summary: '高位擋拆後掩護者下順，第三人對下順者的防守者做背掩護，再外拉到罰球線附近投中距離。',
      finish: 'C 背掩護後外拉到中距離接球投籃（B 下順是第二選擇）',
    },
  },
  {
    id: 'low-pnr-paint',
    category: '低位擋拆',
    name: 'Paint Shot',
    summary: '球傳進低位後，傳球者下來幫低位的人掩護，低位持球者趁防守者被擋住，運到禁區中路出手。',
    roles: { A: '傳入低位後掩護', B: '低位持球、禁區中路出手', C: '拉開空間' },
    start: { A: { x: 5.0, y: 6.6 }, B: { x: 4.6, y: 2.2 }, C: LW },
    ball: 'A',
    frames: [
      { note: 'A 把球傳進右側低位的 B，B 成為持球者。', paths: [{ kind: 'pass', actor: 'A', target: 'B' }] },
      {
        note: 'A 傳完往下走，到 B 的防守者靠中路那側設掩護。',
        paths: [{ kind: 'screen', actor: 'A', to: { x: 2.6, y: 3.0 } }],
      },
      {
        note: 'B 從 A 外側繞過掩護，運到禁區中路停下；A 留在原地繼續擋住防守者。',
        paths: [{ kind: 'dribble', actor: 'B', to: { x: 0.6, y: 4.6 }, via: [{ x: 3.8, y: 4.3 }] }],
      },
      { note: 'B 在禁區中路出手（1 分）。', paths: [{ kind: 'shot', actor: 'B' }] },
    ],
    finisher: 'B',
    finish: 'B 利用 A 的掩護到禁區中路出手',
    weights: { A: { height: 1 }, B: { finishing: 3, iso: 2, height: 1 }, C: { threePoint: 1 } },
  },
  {
    id: 'low-pnr-roll',
    category: '低位擋拆',
    name: 'Pick and Roll',
    summary: '球傳到底角附近後，傳球者下來幫持球者掩護再順下，持球者切向中路後回傳給順下的人。',
    roles: { A: '傳球後掩護、順下', B: '低位持球者', C: '拉開空間' },
    start: { A: { x: 4.6, y: 7.0 }, B: { x: 5.6, y: 2.4 }, C: LW },
    ball: 'A',
    frames: [
      { note: 'A 把球傳給右側低位（底角附近）的 B，B 成為持球者。', paths: [{ kind: 'pass', actor: 'A', target: 'B' }] },
      {
        note: 'A 傳完往下走，到 B 的防守者靠中路那側設掩護。',
        paths: [{ kind: 'screen', actor: 'A', to: { x: 3.4, y: 3.2 } }],
      },
      {
        note: 'B 繞過掩護往中路運球；A 先站住擋人，再轉身順下到籃下。',
        paths: [
          { kind: 'dribble', actor: 'B', to: { x: 2.6, y: 4.8 }, via: [{ x: 4.8, y: 4.4 }] },
          { kind: 'cut', actor: 'A', to: { x: 0.8, y: 2.2 } },
        ],
      },
      { note: 'B 傳給順下的 A。', paths: [{ kind: 'pass', actor: 'B', target: 'A' }] },
      { note: 'A 上籃（1 分）。', paths: [{ kind: 'shot', actor: 'A' }] },
    ],
    finisher: 'A',
    finish: 'A 掩護後順下接球上籃',
    weights: { A: { finishing: 3, height: 2 }, B: { iso: 2 }, C: { threePoint: 1 } },
  },
  {
    id: 'cut-give-go',
    category: '空切',
    name: 'Pass and Cut',
    summary: '傳球後立刻往籃下切，接回傳上籃（傳切）。',
    roles: { A: '傳球後空切', B: '接球者', C: '拉開空間' },
    start: { A: TOP, B: { x: 5.4, y: 6.0 }, C: LW },
    ball: 'A',
    frames: [
      { note: 'A 傳給右翼的 B。', paths: [{ kind: 'pass', actor: 'A', target: 'B' }] },
      {
        note: 'A 傳完立刻往籃下切，B 抓準時機回傳，球和 A 同時到籃下；C 補到弧頂，保持空間。',
        paths: [
          { kind: 'cut', actor: 'A', to: { x: 0.8, y: 2.4 }, via: [{ x: 1.6, y: 5.6 }] },
          { kind: 'cut', actor: 'C', to: { x: -1.2, y: 8.6 } },
          { kind: 'pass', actor: 'B', target: 'A' },
        ],
      },
      { note: 'A 上籃（1 分）。', paths: [{ kind: 'shot', actor: 'A' }] },
    ],
    finisher: 'A',
    finish: 'A 切入接回傳上籃',
    weights: { A: { speed: 3, finishing: 3 }, B: { threePoint: 1 }, C: { threePoint: 1 } },
  },
  {
    id: 'cut-backdoor',
    category: '空切',
    name: 'Backdoor Cut',
    summary: '側翼先往外拉，把防守者帶出來，再突然往籃下背切。',
    roles: { A: '持球者', B: '背切者', C: '拉開空間' },
    start: { A: TOP, B: { x: 5.4, y: 6.0 }, C: LC },
    ball: 'A',
    frames: [
      {
        note: 'B 往外拉高，作勢要接球，把防守者帶離籃框。',
        paths: [{ kind: 'cut', actor: 'B', to: { x: 5.8, y: 7.8 } }],
      },
      {
        note: 'B 突然轉身，從防守者背後往籃下切；A 抓準時機傳球，球和 B 同時到籃下。',
        paths: [
          { kind: 'cut', actor: 'B', to: { x: 1.0, y: 2.2 }, via: [{ x: 3.6, y: 3.8 }] },
          { kind: 'pass', actor: 'A', target: 'B' },
        ],
      },
      { note: 'B 上籃（1 分）。', paths: [{ kind: 'shot', actor: 'B' }] },
    ],
    finisher: 'B',
    finish: 'B 背切接球上籃',
    weights: { A: {}, B: { speed: 3, finishing: 3 }, C: { threePoint: 1 } },
  },
  {
    id: 'offball-down',
    category: '無球掩護',
    name: 'Down Screen',
    summary: '側翼往下幫低位的隊友掩護，隊友繞出來到側翼接球投籃。',
    roles: { A: '持球者', B: '掩護者', C: '繞掩護接球' },
    start: { A: { x: 1.2, y: 8.6 }, B: { x: -5.2, y: 6.4 }, C: { x: -2.8, y: 2.4 } },
    ball: 'A',
    frames: [
      {
        note: 'B 從左翼往下，到 C 的防守者上方設掩護（下掩護）。',
        paths: [{ kind: 'screen', actor: 'B', to: { x: -2.0, y: 3.2 } }],
      },
      {
        note: 'C 繞過掩護往左翼跑到弧外，A 配合時機傳球；B 先站住擋人，再往禁區卡位。',
        paths: [
          { kind: 'cut', actor: 'C', to: { x: -5.4, y: 6.2 }, via: [{ x: -3.8, y: 4.4 }] },
          { kind: 'cut', actor: 'B', to: { x: -0.6, y: 3.4 } },
          { kind: 'pass', actor: 'A', target: 'C' },
        ],
      },
      { note: 'C 弧外投籃（2 分）。', paths: [{ kind: 'shot', actor: 'C' }] },
    ],
    finisher: 'C',
    finish: 'C 繞下掩護接球投籃',
    weights: { A: {}, B: { height: 1 }, C: { threePoint: 3, speed: 1 } },
    shot: 'three',
    alt: {
      shot: 'mid',
      frame: 1,
      to: { x: -4.0, y: 5.0 },
      via: [{ x: -3.4, y: 4.0 }],
      notes: {
        1: 'C 繞過掩護往左側罰球線延伸處跑，A 配合時機傳球；B 先站住擋人，再往禁區卡位。',
        2: 'C 在罰球線延伸處中距離投籃（1 分）。',
      },
      summary: '側翼往下幫低位的隊友掩護，隊友繞出來到罰球線延伸處接球投中距離。',
      finish: 'C 繞下掩護接球投中距離',
    },
  },
  {
    id: 'offball-back',
    category: '無球掩護',
    name: 'Back Screen',
    summary: '在隊友的防守者背後（靠籃框那側）掩護，隊友往籃下空切。',
    roles: { A: '持球者', B: '掩護者', C: '空切者' },
    start: { A: { x: 5.2, y: 6.4 }, B: { x: -1.4, y: 5.8 }, C: { x: -4.6, y: 7.6 } },
    ball: 'A',
    frames: [
      {
        note: 'B 走到 C 的防守者背後（靠籃框那側）設掩護。',
        paths: [{ kind: 'screen', actor: 'B', to: { x: -2.4, y: 5.1 } }],
      },
      {
        note: 'C 繞過掩護往籃下切，A 配合時機傳球；B 先站住擋人，再外彈到弧頂左側。',
        paths: [
          { kind: 'cut', actor: 'C', to: { x: -0.4, y: 2.4 }, via: [{ x: -3.3, y: 4.5 }] },
          { kind: 'cut', actor: 'B', to: { x: -2.6, y: 8.2 } },
          { kind: 'pass', actor: 'A', target: 'C' },
        ],
      },
      { note: 'C 上籃（1 分）。', paths: [{ kind: 'shot', actor: 'C' }] },
    ],
    finisher: 'C',
    finish: 'C 背掩護空切上籃',
    weights: { A: {}, B: { height: 1 }, C: { speed: 2, finishing: 3 } },
  },
  {
    id: 'offball-post-split',
    category: '無球掩護',
    name: 'Post Split',
    summary: '球傳進低位後，外圍兩人交叉掩護：A 先幫 C 掩護，C 繞過來後回頭幫 A 掩護，兩人互相擋住對方的防守者。',
    roles: { A: '傳入低位後掩護，再利用掩護外彈投籃', B: '低位傳球', C: '繞過掩護後回頭幫 A 掩護，再往籃下切' },
    start: { A: { x: 2.2, y: 8.4 }, B: { x: 2.9, y: 2.6 }, C: { x: -5.0, y: 6.4 } },
    ball: 'A',
    frames: [
      { note: 'A 把球傳進右側低位的 B。', paths: [{ kind: 'pass', actor: 'A', target: 'B' }] },
      {
        note: 'A 往左走，到 C 的防守者右側設掩護。',
        paths: [{ kind: 'screen', actor: 'A', to: { x: -2.3, y: 5.9 } }],
      },
      {
        note: 'C 從 A 上方繞過掩護（C 的防守者被 A 擋住），停在 A 的防守者旁邊，回頭幫 A 掩護。',
        paths: [{ kind: 'screen', actor: 'C', to: { x: -0.4, y: 5.6 }, via: [{ x: -2.6, y: 7.4 }] }],
      },
      {
        note: 'A 從 C 上方繞過掩護外彈到右側弧頂，B 配合時機傳給 A；C 先站住擋人，再往籃下切，製造第二個選擇。',
        paths: [
          { kind: 'cut', actor: 'A', to: { x: 2.6, y: 8.4 }, via: [{ x: -1.6, y: 7.6 }] },
          { kind: 'cut', actor: 'C', to: { x: 0.4, y: 2.8 } },
          { kind: 'pass', actor: 'B', target: 'A' },
        ],
      },
      { note: 'A 弧外投籃（2 分）。', paths: [{ kind: 'shot', actor: 'A' }] },
    ],
    finisher: 'A',
    finish: 'A 交叉掩護後外彈投籃（C 切入是第二選擇）',
    weights: { A: { threePoint: 3 }, B: { height: 2 }, C: { finishing: 1, speed: 1 } },
    shot: 'three',
    alt: {
      shot: 'mid',
      frame: 3,
      to: { x: 1.8, y: 6.4 },
      via: [{ x: -1.6, y: 7.6 }],
      notes: {
        3: 'A 從 C 上方繞過掩護外彈到罰球線，B 配合時機傳給 A；C 先站住擋人，再往籃下切，製造第二個選擇。',
        4: 'A 在罰球線中距離投籃（1 分）。',
      },
      summary: '球傳進低位後，外圍兩人交叉掩護：A 先幫 C 掩護，C 繞過來後回頭幫 A 掩護，A 外彈到罰球線投中距離。',
      finish: 'A 交叉掩護後外彈到罰球線投籃（C 切入是第二選擇）',
    },
  },
  {
    id: 'offball-flare',
    category: '無球掩護',
    name: 'Flare Screen',
    summary: '持球者在一側時，弱邊的隊友幫射手設反向掩護，射手往遠離球的方向外拉接球投籃。',
    roles: { A: '持球者', B: '反向掩護者', C: '外拉投籃' },
    start: { A: { x: 4.6, y: 7.0 }, B: { x: -2.6, y: 3.0 }, C: { x: -0.8, y: 7.8 } },
    ball: 'A',
    frames: [
      {
        note: 'B 從左側低位上提，到 C 的防守者左側（遠離球的那側）設反向掩護。',
        paths: [{ kind: 'screen', actor: 'B', to: { x: -2.0, y: 6.2 } }],
      },
      {
        note: 'C 從 B 上方繞過掩護，往遠離球的方向外拉到左翼弧外，A 配合時機傳球；B 先站住擋人，再往禁區走。',
        paths: [
          { kind: 'cut', actor: 'C', to: { x: -5.8, y: 6.8 }, via: [{ x: -2.6, y: 8.0 }] },
          { kind: 'cut', actor: 'B', to: { x: -0.8, y: 3.2 } },
          { kind: 'pass', actor: 'A', target: 'C' },
        ],
      },
      { note: 'C 弧外投籃（2 分）。', paths: [{ kind: 'shot', actor: 'C' }] },
    ],
    finisher: 'C',
    finish: 'C 利用反向掩護外拉接球投籃',
    weights: { A: {}, B: { height: 1 }, C: { threePoint: 3, speed: 1 } },
    shot: 'three',
    alt: {
      shot: 'mid',
      frame: 1,
      to: { x: -4.2, y: 5.4 },
      via: [{ x: -2.6, y: 8.0 }],
      notes: {
        1: 'C 從 B 上方繞過掩護，往遠離球的方向外拉到左側罰球線延伸處，A 配合時機傳球；B 先站住擋人，再往禁區走。',
        2: 'C 在罰球線延伸處中距離投籃（1 分）。',
      },
      summary: '持球者在一側時，弱邊的隊友幫射手設反向掩護，射手外拉到罰球線延伸處接球投中距離。',
      finish: 'C 利用反向掩護外拉到中距離接球投籃',
    },
  },
  {
    id: 'dho-drive',
    category: '手遞手',
    name: 'DHO to Drive',
    summary: '持球者運向側翼把球遞給跑上來的隊友，隊友繞過交球者往中路切入，交球者擋住追過來的防守者。',
    roles: DHO_ROLES,
    start: DHO_START,
    ball: 'A',
    frames: [
      {
        note: 'A 往右運球；B 從右底角往上跑，迎向 A。',
        paths: [
          { kind: 'dribble', actor: 'A', to: { x: 3.0, y: 7.4 } },
          { kind: 'cut', actor: 'B', to: { x: 4.6, y: 6.6 } },
        ],
      },
      { note: 'A 把球遞給 B（手遞手）。', paths: [{ kind: 'pass', actor: 'A', target: 'B' }] },
      {
        note: 'B 接球後從 A 外側（靠中場那側）繞過去，往中路切向籃下；A 轉身擋住追過來的防守者。',
        paths: [
          { kind: 'dribble', actor: 'B', to: { x: 0.2, y: 3.0 }, via: [{ x: 3.6, y: 8.4 }, { x: 1.4, y: 7.6 }] },
          { kind: 'screen', actor: 'A', to: { x: 2.6, y: 5.9 } },
        ],
      },
      { note: 'B 上籃（1 分）。', paths: [{ kind: 'shot', actor: 'B' }] },
    ],
    finisher: 'B',
    finish: 'B 接手遞手後繞過 A 往中路切入上籃',
    weights: { A: { height: 1 }, B: { speed: 3, iso: 2, finishing: 2 }, C: { threePoint: 1 } },
  },
  {
    id: 'dho-shoot',
    category: '手遞手',
    name: 'DHO to Shoot',
    summary: '手遞手後，接球者從交球者外側繞到弧頂，交球者擋住追上來的防守者，接球者投兩分球。',
    roles: DHO_ROLES,
    start: DHO_START,
    ball: 'A',
    frames: [
      {
        note: 'A 往右運球；B 從右底角往上跑，迎向 A。',
        paths: [
          { kind: 'dribble', actor: 'A', to: { x: 3.2, y: 7.4 } },
          { kind: 'cut', actor: 'B', to: { x: 4.6, y: 6.4 } },
        ],
      },
      { note: 'A 把球遞給 B（手遞手）。', paths: [{ kind: 'pass', actor: 'A', target: 'B' }] },
      {
        note: 'B 從 A 的外側（靠中場那側）繞過去，運球到弧頂；A 擋住追過來的防守者。',
        paths: [
          { kind: 'dribble', actor: 'B', to: { x: 0.6, y: 8.8 }, via: [{ x: 3.8, y: 8.6 }] },
          { kind: 'screen', actor: 'A', to: { x: 2.6, y: 6.1 } },
        ],
      },
      { note: 'B 在弧頂的弧外投籃（2 分）。', paths: [{ kind: 'shot', actor: 'B' }] },
    ],
    finisher: 'B',
    finish: 'B 繞過 A 到弧頂投籃',
    weights: { A: { height: 1 }, B: { threePoint: 3, iso: 1 }, C: { threePoint: 1 } },
    shot: 'three',
    alt: {
      shot: 'mid',
      frame: 2,
      to: { x: 1.2, y: 6.5 },
      via: [{ x: 3.8, y: 8.0 }],
      notes: {
        2: 'B 從 A 的外側（靠中場那側）繞過去，往罰球線運球；A 擋住追過來的防守者。',
        3: 'B 在罰球線附近中距離投籃（1 分）。',
      },
      summary: '手遞手後，接球者從交球者外側繞過去，往罰球線運球，交球者擋住追上來的防守者，接球者投中距離。',
      finish: 'B 繞過 A 運到罰球線投中距離',
    },
  },
  {
    id: 'dho-fake',
    category: '手遞手',
    name: 'Fake Hand-Off',
    summary: '作勢要手遞手，交球者突然把球留著，自己轉身切入。',
    roles: { A: '假手遞手者', B: '假接球者', C: '拉開空間' },
    start: DHO_START,
    ball: 'A',
    frames: [
      {
        note: 'A 往右運球；B 從右底角往上跑，迎向 A，好像要接手遞手。',
        paths: [
          { kind: 'dribble', actor: 'A', to: { x: 3.0, y: 7.4 } },
          { kind: 'cut', actor: 'B', to: { x: 4.6, y: 6.6 } },
        ],
      },
      {
        note: 'A 假裝交球，突然轉身往籃下切；B 從 A 的外側（靠中場那側）繞過去跑向弧頂，把防守者帶離切入路線。',
        paths: [
          { kind: 'dribble', actor: 'A', to: { x: 1.0, y: 2.6 }, via: [{ x: 2.4, y: 5.0 }] },
          { kind: 'cut', actor: 'B', to: { x: 0.6, y: 8.8 }, via: [{ x: 3.8, y: 8.6 }] },
        ],
      },
      { note: 'A 上籃（1 分）。', paths: [{ kind: 'shot', actor: 'A' }] },
    ],
    finisher: 'A',
    finish: 'A 假遞後自己切入上籃',
    weights: { A: { iso: 3, finishing: 2, speed: 1 }, B: { speed: 1 }, C: { threePoint: 1 } },
  },
  {
    id: 'dho-chicago',
    category: '手遞手',
    name: 'Chicago',
    summary: '底角的射手先利用下掩護往上跑，再接持球者的手遞手，連續兩個掩護後投籃。',
    roles: { A: '手遞手給球者', B: '下掩護者', C: '連續利用掩護投籃' },
    start: { A: TOP, B: { x: -4.4, y: 5.6 }, C: LC },
    ball: 'A',
    frames: [
      {
        note: 'B 從左翼往下，到 C 的防守者上方設下掩護。',
        paths: [{ kind: 'screen', actor: 'B', to: { x: -4.6, y: 2.8 } }],
      },
      {
        note: 'C 繞過下掩護往上跑到左翼；A 往左運球迎向 C；B 先站住擋人，再往禁區走。',
        paths: [
          { kind: 'cut', actor: 'C', to: { x: -4.6, y: 6.6 }, via: [{ x: -5.8, y: 3.6 }] },
          { kind: 'dribble', actor: 'A', to: { x: -2.6, y: 7.6 } },
          { kind: 'cut', actor: 'B', to: { x: -0.8, y: 3.2 } },
        ],
      },
      { note: 'A 把球遞給 C（手遞手）。', paths: [{ kind: 'pass', actor: 'A', target: 'C' }] },
      {
        note: 'C 從 A 的外側（靠中場那側）繞過去，運球到弧頂；A 擋住追過來的防守者。',
        paths: [
          { kind: 'dribble', actor: 'C', to: { x: -0.6, y: 8.8 }, via: [{ x: -3.6, y: 8.8 }] },
          { kind: 'screen', actor: 'A', to: { x: -3.0, y: 6.4 } },
        ],
      },
      { note: 'C 在弧頂的弧外投籃（2 分）。', paths: [{ kind: 'shot', actor: 'C' }] },
    ],
    finisher: 'C',
    finish: 'C 連續利用下掩護與手遞手後投籃',
    weights: { A: { height: 1 }, B: { height: 1 }, C: { threePoint: 3, speed: 1 } },
    shot: 'three',
    alt: {
      shot: 'mid',
      frame: 3,
      to: { x: -1.0, y: 6.6 },
      via: [{ x: -3.6, y: 8.4 }],
      notes: {
        3: 'C 從 A 的外側（靠中場那側）繞過去，往罰球線運球；A 擋住追過來的防守者。',
        4: 'C 在罰球線附近中距離投籃（1 分）。',
      },
      summary: '底角的射手先利用下掩護往上跑，再接持球者的手遞手，運到罰球線附近投中距離。',
      finish: 'C 連續利用下掩護與手遞手後運到罰球線投籃',
    },
  },
  {
    id: 'iso-top',
    category: '單打',
    name: 'Top Isolation',
    summary: '兩個隊友拉到兩側底角清出空間，持球者在弧頂一對一切入。',
    roles: { A: '單打持球者', B: '拉開空間', C: '拉開空間' },
    start: { A: TOP, B: { x: 4.4, y: 6.8 }, C: LW },
    ball: 'A',
    frames: [
      {
        note: 'B、C 拉到兩側底角，把中間清空給 A。',
        paths: [
          { kind: 'cut', actor: 'B', to: RC },
          { kind: 'cut', actor: 'C', to: LC },
        ],
      },
      {
        note: 'A 一對一，往左運球後切向籃下。',
        paths: [{ kind: 'dribble', actor: 'A', to: { x: -0.6, y: 2.4 }, via: [{ x: -1.2, y: 6.0 }] }],
      },
      { note: 'A 上籃（1 分）。', paths: [{ kind: 'shot', actor: 'A' }] },
    ],
    finisher: 'A',
    finish: 'A 弧頂一對一切入上籃',
    weights: { A: { iso: 3, finishing: 2, speed: 1 }, B: { threePoint: 1 }, C: { threePoint: 1 } },
  },
  {
    id: 'iso-post',
    category: '單打',
    name: 'Post Isolation',
    summary: '高個子到低位要位接球，隊友拉開到外圍，讓他在低位一對一。',
    roles: { A: '傳入低位', B: '低位單打', C: '拉開空間' },
    start: { A: { x: 2.4, y: 8.2 }, B: { x: 3.4, y: 5.2 }, C: LW },
    ball: 'A',
    frames: [
      {
        note: 'B 從罰球線右側往下，到右側低位（禁區內）要位。',
        paths: [{ kind: 'cut', actor: 'B', to: { x: 2.2, y: 2.6 } }],
      },
      { note: 'A 把球傳進低位的 B。', paths: [{ kind: 'pass', actor: 'A', target: 'B' }] },
      {
        note: 'A 拉到弧頂左側、C 拉到左底角，清出空間，讓 B 在低位一對一。',
        paths: [
          { kind: 'cut', actor: 'A', to: { x: -2.4, y: 8.4 } },
          { kind: 'cut', actor: 'C', to: LC },
        ],
      },
      { note: 'B 在低位轉身投籃（1 分）。', paths: [{ kind: 'shot', actor: 'B' }] },
    ],
    finisher: 'B',
    finish: 'B 低位轉身投籃',
    weights: { A: { threePoint: 1 }, B: { height: 3, finishing: 3, iso: 2 }, C: { threePoint: 1 } },
  },
  {
    id: 'iso-mismatch',
    category: '單打',
    name: 'Hunting the Mismatch',
    summary: '先用擋拆逼對方換防，讓持球者換到比較慢或比較矮的防守者，再一對一切入。對方選擇擠過時，就變成一般的擋拆切入。',
    roles: { A: '單打持球者', B: '掩護者（引出錯位）', C: '拉開空間' },
    start: HIGH_PICK_START,
    ball: 'A',
    frames: [
      HIGH_PICK_SET,
      {
        note: 'A 從 B 外側繞過掩護到右翼，逼對方換防；B 先站住擋人，再往弧頂拉開。',
        paths: [
          { kind: 'dribble', actor: 'A', to: { x: 4.6, y: 6.6 }, via: [AROUND_SCREEN] },
          { kind: 'cut', actor: 'B', to: { x: -1.2, y: 8.8 } },
        ],
      },
      {
        note: 'A 對換過來的防守者一對一，切向籃下。',
        paths: [{ kind: 'dribble', actor: 'A', to: { x: 1.0, y: 2.4 }, via: [{ x: 3.6, y: 4.0 }] }],
      },
      { note: 'A 上籃（1 分）。', paths: [{ kind: 'shot', actor: 'A' }] },
    ],
    finisher: 'A',
    finish: 'A 換防後對錯位的防守者切入',
    weights: { A: { iso: 3, speed: 2, finishing: 1 }, B: { height: 1 }, C: { threePoint: 1 } },
  },
  {
    id: 'iso-kick',
    category: '單打',
    name: 'Drive and Kick',
    summary: '持球者往籃下切入，吸引防守收縮，再分給往底角移動的射手投籃。',
    roles: { A: '切入後分球', B: '拉開空間', C: '底角接球投籃' },
    start: { A: TOP, B: { x: 6.9, y: 1.3 }, C: { x: -5.8, y: 4.0 } },
    ball: 'A',
    frames: [
      {
        note: 'A 從弧頂往籃下運球切入；C 從左翼往底角移動（跟著切入的方向找空檔）。',
        paths: [
          { kind: 'dribble', actor: 'A', to: { x: 0.6, y: 4.0 } },
          { kind: 'cut', actor: 'C', to: { x: -6.9, y: 1.3 } },
        ],
      },
      { note: 'A 把球分給底角的 C。', paths: [{ kind: 'pass', actor: 'A', target: 'C' }] },
      { note: 'C 底角弧外投籃（2 分）。', paths: [{ kind: 'shot', actor: 'C' }] },
    ],
    finisher: 'C',
    finish: 'C 接切入分球後底角投籃',
    weights: { A: { speed: 2, iso: 2 }, B: { threePoint: 1 }, C: { threePoint: 3 } },
    shot: 'three',
    alt: {
      shot: 'mid',
      frame: 0,
      to: { x: -4.4, y: 2.2 },
      notes: {
        0: 'A 從弧頂往籃下運球切入；C 從左翼往底線的短角移動（跟著切入的方向找空檔）。',
        1: 'A 把球分給短角的 C。',
        2: 'C 在短角中距離投籃（1 分）。',
      },
      summary: '持球者往籃下切入，吸引防守收縮，再分給移到短角的隊友投中距離。',
      finish: 'C 接切入分球後短角投籃',
    },
  },
];
