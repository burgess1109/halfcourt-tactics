import { en } from './en';
import { zh, type Messages } from './zh';

// 介面語系（SPEC §10.3）：繁體中文、英文兩份文字表，介面文字一律從 t() 取。
// 純模組、不碰 DOM；目前的語系由 main.ts 啟動時決定（detectLocale + setLocale），測試與 plays-doc 維持預設的繁體中文。

export type Locale = 'zh' | 'en';
export const LOCALES: readonly Locale[] = ['zh', 'en'];

/** `<html lang>` 等標準語言標籤 */
export const LANG_TAG: Record<Locale, string> = { zh: 'zh-Hant', en: 'en' };

/** 兩種語系的文字（內建戰術的說明等資料裡的文字） */
export type Localized = Readonly<Record<Locale, string>>;

export type { Messages };
export const MESSAGES: Readonly<Record<Locale, Messages>> = { zh, en };

let current: Locale = 'zh';
const listeners = new Set<(locale: Locale) => void>();

export const getLocale = (): Locale => current;

/** 目前語系的文字表 */
export const t = (): Messages => MESSAGES[current];

/** 取出目前語系的文字 */
export const tr = (text: Localized): string => text[current];

export function setLocale(locale: Locale): void {
  if (locale === current) return;
  const from = current;
  current = locale;
  for (const l of listeners) l(from);
}

/** 語系改變時通知（參數是改變前的語系）；回傳取消函式 */
export function onLocaleChange(listener: (from: Locale) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * 使用者選過的語系優先；沒有時依瀏覽器的第一個偏好語言：中文（zh*）用繁體中文，其他用英文。
 * 瀏覽器完全沒有提供語言時用繁體中文。
 */
export function detectLocale(stored: string | null, languages: readonly (string | undefined)[]): Locale {
  if (stored === 'zh' || stored === 'en') return stored;
  const first = languages.find((l) => !!l)?.toLowerCase();
  if (!first) return 'zh';
  return first.startsWith('zh') ? 'zh' : 'en';
}
