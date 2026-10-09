import { truncateText } from '../model/text';
import { TACTIC_NAME_MAX, nameError } from '../model/serialize';

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

/**
 * 輸入戰術名稱的對話框（SPEC §8：存檔時沒有名稱會要求輸入）。
 * 回傳去掉前後空白的名稱；取消時回傳 null。
 */
export function askName(opts: { title: string; initial: string; confirm: string }): Promise<string | null> {
  const dialog = $<HTMLDialogElement>('#name-dialog');
  const form = $<HTMLFormElement>('#name-form');
  const input = $<HTMLInputElement>('#name-input');
  const error = $<HTMLElement>('#name-error');
  const ok = $<HTMLButtonElement>('#name-ok');
  const cancel = $<HTMLButtonElement>('#name-cancel');

  $('#name-title').textContent = opts.title;
  ok.textContent = opts.confirm;
  input.maxLength = TACTIC_NAME_MAX;
  input.value = truncateText(opts.initial, TACTIC_NAME_MAX);
  error.hidden = true;

  return new Promise((resolve) => {
    let result: string | null = null;
    const onSubmit = (e: SubmitEvent) => {
      e.preventDefault();
      const message = nameError(input.value);
      if (message) {
        error.textContent = message;
        error.hidden = false;
        input.focus();
        return;
      }
      result = input.value.trim();
      dialog.close();
    };
    const onCancel = () => dialog.close();
    const onBackdrop = (e: MouseEvent) => {
      if (e.target === dialog) dialog.close();
    };
    const onClose = () => {
      form.removeEventListener('submit', onSubmit);
      cancel.removeEventListener('click', onCancel);
      dialog.removeEventListener('click', onBackdrop);
      resolve(result);
    };
    form.addEventListener('submit', onSubmit);
    cancel.addEventListener('click', onCancel);
    dialog.addEventListener('click', onBackdrop);
    dialog.addEventListener('close', onClose, { once: true });
    dialog.showModal();
    input.select();
  });
}
