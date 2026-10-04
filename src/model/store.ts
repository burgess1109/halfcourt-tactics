import { createDefaultTactic } from './defaults';
import { syncFrames } from './frames';
import { sameData } from './equal';
import { History } from './history';
import type { Draft } from './paths';
import { BALL_ID, type Frame, type PathKind, type Tactic } from './types';

/** 'move' = 拖曳球員與球；其他 = 畫該種路線 */
export type Tool = 'move' | PathKind;

export interface EditorState {
  tactic: Tactic;
  frameIndex: number;
  tool: Tool;
  /** 手繪模式（SPEC §4） */
  freehand: boolean;
  /** 正在拖曳的物件 id（球員 id 或 'ball'） */
  draggingId: string | null;
  selectedPathId: string | null;
  /** 正在畫、還沒放開的路線 */
  draft: Draft | null;
  /** 播放中：禁止編輯 */
  playing: boolean;
  /** 點評價時在場上標示的球員 */
  highlightIds: string[];
  /** 分享連結的唯讀預覽（SPEC §8）：只能看、播放，按「另存」後才能編輯 */
  readonly: boolean;
}

type Listener = (state: EditorState) => void;

/**
 * 使用者自己畫的部分：第 1 個分鏡的藍隊站位、球與持球者，以及每個分鏡的路線。
 * 紅隊位置與後面分鏡的起始位置都是自動算出來的（改對位、身高、速度、掩護應對時會變），不算在內；
 * 但關閉自動防守時，第 1 個分鏡的紅隊位置與紅隊路線是使用者畫的，要算在內。
 */
export function authoredSignature(tactic: Tactic): string {
  const first = tactic.frames[0]!;
  // 依固定順序取值：物件的欄位順序會因為建立方式不同而不同，直接 JSON.stringify 會誤判
  const ids = [...tactic.players.filter((p) => p.team === 'blue').map((p) => p.id)].sort();
  const start = [...ids, BALL_ID].map((id) => [id, first.start[id]]);
  // 關閉自動防守時，第 1 個分鏡的紅隊位置也是使用者擺的（紅隊路線已經包含在 paths 裡）
  const reds = tactic.autoDefense
    ? null
    : tactic.players.filter((p) => p.team === 'red').map((p) => p.id).sort().map((id) => [id, first.start[id]]);
  return JSON.stringify({ start, holder: first.ballHolderId, paths: tactic.frames.map((f) => f.paths), reds });
}

export class Store {
  private state: EditorState = {
    tactic: createDefaultTactic(),
    frameIndex: 0,
    tool: 'move',
    freehand: false,
    draggingId: null,
    selectedPathId: null,
    draft: null,
    playing: false,
    highlightIds: [],
    readonly: false,
  };
  /** 顯示提示訊息（由 main 接上 toast） */
  notify: (message: string) => void = () => {};
  private listeners = new Set<Listener>();
  private history = new History<Tactic>(5);
  /** 手勢開始時的快照；手勢結束時若有變更才寫入歷史 */
  private pending: { snapshot: Tactic; json: string } | null = null;

  get(): EditorState {
    return this.state;
  }

  currentFrame(): Frame {
    return this.state.tactic.frames[this.state.frameIndex]!;
  }

  /** 暫時性的變更（拖曳中、畫線中），不寫入歷史 */
  update(fn: (draft: EditorState) => void): void {
    fn(this.state);
    syncFrames(this.state.tactic, false);
    this.emit();
  }

  /** 一次完成的操作：寫入歷史後套用 */
  commit(fn: (draft: EditorState) => void): void {
    this.begin();
    fn(this.state);
    this.end();
  }

  /** 開始一個手勢（例如拖曳）。之後的 update 都算在同一步。 */
  begin(): void {
    const json = JSON.stringify(this.state.tactic);
    this.pending = { snapshot: JSON.parse(json) as Tactic, json };
  }

  /** 結束手勢：戰術真的有改變才算一步 */
  end(): void {
    const p = this.pending;
    this.pending = null;
    const removed = syncFrames(this.state.tactic, true);
    if (removed > 0) this.notify(`球換人持有，移除了 ${removed} 條運球 / 傳球 / 投籃路線`);
    if (p && JSON.stringify(this.state.tactic) !== p.json) {
      const t = this.state.tactic;
      // 從內建戰術載入後，動到使用者畫的部分才算「已修改」（SPEC §6.3：不會改寫內建戰術）
      if (t.basedOn && t.id === p.snapshot.id && authoredSignature(t) !== authoredSignature(p.snapshot)) {
        t.basedOn.modified = true;
      }
      // 同一份戰術被修改了，上次的評分已經不準（M8 存檔、分享時不能帶出舊評等）。
      // 載入另一份戰術（id 不同）時保留它自己的評分。
      if (t.id === p.snapshot.id) delete t.lastResult;
      t.updatedAt = Date.now();
      this.history.push(p.snapshot);
    }
    this.emit();
  }

  /**
   * 換成另一份戰術（例如載入內建戰術、開啟存檔）；算一步，可以復原回原本的戰術。會結束唯讀預覽。
   * 載入的戰術原樣使用：不是「修改」，所以不改 updatedAt、不清評分、不標示已修改
   * （重新開啟同一份存檔時，id 相同也一樣）。
   * 內容和目前完全相同時不記一步（按復原不會沒反應，也不會擠掉有用的復原）。回傳是否記了一步。
   */
  load(tactic: Tactic): boolean {
    if (this.state.readonly) {
      this.reset(tactic);
      return false;
    }
    this.pending = null;
    const changed = !sameData(this.state.tactic, tactic);
    if (changed) this.history.push(this.clone());
    this.replace(tactic);
    this.emit();
    return changed;
  }

  /**
   * 改戰術名稱：不算一步、不算修改（不改 updatedAt、不清評分），
   * 復原紀錄裡同一份戰術的名稱也一起改，復原後才不會變回舊名稱。
   */
  renameTactic(id: string, name: string): void {
    const rename = (t: Tactic) => {
      if (t.id === id) t.name = name;
    };
    this.history.forEach(rename);
    rename(this.state.tactic);
    this.emit();
  }

  /**
   * 換成另一份戰術並清空復原紀錄（開啟分享連結、結束預覽時）。
   * readonly = true 時進入唯讀預覽。
   */
  reset(tactic: Tactic, readonly = false): void {
    this.history = new History<Tactic>(5);
    this.replace(tactic);
    this.state.readonly = readonly;
    this.state.tool = 'move';
    this.emit();
  }

  private replace(tactic: Tactic): void {
    const s = this.state;
    s.tactic = tactic;
    s.frameIndex = 0;
    s.selectedPathId = null;
    s.draft = null;
    s.draggingId = null;
    s.highlightIds = [];
  }

  undo(): void {
    if (this.state.readonly) return;
    this.restore(this.history.undo(this.clone()));
  }

  redo(): void {
    if (this.state.readonly) return;
    this.restore(this.history.redo(this.clone()));
  }

  get canUndo(): boolean {
    return this.history.canUndo;
  }

  get canRedo(): boolean {
    return this.history.canRedo;
  }

  subscribe(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  private clone(): Tactic {
    return structuredClone(this.state.tactic);
  }

  private restore(tactic: Tactic | null): void {
    if (!tactic) return;
    const s = this.state;
    s.tactic = tactic;
    s.frameIndex = Math.min(s.frameIndex, tactic.frames.length - 1);
    s.draggingId = null;
    s.draft = null;
    if (s.selectedPathId && !this.currentFrame().paths.some((p) => p.id === s.selectedPathId)) {
      s.selectedPathId = null;
    }
    this.emit();
  }

  private emit(): void {
    for (const l of this.listeners) l(this.state);
  }
}
