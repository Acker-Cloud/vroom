/* attract-check: the home screen's attract mode. After 20 s with no input on home, the autopilot races a level
   of the world of the day behind the menu (the menu plates stay up, no words, targets >= 64 px); the camera cuts
   between shots; a key or a press returns to the podium and the waking press fires nothing; an open overlay or
   leaving home stops it; reduced motion keeps one steady shot; finishing a run rolls on to the next level.
   Owner: ui. */
'use strict';
const { check, done, open, visibleLetters, smallTargets } = require('./lib.cjs');

const probe = page => page.evaluate(() => VROOM.ui.attract.probe());
const waitOn = (page, on, timeout = 30000) => page.waitForFunction(v => VROOM.ui.attract.on() === v, on, { timeout }).then(() => true, () => false);

(async () => {
  /* ---- the idle clock: 20 s of nothing on home ---- */
  {
    const { browser, page, errors } = await open('nosplash');
    check('home is up', (await page.evaluate(() => VROOM.game.current())) === 'home');
    check('the idle threshold is 20 s', (await page.evaluate(() => VROOM.ui.attract.IDLE)) === 20);
    await page.waitForTimeout(8000);
    const early = await probe(page);
    check('no attract before the idle threshold', !early.on, JSON.stringify(early));
    await page.mouse.move(100, 100); await page.mouse.move(300, 300);
    const reset = await page.evaluate(() => VROOM.ui.attract.idle());
    check('mouse movement resets the idle clock', reset < 1, reset.toFixed(2));
    const t0 = Date.now();
    const on = await waitOn(page, true, 40000);
    const took = (Date.now() - t0) / 1000;
    check('attract starts after about 20 s idle', on && took > 17 && took < 32, took.toFixed(1) + ' s');
    const p0 = await probe(page);
    await page.waitForTimeout(5000);
    const p1 = await probe(page);
    const w = await page.evaluate(() => VROOM.ui.worldOfDay());
    check('the demo races a level of the world of the day', p0.n >= (w - 1) * 10 + 1 && p0.n <= w * 10, JSON.stringify({ w, n: p0.n }));
    check('the bot drives: race time and distance go up', p1.t > p0.t + 0.3 && p1.s > p0.s + 3, JSON.stringify({ p0, p1 }));
    const ui = await page.evaluate(() => ({ cls: document.getElementById('home').classList.contains('attract'),
      plates: ['go', 'garage', 'map', 'album', 'settings', 'profile'].filter(a => !document.querySelector(`#home button[aria-label="${a}"]`)) }));
    check('the menu stays up over the demo', ui.cls && ui.plates.length === 0, JSON.stringify(ui));
    const letters = await visibleLetters(page), small = await smallTargets(page);
    check('attract: no words on screen', letters.length === 0, letters.join(' | '));
    check('attract: tap targets >= 64 px', small.length === 0, JSON.stringify(small));
    await page.screenshot({ path: require('path').join(__dirname, '..', 'preview', 'shots', 'r2-ui', 'attract-idle.png') }).catch(() => {});

    /* a key wakes it, and nothing else happens */
    await page.keyboard.press('Enter');
    await page.waitForTimeout(200);
    const k = await page.evaluate(() => ({ on: VROOM.ui.attract.on(), scene: VROOM.game.current(), idle: VROOM.ui.attract.idle(), cls: document.getElementById('home').classList.contains('attract') }));
    check('a key returns to the podium (scene stays home)', !k.on && k.scene === 'home' && !k.cls && k.idle < 1, JSON.stringify(k));

    /* a press on GO while the demo runs only wakes the screen */
    await page.evaluate(() => VROOM.ui.attract.start());
    check('attract can be started on demand', await waitOn(page, true, 5000));
    const r = await page.evaluate(() => document.getElementById('homeGo').getBoundingClientRect().toJSON());
    await page.mouse.click(r.x + r.width / 2, r.y + r.height / 2);
    await page.waitForTimeout(800);
    const g = await page.evaluate(() => ({ on: VROOM.ui.attract.on(), scene: VROOM.game.current(), shutter: (document.getElementById('shutter') || {}).className || '' }));
    check('the waking press on GO is swallowed (no race starts)', !g.on && g.scene === 'home', JSON.stringify(g));
    await page.mouse.click(r.x + r.width / 2, r.y + r.height / 2);
    check('the next press on GO races as normal', await page.waitForFunction(() => VROOM.game.current() === 'race', null, { timeout: 15000 }).then(() => true, () => false));
    check('no console errors', errors.length === 0, errors.join(' | '));
    await browser.close();
  }

  /* ---- ?attract: cuts, overlays, leaving home, the next run ---- */
  {
    const { browser, page, errors } = await open('nosplash&attract');
    check('?attract starts the demo after a second', await waitOn(page, true, 10000));
    const shots = new Set();
    for (let i = 0; i < 24; i++) { shots.add((await probe(page)).shot); await page.waitForTimeout(500); }
    check('the camera cuts between at least three shots in 12 s', shots.size >= 3, [...shots].join(' '));
    await page.screenshot({ path: require('path').join(__dirname, '..', 'preview', 'shots', 'r2-ui', 'attract-cut.png') }).catch(() => {});
    /* a finished demo run rolls on to the next level (the finale on odd runs) */
    const n0 = (await probe(page)).n;
    const rolled = await page.evaluate(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms)), a = VROOM.ui.attract;
      /* skip ahead: run the demo's own sim to its flag */
      const S = VROOM.sim, st = a._state();
      for (let i = 0; i < 120 * 200 && !st.finished; i++) { S.step(st, S.autopilot(st, 1)); st.events.length = 0; }
      for (let i = 0; i < 100 && a.probe().run === 0; i++) await wait(100);
      return a.probe();
    });
    const w = await page.evaluate(() => VROOM.ui.worldOfDay());
    check('a finished demo rolls on to the world finale', rolled.run === 1 && rolled.n === w * 10 && rolled.on, JSON.stringify({ n0, rolled }));
    await page.waitForTimeout(1500);
    await page.screenshot({ path: require('path').join(__dirname, '..', 'preview', 'shots', 'r2-ui', 'attract-boss.png') }).catch(() => {});
    await page.evaluate(() => { VROOM.ui.attract.stop(); document.querySelector('#home button[aria-label="settings"]').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 })); });
    await page.waitForTimeout(2500);
    check('an open overlay keeps the demo off', !(await page.evaluate(() => VROOM.ui.attract.on())));
    await page.evaluate(() => document.querySelector('#ovl .close').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 })));
    await page.waitForTimeout(800);
    await page.evaluate(() => { VROOM.game.go('map'); });
    await page.waitForTimeout(300);
    await page.evaluate(() => { VROOM.game.go('home'); });
    check('back on home the demo returns (?attract)', await waitOn(page, true, 10000));
    await page.evaluate(() => VROOM.game.go('map'));
    await page.waitForTimeout(400);
    const left = await page.evaluate(() => ({ on: VROOM.ui.attract.on(), scene: VROOM.game.current(), st: !!VROOM.ui.attract._state() }));
    check('leaving home stops the demo and frees it', !left.on && left.scene === 'map' && !left.st, JSON.stringify(left));
    check('no console errors', errors.length === 0, errors.join(' | '));
    await browser.close();
  }

  /* ---- reduced motion: one steady chase shot ---- */
  {
    const { browser, page, errors } = await open('nosplash&attract', { reducedMotion: 'reduce' });
    await waitOn(page, true, 10000);
    const shots = new Set();
    for (let i = 0; i < 14; i++) { shots.add((await probe(page)).shot); await page.waitForTimeout(500); }
    check('reduced motion: the demo holds one chase shot (no cuts)', shots.size === 1 && shots.has('chase'), [...shots].join(' '));
    check('no console errors (reduced motion)', errors.length === 0, errors.join(' | '));
    await browser.close();
  }
  done();
})().catch(e => { console.error(e); process.exit(1); });
