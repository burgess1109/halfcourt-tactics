import { LANG_TAG, getLocale, t } from '../i18n';
import { setTip } from './tooltip';

// index.html 裡的固定文字：用屬性標出文字表的位置（「區塊.名稱」，例如 data-i18n="home.offense"），
// 啟動與切換語系時由 applyStaticText 填入。
//   data-i18n       → 文字內容
//   data-i18n-tip   → 按鈕提示（data-tip）
//   data-i18n-aria  → aria-label
// 會隨狀態改變的文字（例如播放 ↔ 停止）由各自的模組更新，不用這些屬性。

export const I18N_ATTRS = { text: 'data-i18n', tip: 'data-i18n-tip', aria: 'data-i18n-aria' } as const;

/** 依「區塊.名稱」取出文字表裡的字串；找不到或不是字串時回傳 null */
export function lookup(table: unknown, key: string): string | null {
  let v: unknown = table;
  for (const part of key.split('.')) {
    if (typeof v !== 'object' || v === null) return null;
    v = (v as Record<string, unknown>)[part];
  }
  return typeof v === 'string' ? v : null;
}

export function applyStaticText(root: ParentNode = document): void {
  const table = t();
  const get = (key: string) => {
    const text = lookup(table, key);
    if (text === null) throw new Error(`文字表沒有 ${key}`);
    return text;
  };
  for (const el of root.querySelectorAll<HTMLElement>(`[${I18N_ATTRS.text}]`)) el.textContent = get(el.getAttribute(I18N_ATTRS.text)!);
  for (const el of root.querySelectorAll<HTMLElement>(`[${I18N_ATTRS.tip}]`)) setTip(el, get(el.getAttribute(I18N_ATTRS.tip)!));
  for (const el of root.querySelectorAll<HTMLElement>(`[${I18N_ATTRS.aria}]`)) el.setAttribute('aria-label', get(el.getAttribute(I18N_ATTRS.aria)!));
  document.documentElement.lang = LANG_TAG[getLocale()];
  document.title = table.app.title;
}
