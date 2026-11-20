# VROOM architecture

How the v13 pieces fit. `docs/OVERHAUL.md` is the design and `src/contracts.js` the binding interface;
this page is the tour. v12's 2D engine is described in `legacy/v12/` and no longer applies.

## The build

`src/` holds one file per module. `scripts/build.cjs` reads them in a fixed ORDER, wraps each as
`(function (VROOM) { 'use strict'; ... })(VROOM)` in its own `<script>` (so one broken module cannot stop
the others loading), inlines `node_modules/three/build/three.module.min.js` as a frozen `window.THREE`,
and drops everything into `src/shell.html` at the `@@THREE@@` and `@@MODULES@@` placeholders. The result
is the one shipped `index.html` (about 1.5 MB), with no requests beyond itself.

```
sim region (DOM-free, THREE-free, deterministic)          browser modules
  contracts.js   ids, shapes, frozen LEGACY lists           save.js      v12 save format + v13 fields, codes, QR
  dmath.js       bit-exact maths (fdlibm), seeded rng       audio.js     synthesized sfx, engines, music, ambience
  catalog.js     bodies, parts, prices, CarStats            fx.js        pooled particles and skid marks
  levels.js      12 worlds, 120 levels + parade             cars.js      machine meshes, the garage scene
  sim.js         track ribbon, vehicle dynamics, bot         worlds.js    environments, backdrops, emblems
  monsters.sim.js creature and boss behaviour                monsters.js  creature and boss meshes
                                                             ui.js        splash, home, map, results, HUD, controls
                                                             game.js      renderer, router, loop, race, camera
```

Modules publish one object each (`VROOM.sim`, `VROOM.cars`, ...) and reach each other only through
`VROOM.<name>.<member>` at call time. Scenes register into `VROOM.scenes[id]`; `game.js` runs last,
boots and routes. `tests/sim.cjs` and `tests/lib.cjs` load the sim region straight into Node with
`new Function('VROOM', simSource())`.

## Scenes and the frame loop

`splash -> home -> garage | map -> race -> results`. A scene is `{ id, dom, enter(params), exit(),
update(dt, t), view }`; `game.go(id)` exits the current one, toggles the `.scene.active` DOM layer and
enters the next. Each animation frame `game.js` calls `update(dt, t)` and, when the scene has a `view`,
renders its `{ scene, camera }` to the one WebGL canvas `#view`. Home renders itself (the world-of-the-day
backdrop full frame, then the player's machine on a podium in a scissored viewport). The stage is a fixed
1200x700 box scaled to the window; the renderer's pixel ratio follows the real on-screen size.

## The race

`game.js` owns `VROOM.scenes.race`:

1. `levels.level(n)` gives the LevelSpec (pieces, props, stars, monsters, boss, par), `sim.buildTrack`
   turns it into a ribbon sampled every metre, `sim.newRace` makes the SimState with the player's
   `catalog.stats(build)` (plus its class) through `sim.carParams(stats, upgrades)`.
2. `worlds.buildWorld` meshes the road straight from the Track arrays and dresses the world;
   `cars.buildCar` and one `monsters.build` per actor add the rigs.
3. Every frame the accumulated time is spent in fixed `SIM_DT = 1/120` s steps (at most 8 per frame).
   Before each step the previous car and actor poses are kept, so the render interpolates between the
   last two ticks by `acc / SIM_DT` (position lerp, quaternion slerp, shortest-way yaw). The sim never
   sees a frame time.
4. `state.events` drain into sounds (`audio.sfx`), the world's effects (`world.onEvent`), the monster
   rigs (`rig.onEvent`) and the HUD (`ui.hud.event`). Big impacts add camera shake (never under reduced
   motion) and a 60 ms hit-stop.
5. The chase camera sits behind the direction of travel, sized to the machine, with its up vector eased
   toward the road's own surface normal so loops and corkscrews carry the view round; it widens with speed
   and boost and snaps after a crane respawn.
6. The countdown and pause hold the race: `ui.js` wraps the scene's `update` once and skips the sim
   while `ui.counting()` or `ui.paused()`.
7. At the flag, `sim.result()` plus the boss bonus (`monsterAI.bonus`) and the run's longest air and
   drift go to `save.recordRun`, with the replay; then the results scene.

## The deterministic sim

`src/sim.js` (see its header for the full model): a rigid body with box inertia on four raycast
spring-damper wheels, slip-angle tyres with a peak at 0.14 rad and a friction ellipse, a per-surface grip
and drag table (`SURF_P`), a power-to-weight engine with gears and rpm for the sound, boost, drift with a
clean-exit boost bank, air control and tricks, bump stops, body-corner contacts, wall impulses that glance,
props by category, and a rail that holds the car on loops and corkscrews above 9 m/s. The crane respawns
the car after a fall, a gap, being upside down or stuck; the third fall since a checkpoint carries it past
the obstacle, so every race finishes. Monsters are thought in `actors[]` order through one shared context;
contact honours each actor's `hot` and `knock`, scaled by mass ratio and armour, capped at 1 s of lost
control. `sim.autopilot(state, skill)` is the deterministic bot behind `?bot=1`, the tests and the fairness suite.

Determinism rules: maths only through `VROOM.dmath` (fdlibm sine, cosine, atan2 and friends, so results
match across engines and the Swift port), randomness only from the state's seeded rng, no allocation per
tick, no clocks. `tests/sim.cjs` scans the region for banned names; `physics-check` and `flow-check` prove
bit-exact replays.

## Ghosts

A finished run's inputs are packed per tick (`sim.packInput`: steer, throttle, brake, boost, drift in 20
bits) and run-length encoded by `save.encodeReplay` into `levels[n].replay = { t, ticks, rle, b }`, where
`b` is the build key (body, wheels, extras, upgrade pips). Next time that level is raced in the same build,
a second SimState steps the decoded inputs alongside the live one and drives a translucent rig
(`buildCar(..., { ghost: true })`). Because the sim is deterministic the twin crosses the line at the
stored time to the tick. Replays never ride in save codes; when localStorage is full, `save.save()`
sheds the longest replays first and keeps every star.

## State and persistence

`src/save.js` keeps v12's format whole: `vroom.v2.p<n>` per profile (three profiles), `vroom.meta`, the
`vroom.v1` and single-profile `vroom.v2` migrations. `save.apply()` validates every field against the live
catalog orders (contracts `LEGACY` followed by `catalog.NEW_*`, append only), keeps unknown fields
untouched and defaults every v13 field (`bosses`, `ctrl`, per-level `t13` and `replay`). The v12 chores
(`fuel`, `tread`, `muddy`, ghost traces, photos, the gift stamp) are retired from play but still load and
save.

Economy: `recordRun` pays stars collected + 3, +2 for a clean run, +25 the first time a finale is beaten,
plus the boss bonus (3 smashed, 2 outrun untouched, 1 outrun), +100 the first parade; bests, ratings and
tiers only go up. Hits dent the machine (repair is 2 stars a dent). Upgrades are three-pip ladders.

## Save codes and the QR

`VROOM1.` compact codes are format 3 exactly as v12 wrote them: a version byte, wallet, level, damage,
flags, the three original upgrade pips, then count-prefixed ownership lists (so ids appended later decode
in both directions), the build as catalog indices, two bits of rating and tier per level, and the tail:
fuel and tread (12.2), race number (12.3), tank and springs pips (12.7), and in 13.0 twelve bits for the
bosses beaten. Every tail read is guarded by `pos + n <= bytes.length * 8`, so shorter older codes simply
stop. Formats 1 and 2 still decode. `VROOM2.` (gzip JSON) and `VROOM3.` (plain) full codes carry the
whole save minus replays and ghosts. The QR is a hand-rolled encoder (byte mode, ECC L, versions 1 to 10)
that carries `https://acker-cloud.github.io/vroom/#save=<code>`; `save-check` scans it with jsQR.

## The update gate

`game.js` re-fetches the page (`?v=<time>`, `cache: 'no-store'`) 2.5 s after boot, on return to the
foreground and every ten minutes, and reads `APP_VERSION` out of the copy. A different version shows a
green hazard plate with a ring on home; a 1.6 s hold saves and reloads through a cache-busting URL, a quick
tap does nothing. v12 pages in the wild fingerprint their own code, so they see v13 as an update too.

## Audio

`src/audio.js`, all Web Audio synthesis, nothing before the first gesture: buses into a master gain,
compressor and plate reverb. SFX are metal clanks, distorted crunches, sub thumps and formant growls. Each
machine class has an engine voice (detuned saws and a sub through a shaper, firing pulse, boost whine,
off-throttle crackle). Music is a 16-step lookahead sequencer playing power chords, bass, drums and a
lead in each world's scale; every song is original.

## Tests

See [tests/README.md](../tests/README.md): 16 suites, Node and headless Chromium, plus ESLint over the
assembled script. `npm test` builds `preview/test.html` and serves it, so the shipped `index.html` is
only checked for freshness (`build-check`).
