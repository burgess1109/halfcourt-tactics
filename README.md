# Halfcourt Tactics（半場戰術板）

English | [繁體中文](README.zh-TW.md)

[![CI](https://github.com/burgess1109/halfcourt-tactics/actions/workflows/ci.yml/badge.svg)](https://github.com/burgess1109/halfcourt-tactics/actions/workflows/ci.yml)

**Play online: <https://burgess1109.github.io/halfcourt-tactics/>**

A 3-on-3 half-court basketball tactics web game. Set up your team, pick or draw an offensive play, and the system simulates the defense live based on the matchups. When the play ends, you get a score (0–100), a grade, and tips on what could be better.

- Pure front-end static site: no back end, no account
- Install it to your home screen and use it offline (PWA)
- Interface: Traditional Chinese and English (follows your browser language; switch it on the home screen or under Settings)

## Features

- **Team setup**: number, name, height and five ratings (speed, isolation, finishing, mid-range, outside shot) for your three Blue players; height and speed for the three Red players (the system)
- **Game settings**: choose the scoring rules (FIBA 3x3 or standard); place the starting lineup on a mini court, pick the ball handler, or apply a common formation; set who guards whom
- **Red’s defense** (defense settings under Game settings): defensive distance (normal / tight), on a drive (no help / weak-side help), on a screen (switch / fight over, and drop / hedge when fighting over)
- **Play library**: 21 built-in plays (pick and roll, cutting, off-ball screens, hand-offs, isolation). The top 5 are recommended after simulating every play with your team’s ratings and matchups. 8 jump-shot plays automatically choose a mid-range or outside shot based on the shooter’s ratings (Spain Pick and Roll can also hit the rolling screener depending on the defense)
- **Draw your own plays**: cuts, dribbles, passes, screens and shots, up to 12 frames, freehand paths and 5-step undo
- **Playback and rating**: Red reacts live through the defense simulation (man-to-man, denial, switches, fighting over, help defense). Afterwards you get a grade, a 0–100 score (effective field goal percentage), expected points and 3–5 comments; tap a comment to jump to its frame
- **Save and share**: save to your browser’s play list, import/export JSON, or create a share link (it opens as a read-only preview the other person can save)

The simulation is fully **deterministic**: the same play always gets the same result. Shots are never “made” or “missed”; only the expected value is computed. Scoring rules are FIBA 3x3 (1 point inside the arc, 2 beyond it, 12-second shot clock; the default) or standard (2 / 3 points, 24 seconds).

## Quick start

Requires [Node.js](https://nodejs.org/) **22.12 or later** (required by Vitest 5).

```bash
git clone https://github.com/burgess1109/halfcourt-tactics.git
cd halfcourt-tactics
npm install
npm run dev
```

Open the URL shown in the terminal (by default <http://localhost:5173/>).

## Commands

| Command | Description |
|---|---|
| `npm run dev` | Development server (reloads on changes) |
| `npm test` | Unit tests (Vitest) |
| `npm run typecheck` | Type check |
| `npm run build` | Type check + bundle into `dist/` |
| `npm run preview` | Preview the build locally (use this to test the PWA and offline mode) |
| `npm run plays-doc` | Regenerate `docs/PLAYS.md` and its diagrams from the play data |

## Deployment

After a push to `main`, GitHub Actions (`.github/workflows/ci.yml`) type-checks, tests, builds and deploys to GitHub Pages.

The `dist/` folder produced by `npm run build` is plain static files and can be hosted anywhere (GitHub Pages, Netlify, Cloudflare Pages, …), including in a subdirectory.

- Serve it over **HTTPS** (or `localhost`) so that offline mode and installing to the home screen work.
- Saved plays live only in the user’s own browser (localStorage); use JSON export/import or share links to move them to another device.

## Tech

- TypeScript + Vite + native Canvas 2D, **no runtime dependencies** (no React or other framework)
- Tests: Vitest
- PWA: vite-plugin-pwa (build time only)
- Share links: the browser’s built-in CompressionStream (deflate-raw) + base64url

## Project structure

```
src/
  court/   FIBA half-court dimensions, inside/beyond the arc
  geom/    vectors, splines, path simplification
  model/   data model and rules: plays, frames, paths, matchups, save and share formats
  sim/     defense simulation and rating (pure functions, fully deterministic; coefficients in sim/config.ts)
  anim/    timeline and playback
  plays/   built-in play library and recommendations
  render/  Canvas drawing
  input/   pointer events (dragging, drawing)
  ui/      DOM interface
  i18n/    interface text tables (Traditional Chinese, English) and sentence building
docs/      spec, planning, play guide
```

## Documents

The documents are written in Traditional Chinese.

| Document | Contents |
|---|---|
| [`docs/SPEC.md`](docs/SPEC.md) | Product spec: the flow, simulation, rating and data model as implemented |
| [`docs/PLANNING.md`](docs/PLANNING.md) | Planning: milestones, decision log, open questions |
| [`docs/PLAYS.md`](docs/PLAYS.md) | Guide and diagrams for the 21 built-in plays (generated) |
| [`CLAUDE.md`](CLAUDE.md) | Development conventions and architecture (for developers and AI coding tools) |

## Contributing

Questions, suggestions or play ideas are welcome in [GitHub Discussions](https://github.com/burgess1109/halfcourt-tactics/discussions) (the Feedback links on the home screen and the bottom-left of the court open it too).

Pull requests are welcome as well. Before sending one, please make sure that:

1. `npm run typecheck` and `npm test` pass; add unit tests for logic changes
2. The simulation and rating stay fully deterministic (no `Math.random`) and new coefficients go into `src/sim/config.ts`
3. Behavior changes are reflected in `docs/SPEC.md`, with a new row in the decision log of `docs/PLANNING.md`
4. After changing the built-in plays (`src/plays/library.ts`), the defense simulation (`src/sim/`) or the colors, you run `npm run plays-doc` to regenerate the diagrams (a test checks that they match)
5. Interface text goes into the text tables in `src/i18n/`, in both Traditional Chinese and English (a test checks that they match); comments, documents and commit messages may be in Traditional Chinese or English

See [`CLAUDE.md`](CLAUDE.md) for more conventions.

## License

[MIT](LICENSE)

Third-party components: toolbar and menu icons are from [Phosphor Icons](https://phosphoricons.com/) (MIT), and the PWA service worker is generated by [Workbox](https://github.com/GoogleChrome/workbox) (MIT). The full license texts are in [`public/THIRD_PARTY_NOTICES.txt`](public/THIRD_PARTY_NOTICES.txt), which is also published with the site.
