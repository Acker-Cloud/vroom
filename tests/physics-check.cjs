/* physics-check: proves the docs/OVERHAUL.md section 5 tuning table on the real sim, headless in Node.
   Owner: physics. Every number comes from driving src/sim.js on purpose-built test tracks (straights,
   skidpads, ramps, loops) with the catalog's own cars, so a stats change in src/catalog.js shows up here.
   Run: node tests/physics-check.cjs   (no browser) */
'use strict';
const { check, done, loadSim } = require('./lib.cjs');
const V = loadSim(), S = V.sim, C = V.contracts, CAT = V.catalog, DT = C.SIM_DT, HZ = C.SIM_HZ;

const statsOf = (body, wheels) => ({ ...CAT.stats({ body, wheels: wheels || (CAT.BODIES[body] && CAT.BODIES[body].cls === 'brute' ? 'monster' : 'normal'), extras: {} }), cls: CAT.BODIES[body] && CAT.BODIES[body].cls });
const params = (body, up = {}) => S.carParams(statsOf(body), up);
const BASE = 'monster';
/* a level spec around a piece list (world 1 unless said), no props or monsters */
const specOf = (pieces, o = {}) => ({ n: 0, world: o.world || 1, seed: o.seed || 7, kind: 'free', pieces, props: o.props || [], stars: o.stars || [], monsters: [], boss: null, par: { S: 0, A: 0, B: 0 } });
function race(pieces, P, o = {}) {
  const tr = S.buildTrack(specOf(pieces, o)), st = S.newRace(tr, P, { seed: 7, monsters: false });
  return { tr, st };
}
const ev = (st, type) => st.events.filter(e => e.type === type);
const g0 = 9.8;

/* ---------- top speed, boost ---------- */
function topSpeed(P, boost) {
  const { st } = race([{ type: 'straight', len: 4000, w: 9, surf: 'asphalt' }], P);
  let best = 0;
  for (let k = 0; k < HZ * 40; k++) { if (boost) st.car.boost = 1; S.step(st, { throttle: 1, boost: boost ? 1 : 0 }); st.events.length = 0; if (k > HZ * 25) best = Math.max(best, st.int.vfwd); }
  return best;
}
const tops = {};
for (const b of ['monster', 'race', 'bulldozer']) {
  const P = params(b), v = topSpeed(P, false);
  tops[b] = v;
  check(`top speed ${b} (${CAT.BODIES[b].cls}) reaches its stats.topSpeed`, Math.abs(v / P.top - 1) < 0.04, `${v.toFixed(1)} m/s vs ${P.top}`);
}
check('top speed table: brute ~40, racer ~50, tank ~34 m/s', Math.abs(tops.monster - 40) <= 4 && Math.abs(tops.race - 50) <= 5 && Math.abs(tops.bulldozer - 34) <= 3.5,
  `${tops.monster.toFixed(1)} ${tops.race.toFixed(1)} ${tops.bulldozer.toFixed(1)}`);
{
  const P = params(BASE), vb = topSpeed(P, true), r = vb / tops.monster;
  check('boost adds about 30 percent top speed', r > 1.25 && r < 1.36, `x${r.toFixed(3)} (${vb.toFixed(1)} m/s)`);
}

/* ---------- acceleration ---------- */
function zeroTo(P, v) {
  const { st } = race([{ type: 'straight', len: 1500, w: 9, surf: 'asphalt' }], P);
  for (let k = 0; k < HZ * 20; k++) { S.step(st, { throttle: 1 }); st.events.length = 0; if (st.int.vfwd >= v) return st.t; }
  return Infinity;
}
{
  const t0 = zeroTo(params(BASE), 30), t3 = zeroTo(params(BASE, { engine: 3 }), 30);
  check('0 to 30 m/s, base monster truck: 3.0 to 3.5 s', t0 >= 3.0 && t0 <= 3.5, t0.toFixed(2) + ' s');
  check('0 to 30 m/s with engine 3: about 2.4 s', t3 >= 2.1 && t3 <= 2.6, t3.toFixed(2) + ' s');
}

/* ---------- braking ---------- */
{
  const P = params(BASE), { st } = race([{ type: 'straight', len: 2000, w: 9, surf: 'asphalt' }], P);
  S.teleport(st, 50, 0, 40);
  let t = 0;
  for (let k = 0; k < HZ * 10 && st.int.vfwd > 0.3; k++) { S.step(st, { brake: 1 }); st.events.length = 0; t = st.t; }
  check('braking 40 to 0 m/s under 3.5 s', t < 3.5 && t > 2, t.toFixed(2) + ' s');
}

/* ---------- lateral grip: a wide skidpad, steady speed, the steering wound on slowly ---------- */
function skidpad(surf, v0, body = BASE) {
  const P = params(body), { st } = race([{ type: 'straight', len: 3000, w: 400, walls: 0, surf }], P);
  S.teleport(st, 1000, 0, v0);
  let best = 0, pvx = st.car.vx, pvz = st.car.vz;
  const win = [];
  for (let k = 0; k < HZ * 8; k++) {
    const c = st.car, sp = Math.sqrt(c.vx * c.vx + c.vz * c.vz);
    S.step(st, { steer: Math.min(1, k / (HZ * 6)), throttle: sp < v0 ? 0.7 : 0 });
    st.events.length = 0;
    const ax = (c.vx - pvx) / DT, az = (c.vz - pvz) / DT; pvx = c.vx; pvz = c.vz;
    win.push(Math.abs(ax * c.vz - az * c.vx) / Math.max(1, Math.sqrt(c.vx * c.vx + c.vz * c.vz)));
    if (win.length > 60) win.shift();
    if (k > 60 && c.respawnT === 0 && st.int.nC >= 3) best = Math.max(best, win.reduce((a, b) => a + b, 0) / win.length);
  }
  return best / g0;
}
{
  const a = skidpad('asphalt', 20), ice = skidpad('ice', 12), oil = skidpad('oil', 12), mud = skidpad('mud', 12);
  check('peak lateral grip on asphalt: 1.0 to 1.2 g', a >= 1.0 && a <= 1.2, a.toFixed(3) + ' g');
  check('ice about 0.15 g', Math.abs(ice - 0.15) <= 0.05, ice.toFixed(3) + ' g');
  check('oil about 0.3 g', Math.abs(oil - 0.3) <= 0.07, oil.toFixed(3) + ' g');
  check('mud about 0.6 g', Math.abs(mud - 0.6) <= 0.1, mud.toFixed(3) + ' g');
}

/* ---------- air ---------- */
function jump(pieces, v, o = {}) {
  const P = params(BASE), { tr, st } = race(pieces, P, o);
  S.teleport(st, o.at || 20, 0, v);
  let land = null, vBefore = 0, vAfter = 0, respawn = false;
  for (let k = 0; k < HZ * 30 && !land; k++) {
    if (o.boost) st.car.boost = 1;
    const vh = Math.sqrt(st.car.vx * st.car.vx + st.car.vz * st.car.vz);
    S.step(st, { throttle: o.coast ? 0 : 1, boost: o.boost ? 1 : 0, ...(o.input || {}) });
    for (const e of st.events) { if (e.type === 'land') { land = e; vBefore = vh; } if (e.type === 'respawn') respawn = true; }
    st.events.length = 0;
  }
  if (land) { for (let k = 0; k < HZ / 2; k++) { S.step(st, { throttle: 0 }); st.events.length = 0; } vAfter = Math.sqrt(st.car.vx * st.car.vx + st.car.vz * st.car.vz); }
  return { airT: land ? land.airT : 0, hard: land ? land.hard : 0, vBefore, vAfter, respawn, st, tr };
}
const KICKER = [{ type: 'straight', len: 200, surf: 'asphalt' }, { type: 'ramp', len: 24, rise: 3, lip: 0.34 }, { type: 'straight', len: 600 }];
{
  const j = jump(KICKER, 35, { at: 120 });
  check('ramp air, typical kicker at 35 m/s: 1 to 3 s', j.airT >= 1 && j.airT <= 3, j.airT.toFixed(2) + ' s');
  const mega = jump([{ type: 'straight', len: 300, surf: 'asphalt' }, { type: 'ramp', len: 40, rise: 8, lip: 0.5 }, { type: 'gap', len: 140, drop: 15 }, { type: 'straight', len: 400, w: 12 }], 45, { at: 200 });
  check('mega ramp: about 5 s of air', mega.airT >= 4 && mega.airT <= 6.5, mega.airT.toFixed(2) + ' s');
  const orbit = jump(KICKER, 35, { at: 120, world: 8 }), ratio = orbit.airT / j.airT, gr = 9.8 / V.levels.WORLDS[8].gravity;
  check('orbit world: about 2.5x the hang time', ratio >= 2.2 && ratio <= 3.2, `x${ratio.toFixed(2)} (gravity ratio ${gr.toFixed(2)})`);
  const land = jump([{ type: 'straight', len: 120, surf: 'asphalt' }, { type: 'gap', len: 76, drop: 44 }, { type: 'straight', len: 600, w: 12 }], 30, { at: 60, coast: true });
  check('a 3 s drop landed on the wheels keeps 90 percent of its speed', land.airT > 2.6 && land.vAfter >= 0.9 * land.vBefore && !land.respawn,
    `air ${land.airT.toFixed(2)} s, ${land.vBefore.toFixed(1)} -> ${land.vAfter.toFixed(1)} m/s, hard ${land.hard.toFixed(2)}`);
}

/* ---------- walls ---------- */
{
  const P = params(BASE), { st } = race([{ type: 'straight', len: 1500, w: 9, surf: 'asphalt' }], P);
  S.teleport(st, 60, 0, 35, 15 * Math.PI / 180);
  let before = 0, hit = -1;
  for (let k = 0; k < HZ * 3; k++) {
    const v = st.car.speed;
    S.step(st, { throttle: 0 });
    if (hit < 0 && ev(st, 'wall').length + ev(st, 'scrape').length) { hit = k; before = v; }
    st.events.length = 0;
    if (hit >= 0 && k - hit > HZ * 0.5) break;
  }
  const r = st.car.speed / (before || 1);
  check('a 15 degree wall glance keeps 85 percent of the speed', hit >= 0 && r >= 0.85, `${(r * 100).toFixed(1)} percent`);
  const { st: s2 } = race([{ type: 'straight', len: 1500, w: 9, surf: 'asphalt' }], P);
  S.teleport(s2, 60, 0, 30, 80 * Math.PI / 180);
  for (let k = 0; k < HZ * 1.5; k++) { S.step(s2, { throttle: 0 }); s2.events.length = 0; }
  check('a head-on wall hit bleeds the speed', s2.car.speed < 15, s2.car.speed.toFixed(1) + ' m/s');
}

/* ---------- monsters: every kind's full knock, on the lightest, least armoured car ----------
   The AI's think is shimmed to a no-op so the actor sits hot in the car's path: this measures the sim's
   contact and knock (the worst case for each kind), not the AI's timing. */
{
  const AI = V.monsterAI, KINDS = (AI && AI.KINDS) || {};
  const light = Object.keys(CAT.BODIES).sort((a, b) => CAT.BODIES[a].stats.mass - CAT.BODIES[b].stats.mass)[0];
  const P = params(light);
  let worst = 0, worstK = '', hits = 0, kinds = 0, minV = 1e9;
  V.monsterAI = { ...AI, think() {}, onHit(a) { a.state = 'gone'; } };
  for (const kind in KINDS) {
    const K = KINDS[kind];
    const { tr, st } = race([{ type: 'straight', len: 800, w: 8, surf: 'asphalt' }], P);
    S.teleport(st, 40, 0, 30);
    const a = { i: 0, kind, arche: K.arche, s: 52, d: 0, h: 0, x: 0, y: 0, z: 0, yaw: 0, vs: 0, vd: 0, vh: 0, state: 'lunge', stateT: 0, hp: K.hp || 1,
      r: K.r, mass: K.mass, phase: 0, alive: true, boss: K.arche === 'boss', hot: true, knock: K.knock };
    const pos = S.toWorld(tr, a.s, a.d, 0); a.x = pos[0]; a.y = pos[1]; a.z = pos[2];
    st.actors.push(a); kinds++;
    let lost = 0, hit = false;
    for (let k = 0; k < HZ * 3; k++) {
      S.step(st, { throttle: 1 });
      if (st.events.some(e => (e.type === 'monster' || e.type === 'boss') && e.what === 'hit')) hit = true;
      lost = Math.max(lost, st.car.stunT, st.car.spinT);
      if (hit) minV = Math.min(minV, st.car.speed);
      st.events.length = 0;
    }
    if (hit) hits++;
    if (lost > worst) { worst = lost; worstK = kind; }
  }
  V.monsterAI = AI;
  check('every monster kind connects with a car driving into it', kinds > 0 && hits === kinds, `${hits}/${kinds} on '${light}'`);
  check('a monster knock takes at most 1 s of control', worst <= 1.0001, `worst ${worst.toFixed(2)} s (${worstK})`);
  check('no monster knock stops the car dead', minV > 2, `slowest after a hit ${minV.toFixed(1)} m/s`);
}

/* ---------- drift and tricks ---------- */
{
  const P = params(BASE), { st } = race([{ type: 'straight', len: 120, surf: 'asphalt' }, { type: 'bend', len: 160, angle: 1.6, w: 12, surf: 'asphalt' }, { type: 'straight', len: 600 }], P);
  S.teleport(st, 90, 0, 30);
  let v0 = 0, vmin = 1e9, banked = null, drifting = false, spun = false;
  for (let k = 0; k < HZ * 9 && !banked; k++) {
    const s = st.car.s, inBend = s > 110 && s < 270;
    if (inBend && !v0) v0 = st.car.speed;
    const bot = S.autopilot(st, 1);
    S.step(st, { throttle: 1, steer: inBend && st.car.drift === 0 ? 0.8 : bot.steer, drift: inBend ? 1 : 0 });
    for (const e of st.events) { if (e.type === 'driftBank') banked = e; if (e.type === 'drift' && e.on) drifting = true; if (e.type === 'spin') spun = true; }
    if (inBend) vmin = Math.min(vmin, st.car.speed);
    st.events.length = 0;
  }
  check('a held drift through a bend (steered on the line) banks boost on exit', drifting && banked && banked.bonus > 0 && !spun, banked ? `t ${banked.t.toFixed(2)} s, +${banked.bonus.toFixed(2)}` : 'no driftBank');
  check('a drift carries its speed (at least 80 percent)', vmin >= 0.8 * v0, `${v0.toFixed(1)} -> min ${vmin.toFixed(1)} m/s`);
}
{
  const pieces = [{ type: 'straight', len: 300, surf: 'asphalt' }, { type: 'ramp', len: 40, rise: 9, lip: 0.6 }, { type: 'gap', len: 140, drop: 20 }, { type: 'straight', len: 400, w: 12 }];
  const P = params(BASE), { st } = race(pieces, P);
  S.teleport(st, 200, 0, 46);
  st.car.boost = 0;
  let tricks = 0, landed = false, upAtLand = 0, b0 = 0;
  for (let k = 0; k < HZ * 12 && !landed; k++) {
    const air = st.car.air;
    S.step(st, { throttle: 1, brake: air && st.car.airT > 0.3 && !tricks ? 1 : 0 });
    for (const e of st.events) { if (e.type === 'trick') tricks++; if (e.type === 'land') { landed = true; b0 = st.car.boost; const R = st.int.R; upAtLand = R[4]; } }
    st.events.length = 0;
  }
  check('a back-flip in the air counts as a trick and a clean landing banks boost', tricks >= 1 && landed && b0 > 0, `tricks ${tricks}, boost ${b0.toFixed(2)}, up ${upAtLand.toFixed(2)}`);
}

/* the home screen's attract bot shows off back-flips and lands most of them on its wheels */
{
  const P = params(BASE);
  let tricks = 0, clean = 0, fin = 0, runs = 0;
  for (let n = 1; n <= C.MAX_LEVEL; n += 13) {
    const spec = V.levels.level(n), st = S.newRace(S.buildTrack(spec), P, { seed: spec.seed, mode: 'attract' });
    runs++;
    while (!st.finished && st.tick < HZ * 300) { S.step(st, S.autopilot(st, 1)); tricks += ev(st, 'trick').length; st.events.length = 0; }
    fin += st.finished ? 1 : 0; clean += st.stats.tricks;
  }
  check('attract mode: the bot flips on big jumps and lands most of them clean', fin === runs && tricks >= runs && clean >= 0.7 * tricks, `${clean}/${tricks} clean over ${runs} levels`);
}

/* ---------- every piece type drives: loops, corkscrews, halfpipes, splits, rumble, banked ---------- */
{
  const P = params(BASE);
  const run = (pieces, v, ticks = HZ * 25) => {
    const { tr, st } = race(pieces, P);
    S.teleport(st, 30, 0, v);
    let resp = 0, maxOut = 0;
    while (!st.finished && st.tick < ticks) {
      S.step(st, S.autopilot(st, 1));
      resp += ev(st, 'respawn').length;
      const i = Math.floor(st.car.s), fl = tr.flags[i];
      if ((fl & C.TF.WALL_L) && (fl & C.TF.WALL_R) && !st.int.air) maxOut = Math.max(maxOut, Math.abs(st.car.d) - tr.hw[i]);
      st.events.length = 0;
    }
    return { finished: st.finished, resp, maxOut, t: st.t };
  };
  const lead = [{ type: 'straight', len: 120, surf: 'asphalt' }];
  const cases = {
    loop: [...lead, { type: 'loop', radius: 12 }, { type: 'straight', len: 200 }],
    corkscrew: [...lead, { type: 'corkscrew', len: 140, turns: 1 }, { type: 'straight', len: 200 }],
    'corkscrew (left)': [...lead, { type: 'corkscrew', len: 120, turns: -1 }, { type: 'straight', len: 200 }],
    halfpipe: [...lead, { type: 'halfpipe', len: 160, wallH: 4 }, { type: 'straight', len: 200 }],
    split: [...lead, { type: 'split', len: 200, sep: 22, w: 7 }, { type: 'straight', len: 200 }],
    rumble: [...lead, { type: 'rumble', len: 120, amp: 0.15, wave: 3 }, { type: 'straight', len: 200 }],
    'banked hairpin': [...lead, { type: 'banked', len: 160, angle: 3, bank: 0.4, w: 9 }, { type: 'straight', len: 200 }],
    'hill and crest': [...lead, { type: 'hill', len: 120, rise: 18 }, { type: 'crest', len: 60, h: 4 }, { type: 'hill', len: 120, rise: -18 }, { type: 'straight', len: 200 }],
    'ramp and gap': [...lead, { type: 'ramp', len: 22, rise: 3, lip: 0.3 }, { type: 'gap', len: 18, drop: 2 }, { type: 'straight', len: 200 }],
  };
  const bad = [];
  for (const k in cases) { const r = run(cases[k], 30); if (!r.finished || r.resp || r.maxOut > 1) bad.push(`${k}: fin ${r.finished} resp ${r.resp} out ${r.maxOut.toFixed(2)}`); }
  check('every piece type drives clean at speed (no respawn, walls hold)', bad.length === 0, bad.join('; ') || Object.keys(cases).length + ' cases');
  const slowLoop = run([...lead, { type: 'loop', radius: 14 }, { type: 'straight', len: 200 }], 0, HZ * 60);
  check('no fail state: a crawl into a loop is rescued and the race still finishes', slowLoop.finished, `t ${slowLoop.t.toFixed(1)} s, respawns ${slowLoop.resp}`);
}
/* a gap far too long for the car: the crane carries you over by the third fall */
{
  const P = params(BASE), { st } = race([{ type: 'straight', len: 120, surf: 'asphalt' }, { type: 'gap', len: 220, drop: 0 }, { type: 'straight', len: 200 }], P);
  let resp = 0;
  while (!st.finished && st.tick < HZ * 120) { S.step(st, { throttle: 1 }); resp += ev(st, 'respawn').length; st.events.length = 0; }
  check('an impossible gap: the crane carries the car over, the race finishes', st.finished && resp <= 3, `finished ${st.finished}, respawns ${resp}`);
}

/* ---------- determinism and replays ---------- */
function hashRun(n, inputs) {
  const spec = V.levels.level(n), tr = S.buildTrack(spec), st = S.newRace(tr, params(BASE), { seed: spec.seed, mode: 'race' });
  let h = 2166136261 >>> 0;
  const f = new Float64Array(1), u = new Uint32Array(f.buffer);
  const mix = x => { f[0] = x; h = Math.imul(h ^ u[0], 16777619) >>> 0; h = Math.imul(h ^ u[1], 16777619) >>> 0; };
  const rec = [];
  let k = 0;
  while (!st.finished && st.tick < HZ * 400) {
    const inp = inputs ? S.unpackInput(inputs[k++]) : S.autopilot(st, 0.8);
    rec.push(S.packInput(inp));
    S.step(st, inp);
    const c = st.car;
    mix(c.x); mix(c.y); mix(c.z); mix(c.qx); mix(c.qw); mix(c.vx); mix(c.boost); mix(st.rng);
    for (const a of st.actors) { mix(a.s); mix(a.d); }
    st.events.length = 0;
  }
  return { h, rec, tick: st.tick, finished: st.finished };
}
{
  const a = hashRun(37), b = hashRun(37), r = hashRun(37, a.rec);
  check('determinism: the same level, seed and inputs give identical bits', a.h === b.h && a.tick === b.tick, `${a.h} ${b.h}`);
  check('a replay of the packed inputs reproduces the run bit for bit (ghosts)', r.h === a.h && r.tick === a.tick && r.finished, `${r.h} ${a.h}`);
}

/* ---------- the sim region source rules, for this file in particular ---------- */
{
  const fs = require('fs'), path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'sim.js'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const banned = [/\bMath\.(random|sin|cos|tan|asin|acos|atan|atan2|exp|expm1|pow|hypot|log|log2|log10|log1p|cbrt|sinh|cosh|tanh)\b/, /\*\*/, /\bDate\b/, /\bperformance\b/, /\bwindow\b/, /\bdocument\b/, /\bTHREE\b/, new RegExp(String.fromCharCode(0x2014))];
  const hits = banned.filter(re => re.test(src)).map(String);
  check('src/sim.js: only dmath maths, no clocks, DOM, THREE or em dashes', hits.length === 0, hits.join(' '));
}
done();
