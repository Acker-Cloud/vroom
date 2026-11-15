/* boot-check: the page boots at iPad landscape with no console errors and no network beyond the page,
   three.js r170 is inlined, every module published its contract API, the stage scales to fit, the splash
   is first and hands over to home, no words on screen but the logo, tap targets >= 64 px, portrait asks
   to rotate, and every scene can be entered and left cleanly. Owner: integrator. */
'use strict';
const { check, done, open, visibleLetters, smallTargets } = require('./lib.cjs');

(async () => {
  const { browser, page, errors, requests } = await open();
  await page.waitForTimeout(300);

  const t = await page.evaluate(() => ({ rev: window.THREE && THREE.REVISION, renderer: typeof (window.THREE && THREE.WebGLRenderer) }));
  check('three.js r170 is inlined as window.THREE', t.rev === '170' && t.renderer === 'function', JSON.stringify(t));
  const origin = new URL(page.url()).origin;
  const foreign = requests.filter(u => !u.startsWith(origin) && !u.startsWith('data:') && !u.startsWith('blob:'));
  check('no network requests beyond the page origin', foreign.length === 0, foreign.join(' '));

  const missing = await page.evaluate(() => {
    const out = [], api = VROOM.contracts.MODULE_API;
    for (const mod in api) for (const name of api[mod]) if (!VROOM[mod] || VROOM[mod][name] === undefined) out.push(mod + '.' + name);
    for (const id of VROOM.contracts.SCENE_IDS) if (!VROOM.scenes[id]) out.push('scenes.' + id);
    return out;
  });
  check('every module publishes its contract API', missing.length === 0, missing.join(' '));
  const ver = await page.evaluate(() => VROOM.contracts.APP_VERSION);
  check('APP_VERSION is 14.0.0', ver === '14.0.0', ver);
  const metas = await page.evaluate(() => ({ vp: (document.querySelector('meta[name=viewport]') || {}).content || '', app: !!document.querySelector('meta[name=apple-mobile-web-app-capable]'), man: !!document.querySelector('link[rel=manifest]') }));
  check('iPad shell: no-zoom viewport, home-screen app metas, manifest (v12 feel-check)', /user-scalable=no/.test(metas.vp) && /viewport-fit=cover/.test(metas.vp) && metas.app && metas.man, JSON.stringify(metas));

  const st = await page.evaluate(() => { const r = document.getElementById('stage').getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; });
  check('stage scales 1200x700 to fit 1024x768', st.w === 1024 && st.h === 597, JSON.stringify(st));
  check('splash is the first scene', (await page.evaluate(() => VROOM.game.current())) === 'splash');
  const logo = await page.evaluate(() => !!document.querySelector('#splash [data-logo]'));
  check('the splash shows the VROOM logo (data-logo)', logo);
  await page.waitForFunction(() => VROOM.game.current() === 'home', null, { timeout: 15000 }).catch(() => {});
  check('splash hands over to home', (await page.evaluate(() => VROOM.game.current())) === 'home');

  for (const id of ['home', 'garage', 'map', 'race']) {
    await page.evaluate(i => i === 'race' ? VROOM.game.startRace(1) : VROOM.game.go(i), id);
    await page.waitForTimeout(400);
    const letters = await visibleLetters(page), small = await smallTargets(page);
    check(`${id}: no words on screen`, letters.length === 0, letters.join(' | '));
    check(`${id}: tap targets >= 64 px`, small.length === 0, JSON.stringify(small));
  }
  const pixels = await page.evaluate(() => {
    const c = document.getElementById('view'), g = c.getContext('webgl2') || c.getContext('webgl');
    return !!g;
  });
  check('the race renders into #view with WebGL', pixels);
  await page.evaluate(() => VROOM.game.go('home'));

  check('no console errors', errors.length === 0, errors.join(' | '));

  await page.setViewportSize({ width: 768, height: 1024 });
  await page.waitForTimeout(200);
  const rot = await page.evaluate(() => getComputedStyle(document.getElementById('rotate')).display);
  check('portrait shows the rotate overlay', rot !== 'none', rot);
  await browser.close();
  done();
})().catch(e => { console.error(e); process.exit(1); });
