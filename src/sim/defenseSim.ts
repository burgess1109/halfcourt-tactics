import { ballHolderAt, poseAt, screensOf, type Timeline } from '../anim/timeline';
import { defenderAssignments } from '../model/matchups';
import { heightOf, speedOf } from '../model/physique';
import type { Tactic, Vec2 } from '../model/types';
import {
  BODY_DISTANCE,
  DEFENSE_SPEED_FACTOR,
  DT,
  FIGHT_OVER_DELAY,
  FIGHT_OVER_PER_CM,
  FIGHT_OVER_RANGE,
  REACTION_TIME,
  SCREEN_CONTACT,
  SCREEN_HOLD_RADIUS,
  SWITCH_DELAY,
} from './config';
import { chaseTarget, defendPosition } from './defense';

// 防守 AI（SPEC §6.2）：人盯人＋阻絕外圍傳球路線，追不上就是追不上；遇到掩護時依設定換防或擠過。
// 藍隊的移動不受紅隊影響，所以先用時間軸算出藍隊位置，再一格一格推進紅隊。完全決定性。

export interface DefenseEvent {
  t: number;
  type: 'fight-over' | 'switch';
  /** 被掩護的防守者 */
  defenderId: string;
  screenerId: string;
  /** 被卡住的秒數 */
  delay: number;
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

  // 起始位置：理想位置
  const start = poseAt(tactic, timeline, 0).positions;
  const holder0 = ballHolderAt(tactic, timeline, 0);
  const cur: Record<string, Vec2> = {};
  const ball0 = holder0 ? start[holder0]! : null;
  for (const r of reds) cur[r.id] = defendPosition(start[assign[r.id]!]!, ball0, holder0 === assign[r.id]);

  for (let i = 0; i < ticks; i++) {
    const t = i * DT;

    // 換防到時間了就交換對位（依時間順序）
    const due = pendingSwaps.filter((s) => s.at <= t);
    if (due.length) {
      Object.assign(assign, applySwaps(assign, due));
      pendingSwaps.splice(0, due.length);
    }

    if (i > 0) {
      // 防守者看到的是反應時間之前的狀況
      const seen = Math.max(0, t - REACTION_TIME);
      const seenPos = poseAt(tactic, timeline, seen).positions;
      const seenHolder = ballHolderAt(tactic, timeline, seen);
      const now = poseAt(tactic, timeline, t).positions;

      for (const r of reds) {
        if (t < (frozenUntil[r.id] ?? 0)) continue;
        const man = assign[r.id]!;
        const seenBall = seenHolder ? seenPos[seenHolder]! : null;
        const target = chaseTarget(cur[r.id]!, seenPos[man]!, seenBall, seenHolder === man);
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
          if (sc.screenerId === man || sc.screenerId === applySwaps(assign, pendingSwaps)[r.id] || t < sc.setAt) return;
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
