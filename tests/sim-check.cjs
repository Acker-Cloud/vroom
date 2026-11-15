/* sim-check: the whole campaign driven headless by the autopilot, in Node. Owner: physics.
   - every level 1..120 and the parade finishes for a skill-1 and a skill-0.4 bot, inside 5 minutes
   - every car class finishes a spread of levels (stats from src/catalog.js)
   - nothing goes NaN or flies off to infinity, and the car stays near the road
   - determinism: the same level, seed and inputs hash to the same bits, run to run
   - the track ribbon is a sane frame everywhere (unit, orthogonal, 1 m apart outside gaps)
   Prints a time / respawn summary so content owners can see the spread. */
'use strict';
const { check, done, loadSim } = require('./lib.cjs');
const V = loadSim(), S = V.sim, C = V.contracts, CAT = V.catalog, HZ = C.SIM_HZ;
const CAP = HZ * 300;

const statsOf = body => ({ ...CAT.stats({ body, wheels: CAT.BODIES[body].cls === 'brute' ? 'monster' : 'normal', extras: {} }), cls: CAT.BODIES[body].cls });
function drive(n, body, skill, hashIt) {
  const spec = V.levels.level(n), tr = S.buildTrack(spec), st = S.newRace(tr, S.carParams(statsOf(body), {}), { seed: spec.seed, mode: 'race' });
  let h = 2166136261 >>> 0, bad = '', far = 0;
  const f = new Float64Array(1), u = new Uint32Array(f.buffer);
  const mix = x => { f[0] = x; h = Math.imul(h ^ u[0], 16777619) >>> 0; h = Math.imul(h ^ u[1], 16777619) >>> 0; };
  while (!st.finished && st.tick < CAP) {
    S.step(st, S.autopilot(st, skill));
    st.events.length = 0;
    if (st.tick % 30 === 0) {
      const c = st.car, vals = [c.x, c.y, c.z, c.qx, c.qy, c.qz, c.qw, c.vx, c.vy, c.vz, c.wx, c.wy, c.wz, c.s, c.d, c.h, c.boost, c.rpm];
      if (!bad && !vals.every(Number.isFinite)) bad = 'NaN at t ' + st.t.toFixed(1);
      if (!bad && c.speed > 200) bad = 'runaway speed ' + c.speed.toFixed(0);
      if (c.respawnT === 0 && st.int.nC > 0) far = Math.max(far, Math.abs(c.d) - tr.hw[Math.floor(c.s)]);
      for (const w of c.wheels) if (!bad && !(Number.isFinite(w.x + w.y + w.z + w.comp + w.spin))) bad = 'wheel NaN';
      if (hashIt) { mix(c.x); mix(c.y); mix(c.z); mix(c.qw); mix(c.vx); mix(st.rng); for (const a of st.actors) { mix(a.s); mix(a.d); } }
    }
  }
  return { n, st, tr, spec, r: S.result(st), bad, far, h };
}

/* ---- the ribbon ---- */
{
  const bad = [];
  for (let n = 1; n <= C.PARADE_LEVEL && bad.length < 6; n++) {
    const tr = S.buildTrack(V.levels.level(n));
    for (let i = 0; i < tr.n - 1; i++) {
      const t = [tr.tx[i], tr.ty[i], tr.tz[i]], uu = [tr.ux[i], tr.uy[i], tr.uz[i]], r = [tr.rx[i], tr.ry[i], tr.rz[i]];
      const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
      const cr = [t[1] * uu[2] - t[2] * uu[1], t[2] * uu[0] - t[0] * uu[2], t[0] * uu[1] - t[1] * uu[0]];
      const step = Math.hypot(tr.px[i + 1] - tr.px[i], tr.py[i + 1] - tr.py[i], tr.pz[i + 1] - tr.pz[i]);
      const gap = tr.flags[i] & C.TF.GAP;
      if (Math.abs(dot(t, t) - 1) > 1e-6 || Math.abs(dot(uu, uu) - 1) > 1e-6 || Math.abs(dot(t, uu)) > 1e-6 || Math.hypot(cr[0] - r[0], cr[1] - r[1], cr[2] - r[2]) > 1e-6
        || (!gap && (step < 0.95 || step > 1.25)) || !(tr.hw[i] > 1)) { bad.push(`${n}@${i}`); break; }
    }
    if (!(tr.finishS > 0 && tr.finishS < tr.length && tr.checkpoints.every(s => s < tr.finishS))) bad.push(n + ':finish');
  }
  check('every track ribbon is a sane frame (unit, square, r = t x u, ~1 m steps)', bad.length === 0, bad.join(' '));
}

/* ---- the campaign, two bots ---- */
const runs = {};
for (const skill of [1, 0.4]) {
  const rows = [];
  for (let n = 1; n <= C.PARADE_LEVEL; n++) rows.push(drive(n, 'monster', skill, false));
  runs[skill] = rows;
  const unfinished = rows.filter(x => !x.st.finished).map(x => x.n);
  const bad = rows.filter(x => x.bad).map(x => x.n + ':' + x.bad);
  const off = rows.filter(x => x.far > 6).map(x => x.n + ':' + x.far.toFixed(1));
  check(`skill ${skill} bot finishes every level and the parade inside 5 minutes`, unfinished.length === 0, unfinished.join(' '));
  check(`skill ${skill}: no NaN, no runaway speed`, bad.length === 0, bad.slice(0, 6).join(' '));
  check(`skill ${skill}: the car stays on or near the road (under 6 m past an edge)`, off.length === 0, off.slice(0, 8).join(' '));
  const t = rows.map(x => x.r.time).sort((a, b) => a - b), resp = rows.reduce((a, x) => a + x.r.respawns, 0);
  console.log(`      skill ${skill}: times ${t[0].toFixed(1)} .. median ${t[t.length >> 1].toFixed(1)} .. ${t[t.length - 1].toFixed(1)} s, ${resp} respawns in all, worst ${Math.max(...rows.map(x => x.r.respawns))} on one level`);
}
{
  const rows = runs[1].filter(x => x.n <= C.MAX_LEVEL), t = rows.map(x => x.r.time).sort((a, b) => a - b), med = t[t.length >> 1];
  check('race length: a good run is 45 to 120 s (median of the skill-1 bot)', med >= 45 && med <= 120, `median ${med.toFixed(1)} s, range ${t[0].toFixed(1)} .. ${t[t.length - 1].toFixed(1)}`);
  const slow = runs[0.4].filter(x => x.r.respawns > 3).map(x => `${x.n}:r${x.r.respawns}`);
  console.log('      skill 0.4 levels over 3 respawns (fairness owner): ' + (slow.join(' ') || 'none'));
}

/* ---- every class of car finishes a spread of levels ---- */
{
  const byCls = {};
  for (const id of Object.keys(CAT.BODIES)) { const cls = CAT.BODIES[id].cls; if (!byCls[cls]) byCls[cls] = id; }
  const bad = [];
  for (const cls in byCls) for (let n = 3; n <= C.MAX_LEVEL; n += 9) { const x = drive(n, byCls[cls], 0.7, false); if (!x.st.finished || x.bad) bad.push(`${byCls[cls]}@${n}${x.bad ? ':' + x.bad : ''}`); }
  check('every car class (' + Object.keys(byCls).join(' ') + ') finishes a spread of levels', bad.length === 0, bad.slice(0, 8).join(' '));
}

/* ---- determinism ---- */
{
  const a = drive(50, 'monster', 0.8, true), b = drive(50, 'monster', 0.8, true), c = drive(100, 'race', 1, true), d = drive(100, 'race', 1, true);
  check('determinism: identical bits run to run (levels 50 and 100)', a.h === b.h && a.st.tick === b.st.tick && c.h === d.h && c.st.tick === d.st.tick, `${a.h}/${b.h} ${c.h}/${d.h}`);
}
done();
