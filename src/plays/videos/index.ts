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
export function videosOf(playId: string | undefined, locale: Locale = getLocale()): readonly PlayVideo[] {
  const list = PLAY_VIDEOS[locale];
  // playId 可能來自外部資料（分享連結、JSON）：只看設定檔裡真的有寫的 id，不會拿到 constructor 等內建屬性
  return playId !== undefined && Object.hasOwn(list, playId) ? list[playId]! : [];
}
