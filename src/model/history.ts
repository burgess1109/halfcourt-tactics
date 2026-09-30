/** 快照式復原 / 重做，最多保留 limit 步（SPEC §9：5 步） */
export class History<T> {
  private past: T[] = [];
  private future: T[] = [];

  constructor(private readonly limit = 5) {}

  /** 記錄「變更之前」的快照；新的變更會清掉重做紀錄 */
  push(before: T): void {
    this.past.push(before);
    if (this.past.length > this.limit) this.past.shift();
    this.future = [];
  }

  /** 傳入目前狀態，回傳要還原成的狀態 */
  undo(current: T): T | null {
    const prev = this.past.pop();
    if (prev === undefined) return null;
    this.future.push(current);
    return prev;
  }

  redo(current: T): T | null {
    const next = this.future.pop();
    if (next === undefined) return null;
    this.past.push(current);
    return next;
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }
}
