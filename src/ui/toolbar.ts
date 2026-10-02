import type { Store, Tool } from '../model/store';
import { PATH_KIND_LABEL } from '../model/paths';
import { bindMenu } from './menu';

const TOOL_LABEL: Record<Tool, string> = { move: '移動', ...PATH_KIND_LABEL };

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

/** 接上下方編輯工具列：復原、重做、工具選單（含手繪切換）、刪除，以及鍵盤快捷鍵 */
export function attachToolbar(store: Store): void {
  const undo = $<HTMLButtonElement>('#undo');
  const redo = $<HTMLButtonElement>('#redo');
  const del = $<HTMLButtonElement>('#delete');
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

  undo.addEventListener('click', () => store.undo());
  redo.addEventListener('click', () => store.redo());
  del.addEventListener('click', deleteSelected);

  // ---- 工具選單 ----
  const menuCtl = bindMenu(toolBtn, menu, () =>
    toolItems.find((i) => i.dataset.tool === store.get().tool)?.focus(),
  );
  const closeMenu = menuCtl.close;

  for (const item of toolItems) {
    item.addEventListener('click', () => {
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
    if (document.body.dataset.screen !== 'board' || store.get().playing || document.querySelector('dialog[open]')) return;
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
          s.tool = 'move';
        });
      }
    } else if (!mod && key === 'f') {
      store.update((s) => {
        s.freehand = !s.freehand;
      });
    } else if (!mod && shortcuts[key]) {
      const tool = shortcuts[key]!;
      store.update((s) => {
        s.tool = tool;
      });
    }
  });

  // ---- 依狀態更新按鈕 ----
  const sync = () => {
    const s = store.get();
    undo.disabled = s.playing || !store.canUndo;
    redo.disabled = s.playing || !store.canRedo;
    del.disabled = s.playing || !s.selectedPathId;
    toolBtn.disabled = s.playing;
    toolIcon.setAttribute('href', `#icon-${s.tool}`);
    toolBtn.setAttribute('aria-label', `工具：${TOOL_LABEL[s.tool]}${s.freehand ? '（手繪）' : ''}`);
    toolBtn.title = `工具：${TOOL_LABEL[s.tool]}`;
    badge.hidden = !s.freehand;
    for (const item of toolItems) item.setAttribute('aria-checked', String(item.dataset.tool === s.tool));
    freehandItem.setAttribute('aria-checked', String(s.freehand));
  };
  store.subscribe(sync);
  sync();
}
