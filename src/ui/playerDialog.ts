import { HEIGHT_RANGE, WEIGHT_RANGE, physique, speedOf } from '../model/physique';
import type { Store } from '../model/store';
import type { Player, Position } from '../model/types';

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

export const NAME_MAX = 12;

interface FormValues {
  number: string;
  name: string;
  position: string;
  height: string;
  weight: string;
}

/** 驗證並轉成球員欄位；失敗時回傳錯誤訊息與欄位名稱 */
export function parsePlayerForm(
  v: FormValues,
  player: Player,
  players: readonly Player[],
): { ok: Partial<Player> & Pick<Player, 'number' | 'name'> } | { error: string; field: keyof FormValues } {
  const num = Number(v.number);
  if (v.number.trim() === '' || !Number.isInteger(num) || num < 0 || num > 99) {
    return { error: '號碼要是 0–99 的整數', field: 'number' };
  }
  if (players.some((p) => p.team === player.team && p.id !== player.id && p.number === num)) {
    return { error: `同隊已經有 ${num} 號`, field: 'number' };
  }
  const name = v.name.trim();
  if (name.length === 0 || name.length > NAME_MAX) return { error: `名字要 1–${NAME_MAX} 個字`, field: 'name' };

  const optional = (raw: string, range: { min: number; max: number }) => {
    if (raw.trim() === '') return undefined;
    const n = Number(raw);
    return Number.isInteger(n) && n >= range.min && n <= range.max ? n : null;
  };
  const heightCm = optional(v.height, HEIGHT_RANGE);
  if (heightCm === null) return { error: `身高要是 ${HEIGHT_RANGE.min}–${HEIGHT_RANGE.max} cm 的整數，或留空`, field: 'height' };
  const weightKg = optional(v.weight, WEIGHT_RANGE);
  if (weightKg === null) return { error: `體重要是 ${WEIGHT_RANGE.min}–${WEIGHT_RANGE.max} kg 的整數，或留空`, field: 'weight' };

  return {
    ok: {
      number: num,
      name,
      position: (v.position || undefined) as Position | undefined,
      heightCm,
      weightKg,
    },
  };
}

/** 球員編輯面板（SPEC §3.1）。回傳 open(playerId)。 */
export function attachPlayerDialog(store: Store): (playerId: string) => void {
  const dialog = $<HTMLDialogElement>('#player-dialog');
  const form = $<HTMLFormElement>('#player-form');
  const chips = $<HTMLElement>('#player-chips');
  const errorEl = $<HTMLElement>('#player-error');
  const speedEl = $<HTMLElement>('#player-speed');
  const field = (name: keyof FormValues) => form.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement;
  let currentId = '';

  const values = (): FormValues => ({
    number: field('number').value,
    name: field('name').value,
    position: field('position').value,
    height: field('height').value,
    weight: field('weight').value,
  });

  const player = (id: string) => store.get().tactic.players.find((p) => p.id === id)!;

  const clearError = () => {
    errorEl.hidden = true;
    for (const el of form.querySelectorAll('[aria-invalid]')) el.removeAttribute('aria-invalid');
  };

  /** 依目前位置顯示身高體重的預設值，以及換算後的速度 */
  const preview = () => {
    const p = player(currentId);
    const position = (field('position').value || undefined) as Position | undefined;
    const d = physique({ ...p, position, heightCm: undefined, weightKg: undefined });
    field('height').setAttribute('placeholder', `預設 ${d.heightCm}`);
    field('weight').setAttribute('placeholder', `預設 ${d.weightKg}`);
    const parsed = parsePlayerForm(values(), p, store.get().tactic.players);
    if ('ok' in parsed) {
      const draft = { ...p, ...parsed.ok };
      speedEl.textContent = `跑動 ${speedOf(draft, false).toFixed(2)} m/s ・ 運球 ${speedOf(draft, true).toFixed(2)} m/s`;
    }
  };

  const load = (id: string) => {
    currentId = id;
    const p = player(id);
    field('number').value = String(p.number);
    field('name').value = p.name;
    field('position').value = p.position ?? '';
    field('height').value = p.heightCm?.toString() ?? '';
    field('weight').value = p.weightKg?.toString() ?? '';
    clearError();
    renderChips();
    preview();
  };

  const renderChips = () => {
    chips.replaceChildren();
    const { players } = store.get().tactic;
    players
      .slice()
      .sort((a, b) => (a.team === b.team ? 0 : a.team === 'blue' ? -1 : 1))
      .forEach((p, i, arr) => {
        if (i > 0 && arr[i - 1]!.team !== p.team) {
          const gap = document.createElement('span');
          gap.className = 'chips__gap';
          chips.append(gap);
        }
        const b = document.createElement('button');
        b.type = 'button';
        b.className = `chip chip--${p.team}`;
        b.role = 'tab';
        b.textContent = String(p.number);
        b.setAttribute('aria-label', `${p.team === 'blue' ? '藍隊' : '紅隊'} ${p.number} 號 ${p.name}`);
        b.setAttribute('aria-selected', String(p.id === currentId));
        b.addEventListener('click', () => {
          if (p.id !== currentId && save()) load(p.id);
        });
        chips.append(b);
      });
  };

  /** 套用目前表單；有錯誤時顯示並回傳 false。沒有改變就不算一步。 */
  const save = (): boolean => {
    const p = player(currentId);
    const parsed = parsePlayerForm(values(), p, store.get().tactic.players);
    if ('error' in parsed) {
      clearError();
      errorEl.textContent = parsed.error;
      errorEl.hidden = false;
      field(parsed.field).setAttribute('aria-invalid', 'true');
      field(parsed.field).focus();
      return false;
    }
    store.commit((s) => {
      const target = s.tactic.players.find((x) => x.id === currentId)!;
      target.number = parsed.ok.number;
      target.name = parsed.ok.name;
      // 選填欄位留空時刪除，讓資料保持精簡
      for (const key of ['position', 'heightCm', 'weightKg'] as const) {
        if (parsed.ok[key] === undefined) delete target[key];
        else (target as unknown as Record<string, unknown>)[key] = parsed.ok[key];
      }
    });
    return true;
  };

  form.addEventListener('input', () => {
    clearError();
    preview();
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (save()) dialog.close();
  });
  $<HTMLButtonElement>('#player-cancel').addEventListener('click', () => dialog.close());

  return (playerId: string) => {
    if (store.get().playing) return;
    load(playerId);
    dialog.showModal();
    field('name').focus();
  };
}
