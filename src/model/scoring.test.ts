import { describe, expect, it } from 'vitest';
import { simulate } from '../anim/simulation';
import { isBeyondArc } from '../court/fiba';
import { loadPlay } from '../plays/instantiate';
import { PLAYS } from '../plays/library';
import { evaluate } from '../sim/evaluate';
import { commentText } from '../i18n/describe';
import { createDefaultTactic } from './defaults';
import { insertFrameAfter, syncFrames } from './frames';
import { putPath } from './paths';
import { SCORING_RULES, scoreOf } from './scoring';
import { parseTactic, toJsonFile } from './serialize';
import type { ScoringRule, Tactic } from './types';

const roles = { A: 'b1', B: 'b2', C: 'b3' } as const;
const run = (name: string, scoring: ScoringRule) => {
  const base = createDefaultTactic();
  base.scoring = scoring;
  const t = loadPlay(base, PLAYS.find((p) => p.name === name)!, roles);
  return evaluate(t, simulate(t));
};

describe('計分規則', () => {
  it('0–100 分 = 預期得分 ÷ 弧內一球的分數 × 100（有效命中率），上限 100', () => {
    expect(scoreOf(0.68, SCORING_RULES.fiba3x3)).toBeCloseTo(68);
    expect(scoreOf(1.36, SCORING_RULES.standard)).toBeCloseTo(68);
    expect(scoreOf(1.35, SCORING_RULES.standard)).toBeCloseTo(67.5);
    expect(scoreOf(1.2, SCORING_RULES.fiba3x3)).toBe(100);
  });

  it('弧內出手：一般規則的預期得分是 FIBA 的 2 倍，0–100 分與評等相同', () => {
    for (const name of ['Pick and Roll', 'Floater', 'Backdoor Cut']) {
      const fiba = run(name, 'fiba3x3');
      const std = run(name, 'standard');
      expect(isBeyondArc(fiba.shot.at)).toBe(false);
      expect(std.expectedPoints!).toBeCloseTo(fiba.expectedPoints! * 2);
      expect(std.score!).toBeCloseTo(fiba.score!);
      expect(std.grade).toBe(fiba.grade);
    }
  });

  it('弧外出手：一般規則 3 分 vs 弧內 2 分（1.5 倍），比 FIBA 的 2 倍低，0–100 分變低', () => {
    const name = PLAYS.map((p) => p.name).find((n) => isBeyondArc(run(n, 'fiba3x3').shot.at))!;
    const fiba = run(name, 'fiba3x3');
    const std = run(name, 'standard');
    expect(fiba.shot.points).toBe(2);
    expect(std.shot.points).toBe(3);
    expect(std.expectedPoints!).toBeCloseTo(fiba.expectedPoints! * 1.5);
    expect(std.score!).toBeLessThan(fiba.score!);
  });

  it('進攻時限跟著規則：同樣 15 秒才出手，FIBA 3x3 違例，一般規則不違例', () => {
    const make = (scoring: ScoringRule): Tactic => {
      const t = createDefaultTactic();
      t.scoring = scoring;
      // 1 號在底線兩側來回運球拖時間，最後投籃
      for (let i = 0; i < 6; i++) {
        const f = t.frames[i]!;
        const to = i % 2 === 0 ? { x: -6.5, y: 8 } : { x: 6.5, y: 8 };
        putPath(f, { id: `d${i}`, kind: 'dribble', actorId: 'b1', points: [f.start.b1!, to], freehand: false });
        insertFrameAfter(t, i);
      }
      const last = t.frames.at(-1)!;
      putPath(last, { id: 's', kind: 'shot', actorId: 'b1', points: [last.start.b1!, { x: 0, y: 1.575 }], freehand: false });
      syncFrames(t, true);
      return t;
    };
    const fiba = make('fiba3x3');
    const std = make('standard');
    const e1 = evaluate(fiba, simulate(fiba));
    const e2 = evaluate(std, simulate(std));
    expect(e1.releaseAt).toBeGreaterThan(12);
    expect(e1.releaseAt).toBeLessThan(24);
    expect(e1.violation).toBe(true);
    expect(e1.expectedPoints).toBe(0);
    expect(e2.violation).toBe(false);
    expect(e2.comments.some((c) => commentText(c.message, std.players).includes('24 秒進攻時限內'))).toBe(true);
  });

  it('舊資料沒有計分規則時當作 FIBA 3x3；沒有 0–100 分時依規則換算', () => {
    const data = JSON.parse(toJsonFile(createDefaultTactic())) as Record<string, unknown>;
    delete data.scoring;
    data.lastResult = { grade: 'A', expectedPoints: 0.68 };
    const { tactic } = parseTactic(data);
    expect(tactic.scoring).toBe('fiba3x3');
    expect(tactic.lastResult!.score).toBeCloseTo(68);
    data.scoring = 'standard';
    data.lastResult = { grade: 'A', expectedPoints: 1.36 };
    expect(parseTactic(data).tactic.lastResult!.score).toBeCloseTo(68);
  });
});
