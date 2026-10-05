import type { Simulation } from '../anim/simulation';
import type { Store } from '../model/store';
import { scoringOf } from '../model/scoring';
import { evaluate } from '../sim/evaluate';

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

/** 標示球員的光圈顯示多久（毫秒） */
const HIGHLIGHT_MS = 3000;

/**
 * 播放完後的評分卡片（SPEC §6.4、§6.5）：評等、預期得分、3–5 條評價。
 * 點評價跳到該分鏡並標示球員；戰術一改，卡片就關閉（分數已經不準）。
 */
export function attachResult(store: Store): { show: (sim: Simulation) => void; hide: () => void } {
  const panel = $<HTMLElement>('#result');
  const grade = $<HTMLElement>('#result-grade');
  const score = $<HTMLElement>('#result-score');
  const points = $<HTMLElement>('#result-points');
  const list = $<HTMLElement>('#result-comments');
  let shownFor = 0;
  let shownId = '';
  let timer: number | undefined;

  const clearHighlight = () => {
    clearTimeout(timer);
    if (store.get().highlightIds.length) {
      store.update((s) => {
        s.highlightIds = [];
      });
    }
  };

  const stage = $<HTMLElement>('#stage');

  /**
   * 卡片不蓋住球場：直式時 canvas 讓出下方、橫式時讓出右側，球場會依剩下的空間重新縮放。
   */
  const reserveSpace = () => {
    // 設在 #stage 上：canvas、戰術名稱、時間資訊都依同一個變數讓位
    stage.style.removeProperty('--reserve-right');
    stage.style.removeProperty('--reserve-bottom');
    if (panel.hidden) return;
    if (matchMedia('(orientation: landscape)').matches) stage.style.setProperty('--reserve-right', `${panel.offsetWidth + 16}px`);
    else stage.style.setProperty('--reserve-bottom', `${panel.offsetHeight + 16}px`);
  };
  addEventListener('resize', reserveSpace);

  const hide = () => {
    panel.hidden = true;
    reserveSpace();
    clearHighlight();
  };

  $<HTMLButtonElement>('#result-close').addEventListener('click', hide);
  // 點場上任何地方，就把標示的光圈拿掉
  $<HTMLCanvasElement>('#court').addEventListener('pointerdown', () => {
    if (store.get().highlightIds.length) clearHighlight();
  });

  // 戰術有變（updatedAt 改變）就關閉；播放開始時也關閉
  store.subscribe((s) => {
    if (panel.hidden) return;
    // 換成另一份戰術（id 不同）也關閉：載入不會改 updatedAt
    if (s.playing || s.tactic.updatedAt !== shownFor || s.tactic.id !== shownId) hide();
  });

  return {
    show(sim: Simulation) {
      const e = evaluate(store.get().tactic, sim);
      // 沒有投籃就不評分，也不記錄評分
      const scored = e.grade !== null && e.expectedPoints !== null;
      store.update((s) => {
        if (scored) s.tactic.lastResult = { grade: e.grade!, expectedPoints: e.expectedPoints!, score: e.score! };
        else delete s.tactic.lastResult;
      });
      shownFor = store.get().tactic.updatedAt;
      shownId = store.get().tactic.id;

      grade.textContent = scored ? e.grade! : '—';
      grade.dataset.grade = scored ? e.grade! : 'none';
      grade.setAttribute('aria-label', scored ? `評等 ${e.grade}` : '未評分');
      const rule = scoringOf(store.get().tactic);
      score.textContent = !scored ? '未評分' : `${Math.round(e.score!)} 分`;
      points.textContent = !scored
        ? '沒有投籃'
        : e.violation
          ? `違例，預期得分 0（${rule.label}）`
          : `預期得分 ${e.expectedPoints!.toFixed(2)} 分（${rule.label}）`;
      list.replaceChildren(
        ...e.comments.map((c) => {
          const button = document.createElement('button');
          button.type = 'button';
          button.textContent = c.text;
          button.addEventListener('click', () => {
            clearTimeout(timer);
            store.update((s) => {
              s.frameIndex = Math.min(c.frameIndex, s.tactic.frames.length - 1);
              s.selectedPathId = null;
              s.highlightIds = c.playerIds;
            });
            timer = window.setTimeout(clearHighlight, HIGHLIGHT_MS);
          });
          const li = document.createElement('li');
          li.append(button);
          return li;
        }),
      );
      panel.hidden = false;
      reserveSpace();
    },
    hide,
  };
}
