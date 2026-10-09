import { displayName } from '../model/defaults';
import type { Player, Tactic } from '../model/types';
import { PLAYS, playVariants, type Play } from '../plays/library';
import { truncateText } from '../model/text';
import type { Advice, Edge, Reason, Strength } from '../plays/recommend';
import { edgeGap, type CommentMessage, type Space } from '../sim/evaluate';
import { getLocale, t, tr, type Locale, type Messages } from '.';

// 依目前語系，把模擬與推薦的結果（評價、推薦理由、球隊總評）組成句子。純函式，不碰 DOM。

/** 球員的稱呼：號碼＋暱稱 */
export function playerName(players: readonly Player[], id: string): string {
  const p = players.find((x) => x.id === id)!;
  return t().common.player(p.number, displayName(p));
}

/**
 * 戰術名稱：類別-名稱；有多個出手點的戰術加上出手點，例如「高位擋拆-Pick and Pop（中距離）」。
 * messages 預設是目前語系；plays-doc 固定傳繁體中文的文字表。
 */
export function playTitle(play: Play, withShot = true, messages: Messages = t()): string {
  const m = messages.library;
  return m.playTitle(m.category[play.category], play.name) + (withShot ? shotSuffix(play, messages) : '');
}

/** 出手點後綴，例如「（中距離）」；只有一個出手點的戰術是空字串 */
export function shotSuffix(play: Play, messages: Messages = t()): string {
  return play.shot ? messages.library.shotSuffix(messages.shot[play.shot]) : '';
}

/** 預填名稱的候選寫法，依偏好順序：完整名稱、類別簡稱＋名稱＋出手點、名稱＋出手點、類別簡稱＋名稱、名稱 */
function nameCandidates(play: Play): string[] {
  const m = t().library;
  const short = m.playTitle(m.categoryShort[play.category], play.name);
  return [playTitle(play), short + shotSuffix(play), play.name + shotSuffix(play), short, play.name];
}

/** 每套戰術的候選寫法（所有出手點），依語系快取；預填名稱不能用其他戰術的候選寫法 */
const candidatesByLocale = new Map<Locale, Map<string, Set<string>>>();
function candidatesOfPlays(): Map<string, Set<string>> {
  let byPlay = candidatesByLocale.get(getLocale());
  if (!byPlay) {
    byPlay = new Map(PLAYS.map((p) => [p.id, new Set(playVariants(p).flatMap(nameCandidates))]));
    candidatesByLocale.set(getLocale(), byPlay);
  }
  return byPlay;
}

/**
 * 存檔時預填的戰術名稱：取第一個放得下 max 個字、不是其他戰術候選寫法的寫法
 * （英文的類別比較長，完整名稱常超過上限；高位、低位都有 Pick and Roll，只寫名稱會分不出來）。
 * 同一套戰術的出手點依固定順序一起決定，後面的出手點跳過前面已經用掉的寫法，所以彼此不會重複。
 * 都不行時才截斷完整名稱。
 */
export function playNameSuggestion(play: Play, max: number): string {
  const byPlay = candidatesOfPlays();
  const others = new Set([...byPlay].filter(([id]) => id !== play.id).flatMap(([, set]) => [...set]));
  const used = new Set<string>();
  const base = PLAYS.find((p) => p.id === play.id);
  for (const variant of base ? playVariants(base) : [play]) {
    const name =
      nameCandidates(variant).find((c) => c.length <= max && !others.has(c) && !used.has(c)) ?? truncateText(playTitle(variant), max);
    if (variant.shot === play.shot) return name;
    used.add(name);
  }
  return truncateText(playTitle(play), max);
}

// ---- 評分卡片的評價 ----

const fmt2 = (v: number) => v.toFixed(2);
const fmt1 = (v: number) => v.toFixed(1);

function spaceText(space: Space, name: (id: string) => string): string {
  const m = t().comment;
  switch (space.kind) {
    case 'all-behind':
      return m.spaceAllBehind(edgeGap(space.distance));
    case 'open':
      return m.spaceOpen(edgeGap(space.distance));
    case 'tight':
      return m.spaceTight(name(space.defenderId));
    case 'contested':
      return m.spaceContested(name(space.defenderId), edgeGap(space.distance));
  }
}

export function commentText(msg: CommentMessage, players: readonly Player[]): string {
  const m = t().comment;
  const name = (id: string) => playerName(players, id);
  const zone = (z: keyof ReturnType<typeof t>['zone']) => t().zone[z];
  switch (msg.kind) {
    case 'shot':
      return m.shot(msg.frame, name(msg.shooterId), zone(msg.zone), msg.points, spaceText(msg.space, name), fmt2(msg.expected));
    case 'no-shot':
      return m.noShot;
    case 'best-option':
      return m.bestOption(name(msg.playerId), zone(msg.zone), spaceText(msg.space, name));
    case 'late-shot':
      return m.lateShot(fmt1(msg.seconds), msg.shotClock);
    case 'too-long':
      return m.tooLong(fmt1(msg.seconds), msg.shotClock);
    case 'better-option':
      return m.betterOption(
        name(msg.playerId),
        zone(msg.zone),
        msg.allBehind ? m.betterAllBehind : m.betterNearest(edgeGap(msg.distance)),
        fmt2(msg.expected),
      );
    case 'drive-help':
      return m.driveHelp(msg.frame, name(msg.defenderId), name(msg.handlerId), fmt1(msg.delay), name(msg.leftId));
    case 'fight-over':
      return m.fightOver(msg.frame, name(msg.screenerId), name(msg.defenderId), fmt2(msg.delay));
    case 'drop':
    case 'hedge':
      return m[msg.kind](msg.frame, name(msg.defenderId), fmt1(msg.delay), name(msg.handlerId), name(msg.screenerId));
    case 'switch': {
      const x = msg.mismatch;
      const detail = x ? m.mismatch(name(x.blueId), name(x.redId), x.heightCm >= 5 ? m.taller(x.heightCm) : m.faster(x.speedPct)) : '';
      return m.switched(msg.frame, name(msg.screenerId), detail);
    }
    case 'spacing':
      return m.spacing(msg.frame, name(msg.aId), name(msg.bId), edgeGap(msg.distance));
    case 'rate': {
      const x = msg.mismatch;
      const height = !x ? '' : x.heightEdge > 0 ? m.heightTaller(x.heightEdge, x.pct) : m.heightShorter(-x.heightEdge, x.pct);
      return m.rate(
        name(msg.playerId),
        t().skill[msg.skill],
        t().rating[msg.rating],
        zone(msg.zone),
        Math.round(msg.baseRate * 100),
        msg.finalRate === null ? null : Math.round(msg.finalRate * 100),
        height,
      );
    }
    case 'in-time':
      return m.inTime(fmt1(msg.seconds), msg.shotClock);
  }
}

// ---- 推薦理由與球隊總評 ----

/** 比較好的地方，例如「弧外投射「優勢」」「比對位的防守者高 8 cm」 */
export function edgeText(edge: Edge): string {
  const m = t().recommend;
  if (edge.key === 'height') return m.taller(edge.cm);
  if (edge.key === 'speed') return m.faster(edge.pct);
  return m.skill(t().skill[edge.key], t().rating[edge.rating]);
}

export function reasonText(reason: Reason, play: Play, players: readonly Player[]): string {
  const m = t().recommend;
  if (reason.kind === 'average') return m.average(tr(play.finish));
  const isSkill = reason.edge.key !== 'height' && reason.edge.key !== 'speed';
  return m.reason(playerName(players, reason.playerId), edgeText(reason.edge), isSkill, reason.role, tr(play.roles[reason.role]));
}

/** 強項適合的打法 */
export const styleText = (s: Pick<Strength, 'key'>): string => t().recommend.style[s.key];

export function adviceText(advice: Advice, tactic: Tactic): string {
  const m = t().recommend;
  if (advice.kind === 'average') return m.adviceAverage;
  const { first, second } = advice;
  return m.advice(
    playerName(tactic.players, first.playerId),
    m.style[first.key],
    second ? playerName(tactic.players, second.playerId) : null,
    second ? m.style[second.key] : null,
    playTitle(advice.top, false),
    advice.grade,
  );
}
