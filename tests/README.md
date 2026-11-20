# VROOM 13 test suites

`npm test` (tests/run-all.cjs) builds `preview/test.html` from `src/`, serves the repo root on a free
port and runs `sim.cjs` plus every `*-check.cjs` here, found by name. A suite prints `PASS` / `FAIL`
lines and an `N/M passed` trailer (use `tests/lib.cjs`), and exits non-zero on any failure.
16 suites, 467 checks.

| Suite | Owner | Runs in | Checks | Guards |
|---|---|---|---|---|
| `sim.cjs` | integrator | Node | 6 | sim region purity, every level 1..121 builds and the autopilot finishes it, determinism, input packing |
| `boot-check.cjs` | integrator | Chromium | 20 | boot, three r170 inlined, no foreign requests, contract API, iPad shell metas, splash then home, no words and 64 px targets on home / garage / map / race, portrait asks to rotate |
| `save-check.cjs` | integrator | Node | 104 | v12 saves and codes (`fixtures/v12-saves.json`) load with every star, unlock and part; 13.29 saves and codes (`fixtures/v13.29-saves.json`, captured from `legacy/v13.29/`) load and re-save whole: three slots with a deleted slot 0, all 96 levels with ghosts, the 13.23 photo wall, album seen list and free-drive day, VROOM1/2/3 codes (also pasted inside a message), the avatar a full code carries, tier records only improving; codes round-trip; stars only go up; damage, repair, upgrade ladders, finale and boss bonuses, v13 badges, the parade jackpot; a full localStorage sheds replays not progress, across all three profiles sharing one quota; three profiles; the save QR scans with jsQR |
| `flow-check.cjs` | integrator | Node + Chromium | 30 | deep links; splash -> home -> garage -> map -> race -> results through the real plates; countdown and pause hold the sim; a race banks time, replay and payout; the ghost replays the best run bit-exact; a fall is caught by the crane; results and pause have no words; reduced motion keeps the camera still; a v12 save and a v12 code keep their stars and unlocks in the page |
| `update-check.cjs` | integrator | Chromium | 14 | the new-version gate keyed on APP_VERSION: hidden when equal, shown on home when the server differs, never mid-race or in the garage, quick tap ignored, held press reloads with a cache-busting URL; 14.1.1 is above 13.29.0, and a hosted 13.29 page arms its own gate for this build and a hold loads 14.1.1 |
| `build-check.cjs` | integrator | Node | 3 | `index.html` is fresh, versions agree, no em or en dashes |
| `physics-check.cjs` | physics | Node | 52 | the tuning targets in docs/OVERHAUL.md section 5: top speeds, 0 to 30, braking, grip per surface, airtime, landings, wall glances, monster knocks, no monster or pack can pin the car, drift (a power slide per class: rear steps out, speed and gear hold, a 20 to 45 deg slip angle the steering orders, no spin, exit boost scales, clean 100 m bends, an autopilot-steered bend still banks), tricks, every piece type, the crane (never for a deliberate stop or reverse), determinism |
| `sim-check.cjs` | physics | Node | 10 | sane frames on all 121 tracks; skill 1 and 0.4 bots finish every level with no NaN and stay on the road; every car class finishes; determinism |
| `levels-check.cjs` | worlds | Node | 16 | world roster against the monster kinds, spec shape, determinism, escalation, placement rules, par range |
| `fairness-check.cjs` | worlds | Node | 3 | every level is fair: the skill-0.4 autopilot finishes under 2x par B with at most 3 respawns, skill 1 reaches par A |
| `worlds-check.cjs` | worlds | Chromium | 21 | every world renders within budget from 5 cameras, events, dispose leaks, overheads off jump flights on all 120 levels, backdrops, cards, FX, reduced motion; smoke, dust and spray are pooled camera-facing billboards that fade; boss trails and entrance blasts; frost stays dark with sodium light; creatures drawn true to their sim radius, eye glints and hot rims in a tell; bosses at size with their own light and a rise-up entrance |
| `cars-check.cjs` | cars | Node + Chromium | 43 | catalog (legacy ids, free stays free, paid stays paid, append-only lists), the starter build and two-tone paints, class feel, every body and part builds within budget, every machine has an exhaust that flames on boost only, edge light on every lit material, suspension, damage, thumbnails, the garage shop flow with no words and 64 px targets, reduced motion |
| `monsters-check.cjs` | monsters | Node + Chromium | 39 | 24 creatures and 12 bosses: purity, telegraphed hits, knock limits, avoidability, stun cap, boss rules (never in the car's path within 10 m, in view for 80% of every chase, level beside the road in every finale, outrun at the flag), determinism, rigs within budget, no boss drawn through the car, a chasing boss framed under the HUD, reduced motion |
| `ui-check.cjs` | ui | Chromium | 69 | tokens, logo, splash, home, map, race HUD (gauge clear of the near road, needle on its pivot, arrowhead and skull rail markers), countdown, keyboard, touch and drag steering, touch plates hidden until a touch and hidden again under keyboard, pause, results tally, overlays (settings, profiles with QR, album), no words and 64 px targets on 9 screens, reduced motion |
| `attract-check.cjs` | ui | Chromium | 25 | attract mode: starts after the home idle, races the autopilot behind the menu with camera cuts that keep the car right of the menu (never starts under reduced motion), any input returns to the podium and the waking press is swallowed, overlays and hidden tabs stop it, leaving home disposes it |
| `audio-check.cjs` | ui | Chromium | 13 | gesture unlock, every SFX name audible, all 17 songs, every engine class, 12 ambiences, quiet mode |

`node tests/lint.cjs [--owner <owner>]` runs ESLint over the assembled modules (0 findings to ship).
Timing-sensitive checks (worlds-check render budgets, ui-check countdown) can flake on a loaded box;
rerun that suite alone with `node tests/run-all.cjs --only <suite>` before treating a failure as real.

## Retired with the v12 2D engine

v13 deleted the SVG side view, the OutRun-style projector, the lane road, the beat sequencer and the
toddler-era chores, so the 23 v12 suites (393 checks) were retired. They are kept in
`legacy/v12/tests/` for reference. Every rule they guarded that still applies has a v13 check:

| v12 suite | What it guarded | Status in v13 |
|---|---|---|
| `verify.cjs` (35) | garage inventory, 64 px floor, shop economy, level invariants, map, persistence | economy and persistence: `save-check`; garage, shop and 64 px: `cars-check`, `ui-check`, `boot-check`; levels: `levels-check`, `sim.cjs`; map: `ui-check`, `flow-check` |
| `polish-check.cjs` (16) | locks, price tags, magnet, headlights, celebrate, reduced motion | locks and tags: `cars-check`; reduced motion: `ui-check`, `cars-check`, `worlds-check`, `monsters-check`, `flow-check`. Retired: headlights and the confetti celebrate (no longer in the game) |
| `damage-check.cjs` (20) | damage tiers, repair, upgrades, keyboard | damage, repair, ladders: `save-check`; repair and workbench UI: `cars-check`; keyboard: `ui-check` |
| `free-check.cjs` (14) | capsules, free drive, time tiers | time tiers: `physics-check`, `fairness-check` (par S/A/B). Retired: gift capsules (buddies are sold in the garage now) and the free-drive scene (not in v13) |
| `feel-check.cjs` (12) | body dynamics, hit-stop, celebrate pacing, iPad shell metas | dynamics: `physics-check`; iPad metas: `boot-check`. Retired: the 2D body sway and celebrate pacing |
| `worlds-check.cjs` (21) | 12 worlds, movers, gravity, map, unlock chain, world bonus, premium shop | worlds: `worlds-check`, `levels-check`; gravity: `physics-check`; unlock chain: `flow-check`, `save-check`; world bonus: `save-check`; shop: `cars-check` |
| `album-check.cjs` (15) | buddies, badges, photos, peek card, muddy flag | badges and bosses: `ui-check` album; muddy flag round-trips: `save-check`. Retired: finish-line photos (kept in saves, no longer taken) |
| `profile-check.cjs` (14) | 3 profiles, save codes, QR byte-exact via jsQR | `save-check` (profiles, codes, jsQR), `ui-check` (profiles overlay), `flow-check` (code import in the page) |
| `washdecals-check.cjs` (11) | wash mini-game, decal shop | decals: `cars-check`. Retired: the wash (dropped in v13, `muddy` kept in saves) |
| `parade-check.cjs` (12) | parade unlock, finale, jackpot, champ badge | `save-check` (unlock, jackpot once, champ), `sim.cjs` (level 121 finishes) |
| `update-check.cjs` (5) | new-version gate | ported: `update-check` (now keyed on APP_VERSION) |
| `world-check-audio-events.cjs` (16) | per-world music, ambience, quiet mode, level-80 frame time | `audio-check`; frame cost: `worlds-check` and `monsters-check` draw-call and triangle budgets. Retired: the v12 star-chime scales and sky events |
| `paint-check.cjs` (22) | pattern paints, v3 code with colours, v2 decode | `cars-check` (paints), `save-check` (codes, v1/v2 decode) |
| `shop-check.cjs` (23) | 23 bodies, 14 wheels, every body x extras x buddy x decal, v3 round trip | `cars-check` (every body and part builds), `save-check` |
| `garage-check.cjs` (19) | garage tabs, select, buy, paging, no text, 64 px | `cars-check` |
| `fairness-check.cjs` (9) | lane bots finish every level and find stars | `fairness-check` (v13 autopilot, par based), `sim-check`, `sim.cjs` |
| `number-check.cjs` (13) | race number keypad, price, roundel, code tail | number tab: `cars-check`; code tail: `save-check`. Retired: the 400-star keypad (the v13 number tab steps by 1 and 10) |
| `course-check.cjs` (22) | 2D corkscrews, hard turns, rollers, mega ramps, hop chains | `physics-check` and `sim-check` drive every v13 piece type, including true 3D corkscrews and loops; `fairness-check` proves no landing past the flags |
| `title-check.cjs` (13) | title scene, daily gift, `?garage` skip | splash and home: `boot-check`, `ui-check`; `?garage`: `flow-check`. Retired: the daily gift capsule (`lastGift` kept in saves) |
| `ghost-check.cjs` (16) | ghost trace, replay, keep the faster, reload, out of codes, malformed dropped | `flow-check` (bit-exact replay ghost, stored with the run), `save-check` (replays round-trip, never in a code, validated on load) |
| `upkeep-check.cjs` (21) | fuel, tyres, shine bonus, workbench fill-up | Retired with the chores; `fuel` and `tread` still load, round-trip and ride the code tail (`save-check`) |
| `events-check.cjs` (23) | date-seeded map surprises, sleeping dino, rainbow day | Retired: no map events in v13. The secret `p:rainbowshine` paint stays owned if a save has it (`save-check`) |
| `life-check.cjs` (17) | garage idle putter, buddy blinks, tap toys | garage animation and reduced motion: `cars-check`; home rev: `ui-check` |

## Adding a check

Add it to the suite that owns the area (above), keep it deterministic (levels are seeded, so assert
exact values where you can) and update the count in this table and in the top-level README.
