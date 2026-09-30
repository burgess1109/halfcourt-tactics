import { createDefaultTactic } from './defaults';
import { History } from './history';
import type { Draft } from './paths';
import type { Frame, PathKind, Tactic } from './types';

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
}

type Listener = (state: EditorState) => void;

export class Store {
  private state: EditorState = {
    tactic: createDefaultTactic(),
    frameIndex: 0,
    tool: 'move',
    freehand: false,
    draggingId: null,
    selectedPathId: null,
    draft: null,
  };
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
    if (p && JSON.stringify(this.state.tactic) !== p.json) {
      this.state.tactic.updatedAt = Date.now();
      this.history.push(p.snapshot);
    }
    this.emit();
  }

  undo(): void {
    this.restore(this.history.undo(this.clone()));
  }

  redo(): void {
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
