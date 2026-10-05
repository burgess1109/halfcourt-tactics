import { describe, expect, it } from 'vitest';
import { buildTimeline, possessionSeconds, screensOf } from '../anim/timeline';
import { SCORING_RULES } from '../model/scoring';
import { createDefaultTactic } from '../model/defaults';
import { MAX_FRAMES } from '../model/frames';
import { simulateDefense } from '../sim/defenseSim';
import { isBeyondArc } from '../court/fiba';
import { PLAYS, SHOT_LABEL, playVariants } from './library';
import { zoneOf } from '../sim/evaluate';
import { loadPlay } from './instantiate';

const roles = { A: 'b1', B: 'b2', C: 'b3' } as const;

describe('內建戰術庫', () => {
  it('共 22 套，id 不重複', () => {
    expect(PLAYS).toHaveLength(22);
    expect(new Set(PLAYS.map((p) => p.id)).size).toBe(22);
  });

  // 跳投戰術的兩個出手點都要檢查
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
      // 跳投戰術：實際出手的區域就是這個版本標示的出手點
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

  it('跳投戰術有兩個出手點（中距離、弧外），終結者的投射權重跟著出手點；切入戰術只有一個', () => {
    const jumpers = PLAYS.filter((p) => p.alt);
    expect(jumpers.map((p) => p.id).sort()).toEqual([
      'dho-chicago',
      'dho-shoot',
      'high-pnr-pop',
      'high-pnr-pullup',
      'high-pnr-spain',
      'iso-kick',
      'offball-down',
      'offball-flare',
      'offball-post-split',
    ]);
    for (const play of jumpers) {
      const [a, b] = playVariants(play);
      expect(new Set([a!.shot, b!.shot])).toEqual(new Set(['mid', 'three']));
      for (const v of [a!, b!]) {
        const w = v.weights[v.finisher];
        expect(w[v.shot === 'mid' ? 'midRange' : 'threePoint'], `${v.id}（${v.shot}）`).toBeGreaterThan(0);
        expect(w[v.shot === 'mid' ? 'threePoint' : 'midRange'], `${v.id}（${v.shot}）`).toBeUndefined();
      }
    }
    for (const play of PLAYS.filter((p) => !p.alt)) expect(playVariants(play)).toHaveLength(1);
  });
});
