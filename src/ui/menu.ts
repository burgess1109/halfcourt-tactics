/**
 * 彈出選單：直式開在按鈕上方或下方、橫式開在按鈕左側或右側，選空間比較大的一側（放得下時用上方 / 左側）。
 * 比所選那一側的空間大時縮小（文字換行），在選單內上下捲動，不蓋住按鈕。
 * 例外：所選那一側不到 MIN_SIDE（例如很矮或很窄的分割畫面），改成以按鈕為中心、只限制在畫面內，可能蓋到按鈕。
 * 不管哪種情況，最後都把大小與位置限制在畫面內（距離邊緣 MARGIN），所以選單一定不會超出畫面。
 * 大小限制只在這裡設定（CSS 不寫 max-height）。
 * 同一個選單可以由多個按鈕開啟（例如語系選單：首頁的「語系 / Language」與戰術面板的「設定」），
 * 位置跟著被點的那個按鈕；再點同一個按鈕就關閉。
 * 點選單外面（不含這些按鈕）、視窗大小改變時自動關閉。
 */
const MARGIN = 8;
/** 按鈕旁邊至少要有這麼多空間（直式看高度、橫式看寬度）才開在旁邊 */
const MIN_SIDE = 100;

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(v, max));

type Side = 'above' | 'below' | 'left' | 'right' | null;

export function bindMenu(anchors: HTMLElement | readonly HTMLElement[], menu: HTMLElement, onOpen?: () => void) {
  const list = Array.isArray(anchors) ? anchors : [anchors as HTMLElement];
  /** 目前是哪個按鈕開的 */
  let current: HTMLElement = list[0]!;

  const openAt = (anchor: HTMLElement) => {
    for (const a of list) a.setAttribute('aria-expanded', String(a === anchor));
    current = anchor;
    // 先回到左上角、拿掉上一次的大小限制再量：留著上一次的位置（可能在另一個按鈕旁邊）時，大小可能被畫面邊緣壓縮
    Object.assign(menu.style, { left: '0px', top: '0px', minWidth: '', maxWidth: '', maxHeight: '' });
    menu.hidden = false;
    menu.scrollTop = 0;
    const b = anchor.getBoundingClientRect();
    const natural = menu.getBoundingClientRect();
    const landscape = matchMedia('(orientation: landscape)').matches;
    const screenW = innerWidth - 2 * MARGIN;
    const screenH = innerHeight - 2 * MARGIN;
    // 可用空間：按鈕到畫面邊緣的距離，扣掉「選單與按鈕之間」和「選單與畫面邊緣之間」兩段邊距
    const room = {
      above: b.top - 2 * MARGIN,
      below: innerHeight - b.bottom - 2 * MARGIN,
      left: b.left - 2 * MARGIN,
      right: innerWidth - b.right - 2 * MARGIN,
    };

    // 1. 寬度：橫式先決定開在哪一側，寬度不超過那一側；直式不超過畫面寬
    let side: Side = null;
    if (landscape && Math.max(room.left, room.right) >= MIN_SIDE) {
      side = room.left >= natural.width || room.left >= room.right ? 'left' : 'right';
    }
    const width = Math.min(natural.width, side === 'left' || side === 'right' ? room[side] : screenW);
    // CSS 的 min-width 會蓋過 max-width，所以兩個一起設；變窄後文字換行、選單變高，所以設完寬度再量高度
    if (width < natural.width) Object.assign(menu.style, { minWidth: `${width}px`, maxWidth: `${width}px` });
    const measured = menu.getBoundingClientRect().height;

    // 2. 高度：直式決定開在上方或下方，高度不超過那一側；橫式不超過畫面高
    if (!landscape && Math.max(room.above, room.below) >= MIN_SIDE) {
      side = room.above >= measured || room.above >= room.below ? 'above' : 'below';
    }
    const height = Math.min(measured, side === 'above' || side === 'below' ? room[side] : screenH);
    menu.style.maxHeight = `${height}px`;

    // 3. 位置：貼著按鈕的那一側；兩側都不夠時以按鈕為中心
    const centerX = b.left + b.width / 2 - width / 2;
    const centerY = b.top + b.height / 2 - height / 2;
    const left = side === 'left' ? b.left - MARGIN - width : side === 'right' ? b.right + MARGIN : centerX;
    const top = side === 'above' ? b.top - MARGIN - height : side === 'below' ? b.bottom + MARGIN : side ? b.top : centerY;

    // 4. 最後一律限制在畫面內
    menu.style.left = `${clamp(left, MARGIN, innerWidth - width - MARGIN)}px`;
    menu.style.top = `${clamp(top, MARGIN, innerHeight - height - MARGIN)}px`;
    onOpen?.();
  };
  const close = () => {
    menu.hidden = true;
    for (const a of list) a.setAttribute('aria-expanded', 'false');
  };
  for (const anchor of list) {
    anchor.addEventListener('click', () => (!menu.hidden && current === anchor ? close() : openAt(anchor)));
  }
  document.addEventListener('pointerdown', (e) => {
    const target = e.target as Node;
    if (!menu.hidden && !menu.contains(target) && !list.some((a) => a.contains(target))) close();
  });
  addEventListener('resize', close);
  return {
    close,
    get isOpen() {
      return !menu.hidden;
    },
    /** 目前開著選單的按鈕（關閉後是最後一次開啟的那個） */
    get anchor() {
      return current;
    },
  };
}
