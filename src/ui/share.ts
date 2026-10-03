import { SHARE_PREFIX, TacticFormatError, decodeShare, encodeShare, jsonFileName, toJsonFile } from '../model/serialize';
import type { Store } from '../model/store';
import type { Tactic } from '../model/types';
import { downloadText } from './saved';
import { setTip } from './tooltip';

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

export type Screen = 'home' | 'setup' | 'board';

export interface ShareUi {
  /** 網址帶有分享連結時進入唯讀預覽；回傳是否進入 */
  openFromHash: () => Promise<boolean>;
  /** 唯讀預覽已經結束（另存、開啟其他戰術） */
  previewEnded: () => void;
}

/** 目前網址不含 hash 的部分 */
const baseUrl = () => location.origin + location.pathname + location.search;

function clearHash(): void {
  if (location.hash) history.replaceState(null, '', baseUrl());
}

/**
 * 分享（SPEC §8）：產生分享連結、下載 JSON 檔；開啟分享連結時進入唯讀預覽，
 * 按「另存」才寫入戰術列表，按「關閉」回到原本的畫面與戰術。
 */
export function attachShare(
  store: Store,
  opts: {
    notify: (message: string) => void;
    save: () => Promise<boolean>;
    show: (screen: Screen) => void;
    screen: () => Screen;
  },
): ShareUi {
  const { notify } = opts;
  const dialog = $<HTMLDialogElement>('#share-dialog');
  const urlInput = $<HTMLInputElement>('#share-url');
  const copyBtn = $<HTMLButtonElement>('#share-copy');
  const nativeBtn = $<HTMLButtonElement>('#share-native');
  const shareBtn = $<HTMLButtonElement>('#share');
  const saveBtn = $<HTMLButtonElement>('#save');
  const bar = $<HTMLElement>('#preview-bar');
  const barName = $<HTMLElement>('#preview-name');
  const barSave = $<HTMLButtonElement>('#preview-save');
  const barClose = $<HTMLButtonElement>('#preview-close');

  // ---- 分享對話框 ----
  nativeBtn.hidden = typeof navigator.share !== 'function';

  shareBtn.addEventListener('click', async () => {
    if (store.get().playing) return;
    urlInput.value = baseUrl() + (await encodeShare(store.get().tactic));
    dialog.showModal();
    copyBtn.focus();
  });

  copyBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(urlInput.value);
      notify('已複製分享連結');
    } catch {
      // 沒有剪貼簿權限（例如用 http 區網 IP 測試）：選取文字讓使用者自己複製
      urlInput.focus();
      urlInput.select();
      notify('請手動複製選取的連結');
    }
  });

  nativeBtn.addEventListener('click', async () => {
    const name = store.get().tactic.name;
    try {
      await navigator.share({ title: name ? `半場戰術：${name}` : '半場戰術', url: urlInput.value });
    } catch {
      // 使用者取消分享
    }
  });

  $<HTMLButtonElement>('#share-json').addEventListener('click', () => {
    const t = store.get().tactic;
    downloadText(jsonFileName(t), toJsonFile(t));
  });

  $<HTMLButtonElement>('#share-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) dialog.close();
  });

  // ---- 唯讀預覽 ----
  /** 進入預覽之前的戰術與畫面，按「關閉」時還原 */
  let before: { tactic: Tactic; screen: Screen } | null = null;

  const openFromHash = async (): Promise<boolean> => {
    if (!location.hash.startsWith(SHARE_PREFIX)) return false;
    try {
      const { tactic, removed } = await decodeShare(location.hash);
      const s = store.get();
      if (s.playing) return false;
      // 連續開兩個分享連結時，保留最早的狀態
      if (!before) before = { tactic: s.tactic, screen: opts.screen() };
      for (const d of document.querySelectorAll('dialog')) if (d.open) d.close();
      store.reset(tactic, true);
      opts.show('board');
      notify(removed > 0 ? `分享的戰術有 ${removed} 條路線不成立，已移除` : '這是分享的戰術，按「另存」可以存到你的戰術列表');
      return true;
    } catch (e) {
      clearHash();
      notify(e instanceof TacticFormatError ? e.message : '無法開啟分享連結');
      return false;
    }
  };

  const previewEnded = () => {
    before = null;
    clearHash();
  };

  barSave.addEventListener('click', () => void opts.save());
  barClose.addEventListener('click', () => {
    const back = before;
    previewEnded();
    store.reset(back?.tactic ?? store.get().tactic);
    opts.show(back?.screen ?? 'board');
  });

  addEventListener('hashchange', () => void openFromHash());

  const sync = () => {
    const s = store.get();
    bar.hidden = !s.readonly;
    barName.textContent = s.tactic.name || '未命名戰術';
    barSave.disabled = s.playing;
    barClose.disabled = s.playing;
    // 預覽中不能改球員與戰術，存檔變成「另存」
    $<HTMLButtonElement>('#library').disabled = s.readonly;
    $<HTMLButtonElement>('#team').disabled = s.readonly;
    setTip(saveBtn, s.readonly ? '另存到我的戰術列表' : '存檔（⌘S / Ctrl+S）');
    saveBtn.setAttribute('aria-label', s.readonly ? '另存' : '存檔');
  };
  store.subscribe(sync);
  sync();

  return { openFromHash, previewEnded };
}
