#!/usr/bin/env node
/* run-all: builds preview/test.html from src/, serves the repo root on a free port, runs every Node suite
   (sim.cjs, *-check.cjs that need no browser) and every browser suite (*-check.cjs), prints a summary
   and exits non-zero if anything failed. Owner: integrator. Suites are discovered by name, so a builder
   adds tests/<area>-check.cjs without touching this file.
   Flags: --only boot-check,sim   --verbose   VROOM_URL=... to test a page you already serve. */
'use strict';
const fs = require('fs'), path = require('path'), http = require('http');
const { spawnSync, spawn } = require('child_process');
const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2), val = f => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };
const only = val('--only') ? val('--only').split(',') : null, verbose = args.includes('--verbose');

const b = spawnSync(process.execPath, [path.join(ROOT, 'scripts/build.cjs'), '--out', 'preview/test.html'], { cwd: ROOT, encoding: 'utf8' });
if (b.status !== 0) { console.error(b.stderr || b.stdout); process.exit(1); }

const suites = ['sim.cjs', ...fs.readdirSync(__dirname).filter(f => f.endsWith('-check.cjs')).sort()]
  .filter(f => !only || only.includes(f.replace(/\.cjs$/, '')));
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((req, res) => {
  let p = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  /* preview pages link manifest.webmanifest and docs/icons relative to themselves: serve the root copies */
  if (!fs.existsSync(p) && p.startsWith(path.join(ROOT, 'preview') + path.sep)) p = path.join(ROOT, path.relative(path.join(ROOT, 'preview'), p));
  if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': TYPES[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});
server.listen(0, '127.0.0.1', async () => {
  const url = process.env.VROOM_URL || `http://127.0.0.1:${server.address().port}/preview/test.html`;
  const rows = [];
  for (const f of suites) {
    const t0 = Date.now();
    const out = await new Promise(resolve => {
      const p = spawn(process.execPath, [path.join(__dirname, f)], { cwd: __dirname, env: { ...process.env, VROOM_URL: url } });
      let log = '';
      p.stdout.on('data', d => { log += d; if (verbose) process.stdout.write(d); });
      p.stderr.on('data', d => { log += d; if (verbose) process.stderr.write(d); });
      p.on('close', code => resolve({ code, log }));
    });
    const m = out.log.match(/(\d+)\/(\d+) passed/);
    rows.push({ f, ok: out.code === 0, tally: m ? `${m[1]}/${m[2]}` : '-', s: ((Date.now() - t0) / 1000).toFixed(1) });
    if (out.code !== 0 && !verbose) console.log(`---- ${f} ----\n` + out.log.split('\n').filter(l => !l.startsWith('PASS')).join('\n'));
  }
  server.close();
  for (const r of rows) console.log(`${r.ok ? 'ok  ' : 'FAIL'}  ${r.f.padEnd(28)} ${r.tally.padStart(9)}  ${r.s}s`);
  const bad = rows.filter(r => !r.ok).length;
  console.log(`\n${rows.length - bad}/${rows.length} suites passed`);
  process.exit(bad ? 1 : 0);
});
