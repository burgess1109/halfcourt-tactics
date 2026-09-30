import { describe, expect, it } from 'vitest';
import { History } from './history';

describe('History', () => {
  it('復原與重做', () => {
    const h = new History<number>(5);
    h.push(0); // 0 → 1
    h.push(1); // 1 → 2
    expect(h.undo(2)).toBe(1);
    expect(h.undo(1)).toBe(0);
    expect(h.undo(0)).toBeNull();
    expect(h.redo(0)).toBe(1);
    expect(h.redo(1)).toBe(2);
    expect(h.canRedo).toBe(false);
  });

  it('最多保留 5 步', () => {
    const h = new History<number>(5);
    for (let i = 0; i < 8; i++) h.push(i);
    let cur = 8;
    let steps = 0;
    for (let prev = h.undo(cur); prev !== null; prev = h.undo(cur)) {
      cur = prev;
      steps++;
    }
    expect(steps).toBe(5);
    expect(cur).toBe(3);
  });

  it('新的變更會清掉重做紀錄', () => {
    const h = new History<number>(5);
    h.push(0);
    h.undo(1);
    h.push(0);
    expect(h.canRedo).toBe(false);
  });
});
