#!/usr/bin/env node
/* doc-shots: regenerates the README screenshots in docs/ from a fresh build. Owner: integrator.
   Builds preview/docs.html, serves the repo root on a free port, seeds a mid-game save (worlds 1 to 7 open,
   six bosses down, a dressed-up machine) and captures splash, home, garage, map and a race in eight worlds
   (two of them boss chases) at the native 1200x700 stage, with the autopilot driving.
   Usage: node scripts/doc-shots.cjs [--only home,race-foundry] [--out docs]
   Needs playwright-core and a Chromium (CHROMIUM=/path or playwright's own download). */
'use strict';
const fs = require('fs'), path = require('path'), http = require('http');
const { spawnSync } = require('child_process');
const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2), val = (f, d) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : d; };
const only = val('--only') ? val('--only').split(',') : null, OUT = path.resolve(ROOT, val('--out', 'docs'));

const b = spawnSync(process.execPath, [path.join(__dirname, 'build.cjs'), '--out', 'preview/docs.html'], { cwd: ROOT, encoding: 'utf8' });
if (b.status !== 0) { console.error(b.stderr || b.stdout); process.exit(1); }

/* the save every shot boots with */
const levels = {};
for (let n = 1; n <= 64; n++) levels[n] = { best: 12, rating: 1 + (n % 3), tier: ['S', 'A', 'B', 'A'][n % 4], t13: 60 + (n % 9) };
const SAVE = {
  build: { body: 'tusk', wheels: 'spike', color: 'm:molten', buddy: 'gremlin', decal: 'skull', number: '13', extras: { rollcage: true, sidepipes: true, searchlights: true } },
  wallet: 2400, current: 65, damage: 1, levels, bosses: [1, 2, 3, 4, 5, 6], badges: ['jump', 'clean', 's', 'world', 'buy', 'boss', 'air'],
  owned: { body: ['tusk', 'cinder', 'police'], wheels: ['spike', 'chain'], color: ['m:molten', 'm:chrome'], extras: ['rollcage', 'sidepipes', 'searchlights'], buddy: ['gremlin'], decal: ['skull'] },
  upgrades: { engine: 2, armor: 1, magnet: 0, tank: 1, springs: 1 }, ctrl: { mode: 0, sens: 2 },
};
const SHOTS = [
  { name: 'splash', q: 'nosplash&scene=splash', wait: 1900 },
  { name: 'home', q: 'nosplash&titleWorld=9', wait: 4000 },
  { name: 'garage', q: 'garage', wait: 4500 },
  { name: 'map', q: 'world=5', wait: 3500 },
  { name: 'race-foundry', q: 'level=4&bot=1', wait: 9000 },
  { name: 'race-neon', q: 'level=23&bot=1', wait: 10000 },
  { name: 'race-frost', q: 'level=44&bot=1', wait: 8000 },
  { name: 'race-orbit', q: 'level=73&bot=1', wait: 9000 },
  { name: 'race-magma', q: 'level=85&bot=1', wait: 11000 },
  { name: 'race-abyss', q: 'level=104&bot=1', wait: 9000 },
  { name: 'boss-foundry', q: 'level=10&bot=1', boss: true, wait: 30000 },
  { name: 'boss-citadel', q: 'level=120&bot=1', boss: true, wait: 40000 },
].filter(s => !only || only.includes(s.name));

const server = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': p.endsWith('.html') ? 'text/html' : 'application/octet-stream' }); fs.createReadStream(p).pipe(res);
});
server.listen(0, '127.0.0.1', async () => {
  const pw = require('playwright-core');
  const browser = await pw.chromium.launch({ executablePath: process.env.CHROMIUM || pw.chromium.executablePath(),
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
  const base = `http://127.0.0.1:${server.address().port}/preview/docs.html`;
  fs.mkdirSync(OUT, { recursive: true });
  for (const s of SHOTS) {
    const page = await browser.newPage({ viewport: { width: 1200, height: 700 } });
    page.on('pageerror', e => console.error('pageerror', s.name, String(e)));
    await page.addInitScript(save => {
      try { localStorage.setItem('vroom.v2.p0', JSON.stringify(save)); localStorage.setItem('vroom.meta', JSON.stringify({ active: 0, avatars: ['dino', null, null] })); } catch (e) { /* first paint */ }
    }, SAVE);
    await page.goto(base + '?' + s.q);
    await page.waitForFunction(() => window.booted === true, null, { timeout: 30000 });
    if (s.boss) {
      /* wait for the boss to surge or attack beside the car, so it is in frame */
      await page.waitForFunction(() => { const r = VROOM.scenes.race, a = r && r.st && r.st.actors.find(x => x.boss); return a && r.st.t > 12 && a.surgeT > 0.9 && Math.abs(a.s - r.st.car.s) < 12; }, null, { timeout: s.wait, polling: 50 }).catch(() => {});
      await page.waitForTimeout(250);
    } else await page.waitForTimeout(s.wait);
    const out = path.join(OUT, s.name + '.png');
    await page.screenshot({ path: out });
    console.log('doc-shots: ' + path.relative(ROOT, out));
    await page.close();
  }
  await browser.close();
  server.close();
});
