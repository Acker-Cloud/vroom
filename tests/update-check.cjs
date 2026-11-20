/* update-check: the new-version gate, keyed on APP_VERSION. Owner: integrator. Ported from v12's update-check.
   The page re-fetches itself (?v=<time>, no-store) on boot, on return to the foreground and every 10 minutes;
   when the copy on the server carries a different APP_VERSION a hazard-green plate appears on home (never mid-race),
   a quick tap does nothing and a held press saves and reloads with a cache-busting URL. */
'use strict';
const { check, done, open, smallTargets } = require('./lib.cjs');

(async () => {
  const { browser, page, errors } = await open('nosplash');
  const html = await (await page.request.get(page.url().split('?')[0])).text();
  const ver = await page.evaluate(() => VROOM.contracts.APP_VERSION);
  check('the shipped page carries APP_VERSION 14.1.1', ver === '14.1.1' && html.includes("APP_VERSION = '14.1.1'"), ver);
  const num = v => v.split('.').map(Number), newer = (a, b) => { const x = num(a), y = num(b); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i]; return false; };
  check('14.1.1 is above the last hosted 2D build, 13.29.0', newer(ver, '13.29.0') && !newer('13.29.0', ver));
  let serveNew = false, reloaded = false;
  await page.route(/\?v=\d+/, route => {
    if (route.request().resourceType() === 'document') { reloaded = true; return route.continue(); }
    route.fulfill({ status: 200, contentType: 'text/html', body: serveNew ? html.replace("APP_VERSION = '14.1.1'", "APP_VERSION = '14.1.2'") : html });
  });
  const shown = () => page.evaluate(() => { const b = document.getElementById('updateBtn'); return !!b && getComputedStyle(b).display !== 'none'; });
  await page.evaluate(() => VROOM.game.update.check(true));
  check('no gate when the server copy has the same APP_VERSION', !(await shown()));
  serveNew = true;
  await page.evaluate(() => VROOM.game.update.check(true));
  check('the gate appears when a new APP_VERSION is deployed', await shown());
  const small = await smallTargets(page);
  check('the gate plate is a >= 64 px target', small.length === 0, JSON.stringify(small));
  await page.evaluate(() => VROOM.game.startRace(1));
  check('the gate hides during a race', !(await shown()));
  await page.evaluate(() => VROOM.game.go('garage'));
  check('and stays off the garage, where the GO plate lives', !(await shown()));
  await page.evaluate(() => VROOM.game.go('home'));
  check('and comes back on home', await shown());
  const box = await page.locator('#updateBtn').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down(); await page.waitForTimeout(300); await page.mouse.up();
  await page.waitForTimeout(1800);
  check('a quick tap does not reload', !reloaded);
  await page.mouse.down(); await page.waitForTimeout(2300); await page.mouse.up().catch(() => {});
  await page.waitForTimeout(1500);
  check('press and hold reloads the new version with a cache-busting URL', reloaded && /\?v=\d+/.test(page.url()), page.url());
  check('no console errors', errors.length === 0, errors.join(' | '));

  /* the hosted upgrade path: a 13.29 page left open on a phone fingerprints its first <style> + <script> and
     arms its own gate when the server copy differs, so it must see this build as new and load it on a hold */
  const old = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  const oldUrl = new URL('../legacy/v13.29/index.html', page.url().split('?')[0]).href;
  const oldHtml = await (await old.request.get(oldUrl)).text();
  let serveV14 = false;
  await old.route(/\?v=\d+/, route => {
    if (route.request().resourceType() === 'document') return route.fulfill({ status: 200, contentType: 'text/html', body: html });
    route.fulfill({ status: 200, contentType: 'text/html', body: serveV14 ? html : oldHtml });
  });
  await old.goto(oldUrl + '?nosplash');
  await old.waitForFunction(() => typeof checkForUpdate === 'function', null, { timeout: 20000 });
  const oldArmed = () => old.evaluate(async () => { lastUpdateCheck = 0; await checkForUpdate(); return { ready: updateReady, ver: APP_VERSION }; });
  const o1 = await oldArmed();
  check('the hosted 13.29 page boots with no gate while the server still has 13.29', o1.ver === '13.29.0' && !o1.ready, JSON.stringify(o1));
  serveV14 = true;
  const o2 = await oldArmed();
  check('the 13.29 page arms its update gate once 14.1.1 is deployed', o2.ready, JSON.stringify(o2));
  await old.evaluate(() => { const t = document.getElementById('titleGo'); t.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); });
  await old.waitForURL(/\?v=\d+/, { timeout: 8000 }).catch(() => {});
  await old.waitForFunction(() => window.VROOM && VROOM.contracts, null, { timeout: 20000 }).catch(() => {});
  const landed = await old.evaluate(() => window.VROOM && VROOM.contracts ? VROOM.contracts.APP_VERSION : null).catch(() => null);
  check('holding it loads 14.1.1', landed === '14.1.1', String(landed));
  await browser.close();
  done();
})().catch(e => { console.error(e); process.exit(1); });
