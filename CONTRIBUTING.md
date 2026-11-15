# Contributing to VROOM

VROOM 13 is a three.js racer built from small modules in `src/` into one shipped `index.html`. Most
contributions are content (a machine, a part, a world's look, a level tweak) or a fix the suite caught.
This page covers how to run it, the rules that are not negotiable, and where each kind of content lives.

## Running it

```bash
npm ci                                   # three, eslint, playwright-core, jsqr: build and test only
npm run build                            # src/ -> index.html
python3 -m http.server 4173              # then open http://localhost:4173/
```

Edit a file in `src/`, rebuild, reload. For a private build that does not touch `index.html`:
`npm run build -- --out preview/me.html` (and `--mine <owner>` to take every other owner's files from
git HEAD). The page is served, not opened from disk, because the save-code QR and the update gate need
`location` to be a real URL. Handy URL switches: `?garage`, `?level=N`, `?world=N`, `?scene=race&world=N&boss`,
`?bot=1` (the autopilot drives), `?nosplash`, `?quality=low`, `?scene=dev:worlds-tour`, `?scene=dev:monsters-zoo`.

## Running the tests

```bash
npx playwright-core install chromium     # once; or point CHROMIUM at any Chrome / Chromium
npm test                                 # builds preview/test.html, serves it, runs every suite
node tests/lint.cjs                      # ESLint over the assembled script: 0 findings
```

| Flag / env | Effect |
|---|---|
| `--verbose` | stream every suite's output instead of only failures |
| `--only sim,flow-check` | run a subset |
| `CHROMIUM=/path/to/chrome` | use that browser instead of playwright-core's download |
| `VROOM_URL=http://host:port/page.html` | test a page you already serve |

Node-only suites (`sim`, `save-check`, `physics-check`, `sim-check`, `levels-check`, `fairness-check`,
`build-check`) need no browser. CI (`.github/workflows/test.yml`) runs lint and `npm test` on every push.
Adding a feature means adding a check to the suite that owns its area ([tests/README.md](tests/README.md)).

## The rules that are not negotiable

The suite enforces most of them; the rest are enforced in review.

1. **Zero words on screen.** Numerals, symbols and pictograms only. The VROOM logo (marked `data-logo`)
   is the one word. `aria-label`s are fine.
2. **No fail states.** Nothing ends a run. A monster knock costs at most a second of control, a gap or a
   flip brings the crane hook, a boss always loses the race to the flag. Stars only go up.
3. **Every tap answers instantly** with a 4 px slam and a metallic clank (`VROOM.ui.button` does both).
4. **Every touch target is at least 64 px** rendered at 1024x768 landscape (75 stage px; use 88+).
5. **One file, offline.** No external scripts, fonts, images or requests except the page re-fetching
   itself for the update gate. Geometry and textures are made in code; every sound is synthesized.
6. **Metal grunge look.** The `--m-*` tokens in `src/shell.html`: gunmetal plates with rivets and rust,
   chrome, hazard stripes, molten accents, a world accent from `VROOM.worlds.accent(w)`. Low-poly, flat
   shaded 3D within the budgets in `docs/OVERHAUL.md` (race scene under 150 draw calls, 250k triangles).
7. **The sim is deterministic.** Code in the sim region uses `VROOM.dmath` for maths and the state's
   seeded rng, never `Math.random`, clocks, the DOM or THREE. Same level, seed and inputs give the same
   bits in Node, every browser and the Swift port. Ghosts depend on it.
8. **Fair.** `fairness-check.cjs` drives every level with the autopilot; at skill 0.4 it must finish
   under twice par B with at most 3 respawns, at skill 1 it must reach par A. If content fails, change
   the content in `src/levels.js`, never the thresholds.
9. **Saves are forever.** `contracts.LEGACY` lists are frozen; new ids append through `catalog.NEW_*`
   and are never reordered or removed. New save fields get a default in `save.apply()` and go on the end
   of the v3 code tail behind a `pos + n <= bytes.length * 8` guard. Keys (`vroom.v2.p<n>`, `vroom.meta`)
   never change.
10. **Original.** A late-90s console style, not a copy: no characters, names, logos, music, level names
    or look-alike art from any existing game, no real brand names.
11. **Versioned.** Bump `APP_VERSION` in `src/contracts.js` and `package.json` together for every
    user-visible change, and rebuild `index.html` (`build-check` fails otherwise).

## Where content lives

Each file has one owner (`scripts/build.cjs` ORDER); a module publishes one object on `VROOM` and talks
to the others only through `VROOM.<name>.<member>` at call time.

| To add | Edit | Then |
|---|---|---|
| a machine | `src/catalog.js`: append the id to `NEW_BODY_IDS` and the `ROSTER` row (class, price, stat tweaks); `src/cars.js`: its design in `BODY_DEFS` | `cars-check` builds it, prices it and drives it through the garage |
| wheels, paint, decal, extra, buddy | the matching `NEW_*` list and table in `src/catalog.js`, the look in `src/cars.js` | `cars-check`, `save-check` (append-only orders) |
| a track piece | `contracts.PIECES` (a cross-team change), `sim.buildTrack`, the renderer in `src/worlds.js` | `physics-check` drives every piece type |
| level content | the course grammar and per-world weights in `src/levels.js` | `levels-check`, `fairness-check`, `sim.cjs` |
| a world's look | the `LOOK` table and set pieces in `src/worlds.js` | `worlds-check` renders it within budget |
| a creature or boss | behaviour in `src/monsters.sim.js` `KINDS`, the blueprint in `src/monsters.js` | `monsters-check` (telegraphed hits, knock limits, budget) |
| a sound | `src/audio.js` (names in `contracts.SFX`) | `audio-check` |
| a screen or HUD element | `src/ui.js`, styles in `src/shell.html` | `ui-check` (no words, tap targets, reduced motion) |

## Commits

Trunk-based: commit to `main`, one verified change per commit, with the tracker key in the title
(`feat: short description [T22]`). Run `npm run build`, `npm test` and `node tests/lint.cjs` first, and
check the exit code rather than piping the output. Never `--no-verify`.
