#!/usr/bin/env node
/* cars-check: the vehicle roster, its catalog and the garage. Owner: cars.
   Node half (the sim region, straight from src/): every legacy id is still in the catalog, v12 free parts stay
   free and v12 paid parts stay paid, the v13 appends are append-only and priced, CarStats are complete and
   physical, the class feel table holds (docs/OVERHAUL.md section 3), wheels and extras change the stats.
   Browser half (VROOM_URL, ?scene=garage): every body, wheel, paint, decal, buddy and extra builds; rigs stay
   inside the draw-call and triangle budget; wheels follow steer, spin and suspension; damage, grime and dispose
   work; thumbnails draw; the garage is wordless with big targets, previews locked parts, buys, denies, upgrades,
   repairs, numbers; reduced motion parks the turntable; no console errors. */
'use strict';
const { check, done, open, visibleLetters, smallTargets, loadSim } = require('./lib.cjs');

/* ---------- Node: the catalog ---------- */
const V = loadSim(), C = V.catalog, L = V.contracts.LEGACY;
const TABLES = [['body', L.BODY_ORDER, C.BODIES], ['wheels', L.WHEEL_ORDER, C.WHEELS], ['color', L.COLORS, C.PAINTS],
  ['decal', L.DECAL_ORDER, C.DECALS], ['buddy', L.BUDDY_ORDER, C.BUDDIES], ['extras', L.EXTRAS, C.EXTRAS]];
const missing = TABLES.flatMap(([k, list, t]) => list.filter(id => !t[id]).map(id => k + ':' + id));
check('every legacy id is still in the catalog', missing.length === 0, missing.join(' '));

const freeWrong = [], paidWrong = [];
for (const [k, list] of TABLES) {
  if (k === 'buddy') continue;
  for (const id of list) {
    const v12 = L.PRICES[k] && L.PRICES[k][id], now = C.price(k, id);
    if (!v12 && now !== 0) freeWrong.push(k + ':' + id + '=' + now);
    if (v12 > 0 && !(now > 0)) paidWrong.push(k + ':' + id + '=' + now);
  }
}
check('v12 free parts stay free', freeWrong.length === 0, freeWrong.join(' '));
check('v12 paid parts stay paid', paidWrong.length === 0, paidWrong.join(' '));
check('the secret v12 paint stays secret', C.PAINTS['p:rainbowshine'].secret === true);
check('v12 buddies are never free', L.BUDDY_ORDER.every(id => C.price('buddy', id) > 0));

/* the v13 appends as shipped: these lists may only grow at the end */
const SHIPPED = {
  NEW_BODY_IDS: ['tusk', 'anvil', 'gnasher', 'howler', 'dredge', 'bulwark', 'cinder', 'wrecker'],
  NEW_WHEEL_IDS: ['spike', 'chain', 'paddle', 'rustrim', 'turbine', 'skullcap'],
  NEW_PAINT_IDS: ['m:gunmetal', 'm:chrome', 'm:rust', 'm:molten', 'm:hazard', 'm:toxic', 'm:blackchrome', 'm:camo',
    'm:furnace', 'm:venom', 'm:bonewhite', 'm:cobalt'],
  NEW_DECAL_IDS: ['skull', 'hazard', 'claws', 'cog', 'fangs'],
  NEW_EXTRA_IDS: ['rollcage', 'ram', 'sidepipes', 'searchlights', 'blower', 'plating'],
  NEW_BUDDY_IDS: ['gremlin', 'skullbot'],
};
const NEW_TABLE = { NEW_BODY_IDS: ['body', C.BODIES, L.BODY_ORDER], NEW_WHEEL_IDS: ['wheels', C.WHEELS, L.WHEEL_ORDER], NEW_PAINT_IDS: ['color', C.PAINTS, L.COLORS],
  NEW_DECAL_IDS: ['decal', C.DECALS, L.DECAL_ORDER], NEW_EXTRA_IDS: ['extras', C.EXTRAS, L.EXTRAS], NEW_BUDDY_IDS: ['buddy', C.BUDDIES, L.BUDDY_ORDER] };
const appendBad = [];
for (const key of Object.keys(SHIPPED)) {
  const arr = C[key], [kind, table, legacy] = NEW_TABLE[key];
  if (!Array.isArray(arr)) { appendBad.push(key + ' missing'); continue; }
  SHIPPED[key].forEach((id, i) => { if (arr[i] !== id) appendBad.push(`${key}[${i}] ${arr[i]} != ${id}`); });
  if (new Set(arr).size !== arr.length) appendBad.push(key + ' has duplicates');
  for (const id of arr) {
    if (legacy.includes(id)) appendBad.push(key + ' reuses legacy ' + id);
    if (!table[id]) appendBad.push(key + ' ' + id + ' not in the table');
    if (!(C.price(kind, id) > 0) && !(kind === 'color' && id === C.STARTER.color)) appendBad.push(key + ' ' + id + ' is free');
  }
  const extra = Object.keys(table).filter(id => !legacy.includes(id) && !arr.includes(id));
  if (extra.length) appendBad.push(kind + ' ids outside LEGACY and ' + key + ': ' + extra.join(','));
}
check('v13 appends are append-only, unique, in their tables and priced', appendBad.length === 0, appendBad.join(' | '));
check('price() is undefined for unknown ids and kinds', C.price('body', 'nope') === undefined && C.price('nope', 'monster') === undefined && C.price('body', 'toString') === undefined);
/* v14: the starter build for a fresh save is a two-tone metallic with a decal, every part free */
const ST = C.STARTER, stPaint = ST && C.PAINTS[ST.color];
check('the starter build is the Mauler in a free two-tone metallic that wears its own stencil',
  !!ST && ST.body === 'monster' && C.price('body', ST.body) === 0 && C.price('wheels', ST.wheels) === 0 && !!stPaint && stPaint.kind === 'metal' && !!stPaint.low
  && C.price('color', ST.color) === 0 && !stPaint.secret && ST.decal === 'none' && !!C.DECALS[stPaint.stencil] && stPaint.stencil !== 'none' && Object.isFrozen(ST),
  JSON.stringify(ST));
const twoTones = Object.values(C.PAINTS).filter(p => p.low);
check('two-tone paints carry a low tone and a pinstripe, and only the starter is free',
  twoTones.length >= 4 && twoTones.every(p => /^#[0-9a-f]{6}$/i.test(p.low) && /^#[0-9a-f]{6}$/i.test(p.stripe) && (p.id === ST.color || p.price > 0)), twoTones.map(p => p.id + '=' + p.price).join(' '));
const newBodyPrices = SHIPPED.NEW_BODY_IDS.map(id => C.price('body', id));
check('new machines cost 150 to 1500 stars', newBodyPrices.every(p => p >= 150 && p <= 1500), newBodyPrices.join(' '));

const KEYS = ['mass', 'wheelbase', 'track', 'cgH', 'rideH', 'wheelR', 'suspK', 'suspC', 'suspTravel', 'power', 'topSpeed', 'grip', 'driftGrip', 'brake', 'steerMax', 'airControl', 'boostPower', 'armor'];
const badStats = [];
for (const id of Object.keys(C.BODIES)) {
  const b = C.BODIES[id], s = b.stats;
  if (!['hauler', 'brute', 'racer', 'hover', 'tank', 'freak'].includes(b.cls)) badStats.push(id + ' cls ' + b.cls);
  for (const k of KEYS) if (!(Number.isFinite(s[k]) && s[k] >= 0)) badStats.push(id + '.' + k);
  if (!(s.armor <= 1) || !(s.driftGrip < s.grip) || !(s.size && s.size.l > 0 && s.size.w > 0 && s.size.h > 0)) badStats.push(id + ' shape');
  if (!(s.wheelbase < s.size.l) || !(s.track < s.size.w + 0.6)) badStats.push(id + ' wheels outside the body');
  const sag = s.mass * 9.81 / 4 / s.suspK;
  if (!(sag < s.suspTravel * 0.6)) badStats.push(id + ' bottoms out at rest (' + sag.toFixed(2) + ' m sag)');
}
check('every body carries complete, physical CarStats', badStats.length === 0, badStats.join(' '));

const byCls = {};
for (const b of Object.values(C.BODIES)) (byCls[b.cls] = byCls[b.cls] || []).push(b.stats);
const mean = (cls, k) => byCls[cls].reduce((a, s) => a + s[k], 0) / byCls[cls].length;
const order = (k, list) => list.every((c, i) => i === 0 || mean(list[i - 1], k) > mean(c, k));
check('class feel: top speed racer > freak > brute > hauler > tank', order('topSpeed', ['racer', 'freak', 'brute', 'hauler', 'tank']));
check('class feel: armour tank > hauler > brute > freak > racer', order('armor', ['tank', 'hauler', 'brute', 'freak', 'racer']));
check('class feel: mass tank > hauler > brutes and freaks > racer > hover', order('mass', ['tank', 'hauler']) && mean('hauler', 'mass') > Math.max(mean('brute', 'mass'), mean('freak', 'mass'))
  && Math.min(mean('brute', 'mass'), mean('freak', 'mass')) > mean('racer', 'mass') && mean('racer', 'mass') > mean('hover', 'mass'));
check('class feel: hovers have the best air control, brutes the longest travel, racers ride lowest',
  mean('hover', 'airControl') > Math.max(...['brute', 'racer', 'tank', 'hauler', 'freak'].map(c => mean(c, 'airControl')))
  && mean('brute', 'suspTravel') > Math.max(...['racer', 'tank', 'hauler', 'freak'].map(c => mean(c, 'suspTravel')))
  && mean('racer', 'rideH') < Math.min(...['brute', 'tank', 'hauler', 'freak', 'hover'].map(c => mean(c, 'rideH'))));
const def = C.stats({ body: 'monster', wheels: 'monster', extras: {} });
check('tuning anchors: the Mauler tops 40 m/s, racers about 50, tanks about 34',
  def.topSpeed === 40 && Math.abs(mean('racer', 'topSpeed') - 50) < 3 && Math.abs(mean('tank', 'topSpeed') - 34) < 1.5,
  `${def.topSpeed} ${mean('racer', 'topSpeed').toFixed(1)} ${mean('tank', 'topSpeed').toFixed(1)}`);
const plain = C.stats({ body: 'police', wheels: 'racing', extras: {} }), tuned = C.stats({ body: 'police', wheels: 'racing', extras: { spoiler: true, plating: true } });
check('extras add their mods', tuned.grip > plain.grip && tuned.armor > plain.armor && tuned.mass > plain.mass && tuned.topSpeed < plain.topSpeed);
const big = C.stats({ body: 'race', wheels: 'monster', extras: {} }), base = C.BODIES.race.stats;
check('wheels clamp to the chassis and lift the ride height', big.wheelR <= base.wheelR * 1.3 + 1e-9 && big.wheelR > base.wheelR && big.rideH > base.rideH);
check('stats() is deterministic and never mutates the catalog',
  JSON.stringify(C.stats({ body: 'anvil', wheels: 'chain', extras: { ram: true } })) === JSON.stringify(C.stats({ body: 'anvil', wheels: 'chain', extras: { ram: true } }))
  && C.BODIES.race.stats.wheelR === base.wheelR && C.stats({}).topSpeed === 40);

/* ---------- browser: the rigs and the garage ---------- */
(async () => {
  const { browser, page, errors } = await open('scene=garage');
  await page.waitForTimeout(600);

  const rigs = await page.evaluate(() => {
    const ctx = VROOM.game.ctx, Cat = VROOM.catalog, out = { bad: [], maxCalls: 0, maxTris: 0, worst: '' };
    const car = (comp, steer, spin) => ({ speed: 20, rpm: 0.8, boosting: true, air: false, wheels: [0, 1, 2, 3].map(() => ({ comp, steer, spin, contact: true })) });
    for (const id of Object.keys(Cat.BODIES)) {
      try {
        const r = VROOM.cars.buildCar(ctx, { body: id, wheels: 'monster', color: 'm:molten', decal: 'skull', buddy: 'robot', number: '42', extras: { beacon: true, spoiler: true } });
        if (!r.group || !r.group.isObject3D || r.wheels.length !== 4 || !r.wheels.every(w => w.isObject3D)) out.bad.push(id + ' shape');
        const a = r.anchors;
        if (!a.exhaust.length || !a.exhaust.every(p => p.length === 3 && p.every(Number.isFinite)) || a.cam.length !== 3 || a.roof.length !== 3) out.bad.push(id + ' anchors');
        r.update(car(0.1, 0, 0), 1 / 60, 1); const low = r.wheels[0].position.y;
        r.update(car(0.9, 0.4, 1.2), 1 / 60, 1.1); const high = r.wheels[0].position.y;
        if (!(high > low)) out.bad.push(id + ' suspension');
        if (!(Math.abs(r.wheels[0].rotation.y + 0.4) < 1e-6) || r.wheels[2].rotation.y !== 0) out.bad.push(id + ' steer');
        r.setDamage(9); r.setGrime(1); r.setDamage(0); r.setGrime(0);
        const calls = r.drawCalls(), tris = r.triangles();
        if (calls > out.maxCalls) { out.maxCalls = calls; out.worst = id; }
        out.maxTris = Math.max(out.maxTris, tris);
        r.dispose();
        if (r.group.parent) out.bad.push(id + ' dispose');
      } catch (e) { out.bad.push(id + ' ' + e.message); }
    }
    return out;
  });
  check('every body builds, steers, springs, dents and disposes', rigs.bad.length === 0, rigs.bad.slice(0, 8).join(' | '));
  check('a fully dressed machine stays under 30 draw calls and 40k triangles', rigs.maxCalls <= 30 && rigs.maxTris <= 40000, `${rigs.maxCalls} calls (${rigs.worst}), ${rigs.maxTris} tris`);

  /* v14 polish: every machine spits boost flame (an outer cone and a hot core per outlet, in one draw call),
     every shared and paint material carries the edge light, and a two-tone paint splits inside its paint */
  const look = await page.evaluate(() => {
    const ctx = VROOM.game.ctx, Cat = VROOM.catalog, out = { fewPipes: [], flame: [], rim: [], tt: '' };
    const car = (boosting, rpm) => ({ speed: 25, rpm, boosting, air: false, wheels: [0, 1, 2, 3].map(() => ({ comp: 0.4, steer: 0, spin: 0, contact: true })) });
    const flameLen = (im, n) => { const m = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3(); let max = 0; for (let i = 0; i < n; i++) { im.getMatrixAt(i, m); m.decompose(p, q, s); max = Math.max(max, s.y); } return max; };
    for (const id of Object.keys(Cat.BODIES)) {
      const r = VROOM.cars.buildCar(ctx, { body: id, wheels: 'monster', color: '#e53935' });
      const n = r.anchors.exhaust.length;
      if (n < 1) out.fewPipes.push(id + ':' + n);
      let im = null; r.group.traverse(o => { if (o.isInstancedMesh && o.material && o.material.blending === THREE.AdditiveBlending && o.count === n * 2) im = o; });
      if (!im || !im.instanceColor) out.flame.push(id + ' no flame mesh');
      else {
        r.update(car(false, 0.2), 1 / 60, 1); const idle = flameLen(im, n * 2);
        r.update(car(true, 0.9), 1 / 60, 1.2); const boost = flameLen(im, n * 2);
        if (!(idle < 0.01 && boost > 1.2)) out.flame.push(`${id} idle ${idle.toFixed(2)} boost ${boost.toFixed(2)}`);
      }
      r.group.traverse(o => { if (o.isMesh && !o.isInstancedMesh && o.material.isMeshStandardMaterial && o.material.vertexColors && !(o.material.userData.shade && o.material.userData.shade.uRim)) out.rim.push(id + ':' + o.name); });
      r.dispose();
    }
    const r = VROOM.cars.buildCar(ctx, Cat.STARTER), paint = [];
    r.group.traverse(o => { if (o.isMesh && o.name === 'paint') paint.push(o); });
    const u = paint[0] && paint[0].material.userData.shade, ys = paint.flatMap(m => m.geometry.attributes.aBodyY ? Array.from(m.geometry.attributes.aBodyY.array) : []);
    const lo = Math.min(...ys), hi = Math.max(...ys);
    let decal = 0; r.group.traverse(o => { if (o.isMesh && o.name === 'decal') decal++; });
    out.stencil = decal > 0;
    out.tt = u && u.uSplit && ys.length && u.uSplit.value > lo && u.uSplit.value < hi && u.uLow.value.getHex() !== u.uHigh.value.getHex() ? '' : `split ${u && u.uSplit && u.uSplit.value} in ${lo}..${hi}`;
    r.dispose();
    return out;
  });
  check('every machine has an exhaust outlet', look.fewPipes.length === 0, look.fewPipes.join(' '));
  check('boost lights long flame cones with hot cores; idle keeps them out', look.flame.length === 0, look.flame.slice(0, 6).join(' | '));
  check('every lit body material carries the edge light', look.rim.length === 0, look.rim.slice(0, 6).join(' '));
  check('the starter two-tone splits inside its painted parts and wears its flame stencils', look.tt === '' && look.stencil, look.tt);

  const parts = await page.evaluate(() => {
    const ctx = VROOM.game.ctx, Cat = VROOM.catalog, bad = [];
    const bodies = ['monster', 'race', 'digger', 'ufo', 'bulwark', 'dump'];
    const all = Object.fromEntries(Object.keys(Cat.EXTRAS).map(k => [k, true]));
    const tryBuild = (b, tag) => { try { VROOM.cars.buildCar(ctx, b).dispose(); } catch (e) { bad.push(tag + ' ' + e.message); } };
    Object.keys(Cat.WHEELS).forEach((w, i) => tryBuild({ body: bodies[i % bodies.length], wheels: w }, 'wheel ' + w));
    Object.keys(Cat.PAINTS).forEach((c, i) => tryBuild({ body: bodies[i % bodies.length], color: c }, 'paint ' + c));
    Object.keys(Cat.DECALS).forEach((d, i) => tryBuild({ body: bodies[i % bodies.length], decal: d, number: String(i) }, 'decal ' + d));
    Object.keys(Cat.BUDDIES).forEach((b, i) => tryBuild({ body: bodies[i % bodies.length], buddy: b, extras: { partyhat: i % 2 === 0 } }, 'buddy ' + b));
    for (const b of Object.keys(Cat.BODIES)) tryBuild({ body: b, extras: all, buddy: 'pup', decal: 'fangs', number: '99' }, 'all extras on ' + b);
    tryBuild({ body: 'nope', wheels: 'nope', color: 'nope', decal: 'nope', buddy: 'nope', number: 'x' }, 'unknown ids');
    const t = VROOM.cars.thumb(ctx, { body: 'tusk', wheels: 'spike', color: 'm:hazard' }, 96);
    const px = t.getContext('2d').getImageData(0, 0, 96, 96).data; let lit = 0; for (let i = 3; i < px.length; i += 4) if (px[i] > 0) lit++;
    return { bad, thumb: t instanceof HTMLCanvasElement && t.width === 96, lit };
  });
  check('every wheel, paint, decal, number, buddy and extra builds (and unknown ids fall back)', parts.bad.length === 0, parts.bad.slice(0, 6).join(' | '));
  check('thumb() draws the machine into a canvas', parts.thumb && parts.lit > 600, 'lit px ' + parts.lit);

  /* the garage */
  check('the garage scene is active with a 3D view', await page.evaluate(() => VROOM.game.current() === 'garage' && !!VROOM.scenes.garage.view && !!VROOM.scenes.garage.rig));
  const tabs = ['body', 'wheels', 'color', 'decal', 'extras', 'buddy', 'number', 'bench'];
  const words = [], small = [];
  for (const t of tabs) {
    await page.click(`[aria-label="tab ${t}"]`, { force: true });
    await page.waitForTimeout(250);
    words.push(...(await visibleLetters(page)).map(w => t + ':' + w));
    small.push(...(await smallTargets(page)).map(s => t + ':' + JSON.stringify(s)));
  }
  check('garage: no words on screen on any tab', words.length === 0, words.slice(0, 6).join(' | '));
  check('garage: tap targets >= 64 px on every tab', small.length === 0, small.slice(0, 6).join(' | '));
  const tiles = await page.evaluate(() => { const g = VROOM.scenes.garage; g.setTab('body'); return document.querySelectorAll('#garageHud .gx-tile').length; });
  check('garage: the body tab shows a page of tiles', tiles === 5, String(tiles));

  const shop = await page.evaluate(() => {
    const g = VROOM.scenes.garage, S = VROOM.save, out = {};
    S.progress.wallet = 0; g.setTab('body'); g.choose('body', 'anvil');
    out.preview = g.rig.build.body === 'anvil' && S.state.body !== 'anvil' && getComputedStyle(g.buy).display !== 'none';
    g.purchase(); out.denied = !S.owns('body', 'anvil') && S.state.body !== 'anvil' && S.progress.wallet === 0;
    S.progress.wallet = 2000; g.purchase();
    out.bought = S.owns('body', 'anvil') && S.state.body === 'anvil' && S.progress.wallet === 500 && getComputedStyle(g.buy).display === 'none' && g.rig.build.body === 'anvil';
    g.setTab('body'); g.choose('body', 'monster'); out.backFree = S.state.body === 'monster' && S.progress.wallet === 500;
    g.setTab('extras'); g.choose('extras', 'horn'); out.toggle = S.state.extras.horn === true; g.choose('extras', 'horn'); out.toggle = out.toggle && S.state.extras.horn === false;
    g.setTab('bench'); g.choose('bench', 'engine'); const p = S.upgradePrice('engine'); g.purchase(); out.upgrade = S.progress.upgrades.engine === 1 && S.progress.wallet === 500 - p;
    S.progress.damage = 5; g.setTab('bench'); g.choose('bench', 'repair'); const rp = S.repairPrice(), w0 = S.progress.wallet; g.purchase(); out.repair = S.progress.damage === 0 && S.progress.wallet === w0 - rp;
    g.setTab('number'); document.querySelector('[aria-label="plus ten"]').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); out.number = S.state.number === '10';
    g.setTab('buddy'); g.choose('buddy', 'none'); out.noBuddy = S.state.buddy === null;
    return out;
  });
  check('garage: a locked part previews on the turntable with a buy plate', shop.preview);
  check('garage: buying without the stars is denied and changes nothing', shop.denied);
  check('garage: buying bolts the part on and charges the wallet', shop.bought);
  check('garage: owned parts switch for free', shop.backFree);
  check('garage: owned extras toggle on and off', shop.toggle);
  check('garage: workbench upgrades and repairs charge and apply', shop.upgrade && shop.repair, JSON.stringify(shop));
  check('garage: race number and buddy pickers work', shop.number && shop.noBuddy);
  const calls = await page.evaluate(() => new Promise(res => requestAnimationFrame(() => requestAnimationFrame(() => res(VROOM.game.ctx.renderer ? VROOM.game.ctx.renderer.info.render.calls : -1)))));
  check('garage: the bay renders under 150 draw calls', calls > 0 && calls < 150, String(calls));
  await page.evaluate(() => VROOM.game.go('home'));
  await page.evaluate(() => VROOM.game.go('garage'));
  await page.waitForTimeout(200);
  check('garage: leaving and re-entering is clean', await page.evaluate(() => document.querySelectorAll('#garageHud .gx-tab').length === 8 && !!VROOM.scenes.garage.rig));
  check('no console errors', errors.length === 0, errors.slice(0, 4).join(' | '));
  await browser.close();

  const rm = await open('scene=garage', { reducedMotion: 'reduce' });
  await rm.page.waitForTimeout(300);
  const a = await rm.page.evaluate(() => VROOM.scenes.garage.bay.turntable.rotation.y);
  await rm.page.waitForTimeout(700);
  const b = await rm.page.evaluate(() => VROOM.scenes.garage.bay.turntable.rotation.y);
  check('reduced motion parks the turntable', a === b, a + ' ' + b);
  check('no console errors under reduced motion', rm.errors.length === 0, rm.errors.slice(0, 3).join(' | '));
  await rm.browser.close();
  done();
})().catch(e => { console.error(e); process.exit(1); });
