import { LOCALES, getLocale, onLocaleChange, setLocale, type Locale } from '../i18n';
import { bindMenu } from './menu';

// 語系選單（SPEC §10.3）：首頁的「語系 / Language」按鈕與戰術面板的「設定」共用同一個選單。
// 選過的語系記在 localStorage；沒有選過時依瀏覽器語言（i18n 的 detectLocale）。

export const LOCALE_STORAGE_KEY = 'halfcourt-locale';

/** 讀取使用者選過的語系（localStorage 被停用時當作沒有選過） */
export function storedLocale(): string | null {
  try {
    return localStorage.getItem(LOCALE_STORAGE_KEY);
  } catch {
    return null;
  }
}

function storeLocale(locale: Locale): void {
  try {
    localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // 不能儲存時只在這次開啟有效
  }
}

export function attachLanguageMenu(anchors: readonly HTMLElement[]): void {
  const menu = document.querySelector<HTMLElement>('#lang-menu')!;
  const items = [...menu.querySelectorAll<HTMLButtonElement>('[data-locale]')];
  const controls = anchors.map((anchor) =>
    bindMenu(anchor, menu, () => items.find((i) => i.dataset.locale === getLocale())?.focus()),
  );
  const close = () => controls.forEach((c) => c.close());

  for (const item of items) {
    item.addEventListener('click', () => {
      const locale = item.dataset.locale as Locale;
      if (!LOCALES.includes(locale)) return;
      storeLocale(locale);
      close();
      setLocale(locale);
    });
  }
  menu.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const anchor = anchors.find((a) => a.getAttribute('aria-expanded') === 'true');
    close();
    anchor?.focus();
  });

  const sync = () => {
    for (const item of items) item.setAttribute('aria-checked', String(item.dataset.locale === getLocale()));
  };
  onLocaleChange(sync);
  sync();
}
