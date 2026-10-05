import { describe, expect, it } from 'vitest';
import { createDefaultTactic } from './defaults';
import { DEFAULT_SKILLS } from './physique';
import { applyPatch, isBlueComplete, parseTeamForm, type PlayerFormValues } from './playerForm';

const row = (id: string, number: string, over: Partial<PlayerFormValues> = {}): PlayerFormValues => ({
  id,
  number,
  name: `球員 ${number}`,
  height: '',
  skills: { ...DEFAULT_SKILLS },
  ...over,
});

describe('設定頁表單', () => {
  it('合法輸入；身高留空為 undefined', () => {
    const r = parseTeamForm([row('b1', '0'), row('b2', '23', { height: '201' }), row('b3', '99')]);
    expect('ok' in r && r.ok.map((p) => [p.number, p.heightCm])).toEqual([
      [0, undefined],
      [23, 201],
      [99, undefined],
    ]);
  });

  it('同隊號碼重複，指出後面那個人', () => {
    expect(parseTeamForm([row('b1', '7'), row('b2', '7'), row('b3', '3')])).toMatchObject({ id: 'b2', field: 'number' });
  });

  it('不合法的輸入指出欄位', () => {
    expect(parseTeamForm([row('b1', '100'), row('b2', '2'), row('b3', '3')])).toMatchObject({ field: 'number' });
    expect(parseTeamForm([row('b1', '1', { name: '  ' }), row('b2', '2'), row('b3', '3')])).toMatchObject({ field: 'name' });
    expect(parseTeamForm([row('b1', '1', { name: '一二三四五六七八九十一二三' }), row('b2', '2'), row('b3', '3')])).toMatchObject({ field: 'name' });
    expect(parseTeamForm([row('b1', '1', { height: '149' }), row('b2', '2'), row('b3', '3')])).toMatchObject({ field: 'height' });
    expect(parseTeamForm([row('b1', '1', { height: '190.5' }), row('b2', '2'), row('b3', '3')])).toMatchObject({ field: 'height' });
  });

  it('寫回球員：身高清空時刪除欄位，紅隊不寫入能力', () => {
    const t = createDefaultTactic();
    const b1 = t.players.find((p) => p.id === 'b1')!;
    b1.heightCm = 190;
    applyPatch(b1, { id: 'b1', number: 5, name: '阿明', heightCm: undefined, skills: { ...DEFAULT_SKILLS, threePoint: 4 } });
    expect(b1).not.toHaveProperty('heightCm');
    expect(b1.skills!.threePoint).toBe(4);
    const r1 = t.players.find((p) => p.id === 'r1')!;
    applyPatch(r1, { id: 'r1', number: 5, name: '對手', heightCm: 200, skills: DEFAULT_SKILLS });
    expect(r1).not.toHaveProperty('skills');
  });

  it('資料完整 = 沒略過且藍隊三人都有身高', () => {
    const t = createDefaultTactic();
    expect(isBlueComplete(t.players, false)).toBe(false);
    for (const p of t.players) if (p.team === 'blue') p.heightCm = 190;
    expect(isBlueComplete(t.players, false)).toBe(true);
    expect(isBlueComplete(t.players, true)).toBe(false);
  });

  it('紅隊速度：平均不另外存，其他等級寫回；藍隊不寫入紅隊速度', () => {
    const t = createDefaultTactic();
    const r1 = t.players.find((p) => p.id === 'r1')!;
    applyPatch(r1, { id: 'r1', number: 1, name: '對手 1', heightCm: undefined, speedRating: 0 });
    expect(r1.speedRating).toBe(0);
    applyPatch(r1, { id: 'r1', number: 1, name: '對手 1', heightCm: undefined, speedRating: 2 });
    expect(r1).not.toHaveProperty('speedRating');
    const b1 = t.players.find((p) => p.id === 'b1')!;
    applyPatch(b1, { id: 'b1', number: 1, name: '球員 1', heightCm: undefined, skills: { ...DEFAULT_SKILLS }, speedRating: 4 });
    expect(b1).not.toHaveProperty('speedRating');
  });
});
