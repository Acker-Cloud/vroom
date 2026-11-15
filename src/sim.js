/* sim: deterministic vehicle and track physics. Owner: physics. DOM-free, THREE-free (sim region).
   Everything here is a pure function of (LevelSpec, CarParams, seed, inputs): fixed step SIM_DT, the
   seeded stream in SimState.rng, maths from VROOM.dmath only (no Math.sin/cos/atan2/exp/pow/hypot,
   no **, no Math.random, no clocks), plain arrays and loops in a fixed order, so the Swift port can
   match it bit for bit. Section map:
     1. constants and surfaces          5. the car: forces, contacts, assists
     2. small vector and quaternion      6. props, pads, patches, stars, monsters
     3. the track ribbon (buildTrack)    7. respawn crane, checkpoints, finish
     4. track queries (frameAt, locate)  8. autopilot, result, inputs
   Units: metres, seconds, kilograms, radians. Car space: +z nose, +y up, +x the car's LEFT. Track
   space: s along, d to the driver's right (r = cross(t, u)), h above the surface along its normal. */

const C = VROOM.contracts, M = VROOM.dmath;
const TF = C.TF, DT = C.SIM_DT, TAU = 2 * Math.PI;

/* ============ 1. constants and surfaces ============ */
const STEP = 1;               /* track sample spacing, metres */
const RUNOUT = 160;           /* flat walled straight after the finish line: room to brake */
const START_S = 3;            /* where the car sits on the grid */
const CHECK_EVERY = 250;      /* checkpoint spacing */
const CRANE_T = 1.4;          /* seconds the crane holds the car after a fall (about 2 s lost in all) */
const CRANE_H = 3.5;          /* the crane lowers the car from this height */
const RELEASE_V = 14;         /* the crane lets go rolling */
const RUNUP = 80;             /* a crane spot has this much clear road before the next loop or gap */
const LOOP_STICK_V = 9;       /* faster than this a loop or corkscrew holds the car to the road */
const LOOP_PULL = 15;         /* m/s2 the magnet road adds there, on top of gravity turned into the surface */
const LOST_MAX = 1.0;         /* no knock, spin or stun takes control away for longer than this */
const LONG_MU = 1.25;         /* tyres hold more under braking and drive than sideways (real tyres do) */
const TYRE_PEAK = 0.14;       /* slip angle (rad) of peak lateral grip; past it the tyre slides */
const TYRE_FALL = 0.25;       /* grip lost by a fully sliding tyre (share of peak) */
const TYRE_STIFF = 0.3;       /* share of the lateral slip a tyre can cancel per step */
const DRIFT_SIDE = 0.4;       /* tyre side force kept in a drift: the drift's carve steers the path */
const WALL_E = 0.2, WALL_MU = 0.1;      /* barrier: restitution and tangential friction */
const WALL_ANG = 0.3;         /* share of a wall impulse's turning effect: cars glance along walls */
const HULL_E = 0.12, HULL_MU = 0.16;    /* the body on the ground (roof landings, bottoming out) */
const PROP_E = 0.3, PROP_MU = 0.2;      /* hard props */
const WALL_TOP = 12;          /* walls stop the car up to this height: nobody flies out of a walled road */
const STEER_V = 17;           /* steering lock halves by about this speed (m/s) */
const AIR_RATE_MAX = 9;       /* rad/s */
const AIR_STRAFE = 5;         /* m/s2 of sideways air steering from full steer */
const AIR_STRAFE_V = 14;      /* ...up to this sideways speed across the road */

/* per SURF code: grip multiplies the tyre friction, drag is rolling drag in 1/s. Patch props
   (oil, mud, ice, water) use the same table through PATCH_SURF. */
const SURF_P = [
  { grip: 1.08, drag: 0 },      /* 0 asphalt */
  { grip: 1.02, drag: 0 },      /* 1 steel: welded plate */
  { grip: 0.88, drag: 0.02 },   /* 2 dirt */
  { grip: 0.76, drag: 0.06 },   /* 3 sand */
  { grip: 0.6,  drag: 0.3 },    /* 4 mud */
  { grip: 0.155, drag: 0 },     /* 5 ice */
  { grip: 0.62, drag: 0.04 },   /* 6 snow */
  { grip: 0.3,  drag: 0 },      /* 7 oil */
  { grip: 0.74, drag: 0.32 },   /* 8 water */
  { grip: 0.95, drag: 0.03 },   /* 9 lava rock */
  { grip: 0.98, drag: 0 },      /* 10 glass */
  { grip: 0.72, drag: 0.05 },   /* 11 cloud */
  { grip: 0.84, drag: 0.06 },   /* 12 sugar */
];
const surfP = code => SURF_P[code] || SURF_P[0];
const PATCH_SURF = { oil: 7, mud: 4, ice: 5, water: 8 };
const TRICKS = ['flip', 'roll', 'spin'];                 /* trick kinds by body axis: pitch, roll, yaw */
const GEARS = [0, 0.2, 0.38, 0.56, 0.76, 1.3];           /* gear bands as shares of top speed, for the engine voice */

/* ============ 2. small vector and quaternion helpers ============ */
const clamp = M.clamp;
const sgn = v => (v > 0 ? 1 : v < 0 ? -1 : 0);
const smooth = u => u * u * (3 - 2 * u);
const len3 = (x, y, z) => Math.sqrt(x * x + y * y + z * z);
const finite = v => typeof v === 'number' && v - v === 0;

/* body axes from the car's quaternion: R[0..2] bx (left), R[3..5] by (up), R[6..8] bz (nose) */
function qmat(c, R) {
  const x = c.qx, y = c.qy, z = c.qz, w = c.qw;
  R[0] = 1 - 2 * (y * y + z * z); R[1] = 2 * (x * y + z * w); R[2] = 2 * (x * z - y * w);
  R[3] = 2 * (x * y - z * w); R[4] = 1 - 2 * (x * x + z * z); R[5] = 2 * (y * z + x * w);
  R[6] = 2 * (x * z + y * w); R[7] = 2 * (y * z - x * w); R[8] = 1 - 2 * (x * x + y * y);
}
/* quaternion from three orthonormal axes (the columns of a rotation matrix), into c.q* */
function qFromAxes(c, ax, ay, az, bxv, byv, bzv, cxv, cyv, czv) {
  /* columns: a = body x, b = body y, cc = body z; m[row][col] */
  const m00 = ax, m10 = ay, m20 = az, m01 = bxv, m11 = byv, m21 = bzv, m02 = cxv, m12 = cyv, m22 = czv;
  const tr = m00 + m11 + m22;
  let x, y, z, w;
  if (tr > 0) { const s = 0.5 / Math.sqrt(tr + 1); w = 0.25 / s; x = (m21 - m12) * s; y = (m02 - m20) * s; z = (m10 - m01) * s; }
  else if (m00 > m11 && m00 > m22) { const s = 2 * Math.sqrt(1 + m00 - m11 - m22); w = (m21 - m12) / s; x = 0.25 * s; y = (m01 + m10) / s; z = (m02 + m20) / s; }
  else if (m11 > m22) { const s = 2 * Math.sqrt(1 + m11 - m00 - m22); w = (m02 - m20) / s; x = (m01 + m10) / s; y = 0.25 * s; z = (m12 + m21) / s; }
  else { const s = 2 * Math.sqrt(1 + m22 - m00 - m11); w = (m10 - m01) / s; x = (m02 + m20) / s; y = (m12 + m21) / s; z = 0.25 * s; }
  const L = Math.sqrt(x * x + y * y + z * z + w * w);
  c.qx = x / L; c.qy = y / L; c.qz = z / L; c.qw = w / L;
}

/* ============ 3. the track ribbon ============ */
function pieceSteps(p) {
  const len = p.type === 'loop' ? TAU * (p.radius > 0 ? p.radius : 10) : (+p.len > 0 ? +p.len : 1);
  return Math.max(1, Math.round(len / STEP));
}
/* a bend's yaw over the piece: curvature eases in and out over share a at each end (a trapezoid), 0..1 */
function bendY(u, a) {
  let y;
  if (u < a) y = u * u / (2 * a);
  else if (u > 1 - a) y = (1 - a) - (1 - u) * (1 - u) / (2 * a);
  else y = a / 2 + (u - a);
  return y / (1 - a);
}
/* 0 at the ends, 1 in the middle, eased over share e at each end */
const env = (u, e) => (u < e ? smooth(u / e) : u > 1 - e ? smooth((1 - u) / e) : 1);
/* ramp slope profile: slope sine sl * g(u), with g chosen so the climb is close to `rise` (lip is exact) */
function rampG(u, F) {
  if (F <= 0.5) { const b = clamp(2 - 4 * F, 0, 1); return (1 - b) * u + b * u * u * u; }
  const c = clamp(2 - 2 * F, 0, 1); return (1 - c) + c * u;
}

/* frame from heading psi, slope (sp = sin pitch, cp = cos pitch) and roll phi, written at sample i */
function writeFrame(T, i, x, y, z, psi, sp, cp, phi) {
  const sy = M.dsin(psi), cy = M.dcos(psi);
  const tx = cp * sy, ty = sp, tz = cp * cy;
  const r0x = -cy, r0z = sy;                       /* the level right vector */
  const u0x = -sy * sp, u0y = cp, u0z = -cy * sp;  /* cross(r0, t) */
  const sf = M.dsin(phi), cf = M.dcos(phi);
  T.px[i] = x; T.py[i] = y; T.pz[i] = z;
  T.tx[i] = tx; T.ty[i] = ty; T.tz[i] = tz;
  T.ux[i] = u0x * cf + r0x * sf; T.uy[i] = u0y * cf; T.uz[i] = u0z * cf + r0z * sf;
  T.rx[i] = r0x * cf - u0x * sf; T.ry[i] = -u0y * sf; T.rz[i] = r0z * cf - u0z * sf;
}

/* a loop drifts sideways so its exit clears its entry: offset the tangent by that drift and re-square u
   and r on it. (A corkscrew rolls about its centreline; the rail in physics() keeps the car on it.) */
function loopFrame(T, i, O, N, psi0) {
  const r0x = -M.dcos(psi0), r0z = M.dsin(psi0), dlat = O.latD / (N * STEP);
  let tx = T.tx[i] + r0x * dlat, ty = T.ty[i], tz = T.tz[i] + r0z * dlat;
  const tl = len3(tx, ty, tz); tx /= tl; ty /= tl; tz /= tl;
  let ux = T.ux[i], uy = T.uy[i], uz = T.uz[i];
  const ut = ux * tx + uy * ty + uz * tz;
  ux -= tx * ut; uy -= ty * ut; uz -= tz * ut;
  const ul = len3(ux, uy, uz); ux /= ul; uy /= ul; uz /= ul;
  T.tx[i] = tx; T.ty[i] = ty; T.tz[i] = tz; T.ux[i] = ux; T.uy[i] = uy; T.uz[i] = uz;
  T.rx[i] = ty * uz - tz * uy; T.ry[i] = tz * ux - tx * uz; T.rz[i] = tx * uy - ty * ux;
}

/* LevelSpec -> Track. Every contracts.PIECES type; unknown types drive as straights. Extra arrays the
   renderers may read: hp (halfpipe lip height), mid (split median half width), rbA / rbW (rumble amp,
   wave), curv (signed curvature 1/m, + right). Samples past finishS are the runout. */
function buildTrack(spec) {
  const WORLDS = VROOM.levels.WORLDS, W = WORLDS[spec.world] || WORLDS[1];
  const pieces = spec.pieces || [];
  const steps = pieces.map(pieceSteps);
  let total = 0;
  for (const k of steps) total += k;
  const n = total + RUNOUT + 1;
  const f64 = () => new Float64Array(n), f32 = () => new Float32Array(n);
  const T = { spec, step: STEP, n, length: (n - 1) * STEP, finishS: 0, checkpoints: [], world: W,
    px: f64(), py: f64(), pz: f64(), tx: f64(), ty: f64(), tz: f64(), ux: f64(), uy: f64(), uz: f64(), rx: f64(), ry: f64(), rz: f64(),
    hw: f32(), surf: new Uint8Array(n), flags: new Uint8Array(n), piece: new Uint16Array(n),
    hp: f32(), mid: f32(), rbA: f32(), rbW: f32(), curv: f32(), props: [], propOrder: null };
  const defSurf = C.SURF_CODE[W.surf] !== undefined ? C.SURF_CODE[W.surf] : 0;
  let x = 0, y = 0, z = 0, psi = 0, hw = 7, i = 0;
  const O = { psi: 0, sp: 0, cp: 1, phi: 0, lat: 0, latD: 0, turns: 0 };
  for (let pi = 0; pi < pieces.length; pi++) {
    const p = pieces[pi], N = steps[pi], type = p.type, L = N * STEP;
    const w0 = hw, w1 = +p.w > 0 ? +p.w : 7;
    const surf = p.surf !== undefined && C.SURF_CODE[p.surf] !== undefined ? C.SURF_CODE[p.surf] : defSurf;
    let walls = p.walls === undefined ? 3 : (p.walls | 0) & 3;
    if (type === 'gap' || type === 'halfpipe') walls = 0;
    const flags0 = (type === 'gap' ? TF.GAP : 0) | (type === 'ramp' ? TF.RAMP : 0) | (type === 'loop' || type === 'corkscrew' ? TF.LOOP : 0) |
      (walls & 1 ? TF.WALL_L : 0) | (walls & 2 ? TF.WALL_R : 0) | (p.deco === 'tunnel' ? TF.COVER : 0);
    const psi0 = psi, y0 = y;
    const angle = +p.angle || 0, bank = +p.bank || 0;
    const ba = Math.min(0.25, 10 / L) > 0.05 ? Math.min(0.25, 10 / L) : 0.05;
    const lipS = M.dsin(clamp(+p.lip || 0, -1.2, 1.2));
    const rampF = lipS > 0.01 && +p.rise > 0 ? (+p.rise) / (L * lipS) : 0.5;
    const loopLat = 2 * w0 + 2;
    const orient = u => {
      O.psi = psi0; O.sp = 0; O.cp = 1; O.phi = 0; O.lat = 0; O.latD = 0; O.turns = Math.max(1, Math.round(Math.abs(+p.turns || 1))) * (+p.turns < 0 ? -1 : 1);
      if (type === 'bend') { O.psi = psi0 - angle * bendY(u, 0.2); O.phi = bank * M.dsin(Math.PI * u); }
      else if (type === 'banked') { O.psi = psi0 - angle * bendY(u, 0.2); O.phi = bank * env(u, ba); }
      else if (type === 'hill') O.sp = (+p.rise || 0) * (Math.PI / 2) * M.dsin(Math.PI * u) / L;
      else if (type === 'crest') O.sp = (+p.h || 0) * Math.PI * M.dsin(TAU * u) / L;
      else if (type === 'ramp') O.sp = lipS * rampG(u, rampF);
      else if (type === 'loop') { const a = TAU * u; O.sp = M.dsin(a); O.cp = M.dcos(a); O.lat = loopLat * (u - M.dsin(TAU * u) / TAU); O.latD = loopLat * (1 - M.dcos(TAU * u)); }
      else if (type === 'corkscrew') O.phi = TAU * O.turns * (u - M.dsin(TAU * u) / TAU);
      if (type !== 'loop') { O.sp = clamp(O.sp, -0.95, 0.95); O.cp = Math.sqrt(1 - O.sp * O.sp); }
    };
    for (let k = 0; k < N && i < n; k++) {
      const u = k / N, um = (k + 0.5) / N, u1 = (k + 1) / N;
      orient(u);
      const lat0 = O.lat;
      writeFrame(T, i, x, y, z, O.psi, O.sp, O.cp, O.phi);
      if (type === 'loop') loopFrame(T, i, O, N, psi0);
      const e = smooth(u);
      let w = w0 + (w1 - w0) * e;
      if (type === 'split') {
        const sep = Math.max(0, +p.sep || 0), es = env(u, 0.25);
        T.mid[i] = Math.max(0, (sep / 2) * es - w);
        w += (sep / 2) * es;
      }
      if (type === 'halfpipe') T.hp[i] = Math.max(0, +p.wallH || 0) * env(u, Math.min(0.25, 10 / L));
      if (type === 'rumble') { T.rbA[i] = Math.max(0, +p.amp || 0) * env(u, 0.1); T.rbW[i] = Math.max(1, +p.wave || 3); }
      T.hw[i] = w; T.surf[i] = surf; T.flags[i] = flags0; T.piece[i] = pi;
      /* advance one metre along the mid-step tangent */
      orient(um);
      const sy = M.dsin(O.psi), cy = M.dcos(O.psi);
      if (type === 'gap') { x += sy * STEP; z += cy * STEP; y = y0 - (+p.drop || 0) * u1; }
      else { x += O.cp * sy * STEP; y += O.sp * STEP; z += O.cp * cy * STEP; }
      if (type === 'loop') { orient(u1); const dl = O.lat - lat0; x += -M.dcos(psi0) * dl; z += M.dsin(psi0) * dl; }
      i++;
    }
    orient(1);
    psi = O.psi; hw = w1;
  }
  T.finishS = Math.max(START_S + 20, i * STEP);
  /* the runout: flat, walled, the world's surface */
  const pl = Math.max(0, pieces.length - 1);
  for (; i < n; i++) {
    writeFrame(T, i, x, y, z, psi, 0, 1, 0);
    T.hw[i] = hw; T.surf[i] = defSurf; T.flags[i] = TF.WALL_L | TF.WALL_R; T.piece[i] = pl;
    x += M.dsin(psi) * STEP; z += M.dcos(psi) * STEP;
  }
  /* signed curvature (+ right) for the autopilot and the renderers */
  for (let j = 0; j < n - 1; j++) {
    T.curv[j] = ((T.tx[j + 1] - T.tx[j]) * T.rx[j] + (T.ty[j + 1] - T.ty[j]) * T.ry[j] + (T.tz[j + 1] - T.tz[j]) * T.rz[j]) / STEP;
  }
  /* finish line on solid road */
  let fi = Math.floor(T.finishS / STEP);
  while (fi > 1 && (T.flags[fi] & (TF.GAP | TF.LOOP))) fi--;
  T.finishS = fi * STEP;
  T.flags[fi] |= TF.FINISH;
  /* checkpoints every ~250 m, each on a solid flat stretch the crane can use */
  for (let s = CHECK_EVERY; s < T.finishS - 60; s += CHECK_EVERY) {
    const j = safeSample(T, Math.floor(s / STEP), -1, 180);
    if (j < 0) continue;
    const cs = j * STEP;
    if (T.checkpoints.length && cs <= T.checkpoints[T.checkpoints.length - 1] + 40) continue;
    if (cs < START_S + 40) continue;
    T.checkpoints.push(cs); T.flags[j] |= TF.CHECK;
  }
  /* props: PropPlace plus pose, with the category's defaults filled in */
  const pos = [0, 0, 0];
  T.props = (spec.props || []).map(p => {
    const cat = C.PROP_CAT[p.cat] || C.PROP_CAT.cone;
    toWorld(T, p.s, p.d || 0, 0, pos);
    return { ...p, kind: cat.kind, r: p.r > 0 ? p.r : cat.r || 1, len: p.len > 0 ? p.len : cat.len || 4, w: p.w > 0 ? p.w : cat.w || 2,
      h: p.h > 0 ? p.h : 2.2, mass: cat.mass || 0, x: pos[0], y: pos[1], z: pos[2], alive: true, knocked: false, vx: 0, vy: 0, vz: 0, rx: 0, ry: 0, rz: 0 };
  });
  const ord = T.props.map((p, k) => k);
  ord.sort((a, b) => (T.props[a].s - T.props[b].s) || (a - b));
  T.propOrder = Int32Array.from(ord);
  return T;
}
/* a sample near i (searching in direction dir, then the other way) whose next 10 m are solid, flat-ish and
   not a loop: where a crane can set a car down. -1 if none within `range`. */
function safeSample(T, i, dir, range) {
  const ok = j => {
    if (j < 1 || j + 10 >= T.n) return false;
    for (let k = j; k <= j + 10; k++) if ((T.flags[k] & (TF.GAP | TF.LOOP | TF.RAMP)) || T.hp[k] > 0.2 || T.uy[k] < 0.8) return false;
    /* and a run-up: no loop or jump in the next RUNUP metres (the car needs the speed) */
    for (let k = j + 11, e = Math.min(T.n - 1, j + RUNUP); k < e; k++) if (T.flags[k] & (TF.GAP | TF.LOOP)) return false;
    return true;
  };
  for (let k = 0; k <= range; k++) { const j = i + dir * k; if (ok(j)) return j; }
  for (let k = 1; k <= range; k++) { const j = i - dir * k; if (ok(j)) return j; }
  return -1;
}

/* ============ 4. track queries ============ */
function frameAt(T, s, out = {}) {
  const f = clamp(s / T.step, 0, T.n - 1.000001), i = Math.floor(f), a = f - i, j = i + 1;
  out.x = T.px[i] + (T.px[j] - T.px[i]) * a; out.y = T.py[i] + (T.py[j] - T.py[i]) * a; out.z = T.pz[i] + (T.pz[j] - T.pz[i]) * a;
  out.tx = T.tx[i] + (T.tx[j] - T.tx[i]) * a; out.ty = T.ty[i] + (T.ty[j] - T.ty[i]) * a; out.tz = T.tz[i] + (T.tz[j] - T.tz[i]) * a;
  out.ux = T.ux[i] + (T.ux[j] - T.ux[i]) * a; out.uy = T.uy[i] + (T.uy[j] - T.uy[i]) * a; out.uz = T.uz[i] + (T.uz[j] - T.uz[i]) * a;
  out.rx = T.rx[i] + (T.rx[j] - T.rx[i]) * a; out.ry = T.ry[i] + (T.ry[j] - T.ry[i]) * a; out.rz = T.rz[i] + (T.rz[j] - T.rz[i]) * a;
  out.hw = T.hw[i] + (T.hw[j] - T.hw[i]) * a; out.surf = T.surf[i]; out.flags = T.flags[i];
  return out;
}
/* the cross-section's height above the centre plane at (sample i + a, d): halfpipe lips and rumble */
function crossOff(T, i, a, s, d, hw, out) {
  let off = 0, dd = 0, ds = 0;
  const hp = T.hp[i] + (T.hp[i + 1] - T.hp[i]) * a;
  if (hp > 0.01) {
    const flat = hw * 0.4, ad = Math.abs(d);
    if (ad > flat) { const span = hw - flat, x = Math.min(1.15, (ad - flat) / span); off += hp * x * x; dd += sgn(d) * 2 * hp * x / span; }
  }
  const ra = T.rbA[i];
  if (ra > 0.001) {
    const wv = T.rbW[i], ph = TAU * s / wv;
    off += ra * 0.5 * (1 - M.dcos(ph)); ds += ra * Math.PI / wv * M.dsin(ph);
  }
  out[0] = off; out[1] = dd; out[2] = ds;
  return out;
}
const tmpF = {}, tmpOff = [0, 0, 0];
function toWorld(T, s, d, h, out = [0, 0, 0]) {
  const f = frameAt(T, s, tmpF), fi = clamp(s / T.step, 0, T.n - 1.000001), i = Math.floor(fi);
  crossOff(T, i, fi - i, s, d, f.hw, tmpOff);
  const hh = h + tmpOff[0];
  out[0] = f.x + f.rx * d + f.ux * hh; out[1] = f.y + f.ry * d + f.uy * hh; out[2] = f.z + f.rz * d + f.uz * hh;
  return out;
}
/* where a world point is in track space: s by Newton steps from a guess, then d, h, the surface normal,
   whether there is road under it, and the local flags. Writes q; allocation-free. */
function mkQuery() {
  return { s: 0, d: 0, h: 0, nx: 0, ny: 1, nz: 0, tx: 0, ty: 0, tz: 1, ux: 0, uy: 1, uz: 0, rx: -1, ry: 0, rz: 0,
    hw: 7, mid: 0, flags: 0, surf: 0, solid: true, i: 0 };
}
function locate(T, px, py, pz, s0, iters, q) {
  const lim = T.n - 1.000001;
  let s = s0;
  for (let k = 0; k < iters; k++) {
    const f = clamp(s / STEP, 0, lim), i = Math.floor(f), a = f - i, j = i + 1;
    const cx = T.px[i] + (T.px[j] - T.px[i]) * a, cy = T.py[i] + (T.py[j] - T.py[i]) * a, cz = T.pz[i] + (T.pz[j] - T.pz[i]) * a;
    const tx = T.tx[i] + (T.tx[j] - T.tx[i]) * a, ty = T.ty[i] + (T.ty[j] - T.ty[i]) * a, tz = T.tz[i] + (T.tz[j] - T.tz[i]) * a;
    s += (px - cx) * tx + (py - cy) * ty + (pz - cz) * tz;
  }
  s = clamp(s, 0, T.length);
  const f = clamp(s / STEP, 0, lim), i = Math.floor(f), a = f - i, j = i + 1;
  const cx = T.px[i] + (T.px[j] - T.px[i]) * a, cy = T.py[i] + (T.py[j] - T.py[i]) * a, cz = T.pz[i] + (T.pz[j] - T.pz[i]) * a;
  const tx = T.tx[i] + (T.tx[j] - T.tx[i]) * a, ty = T.ty[i] + (T.ty[j] - T.ty[i]) * a, tz = T.tz[i] + (T.tz[j] - T.tz[i]) * a;
  const ux = T.ux[i] + (T.ux[j] - T.ux[i]) * a, uy = T.uy[i] + (T.uy[j] - T.uy[i]) * a, uz = T.uz[i] + (T.uz[j] - T.uz[i]) * a;
  const rx = T.rx[i] + (T.rx[j] - T.rx[i]) * a, ry = T.ry[i] + (T.ry[j] - T.ry[i]) * a, rz = T.rz[i] + (T.rz[j] - T.rz[i]) * a;
  const hw = T.hw[i] + (T.hw[j] - T.hw[i]) * a;
  const dx = px - cx, dy = py - cy, dz = pz - cz;
  const d = dx * rx + dy * ry + dz * rz, hr = dx * ux + dy * uy + dz * uz;
  crossOff(T, i, a, s, d, hw, tmpOff);
  let nx = ux - rx * tmpOff[1] - tx * tmpOff[2], ny = uy - ry * tmpOff[1] - ty * tmpOff[2], nz = uz - rz * tmpOff[1] - tz * tmpOff[2];
  const nl = len3(nx, ny, nz); nx /= nl; ny /= nl; nz /= nl;
  q.s = s; q.d = d; q.h = (hr - tmpOff[0]) * (ux * nx + uy * ny + uz * nz); q.i = i;
  q.nx = nx; q.ny = ny; q.nz = nz; q.tx = tx; q.ty = ty; q.tz = tz; q.ux = ux; q.uy = uy; q.uz = uz; q.rx = rx; q.ry = ry; q.rz = rz;
  q.hw = hw; q.mid = T.mid[i] + (T.mid[j] - T.mid[i]) * a; q.flags = T.flags[i]; q.surf = T.surf[i];
  q.solid = !(T.flags[i] & TF.GAP) && Math.abs(d) <= hw + 0.3 && s < T.length - 0.5;
  return q;
}

/* ============ 5. the car ============ */
/* CarStats (+ save upgrades) -> the sim's own constants. Robust to missing or odd stats. */
function carParams(stats, upgrades = {}) {
  const S = stats || {}, up = upgrades || {}, sz = S.size || {};
  const num = (v, d) => (finite(v) ? v : d);
  const lv = k => clamp(num(up[k], 0) | 0, 0, 3);
  const eng = lv('engine'), arm = lv('armor'), mag = lv('magnet'), tank = lv('tank'), spr = lv('springs');
  const m = clamp(num(S.mass, 1600), 300, 30000);
  const l = clamp(num(sz.l, 4.4), 2, 14), w = clamp(num(sz.w, 2.2), 1.2, 5), h = clamp(num(sz.h, 1.8), 0.6, 6);
  const wb = clamp(num(S.wheelbase, l * 0.62), 1.4, l), tr = clamp(num(S.track, w * 0.86), 1, w * 1.15);
  const wR = clamp(num(S.wheelR, 0.5), 0.2, 1.5), travel = clamp(num(S.suspTravel, 0.35), 0.1, 1);
  const cgH = clamp(num(S.cgH, 0.9), 0.3, 3), rideH = clamp(num(S.rideH, 0.5), 0.08, 2.5);
  const wl = m * 9.8 / 4;
  const K = clamp(num(S.suspK, 42000), wl / (0.5 * travel), wl / (0.16 * travel));
  const crit = 2 * Math.sqrt(K * m / 4);
  const Cd = clamp(num(S.suspC, 0.5 * crit), 0.35 * crit, 0.85 * crit) * (1 + 0.08 * spr);
  const x0 = wl / K;                                     /* static compression at 1 g */
  const yM = (wR + travel - x0) - cgH;                   /* mount height above the CG, car space */
  const hx = tr / 2, hz = wb / 2;
  const mounts = new Float64Array([hx, yM, hz, -hx, yM, hz, hx, yM, -hz, -hx, yM, -hz]);
  const hb = Math.max(0.1, rideH) - cgH, ht = Math.max(hb + 0.4, h) - cgH, cx = w * 0.45, cz = l * 0.45;
  const hull = new Float64Array([cx, hb, cz, -cx, hb, cz, cx, hb, -cz, -cx, hb, -cz, cx, ht, cz, -cx, ht, cz, cx, ht, -cz, -cx, ht, -cz]);
  /* box inertia, padded 50 percent for the heavy axles and wheels out at the corners */
  const Ix = 1.5 * m / 12 * (h * h + l * l), Iy = 1.5 * m / 12 * (w * w + l * l), Iz = 1.5 * m / 12 * (w * w + h * h);
  const top = clamp(num(S.topSpeed, 40), 10, 90) * (1 + 0.04 * eng);
  /* drive: a(v) = A0 (1 - (v / top)^3). A0 from power to weight, so 0-30 m/s is ~3.2 s for the base truck */
  const pw = clamp(num(S.power, 260000) / m / 162.5, 0.5, 2.2);
  const A0 = 11.1 * Math.sqrt(pw) * (1 + 0.16 * eng);
  const bw = clamp(num(S.boostPower, 120000) / m / 75, 0.5, 2.5);
  const grip = clamp(num(S.grip, 1.05), 0.3, 2);
  const cls = typeof S.cls === 'string' ? S.cls : '';
  return {
    stats: S, cls, hover: cls === 'hover', m, im: 1 / m, iI: [1 / Ix, 1 / Iy, 1 / Iz],
    l, w, h, wb, tr, wR, travel, cgH, rideH, K, Cd, x0, mounts, hull, carR: 0.25 * (l + w),
    top, A0, boostMul: 1.3, boostA: 5.5 * Math.sqrt(bw), kickA: 5,
    brakeA: clamp(num(S.brake, 14), 6, 30), grip, driftRatio: clamp(num(S.driftGrip, 0.72) / grip, 0.45, 0.9),
    steerMax: clamp(num(S.steerMax, 0.55), 0.2, 0.9), airCtl: clamp(num(S.airControl, 2.2), 0.5, 6) * (1 + 0.15 * spr),
    armor: clamp(num(S.armor, 0.3) + 0.12 * arm, 0, 0.9), boostDur: 3 * (1 + 0.25 * tank), magnet: 2.2 + 0.7 * mag, landSoft: 1 + 0.1 * spr,
  };
}

const wheelState = () => ({ x: 0, y: 0, z: 0, comp: 0, contact: false, spin: 0, steer: 0, slip: 0, surf: 0 });
function newRace(track, params, opts = {}) {
  const P = params || carParams({}, {});
  const seed = (opts.seed >>> 0) || (track.spec.seed >>> 0) || 1;
  const c = { x: 0, y: 0, z: 0, qx: 0, qy: 0, qz: 0, qw: 1, vx: 0, vy: 0, vz: 0, wx: 0, wy: 0, wz: 0, s: START_S, d: 0, h: 0, speed: 0, air: false, airT: 0,
    boost: 0.5, boosting: false, drift: 0, driftT: 0, spinT: 0, stunT: 0, respawnT: 0, surf: 0, rpm: 0, gear: 1,
    wheels: [wheelState(), wheelState(), wheelState(), wheelState()] };
  const props = track.props.map(p => ({ ...p }));
  const st = { tick: 0, t: 0, rng: seed, track, params: P, mode: opts.mode || 'race', car: c, actors: [], props,
    stars: new Uint8Array((track.spec.stars || []).length), starsGot: 0, nitroGot: 0, events: [], finished: false, finishT: 0,
    stats: { hits: 0, airTime: 0, driftTime: 0, tricks: 0, respawns: 0, walls: 0 } };
  st.int = newInternal(st);
  placeAt(st, START_S, 0, 0, 0);
  c.surf = track.surf[Math.floor(START_S / STEP)];
  if (opts.monsters !== false && VROOM.monsterAI) {
    const ctx = st.int.ctx;
    for (const m of track.spec.monsters || []) { const a = VROOM.monsterAI.spawn(m, track, ctx); if (a) { a.i = st.actors.length; st.actors.push(a); } }
    if (track.spec.boss) { const a = VROOM.monsterAI.spawn({ ...track.spec.boss, boss: true }, track, ctx); if (a) { a.i = st.actors.length; st.actors.push(a); } }
  }
  return st;
}
/* the sim's private per-race state (not part of the contract; the Swift port mirrors it field by field) */
function newInternal(st) {
  const I = {
    R: new Float64Array(9), om: new Float64Array(3), sf: new Float64Array(2), tgt: [0, 0, 0], surfCount: new Uint8Array(16), inp: { steer: 0, throttle: 0, brake: 0, boost: 0, drift: 0 }, qc: mkQuery(), qh: mkQuery(),
    qw: [mkQuery(), mkQuery(), mkQuery(), mkQuery()], wf: new Float64Array(4), wx: new Float64Array(4), wvn: new Float64Array(4),
    steer: 0, airTicks: 0, takeoffVy: 0, rotP: 0, rotR: 0, rotY: 0, trickN: [0, 0, 0], tricksPending: 0,
    driftClean: true, driftHold: 0, kickT: 0, spinDir: 1, spinLeft: 0, spinRate: 0, prevH: 0, flipT: 0, stuckT: 0, loopAirT: 0,
    cpI: -1, cpS: START_S, fallsHere: 0, progS: START_S, progT: 0, patchN: 0, patches: new Int32Array(8), nC: 0, vfwd: 0, landVn: 0, wallV: 0, wallSide: 0, touchSide: 0, scrapeV: 0, slipMax: 0, oilN: 0, lastGroundS: START_S, craneS: START_S, wallCool: 0, scrapeCool: 0, onOil: 0, hull: false,
    propCool: new Float64Array(st.track.props.length), flying: [], actorCool: [], bossDone: [], lastSurf: -1, lastCP: -1,
    ctx: null, why: '',
  };
  I.ctx = {
    track: st.track, car: st.car, dt: DT, tick: 0, rand: () => M.rngNext(st), frameAt, toWorld,
    emit: (type, fields) => {
      if (type === 'boss' && fields && fields.what === 'defeat') I.bossDone[fields.a] = 1;
      st.events.push({ type, tick: st.tick, ...fields });
    },
    spawn: place => {
      const a = VROOM.monsterAI.spawn(place, st.track, I.ctx);
      if (a) { a.i = st.actors.length; st.actors.push(a); }
      return a;
    },
  };
  return I;
}
function emit(st, type, fields) { st.events.push({ type, tick: st.tick, ...fields }); }

/* put the car at (s, d) on the road, h above it, aligned with the track, rolling at v */
const placePos = [0, 0, 0];
function placeAt(st, s, d, h, v) {
  const c = st.car, T = st.track, P = st.params, f = frameAt(T, s, {});
  const tl = len3(f.tx, f.ty, f.tz), ul = len3(f.ux, f.uy, f.uz);
  const tx = f.tx / tl, ty = f.ty / tl, tz = f.tz / tl, ux = f.ux / ul, uy = f.uy / ul, uz = f.uz / ul;
  /* body x is the car's left = -right = cross(u, t) */
  const bxx = uy * tz - uz * ty, bxy = uz * tx - ux * tz, bxz = ux * ty - uy * tx;
  qFromAxes(c, bxx, bxy, bxz, ux, uy, uz, tx, ty, tz);
  toWorld(T, s, d, h, placePos);
  c.x = placePos[0]; c.y = placePos[1]; c.z = placePos[2];
  c.vx = tx * v; c.vy = ty * v; c.vz = tz * v; c.wx = 0; c.wy = 0; c.wz = 0;
  c.s = s; c.d = d; c.h = h; c.speed = Math.abs(v);
  const I = st.int;
  I.steer = 0; I.airTicks = 0; I.flipT = 0; I.stuckT = 0; I.loopAirT = 0; I.progS = s; I.progT = 0;
  qmat(c, I.R);
  for (let k = 0; k < 4; k++) {
    const w = c.wheels[k], m = P.mounts;
    const ox = I.R[0] * m[k * 3] + I.R[3] * m[k * 3 + 1] + I.R[6] * m[k * 3 + 2];
    const oy = I.R[1] * m[k * 3] + I.R[4] * m[k * 3 + 1] + I.R[7] * m[k * 3 + 2];
    const oz = I.R[2] * m[k * 3] + I.R[5] * m[k * 3 + 1] + I.R[8] * m[k * 3 + 2];
    const drop = h > 0.05 ? P.travel : P.travel - P.x0;
    w.x = c.x + ux * P.cgH + ox - ux * drop; w.y = c.y + uy * P.cgH + oy - uy * drop; w.z = c.z + uz * P.cgH + oz - uz * drop;
    w.comp = h > 0.05 ? 0 : P.x0 / P.travel; w.contact = h <= 0.05; w.steer = 0; w.slip = 0;
  }
}

/* the track frame's angular velocity at q, for a car moving along it: per metre the frame turns by
   roll -(dr/ds).u about t, pitch (dt/ds).u about r, yaw -(dt/ds).r about u; times the along-track speed */
function roadSpin(T, q, c, out) {
  const i = Math.min(T.n - 2, q.i), j = i + 1;
  const dtx = T.tx[j] - T.tx[i], dty = T.ty[j] - T.ty[i], dtz = T.tz[j] - T.tz[i];
  const drx = T.rx[j] - T.rx[i], dry = T.ry[j] - T.ry[i], drz = T.rz[j] - T.rz[i];
  const wt = -(drx * q.ux + dry * q.uy + drz * q.uz), wr = dtx * q.ux + dty * q.uy + dtz * q.uz, wu = -(dtx * q.rx + dty * q.ry + dtz * q.rz);
  const vs = (c.vx * q.tx + c.vy * q.ty + c.vz * q.tz) / STEP;
  out[0] = (q.tx * wt + q.rx * wr + q.ux * wu) * vs; out[1] = (q.ty * wt + q.ry * wr + q.uy * wu) * vs; out[2] = (q.tz * wt + q.rz * wr + q.uz * wu) * vs;
  return out;
}
/* the effective grip and drag of a wheel's surface for this car (hovers float over the slow stuff) */
function wheelSurf(P, code, out) {
  const sp = surfP(code);
  if (P.hover) { out[0] = sp.grip < 1 ? 1 - (1 - sp.grip) * 0.3 : sp.grip; out[1] = sp.drag * 0.2; }
  else { out[0] = sp.grip; out[1] = sp.drag; }
  return out;
}
/* is (s, d) inside a patch prop? returns its SURF code or -1 */
function patchAt(st, s, d) {
  const I = st.int;
  for (let k = 0; k < I.patchN; k++) {
    const p = st.props[I.patches[k]];
    if (Math.abs(s - p.s) <= p.len / 2 && Math.abs(d - (p.d || 0)) <= p.w) return PATCH_SURF[p.cat] !== undefined ? PATCH_SURF[p.cat] : -1;
  }
  return -1;
}

/* apply an impulse J (world) at offset o from the CG; ang scales its turning share (walls turn the car less) */
function impulse(c, P, R, ox, oy, oz, jx, jy, jz, ang = 1) {
  c.vx += jx * P.im; c.vy += jy * P.im; c.vz += jz * P.im;
  const tx = oy * jz - oz * jy, ty = oz * jx - ox * jz, tz = ox * jy - oy * jx;
  angAdd(c, P, R, tx, ty, tz, ang);
}
/* W += Iw^-1 tau * k, with Iw^-1 = R diag(iI) R^T */
function angAdd(c, P, R, tx, ty, tz, k) {
  const b0 = (R[0] * tx + R[1] * ty + R[2] * tz) * P.iI[0] * k, b1 = (R[3] * tx + R[4] * ty + R[5] * tz) * P.iI[1] * k, b2 = (R[6] * tx + R[7] * ty + R[8] * tz) * P.iI[2] * k;
  c.wx += R[0] * b0 + R[3] * b1 + R[6] * b2; c.wy += R[1] * b0 + R[4] * b1 + R[7] * b2; c.wz += R[2] * b0 + R[5] * b1 + R[8] * b2;
}
/* 1 / effective mass of the body along unit n at offset o */
function invMass(P, R, ox, oy, oz, nx, ny, nz) {
  const cx = oy * nz - oz * ny, cy = oz * nx - ox * nz, cz = ox * ny - oy * nx;
  const b0 = (R[0] * cx + R[1] * cy + R[2] * cz) * P.iI[0], b1 = (R[3] * cx + R[4] * cy + R[5] * cz) * P.iI[1], b2 = (R[6] * cx + R[7] * cy + R[8] * cz) * P.iI[2];
  const wx = R[0] * b0 + R[3] * b1 + R[6] * b2, wy = R[1] * b0 + R[4] * b1 + R[7] * b2, wz = R[2] * b0 + R[5] * b1 + R[8] * b2;
  /* (Iinv (o x n)) x o . n */
  const kx = wy * oz - wz * oy, ky = wz * ox - wx * oz, kz = wx * oy - wy * ox;
  return P.im + kx * nx + ky * ny + kz * nz;
}
/* resolve a point contact: normal n, restitution e, friction mu; returns the normal speed it removed.
   ang < 1 solves the contact as if the body turned less easily there (walls glance you along, they do not spin you) */
function contact(c, P, R, ox, oy, oz, nx, ny, nz, e, mu, ang = 1) {
  const vx = c.vx + c.wy * oz - c.wz * oy, vy = c.vy + c.wz * ox - c.wx * oz, vz = c.vz + c.wx * oy - c.wy * ox;
  const vn = vx * nx + vy * ny + vz * nz;
  if (vn >= 0) return 0;
  const jn = -(1 + e) * vn / (P.im + (invMass(P, R, ox, oy, oz, nx, ny, nz) - P.im) * ang);
  let tx = vx - nx * vn, ty = vy - ny * vn, tz = vz - nz * vn;
  const vt = len3(tx, ty, tz);
  let jt = 0;
  if (vt > 1e-6 && mu > 0) {
    tx /= vt; ty /= vt; tz /= vt;
    jt = Math.min(mu * jn, vt / (P.im + (invMass(P, R, ox, oy, oz, tx, ty, tz) - P.im) * ang));
  }
  impulse(c, P, R, ox, oy, oz, nx * jn - tx * jt, ny * jn - ty * jt, nz * jn - tz * jt, ang);
  return -vn;
}

/* one SIM_DT of car physics: suspension, tyres, engine, assists, contacts, integration */
function physics(st, inp, lost) {
  const c = st.car, T = st.track, P = st.params, I = st.int, R = I.R, W = T.world;
  const g = finite(W.gravity) ? W.gravity : 9.8, m = P.m;
  qmat(c, R);
  const bxx = R[0], bxy = R[1], bxz = R[2], byx = R[3], byy = R[4], byz = R[5], bzx = R[6], bzy = R[7], bzz = R[8];
  let gx = c.x + byx * P.cgH, gy = c.y + byy * P.cgH, gz = c.z + byz * P.cgH;   /* CG */
  const QC = locate(T, gx, gy, gz, c.s, 3, I.qc);
  const vmag = len3(c.vx, c.vy, c.vz), vfwd = c.vx * bzx + c.vy * bzy + c.vz * bzz;
  /* gravity: a loop or corkscrew holds a fast car to the road */
  let Gx = 0, Gy = -g, Gz = 0;
  if ((QC.flags & TF.LOOP) && QC.solid && QC.h < P.cgH + 3 && vmag > LOOP_STICK_V) { const k2 = g + LOOP_PULL; Gx = -QC.nx * k2; Gy = -QC.ny * k2; Gz = -QC.nz * k2; }
  let Fx = Gx * m, Fy = Gy * m, Fz = Gz * m, Tx = 0, Ty = 0, Tz = 0;
  /* steering: lock shrinks with speed, the wheel turns at a finite rate */
  const lock = P.steerMax / (1 + (vfwd * vfwd) / (STEER_V * STEER_V));
  const target = inp.steer * lock, dmax = 4 * DT;
  I.steer += clamp(target - I.steer, -dmax, dmax);
  const delta = I.steer, cd = M.dcos(delta), sd = M.dsin(delta);
  /* ---- pass 1: suspension ---- */
  let nC = 0, sumF = 0;
  const mo = P.mounts;
  for (let k = 0; k < 4; k++) {
    const mx = mo[k * 3], my = mo[k * 3 + 1], mz = mo[k * 3 + 2];
    const ox = bxx * mx + byx * my + bzx * mz, oy = bxy * mx + byy * my + bzy * mz, oz = bxz * mx + byz * my + bzz * mz;
    const q = locate(T, gx + ox, gy + oy, gz + oz, c.s, 2, I.qw[k]);
    const cosA = byx * q.nx + byy * q.ny + byz * q.nz;
    I.wf[k] = 0; I.wx[k] = -1;
    if (!q.solid || cosA < 0.3 || q.h < -0.8) continue;
    const dist = q.h / cosA, x = P.travel + P.wR - dist;
    if (x <= 0) continue;
    const pox = ox - byx * dist, poy = oy - byy * dist, poz = oz - byz * dist;
    const vpx = c.vx + c.wy * poz - c.wz * poy, vpy = c.vy + c.wz * pox - c.wx * poz, vpz = c.vz + c.wx * poy - c.wy * pox;
    const vn = vpx * q.nx + vpy * q.ny + vpz * q.nz;
    let fs = P.K * x - P.Cd * vn;
    if (x > P.travel) fs += P.K * 6 * (x - P.travel);
    fs = clamp(fs, 0, 5 * m * 9.8);
    I.wf[k] = fs; I.wx[k] = x; I.wvn[k] = vn;
    nC++; sumF += fs;
  }
  /* ---- engine ---- */
  const boosting = c.boosting;
  const vt = boosting ? P.top * P.boostMul : P.top, rr = Math.max(0, vfwd) / vt;
  let drive = 0;
  const reversing = inp.throttle === 0 && inp.brake > 0 && vfwd < 0.8;
  if (reversing) drive = vfwd > -9 ? -P.A0 * 0.45 * inp.brake : 0;
  else if (rr < 1) drive = P.A0 * (1 - rr * rr * rr) * inp.throttle;
  const driftOn = c.drift !== 0, spinning = c.spinT > 0;
  /* ---- pass 2: tyres ---- */
  let gripSum = 0, slipMax = 0, oilN = 0;
  const sf = I.sf;
  const surfCount = I.surfCount;
  surfCount.fill(0);
  for (let k = 0; k < 4; k++) {
    const w = c.wheels[k], q = I.qw[k], fs = I.wf[k];
    const mx = mo[k * 3], my = mo[k * 3 + 1], mz = mo[k * 3 + 2];
    const ox = bxx * mx + byx * my + bzx * mz, oy = bxy * mx + byy * my + bzy * mz, oz = bxz * mx + byz * my + bzz * mz;
    const front = k < 2;
    w.steer = front ? delta : 0;
    if (I.wx[k] < 0) {
      w.contact = false; w.slip = 0;
      w.comp = Math.max(0, w.comp - 6 * DT);
      w.spin += inp.throttle * 15 * DT;
      w.x = gx + ox - byx * P.travel; w.y = gy + oy - byy * P.travel; w.z = gz + oz - byz * P.travel;
      continue;
    }
    const x = I.wx[k], dist = P.travel + P.wR - x;
    const pox = ox - byx * dist, poy = oy - byy * dist, poz = oz - byz * dist;
    const nx = q.nx, ny = q.ny, nz = q.nz;
    /* wheel heading on the ground plane, and its side (left) */
    let fx = front ? bzx * cd - bxx * sd : bzx, fy = front ? bzy * cd - bxy * sd : bzy, fz = front ? bzz * cd - bxz * sd : bzz;
    const fn = fx * nx + fy * ny + fz * nz;
    fx -= nx * fn; fy -= ny * fn; fz -= nz * fn;
    const fl = len3(fx, fy, fz) || 1; fx /= fl; fy /= fl; fz /= fl;
    const sx = ny * fz - nz * fy, sy = nz * fx - nx * fz, sz = nx * fy - ny * fx;
    const vpx = c.vx + c.wy * poz - c.wz * poy, vpy = c.vy + c.wz * pox - c.wx * poz, vpz = c.vz + c.wx * poy - c.wy * pox;
    const vlong = vpx * fx + vpy * fy + vpz * fz, vlat = vpx * sx + vpy * sy + vpz * sz;
    let code = q.surf;
    if (I.patchN) { const pc = patchAt(st, q.s, q.d); if (pc >= 0) code = pc; }
    if (code === 7) oilN++;
    surfCount[code]++;
    wheelSurf(P, code, sf);
    const share = sumF > 0 ? fs / sumF : 0.25;
    let mu = P.grip * sf[0];
    if (!front && driftOn) mu *= P.driftRatio;
    if (spinning) mu *= 0.3;
    gripSum += sf[0];
    const capS = mu * fs, capL = capS * LONG_MU;
    const alpha = M.datan2(Math.abs(vlat), Math.max(Math.abs(vlong), 2));
    const shape = alpha < TYRE_PEAK ? 1 : 1 - TYRE_FALL * Math.min(1, (alpha - TYRE_PEAK) / 0.5);
    let fyT = clamp(-vlat * m * share / DT * TYRE_STIFF, -capS * shape, capS * shape);
    if (driftOn && !spinning) fyT *= DRIFT_SIDE;
    let fxT = drive * m * share;
    if (!reversing && inp.brake > 0) {
      const fb = Math.min(inp.brake * P.brakeA * m * share, Math.abs(vlong) * m * share / DT * 0.5);
      fxT -= sgn(vlong) * fb;
    }
    if (inp.throttle === 0 && !reversing) fxT -= sgn(vlong) * Math.min(0.6 * m * share, Math.abs(vlong) * m * share / DT * 0.5);
    fxT -= vlong * sf[1] * m * share;
    const ell = (fxT / (capL || 1)) * (fxT / (capL || 1)) + (fyT / (capS || 1)) * (fyT / (capS || 1));
    if (ell > 1) { const k2 = 1 / Math.sqrt(ell); fxT *= k2; fyT *= k2; }
    const slip = clamp((ell - 0.8) * 2, 0, 1) || (alpha > TYRE_PEAK ? clamp((alpha - TYRE_PEAK) * 3, 0, 1) : 0);
    w.slip = slip; if (slip > slipMax) slipMax = slip;
    /* forces: spring along the normal at the contact, tyre forces raised toward the CG (less roll and pitch moment) */
    const tfx = fx * fxT + sx * fyT, tfy = fy * fxT + sy * fyT, tfz = fz * fxT + sz * fyT;
    Fx += nx * fs + tfx; Fy += ny * fs + tfy; Fz += nz * fs + tfz;
    const lift = P.cgH * 0.55;
    const ax = pox + nx * lift, ay = poy + ny * lift, az = poz + nz * lift;
    Tx += poy * nz * fs - poz * ny * fs + ay * tfz - az * tfy;
    Ty += poz * nx * fs - pox * nz * fs + az * tfx - ax * tfz;
    Tz += pox * ny * fs - poy * nx * fs + ax * tfy - ay * tfx;
    w.contact = true; w.comp = Math.min(1, x / P.travel); w.surf = code;
    w.spin += vlong / P.wR * DT;
    w.x = gx + ox - byx * (dist - P.wR); w.y = gy + oy - byy * (dist - P.wR); w.z = gz + oz - byz * (dist - P.wR);
  }
  /* surface under the car: the most wheels */
  if (nC) { let best = 0; for (let k = 1; k < 16; k++) if (surfCount[k] > surfCount[best]) best = k; c.surf = best; }
  /* boost and kicks are thrust at the CG (they do not need traction); half strength in the air */
  const vb = P.top * P.boostMul;
  let push = 0;
  if (boosting && vfwd < vb) push += P.boostA * Math.min(1, (vb - vfwd) / 3);
  if (I.kickT > 0 && vfwd < vb) push += P.kickA * Math.min(1, (vb - vfwd) / 3);
  if (nC === 0) push *= 0.5;
  Fx += bzx * push * m; Fy += bzy * push * m; Fz += bzz * push * m;
  /* over the top speed on the ground (downhill, pads): a soft limiter; in the air, the world's air drag */
  if (nC > 0) {
    const lim = (boosting || I.kickT > 0 ? vb : P.top) * 1.01;
    if (vfwd > lim) { const k2 = 0.8 * (vfwd - lim) * m; Fx -= bzx * k2; Fy -= bzy * k2; Fz -= bzz * k2; }
  } else {
    const ad = finite(W.airDrag) ? W.airDrag : 0.02;
    Fx -= c.vx * ad * m; Fy -= c.vy * ad * m; Fz -= c.vz * ad * m;
  }
  /* ---- integrate forces ---- */
  const vfBefore = vmag;
  c.vx += Fx * P.im * DT; c.vy += Fy * P.im * DT; c.vz += Fz * P.im * DT;
  angAdd(c, P, R, Tx, Ty, Tz, DT);
  /* the road's own turning rate under the car (rad/s): the stabilisers damp the car's rotation against it,
     not against standing still, so a car keeps pace with a corkscrew's roll or a loop's pitch */
  roadSpin(T, QC, c, I.om);
  const owx = c.wx - I.om[0], owy = c.wy - I.om[1], owz = c.wz - I.om[2];
  /* ---- the rail: on a loop or corkscrew a fast car is held to the road, square to it ---- */
  if ((QC.flags & TF.LOOP) && QC.solid && QC.h < P.cgH + 2.5 && vmag > LOOP_STICK_V) {
    const hd = (QC.h - I.prevH) / DT;
    if (hd > 0) { const k2 = hd * 0.9; c.vx -= QC.nx * k2; c.vy -= QC.ny * k2; c.vz -= QC.nz * k2; }
    const ex = byy * QC.nz - byz * QC.ny, ey = byz * QC.nx - byx * QC.nz, ez = byx * QC.ny - byy * QC.nx;
    const eR = ex * bzx + ey * bzy + ez * bzz, eP = ex * bxx + ey * bxy + ez * bxz;
    const wR = owx * bzx + owy * bzy + owz * bzz, wP = owx * bxx + owy * bxy + owz * bxz;
    const kR = (160 * eR - 18 * wR) * DT, kP = (60 * eP - 10 * wP) * DT;
    c.wx += bzx * kR + bxx * kP; c.wy += bzy * kR + bxy * kP; c.wz += bzz * kR + bxz * kP;
  }
  I.prevH = QC.h;
  /* ---- assists: what makes a 2 t truck drivable with one thumb ---- */
  const ground = nC >= 2;
  const nx = QC.nx, ny = QC.ny, nz = QC.nz;
  if (ground) {
    const gf = clamp(gripSum / nC, 0.12, 1.1);
    /* keep the body square to the road: roll firmly, pitch softly (squat and dive still show) */
    const ex = byy * nz - byz * ny, ey = byz * nx - byx * nz, ez = byx * ny - byy * nx;
    const eR = ex * bzx + ey * bzy + ez * bzz, eP = ex * bxx + ey * bxy + ez * bxz;
    const wR = owx * bzx + owy * bzy + owz * bzz, wP = owx * bxx + owy * bxy + owz * bxz;
    const kR = (40 * eR - 8 * wR) * DT, kP = (10 * eP - 4 * wP) * DT;
    c.wx += bzx * kR + bxx * kP; c.wy += bzy * kR + bxy * kP; c.wz += bzz * kR + bxz * kP;
    /* yaw: drift, spin-out, or stability control toward the steered turn rate the grip can hold */
    const wy = c.wx * nx + c.wy * ny + c.wz * nz;
    let fpx = bzx - nx * (bzx * nx + bzy * ny + bzz * nz), fpy = bzy - ny * (bzx * nx + bzy * ny + bzz * nz), fpz = bzz - nz * (bzx * nx + bzy * ny + bzz * nz);
    const fpl = len3(fpx, fpy, fpz) || 1; fpx /= fpl; fpy /= fpl; fpz /= fpl;
    const spx = ny * fpz - nz * fpy, spy = nz * fpx - nx * fpz, spz = nx * fpy - ny * fpx;
    const vF = c.vx * fpx + c.vy * fpy + c.vz * fpz, vL = c.vx * spx + c.vy * spy + c.vz * spz;
    let wt, gain;
    if (spinning) { wt = I.spinLeft > 0.25 ? I.spinDir * I.spinRate : 0; gain = 12; I.spinLeft -= Math.abs(wy) * DT; }
    else if (driftOn) {
      const beta = M.datan2(vL, Math.max(Math.abs(vF), 1));
      const bt = c.drift * clamp(0.45 + 0.25 * inp.steer * c.drift, 0.2, 0.75);
      const carve = -c.drift * 0.5 * (1 + clamp(inp.steer * c.drift, -1, 1)) * clamp(vF / 20, 0, 1.2) * gf;
      wt = carve - 3 * (bt - beta); gain = 9;
      /* the drift carves: velocity turns with the car, and a held drift keeps most of its speed */
      const ang = carve * 0.8 * DT, ca = M.dcos(ang), sa = M.dsin(ang);
      const vpx = vF * fpx + vL * spx, vpy = vF * fpy + vL * spy, vpz = vF * fpz + vL * spz;
      const rotF = vF * ca - vL * sa, rotL = vF * sa + vL * ca;
      c.vx += rotF * fpx + rotL * spx - vpx; c.vy += rotF * fpy + rotL * spy - vpy; c.vz += rotF * fpz + rotL * spz - vpz;
      const vnow = len3(c.vx, c.vy, c.vz), keep = vfBefore * (1 - 0.1 * DT);
      if (vnow > 0.1 && vnow < keep) { const k2 = keep / vnow; c.vx *= k2; c.vy *= k2; c.vz *= k2; }
    } else {
      const vmaxW = gf * P.grip * 9.8 / Math.max(Math.abs(vF), 3);
      wt = clamp(-vF * M.dsin(delta) / (M.dcos(delta) * P.wb), -vmaxW, vmaxW); gain = 8 * gf;
      /* weathervane: a car sliding sideways or backwards swings nose-first into its travel */
      const vmg = Math.sqrt(vF * vF + vL * vL);
      if (vmg > 6) {
        const th = M.datan2(vL, vF);
        if (Math.abs(th) > 0.6) { wt = 2.6 * th * clamp(vmg / 15, 0, 1); gain = Math.max(gain, 5); }
      }
    }
    const dw = (wt - wy) * Math.min(1, gain * DT);
    c.wx += nx * dw; c.wy += ny * dw; c.wz += nz * dw;
  } else if (nC === 0) {
    /* air: player rotation, auto-level when hands are off, a little damping */
    const ac = P.airCtl * DT;
    /* steer strafes (air steering, the nose follows the travel); tricks sit behind the drift control and the brake:
       drift + steer spins, brake back-flips, brake + steer rolls, drift + gas front-flips */
    const big = Math.abs(inp.steer) > 0.5;
    const inR = !inp.drift && inp.brake > 0 && big ? inp.steer : 0;
    const inY = inp.drift ? -inp.steer : 0;
    const inP = inR ? 0 : inp.brake > 0 ? -inp.brake : inp.drift && inp.throttle > 0 && Math.abs(inp.steer) < 0.2 ? 1 : 0;
    if (!lost) {
      c.wx += (bxx * inP + bzx * inR + byx * inY) * ac * 2.2; c.wy += (bxy * inP + bzy * inR + byy * inY) * ac * 2.2; c.wz += (bxz * inP + bzz * inR + byz * inY) * ac * 2.2;
      if (!inp.drift && !inR && QC.h < 80) {
        const vl = c.vx * QC.rx + c.vy * QC.ry + c.vz * QC.rz, want = inp.steer * AIR_STRAFE_V;
        const k2 = clamp(want - vl, -AIR_STRAFE * DT, AIR_STRAFE * DT) * Math.abs(inp.steer);
        c.vx += QC.rx * k2; c.vy += QC.ry * k2; c.vz += QC.rz * k2;
      }
    }
    if (lost || (inP === 0 && inR === 0)) {
      let ux = 0, uy = 1, uz = 0;
      if (QC.h < 40) { ux = QC.ux; uy = QC.uy; uz = QC.uz; }
      const ex = byy * uz - byz * uy, ey = byz * ux - byx * uz, ez = byx * uy - byy * ux;
      const eR = ex * bzx + ey * bzy + ez * bzz, eP = ex * bxx + ey * bxy + ez * bxz;
      const wR = c.wx * bzx + c.wy * bzy + c.wz * bzz, wP = c.wx * bxx + c.wy * bxy + c.wz * bxz;
      const kR = (6 * eR - 3 * wR) * DT, kP = (6 * eP - 3 * wP) * DT;
      c.wx += bzx * kR + bxx * kP; c.wy += bzy * kR + bxy * kP; c.wz += bzz * kR + bxz * kP;
    }
    if (c.spinT > 0 && I.spinLeft > 0.25) {
      const wY = c.wx * byx + c.wy * byy + c.wz * byz, dw = (I.spinDir * I.spinRate - wY) * Math.min(1, 12 * DT);
      c.wx += byx * dw; c.wy += byy * dw; c.wz += byz * dw; I.spinLeft -= Math.abs(wY) * DT;
    } else if (lost || inY === 0) {
      /* swing the nose toward the direction of travel so landings run true */
      const vS = c.vx * bxx + c.vy * bxy + c.vz * bxz, vF = c.vx * bzx + c.vy * bzy + c.vz * bzz;
      const yawErr = vF * vF + vS * vS > 9 ? M.datan2(vS, vF) : 0, wY = c.wx * byx + c.wy * byy + c.wz * byz;
      const kY = (4 * yawErr - 2.5 * wY) * DT;
      c.wx += byx * kY; c.wy += byy * kY; c.wz += byz * kY;
    }
    const dmp = 1 - 0.3 * DT;
    c.wx *= dmp; c.wy *= dmp; c.wz *= dmp;
    const wl = len3(c.wx, c.wy, c.wz);
    if (wl > AIR_RATE_MAX) { const k2 = AIR_RATE_MAX / wl; c.wx *= k2; c.wy *= k2; c.wz *= k2; }
  }
  /* ---- contacts as impulses: bump stops, the hull on the ground, walls and the split median ---- */
  let landVn = 0;
  for (let k = 0; k < 4; k++) {
    if (I.wx[k] <= P.travel * 0.92) continue;
    const q = I.qw[k], mx = mo[k * 3], my = mo[k * 3 + 1], mz = mo[k * 3 + 2];
    const dist = P.travel + P.wR - I.wx[k];
    const ox = bxx * mx + byx * my + bzx * mz - byx * dist, oy = bxy * mx + byy * my + bzy * mz - byy * dist, oz = bxz * mx + byz * my + bzz * mz - byz * dist;
    const v = contact(c, P, R, ox, oy, oz, q.nx, q.ny, q.nz, 0.05, 0);
    if (v > landVn) landVn = v;
  }
  let hullHit = false, deepest = 0, dnx = 0, dny = 0, dnz = 0, wallV = 0, wallSide = 0, touchSide = 0, scrapeV = 0, wallPen = 0, wpx = 0, wpy = 0, wpz = 0;
  const hl = P.hull, QH = I.qh;
  for (let k = 0; k < 8; k++) {
    const hx = hl[k * 3], hy = hl[k * 3 + 1], hz = hl[k * 3 + 2];
    const ox = bxx * hx + byx * hy + bzx * hz, oy = bxy * hx + byy * hy + bzy * hz, oz = bxz * hx + byz * hy + bzz * hz;
    locate(T, gx + ox, gy + oy, gz + oz, c.s, 1, QH);
    if (QH.solid && QH.h < 0 && QH.h > -2.2) {
      const v = contact(c, P, R, ox, oy, oz, QH.nx, QH.ny, QH.nz, HULL_E, HULL_MU);
      hullHit = true;
      if (v > landVn) landVn = v;
      if (-QH.h > deepest) { deepest = -QH.h; dnx = QH.nx; dny = QH.ny; dnz = QH.nz; }
    }
    if (QH.h > WALL_TOP || QH.h < -3) continue;
    const ad = Math.abs(QH.d), side = QH.d > 0 ? 1 : -1;
    let wnx = 0, wny = 0, wnz = 0, pen = 0;
    if (ad > QH.hw && (QH.flags & (side > 0 ? TF.WALL_R : TF.WALL_L))) { pen = ad - QH.hw; wnx = -QH.rx * side; wny = -QH.ry * side; wnz = -QH.rz * side; }
    else if (QH.mid > 0.2 && ad < QH.mid) {
      const cs = c.d >= 0 ? 1 : -1;
      pen = cs > 0 ? QH.mid - QH.d : QH.d + QH.mid;
      if (pen > 0) { wnx = QH.rx * cs; wny = QH.ry * cs; wnz = QH.rz * cs; }
    }
    if (pen > 0) {
      const rl = len3(wnx, wny, wnz) || 1; wnx /= rl; wny /= rl; wnz /= rl;
      const v = contact(c, P, R, ox, oy, oz, wnx, wny, wnz, WALL_E, WALL_MU, WALL_ANG);
      if (v > wallV) { wallV = v; wallSide = side; }
      touchSide = side;
      scrapeV = Math.max(scrapeV, Math.abs(c.vx * QH.tx + c.vy * QH.ty + c.vz * QH.tz));
      if (pen > wallPen) { wallPen = pen; wpx = wnx; wpy = wny; wpz = wnz; }
    }
  }
  /* push out of the ground and the walls (position only) */
  if (deepest > 0) { const k2 = Math.min(deepest, 0.5) * 0.8; gx += dnx * k2; gy += dny * k2; gz += dnz * k2; }
  if (wallPen > 0) { const k2 = Math.min(wallPen, 1) * 0.9; gx += wpx * k2; gy += wpy * k2; gz += wpz * k2; }
  /* ---- integrate position and orientation ---- */
  gx += c.vx * DT; gy += c.vy * DT; gz += c.vz * DT;
  const h2 = 0.5 * DT, qx = c.qx, qy = c.qy, qz = c.qz, qw = c.qw;
  c.qx = qx + h2 * (c.wx * qw + c.wy * qz - c.wz * qy);
  c.qy = qy + h2 * (c.wy * qw + c.wz * qx - c.wx * qz);
  c.qz = qz + h2 * (c.wz * qw + c.wx * qy - c.wy * qx);
  c.qw = qw + h2 * (-c.wx * qx - c.wy * qy - c.wz * qz);
  const ql = Math.sqrt(c.qx * c.qx + c.qy * c.qy + c.qz * c.qz + c.qw * c.qw);
  c.qx /= ql; c.qy /= ql; c.qz /= ql; c.qw /= ql;
  qmat(c, R);
  c.x = gx - R[3] * P.cgH; c.y = gy - R[4] * P.cgH; c.z = gz - R[5] * P.cgH;
  locate(T, c.x, c.y, c.z, c.s, 3, QC);
  c.s = QC.s; c.d = QC.d; c.h = QC.h;
  c.speed = len3(c.vx, c.vy, c.vz);
  /* hand the step's contact story to the bookkeeping */
  I.nC = nC; I.hull = hullHit; I.landVn = landVn; I.wallV = wallV; I.wallSide = wallSide || touchSide; I.touchSide = touchSide; I.scrapeV = scrapeV; I.slipMax = slipMax; I.oilN = oilN;
  I.vfwd = c.vx * R[6] + c.vy * R[7] + c.vz * R[8];
}

/* jumps, landings, tricks, drift, rpm and the events they make */
function bookkeeping(st, inp, lost) {
  const c = st.car, I = st.int, P = st.params, R = I.R, QC = I.qc;
  const onGround = I.nC > 0 || I.hull;
  /* air and landing */
  if (!onGround) {
    if (I.airTicks === 0) I.takeoffVy = c.vx * QC.nx + c.vy * QC.ny + c.vz * QC.nz;
    I.airTicks++;
    if (I.airTicks === 12) {
      c.air = true; c.airT = 12 * DT; I.rotP = 0; I.rotR = 0; I.rotY = 0; I.trickN[0] = 0; I.trickN[1] = 0; I.trickN[2] = 0; I.tricksPending = 0;
      emit(st, 'jump', { vy: I.takeoffVy });
      if (c.drift) endDrift(st, false);
    }
    if (c.air) {
      c.airT += DT;
      I.rotP += (c.wx * R[0] + c.wy * R[1] + c.wz * R[2]) * DT;
      I.rotY += (c.wx * R[3] + c.wy * R[4] + c.wz * R[5]) * DT;
      I.rotR += (c.wx * R[6] + c.wy * R[7] + c.wz * R[8]) * DT;
      const full = TAU * 0.85;
      for (let k = 0; k < 3; k++) {
        const rot = k === 0 ? I.rotP : k === 1 ? I.rotR : I.rotY;
        if (Math.abs(rot) >= full) {
          const sg = sgn(rot);
          if (k === 0) I.rotP -= sg * TAU; else if (k === 1) I.rotR -= sg * TAU; else I.rotY -= sg * TAU;
          I.trickN[k]++; I.tricksPending++;
          emit(st, 'trick', { kind: TRICKS[k], n: I.trickN[k] });
        }
      }
    }
  } else {
    if (c.air) {
      const up = R[3] * QC.nx + R[4] * QC.ny + R[5] * QC.nz;
      const hard = clamp((I.landVn - 3) / (12 * P.landSoft), 0, 1);
      emit(st, 'land', { airT: c.airT, hard });
      st.stats.airTime += c.airT;
      if (I.tricksPending) {
        if (up > 0.7) { st.stats.tricks += I.tricksPending; c.boost = Math.min(1, c.boost + 0.15 * I.tricksPending); }
        I.tricksPending = 0;
      }
      c.air = false;
    }
    I.airTicks = 0;
    I.lastGroundS = c.s;
  }
  /* walls */
  if (I.wallCool > 0) I.wallCool -= DT;
  if (I.scrapeCool > 0) I.scrapeCool -= DT;
  if (I.wallV > 4 && I.wallCool <= 0) { emit(st, 'wall', { side: I.wallSide, impulse: I.wallV }); I.wallCool = 0.3; st.stats.walls++; if (I.wallV > 6) I.driftClean = false; }
  else if (I.touchSide !== 0 && I.scrapeV > 4 && I.scrapeCool <= 0) { emit(st, 'scrape', { side: I.touchSide, v: I.scrapeV }); I.scrapeCool = 0.15; }
  /* drift: enter with the drift control + a steer at speed; ends on release, when slow, or knocked */
  const ground = I.nC >= 2;
  if (!c.drift && ground && !lost && inp.drift && Math.abs(inp.steer) > 0.2 && I.vfwd > 13) {
    c.drift = inp.steer > 0 ? 1 : -1; c.driftT = 0; I.driftClean = true; I.driftHold = 0;
    const dw = -c.drift * 1.4;
    c.wx += R[3] * dw; c.wy += R[4] * dw; c.wz += R[5] * dw;
    emit(st, 'drift', { on: 1 });
  } else if (c.drift) {
    if (ground) { c.driftT += DT; st.stats.driftTime += DT; }
    if (!inp.drift || lost || I.vfwd < 7) endDrift(st, !lost);
  }
  if (I.kickT > 0) I.kickT -= DT;
  /* surface change */
  if (onGround && c.surf !== I.lastSurf) { if (I.lastSurf >= 0) emit(st, 'surface', { surf: c.surf }); I.lastSurf = c.surf; }
  /* oil: hitting it fast with a wheel turned can spin you */
  if (I.oilN > 0 && I.onOil === 0 && !lost && I.vfwd > 16 && (Math.abs(inp.steer) > 0.35 || M.rngNext(st) < 0.3)) spinOut(st, 'oil', inp.steer >= 0 ? -1 : 1, 0.8);
  I.onOil = I.oilN;
  /* rpm and gear for the engine voice */
  const v = Math.max(0, I.vfwd), top = P.top * 1.05;
  let gi = 0;
  while (gi < 4 && v > GEARS[gi + 1] * top) gi++;
  if (onGround) {
    const lo = GEARS[gi] * top, hi = GEARS[gi + 1] * top;
    c.gear = gi + 1; c.rpm = clamp(0.28 + 0.72 * (v - lo) / (hi - lo), 0, 1);
  } else c.rpm += (clamp(0.3 + inp.throttle * 0.7, 0, 1) - c.rpm) * 4 * DT;
}
function endDrift(st, clean) {
  const c = st.car, I = st.int;
  if (clean && I.driftClean && c.driftT >= 0.5) {
    const bonus = Math.min(0.3, 0.1 * c.driftT);
    c.boost = Math.min(1, c.boost + bonus);
    I.kickT = Math.min(1.2, 0.35 * c.driftT);
    emit(st, 'driftBank', { t: c.driftT, bonus });
  }
  c.drift = 0;
  emit(st, 'drift', { on: 0 });
}
function spinOut(st, why, dir, t) {
  const c = st.car, I = st.int;
  if (c.spinT > 0 || c.respawnT > 0) return;
  c.spinT = clamp(t, 0.75, LOST_MAX); I.spinDir = dir; I.spinLeft = TAU; I.spinRate = TAU / (c.spinT * 0.9);
  if (c.drift) endDrift(st, false);
  I.driftClean = false;
  emit(st, 'spin', { why });
}

/* ============ 6. props, pads, patches, stars, monsters ============ */
function interact(st) {
  const c = st.car, T = st.track, P = st.params, I = st.int, R = I.R, props = st.props, ord = T.propOrder;
  /* stars: a ball around the car, bigger with the magnet */
  const stars = T.spec.stars || [], rr = P.magnet * P.magnet;
  for (let k = 0; k < stars.length; k++) {
    if (st.stars[k]) continue;
    const s = stars[k], ds = s.s - c.s;
    if (ds > P.magnet || ds < -P.magnet) continue;
    const dd = (s.d || 0) - c.d, dh = (s.h || 1) - (c.h + 1);
    if (ds * ds + dd * dd + dh * dh < rr) { st.stars[k] = 1; st.starsGot++; emit(st, 'star', { i: k }); }
  }
  /* props near the car, found by binary search on the s-sorted order */
  I.patchN = 0;
  let lo = 0, hi = ord.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (props[ord[mid]].s < c.s - 16) lo = mid + 1; else hi = mid; }
  for (let k = lo; k < ord.length; k++) {
    const i = ord[k], p = props[i];
    if (p.s > c.s + 16) break;
    if (I.propCool[i] > 0) I.propCool[i] -= DT;
    if (!p.alive || p.knocked) continue;
    const ds = p.s - c.s, dd = (p.d || 0) - c.d;
    if (p.kind === 'patch') { if (I.patchN < 8) I.patches[I.patchN++] = i; continue; }
    if (p.kind === 'pad') {
      if (Math.abs(ds) <= p.len / 2 && Math.abs(dd) <= p.w && c.h < 1.2 && I.propCool[i] <= 0) {
        I.propCool[i] = 1;
        const QC = I.qc;
        if (p.cat === 'jumpPad') {
          const g = finite(T.world.gravity) ? T.world.gravity : 9.8, want = 9 * Math.sqrt(g / 9.8);
          const vn = c.vx * QC.nx + c.vy * QC.ny + c.vz * QC.nz;
          if (vn < want) { c.vx += QC.nx * (want - vn); c.vy += QC.ny * (want - vn); c.vz += QC.nz * (want - vn); }
        } else {
          const vb = P.top * P.boostMul * 1.1, vf = c.vx * QC.tx + c.vy * QC.ty + c.vz * QC.tz, add = clamp(vb - vf, 0, 10);
          c.vx += QC.tx * add; c.vy += QC.ty * add; c.vz += QC.tz * add;
          I.kickT = Math.max(I.kickT, 0.8);
        }
        emit(st, 'pad', { i });
      }
      continue;
    }
    if (p.kind === 'pickup') {
      const rad = p.r + 1.2 + (P.magnet - 2.2);
      if (ds * ds + dd * dd < rad * rad && c.h < 4) {
        p.alive = false; st.nitroGot++; c.boost = Math.min(1, c.boost + 0.5);
        emit(st, 'nitro', { i });
      }
      continue;
    }
    const rad = p.r + P.carR * (p.kind === 'trap' ? 0.7 : 0.8);
    if (ds * ds + dd * dd >= rad * rad || c.h > p.h + 0.5) continue;
    if (p.kind === 'soft') {
      /* knocked flying with the car's momentum; the car pays for the mass */
      const loss = clamp(p.mass * 3 / P.m, 0.005, 0.2);
      const v0 = c.speed;
      c.vx *= 1 - loss; c.vy *= 1 - loss; c.vz *= 1 - loss;
      const QC = I.qc, side = dd >= 0 ? 1 : -1;
      p.knocked = true; p.hitT = 0;
      p.vx = c.vx * 1.15 + QC.ux * (4 + 3 * M.rngNext(st)) + QC.rx * side * (2 + 3 * M.rngNext(st));
      p.vy = c.vy * 1.15 + QC.uy * (4 + 3 * M.rngNext(st)) + QC.ry * side * 2;
      p.vz = c.vz * 1.15 + QC.uz * (4 + 3 * M.rngNext(st)) + QC.rz * side * 2;
      p.wrx = (M.rngNext(st) - 0.5) * 16; p.wry = (M.rngNext(st) - 0.5) * 16; p.wrz = (M.rngNext(st) - 0.5) * 16;
      I.flying.push(i);
      emit(st, 'hit', { i, cat: p.cat, impulse: v0 * loss });
    } else if (p.kind === 'trap') {
      p.alive = false;
      const QC = I.qc, kx = (M.rngNext(st) - 0.5) * 6;
      c.vx += QC.ux * 9 + QC.rx * kx; c.vy += QC.uy * 9 + QC.ry * kx; c.vz += QC.uz * 9 + QC.rz * kx;
      const sp = (M.rngNext(st) - 0.5) * 4;
      c.wx += R[6] * sp + R[0] * 1.5; c.wy += R[7] * sp + R[1] * 1.5; c.wz += R[8] * sp + R[2] * 1.5;
      st.stats.hits++;
      emit(st, 'hit', { i, cat: p.cat, impulse: 9 });
      spinOut(st, 'mine', sp >= 0 ? 1 : -1, 0.7);
    } else if (p.kind === 'hard') {
      /* a post in the road: bounce off its round face, keep the glancing speed */
      const f = frameAt(T, p.s, tmpF);
      const dl = Math.sqrt(ds * ds + dd * dd) || 1;
      let nx = -(f.tx * ds + f.rx * dd) / dl, ny = -(f.ty * ds + f.ry * dd) / dl, nz = -(f.tz * ds + f.rz * dd) / dl;
      const nl = len3(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
      const ox = -nx * P.carR * 0.8, oy = -ny * P.carR * 0.8 + 0, oz = -nz * P.carR * 0.8;
      const v = contact(c, P, R, ox, oy, oz, nx, ny, nz, PROP_E, PROP_MU, 0.5);
      const pen = rad - dl;
      c.x += nx * pen * 0.9; c.y += ny * pen * 0.9; c.z += nz * pen * 0.9;
      if (v > 2 && I.propCool[i] <= 0) {
        I.propCool[i] = 0.4; st.stats.hits++; I.driftClean = false;
        emit(st, 'hit', { i, cat: p.cat, impulse: v });
        if (v > 14) spinOut(st, 'hit', dd >= 0 ? 1 : -1, 0.5);
      }
    }
  }
  /* knocked props fly, tumble and vanish */
  const g = finite(T.world.gravity) ? T.world.gravity : 9.8;
  for (let k = I.flying.length - 1; k >= 0; k--) {
    const p = props[I.flying[k]];
    p.hitT += DT; p.vy -= g * DT;
    p.x += p.vx * DT; p.y += p.vy * DT; p.z += p.vz * DT;
    p.rx += p.wrx * DT; p.ry += p.wry * DT; p.rz += p.wrz * DT;
    if (p.hitT > 2.5) { p.alive = false; I.flying.splice(k, 1); }
  }
}

/* monsters: think in actors[] order (the rng stream depends on it), then car contact with momentum.
   An actor touches the car only while actor.hot (when the AI sets it) and knocks with actor.knock or its kind's. */
function monsters(st) {
  const AI = VROOM.monsterAI;
  if (!AI || !st.actors.length) return;
  const c = st.car, P = st.params, I = st.int, ctx = I.ctx, KINDS = AI.KINDS || {};
  ctx.tick = st.tick;
  const n0 = st.actors.length;
  for (let k = 0; k < n0; k++) { const a = st.actors[k]; if (a.alive && a.state !== 'gone') AI.think(a, ctx); }
  if (c.respawnT > 0) return;
  for (let k = 0; k < st.actors.length; k++) {
    const a = st.actors[k];
    if (I.actorCool[k] > 0) { I.actorCool[k] -= DT; continue; }
    if (!a.alive || a.state === 'gone' || a.hot === false) continue;
    const K = KINDS[a.kind] || {};
    const ds = a.s - c.s, dd = a.d - c.d, rad = (a.r || K.r || 1) + P.carR * 0.8;
    if (ds * ds + dd * dd >= rad * rad) continue;
    const ah = a.h || 0, tall = K.h || 2;
    if (c.h > ah + tall + 0.5 || c.h + P.h < ah - 0.5) continue;
    knock(st, a, K, ds, dd);
    I.actorCool[k] = 0.9;
    st.stats.hits++; I.driftClean = false;
    emit(st, a.boss ? 'boss' : 'monster', { a: a.i, what: 'hit' });
    AI.onHit(a, ctx);
  }
}
/* the knock: impulse away from the monster (and along its lunge), lift, spin and a short stun, scaled by
   the mass ratio and the car's armour. Never more than LOST_MAX of lost control. */
function knock(st, a, K, ds, dd) {
  const c = st.car, P = st.params, I = st.int, R = I.R, T = st.track;
  const kn = a.knock || K.knock || { impulse: 8, lift: 3, spin: 3, stun: 0.4 };
  const am = a.mass || K.mass || 800;
  const ratio = clamp(2 * am / (am + P.m), 0.25, 1.6), sc = ratio * (1 - 0.55 * P.armor);
  const dl = Math.sqrt(ds * ds + dd * dd) || 1;
  let es = -ds / dl, ed = -dd / dl;
  const vl = Math.sqrt((a.vs || 0) * (a.vs || 0) + (a.vd || 0) * (a.vd || 0));
  if (vl > 0.5) { es += 0.6 * (a.vs || 0) / vl; ed += 0.6 * (a.vd || 0) / vl; }
  if (Math.abs(ed) < 0.2) ed = c.d >= a.d ? 0.4 : -0.4;
  const el = Math.sqrt(es * es + ed * ed) || 1; es /= el; ed /= el;
  const f = frameAt(T, c.s, tmpF), imp = (kn.impulse || 0) * sc, lift = (f.flags & TF.LOOP) ? 0 : (kn.lift || 0) * sc;
  /* a hit from behind shoves you on, a hit from the front costs speed */
  const vf = c.vx * f.tx + c.vy * f.ty + c.vz * f.tz, keep = es < 0 ? 1 - 0.12 * sc : 1;
  c.vx += f.tx * (vf * (keep - 1) + es * imp) + f.rx * ed * imp + f.ux * lift;
  c.vy += f.ty * (vf * (keep - 1) + es * imp) + f.ry * ed * imp + f.uy * lift;
  c.vz += f.tz * (vf * (keep - 1) + es * imp) + f.rz * ed * imp + f.uz * lift;
  const spin = (kn.spin || 0) * sc * (ed >= 0 ? -1 : 1), kick = clamp(spin, -1.5, 1.5);
  c.wx += R[3] * kick; c.wy += R[4] * kick; c.wz += R[5] * kick;
  c.stunT = Math.max(c.stunT, Math.min(LOST_MAX, (kn.stun || 0) * sc));
  if (Math.abs(spin) > 4.5) spinOut(st, 'monster', spin > 0 ? 1 : -1, 0.75 + 0.03 * Math.abs(spin));
  I.lastKnock = imp;
}

/* ============ 7. respawn crane, checkpoints, finish ============ */
function startRespawn(st, s, counts) {
  const c = st.car, I = st.int;
  if (c.drift) endDrift(st, false);
  if (c.boosting) { c.boosting = false; emit(st, 'boost', { on: 0 }); }
  c.spinT = 0; c.stunT = 0; c.air = false; I.tricksPending = 0; I.kickT = 0;
  c.respawnT = CRANE_T; I.craneS = s;
  if (counts) st.stats.respawns++;
  emit(st, 'respawn', { s });
  placeAt(st, s, 0, CRANE_H, 0);
}
function crane(st) {
  const c = st.car, I = st.int;
  c.respawnT -= DT;
  if (c.respawnT <= 0) { c.respawnT = 0; placeAt(st, I.craneS, 0, 0.02, RELEASE_V); I.lastSurf = -1; return; }
  const k = c.respawnT / CRANE_T;
  placeAt(st, I.craneS, 0, CRANE_H * smooth(k), 0);
}
/* the falls and the stuck: no fail state, the crane always brings the car back */
function rescue(st, inp) {
  const c = st.car, T = st.track, I = st.int, QC = I.qc, R = I.R;
  const noGround = I.nC === 0 && !I.hull;
  const i = Math.floor(clamp(c.s / STEP, 0, T.n - 1));
  let fell = false;
  if (noGround && c.h < -4) fell = true;
  if (noGround && c.y < T.py[i] - 28) fell = true;
  if (Math.abs(c.d) > QC.hw + 30) fell = true;
  if ((QC.flags & TF.LOOP) && ((noGround && Math.abs(c.h) < 12) || c.speed < 4)) { I.loopAirT += DT; if (I.loopAirT > (noGround ? 1.5 : 1)) fell = true; } else I.loopAirT = 0;
  if (fell) {
    I.fallsHere++;
    let s = I.cpS;
    if (I.fallsHere >= 3) {
      /* third time unlucky: the crane carries you over it */
      const from = Math.floor(Math.max(c.s, I.lastGroundS) / STEP) + 4;
      let j = from;
      while (j < T.n - 12 && (T.flags[j] & (TF.GAP | TF.LOOP))) j++;
      const sj = safeSample(T, j + 2, 1, 200);
      s = sj >= 0 ? sj * STEP : I.cpS;
      I.fallsHere = 0;
    }
    I.why = (QC.flags & TF.LOOP) ? 'loop' : (QC.flags & TF.GAP) ? 'gap' : 'edge';
    startRespawn(st, Math.min(s, T.finishS - 5), true);
    return;
  }
  /* stuck against something, or upside down */
  const up = R[3] * QC.nx + R[4] * QC.ny + R[5] * QC.nz;
  if (!noGround && up < 0.45) {
    I.flipT += DT;
    if (I.flipT > 0.35) {
      /* right itself: roll toward upright with a hop */
      let ax = R[4] * QC.nz - R[5] * QC.ny, ay = R[5] * QC.nx - R[3] * QC.nz, az = R[3] * QC.ny - R[4] * QC.nx;
      const al = len3(ax, ay, az);
      if (al < 0.05) { ax = R[6]; ay = R[7]; az = R[8]; } else { ax /= al; ay /= al; az /= al; }
      const wa = c.wx * ax + c.wy * ay + c.wz * az, dw = (4.5 - wa) * Math.min(1, 8 * DT);
      c.wx += ax * dw; c.wy += ay * dw; c.wz += az * dw;
      const vn = c.vx * QC.nx + c.vy * QC.ny + c.vz * QC.nz;
      if (vn < 2.5) { c.vx += QC.nx * (2.5 - vn) * 0.2; c.vy += QC.ny * (2.5 - vn) * 0.2; c.vz += QC.nz * (2.5 - vn) * 0.2; }
    }
    if (I.flipT > 3) { I.why = 'flip'; startRespawn(st, crawlS(st), true); return; }
  } else I.flipT = 0;
  if (!noGround && c.speed < 1.2 && (inp.throttle > 0 || inp.brake > 0) && !st.finished) {
    I.stuckT += DT;
    if (I.stuckT > 3) { I.why = 'stuck'; startRespawn(st, crawlS(st), true); return; }
  } else I.stuckT = 0;
  /* wedged: rocking against something without getting anywhere for 5 s */
  if (c.s > I.progS + 6 || st.finished || c.speed > 5) { I.progS = c.s; I.progT = 0; }
  else if ((I.progT += DT) > 5) { I.why = 'wedge'; startRespawn(st, crawlS(st), true); }
}
/* a safe spot just ahead of the car for a stuck rescue */
function crawlS(st) {
  const T = st.track, j = safeSample(T, Math.floor(st.car.s / STEP) + 8, 1, 120);
  return Math.min(j >= 0 ? j * STEP : st.int.cpS, T.finishS - 5);
}
function progress(st) {
  const c = st.car, T = st.track, I = st.int;
  if (c.respawnT > 0) return;
  while (I.cpI + 1 < T.checkpoints.length && c.s >= T.checkpoints[I.cpI + 1] && c.s < T.checkpoints[I.cpI + 1] + 60) {
    I.cpI++; I.cpS = T.checkpoints[I.cpI]; I.fallsHere = 0;
    emit(st, 'checkpoint', { i: I.cpI });
  }
  if (!st.finished && c.s >= T.finishS && c.s < T.finishS + 60 && Math.abs(c.d) < c.h + 40) {
    st.finished = true; st.finishT = st.t;
    emit(st, 'finish', { t: st.t });
    for (const a of st.actors) if (a.boss && !I.bossDone[a.i]) { I.bossDone[a.i] = 1; emit(st, 'boss', { a: a.i, what: 'defeat' }); }
    if (c.drift) endDrift(st, true);
  }
}

/* ============ the step ============ */
const Qz = (v, k) => Math.round(clamp(finite(+v) ? +v : 0, -1, 1) * k) / k;
function quantize(i = {}) { return { steer: Qz(i.steer, 64), throttle: Math.max(0, Qz(i.throttle, 16)), brake: Math.max(0, Qz(i.brake, 16)), boost: i.boost ? 1 : 0, drift: i.drift ? 1 : 0 }; }
function quantizeInto(i, o) {
  i = i || {};
  o.steer = Qz(i.steer, 64); o.throttle = Math.max(0, Qz(i.throttle, 16)); o.brake = Math.max(0, Qz(i.brake, 16)); o.boost = i.boost ? 1 : 0; o.drift = i.drift ? 1 : 0;
  return o;
}
/* a replay tick as one int: bits 0-7 steer + 64 (0..128), 8-12 throttle x16, 13-17 brake x16, 18 boost, 19 drift */
function packInput(i) { const q = quantize(i); return (q.steer * 64 + 64) | ((q.throttle * 16) << 8) | ((q.brake * 16) << 13) | (q.boost << 18) | (q.drift << 19); }
function unpackInput(v) { return { steer: ((v & 255) - 64) / 64, throttle: ((v >> 8) & 31) / 16, brake: ((v >> 13) & 31) / 16, boost: (v >> 18) & 1, drift: (v >> 19) & 1 }; }

function step(st, input) {
  const c = st.car, I = st.int;
  st.tick++; st.t += DT;
  const inp = quantizeInto(input, I.inp);
  if (st.finished) { inp.throttle = 0; inp.brake = c.speed > 1 ? 1 : 0; inp.boost = 0; inp.drift = 0; inp.steer = clamp(-c.d * 0.08, -0.5, 0.5); if (c.speed <= 1) inp.brake = 0; }
  if (c.respawnT > 0) { crane(st); monsters(st); return; }
  const lost = c.stunT > 0 || c.spinT > 0;
  if (lost) { inp.steer = 0; inp.throttle = 0; inp.brake = 0; inp.drift = 0; inp.boost = 0; }
  if (c.stunT > 0) c.stunT = Math.max(0, c.stunT - DT);
  if (c.spinT > 0) c.spinT = Math.max(0, c.spinT - DT);
  /* boost meter */
  const want = !!inp.boost && c.boost > 0.001;
  if (want !== c.boosting) { c.boosting = want; emit(st, 'boost', { on: want ? 1 : 0 }); }
  if (c.boosting) { c.boost = Math.max(0, c.boost - DT / st.params.boostDur); if (c.boost === 0) { c.boosting = false; emit(st, 'boost', { on: 0 }); } }
  physics(st, inp, lost);
  bookkeeping(st, inp, lost);
  interact(st);
  monsters(st);
  if (c.respawnT === 0) rescue(st, inp);
  progress(st);
}

/* ============ 8. autopilot, result ============ */
/* A deterministic bot (home-screen attract mode, the fairness suite, ?bot=1). It reads the track ahead:
   braking points from the curvature and the grip, a racing line that picks up stars and dodges hard props,
   mines and monsters, a lane at splits, boost on straights. skill 0..1 sets its margins and reach.
   It never touches st.rng: its little wobble comes from hash01 of the tick. */
function autopilot(st, skill = 1) {
  const c = st.car, T = st.track, P = st.params, I = st.int, out = { steer: 0, throttle: 1, brake: 0, boost: 0, drift: 0 };
  skill = clamp(+skill || 0, 0, 1);
  if (c.respawnT > 0 || st.finished) return out;
  const ap = I.ap || (I.ap = { lane: 0, rev: 0, stuck: 0, line: 0, hz: null, jumps: null });
  const v = Math.max(0, I.vfwd || 0), s = c.s;
  /* ---- speed plan: the slowest corner ahead we could still brake for ---- */
  const g = finite(T.world.gravity) ? T.world.gravity : 9.8;
  const mu = P.grip * g * (0.68 + 0.27 * skill), decel = Math.min(P.brakeA, mu * 1.1) * (0.55 + 0.35 * skill);
  const look = Math.min(260, v * v / (2 * decel) + 25);
  let cap = 1e9, capNear = 1e9;
  const i0 = Math.floor(s / STEP);
  let loopAhead = false, rampAhead = false;
  for (let k = 0; k < look; k += 2) {
    const j = i0 + k;
    if (j >= T.n - 1) break;
    const fl = T.flags[j];
    if (fl & TF.LOOP) { loopAhead = loopAhead || k < 80; continue; }
    if (fl & (TF.RAMP | TF.GAP)) { if (k < 90) rampAhead = true; continue; }
    const kap = Math.abs(T.curv[j]);
    if (kap < 0.002) continue;
    const bank = clamp(sgn(T.curv[j]) * -T.ry[j], -0.4, 0.8);
    const sg = surfP(T.surf[j]).grip;
    const vmax = Math.sqrt(Math.max(4, (mu * sg + g * bank) / kap));
    const reach = Math.sqrt(vmax * vmax + 2 * decel * sg * Math.max(0, k - 3));
    if (reach < cap) cap = reach;
    if (k < 40 && vmax < capNear) capNear = vmax;
  }
  if (loopAhead || rampAhead) cap = Math.max(cap, P.top * 1.3);
  /* jumps: brake in time for a launch that still lands short of the next loop, gap or bend */
  const jumps = ap.jumps || (ap.jumps = planJumps(T, g));
  let jumpNeed = 0, jumpMost = 1e9;
  for (let k = 0; k < jumps.length; k += 3) {
    const ds = jumps[k] - s;
    if (ds < -2 || ds > look + 60) continue;
    const most = jumps[k + 2] * (0.97 - 0.07 * (1 - skill));
    const reach = Math.sqrt(most * most + 2 * decel * Math.max(0, ds - 3));
    if (reach < cap) cap = reach;
    if (ds < 160 && !jumpNeed) { jumpNeed = jumps[k + 1]; jumpMost = most; }
  }
  let vt = Math.min(cap, P.top * 1.4);
  if (jumpNeed) vt = Math.max(vt, Math.min(jumpNeed * 1.12 + 2, jumpMost));
  /* ---- the line: centre, a split lane, a star, then dodge what is in the way ---- */
  const la = Math.min(T.length - 1, s + 6 + v * 0.45), ia = Math.floor(la / STEP);
  const hwA = T.hw[ia], midA = T.mid[ia];
  let line = 0;
  if (midA > 0.5) { if (!ap.lane) ap.lane = c.d >= 0 ? 1 : -1; line = ap.lane * (midA + hwA) / 2; } else if (T.mid[Math.min(T.n - 1, i0 + 40)] < 0.5) ap.lane = 0;
  if (skill > 0.25 && midA < 0.5) {
    const stars = T.spec.stars || [];
    let best = -1, bs = 1e9;
    for (let k = 0; k < stars.length; k++) {
      if (st.stars[k]) continue;
      const ds = stars[k].s - s;
      if (ds > 4 && ds < 45 + 20 * skill && ds < bs && (stars[k].h || 1) < 3.5) { bs = ds; best = k; }
    }
    if (best >= 0) line += ((stars[best].d || 0) - line) * clamp(skill * 1.1, 0, 1);
  }
  const reachA = 14 + 46 * skill, props = st.props, ord = T.propOrder;
  let lo = 0, hi = ord.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (props[ord[mid]].s < s - 2) lo = mid + 1; else hi = mid; }
  /* pulls first (pads, nitro), then every hazard in reach pushes the line clear: hazards win */
  for (let k = lo; k < ord.length; k++) {
    const p = props[ord[k]];
    if (p.s > s + reachA) break;
    if (!p.alive || p.knocked || p.s < s + 3) continue;
    const fast = p.kind === 'pad' && v > vt - 3;
    if ((p.kind === 'pad' || p.kind === 'pickup') && !fast && skill > 0.5 && Math.abs((p.d || 0) - line) < 4 && p.cat !== 'jumpPad') line += ((p.d || 0) - line) * 0.6;
  }
  const hz = ap.hz || (ap.hz = new Float64Array(64));
  let nh = 0;
  for (let k = lo; k < ord.length && nh < 30; k++) {
    const p = props[ord[k]];
    if (p.s > s + reachA) break;
    if (!p.alive || p.knocked) continue;
    const bad = p.kind === 'hard' || p.kind === 'trap' || (p.kind === 'patch' && p.cat !== 'water') || (p.kind === 'soft' && skill > 0.8 && p.cat === 'crate') ||
      (p.kind === 'pad' && p.cat !== 'jumpPad' && jumpNeed > 0 && v > vt - 3 && skill > 0.5);
    if (!bad) continue;
    const ext = p.kind === 'patch' ? p.len / 2 : p.r;
    if (p.s + ext < s - 1) continue;
    hz[nh * 2] = p.d || 0; hz[nh * 2 + 1] = (p.kind === 'patch' ? p.w : p.r) + P.w * 0.5 + 0.8; nh++;
  }
  if (skill > 0.35) {
    for (const a of st.actors) {
      if (!a.alive || a.state === 'gone' || nh >= 32) continue;
      const ds = a.s - s;
      if (ds < -2 || ds > 18 + 30 * skill) continue;
      hz[nh * 2] = a.d; hz[nh * 2 + 1] = (a.r || 1.5) + P.w * 0.5 + 1.2; nh++;
    }
  }
  if (nh) {
    /* the clear spot nearest the wanted line: try the line, then each hazard's two edges */
    const edgeH = Math.max(0.5, hwA - P.w * 0.5 - 0.6);
    if (!clearOf(hz, nh, line, edgeH)) {
      let best = line, bd = 1e9;
      for (let k = 0; k < nh; k++) {
        for (let sd = -1; sd <= 1; sd += 2) {
          const d = hz[k * 2] + sd * (hz[k * 2 + 1] + 0.05);
          if (clearOf(hz, nh, d, edgeH) && Math.abs(d - c.d) * 0.5 + Math.abs(d - line) < bd) { bd = Math.abs(d - c.d) * 0.5 + Math.abs(d - line); best = d; }
        }
      }
      line = best;
    }
  }
  const edge = Math.max(0.5, hwA - P.w * 0.5 - 0.6);
  line = clamp(line, -edge, edge);
  if (midA > 0.5) line = ap.lane > 0 ? clamp(line, midA + P.w * 0.5 + 0.5, edge) : clamp(line, -edge, -(midA + P.w * 0.5 + 0.5));
  ap.line += (line - ap.line) * (0.06 + 0.1 * skill);
  /* ---- steer: pure pursuit on a point on the line ahead ---- */
  const tgt = toWorld(T, la, ap.line, 0, I.tgt), R = I.R;
  const dx = tgt[0] - c.x, dy = tgt[1] - c.y, dz = tgt[2] - c.z;
  const lx = dx * R[0] + dy * R[1] + dz * R[2], lz = Math.max(1, dx * R[6] + dy * R[7] + dz * R[8]);
  const Ld2 = lx * lx + lz * lz;
  const wheel = 2 * P.wb * (-lx) / Ld2;   /* + right */
  const lock = P.steerMax / (1 + (v * v) / (STEER_V * STEER_V));
  const wob = (1 - skill) * 0.12 * (M.hash01(st.tick >> 5, 7) - 0.5);
  out.steer = clamp(wheel / lock + wob, -1, 1);
  if (I.nC === 0 && !I.hull) {
    /* airborne: strafe toward the line (inside the spin deadzone), feet off the pedals that flip */
    const f = frameAt(T, s, tmpF), vl = c.vx * f.rx + c.vy * f.ry + c.vz * f.rz;
    out.steer = clamp((ap.line - c.d) * 0.12 - vl * 0.25, -1, 1);
    out.brake = 0; out.throttle = 1;
    /* attract mode shows off: a back-flip when the hang time allows one, then hands off to land it */
    if (st.mode === 'attract' && c.air && !I.tricksPending) {
      const q = I.qc, vn = c.vx * q.ux + c.vy * q.uy + c.vz * q.uz, h = Math.max(0, c.h);
      const left = (vn + Math.sqrt(Math.max(0, vn * vn + 2 * g * h))) / g;
      /* wind it past half a turn, then let the spin and the auto-level carry it round onto the wheels */
      if ((left > 1.6 && I.rotP > -0.3) || (I.rotP <= -0.3 && I.rotP > -3.6 && left > 0.7)) { out.brake = 1; out.steer = 0; }
    }
    return out;
  }
  /* ---- pedals ---- */
  if (v > vt + 1.5) { out.throttle = 0; out.brake = clamp((v - vt) / 6, 0.3, 1); }
  else if (v > vt) out.throttle = 0.3;
  if (capNear < v - 4 && skill > 0.6) { out.throttle = 0; out.brake = Math.max(out.brake, 0.5); }
  /* boost on the straights, and into the jumps */
  const meter = skill >= 0.7 ? 0.05 : 0.6;
  if (I.nC > 0 && c.boost > meter && cap > v + 8 && Math.abs(out.steer) < 0.5 && (cap > P.top * 1.2 || rampAhead)) out.boost = 1;
  if (rampAhead && jumpNeed > 0 && v < jumpNeed * 1.1 && c.boost > 0.05 && skill > 0.3) out.boost = 1;
  if (rampAhead && v > vt - 2) out.boost = 0;
  /* unstick: pushing the gas and going nowhere for 0.6 s -> back off 1.2 s, wheel turned the other way */
  if (ap.rev > 0) {
    ap.rev -= DT;
    out.throttle = 0; out.brake = 1; out.boost = 0; out.steer = -out.steer;
    return out;
  }
  if (c.speed < 1 && st.t > 1.5 && I.nC > 0) ap.stuck += DT; else ap.stuck = 0;
  if (ap.stuck > 0.6) { ap.stuck = 0; ap.rev = 1.2; }
  return out;
}

/* is lateral position d clear of every hazard band (centre, half width pairs in hz) and inside the edges? */
function clearOf(hz, nh, d, edge) {
  if (d < -edge || d > edge) return false;
  for (let k = 0; k < nh; k++) if (Math.abs(d - hz[k * 2]) < hz[k * 2 + 1]) return false;
  return true;
}
/* every ramp lip: [lipS, need, most, ...]. need = the speed that clears the gap after it (0 if none),
   most = the fastest launch that still lands before the next loop, corkscrew or gap (1e9 if open road) */
function planJumps(T, g) {
  const out = [];
  const reach = (v, sl, cl, drop) => { const vy = v * sl, disc = vy * vy + 2 * g * drop; return disc < 0 ? 0 : v * cl * (vy + Math.sqrt(disc)) / g; };
  const solve = (sl, cl, drop, dist) => {
    let lo = 4, hi = 120;
    for (let it = 0; it < 24; it++) { const v = (lo + hi) / 2; if (reach(v, sl, cl, drop) >= dist) hi = v; else lo = v; }
    return hi;
  };
  for (let j = 1; j < T.n - 2; j++) {
    if (!(T.flags[j] & TF.RAMP) || (T.flags[j + 1] & TF.RAMP)) continue;
    let e = j + 1;
    while (e < T.n - 1 && (T.flags[e] & TF.GAP)) e++;
    const sl = T.ty[j], cl = Math.sqrt(Math.max(0.05, 1 - sl * sl)), drop = T.py[j] - T.py[e];
    const need = e > j + 1 ? solve(sl, cl, drop, (e - j) * STEP + 4) : 0;
    /* landing room: up to the next loop or gap, or where the road bends away from the launch line */
    const hx = T.tx[j], hz = T.tz[j], hl = Math.sqrt(hx * hx + hz * hz) || 1;
    let h = e + 1;
    while (h < T.n - 1 && !(T.flags[h] & (TF.LOOP | TF.GAP)) && h - j < 800) {
      const ox = T.px[h] - T.px[j], oz = T.pz[h] - T.pz[j];
      if (Math.abs(ox * hz - oz * hx) / hl > T.hw[h] * 0.5) break;
      h++;
    }
    const room = (h - j) * STEP - 14;
    const most = h >= T.n - 1 || h - j >= 800 ? 1e9 : Math.max(need * 1.05, solve(sl, cl, T.py[j] - T.py[Math.min(h, T.n - 1)], room));
    out.push(j * STEP, need, most);
  }
  return out;
}

function result(st) {
  const sp = st.track.spec, par = sp.par || { S: 0, A: 0, B: 0 }, t = st.finished ? st.finishT : st.t, total = (sp.stars || []).length;
  const tier = t <= par.S ? 'S' : t <= par.A ? 'A' : t <= par.B ? 'B' : 'C';
  const ratio = total ? st.starsGot / total : 1;
  return { time: t, stars: st.starsGot, starsTotal: total, rating: ratio >= 0.9 ? 3 : ratio >= 0.5 ? 2 : 1, tier, hits: st.stats.hits,
    airTime: st.stats.airTime, driftTime: st.stats.driftTime, tricks: st.stats.tricks, respawns: st.stats.respawns,
    clean: st.stats.hits === 0 && st.stats.respawns === 0 };
}

/* test and dev hook (not part of the contract): drop the car at (s, d) facing `yaw` radians off the track
   heading (+ right), rolling forward at v */
function teleport(st, s, d, v, yaw = 0) {
  const c = st.car;
  placeAt(st, s, d, 0, 0);
  if (yaw) {
    const hy = -yaw / 2, sy = M.dsin(hy), cy = M.dcos(hy);
    const f = frameAt(st.track, s, {}), ul = len3(f.ux, f.uy, f.uz);
    const ax = f.ux / ul * sy, ay = f.uy / ul * sy, az = f.uz / ul * sy;
    const qx = c.qx, qy = c.qy, qz = c.qz, qw = c.qw;
    c.qw = cy * qw - ax * qx - ay * qy - az * qz;
    c.qx = cy * qx + ax * qw + ay * qz - az * qy;
    c.qy = cy * qy - ax * qz + ay * qw + az * qx;
    c.qz = cy * qz + ax * qy - ay * qx + az * qw;
  }
  qmat(c, st.int.R);
  c.vx = st.int.R[6] * v; c.vy = st.int.R[7] * v; c.vz = st.int.R[8] * v; c.speed = Math.abs(v);
  st.int.vfwd = v;
}

VROOM.sim = { buildTrack, frameAt, toWorld, carParams, newRace, step, quantize, packInput, unpackInput, autopilot, result, teleport, SURF_P };
