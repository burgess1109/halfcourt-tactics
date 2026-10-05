import { buildTimeline, possessionSeconds } from '../anim/timeline';
import { shotClockOf } from '../model/scoring';
import type { Store } from '../model/store';

const fmt = (s: number) => s.toFixed(1);

/** 球場上方的時間資訊；超過進攻時限（依計分規則，12 或 24 秒）時變紅（SPEC §5） */
export function attachHud(el: HTMLElement, store: Store) {
  const show = (text: string, warn: boolean) => {
    el.textContent = text;
    el.classList.toggle('hud--warn', warn);
  };

  const sync = () => {
    const s = store.get();
    if (s.playing) return; // 播放中由 playing() 更新
    const tl = buildTimeline(s.tactic);
    const frame = tl.frames[s.frameIndex]!;
    const clock = shotClockOf(s.tactic);
    const over = possessionSeconds(tl) > clock;
    const shot = tl.shotReleaseAt === null ? '' : `（${fmt(tl.shotReleaseAt)} 秒出手）`;
    show(
      `分鏡 ${s.frameIndex + 1}：${fmt(frame.duration)} 秒 ｜ 總計 ${fmt(tl.total)} 秒${shot}${over ? `，超過 ${clock} 秒進攻時限` : ''}`,
      over,
    );
  };
  store.subscribe(sync);
  sync();

  return {
    playing(t: number, total: number) {
      show(`▶ ${fmt(t)} / ${fmt(total)} 秒`, t > shotClockOf(store.get().tactic));
    },
  };
}
