import { describe, expect, it } from 'vitest';
import { loadPlay } from '../plays/instantiate';
import { PLAYS } from '../plays/library';
import { createDefaultTactic } from './defaults';
import { SavedTactics, STORAGE_KEY, copyName, type KeyValueStorage } from './savedTactics';
import {
  SHARE_PREFIX,
  TACTIC_NAME_MAX,
  TacticFormatError,
  decodeShare,
  encodeShare,
  fromJsonFile,
  jsonFileName,
  nameError,
  parseTactic,
  toJsonFile,
} from './serialize';
import { authoredSignature } from './store';
import type { Tactic } from './types';

const roles = { A: 'b1', B: 'b2', C: 'b3' } as const;
/** 分享連結不帶路線 id（還原時重新產生），比較時去掉 */
const withoutIds = (t: Tactic) => ({
  signature: authoredSignature({ ...t, frames: t.frames.map((f) => ({ ...f, paths: f.paths.map((p) => ({ ...p, id: '' })) })) }),
  frames: t.frames.map((f) => ({ ...f, paths: f.paths.map((p) => ({ ...p, id: '' })) })),
});
const sample = (i = 0): Tactic => {
  const t = loadPlay(createDefaultTactic(), PLAYS[i]!, roles);
  t.name = '測試戰術';
  return t;
};

describe('戰術名稱', () => {
  it(`1–${TACTIC_NAME_MAX} 個字，前後空白不算`, () => {
    expect(nameError('')).not.toBeNull();
    expect(nameError('   ')).not.toBeNull();
    expect(nameError('擋拆')).toBeNull();
    expect(nameError('字'.repeat(TACTIC_NAME_MAX))).toBeNull();
    expect(nameError('字'.repeat(TACTIC_NAME_MAX + 1))).not.toBeNull();
  });
});

describe('JSON 匯出入', () => {
  it('匯出再匯入，資料完全相同', () => {
    const t = sample();
    t.lastResult = { grade: 'A', expectedPoints: 0.8 };
    const { tactic, removed } = fromJsonFile(toJsonFile(t));
    expect(removed).toBe(0);
    expect(tactic).toEqual(t);
  });

  it('紅隊位置不採用檔案裡的值，一律依防守 AI 重新推算', () => {
    const t = sample();
    const data = JSON.parse(toJsonFile(t)) as Tactic;
    data.frames[0]!.start.r1 = { x: 7, y: 13 };
    data.frames[1]!.start.r2 = { x: -7, y: 13 };
    expect(parseTactic(data).tactic.frames).toEqual(t.frames);
  });

  it('不是 JSON、版本不對、資料不完整時，給出看得懂的錯誤', () => {
    expect(() => fromJsonFile('hello')).toThrow(TacticFormatError);
    const t = JSON.parse(toJsonFile(sample())) as Record<string, unknown>;
    expect(() => parseTactic({ ...t, version: 2 })).toThrow('較新的版本');
    expect(() => parseTactic({ ...t, mode: 'defense' })).toThrow('防守模式');
    expect(() => parseTactic({ ...t, players: [] })).toThrow(TacticFormatError);
    expect(() => parseTactic({ ...t, frames: [] })).toThrow(TacticFormatError);
    expect(() => parseTactic({ ...t, matchups: { b1: 'r1', b2: 'r1', b3: 'r3' } })).toThrow(TacticFormatError);
  });

  it('違反路線規則的資料不接受：同一人兩條路線、投籃不在最後一個分鏡', () => {
    const t = JSON.parse(toJsonFile(sample())) as Tactic;
    const twice = structuredClone(t);
    twice.frames[0]!.paths.push({ ...twice.frames[0]!.paths[0]!, id: 'x' });
    expect(() => parseTactic(twice)).toThrow('兩條路線');
    const early = structuredClone(t);
    const shot = early.frames.at(-1)!.paths.find((p) => p.kind === 'shot')!;
    early.frames[0]!.paths = [shot];
    expect(() => parseTactic(early)).toThrow('最後一個分鏡');
  });

  it('擋拆協防：舊資料沒有這個欄位時預設沉退；不認得的值不接受', () => {
    const t = JSON.parse(toJsonFile(sample())) as Record<string, unknown>;
    delete t.pickCoverage;
    expect(parseTactic(t).tactic.pickCoverage).toBe('drop');
    expect(parseTactic({ ...t, pickCoverage: 'hedge' }).tactic.pickCoverage).toBe('hedge');
    expect(() => parseTactic({ ...t, pickCoverage: 'blitz' })).toThrow(TacticFormatError);
  });

  it('座標超出球場時不接受', () => {
    const t = JSON.parse(toJsonFile(sample())) as Tactic;
    t.frames[0]!.start.b1 = { x: 0, y: 99 };
    expect(() => parseTactic(t)).toThrow('超出球場');
  });

  it('持球者不對的運球、傳球會被移除並回報數量', () => {
    const t = JSON.parse(toJsonFile(sample())) as Tactic;
    const f = t.frames[0]!;
    const notHolder = ['b1', 'b2', 'b3'].find((id) => id !== f.ballHolderId)!;
    f.paths = f.paths.filter((p) => p.actorId !== notHolder);
    f.paths.push({ id: 'd', kind: 'dribble', actorId: notHolder, points: [f.start[notHolder]!, { x: 0, y: 5 }], freehand: false });
    expect(parseTactic(t).removed).toBe(1);
  });

  it('檔名去掉不能用的字元', () => {
    const t = sample();
    t.name = '擋拆 / 下切?';
    expect(jsonFileName(t)).toBe('擋拆_下切_.json');
    t.name = '';
    expect(jsonFileName(t)).toBe('戰術.json');
  });
});

describe('分享連結', () => {
  it('18 套內建戰術都能完整還原（使用者畫的部分與設定都相同，評分不帶出去）', async () => {
    for (let i = 0; i < PLAYS.length; i++) {
      const t = sample(i);
      t.lastResult = { grade: 'S', expectedPoints: 1.5 };
      t.pickCoverage = i % 2 ? 'hedge' : 'drop';
      const hash = await encodeShare(t);
      expect(hash.startsWith(SHARE_PREFIX)).toBe(true);
      expect(hash).toMatch(/^#p=[A-Za-z0-9_-]+$/);
      const { tactic, removed } = await decodeShare(hash);
      expect(removed).toBe(0);
      expect(withoutIds(tactic)).toEqual(withoutIds(t));
      expect(tactic.players).toEqual(t.players);
      expect(tactic.matchups).toEqual(t.matchups);
      expect(tactic.pickCoverage).toBe(t.pickCoverage);
      expect(tactic.basedOn).toEqual(t.basedOn);
      expect(tactic.name).toBe(t.name);
      expect(tactic.id).not.toBe(t.id);
      expect(tactic.lastResult).toBeUndefined();
    }
  });

  it('座標四捨五入到公分', async () => {
    const t = createDefaultTactic();
    t.frames[0]!.start.b1 = { x: 1.23456, y: 7.891011 };
    const { tactic } = await decodeShare(await encodeShare(t));
    expect(tactic.frames[0]!.start.b1).toEqual({ x: 1.23, y: 7.89 });
  });

  it('網址夠短（最長的內建戰術也在 2000 字以內）', async () => {
    const lengths = await Promise.all(PLAYS.map(async (_, i) => (await encodeShare(sample(i))).length));
    expect(Math.max(...lengths)).toBeLessThan(2000);
  });

  it('損壞的連結給出看得懂的錯誤', async () => {
    await expect(decodeShare('#p=@@@')).rejects.toThrow(TacticFormatError);
    await expect(decodeShare('#p=abcdef')).rejects.toThrow(TacticFormatError);
    const good = await encodeShare(sample());
    await expect(decodeShare(good.slice(0, good.length / 2))).rejects.toThrow(TacticFormatError);
  });
});

class MemoryStorage implements KeyValueStorage {
  data = new Map<string, string>();
  full = false;
  getItem(key: string) {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    if (this.full) throw new Error('QuotaExceededError');
    this.data.set(key, value);
  }
}

describe('已存的戰術（localStorage）', () => {
  it('存檔、列表（新的在前）、開啟', () => {
    const storage = new MemoryStorage();
    const saved = new SavedTactics(storage);
    const a = sample(0);
    a.updatedAt = 1000;
    const b = sample(1);
    b.name = '第二套';
    b.updatedAt = 2000;
    b.lastResult = { grade: 'B', expectedPoints: 0.6 };
    saved.save(a);
    saved.save(b);
    expect(saved.list().map((s) => s.name)).toEqual(['第二套', '測試戰術']);
    expect(saved.list()[0]).toMatchObject({ grade: 'B', expectedPoints: 0.6, playId: PLAYS[1]!.id });
    // 重新讀取 storage 也一樣
    const again = new SavedTactics(storage);
    expect(again.get(a.id)).toEqual(a);
    expect(again.savedUpdatedAt(b.id)).toBe(2000);
  });

  it('同一個 id 再存一次是覆蓋，不會多一筆；拿到的是複本', () => {
    const saved = new SavedTactics(new MemoryStorage());
    const t = sample();
    saved.save(t);
    t.name = '改名';
    saved.save(t);
    expect(saved.list()).toHaveLength(1);
    const copy = saved.get(t.id)!;
    copy.name = '不影響';
    expect(saved.get(t.id)!.name).toBe('改名');
  });

  it('重新命名、複製、刪除', () => {
    const saved = new SavedTactics(new MemoryStorage());
    const t = sample();
    saved.save(t);
    saved.rename(t.id, '  新名稱 ');
    expect(saved.get(t.id)!.name).toBe('新名稱');
    const dup = saved.duplicate(t.id)!;
    expect(dup.id).not.toBe(t.id);
    expect(dup.name).toBe('新名稱 複本');
    expect(saved.list()).toHaveLength(2);
    saved.remove(t.id);
    expect(saved.list().map((s) => s.id)).toEqual([dup.id]);
  });

  it('複本名稱不超過長度上限', () => {
    expect(copyName('字'.repeat(TACTIC_NAME_MAX)).length).toBe(TACTIC_NAME_MAX);
  });

  it('沒有名稱不能存；儲存空間不足時給出錯誤，資料不變', () => {
    const storage = new MemoryStorage();
    const saved = new SavedTactics(storage);
    const t = sample();
    t.name = '';
    expect(() => saved.save(t)).toThrow('沒有名稱');
    t.name = '有名稱';
    storage.full = true;
    expect(() => saved.save(t)).toThrow('儲存空間');
    expect(saved.list()).toHaveLength(0);
  });

  it('損壞的資料略過，其他照常讀取', () => {
    const storage = new MemoryStorage();
    const good = JSON.parse(toJsonFile(sample())) as unknown;
    storage.setItem(STORAGE_KEY, JSON.stringify([good, { version: 1, name: '壞掉' }, 42]));
    const saved = new SavedTactics(storage);
    expect(saved.list()).toHaveLength(1);
    expect(saved.skipped).toBe(2);
    storage.setItem(STORAGE_KEY, 'not json');
    saved.reload();
    expect(saved.list()).toHaveLength(0);
  });
});

describe('分享連結的唯讀預覽（Store）', () => {
  it('預覽中不能復原；載入其他戰術會結束預覽，復原紀錄從頭開始', async () => {
    const { Store } = await import('./store');
    const store = new Store();
    store.commit((s) => {
      s.tactic.frames[0]!.start.b1 = { x: 1, y: 8 };
    });
    expect(store.canUndo).toBe(true);

    store.reset(sample(), true);
    expect(store.get().readonly).toBe(true);
    expect(store.canUndo).toBe(false);
    const before = store.get().tactic;
    store.undo();
    expect(store.get().tactic).toBe(before);

    store.load(sample(1));
    expect(store.get().readonly).toBe(false);
    expect(store.canUndo).toBe(false);
  });

  it('開啟存檔原樣載入：最後修改時間、評分、內建戰術來源都不變（標題才不會顯示未存檔）', async () => {
    const { Store } = await import('./store');
    const store = new Store();
    const saved = sample();
    saved.updatedAt = 1234;
    saved.lastResult = { grade: 'A', expectedPoints: 0.8 };
    store.load(structuredClone(saved));
    expect(store.get().tactic).toEqual(saved);
    expect(store.canUndo).toBe(true);
  });

  it('重新開啟沒改過的同一份存檔：不多記一步復原', async () => {
    const { Store } = await import('./store');
    const store = new Store();
    store.commit((s) => {
      s.tactic.frames[0]!.start.b1 = { x: 1, y: 8 };
    });
    const saved = sample();
    expect(store.load(structuredClone(saved))).toBe(true);
    expect(store.load(structuredClone(saved))).toBe(false);
    store.undo();
    expect(store.get().tactic.id).not.toBe(saved.id); // 一次復原就回到載入前的戰術
  });

  it('不同方式建立、欄位順序不同的同一份戰術，也算內容相同', async () => {
    const { Store } = await import('./store');
    // 角色 A 不是 b1：loadPlay 的 start 依角色順序建立，parseTactic 依固定順序
    const t = loadPlay(createDefaultTactic(), PLAYS[0]!, { A: 'b2', B: 'b3', C: 'b1' });
    t.name = 'X';
    const parsed = parseTactic(JSON.parse(toJsonFile(t))).tactic;
    expect(JSON.stringify(parsed)).not.toBe(JSON.stringify(t));
    const store = new Store();
    store.load(t);
    expect(store.load(parsed)).toBe(false);
  });

  it('重新開啟正在編輯的同一份存檔（放棄修改）：拿回已存的評分，不會被標成已修改', async () => {
    const { Store } = await import('./store');
    const store = new Store();
    const saved = sample();
    saved.lastResult = { grade: 'A', expectedPoints: 0.8 };
    store.load(structuredClone(saved));
    store.commit((s) => {
      s.tactic.frames[0]!.paths = [];
    });
    expect(store.get().tactic.basedOn!.modified).toBe(true);
    expect(store.get().tactic.lastResult).toBeUndefined();
    store.load(structuredClone(saved));
    expect(store.get().tactic).toEqual(saved);
  });

  it('改名稱不算一步、不算修改；復原後名稱也不會變回去', async () => {
    const { Store } = await import('./store');
    const store = new Store();
    const t = sample();
    t.name = '';
    t.lastResult = { grade: 'A', expectedPoints: 0.8 };
    store.load(t);
    store.commit((s) => {
      s.tactic.frames[0]!.start.b3 = { x: -5, y: 6.5 };
    });
    const at = store.get().tactic.updatedAt;
    store.renameTactic(t.id, 'A');
    expect(store.get().tactic.updatedAt).toBe(at);
    store.undo();
    expect(store.get().tactic.name).toBe('A');
    store.redo();
    expect(store.get().tactic.name).toBe('A');
    // 復原到載入之前的另一份戰術：那份的名稱不受影響
    store.undo();
    store.undo();
    expect(store.get().tactic.id).not.toBe(t.id);
    expect(store.get().tactic.name).toBe('');
  });
});
