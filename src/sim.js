/* sim: deterministic vehicle and track physics. Owner: physics. DOM-free, THREE-free (sim region).
   SCAFFOLD STUB: a flat-shaded kinematic placeholder that honours every contract shape so the other
   modules can be built against it. The physics builder replaces the insides (docs/OVERHAUL.md "Physics"):
   per-wheel raycast suspension, tyre grip and slip, drift, airtime, landing, ramps, loops, corkscrews,
   wall and prop collisions with momentum, monster contacts, crane respawn. Keep every export.
   Allowed maths: see src/dmath.js. No Math.random, no clocks, no Math.sin/cos/atan2/exp/pow/hypot. */

const C = VROOM.contracts, M = VROOM.dmath;
const STEP = 1;   /* track sample spacing, metres */

/* ---- track ---- */
function buildTrack(spec) {
  const W = VROOM.levels.WORLDS[spec.world] || VROOM.levels.WORLDS[1];
  let total = 0;
  for (const p of spec.pieces) total += p.type === 'loop' ? 2 * Math.PI * (p.radius || 10) : p.len;
  const n = Math.max(2, Math.ceil(total / STEP) + 1);
  const f64 = () => new Float64Array(n);
  const T = { spec, step: STEP, n, length: (n - 1) * STEP, world: W, px: f64(), py: f64(), pz: f64(), tx: f64(), ty: f64(), tz: f64(),
    ux: f64(), uy: f64(), uz: f64(), rx: f64(), ry: f64(), rz: f64(), hw: new Float32Array(n), surf: new Uint8Array(n), flags: new Uint8Array(n),
    piece: new Uint16Array(n), checkpoints: [], props: [] };
  let x = 0, y = 0, z = 0, yaw = 0, i = 0, hw = 7;
  const defSurf = C.SURF_CODE[W.surf] || 0;
  spec.pieces.forEach((p, pi) => {
    const len = p.type === 'loop' ? 2 * Math.PI * (p.radius || 10) : p.len, steps = Math.max(1, Math.round(len / STEP)), w0 = hw, w1 = p.w || 7;
    let lift = 0;
    for (let k = 0; k < steps && i < n; k++) {
      const u = (k + 0.5) / steps;
      let dy = 0;
      if (p.type === 'hill') dy = p.rise * (0.5 - 0.5 * M.dcos(Math.PI * (k + 1) / steps)) - p.rise * (0.5 - 0.5 * M.dcos(Math.PI * k / steps));
      if (p.type === 'crest') dy = p.h * (M.dsin(Math.PI * (k + 1) / steps) - M.dsin(Math.PI * k / steps));
      if (p.type === 'ramp') { const a = (k + 1) / steps, b = k / steps; dy = p.rise * (a * a - b * b); }
      if (p.type === 'gap' && k === steps - 1) lift = -(p.drop || 0);
      if (p.type === 'bend' || p.type === 'banked') yaw -= p.angle / steps;
      const fx = M.dsin(yaw), fz = M.dcos(yaw), L = M.hyp(1, dy);
      T.px[i] = x; T.py[i] = y; T.pz[i] = z;
      T.tx[i] = fx / L; T.ty[i] = dy / L; T.tz[i] = fz / L;
      T.ux[i] = 0; T.uy[i] = 1; T.uz[i] = 0;
      T.rx[i] = -fz; T.ry[i] = 0; T.rz[i] = fx;
      T.hw[i] = w0 + (w1 - w0) * u;
      T.surf[i] = p.surf ? C.SURF_CODE[p.surf] : defSurf;
      const walls = p.walls === undefined ? 3 : p.walls;
      T.flags[i] = (p.type === 'gap' ? C.TF.GAP : 0) | (p.type === 'ramp' ? C.TF.RAMP : 0) | (walls & 1 ? C.TF.WALL_L : 0) | (walls & 2 ? C.TF.WALL_R : 0) | (p.deco === 'tunnel' ? C.TF.COVER : 0);
      T.piece[i] = pi;
      x += fx * STEP; z += fz * STEP; y += dy; i++;
    }
    y += lift; hw = w1;
  });
  for (; i < n; i++) { T.px[i] = x; T.py[i] = y; T.pz[i] = z; T.tz[i] = 1; T.uy[i] = 1; T.rx[i] = -1; T.hw[i] = hw; T.piece[i] = spec.pieces.length - 1; }
  T.finishS = T.length - 20;
  T.flags[Math.floor(T.finishS / STEP)] |= C.TF.FINISH;
  for (let s = 250; s < T.finishS; s += 250) { T.checkpoints.push(s); T.flags[Math.floor(s / STEP)] |= C.TF.CHECK; }
  T.props = spec.props.map(p => {
    const [px, py, pz] = toWorld(T, p.s, p.d, 0);
    return { ...p, x: px, y: py, z: pz, alive: true, vx: 0, vy: 0, vz: 0, rx: 0, ry: 0, rz: 0 };
  });
  return T;
}
function frameAt(T, s, out = {}) {
  const f = Math.max(0, Math.min(T.n - 1.000001, s / T.step)), i = Math.floor(f), a = f - i, j = Math.min(T.n - 1, i + 1);
  const lerp = (arr) => arr[i] + (arr[j] - arr[i]) * a;
  out.x = lerp(T.px); out.y = lerp(T.py); out.z = lerp(T.pz);
  out.tx = lerp(T.tx); out.ty = lerp(T.ty); out.tz = lerp(T.tz);
  out.ux = lerp(T.ux); out.uy = lerp(T.uy); out.uz = lerp(T.uz);
  out.rx = lerp(T.rx); out.ry = lerp(T.ry); out.rz = lerp(T.rz);
  out.hw = lerp(T.hw); out.surf = T.surf[i]; out.flags = T.flags[i];
  return out;
}
const tmpF = {};
function toWorld(T, s, d, h, out = [0, 0, 0]) {
  const f = frameAt(T, s, tmpF);
  out[0] = f.x + f.rx * d + f.ux * h; out[1] = f.y + f.ry * d + f.uy * h; out[2] = f.z + f.rz * d + f.uz * h;
  return out;
}

/* ---- car ---- */
function carParams(stats, upgrades = {}) {
  return { stats, top: stats.topSpeed * (1 + 0.06 * (upgrades.engine || 0)), accel: stats.power / stats.mass / 12, boostTank: 1 + 0.25 * (upgrades.tank || 0), magnet: 1.5 + 0.5 * (upgrades.magnet || 0) };
}
const wheel = () => ({ x: 0, y: 0, z: 0, comp: 0.5, contact: true, spin: 0, steer: 0, slip: 0, surf: 0 });
function newRace(track, params, opts = {}) {
  const st = { tick: 0, t: 0, rng: (opts.seed >>> 0) || track.spec.seed || 1, track, params, mode: opts.mode || 'race',
    car: { x: 0, y: 0, z: 0, qx: 0, qy: 0, qz: 0, qw: 1, vx: 0, vy: 0, vz: 0, wx: 0, wy: 0, wz: 0, s: 2, d: 0, h: 0, speed: 0, air: false, airT: 0,
      boost: 1, boosting: false, drift: 0, driftT: 0, spinT: 0, stunT: 0, respawnT: 0, surf: 0, rpm: 0, gear: 1, wheels: [wheel(), wheel(), wheel(), wheel()] },
    actors: [], props: track.props.map(p => ({ ...p })), stars: new Uint8Array(track.spec.stars.length), starsGot: 0, nitroGot: 0,
    events: [], finished: false, finishT: 0, stats: { hits: 0, airTime: 0, driftTime: 0, tricks: 0, respawns: 0 } };
  if (opts.monsters !== false && VROOM.monsterAI) {
    const ctx = aiCtx(st);
    for (const m of track.spec.monsters) { const a = VROOM.monsterAI.spawn(m, track, ctx); if (a) st.actors.push(a); }
    if (track.spec.boss) { const a = VROOM.monsterAI.spawn({ ...track.spec.boss, boss: true }, track, ctx); if (a) st.actors.push(a); }
    st.actors.forEach((a, i) => { a.i = i; });
  }
  place(st);
  return st;
}
function aiCtx(st) {
  return { track: st.track, car: st.car, dt: C.SIM_DT, tick: st.tick, rand: () => M.rngNext(st), frameAt, toWorld,
    emit: (type, fields) => st.events.push({ type, tick: st.tick, ...fields }),
    spawn: place => { const a = VROOM.monsterAI.spawn(place, st.track, aiCtx(st)); if (a) { a.i = st.actors.length; st.actors.push(a); } return a; } };
}
const pos3 = [0, 0, 0];
function place(st) {
  const c = st.car, T = st.track, f = frameAt(T, c.s, {});
  toWorld(T, c.s, c.d, c.h, pos3); c.x = pos3[0]; c.y = pos3[1]; c.z = pos3[2];
  const half = M.datan2(f.tx, f.tz) / 2;
  c.qx = 0; c.qy = M.dsin(half); c.qz = 0; c.qw = M.dcos(half);
  c.vx = f.tx * c.speed; c.vy = f.ty * c.speed; c.vz = f.tz * c.speed;
  for (let k = 0; k < 4; k++) {
    const w = c.wheels[k], side = k % 2 ? -0.95 : 0.95, fwd = k < 2 ? 1.4 : -1.4;
    w.x = c.x + f.rx * -side + f.tx * fwd; w.y = c.y + 0.5; w.z = c.z + f.rz * -side + f.tz * fwd;
  }
}
const Q = (v, k) => Math.round(Math.max(-1, Math.min(1, +v || 0)) * k) / k;
function quantize(i = {}) { return { steer: Q(i.steer, 64), throttle: Math.max(0, Q(i.throttle, 16)), brake: Math.max(0, Q(i.brake, 16)), boost: i.boost ? 1 : 0, drift: i.drift ? 1 : 0 }; }
function packInput(i) { const q = quantize(i); return ((q.steer * 64 + 64) & 127) | ((q.throttle * 16) << 7) | ((q.brake * 16) << 12) | (q.boost << 17) | (q.drift << 18); }
function unpackInput(v) { return { steer: ((v & 127) - 64) / 64, throttle: ((v >> 7) & 31) / 16, brake: ((v >> 12) & 31) / 16, boost: (v >> 17) & 1, drift: (v >> 18) & 1 }; }

function step(st, input) {
  const dt = C.SIM_DT, c = st.car, T = st.track, P = st.params, inp = quantize(input);
  st.tick++; st.t += dt;
  if (st.finished) { c.speed *= 0.98; c.s = Math.min(T.length - 1, c.s + c.speed * dt); place(st); return; }
  const boosting = inp.boost && c.boost > 0;
  if (boosting !== c.boosting) { c.boosting = boosting; st.events.push({ type: 'boost', tick: st.tick, on: boosting ? 1 : 0 }); }
  if (boosting) c.boost = Math.max(0, c.boost - dt / (3 * P.boostTank));
  const top = P.top * (boosting ? 1.3 : 1);
  c.speed += (inp.throttle * P.accel * (1 - c.speed / top) - inp.brake * 14 - 0.4) * dt * (c.speed > top ? 0 : 1);
  if (c.speed > top) c.speed -= 8 * dt;
  c.speed = Math.max(0, c.speed);
  const f = frameAt(T, c.s, {});
  c.d = M.clamp(c.d + inp.steer * 8 * dt * Math.min(1, c.speed / 10), -f.hw + 1, f.hw - 1);
  c.s += c.speed * dt;
  c.rpm = Math.min(1, c.speed / P.top); c.surf = f.surf;
  for (const w of c.wheels) { w.spin += c.speed * dt / P.stats.wheelR; w.steer = inp.steer * P.stats.steerMax; }
  const R = P.magnet;
  T.spec.stars.forEach((s, i) => {
    if (!st.stars[i] && Math.abs(s.s - c.s) < R && Math.abs(s.d - c.d) < R) { st.stars[i] = 1; st.starsGot++; st.events.push({ type: 'star', tick: st.tick, i }); }
  });
  if (VROOM.monsterAI) { const ctx = aiCtx(st); for (const a of st.actors) if (a.alive) VROOM.monsterAI.think(a, ctx); }
  if (c.s >= T.finishS) { st.finished = true; st.finishT = st.t; st.events.push({ type: 'finish', tick: st.tick, t: st.t }); }
  place(st);
}
function autopilot(st, skill = 1) {
  const c = st.car, next = st.track.spec.stars.find((s, i) => !st.stars[i] && s.s > c.s + 5);
  const aim = next && next.s - c.s < 60 ? next.d : 0;
  return { steer: M.clamp((aim - c.d) * 0.5 * skill, -1, 1), throttle: 1, brake: 0, boost: c.boost > 0.5 ? 1 : 0, drift: 0 };
}
function result(st) {
  const par = st.track.spec.par, t = st.finishT || st.t, total = st.track.spec.stars.length;
  const tier = t <= par.S ? 'S' : t <= par.A ? 'A' : t <= par.B ? 'B' : 'C';
  const ratio = total ? st.starsGot / total : 1;
  return { time: t, stars: st.starsGot, starsTotal: total, rating: ratio >= 0.9 ? 3 : ratio >= 0.5 ? 2 : 1, tier, hits: st.stats.hits,
    airTime: st.stats.airTime, driftTime: st.stats.driftTime, tricks: st.stats.tricks, respawns: st.stats.respawns, clean: st.stats.hits === 0 };
}

VROOM.sim = { buildTrack, frameAt, toWorld, carParams, newRace, step, quantize, packInput, unpackInput, autopilot, result };
