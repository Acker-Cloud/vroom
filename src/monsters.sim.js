/* monsters.sim: creature behaviour, deterministic. Owner: monsters. DOM-free, THREE-free (sim region).
   Behaviour only: actors are kinematic (this file moves them in track space); src/sim.js detects car
   contacts, applies the knock to the car with momentum, emits the 'hit' event and then calls onHit.
   Randomness only through ctx.rand(). No fail states: a monster can knock, spin, stun and cost time;
   it never stops a run, and a boss always loses the race to the finish line.

   Archetypes (docs/OVERHAUL.md section 4):
     lurker    waits beside the road, tells (eyes, crouch, roar), lunges `reach` metres into the road
     swarm     a pack of small ones crossing the road together, staggered so there are gaps
     roamer    runs, hops or drifts on the road ahead of the car, body-checks when the car closes in
     diver     circles high, its shadow marks the spot it will dive on, then skims the road
     burrower  a wake in the ground homes in on the car's lane, the ground cracks, it erupts
     boss      the finale chase: roars past the car beside the road, then keeps station 14 to 30 m
               AHEAD of it, off its line, where the chase camera sees it; telegraphs attacks (thrown
               debris, sweeps, rollers, eruptions, a leap into the car's path, a charge in from beside
               the road), never overlaps the car, is outrun over the last 150 m and defeated at the
               flag. Ram it while it is dazed to chip its hp; three rams smash it early. Either way it
               pays bonus stars (actor.bonus).
     debris    pooled boss and thrower ammunition, spawned once at race start, recycled forever

   Contact contract for src/sim.js (additive fields on ActorState, see open notes in the hand-off):
     actor.hot    true while the actor's body can hit the car this tick (false in every tell, idle,
                  recover and stagger window, so a monster never hits twice and never without warning)
     actor.knock  the knock to apply right now ({ impulse, lift, spin, stun }); falls back to
                  KINDS[kind].knock. A roaming body bump or a dazed boss is softer than a lunge.
     actor.r, actor.h  contact radius in the (s, d) plane and body height above actor.h
   Render hints for src/monsters.js (world-space points, refreshed every think):
     actor.mark 0 none | 1 point (impact ring) | 2 stripe (across the road) | 3 shadow (a diver's)
     actor.mx/my/mz  the telegraph point on the road surface; actor.gy the ground height under the actor
     actor.tether true when the actor is a reaching limb; actor.ax/ay/az the anchor it reaches from
   Allocation: think() allocates nothing; spawn() runs at race start only. */

const C = VROOM.contracts, M = VROOM.dmath;
const PI = Math.PI;

const kn = (impulse, lift, spin, stun) => Object.freeze({ impulse, lift, spin, stun });
const atk = (move, w, debris, n) => Object.freeze({ move, w, debris: debris || null, n: n || 1 });
/* one creature: defaults suit a mid-size lurker */
function def(kind, world, arche, o) {
  return Object.freeze({
    kind, world, arche, r: 1.2, h: 2, mass: 600, speed: 0, trigger: 38, tell: 0.75, lunge: 14, reach: 9, cooldown: 2.4,
    knock: kn(8, 3, 4, 0.45), bump: kn(4, 1, 1.5, 0.15), off: 3, tries: 2, pack: 1, spread: 4, fly: 0, hop: 0, drift: 0, chase: 0.9,
    throws: null, style: 'walk', gap: 20, lead: 0, wide: 0, daze: 1.6, mode: null, peak: 0, life: 0, tether: false, ...o,
  });
}

const KINDS = {};
const add = k => { KINDS[k.kind] = k; };

/* ---- 1 Scrapyard Foundry ---- */
add(def('rivetrat', 1, 'swarm', { r: 0.65, h: 0.9, mass: 25, lunge: 11, tell: 0.45, trigger: 34, pack: 6, spread: 3.2, off: 2, knock: kn(3, 1, 2.5, 0.15), cooldown: 1.6, tries: 2 }));
add(def('magnetmaw', 1, 'lurker', { r: 1.7, h: 3.2, mass: 2600, lunge: 13, reach: 8.5, off: 3.5, tell: 0.8, knock: kn(10, 2, 5.5, 0.55) }));
add(def('slagcolossus', 1, 'boss', { r: 3.4, wide: 4.2, h: 9, mass: 40000, speed: 46, tell: 1.0, cooldown: 3.4, hp: 3, gap: 20, knock: kn(13, 5, 5, 0.8), bump: kn(6, 2, 2, 0.25),
  attacks: [atk('throw', 3, 'slagblob', 2), atk('sweep', 2, 'cranehook'), atk('leap', 2), atk('charge', 1)] }));
add(def('slagblob', 1, 'debris', { r: 1.5, h: 1.2, mass: 900, mode: 'fall', peak: 14, life: 1.1, knock: kn(9, 4, 4, 0.5) }));
add(def('cranehook', 1, 'debris', { r: 1.4, h: 2.2, mass: 1500, mode: 'sweep', lunge: 15, tell: 0.95, knock: kn(10, 3, 6, 0.55) }));

/* ---- 2 Ember Canyon ---- */
add(def('duskvulture', 2, 'diver', { r: 1.3, h: 1.4, mass: 120, fly: 15, speed: 48, trigger: 60, tell: 1.0, tries: 3, cooldown: 1.6, knock: kn(6, 4, 4, 0.35) }));
add(def('cliffjaw', 2, 'lurker', { r: 1.5, h: 1.6, mass: 900, lunge: 17, reach: 9.5, off: 3, tell: 0.7, knock: kn(9, 2.5, 5, 0.45) }));
add(def('duskback', 2, 'boss', { r: 3.6, wide: 4.4, h: 7, mass: 45000, speed: 46, tell: 1.0, cooldown: 3.2, hp: 3, gap: 22, style: 'roll', knock: kn(13, 5, 6, 0.8), bump: kn(6, 2, 2, 0.25),
  attacks: [atk('roll', 3, 'mesarock', 2), atk('throw', 2, 'emberclod', 2), atk('leap', 2), atk('charge', 2)] }));
add(def('mesarock', 2, 'debris', { r: 1.6, h: 3.2, mass: 3000, mode: 'roll', speed: 13, tell: 0.6, knock: kn(10, 4, 5, 0.55) }));
add(def('emberclod', 2, 'debris', { r: 1.3, h: 1.4, mass: 600, mode: 'fall', peak: 12, life: 1.0, knock: kn(8, 4, 4, 0.45) }));

/* ---- 3 Neon Necropolis ---- */
add(def('grabber', 3, 'burrower', { r: 1.0, h: 3.6, mass: 400, speed: 8, trigger: 36, tell: 0.7, chase: 0.9, tries: 2, knock: kn(8, 5, 4, 0.45) }));
add(def('neonhound', 3, 'roamer', { r: 0.9, h: 1.3, mass: 220, speed: 27, trigger: 70, tell: 0.4, lunge: 9, pack: 3, spread: 6, cooldown: 1.5, knock: kn(6, 2, 4, 0.35) }));
add(def('lampmoth', 3, 'boss', { r: 3.2, h: 5, mass: 8000, speed: 48, tell: 0.95, cooldown: 3.0, hp: 3, gap: 18, style: 'fly', fly: 5, knock: kn(11, 6, 6, 0.75), bump: kn(5, 2, 2, 0.25),
  attacks: [atk('throw', 3, 'sparkorb', 3), atk('sweep', 2, 'dustwave'), atk('leap', 2), atk('charge', 1)] }));
add(def('sparkorb', 3, 'debris', { r: 1.1, h: 1.2, mass: 150, mode: 'fall', peak: 10, life: 0.9, knock: kn(7, 5, 5, 0.4) }));
add(def('dustwave', 3, 'debris', { r: 1.6, h: 2.0, mass: 400, mode: 'sweep', lunge: 16, tell: 0.9, knock: kn(8, 4, 6, 0.5) }));

/* ---- 4 Drown Docks ---- */
add(def('guttereel', 4, 'burrower', { r: 1.0, h: 2.8, mass: 300, speed: 9, trigger: 36, tell: 0.6, chase: 0.8, tries: 2, knock: kn(8, 5, 5, 0.45) }));
add(def('docktoad', 4, 'roamer', { r: 1.5, h: 2.0, mass: 1200, speed: 22, trigger: 60, tell: 0.45, lunge: 8, hop: 3.2, cooldown: 1.8, knock: kn(9, 4, 3, 0.45) }));
add(def('bilgekraken', 4, 'boss', { r: 3.6, h: 6, mass: 38000, speed: 46, tell: 1.0, cooldown: 3.1, hp: 3, gap: 20, knock: kn(12, 5, 6, 0.8), bump: kn(6, 2, 2, 0.25),
  attacks: [atk('erupt', 3, 'tentacle', 2), atk('sweep', 2, 'bilgewave'), atk('leap', 2), atk('charge', 1)] }));
add(def('tentacle', 4, 'debris', { r: 1.2, h: 6.5, mass: 2000, mode: 'erupt', tell: 0.9, life: 0.7, knock: kn(10, 6, 5, 0.55) }));
add(def('bilgewave', 4, 'debris', { r: 1.8, h: 2.0, mass: 1000, mode: 'sweep', lunge: 14, tell: 1.0, knock: kn(8, 3, 5, 0.5) }));

/* ---- 5 Frostbite Pass ---- */
add(def('icewolf', 5, 'roamer', { r: 1.0, h: 1.4, mass: 260, speed: 28, trigger: 70, tell: 0.4, lunge: 10, pack: 3, spread: 7, cooldown: 1.4, knock: kn(6, 2, 4.5, 0.35) }));
add(def('snowbrute', 5, 'lurker', { r: 1.8, h: 3.6, mass: 2800, off: 4, tell: 0.85, cooldown: 2.2, tries: 3, throws: 'snowball', knock: kn(10, 3, 4, 0.5) }));
add(def('snowball', 5, 'debris', { r: 1.5, h: 3.0, mass: 900, mode: 'sweep', lunge: 13, tell: 0.0, knock: kn(8, 3, 4, 0.45) }));
add(def('glaciergolem', 5, 'boss', { r: 3.6, wide: 4.9, h: 9, mass: 50000, speed: 45, tell: 1.05, cooldown: 3.3, hp: 3, gap: 21, knock: kn(13, 5, 5, 0.8), bump: kn(6, 2, 2, 0.25),
  attacks: [atk('roll', 3, 'avalanche', 2), atk('throw', 2, 'icespear', 3), atk('leap', 2), atk('charge', 1)] }));
add(def('avalanche', 5, 'debris', { r: 1.9, h: 3.8, mass: 3000, mode: 'roll', speed: 12, tell: 0.6, knock: kn(10, 4, 5, 0.55) }));
add(def('icespear', 5, 'debris', { r: 1.0, h: 3.0, mass: 400, mode: 'fall', peak: 16, life: 1.0, knock: kn(8, 4, 5, 0.45) }));

/* ---- 6 Scorch Flats ---- */
add(def('sandshark', 6, 'burrower', { r: 1.4, h: 2.4, mass: 1100, speed: 10, trigger: 40, tell: 0.6, chase: 1.1, tries: 3, knock: kn(9, 5, 5, 0.5) }));
add(def('stingtail', 6, 'lurker', { r: 1.6, h: 2.2, mass: 1300, lunge: 15, reach: 9, off: 3, tell: 0.8, knock: kn(9, 3, 6, 0.5) }));
add(def('gritmaw', 6, 'boss', { r: 3.2, wide: 5.9, h: 8, mass: 42000, speed: 47, tell: 1.0, cooldown: 3.1, hp: 3, gap: 20, style: 'burrow', knock: kn(12, 7, 5, 0.8), bump: kn(6, 2, 2, 0.25),
  attacks: [atk('erupt', 3, 'sandspout', 2), atk('throw', 2, 'gritclod', 2), atk('leap', 3), atk('charge', 1)] }));
add(def('sandspout', 6, 'debris', { r: 1.6, h: 5, mass: 800, mode: 'erupt', tell: 0.9, life: 0.7, knock: kn(8, 7, 4, 0.5) }));
add(def('gritclod', 6, 'debris', { r: 1.3, h: 1.3, mass: 600, mode: 'fall', peak: 12, life: 1.0, knock: kn(8, 4, 4, 0.45) }));

/* ---- 7 Wreck Cove ---- */
add(def('hermittank', 7, 'lurker', { r: 1.6, h: 1.8, mass: 1800, lunge: 10, reach: 10.5, off: 3, tell: 0.85, cooldown: 2.0, tries: 3, knock: kn(9, 2, 5, 0.45) }));
add(def('gullswarm', 7, 'diver', { r: 0.9, h: 1.0, mass: 30, fly: 13, speed: 50, trigger: 56, tell: 0.85, pack: 3, spread: 9, tries: 2, cooldown: 1.2, knock: kn(4, 2, 3, 0.2) }));
add(def('tidecrusher', 7, 'boss', { r: 3.8, wide: 7.6, h: 7, mass: 52000, speed: 45, tell: 1.0, cooldown: 3.2, hp: 3, gap: 21, knock: kn(13, 4, 6, 0.8), bump: kn(6, 2, 2, 0.25),
  attacks: [atk('sweep', 3, 'clawsweep'), atk('throw', 2, 'hulkchunk', 2), atk('leap', 2), atk('charge', 2)] }));
add(def('clawsweep', 7, 'debris', { r: 2.0, h: 2.6, mass: 4000, mode: 'sweep', lunge: 15, tell: 0.95, knock: kn(11, 3, 6, 0.6) }));
add(def('hulkchunk', 7, 'debris', { r: 1.6, h: 1.8, mass: 2000, mode: 'fall', peak: 14, life: 1.1, knock: kn(9, 4, 4, 0.5) }));

/* ---- 8 Orbital Scrapheap ---- */
add(def('voidgrub', 8, 'burrower', { r: 1.2, h: 2.4, mass: 500, speed: 8, trigger: 40, tell: 0.65, chase: 1.0, tries: 3, knock: kn(8, 8, 4, 0.45) }));
add(def('droneswarm', 8, 'swarm', { r: 0.6, h: 0.6, mass: 40, fly: 1.4, lunge: 12, tell: 0.4, trigger: 36, pack: 5, spread: 3.6, off: 2.5, cooldown: 1.4, knock: kn(3, 2, 3, 0.15) }));
add(def('starmaw', 8, 'boss', { r: 3.4, h: 6, mass: 30000, speed: 48, tell: 1.0, cooldown: 3.0, hp: 3, gap: 19, lead: 4, style: 'fly', fly: 4, knock: kn(12, 8, 6, 0.8), bump: kn(5, 3, 2, 0.25),
  attacks: [atk('throw', 3, 'voidorb', 3), atk('roll', 2, 'junkroller', 2), atk('leap', 2), atk('charge', 2)] }));
add(def('voidorb', 8, 'debris', { r: 1.3, h: 1.4, mass: 300, mode: 'fall', peak: 12, life: 1.2, knock: kn(7, 8, 5, 0.45) }));
add(def('junkroller', 8, 'debris', { r: 1.5, h: 3.0, mass: 1800, mode: 'roll', speed: 12, tell: 0.6, knock: kn(9, 6, 5, 0.5) }));

/* ---- 9 Magma Forge ---- */
add(def('cinderbat', 9, 'diver', { r: 1.1, h: 1.2, mass: 80, fly: 14, speed: 52, trigger: 58, tell: 0.85, tries: 3, cooldown: 1.3, pack: 2, spread: 12, knock: kn(6, 3, 4, 0.35) }));
add(def('magmander', 9, 'lurker', { r: 1.5, h: 1.5, mass: 1000, lunge: 17, reach: 9.5, off: 3, tell: 0.7, knock: kn(9, 3, 5, 0.5) }));
add(def('moltentitan', 9, 'boss', { r: 3.6, h: 10, mass: 60000, speed: 46, tell: 0.95, cooldown: 2.9, hp: 3, gap: 20, knock: kn(14, 6, 5, 0.85), bump: kn(6, 2, 2, 0.25),
  attacks: [atk('throw', 3, 'lavabomb', 3), atk('erupt', 2, 'magmaspout', 2), atk('leap', 2), atk('charge', 1)] }));
add(def('lavabomb', 9, 'debris', { r: 1.4, h: 1.4, mass: 700, mode: 'fall', peak: 16, life: 1.1, knock: kn(9, 5, 4, 0.5) }));
add(def('magmaspout', 9, 'debris', { r: 1.5, h: 5.5, mass: 900, mode: 'erupt', tell: 0.85, life: 0.7, knock: kn(9, 7, 4, 0.5) }));

/* ---- 10 Rot Sugar Carnival ---- */
add(def('gumghoul', 10, 'swarm', { r: 0.7, h: 1.1, mass: 60, lunge: 9, tell: 0.5, trigger: 34, pack: 5, spread: 3.8, off: 2, cooldown: 1.8, knock: kn(4, 2, 3, 0.2) }));
add(def('licorash', 10, 'lurker', { r: 1.0, h: 1.6, mass: 500, lunge: 20, reach: 9.5, off: 4, tell: 0.75, tether: true, cooldown: 1.9, tries: 3, knock: kn(8, 2, 6.5, 0.45) }));
add(def('sourjaw', 10, 'boss', { r: 3.4, h: 7, mass: 36000, speed: 47, tell: 1.0, cooldown: 3.0, hp: 3, gap: 20, style: 'roll', knock: kn(12, 5, 6, 0.8), bump: kn(6, 2, 2, 0.25),
  attacks: [atk('throw', 3, 'jawshard', 3), atk('roll', 2, 'gobstop', 2), atk('leap', 2), atk('charge', 2)] }));
add(def('jawshard', 10, 'debris', { r: 1.2, h: 1.6, mass: 400, mode: 'fall', peak: 13, life: 1.0, knock: kn(8, 4, 5, 0.45) }));
add(def('gobstop', 10, 'debris', { r: 1.6, h: 3.2, mass: 1600, mode: 'roll', speed: 13, tell: 0.6, knock: kn(9, 4, 6, 0.5) }));

/* ---- 11 Abyss Trench ---- */
add(def('anglerlurk', 11, 'lurker', { r: 1.6, h: 2.2, mass: 1100, lunge: 13, reach: 9, off: 3.5, tell: 0.9, knock: kn(9, 4, 5, 0.5) }));
add(def('jellymine', 11, 'roamer', { r: 1.1, h: 1.8, mass: 50, drift: 1, fly: 1.4, trigger: 60, tell: 0.5, pack: 3, spread: 14, cooldown: 1.5, knock: kn(5, 6, 6, 0.4) }));
add(def('trenchleviathan', 11, 'boss', { r: 3.4, h: 6, mass: 48000, speed: 44, tell: 1.05, cooldown: 3.2, hp: 3, gap: 20, lead: 4, style: 'swim', fly: 2, knock: kn(12, 6, 6, 0.8), bump: kn(6, 2, 2, 0.25),
  attacks: [atk('sweep', 3, 'tidesurge'), atk('erupt', 2, 'ventspout', 2), atk('leap', 2), atk('charge', 1)] }));
add(def('tidesurge', 11, 'debris', { r: 1.9, h: 2.4, mass: 1200, mode: 'sweep', lunge: 13, tell: 1.0, knock: kn(8, 4, 5, 0.5) }));
add(def('ventspout', 11, 'debris', { r: 1.4, h: 5, mass: 600, mode: 'erupt', tell: 0.9, life: 0.7, knock: kn(8, 7, 4, 0.5) }));

/* ---- 12 Storm Citadel ---- */
add(def('gargohawk', 12, 'diver', { r: 1.4, h: 1.5, mass: 900, fly: 16, speed: 54, trigger: 64, tell: 0.85, tries: 3, cooldown: 1.2, knock: kn(9, 4, 5, 0.5) }));
add(def('cloudwraith', 12, 'roamer', { r: 1.3, h: 2.6, mass: 200, fly: 1.2, speed: 30, trigger: 70, tell: 0.4, lunge: 11, cooldown: 1.4, pack: 2, spread: 10, knock: kn(7, 4, 5, 0.4) }));
add(def('tempestwyrm', 12, 'boss', { r: 3.4, h: 6, mass: 55000, speed: 50, tell: 0.9, cooldown: 2.7, hp: 3, gap: 18, lead: 5, style: 'fly', fly: 5, knock: kn(14, 6, 7, 0.85), bump: kn(6, 2, 2, 0.25),
  attacks: [atk('throw', 3, 'boltstrike', 3), atk('sweep', 2, 'stormfront'), atk('leap', 2), atk('charge', 2)] }));
add(def('boltstrike', 12, 'debris', { r: 1.5, h: 8, mass: 100, mode: 'fall', peak: 30, life: 0.9, knock: kn(8, 6, 6, 0.5) }));
add(def('stormfront', 12, 'debris', { r: 1.8, h: 2.6, mass: 800, mode: 'sweep', lunge: 17, tell: 0.9, knock: kn(8, 4, 6, 0.5) }));

/* any kind the levels name that this table lacks still gets a working placeholder, so a rename never breaks a race */
if (VROOM.levels && VROOM.levels.WORLDS) {
  for (const w in VROOM.levels.WORLDS) {
    const W = VROOM.levels.WORLDS[w];
    (W.monsters || []).forEach((k, i) => { if (!KINDS[k]) add(def(k, +w, i ? 'roamer' : 'lurker', { speed: i ? 24 : 0 })); });
    if (W.boss && !KINDS[W.boss]) add(def(W.boss, +w, 'boss', { r: 3.4, h: 8, mass: 40000, speed: 46, hp: 3, knock: kn(12, 5, 5, 0.8), attacks: [atk('leap', 2), atk('charge', 1)] }));
  }
}
Object.freeze(KINDS);

/* ---------- helpers (no allocation after spawn) ---------- */
const F = {}, P3 = [0, 0, 0];
const clamp = M.clamp;
function hwAt(ctx, s) { return ctx.frameAt(ctx.track, s, F).hw; }
function finishS(track) { return track.finishS !== undefined ? track.finishS : track.length - 20; }
function carV(ctx) { return Math.max(0, +ctx.car.speed || 0); }
function wrapPi(a) { while (a > PI) a -= 2 * PI; while (a < -PI) a += 2 * PI; return a; }
/* turn toward a direction given in track space (fs along, fd to the right); rate 1/s */
function face(a, ctx, fs, fd, rate) {
  if (fs === 0 && fd === 0) return;
  ctx.frameAt(ctx.track, a.s, F);
  const wx = F.tx * fs + F.rx * fd, wz = F.tz * fs + F.rz * fd, want = M.datan2(wx, wz);
  a.yaw = wrapPi(a.yaw + wrapPi(want - a.yaw) * Math.min(1, rate * ctx.dt));
}
function set(a, state) { a.state = state; a.stateT = 0; }
const ease = u => u * u * (3 - 2 * u);
function sync(a, ctx) {
  const T = ctx.track;
  a.s = clamp(a.s, 0, T.length);
  ctx.toWorld(T, a.s, a.d, a.h, P3); a.x = P3[0]; a.y = P3[1]; a.z = P3[2];
  ctx.toWorld(T, a.s, a.d, 0, P3); a.gy = P3[1];
  if (a.mark) { ctx.toWorld(T, clamp(a.ms, 0, T.length), a.md, 0, P3); a.mx = P3[0]; a.my = P3[1]; a.mz = P3[2]; }
  if (a.tether) { ctx.toWorld(T, a.s0, a.home, 0, P3); a.ax = P3[0]; a.ay = P3[1]; a.az = P3[2]; }
}
function mark(a, type, s, d) { a.mark = type; a.ms = s; a.md = d; }
/* difficulty 0..1 from the level number: later levels in a world and later worlds tell a little faster */
function level01(track) {
  const n = (track.spec && track.spec.n) || 1, w = C.worldOf(Math.max(1, Math.min(C.MAX_LEVEL, n)));
  return clamp(0.5 * (((n - 1) % C.WORLD_SIZE) / (C.WORLD_SIZE - 1)) + 0.5 * ((w - 1) / (C.WORLD_COUNT - 1)), 0, 1);
}
function tellFor(a, K, ctx) { return Math.max(0.4, K.tell * (1 - 0.22 * a.lvl) + (ctx.rand() - 0.5) * 0.16); }

/* ---------- spawn ---------- */
function blank(K, track) {
  return { i: 0, kind: K.kind, arche: K.arche, s: 0, d: 0, h: 0, x: 0, y: 0, z: 0, yaw: 0, vs: 0, vd: 0, vh: 0, state: 'idle', stateT: 0,
    hp: K.hp || 1, r: K.r, mass: K.mass, phase: 0, alive: true, boss: K.arche === 'boss',
    hot: false, knock: K.knock, side: 1, home: 0, s0: 0, ts: 0, td: 0, fs: 0, fd: 0, fh: 0, tellT: 0, flyT: 0, cd: 0, tries: K.tries, member: 0, delay: 0,
    mark: 0, ms: 0, md: 0, mx: 0, my: 0, mz: 0, gy: 0, tether: !!K.tether, ax: 0, ay: 0, az: 0,
    move: '', atk: 0, surgeT: 0, pool: null, owner: null, leader: null, struck: false, carHits: 0, smashed: false, defeated: false, enraged: false, bonus: 0, lvl: level01(track) };
}
function makePool(a, kinds, ctx) {
  a.pool = [];
  if (!ctx.spawn) return;
  for (const dk of kinds) for (let k = 0; k < 3; k++) { const p = ctx.spawn({ kind: dk, pooled: true }); if (p) { p.owner = a; a.pool.push(p); } }
}
function spawn(place, track, ctx) {
  const K = KINDS[place.kind];
  if (!K) return null;
  const a = blank(K, track), len = track.length;
  if (K.arche === 'debris') { stow(a); a.s = 0; sync(a, ctx); return a; }
  if (K.arche === 'boss') {
    a.s = 0; a.h = -40; a.d = 0; a.cd = K.cooldown;
    const kinds = [];
    for (const at of K.attacks || []) if (at.debris && kinds.indexOf(at.debris) < 0) kinds.push(at.debris);
    makePool(a, kinds, ctx);
    sync(a, ctx);
    return a;
  }
  const side = place.side ? Math.sign(place.side) : (place.d || 0) < 0 ? -1 : 1, mem = place.member || 0;
  a.side = side; a.member = mem;
  a.s = clamp((place.s || 0) + mem * K.spread, 0, len); a.s0 = a.s;
  const hw = hwAt(ctx, a.s);
  if (K.arche === 'lurker' || K.arche === 'swarm') { a.home = side * (hw + K.off); a.d = a.home; a.delay = mem * 0.14; a.h = K.fly; }
  else if (K.arche === 'roamer') {
    a.home = clamp((place.d || 0) + (mem ? (mem % 2 ? -1 : 1) * 3 * ((mem + 1) >> 1) : 0), -hw + 1.5, hw - 1.5);
    a.d = K.drift ? a.home : side * (hw + 2); a.h = K.fly; a.phase = mem * 1.7;
  } else if (K.arche === 'diver') { a.d = clamp(place.d || 0, -hw + 1, hw - 1); a.h = K.fly; a.phase = mem * 2.1; a.delay = mem * 0.35; }
  else if (K.arche === 'burrower') { a.d = clamp(place.d || 0, -hw + 1, hw - 1); a.home = a.d; a.h = -1.6; }
  a.yaw = 0;
  if (K.throws) makePool(a, [K.throws], ctx);
  /* the pack: the leader spawns its followers, which the sim appends to actors[] in order */
  if (K.pack > 1 && !mem && ctx.spawn) for (let k = 1; k < K.pack; k++) { const f = ctx.spawn({ kind: K.kind, s: place.s, d: place.d, side, member: k }); if (f) f.leader = a; }
  if (K.arche === 'lurker' || K.arche === 'swarm') face(a, ctx, 0, -side, 1 / ctx.dt);
  sync(a, ctx);
  return a;
}

/* ---------- lurker ---------- */
function lurker(a, K, ctx) {
  const car = ctx.car, v = carV(ctx), hw = hwAt(ctx, a.s), side = a.side;
  switch (a.state) {
    case 'idle': {
      a.hot = false; a.mark = 0;
      a.d += (a.home - a.d) * Math.min(1, 4 * ctx.dt); a.h = 0;
      face(a, ctx, 0, -side, 4);
      const lead = K.tell + (K.off + K.reach * 0.6) / K.lunge, ahead = a.s - car.s;
      if (a.tries > 0 && ahead > 0 && ahead < Math.max(K.trigger, v * lead)) {
        set(a, 'tell'); a.tellT = tellFor(a, K, ctx); a.tries--;
        mark(a, K.throws ? 2 : 1, a.s, side * (hw - K.reach * 0.5));
        ctx.emit('monster', { a: a.i, what: 'tell' });
      }
      break;
    }
    case 'tell':
      a.hot = false; face(a, ctx, 0, -side, 6);
      if (a.stateT >= a.tellT) {
        if (K.throws && a.pool && a.pool.length) {
          const p = freeOf(a.pool, K.throws);
          if (p) armSweep(p, ctx, a.s, side, 0.0);
          set(a, 'recover'); a.mark = 0; ctx.emit('monster', { a: a.i, what: 'roar' });
        } else { set(a, 'lunge'); a.vd = -side * K.lunge; a.mark = 0; ctx.emit('monster', { a: a.i, what: 'lunge' }); }
      }
      break;
    case 'lunge': {
      a.hot = true; a.knock = K.knock;
      a.d += a.vd * ctx.dt;
      const span = K.off + K.reach, u = clamp(side * (a.home - a.d) / span, 0, 1);
      a.h = 0.9 * M.dsin(PI * u);
      if (u >= 1 || a.stateT > 1.6) { set(a, 'recover'); a.hot = false; }
      break;
    }
    case 'recover':
      a.hot = false; a.h = Math.max(0, a.h - 3 * ctx.dt);
      a.d += (a.home - a.d) * Math.min(1, 1.6 * ctx.dt);
      face(a, ctx, 0, side, 3);
      if (a.stateT >= K.cooldown) set(a, 'idle');
      break;
    case 'stagger':
      a.hot = false; a.d += (a.home - a.d) * Math.min(1, 1.2 * ctx.dt); a.h = Math.max(0, a.h - 4 * ctx.dt);
      if (a.stateT >= 0.7) set(a, 'recover');
      break;
    default: a.hot = false;
  }
}

/* ---------- swarm: a pack crossing the road, each member staggered ---------- */
function swarm(a, K, ctx) {
  const car = ctx.car, v = carV(ctx), hw = hwAt(ctx, a.s);
  const bob = K.fly ? K.fly + 0.25 * M.dsin(a.phase * 5) : 0;
  switch (a.state) {
    case 'idle': {
      a.hot = false; a.mark = 0; a.h = bob;
      a.d += (a.home - a.d) * Math.min(1, 3 * ctx.dt);
      face(a, ctx, 0, -a.side, 4);
      const lead = K.tell + 0.3 + (K.off + hw) / K.lunge * 0.8, ahead = a.s - car.s;
      if (a.tries > 0 && ahead > 0 && ahead < Math.max(K.trigger, v * lead)) {
        set(a, 'tell'); a.tellT = tellFor(a, K, ctx) + a.delay; a.tries--;
        if (!a.member) { mark(a, 2, a.s + K.spread * (K.pack - 1) * 0.5, 0); ctx.emit('monster', { a: a.i, what: 'tell' }); }
      }
      break;
    }
    case 'tell':
      a.hot = false; a.h = bob;
      if (a.stateT >= a.tellT) { set(a, 'lunge'); a.vd = -a.side * K.lunge * (0.85 + 0.3 * ctx.rand()); a.mark = 0; if (!a.member) ctx.emit('monster', { a: a.i, what: 'lunge' }); }
      break;
    case 'lunge':
      a.d += a.vd * ctx.dt;
      a.h = bob + (K.fly ? 0 : 0.25 * Math.abs(M.dsin(a.phase * 14)));
      a.hot = Math.abs(a.d) < hw + 0.6; a.knock = K.knock;
      face(a, ctx, 0.15, -a.side, 10);
      if (-a.side * a.d >= hw + K.off - 0.2 || a.stateT > 4) { a.side = -a.side; a.home = a.side * (hw + K.off); a.d = a.home; set(a, 'recover'); a.hot = false; }
      break;
    case 'recover':
      a.hot = false; a.h = bob; face(a, ctx, 0, -a.side, 3);
      if (a.stateT >= K.cooldown) set(a, 'idle');
      break;
    case 'stagger':
      a.hot = false; a.h = Math.max(0, a.h - 3 * ctx.dt);
      a.d += (a.side * (hw + K.off) - a.d) * Math.min(1, 2 * ctx.dt);
      if (a.stateT >= 0.9) { a.home = a.side * (hw + K.off); set(a, 'recover'); }
      break;
    default: a.hot = false;
  }
}

/* ---------- roamer: runners, hoppers, drifters ---------- */
function roamer(a, K, ctx) {
  const car = ctx.car, v = carV(ctx), hw = hwAt(ctx, a.s), dt = ctx.dt, gap = a.s - car.s;
  if (a.state !== 'gone' && a.state !== 'idle' && gap < -40) { set(a, 'gone'); a.hot = false; return; }
  if (a.cd > 0) a.cd -= dt;
  switch (a.state) {
    case 'idle':
      a.hot = false; a.mark = 0;
      if (K.drift) { a.h = K.fly + 0.3 * M.dsin(a.phase * 2); a.d = clamp(a.home + 2 * M.dsin(a.phase * 0.7), -hw + 1, hw - 1); }
      if (gap > -2 && gap < K.trigger) {
        set(a, 'roam'); a.cd = 0.8;
        if (!a.member) ctx.emit('monster', { a: a.i, what: K.drift ? 'tell' : 'roar' });
      }
      break;
    case 'roam': {
      a.knock = K.bump;
      if (K.drift) {
        const A = Math.max(1, hw - 2);
        a.d = clamp(a.home * 0.4 + A * M.dsin(a.phase * (0.55 + 0.1 * a.member) + a.member * 2), -hw + 1, hw - 1);
        a.h = K.fly + 0.4 * M.dsin(a.phase * 2.2);
        a.hot = true; a.knock = K.knock;
        face(a, ctx, 0.2, M.dcos(a.phase * 0.6), 2);
        if (gap > 0 && gap < 22 && a.cd <= 0) { a.cd = 99; ctx.emit('monster', { a: a.i, what: 'tell' }); }
        break;
      }
      if (K.hop) {
        const per = 0.9, u = (a.stateT % per) / per;
        a.h = K.hop * 4 * u * (1 - u);
        a.vs = u < 0.85 ? K.speed * 1.15 : 0;
        a.hot = a.h < K.h * 0.55;
        if (u < 0.85 && ((a.stateT + dt) % per) / per >= 0.85) ctx.emit('monster', { a: a.i, what: 'stomp' });
      } else {
        a.vs += (K.speed - a.vs) * Math.min(1, 1.5 * dt);
        a.h = K.fly ? K.fly + 0.3 * M.dsin(a.phase * 3) : 0;
        a.hot = Math.abs(a.d) < hw + 0.5;
      }
      const lane = clamp(car.d * 0.6 + 2.4 * M.dsin(a.phase * 0.9 + a.member * 2.3), -hw + 1.2, hw - 1.2);
      a.vd = clamp((lane - a.d) * 2.2, -7, 7);
      a.s += a.vs * dt; a.d += a.vd * dt;
      face(a, ctx, Math.max(1, a.vs), a.vd, 6);
      if (gap > 2 && gap < 9 + v * 0.25 && Math.abs(a.d - car.d) < 4 && a.cd <= 0) {
        set(a, 'tell'); a.tellT = Math.max(0.3, K.tell * (1 - 0.2 * a.lvl)); ctx.emit('monster', { a: a.i, what: 'tell' });
      }
      break;
    }
    case 'tell':
      a.knock = K.bump; a.hot = !K.hop && Math.abs(a.d) < hw + 0.5;
      a.vs += (K.speed - a.vs) * Math.min(1, 1.5 * dt); a.s += a.vs * dt;
      if (K.hop) a.h = Math.max(0, a.h - 8 * dt);
      face(a, ctx, a.vs, (car.d - a.d) * 2, 6);
      if (a.stateT >= a.tellT) { set(a, 'lunge'); a.vd = Math.sign(car.d - a.d || 1) * K.lunge; a.vs = Math.max(0, v - 9); ctx.emit('monster', { a: a.i, what: 'lunge' }); }
      break;
    case 'lunge':
      a.hot = true; a.knock = K.knock;
      a.s += a.vs * dt; a.d = clamp(a.d + a.vd * dt, -hw + 0.8, hw - 0.8);
      a.h = (K.fly || 0) + 1.1 * M.dsin(PI * Math.min(1, a.stateT / 0.5));
      face(a, ctx, 0.4, a.vd, 10);
      if (a.stateT >= 0.5) { set(a, 'recover'); a.hot = false; a.cd = K.cooldown; }
      break;
    case 'recover':
    case 'stagger':
      a.hot = false; a.vs += (K.speed * 0.6 - a.vs) * Math.min(1, 2 * dt); a.s += a.vs * dt;
      a.h = Math.max(K.fly || 0, a.h - 4 * dt);
      if (a.stateT >= (a.state === 'stagger' ? 1.0 : 0.6)) set(a, K.drift && a.state === 'stagger' ? 'gone' : 'roam');
      break;
    default: a.hot = false;
  }
}

/* ---------- diver: circle, shadow, dive, skim, climb ---------- */
function diver(a, K, ctx) {
  const car = ctx.car, v = carV(ctx), hw = hwAt(ctx, a.s), dt = ctx.dt;
  switch (a.state) {
    case 'idle': {
      a.hot = false; a.mark = 0;
      a.h = K.fly + 1.2 * M.dsin(a.phase * 1.3);
      a.d = clamp(hw * 0.6 * M.dsin(a.phase * 0.8), -hw, hw);
      face(a, ctx, M.dcos(a.phase * 0.8), M.dsin(a.phase * 0.8), 3);
      const ahead = a.s - car.s;
      if (a.tries > 0 && ahead > 0 && ahead < Math.max(K.trigger, v * (K.tell + 1.0)) + a.delay * v) {
        a.tellT = tellFor(a, K, ctx) + a.delay;
        a.fs = a.s; a.fd = a.d; a.fh = a.h;
        a.ts = Math.min(finishS(ctx.track) - 5, car.s + v * (a.tellT + 0.45));
        a.td = clamp(car.d + (ctx.rand() - 0.5) * 2, -hw + 1, hw - 1);
        a.tries--; set(a, 'tell'); mark(a, 3, a.ts, a.td);
        ctx.emit('monster', { a: a.i, what: 'tell' });
      }
      break;
    }
    case 'tell': {
      a.hot = false;
      const u = ease(Math.min(1, a.stateT / a.tellT));
      a.s = a.fs + (a.ts - a.fs) * u; a.d = a.fd + (a.td - a.fd) * u; a.h = a.fh + (K.fly * 0.75 - a.fh) * u;
      face(a, ctx, 1, 0, 4);
      if (a.stateT >= a.tellT) { set(a, 'lunge'); a.fh = a.h; ctx.emit('monster', { a: a.i, what: 'lunge' }); }
      break;
    }
    case 'lunge': {
      const u = Math.min(1, a.stateT / 0.45);
      a.h = a.fh + (0.7 - a.fh) * u * u;
      if (u >= 1) { a.vs = 12; a.s += a.vs * dt; }
      a.hot = a.h < K.h + 1.4; a.knock = K.knock;
      face(a, ctx, 1, 0, 6);
      if (a.stateT >= 0.75) { set(a, 'recover'); a.hot = false; a.mark = 0; a.vs = K.speed; }
      break;
    }
    case 'recover':
    case 'stagger':
      a.hot = false; a.mark = 0;
      a.h += (K.fly - a.h) * Math.min(1, 1.5 * dt);
      a.vs = a.state === 'stagger' ? 6 : K.speed; a.s += a.vs * dt;
      face(a, ctx, 1, 0, 3);
      if (a.stateT >= K.cooldown && a.s > car.s + 50) {
        if (a.tries > 0) { set(a, 'idle'); a.phase = 0; } else set(a, 'gone');
      }
      if (a.s >= finishS(ctx.track) - 10) set(a, 'gone');
      break;
    default: a.hot = false;
  }
}

/* ---------- burrower: a wake homes in, the ground cracks, it erupts ---------- */
function burrower(a, K, ctx) {
  const car = ctx.car, v = carV(ctx), hw = hwAt(ctx, a.s), dt = ctx.dt, ahead = a.s - car.s;
  switch (a.state) {
    case 'idle':
      a.hot = false; a.mark = 0; a.h = -1.6;
      if (a.tries > 0 && ahead > 0 && ahead < Math.max(K.trigger, v * (K.chase + K.tell + 0.25))) {
        set(a, 'chase'); a.tries--;
      }
      break;
    case 'chase':
      a.hot = false; a.h = -0.5;
      a.vd = clamp((car.d - a.d) * 4, -K.speed, K.speed);
      a.d = clamp(a.d + a.vd * dt, -hw + 0.8, hw - 0.8); a.s -= 3 * dt;
      face(a, ctx, -1, a.vd * 0.3, 6);
      if (ahead < -2) { set(a, 'recover'); break; }
      if (a.stateT >= K.chase) { set(a, 'tell'); a.tellT = tellFor(a, K, ctx); mark(a, 1, a.s, a.d); ctx.emit('monster', { a: a.i, what: 'tell' }); }
      break;
    case 'tell':
      a.hot = false; a.h = -0.4;
      if (a.stateT >= a.tellT) { set(a, 'lunge'); ctx.emit('monster', { a: a.i, what: 'lunge' }); }
      break;
    case 'lunge':
      a.h = Math.min(0, -0.4 + a.stateT * 8);
      a.hot = a.stateT > 0.05 && a.stateT < 0.65; a.knock = K.knock;
      face(a, ctx, -1, 0, 4);
      if (a.stateT >= 0.95) { set(a, 'recover'); a.hot = false; a.mark = 0; }
      break;
    case 'recover':
    case 'stagger':
      a.hot = false; a.mark = 0; a.h = Math.max(-1.6, a.h - 3 * dt);
      if (a.stateT >= 0.8) {
        if (a.tries > 0 && car.s + 120 < finishS(ctx.track)) {
          a.s = car.s + 90 + 30 * ctx.rand(); a.d = clamp((ctx.rand() - 0.5) * 2 * (hw - 1.5), -hw + 1, hw - 1); set(a, 'idle');
        } else set(a, 'gone');
      }
      break;
    default: a.hot = false;
  }
}

/* ---------- debris: pooled ammunition ---------- */
function stow(p) { p.state = 'gone'; p.stateT = 0; p.hot = false; p.mark = 0; p.d = 0; p.h = -60; p.vs = 0; p.vd = 0; }
function freeOf(pool, kind) { for (const p of pool) if (p.state === 'gone' && p.kind === kind) return p; return null; }
function armFall(p, ctx, from, ts, td) {
  const K = KINDS[p.kind];
  p.fs = from.s; p.fd = from.d; p.fh = Math.max(2, from.h + (KINDS[from.kind].h || 4) * 0.8);
  p.ts = ts; p.td = td; p.tellT = K.life; set(p, 'tell'); mark(p, 1, ts, td);
  p.s = p.fs; p.d = p.fd; p.h = p.fh;
}
function armSweep(p, ctx, s, side, tell) {
  const K = KINDS[p.kind], hw = hwAt(ctx, s);
  p.side = side; p.s = s; p.d = side * (hw + 2); p.h = 0; p.tellT = tell === undefined ? K.tell : tell;
  set(p, 'tell'); mark(p, 2, s, 0);
}
function armRoll(p, ctx, s, d) { const K = KINDS[p.kind]; p.s = s; p.d = d; p.h = 0; p.tellT = K.tell; set(p, 'tell'); p.mark = 0; }
function armErupt(p, ctx, s, d) { const K = KINDS[p.kind]; p.s = s; p.d = d; p.h = -K.h; p.tellT = K.tell; set(p, 'tell'); mark(p, 1, s, d); }
function debris(p, K, ctx) {
  const dt = ctx.dt, car = ctx.car;
  p.knock = K.knock;
  if (p.state === 'gone') { p.hot = false; return; }
  if (p.state === 'stagger') { p.hot = false; if (p.stateT >= 0.35) stow(p); return; }
  if (K.mode === 'fall') {
    /* tell: the arc toward the marked spot; lunge: the last 14 percent of the drop and the impact */
    const t = p.state === 'lunge' ? p.tellT * 0.86 + p.stateT : p.stateT, u = Math.min(1, t / p.tellT);
    if (p.state === 'tell' || p.state === 'lunge') {
      p.s = p.fs + (p.ts - p.fs) * u; p.d = p.fd + (p.td - p.fd) * u;
      p.h = p.fh * (1 - u) + K.peak * 4 * u * (1 - u);
    }
    if (p.state === 'tell') { p.hot = false; if (u >= 0.86) { set(p, 'lunge'); p.struck = false; } }
    else if (p.state === 'lunge') {
      p.hot = p.h < K.h + 1.5 && t < p.tellT + 0.3;
      if (u >= 1 && !p.struck) { p.struck = true; p.h = 0; ctx.emit('monster', { a: p.i, what: 'stomp' }); }
      if (t >= p.tellT + 0.3) { set(p, 'recover'); p.hot = false; p.mark = 0; }
    } else if (p.state === 'recover') { p.hot = false; if (p.stateT >= 0.9) stow(p); }
  } else if (K.mode === 'sweep') {
    const hw = hwAt(ctx, p.s);
    if (p.state === 'tell') { p.hot = false; face(p, ctx, 0, -p.side, 20); if (p.stateT >= p.tellT) { set(p, 'lunge'); p.vd = -p.side * K.lunge; ctx.emit('monster', { a: p.i, what: 'lunge' }); } }
    else if (p.state === 'lunge') {
      p.d += p.vd * dt; p.hot = Math.abs(p.d) < hw + 0.5; p.mark = 2;
      if (-p.side * p.d > hw + 2.5 || p.stateT > 4) stow(p);
    } else if (p.state === 'recover') { p.hot = false; if (p.stateT >= 0.3) stow(p); }
  } else if (K.mode === 'roll') {
    const hw = hwAt(ctx, p.s);
    if (p.state === 'tell') { p.hot = false; p.h = 0; face(p, ctx, -1, 0, 20); if (p.stateT >= p.tellT) { set(p, 'lunge'); ctx.emit('monster', { a: p.i, what: 'lunge' }); } }
    else if (p.state === 'lunge') {
      p.vs = -K.speed; p.s += p.vs * dt;
      p.vd = 2.2 * M.dcos(p.stateT * 1.7 + p.fd); p.d = clamp(p.d + p.vd * dt, -hw + K.r * 0.6, hw - K.r * 0.6);
      p.h = 0.25 * Math.abs(M.dsin(p.stateT * 6)); p.hot = true;
      if (p.s < car.s - 25 || p.s <= 0.5 || p.stateT > 9) stow(p);
    } else if (p.state === 'recover') { p.hot = false; if (p.stateT >= 0.3) stow(p); }
  } else if (K.mode === 'erupt') {
    if (p.state === 'tell') { p.hot = false; p.h = -K.h; if (p.stateT >= p.tellT) { set(p, 'lunge'); ctx.emit('monster', { a: p.i, what: 'stomp' }); } }
    else if (p.state === 'lunge') {
      p.h = Math.min(0, -K.h + p.stateT * K.h * 7);
      p.hot = p.stateT > 0.04 && p.stateT < K.life;
      if (p.stateT >= K.life) { set(p, 'recover'); p.hot = false; p.mark = 0; }
    } else if (p.state === 'recover') { p.hot = false; p.h -= K.h * 2.5 * dt; if (p.stateT >= 0.45) stow(p); }
  }
}

/* ---------- boss ---------- */
function bossTell(a, K) { return K.tell * (a.enraged ? 0.8 : 1) * (1 - 0.15 * a.lvl); }
function retireAmmo(a) { if (a.pool) for (const p of a.pool) if (p.state !== 'gone') stow(p); }
function defeat(a, ctx, smashed) {
  if (a.defeated) return;
  a.defeated = true; a.smashed = smashed; a.hot = false; a.mark = 0;
  a.bonus = smashed ? 3 : a.carHits === 0 ? 2 : 1;
  set(a, 'stagger'); retireAmmo(a);
  ctx.emit('boss', { a: a.i, what: 'defeat', smashed: smashed ? 1 : 0, bonus: a.bonus });
}
function roll(K, ctx) {
  let tot = 0;
  for (const m of K.attacks) tot += m.w;
  let r = ctx.rand() * tot;
  for (const m of K.attacks) { r -= m.w; if (r < 0) return m; }
  return K.attacks[K.attacks.length - 1];
}
/* weighted, but never the same move twice running */
function pickMove(a, K, ctx) {
  let m = roll(K, ctx);
  if (m.move === a.move && K.attacks.length > 1) { m = roll(K, ctx); if (m.move === a.move) m = K.attacks[(K.attacks.indexOf(m) + 1) % K.attacks.length]; }
  return m;
}
function restH(a, K) { return K.style === 'fly' ? K.fly + 0.8 * M.dsin(a.phase * 1.6) : K.style === 'swim' ? K.fly + 0.5 * M.dsin(a.phase * 1.1) : K.style === 'burrow' ? -K.h * 0.45 : 0; }
const END_RUN = 150;          /* over the last metres before the flag the boss is outrun and drops back */
/* the chase. The boss keeps station AHEAD of the car (14 to 30 m, inside the chase camera's frame), off the
   car's line; `along` brings it level with the car beside the road instead (a charge's wind-up). Behind or level
   with the car it runs up beside the road, and a body never overlaps the car: within 12 m along the road it is
   held at least keepOut(K) to the side. Near the flag it is outrun: it drops back beside the road and loses. */
/* the side clearance a boss keeps from the car's centre: r + 2 m, or more for a boss whose drawn reach below
   roof height (K.wide, its arms or jaws) is wider than its contact radius, so the drawing never sweeps through
   the car either (CAR_SIDE: the widest machine's half width plus a hand). monsters-check measures every rig. */
const CAR_SIDE = 1.4;
const keepOut = K => Math.max(K.r + 2, K.wide + CAR_SIDE);
function chaseMove(a, K, ctx, v, hw, along) {
  const car = ctx.car, dt = ctx.dt, fin = finishS(ctx.track);
  const end = clamp((car.s - (fin - END_RUN)) / END_RUN, 0, 1);
  /* serpents (lead > 0) trail a body some 28 m long: they keep station further up the road and beside it, so
     the body clears the car and the chase camera */
  const Gs = (a.enraged ? K.gap - 4 : K.gap) + K.lead + 4 * M.dsin(a.phase * 0.6);
  const tgt = along ? car.s + 2 : car.s + Gs - (Gs + 14) * end;
  a.vs = clamp(v + (tgt - a.s) * 1.4, -6, Math.max(K.speed, v + 28));
  a.s += a.vs * dt;
  const out = a.side * (hw + K.r * 0.95), ahead = a.s > car.s + K.r + 4;
  let want = out;
  if (ahead && !along && end === 0 && !K.lead) {
    want = clamp(car.d + a.side * keepOut(K), -hw - K.r * 0.6, hw + K.r * 0.6);
    if (Math.abs(want - car.d) < K.r + 1.5 && a.s > car.s + 14) a.side = -a.side;
  }
  a.vd = clamp((want - a.d) * 1.8, -8, 8);
  a.d += a.vd * dt;
  const ds = a.s - car.s, dd = a.d - car.d, keep = keepOut(K);
  if (ds > -12 && ds < 12 && Math.abs(dd) < keep) a.d = car.d + (dd >= 0 ? keep : -keep);
  a.surgeT = Math.abs(a.d) > hw + K.r * 0.5 && Math.abs(ds) < 12 ? 1 : Math.max(0, a.surgeT - dt);
  a.h += (restH(a, K) - a.h) * Math.min(1, 3 * dt);
  face(a, ctx, Math.max(1, a.vs), a.vd * 0.3, 4);
}
/* a boss charge: from beside the road it swings in across the car's half of it, carried along at the speed it
   had when it launched (brake or boost to slip it), and stops short of the far half (steer across to dodge) */
function charging(a, K, ctx, hw) {
  a.hot = true; a.knock = K.knock; a.mark = 0;
  a.s += a.fs * ctx.dt; a.vs = a.fs;
  a.vd = -a.side * 13; a.d += a.vd * ctx.dt;
  face(a, ctx, 1, -a.side * 0.8, 6);
  if (a.side * a.d <= K.r * 0.9 || a.stateT > 1.2) { set(a, 'recover'); a.hot = false; }
}
function boss(a, K, ctx) {
  const car = ctx.car, v = carV(ctx), dt = ctx.dt, T = ctx.track, fin = finishS(T), hw = hwAt(ctx, a.s);
  a.knock = K.knock;
  if (a.defeated) {
    a.hot = false; a.vs *= 0.97; a.s += a.vs * dt;
    if (a.smashed || K.style === 'burrow') a.h -= 2.5 * dt; else a.h = Math.max(restH(a, K) * 0.3, a.h - 3 * dt);
    if (a.stateT > 3.5) set(a, 'gone');
    return;
  }
  if (car.s >= fin - 1 && a.state !== 'idle') { defeat(a, ctx, false); return; }
  if (a.state === 'idle') {
    a.hot = false; a.h = -40;
    if (car.s > 45) {
      /* enter from behind, beside the road, and roar past the car into station ahead */
      a.side = car.d > 0 ? -1 : 1;
      a.s = Math.max(0, car.s - 40); a.d = a.side * (hw + K.r * 0.95); a.h = restH(a, K); a.vs = v;
      set(a, 'chase'); a.cd = K.cooldown * 0.9; ctx.emit('boss', { a: a.i, what: 'enter' });
    }
    return;
  }
  /* the crane put the car back far behind the boss: it re-enters from behind */
  if ((a.state === 'chase' || a.state === 'tell' || a.state === 'recover') && a.s > car.s + 70) {
    a.side = car.d > 0 ? -1 : 1;
    a.s = Math.max(0, car.s - 40); a.d = a.side * (hw + K.r * 0.95); a.vs = v; a.mark = 0;
    set(a, 'chase'); ctx.emit('boss', { a: a.i, what: 'enter' });
  }
  switch (a.state) {
    case 'chase':
      a.hot = false; a.mark = 0; chaseMove(a, K, ctx, v, hw, false);
      a.cd -= dt;
      if (a.cd <= 0 && car.s > 60 && car.s < fin - 170 && K.attacks && K.attacks.length) {
        const m = pickMove(a, K, ctx);
        a.move = m.move; a.flyT = m.n; set(a, 'tell'); a.tellT = bossTell(a, K) + (m.move === 'charge' ? 1.3 : 0);
        if (m.move === 'charge') a.side = a.d >= car.d ? 1 : -1;   /* it winds up on the side it is on: it never crosses the car's nose */
        ctx.emit('boss', { a: a.i, what: 'roar', move: m.move });
        a.atk = K.attacks.indexOf(m);
      }
      break;
    case 'tell':
      a.hot = false;
      if (a.move === 'charge') {
        /* the wind-up: drop back level with the car beside the road, ring the half of the road it will sweep */
        chaseMove(a, K, ctx, v, hw, true);
        mark(a, 1, a.s, a.side * Math.max(1, hw - 2.5));
        const ready = Math.abs(a.d) > hw + K.r * 0.5 && Math.abs(a.s - car.s) < 8;
        if (a.stateT >= a.tellT && ready && car.s < fin - 120) launch(a, K, ctx, K.attacks[a.atk]);
        else if (a.stateT >= a.tellT + 1.5 || car.s >= fin - 120) { set(a, 'chase'); a.mark = 0; a.cd = K.cooldown * 0.5; }
      } else {
        chaseMove(a, K, ctx, v, hw, false);
        if (a.stateT >= a.tellT) launch(a, K, ctx, K.attacks[a.atk]);
      }
      break;
    case 'attack':
      if (a.move === 'leap') leapFly(a, K, ctx);
      else if (a.move === 'charge') charging(a, K, ctx, hw);
      else {
        a.hot = false; chaseMove(a, K, ctx, v, hw, false);
        if (a.stateT >= 0.7) { set(a, 'chase'); a.cd = K.cooldown * (0.8 + 0.4 * ctx.rand()) * (a.enraged ? 0.75 : 1); }
      }
      break;
    case 'stagger':
      /* dazed after a leap: down on the road ahead of the car, rammable */
      a.hot = a.stateT > 0.3; a.knock = K.bump; a.vs = 0; a.mark = 0;
      if (a.stateT < 0.3) { a.hot = true; a.knock = K.knock; }
      if (a.stateT >= K.daze || car.s > a.s + K.r + 6) {
        set(a, 'recover'); a.hot = false;
        if (a.s < car.s + K.r + 4) a.side = car.d > a.d ? -1 : 1;   /* passed: get back up beside the road, away from the car */
      }
      break;
    case 'recover':
      /* back out to station (from a charge or a daze): beside the road first when it is level with or behind the car */
      a.hot = false; a.mark = 0;
      chaseMove(a, K, ctx, v, hw, false);
      if (a.stateT >= 0.6) { set(a, 'chase'); a.cd = K.cooldown * (0.8 + 0.4 * ctx.rand()) * (a.enraged ? 0.75 : 1); }
      break;
    default: a.hot = false;
  }
}
function launch(a, K, ctx, m) {
  const car = ctx.car, v = carV(ctx), fin = finishS(ctx.track);
  set(a, 'attack');
  if (m.move === 'leap') {
    const hw = hwAt(ctx, Math.min(fin - 40, car.s + v * 1.25 + 30));
    a.fs = a.s; a.fd = a.d; a.fh = a.h; a.tellT = 1.25;
    a.ts = Math.min(fin - 40, car.s + v * a.tellT + 30);
    a.td = clamp((ctx.rand() - 0.5) * 2 * (hw - K.r - 1), -hw + K.r, hw - K.r);
    mark(a, 1, a.ts, a.td);
    return;
  }
  if (m.move === 'charge') { a.fs = v; a.mark = 0; ctx.emit('boss', { a: a.i, what: 'attack', move: 'charge' }); return; }
  const n = a.enraged ? m.n + 1 : m.n;
  for (let k = 0; k < n; k++) {
    const p = a.pool ? freeOf(a.pool, m.debris) : null;
    if (!p) break;
    const DK = KINDS[m.debris];
    if (m.move === 'throw') {
      const ts = Math.min(fin - 20, car.s + v * DK.life + 6 + k * 14 + 8 * ctx.rand()), hw = hwAt(ctx, ts);
      const td = clamp(car.d + (ctx.rand() - 0.5) * 7 + (k ? (k % 2 ? -4 : 4) : 0), -hw + 1, hw - 1);
      armFall(p, ctx, a, ts, td);
    } else if (m.move === 'sweep') {
      const s = Math.min(fin - 20, car.s + v * (DK.tell + 0.45) + 4 + k * 22);
      armSweep(p, ctx, s, ctx.rand() < 0.5 ? -1 : 1);
    } else if (m.move === 'roll') {
      const s = Math.min(fin - 10, car.s + 110 + k * 18), hw = hwAt(ctx, s);
      p.fd = ctx.rand() * 6;
      armRoll(p, ctx, s, clamp(car.d + (ctx.rand() - 0.5) * 6, -hw + DK.r, hw - DK.r));
    } else if (m.move === 'erupt') {
      const s = Math.min(fin - 20, car.s + v * (DK.tell + 0.1) + 3 + k * 12), hw = hwAt(ctx, s);
      armErupt(p, ctx, s, clamp(car.d + (k ? (k % 2 ? -3.5 : 3.5) : 0), -hw + 1, hw - 1));
    }
  }
  ctx.emit('boss', { a: a.i, what: 'attack', move: m.move });
}
function leapFly(a, K, ctx) {
  const u = Math.min(1, a.stateT / a.tellT), e = ease(u);
  a.s = a.fs + (a.ts - a.fs) * e; a.d = a.fd + (a.td - a.fd) * e;
  const base = a.fh * (1 - u), arc = 4 * u * (1 - u);
  a.h = K.style === 'burrow' ? base - 9 * arc : base + 12 * arc;
  a.hot = false;
  face(a, ctx, a.ts >= a.fs ? 1 : -1, 0, 3);
  if (u >= 1) { a.h = 0; set(a, 'stagger'); a.mark = 0; ctx.emit('boss', { a: a.i, what: 'attack', move: 'stomp' }); }
}

/* ---------- the public face ---------- */
function think(a, ctx) {
  const K = KINDS[a.kind];
  if (!K || !a.alive) return;
  a.stateT += ctx.dt; a.phase += ctx.dt;
  if (a.state === 'gone') { a.hot = false; a.mark = 0; if (K.arche !== 'debris') return; }
  switch (K.arche) {
    case 'lurker': lurker(a, K, ctx); break;
    case 'swarm': swarm(a, K, ctx); break;
    case 'roamer': roamer(a, K, ctx); break;
    case 'diver': diver(a, K, ctx); break;
    case 'burrower': burrower(a, K, ctx); break;
    case 'boss': boss(a, K, ctx); break;
    case 'debris': debris(a, K, ctx); break;
  }
  if (a.state === 'gone') { a.hot = false; a.mark = 0; }
  sync(a, ctx);
}
/* the sim resolved a car contact with this actor (and applied the knock): react, never hit again at once */
function onHit(a, ctx) {
  const K = KINDS[a.kind];
  if (!K) return;
  a.hot = false; a.mark = 0;
  if (K.arche === 'debris') { set(a, 'stagger'); if (a.owner) a.owner.carHits++; return; }
  if (K.arche === 'boss') {
    if (a.defeated) return;
    if (a.state === 'stagger') {
      a.hp = Math.max(0, a.hp - 1);
      if (a.hp <= 0) { defeat(a, ctx, true); return; }
      if (a.hp === 1 && !a.enraged) { a.enraged = true; ctx.emit('boss', { a: a.i, what: 'enrage' }); }
      set(a, 'recover');
    } else { a.carHits++; set(a, 'recover'); }
    return;
  }
  if (a.owner) a.owner.carHits++;
  set(a, 'stagger');
  if (K.arche === 'roamer') { a.vs = Math.max(0, (+ctx.car.speed || 0) - 12); a.cd = K.cooldown; }
  ctx.emit('monster', { a: a.i, what: 'retreat' });
}
/* is this actor's body live this tick (the sim's contact test reads actor.hot directly; this is the same) */
function active(a) { return !!(a && a.alive && a.hot && a.state !== 'gone'); }
/* bonus stars the bosses of a finished race paid: 3 smashed, 2 outrun untouched, 1 outrun */
function bonus(actors) { let b = 0; for (const a of actors || []) if (a.boss) b += a.bonus || 0; return b; }

VROOM.monsterAI = { KINDS, spawn, think, onHit, active, bonus, keepOut, CAR_SIDE };
