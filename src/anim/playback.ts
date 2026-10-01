import type { Store } from '../model/store';
import type { Renderer } from '../render/renderer';
import { fullPoseAt, simulate, type Simulation } from './simulation';

/** 播完後停在最後畫面多久，再回到編輯 */
const END_HOLD_SECONDS = 0.8;

/** 從第 1 個分鏡完整播到最後（SPEC §5：v1 不做暫停、調速） */
export class Playback {
  private raf = 0;
  private sim: Simulation | null = null;
  private startedAt = 0;
  /** 每一格回報目前時間，給 HUD 用 */
  onTick: (t: number, total: number) => void = () => {};

  constructor(
    private readonly store: Store,
    private readonly renderer: Renderer,
  ) {}

  get active(): boolean {
    return this.sim !== null;
  }

  start(): void {
    if (this.active) return;
    this.sim = simulate(this.store.get().tactic);
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
    this.sim = null;
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
    if (this.sim) this.render(Math.min(this.elapsed(), this.sim.timeline.total));
  }

  private elapsed(): number {
    return (performance.now() - this.startedAt) / 1000;
  }

  private render(t: number): void {
    const state = this.store.get();
    this.renderer.draw(state, fullPoseAt(state.tactic, this.sim!, t));
    this.onTick(t, this.sim!.timeline.total);
  }

  private tick = () => {
    const sim = this.sim;
    if (!sim) return;
    const t = this.elapsed();
    this.render(Math.min(t, sim.timeline.total));
    if (t >= sim.timeline.total + END_HOLD_SECONDS) this.stop();
    else this.raf = requestAnimationFrame(this.tick);
  };
}
