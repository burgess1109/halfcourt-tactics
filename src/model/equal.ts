/**
 * 與欄位順序無關的 JSON 字串：物件的 key 依字母排序，值為 undefined 的欄位略過（和 JSON.stringify 相同）。
 * 同一份資料可能用不同順序建立（例如 loadPlay 依角色、parseTactic 依固定順序），直接 JSON.stringify 比對會誤判。
 */
export function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v,
  );
}

/** 兩份資料內容是否相同（不管欄位順序） */
export function sameData(a: unknown, b: unknown): boolean {
  return stableStringify(a) === stableStringify(b);
}
