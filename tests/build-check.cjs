/* build-check: index.html is exactly what `npm run build` makes from src/ (never hand-edit index.html),
   versions agree, and no em dashes crept into the sources. Owner: integrator. Node only. */
'use strict';
const fs = require('fs'), path = require('path');
const { check, done } = require('./lib.cjs');
const { build, ROOT, ORDER, SHELL } = require('../scripts/build.cjs');

const shipped = fs.existsSync(path.join(ROOT, 'index.html')) ? fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8') : '';
check('index.html is fresh (run npm run build)', shipped === build());
const pkg = require('../package.json');
const appV = (fs.readFileSync(path.join(ROOT, 'src/contracts.js'), 'utf8').match(/APP_VERSION = '([\d.]+)'/) || [])[1];
check('package.json version matches APP_VERSION', pkg.version === appV, pkg.version + ' / ' + appV);
const dashed = [...ORDER, SHELL].map(m => m.f).concat(['docs/OVERHAUL.md']).filter(f => fs.existsSync(path.join(ROOT, f)) && /[–—]/.test(fs.readFileSync(path.join(ROOT, f), 'utf8')));
check('no em or en dashes in src/ or docs/OVERHAUL.md', dashed.length === 0, dashed.join(' '));
done();
