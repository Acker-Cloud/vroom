/* monsters.sim: creature behaviour, deterministic. Owner: monsters. DOM-free, THREE-free (sim region).
   Behaviour only: actors are kinematic (this file moves them in track space); src/sim.js detects car
   contacts, applies KINDS[kind].knock to the car with momentum, emits 'monster' / 'boss' events and then
   calls onHit. Randomness only through ctx.rand(). No fail states: a monster can knock, spin, stun and
   cost time; it never stops a run, and a boss always loses the race to the finish line.
   SCAFFOLD STUB: one placeholder kind per name in VROOM.levels.WORLDS with a simple lurker / roamer /
   boss loop. The monsters builder designs the real roster (docs/OVERHAUL.md "Monsters"). */

const M = VROOM.dmath;

const base = (kind, world, arche, o = {}) => ({ kind, world, arche, r: 1.2, h: 2, mass: 800, speed: 20, trigger: 40, tell: 0.6, lunge: 14, reach: 8, cooldown: 3,
  knock: { impulse: 8, lift: 3, spin: 4, stun: 0.4 }, ...o });
const KINDS = {};
for (const w in VROOM.levels.WORLDS) {
  const W = VROOM.levels.WORLDS[w];
  W.monsters.forEach((k, i) => { KINDS[k] = base(k, +w, i ? 'roamer' : 'lurker'); });
  KINDS[W.boss] = base(W.boss, +w, 'boss', { r: 3, h: 6, mass: 20000, speed: 30, hp: 3, knock: { impulse: 12, lift: 5, spin: 5, stun: 0.6 } });
}

const p3 = [0, 0, 0];
function sync(a, ctx) { ctx.toWorld(ctx.track, a.s, a.d, a.h, p3); a.x = p3[0]; a.y = p3[1]; a.z = p3[2]; }
function spawn(place, track, ctx) {
  const K = KINDS[place.kind];
  if (!K) return null;
  const a = { i: 0, kind: K.kind, arche: K.arche, s: place.boss ? place.startS || -40 : place.s, d: place.boss ? 0 : (place.side || 1) * (track.hw[0] + 3), h: 0,
    x: 0, y: 0, z: 0, yaw: 0, vs: 0, vd: 0, vh: 0, state: K.arche === 'boss' ? 'chase' : K.arche === 'roamer' ? 'roam' : 'idle', stateT: 0,
    hp: K.hp || 1, r: K.r, mass: K.mass, phase: 0, alive: true, boss: K.arche === 'boss', home: place.d || 0 };
  a.s = Math.max(0, a.s);
  sync(a, ctx);
  return a;
}
function think(a, ctx) {
  const K = KINDS[a.kind], dt = ctx.dt, car = ctx.car;
  a.stateT += dt; a.phase += dt;
  if (a.state === 'idle' && a.s - car.s < K.trigger && a.s > car.s) { a.state = 'tell'; a.stateT = 0; ctx.emit('monster', { a: a.i, what: 'tell' }); }
  else if (a.state === 'tell' && a.stateT > K.tell) { a.state = 'lunge'; a.stateT = 0; a.vd = -Math.sign(a.d) * K.lunge; ctx.emit('monster', { a: a.i, what: 'lunge' }); }
  else if (a.state === 'lunge' && (Math.abs(a.d) > K.reach + 6 || a.stateT > 1.5)) { a.state = 'recover'; a.stateT = 0; a.vd = 0; }
  else if (a.state === 'roam') { a.vs = K.speed * 0.5; a.vd = M.dsin(a.phase * 0.8) * 3; }
  else if (a.state === 'chase') { a.vs = Math.max(0, car.speed + (car.s - 30 - a.s) * 0.5); a.vd = (car.d - a.d) * 0.3; }
  if (a.state === 'recover' && a.stateT > K.cooldown) a.state = 'gone';
  a.s += a.vs * dt; a.d += a.vd * dt;
  a.yaw = a.vd < 0 ? -1 : a.vd > 0 ? 1 : 0;
  sync(a, ctx);
}
function onHit(a, ctx) { a.state = a.boss ? 'stagger' : 'recover'; a.stateT = 0; a.vd = 0; if (a.boss) a.state = 'chase'; }

VROOM.monsterAI = { KINDS, spawn, think, onHit };
