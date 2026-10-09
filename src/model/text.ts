// 和語系無關的字串工具。

/** 拉丁字母與數字：截在兩個這種字中間，才算截在英文單字中間 */
const WORD_CHAR = /[\p{Script=Latin}\p{N}]/u;
/** 截斷後去掉結尾的空白與連接用的標點（例如「High pick and roll:」的冒號） */
const TRAILING = /[\s:;,，、：；\-–—]+$/u;

/**
 * 把文字截到 max 個字以內（長度用 UTF-16 計算，和 maxlength、名稱上限一致）：
 * - 依字元截斷，不會切開 emoji 這類由兩個 UTF-16 單位組成的字。
 * - 只有截在英文單字中間（截點兩側都是拉丁字母或數字）時，才往前退到最後一個空格；
 *   空格在一半長度以前就不退（不會只剩開頭幾個字）。中文、標點一律照字元截斷。
 * - 去掉結尾的空白與連接用的標點。
 */
export function truncateText(text: string, max: number): string {
  if (text.length <= max) return text;
  let out = '';
  for (const ch of text) {
    if (out.length + ch.length > max) break;
    out += ch;
  }
  const last = Array.from(out).at(-1) ?? '';
  const next = Array.from(text.slice(out.length))[0] ?? '';
  if (WORD_CHAR.test(last) && WORD_CHAR.test(next)) {
    const space = out.lastIndexOf(' ');
    if (space >= max / 2) out = out.slice(0, space);
  }
  return out.replace(TRAILING, '');
}
