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
import { guardPosition } from './defense';

// 防守 AI（SPEC §6.2）：人盯人，追不上就是追不上；遇到掩護時依設定換防或擠過。
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
  const pendingSwaps: { at: number; a: string; b: string }[] = [];
  const handled = new Set<number>();

  // 起始位置：理想位置
  const start = poseAt(tactic, timeline, 0).positions;
  const holder0 = ballHolderAt(tactic, timeline, 0);
  const cur: Record<string, Vec2> = {};
  for (const r of reds) cur[r.id] = guardPosition(start[assign[r.id]!]!, holder0 === assign[r.id]);

  for (let i = 0; i < ticks; i++) {
    const t = i * DT;

    // 換防到時間了就交換對位
    for (let k = pendingSwaps.length - 1; k >= 0; k--) {
      const s = pendingSwaps[k]!;
      if (s.at > t) continue;
      [assign[s.a], assign[s.b]] = [assign[s.b]!, assign[s.a]!];
      pendingSwaps.splice(k, 1);
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
        const target = guardPosition(seenPos[man]!, seenHolder === man);
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
          if (sc.screenerId === man || t < sc.setAt) return;
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
            const partner = reds.find((x) => assign[x.id] === sc.screenerId);
            frozenUntil[r.id] = t + SWITCH_DELAY;
            if (partner) pendingSwaps.push({ at: t + SWITCH_DELAY, a: r.id, b: partner.id });
            events.push({
              t,
              type: 'switch',
              defenderId: r.id,
              screenerId: sc.screenerId,
              delay: SWITCH_DELAY,
              partnerId: partner?.id,
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
