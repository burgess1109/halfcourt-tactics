import { newId } from './id';
import { TACTIC_NAME_MAX, parseTactic } from './serialize';
import type { Grade, Mode, Tactic } from './types';

// 存在 localStorage 的戰術列表（SPEC §8）：開啟、重新命名、複製、刪除。

export const STORAGE_KEY = 'halfcourt-tactics.saved';

export interface SavedSummary {
  id: string;
  name: string;
  mode: Mode;
  grade?: Grade;
  expectedPoints?: number;
  /** 戰術最後修改的時間 */
  updatedAt: number;
  /** 根據的內建戰術 */
  playId?: string;
}

/** 只需要讀寫，測試時可以換成記憶體版本 */
export type KeyValueStorage = Pick<Storage, 'getItem' | 'setItem'>;

/** 存檔失敗（例如空間不足）：訊息直接顯示給使用者 */
export class SaveError extends Error {}

const summaryOf = (t: Tactic): SavedSummary => ({
  id: t.id,
  name: t.name,
  mode: t.mode,
  ...(t.lastResult && { grade: t.lastResult.grade, expectedPoints: t.lastResult.expectedPoints }),
  updatedAt: t.updatedAt,
  ...(t.basedOn && { playId: t.basedOn.playId }),
});

/** 「X 複本」，超過長度上限時截短名稱 */
export function copyName(name: string): string {
  const suffix = ' 複本';
  return name.slice(0, TACTIC_NAME_MAX - suffix.length) + suffix;
}

/**
 * 已存的戰術。資料在記憶體裡保留一份，每次變更都整份寫回 storage；
 * 其他分頁改了資料時呼叫 reload()。讀出來的資料都經過 parseTactic 檢查，損壞的項目會略過。
 */
export class SavedTactics {
  private items: Tactic[] = [];
  /** 讀取時略過的損壞項目數量 */
  skipped = 0;

  constructor(private readonly storage: KeyValueStorage) {
    this.reload();
  }

  reload(): void {
    this.items = [];
    this.skipped = 0;
    let raw: unknown = [];
    try {
      raw = JSON.parse(this.storage.getItem(STORAGE_KEY) ?? '[]');
    } catch {
      raw = [];
    }
    if (!Array.isArray(raw)) return;
    for (const item of raw) {
      try {
        const { tactic } = parseTactic(item);
        if (tactic.name && !this.items.some((t) => t.id === tactic.id)) this.items.push(tactic);
        else this.skipped++;
      } catch {
        this.skipped++;
      }
    }
  }

  /** 依最後修改時間排序，新的在前 */
  list(): SavedSummary[] {
    return this.items.map(summaryOf).sort((a, b) => b.updatedAt - a.updatedAt);
  }

  /** 取得一份複本（修改它不會影響已存的資料） */
  get(id: string): Tactic | null {
    const t = this.items.find((x) => x.id === id);
    return t ? structuredClone(t) : null;
  }

  has(id: string): boolean {
    return this.items.some((t) => t.id === id);
  }

  /** 已存的版本的最後修改時間（判斷目前的戰術有沒有存檔後又改過） */
  savedUpdatedAt(id: string): number | null {
    return this.items.find((t) => t.id === id)?.updatedAt ?? null;
  }

  /** 已存的版本的評分 */
  savedResult(id: string): Tactic['lastResult'] {
    return this.items.find((t) => t.id === id)?.lastResult;
  }

  /** 新增或覆蓋同一個 id 的戰術；名稱必須已經填好 */
  save(tactic: Tactic): void {
    if (!tactic.name.trim()) throw new SaveError('戰術沒有名稱');
    const copy = structuredClone(tactic);
    const next = [...this.items.filter((t) => t.id !== copy.id), copy];
    this.write(next);
  }

  rename(id: string, name: string): void {
    this.write(this.items.map((t) => (t.id === id ? { ...t, name: name.trim() } : t)));
  }

  /** 複製一份（新的 id、名稱加上「複本」），回傳新的戰術 */
  duplicate(id: string): Tactic | null {
    const t = this.get(id);
    if (!t) return null;
    t.id = newId();
    t.name = copyName(t.name);
    t.updatedAt = Date.now();
    this.write([...this.items, t]);
    return structuredClone(t);
  }

  remove(id: string): void {
    this.write(this.items.filter((t) => t.id !== id));
  }

  private write(next: Tactic[]): void {
    try {
      this.storage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      throw new SaveError('存檔失敗：瀏覽器的儲存空間不足或被停用');
    }
    this.items = next;
  }
}
