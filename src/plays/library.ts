import type { Localized } from '../i18n';
import type { PathKind, ShotZone, Skills, Vec2 } from '../model/types';

export type { ShotZone };

// 內建戰術庫（SPEC §6.3）。每套戰術用三個角色 A / B / C 描述，載入時再換成實際球員。
// 座標單位為公尺：原點在底線中點，籃框在 (0, 1.575)，弧線（三分線）半徑 6.75。
// 用詞：說明一律寫「弧內 / 弧外」（分數依計分規則，FIBA 3x3 弧內 1 分、弧外 2 分）。
// 權重：跳投的終結者看出手點的投射能力（中距離投射 / 弧外投射）；拉開空間的人看弧外投射。
// 語系：戰術名稱（name）一律英文；簡介、終結、角色（介面會顯示）有繁中與英文；
// 分鏡說明（note）只出現在 docs/PLAYS.md（只有中文版），所以只寫中文。類別名稱在文字表（i18n 的 library.category）。

export type Role = 'A' | 'B' | 'C';
export type PlayCategory = 'high-pnr' | 'low-pnr' | 'cut' | 'off-ball' | 'dho' | 'iso';
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
  /** 分鏡說明（只用在 docs/PLAYS.md） */
  note: string;
  paths: PlayPath[];
}

/** 推薦用的權重：能力（0–4 分）與身高（越高越好） */
export type RoleWeights = Partial<Record<keyof Skills | 'height', number>>;


/**
 * 戰術的另一個出手點（SPEC §6.3），推薦時每個出手點都模擬，選分數高的。兩種：
 * - 跳投換出手位置：只改終結者在某個分鏡的移動終點與說明，其他跑位、掩護、傳球都一樣（傳球會自動傳到新的位置）。
 * - 換人出手（finisher）：跑位都一樣，最後一傳改傳給另一個人、由他出手，例如 Spain Pick and Roll 改傳給下順的掩護者。
 */
export interface ShotVariant {
  shot: ShotZone;
  /** 改由這個角色出手（最後一傳改傳給他）；省略 = 同一個終結者 */
  finisher?: Role;
  /** 改終結者在第幾個分鏡（0 起算）的移動路線；只換人出手時省略 */
  frame?: number;
  to?: Vec2;
  via?: Vec2[];
  /** 換掉說明的分鏡（0 起算）→ 新的說明 */
  notes: Record<number, string>;
  summary: Localized;
  finish: Localized;
  /** 推薦權重（整份換掉）；省略 = 終結者的投射權重換成出手點對應的能力 */
  weights?: Record<Role, RoleWeights>;
}

export interface Play {
  id: string;
  category: PlayCategory;
  /** 戰術名稱：各語系都用英文（慣例上就用英文稱呼） */
  name: string;
  summary: Localized;
  roles: Record<Role, Localized>;
  start: Record<Role, Vec2>;
  ball: Role;
  frames: PlayFrame[];
  finisher: Role;
  finish: Localized;
  weights: Record<Role, RoleWeights>;
  /** 有多個出手點的戰術：這個版本的出手點（只有一個版本的戰術沒有） */
  shot?: ShotZone;
  /** 其他出手點 */
  alts?: ShotVariant[];
}

const SHOT_SKILL: Partial<Record<ShotZone, 'midRange' | 'threePoint'>> = { mid: 'midRange', three: 'threePoint' };

/**
 * 依出手點取得戰術：shot 是其他出手點時，產生改過路線、出手的人、說明與權重的版本（不改到 PLAYS）。
 * 沒有指定權重時，終結者的投射權重換成對應出手點的能力（中距離投射 / 弧外投射）。
 */
export function playVariant(play: Play, shot?: ShotZone): Play {
  const alt = play.alts?.find((a) => a.shot === shot);
  if (!alt) return play;
  const finisher = alt.finisher ?? play.finisher;
  // 換人出手：最後一次傳給原本終結者的那一傳，改傳給新的終結者
  let passFrame = -1;
  if (finisher !== play.finisher) {
    play.frames.forEach((f, i) => {
      if (f.paths.some((p) => p.kind === 'pass' && p.target === play.finisher)) passFrame = i;
    });
  }
  return {
    ...play,
    summary: alt.summary,
    finish: alt.finish,
    shot: alt.shot,
    finisher,
    // 產生出來的版本不再帶其他出手點；要切換時一律從 PLAYS 裡的原始戰術產生
    alts: undefined,
    weights: alt.weights ?? swapShotWeight(play, alt.shot),
    frames: play.frames.map((f, i) => ({
      note: alt.notes[i] ?? f.note,
      paths: f.paths.map((p) => {
        if (i === alt.frame && alt.to && p.actor === finisher && (p.kind === 'cut' || p.kind === 'dribble')) {
          return { ...p, to: alt.to, via: alt.via };
        }
        if (i === passFrame && p.kind === 'pass' && p.target === play.finisher) return { ...p, target: finisher };
        if (p.kind === 'shot') return { ...p, actor: finisher };
        return p;
      }),
    })),
  };
}

/** 終結者的投射權重換成出手點對應的能力（例如弧外投射 → 中距離投射） */
function swapShotWeight(play: Play, shot: ShotZone): Record<Role, RoleWeights> {
  const from = play.shot && SHOT_SKILL[play.shot];
  const to = SHOT_SKILL[shot];
  if (!from || !to) return play.weights;
  const finisherWeights = Object.fromEntries(
    Object.entries(play.weights[play.finisher]).map(([k, v]) => [k === from ? to : k, v]),
  ) as RoleWeights;
  return { ...play.weights, [play.finisher]: finisherWeights };
}

/** 原始戰術（PLAYS 裡的那一份）；切換出手點時從它產生 */
export function basePlay(id: string): Play | undefined {
  return PLAYS.find((p) => p.id === id);
}

/** 這套戰術的所有出手點版本（原本的在第一個；只有一個出手點的戰術只有自己） */
export function playVariants(play: Play): Play[] {
  return [play, ...(play.alts ?? []).map((a) => playVariant(play, a.shot))];
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
const HIGH_PICK_ROLES: Record<Role, Localized> = {
  A: { zh: '持球者', en: 'Ball handler' },
  B: { zh: '掩護者', en: 'Screener' },
  C: { zh: '拉開空間', en: 'Spacer' },
};
/** A 從掩護者外側（靠中場那側）繞過去，路線不會穿過 B */
const AROUND_SCREEN: Vec2 = { x: 2.1, y: 8.5 };

/** 手遞手的第 1 個分鏡：A 往右運球，B 從底角上來接 */
const DHO_START: Record<Role, Vec2> = { A: TOP, B: RC, C: LW };
const DHO_ROLES: Record<Role, Localized> = {
  A: { zh: '手遞手給球者', en: 'Hands off' },
  B: { zh: '接球者', en: 'Receiver' },
  C: { zh: '拉開空間', en: 'Spacer' },
};

export const PLAYS: readonly Play[] = [
  {
    id: 'high-pnr-pullup',
    category: 'high-pnr',
    name: 'Pull-up Jumper',
    summary: {
      zh: '持球者繞過高位掩護後，在罰球線延伸處急停跳投。',
      en: 'The ball handler comes off a high screen and pulls up at the extended free-throw line.',
    },
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
    finish: { zh: 'A 擋拆後急停跳投', en: 'A pulls up off the pick and roll' },
    weights: { A: { midRange: 3, iso: 2 }, B: { height: 1 }, C: { threePoint: 1 } },
    shot: 'mid',
    alts: [
      {
        shot: 'three',
        frame: 1,
        to: { x: 4.4, y: 7.3 },
        via: [AROUND_SCREEN],
        notes: {
          1: 'A 從 B 外側繞過掩護往右運球，在弧外急停；B 先站住擋人，再下順把防守者帶離。',
          2: 'A 在弧外急停跳投（2 分）。',
        },
        summary: {
          zh: '持球者繞過高位掩護後，在弧外急停跳投。',
          en: 'The ball handler comes off a high screen and pulls up beyond the arc.',
        },
        finish: { zh: 'A 擋拆後弧外急停跳投', en: 'A pulls up beyond the arc off the pick and roll' },
      },
    ],
  },
  {
    id: 'high-pnr-floater',
    category: 'high-pnr',
    name: 'Floater',
    summary: {
      zh: '持球者繞過掩護切進禁區，在長人補防前拋投。',
      en: 'The ball handler comes off the screen into the paint and floats it up before the big can help.',
    },
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
    finish: { zh: 'A 切入拋投', en: 'A drives for a floater' },
    weights: { A: { finishing: 3, speed: 2, iso: 1 }, B: { threePoint: 1 }, C: { threePoint: 1 } },
  },
  {
    id: 'high-pnr-drive',
    category: 'high-pnr',
    name: 'Drive to Rim',
    summary: {
      zh: '持球者繞過掩護一路切到籃下上籃。',
      en: 'The ball handler comes off the screen and drives all the way to the rim for a layup.',
    },
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
    finish: { zh: 'A 切入上籃', en: 'A drives for a layup' },
    weights: { A: { speed: 3, finishing: 3, iso: 2 }, B: { threePoint: 1 }, C: { threePoint: 1 } },
  },
  {
    id: 'high-pnr-pop',
    category: 'high-pnr',
    name: 'Pick and Pop',
    summary: {
      zh: '掩護後，掩護者往外彈到弧頂，接球投兩分球。',
      en: 'After the screen, the screener pops out to the top of the arc for a catch-and-shoot beyond the arc.',
    },
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
    finish: { zh: 'B 外彈接球投籃', en: 'B pops out for the catch-and-shoot' },
    weights: { A: { iso: 1 }, B: { threePoint: 3 }, C: { threePoint: 1 } },
    shot: 'three',
    alts: [
      {
        shot: 'mid',
        frame: 1,
        to: { x: -2.0, y: 6.2 },
        notes: {
          1: 'A 從 B 外側繞過掩護往右運球，吸引防守；B 先站住擋人，再往左外彈到罰球線左側。',
          3: 'B 在罰球線左側中距離投籃（1 分）。',
        },
        summary: {
          zh: '掩護後，掩護者往外彈到罰球線附近，接球投中距離。',
          en: 'After the screen, the screener pops out near the free-throw line for a mid-range catch-and-shoot.',
        },
        finish: { zh: 'B 外彈到中距離接球投籃', en: 'B pops to mid-range for the catch-and-shoot' },
      },
    ],
  },
  {
    id: 'high-pnr-roll',
    category: 'high-pnr',
    name: 'Pick and Roll',
    summary: {
      zh: '掩護後，掩護者轉身下順到籃下，接球上籃。',
      en: 'After the screen, the screener rolls to the rim for the catch and layup.',
    },
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
    finish: { zh: 'B 下順接球上籃', en: 'B rolls for the catch and layup' },
    weights: { A: { iso: 1 }, B: { finishing: 3, height: 2 }, C: { threePoint: 1 } },
  },
  {
    id: 'high-pnr-spain',
    category: 'high-pnr',
    name: 'Spain Pick and Roll',
    summary: {
      zh: '高位擋拆後掩護者下順，第三人從背後擋住下順者的防守者，再外拉接球投籃。',
      en: 'After a high pick and roll, a third player back-screens the roller’s defender, then pops out for the catch-and-shoot.',
    },
    roles: {
      A: { zh: '持球者', en: 'Ball handler' },
      B: { zh: '掩護者（下順）', en: 'Screener (rolls)' },
      C: { zh: '背掩護後外拉', en: 'Back-screens, then pops out' },
    },
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
        note: 'A 從 B 外側繞過掩護往右運球；B 先站住擋人，再從右側繞往籃下順；C 往下到籃下附近，從背後擋住 B 的防守者。',
        paths: [
          { kind: 'dribble', actor: 'A', to: { x: 3.4, y: 5.6 }, via: [AROUND_SCREEN] },
          { kind: 'cut', actor: 'B', to: { x: 1.0, y: 2.0 }, via: [{ x: 2.4, y: 4.0 }] },
          { kind: 'screen', actor: 'C', to: { x: 0.4, y: 3.6 } },
        ],
      },
      {
        note: 'C 背掩護後外拉到弧頂左側，A 傳給 C。',
        paths: [
          { kind: 'cut', actor: 'C', to: { x: -2.8, y: 8.2 } },
          { kind: 'pass', actor: 'A', target: 'C' },
        ],
      },
      { note: 'C 弧外投籃（2 分）。', paths: [{ kind: 'shot', actor: 'C' }] },
    ],
    finisher: 'C',
    finish: { zh: 'C 背掩護後外拉接球投籃', en: 'C pops out after the back screen for the catch-and-shoot' },
    weights: { A: { iso: 1 }, B: { finishing: 2, height: 1 }, C: { threePoint: 3 } },
    shot: 'three',
    alts: [
      {
        shot: 'mid',
        frame: 2,
        to: { x: -2.2, y: 6.6 },
        notes: {
          2: 'C 背掩護後外拉到罰球線左側，A 傳給 C。',
          3: 'C 在罰球線左側中距離投籃（1 分）。',
        },
        summary: {
          zh: '高位擋拆後掩護者下順，第三人從背後擋住下順者的防守者，再外拉到罰球線附近投中距離。',
          en: 'After a high pick and roll, a third player back-screens the roller’s defender, then pops out near the free-throw line for a mid-range shot.',
        },
        finish: {
          zh: 'C 背掩護後外拉到中距離接球投籃',
          en: 'C pops to mid-range after the back screen for the catch-and-shoot',
        },
      },
      {
        shot: 'paint',
        finisher: 'B',
        notes: {
          2: 'C 背掩護後外拉到弧頂左側，把自己的防守者帶開；A 傳給順到籃下的 B。',
          3: 'B 在籃下出手（1 分）。',
        },
        summary: {
          zh: '高位擋拆後掩護者下順，第三人從背後擋住下順者的防守者，A 傳給順到籃下的掩護者。對方沉退時特別有效。',
          en: 'After a high pick and roll, a third player back-screens the roller’s defender and A hits the screener rolling to the rim. Especially effective against drop coverage.',
        },
        finish: { zh: 'B 下順到籃下接球出手', en: 'B rolls to the rim for the catch and finish' },
        weights: { A: { iso: 1 }, B: { finishing: 3, height: 1 }, C: { threePoint: 1 } },
      },
    ],
  },
  {
    id: 'low-pnr-paint',
    category: 'low-pnr',
    name: 'Paint Shot',
    summary: {
      zh: '球傳進低位後，傳球者下來幫低位的人掩護，低位持球者趁防守者被擋住，運到禁區中路出手。',
      en: 'After the entry pass to the post, the passer comes down to screen for the post player, who uses it to dribble into the middle of the paint and shoot.',
    },
    roles: {
      A: { zh: '傳入低位後掩護', en: 'Enters to the post, then screens' },
      B: { zh: '低位持球、禁區中路出手', en: 'Post player, shoots from the middle of the paint' },
      C: { zh: '拉開空間', en: 'Spacer' },
    },
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
    finish: { zh: 'B 利用 A 的掩護到禁區中路出手', en: 'B uses A’s screen to shoot from the middle of the paint' },
    weights: { A: { height: 1 }, B: { finishing: 3, iso: 2, height: 1 }, C: { threePoint: 1 } },
  },
  {
    id: 'low-pnr-roll',
    category: 'low-pnr',
    name: 'Pick and Roll',
    summary: {
      zh: '球傳到底角附近後，傳球者下來幫持球者掩護再順下，持球者切向中路後回傳給順下的人。',
      en: 'After a pass near the corner, the passer comes down to screen for the ball handler and rolls; the ball handler attacks the middle and dishes to the roller.',
    },
    roles: {
      A: { zh: '傳球後掩護、順下', en: 'Passes, screens, and rolls' },
      B: { zh: '低位持球者', en: 'Ball handler on the low block' },
      C: { zh: '拉開空間', en: 'Spacer' },
    },
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
    finish: { zh: 'A 掩護後順下接球上籃', en: 'A screens and rolls for the catch and layup' },
    weights: { A: { finishing: 3, height: 2 }, B: { iso: 2 }, C: { threePoint: 1 } },
  },
  {
    id: 'cut-give-go',
    category: 'cut',
    name: 'Pass and Cut',
    summary: {
      zh: '傳球後立刻往籃下切，接回傳上籃（傳切）。',
      en: 'Pass and immediately cut to the rim for the return pass and a layup (give-and-go).',
    },
    roles: {
      A: { zh: '傳球後空切', en: 'Passes, then cuts' },
      B: { zh: '接球者', en: 'Receiver' },
      C: { zh: '拉開空間', en: 'Spacer' },
    },
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
    finish: { zh: 'A 切入接回傳上籃', en: 'A cuts for the return pass and a layup' },
    weights: { A: { speed: 3, finishing: 3 }, B: { threePoint: 1 }, C: { threePoint: 1 } },
  },
  {
    id: 'cut-backdoor',
    category: 'cut',
    name: 'Backdoor Cut',
    summary: {
      zh: '側翼先往外拉，把防守者帶出來，再突然往籃下背切。',
      en: 'The wing steps out to draw the defender up, then suddenly cuts backdoor to the rim.',
    },
    roles: {
      A: { zh: '持球者', en: 'Ball handler' },
      B: { zh: '背切者', en: 'Backdoor cutter' },
      C: { zh: '拉開空間', en: 'Spacer' },
    },
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
    finish: { zh: 'B 背切接球上籃', en: 'B cuts backdoor for the catch and layup' },
    weights: { A: {}, B: { speed: 3, finishing: 3 }, C: { threePoint: 1 } },
  },
  {
    id: 'offball-down',
    category: 'off-ball',
    name: 'Down Screen',
    summary: {
      zh: '側翼往下幫低位的隊友掩護，隊友繞出來到側翼接球投籃。',
      en: 'The wing comes down to screen for a low teammate, who comes off it to the wing for the catch-and-shoot.',
    },
    roles: {
      A: { zh: '持球者', en: 'Ball handler' },
      B: { zh: '掩護者', en: 'Screener' },
      C: { zh: '繞掩護接球', en: 'Comes off the screen for the catch' },
    },
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
    finish: { zh: 'C 繞下掩護接球投籃', en: 'C comes off the down screen for the catch-and-shoot' },
    weights: { A: {}, B: { height: 1 }, C: { threePoint: 3, speed: 1 } },
    shot: 'three',
    alts: [
      {
        shot: 'mid',
        frame: 1,
        to: { x: -4.0, y: 5.0 },
        via: [{ x: -3.4, y: 4.0 }],
        notes: {
          1: 'C 繞過掩護往左側罰球線延伸處跑，A 配合時機傳球；B 先站住擋人，再往禁區卡位。',
          2: 'C 在罰球線延伸處中距離投籃（1 分）。',
        },
        summary: {
          zh: '側翼往下幫低位的隊友掩護，隊友繞出來到罰球線延伸處接球投中距離。',
          en: 'The wing comes down to screen for a low teammate, who comes off it to the extended free-throw line for a mid-range catch-and-shoot.',
        },
        finish: { zh: 'C 繞下掩護接球投中距離', en: 'C comes off the down screen for a mid-range catch-and-shoot' },
      },
    ],
  },
  {
    id: 'offball-back',
    category: 'off-ball',
    name: 'Back Screen',
    summary: {
      zh: '在隊友的防守者背後（靠籃框那側）掩護，隊友往籃下空切。',
      en: 'Screen behind a teammate’s defender (on the basket side) so the teammate can cut to the rim.',
    },
    roles: {
      A: { zh: '持球者', en: 'Ball handler' },
      B: { zh: '掩護者', en: 'Screener' },
      C: { zh: '空切者', en: 'Cutter' },
    },
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
    finish: { zh: 'C 背掩護空切上籃', en: 'C cuts off the back screen for a layup' },
    weights: { A: {}, B: { height: 1 }, C: { speed: 2, finishing: 3 } },
  },
  {
    id: 'offball-post-split',
    category: 'off-ball',
    name: 'Post Split',
    summary: {
      zh: '球傳進低位後，外圍兩人交叉掩護：A 先幫 C 掩護，C 繞過來後回頭幫 A 掩護，兩人互相擋住對方的防守者。',
      en: 'After the entry pass to the post, the two perimeter players run a split: A screens for C, then C comes back to screen for A, each freeing the other from a defender.',
    },
    roles: {
      A: { zh: '傳入低位後掩護，再利用掩護外彈投籃', en: 'Enters to the post, screens, then pops off a screen to shoot' },
      B: { zh: '低位傳球', en: 'Passes from the post' },
      C: { zh: '繞過掩護後回頭幫 A 掩護，再往籃下切', en: 'Comes off the screen, screens back for A, then cuts to the rim' },
    },
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
    finish: {
      zh: 'A 交叉掩護後外彈投籃（C 切入是第二選擇）',
      en: 'A pops out off the split to shoot (C’s cut is the second option)',
    },
    weights: { A: { threePoint: 3 }, B: { height: 2 }, C: { finishing: 1, speed: 1 } },
    shot: 'three',
    alts: [
      {
        shot: 'mid',
        frame: 3,
        to: { x: 1.8, y: 6.4 },
        via: [{ x: -1.6, y: 7.6 }],
        notes: {
          3: 'A 從 C 上方繞過掩護外彈到罰球線，B 配合時機傳給 A；C 先站住擋人，再往籃下切，製造第二個選擇。',
          4: 'A 在罰球線中距離投籃（1 分）。',
        },
        summary: {
          zh: '球傳進低位後，外圍兩人交叉掩護：A 先幫 C 掩護，C 繞過來後回頭幫 A 掩護，A 外彈到罰球線投中距離。',
          en: 'After the entry pass to the post, the two perimeter players run a split: A screens for C, then C comes back to screen for A, who pops to the free-throw line for a mid-range shot.',
        },
        finish: {
          zh: 'A 交叉掩護後外彈到罰球線投籃（C 切入是第二選擇）',
          en: 'A pops to the free-throw line off the split to shoot (C’s cut is the second option)',
        },
      },
    ],
  },
  {
    id: 'offball-flare',
    category: 'off-ball',
    name: 'Flare Screen',
    summary: {
      zh: '持球者在一側時，弱邊的隊友幫射手設反向掩護，射手往遠離球的方向外拉接球投籃。',
      en: 'With the ball on one side, a weak-side teammate sets a flare screen for the shooter, who fades away from the ball for the catch-and-shoot.',
    },
    roles: {
      A: { zh: '持球者', en: 'Ball handler' },
      B: { zh: '反向掩護者', en: 'Flare screener' },
      C: { zh: '外拉投籃', en: 'Fades out to shoot' },
    },
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
    finish: { zh: 'C 利用反向掩護外拉接球投籃', en: 'C fades off the flare screen for the catch-and-shoot' },
    weights: { A: {}, B: { height: 1 }, C: { threePoint: 3, speed: 1 } },
    shot: 'three',
    alts: [
      {
        shot: 'mid',
        frame: 1,
        to: { x: -4.2, y: 5.4 },
        via: [{ x: -2.6, y: 8.0 }],
        notes: {
          1: 'C 從 B 上方繞過掩護，往遠離球的方向外拉到左側罰球線延伸處，A 配合時機傳球；B 先站住擋人，再往禁區走。',
          2: 'C 在罰球線延伸處中距離投籃（1 分）。',
        },
        summary: {
          zh: '持球者在一側時，弱邊的隊友幫射手設反向掩護，射手外拉到罰球線延伸處接球投中距離。',
          en: 'With the ball on one side, a weak-side teammate sets a flare screen for the shooter, who fades to the extended free-throw line for a mid-range catch-and-shoot.',
        },
        finish: {
          zh: 'C 利用反向掩護外拉到中距離接球投籃',
          en: 'C fades to mid-range off the flare screen for the catch-and-shoot',
        },
      },
    ],
  },
  {
    id: 'dho-drive',
    category: 'dho',
    name: 'DHO to Drive',
    summary: {
      zh: '持球者運向側翼把球遞給跑上來的隊友，隊友繞過交球者往中路切入，交球者擋住追過來的防守者。',
      en: 'The ball handler dribbles toward the wing and hands off to a teammate coming up, who turns the corner and drives middle while the handler screens off the trailing defender.',
    },
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
    finish: {
      zh: 'B 接手遞手後繞過 A 往中路切入上籃',
      en: 'B takes the hand-off, turns the corner around A, and drives middle for a layup',
    },
    weights: { A: { height: 1 }, B: { speed: 3, iso: 2, finishing: 2 }, C: { threePoint: 1 } },
  },
  {
    id: 'dho-shoot',
    category: 'dho',
    name: 'DHO to Shoot',
    summary: {
      zh: '手遞手後，接球者從交球者外側繞到弧頂，交球者擋住追上來的防守者，接球者投兩分球。',
      en: 'After the hand-off, the receiver loops around the handler to the top of the arc while the handler screens off the trailing defender, then shoots from beyond the arc.',
    },
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
    finish: { zh: 'B 繞過 A 到弧頂投籃', en: 'B comes around A to the top of the arc and shoots' },
    weights: { A: { height: 1 }, B: { threePoint: 3, iso: 1 }, C: { threePoint: 1 } },
    shot: 'three',
    alts: [
      {
        shot: 'mid',
        frame: 2,
        to: { x: 1.2, y: 6.5 },
        via: [{ x: 3.8, y: 8.0 }],
        notes: {
          2: 'B 從 A 的外側（靠中場那側）繞過去，往罰球線運球；A 擋住追過來的防守者。',
          3: 'B 在罰球線附近中距離投籃（1 分）。',
        },
        summary: {
          zh: '手遞手後，接球者從交球者外側繞過去，往罰球線運球，交球者擋住追上來的防守者，接球者投中距離。',
          en: 'After the hand-off, the receiver comes around the handler and dribbles toward the free-throw line while the handler screens off the trailing defender, then shoots from mid-range.',
        },
        finish: {
          zh: 'B 繞過 A 運到罰球線投中距離',
          en: 'B comes around A and dribbles to the free-throw line for a mid-range shot',
        },
      },
    ],
  },
  {
    id: 'dho-fake',
    category: 'dho',
    name: 'Fake Hand-Off',
    summary: {
      zh: '作勢要手遞手，交球者突然把球留著，自己轉身切入。',
      en: 'Fake the hand-off: the handler keeps the ball and spins into a drive.',
    },
    roles: {
      A: { zh: '假手遞手者', en: 'Fakes the hand-off' },
      B: { zh: '假接球者', en: 'Decoy receiver' },
      C: { zh: '拉開空間', en: 'Spacer' },
    },
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
    finish: { zh: 'A 假遞後自己切入上籃', en: 'A fakes the hand-off and drives for a layup' },
    weights: { A: { iso: 3, finishing: 2, speed: 1 }, B: { speed: 1 }, C: { threePoint: 1 } },
  },
  {
    id: 'dho-chicago',
    category: 'dho',
    name: 'Chicago',
    summary: {
      zh: '底角的射手先利用下掩護往上跑，再接持球者的手遞手，連續兩個掩護後投籃。',
      en: 'The corner shooter comes up off a down screen, then takes a hand-off from the ball handler and shoots after back-to-back screens.',
    },
    roles: {
      A: { zh: '手遞手給球者', en: 'Hands off' },
      B: { zh: '下掩護者', en: 'Down screener' },
      C: { zh: '連續利用掩護投籃', en: 'Uses both screens to shoot' },
    },
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
    finish: { zh: 'C 連續利用下掩護與手遞手後投籃', en: 'C shoots off the down screen and the hand-off' },
    weights: { A: { height: 1 }, B: { height: 1 }, C: { threePoint: 3, speed: 1 } },
    shot: 'three',
    alts: [
      {
        shot: 'mid',
        frame: 3,
        to: { x: -1.0, y: 6.6 },
        via: [{ x: -3.6, y: 8.4 }],
        notes: {
          3: 'C 從 A 的外側（靠中場那側）繞過去，往罰球線運球；A 擋住追過來的防守者。',
          4: 'C 在罰球線附近中距離投籃（1 分）。',
        },
        summary: {
          zh: '底角的射手先利用下掩護往上跑，再接持球者的手遞手，運到罰球線附近投中距離。',
          en: 'The corner shooter comes up off a down screen, takes a hand-off from the ball handler, and dribbles near the free-throw line for a mid-range shot.',
        },
        finish: {
          zh: 'C 連續利用下掩護與手遞手後運到罰球線投籃',
          en: 'C uses the down screen and the hand-off, then dribbles to the free-throw line to shoot',
        },
      },
    ],
  },
  {
    id: 'iso-top',
    category: 'iso',
    name: 'Top Isolation',
    summary: {
      zh: '兩個隊友拉到兩側底角清出空間，持球者在弧頂一對一切入。',
      en: 'Both teammates clear out to the corners and the ball handler attacks one-on-one from the top of the arc.',
    },
    roles: {
      A: { zh: '單打持球者', en: 'Isolation ball handler' },
      B: { zh: '拉開空間', en: 'Spacer' },
      C: { zh: '拉開空間', en: 'Spacer' },
    },
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
    finish: { zh: 'A 弧頂一對一切入上籃', en: 'A drives one-on-one from the top for a layup' },
    weights: { A: { iso: 3, finishing: 2, speed: 1 }, B: { threePoint: 1 }, C: { threePoint: 1 } },
  },
  {
    id: 'iso-post',
    category: 'iso',
    name: 'Post Isolation',
    summary: {
      zh: '高個子到低位要位接球，隊友拉開到外圍，讓他在低位一對一。',
      en: 'The big posts up for the entry pass while the teammates space the floor, leaving a one-on-one in the post.',
    },
    roles: {
      A: { zh: '傳入低位', en: 'Enters to the post' },
      B: { zh: '低位單打', en: 'Posts up' },
      C: { zh: '拉開空間', en: 'Spacer' },
    },
    start: { A: { x: 2.4, y: 8.2 }, B: { x: 3.4, y: 5.2 }, C: LW },
    ball: 'A',
    frames: [
      {
        note: 'B 從罰球線右側往下，到右側低位（禁區線外緣）背框要位。',
        paths: [{ kind: 'cut', actor: 'B', to: { x: 2.9, y: 2.6 } }],
      },
      { note: 'A 把球傳進低位的 B。', paths: [{ kind: 'pass', actor: 'A', target: 'B' }] },
      {
        note: 'A 拉到弧頂左側、C 拉到左底角，清出空間；B 在低位一對一，轉身往禁區運一步。',
        paths: [
          { kind: 'cut', actor: 'A', to: { x: -2.4, y: 8.4 } },
          { kind: 'cut', actor: 'C', to: LC },
          { kind: 'dribble', actor: 'B', to: { x: 1.5, y: 2.4 } },
        ],
      },
      { note: 'B 在禁區轉身出手（1 分）。', paths: [{ kind: 'shot', actor: 'B' }] },
    ],
    finisher: 'B',
    finish: { zh: 'B 低位要位後轉身往禁區出手', en: 'B posts up, turns, and shoots in the paint' },
    weights: { A: { threePoint: 1 }, B: { height: 3, finishing: 3, iso: 2 }, C: { threePoint: 1 } },
  },
  {
    id: 'iso-mismatch',
    category: 'iso',
    name: 'Hunting the Mismatch',
    summary: {
      zh: '先用擋拆逼對方換防，讓持球者換到比較慢或比較矮的防守者，再一對一切入。若沒有成功換防（對方擠過），就變成一般的擋拆切入。',
      en: 'Use a pick and roll to force a switch onto a slower or shorter defender, then attack one-on-one. If the defense fights over instead of switching, it becomes a regular pick-and-roll drive.',
    },
    roles: {
      A: { zh: '單打持球者', en: 'Isolation ball handler' },
      B: { zh: '掩護者（引出錯位）', en: 'Screener (forces the mismatch)' },
      C: { zh: '拉開空間', en: 'Spacer' },
    },
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
    finish: { zh: 'A 換防後對錯位的防守者切入', en: 'A attacks the mismatched defender after the switch' },
    weights: { A: { iso: 3, speed: 2, finishing: 1 }, B: { height: 1 }, C: { threePoint: 1 } },
  },
];
