import { displayName } from '../model/defaults';
import type { Player, Tactic } from '../model/types';
import type { Messages } from '.';
import type { Play } from '../plays/library';
import type { Advice, Edge, Reason, Strength } from '../plays/recommend';
import { edgeGap, type CommentMessage, type Space } from '../sim/evaluate';
import { t, tr } from '.';

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
  const title = m.playTitle(m.category[play.category], play.name);
  return withShot && play.shot ? title + m.shotSuffix(messages.shot[play.shot]) : title;
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
