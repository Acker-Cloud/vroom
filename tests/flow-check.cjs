/* flow-check: the whole game wired together. Owner: integrator.
   Node half: a race's packed inputs survive save.encodeReplay / decodeReplay and replay bit-exact (the ghost).
   Browser half: deep links (?garage, ?level, ?world, ?scene=race&world&boss), the scene chain
   splash -> home -> garage -> map -> race -> results through the real plates, a bot race banks its result
   (time, replay, payout, next level), the ghost of that run drives the same line to the same finish tick,
   no fail states (a crane respawn and a monster knock never end a run), results and pause show no words
   and keep tap targets, reduced motion keeps the camera still, and a v12 save and a v12 save code keep
   their stars and unlocks in the real page. */
'use strict';
const { check, done, open, visibleLetters, smallTargets, loadSim } = require('./lib.cjs');
const fx = require('./fixtures/v12-saves.json');

/* ---- Node: the ghost is a bit-exact replay ---- */
{
  const V = loadSim(), S = V.sim, C = V.contracts;
  const fs = require('fs'), path = require('path');
  const saveSrc = fs.readFileSync(path.join(__dirname, '../src/save.js'), 'utf8');
  new Function('VROOM', `(function (VROOM) { 'use strict';\n${saveSrc}\n})(VROOM);`)(V);
  const P = () => S.carParams({ ...V.catalog.stats({ body: 'monster', wheels: 'monster', extras: {} }), cls: 'brute' }, {});
  let worst = 0;
  const bad = [];
  for (const n of [3, 10, 47, 88]) {
    const spec = V.levels.level(n), track = S.buildTrack(spec);
    const a = S.newRace(track, P(), { seed: spec.seed, mode: 'race' }), packed = [];
    while (!a.finished && a.tick < C.SIM_HZ * 400) {
      const inp = S.autopilot(a, 0.8);
      packed.push(S.packInput(inp));
      S.step(a, inp); a.events.length = 0;
    }
    const rle = V.save.encodeReplay(packed), back = V.save.decodeReplay(rle);
    const b = S.newRace(track, P(), { seed: spec.seed, mode: 'race' });
    for (const x of back) { S.step(b, S.unpackInput(x)); b.events.length = 0; }
    worst = Math.max(worst, rle.length);
    if (!(a.finished && b.finished && a.finishT === b.finishT && a.car.x === b.car.x && a.car.z === b.car.z && a.starsGot === b.starsGot)) bad.push(n);
  }
  check('a replay of the packed inputs drives the same race to the same bits (the ghost)', bad.length === 0, 'levels ' + bad.join(' '));
  check('replay strings stay under the save cap', worst > 0 && worst < 250000, worst + ' chars');
}

const SAVED = fx.cases.find(c => c.label === 'played');
const stepRace = (page, maxCalls = 4000) => page.evaluate(m => {
  const r = VROOM.scenes.race;
  for (let i = 0; i < m && VROOM.game.current() === 'race' && !r.st.finished; i++) r.update(0.07, i * 0.07);
  return { finished: r.st.finished, t: r.st.finishT, ticks: r.inputs.length };
}, maxCalls);

(async () => {
  /* deep links */
  {
    const { browser, page } = await open('garage');
    check('?garage opens the garage', (await page.evaluate(() => VROOM.game.current())) === 'garage');
    await browser.close();
  }
  {
    const { browser, page, errors } = await open('level=7&bot=1');
    const r = await page.evaluate(() => ({ cur: VROOM.game.current(), n: VROOM.scenes.race.n, world: VROOM.scenes.race.spec.world }));
    check('?level=7 opens the race on level 7', r.cur === 'race' && r.n === 7 && r.world === 1, JSON.stringify(r));
    await page.evaluate(() => VROOM.game.go('home'));
    check('deep link race: no console errors', errors.length === 0, errors.join(' | '));
    await browser.close();
  }
  {
    const { browser, page } = await open('scene=race&world=4&boss&bot=1');
    const r = await page.evaluate(() => ({ n: VROOM.scenes.race.n, boss: !!VROOM.scenes.race.spec.boss, actors: VROOM.scenes.race.st.actors.some(a => a.boss) }));
    check('?scene=race&world=4&boss opens the world 4 finale with its boss', r.n === 40 && r.boss && r.actors, JSON.stringify(r));
    await browser.close();
  }

  /* a v12 save in the real page keeps its stars and unlocks */
  {
    const { browser, page } = await open('nosplash');
    await page.evaluate(s => { localStorage.setItem('vroom.v2.p0', JSON.stringify(s)); localStorage.setItem('vroom.meta', JSON.stringify({ active: 0, avatars: ['pup', null, null] })); }, SAVED.saved);
    await page.reload(); await page.waitForFunction(() => window.booted === true);
    const r = await page.evaluate(() => {
      const S = VROOM.save, P = S.progress;
      return { wallet: P.wallet, cur: P.current, open37: S.levelOpen(37), open38: S.levelOpen(38), r1: P.levels[1] && P.levels[1].rating, n: Object.keys(P.levels).length,
        hover: S.owns('body', 'hover'), dragon: S.owns('body', 'dragon'), disco: S.owns('wheels', 'disco'), galaxy: S.owns('color', 'p:galaxy'), jet: S.owns('extras', 'jetpack'), robot: S.owns('buddy', 'robot'), body: S.state.body };
    });
    const sv = SAVED.saved;
    check('v12 save in the page: wallet, level and every level rating survive', r.wallet === sv.wallet && r.cur === sv.current && r.n === Object.keys(sv.levels).length && r.r1 === sv.levels[1].rating, JSON.stringify(r));
    check('v12 save in the page: unlocks survive (next level open, the one after still locked)', r.open37 && !r.open38);
    check('v12 save in the page: bought machines, wheels, paint, extras and buddies are still owned', r.hover && r.dragon && r.disco && r.galaxy && r.jet && r.robot && r.body === sv.build.body, JSON.stringify(r));
    await page.evaluate(() => VROOM.game.go('map', { world: 4 }));
    await page.waitForTimeout(300);
    const mapLetters = await visibleLetters(page);
    check('v12 save: the map opens on world 4 with no words', mapLetters.length === 0, mapLetters.join(' | '));
    /* a v12 VROOM1 code imported on a fresh profile */
    await page.evaluate(() => { localStorage.clear(); });
    await page.reload(); await page.waitForFunction(() => window.booted === true);
    const data = await page.evaluate(async c => { const d = await VROOM.save.checkCode(c); if (d) VROOM.save.importData(d); return d && d.wallet; }, SAVED.compact);
    await page.reload(); await page.waitForFunction(() => window.booted === true);
    const c = await page.evaluate(() => ({ wallet: VROOM.save.progress.wallet, open: VROOM.save.levelOpen(37), hover: VROOM.save.owns('body', 'hover'), rating: VROOM.save.progress.levels[5] && VROOM.save.progress.levels[5].rating }));
    check('a v12 VROOM1 save code imports: wallet, level ratings, unlocks and parts survive', data === SAVED.saved.wallet && c.wallet === SAVED.saved.wallet && c.open && c.hover && c.rating === SAVED.saved.levels[5].rating, JSON.stringify(c));
    await browser.close();
  }

  /* the scene chain through the real plates, then a race, results and the ghost */
  const { browser, page, errors } = await open('');
  await page.waitForFunction(() => VROOM.game.current() === 'home', null, { timeout: 15000 }).catch(() => {});
  check('splash hands over to home', (await page.evaluate(() => VROOM.game.current())) === 'home');
  const idle = () => page.waitForFunction(() => { const s = document.getElementById('shutter'); return !s || s.className === ''; }, null, { timeout: 10000 }).catch(() => {});
  const press = async sel => (await idle(), page.evaluate(s => { const b = document.querySelector(s); if (!b) return false; b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 })); return true; }, sel));
  const waitScene = id => page.waitForFunction(i => VROOM.game.current() === i, id, { timeout: 15000 }).then(() => true, () => false);
  const plate = aria => `#homeHud button[aria-label="${aria}"]`;
  await press(plate('garage'));
  check('home -> garage through its plate', await waitScene('garage'));
  await page.evaluate(() => VROOM.game.go('home'));
  await press(plate('map'));
  check('home -> map through its plate', await waitScene('map'));
  await page.evaluate(() => VROOM.game.go('home'));
  const goPlate = await press(plate('go'));
  check('home GO starts the next race', goPlate && await waitScene('race'));
  const lvl = await page.evaluate(() => VROOM.scenes.race.n);
  check('GO races the current level', lvl === 1, String(lvl));
  /* the countdown holds the sim; then let the autopilot drive */
  const held = await page.evaluate(() => VROOM.ui.counting() && VROOM.scenes.race.st.tick === 0);
  check('the countdown holds the race at tick 0', held);
  await page.waitForFunction(() => !VROOM.ui.counting(), null, { timeout: 15000 }).catch(() => {});
  await page.evaluate(() => { VROOM.scenes.race.bot = true; });
  const run1 = await stepRace(page);
  check('the race finishes (the bot drove level 1 to the flag)', run1.finished && run1.t > 20, JSON.stringify(run1));
  check('race -> results', await waitScene('results'));
  const saved = await page.evaluate(() => { const P = VROOM.save.progress, lv = P.levels[1]; return { t13: lv && lv.t13, rp: !!(lv && lv.replay && lv.replay.b), ticks: lv && lv.replay && lv.replay.ticks, wallet: P.wallet, cur: P.current, json: !!JSON.parse(localStorage.getItem('vroom.v2.p0')).levels[1].replay }; });
  check('results bank the run: best time, replay with its build, payout, the next level', saved.t13 === run1.t && saved.rp && saved.ticks === run1.ticks && saved.wallet > 0 && saved.cur === 2 && saved.json, JSON.stringify(saved));
  await page.waitForTimeout(2500);
  const rl = await visibleLetters(page), rs = await smallTargets(page);
  check('results: no words on screen', rl.length === 0, rl.join(' | '));
  check('results: tap targets >= 64 px', rs.length === 0, JSON.stringify(rs));
  const next = await page.evaluate(() => { const b = document.querySelector('#resultsHud button[aria-label="next"]'); if (!b) return false; b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 })); return true; });
  check('results NEXT races level 2', next && await waitScene('race') && (await page.evaluate(() => VROOM.scenes.race.n)) === 2);

  /* the ghost: race level 1 again, its twin must replay the stored run to the same finish */
  await page.evaluate(() => VROOM.game.startRace(1));
  await page.waitForFunction(() => !VROOM.ui.counting(), null, { timeout: 15000 }).catch(() => {});
  const g0 = await page.evaluate(() => { const g = VROOM.scenes.race.ghost; return g ? { n: g.inputs.length, vis: g.rig.group.parent === VROOM.scenes.race.world.scene } : null; });
  check('a second run of the level races a ghost of the best run', !!g0 && g0.n === run1.ticks && g0.vis, JSON.stringify(g0));
  /* no fail states, mid race: drop the car into a fall and let a monster-free crane bring it back */
  const fall = await page.evaluate(() => {
    const r = VROOM.scenes.race, st = r.st;
    for (let i = 0; i < 40; i++) r.update(0.07, i);
    st.car.y -= 60; st.car.vy = -20;
    let resp = 0;
    for (let i = 0; i < 400 && !resp; i++) { r.update(0.07, i); if (st.stats.respawns > 0) resp = 1; }
    for (let i = 0; i < 60; i++) r.update(0.07, i);
    return { resp, scene: VROOM.game.current(), speedOk: Number.isFinite(st.car.speed), finished: st.finished };
  });
  check('no fail state: a fall is caught by the crane and the race goes on', fall.resp === 1 && fall.scene === 'race' && fall.speedOk, JSON.stringify(fall));
  await page.evaluate(() => { VROOM.scenes.race.bot = true; });
  const g1 = await page.evaluate(() => {
    const r = VROOM.scenes.race, g = r.ghost;
    for (let i = 0; i < 4000 && g.i < g.inputs.length; i++) r.update(0.07, i);
    return { done: g.st.finished, t: g.st.finishT };
  });
  check('the ghost reaches the flag at the stored best time, bit for bit', g1.done && g1.t === run1.t, JSON.stringify(g1) + ' vs ' + run1.t);
  /* pause shows no words and keeps its targets */
  await page.evaluate(() => { const b = document.getElementById('hPause'); b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 })); });
  await page.waitForTimeout(300);
  const pl = await visibleLetters(page), ps = await smallTargets(page);
  check('pause: no words, tap targets >= 64 px', pl.length === 0 && ps.length === 0 && (await page.evaluate(() => VROOM.ui.paused())), pl.join(' | ') + JSON.stringify(ps));
  const tick = await page.evaluate(() => { const r = VROOM.scenes.race, t0 = r.st.tick; for (let i = 0; i < 20; i++) r.update(0.07, i); return r.st.tick - t0; });
  check('pause holds the sim', tick === 0, String(tick));
  await page.evaluate(() => VROOM.game.go('home'));
  check('no console errors through the whole flow', errors.length === 0, errors.slice(0, 5).join(' | '));
  await browser.close();

  /* reduced motion: a monster knock or a hard landing never shakes the camera */
  {
    const { browser: b2, page: p2 } = await open('level=10&bot=1', { reducedMotion: 'reduce' });
    const sh = await p2.evaluate(() => { const r = VROOM.scenes.race; r.bump(1); r.route({ type: 'land', airT: 3, hard: 1 }); return r.shake; });
    check('reduced motion: the race camera never shakes', sh === 0, String(sh));
    await b2.close();
  }
  done();
})().catch(e => { console.error(e); process.exit(1); });
