import { createDefaultTactic } from './defaults';
import type { Frame, Tactic } from './types';

export interface EditorState {
  tactic: Tactic;
  frameIndex: number;
  /** 正在拖曳的物件 id（球員 id 或 'ball'） */
  draggingId: string | null;
}

type Listener = (state: EditorState) => void;

/** 最小的狀態容器。M2 會在這裡加上 5 步復原。 */
export class Store {
  private state: EditorState = {
    tactic: createDefaultTactic(),
    frameIndex: 0,
    draggingId: null,
  };
  private listeners = new Set<Listener>();

  get(): EditorState {
    return this.state;
  }

  currentFrame(): Frame {
    return this.state.tactic.frames[this.state.frameIndex]!;
  }

  update(fn: (draft: EditorState) => void): void {
    fn(this.state);
    for (const l of this.listeners) l(this.state);
  }

  subscribe(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }
}
