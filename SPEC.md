# VROOM

A late-90s console style metal grunge 3D racer for players around 10 to 12. Browser, one shipped
`index.html` built from `src/` (three.js r170 inlined), offline, iPad first, with a native iOS shell.
This is the v13 spec (2026-11-14, user-directed overhaul: "make this classic playstation metal grunge
style, full physics overhaul and car design, go absolutely wild"). The detailed design, art bible and
module map are in [docs/OVERHAUL.md](docs/OVERHAUL.md); the binding interfaces are `src/contracts.js`.
The v1 to v12 toybox spec is in git history and the v12 game in `legacy/v12/`.

## Design rules (non-negotiable)

- Zero words on screen. Numerals, symbols and pictograms only; the VROOM logo is the one word.
- No fail states. Crashes, monsters, bosses, gaps and walls knock you back, spin you out, dent the
  machine and cost time; nothing ends a run. The crane hook puts a fallen car back on the road. A boss
  always loses the race to the flag. Stars only go up.
- Every tap target at least 64 px rendered at iPad landscape (1024x768).
- Every tap answers instantly: a 4 px plate slam and a metallic clank.
- `prefers-reduced-motion` turns off decorative motion (shake, glints, sway, idle bobs, weather).
- Save data is forever: every v12 save, profile and code loads with its stars, unlocks and parts.
- Real skill: harder, faster, nothing patronising, but every level fair for a middling driver.
- Original: a late-90s console style, never a copy of an existing game, character or brand.
- Loop: race -> collect stars, medals and boss bonuses -> build a meaner machine -> race harder worlds.

## Look

Riveted gunmetal plates, chrome trims, rust from the bolt holes, hazard stripes, molten light from
below; chunky low-poly flat-shaded 3D with saturated dramatic skies, hard rim light and heavy fog. The
chrome VROOM logo with a molten O and a ten-step extrusion. Tokens `--m-*` in `src/shell.html`; each
world tints the UI with its four-colour accent.

## Scenes

1. **Splash.** A foundry anvil-and-hammer sting, then the chrome logo smashes through a riveted plate
   with a shockwave, sparks and an engine roar. About 3 s; any tap skips.
2. **Home.** The world of the day (day number mod 12) as a 3D diorama, the logo, the player's machine
   idling on a hazard podium (tap to rev), a huge GO showing the next level (a skull on finales), garage,
   map, album, settings and profile plates, the wallet. A new-version plate appears here when one is live.
3. **Garage.** The machine on a turntable in a night foundry bay. Tabs: body, wheels, paint, decal,
   extras, buddy, number, workbench (upgrade ladders and repair). Locked parts rusted with a star price;
   preview, buy, bolt on with sparks. Stat bars for speed, power, grip, armour and air.
4. **Map.** Twelve world tabs with riveted emblems (locked worlds behind a hazard gate); a world page is
   a chain of ten level plates over its backdrop, each with its number, stars and medal, the finale plate
   with the boss skull. The parade after level 120.
5. **Race.** Countdown lamps, then the HUD: timer, stars, a progress rail (checkpoints, flag, you, your
   ghost, the boss), an analog gauge with gear and rpm, a ten-segment boost meter, hang-time and drift
   readouts, trick and big-air popups, the boss heat bar on finales. Controls: gas, brake, boost and drift
   plates and a drag-steer zone (or tilt, or left / right plates), keyboard and gamepad. Pause overlay.
   Your best run on the level races alongside as a ghost.
6. **Results.** A slammed gunmetal card: medal stamp (S / A / B / C as chevrons), 1 to 3 stars, time,
   new-best flare, stars collected, air / drift / tricks / hits / respawns, the boss stamp on finales, the
   payout ticking into the wallet, badges as toasts; replay, garage, map, home and a big NEXT.
7. **Overlays.** Settings (quiet, CRT scanlines, steering mode, sensitivity), profiles (three avatars,
   the save QR, copy and paste a code, a wordless confirm), the album (badges and twelve boss emblems).

## Worlds and tracks

Twelve worlds, ten levels each, plus the parade (121): Scrapyard Foundry, Ember Canyon, Neon Necropolis,
Drown Docks, Frostbite Pass, Scorch Flats, Wreck Cove, Orbital Scrapheap (gravity 3.6), Magma Forge,
Rot Sugar Carnival, Abyss Trench, Storm Citadel. Levels come from a seeded course grammar over the track
pieces (straight, bend, banked, hill, crest, ramp, gap, corkscrew, loop, halfpipe, split, rumble) with
per-world feature weights, surfaces, hazards and props. Difficulty rises through the 120: narrower roads,
longer gaps, more hazards and monsters. Every tenth level is a boss chase. Par S / A / B comes from a
pace model and is proven by the autopilot.

## Machines

31 bodies in six classes (brute, hauler, racer, tank, hover, freak): the 23 v12 ids rebuilt as heavy
machines plus eight new ones. 20 wheel sets, 32 paints (solid, candy, metallic, patterns, eight metal
finishes), 14 decals, 18 extras with small stat effects, 12 buddies, a race number. Upgrades: engine,
armour, magnet, boost tank, springs (three pips each). Repair hammers out dents (2 stars each). The
default build is the free Mauler monster truck.

## Monsters

Two creature kinds per world (lurkers, roamers, swarms, divers, burrowers) and a boss per world. Every
hit is telegraphed at least 0.3 s ahead and dodgeable; a knock costs at most 1 s of control. Bosses
rubber-band behind, surge alongside, attack with throws, sweeps, rolls, eruptions, leaps and charges,
land dazed after a leap (ram them three times to smash them), and are beaten at the flag. Boss bonus
stars: 3 smashed, 2 outrun untouched, 1 outrun.

## Physics

Deterministic, fixed 120 Hz step, bit-exact maths, seeded rng; ports to Swift. Tuning targets (proven by
`tests/physics-check.cjs`): top speed 40 m/s for the base monster truck, about 50 for racers, about 34 for
tanks, boost +30 percent; 0 to 30 m/s in 3.0 to 3.5 s; lateral grip 1.0 to 1.2 g on asphalt, 0.15 on
ice; braking 40 to 0 under 3.5 s; 1 to 3 s of air on a ramp, up to 5 s on mega ramps, 2.5 times in orbit;
a 3 s drop keeps over 90 percent of its speed; a 15 degree wall glance keeps 85 percent.

## Economy

Stars collected + 3 a race, +2 for a clean run (no hits, no respawns), +25 the first time a finale falls,
the boss bonus, +100 the first parade. Bests, ratings and tiers only go up. v13 badges append to v12's:
first boss, 3 s of air, a 3 s drift, every star on a level.

## Tech

`src/` modules, one owner each, built by `scripts/build.cjs`. three.js r170, eslint, playwright-core
and jsqr are dev dependencies only. Saves in localStorage (`vroom.v2.p<n>`, `vroom.meta`), v12 compact
and full codes plus the QR. The update gate compares `APP_VERSION`. 15 test suites (`npm test`).

## Verify

`npm run build`, `npm test` (every suite green), `node tests/lint.cjs` (0 findings), and a look at the
screenshots from `node scripts/doc-shots.cjs`.
