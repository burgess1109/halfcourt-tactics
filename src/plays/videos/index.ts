import { getLocale, type Locale } from '../../i18n';
import { EN_VIDEOS } from './en';
import { ZH_VIDEOS } from './zh-Hant';

// 內建戰術的參考影片（SPEC §6.3）：每種語系一份設定檔（zh-Hant.ts、en.ts），依目前的語系只讀其中一份。

export interface PlayVideo {
  /** 顯示文字 */
  title: string;
  url: string;
}

/** 每套戰術最多幾個影片 */
export const MAX_VIDEOS = 3;

export const PLAY_VIDEOS: Readonly<Record<Locale, Readonly<Record<string, readonly PlayVideo[]>>>> = {
  zh: ZH_VIDEOS,
  en: EN_VIDEOS,
};

/** 這套戰術在這個語系的參考影片（沒有就是空陣列，介面不顯示） */
export const videosOf = (playId: string | undefined, locale: Locale = getLocale()): readonly PlayVideo[] =>
  (playId && PLAY_VIDEOS[locale][playId]) || [];
