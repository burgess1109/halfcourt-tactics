import { describe, expect, it } from 'vitest';
import { SHOT_CLOCK_SECONDS, buildTimeline, possessionSeconds, screensOf } from '../anim/timeline';
import { createDefaultTactic } from '../model/defaults';
import { MAX_FRAMES } from '../model/frames';
import { simulateDefense } from '../sim/defenseSim';
import { PLAYS } from './library';
import { loadPlay } from './instantiate';

const roles = { A: 'b1', B: 'b2', C: 'b3' } as const;

describe('內建戰術庫', () => {
  it('共 18 套，id 不重複', () => {
    expect(PLAYS).toHaveLength(18);
    expect(new Set(PLAYS.map((p) => p.id)).size).toBe(18);
  });

  for (const play of PLAYS) {
    describe(`${play.category}-${play.name}`, () => {
      it('可以載入，最後一個分鏡由終結者投籃，12 秒內出手', () => {
        const t = loadPlay(createDefaultTactic(), play, roles);
        expect(t.frames.length).toBe(play.frames.length);
        expect(t.frames.length).toBeLessThanOrEqual(MAX_FRAMES);
        const last = t.frames.at(-1)!;
        expect(last.paths.find((p) => p.kind === 'shot')?.actorId).toBe(roles[play.finisher]);
        const tl = buildTimeline(t);
        expect(possessionSeconds(tl)).toBeLessThan(SHOT_CLOCK_SECONDS);
        expect(t.basedOn).toMatchObject({ playId: play.id, modified: false });
      });

      it('每個掩護都真的擋到防守者（換防、擠過都一樣）', () => {
        for (const scheme of ['switch', 'fight-over'] as const) {
          const base = createDefaultTactic();
          base.screenDefense = scheme;
          const t = loadPlay(base, play, roles);
          const tl = buildTimeline(t);
          const screens = screensOf(t, tl);
          const events = simulateDefense(t, tl).events;
          expect(events.length, `${scheme}：${screens.length} 個掩護`).toBe(screens.length);
        }
      });
    });
  }

  it('載入不會改到內建戰術資料', () => {
    const before = JSON.stringify(PLAYS);
    const t = loadPlay(createDefaultTactic(), PLAYS[0]!, roles);
    t.frames[0]!.paths = [];
    expect(JSON.stringify(PLAYS)).toBe(before);
  });
});
