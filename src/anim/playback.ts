import type { Store } from '../model/store';
import type { Renderer } from '../render/renderer';
import { buildTimeline, poseAt, type Timeline } from './timeline';

/** 播完後停在最後畫面多久，再回到編輯 */
const END_HOLD_SECONDS = 0.8;

/** 從第 1 個分鏡完整播到最後（SPEC §5：v1 不做暫停、調速） */
export class Playback {
  private raf = 0;
  private timeline: Timeline | null = null;
  private startedAt = 0;
  /** 每一格回報目前時間，給 HUD 用 */
  onTick: (t: number, total: number) => void = () => {};

  constructor(
    private readonly store: Store,
    private readonly renderer: Renderer,
  ) {}

  get active(): boolean {
    return this.timeline !== null;
  }

  start(): void {
    if (this.active) return;
    this.timeline = buildTimeline(this.store.get().tactic);
    this.startedAt = performance.now();
    this.store.update((s) => {
      s.playing = true;
      s.selectedPathId = null;
      s.draft = null;
    });
    this.raf = requestAnimationFrame(this.tick);
  }

  stop(): void {
    if (!this.active) return;
    cancelAnimationFrame(this.raf);
    this.timeline = null;
    this.store.update((s) => {
      s.playing = false;
    });
  }

  toggle(): void {
    if (this.active) this.stop();
    else this.start();
  }

  /** 畫面大小改變時，播放中也要立刻重畫 */
  redraw(): void {
    if (this.timeline) this.render(Math.min(this.elapsed(), this.timeline.total));
  }

  private elapsed(): number {
    return (performance.now() - this.startedAt) / 1000;
  }

  private render(t: number): void {
    const state = this.store.get();
    this.renderer.draw(state, poseAt(state.tactic, this.timeline!, t));
    this.onTick(t, this.timeline!.total);
  }

  private tick = () => {
    const timeline = this.timeline;
    if (!timeline) return;
    const t = this.elapsed();
    this.render(Math.min(t, timeline.total));
    if (t >= timeline.total + END_HOLD_SECONDS) this.stop();
    else this.raf = requestAnimationFrame(this.tick);
  };
}
