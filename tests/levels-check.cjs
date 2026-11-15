/* levels-check: the 12 worlds and 121 level specs, in Node. Owner: worlds.
   Shape (contracts PIECES / PROP_CAT / SURF only, every number finite), cross-module ids (monster kinds exist),
   determinism (a second load builds the same bits), escalation (harder, not longer, after world 3) and the
   placement rules src/levels.js promises: nothing hard on jumps or loops, a clear lane past every obstacle,
   monsters beside the road, stars on it. */
'use strict';
const { check, done, loadSim } = require('./lib.cjs');
const V = loadSim(), C = V.contracts, L = V.levels, S = V.sim;
const N = C.PARADE_LEVEL, specs = [];
for (let n = 1; n <= N; n++) specs.push(L.level(n));

/* ---- worlds ---- */
const keys = new Set(), worldBad = [];
for (let w = 1; w <= C.WORLD_COUNT; w++) {
  const W = L.WORLDS[w];
  if (!W || W.id !== w || !W.key || keys.has(W.key)) { worldBad.push(w + ':id/key'); continue; }
  keys.add(W.key);
  if (!(W.gravity > 0 && W.gravity <= 12) || !(W.airDrag >= 0) || C.SURF_CODE[W.surf] === undefined) worldBad.push(w + ':physics');
  if (!Array.isArray(W.monsters) || W.monsters.length !== 2 || !W.boss) worldBad.push(w + ':roster');
}
check('WORLDS 1..12: unique keys, sane gravity and drag, a SURF key, two creatures and a boss', worldBad.length === 0, worldBad.join(' '));
const kinds = V.monsterAI && V.monsterAI.KINDS || {}, missing = [];
for (let w = 1; w <= C.WORLD_COUNT; w++) for (const k of [...L.WORLDS[w].monsters, L.WORLDS[w].boss]) if (!kinds[k]) missing.push(k);
check('every creature and boss kind exists in monsterAI.KINDS', missing.length === 0, missing.join(' '));
check('orbit floats (low gravity) and the abyss drags', L.WORLDS[8].gravity < 5 && L.WORLDS[11].airDrag > 0.1);

/* ---- shape ---- */
const fin = x => typeof x === 'number' && Number.isFinite(x);
const shape = [];
for (const sp of specs) {
  const n = sp.n, W = L.WORLDS[sp.world], tag = m => shape.push(n + ':' + m);
  if (sp.world !== (n === N ? 12 : C.worldOf(n))) tag('world');
  if (sp.kind !== (n === N ? 'parade' : C.isFinale(n) ? 'boss' : 'race')) tag('kind');
  if (!(sp.seed > 0)) tag('seed');
  for (const p of sp.pieces) {
    const P = C.PIECES[p.type];
    if (!P) { tag('piece ' + p.type); continue; }
    if (p.type === 'loop' ? !(p.radius > 5) : !(Number.isInteger(p.len) && p.len > 0)) tag('len ' + p.type);
    for (const a of P.args) if (p[a] !== undefined && !fin(p[a])) tag('arg ' + p.type + '.' + a);
    if (p.w !== undefined && !(p.w >= 4 && p.w <= 14)) tag('w ' + p.w);
    if (p.surf !== undefined && C.SURF_CODE[p.surf] === undefined) tag('surf ' + p.surf);
  }
  for (const q of sp.props) {
    if (!C.PROP_CAT[q.cat]) tag('cat ' + q.cat);
    if (!q.look || !q.look.startsWith(W.key + '.')) tag('look ' + q.look);
    if (!fin(q.s) || !fin(q.d)) tag('prop pos');
  }
  for (const s of sp.stars) if (!fin(s.s) || !fin(s.d) || !fin(s.h)) tag('star pos');
  for (const m of sp.monsters) if (!W.monsters.includes(m.kind) || !fin(m.s) || !fin(m.d)) tag('monster ' + m.kind);
  if (C.isFinale(n) !== !!sp.boss || (sp.boss && sp.boss.kind !== W.boss)) tag('boss');
  if (!(sp.par.S > 0 && sp.par.S < sp.par.A && sp.par.A < sp.par.B)) tag('par');
}
check('121 specs: contracts vocabulary only, every number finite, looks in their world, bosses on every tenth', shape.length === 0, shape.slice(0, 12).join(' '));

/* ---- determinism: a fresh load builds the same specs ---- */
const V2 = loadSim(), diff = [];
for (let n = 1; n <= N; n++) if (JSON.stringify(V2.levels.level(n)) !== JSON.stringify(specs[n - 1])) diff.push(n);
check('level(n) is deterministic across loads', diff.length === 0, diff.join(' '));
const f1 = JSON.stringify(L.free(7, 3)), f2 = JSON.stringify(V2.levels.free(7, 3));
check('free(seed, k) is deterministic and builds a track', f1 === f2 && S.buildTrack(L.free(7, 3)).n > 100);

/* ---- length and escalation ---- */
const lenOf = sp => sp.pieces.reduce((a, p) => a + (p.type === 'loop' ? Math.round(2 * Math.PI * p.radius) : p.len), 0);
const avg = (w, f) => { let a = 0; for (let k = 1; k <= 10; k++) a += f(specs[(w - 1) * 10 + k - 1]); return a / 10; };
const parA = specs.map(s => s.par.A), parBad = specs.filter(s => s.par.A < 40 || s.par.A > 125).map(s => s.n + ':' + s.par.A);
check('par A is a 40 to 125 s race on every level', parBad.length === 0, parBad.join(' '));
check('courses grow through world 3, then hold', avg(1, lenOf) < avg(2, lenOf) && avg(2, lenOf) < avg(3, lenOf) && avg(12, lenOf) < avg(3, lenOf) * 1.25,
  [1, 2, 3, 6, 12].map(w => w + ':' + Math.round(avg(w, lenOf))).join(' '));
const hazards = sp => sp.props.filter(q => ['hard', 'trap', 'patch'].includes(C.PROP_CAT[q.cat].kind)).length / (lenOf(sp) / 1000);
const tricky = sp => sp.pieces.filter(p => ['loop', 'corkscrew', 'halfpipe', 'gap', 'split', 'banked'].includes(p.type)).length;
const width = sp => sp.pieces.reduce((a, p) => a + (p.w || 7), 0) / sp.pieces.length;
check('later worlds are harder: more hazards per km, more tricky pieces, narrower roads',
  avg(1, hazards) < avg(9, hazards) && avg(1, tricky) < avg(8, tricky) && avg(1, width) > avg(12, width),
  `hazards/km ${avg(1, hazards).toFixed(1)} < ${avg(9, hazards).toFixed(1)}, tricky ${avg(1, tricky)} < ${avg(8, tricky)}, width ${avg(1, width).toFixed(1)} > ${avg(12, width).toFixed(1)}`);
const monsters = w => avg(w, sp => sp.monsters.length);
const early = w => (specs[(w - 1) * 10].monsters.length + specs[(w - 1) * 10 + 1].monsters.length) / 2, late = w => (specs[(w - 1) * 10 + 7].monsters.length + specs[(w - 1) * 10 + 8].monsters.length) / 2;
const flat = []; for (let w = 1; w <= 12; w++) if (!(late(w) > early(w))) flat.push(w);
check('every level has a creature, and each world has more of them by its end', specs.every(s => s.monsters.length > 0 || s.kind === 'parade') && flat.length === 0 && monsters(1) < monsters(12), flat.join(' '));
const features = { 11: sp => sp.pieces.filter(p => p.deco === 'tunnel').length > 5, 8: sp => sp.pieces.filter(p => p.type === 'gap').length >= 3, 6: sp => sp.pieces.filter(p => p.type === 'crest').length >= 2 };
const sig = Object.entries(features).filter(([w, f]) => avg(+w, sp => f(sp) ? 1 : 0) < 0.6).map(([w]) => w);
check('worlds keep their character (abyss tube, orbit jumps, scorch dunes)', sig.length === 0, sig.join(' '));
const starBad = specs.filter(s => s.stars.length < 20 || s.stars.length > 90).map(s => s.n + ':' + s.stars.length);
check('20 to 90 stars per level', starBad.length === 0, starBad.join(' '));

/* ---- placement on the built track ---- */
const TF = C.TF, place = [], lane = [], beside = [], onRoad = [];
for (const sp of specs) {
  const T = S.buildTrack(sp), at = s => Math.max(0, Math.min(T.n - 1, Math.round(s / T.step)));
  for (const q of sp.props) {
    const kind = C.PROP_CAT[q.cat].kind;
    if (kind !== 'hard' && kind !== 'patch' && kind !== 'trap') continue;
    for (let s = q.s - 4; s <= q.s + 4; s++) if (T.flags[at(s)] & (TF.GAP | TF.RAMP | TF.LOOP)) { place.push(sp.n + '@' + q.s); break; }
  }
  /* the hard props near any s may block at most the road minus a 4.5 m lane */
  const hard = sp.props.filter(q => ['hard', 'trap'].includes(C.PROP_CAT[q.cat].kind));
  for (const q of hard) {
    const hw = T.hw[at(q.s)], near = hard.filter(o => Math.abs(o.s - q.s) < 3);
    const iv = near.map(o => { const r = o.r || C.PROP_CAT[o.cat].r || 1; return [o.d - r, o.d + r]; }).sort((a, b) => a[0] - b[0]);
    let x = -hw, best = 0;
    for (const [a, b] of iv) { best = Math.max(best, a - x); x = Math.max(x, b); }
    best = Math.max(best, hw - x);
    if (best < 4.5) lane.push(sp.n + '@' + q.s);
  }
  for (const m of sp.monsters) if (Math.abs(m.d) <= T.hw[at(m.s)] || (T.flags[at(m.s)] & TF.GAP)) beside.push(sp.n + '@' + m.s);
  for (const s of sp.stars) if (Math.abs(s.d) > T.hw[at(s.s)] + 0.01) onRoad.push(sp.n + '@' + s.s);
}
check('nothing hard, slippery or explosive within 4 m of a ramp, gap, loop or corkscrew', place.length === 0, place.slice(0, 12).join(' '));
check('a clear lane of 4.5 m or more past every hard prop', lane.length === 0, lane.slice(0, 12).join(' '));
check('monsters wait beside the road, never in a jump', beside.length === 0, beside.slice(0, 12).join(' '));
check('every star is over the road', onRoad.length === 0, onRoad.slice(0, 12).join(' '));
done();
