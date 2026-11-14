#!/usr/bin/env node
/* shot: PNG screenshots of any scene at 1024x768, for eyeballing art. Owner: integrator.
   Builds preview/shot.html, serves the repo root on a free port, opens each requested view and writes
   preview/shots/<name>.png.
   Usage: npm run shot -- [--scene race] [--level 12] [--bot] [--wait 2500] [--name foo] [--mine cars]
          npm run shot -- --worlds        (one race shot per world, levels 1, 11, ... 111, autopilot driving) */
'use strict';
const fs = require('fs'), path = require('path'), http = require('http');
const { spawnSync } = require('child_process');
const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2), val = (f, d) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : d; };

const bargs = [path.join(__dirname, 'build.cjs'), '--out', 'preview/shot.html'];
if (val('--mine')) bargs.push('--mine', val('--mine'));
const b = spawnSync(process.execPath, bargs, { cwd: ROOT, encoding: 'utf8' });
if (b.status !== 0) { console.error(b.stderr || b.stdout); process.exit(1); }

const views = args.includes('--worlds')
  ? Array.from({ length: 12 }, (_, i) => ({ name: 'world' + (i + 1), q: `scene=race&level=${i * 10 + 1}&bot=1` }))
  : [{ name: val('--name', val('--scene', 'home') + (val('--level') ? '-' + val('--level') : '')), q: `scene=${val('--scene', 'home')}${val('--level') ? '&level=' + val('--level') : ''}${args.includes('--bot') ? '&bot=1' : ''}` }];
const server = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200); fs.createReadStream(p).pipe(res);
});
server.listen(0, '127.0.0.1', async () => {
  const pw = require('playwright-core');
  const browser = await pw.chromium.launch({ executablePath: process.env.CHROMIUM || pw.chromium.executablePath(),
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  page.on('pageerror', e => console.error('pageerror', String(e)));
  fs.mkdirSync(path.join(ROOT, 'preview', 'shots'), { recursive: true });
  for (const v of views) {
    await page.goto(`http://127.0.0.1:${server.address().port}/preview/shot.html?${v.q}`);
    await page.waitForFunction(() => window.booted === true, null, { timeout: 20000 });
    await page.waitForTimeout(+val('--wait', 2500));
    const out = path.join(ROOT, 'preview', 'shots', v.name + '.png');
    await page.screenshot({ path: out });
    console.log('shot: ' + path.relative(ROOT, out));
  }
  await browser.close();
  server.close();
});
