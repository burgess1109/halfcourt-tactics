import { HEIGHT_RANGE } from './physique';
import type { Player, Rating, Skills } from './types';

// 設定頁的表單驗證（SPEC §3.1、§3.2），純函式方便測試。

export const NAME_MAX = 12;

export interface PlayerFormValues {
  id: string;
  number: string;
  name: string;
  height: string;
  /** 只有藍隊 */
  skills?: Skills;
  /** 只有紅隊 */
  speedRating?: Rating;
}

export type PlayerPatch = Pick<Player, 'id' | 'number' | 'name' | 'heightCm' | 'skills' | 'speedRating'>;

export type FormField = 'number' | 'name' | 'height';

export type TeamFormResult = { ok: PlayerPatch[] } | { error: string; id: string; field: FormField };

/** 驗證一隊三個人；號碼在同隊內不可重複 */
export function parseTeamForm(values: readonly PlayerFormValues[]): TeamFormResult {
  const out: PlayerPatch[] = [];
  const seen = new Map<number, string>();
  for (const v of values) {
    const num = Number(v.number);
    if (v.number.trim() === '' || !Number.isInteger(num) || num < 0 || num > 99) {
      return { error: '號碼要是 0–99 的整數', id: v.id, field: 'number' };
    }
    if (seen.has(num)) return { error: `號碼 ${num} 重複了`, id: v.id, field: 'number' };
    seen.set(num, v.id);

    const name = v.name.trim();
    if (name.length === 0 || name.length > NAME_MAX) {
      return { error: `暱稱要 1–${NAME_MAX} 個字`, id: v.id, field: 'name' };
    }

    let heightCm: number | undefined;
    if (v.height.trim() !== '') {
      const h = Number(v.height);
      if (!Number.isInteger(h) || h < HEIGHT_RANGE.min || h > HEIGHT_RANGE.max) {
        return { error: `身高要是 ${HEIGHT_RANGE.min}–${HEIGHT_RANGE.max} cm 的整數，或留空`, id: v.id, field: 'height' };
      }
      heightCm = h;
    }
    out.push({ id: v.id, number: num, name, heightCm, skills: v.skills, speedRating: v.speedRating });
  }
  return { ok: out };
}

/** 把表單結果寫回球員；選填欄位留空時刪除 */
export function applyPatch(player: Player, patch: PlayerPatch): void {
  player.number = patch.number;
  player.name = patch.name;
  if (patch.heightCm === undefined) delete player.heightCm;
  else player.heightCm = patch.heightCm;
  if (player.team === 'blue' && patch.skills) player.skills = { ...patch.skills };
  if (player.team === 'red') {
    // 平均是預設值，不另外存
    if (patch.speedRating === undefined || patch.speedRating === 2) delete player.speedRating;
    else player.speedRating = patch.speedRating;
  }
}

/** 資料完整（SPEC §3.1）：藍隊沒有略過，而且三人都填了身高 */
export function isBlueComplete(players: readonly Player[], blueSkipped: boolean): boolean {
  return !blueSkipped && players.filter((p) => p.team === 'blue').every((p) => p.heightCm !== undefined);
}
