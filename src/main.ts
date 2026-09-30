import './style.css';
import { Playback } from './anim/playback';
import { attachPointer } from './input/pointer';
import { Store } from './model/store';
import { Renderer } from './render/renderer';
import { attachFrames } from './ui/frames';
import { attachHud } from './ui/hud';
import { attachPlayerDialog } from './ui/playerDialog';
import { createToast } from './ui/toast';
import { attachToolbar } from './ui/toolbar';
import { SHOT_CLOCK_SECONDS, buildTimeline } from './anim/timeline';

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

const stage = $<HTMLElement>('#stage');
const canvas = $<HTMLCanvasElement>('#court');

const store = new Store();
const renderer = new Renderer(canvas);
const playback = new Playback(store, renderer);
const notify = createToast($('#toast'));
store.notify = notify;

// 狀態變動時，下一個畫格再重畫（合併同一格內的多次變動）。播放中由 Playback 負責畫。
let scheduled = false;
function requestDraw(): void {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    if (!playback.active) renderer.draw(store.get());
  });
}

function resize(): void {
  renderer.resize(stage.clientWidth, stage.clientHeight);
  requestDraw();
  playback.redraw();
}
new ResizeObserver(resize).observe(stage);

// 螢幕的 devicePixelRatio 改變時（例如視窗拖到另一個螢幕）要重建快取。
// 每個 media query 只對應一個 dpr，所以觸發後要用新的值重新監聽。
function watchPixelRatio(): void {
  matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`).addEventListener(
    'change',
    () => {
      resize();
      watchPixelRatio();
    },
    { once: true },
  );
}
watchPixelRatio();

store.subscribe(requestDraw);
const openPlayer = attachPlayerDialog(store);
attachPointer(canvas, store, renderer, notify, openPlayer);
attachToolbar(store);
attachFrames(store, notify);
const hud = attachHud($('#hud'), store);
playback.onTick = hud.playing;

// ---- 播放 ----
const playBtn = $<HTMLButtonElement>('#play');
const togglePlay = () => {
  if (!playback.active) {
    const total = buildTimeline(store.get().tactic).total;
    if (total > SHOT_CLOCK_SECONDS) notify(`整個戰術 ${total.toFixed(1)} 秒，超過 ${SHOT_CLOCK_SECONDS} 秒進攻時限`);
  }
  playback.toggle();
};
playBtn.addEventListener('click', togglePlay);
store.subscribe((s) => {
  playBtn.querySelector('use')!.setAttribute('href', s.playing ? '#icon-stop' : '#icon-play');
  playBtn.setAttribute('aria-label', s.playing ? '停止' : '播放');
  playBtn.title = s.playing ? '停止' : '播放';
});
document.addEventListener('keydown', (e) => {
  if (e.key !== ' ' || document.querySelector('dialog[open]')) return;
  if (e.target instanceof HTMLButtonElement || e.target instanceof HTMLInputElement) return;
  e.preventDefault();
  togglePlay();
});

$<HTMLButtonElement>('#players').addEventListener('click', () => {
  const s = store.get();
  openPlayer(s.tactic.players.find((p) => p.team === 'blue')!.id);
});
