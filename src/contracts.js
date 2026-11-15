/* contracts: the shapes every module passes to every other, and the ids that are frozen forever.
   Owner: integrator (architect wrote it). Builders read it; a change here is a cross-team change.
   DOM-free, THREE-free, deterministic: it runs in the sim region (tests/sim.cjs loads it in Node).

   How modules meet. scripts/build.cjs wraps every src/*.js file as
       (function (VROOM) { 'use strict'; ...file... })(VROOM);
   so a file's top-level names are private. A module publishes exactly one object on VROOM
   (VROOM.sim, VROOM.cars, ...) and reaches other modules ONLY through VROOM.<name>.<member>,
   looked up at call time (never captured at load), so load order matters only for code that
   runs at load. Load order (scripts/build.cjs ORDER):
       sim region: contracts, dmath, catalog, levels, sim, monsters.sim
       then:       save, audio, fx, cars, worlds, monsters, ui, game
   Scenes register into VROOM.scenes[id] at load; game.js boots last and routes between them.

   Units everywhere: metres, seconds, kilograms, radians. y is up. three.js is right-handed.
   Car space: +z is the nose, +y up, origin on the ground under the chassis centre, so +x is the car's
   LEFT (seen from the chase camera behind the car, +x points to the left of the screen). Object3D.lookAt
   turns +z toward a target, so a model built nose-on-+z just works.
   Track space: s metres along the centreline, d metres to the DRIVER'S RIGHT (r = cross(t, u)), h metres
   above the surface along u. A turn with angle > 0 turns to the driver's right. */

const APP_VERSION = '14.0.0';

/* ---------- sim timing ---------- */
const SIM_HZ = 120;
const SIM_DT = 1 / SIM_HZ;          /* the one fixed step. Render interpolates; the sim never sees a frame time. */
const MAX_STEPS_PER_FRAME = 8;      /* game.js caps catch-up after a stall */

/* ---------- stage ---------- */
const STAGE_W = 1200, STAGE_H = 700; /* fixed stage, letterboxed. 64 rendered px at 1024x768 = 75 stage px; use 88+ */
const MIN_TAP = 88;

/* ---------- world and level counts (levels.js fills the content) ---------- */
const WORLD_COUNT = 12, WORLD_SIZE = 10, MAX_LEVEL = WORLD_COUNT * WORLD_SIZE;   /* 120; level n is in world ceil(n / 10) */
const PARADE_LEVEL = MAX_LEVEL + 1;   /* the victory lap after 120, as in v12 */
const worldOf = n => Math.min(WORLD_COUNT, Math.max(1, Math.ceil(n / WORLD_SIZE)));
const isFinale = n => n >= 1 && n <= MAX_LEVEL && n % WORLD_SIZE === 0;   /* every tenth level: the boss chase */

/* ---------- track pieces: the ONLY vocabulary levels.js may author; sim.buildTrack implements every one ----------
   A LevelSpec's pieces[] run end to end. Every piece has `len` (metres of centreline) and may carry
   `surf` (a SURF key, default the world's), `walls` (0 none, 1 left, 2 right, 3 both; default 3),
   `w` (half width at the piece's end, metres, eased from the previous; default 7), `deco` (a free
   string the renderer reads: 'tunnel', 'bridge', 'pipe', 'cage', ...; the sim ignores it).        */
const PIECES = {
  straight:  { args: [] },
  bend:      { args: ['angle', 'bank'] },            /* angle: total yaw, + turns right; bank: roll at the apex, + leans into a right turn */
  hill:      { args: ['rise'] },                     /* smooth S-curve in height: rise metres over len (negative = dip) */
  crest:     { args: ['h'] },                        /* a hump of height h (cosine), the airtime-on-a-crest piece */
  ramp:      { args: ['rise', 'lip'] },              /* kicker: climbs rise metres, ends at pitch `lip` (rad). Usually followed by a gap. */
  gap:       { args: ['drop'] },                     /* no surface for len; the next piece starts drop metres lower (negative = higher) */
  corkscrew: { args: ['turns'] },                    /* the road rolls turns x 2pi about its centreline over len (+ = clockwise seen from behind) */
  loop:      { args: ['radius'] },                   /* a vertical loop of radius r (len is ignored: 2 pi r); needs speed; too slow drops you off */
  halfpipe:  { args: ['wallH'] },                    /* the cross-section curves up wallH metres at both edges (no walls) */
  banked:    { args: ['angle', 'bank'] },            /* a high-speed bowl turn: like bend but bank is held for the whole piece */
  split:     { args: ['sep'] },                      /* two parallel lanes sep metres apart, rejoining at the end; a wall between them */
  rumble:    { args: ['amp', 'wave'] },              /* washboard: surface bumps amp metres, wave metres long */
};

/* ---------- surfaces: grip is the sim's lateral friction multiplier, drag its rolling drag (1/s) ---------- */
const SURF = {                                       /* code -> key; Track.surf stores the code */
  0: 'asphalt', 1: 'steel', 2: 'dirt', 3: 'sand', 4: 'mud', 5: 'ice', 6: 'snow', 7: 'oil', 8: 'water', 9: 'lava', 10: 'glass', 11: 'cloud', 12: 'sugar',
};
const SURF_CODE = Object.fromEntries(Object.entries(SURF).map(([c, k]) => [k, +c]));

/* ---------- Track.flags bits, one byte per sample ---------- */
const TF = { GAP: 1, WALL_L: 2, WALL_R: 4, RAMP: 8, LOOP: 16, CHECK: 32, FINISH: 64, COVER: 128 };

/* ---------- props: what levels.js places, how the sim treats each category ----------
   PropPlace = { cat, look, s, d, len?, w?, h?, r? }
     cat   one of PROP_CAT keys (physics behaviour)
     look  'world.thing' mesh key, e.g. 'foundry.slagdrum'; worlds.js draws it, the sim never reads it
     s, d  along-track and lateral (+ right of centre) position, metres
     len, w   patch / pad extent (along, half width) for pads and patches
     r     radius for round things (defaults per cat)                                              */
const PROP_CAT = {
  cone:    { kind: 'soft',  r: 0.4,  mass: 5 },      /* knocked flying; car loses a little speed */
  crate:   { kind: 'soft',  r: 0.7,  mass: 40 },     /* scrap box, barrel: smashes, bigger slow-down */
  barrier: { kind: 'hard',  r: 1.0,  mass: 0 },      /* static: concrete block, girder, wreck. Bounce + spin, never a stop forever */
  boulder: { kind: 'hard',  r: 1.4,  mass: 0 },
  pillar:  { kind: 'hard',  r: 0.8,  mass: 0 },
  boost:   { kind: 'pad',   len: 6, w: 2 },          /* speed kick along the track */
  nitro:   { kind: 'pickup', r: 1.0 },               /* refills the boost meter */
  jumpPad: { kind: 'pad',   len: 3, w: 2 },          /* launches the car up */
  oil:     { kind: 'patch', len: 8, w: 2.5 },        /* grip drops, spin risk */
  mud:     { kind: 'patch', len: 10, w: 3 },
  ice:     { kind: 'patch', len: 12, w: 3 },
  water:   { kind: 'patch', len: 10, w: 3 },
  mine:    { kind: 'trap',  r: 0.8 },                /* blast: launches and spins the car, no damage beyond a dent */
};

/* ---------- monster archetypes (monsters.sim.js implements the behaviour, sim.js the contact) ---------- */
const ARCHE = ['lurker', 'roamer', 'swarm', 'diver', 'burrower', 'boss', 'debris'];

/* ---------- sim events: sim.step pushes these on state.events; game.js drains them each frame ----------
   Every event is { type, tick, ...fields }. Fields per type:                                     */
const EVENTS = {
  star:       ['i'],                         /* star i collected */
  nitro:      ['i'],                         /* nitro pickup i */
  boost:      ['on'],                        /* boost started (on 1) or ran out / released (on 0) */
  pad:        ['i'],                         /* drove over boost pad / jump pad i */
  jump:       ['vy'],                        /* left the ground with this upward speed */
  land:       ['airT', 'hard'],              /* touched down after airT seconds; hard 0..1 */
  trick:      ['kind', 'n'],                 /* airborne rotation completed: kind 'flip' | 'roll' | 'spin', n of them */
  hit:        ['i', 'cat', 'impulse'],       /* hit prop i of category cat; impulse m/s of speed change */
  scrape:     ['side', 'v'],                 /* rubbing a wall: side -1 left / 1 right, v tangential speed */
  wall:       ['side', 'impulse'],           /* a hard wall impact */
  drift:      ['on'],                        /* drift entered / left */
  driftBank:  ['t', 'bonus'],                /* a drift of t seconds ended cleanly and banked bonus boost */
  spin:       ['why'],                       /* spin-out started: 'oil' | 'hit' | 'monster' | 'mine' */
  surface:    ['surf'],                      /* the surface under the car changed (SURF code) */
  monster:    ['a', 'what'],                 /* actor index a: 'tell' | 'lunge' | 'hit' | 'roar' | 'stomp' | 'retreat' */
  boss:       ['a', 'what'],                 /* boss actor a: 'enter' | 'attack' | 'hit' | 'enrage' | 'defeat' */
  checkpoint: ['i'],
  respawn:    ['s'],                         /* fell off / into a gap: the crane put the car back at s (costs time, never the run) */
  finish:     ['t'],
};

/* ---------- inputs ----------
   InputFrame = { steer -1..1 (+ right), throttle 0..1, brake 0..1 (also reverse when stopped), boost 0|1, drift 0|1 }
   The sim quantizes every field on entry (sim.quantize): steer to 1/64, throttle and brake to 1/16. A
   replay (ghost) is the packed input per tick (sim.packInput -> a 20-bit int: steer 8 bits, throttle 5, brake 5, boost 1, drift 1), run-length encoded by save.js. */

/* ---------- frozen ids: SAVE DATA IS FOREVER ----------
   These are the v12.9 catalog orders exactly as shipped (tests/fixtures/v12-saves.json proves it).
   Append only, never reorder, never remove. v13 additions come from VROOM.catalog.NEW_* arrays and are
   appended after these by save.js. A legacy id may be redesigned completely (the 'dump' truck can
   become a slag hauler), but it must exist in VROOM.catalog with the same id.                     */
const LEGACY = Object.freeze({
  BODY_ORDER: ['dump', 'digger', 'mixer', 'fire', 'monster', 'police', 'race', 'tractor', 'icecream', 'rocket', 'ufo', 'limo', 'dragon', 'train', 'royal',
    'bulldozer', 'schoolbus', 'ambulance', 'submarine', 'pirate', 'dino', 'unicorn', 'hover'],
  WHEEL_ORDER: ['normal', 'monster', 'racing', 'gold', 'flower', 'tank', 'glow', 'star', 'donut', 'cookie', 'lava', 'bubble', 'crystal', 'disco'],
  COLORS: ['#e53935', '#1e88e5', '#fdd835', '#43a047', '#fb8c00', '#ec407a', '#8e24aa', '#00acc1', '#9ccc65', '#f5f5f5', '#37474f', 'rainbow',
    'p:stripes', 'p:flames', 'p:dots', 'p:checker', 'p:camo', 'p:candy', 'p:galaxy', 'p:gold', 'p:leopard', 'p:bubblegum', 'p:bolt', 'p:rainbowshine'],
  DECAL_ORDER: ['none', 'flame', 'star', 'heart', 'bolt', 'eyes', 'rainbow', 'dinofoot', 'flower'],
  BUDDY_ORDER: ['pup', 'kitty', 'ducky', 'dino', 'penguin', 'monkey', 'fox', 'bunny', 'frog', 'robot'],
  EXTRAS: ['horn', 'beacon', 'flag', 'wings', 'booster', 'partyhat', 'spoiler', 'antenna', 'surf', 'bubbles', 'jetpack', 'trophyrack'],
  BADGES: ['jump', 'clean', 's', 'world', 'buy', 'gag', 'champ', 'shine'],
  UPGRADES: ['engine', 'armor', 'magnet', 'tank', 'springs'],
  /* save-code paid lists (VROOM1 format 3 count-prefixes each) */
  CODE_BODIES: ['police', 'race', 'tractor', 'icecream', 'rocket', 'ufo', 'limo', 'dragon', 'train', 'royal', 'bulldozer', 'schoolbus', 'ambulance', 'submarine', 'pirate', 'dino', 'unicorn', 'hover'],
  CODE_WHEELS: ['gold', 'flower', 'tank', 'glow', 'star', 'donut', 'cookie', 'lava', 'bubble', 'crystal', 'disco'],
  CODE_COLORS: ['#8e24aa', '#00acc1', '#9ccc65', '#f5f5f5', '#37474f', 'rainbow', 'p:stripes', 'p:flames', 'p:dots', 'p:checker', 'p:camo', 'p:candy', 'p:galaxy', 'p:gold', 'p:leopard', 'p:bubblegum', 'p:bolt', 'p:rainbowshine'],
  CODE_EXTRAS: ['wings', 'booster', 'partyhat', 'spoiler', 'antenna', 'surf', 'bubbles', 'jetpack', 'trophyrack'],
  CODE_DECALS: ['flame', 'star', 'heart', 'bolt', 'eyes', 'rainbow', 'dinofoot', 'flower'],
  CODE_BADGES: ['jump', 'clean', 's', 'world', 'buy', 'gag'],
  /* v12 prices: an owned[] entry survives load only if its id is paid (here or in the v13 catalog) */
  PRICES: {
    body: { police: 25, race: 40, tractor: 60, icecream: 80, rocket: 120, ufo: 200, limo: 250, dragon: 300, train: 350, royal: 400, bulldozer: 75, schoolbus: 90, ambulance: 110, submarine: 150, pirate: 180, dino: 220, unicorn: 280, hover: 1000 },
    wheels: { gold: 30, flower: 50, tank: 70, glow: 90, star: 120, donut: 50, cookie: 50, lava: 80, bubble: 85, crystal: 120, disco: 220 },
    color: { '#8e24aa': 10, '#00acc1': 10, '#9ccc65': 15, '#f5f5f5': 15, '#37474f': 20, rainbow: 60, 'p:stripes': 40, 'p:flames': 70, 'p:dots': 45, 'p:checker': 50, 'p:camo': 55, 'p:candy': 45, 'p:galaxy': 110, 'p:gold': 120, 'p:leopard': 60, 'p:bubblegum': 50, 'p:bolt': 65, 'p:rainbowshine': 0 },
    decal: { flame: 30, star: 20, heart: 20, bolt: 40, eyes: 50, rainbow: 35, dinofoot: 40, flower: 45 },
    extras: { wings: 40, booster: 60, partyhat: 25, spoiler: 30, antenna: 20, surf: 40, bubbles: 45, jetpack: 180, trophyrack: 260 },
  },
  SECRET_COLORS: ['p:rainbowshine'],   /* priced 0 but never free: only an award puts it in owned */
});

/* ---------- module API: what each module must publish (tests/boot-check.cjs and tests/sim.cjs verify the names exist) ----------
   The JSDoc-ish shapes below are the contract. "->" is the return value.                         */
const MODULE_API = {
  /* src/catalog.js (cars owner), DOM-free. The garage's data and every vehicle's physical stats.
     BODIES[id]  = { id, cls, price, stats: CarStats, seats?: n }       cls: 'hauler' | 'brute' | 'racer' | 'hover' | 'tank' | 'freak'
     WHEELS[id]  = { id, price, r, width, grip, mass }                  r, width metres; grip multiplier ~0.8..1.2
     PAINTS[id]  = { id, price, kind: 'solid' | 'metal' | 'pattern', base: '#hex', metal: 0..1, rough: 0..1, secret? }
     DECALS[id], EXTRAS[id], BUDDIES[id] = { id, price, ...mods }        EXTRAS may carry stat mods: { mods: { grip: +0.03, ... } }
     NEW_* arrays: v13 ids in append order (never reordered once shipped)
     CarStats = { mass, wheelbase, track, cgH, rideH, wheelR, suspK, suspC, suspTravel, power, topSpeed, grip, driftGrip,
                  brake, steerMax, airControl, boostPower, armor, size: { l, w, h } }   (SI units; armor 0..1) */
  catalog: ['BODIES', 'WHEELS', 'PAINTS', 'DECALS', 'EXTRAS', 'BUDDIES',
    'NEW_BODY_IDS', 'NEW_WHEEL_IDS', 'NEW_PAINT_IDS', 'NEW_DECAL_IDS', 'NEW_EXTRA_IDS', 'NEW_BUDDY_IDS',
    'price', 'stats'],   /* price(kind, id) -> stars; stats(build) -> CarStats (body + wheels + extras applied) */

  /* src/levels.js (worlds owner), DOM-free. World physics constants and all 120 levels.
     WORLDS[w] = { id: w, key, gravity (m/s2), airDrag, surf (default SURF key), monsters: [kind...], boss: kind }
     level(n) -> LevelSpec (deterministic, cached). n in 1..MAX_LEVEL, PARADE_LEVEL, or free(seed).
     LevelSpec = { n, world, seed, kind: 'race' | 'boss' | 'parade' | 'free', pieces: Piece[], props: PropPlace[],
                   stars: [{ s, d, h }], monsters: [{ kind, s, d, side? }], boss: null | { kind, startS }, par: { S, A, B } seconds } */
  levels: ['WORLDS', 'level', 'free'],

  /* src/sim.js (physics owner), DOM-free, THREE-free, deterministic.
     buildTrack(spec) -> Track
       Track = { spec, step, n, length, finishS, checkpoints: [s], world: WORLDS[w],
                 px py pz  tx ty tz  ux uy uz  rx ry rz : Float64Array(n)   centre, tangent, surface up, right
                 hw: Float32Array(n) half width, surf: Uint8Array(n) SURF code, flags: Uint8Array(n) TF bits,
                 piece: Uint16Array(n) index into spec.pieces, props: PropState[] }
       sample i sits at s = i * step. Renderers mesh the road from these arrays directly.
     frameAt(track, s, out?) -> { x, y, z, tx, ty, tz, ux, uy, uz, rx, ry, rz, hw, surf, flags }   interpolated
     toWorld(track, s, d, h, out?) -> [x, y, z]      a point d right of centre, h above the surface
     carParams(stats, upgrades) -> CarParams       the sim's own tuned constants (opaque to everyone else)
     newRace(track, carParams, opts) -> SimState    opts = { seed, mode: 'race' | 'free' | 'attract', monsters: true }
     step(state, input)                             one SIM_DT; mutates state; pushes state.events
     quantize(input) -> InputFrame; packInput(input) -> int; unpackInput(int) -> InputFrame
     autopilot(state, skill 0..1) -> InputFrame     deterministic bot: home-screen attract mode and the fairness suite
     result(state) -> RaceResult
     SimState = { tick, t, rng, track, car: CarState, actors: ActorState[], props: PropState[], stars: Uint8Array,
                  starsGot, nitroGot, events: SimEvent[], finished, finishT, stats }
     CarState = { x, y, z, qx, qy, qz, qw, vx, vy, vz, wx, wy, wz, s, d, h, speed, air, airT, boost (0..1), boosting,
                  drift (-1 | 0 | 1), driftT, spinT, stunT, respawnT, surf, rpm (0..1), gear,
                  wheels: [{ x, y, z, comp (0..1), contact, spin, steer, slip (0..1), surf }] x4 in order FL FR RL RR }
     PropState = { ...PropPlace, x, y, z, alive, vx, vy, vz, rx, ry, rz }   knocked soft props fly (renderer reads pose)
     ActorState = { i, kind, arche, s, d, h, x, y, z, yaw, vs, vd, vh, state, stateT, hp, r, mass, phase, alive, boss }
       state: 'idle' | 'tell' | 'lunge' | 'recover' | 'roam' | 'chase' | 'attack' | 'stagger' | 'gone'
     RaceResult = { time, stars, starsTotal, rating (1..3), tier ('S' | 'A' | 'B' | 'C'), hits, airTime, driftTime, tricks, respawns, clean } */
  sim: ['buildTrack', 'frameAt', 'toWorld', 'carParams', 'newRace', 'step', 'quantize', 'packInput', 'unpackInput', 'autopilot', 'result'],

  /* src/monsters.sim.js (monsters owner), DOM-free, deterministic: behaviour only; sim.js owns contact.
     KINDS[kind] = { kind, world, arche, r, h, mass, speed, trigger, tell, lunge, reach, cooldown, hp?,
                     knock: { impulse, lift, spin, stun }, attacks?: [...] }
     spawn(place, track, ctx) -> ActorState         place from LevelSpec.monsters / boss
     think(actor, ctx)                               move the actor one SIM_DT (kinematic: s, d, h, yaw, state)
     onHit(actor, ctx)                               after sim resolved a car contact: stagger, retreat, enrage
     ctx = { track, car, dt, tick, rand: () => [0,1), emit(type, fields), spawn(place) -> ActorState, frameAt, toWorld }
     rand draws from the sim's seeded stream, so actors must be thought in a fixed order (sim iterates actors[] in order). */
  monsterAI: ['KINDS', 'spawn', 'think', 'onHit'],

  /* src/save.js (integrator): the v12 save format, kept, plus v13 fields. See docs/OVERHAUL.md "Save compatibility". */
  save: ['ids', 'state', 'progress', 'meta', 'load', 'save', 'owns', 'price', 'buy', 'recordRun', 'switchProfile',
    'packCompact', 'unpackCompact', 'exportFullCode', 'decodeSaveCode', 'importData', 'qrMatrix', 'SAVE_URL_PREFIX'],

  /* src/audio.js (ui owner). All synthesized Web Audio, one master compressor, quiet mode honoured.
     sfx(name, opts?)  names: SFX below. opts = { v: 0..1 volume, p: pitch multiplier, pan: -1..1, kind: monster kind }
     engine.start(bodyId); engine.update({ rpm, load, speed, boost, air, surf }); engine.stop()
     music.play(id) id: 'title' | 'garage' | 'map' | 'w1'..'w12' | 'boss' | 'results' ; music.stop(fadeS)
     ambience(world | 0) */
  audio: ['unlock', 'setQuiet', 'sfx', 'engine', 'music', 'ambience'],

  /* src/fx.js (worlds owner). Particles and screen-space juice for any THREE.Scene.
     create(ctx, scene) -> FxRig = { emit(kind, pos [x,y,z], opts?), update(dt), dispose() }
     kinds: 'sparks' 'dust' 'smoke' 'fire' 'explosion' 'splash' 'debris' 'snow' 'shards' 'nitro' 'stars' 'skid' */
  fx: ['create'],

  /* src/cars.js (cars owner). Low-poly vehicle meshes and the garage scene (VROOM.scenes.garage).
     buildCar(ctx, build, opts?) -> CarRig = { group, wheels: [4 Object3D FL FR RL RR], update(carState, dt, t),
                                               setDamage(0..9), setGrime(0..1), anchors: { exhaust: [[x,y,z]], cam: [x,y,z], roof: [x,y,z] }, dispose() }
       group: origin on the ground under the chassis centre, +z nose, metres. game.js sets group.position and
       group.quaternion from CarState; update() animates wheels (spin, steer, comp), body roll and pitch, exhaust.
     build = save.state: { body, wheels, color, decal, buddy, number, extras: { id: bool } }
     thumb(ctx, build, px) -> HTMLCanvasElement     a still of the build for the map, profiles and results */
  cars: ['buildCar', 'thumb'],

  /* src/worlds.js (worlds owner). The 12 environments.
     buildWorld(ctx, track, spec) -> WorldRig = { scene, props: Object3D[] (index = track.props), stars: Object3D[],
                                                 sun?, update(simState, dt, t, camera), onEvent(ev, simState), dispose() }
       The road mesh, walls, roadside sets, sky, fog, lights and weather are all in scene.
     backdrop(ctx, w) -> { scene, camera, update(dt, t), dispose() }    the world-of-the-day diorama behind menus
     accent(w) -> [hot, warm, mid, deep] four '#hex'                    UI tints its plates with these
     icon(w) -> '<svg ...>'                                             map tab emblem, no words */
  worlds: ['buildWorld', 'backdrop', 'accent', 'icon'],

  /* src/monsters.js (monsters owner). Creature and boss meshes.
     build(ctx, kind) -> MonsterRig = { group, update(actorState, dt, t), onEvent(what), dispose() }
       group origin on the ground under the creature, +z faces its travel. game.js places it from ActorState. */
  monsters: ['build'],

  /* src/ui.js (ui owner). DOM scenes, HUD, widgets, touch + keyboard controls.
     init(game)                       bind to the shell; game = VROOM.game
     hud = { show(spec), update(simState), event(ev), hide() }
     controls = { read() -> InputFrame, show(), hide() }   pedals, steering, boost, drift; keyboard merged in
     button({ icon, cls, aria, on }) -> HTMLButtonElement   the metal plate button (press squash + sfx('press'))
     toast(iconSvg); transition(fn)   wordless popup; scene iris/slam transition around fn
     icons: { star, lock, home, go, map, garage, ... } SVG strings
     Registers scenes splash, home, map, results (and overlays profile, album) into VROOM.scenes. */
  ui: ['init', 'hud', 'controls', 'button', 'toast', 'transition', 'icons'],

  /* src/game.js (integrator): boot, renderer, router, loop, race glue (VROOM.scenes.race), camera.
     go(id, params)   leave the current scene, enter VROOM.scenes[id]
     ctx              RenderCtx = { THREE, renderer, quality: 'high' | 'low', reducedMotion: bool, cache: Map }
     startRace(n), current() -> id */
  game: ['go', 'ctx', 'startRace', 'current'],
};

/* ---------- Scene API: every VROOM.scenes[id] ----------
   { id, dom: 'elementId' | null,              the DOM layer shown while active (.scene.active)
     enter(params), exit(),                     params are scene specific (race: { n }, results: { n, result, payout })
     update(dt, t),                             every animation frame while active
     view: null | { scene, camera } }           when set, game.js renders it to #view each frame (after update)
   Scene ids: splash -> home -> garage | map -> race -> results. Owners: splash, home, map, results (ui);
   garage (cars); race (game). Dev-only scenes may register as 'dev:<owner>-<name>' and open with ?scene=<id>. */
const SCENE_IDS = ['splash', 'home', 'garage', 'map', 'race', 'results'];

/* ---------- sfx names audio.js must answer (unknown names must be a silent no-op, never a throw) ---------- */
const SFX = ['press', 'deny', 'buy', 'unlock', 'star', 'nitro', 'boost', 'pad', 'jump', 'land', 'landHard', 'trick', 'hit', 'crunch',
  'scrape', 'wall', 'skid', 'spin', 'horn', 'count', 'go', 'checkpoint', 'finish', 'fanfare', 'medal', 'tick', 'respawn', 'splash',
  'explosion', 'monsterTell', 'monsterRoar', 'monsterHit', 'bossRoar', 'bossStomp', 'bossDefeat', 'slam', 'whoosh'];

VROOM.contracts = Object.freeze({
  APP_VERSION, SIM_HZ, SIM_DT, MAX_STEPS_PER_FRAME, STAGE_W, STAGE_H, MIN_TAP,
  WORLD_COUNT, WORLD_SIZE, MAX_LEVEL, PARADE_LEVEL, worldOf, isFinale,
  PIECES, SURF, SURF_CODE, TF, PROP_CAT, ARCHE, EVENTS, LEGACY, MODULE_API, SCENE_IDS, SFX,
});
if (!VROOM.scenes) VROOM.scenes = {};
