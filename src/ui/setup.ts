import { defaultPlayer } from '../model/defaults';
import { assignMatchup, defaultMatchups } from '../model/matchups';
import { applyLineup, canApplyLineupNow, lineupOf, type Lineup } from '../model/lineup';
import { createLineupEditor } from './lineupEditor';
import {
  DEFAULT_SKILLS,
  RATINGS,
  RATING_LABEL,
  SKILL_KEYS,
  SKILL_LABEL,
  counterpartId,
  heightOf,
  speedOf,
} from '../model/physique';
import { applyPatch, parseTeamForm, type PlayerFormValues } from '../model/playerForm';
import type { EditorState, Store } from '../model/store';
import type { PickCoverage, Player, Pressure, Rating, Skills, Tactic, Team } from '../model/types';

// 進攻模式的設定流程（SPEC §1.1）：① 藍隊 → ② 紅隊 → ③ 對位 → 戰術面板。

export type Step = 1 | 2 | 3;

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

const STEP_TEXT: Record<Step, { title: string; hint: string }> = {
  1: { title: '你的球隊（藍隊）', hint: '都是選填。能力以場上六個人的平均為基準，預設平均；有填身高才會推薦內建戰術。' },
  2: { title: '對手（紅隊）', hint: '都是選填。身高沒填時跟藍隊同順序的球員一樣高；速度以場上六個人的平均為基準，預設平均。' },
  3: { title: '站位與對位', hint: '在小球場上擺好開局站位、指定誰持球，再設定紅隊誰盯誰。' },
};

const teamPlayers = (t: Tactic, team: Team) => t.players.filter((p) => p.team === team);

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> & Record<string, unknown> = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = String(v);
    else if (k.startsWith('data-') || k.startsWith('aria-') || k === 'role' || k === 'for') node.setAttribute(k, String(v));
    else (node as unknown as Record<string, unknown>)[k] = v;
  }
  node.append(...children);
  return node;
}

/** 依步驟切換、驗證並寫回戰術。回傳 open(step, focusPlayerId?)。 */
export function attachSetup(
  store: Store,
  show: (screen: 'home' | 'setup' | 'board') => void,
  notify: (message: string) => void,
): { open: (step: Step, focusPlayerId?: string) => void } {
  const form = $<HTMLFormElement>('#setup-form');
  const progress = $<HTMLElement>('#setup-progress');
  const title = $<HTMLElement>('#setup-title');
  const hint = $<HTMLElement>('#setup-hint');
  const errorEl = $<HTMLElement>('#setup-error');
  const back = $<HTMLButtonElement>('#setup-back');
  const skip = $<HTMLButtonElement>('#setup-skip');
  const next = $<HTMLButtonElement>('#setup-next');
  const tabs = [...document.querySelectorAll<HTMLButtonElement>('#setup-tabs [data-step]')];
  const tabList = $<HTMLElement>('#setup-tabs');

  let step: Step = 1;
  /**
   * 已經進過戰術面板：改成「藍隊 / 紅隊 / 對位」分頁，底部只有「完成」，
   * 沒有「略過」（資料已經設定好，略過會把它清回預設值）。
   */
  let boardReady = false;
  /** 對位頁的暫存，按下一步才寫回 */
  let draftMatchups: Record<string, string> = {};
  let draftCustomized = false;
  let draftScreen: Tactic['screenDefense'] = 'switch';
  let draftCoverage: PickCoverage = 'drop';
  let draftPressure: Pressure = 'normal';
  let draftLineup: Lineup = lineupOf(store.get().tactic);

  const tactic = () => store.get().tactic;

  // ---------- ① ② 球員卡 ----------

  const playerCard = (p: Player, index: number) => {
    const blue = p.team === 'blue';
    const card = el('fieldset', { class: `pcard pcard--${p.team}`, 'data-id': p.id });
    card.append(el('legend', {}, `${blue ? '藍隊' : '紅隊'}第 ${index + 1} 位`));

    const input = (name: string, label: string, attrs: Record<string, unknown>, optional = false) =>
      el(
        'label',
        { class: 'field' },
        el('span', {}, label, ...(optional ? [' ', el('small', {}, '選填')] : [])),
        el('input', { name, ...attrs }),
      );
    card.append(
      el(
        'div',
        { class: 'pcard__row' },
        input('number', '號碼', { type: 'number', inputMode: 'numeric', min: '0', max: '99', step: '1', value: String(p.number) }),
        input('name', '暱稱', { type: 'text', maxLength: 12, autocomplete: 'off', value: p.name }),
        input(
          'height',
          '身高 cm',
          { type: 'number', inputMode: 'numeric', min: '150', max: '230', step: '1', value: p.heightCm?.toString() ?? '' },
          true,
        ),
      ),
    );

    /** 五段按鈕：藍隊四項能力、紅隊速度共用 */
    const ratingRow = (name: string, legend: string, labels: Record<Rating, string>, value: Rating) => {
      const seg = el('div', { class: 'seg' });
      for (const r of RATINGS) {
        seg.append(
          el(
            'label',
            {},
            el('input', { type: 'radio', name, value: String(r), checked: value === r }),
            el('span', {}, labels[r]),
          ),
        );
      }
      return el('fieldset', { class: 'skill' }, el('legend', {}, legend), seg);
    };
    if (blue) {
      const skills = p.skills ?? DEFAULT_SKILLS;
      for (const key of SKILL_KEYS) card.append(ratingRow(`${p.id}-${key}`, SKILL_LABEL[key], RATING_LABEL, skills[key]));
    } else {
      card.append(ratingRow(`${p.id}-speed`, '速度', RATING_LABEL, p.speedRating ?? 2));
    }
    card.append(el('p', { class: 'pcard__speed', 'aria-live': 'polite' }));
    return card;
  };

  /** 從畫面讀出一隊的表單值 */
  const readTeam = (team: Team): PlayerFormValues[] =>
    teamPlayers(tactic(), team).map((p) => {
      const card = form.querySelector<HTMLElement>(`[data-id="${p.id}"]`)!;
      const value = (name: string) => card.querySelector<HTMLInputElement>(`input[name="${name}"]`)!.value;
      const pick = (key: string) =>
        Number(card.querySelector<HTMLInputElement>(`input[name="${p.id}-${key}"]:checked`)!.value) as Rating;
      const skills: Skills | undefined =
        team === 'blue'
          ? { shooting: pick('shooting'), speed: pick('speed'), finishing: pick('finishing'), iso: pick('iso') }
          : undefined;
      const speedRating = team === 'red' ? pick('speed') : undefined;
      return { id: p.id, number: value('number'), name: value('name'), height: value('height'), skills, speedRating };
    });

  /** 依目前輸入更新身高預設提示與速度 */
  const refreshCards = () => {
    const team: Team = step === 1 ? 'blue' : 'red';
    const values = readTeam(team);
    const players = tactic().players;
    for (const v of values) {
      const card = form.querySelector<HTMLElement>(`[data-id="${v.id}"]`)!;
      const base = players.find((p) => p.id === v.id)!;
      const h = Number(v.height);
      const draft: Player = {
        ...base,
        heightCm: v.height.trim() && Number.isFinite(h) ? h : undefined,
        skills: v.skills ?? base.skills,
        speedRating: v.speedRating ?? base.speedRating,
      };
      const heightInput = card.querySelector<HTMLInputElement>('input[name="height"]')!;
      const fallback = heightOf({ ...draft, heightCm: undefined }, players);
      const blue = players.find((p) => p.id === counterpartId(v.id));
      heightInput.placeholder =
        team === 'red' && blue?.heightCm !== undefined ? `同藍 ${fallback}` : `預設 ${fallback}`;
      const all = players.map((p) => (p.id === draft.id ? draft : p));
      card.querySelector('.pcard__speed')!.textContent =
        `跑動 ${speedOf(draft, all, false).toFixed(2)} m/s ・ 運球 ${speedOf(draft, all, true).toFixed(2)} m/s`;
    }
  };

  // ---------- ③ 對位 ----------

  const renderMatchups = () => {
    const t = tactic();
    const players = t.players;
    const red = teamPlayers(t, 'red');
    const label = (p: Player) => `${p.number} 號 ${p.name}（${heightOf(p, players)} cm）`;
    form.replaceChildren();

    // 開局站位：小球場自由放置（紅隊依目前的對位即時站好）
    form.append(el('h3', { class: 'setup__section' }, '開局站位'));
    form.append(
      createLineupEditor({
        players,
        matchups: draftMatchups,
        pressure: draftPressure,
        lineup: draftLineup,
        onChange: (next) => {
          draftLineup = next;
        },
      }),
    );
    form.append(el('h3', { class: 'setup__section' }, '對位'));

    for (const b of teamPlayers(t, 'blue')) {
      const r = players.find((p) => p.id === draftMatchups[b.id])!;
      const select = el('select', { 'aria-label': `${b.name} 的對位` });
      for (const opt of red) select.append(el('option', { value: opt.id, selected: opt.id === r.id }, label(opt)));
      select.addEventListener('change', () => {
        draftMatchups = assignMatchup(draftMatchups, b.id, select.value);
        draftCustomized = true;
        renderMatchups();
      });

      const dh = heightOf(b, players) - heightOf(r, players);
      const dv = speedOf(b, players, false) / speedOf(r, players, false) - 1;
      const diff = (text: string, v: number) => el('span', { class: v > 0 ? 'adv' : v < 0 ? 'disadv' : '' }, text);
      form.append(
        el(
          'div',
          { class: 'mrow' },
          el('div', { class: 'mrow__blue' }, label(b)),
          el('span', { class: 'mrow__vs' }, '對'),
          select,
          el(
            'p',
            { class: 'mrow__diff' },
            '藍隊的優勢：',
            diff(`身高 ${dh >= 0 ? '+' : ''}${dh} cm`, dh),
            ' ・ ',
            diff(`速度 ${dv >= 0 ? '+' : ''}${Math.round(dv * 100)}%`, Math.round(dv * 100)),
          ),
        ),
      );
    }

    if (draftCustomized) {
      const reset = el('button', { type: 'button', class: 'link-btn' }, '恢復預設對位');
      reset.addEventListener('click', () => {
        draftMatchups = defaultMatchups(players);
        draftCustomized = false;
        renderMatchups();
      });
      form.append(reset);
    }

    // 防守距離：改了之後重畫，小球場上的紅隊跟著換位置
    const pressure = el('fieldset', { class: 'choice' }, el('legend', {}, '紅隊的防守距離'));
    const pressureOption = (value: Pressure, text: string, desc: string) => {
      const radio = el('input', { type: 'radio', name: 'pressure', value, checked: draftPressure === value });
      radio.addEventListener('change', () => {
        draftPressure = value;
        renderMatchups();
      });
      return el('label', {}, radio, el('span', {}, text, el('small', {}, desc)));
    };
    pressure.append(
      pressureOption('normal', '一般（預設）', '防持球者 1.5 m、防無球者 2.0 m，外圍無球者平常守在內側，對方往外跑才阻絕'),
      pressureOption('tight', '緊貼', '貼近對位者，外圍一律阻絕傳球路線：出手和外圍接球比較難，但切入、背切比較容易甩開防守者'),
    );
    form.append(pressure);

    const choice = el('fieldset', { class: 'choice' }, el('legend', {}, '遇到掩護時，紅隊要'));
    // 進階：擠過時，擋拆由掩護者的防守者沉退或上提（換防時用不到，隱藏）
    const coverage = el('fieldset', { class: 'choice choice--sub' }, el('legend', {}, '擋拆時，盯掩護者的防守者要'));
    const option = (value: Tactic['screenDefense'], text: string, desc: string) => {
      const radio = el('input', { type: 'radio', name: 'screen', value, checked: draftScreen === value });
      radio.addEventListener('change', () => {
        draftScreen = value;
        coverage.hidden = draftScreen !== 'fight-over';
      });
      return el('label', {}, radio, el('span', {}, text, el('small', {}, desc)));
    };
    const coverageOption = (value: PickCoverage, text: string, desc: string) => {
      const radio = el('input', { type: 'radio', name: 'pick-coverage', value, checked: draftCoverage === value });
      radio.addEventListener('change', () => (draftCoverage = value));
      return el('label', {}, radio, el('span', {}, text, el('small', {}, desc)));
    };
    coverage.append(
      coverageOption('drop', '沉退 Drop（預設）', '退到罰球線下方保護籃下：切入和順下比較難，但中距離以外急停跳投、掩護者拉開會比較空'),
      coverageOption('hedge', '上提 Hedge', '踏出去擋在持球者前面干擾投籃：持球者不好直接出手，但掩護者順下會比較空'),
    );
    coverage.hidden = draftScreen !== 'fight-over';
    choice.append(
      option('switch', '換防（預設）', '兩位防守者交換對位，可能形成身高錯位'),
      option('fight-over', '擠過', '被掩護的人繞過掩護繼續盯原本的人，會慢一步'),
      coverage,
    );
    form.append(choice);
  };

  // ---------- 切換步驟 ----------

  const clearError = () => {
    errorEl.hidden = true;
    for (const x of form.querySelectorAll('[aria-invalid]')) x.removeAttribute('aria-invalid');
  };

  const render = () => {
    clearError();
    progress.textContent = `${step} / 3`;
    progress.hidden = boardReady;
    tabList.hidden = !boardReady;
    for (const tab of tabs) tab.setAttribute('aria-selected', String(Number(tab.dataset.step) === step));
    title.textContent = STEP_TEXT[step].title;
    hint.textContent = STEP_TEXT[step].hint;
    back.hidden = boardReady;
    back.textContent = step === 1 ? '回首頁' : '上一步';
    skip.hidden = boardReady || step === 3;
    next.textContent = boardReady ? '完成' : step === 3 ? '開始' : '下一步';

    if (step === 3) {
      renderMatchups();
    } else {
      const team: Team = step === 1 ? 'blue' : 'red';
      form.replaceChildren(...teamPlayers(tactic(), team).map((p, i) => playerCard(p, i)));
      refreshCards();
    }
    form.scrollTop = 0;
  };

  /** 進入對位頁前：沒改過對位就重新套用預設 */
  const loadMatchupDraft = () => {
    const t = tactic();
    draftCustomized = t.setup.matchupsCustomized;
    draftMatchups = draftCustomized ? { ...t.matchups } : defaultMatchups(t.players);
    draftScreen = t.screenDefense;
    draftCoverage = t.pickCoverage;
    draftPressure = t.pressure;
    draftLineup = lineupOf(t);
  };

  /** 寫回球員後，若沒改過對位就跟著更新預設對位 */
  const refreshDefaultMatchups = (s: EditorState) => {
    if (!s.tactic.setup.matchupsCustomized) s.tactic.matchups = defaultMatchups(s.tactic.players);
  };

  /** 驗證並寫回目前這一步；失敗時顯示錯誤並回傳 false */
  const saveStep = (): boolean => {
    if (step === 3) {
      const t = store.get().tactic;
      const lineupChanged = JSON.stringify(draftLineup) !== JSON.stringify(lineupOf(t));
      const applyNow = canApplyLineupNow(t);
      store.commit((s) => {
        s.tactic.matchups = { ...draftMatchups };
        s.tactic.setup.matchupsCustomized = draftCustomized;
        s.tactic.screenDefense = draftScreen;
        s.tactic.pickCoverage = draftCoverage;
        s.tactic.pressure = draftPressure;
        s.tactic.setup.lineup = structuredClone(draftLineup);
        // 還沒畫路線就直接套用；已經有路線時不動目前的戰術，避免路線變得不合理
        if (lineupChanged && applyNow) applyLineup(s.tactic.frames[0]!, draftLineup);
      });
      if (lineupChanged && !applyNow) notify('目前的戰術已經有路線，新的開局站位會在清空戰術或選空白戰術時生效');
      return true;
    }
    const team: Team = step === 1 ? 'blue' : 'red';
    const result = parseTeamForm(readTeam(team));
    if ('error' in result) {
      clearError();
      errorEl.textContent = result.error;
      errorEl.hidden = false;
      const input = form.querySelector<HTMLInputElement>(`[data-id="${result.id}"] input[name="${result.field}"]`)!;
      input.setAttribute('aria-invalid', 'true');
      input.focus();
      return false;
    }
    store.commit((s) => {
      for (const patch of result.ok) applyPatch(s.tactic.players.find((p) => p.id === patch.id)!, patch);
      if (team === 'blue') s.tactic.setup.blueSkipped = false;
      else s.tactic.setup.redSkipped = false;
      refreshDefaultMatchups(s);
    });
    return true;
  };

  const goto = (to: Step) => {
    step = to;
    if (to === 3) loadMatchupDraft();
    render();
  };

  const finish = () => {
    boardReady = true;
    show('board');
  };

  next.addEventListener('click', () => {
    if (!saveStep()) return;
    if (step === 3 || boardReady) finish();
    else goto((step + 1) as Step);
  });

  for (const tab of tabs) {
    tab.addEventListener('click', () => {
      const to = Number(tab.dataset.step) as Step;
      if (to !== step && saveStep()) goto(to);
    });
  }

  back.addEventListener('click', () => {
    if (step === 1) {
      show('home');
      return;
    }
    if (!saveStep()) return;
    goto((step - 1) as Step);
  });

  skip.addEventListener('click', () => {
    const team: Team = step === 1 ? 'blue' : 'red';
    store.commit((s) => {
      const members = s.tactic.players.filter((p) => p.team === team);
      s.tactic.players = s.tactic.players.map((p) => (p.team === team ? defaultPlayer(team, members.indexOf(p) + 1) : p));
      if (team === 'blue') s.tactic.setup.blueSkipped = true;
      else s.tactic.setup.redSkipped = true;
      refreshDefaultMatchups(s);
    });
    goto((step + 1) as Step);
  });

  form.addEventListener('input', () => {
    clearError();
    if (step !== 3) refreshCards();
  });
  form.addEventListener('submit', (e) => e.preventDefault());

  return {
    open(to: Step, focusPlayerId?: string) {
      goto(to);
      show('setup');
      if (focusPlayerId) {
        const card = form.querySelector<HTMLElement>(`[data-id="${focusPlayerId}"]`);
        card?.scrollIntoView({ block: 'center' });
        card?.querySelector<HTMLInputElement>('input[name="name"]')?.focus();
      }
    },
  };
}
