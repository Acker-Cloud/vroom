# VROOM 13 test suites

`npm test` (tests/run-all.cjs) builds `preview/test.html` from `src/`, serves the repo root on a free
port and runs `sim.cjs` plus every `*-check.cjs` here, found by name. A suite prints `PASS` / `FAIL`
lines and an `N/M passed` trailer (use `tests/lib.cjs`), and exits non-zero on any failure.

| Suite | Owner | Runs in | Guards |
|---|---|---|---|
| `sim.cjs` | integrator | Node | sim region purity, every level builds and finishes, determinism, input packing |
| `boot-check.cjs` | integrator | Chromium | boot, three r170 inlined, contract API, no words, tap targets, no errors, rotate overlay |
| `save-check.cjs` | integrator | Node | v12 saves and codes (`fixtures/v12-saves.json`) load; codes round-trip; stars only go up |
| `build-check.cjs` | integrator | Node | `index.html` is fresh, versions agree, no em dashes |
| `physics-check.cjs` | physics | Node | the tuning targets in docs/OVERHAUL.md section 5 |
| `cars-check.cjs` | cars | Chromium | every body x wheels x extras builds, garage flow, shop |
| `worlds-check.cjs` | worlds | Chromium | every world renders within budget, backdrops, accents, icons |
| `fairness-check.cjs` | worlds | Node | every level is fair for the autopilot at skill 0.4 and reaches par A at skill 1 |
| `monsters-check.cjs` | monsters | Node + Chromium | every kind spawns, behaves deterministically, knocks within limits, renders |
| `ui-check.cjs`, `audio-check.cjs` | ui | Chromium | scenes, HUD, controls, no words, tap targets, reduced motion, sfx names |

`node tests/lint.cjs [--owner <owner>]` runs ESLint over the assembled modules (0 findings to ship).
The v12 suites live in `legacy/v12/tests/` for reference only.
