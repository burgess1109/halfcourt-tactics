import { isBlueComplete } from '../model/playerForm';
import type { Store } from '../model/store';
import type { Player } from '../model/types';
import { loadPlay, type RoleAssignment } from '../plays/instantiate';
import { PLAYS, ROLES, type Play } from '../plays/library';
import { createBlankTactic } from '../model/defaults';
import {
  bestAssignment,
  recommend,
  recommendationKey,
  sortBySimulation,
  teamSummary,
  withSimulation,
  type Recommendation,
} from '../plays/recommend';

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Record<string, string> = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v;
    else node.setAttribute(k, v);
  }
  node.append(...children);
  return node;
}

export const playTitle = (play: Play) => `${play.category}-${play.name}`;

/**
 * 戰術庫面板（SPEC §6.3）：資料完整時先列出 5 套推薦，下面是全部戰術。
 * 點擊後依最佳角色分配載入成複本，並自動播放一次。
 */
export function attachLibrary(
  store: Store,
  opts: { onLoaded: () => void; notify: (message: string) => void; openSetup: () => void },
): { open: () => void } {
  const dialog = $<HTMLDialogElement>('#library-dialog');
  const body = $<HTMLElement>('#library-body');

  const nameOf = (players: readonly Player[], id: string) => {
    const p = players.find((x) => x.id === id)!;
    return `${p.number} 號 ${p.name}`;
  };
  const rolesText = (play: Play, roles: RoleAssignment) =>
    ROLES.map((r) => `${r} ${play.roles[r]}：${nameOf(store.get().tactic.players, roles[r])}`).join('　');

  const choose = (play: Play, roles: RoleAssignment) => {
    dialog.close();
    store.load(loadPlay(store.get().tactic, play, roles));
    opts.notify(`已載入「${playTitle(play)}」，按復原可以回到原本的戰術`);
    opts.onLoaded();
  };

  const item = (rec: Recommendation, text: string, rank?: number) => {
    const { play, roles } = rec;
    const current = store.get().tactic.basedOn?.playId === play.id;
    const expected = rec.grade
      ? [el('span', { class: 'play-item__grade', 'data-grade': rec.grade }, `預期 ${rec.grade} ${rec.expectedPoints!.toFixed(2)}`)]
      : [];
    const button = el(
      'button',
      { type: 'button', class: `play-item${rank ? '' : ' play-item--plain'}`, 'aria-current': String(current) },
      ...(rank ? [el('span', { class: 'play-item__rank' }, String(rank))] : []),
      el('span', { class: 'play-item__name' }, el('span', { class: 'play-item__cat' }, play.category), play.name, ...expected),
      el('span', { class: 'play-item__text' }, text),
      el('span', { class: 'play-item__roles' }, rolesText(play, roles)),
    );
    button.addEventListener('click', () => choose(play, roles));
    return el('li', {}, button);
  };

  const render = (ranked: readonly Recommendation[]) => {
    const t = store.get().tactic;
    body.replaceChildren();
    const byPlay = new Map(ranked.map((rec) => [rec.play.id, rec]));

    // 回到空白戰術：保留球員資料與對位，只清掉跑位
    const blank = el(
      'button',
      { type: 'button', class: 'play-item play-item--plain' },
      el('span', { class: 'play-item__name' }, '空白戰術'),
      el('span', { class: 'play-item__text' }, '清掉目前的跑位，回到預設站位自己畫（球員資料和對位會保留）。'),
    );
    blank.addEventListener('click', () => {
      dialog.close();
      store.load(createBlankTactic(store.get().tactic));
      opts.notify('已換成空白戰術，按復原可以回到剛才的戰術');
    });
    body.append(el('ul', { class: 'lib-list lib-list--top' }, el('li', {}, blank)));

    if (!t.autoDefense) {
      body.append(
        el('p', { class: 'lib-note' }, '自動防守跑位已關閉：推薦與預期評等仍依自動防守模擬；載入後，每個分鏡的紅隊位置以模擬結果為起點，可以自己拖曳調整。'),
      );
    }

    if (isBlueComplete(t.players, t.setup.blueSkipped)) {
      const summary = teamSummary(t, ranked);
      const box = el('section', { class: 'lib-summary', 'aria-label': '球隊總評' }, el('h3', { class: 'lib-summary__title' }, '球隊總評'));
      if (summary.strengths.length > 0) {
        // 每人一行：合併同一個人的強項、戰術類型與例子（例子去掉重複，最多 3 套）
        const list = el('ul', { class: 'lib-summary__list' });
        const order = [...new Set(summary.strengths.map((st) => st.playerId))];
        for (const id of order) {
          const mine = summary.strengths.filter((st) => st.playerId === id);
          const labels = mine.map((st) => st.label).join('、');
          const styles = [...new Set(mine.map((st) => st.style))].join('、');
          const examples = [...new Set(mine.flatMap((st) => st.examples))].slice(0, 3).map(playTitle);
          const tail = examples.length ? `，例如 ${examples.join('、')}` : '';
          list.append(el('li', {}, el('strong', {}, nameOf(t.players, id)), `：${labels} → 適合${styles}的戰術${tail}`));
        }
        box.append(list);
      }
      box.append(el('p', { class: 'lib-summary__advice' }, summary.advice));
      body.append(box);

      body.append(el('h3', { class: 'lib-section' }, '推薦給你的球隊'));
      const list = el('ol', { class: 'lib-list' });
      recommend(t, undefined, ranked).forEach((rec, i) => list.append(item(rec, rec.reason, i + 1)));
      body.append(list);
    } else {
      const go = el('button', { type: 'button', class: 'btn' }, '去填身高');
      go.addEventListener('click', () => {
        dialog.close();
        opts.openSetup();
      });
      body.append(el('p', { class: 'lib-note' }, el('span', {}, '藍隊三人都填了身高，就會依能力和對位推薦最適合的 5 套戰術。'), go));
    }

    // 全部戰術，依類別分組；點選時也自動找最佳的角色分配
    for (const category of [...new Set(PLAYS.map((p) => p.category))]) {
      body.append(el('h3', { class: 'lib-section' }, category));
      const list = el('ul', { class: 'lib-list' });
      for (const play of PLAYS.filter((p) => p.category === category)) {
        list.append(item(byPlay.get(play.id) ?? bestAssignment(t, play), play.summary));
      }
      body.append(list);
    }
  };

  // ---- 模擬：每套戰術模擬一次（約 15 ms），逐套進行並顯示進度，畫面不會卡住 ----
  let cache: { key: string; ranked: Recommendation[] } | null = null;
  /** 每次打開加一；關閉或重新打開時，舊的計算就停下來 */
  let run = 0;

  const showLoading = (done: number) => {
    body.replaceChildren(
      el(
        'div',
        { class: 'lib-loading', role: 'status', 'aria-live': 'polite' },
        el('span', { class: 'spinner', 'aria-hidden': 'true' }),
        el('span', {}, `正在模擬戰術 ${done} / ${PLAYS.length}…`),
      ),
    );
  };

  const computeAndRender = async () => {
    const id = ++run;
    const t = store.get().tactic;
    const key = recommendationKey(t);
    if (cache?.key !== key) {
      const results: Recommendation[] = [];
      for (const play of PLAYS) {
        showLoading(results.length);
        // 讓瀏覽器先畫出進度，再算下一套
        await new Promise((resolve) => setTimeout(resolve, 0));
        if (id !== run || !dialog.open) return;
        results.push(withSimulation(t, bestAssignment(t, play)));
      }
      cache = { key, ranked: sortBySimulation(results) };
    }
    if (id !== run || !dialog.open) return;
    render(cache.ranked);
    body.scrollTop = 0;
  };

  dialog.addEventListener('close', () => {
    run++; // 關閉時停止還在進行的計算
  });

  $<HTMLButtonElement>('#library-close').addEventListener('click', () => dialog.close());
  // 點背景關閉
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) dialog.close();
  });

  return {
    open() {
      if (store.get().playing || store.get().readonly) return;
      dialog.showModal();
      void computeAndRender();
    },
  };
}
