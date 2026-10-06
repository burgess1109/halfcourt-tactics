import { describe, expect, it } from 'vitest';
import { buildTimeline, possessionSeconds, screensOf } from '../anim/timeline';
import { SCORING_RULES } from '../model/scoring';
import { createDefaultTactic } from '../model/defaults';
import { MAX_FRAMES } from '../model/frames';
import { simulateDefense } from '../sim/defenseSim';
import { isBeyondArc } from '../court/fiba';
import { PLAYS, SHOT_LABEL, playVariant, playVariants } from './library';
import { zoneOf } from '../sim/evaluate';
import { loadPlay } from './instantiate';

const roles = { A: 'b1', B: 'b2', C: 'b3' } as const;

describe('內建戰術庫', () => {
  it('共 21 套，id 不重複', () => {
    expect(PLAYS).toHaveLength(21);
    expect(new Set(PLAYS.map((p) => p.id)).size).toBe(21);
  });

  // 每個出手點版本都要檢查
  for (const play of PLAYS.flatMap(playVariants)) {
    describe(`${play.category}-${play.name}${play.shot ? `（${SHOT_LABEL[play.shot]}）` : ''}`, () => {
      it('可以載入，最後一個分鏡由終結者投籃，12 秒內出手', () => {
        const t = loadPlay(createDefaultTactic(), play, roles);
        expect(t.frames.length).toBe(play.frames.length);
        expect(t.frames.length).toBeLessThanOrEqual(MAX_FRAMES);
        const last = t.frames.at(-1)!;
        expect(last.paths.find((p) => p.kind === 'shot')?.actorId).toBe(roles[play.finisher]);
        const tl = buildTimeline(t);
        // 內建戰術要在比較短的 FIBA 3x3 時限（12 秒）內出手
        expect(possessionSeconds(tl)).toBeLessThan(SCORING_RULES.fiba3x3.shotClock);
        expect(t.basedOn).toMatchObject({ playId: play.id, modified: false });
      });

      it('每個掩護都真的擋到防守者（換防、擠過都一樣）', () => {
        for (const scheme of ['switch', 'fight-over'] as const) {
          const base = createDefaultTactic();
          base.screenDefense = scheme;
          const t = loadPlay(base, play, roles);
          const tl = buildTimeline(t);
          const screens = screensOf(t, tl);
          // 只數掩護本身（沉退 / 上提是另外的協防事件）
          const events = simulateDefense(t, tl).events.filter((e) => e.type === 'switch' || e.type === 'fight-over');
          expect(events.length, `${scheme}：${screens.length} 個掩護`).toBe(screens.length);
        }
      });
    });
  }

  it('出手說明寫的分數和實際出手位置一致（弧外 2 分、弧內 1 分）', () => {
    for (const play of PLAYS.flatMap(playVariants)) {
      const t = loadPlay(createDefaultTactic(), play, roles);
      const last = t.frames.at(-1)!;
      const shot = last.paths.find((p) => p.kind === 'shot')!;
      const pos = last.start[shot.actorId]!;
      const beyondArc = isBeyondArc(pos);
      const note = play.frames.at(-1)!.note;
      expect(note, `${play.id}：${note}`).toContain(beyondArc ? '（2 分）' : '（1 分）');
      if (beyondArc) expect(note, play.id).toContain('弧外');
      // 有多個出手點的戰術：實際出手的區域就是這個版本標示的出手點
      if (play.shot) expect(zoneOf(pos), `${play.id}（${play.shot}）`).toBe(play.shot);
    }
    // 移動說明也統一用「弧外」，不混用「三分線外」
    for (const play of PLAYS.flatMap(playVariants)) for (const f of play.frames) expect(f.note, play.id).not.toContain('三分線');
  });

  it('載入不會改到內建戰術資料', () => {
    const before = JSON.stringify(PLAYS);
    const t = loadPlay(createDefaultTactic(), PLAYS[0]!, roles);
    t.frames[0]!.paths = [];
    expect(JSON.stringify(PLAYS)).toBe(before);
  });

  it('跳投戰術有中距離、弧外兩個出手點，終結者的投射權重跟著出手點；切入戰術只有一個', () => {
    const jumpers = PLAYS.filter((p) => p.alts);
    expect(jumpers.map((p) => p.id).sort()).toEqual([
      'dho-chicago',
      'dho-shoot',
      'high-pnr-pop',
      'high-pnr-pullup',
      'high-pnr-spain',
      'offball-down',
      'offball-flare',
      'offball-post-split',
    ]);
    for (const play of jumpers) {
      const variants = playVariants(play);
      const shots = variants.map((v) => v.shot);
      expect(new Set(shots).size, play.id).toBe(shots.length);
      expect(shots, play.id).toEqual(expect.arrayContaining(['mid', 'three']));
      for (const v of variants.filter((x) => x.shot !== 'paint')) {
        const w = v.weights[v.finisher];
        expect(v.finisher, `${v.id}（${v.shot}）`).toBe(play.finisher);
        expect(w[v.shot === 'mid' ? 'midRange' : 'threePoint'], `${v.id}（${v.shot}）`).toBeGreaterThan(0);
        expect(w[v.shot === 'mid' ? 'threePoint' : 'midRange'], `${v.id}（${v.shot}）`).toBeUndefined();
      }
    }
    for (const play of PLAYS.filter((p) => !p.alts)) expect(playVariants(play)).toHaveLength(1);
  });

  it('Spain Pick and Roll 的禁區出手點：跑位都一樣，最後一傳改傳給下順的 B、由 B 出手', () => {
    const spain = PLAYS.find((p) => p.id === 'high-pnr-spain')!;
    const before = JSON.stringify(spain);
    const paint = playVariant(spain, 'paint');
    expect(JSON.stringify(spain)).toBe(before);
    expect(paint).toMatchObject({ shot: 'paint', finisher: 'B' });
    expect(paint.weights.B.finishing).toBeGreaterThan(0);
    // 只有傳球對象與出手的人不同，其他路線（含 C 背掩護後外拉）都一樣
    paint.frames.forEach((f, i) => {
      const base = spain.frames[i]!;
      expect(f.paths.length).toBe(base.paths.length);
      f.paths.forEach((p, k) => {
        const b = base.paths[k]!;
        if (p.kind === 'pass') expect([b.target, p.target]).toEqual(['C', 'B']);
        else if (p.kind === 'shot') expect([b.actor, p.actor]).toEqual(['C', 'B']);
        else expect(p).toEqual(b);
      });
    });
    // B 在禁區接球出手
    const t = loadPlay(createDefaultTactic(), paint, roles);
    const last = t.frames.at(-1)!;
    const shot = last.paths.find((p) => p.kind === 'shot')!;
    expect(shot.actorId).toBe(roles.B);
    expect(zoneOf(last.start[shot.actorId]!)).toBe('paint');
  });
});
