import { ballHolderAt, passAt, poseAt, screensOf, type Timeline } from '../anim/timeline';
import { defenderAssignments } from '../model/matchups';
import { RIM } from '../model/paths';
import { heightOf, speedOf } from '../model/physique';
import type { PickCoverage, Tactic, Vec2 } from '../model/types';
import {
  BODY_DISTANCE,
  DEFENSE_SPEED_FACTOR,
  DT,
  FIGHT_OVER_DELAY,
  JUMP_DURATION,
  FIGHT_OVER_PER_CM,
  FIGHT_OVER_RANGE,
  HELP_FRONT,
  HELP_MAX,
  HELP_MIN,
  HELP_RECOVERED,
  REACTION_TIME,
  SCREEN_CONTACT,
  SCREEN_HOLD_RADIUS,
  SWITCH_DELAY,
  VELOCITY_DT,
} from './config';
import { chaseTarget, defendPosition, guardPosition, nextDenyState, outwardSpeedOf, pickHelpPosition } from './defense';

// 防守 AI（SPEC §6.2）：人盯人＋阻絕外圍傳球路線，追不上就是追不上；遇到掩護時依設定換防或擠過，
// 擋拆擠過時，掩護者的防守者沉退或上提。
// 藍隊的移動不受紅隊影響，所以先用時間軸算出藍隊位置，再一格一格推進紅隊。完全決定性。

export interface DefenseEvent {
  t: number;
  /** drop / hedge：擋拆擠過時，掩護者的防守者（defenderId）沉退或上提 */
  type: 'fight-over' | 'switch' | PickCoverage;
  /** 被掩護的防守者；drop / hedge 時是協防的人（盯掩護者的防守者） */
  defenderId: string;
  screenerId: string;
  /** 被卡住的秒數；drop / hedge 時是協防了多久 */
  delay: number;
  /** drop / hedge 時，被協防的持球者 */
  handlerId?: string;
  /** 換防時，另一位防守者 */
  partnerId?: string;
  /** 換防時，這次換防完成後的對位（紅隊 id → 藍隊 id）；之後再換防也不會影響 */
  assignmentsAfter?: Record<string, string>;
}

export interface DefenseResult {
  ticks: number;
  /** 每位紅隊球員在每一格的位置 */
  red: Record<string, Vec2[]>;
  /** 每一格被掩護卡住的紅隊球員 */
  stuck: Set<string>[];
  events: DefenseEvent[];
  /** 最後一格時的對位（紅隊 id → 藍隊 id），換防後會不同 */
  finalAssignments: Record<string, string>;
}

interface PendingSwap {
  at: number;
  a: string;
  b: string;
}

/** 依時間順序套用換防（交換兩位防守者的對象）；交換的順序會影響結果，不能倒著套 */
export function applySwaps(assign: Readonly<Record<string, string>>, swaps: readonly PendingSwap[]): Record<string, string> {
  const out = { ...assign };
  for (const s of swaps) [out[s.a], out[s.b]] = [out[s.b]!, out[s.a]!];
  return out;
}

/**
 * 換防：defenderId 被 screenerId 的掩護擋到。
 * 先把還在延遲中、已經決定的換防算進去（連續掩護時，前一次換防可能還沒生效），
 * 再找出「盯掩護者的人」當交換對象，並算出這次換防完成後的對位。
 */
export function planSwitch(
  assign: Readonly<Record<string, string>>,
  pending: readonly PendingSwap[],
  defenderId: string,
  screenerId: string,
): { partnerId?: string; after: Record<string, string> } {
  const projected = applySwaps(assign, pending);
  const partnerId = Object.keys(projected).find((id) => id !== defenderId && projected[id] === screenerId);
  const after = partnerId ? applySwaps(projected, [{ at: 0, a: defenderId, b: partnerId }]) : projected;
  return { partnerId, after };
}

export function fightOverDelay(screenerCm: number, defenderCm: number): number {
  const d = FIGHT_OVER_DELAY + FIGHT_OVER_PER_CM * (screenerCm - defenderCm);
  return Math.min(FIGHT_OVER_RANGE.max, Math.max(FIGHT_OVER_RANGE.min, d));
}

const rimDistance = (p: Vec2) => Math.hypot(p.x - RIM.x, p.y - RIM.y);

/**
 * 擋拆的協防是否結束（SPEC §6.2）：隊友追回來（recovered，已含至少協防 HELP_MIN 秒）、時間到、或持球者把球傳出去。
 * 防守者看到的是 seen（反應時間之前）的持球者，所以「傳出去」只算 seen 在協防開始之後的變化：
 * 接球後馬上擋拆時，seen 的持球者可能還是傳球者或球在空中，那不算傳出去。
 */
export function pickHelpOver(
  help: { start: number; until: number; handler: string },
  t: number,
  seen: number,
  seenHolder: string | null,
  recovered: boolean,
): boolean {
  const passedOut = seen >= help.start && seenHolder !== help.handler;
  return recovered || passedOut || t >= help.until;
}

export function simulateDefense(tactic: Tactic, timeline: Timeline): DefenseResult {
  const { players } = tactic;
  const reds = players.filter((p) => p.team === 'red');
  const blues = players.filter((p) => p.team === 'blue');
  const byId = new Map(players.map((p) => [p.id, p]));
  const assign = defenderAssignments(tactic.matchups); // 紅 → 藍
  const speed = Object.fromEntries(reds.map((r) => [r.id, speedOf(r, players, false) * DEFENSE_SPEED_FACTOR]));
  const screens = screensOf(tactic, timeline);

  const ticks = Math.max(1, Math.ceil(timeline.total / DT) + 1);
  const red: Record<string, Vec2[]> = Object.fromEntries(reds.map((r) => [r.id, []]));
  const stuck: Set<string>[] = [];
  const events: DefenseEvent[] = [];

  const frozenUntil: Record<string, number> = {};
  /** 已決定、還在 SWITCH_DELAY 延遲中的換防，依時間先後排列 */
  const pendingSwaps: PendingSwap[] = [];
  const handled = new Set<number>();
  /** 每位防守者是否正在阻絕（換防後重新判斷） */
  const denying: Record<string, boolean> = {};
  /** 對位者傳完球後，防守者往球的方向靠到這個時間 */
  const jumpUntil: Record<string, number> = {};
  /** 往球的方向靠時，球要去的地方（接球者） */
  const jumpToward: Record<string, string> = {};
  /** 擋拆擠過時正在協防的人（盯掩護者的防守者）→ 協防的對象、被掩護的隊友、對應的事件 */
  const helping: Record<string, { handler: string; teammate: string; until: number; event: DefenseEvent }> = {};

  // 起始位置：理想位置
  const start = poseAt(tactic, timeline, 0).positions;
  const holder0 = ballHolderAt(tactic, timeline, 0);
  const cur: Record<string, Vec2> = {};
  const ball0 = holder0 ? start[holder0]! : null;
  const { pressure } = tactic;
  for (const r of reds) cur[r.id] = defendPosition(start[assign[r.id]!]!, ball0, holder0 === assign[r.id], false, pressure);

  for (let i = 0; i < ticks; i++) {
    const t = i * DT;

    // 換防到時間了就交換對位（依時間順序）
    const due = pendingSwaps.filter((s) => s.at <= t);
    if (due.length) {
      Object.assign(assign, applySwaps(assign, due));
      pendingSwaps.splice(0, due.length);
      for (const s of due) {
        // 換了人盯，重新判斷要不要阻絕、往球的方向靠
        denying[s.a] = denying[s.b] = false;
        jumpUntil[s.a] = jumpUntil[s.b] = -1;
      }
    }

    if (i > 0) {
      // 防守者看到的是反應時間之前的狀況
      const seen = Math.max(0, t - REACTION_TIME);
      const seenPos = poseAt(tactic, timeline, seen).positions;
      const seenHolder = ballHolderAt(tactic, timeline, seen);
      // 對位者剛才的位置，用來判斷他是不是往外跑想接球（要不要阻絕）
      const prevPos = poseAt(tactic, timeline, Math.max(0, seen - VELOCITY_DT)).positions;
      const now = poseAt(tactic, timeline, t).positions;
      // 含延遲中換防的預計對位；每一格算一次就好
      const projected = pendingSwaps.length ? applySwaps(assign, pendingSwaps) : assign;
      const seenPass = passAt(timeline, seen);

      for (const r of reds) {
        if (t < (frozenUntil[r.id] ?? 0)) continue;
        const man = assign[r.id]!;
        const seenBall = seenHolder ? seenPos[seenHolder]! : null;
        denying[r.id] = nextDenyState(denying[r.id] ?? false, outwardSpeedOf(prevPos[man]!, seenPos[man]!, VELOCITY_DT));
        // 看到對位者把球傳出去：往接球者的方向靠一下（傳球飛行中持續延長）
        if (seenPass && seenPass.from === man) {
          jumpUntil[r.id] = seen + JUMP_DURATION;
          jumpToward[r.id] = seenPass.to;
          denying[r.id] = false;
        }
        const jumping = seen < (jumpUntil[r.id] ?? -1) && seenHolder !== man;
        const jumpTo = jumping ? seenPos[jumpToward[r.id]!]! : null;
        // 協防擋拆：被掩護的隊友追回來、球傳出去、或時間到了，就回去盯掩護者
        const help = helping[r.id];
        if (help) {
          const mate = cur[help.teammate]!;
          const handler = seenPos[help.handler]!;
          const spot = guardPosition(handler, true, pressure);
          const recovered =
            t >= help.event.t + HELP_MIN &&
            t >= (frozenUntil[help.teammate] ?? 0) &&
            Math.hypot(mate.x - spot.x, mate.y - spot.y) <= HELP_RECOVERED &&
            rimDistance(mate) <= rimDistance(handler) - HELP_FRONT;
          if (pickHelpOver({ start: help.event.t, until: help.until, handler: help.handler }, t, seen, seenHolder, recovered)) {
            help.event.delay = t - help.event.t;
            delete helping[r.id];
          }
        }
        const target = helping[r.id]
          ? pickHelpPosition(tactic.pickCoverage, seenPos[helping[r.id]!.handler]!, pressure)
          : chaseTarget(cur[r.id]!, seenPos[man]!, seenBall, seenHolder === man, denying[r.id], jumpTo, pressure);
        const p = cur[r.id]!;
        const dx = target.x - p.x;
        const dy = target.y - p.y;
        const d = Math.hypot(dx, dy);
        const step = speed[r.id]! * DT;
        let next = d <= step ? target : { x: p.x + (dx / d) * step, y: p.y + (dy / d) * step };
        // 不能穿過進攻者：太近就沿著連線推開
        for (const b of blues) {
          const bp = now[b.id]!;
          const ox = next.x - bp.x;
          const oy = next.y - bp.y;
          const od = Math.hypot(ox, oy);
          if (od >= BODY_DISTANCE) continue;
          next = od === 0 ? { x: bp.x, y: bp.y + BODY_DISTANCE } : { x: bp.x + (ox / od) * BODY_DISTANCE, y: bp.y + (oy / od) * BODY_DISTANCE };
        }
        cur[r.id] = next;

        // 掩護：掩護者已經到位，而且擋在防守者要去的方向上
        screens.forEach((sc, idx) => {
          // 自己（含延遲中即將換到）盯的人是掩護者時，不算被掩護
          if (sc.screenerId === man || sc.screenerId === projected[r.id] || t < sc.setAt) return;
          // 每個掩護只觸發一次：換防後，接手的防守者經過同一個掩護時不會再換回來
          if (handled.has(idx)) return;
          const sp = now[sc.screenerId]!;
          if (Math.hypot(sp.x - sc.spot.x, sp.y - sc.spot.y) > SCREEN_HOLD_RADIUS) return;
          const toScreener = { x: sp.x - next.x, y: sp.y - next.y };
          if (Math.hypot(toScreener.x, toScreener.y) > SCREEN_CONTACT) return;
          if (toScreener.x * dx + toScreener.y * dy <= 0) return; // 掩護者不在前進方向上
          handled.add(idx);

          if (tactic.screenDefense === 'fight-over') {
            const delay = fightOverDelay(heightOf(byId.get(sc.screenerId)!, players), heightOf(r, players));
            frozenUntil[r.id] = t + delay;
            events.push({ t, type: 'fight-over', defenderId: r.id, screenerId: sc.screenerId, delay });
            // 擋拆（被掩護的人盯的是持球者）：盯掩護者的人沉退或上提，等隊友追回來
            const big = reds.find((x) => x.id !== r.id && assign[x.id] === sc.screenerId);
            if (big && ballHolderAt(tactic, timeline, t) === man && !helping[big.id]) {
              const event: DefenseEvent = { t, type: tactic.pickCoverage, defenderId: big.id, screenerId: sc.screenerId, delay: 0, handlerId: man };
              events.push(event);
              helping[big.id] = { handler: man, teammate: r.id, until: t + HELP_MAX, event };
            }
          } else {
            const { partnerId, after } = planSwitch(assign, pendingSwaps, r.id, sc.screenerId);
            frozenUntil[r.id] = t + SWITCH_DELAY;
            if (partnerId) pendingSwaps.push({ at: t + SWITCH_DELAY, a: r.id, b: partnerId });
            events.push({
              t,
              type: 'switch',
              defenderId: r.id,
              screenerId: sc.screenerId,
              delay: SWITCH_DELAY,
              partnerId,
              assignmentsAfter: after,
            });
          }
        });
      }
    }

    for (const r of reds) red[r.id]!.push({ ...cur[r.id]! });
    // 模擬結束時還在協防：協防時間算到最後一格
    if (i === ticks - 1) for (const h of Object.values(helping)) h.event.delay = t - h.event.t;
    stuck.push(new Set(reds.filter((r) => t < (frozenUntil[r.id] ?? 0)).map((r) => r.id)));
  }

  return { ticks, red, stuck, events, finalAssignments: { ...assign } };
}

/** 時間 t 時紅隊的位置（相鄰兩格之間內插） */
export function redAt(result: DefenseResult, t: number): { positions: Record<string, Vec2>; stuck: Set<string> } {
  const f = Math.min(Math.max(0, t / DT), result.ticks - 1);
  const i = Math.floor(f);
  const j = Math.min(i + 1, result.ticks - 1);
  const u = f - i;
  const positions: Record<string, Vec2> = {};
  for (const [id, samples] of Object.entries(result.red)) {
    const a = samples[i]!;
    const b = samples[j]!;
    positions[id] = { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u };
  }
  return { positions, stuck: result.stuck[i]! };
}
