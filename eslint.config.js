/* Dev-only ESLint flat config for the game modules (tests/lint.cjs assembles them exactly as the build does).
   Browser globals are listed by hand; every element id in src/shell.html is a global too. THREE comes from
   the inlined three.js block, VROOM and BUILD_ID from the build prelude. */
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, 'src', 'shell.html'), 'utf8');
const ids = {};
for (const m of html.matchAll(/\sid="([A-Za-z_$][\w$]*)"/g)) ids[m[1]] = 'readonly';

const browser = { THREE: 'readonly' };
for (const g of [
  'window', 'document', 'navigator', 'location', 'history', 'screen', 'localStorage', 'sessionStorage', 'console', 'fetch', 'URL', 'URLSearchParams',
  'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'requestAnimationFrame', 'cancelAnimationFrame', 'queueMicrotask', 'performance',
  'btoa', 'atob', 'TextEncoder', 'TextDecoder', 'Blob', 'Response', 'CompressionStream', 'DecompressionStream', 'Image', 'ImageData', 'OffscreenCanvas',
  'createImageBitmap', 'AudioContext', 'webkitAudioContext', 'OfflineAudioContext', 'HTMLElement', 'HTMLCanvasElement', 'Element', 'Node', 'Event', 'CustomEvent',
  'PointerEvent', 'KeyboardEvent', 'MutationObserver', 'ResizeObserver', 'matchMedia', 'getComputedStyle', 'devicePixelRatio', 'innerWidth', 'innerHeight',
  'visualViewport', 'addEventListener', 'removeEventListener', 'dispatchEvent', 'structuredClone', 'globalThis', 'CSS', 'DOMRect', 'Path2D', 'NodeFilter',
]) browser[g] = 'readonly';

module.exports = [
  {
    files: ['**/*.js'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'script', globals: { ...browser, ...ids } },
    rules: {
      'no-unused-vars': ['warn', { vars: 'all', args: 'none', caughtErrors: 'none' }],
      'no-undef': 'warn',
      'no-redeclare': 'warn',
      'no-dupe-keys': 'warn',
      'no-unreachable': 'warn',
      'no-dupe-else-if': 'warn',
      'no-duplicate-case': 'warn',
      'no-self-assign': 'warn',
      'no-empty': ['warn', { allowEmptyCatch: true }],
      eqeqeq: ['warn', 'smart'],
    },
  },
];
