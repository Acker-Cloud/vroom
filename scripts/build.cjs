#!/usr/bin/env node
/* build: assembles the single shipped index.html from src/.
     src/shell.html     CSS and scene markup, with the @@THREE@@ and @@MODULES@@ placeholders
     node_modules/three three.js r170, inlined as window.THREE inside an IIFE
     src/*.js           the game modules in ORDER, each wrapped as (function (VROOM) { ... })(VROOM)
                        and shipped in its own <script> so a broken module cannot stop the others loading
   Usage: node scripts/build.cjs [--out path] [--mine owner]
     --out preview/cars.html   write somewhere other than index.html (each builder previews its own file)
     --mine cars               take only that owner's files from the working tree and every other module
                               from git HEAD, so a teammate's half-finished file cannot break your preview
   The library half (ORDER, OWNERS, gameSource, simSource, build) is shared with tests/sim.cjs and tests/lint.cjs. */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
/* load order. sim: true marks the deterministic region (DOM-free, THREE-free; runs in Node and ports to Swift). */
const ORDER = [
  { f: 'src/contracts.js',    owner: 'integrator', sim: true },
  { f: 'src/dmath.js',        owner: 'integrator', sim: true },
  { f: 'src/catalog.js',      owner: 'cars',       sim: true },
  { f: 'src/levels.js',       owner: 'worlds',     sim: true },
  { f: 'src/sim.js',          owner: 'physics',    sim: true },
  { f: 'src/monsters.sim.js', owner: 'monsters',   sim: true },
  { f: 'src/save.js',         owner: 'integrator' },
  { f: 'src/audio.js',        owner: 'ui' },
  { f: 'src/fx.js',           owner: 'worlds' },
  { f: 'src/cars.js',         owner: 'cars' },
  { f: 'src/worlds.js',       owner: 'worlds' },
  { f: 'src/monsters.js',     owner: 'monsters' },
  { f: 'src/ui.js',           owner: 'ui' },
  { f: 'src/game.js',         owner: 'integrator' },
];
const SHELL = { f: 'src/shell.html', owner: 'ui' };
const OWNERS = [...new Set(ORDER.map(m => m.owner))];

let mine = null;   /* --mine owner: other owners' files come from HEAD */
function read(m) {
  if (mine && m.owner !== mine) {
    try { return execFileSync('git', ['show', 'HEAD:' + m.f], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); } catch (e) { /* not committed yet: fall through */ }
  }
  return fs.readFileSync(path.join(ROOT, m.f), 'utf8');
}
const wrap = (m, src) => `/* ---- ${m.f} ---- */\n(function (VROOM) {\n'use strict';\n${src.trim()}\n})(VROOM);\n/* ---- end of ${m.f} ---- */\n`;
function modules() { return ORDER.map(m => ({ ...m, src: read(m) })); }
function buildId(mods) {
  return require('crypto').createHash('sha1').update(mods.map(m => m.src).join('\0')).digest('hex').slice(0, 12);
}
const prelude = id => `const BUILD_ID = '${id}';\nconst VROOM = window.VROOM = { BUILD_ID };\n`;
/* the deterministic region alone, for Node: run it with new Function('VROOM', simSource())({}) */
function simSource() {
  return '// #region sim\n' + modules().filter(m => m.sim).map(m => wrap(m, m.src)).join('') + '// #endregion sim\n';
}
/* every module as one script, as lint sees it (line numbers map back through the ---- markers) */
function gameSource() {
  const mods = modules();
  let out = prelude(buildId(mods)), open = false;
  for (const m of mods) {
    if (m.sim && !open) { out += '// #region sim\n'; open = true; }
    if (!m.sim && open) { out += '// #endregion sim\n'; open = false; }
    out += wrap(m, m.src);
  }
  return out;
}
function threeSource() {
  /* three's package `exports` hides build/, so read the file by path */
  const src = fs.readFileSync(path.join(ROOT, 'node_modules', 'three', 'build', 'three.module.min.js'), 'utf8').trim();
  const rev = (src.match(/const \w+="(\d+)"/) || [])[1];
  const m = src.match(/export\s*\{([^}]*)\}\s*;?\s*$/);
  if (!m || !rev) throw new Error('build: unexpected three.module.min.js shape');
  const pairs = m[1].split(',').map(s => s.trim()).filter(Boolean).map(s => {
    const [local, , exported] = s.split(/\s+/);
    return `${exported || local}:${local}`;
  });
  const body = src.slice(0, m.index) + `window.THREE=Object.freeze({${pairs.join(',')}});`;
  if (/\bexport\s*\{/.test(body) || /<\/script/i.test(body)) throw new Error('build: three body still has an export or a closing script tag');
  return `/* three.js r${rev}, MIT, Copyright 2010-2024 Three.js Authors */\n(function(){${body}})();`;
}
function build() {
  const shell = read(SHELL), mods = modules();
  if (!shell.includes('/* @@THREE@@ */') || !shell.includes('<!-- @@MODULES@@ -->')) throw new Error('build: placeholders missing from src/shell.html');
  for (const m of mods) if (/<\/script/i.test(m.src)) throw new Error(`build: ${m.f} contains a closing script tag`);
  const scripts = `<script>\n${prelude(buildId(mods))}</script>\n` + mods.map(m => `<script>\n${wrap(m, m.src)}</script>`).join('\n');
  return shell.replace('/* @@THREE@@ */', () => threeSource()).replace('<!-- @@MODULES@@ -->', () => scripts);
}
module.exports = { ORDER, OWNERS, SHELL, ROOT, gameSource, simSource, build, setMine: o => { mine = o; } };

if (require.main === module) {
  const args = process.argv.slice(2), val = f => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };
  mine = val('--mine');
  if (mine && !OWNERS.includes(mine)) { console.error(`build: --mine must be one of ${OWNERS.join(', ')}`); process.exit(2); }
  const out = path.resolve(ROOT, val('--out') || 'index.html');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  /* a page built elsewhere (preview/x.html) still finds the root's manifest and icons */
  const up = path.relative(path.dirname(out), ROOT).split(path.sep).join('/');
  const html = up ? build().replace(/href="(manifest\.webmanifest|docs\/)/g, (m, p) => `href="${up}/${p}`) : build();
  fs.writeFileSync(out, html);
  console.log(`build: ${path.relative(ROOT, out)} (${(html.length / 1024).toFixed(0)} KB${mine ? ', only ' + mine + ' from the working tree' : ''})`);
}
