/* monsters-check: the creature roster, its behaviour and its rigs. Owner: monsters.
   Node half: drives a kinematic probe car through every level with its own contact test (the same rule the
   sim is asked to use: actor.hot, actor.r, actor.h), so the behaviour is proven independently of physics:
   - roster: two creatures and a boss per world, every kind the levels name exists, knocks within limits
   - fair: every lunge or attack hit was told first (>= 0.3 s), nothing hits twice in a row, idle and tell never hit
   - avoidable: a driver that reads the telegraphs takes far fewer hits than one that ignores them
   - bosses: enter, attack, never pass the car outside a leap, are defeated at the flag, can be smashed, pay a bonus
   - deterministic: the same level twice gives the same bits, alone and through the real sim.step
   Browser half (Chromium): every kind builds within its draw-call and triangle budget, animates through every
   state and event, disposes, and the dev zoo and a boss race run with zero console errors and no words. */
'use strict';
const { check, done, loadSim, open, visibleLetters } = require('./lib.cjs');
const fs = require('fs'), path = require('path');

const V = loadSim(), C = V.contracts, S = V.sim, AI = V.monsterAI, K = AI.KINDS, W = V.levels.WORLDS;
const SRC = fs.readFileSync(path.join(__dirname, '..', 'src', 'monsters.sim.js'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

/* ---------- roster ---------- */
const banned = /\bMath\.(random|sin|cos|tan|asin|acos|atan|atan2|exp|pow|hypot|log\w*|cbrt)\b|\*\*|\bDate\b|\bperformance\b|\bwindow\b|\bdocument\b|\bTHREE\b/;
check('monsters.sim.js is pure sim-region code', !banned.test(SRC), (SRC.match(banned) || [''])[0]);
const missing = [], wrongWorld = [], badArche = [], creatures = new Set();
for (let w = 1; w <= C.WORLD_COUNT; w++) {
  const Wd = W[w];
  if (!Wd || Wd.monsters.length !== 2) missing.push(w + ':needs 2 creatures');
  for (const k of [...Wd.monsters, Wd.boss]) {
    if (!K[k]) { missing.push(k); continue; }
    if (K[k].world !== w) wrongWorld.push(k);
    if (!C.ARCHE.includes(K[k].arche)) badArche.push(k);
  }
  Wd.monsters.forEach(k => { creatures.add(k); if (K[k] && (K[k].arche === 'boss' || K[k].arche === 'debris')) badArche.push(k + ' is not a creature'); });
  if (K[Wd.boss] && K[Wd.boss].arche !== 'boss') badArche.push(Wd.boss + ' is not a boss');
}
check('every world has two creature kinds and a boss in KINDS', missing.length === 0, missing.join(' '));
check('kinds belong to their world and use a contracts.ARCHE archetype', !wrongWorld.length && !badArche.length, [...wrongWorld, ...badArche].join(' '));
check('24 distinct creatures, 12 distinct bosses', creatures.size === 24 && new Set(Object.values(W).map(x => x.boss)).size === 12);
const badKnock = [], badNum = [], badAmmo = [];
for (const k of Object.values(K)) {
  for (const f of ['r', 'h', 'mass', 'speed', 'trigger', 'tell', 'lunge', 'reach', 'cooldown']) if (!Number.isFinite(k[f])) badNum.push(k.kind + '.' + f);
  for (const kn of [k.knock, k.bump]) if (!(kn.stun > 0 && kn.stun <= 1 && kn.impulse > 0 && kn.impulse <= 15 && kn.lift >= 0 && kn.spin >= 0)) badKnock.push(k.kind);
  for (const a of k.attacks || []) if (a.debris && (!K[a.debris] || K[a.debris].arche !== 'debris')) badAmmo.push(k.kind + '>' + a.debris);
  if (k.throws && (!K[k.throws] || K[k.throws].arche !== 'debris')) badAmmo.push(k.kind + '>' + k.throws);
  if (k.arche === 'boss' && !(k.hp >= 1 && (k.attacks || []).length >= 3)) badAmmo.push(k.kind + ' needs hp and 3+ attacks');
}
check('every knock costs at most 1 s of control (stun <= 1) and a sane impulse', badKnock.length === 0, badKnock.join(' '));
check('every kind has finite behaviour numbers', badNum.length === 0, badNum.join(' '));
check('every boss attack and thrower names a debris kind', badAmmo.length === 0, badAmmo.join(' '));

/* ---------- the kinematic probe ---------- */
const CAR_R = 1.3;
function race(n, driver, opt = {}) {
  const spec = V.levels.level(n), T = S.buildTrack(spec), fin = T.finishS !== undefined ? T.finishS : T.length - 20;
  const st = { rng: (spec.seed >>> 0) || 1, events: [], tick: 0, actors: [] };
  const car = { s: 2, d: 0, h: 0, speed: 0 };
  const ctx = { track: T, car, dt: C.SIM_DT, tick: 0, rand: () => V.dmath.rngNext(st), frameAt: S.frameAt, toWorld: S.toWorld,
    emit: (type, f) => st.events.push({ type, tick: st.tick, ...f }),
    spawn: place => { const a = AI.spawn(place, T, ctx); if (a) { a.i = st.actors.length; st.actors.push(a); } return a; } };
  for (const m of spec.monsters) { const a = AI.spawn(m, T, ctx); if (a) { a.i = st.actors.length; st.actors.push(a); } }
  if (spec.boss) { const a = AI.spawn({ ...spec.boss, boss: true }, T, ctx); if (a) { a.i = st.actors.length; st.actors.push(a); } }
  st.actors.forEach((a, i) => { a.i = i; });
  const told = new Map(), lastHit = new Map(), out = { n, hits: 0, untold: [], double: [], idleHot: [], nonfinite: [], bossAhead: 0, ev: {}, stun: 0, t: 0, h: 2166136261 >>> 0, boss: null, finishedBehind: true };
  const mix = x => { const f = new Float64Array([x]), u = new Uint32Array(f.buffer); out.h = Math.imul(out.h ^ u[0], 16777619) >>> 0; out.h = Math.imul(out.h ^ u[1], 16777619) >>> 0; };
  let stunT = 0, v = 0;
  const F = {};
  while (car.s < fin && st.tick < C.SIM_HZ * 400) {
    st.tick++; ctx.tick = st.tick;
    const want = driver(car, st, T, ctx);
    S.frameAt(T, car.s, F);
    if (stunT > 0) stunT -= ctx.dt;
    else { v += Math.max(-30, Math.min(8, (want.v - v) * 2)) * ctx.dt; car.d = Math.max(-F.hw + 1, Math.min(F.hw - 1, car.d + Math.max(-9, Math.min(9, (want.d - car.d) * 3)) * ctx.dt)); }
    car.speed = v; car.s += v * ctx.dt;
    const was = st.actors.map(a => a.state);
    for (const a of st.actors) AI.think(a, ctx);
    st.actors.forEach((a, i) => { if (was[i] === 'gone' && a.state !== 'gone') told.set(a.i, st.tick); });
    for (const a of st.actors) {
      const k = K[a.kind];
      if (!Number.isFinite(a.x + a.y + a.z + a.s + a.d + a.h + a.yaw)) out.nonfinite.push(a.kind);
      if (a.hot && (a.state === 'idle' || a.state === 'gone' || (a.state === 'tell' && a.knock !== k.bump))) out.idleHot.push(a.kind + ':' + a.state);
      if (a.boss && !a.defeated && (a.state === 'chase' || a.state === 'tell') && a.s > car.s && Math.abs(a.d) < S.frameAt(T, a.s, F).hw + 0.5) out.bossAhead++;
      if (a.boss && a.surgeT > 0 && Math.abs(a.d) > S.frameAt(T, a.s, F).hw + k.r * 0.5) out.surged = (out.surged || 0) + 1;
      if (!a.hot) continue;
      const ds = a.s - car.s, dd = a.d - car.d;
      if (ds * ds + dd * dd > (a.r + CAR_R) * (a.r + CAR_R) || car.h > a.h + k.h || car.h + 1.6 < a.h) continue;
      const kn = a.knock || k.knock;
      if (lastHit.has(a.i) && st.tick - lastHit.get(a.i) < C.SIM_HZ * 0.5) out.double.push(a.kind);
      lastHit.set(a.i, st.tick);
      out.hits++; out.stun += kn.stun; stunT = Math.max(stunT, kn.stun); v = Math.max(0, v - kn.impulse);
      if (kn === k.knock && a.state !== 'roam') {   /* a lunge or an attack, not a body bump: it must have been told */
        const tk = told.get((k.arche === 'debris' ? a : a.leader || a).i);
        if (tk === undefined || st.tick - tk < C.SIM_HZ * 0.3) out.untold.push(a.kind + '@' + a.state);
      }
      st.events.push({ type: a.boss ? 'boss' : 'monster', tick: st.tick, a: a.i, what: 'hit' });
      AI.onHit(a, ctx);
    }
    for (const e of st.events) {
      out.ev[e.type + ':' + e.what] = (out.ev[e.type + ':' + e.what] || 0) + 1;
      if (e.what === 'tell' || e.what === 'roar' || (e.type === 'monster' && e.what === 'lunge' && K[st.actors[e.a].kind].arche === 'debris')) {
        const a = st.actors[e.a]; if (!told.has(a.i) || e.what !== 'lunge') told.set(a.i, st.tick);
      }
      if (e.type === 'boss' && e.what === 'roar') told.set(e.a, st.tick);
    }
    st.events.length = 0;
    if (st.tick % 30 === 0) for (const a of st.actors) { mix(a.s); mix(a.d); mix(a.h); }
    if (opt.each) opt.each(st, car);
  }
  out.t = st.tick / C.SIM_HZ;
  out.finished = car.s >= fin;
  for (const a of st.actors) AI.think(a, ctx);
  for (const e of st.events) out.ev[e.type + ':' + e.what] = (out.ev[e.type + ':' + e.what] || 0) + 1;
  out.boss = st.actors.find(a => a.boss) || null;
  if (out.boss && !out.boss.defeated) out.finishedBehind = false;
  out.actors = st.actors;
  return out;
}
/* plough: full speed down the middle, ignores every monster */
const plough = () => ({ v: 36, d: 0 });
/* reader: watches the telegraphs (marks, hot bodies ahead) and steers to the far side of them */
function reader(car, st, T) {
  let best = 0, worst = 0;
  const F = {};
  const hw = S.frameAt(T, car.s, F).hw;
  for (const a of st.actors) {
    if (a.state === 'gone') continue;
    const k = K[a.kind], threat = a.mark || a.hot || a.state === 'tell' || a.state === 'lunge';
    if (!threat) continue;
    const s = a.mark ? a.ms : a.s, ds = s - car.s;
    if (ds < -3 || ds > 45) continue;
    let d = a.mark === 2 ? null : a.mark ? a.md : a.d;
    if (k.arche === 'lurker' || (k.arche === 'swarm')) d = a.side * hw;
    if (k.arche === 'debris' && k.mode === 'sweep') d = a.side * hw;
    if (d === null) continue;
    const w = 1 / (1 + Math.max(0, ds) * 0.05);
    if (w > worst) { worst = w; best = d > 0 ? -hw + 1.2 : hw - 1.2; }
  }
  return { v: 34, d: worst ? best : 0 };
}

const plo = [], rea = [];
for (let n = 1; n <= C.PARADE_LEVEL; n++) { plo.push(race(n, plough)); rea.push(race(n, reader)); }
const all = [...plo, ...rea];
check('every level finishes for the probe car (monsters never stop a run)', all.every(r => r.finished), all.filter(r => !r.finished).map(r => r.n).join(' '));
check('positions stay finite for every actor', all.every(r => !r.nonfinite.length), all.flatMap(r => r.nonfinite).slice(0, 8).join(' '));
const untold = all.flatMap(r => r.untold.map(u => r.n + ':' + u));
check('every lunge and attack hit was telegraphed at least 0.3 s before', untold.length === 0, untold.slice(0, 10).join(' '));
const idleHot = all.flatMap(r => r.idleHot.map(u => r.n + ':' + u));
check('idle and gone are never hot; a tell is at most a body bump', idleHot.length === 0, [...new Set(idleHot)].slice(0, 10).join(' '));
const dbl = all.flatMap(r => r.double.map(u => r.n + ':' + u));
check('no actor hits the car twice within 0.5 s', dbl.length === 0, dbl.slice(0, 10).join(' '));
const ph = plo.reduce((s, r) => s + r.hits, 0), rh = rea.reduce((s, r) => s + r.hits, 0);
check('monsters are a real threat: the plough takes hits in most levels', plo.filter(r => r.hits > 0).length >= 100, plo.filter(r => r.hits > 0).length + ' levels, ' + ph + ' hits');
check('hits are avoidable: reading the tells cuts hits by 40 percent or more', rh <= ph * 0.6, `plough ${ph} reader ${rh}`);
const stunShare = plo.map(r => r.stun / r.t), worstStun = Math.max(...stunShare);
check('no level stuns the plough for more than 15 percent of its run', worstStun <= 0.15, 'worst ' + (worstStun * 100).toFixed(1) + '%');
const tellsSeen = new Set();
for (const r of plo) for (const a of r.actors) if (a.state !== 'idle' || a.tries < K[a.kind].tries) tellsSeen.add(a.kind);
const dormant = [...creatures].filter(k => !tellsSeen.has(k));
check('every creature kind wakes up and acts in some level', dormant.length === 0, dormant.join(' '));

/* bosses */
const fin = all.filter(r => V.levels.level(r.n).boss);
check('every finale has a boss that enters, attacks at least twice and is defeated at the flag',
  fin.length >= 24 && fin.every(r => r.ev['boss:enter'] >= 1 && (r.ev['boss:attack'] || 0) >= 2 && r.ev['boss:defeat'] === 1 && r.finishedBehind),
  fin.filter(r => !(r.ev['boss:enter'] >= 1 && (r.ev['boss:attack'] || 0) >= 2 && r.ev['boss:defeat'] === 1)).map(r => r.n + JSON.stringify(r.ev)).slice(0, 2).join(' '));
check('a chasing boss never gets ahead of the car on the road',  fin.every(r => r.bossAhead === 0), fin.map(r => r.bossAhead).join(','));
check('bosses surge level with the car beside the road in most finales (visible from the chase camera)', fin.filter(r => r.surged > 0).length >= fin.length * 0.6, fin.filter(r => r.surged > 0).length + '/' + fin.length);
check('an outrun boss pays a bonus (1 or 2 stars) and AI.bonus() sums it', fin.every(r => r.boss.bonus >= 1 && AI.bonus(r.actors) === r.boss.bonus));
const moves = new Set();
for (let n = 10; n <= 120; n += 10) race(n, plough, { each: st => { for (const a of st.actors) if (a.boss && a.move) moves.add(K[a.kind].world + ':' + a.move); } });
const perW = [...Array(12)].map((_, i) => [...moves].filter(m => m.startsWith((i + 1) + ':')).length);
check('every boss uses at least three different moves', perW.every(x => x >= 3), perW.join(','));
/* smash: a driver that rams the dazed boss */
let smashed = 0;
for (let n = 10; n <= 120; n += 10) {
  const r = race(n, (car, st) => {
    const b = st.actors.find(a => a.boss && a.state === 'stagger' && !a.defeated && a.s > car.s - 2);
    return b ? { v: 30, d: b.d } : { v: 36, d: 0 };
  });
  if (r.boss.smashed && r.boss.bonus === 3 && r.ev['boss:defeat'] === 1) smashed++;
}
check('ramming the dazed boss three times smashes it (bonus 3, one defeat) in most finales', smashed >= 8, smashed + '/12');

/* determinism */
const d1 = race(40, reader), d2 = race(40, reader);
check('determinism: the probe race twice gives the same bits', d1.h === d2.h && d1.t === d2.t, d1.h + ' ' + d2.h);
function simRun(n) {
  const spec = V.levels.level(n), T = S.buildTrack(spec);
  const st = S.newRace(T, S.carParams(V.catalog.stats({ body: 'monster', wheels: 'monster', extras: {} }), {}), { seed: spec.seed, mode: 'race' });
  let h = 2166136261 >>> 0;
  const mix = x => { const f = new Float64Array([x]), u = new Uint32Array(f.buffer); h = Math.imul(h ^ u[0], 16777619) >>> 0; h = Math.imul(h ^ u[1], 16777619) >>> 0; };
  while (!st.finished && st.tick < C.SIM_HZ * 400) { S.step(st, S.autopilot(st, 1)); if (st.tick % 30 === 0) for (const a of st.actors) { mix(a.s); mix(a.d); mix(a.h); } st.events.length = 0; }
  return { h, st };
}
const s1 = simRun(30), s2 = simRun(30);
check('determinism through sim.step: a boss race twice gives the same actor bits', s1.h === s2.h && s1.st.actors.length > 1, s1.h + ' ' + s2.h);
check('the sim spawns the packs and boss ammunition (actors beyond the placed monsters)', s1.st.actors.length > V.levels.level(30).monsters.length + 1, s1.st.actors.length + ' actors');

/* ---------- browser ---------- */
(async () => {
  let b;
  try {
    b = await open('scene=dev:monsters-zoo&nosplash');
    const { page, errors, requests } = b;
    await page.waitForTimeout(600);
    const rep = await page.evaluate(() => {
      const g = VROOM.game.ctx, T = g.THREE, out = [];
      for (const kind of Object.keys(VROOM.monsterAI.KINDS)) {
        const r = VROOM.monsters.build(g, kind);
        let calls = 0, tris = 0;
        r.group.traverse(o => {
          if (!o.isMesh) return;
          calls++;
          const gi = o.geometry, n = gi.index ? gi.index.count / 3 : gi.attributes.position.count / 3;
          tris += n * (o.isInstancedMesh ? o.count : 1);
        });
        const K = VROOM.monsterAI.KINDS[kind];
        const a = { i: 0, kind, arche: K.arche, s: 0, d: 0, h: 0, x: 0, y: 0, z: 0, yaw: 0, vs: 10, vd: 2, vh: 0, state: 'idle', stateT: 0, hp: 3, r: K.r, mass: K.mass, phase: 0,
          alive: true, boss: K.arche === 'boss', hot: false, mark: 1, mx: 3, my: 0, mz: 4, gy: 0, tether: !!K.tether, ax: 5, ay: 0, az: 0, move: 'leap', side: 1, enraged: false, defeated: false };
        let bad = '';
        try {
          for (const s of ['idle', 'tell', 'lunge', 'recover', 'roam', 'chase', 'attack', 'stagger', 'idle', 'gone', 'idle']) {
            a.state = s; a.mark = s === 'tell' ? (a.mark % 3) + 1 : 0;
            for (let k = 0; k < 8; k++) { a.stateT = k * 0.1; a.phase += 0.1; r.update(a, 1 / 60, a.phase); }
          }
          for (const w of ['tell', 'lunge', 'hit', 'roar', 'stomp', 'retreat', 'enter', 'attack', 'enrage', 'defeat', 'nonsense']) r.onEvent(w);
          a.defeated = true; a.state = 'stagger'; r.update(a, 1 / 60, 9);
          r.update(a, 1 / 60, 9.1);
        } catch (e) { bad = String(e); }
        const vis = (() => { a.state = 'gone'; a.defeated = false; r.update(a, 1 / 60, 10); return r.group.visible; })();
        r.dispose();
        out.push({ kind, arche: K.arche, calls, tris: Math.round(tris), bad, goneVisible: vis, kids: r.group.children.length });
      }
      return out;
    });
    const big = rep.filter(r => r.arche === 'boss' ? r.calls > 14 || r.tris > 14000 : r.arche === 'debris' ? r.calls > 4 || r.tris > 2500 : r.calls > 12 || r.tris > 5000);
    check('every kind builds a rig with geometry', rep.length === Object.keys(K).length && rep.every(r => r.kids > 0 && r.calls > 0), rep.filter(r => !r.calls).map(r => r.kind).join(' '));
    check('rigs stay within budget (creature 12 calls / 5k tris, boss 14 / 14k, debris 4 / 2.5k, overlays included)', big.length === 0, big.map(r => `${r.kind} ${r.calls}c ${r.tris}t`).join(' '));
    check('every rig animates every state and event without throwing', rep.every(r => !r.bad), rep.filter(r => r.bad).map(r => r.kind + ' ' + r.bad).slice(0, 3).join(' | '));
    check('a gone actor is hidden', rep.every(r => r.goneVisible === false), rep.filter(r => r.goneVisible).map(r => r.kind).join(' '));
    const worst = rep.reduce((m, r) => r.arche === 'boss' ? Math.max(m, r.calls) : m, 0), worstT = rep.reduce((m, r) => Math.max(m, r.tris), 0);
    console.log(`      rigs: ${rep.length} kinds, max boss draw calls ${worst}, max triangles ${worstT}`);
    const still = await page.evaluate(() => {
      const ctx = { ...VROOM.game.ctx, reducedMotion: true }, out = [];
      for (const kind of ['magnetmaw', 'lampmoth', 'bilgekraken', 'icewolf']) {
        const r = VROOM.monsters.build(ctx, kind), K = VROOM.monsterAI.KINDS[kind];
        const a = { i: 0, kind, arche: K.arche, s: 0, d: 0, h: 0, x: 0, y: 0, z: 0, yaw: 0, vs: 0, vd: 0, state: K.arche === 'boss' ? 'chase' : 'idle', stateT: 1, phase: 0, alive: true, hot: false, mark: 0, gy: 0 };
        const snap = () => { const v = []; r.group.traverse(o => v.push(o.position.y.toFixed(4), o.rotation.z.toFixed(4))); return v.join(); };
        for (let k = 0; k < 30; k++) r.update(a, 1 / 60, 1 + k / 60);
        const s1 = snap();
        for (let k = 0; k < 30; k++) r.update(a, 1 / 60, 3.7 + k / 60);
        r.onEvent('stomp');
        r.update(a, 1 / 60, 4.3);
        const dust = r.group.children.some(o => o.isMesh && o.visible && o.material && o.material.color && o.material.color.getHex() === 0xd8c8a8);
        out.push({ kind, same: K.arche === 'boss' || s1 === snap(), dust });
        r.dispose();
      }
      return out;
    });
    check('reduced motion: idle creatures hold still and stomps raise no dust ring', still.every(s => s.same && !s.dust), JSON.stringify(still.filter(s => !s.same || s.dust)));
    const zoo = await page.evaluate(() => ({ id: VROOM.game.current(), info: VROOM.game.ctx.renderer.info.render }));
    check('the dev zoo scene renders', zoo.id === 'dev:monsters-zoo' && zoo.info.calls > 20, JSON.stringify(zoo));
    check('no words on screen in the zoo', (await visibleLetters(page)).length === 0);
    await b.browser.close();
    b = await open('scene=race&level=10&bot=1');
    await b.page.waitForTimeout(5000);
    const rs = await b.page.evaluate(() => {
      const r = VROOM.scenes.race, st = r.st;
      return { id: VROOM.game.current(), actors: st ? st.actors.length : 0, rigs: r.mons ? r.mons.length : 0, calls: VROOM.game.ctx.renderer.info.render.calls,
        boss: st ? st.actors.filter(a => a.boss).map(a => a.state).join() : '' };
    });
    check('a boss race builds a rig for every actor and runs', rs.id === 'race' && rs.actors > 1 && rs.rigs === rs.actors, JSON.stringify(rs));
    const allErr = [...errors, ...b.errors];
    check('zero console errors', allErr.length === 0, allErr.slice(0, 3).join(' | '));
    const foreign = [...requests, ...b.requests].filter(u => !/^(http:\/\/127\.0\.0\.1|data:|blob:|about:)/.test(u));
    check('no foreign requests', foreign.length === 0, foreign.slice(0, 3).join(' '));
  } catch (e) {
    check('browser half ran', false, String(e).slice(0, 300));
  } finally { if (b) await b.browser.close().catch(() => {}); }
  done();
})();
