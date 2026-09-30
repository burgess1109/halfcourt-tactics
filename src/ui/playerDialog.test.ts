import { describe, expect, it } from 'vitest';
import { createDefaultTactic } from '../model/defaults';
import { parsePlayerForm } from './playerDialog';

const base = { number: '7', name: '阿明', position: '', height: '', weight: '' };

describe('球員表單驗證', () => {
  const { players } = createDefaultTactic();
  const b1 = players.find((p) => p.id === 'b1')!;

  it('合法輸入；選填欄位留空為 undefined', () => {
    const r = parsePlayerForm(base, b1, players);
    expect(r).toEqual({ ok: { number: 7, name: '阿明', position: undefined, heightCm: undefined, weightKg: undefined } });
  });

  it('位置可重複，身高體重在範圍內', () => {
    const r = parsePlayerForm({ ...base, position: 'SF', height: '201', weight: '98' }, b1, players);
    expect(r).toMatchObject({ ok: { position: 'SF', heightCm: 201, weightKg: 98 } });
  });

  it('同隊號碼不能重複，不同隊可以', () => {
    expect(parsePlayerForm({ ...base, number: '2' }, b1, players)).toMatchObject({ field: 'number' });
    const r1 = players.find((p) => p.id === 'r1')!;
    expect(parsePlayerForm({ ...base, number: '2' }, r1, players)).toMatchObject({ field: 'number' });
    expect(parsePlayerForm({ ...base, number: '1' }, r1, players)).toHaveProperty('ok');
  });

  it('不合法的輸入指出欄位', () => {
    expect(parsePlayerForm({ ...base, number: '100' }, b1, players)).toMatchObject({ field: 'number' });
    expect(parsePlayerForm({ ...base, number: '3.5' }, b1, players)).toMatchObject({ field: 'number' });
    expect(parsePlayerForm({ ...base, name: '   ' }, b1, players)).toMatchObject({ field: 'name' });
    expect(parsePlayerForm({ ...base, name: '一二三四五六七八九十一二三' }, b1, players)).toMatchObject({ field: 'name' });
    expect(parsePlayerForm({ ...base, height: '149' }, b1, players)).toMatchObject({ field: 'height' });
    expect(parsePlayerForm({ ...base, weight: '151' }, b1, players)).toMatchObject({ field: 'weight' });
  });
});
