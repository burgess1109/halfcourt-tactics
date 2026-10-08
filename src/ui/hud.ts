import { buildTimeline, possessionSeconds } from '../anim/timeline';
import { shotClockOf } from '../model/scoring';
import type { Store } from '../model/store';
import { t } from '../i18n';

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
    const release = tl.shotReleaseAt === null ? null : fmt(tl.shotReleaseAt);
    show(t().hud.frame(s.frameIndex + 1, fmt(frame.duration), fmt(tl.total), release, over ? clock : null), over);
  };
  store.subscribe(sync);
  sync();

  return {
    playing(at: number, total: number) {
      show(t().hud.playing(fmt(at), fmt(total)), at > shotClockOf(store.get().tactic));
    },
  };
}
