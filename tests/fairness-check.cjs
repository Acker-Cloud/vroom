/* fairness-check: every level is fair. Owner: worlds. Runs in Node on the sim region (tests/lib.cjs loadSim).
   For every level 1..120 and the parade, with the default build (the starter monster truck, no upgrades):
     - the autopilot at skill 0.4 finishes in under 2 x par (par = spec.par.B, the slowest medal) with at most 3 respawns
     - the autopilot at skill 1 reaches par A
   docs/OVERHAUL.md section 5: if a level fails, fix the content in src/levels.js, never these thresholds.
   Flags: --levels 1-20,55   --report (one line per level: times against par, respawns, stars)   --jobs N (default: cores) */
'use strict';
const os = require('os');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');

const SKILL_LO = 0.4, SKILL_HI = 1, MAX_RESPAWNS = 3, SLACK = 2;

function runLevel(V, n, skill) {
  const C = V.contracts, S = V.sim, spec = V.levels.level(n), track = S.buildTrack(spec);
  const st = S.newRace(track, S.carParams(V.catalog.stats({ body: 'monster', wheels: 'monster', extras: {} }), {}), { seed: spec.seed, mode: 'race' });
  const cap = Math.ceil(C.SIM_HZ * Math.max(240, spec.par.B * SLACK * 1.5));
  while (!st.finished && st.tick < cap) { S.step(st, S.autopilot(st, skill)); st.events.length = 0; }
  const r = S.result(st);
  return { n, skill, finished: st.finished, t: st.finished ? st.finishT : Infinity, respawns: r.respawns, stars: r.stars, total: r.starsTotal, hits: r.hits, par: spec.par };
}

if (!isMainThread) {
  const { loadSim } = require('./lib.cjs');
  const V = loadSim();
  for (const n of workerData.levels) parentPort.postMessage([runLevel(V, n, SKILL_LO), runLevel(V, n, SKILL_HI)]);
  parentPort.postMessage(null);
} else {
  const { check, done, loadSim } = require('./lib.cjs');
  const args = process.argv.slice(2), val = f => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };
  const C = loadSim().contracts;
  let levels = [];
  if (val('--levels')) for (const part of val('--levels').split(',')) { const [a, b] = part.split('-').map(Number); for (let n = a; n <= (b || a); n++) levels.push(n); }
  else for (let n = 1; n <= C.PARADE_LEVEL; n++) levels.push(n);
  const jobs = Math.max(1, Math.min(+val('--jobs') || os.cpus().length, levels.length)), report = args.includes('--report');
  const buckets = Array.from({ length: jobs }, () => []);
  levels.forEach((n, i) => buckets[i % jobs].push(n));
  const rows = [];
  let live = jobs;
  for (const b of buckets) {
    const w = new Worker(__filename, { workerData: { levels: b } });
    w.on('message', m => { if (m) rows.push(m); else if (--live === 0) finish(); });
    w.on('error', e => { console.error(e); process.exit(2); });
  }
  function finish() {
    rows.sort((a, b) => a[0].n - b[0].n);
    const slow = [], respawny = [], noA = [];
    for (const [lo, hi] of rows) {
      const p = lo.par;
      if (report) console.log(`L${String(lo.n).padStart(3)}  par S ${p.S.toFixed(1)} A ${p.A.toFixed(1)} B ${p.B.toFixed(1)}   skill1 ${hi.t.toFixed(1)} (${(hi.t / p.A).toFixed(2)}A) r${hi.respawns}   skill.4 ${lo.t.toFixed(1)} (${(lo.t / p.B).toFixed(2)}B) r${lo.respawns}   stars ${hi.stars}/${hi.total}`);
      if (!lo.finished || lo.t > SLACK * p.B) slow.push(`${lo.n}:${lo.finished ? lo.t.toFixed(1) : 'dnf'}>${(SLACK * p.B).toFixed(1)}`);
      if (lo.respawns > MAX_RESPAWNS) respawny.push(`${lo.n}:${lo.respawns}`);
      if (!hi.finished || hi.t > p.A) noA.push(`${hi.n}:${hi.finished ? hi.t.toFixed(1) : 'dnf'}>${p.A.toFixed(1)}`);
    }
    check(`skill ${SKILL_LO} finishes every level under ${SLACK} x par B (${rows.length} levels)`, slow.length === 0, slow.slice(0, 16).join(' '));
    check(`skill ${SKILL_LO} needs at most ${MAX_RESPAWNS} respawns on every level`, respawny.length === 0, respawny.slice(0, 16).join(' '));
    check(`skill ${SKILL_HI} reaches par A on every level`, noA.length === 0, noA.slice(0, 16).join(' '));
    done();
  }
}
