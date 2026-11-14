#!/usr/bin/env node
/* lint: writes the game source (every src/*.js module wrapped exactly as scripts/build.cjs ships it) to a
   temp .js file and runs ESLint over it. Findings map back to src/<file>:<line>. Names unused inside the
   script but referenced from the test suites are reported as "external", not as findings.
   Usage: node tests/lint.cjs [--owner cars]   (--owner reports only that owner's files)
   Exit 1 when any real finding remains. Owner: integrator. */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ESLint } = require('eslint');

const ROOT = path.resolve(__dirname, '..');
const { gameSource, ORDER } = require('../scripts/build.cjs');
const args = process.argv.slice(2), oi = args.indexOf('--owner'), owner = oi >= 0 ? args[oi + 1] : null;
const src = gameSource(), lines = src.split('\n');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vroom-lint-'));
const tmp = path.join(dir, 'game.js');
fs.writeFileSync(tmp, src);

const external = new Set();
for (const f of fs.readdirSync(__dirname)) {
  if (!f.endsWith('.cjs') || f === 'lint.cjs') continue;
  for (const m of fs.readFileSync(path.join(__dirname, f), 'utf8').matchAll(/[A-Za-z_$][\w$]*/g)) external.add(m[0]);
}
/* map a line of the assembled source back to the module it came from (the wrapper adds 2 lines) */
function where(line) {
  for (let i = line - 1; i >= 0; i--) {
    if (/^\/\* ---- end of /.test(lines[i]) && i < line - 1) break;
    const m = lines[i].match(/^\/\* ---- (src\/[\w.]+\.js) ---- \*\/$/);
    if (m) return { f: m[1], line: line - i - 3 };
  }
  return { f: 'prelude', line };
}
(async () => {
  const eslint = new ESLint({ cwd: dir, overrideConfigFile: path.join(ROOT, 'eslint.config.js') });
  const [result] = await eslint.lintFiles([tmp]);
  const mine = owner ? new Set(ORDER.filter(m => m.owner === owner).map(m => m.f)) : null;
  const findings = [];
  let ext = 0;
  for (const m of result.messages) {
    const name = (m.message.match(/'([^']+)'/) || [])[1];
    if (m.ruleId === 'no-unused-vars' && name && external.has(name)) { ext++; continue; }
    const w = where(m.line);
    if (mine && !mine.has(w.f)) continue;
    findings.push(`${w.f}:${w.line}:${m.column}  ${m.ruleId}  ${m.message}  | ${(lines[m.line - 1] || '').trim().slice(0, 80)}`);
  }
  for (const f of findings) console.log(f);
  console.log(`\n${findings.length} finding(s), ${ext} external-only name(s)`);
  fs.rmSync(dir, { recursive: true, force: true });
  process.exit(findings.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
