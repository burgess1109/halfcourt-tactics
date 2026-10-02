// 按鈕提示：滑鼠移到有 data-tip 的元素上約 0.3 秒後顯示（瀏覽器內建的 title 要等一秒多，容易以為沒有）。
// 用 elementFromPoint 判斷，停用中的按鈕（例如「即將推出」）也能顯示。觸控裝置沒有 hover，不顯示。

const DELAY_MS = 300;
const GAP = 8;

/** 全頁共用一個提示框；attachTooltips 之後才有 */
let tip: HTMLDivElement | null = null;
/** 滑鼠目前停在哪個元素上（提示可能已顯示，或還在等待延遲） */
let target: HTMLElement | null = null;

function place(el: HTMLElement): void {
  if (!tip) return;
  tip.textContent = el.dataset.tip ?? '';
  tip.hidden = false;
  // 先移到左上角再量大小：留在上一次的位置（例如畫面右緣）時，可用寬度太窄，長文字會被擠成兩行
  tip.style.left = '0px';
  tip.style.top = '0px';
  const r = el.getBoundingClientRect();
  const t = tip.getBoundingClientRect();
  let left: number;
  let top: number;
  if (r.left < 80) {
    // 橫式左側工具列：顯示在右邊
    left = r.right + GAP;
    top = r.top + r.height / 2 - t.height / 2;
  } else if (innerWidth - r.right < 80) {
    // 橫式右側工具列：顯示在左邊
    left = r.left - t.width - GAP;
    top = r.top + r.height / 2 - t.height / 2;
  } else {
    // 上半部的按鈕顯示在下方，下半部的顯示在上方
    left = r.left + r.width / 2 - t.width / 2;
    top = r.top + r.height / 2 < innerHeight / 2 ? r.bottom + GAP : r.top - t.height - GAP;
  }
  tip.style.left = `${Math.max(8, Math.min(left, innerWidth - t.width - 8))}px`;
  tip.style.top = `${Math.max(8, Math.min(top, innerHeight - t.height - 8))}px`;
}

export function attachTooltips(): void {
  const box = document.createElement('div');
  box.className = 'tip';
  box.setAttribute('role', 'tooltip');
  box.hidden = true;
  document.body.append(box);
  tip = box;

  let timer: number | undefined;
  const hide = () => {
    clearTimeout(timer);
    target = null;
    box.hidden = true;
  };

  document.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse') return;
    const hit = document.elementFromPoint(e.clientX, e.clientY);
    const el = hit instanceof Element ? hit.closest<HTMLElement>('[data-tip]') : null;
    if (el === target) return;
    hide();
    if (!el || el.offsetParent === null) return;
    target = el;
    timer = window.setTimeout(() => place(el), DELAY_MS);
  });
  document.addEventListener('pointerdown', hide);
  document.addEventListener('keydown', hide);
  addEventListener('blur', hide);
}

/** 更新提示文字（例如播放 ↔ 停止）；提示正在顯示時，連畫面上的文字和位置一起更新 */
export function setTip(el: HTMLElement, text: string): void {
  el.dataset.tip = text;
  el.removeAttribute('title');
  if (tip && !tip.hidden && target === el) place(el);
}
