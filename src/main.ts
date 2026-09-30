import './style.css';
import { attachDrag } from './input/drag';
import { Store } from './model/store';
import { Renderer } from './render/renderer';

const stage = document.querySelector<HTMLElement>('#stage')!;
const canvas = document.querySelector<HTMLCanvasElement>('#court')!;

const store = new Store();
const renderer = new Renderer(canvas);

// 狀態變動時，下一個畫格再重畫（合併同一格內的多次變動）
let scheduled = false;
function requestDraw(): void {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    renderer.draw(store.get());
  });
}

new ResizeObserver(() => {
  renderer.resize(stage.clientWidth, stage.clientHeight);
  requestDraw();
}).observe(stage);

// 螢幕的 devicePixelRatio 改變時（例如視窗拖到另一個螢幕）要重建快取。
// 每個 media query 只對應一個 dpr，所以觸發後要用新的值重新監聽。
function watchPixelRatio(): void {
  matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`).addEventListener(
    'change',
    () => {
      renderer.resize(stage.clientWidth, stage.clientHeight);
      requestDraw();
      watchPixelRatio();
    },
    { once: true },
  );
}
watchPixelRatio();

store.subscribe(requestDraw);
attachDrag(canvas, store, renderer);
