import { isBlueComplete } from '../model/playerForm';
import type { Store } from '../model/store';
import { loadPlay, type RoleAssignment } from '../plays/instantiate';
import { PLAYS, ROLES, basePlay, type Play } from '../plays/library';
import { createBlankTactic } from '../model/defaults';
import {
  bestAssignment,
  recommend,
  recommendationKey,
  sortBySimulation,
  teamSummary,
  withBestShot,
  type Recommendation,
} from '../plays/recommend';
import { videosOf } from '../plays/videos';
import { videoLinks } from './videos';
import { t as tx, tr } from '../i18n';
import { adviceText, edgeText, playTitle, playerName, reasonText, shotSuffix, styleText } from '../i18n/describe';

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

  const rolesText = (play: Play, roles: RoleAssignment) =>
    ROLES.map((r) => tx().library.role(r, tr(play.roles[r]), playerName(store.get().tactic.players, roles[r]))).join(tx().library.roleSep);

  const choose = (play: Play, roles: RoleAssignment) => {
    dialog.close();
    store.load(loadPlay(store.get().tactic, play, roles));
    opts.notify(tx().library.loaded(playTitle(play)));
    opts.onLoaded();
  };

  /** text：說明文字（推薦清單用推薦理由、全部清單用戰術簡介），切換出手點時跟著換 */
  /** 目前戰術載入的出手點；舊存檔沒有記錄時，改版前載入的一定是原本的出手點 */
  const loadedShot = (playId: string) => {
    const based = store.get().tactic.basedOn;
    return based?.playId === playId ? (based.shot ?? basePlay(playId)?.shot) : undefined;
  };

  const item = (rec: Recommendation, textOf: (r: Recommendation) => string, rank?: number): HTMLLIElement => {
    const { play, roles } = rec;
    const text = textOf(rec);
    // 卡片代表整套戰術：同一套就是目前的戰術（不管顯示的是哪個出手點）
    const current = store.get().tactic.basedOn?.playId === play.id;
    const expected = rec.grade
      ? [el('span', { class: 'play-item__grade', 'data-grade': rec.grade }, tx().library.expected(rec.grade, Math.round(rec.gradeScore!)))]
      : [];
    const button = el(
      'button',
      { type: 'button', class: `play-item${rank ? '' : ' play-item--plain'}`, 'aria-current': String(current) },
      ...(rank ? [el('span', { class: 'play-item__rank' }, String(rank))] : []),
      el(
        'span',
        { class: 'play-item__name' },
        el('span', { class: 'play-item__cat' }, tx().library.category[play.category]),
        play.name,
        ...(play.shot ? [el('span', { class: 'play-item__shot' }, shotSuffix(play))] : []),
        ...expected,
      ),
      el('span', { class: 'play-item__text' }, text),
      el('span', { class: 'play-item__roles' }, rolesText(play, roles)),
    );
    button.addEventListener('click', () => choose(play, roles));
    // 卡片、出手點、影片一起框成一張卡片，和下一套戰術明顯分開
    const li = el('li', { class: 'play-card' }, button);
    // 有多個出手點的戰術：切換出手點（預設是模擬分數比較高的那一個）
    if (rec.alternatives) {
      const shots = el('div', { class: 'play-item__shots', role: 'group', 'aria-label': tx().library.shots });
      for (const alt of rec.alternatives) {
        const b = el(
          'button',
          { type: 'button', class: 'play-item__shot-btn', 'aria-pressed': String(alt.play.shot === play.shot) },
          tx().library.shotOption(tx().shot[alt.play.shot!], alt.grade ?? null, Math.round(alt.gradeScore ?? 0)),
        );
        b.addEventListener('click', () => li.replaceWith(item({ ...alt, alternatives: rec.alternatives }, textOf, rank)));
        shots.append(b);
      }
      li.append(shots);
    }
    const videos = videosOf(play.id);
    if (videos.length) li.append(videoLinks(videos, 'play-item__videos'));
    return li;
  };

  /** 目前戰術用的就是這套戰術時，卡片預設顯示載入的那個出手點（不是分數比較高的那個） */
  const showLoaded = (rec: Recommendation): Recommendation => {
    const shot = loadedShot(rec.play.id);
    const alt = shot && rec.alternatives?.find((a) => a.play.shot === shot);
    return alt ? { ...alt, alternatives: rec.alternatives } : rec;
  };

  const render = (ranked: readonly Recommendation[]) => {
    const t = store.get().tactic;
    body.replaceChildren();
    const byPlay = new Map(ranked.map((rec) => [rec.play.id, rec]));

    // 回到空白戰術：保留球員資料與對位，只清掉跑位
    const blank = el(
      'button',
      { type: 'button', class: 'play-item play-item--plain' },
      el('span', { class: 'play-item__name' }, tx().library.blank),
      el('span', { class: 'play-item__text' }, tx().library.blankDesc),
    );
    blank.addEventListener('click', () => {
      dialog.close();
      store.load(createBlankTactic(store.get().tactic));
      opts.notify(tx().library.blankLoaded);
    });
    body.append(el('ul', { class: 'lib-list lib-list--top' }, el('li', { class: 'play-card' }, blank)));

    if (!t.autoDefense) {
      body.append(
        el('p', { class: 'lib-note' }, tx().library.manualDefense),
      );
    }

    if (isBlueComplete(t.players, t.setup.blueSkipped)) {
      const summary = teamSummary(t, ranked);
      const box = el('section', { class: 'lib-summary', 'aria-label': tx().library.summary }, el('h3', { class: 'lib-summary__title' }, tx().library.summary));
      if (summary.strengths.length > 0) {
        // 每人一行：合併同一個人的強項、戰術類型與例子（例子去掉重複，最多 3 套）
        const list = el('ul', { class: 'lib-summary__list' });
        const order = [...new Set(summary.strengths.map((st) => st.playerId))];
        for (const id of order) {
          const mine = summary.strengths.filter((st) => st.playerId === id);
          const sep = tx().common.listSep;
          const labels = mine.map((st) => edgeText(st.edge)).join(sep);
          const styles = [...new Set(mine.map(styleText))].join(sep);
          // 例子去掉重複：同一套戰術只列一次（不同強項可能各自用到同一套的不同出手點）
          const examples = mine
            .flatMap((st) => st.examples)
            .filter((p, i, all) => all.findIndex((q) => q.id === p.id) === i)
            .slice(0, 3)
            .map((p) => playTitle(p));
          const line = tx().library.summaryLine(labels, styles, examples.length ? examples.join(sep) : null);
          list.append(el('li', {}, el('strong', {}, playerName(t.players, id)), line));
        }
        box.append(list);
      }
      box.append(el('p', { class: 'lib-summary__advice' }, adviceText(summary.advice, t)));
      body.append(box);

      body.append(el('h3', { class: 'lib-section' }, tx().library.recommended));
      const list = el('ol', { class: 'lib-list' });
      recommend(t, undefined, ranked).forEach((rec, i) => list.append(item(showLoaded(rec), (r) => reasonText(r.reason, r.play, t.players), i + 1)));
      body.append(list);
    } else {
      const go = el('button', { type: 'button', class: 'btn' }, tx().library.goHeights);
      go.addEventListener('click', () => {
        dialog.close();
        opts.openSetup();
      });
      body.append(el('p', { class: 'lib-note' }, el('span', {}, tx().library.needHeights), go));
    }

    // 全部戰術，依類別分組；點選時也自動找最佳的角色分配
    for (const category of [...new Set(PLAYS.map((p) => p.category))]) {
      body.append(el('h3', { class: 'lib-section' }, tx().library.category[category]));
      const list = el('ul', { class: 'lib-list' });
      for (const play of PLAYS.filter((p) => p.category === category)) {
        list.append(item(showLoaded(byPlay.get(play.id) ?? bestAssignment(t, play)), (r) => tr(r.play.summary)));
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
        el('span', {}, tx().library.loading(done, PLAYS.length)),
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
        results.push(withBestShot(t, play));
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
