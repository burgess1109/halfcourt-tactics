import type { Store, Tool } from '../model/store';
import { PATH_KIND_LABEL } from '../model/paths';
import { createBlankTactic } from '../model/defaults';
import { isBlankTactic } from '../model/lineup';
import { bindMenu } from './menu';
import { setTip } from './tooltip';

const TOOL_LABEL: Record<Tool, string> = { move: '移動', ...PATH_KIND_LABEL };

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

/** 接上下方編輯工具列：復原、重做、工具選單（含手繪切換）、刪除，以及鍵盤快捷鍵 */
export function attachToolbar(store: Store, notify: (message: string) => void): void {
  const undo = $<HTMLButtonElement>('#undo');
  const redo = $<HTMLButtonElement>('#redo');
  const del = $<HTMLButtonElement>('#delete');
  const clear = $<HTMLButtonElement>('#clear');
  const toolBtn = $<HTMLButtonElement>('#tool');
  const toolIcon = toolBtn.querySelector('use')!;
  const badge = toolBtn.querySelector<HTMLElement>('.tool__badge')!;
  const menu = $<HTMLElement>('#tool-menu');
  const toolItems = [...menu.querySelectorAll<HTMLButtonElement>('[data-tool]')];
  const freehandItem = menu.querySelector<HTMLButtonElement>('[data-freehand]')!;

  const deleteSelected = () => {
    const { selectedPathId } = store.get();
    if (!selectedPathId) return;
    store.commit((s) => {
      const f = s.tactic.frames[s.frameIndex]!;
      f.paths = f.paths.filter((p) => p.id !== selectedPathId);
      s.selectedPathId = null;
    });
  };

  // 清空戰術：跟戰術庫的「空白戰術」相同，回到開局站位，球員資料與對位保留
  clear.addEventListener('click', () => {
    store.load(createBlankTactic(store.get().tactic));
    notify('已清空戰術，按復原可以回到剛才的戰術');
  });

  undo.addEventListener('click', () => store.undo());
  redo.addEventListener('click', () => store.redo());
  del.addEventListener('click', deleteSelected);

  // ---- 工具選單 ----
  const menuCtl = bindMenu(toolBtn, menu, () =>
    toolItems.find((i) => i.dataset.tool === store.get().tool)?.focus(),
  );
  const closeMenu = menuCtl.close;

  const MOVE_LOCKED = '只有第 1 個分鏡可以移動站位；之後的站位由上一個分鏡的路線決定';
  for (const item of toolItems) {
    item.addEventListener('click', () => {
      if (item.disabled) return;
      store.update((s) => {
        s.tool = item.dataset.tool as Tool;
      });
      closeMenu();
    });
  }
  // 手繪切換不關閉選單，方便接著選路線種類
  freehandItem.addEventListener('click', () => {
    store.update((s) => {
      s.freehand = !s.freehand;
    });
  });
  // ---- 鍵盤 ----
  const shortcuts: Record<string, Tool> = { v: 'move', '1': 'cut', '2': 'dribble', '3': 'pass', '4': 'screen', '5': 'shot' };
  document.addEventListener('keydown', (e) => {
    const { playing, readonly } = store.get();
    if (document.body.dataset.screen !== 'board' || playing || readonly || document.querySelector('dialog[open]')) return;
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    const mod = e.metaKey || e.ctrlKey;
    const key = e.key.toLowerCase();
    if (mod && key === 'z') {
      e.preventDefault();
      if (e.shiftKey) store.redo();
      else store.undo();
    } else if (mod && key === 'y') {
      e.preventDefault();
      store.redo();
    } else if (!mod && (e.key === 'Delete' || e.key === 'Backspace')) {
      e.preventDefault();
      deleteSelected();
    } else if (e.key === 'Escape') {
      if (!menu.hidden) {
        closeMenu();
        toolBtn.focus();
      } else {
        store.update((s) => {
          s.selectedPathId = null;
          if (s.frameIndex === 0) s.tool = 'move';
        });
      }
    } else if (!mod && key === 'f') {
      store.update((s) => {
        s.freehand = !s.freehand;
      });
    } else if (!mod && shortcuts[key]) {
      const tool = shortcuts[key]!;
      if (tool === 'move' && store.get().frameIndex > 0) {
        notify(MOVE_LOCKED);
        return;
      }
      store.update((s) => {
        s.tool = tool;
      });
    }
  });

  // ---- 依狀態更新按鈕 ----
  const sync = () => {
    const s = store.get();
    const locked = s.playing || s.readonly;
    undo.disabled = locked || !store.canUndo;
    redo.disabled = locked || !store.canRedo;
    del.disabled = locked || !s.selectedPathId;
    // 已經是空白戰術（開局站位、沒有路線、不是內建戰術）時不需要清空
    clear.disabled = locked || isBlankTactic(s.tactic);
    toolBtn.disabled = locked;
    if (locked) closeMenu();
    toolIcon.setAttribute('href', `#icon-${s.tool}`);
    toolBtn.setAttribute('aria-label', `工具：${TOOL_LABEL[s.tool]}${s.freehand ? '（手繪）' : ''}`);
    setTip(toolBtn, `工具：${TOOL_LABEL[s.tool]}${s.freehand ? '（手繪）' : ''}，點開切換（V、1–5、F）`);
    badge.hidden = !s.freehand;
    for (const item of toolItems) {
      item.setAttribute('aria-checked', String(item.dataset.tool === s.tool));
      // 「移動」只在第 1 個分鏡可以用
      if (item.dataset.tool === 'move') {
        item.disabled = s.frameIndex > 0;
        if (item.disabled) item.dataset.tip = MOVE_LOCKED;
        else delete item.dataset.tip;
      }
    }
    freehandItem.setAttribute('aria-checked', String(s.freehand));
  };
  store.subscribe(sync);
  sync();
}
