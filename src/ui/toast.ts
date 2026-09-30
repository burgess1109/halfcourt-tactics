/** 底部的短暫提示訊息 */
export function createToast(el: HTMLElement): (message: string) => void {
  let timer: number | undefined;
  return (message) => {
    el.textContent = message;
    el.hidden = false;
    clearTimeout(timer);
    timer = window.setTimeout(() => {
      el.hidden = true;
    }, 2000);
  };
}
