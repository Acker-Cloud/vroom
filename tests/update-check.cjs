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
  check('the shipped page carries APP_VERSION 13.0.0', ver === '13.0.0' && html.includes("APP_VERSION = '13.0.0'"), ver);
  let serveNew = false, reloaded = false;
  await page.route(/\?v=\d+/, route => {
    if (route.request().resourceType() === 'document') { reloaded = true; return route.continue(); }
    route.fulfill({ status: 200, contentType: 'text/html', body: serveNew ? html.replace("APP_VERSION = '13.0.0'", "APP_VERSION = '13.0.1'") : html });
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
  await browser.close();
  done();
})().catch(e => { console.error(e); process.exit(1); });
