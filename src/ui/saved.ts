import { newId } from '../model/id';
import { SaveError, type SavedSummary, type SavedTactics } from '../model/savedTactics';
import { TacticFormatError, fromJsonFile, jsonFileName, nameError, toJsonFile } from '../model/serialize';
import type { Store } from '../model/store';
import type { ShotZone, Tactic } from '../model/types';
import { basePlay, playVariant } from '../plays/library';
import { playTitle } from './library';

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

/** 下載文字檔（JSON 匯出） */
export function downloadText(filename: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = el('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const timeText = (ts: number) =>
  new Date(ts).toLocaleString('zh-TW', { year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });

/** 內建戰術的名稱，有多個出手點的戰術含出手點（找不到時回傳 null） */
const basedTitle = (playId: string | undefined, shot?: ShotZone) => {
  const play = playId ? basePlay(playId) : undefined;
  return play ? playTitle(playVariant(play, shot)) : null;
};

export interface SavedUi {
  /** 存檔；沒有名稱（或唯讀預覽的另存）時先要求輸入名稱。存好回傳 true */
  save: () => Promise<boolean>;
  open: () => void;
}

/**
 * 存檔與戰術列表（SPEC §8）：存檔、開啟、重新命名、複製、刪除、JSON 匯入匯出，
 * 以及球場上方的戰術名稱（存檔後又改過會標示「未存檔」）。
 */
export function attachSaved(
  store: Store,
  saved: SavedTactics,
  opts: {
    notify: (message: string) => void;
    askName: (o: { title: string; initial: string; confirm: string }) => Promise<string | null>;
    /** 唯讀預覽另存成功、或開啟其他戰術而結束預覽時 */
    onPreviewEnded: () => void;
    /** 從列表開啟了一份戰術（例如從首頁打開列表時，要切到戰術面板） */
    onOpened: () => void;
  },
): SavedUi {
  const dialog = $<HTMLDialogElement>('#saved-dialog');
  const body = $<HTMLElement>('#saved-body');
  const file = $<HTMLInputElement>('#saved-file');
  const title = $<HTMLElement>('#board-title');
  const { notify } = opts;

  const write = (fn: () => void): boolean => {
    try {
      fn();
      return true;
    } catch (e) {
      notify(e instanceof SaveError ? e.message : '存檔失敗');
      return false;
    }
  };

  // ---- 存檔 ----
  const save = async (): Promise<boolean> => {
    const s = store.get();
    if (s.playing) return false;
    const t = s.tactic;
    let name = t.name;
    if (!name || s.readonly) {
      const suggestion = name || (t.basedOn && !t.basedOn.modified ? basedTitle(t.basedOn.playId, t.basedOn.shot) : null) || '';
      const asked = await opts.askName({
        title: s.readonly ? '另存到我的戰術列表' : '存檔',
        initial: suggestion,
        confirm: '存檔',
      });
      if (!asked) return false;
      name = asked;
    }
    // 名稱不算戰術內容的修改：不寫入復原紀錄，也不清掉評分
    const copy: Tactic = { ...structuredClone(store.get().tactic), name };
    if (!write(() => saved.save(copy))) return false;
    if (store.get().readonly) {
      store.reset(copy);
      opts.onPreviewEnded();
    } else {
      store.renameTactic(copy.id, name);
    }
    notify(`已存檔「${name}」`);
    render();
    return true;
  };

  // 播放後的評分：戰術存檔後沒有再改過時，評分一起更新到已存的版本（列表才看得到最新評等）
  store.subscribe((s) => {
    const t = s.tactic;
    if (s.readonly || !t.name || saved.savedUpdatedAt(t.id) !== t.updatedAt) return;
    if (JSON.stringify(saved.savedResult(t.id)) === JSON.stringify(t.lastResult)) return;
    try {
      saved.save(t);
    } catch {
      // 只是同步評分，失敗不影響使用
    }
  });

  // ---- 球場上方的戰術名稱 ----
  const syncTitle = () => {
    const s = store.get();
    const t = s.tactic;
    let text = '';
    if (!s.readonly) {
      if (t.name) {
        const dirty = saved.savedUpdatedAt(t.id) !== t.updatedAt;
        text = dirty ? `${t.name}・未存檔` : t.name;
      } else if (t.basedOn) {
        const based = basedTitle(t.basedOn.playId, t.basedOn.shot);
        if (based) text = t.basedOn.modified ? `根據「${based}」修改` : based;
      }
    }
    title.hidden = !text;
    title.textContent = text;
  };
  store.subscribe(syncTitle);
  syncTitle();

  // ---- 戰術列表 ----
  /** 等待第二次點擊確認刪除的項目 */
  let confirmDelete: string | null = null;
  /** 正在重新命名的項目 */
  let renaming: string | null = null;

  const openTactic = (id: string) => {
    const t = saved.get(id);
    if (!t) return;
    const wasPreview = store.get().readonly;
    dialog.close();
    const undoable = store.load(t);
    if (wasPreview) opts.onPreviewEnded();
    opts.onOpened();
    notify(undoable ? `已開啟「${t.name}」，按復原可以回到剛才的戰術` : `已開啟「${t.name}」`);
  };

  const renameRow = (item: SavedSummary) => {
    const input = el('input', { type: 'text', maxlength: '30', 'aria-label': '新名稱', enterkeyhint: 'done' });
    input.value = item.name;
    const ok = el('button', { type: 'button', class: 'btn btn--primary btn--small' }, '確定');
    const cancel = el('button', { type: 'button', class: 'btn btn--small' }, '取消');
    const commit = () => {
      const message = nameError(input.value);
      if (message) {
        notify(message);
        input.focus();
        return;
      }
      const name = input.value.trim();
      if (!write(() => saved.rename(item.id, name))) return;
      // 目前開著（或在復原紀錄裡）的就是這份戰術：名稱一起改（不算修改內容）
      store.renameTactic(item.id, name);
      renaming = null;
      render();
    };
    ok.addEventListener('click', commit);
    cancel.addEventListener('click', () => {
      renaming = null;
      render();
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') commit();
      else if (e.key === 'Escape') {
        e.preventDefault(); // 不要關閉整個對話框
        renaming = null;
        render();
      }
    });
    queueMicrotask(() => input.select());
    return el('div', { class: 'saved-item__rename' }, input, ok, cancel);
  };

  const row = (item: SavedSummary) => {
    const current = store.get().tactic.id === item.id && !store.get().readonly;
    const based = basedTitle(item.playId, item.shot);
    const meta = [timeText(item.updatedAt), based && `根據「${based}」`].filter(Boolean).join('・');
    const grade = item.grade
      ? [el('span', { class: 'play-item__grade', 'data-grade': item.grade }, `${item.grade} ${Math.round(item.score!)} 分`)]
      : [];

    const head =
      renaming === item.id
        ? renameRow(item)
        : (() => {
            const b = el(
              'button',
              { type: 'button', class: 'saved-item__open', 'aria-label': `開啟「${item.name}」` },
              el('span', { class: 'saved-item__name' }, item.name, ...grade),
              el('span', { class: 'saved-item__meta' }, current ? `目前開啟中・${meta}` : meta),
            );
            b.addEventListener('click', () => openTactic(item.id));
            return b;
          })();

    const action = (label: string, fn: () => void, cls = '') => {
      const b = el('button', { type: 'button', class: `btn btn--small ${cls}`.trim() }, label);
      b.addEventListener('click', fn);
      return b;
    };
    const actions = el(
      'div',
      { class: 'saved-item__actions' },
      action('重新命名', () => {
        renaming = item.id;
        confirmDelete = null;
        render();
      }),
      action('複製', () => {
        const names: string[] = [];
        if (write(() => names.push(saved.duplicate(item.id)?.name ?? ''))) {
          notify(`已複製成「${names[0]}」`);
          render();
        }
      }),
      action('匯出 JSON', () => {
        const t = saved.get(item.id);
        if (t) downloadText(jsonFileName(t), toJsonFile(t));
      }),
      confirmDelete === item.id
        ? action(
            '確定刪除？',
            () => {
              confirmDelete = null;
              if (write(() => saved.remove(item.id))) notify(`已刪除「${item.name}」`);
              render();
            },
            'btn--danger',
          )
        : action('刪除', () => {
            confirmDelete = item.id;
            renaming = null;
            render();
          }),
    );
    return el('li', { class: 'saved-item', 'aria-current': String(current) }, head, actions);
  };

  const render = () => {
    if (!dialog.open) return;
    const items = saved.list();
    if (items.length === 0) {
      body.replaceChildren(
        el('p', { class: 'saved-empty' }, '還沒有存檔的戰術。按上方工具列的「存檔」，戰術就會出現在這裡；也可以匯入 JSON 檔。'),
      );
      return;
    }
    body.replaceChildren(el('ul', { class: 'lib-list saved-list' }, ...items.map(row)));
  };

  // ---- 匯入 ----
  $<HTMLButtonElement>('#saved-import').addEventListener('click', () => file.click());
  file.addEventListener('change', async () => {
    const f = file.files?.[0];
    file.value = ''; // 同一個檔案可以再選一次
    if (!f) return;
    try {
      const { tactic, removed } = fromJsonFile(await f.text());
      // 不覆蓋已存的戰術：id 重複就當成新的一份
      if (saved.has(tactic.id)) tactic.id = newId();
      if (!tactic.name) tactic.name = f.name.replace(/\.json$/i, '').slice(0, 30).trim() || '匯入的戰術';
      if (!write(() => saved.save(tactic))) return;
      notify(removed > 0 ? `已匯入「${tactic.name}」，移除了 ${removed} 條不成立的路線` : `已匯入「${tactic.name}」`);
      render();
    } catch (e) {
      notify(e instanceof TacticFormatError ? e.message : '無法讀取這個檔案');
    }
  });

  $<HTMLButtonElement>('#saved-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) dialog.close();
  });
  dialog.addEventListener('close', () => {
    confirmDelete = null;
    renaming = null;
  });

  // 其他分頁改了戰術列表
  addEventListener('storage', () => {
    saved.reload();
    render();
    syncTitle();
  });

  // ⌘S / Ctrl+S 存檔
  document.addEventListener('keydown', (e) => {
    if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 's') return;
    if (document.body.dataset.screen !== 'board' || document.querySelector('dialog[open]')) return;
    e.preventDefault();
    void save();
  });

  return {
    save,
    open() {
      if (store.get().playing) return;
      dialog.showModal();
      render();
      if (saved.skipped > 0) notify(`有 ${saved.skipped} 筆存檔損壞，無法讀取`);
    },
  };
}
