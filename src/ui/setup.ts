import { defaultName, defaultPlayer, displayName } from '../model/defaults';
import { assignMatchup, defaultMatchups, setMatchups } from '../model/matchups';
import { clearRedPaths, freezeDefenseAsPaths, syncFrames } from '../model/frames';
import { applyLineup, canApplyLineupNow, lineupOf, type Lineup } from '../model/lineup';
import { createLineupEditor } from './lineupEditor';
import { DEFAULT_SKILLS, RATINGS, SKILL_KEYS, counterpartId, heightOf, speedOf } from '../model/physique';
import { applyPatch, parseTeamForm, type PlayerFormValues } from '../model/playerForm';
import type { EditorState, Store } from '../model/store';
import type { DriveHelp, PickCoverage, Player, Pressure, Rating, ScoringRule, Skills, Tactic, Team } from '../model/types';
import { t as tx } from '../i18n';

// 進攻模式的設定流程（SPEC §1.1）：① 藍隊 → ② 紅隊 → ③ 對位 → 戰術面板。

export type Step = 1 | 2 | 3;

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

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
  let draftDriveHelp: DriveHelp = 'off';
  let draftAutoDefense = true;
  let draftScoring: ScoringRule = 'fiba3x3';
  let draftLineup: Lineup = lineupOf(store.get().tactic);

  const tactic = () => store.get().tactic;

  // ---------- ① ② 球員卡 ----------

  const playerCard = (p: Player, index: number) => {
    const blue = p.team === 'blue';
    const card = el('fieldset', { class: `pcard pcard--${p.team}`, 'data-id': p.id });
    card.append(el('legend', {}, tx().setup.cardLegend(blue, index + 1)));

    const input = (name: string, label: string, attrs: Record<string, unknown>, optional = false) =>
      el(
        'label',
        { class: 'field' },
        el('span', {}, label, ...(optional ? [' ', el('small', {}, tx().setup.optional)] : [])),
        el('input', { name, ...attrs }),
      );
    card.append(
      el(
        'div',
        { class: 'pcard__row' },
        input('number', tx().setup.number, { type: 'number', inputMode: 'numeric', min: '0', max: '99', step: '1', value: String(p.number) }),
        input('name', tx().setup.nickname, { type: 'text', maxLength: 12, autocomplete: 'off', value: p.name, placeholder: defaultName(p) }, true),
        input(
          'height',
          tx().setup.height,
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
      for (const key of SKILL_KEYS) card.append(ratingRow(`${p.id}-${key}`, tx().skill[key], tx().rating, skills[key]));
    } else {
      card.append(ratingRow(`${p.id}-speed`, tx().skill.speed, tx().rating, p.speedRating ?? 2));
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
          ? { speed: pick('speed'), iso: pick('iso'), finishing: pick('finishing'), midRange: pick('midRange'), threePoint: pick('threePoint') }
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
        team === 'red' && blue?.heightCm !== undefined ? tx().setup.heightSameAsBlue(fallback) : tx().setup.heightDefault(fallback);
      const all = players.map((p) => (p.id === draft.id ? draft : p));
      card.querySelector('.pcard__speed')!.textContent =
        tx().setup.speedLine(speedOf(draft, all, false).toFixed(2), speedOf(draft, all, true).toFixed(2));
    }
  };

  // ---------- ③ 對位 ----------

  const renderMatchups = () => {
    const t = tactic();
    const players = t.players;
    const red = teamPlayers(t, 'red');
    const m = tx().setup;
    const label = (p: Player) => m.matchupOption(tx().common.player(p.number, displayName(p)), heightOf(p, players));
    form.replaceChildren();

    // 計分規則：影響每一球的分數、評分與進攻時限（存在戰術裡，分享連結才能重現）
    form.append(el('h3', { class: 'setup__section' }, m.scoringTitle));
    const scoring = el('fieldset', { class: 'choice' }, el('legend', {}, m.scoringLegend));
    for (const rule of ['fiba3x3', 'standard'] as const) {
      const spec = tx().scoring[rule];
      const radio = el('input', { type: 'radio', name: 'scoring', value: rule, checked: draftScoring === rule });
      radio.addEventListener('change', () => (draftScoring = rule));
      scoring.append(el('label', {}, radio, el('span', {}, rule === 'fiba3x3' ? m.withDefault(spec.label) : spec.label, el('small', {}, spec.description))));
    }
    form.append(scoring);

    // 開局站位：小球場自由放置（紅隊依目前的對位即時站好）
    form.append(el('h3', { class: 'setup__section' }, m.lineupTitle));
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
    form.append(el('h3', { class: 'setup__section' }, m.matchupsTitle));

    for (const b of teamPlayers(t, 'blue')) {
      const r = players.find((p) => p.id === draftMatchups[b.id])!;
      const select = el('select', { 'aria-label': m.matchupOf(displayName(b)) });
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
          el('span', { class: 'mrow__vs' }, m.versus),
          select,
          el(
            'p',
            { class: 'mrow__diff' },
            m.blueEdge,
            diff(m.heightDiff(`${dh >= 0 ? '+' : ''}${dh}`), dh),
            ' ・ ',
            diff(m.speedDiff(`${dv >= 0 ? '+' : ''}${Math.round(dv * 100)}`), Math.round(dv * 100)),
          ),
        ),
      );
    }

    if (draftCustomized) {
      const reset = el('button', { type: 'button', class: 'link-btn' }, m.resetMatchups);
      reset.addEventListener('click', () => {
        draftMatchups = defaultMatchups(players);
        draftCustomized = false;
        renderMatchups();
      });
      form.append(reset);
    }

    // 防守設定：紅隊的防守方式（自動防守跑位、防守距離、切入補防、掩護應對）
    form.append(el('h3', { class: 'setup__section' }, m.defenseTitle));

    // 自動防守跑位：關閉時紅隊不會自動移動，每個分鏡由使用者拖曳；切入補防、掩護應對用不到
    const auto = el('input', { type: 'checkbox', checked: draftAutoDefense });
    const autoNote = el('p', { class: 'choice__note' }, m.autoNote);
    const syncAuto = () => {
      help.disabled = !draftAutoDefense;
      choice.disabled = !draftAutoDefense;
      autoNote.hidden = draftAutoDefense;
    };
    auto.addEventListener('change', () => {
      draftAutoDefense = auto.checked;
      syncAuto();
    });
    form.append(
      el(
        'fieldset',
        { class: 'choice' },
        el('legend', {}, m.autoLegend),
        el(
          'label',
          {},
          auto,
          el(
            'span',
            {},
            m.autoLabel,
            el('small', {}, m.autoDesc),
          ),
        ),
        autoNote,
      ),
    );

    // 防守距離：改了之後重畫，小球場上的紅隊跟著換位置
    const pressure = el('fieldset', { class: 'choice' }, el('legend', {}, m.pressureLegend));
    const pressureOption = (value: Pressure, text: string, desc: string) => {
      const radio = el('input', { type: 'radio', name: 'pressure', value, checked: draftPressure === value });
      radio.addEventListener('change', () => {
        draftPressure = value;
        renderMatchups();
      });
      return el('label', {}, radio, el('span', {}, text, el('small', {}, desc)));
    };
    pressure.append(
      pressureOption('normal', m.pressureNormal, m.pressureNormalDesc),
      pressureOption('tight', m.pressureTight, m.pressureTightDesc),
    );
    form.append(pressure);

    const help = el('fieldset', { class: 'choice' }, el('legend', {}, m.helpLegend));
    const helpOption = (value: DriveHelp, text: string, desc: string) => {
      const radio = el('input', { type: 'radio', name: 'drive-help', value, checked: draftDriveHelp === value });
      radio.addEventListener('change', () => (draftDriveHelp = value));
      return el('label', {}, radio, el('span', {}, text, el('small', {}, desc)));
    };
    help.append(
      helpOption('off', m.helpOff, m.helpOffDesc),
      helpOption('weak-side', m.helpWeak, m.helpWeakDesc),
    );
    form.append(help);

    const choice = el('fieldset', { class: 'choice' }, el('legend', {}, m.screenLegend));
    // 進階：擠過時，擋拆由掩護者的防守者沉退或上提（換防時用不到，隱藏）
    const coverage = el('fieldset', { class: 'choice choice--sub' }, el('legend', {}, m.coverageLegend));
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
      coverageOption('drop', m.drop, m.dropDesc),
      coverageOption('hedge', m.hedge, m.hedgeDesc),
    );
    coverage.hidden = draftScreen !== 'fight-over';
    choice.append(
      option('switch', m.switch, m.switchDesc),
      option('fight-over', m.fightOver, m.fightOverDesc),
      coverage,
    );
    form.append(choice);
    syncAuto();
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
    const m = tx().setup;
    title.textContent = m.steps[step].title;
    hint.textContent = m.steps[step].hint;
    back.hidden = boardReady;
    back.textContent = step === 1 ? m.home : m.back;
    skip.hidden = boardReady || step === 3;
    next.textContent = boardReady ? m.done : step === 3 ? m.start : m.next;

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
    draftDriveHelp = t.driveHelp;
    draftAutoDefense = t.autoDefense;
    draftScoring = t.scoring;
    draftLineup = lineupOf(t);
  };

  /** 寫回球員後，若沒改過對位就跟著更新預設對位 */
  const refreshDefaultMatchups = (s: EditorState) => {
    if (!s.tactic.setup.matchupsCustomized) setMatchups(s.tactic, defaultMatchups(s.tactic.players));
  };

  /** 驗證並寫回目前這一步；失敗時顯示錯誤並回傳 false */
  const saveStep = (): boolean => {
    if (step === 3) {
      const t = store.get().tactic;
      const lineupChanged = JSON.stringify(draftLineup) !== JSON.stringify(lineupOf(t));
      const applyNow = canApplyLineupNow(t);
      store.commit((s) => {
        // 對位換了：拖過的紅隊開局位置是照舊對位擺的，清掉讓紅隊依新對位站好
        setMatchups(s.tactic, draftMatchups);
        s.tactic.setup.matchupsCustomized = draftCustomized;
        s.tactic.screenDefense = draftScreen;
        s.tactic.pickCoverage = draftCoverage;
        s.tactic.pressure = draftPressure;
        s.tactic.driveHelp = draftDriveHelp;
        s.tactic.scoring = draftScoring;
        const wasAuto = s.tactic.autoDefense;
        // 切換自動防守開關：手動的紅隊開局位置從頭開始（改成手動時以自動模擬為起點；改回自動時用不到）
        if (wasAuto !== draftAutoDefense) delete s.tactic.redStarts;
        s.tactic.autoDefense = true; // 先用新的設定自動模擬，切換手動時才有正確的起點
        s.tactic.setup.lineup = structuredClone(draftLineup);
        // 還沒畫路線就直接套用；已經有路線時不動目前的戰術，避免路線變得不合理
        if (lineupChanged && applyNow) {
          applyLineup(s.tactic.frames[0]!, draftLineup);
          // 開局站位換了：紅隊依新的站位重新就位（關閉自動防守時，原本拖過的位置已經不合用）
          delete s.tactic.redStarts;
        }
        if (!draftAutoDefense) {
          if (wasAuto) {
            // 改成手動：目前自動模擬的紅隊移動變成紅隊跑位路線，當成編輯的起點
            syncFrames(s.tactic, false);
            freezeDefenseAsPaths(s.tactic);
          }
          s.tactic.autoDefense = false;
        } else if (!wasAuto) {
          // 改回自動：紅隊路線用不到了
          clearRedPaths(s.tactic);
        }
      });
      if (lineupChanged && !applyNow) notify(tx().setup.lineupDeferred);
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
