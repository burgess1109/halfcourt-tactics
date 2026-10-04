import { describe, expect, it } from 'vitest';
import { insertFrameAfter } from './frames';
import { Store } from './store';

describe('工具', () => {
  it('第 2 個分鏡之後不能用「移動」：自動換成「跑位」，回到第 1 個分鏡時維持目前的工具', () => {
    const store = new Store();
    store.commit((s) => {
      insertFrameAfter(s.tactic, 0);
    });
    expect(store.get().tool).toBe('move');
    store.update((s) => {
      s.frameIndex = 1;
    });
    expect(store.get().tool).toBe('cut');
    store.update((s) => {
      s.tool = 'move';
    });
    expect(store.get().tool).toBe('cut');
    store.update((s) => {
      s.frameIndex = 0;
    });
    expect(store.get().tool).toBe('cut');
    store.update((s) => {
      s.tool = 'move';
    });
    expect(store.get().tool).toBe('move');
  });
});
