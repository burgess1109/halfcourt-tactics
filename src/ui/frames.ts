import { MAX_FRAMES, cannotInsertAfter, insertFrameAfter, removeFrame } from '../model/frames';
import type { Store } from '../model/store';
import { bindMenu } from './menu';

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

/** 分鏡切換：‹ n / N ›、＋ 新增、點數字開選單刪除 */
export function attachFrames(store: Store, notify: (message: string) => void): void {
  const prev = $<HTMLButtonElement>('#frame-prev');
  const next = $<HTMLButtonElement>('#frame-next');
  const add = $<HTMLButtonElement>('#frame-add');
  const label = $<HTMLButtonElement>('#frame-label');
  const menu = $<HTMLElement>('#frame-menu');
  const del = $<HTMLButtonElement>('#frame-delete');

  const go = (delta: number) => {
    store.update((s) => {
      const i = s.frameIndex + delta;
      if (i < 0 || i >= s.tactic.frames.length) return;
      s.frameIndex = i;
      s.selectedPathId = null;
    });
  };

  prev.addEventListener('click', () => go(-1));
  next.addEventListener('click', () => go(1));
  add.addEventListener('click', () => {
    const s = store.get();
    const reason = cannotInsertAfter(s.tactic, s.frameIndex);
    if (reason) {
      notify(reason);
      return;
    }
    store.commit((s) => {
      const i = insertFrameAfter(s.tactic, s.frameIndex);
      if (i !== null) {
        s.frameIndex = i;
        s.selectedPathId = null;
      }
    });
  });

  const menuCtl = bindMenu(label, menu, () => del.focus());
  del.addEventListener('click', () => {
    menuCtl.close();
    store.commit((s) => {
      const i = removeFrame(s.tactic, s.frameIndex);
      if (i !== null) {
        s.frameIndex = i;
        s.selectedPathId = null;
      }
    });
  });

  // ←/→ 切換分鏡
  document.addEventListener('keydown', (e) => {
    if (document.body.dataset.screen !== 'board' || store.get().playing || document.querySelector('dialog[open]')) return;
    if (e.target instanceof HTMLInputElement) return;
    if (e.key === 'ArrowLeft') go(-1);
    else if (e.key === 'ArrowRight') go(1);
  });

  const sync = () => {
    const s = store.get();
    const n = s.tactic.frames.length;
    label.textContent = `${s.frameIndex + 1} / ${n}`;
    label.setAttribute('aria-label', `第 ${s.frameIndex + 1} 個分鏡，共 ${n} 個`);
    prev.disabled = s.playing || s.frameIndex === 0;
    next.disabled = s.playing || s.frameIndex === n - 1;
    add.disabled = s.playing || n >= MAX_FRAMES;
    label.disabled = s.playing;
    del.disabled = n <= 1;
    if (s.playing) menuCtl.close();
  };
  store.subscribe(sync);
  sync();
}
