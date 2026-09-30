/**
 * 彈出選單：直式開在按鈕上方，橫式開在按鈕左側，都不超出畫面。
 * 點選單外面、視窗大小改變時自動關閉。回傳 open / close。
 */
export function bindMenu(anchor: HTMLElement, menu: HTMLElement, onOpen?: () => void) {
  const open = () => {
    menu.hidden = false;
    anchor.setAttribute('aria-expanded', 'true');
    const b = anchor.getBoundingClientRect();
    const m = menu.getBoundingClientRect();
    const landscape = matchMedia('(orientation: landscape)').matches;
    const left = landscape ? b.left - m.width - 8 : Math.min(b.left + b.width / 2 - m.width / 2, innerWidth - m.width - 8);
    const top = landscape ? Math.min(b.top, innerHeight - m.height - 8) : b.top - m.height - 8;
    menu.style.left = `${Math.max(8, left)}px`;
    menu.style.top = `${Math.max(8, top)}px`;
    onOpen?.();
  };
  const close = () => {
    menu.hidden = true;
    anchor.setAttribute('aria-expanded', 'false');
  };
  anchor.addEventListener('click', () => (menu.hidden ? open() : close()));
  document.addEventListener('pointerdown', (e) => {
    if (!menu.hidden && !menu.contains(e.target as Node) && !anchor.contains(e.target as Node)) close();
  });
  addEventListener('resize', close);
  return { open, close, get isOpen() { return !menu.hidden; } };
}
