import { PLAYER_RADIUS } from '../model/entities';
import { FORMATIONS, applyFormation, lineupBall, moveInLineup, setHolder, type Lineup } from '../model/lineup';
import type { Player, Vec2 } from '../model/types';
import { drawCourt } from '../render/court';
import { drawBall, drawPlayer, drawPlayerLabel } from '../render/entities';
import type { Viewport } from '../render/viewport';
import { defendPosition } from '../sim/defense';

// 站位與對位頁的小球場（SPEC §1.1 步驟 ③）：拖曳藍隊自由放置、點一下指定持球者、一鍵套用常用陣型；
// 紅隊依目前的對位即時站到防守位置。

/** 只顯示半場靠籃框的部分，球員才不會太小 */
const VIEW = { minX: -8.3, maxX: 8.3, minY: -0.8, maxY: 11.2 };
/** 手指移動超過這個距離（CSS px）才算拖曳，否則算點一下 */
const TAP_SLOP_PX = 5;

function fit(width: number, height: number): Viewport {
  const scale = Math.max(0, Math.min(width / (VIEW.maxX - VIEW.minX), height / (VIEW.maxY - VIEW.minY)));
  const cx = (VIEW.minX + VIEW.maxX) / 2;
  const cy = (VIEW.minY + VIEW.maxY) / 2;
  return { scale, originX: width / 2 - cx * scale, originY: height / 2 + cy * scale };
}

export interface LineupEditorOptions {
  players: readonly Player[];
  /** 藍隊 id → 紅隊 id */
  matchups: Record<string, string>;
  lineup: Lineup;
  onChange: (lineup: Lineup) => void;
}

/** 建立小球場；回傳要放進頁面的元素 */
export function createLineupEditor(opts: LineupEditorOptions): HTMLElement {
  let lineup = opts.lineup;
  const blues = opts.players.filter((p) => p.team === 'blue');
  const reds = opts.players.filter((p) => p.team === 'red');

  const wrap = document.createElement('div');
  wrap.className = 'lineup';

  // 持球者單選：和小球場雙向同步（點小球場上的球員、套用陣型時也會更新）
  const holderGroup = document.createElement('fieldset');
  holderGroup.className = 'lineup__holder';
  const legend = document.createElement('legend');
  legend.textContent = '持球者';
  holderGroup.append(legend);
  const radios = blues.map((b) => {
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = 'lineup-holder';
    input.value = b.id;
    input.addEventListener('change', () => {
      if (input.checked) update(setHolder(lineup, b.id));
    });
    const label = document.createElement('label');
    label.append(input, document.createTextNode(`${b.number} 號 ${b.name}`));
    holderGroup.append(label);
    return input;
  });
  const syncRadios = () => {
    for (const r of radios) r.checked = r.value === lineup.holder;
  };
  syncRadios();

  // 常用陣型
  const presets = document.createElement('div');
  presets.className = 'lineup__presets';
  presets.setAttribute('role', 'group');
  presets.setAttribute('aria-label', '常用陣型');
  for (const f of FORMATIONS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'lineup__preset';
    b.textContent = f.label;
    b.addEventListener('click', () => update(applyFormation(lineup, f)));
    presets.append(b);
  }

  const canvas = document.createElement('canvas');
  canvas.className = 'lineup__court';
  canvas.setAttribute('aria-label', '開局站位：拖曳藍隊球員調整位置，點一下讓他持球');
  const hint = document.createElement('p');
  hint.className = 'lineup__hint';
  hint.textContent = '拖曳藍隊到想要的位置；選上方的持球者，或在球場上點一下球員，都能換人持球。紅隊會依對位自動站好。';
  wrap.append(holderGroup, presets, canvas, hint);

  const ctx = canvas.getContext('2d')!;
  let vp = fit(0, 0);
  let dpr = 1;

  const toWorld = (sx: number, sy: number): Vec2 => ({ x: (sx - vp.originX) / vp.scale, y: (vp.originY - sy) / vp.scale });

  const draw = () => {
    if (vp.scale === 0) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawCourt(ctx, vp, dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const ball = lineup.positions[lineup.holder]!;
    // 紅隊：依對位站到防守位置（開局是協防站位）
    const redPos = new Map<string, Vec2>();
    for (const b of blues) {
      const redId = opts.matchups[b.id];
      if (redId) redPos.set(redId, defendPosition(lineup.positions[b.id]!, ball, b.id === lineup.holder));
    }
    for (const r of reds) {
      const p = redPos.get(r.id);
      if (p) drawPlayer(ctx, vp, r, p, false);
    }
    for (const b of blues) drawPlayer(ctx, vp, b, lineup.positions[b.id]!, b.id === dragging);
    for (const r of reds) {
      const p = redPos.get(r.id);
      if (p) drawPlayerLabel(ctx, vp, r, p, false);
    }
    for (const b of blues) drawPlayerLabel(ctx, vp, b, lineup.positions[b.id]!, b.id === dragging);
    drawBall(ctx, vp, lineupBall(lineup), false);
  };

  const update = (next: Lineup) => {
    lineup = next;
    opts.onChange(lineup);
    syncRadios();
    draw();
  };

  // canvas 大小由 CSS 決定（寬度 100%、固定長寬比），這裡只跟著設定像素大小
  new ResizeObserver(() => {
    dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    vp = fit(w, h);
    draw();
  }).observe(canvas);

  // ---- 拖曳與點選 ----
  let dragging: string | null = null;
  let pointerId: number | null = null;
  let downAt = { x: 0, y: 0 };
  let grab = { x: 0, y: 0 };
  let moved = false;

  const local = (e: PointerEvent) => {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  canvas.addEventListener('pointerdown', (e) => {
    if (pointerId !== null) return;
    const at = local(e);
    const w = toWorld(at.x, at.y);
    const hit = blues
      .map((b) => ({ id: b.id, d: Math.hypot(lineup.positions[b.id]!.x - w.x, lineup.positions[b.id]!.y - w.y) }))
      .filter((h) => h.d <= PLAYER_RADIUS + 0.3)
      .sort((a, b) => a.d - b.d)[0];
    if (!hit) return;
    dragging = hit.id;
    pointerId = e.pointerId;
    downAt = at;
    moved = false;
    const p = lineup.positions[hit.id]!;
    grab = { x: p.x - w.x, y: p.y - w.y };
    canvas.setPointerCapture(e.pointerId);
    draw();
  });

  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerId !== pointerId || !dragging) return;
    const at = local(e);
    if (!moved && Math.hypot(at.x - downAt.x, at.y - downAt.y) < TAP_SLOP_PX) return;
    moved = true;
    const w = toWorld(at.x, at.y);
    lineup = moveInLineup(lineup, dragging, { x: w.x + grab.x, y: w.y + grab.y });
    draw();
  });

  const end = (e: PointerEvent) => {
    if (e.pointerId !== pointerId || !dragging) return;
    const id = dragging;
    dragging = null;
    pointerId = null;
    update(moved ? lineup : setHolder(lineup, id));
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);

  return wrap;
}
