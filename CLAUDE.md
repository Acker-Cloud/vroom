# Vroom: notes for Claude Code

VROOM 13 is a late-90s console style metal grunge 3D racer (three.js r170) for players around 10 to 12.
The shipped `index.html` is **generated** by `npm run build` from `src/` (`src/shell.html` plus the
modules in `scripts/build.cjs` ORDER, with three.js inlined from `node_modules`). Never hand-edit or
Read `index.html` (the three.js line is ~690 KB). `docs/OVERHAUL.md` is the design and module map,
`src/contracts.js` the binding interfaces. v12 (the 2D toddler game) lives in `legacy/v12/` for
reference; `SPEC.md`, `docs/ARCHITECTURE.md` and `CONTRIBUTING.md` still describe v12.

## Rules that the suites and the user enforce

- Zero on-screen words: numerals, symbols, pictograms. `aria-label`s are fine. The VROOM logo (`data-logo`) is the one word.
- No fail states. Crashes and monsters knock, spin and cost time, never end a run. Stars only go up.
- Every tap target is at least 64 px rendered at 1024x768 (75 stage px; use 88+).
- Metal grunge look: the `--m-*` tokens in `src/shell.html`, gunmetal plates, chrome, rust, hazard stripes. No toybox chrome.
- The sim region (contracts, dmath, catalog, levels, sim, monsters.sim) is DOM-free, THREE-free and deterministic:
  no Math.random, no clocks, no Math.sin/cos/atan2/exp/pow/hypot or `**` (use `VROOM.dmath`). It ports to Swift bit-exact.
- Save data is forever: `contracts.LEGACY` lists are frozen; new ids append through `catalog.NEW_*`; new code fields go
  on the end of the v3 tail with a `pos + n <= bytes.length * 8` guard; new JSON fields get a default in `save.js` `apply()`.
- Honour `prefers-reduced-motion` for anything decorative.
- Bump `APP_VERSION` (src/contracts.js) and package.json together on every user-visible change.
- IP: original designs only. Nothing from Crash Bandicoot or any other existing game or brand.
- No em dashes in anything you write (code comments, docs, commit messages, replies).

## Working here

```bash
npm ci && npx playwright-core install chromium
npm run build                            # src/ + three.js -> index.html
npm run build -- --out preview/x.html [--mine <owner>]   # a private preview build
npm test                                 # every suite; builds and serves preview/test.html itself
npm run lint                             # ESLint over the assembled modules, must be 0 findings
node tests/sim.cjs                       # the sim region in Node
python3 -m http.server 4173              # then /index.html?scene=race&level=12&bot=1
```

- URL switches: `?scene=<id>`, `?level=N`, `?bot=1`, `?nosplash`, `?garage`, `?quality=low`.
- `CHROMIUM=/path/to/chrome` points the suites at a browser.
- Each module has one owner (docs/OVERHAUL.md section 10); suites are `tests/<area>-check.cjs`, found by name.

## Git

- Commit as `Claude <noreply@anthropic.com>` (the repo config is set); the user's stop hook rejects other committer identities.
- End every commit message with the two attribution lines the session provides.
- Agent worktree branches are merged into `main` with `git merge --squash` so each feature lands as one verified, Claude-authored commit.
- Push `main`, then mirror it with `git push origin main:feat/chase-cam`. Never open a pull request unless asked.
- Run `npm run build`, the full battery and lint before every push; commit the rebuilt `index.html`. A pipe such as `node tests/run-all.cjs | tail` hides the exit code; capture to a log and check `exit`.
