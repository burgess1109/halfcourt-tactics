// 按鈕提示：滑鼠移到有 data-tip 的元素上約 0.3 秒後顯示（瀏覽器內建的 title 要等一秒多，容易以為沒有）。
// 用 elementFromPoint 判斷，停用中的按鈕（例如「即將推出」）也能顯示。觸控裝置沒有 hover，不顯示。

const DELAY_MS = 300;
const GAP = 8;

export function attachTooltips(): void {
  const tip = document.createElement('div');
  tip.className = 'tip';
  tip.setAttribute('role', 'tooltip');
  tip.hidden = true;
  document.body.append(tip);

  let target: HTMLElement | null = null;
  let timer: number | undefined;

  const hide = () => {
    clearTimeout(timer);
    target = null;
    tip.hidden = true;
  };

  const show = (el: HTMLElement) => {
    tip.textContent = el.dataset.tip ?? '';
    tip.hidden = false;
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
  };

  document.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse') return;
    const hit = document.elementFromPoint(e.clientX, e.clientY);
    const el = hit instanceof Element ? hit.closest<HTMLElement>('[data-tip]') : null;
    if (el === target) return;
    hide();
    if (!el || el.offsetParent === null) return;
    target = el;
    timer = window.setTimeout(() => show(el), DELAY_MS);
  });
  document.addEventListener('pointerdown', hide);
  document.addEventListener('keydown', hide);
  addEventListener('blur', hide);
}

/** 更新提示文字（例如播放 ↔ 停止）；如果正在顯示就一起更新 */
export function setTip(el: HTMLElement, text: string): void {
  el.dataset.tip = text;
  el.removeAttribute('title');
}
