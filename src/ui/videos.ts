import type { PlayVideo } from '../plays/videos';

/**
 * 參考影片連結列（戰術庫卡片、評分卡片共用）：點擊開新分頁。
 * 連結不能放在按鈕裡面，所以是另外一列。
 */
export function videoLinks(videos: readonly PlayVideo[], className: string): HTMLElement {
  const row = document.createElement('div');
  row.className = `videos ${className}`;
  row.setAttribute('role', 'group');
  row.setAttribute('aria-label', '參考影片');
  for (const v of videos) {
    const a = document.createElement('a');
    a.className = 'videos__link';
    a.href = v.url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    // 標題太長會被截斷，提示顯示完整標題
    a.dataset.tip = `${v.title}（開新分頁）`;
    a.innerHTML = '<svg aria-hidden="true"><use href="#icon-play"/></svg>';
    const text = document.createElement('span');
    text.textContent = v.title;
    a.append(text);
    row.append(a);
  }
  return row;
}
