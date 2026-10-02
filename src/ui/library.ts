import { isBlueComplete } from '../model/playerForm';
import type { Store } from '../model/store';
import type { Player } from '../model/types';
import { loadPlay, type RoleAssignment } from '../plays/instantiate';
import { PLAYS, ROLES, type Play } from '../plays/library';
import { bestAssignment, recommend } from '../plays/recommend';

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
  const title = $<HTMLElement>('#board-title');

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

  const item = (play: Play, roles: RoleAssignment, text: string, rank?: number) => {
    const current = store.get().tactic.basedOn?.playId === play.id;
    const button = el(
      'button',
      { type: 'button', class: `play-item${rank ? '' : ' play-item--plain'}`, 'aria-current': String(current) },
      ...(rank ? [el('span', { class: 'play-item__rank' }, String(rank))] : []),
      el('span', { class: 'play-item__name' }, el('span', { class: 'play-item__cat' }, play.category), play.name),
      el('span', { class: 'play-item__text' }, text),
      el('span', { class: 'play-item__roles' }, rolesText(play, roles)),
    );
    button.addEventListener('click', () => choose(play, roles));
    return el('li', {}, button);
  };

  const render = () => {
    const t = store.get().tactic;
    body.replaceChildren();

    if (isBlueComplete(t.players, t.setup.blueSkipped)) {
      body.append(el('h3', { class: 'lib-section' }, '推薦給你的球隊'));
      const list = el('ol', { class: 'lib-list' });
      recommend(t).forEach((r, i) => list.append(item(r.play, r.roles, r.reason, i + 1)));
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
        list.append(item(play, bestAssignment(t, play).roles, play.summary));
      }
      body.append(list);
    }
  };

  $<HTMLButtonElement>('#library-close').addEventListener('click', () => dialog.close());
  // 點背景關閉
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) dialog.close();
  });

  // 球場上方顯示目前的戰術名稱
  const syncTitle = () => {
    const based = store.get().tactic.basedOn;
    const play = based && PLAYS.find((p) => p.id === based.playId);
    title.hidden = !play;
    if (play) title.textContent = based.modified ? `根據「${playTitle(play)}」修改` : playTitle(play);
  };
  store.subscribe(syncTitle);
  syncTitle();

  return {
    open() {
      if (store.get().playing) return;
      render();
      dialog.showModal();
      body.scrollTop = 0;
    },
  };
}
