import './style.css';
import { Playback } from './anim/playback';
import { SHOT_CLOCK_SECONDS, buildTimeline, possessionSeconds } from './anim/timeline';
import { attachPointer } from './input/pointer';
import { SavedTactics, type KeyValueStorage } from './model/savedTactics';
import { Store } from './model/store';
import { Renderer } from './render/renderer';
import { attachFrames } from './ui/frames';
import { attachHud } from './ui/hud';
import { attachLibrary } from './ui/library';
import { askName } from './ui/nameDialog';
import { attachResult } from './ui/result';
import { attachSaved } from './ui/saved';
import { attachSetup } from './ui/setup';
import { attachShare, type Screen } from './ui/share';
import { createToast } from './ui/toast';
import { attachToolbar } from './ui/toolbar';
import { attachTooltips, setTip } from './ui/tooltip';

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

const canvas = $<HTMLCanvasElement>('#court');

attachTooltips();
const store = new Store();
const renderer = new Renderer(canvas);
const playback = new Playback(store, renderer);
const notify = createToast($('#toast'));
store.notify = notify;

// ---- 畫面切換：首頁 → 設定 → 戰術面板（SPEC §1.1） ----
function show(screen: Screen): void {
  if (screen !== 'board') playback.stop();
  document.body.dataset.screen = screen;
  if (screen === 'board') resize();
}

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
  // 用 canvas 本身的大小：評分卡片打開時，canvas 會讓出空間給卡片
  renderer.resize(canvas.clientWidth, canvas.clientHeight);
  requestDraw();
  playback.redraw();
}
new ResizeObserver(resize).observe(canvas);

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
const setup = attachSetup(store, show, notify);
attachPointer(canvas, store, renderer, notify, (playerId) => {
  const team = store.get().tactic.players.find((p) => p.id === playerId)?.team;
  setup.open(team === 'red' ? 2 : 1, playerId);
});
attachToolbar(store, notify);
attachFrames(store, notify);
const hud = attachHud($('#hud'), store);
playback.onTick = hud.playing;
const result = attachResult(store);
playback.onFinished = (sim) => result.show(sim);

const library = attachLibrary(store, {
  onLoaded: () => playback.start(),
  notify,
  openSetup: () => setup.open(1),
});
$<HTMLButtonElement>('#library').addEventListener('click', () => library.open());

// ---- 存檔、戰術列表、分享（SPEC §8） ----
/** localStorage 被停用（例如部分瀏覽器的私密模式）時，改存在記憶體裡，關閉頁面後就消失 */
function storage(): KeyValueStorage {
  try {
    const key = '__halfcourt_test__';
    localStorage.setItem(key, '1');
    localStorage.removeItem(key);
    return localStorage;
  } catch {
    const memory = new Map<string, string>();
    notify('瀏覽器不允許儲存資料，存檔只會保留到關閉頁面');
    return { getItem: (k) => memory.get(k) ?? null, setItem: (k, v) => void memory.set(k, v) };
  }
}
const savedTactics = new SavedTactics(storage());
const share = attachShare(store, {
  notify,
  save: () => saved.save(),
  show,
  screen: () => document.body.dataset.screen as Screen,
  stopPlayback: () => playback.stop(),
});
const saved = attachSaved(store, savedTactics, {
  notify,
  askName,
  onPreviewEnded: share.previewEnded,
  onOpened: () => show('board'),
});
$<HTMLButtonElement>('#saved').addEventListener('click', () => saved.open());
$<HTMLButtonElement>('#home-saved').addEventListener('click', () => saved.open());
$<HTMLButtonElement>('#save').addEventListener('click', () => void saved.save());
void share.openFromHash();

$<HTMLButtonElement>('#mode-offense').addEventListener('click', () => setup.open(1));
$<HTMLButtonElement>('#team').addEventListener('click', () => setup.open(1));

// ---- 播放 ----
const playBtn = $<HTMLButtonElement>('#play');
const togglePlay = () => {
  if (!playback.active) {
    const tl = buildTimeline(store.get().tactic);
    const t = possessionSeconds(tl);
    if (t > SHOT_CLOCK_SECONDS) {
      const what = tl.shotReleaseAt === null ? '整個戰術' : '出手時間';
      notify(`${what} ${t.toFixed(1)} 秒，超過 ${SHOT_CLOCK_SECONDS} 秒進攻時限`);
    }
  }
  playback.toggle();
};
playBtn.addEventListener('click', togglePlay);
store.subscribe((s) => {
  playBtn.querySelector('use')!.setAttribute('href', s.playing ? '#icon-stop' : '#icon-play');
  playBtn.setAttribute('aria-label', s.playing ? '停止' : '播放');
  setTip(playBtn, s.playing ? '停止（空白鍵）' : '播放（空白鍵）');
});
document.addEventListener('keydown', (e) => {
  if (e.key !== ' ' || document.body.dataset.screen !== 'board' || document.querySelector('dialog[open]')) return;
  if (e.target instanceof HTMLButtonElement || e.target instanceof HTMLInputElement) return;
  e.preventDefault();
  togglePlay();
});
