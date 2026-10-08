import { afterEach, describe, expect, it } from 'vitest';
import { simulate } from '../anim/simulation';
import { createDefaultTactic, displayName } from '../model/defaults';
import { cannotStart } from '../model/paths';
import { parseTeamForm } from '../model/playerForm';
import { parseTactic } from '../model/serialize';
import type { Tactic } from '../model/types';
import { loadPlay } from '../plays/instantiate';
import { PLAYS, playVariants } from '../plays/library';
import { rankBySimulation, teamSummary } from '../plays/recommend';
import { evaluate } from '../sim/evaluate';
import { lookup } from '../ui/i18nDom';
import { adviceText, commentText, edgeText, playTitle, reasonText, styleText } from './describe';
import { MESSAGES, detectLocale, getLocale, setLocale, t } from '.';
import html from '../../index.html?raw';

/** 中日韓文字（英文介面不能出現） */
const CJK = /[　-〿㐀-鿿＀-￯]/;

/** 文字表的結構：每個葉節點記成「字串」或「函式（參數個數）」 */
function shape(v: unknown): unknown {
  if (typeof v === 'string') return 'string';
  if (typeof v === 'function') return `function/${v.length}`;
  return Object.fromEntries(Object.entries(v as object).map(([k, x]) => [k, shape(x)]));
}

/** 所有葉節點：[路徑, 值] */
function leaves(v: unknown, path = ''): [string, unknown][] {
  if (typeof v !== 'object' || v === null) return [[path, v]];
  return Object.entries(v).flatMap(([k, x]) => leaves(x, path ? `${path}.${k}` : k));
}

afterEach(() => setLocale('zh'));

describe('文字表', () => {
  it('預設是繁體中文', () => {
    expect(getLocale()).toBe('zh');
    expect(t().app.title).toBe('半場戰術板');
  });

  it('繁體中文與英文的項目完全一致（包括函式的參數個數）', () => {
    expect(shape(MESSAGES.en)).toEqual(shape(MESSAGES.zh));
  });

  it('英文表沒有中文字（函式檢查原始碼）', () => {
    for (const [path, v] of leaves(MESSAGES.en)) {
      const text = typeof v === 'function' ? v.toString() : String(v);
      expect(text, path).not.toMatch(CJK);
    }
  });

  it('沒有空字串', () => {
    for (const locale of ['zh', 'en'] as const) {
      for (const [path, v] of leaves(MESSAGES[locale])) if (typeof v === 'string') expect(v, `${locale} ${path}`).not.toBe('');
    }
  });

  it('index.html 的 data-i18n 標記在兩種語系都找得到文字', () => {
    const keys = [...html.matchAll(/data-i18n(?:-tip|-aria)?="([^"]+)"/g)].map((m) => m[1]!);
    expect(keys.length).toBeGreaterThan(40);
    for (const key of keys) {
      expect(lookup(MESSAGES.zh, key), key).not.toBeNull();
      expect(lookup(MESSAGES.en, key), key).not.toBeNull();
    }
  });
});

describe('語系選擇', () => {
  it('選過的語系優先；沒有時依瀏覽器語言，中文用繁體中文、其他用英文', () => {
    expect(detectLocale('en', ['zh-TW'])).toBe('en');
    expect(detectLocale('zh', ['en-US'])).toBe('zh');
    expect(detectLocale(null, ['zh-TW', 'en'])).toBe('zh');
    expect(detectLocale(null, ['zh-CN'])).toBe('zh');
    expect(detectLocale(null, ['en-US', 'zh-TW'])).toBe('en');
    expect(detectLocale(null, ['ja'])).toBe('en');
    expect(detectLocale('xx', [])).toBe('zh');
    // 瀏覽器完全沒有提供語言：繁體中文
    expect(detectLocale(null, [])).toBe('zh');
    expect(detectLocale(null, [undefined])).toBe('zh');
  });

  it('預設暱稱不寫進資料，顯示時依目前語系組出來；自己取的暱稱（就算和預設暱稱一樣）原樣顯示', () => {
    const tactic = createDefaultTactic();
    expect(tactic.players.every((p) => p.name === '')).toBe(true);
    const b1 = tactic.players.find((p) => p.id === 'b1')!;
    const r2 = tactic.players.find((p) => p.id === 'r2')!;
    const b3 = tactic.players.find((p) => p.id === 'b3')!;
    b3.name = '球員 2';
    expect([displayName(b1), displayName(r2), displayName(b3)]).toEqual(['球員 1', '對手 2', '球員 2']);
    setLocale('en');
    expect([displayName(b1), displayName(r2), displayName(b3)]).toEqual(['Player 1', 'Opponent 2', '球員 2']);
  });

  it('第 1 版的存檔：預設暱稱（任一語系）轉成空字串，自己取的不動', () => {
    const v1 = JSON.parse(JSON.stringify({ ...createDefaultTactic(), version: 1 }));
    const names: Record<string, string> = { b1: '球員 1', b2: 'Player 2', b3: '阿明', r1: '對手 1', r2: '球員 2', r3: 'Opponent 3' };
    for (const p of v1.players) p.name = names[p.id];
    const { tactic } = parseTactic(v1);
    expect(tactic.version).toBe(2);
    // r2 的「球員 2」不是 r2 位置的預設暱稱，是使用者自己取的
    expect(Object.fromEntries(tactic.players.map((p) => [p.id, p.name]))).toEqual({ b1: '', b2: '', b3: '阿明', r1: '', r2: '球員 2', r3: '' });
  });
});

describe('英文介面沒有殘留中文', () => {
  it('內建戰術的名稱、簡介、終結、角色（含每個出手點）', () => {
    setLocale('en');
    for (const play of PLAYS.flatMap(playVariants)) {
      for (const text of [playTitle(play), play.summary.en, play.finish.en, ...Object.values(play.roles).map((r) => r.en)]) {
        expect(text.trim(), play.id).not.toBe('');
        expect(text, play.id).not.toMatch(CJK);
      }
    }
  });

  it('評價、推薦理由、球隊總評', () => {
    setLocale('en');
    const base = createDefaultTactic();
    for (const p of base.players) p.heightCm = 185;
    base.players.find((p) => p.id === 'b2')!.heightCm = 200;
    base.players.find((p) => p.id === 'b3')!.skills!.threePoint = 4;
    const texts: string[] = [];
    for (const screenDefense of ['switch', 'fight-over'] as const) {
      for (const driveHelp of ['off', 'weak-side'] as const) {
        const tactic: Tactic = { ...base, screenDefense, driveHelp };
        const ranked = rankBySimulation(tactic);
        const summary = teamSummary(tactic, ranked);
        texts.push(adviceText(summary.advice, tactic), ...summary.strengths.flatMap((s) => [edgeText(s.edge), styleText(s)]));
        for (const r of ranked) {
          texts.push(reasonText(r.reason, r.play, tactic.players));
          const loaded = loadPlay(tactic, r.play, r.roles);
          texts.push(...evaluate(loaded, simulate(loaded)).comments.map((c) => commentText(c.message, loaded.players)));
        }
      }
    }
    // 沒有投籃、全部平均
    const blank = createDefaultTactic();
    texts.push(...evaluate(blank, simulate(blank)).comments.map((c) => commentText(c.message, blank.players)));
    texts.push(adviceText(teamSummary(blank).advice, blank), reasonText(rankBySimulation(blank)[0]!.reason, PLAYS[0]!, blank.players));
    for (const text of texts) expect(text).not.toMatch(CJK);
  });

  it('規則與驗證的訊息', () => {
    setLocale('en');
    const tactic = createDefaultTactic();
    const frame = tactic.frames[0]!;
    expect(cannotStart('dribble', 'b2', frame, tactic.players, true)).toBe('Only the ball handler can dribble');
    const form = parseTeamForm([{ id: 'b1', number: '100', name: 'A', height: '' }]);
    expect('error' in form && form.error).toMatch(/^Number must be/);
    expect(() => parseTactic({ version: 1 })).toThrow(/^Invalid play data: /);
  });
});
