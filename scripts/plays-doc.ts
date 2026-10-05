// 產生 docs/PLAYS.md 與 docs/plays/*.svg：用遊戲本身的路線與防守 AI 畫出所有內建戰術的分鏡圖。
// 由 scripts/build-plays-doc.mjs 透過 Vite 載入執行。

import { buildTimeline, possessionSeconds } from '../src/anim/timeline';
import {
  BACKBOARD_HALF_WIDTH,
  BACKBOARD_Y,
  BASKET_Y,
  COURT_HALF_WIDTH,
  FREE_THROW_RADIUS,
  PAINT_DEPTH,
  PAINT_HALF_WIDTH,
  RESTRICTED_RADIUS,
  RIM_RADIUS,
  THREE_POINT_CORNER_X,
  THREE_POINT_CORNER_Y,
  THREE_POINT_RADIUS,
} from '../src/court/fiba';
import { sampleSpline } from '../src/geom/spline';
import { trimPolyline } from '../src/geom/polyline';
import { normalize, perp, sub } from '../src/geom/vec';
import { createDefaultTactic } from '../src/model/defaults';
import { ballPosition } from '../src/model/entities';
import { SKILL_LABEL } from '../src/model/physique';
import { RIM, resolvePoints } from '../src/model/paths';
import type { Tactic, Vec2 } from '../src/model/types';
import { wave } from '../src/render/paths';
import { PLAYS, ROLES, SHOT_LABEL, playVariant, type Play, type Role, type RoleWeights } from '../src/plays/library';
import { loadPlay } from '../src/plays/instantiate';
import { theme } from '../src/render/theme';

const PX = 20; // 每公尺幾個 SVG 單位
const VIEW = { minX: -7.9, maxX: 7.9, minY: -0.6, maxY: 11.2 };
const PANEL_W = (VIEW.maxX - VIEW.minX) * PX;
const PANEL_H = (VIEW.maxY - VIEW.minY) * PX;
const CAPTION_H = 26;
const GAP = 12;
const COLUMNS = 3;

// 地板與禁區沿用球場的配色（src/render/theme.ts）；SVG 不用漸層，禁區用漸層上端（比較亮的那一端）
const C = {
  floor: theme.floor,
  paint: theme.paintTop,
  /** 路線底下的淺色外框（同 theme.pathHalo，透明度另外用屬性設定） */
  halo: '#ffffff',
  line: '#ffffff',
  blue: '#1f56e0',
  red: '#b3232d',
  path: { blue: '#1a3ea8' },
  ball: '#e8782a',
};

const f = (n: number) => n.toFixed(1);
const sx = (x: number) => (x - VIEW.minX) * PX;
const sy = (y: number) => (VIEW.maxY - y) * PX;
const pt = (p: Vec2) => `${f(sx(p.x))},${f(sy(p.y))}`;
const poly = (pts: readonly Vec2[]) => pts.map(pt).join(' ');

function arcPath(cx: number, cy: number, r: number, a0: number, a1: number, steps = 48): Vec2[] {
  return Array.from({ length: steps + 1 }, (_, i) => {
    const a = a0 + ((a1 - a0) * i) / steps;
    return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
  });
}

function court(): string {
  // 注意：每個屬性只能出現一次，PhpStorm 等嚴格的 XML 解析器遇到重複屬性會無法載入
  const stroke = `stroke="${C.line}" stroke-width="2"`;
  const line = `fill="none" ${stroke}`;
  const corner = Math.atan2(THREE_POINT_CORNER_Y - BASKET_Y, THREE_POINT_CORNER_X);
  const three = [
    { x: THREE_POINT_CORNER_X, y: 0 },
    ...arcPath(0, BASKET_Y, THREE_POINT_RADIUS, corner, Math.PI - corner),
    { x: -THREE_POINT_CORNER_X, y: 0 },
  ];
  return [
    `<rect width="${f(PANEL_W)}" height="${f(PANEL_H)}" rx="8" fill="${C.floor}"/>`,
    `<rect x="${f(sx(-PAINT_HALF_WIDTH))}" y="${f(sy(PAINT_DEPTH))}" width="${f(PAINT_HALF_WIDTH * 2 * PX)}" height="${f(PAINT_DEPTH * PX)}" fill="${C.paint}" ${stroke}/>`,
    `<polyline points="${poly([{ x: -COURT_HALF_WIDTH, y: VIEW.maxY }, { x: -COURT_HALF_WIDTH, y: 0 }, { x: COURT_HALF_WIDTH, y: 0 }, { x: COURT_HALF_WIDTH, y: VIEW.maxY }])}" ${line}/>`,
    `<polyline points="${poly(arcPath(0, PAINT_DEPTH, FREE_THROW_RADIUS, 0, Math.PI))}" ${line}/>`,
    `<polyline points="${poly(arcPath(0, PAINT_DEPTH, FREE_THROW_RADIUS, Math.PI, 2 * Math.PI))}" ${line} stroke-dasharray="6 5"/>`,
    `<polyline points="${poly(three)}" ${line}/>`,
    `<polyline points="${poly(arcPath(0, BASKET_Y, RESTRICTED_RADIUS, 0, Math.PI))}" fill="none" stroke="${C.line}" stroke-width="1.2"/>`,
    `<line x1="${f(sx(-BACKBOARD_HALF_WIDTH))}" y1="${f(sy(BACKBOARD_Y))}" x2="${f(sx(BACKBOARD_HALF_WIDTH))}" y2="${f(sy(BACKBOARD_Y))}" stroke="${C.line}" stroke-width="3"/>`,
    `<circle cx="${f(sx(0))}" cy="${f(sy(BASKET_Y))}" r="${f(RIM_RADIUS * PX)}" ${line}/>`,
  ].join('');
}

/** 一層路線的畫法：外框（淺色、比較寬）或路線本身 */
interface Layer {
  color: string;
  /** 每邊多出的寬度（SVG 單位） */
  extra: number;
  /** 透明度屬性（SVG 不用 rgba，PhpStorm 的檢視器會載入失敗） */
  opacity: string;
}

function arrowHead(tip: Vec2, dir: Vec2, layer: Layer): string {
  const n = perp(dir);
  const base = { x: tip.x - dir.x * 0.42, y: tip.y - dir.y * 0.42 };
  const a = { x: base.x + n.x * 0.22, y: base.y + n.y * 0.22 };
  const b = { x: base.x - n.x * 0.22, y: base.y - n.y * 0.22 };
  // 外框：同一個三角形加上同色的粗邊
  const edge = layer.extra > 0 ? ` stroke="${layer.color}" stroke-width="${f(layer.extra * 2)}" stroke-linejoin="round"` : '';
  return `<polygon points="${poly([tip, a, b])}" fill="${layer.color}"${edge}${layer.opacity}/>`;
}

function pathLayer(kind: string, controls: Vec2[], layer: Layer): string {
  const sampled = sampleSpline(controls);
  const endTrim = kind === 'pass' ? 0.77 : kind === 'shot' ? 0.5 : 0.62;
  const body = trimPolyline(sampled, 0.62, endTrim);
  if (body.length < 2) return '';
  const tip = body.at(-1)!;
  const dir = normalize(sub(tip, body.at(-2)!));
  const width = (kind === 'shot' ? 3.6 : 2.6) + layer.extra * 2;
  const stroke = `fill="none" stroke="${layer.color}" stroke-width="${f(width)}" stroke-linecap="round" stroke-linejoin="round"${layer.opacity}`;
  const lineBody = kind === 'screen' || kind === 'shot' ? body : trimPolyline(body, 0, 0.34);
  const shape = kind === 'dribble' ? wave(lineBody) : lineBody;
  const dash = kind === 'pass' ? ' stroke-dasharray="7 6"' : kind === 'shot' ? ' stroke-dasharray="1 6"' : '';
  let out = `<polyline points="${poly(shape)}" ${stroke}${dash}/>`;
  if (kind === 'screen') {
    const n = perp(dir);
    out += `<line x1="${f(sx(tip.x + n.x * 0.42))}" y1="${f(sy(tip.y + n.y * 0.42))}" x2="${f(sx(tip.x - n.x * 0.42))}" y2="${f(sy(tip.y - n.y * 0.42))}" stroke="${layer.color}" stroke-width="${f(4 + layer.extra * 2)}" stroke-linecap="round"${layer.opacity}/>`;
  } else if (kind === 'shot') {
    out += `<circle cx="${f(sx(RIM.x))}" cy="${f(sy(RIM.y))}" r="${f(0.5 * PX)}" fill="none" stroke="${layer.color}" stroke-width="${f(2.6 + layer.extra * 2)}"${layer.opacity}/>`;
  } else {
    out += arrowHead(tip, dir, layer);
  }
  return out;
}

/** 路線：先畫淺色外框，再畫路線本身（和遊戲畫面相同，深藍禁區上也看得清楚） */
function pathSvg(kind: string, controls: Vec2[]): string {
  return (
    pathLayer(kind, controls, { color: C.halo, extra: 1.2, opacity: ' stroke-opacity="0.6" fill-opacity="0.6"' }) +
    pathLayer(kind, controls, { color: C.path.blue, extra: 0, opacity: '' })
  );
}

function panel(tactic: Tactic, i: number, roleOf: Map<string, Role>, ox: number, oy: number): string {
  const frame = tactic.frames[i]!;
  const parts: string[] = [`<g transform="translate(${ox},${oy})">`, court()];

  // 移動路線終點的分身
  for (const path of frame.paths) {
    if (path.kind !== 'cut' && path.kind !== 'dribble' && path.kind !== 'screen') continue;
    const end = path.points.at(-1)!;
    parts.push(
      `<circle cx="${f(sx(end.x))}" cy="${f(sy(end.y))}" r="${f(0.62 * PX)}" fill="#ffffff" fill-opacity="0.45" stroke="${C.blue}" stroke-width="1.6" stroke-dasharray="4 3"/>`,
    );
  }
  for (const path of frame.paths) parts.push(pathSvg(path.kind, resolvePoints(frame, path)));

  // 紅隊（防守 AI 在這個分鏡開始時的位置）
  for (const p of tactic.players.filter((x) => x.team === 'red')) {
    const pos = frame.start[p.id]!;
    parts.push(`<circle cx="${f(sx(pos.x))}" cy="${f(sy(pos.y))}" r="${f(0.5 * PX)}" fill="${C.red}" stroke="#fff" stroke-width="1.5"/>`);
  }
  // 藍隊（標角色字母）
  for (const p of tactic.players.filter((x) => x.team === 'blue')) {
    const pos = frame.start[p.id]!;
    parts.push(
      `<circle cx="${f(sx(pos.x))}" cy="${f(sy(pos.y))}" r="${f(0.62 * PX)}" fill="${C.blue}" stroke="#fff" stroke-width="2"/>`,
      `<text x="${f(sx(pos.x))}" y="${f(sy(pos.y) + 5)}" font-size="14" font-weight="700" fill="#fff" text-anchor="middle">${roleOf.get(p.id)}</text>`,
    );
  }
  const ball = ballPosition(frame);
  parts.push(`<circle cx="${f(sx(ball.x))}" cy="${f(sy(ball.y))}" r="${f(0.32 * PX)}" fill="${C.ball}" stroke="#3b1d0b" stroke-width="1.5"/>`);
  parts.push(
    `<text x="${f(PANEL_W / 2)}" y="${f(PANEL_H + 19)}" font-size="15" font-weight="600" fill="#222" text-anchor="middle">分鏡 ${i + 1}</text>`,
    '</g>',
  );
  return parts.join('');
}

function playSvg(tactic: Tactic): string {
  const roles = tactic.basedOn!.roles;
  const roleOf = new Map((Object.entries(roles) as [Role, string][]).map(([r, id]) => [id, r]));
  const n = tactic.frames.length;
  const cols = Math.min(COLUMNS, n);
  const rows = Math.ceil(n / cols);
  const w = cols * PANEL_W + (cols - 1) * GAP;
  const h = rows * (PANEL_H + CAPTION_H) + (rows - 1) * GAP;
  const panels = tactic.frames.map((_, i) =>
    panel(tactic, i, roleOf, (i % cols) * (PANEL_W + GAP), Math.floor(i / cols) * (PANEL_H + CAPTION_H + GAP)),
  );
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${f(w)} ${f(h)}" width="${f(w)}" height="${f(h)}" font-family="-apple-system, 'PingFang TC', 'Noto Sans TC', sans-serif">${panels.join('')}</svg>\n`;
}

function weightText(w: RoleWeights): string {
  const parts = Object.entries(w).map(([k, v]) => `${k === 'height' ? '身高' : SKILL_LABEL[k as keyof typeof SKILL_LABEL]} ×${v}`);
  return parts.length ? parts.join('、') : '—';
}

export function buildPlaysDoc(): { markdown: string; svgs: Record<string, string> } {
  const svgs: Record<string, string> = {};
  const out: string[] = [
    '# 內建戰術說明',
    '',
    `> ${PLAYS.length} 套內建進攻戰術（\`src/plays/library.ts\`），由程式產生，不要手改（改完執行 \`npm run plays-doc\`）。`,
    '> 跳投戰術有兩個出手點（中距離 / 弧外），戰術庫依球隊能力與設定兩個都模擬，選分數高的；兩個出手點的圖都列在下面。',
    '> 圖是用遊戲本身的路線與防守 AI 畫的：藍隊標角色字母 A / B / C，紅點是防守 AI 在該分鏡**開始時**的位置（預設身高 175 cm、換防），虛線圓是跑位終點，橘色小球是球。',
    '> 線條：實線箭頭＝跑位、波浪線＝運球、虛線＝傳球、T 字＝掩護、點狀弧線＋圈＝投籃。',
    '> 說明中的分數以 FIBA 3x3 計：弧線（半徑 6.75 m）以內 1 分、以外 2 分；一般規則是 2 / 3 分。',
    '',
    '## 目錄',
    '',
    ...PLAYS.map((p, i) => `${i + 1}. [${p.category}-${p.name}](#${i + 1}-${p.category}-${p.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')})`),
    '',
  ];

  /** 一個出手點版本：分鏡圖、終結與時間、各分鏡說明 */
  const variantBody = (play: Play, svgId: string): string[] => {
    const tactic = loadPlay(createDefaultTactic(), play, { A: 'b1', B: 'b2', C: 'b3' });
    const tl = buildTimeline(tactic);
    svgs[svgId] = playSvg(tactic);
    return [
      `**終結**：${play.finish}　**時間**：約 ${tl.total.toFixed(1)} 秒，第 ${possessionSeconds(tl).toFixed(1)} 秒出手`,
      '',
      `![${play.category}-${play.name}${play.shot ? `（${SHOT_LABEL[play.shot]}）` : ''}](plays/${svgId}.svg)`,
      '',
      ...play.frames.map((fr, k) => `${k + 1}. ${fr.note}`),
      '',
    ];
  };

  PLAYS.forEach((play, i) => {
    out.push(
      `## ${i + 1}. ${play.category}-${play.name}`,
      '',
      play.summary,
      '',
      '| 角色 | 任務 | 推薦時看重 |',
      '|---|---|---|',
      ...ROLES.map((r) => `| **${r}**${r === play.ball ? '（開局持球）' : ''} | ${play.roles[r]} | ${weightText(play.weights[r])} |`),
      '',
      ...(play.shot ? [`**出手點：${SHOT_LABEL[play.shot]}**`, ''] : []),
      ...variantBody(play, play.id),
    );
    if (play.alt) {
      const alt = playVariant(play, play.alt.shot);
      out.push(
        `### 另一個出手點：${SHOT_LABEL[alt.shot!]}`,
        '',
        `${alt.summary}終結者改看重：${weightText(alt.weights[alt.finisher])}。`,
        '',
        ...variantBody(alt, `${play.id}-${alt.shot}`),
      );
    }
  });
  return { markdown: out.join('\n'), svgs };
}
