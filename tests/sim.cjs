/* sim: the deterministic region in Node, straight from src/. Owner: integrator (physics adds its own
   physics-check.cjs; this file guards the contract every port relies on).
   - purity: no DOM, no THREE, no clocks, no Math.random, no engine-approximated maths (see src/dmath.js)
   - every level 1..120 (and the parade) builds a track, and the autopilot finishes it
   - determinism: the same level, seed and inputs give the same bits, twice */
'use strict';
const { check, done, loadSim } = require('./lib.cjs');
const fs = require('fs'), path = require('path');
const { ORDER, ROOT } = require('../scripts/build.cjs');

/* dmath.js is exempt: its fdlibm code falls back to Math.sin / Math.cos past 800 000 radians, by design */
const src = ORDER.filter(m => m.sim && m.f !== 'src/dmath.js').map(m => fs.readFileSync(path.join(ROOT, m.f), 'utf8')).join('\n').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const banned = [/\bMath\.(random|sin|cos|tan|asin|acos|atan|atan2|exp|expm1|pow|hypot|log|log2|log10|log1p|cbrt|sinh|cosh|tanh)\b/, /\*\*/, /\bDate\b/, /\bperformance\b/,
  /\bwindow\b/, /\bdocument\b/, /\bTHREE\b/, /\blocalStorage\b/, /\bnavigator\b/, /\brequestAnimationFrame\b/, /\bsetTimeout\b/, /\bsetInterval\b/];
const hits = banned.filter(re => re.test(src)).map(String);
check('sim region is pure (no DOM, THREE, clocks, random or approximated maths)', hits.length === 0, hits.join(' '));

const V = loadSim(), C = V.contracts, S = V.sim;
const api = ['sim', 'levels', 'catalog', 'monsterAI'].flatMap(m => C.MODULE_API[m].filter(n => !V[m] || V[m][n] === undefined).map(n => m + '.' + n));
check('sim-region modules publish their contract API', api.length === 0, api.join(' '));

function run(n, ticksMax = C.SIM_HZ * 600) {
  const spec = V.levels.level(n), track = S.buildTrack(spec);
  const st = S.newRace(track, S.carParams(V.catalog.stats({ body: 'monster', wheels: 'monster', extras: {} }), {}), { seed: spec.seed, mode: 'race' });
  let h = 2166136261 >>> 0;
  const mix = x => { const f = new Float64Array([x]), u = new Uint32Array(f.buffer); h = Math.imul(h ^ u[0], 16777619) >>> 0; h = Math.imul(h ^ u[1], 16777619) >>> 0; };
  while (!st.finished && st.tick < ticksMax) {
    S.step(st, S.autopilot(st, 1));
    if (st.tick % 60 === 0) { const c = st.car; mix(c.x); mix(c.y); mix(c.z); mix(c.speed); for (const a of st.actors) { mix(a.s); mix(a.d); } }
    st.events.length = 0;
  }
  return { st, track, h };
}
const bad = [], slow = [];
for (let n = 1; n <= C.PARADE_LEVEL; n++) {
  let r;
  try { r = run(n); } catch (e) { bad.push(n + ':' + e.message); continue; }
  if (!r.st.finished) bad.push(n + ':unfinished');
  if (r.track.n < 2 || !(r.track.length > 0)) bad.push(n + ':empty track');
  if (r.st.finished && r.st.finishT > 300) slow.push(n);
}
check('every level builds and the autopilot finishes it', bad.length === 0, bad.slice(0, 12).join(' '));
check('no level takes the autopilot over 5 minutes', slow.length === 0, slow.join(' '));
const a = run(10), b = run(10);
check('determinism: the same race twice gives the same bits', a.h === b.h && a.st.tick === b.st.tick, a.h + ' ' + b.h);
const q = S.quantize({ steer: 0.3333, throttle: 0.77, brake: 0, boost: 1, drift: 0 });
check('inputs round-trip through packInput / unpackInput', JSON.stringify(S.unpackInput(S.packInput(q))) === JSON.stringify(q), JSON.stringify(q));
done();
