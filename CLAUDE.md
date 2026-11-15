# VROOM: notes for Claude Code

VROOM 13 is a late-90s console style metal grunge 3D racer (three.js r170) for players around 10 to 12.
Sources live in `src/`; `npm run build` assembles the one shipped `index.html` (three.js inlined, every
module in its own `<script>`). Never hand-edit `index.html`. Read `docs/OVERHAUL.md` (the design and the
module map), `src/contracts.js` (the binding interfaces and frozen ids), `CONTRIBUTING.md` (the rules)
and `docs/ARCHITECTURE.md` (how the pieces fit). `SPEC.md` is the design spec, `TASKS.md` the log.
v12 (the 2D toybox) lives in `legacy/v12/` for reference only.

## Rules that the suite and the user both enforce

- Zero on-screen words: numerals and symbols only, pictograms for everything. The VROOM logo (`data-logo`) is the one word. `aria-label`s are fine.
- No fail states. Crashes, monsters, gaps and walls knock you back and cost time, never end a run; the crane respawns the car. Stars only go up.
- Every tap target is at least 64 px rendered at 1024x768 (75 stage px; use 88 or more).
- Metal grunge look: the `--m-*` tokens in `src/shell.html`, gunmetal plates, rivets, hazard stripes, molten accents. No toybox `--v-*` tokens.
- The sim region (`contracts`, `dmath`, `catalog`, `levels`, `sim`, `monsters.sim`) is deterministic: no DOM, no THREE, no clocks, no `Math.random`, maths only through `VROOM.dmath`. It ports bit-exact to Swift for iOS. `tests/sim.cjs` enforces it.
- Save data is forever: `contracts.LEGACY` lists are frozen; v13 ids append through `catalog.NEW_*`. New save fields go on the end of the v3 code tail with a `pos + n <= bytes.length * 8` guard, and in `save.apply()` with a default for older saves.
- Honour `prefers-reduced-motion` for anything decorative.
- Bump `APP_VERSION` (src/contracts.js) and `package.json` together on every user-visible change; the update gate keys off it.
- Original designs only: nothing from Crash Bandicoot, Naughty Dog or any other game, no real brand names.
- No em dashes in anything you write (code comments, docs, commit messages, replies).

## Working here

```bash
npm ci && npx playwright-core install chromium
npm run build                            # src/ -> index.html (CI checks it is fresh)
npm run build -- --out preview/x.html    # a private preview build (preview/ is gitignored)
python3 -m http.server 4173              # serve; the page must be served, not opened from disk
npm test                                 # 15 suites; builds preview/test.html and serves it on a free port
node tests/lint.cjs                      # ESLint over the assembled modules, must be 0 findings
node scripts/doc-shots.cjs               # regenerate docs/*.png (needs a Chromium)
```

- URL switches: `?garage`, `?level=N` (race), `?world=N` (map, or with `?scene=race` that world's first level, `&boss` its finale), `?scene=<id>`, `?bot=1` (autopilot drives, no countdown), `?nosplash`, `?nocount`, `?noghost`, `?quality=low`, `?titleWorld=N`.
- `CHROMIUM=/path/to/chrome` points the suites at a browser.
- Port 4173 can be held by a stale server. If a screenshot shows the wrong version, check `VROOM.contracts.APP_VERSION` in the served page.
- The fairness bots (`tests/fairness-check.cjs`) drive all 121 levels. If level content fails them, fix the content (`src/levels.js`), never the thresholds.
- Every feature gets a check in the suite that owns the area (see `tests/README.md`); keep the counts there and in the top-level README current.
- Under load the render-budget and countdown checks can flake; rerun that suite alone (`node tests/run-all.cjs --only <suite>`) before treating a failure as real.

## Git

- Commit as `Claude <noreply@anthropic.com>` (the repo config is set); the user's stop hook rejects other committer identities.
- End every commit message with the attribution lines the session provides.
- Run `npm run build`, the full battery and lint before every commit. A pipe such as `node tests/run-all.cjs | tail` hides the exit code; capture to a log and check `exit`.
- Agent worktree branches are merged into `main` with `git merge --squash` so each feature lands as one verified, Claude-authored commit.
- When pushing: push `main`, then mirror it with `git push origin main:feat/chase-cam`. Never open a pull request unless asked.
