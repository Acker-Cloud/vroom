/* ui: every DOM layer: splash, home, map, results, the race HUD, overlays, widgets and controls. Owner: ui.
   The metal grunge look lives in src/shell.html (tokens --m-*, plates, logo); this file builds the DOM,
   drives the scene timelines and reads the player's hands. Zero words on screen: numerals, symbols and
   pictograms only (the VROOM logo, data-logo, is the one word). Contract: VROOM.contracts MODULE_API.ui.
   Sections: 1 helpers  2 icons  3 widgets (button, toast, transition)  4 controls  5 race HUD, countdown,
   pause  6 splash  7 home  8 map  9 results  10 overlays (settings, profiles, album, code import)  11 init */

/* ============ 1. helpers ============ */
const C = VROOM.contracts;
const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const sfx = (name, o) => { try { if (VROOM.audio) VROOM.audio.sfx(name, o); } catch (e) {} };
const reduced = () => !!(VROOM.game && VROOM.game.ctx ? VROOM.game.ctx.reducedMotion : (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches));
function el(tag, cls, html, css) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  if (css) e.style.cssText = css;
  return e;
}
const at = (e, x, y, w, h) => { e.style.left = x + 'px'; e.style.top = y + 'px'; if (w) e.style.width = w + 'px'; if (h) e.style.height = h + 'px'; return e; };
const n = (v, cls = '') => '<span class="n ' + cls + '">' + v + '</span>';
/* m:ss.cc from seconds, in whole centiseconds so 59.999 never shows as 60 */
function fmtTime(t) {
  const cs = Math.max(0, Math.round((t || 0) * 100)), m = Math.floor(cs / 6000), s = Math.floor(cs / 100) % 60, c = cs % 100;
  return m + ':' + (s < 10 ? '0' : '') + s + '.' + (c < 10 ? '0' : '') + c;
}
const warned = new Set();
function guard(tag, fn, fallback) {
  try { return fn(); } catch (e) {
    if (!warned.has(tag)) { warned.add(tag); console.warn('ui: ' + tag, e); }
    return fallback;
  }
}
function setAccent(w) {
  const a = guard('accent', () => VROOM.worlds.accent(w), null) || ['#fff2a8', '#ffb02e', '#ff5a1a', '#b3200f'];
  const s = document.documentElement.style;
  a.forEach((c, i) => s.setProperty('--acc' + i, c));
  return a;
}
/* the world of the day: the day's number mod twelve, the same for everyone (days since 1 January of year 1, as PuttX
   and its iOS port count them), or ?titleWorld=N */
function worldOfDay() {
  const q = +params.get('titleWorld');
  if (q >= 1 && q <= C.WORLD_COUNT) return q;
  const d = new Date(), y1 = new Date(0); y1.setUTCFullYear(1, 0, 1); y1.setUTCHours(0, 0, 0, 0);
  const day = Math.floor((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - y1.getTime()) / 86400000) + 1;
  return day % C.WORLD_COUNT + 1;
}
const worldOfLevel = lv => lv === C.PARADE_LEVEL ? C.WORLD_COUNT : C.worldOf(lv);
const prefGet = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
const prefSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };

/* ============ 2. icons: pictograms, ink on metal with a black cut-out ============ */
const K = '#0d0e12', INK = '#e6e9ef';
const sv = (b, vb = '0 0 64 64') => '<svg viewBox="' + vb + '" aria-hidden="true">' + b + '</svg>';
const P = (d, f, extra = '') => '<path d="' + d + '" fill="' + f + '" stroke="' + K + '" stroke-width="6" stroke-linejoin="round" stroke-linecap="round" paint-order="stroke" ' + extra + '/>';
const Ln = (d, c, w, extra = '') => '<path d="' + d + '" fill="none" stroke="' + c + '" stroke-width="' + w + '" stroke-linecap="round" stroke-linejoin="round" ' + extra + '/>';
const LL = (d, c, w, extra = '') => Ln(d, K, w + 6, extra) + Ln(d, c, w, extra);
const Ci = (x, y, r, f, extra = '') => '<circle cx="' + x + '" cy="' + y + '" r="' + r + '" fill="' + f + '" stroke="' + K + '" stroke-width="5" paint-order="stroke" ' + extra + '/>';
const STAR_D = 'M32 3 L40.6 22.4 L61.4 24.2 L45.6 38.2 L50.2 59 L32 48.2 L13.8 59 L18.4 38.2 L2.6 24.2 L23.4 22.4 Z';
const starSvg = (on = true) => sv('<path d="' + STAR_D + '" fill="none" stroke="' + K + '" stroke-width="8" stroke-linejoin="round"/>'
  + '<path d="' + STAR_D + '" fill="' + (on ? '#ffd02e' : '#3a3f48') + '" stroke="' + (on ? '#ff8a1e' : '#5a616d') + '" stroke-width="3" stroke-linejoin="round"/>'
  + (on ? '<path d="M32 10 L37 22 L32 30 L26 22 Z" fill="#fff6c8" opacity=".75"/>' : ''));
function cog(r1 = 26, r2 = 19, teeth = 8) {
  let d = '';
  for (let i = 0; i < teeth * 2; i++) {
    const a0 = (i / (teeth * 2)) * Math.PI * 2, a1 = ((i + 1) / (teeth * 2)) * Math.PI * 2, r = i % 2 ? r2 : r1;
    d += (i ? 'L' : 'M') + (32 + Math.cos(a0 + 0.08) * r).toFixed(1) + ' ' + (32 + Math.sin(a0 + 0.08) * r).toFixed(1) + ' L' + (32 + Math.cos(a1 - 0.08) * r).toFixed(1) + ' ' + (32 + Math.sin(a1 - 0.08) * r).toFixed(1) + ' ';
  }
  return d + 'Z';
}
const CAR_D = 'M6 40 L10 28 L22 26 L28 16 H44 L50 26 L58 28 V40 Z';
const carSvg = (f = '#ff5a1a') => sv(P(CAR_D, f) + Ci(18, 44, 9, '#2a2d34') + Ci(46, 44, 9, '#2a2d34') + Ci(18, 44, 3, '#9aa3b0') + Ci(46, 44, 3, '#9aa3b0') + P('M31 20 H42 L45 26 H31 Z', '#8fd8ff'));
const skullBody = (eye = 'var(--acc2)', crossed = false) => (
  P('M14 28 C4 20 4 8 10 2 C12 12 16 18 24 20 Z', '#d9dee6') + P('M50 28 C60 20 60 8 54 2 C52 12 48 18 40 20 Z', '#d9dee6')
  + P('M32 12 C46 12 54 22 54 34 C54 41 50 45 46 47 V57 H18 V47 C14 45 10 41 10 34 C10 22 18 12 32 12 Z', '#e6e9ef')
  + '<path d="M17 31 L28 29 L28 39 L20 39 Z M47 31 L36 29 L36 39 L44 39 Z" style="fill:' + eye + '" stroke="' + K + '" stroke-width="3" stroke-linejoin="round"/>'
  + P('M32 40 L35 46 H29 Z', K) + Ln('M24 51 V57 M32 51 V57 M40 51 V57', K, 3)
  + (crossed ? LL('M6 8 L58 58 M58 8 L6 58', '#d8322a', 6) : ''));
const skullSvg = (eye, crossed) => sv(skullBody(eye, crossed));
/* rail markers: you are a chrome arrowhead with a molten spine, your best run a steel twin, the boss a skull on a rusted plate */
const ARROW_D = 'M3 13 L61 32 L3 51 L15 32 Z';
const markSvg = ghost => sv((ghost ? P(ARROW_D, '#6b727e') + Ln('M15 32 H44', '#c7ccd5', 3)
  : '<defs><linearGradient id="mkChrome" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset=".42" stop-color="#b7bec9"/><stop offset=".5" stop-color="#3a3f48"/><stop offset=".62" stop-color="#6b727e"/><stop offset="1" stop-color="#e3e7ee"/></linearGradient></defs>'
    + P(ARROW_D, 'url(#mkChrome)') + LL('M17 32 H46', '#ff5a1a', 4) + Ci(40, 32, 2.5, '#ffb02e')));
const bossMarkSvg = () => sv(P('M32 2 L58 17 V47 L32 62 L6 47 V17 Z', '#8a3b12') + P('M32 8 L53 20 V44 L32 56 L11 44 V20 Z', '#2c3039')
  + Ci(32, 6, 2, '#c7ccd5') + Ci(32, 58, 2, '#c7ccd5') + '<g transform="translate(14 13) scale(.56)">' + skullBody('#ff5a1a') + '</g>');
const icons = {
  go: sv(P('M16 7 L57 32 L16 57 L24 32 Z', '#f4f6fa')),
  next: sv(P('M6 12 L29 32 L6 52 Z', INK) + P('M32 12 L57 32 L32 52 Z', INK)),
  back: sv(P('M44 8 L14 32 L44 56 L38 32 Z', INK)),
  home: sv(P('M5 30 L32 7 L59 30 V57 H41 V40 H23 V57 H5 Z', INK) + Ln('M26 46 H38 M26 51 H38', K, 3)),
  map: sv(P('M5 14 L22 8 L42 14 L59 8 V50 L42 56 L22 50 L5 56 Z', '#c7ccd5') + Ln('M22 8 V50 M42 14 V56', '#6b727e', 3)
    + Ln('M11 44 C18 30 28 42 33 28 S48 22 52 16', '#ff5a1a', 4, 'stroke-dasharray="1 7"') + Ci(52, 16, 4, '#ff5a1a')),
  garage: sv(P('M44 5 a13 13 0 0 0 -12 18 L9 46 a7 7 0 0 0 10 10 L42 33 a13 13 0 0 0 17 -12 l-9 6 -8 -8 6 -9 Z', INK)),
  star: starSvg(true),
  starOff: starSvg(false),
  lock: sv(LL('M20 30 V21 a12 12 0 0 1 24 0 V30', '#9aa3b0', 6) + P('M11 28 H53 V58 H11 Z', '#9aa3b0')
    + '<ellipse cx="44" cy="50" rx="6" ry="4" fill="#8a3b12" opacity=".7"/>' + P('M32 36 a4 4 0 0 1 3 7 V50 H29 V43 a4 4 0 0 1 3 -7 Z', K)),
  replay: sv(LL('M50 34 A18 18 0 1 1 33 15', INK, 7) + P('M27 4 L44 15 L27 26 Z', INK)),
  pause: sv(P('M15 11 H28 V53 H15 Z', INK) + P('M36 11 H49 V53 H36 Z', INK)),
  boost: sv(P('M38 3 L11 37 H29 L24 61 L53 25 H35 Z', '#ffb02e') + '<path d="M36 10 L19 33 H31 L28 49 L45 28 H33 Z" fill="#fff0b0" opacity=".6"/>'),
  brake: sv(P('M22 5 H42 L59 22 V42 L42 59 H22 L5 42 V22 Z', '#d8322a') + P('M15 28 H49 V36 H15 Z', '#f4f6fa')),
  gas: sv(LL('M14 44 L32 26 L50 44', '#f4f6fa', 8) + LL('M14 26 L32 8 L50 26', '#f4f6fa', 8) + Ln('M18 58 H46', '#0d0e12', 5)),
  drift: sv(LL('M10 46 C8 22 40 8 52 26', INK, 6) + P('M43 15 L58 27 L42 34 Z', INK) + LL('M12 57 H28 M36 57 H52', '#ffb02e', 4)),
  gear: sv(P(cog(), '#c7ccd5') + Ci(32, 32, 8, '#2c3039')),
  sound: sv(P('M7 24 H19 L34 11 V53 L19 40 H7 Z', INK) + LL('M42 23 a13 13 0 0 1 0 18', INK, 4) + LL('M49 15 a24 24 0 0 1 0 34', INK, 4)),
  mute: sv(P('M7 24 H19 L34 11 V53 L19 40 H7 Z', '#9aa3b0') + LL('M42 24 L57 40 M57 24 L42 40', '#d8322a', 5)),
  profile: sv(P('M9 42 C9 18 21 7 34 7 C49 7 57 20 57 36 V50 H34 L29 42 Z', INK) + P('M30 23 H57 V36 H34 Z', '#ff5a1a') + Ci(18, 34, 4, '#6b727e')),
  trophy: sv(LL('M19 14 H10 C10 25 14 29 21 29 M45 14 H54 C54 25 50 29 43 29', '#ffd02e', 4)
    + P('M18 7 H46 V21 C46 33 40 40 32 40 C24 40 18 33 18 21 Z', '#ffd02e') + P('M28 40 H36 V48 H45 V57 H19 V48 H28 Z', '#c7ccd5')
    + '<path d="M24 12 V22 C24 28 27 32 30 33" fill="none" stroke="#fff6c8" stroke-width="3" opacity=".7"/>'),
  flag: sv(LL('M11 5 V60', '#c7ccd5', 5) + P('M14 8 H56 V36 H14 Z', '#f4f6fa')
    + '<path d="M14 8 H24.5 V17.3 H14 Z M35 8 H45.5 V17.3 H35 Z M24.5 17.3 H35 V26.6 H24.5 Z M45.5 17.3 H56 V26.6 H45.5 Z M14 26.6 H24.5 V36 H14 Z M35 26.6 H45.5 V36 H35 Z" fill="' + K + '"/>'),
  skull: skullSvg(),
  crane: sv(LL('M32 2 V22', '#9aa3b0', 4, 'stroke-dasharray="4 3"') + P('M24 18 H40 V26 H24 Z', '#6b727e') + LL('M32 26 V40 a11 11 0 1 1 -15 -7', '#f2b705', 7)),
  clock: sv(P('M27 3 H37 V10 H27 Z', '#9aa3b0') + Ci(32, 36, 24, '#e6e9ef') + LL('M32 36 L32 20 M32 36 L43 42', '#d8322a', 3) + Ci(32, 36, 3, K)),
  copy: sv(P('M20 6 H50 V44 H20 Z', '#6b727e') + P('M12 18 H42 V58 H12 Z', INK) + Ln('M18 30 H36 M18 38 H36 M18 46 H30', '#6b727e', 3)),
  paste: sv(P('M10 10 H54 V60 H10 Z', '#8a5a2a') + P('M22 4 H42 V16 H22 Z', '#9aa3b0') + P('M17 22 H47 V54 H17 Z', INK) + LL('M32 28 V46 M24 38 L32 46 L40 38', '#2f7d25', 4)),
  qr: sv(P('M6 6 H26 V26 H6 Z', INK) + P('M38 6 H58 V26 H38 Z', INK) + P('M6 38 H26 V58 H6 Z', INK) + '<path d="M12 12 H20 V20 H12 Z M44 12 H52 V20 H44 Z M12 44 H20 V52 H12 Z M38 38 H46 V46 H38 Z M50 50 H58 V58 H50 Z M38 52 H44 V58 H38 Z M52 38 H58 V44 H52 Z" fill="' + K + '"/>'),
  check: sv(LL('M10 34 L26 50 L54 14', '#8cff3a', 9)),
  cross: sv(LL('M14 14 L50 50 M50 14 L14 50', '#d8322a', 9)),
  crt: sv(P('M5 10 H59 V48 H5 Z', '#3a3f48') + P('M10 15 H54 V43 H10 Z', '#8fd8ff') + Ln('M10 21 H54 M10 27 H54 M10 33 H54 M10 39 H54', '#2e8ac8', 2) + P('M22 48 H42 L46 58 H18 Z', '#6b727e')),
  tilt: sv(P('M14 18 H50 V46 H14 Z', '#c7ccd5', 'transform="rotate(-18 32 32)"') + LL('M6 52 C14 60 26 62 36 60', '#ff5a1a', 4) + P('M32 54 L40 60 L32 65 Z', '#ff5a1a')),
  drag: sv(LL('M8 32 H56', '#9aa3b0', 4) + P('M6 32 L16 24 V40 Z', '#ff5a1a') + P('M58 32 L48 24 V40 Z', '#ff5a1a') + Ci(32, 32, 11, INK)),
  buttons: sv(P('M27 12 L4 32 L27 52 Z', INK) + P('M37 12 L60 32 L37 52 Z', INK)),
  left: sv(P('M50 8 L12 32 L50 56 L42 32 Z', INK)),
  right: sv(P('M14 8 L52 32 L14 56 L22 32 Z', INK)),
  flip: sv(P(CAR_D, '#ff5a1a', 'transform="translate(10 18) scale(.7)"') + LL('M10 26 A24 22 0 1 1 54 26', INK, 4) + P('M48 16 L58 28 L44 32 Z', INK)),
  roll: sv(P(CAR_D, '#ff5a1a', 'transform="translate(10 14) scale(.7)"') + LL('M8 50 A26 14 0 0 0 56 50', INK, 4) + P('M50 42 L60 52 L46 56 Z', INK)),
  spin: sv(P(CAR_D, '#ff5a1a', 'transform="translate(10 12) scale(.7)"') + LL('M6 44 C6 58 58 58 58 44', INK, 4) + P('M52 36 L60 46 L48 48 Z', INK)),
  air: sv(LL('M4 56 C18 20 46 20 60 56', '#6b727e', 3, 'stroke-dasharray="3 5"') + P(CAR_D, '#ff5a1a', 'transform="translate(14 4) scale(.56)"') + P('M28 34 L36 34 L32 42 Z', '#8cff3a')),
  hit: sv(P('M32 2 L38 20 L58 10 L46 28 L62 36 L44 40 L50 60 L32 46 L14 60 L20 40 L2 36 L18 28 L6 10 L26 20 Z', '#ff5a1a') + P('M32 18 L36 28 L46 26 L40 34 L44 44 L32 38 L20 44 L24 34 L18 26 L28 28 Z', '#ffd02e')),
  checkpoint: sv(LL('M10 60 V8 M54 60 V8', '#c7ccd5', 5) + P('M10 8 H54 V20 H10 Z', '#8cff3a') + '<path d="M10 8 h8 v12 h-8 Z M26 8 h8 v12 h-8 Z M42 8 h8 v12 h-8 Z" fill="' + K + '"/>'),
  plus: sv(LL('M32 10 V54 M10 32 H54', '#8cff3a', 9)),
  car: carSvg(),
  ghost: carSvg('#c7ccd5'),
  marker: markSvg(false),
  markerGhost: markSvg(true),
  markerBoss: bossMarkSvg(),
  bolt: sv(Ci(32, 32, 26, '#6b727e') + P('M32 12 L49 22 V42 L32 52 L15 42 V22 Z', '#c7ccd5')),
  wallet: starSvg(true),
  album: sv(P('M8 6 H50 L56 12 V58 H8 Z', '#6b727e') + P('M14 12 H50 V52 H14 Z', '#2c3039') + Ci(32, 30, 11, '#ffd02e') + P('M24 40 L22 52 L32 47 L42 52 L40 40 Z', '#d8322a')),
  calendar: sv(P('M6 12 H58 V58 H6 Z', INK) + P('M6 12 H58 V24 H6 Z', '#d8322a') + LL('M18 6 V16 M46 6 V16', '#9aa3b0', 4) + Ci(32, 41, 9, '#ff5a1a')),
  sens: sv(P('M6 44 H16 V58 H6 Z', '#ff5a1a') + P('M24 32 H34 V58 H24 Z', '#ff5a1a') + P('M42 18 H52 V58 H42 Z', '#ff5a1a')),
};
/* medal stamps: S molten with a flame crown, A gold, B steel, C bronze; rank shown as chevrons, never letters */
const MEDAL = { S: ['#fff6c8', '#ffb02e', '#ff5a1a', '#8a1a06'], A: ['#fff3b0', '#ffd02e', '#d8a010', '#6a4a08'], B: ['#ffffff', '#c7ccd5', '#8d94a0', '#3a3f48'], C: ['#ffd8b0', '#d08a50', '#9a5a2a', '#4a2a10'] };
function medalSvg(tier) {
  const m = MEDAL[tier] || MEDAL.C, k = { S: 3, A: 3, B: 2, C: 1 }[tier] || 1, id = 'md' + (tier || 'C');
  let chev = '';
  for (let i = 0; i < k; i++) chev += LL('M20 ' + (40 + i * 7) + ' L32 ' + (33 + i * 7) + ' L44 ' + (40 + i * 7), m[0], 3);
  const crown = tier === 'S' ? P('M18 24 L22 12 L27 20 L32 8 L37 20 L42 12 L46 24 Z', '#fff6c8') : P('M32 15 L35 22 L42 22 L36 27 L38 34 L32 30 L26 34 L28 27 L22 22 L29 22 Z', m[0]);
  return sv('<defs><radialGradient id="' + id + '" cx=".4" cy=".35"><stop offset="0" stop-color="' + m[0] + '"/><stop offset=".45" stop-color="' + m[1] + '"/><stop offset="1" stop-color="' + m[2] + '"/></radialGradient></defs>'
    + P('M20 2 L28 2 L32 14 L36 2 L44 2 L38 18 H26 Z', '#d8322a') + '<path d="' + cog(30, 26, 12).replace(/32 /g, '32 ') + '" transform="translate(0 4)" fill="url(#' + id + ')" stroke="' + K + '" stroke-width="5" stroke-linejoin="round" paint-order="stroke"/>'
    + '<circle cx="32" cy="36" r="19" fill="none" stroke="' + m[3] + '" stroke-width="3"/>' + '<g transform="translate(0 4)">' + crown + chev + '</g>');
}
/* the six profile avatars (save.AVATAR_IDS): original critters in welding masks */
const AV = {
  pup: { c: '#c2561c', ears: P('M12 26 L6 6 L24 16 Z', '#8a3b12') + P('M52 26 L58 6 L40 16 Z', '#8a3b12'), snout: P('M24 40 H40 V50 H24 Z', '#e6e9ef') },
  kitty: { c: '#6b727e', ears: P('M10 24 L12 2 L28 14 Z', '#4b515b') + P('M54 24 L52 2 L36 14 Z', '#4b515b'), snout: P('M28 42 H36 L32 47 Z', '#ff9ad0') },
  ducky: { c: '#f2b705', ears: P('M28 6 C30 0 38 0 36 8 Z', '#f2b705'), snout: P('M18 42 H46 L40 52 H24 Z', '#ff5a1a') },
  dino: { c: '#2f7d25', ears: P('M20 10 L26 0 L32 8 L38 0 L44 10 Z', '#8cff3a'), snout: P('M22 44 H42 V52 H22 Z', '#5fd34a') },
  penguin: { c: '#24272e', ears: '', snout: P('M26 40 H38 L32 50 Z', '#ffb02e') + P('M20 22 H44 V52 H20 Z', '#e6e9ef', 'opacity=".25"') },
  monkey: { c: '#8a5a2a', ears: Ci(8, 30, 8, '#c08050') + Ci(56, 30, 8, '#c08050'), snout: P('M20 38 H44 V52 H20 Z', '#e0b080') },
};
function avatarSvg(id) {
  const a = AV[id] || AV.pup;
  return sv(a.ears + P('M10 30 C10 14 20 8 32 8 C44 8 54 14 54 30 V42 C54 52 44 58 32 58 C20 58 10 52 10 42 Z', a.c) + P('M14 24 H50 V36 H14 Z', '#1a1c21')
    + '<path d="M18 28 H28 V32 H18 Z M36 28 H46 V32 H36 Z" style="fill:var(--acc1)"/>' + a.snout + Ln('M14 24 H50', '#9aa3b0', 2));
}
/* badges (save.ids.BADGE_IDS): v12 eight, then the v13 four */
function badgeSvg(id) {
  switch (id) {
    case 'jump': return icons.air;
    case 'clean': return sv(P('M32 4 L56 12 V30 C56 46 44 56 32 60 C20 56 8 46 8 30 V12 Z', '#5fd34a') + LL('M20 32 L29 41 L45 22', '#f4f6fa', 5));
    case 's': return medalSvg('S');
    case 'world': return icons.flag;
    case 'buy': return sv(P('M44 5 a13 13 0 0 0 -12 18 L9 46 a7 7 0 0 0 10 10 L42 33 a13 13 0 0 0 17 -12 l-9 6 -8 -8 6 -9 Z', '#c7ccd5') + '<g transform="translate(30 30) scale(.5)">' + starSvg(true).replace(/<\/?svg[^>]*>/g, '') + '</g>');
    case 'gag': return sv(P('M6 26 H18 L46 10 V54 L18 38 H6 Z', '#f2b705') + LL('M52 22 L60 18 M52 32 H62 M52 42 L60 46', '#ff5a1a', 4));
    case 'champ': return icons.trophy;
    case 'shine': return sv(P('M32 2 L37 27 L62 32 L37 37 L32 62 L27 37 L2 32 L27 27 Z', '#fff6c8') + P('M50 6 L52 14 L60 16 L52 18 L50 26 L48 18 L40 16 L48 14 Z', '#8fd8ff'));
    case 'boss': return skullSvg('#ff5a1a', true);
    case 'air': return sv(P('M4 40 C18 34 24 22 30 10 C34 22 44 32 60 34 C46 40 38 46 32 58 C28 48 18 42 4 40 Z', '#8fd8ff'));
    case 'drift': return icons.drift;
    case 'sweep': return sv('<g transform="translate(-2 18) scale(.5)">' + starSvg(true).replace(/<\/?svg[^>]*>/g, '') + '</g><g transform="translate(16 2) scale(.5)">' + starSvg(true).replace(/<\/?svg[^>]*>/g, '') + '</g><g transform="translate(34 18) scale(.5)">' + starSvg(true).replace(/<\/?svg[^>]*>/g, '') + '</g>');
    default: return icons.bolt;
  }
}
const worldIcon = w => guard('icon', () => VROOM.worlds.icon(w), null) || sv(Ci(32, 32, 24, 'var(--acc2)'));
const emblem = (w, cls = 'em') => worldIcon(w).replace('<svg', '<svg class="' + cls + '"');

/* ============ 3. widgets ============ */
let game = null;
/* the metal plate button: pressed is a 4 px slam with a clank; fires on pointerdown (fast thumbs) and on keyboard click */
function button({ icon = '', cls = '', aria = '', on } = {}) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'plate ' + cls;
  b.innerHTML = icon;
  if (aria) b.setAttribute('aria-label', aria);
  const up = () => b.classList.remove('pressed');
  b.addEventListener('pointerdown', e => {
    e.stopPropagation();
    if (e.button > 0) return;
    b.classList.add('pressed');
    sfx('press');
    if (on) on(e);
  });
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) b.addEventListener(ev, up);
  b.addEventListener('click', e => { if (e.detail === 0) { sfx('press'); if (on) on(e); } });
  return b;
}
const deny = b => { sfx('deny'); if (!b || reduced()) return; b.classList.remove('deny'); void b.offsetWidth; b.classList.add('deny'); };
/* a wordless popup: a slammed plate at the top with one pictogram */
function toast(svg) {
  const box = $('toasts');
  if (!box) return;
  while (box.children.length >= 3) box.firstChild.remove();
  const t = el('div', 'toast panel in', svg);
  box.append(t);
  setTimeout(() => { t.classList.remove('in'); t.classList.add('out'); }, 1700);
  setTimeout(() => t.remove(), 2050);
}
/* the hazard shutter slams shut, fn runs behind it, it lifts. Reduced motion: a 150 ms fade.
   A call while one is running is dropped (a double tap must not start two races). */
let shutBusy = false;
function transition(fn) {
  const sh = $('shutter');
  if (!sh) { fn(); return; }
  if (shutBusy) return;
  shutBusy = true;
  const run = () => { try { fn(); } catch (e) { console.error(e); } };
  if (reduced()) {
    sh.className = 'fade';
    setTimeout(run, 150);
    setTimeout(() => { sh.className = ''; shutBusy = false; }, 300);
    return;
  }
  sh.className = 'shut';
  sfx('whoosh', { v: 0.5 });
  setTimeout(() => {
    sfx('slam', { v: 0.45, p: 1.4 });
    run();
    setTimeout(() => {
      sh.className = 'open';
      setTimeout(() => { sh.className = ''; shutBusy = false; }, 240);
    }, 90);
  }, 175);
}
const nav = (id, p) => transition(() => game.go(id, p));
const race = lv => transition(() => game.startRace(lv));

/* ============ 4. controls: touch plates and a steering zone, tilt, keyboard, a gamepad ============ */
const keys = new Set();
const touch = { gas: 0, brake: 0, boost: 0, drift: 0, steer: 0, btn: 0 };
let kSteer = 0, tiltZero = null, tiltRaw = 0, padPausePrev = false;
const KEYMAP = { arrowleft: 1, arrowright: 1, arrowup: 1, arrowdown: 1, ' ': 1 };
/* the touch plates only show on a touch device: a coarse primary pointer at boot, or the first real touch.
   Keyboard and gamepad drivers get a clean screen; a touch brings the plates back */
const DRIVE_KEYS = new Set(['arrowleft', 'arrowright', 'arrowup', 'arrowdown', ' ', 'a', 'd', 'w', 's', 'shift', 'x']);
let touchUI = !!(window.matchMedia && matchMedia('(pointer: coarse)').matches);
function touchPlates(on) {
  if (touchUI === on) return;
  touchUI = on;
  const c = document.getElementById('ctl');
  if (c) c.classList.toggle('off', !on);
}
addEventListener('pointerdown', e => { if (e.pointerType === 'touch' || e.pointerType === 'pen') touchPlates(true); }, true);
addEventListener('keydown', e => {
  const k = e.key.toLowerCase();
  keys.add(k);
  if (DRIVE_KEYS.has(k) && game && game.current() === 'race') touchPlates(false);
  if (KEYMAP[k] && game && game.current() === 'race') e.preventDefault();
  if ((k === 'escape' || k === 'p') && game && game.current() === 'race' && !e.repeat) togglePause();
});
addEventListener('keyup', e => keys.delete(e.key.toLowerCase()));
addEventListener('blur', () => { keys.clear(); Object.assign(touch, { gas: 0, brake: 0, boost: 0, drift: 0, steer: 0, btn: 0 }); });
function onTilt(e) {
  const ang = (screen.orientation && screen.orientation.angle) || window.orientation || 0;
  const v = ang === 90 ? e.beta : ang === -90 || ang === 270 ? -e.beta : e.gamma;
  if (typeof v !== 'number') return;
  if (tiltZero === null) tiltZero = v;
  tiltRaw = v - tiltZero;
}
const ctrl = () => (VROOM.save && VROOM.save.progress.ctrl) || { mode: 0, sens: 2 };
function readPad() {
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  for (const g of pads) {
    if (!g || !g.connected) continue;
    const b = i => (g.buttons[i] ? g.buttons[i].value || (g.buttons[i].pressed ? 1 : 0) : 0);
    const ax = g.axes[0] || 0;
    const start = b(9) > 0.5;
    if (start && !padPausePrev && game && game.current() === 'race') setTimeout(togglePause, 0);
    padPausePrev = start;
    if (touchUI && (Math.abs(ax) > 0.3 || b(7) > 0.2 || b(6) > 0.2 || b(0) > 0.5 || b(1) > 0.5)) touchPlates(false);
    return { steer: Math.abs(ax) < 0.12 ? 0 : ax, throttle: Math.max(b(7), (g.axes[1] || 0) < -0.5 ? 1 : 0), brake: b(6), boost: b(0) > 0.5 || b(5) > 0.5 ? 1 : 0, drift: b(1) > 0.5 || b(2) > 0.5 || b(4) > 0.5 ? 1 : 0 };
  }
  return null;
}
const controls = {
  /* one InputFrame per sim tick (120 Hz): keyboard steering ramps so a tap is a nudge and a hold is full lock */
  read() {
    const k = c => keys.has(c);
    const kl = k('arrowleft') || k('a'), kr = k('arrowright') || k('d');
    const target = (kr ? 1 : 0) - (kl ? 1 : 0);
    if (target === 0 || Math.sign(target) !== Math.sign(kSteer)) kSteer = 0;
    if (target !== 0) kSteer = clamp(kSteer + target * 0.05, -1, 1);
    const pad = readPad();
    const sens = [0.6, 0.8, 1, 1.3][ctrl().sens | 0] || 1;
    const tilt = ctrl().mode === 1 ? clamp(tiltRaw / (28 / sens), -1, 1) : 0;
    let steer = kSteer;
    for (const v of [touch.steer, touch.btn, tilt, pad ? pad.steer : 0]) if (Math.abs(v) > Math.abs(steer)) steer = v;
    return {
      steer: clamp(steer, -1, 1),
      throttle: Math.max(k('arrowup') || k('w') ? 1 : 0, touch.gas, pad ? pad.throttle : 0),
      brake: Math.max(k('arrowdown') || k('s') ? 1 : 0, touch.brake, pad ? pad.brake : 0),
      boost: k(' ') || touch.boost || (pad && pad.boost) ? 1 : 0,
      drift: k('shift') || k('x') || touch.drift || (pad && pad.drift) ? 1 : 0,
    };
  },
  show() {
    const hud = $('raceHud');
    if (!hud) return;
    const old = $('ctl'); if (old) old.remove();
    const box = el('div', '', '', ''); box.id = 'ctl';
    if (!touchUI) box.classList.add('off');
    const hold = (b, key) => {
      b.classList.add('pedal');
      b.addEventListener('pointerdown', e => { touch[key] = 1; b.classList.add('held'); try { b.setPointerCapture(e.pointerId); } catch (er) {} });
      for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) b.addEventListener(ev, () => { touch[key] = 0; b.classList.remove('held'); });
      return b;
    };
    const gas = hold(button({ icon: icons.gas, cls: 'go', aria: 'gas' }), 'gas'); gas.id = 'ctlGas';
    const brake = hold(button({ icon: icons.brake, cls: 'dark', aria: 'brake' }), 'brake'); brake.id = 'ctlBrake';
    const boost = hold(button({ icon: icons.boost, cls: 'molten', aria: 'boost' }), 'boost'); boost.id = 'ctlBoost';
    const drift = hold(button({ icon: icons.drift, aria: 'drift' }), 'drift'); drift.id = 'ctlDrift';
    const mode = ctrl().mode | 0;
    if (mode === 2) {
      const L = button({ icon: icons.left, aria: 'left' }), R = button({ icon: icons.right, aria: 'right' });
      L.id = 'ctlL'; R.id = 'ctlR';
      for (const [b, v] of [[L, -1], [R, 1]]) {
        b.classList.add('pedal');
        b.addEventListener('pointerdown', e => { touch.btn = v; b.classList.add('held'); try { b.setPointerCapture(e.pointerId); } catch (er) {} });
        for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) b.addEventListener(ev, () => { if (touch.btn === v) touch.btn = 0; b.classList.remove('held'); });
      }
      box.append(L, R);
    } else if (mode === 0) {
      /* the drag zone: put a thumb down anywhere on the left, slide it; the knob shows where centre is */
      const zone = el('div', 'live'); zone.id = 'ctlSteer';
      const knob = el('div'); knob.id = 'ctlKnob';
      const track = el('div'); track.id = 'ctlTrack';
      let pid = null, ox = 0;
      const local = e => { const r = $('stage').getBoundingClientRect(), s = r.width / C.STAGE_W; return [(e.clientX - r.left) / s, (e.clientY - r.top) / s]; };
      zone.addEventListener('pointerdown', e => {
        if (pid !== null) return;
        pid = e.pointerId; const [x, y] = local(e); ox = x;
        try { zone.setPointerCapture(pid); } catch (er) {}
        at(knob, x, y); at(track, x, y); knob.classList.add('on'); track.classList.add('on');
      });
      zone.addEventListener('pointermove', e => {
        if (e.pointerId !== pid) return;
        const [x] = local(e), sens = [0.6, 0.8, 1, 1.3][ctrl().sens | 0] || 1;
        touch.steer = clamp((x - ox) / (120 / sens), -1, 1);
        knob.style.left = (ox + touch.steer * 120 / sens) + 'px';
      });
      const end = e => { if (e.pointerId !== pid) return; pid = null; touch.steer = 0; knob.classList.remove('on'); track.classList.remove('on'); };
      for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) zone.addEventListener(ev, end);
      box.append(zone, track, knob);
    } else {
      tiltZero = null; tiltRaw = 0;
      addEventListener('deviceorientation', onTilt);
    }
    box.append(drift, brake, boost, gas);
    hud.append(box);
  },
  hide() {
    Object.assign(touch, { gas: 0, brake: 0, boost: 0, drift: 0, steer: 0, btn: 0 });
    removeEventListener('deviceorientation', onTilt);
    const c = $('ctl'); if (c) c.remove();
  },
};

/* ============ 5. the race HUD, the countdown and pause ============ */
const H = { st: null, spec: null, n: 0, last: {}, els: null, popT: 0, cps: [], bossSeen: false, best: 0 };
let paused = false, countdown = null;
const GAUGE = { R: 88, cx: 105, cy: 112, max: 240, a0: -130, a1: 130 };
function arcPath(r, a0, a1) {
  const p = a => [GAUGE.cx + Math.sin(a * Math.PI / 180) * r, GAUGE.cy - Math.cos(a * Math.PI / 180) * r];
  const [x0, y0] = p(a0), [x1, y1] = p(a1);
  return 'M' + x0.toFixed(1) + ' ' + y0.toFixed(1) + ' A' + r + ' ' + r + ' 0 ' + (a1 - a0 > 180 ? 1 : 0) + ' 1 ' + x1.toFixed(1) + ' ' + y1.toFixed(1);
}
function gaugeSvg() {
  let ticks = '';
  for (let v = 0; v <= GAUGE.max; v += 20) {
    const a = (GAUGE.a0 + (GAUGE.a1 - GAUGE.a0) * v / GAUGE.max) * Math.PI / 180, big = v % 40 === 0;
    const r0 = big ? 66 : 72, r1 = 80;
    ticks += '<line x1="' + (GAUGE.cx + Math.sin(a) * r0).toFixed(1) + '" y1="' + (GAUGE.cy - Math.cos(a) * r0).toFixed(1) + '" x2="' + (GAUGE.cx + Math.sin(a) * r1).toFixed(1) + '" y2="' + (GAUGE.cy - Math.cos(a) * r1).toFixed(1)
      + '" stroke="' + (v >= 200 ? '#ff5a1a' : '#c7ccd5') + '" stroke-width="' + (big ? 5 : 3) + '"/>';
  }
  return '<svg viewBox="0 0 210 210" aria-hidden="true"><defs><radialGradient id="gfG" cx=".5" cy=".4"><stop offset="0" stop-color="#2c3039"/><stop offset="1" stop-color="#0d0e12"/></radialGradient>'
    + '<linearGradient id="grG" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e3e7ee"/><stop offset=".5" stop-color="#5a616d"/><stop offset="1" stop-color="#a9b0bc"/></linearGradient></defs>'
    + '<circle cx="105" cy="112" r="100" fill="url(#grG)" stroke="#050608" stroke-width="5"/><circle cx="105" cy="112" r="91" fill="url(#gfG)" stroke="#050608" stroke-width="3"/>'
    + '<path d="' + arcPath(GAUGE.R, GAUGE.a0, GAUGE.a1) + '" fill="none" stroke="#2a2d34" stroke-width="9" stroke-linecap="round"/>'
    + '<path class="rpm" d="' + arcPath(GAUGE.R, GAUGE.a0, GAUGE.a1) + '" pathLength="100" fill="none" stroke="#ff5a1a" stroke-width="9" stroke-linecap="round" stroke-dasharray="0 100" style="filter:drop-shadow(0 0 4px #ff5a1a)"/>'
    + ticks + '<g class="needle"><path d="M101 112 L105 42 L109 112 Z" fill="#ff5a1a" stroke="#050608" stroke-width="2"/></g>'
    + '<circle cx="105" cy="112" r="12" fill="#6b727e" stroke="#050608" stroke-width="4"/>'
    + '<circle cx="64" cy="186" r="5" fill="#2a2d34"/><circle cx="146" cy="186" r="5" fill="#2a2d34"/></svg>';
}
const hud = {
  show(spec) {
    const root = $('raceHud');
    if (!root) return;
    root.innerHTML = ''; root.className = '';
    paused = false;
    $('stage').classList.add('racing');
    setAccent(spec ? spec.world : 1);
    H.spec = spec; H.n = spec ? spec.n : 0; H.last = {}; H.st = null; H.bossSeen = false;
    const lv = VROOM.save && VROOM.save.progress.levels[H.n];
    H.best = lv && lv.t13 > 0 ? lv.t13 : 0;
    root.append(el('div', 'top'));
    const speed = el('div'); speed.id = 'hSpeed';
    const flash = el('div'); flash.id = 'hFlash';
    const pauseB = button({ icon: icons.pause, aria: 'pause', on: () => togglePause() }); pauseB.id = 'hPause';
    const time = el('div', 'chip', icons.clock + n('0:00.00')); time.id = 'hTime';
    const stars = el('div', 'chip', icons.star + n('0') + n('/', 's') + n('0', 's')); stars.id = 'hStars';
    const rail = el('div', '', '<div class="bar"></div><div class="fill"></div>' + icons.flag.replace('<svg', '<svg class="flag"')); rail.id = 'hRail';
    const boss = el('div', '', '<div class="frame"><div class="heat"></div></div>' + skullSvg().replace('<svg', '<svg class="skull"')); boss.id = 'hBoss';
    const gauge = el('div', '', gaugeSvg() + n('0', 'kmh') + n('1', 'gear s')); gauge.id = 'hGauge';
    const boostBar = el('div', '', '<i></i>'.repeat(10)); boostBar.id = 'hBoost';
    const live = el('div'); live.id = 'hLive';
    const pop = el('div'); pop.id = 'hPop';
    const split = el('div'); split.id = 'hSplit';
    const crane = el('div', '', icons.crane.replace('<svg', '<svg style="width:160px;height:300px" preserveAspectRatio="xMidYMax meet"')); crane.id = 'hCrane';
    const fin = el('div', '', icons.flag); fin.id = 'hFinish';
    const count = el('div'); count.id = 'hCount';
    const lights = el('div', 'panel', '<i></i><i></i><i></i>'); lights.id = 'hLights';
    root.append(speed, flash, rail, boss, gauge, boostBar, live, split, pop, crane, fin, time, stars, pauseB);
    H.els = { root, speed, flash, time: time.querySelector('.n'), starN: stars.querySelectorAll('.n')[0], starT: stars.querySelectorAll('.n')[2], stars, rail,
      fill: rail.querySelector('.fill'), boss, heat: boss.querySelector('.heat'), needle: gauge.querySelector('.needle'), rpm: gauge.querySelector('.rpm'),
      kmh: gauge.querySelector('.kmh'), gear: gauge.querySelector('.gear'), boostBar, segs: [...boostBar.children], live, pop, split, crane, fin, count, lights, car: null, ghost: null, bossMk: null };
    /* markers on the rail: the pace of your best run (a ghost), the boss, you */
    if (H.best) { H.els.ghost = el('div', 'mk ghost', icons.markerGhost); rail.append(H.els.ghost); }
    H.els.car = el('div', 'mk you', icons.marker); rail.append(H.els.car);
    H.cps = [];
    const skipCount = params.get('bot') === '1' || params.has('nocount');
    if (!skipCount) {
      root.append(lights, count);
      countdown = { t: 0, step: -1, last: 0 };
    } else countdown = null;
  },
  update(st) {
    const E = H.els;
    if (!E || !st) return;
    H.st = st;
    const L = H.last, car = st.car, track = st.track;
    /* the checkpoint ticks, once the track is known */
    if (!H.cps.length && track && track.checkpoints && track.finishS > 0) {
      for (const s of track.checkpoints) {
        if (s <= 0 || s >= track.finishS) continue;
        const cp = el('div', 'cp'); cp.style.left = (s / track.finishS * 100).toFixed(2) + '%';
        E.rail.insertBefore(cp, E.rail.querySelector('.mk')); H.cps.push({ s, el: cp, on: false });
      }
    }
    const t = st.finished ? st.finishT : st.t;
    const ts = fmtTime(t);
    if (L.ts !== ts) { E.time.textContent = ts; L.ts = ts; }
    const total = st.stars ? st.stars.length : 0;
    if (L.sg !== st.starsGot || L.stt !== total) { E.starN.textContent = st.starsGot; E.starT.textContent = total; L.sg = st.starsGot; L.stt = total; }
    if (car) {
      const kmh = Math.round(Math.abs(car.speed || 0) * 3.6);
      if (L.kmh !== kmh) {
        E.kmh.textContent = kmh; L.kmh = kmh;
        const a = GAUGE.a0 + (GAUGE.a1 - GAUGE.a0) * Math.min(1, kmh / GAUGE.max);
        E.needle.style.transform = 'rotate(' + a.toFixed(1) + 'deg)';   /* pivot: the CSS transform-origin only */
      }
      const rpm = Math.round(clamp(car.rpm || 0, 0, 1) * 100);
      if (L.rpm !== rpm) { E.rpm.setAttribute('stroke-dasharray', rpm + ' 100'); L.rpm = rpm; }
      const gear = car.gear | 0;
      if (L.gear !== gear) { E.gear.textContent = gear > 0 ? gear : gear < 0 ? '<' : '0'; L.gear = gear; }
      const seg = Math.round(clamp(car.boost || 0, 0, 1) * 10);
      if (L.seg !== seg) { E.segs.forEach((s, i) => s.classList.toggle('on', i < seg)); L.seg = seg; }
      const burn = !!car.boosting;
      if (L.burn !== burn) { E.boostBar.classList.toggle('burn', burn); E.speed.classList.toggle('on', burn && !reduced()); L.burn = burn; const b = $('ctlBoost'); if (b) b.classList.toggle('ready', !burn && seg >= 3); }
      if (track && track.finishS > 0) {
        const f = clamp(car.s / track.finishS, 0, 1), pct = (f * 100).toFixed(1);
        if (L.pct !== pct) { E.car.style.left = pct + '%'; E.fill.style.width = 'calc(' + pct + '% - 4px)'; L.pct = pct; }
        for (const cp of H.cps) if (!cp.on && car.s >= cp.s) { cp.on = true; cp.el.classList.add('on'); }
        if (E.ghost) { const g = (clamp(t / H.best, 0, 1) * 100).toFixed(1); if (L.g !== g) { E.ghost.style.left = g + '%'; L.g = g; } }
      }
      /* live readouts: hang time while airborne, drift time while sliding */
      let live = '';
      if (car.air && car.airT > 0.45) live = 'a' + car.airT.toFixed(1);
      else if (car.drift && car.driftT > 0.4) live = 'd' + car.driftT.toFixed(1);
      if (L.live !== live) {
        E.live.classList.toggle('on', !!live);
        if (live) {
          const kind = live[0];
          if (L.liveK !== kind) { E.live.innerHTML = (kind === 'a' ? icons.air : icons.drift) + n(live.slice(1), kind === 'a' ? 'toxic' : 'hot'); L.liveK = kind; }
          else E.live.querySelector('.n').textContent = live.slice(1);
        } else L.liveK = '';
        L.live = live;
      }
    }
    /* the boss: the heat bar fills as it closes in. 14.1: it keeps station ahead, so the gap is taken either way */
    const boss = st.actors && st.actors.find(a => a && a.boss);
    if (boss && track && track.finishS > 0) {
      if (!H.bossSeen) { H.bossSeen = true; E.boss.classList.add('on'); H.els.bossMk = el('div', 'mk boss', icons.markerBoss); E.rail.insertBefore(H.els.bossMk, E.car); }
      const gap = Math.abs(car.s - boss.s), heat = Math.round(clamp(1 - gap / 80, 0, 1) * 100);
      if (L.heat !== heat) { E.heat.style.width = heat + '%'; E.boss.classList.toggle('hot', heat > 70 && !reduced()); L.heat = heat; }
      const bp = (clamp(boss.s / track.finishS, 0, 1) * 100).toFixed(1);
      if (L.bp !== bp) { H.els.bossMk.style.left = bp + '%'; L.bp = bp; }
    }
  },
  event(ev) {
    const E = H.els;
    if (!E || !ev) return;
    const st = H.st;
    switch (ev.type) {
      case 'star': E.stars.classList.remove('pop'); void E.stars.offsetWidth; E.stars.classList.add('pop'); break;
      case 'nitro': E.boostBar.classList.remove('fill'); void E.boostBar.offsetWidth; E.boostBar.classList.add('fill'); break;
      case 'trick': popUp(icons[ev.kind] || icons.flip, ev.n > 1 ? '\u00d7' + ev.n : ''); break;
      case 'driftBank': popUp(icons.drift, '+' + (ev.t ? ev.t.toFixed(1) : ''), 'hot'); break;
      case 'land': if (ev.hard > 0.6) shakeHud(); if (ev.airT > 1.6) popUp(icons.air, ev.airT.toFixed(1), 'toxic'); break;
      case 'hit': case 'wall': if ((ev.impulse || 0) > 4) { flashHud(false); shakeHud(); } break;
      case 'spin': flashHud(false); break;
      case 'monster': if (ev.what === 'hit') { flashHud(false); shakeHud(); } break;
      case 'boss':
        if (ev.what === 'enter' || ev.what === 'enrage') { flashHud(true); if (!H.bossSeen && E.boss) E.boss.classList.add('on'); }
        if (ev.what === 'hit') { flashHud(false); shakeHud(); }
        if (ev.what === 'defeat') { E.boss.classList.add('dead'); popUp(skullSvg('#8cff3a', true), ''); }
        break;
      case 'checkpoint': {
        const t = st ? st.t : 0;
        E.split.innerHTML = '<span style="display:inline-flex;gap:10px;align-items:center">' + icons.checkpoint.replace('<svg', '<svg style="width:44px;height:44px"') + n(fmtTime(t), 's') + '</span>';
        E.split.classList.remove('on'); void E.split.offsetWidth; E.split.classList.add('on');
        const cp = H.cps.find(c => !c.on); if (cp && st && st.car.s >= cp.s - 2) { cp.on = true; cp.el.classList.add('on'); }
        break;
      }
      case 'respawn': E.crane.classList.remove('on'); void E.crane.offsetWidth; E.crane.classList.add('on'); break;
      case 'finish': E.fin.classList.add('on'); E.lights.remove(); break;
      default: break;
    }
  },
  hide() {
    const root = $('raceHud');
    if (root) { root.innerHTML = ''; root.className = ''; }
    $('stage').classList.remove('racing');
    H.els = null; H.st = null; countdown = null;
    if (paused) closeOverlay();
    paused = false;
  },
};
function popUp(svg, num, cls = '') {
  const E = H.els;
  if (!E) return;
  E.pop.innerHTML = svg + (num ? n(num, cls) : '');
  E.pop.classList.remove('on'); void E.pop.offsetWidth; E.pop.classList.add('on');
}
function flashHud(haz) {
  const E = H.els;
  if (!E) return;
  E.flash.classList.toggle('haz', !!haz);
  E.flash.classList.remove('on'); void E.flash.offsetWidth; E.flash.classList.add('on');
}
function shakeHud() {
  const E = H.els;
  if (!E || reduced()) return;
  E.root.classList.remove('shake'); void E.root.offsetWidth; E.root.classList.add('shake');
}
/* the countdown: red, red, red, green. The sim does not tick until GO, so par times stay honest; holding gas revs */
function countdownTick(dt) {
  const cd = countdown, E = H.els;
  if (!cd || !E) { countdown = null; return; }
  /* wall-clock steps capped at 0.25 s: a steady 3-2-1 on slow frames, but a first-frame shader stall never skips a number */
  const now = performance.now();
  cd.t += cd.last ? Math.min(0.25, (now - cd.last) / 1000) : Math.min(dt, 0.1);
  cd.last = now;
  const step = Math.min(3, Math.floor(cd.t / 0.62));
  if (step !== cd.step) {
    cd.step = step;
    const lamps = E.lights.querySelectorAll('i');
    if (step < 3) {
      lamps.forEach((l, i) => l.className = i <= step ? 'r' : '');
      E.count.innerHTML = n(String(3 - step), 'on');
      sfx('count');
    } else {
      lamps.forEach(l => l.className = 'g');
      E.count.innerHTML = '<span class="n on" style="font-size:200px">' + icons.go.replace('<svg', '<svg style="width:220px;height:220px"') + '</span>';
      E.lights.classList.add('off');
      sfx('go');
      countdown = null;
      setTimeout(() => { if (E.count) E.count.innerHTML = ''; }, 600);
    }
  }
  const inp = controls.read();
  guard('rev', () => VROOM.audio.engine.update({ rpm: inp.throttle ? 0.55 + 0.4 * Math.abs(Math.sin(cd.t * 9)) : 0.12, load: inp.throttle, speed: 0, boost: 0, air: false, surf: 0 }));
}
/* the race scene is game.js's; ui holds it still during the countdown and pause by wrapping update() once */
function holdRace() {
  const r = VROOM.scenes.race;
  if (!r || r.uiHold) return;
  const upd = r.update;
  r.uiHold = true;
  r.update = function (dt, t) {
    if (paused) return;
    if (countdown) { countdownTick(dt); return; }
    return upd.call(this, dt, t);
  };
}
function togglePause() {
  if (!game || game.current() !== 'race' || !H.els) return;
  if (paused) { resume(); return; }
  paused = true;
  sfx('slam', { v: 0.35, p: 1.6 });
  guard('pauseEngine', () => VROOM.audio.engine.update({ rpm: 0.08, load: 0, speed: 0, boost: 0, air: false, surf: 0 }));
  Object.assign(touch, { gas: 0, brake: 0, boost: 0, drift: 0, steer: 0, btn: 0 });
  const o = openOverlay('pause');
  const p = at(el('div', 'panel glow'), 300, 150, 600, 380); o.append(p);
  const stripe = at(el('div', 'stripe'), 330, 172, 540); o.append(stripe);
  const go = at(button({ icon: icons.go, cls: 'go', aria: 'resume', on: resume }), 420, 216, 360, 150); go.id = 'pResume';
  const again = at(button({ icon: icons.replay, aria: 'restart', on: () => { closeOverlay(); paused = false; race(H.n); } }), 340, 400, 110, 100);
  const mapB = at(button({ icon: icons.map, aria: 'map', on: () => { closeOverlay(); paused = false; nav('map', { world: worldOfLevel(H.n) }); } }), 470, 400, 110, 100);
  const homeB = at(button({ icon: icons.home, aria: 'home', on: () => { closeOverlay(); paused = false; nav('home'); } }), 600, 400, 110, 100);
  const q = VROOM.save.progress.quiet;
  const snd = at(button({ icon: q ? icons.mute : icons.sound, aria: 'sound', on: e => { toggleQuiet(); e.currentTarget.innerHTML = VROOM.save.progress.quiet ? icons.mute : icons.sound; } }), 730, 400, 110, 100);
  o.append(go, again, mapB, homeB, snd);
}
function resume() { if (!paused) return; closeOverlay(); paused = false; }
document.addEventListener('visibilitychange', () => { if (document.hidden && game && game.current() === 'race' && !paused && !countdown) togglePause(); });

/* ============ 6. splash: an original foundry sting, then the logo smashes through a steel plate ============ */
const FX = { parts: [], rings: [], g: null, embers: 0, dirty: false };
function fxBurst(x, y, count, speed, spread = Math.PI * 2, dir = -Math.PI / 2, life = 0.9) {
  for (let i = 0; i < count && FX.parts.length < 700; i++) {
    const a = dir + (Math.random() - 0.5) * spread, v = speed * (0.35 + Math.random() * 0.9);
    FX.parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: life * (0.5 + Math.random() * 0.7), max: 0, w: 1.5 + Math.random() * 2.5, ember: false });
    FX.parts[FX.parts.length - 1].max = FX.parts[FX.parts.length - 1].life;
  }
}
/* the spark canvas is half resolution and only touched while something is alive in it (an idle canvas costs nothing) */
function fxStep(dt) {
  const c = FX.g;
  if (!c) return;
  if (!FX.parts.length && !FX.rings.length) { if (FX.dirty) { c.clearRect(0, 0, C.STAGE_W, C.STAGE_H); FX.dirty = false; } return; }
  FX.dirty = true;
  c.clearRect(0, 0, C.STAGE_W, C.STAGE_H);
  c.globalCompositeOperation = 'lighter';
  for (let i = FX.rings.length - 1; i >= 0; i--) {
    const r = FX.rings[i];
    r.t += dt; const k = r.t / r.life;
    if (k >= 1) { FX.rings.splice(i, 1); continue; }
    c.strokeStyle = 'rgba(255,' + Math.round(200 - k * 120) + ',90,' + (1 - k) * 0.8 + ')';
    c.lineWidth = 18 * (1 - k) + 2;
    c.beginPath(); c.ellipse(r.x, r.y, r.r * (0.2 + k * 1.2), r.r * (0.2 + k * 1.2) * 0.42, 0, 0, Math.PI * 2); c.stroke();
  }
  for (let i = FX.parts.length - 1; i >= 0; i--) {
    const p = FX.parts[i];
    p.life -= dt;
    if (p.life <= 0) { FX.parts.splice(i, 1); continue; }
    if (p.ember) { p.vx += (Math.random() - 0.5) * 40 * dt; p.vy -= 10 * dt; } else { p.vy += 900 * dt; p.vx *= 1 - 0.8 * dt; }
    p.x += p.vx * dt; p.y += p.vy * dt;
    if (!p.ember && p.y > 690 && p.vy > 0) { p.vy *= -0.35; p.y = 690; }
    const k = p.life / p.max, hot = Math.round(150 + 105 * k);
    c.strokeStyle = 'rgba(255,' + hot + ',' + Math.round(60 + 150 * k * k) + ',' + Math.min(1, k * 1.6) + ')';
    c.lineWidth = p.w * (p.ember ? 1.4 : 1);
    c.beginPath(); c.moveTo(p.x, p.y); c.lineTo(p.x - p.vx * (p.ember ? 0.05 : 0.028), p.y - p.vy * (p.ember ? 0.05 : 0.028)); c.stroke();
  }
  c.globalCompositeOperation = 'source-over';
}
const SPL = { t: 0, t0: 0, phase: 0, left: false };
function splashLeave() {
  if (SPL.left) return;
  SPL.left = true;
  transition(() => game.go('home'));
}
VROOM.scenes.splash = {
  id: 'splash', dom: 'splash', view: null,
  enter() {
    SPL.t = 0; SPL.t0 = performance.now(); SPL.phase = 0; SPL.left = false;
    const s = $('splash'); s.classList.remove('s1', 's2', 's3', 'shake');
    FX.parts.length = 0; FX.rings.length = 0;
    const cv = $('splashFx');
    FX.g = cv ? cv.getContext('2d') : null;
    if (FX.g) { FX.g.setTransform(cv.width / C.STAGE_W, 0, 0, cv.height / C.STAGE_H, 0, 0); FX.g.clearRect(0, 0, C.STAGE_W, C.STAGE_H); FX.g.lineCap = 'round'; }
    s.onpointerdown = () => { sfx('press'); splashLeave(); };
    if (reduced()) { s.classList.add('s2', 's3'); SPL.phase = 9; }
    setAccent(1);
  },
  update(dt) {
    /* the timeline runs on the wall clock so a slow device still hands over on time; sparks step with the frame */
    dt = Math.min(dt, 0.05);
    SPL.t = (performance.now() - SPL.t0) / 1000;
    const s = $('splash'), t = SPL.t, rm = reduced();
    if (rm) { if (t > 1.6) splashLeave(); return; }
    if (SPL.phase === 0 && t > 0.12) { SPL.phase = 1; s.classList.add('s1'); }
    if (SPL.phase === 1 && t > 0.46) {
      /* the hammer lands on the anvil */
      SPL.phase = 2; sfx('slam', { v: 0.55, p: 1.5 });
      fxBurst(600, 330, 120, 900, Math.PI * 1.3); FX.rings.push({ x: 600, y: 336, r: 160, t: 0, life: 0.45 });
      flashSplash();
    }
    if (SPL.phase === 2 && t > 1.05) { SPL.phase = 3; s.classList.add('s2'); }
    if (SPL.phase === 3 && t > 1.2) { SPL.phase = 4; s.classList.add('s3'); sfx('whoosh', { v: 0.7, p: 0.7 }); }
    if (SPL.phase === 4 && t > 1.44) {
      /* the logo smashes through the plate: shockwave, sparks off every edge, the roar */
      SPL.phase = 5; sfx('slam', { v: 1 }); sfx('roar');
      s.classList.remove('shake'); void s.offsetWidth; s.classList.add('shake');
      flashSplash();
      FX.rings.push({ x: 600, y: 330, r: 700, t: 0, life: 0.6 });
      fxBurst(600, 320, 220, 1300, Math.PI * 2, 0, 1.2);
      for (const x of [260, 420, 600, 780, 940]) fxBurst(x, 410, 30, 700, 1.4, -Math.PI / 2, 1);
    }
    if (SPL.phase >= 5 && t < 3.0) {
      FX.embers += dt * 60;
      while (FX.embers > 1) { FX.embers -= 1; FX.parts.push({ x: 140 + Math.random() * 920, y: 600 + Math.random() * 100, vx: 0, vy: -60 - Math.random() * 120, life: 1.6, max: 1.6, w: 2, ember: true }); }
      if (Math.random() < dt * 5) fxBurst(300 + Math.random() * 600, 420, 18, 500, 0.9, -Math.PI / 2, 0.8);
    }
    fxStep(dt);
    if (t > 3.05) splashLeave();
  },
  exit() {
    const s = $('splash'); s.onpointerdown = null; s.classList.remove('shake');
    FX.parts.length = 0; FX.rings.length = 0;
    if (FX.g) FX.g.clearRect(0, 0, C.STAGE_W, C.STAGE_H);
  },
};
function flashSplash() { const f = $('splashFlash'); if (!f) return; f.classList.remove('on'); void f.offsetWidth; f.classList.add('on'); }

/* ============ 7. home: the world of the day, the logo, your machine idling on a steel podium ============ */
const HOME = { back: null, carScene: null, carCam: null, rig: null, pod: null, fx: null, car: null, rev: 0, w: 1, disposables: [], vp: [620, 34, 560, 440] };
function fakeCarState() {
  return { x: 0, y: 0, z: 0, qx: 0, qy: 0, qz: 0, qw: 1, vx: 0, vy: 0, vz: 0, wx: 0, wy: 0, wz: 0, s: 0, d: 0, h: 0, speed: 0, air: false, airT: 0,
    boost: 1, boosting: false, drift: 0, driftT: 0, spinT: 0, stunT: 0, respawnT: 0, surf: 0, rpm: 0.12, gear: 0,
    wheels: [0, 1, 2, 3].map(() => ({ x: 0, y: 0, z: 0, comp: 0.5, contact: true, spin: 0, steer: 0, slip: 0, surf: 0 })) };
}
function hazardTexture(T, cache) {
  const key = 'ui.hazardTex';
  if (cache && cache.has(key)) return cache.get(key);
  const c = document.createElement('canvas'); c.width = 512; c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#111214'; g.fillRect(0, 0, 512, 64);
  g.fillStyle = '#f2b705';
  for (let x = -64; x < 576; x += 48) { g.beginPath(); g.moveTo(x, 64); g.lineTo(x + 24, 64); g.lineTo(x + 88, 0); g.lineTo(x + 64, 0); g.fill(); }
  g.fillStyle = 'rgba(138,59,18,.35)';
  for (let i = 0; i < 40; i++) { g.beginPath(); g.arc((i * 97) % 512, (i * 37) % 64, 2 + (i % 5), 0, Math.PI * 2); g.fill(); }
  const tex = new T.CanvasTexture(c);
  tex.wrapS = T.RepeatWrapping; tex.repeat.set(4, 1); tex.colorSpace = T.SRGBColorSpace;
  if (cache) cache.set(key, tex);
  return tex;
}
function buildPodium(T, ctx, radius, accent) {
  const g = new T.Group(), d = HOME.disposables;
  const steel = new T.MeshStandardMaterial({ color: 0x4b515b, metalness: 0.85, roughness: 0.42, flatShading: true });
  const dark = new T.MeshStandardMaterial({ color: 0x1a1c21, metalness: 0.6, roughness: 0.7, flatShading: true });
  const haz = new T.MeshStandardMaterial({ map: hazardTexture(T, ctx.cache), metalness: 0.3, roughness: 0.6, flatShading: true });
  const glow = new T.MeshBasicMaterial({ color: new T.Color(accent), toneMapped: false });
  d.push(steel, dark, haz, glow);
  const geoTop = new T.CylinderGeometry(radius, radius, 0.22, 12), geoBand = new T.CylinderGeometry(radius * 1.04, radius * 1.08, 0.3, 12, 1, true);
  const geoBase = new T.CylinderGeometry(radius * 1.12, radius * 1.24, 0.5, 12), geoRing = new T.TorusGeometry(radius * 1.1, 0.045, 4, 48);
  const geoBolt = new T.CylinderGeometry(0.09, 0.09, 0.08, 6);
  d.push(geoTop, geoBand, geoBase, geoRing, geoBolt);
  const top = new T.Mesh(geoTop, steel); top.position.y = -0.11;
  const band = new T.Mesh(geoBand, haz); band.position.y = -0.36;
  const base = new T.Mesh(geoBase, dark); base.position.y = -0.76;
  const ring = new T.Mesh(geoRing, glow); ring.rotation.x = Math.PI / 2; ring.position.y = -0.52;
  g.add(top, band, base, ring);
  for (let i = 0; i < 12; i++) {
    const b = new T.Mesh(geoBolt, dark), a = i / 12 * Math.PI * 2;
    b.position.set(Math.cos(a) * radius * 0.9, 0.02, Math.sin(a) * radius * 0.9); g.add(b);
  }
  return g;
}
function homeBuild3D() {
  const ctx = game.ctx, T = ctx && ctx.THREE;
  if (!T) return;
  HOME.back = guard('backdrop', () => VROOM.worlds.backdrop(ctx, HOME.w), null);
  const scene = new T.Scene(), a = setAccent(HOME.w);
  HOME.carScene = scene;
  scene.add(new T.HemisphereLight(0x9aa3b0, 0x2a1208, 1.1));
  const key = new T.DirectionalLight(0xffe2c0, 3.0); key.position.set(-5, 8, 6); scene.add(key);
  const rim = new T.DirectionalLight(new T.Color(a[1]), 3.5); rim.position.set(4, 3, -7); scene.add(rim);
  const under = new T.PointLight(new T.Color(a[2]), 30, 10, 2); under.position.set(0, 0.4, 3.2); scene.add(under);
  HOME.car = fakeCarState();
  HOME.rig = guard('buildCar', () => VROOM.cars.buildCar(ctx, VROOM.save.state, { garage: true }), null);
  const turn = new T.Group(); scene.add(turn); HOME.pod = turn;
  let size = new T.Vector3(4, 2.5, 5);
  if (HOME.rig && HOME.rig.group) {
    turn.add(HOME.rig.group);
    const box = new T.Box3().setFromObject(HOME.rig.group);
    if (Number.isFinite(box.min.x)) size = box.getSize(new T.Vector3());
  }
  const radius = Math.max(2.4, Math.max(size.x, size.z) * 0.62);
  turn.add(buildPodium(T, ctx, radius, a[2]));
  const vp = HOME.vp, cam = new T.PerspectiveCamera(30, vp[2] / vp[3], 0.1, 200);
  /* frame the machine and the podium (whose base sinks to about -1 m) with room to breathe */
  const reach = Math.max(radius * 2.5, size.y * 2.2);
  const dist = reach / (2 * Math.tan(15 * Math.PI / 180));
  const midY = (size.y - 1.0) * 0.5;
  cam.position.set(dist * 0.62, midY + dist * 0.3, dist * 0.74);
  cam.lookAt(0, midY, 0);
  HOME.carCam = cam;
  turn.rotation.y = -0.55;
  HOME.fx = guard('fx', () => VROOM.fx.create(ctx, scene), null);
}
function homeRender() {
  const r = game && game.ctx && game.ctx.renderer;
  if (!r) return;
  r.setScissorTest(false); r.setViewport(0, 0, C.STAGE_W, C.STAGE_H); r.autoClear = true;
  if (ATT.on && ATT.world) { r.render(ATT.world.scene, ATT.cam); return; }
  if (HOME.back) r.render(HOME.back.scene, HOME.back.camera); else r.clear();
  if (HOME.carScene && HOME.carCam) {
    const [x, y, w, h] = HOME.vp;
    r.autoClear = false; r.clearDepth();
    r.setViewport(x, y, w, h); r.setScissor(x, y, w, h); r.setScissorTest(true);
    r.render(HOME.carScene, HOME.carCam);
    r.setScissorTest(false); r.setViewport(0, 0, C.STAGE_W, C.STAGE_H); r.autoClear = true;
  }
}
function homeRev() {
  HOME.rev = 1;
  sfx('rev');
  const rig = HOME.rig, f = HOME.fx;
  if (rig && f && rig.anchors && rig.anchors.exhaust && !reduced()) {
    for (const e of rig.anchors.exhaust) {
      const v = new game.ctx.THREE.Vector3(e[0], e[1], e[2]);
      rig.group.localToWorld(v);
      guard('fxEmit', () => { f.emit('fire', [v.x, v.y, v.z], { n: 8 }); f.emit('smoke', [v.x, v.y, v.z], { n: 4 }); });
    }
  }
}
/* ---- attract mode: after 20 s with no input on home, the autopilot races a level of the world of the day
   behind the menu, cut like a demo reel (chase, side, trackside, crane, head-on). Any input returns to the
   podium and is swallowed, so the press that wakes the screen never fires a plate. ?attract cuts the wait to 1 s.
   Reduced motion: it never starts (an idle demo is decoration). ---- */
/* PREP_S: the demo's world is built (and its shaders compiled) this long before it shows, so the cut-in is smooth */
const ATTRACT_IDLE = 20, SHOT_S = 4.2, PREP_S = 6;
const ATT = { on: false, idle: 0, last: 0, woke: -1e9, run: 0, n: 0, st: null, track: null, world: null, car: null, mons: [], cam: null, acc: 0, doneT: 0,
  shot: 0, shotT: 0, snap: true, side: 1, plant: null, prev: null, prevA: [], fr: {}, K: null, mx: -1, my: -1 };
const SHOTS = ['chase', 'side', 'trackside', 'crane', 'front'];
function attractParams() {
  const s = VROOM.save.state, st = VROOM.catalog.stats(s), body = VROOM.catalog.BODIES[s.body];
  if (body && !st.cls) st.cls = body.cls;
  return VROOM.sim.carParams(st, VROOM.save.progress.upgrades);
}
/* even runs a regular level of the world, odd runs its boss finale */
const attractLevel = run => (HOME.w - 1) * C.WORLD_SIZE + 1 + (run % 2 ? C.WORLD_SIZE - 1 : (HOME.w + run * 3) % (C.WORLD_SIZE - 1));
function attractClear() {
  if (ATT.mons) for (const m of ATT.mons) guard('attractDispose', () => m.dispose());
  if (ATT.car) guard('attractDispose', () => ATT.car.dispose());
  if (ATT.world) guard('attractDispose', () => ATT.world.dispose());
  Object.assign(ATT, { st: null, track: null, world: null, car: null, mons: [], cam: null });
}
function attractBuild() {
  attractClear();
  const S = VROOM.sim, ctx = game.ctx, T = ctx.THREE, n = attractLevel(ATT.run);
  const spec = VROOM.levels.level(n), track = S.buildTrack(spec);
  const st = S.newRace(track, attractParams(), { seed: spec.seed, mode: 'race' });
  const world = VROOM.worlds.buildWorld(ctx, track, spec);
  ATT.world = world;
  const car = VROOM.cars.buildCar(ctx, VROOM.save.state);
  ATT.car = car; world.scene.add(car.group);
  ATT.mons = st.actors.map(a => { const r = VROOM.monsters.build(ctx, a.kind); world.scene.add(r.group); return r; });
  const V = () => new T.Vector3();
  Object.assign(ATT, { n, st, track, cam: new T.PerspectiveCamera(50, C.STAGE_W / C.STAGE_H, 0.1, 3000), acc: 0, doneT: 0,
    prev: { x: 0, y: 0, z: 0, q: new T.Quaternion() }, prevA: [], q: new T.Quaternion(),
    K: { pos: V(), look: V(), want: V(), wlook: V(), up: new T.Vector3(0, 1, 0), tmp: V(), fov: 50 } });
  /* the menu holds the left of the screen: the lens is shifted so the action sits right of centre */
  ATT.cam.setViewOffset(C.STAGE_W, C.STAGE_H, -C.STAGE_W * 0.16, 0, C.STAGE_W, C.STAGE_H);
  attractSavePrev();
  attractCut(ATT.run % 2 ? 4 : 0);
  /* warm the programs now (while the podium sits idle), not on the first frame shown: a cold compile held the main
     thread for seconds. Synchronous on purpose: compileAsync polls programs a wake may already have disposed */
  guard('attractCompile', () => ctx.renderer.compile(world.scene, ATT.cam));
}
function attractSavePrev() {
  const c = ATT.st.car, p = ATT.prev, A = ATT.st.actors;
  p.x = c.x; p.y = c.y; p.z = c.z; p.q.set(c.qx, c.qy, c.qz, c.qw);
  for (let i = 0; i < A.length; i++) { const a = A[i], q = ATT.prevA[i] || (ATT.prevA[i] = [0, 0, 0, 0]); q[0] = a.x; q[1] = a.y; q[2] = a.z; q[3] = a.yaw; }
}
function attractCut(i) {
  ATT.shot = i; ATT.shotT = performance.now(); ATT.snap = true; ATT.side = -ATT.side; ATT.plant = null;
  if (SHOTS[i] === 'trackside') {
    /* a camera planted on the verge 40 m ahead: the car screams past it */
    const T = ATT.track, f = VROOM.sim.frameAt(T, clamp(ATT.st.car.s + 40, 0, T.length), ATT.fr), off = f.hw + 3.5;
    ATT.plant = new game.ctx.THREE.Vector3(f.x + f.rx * off * ATT.side + f.ux * 2.2, f.y + f.ry * off * ATT.side + f.uy * 2.2, f.z + f.rz * off * ATT.side + f.uz * 2.2);
  }
}
/* the idle demo is pure decoration: under reduced motion it never starts (the podium stays still) */
function attractStart() {
  if (ATT.on || reduced() || !game || game.current() !== 'home' || !game.ctx || !game.ctx.renderer) return false;
  if (!attractPrep()) return false;
  ATT.shotT = performance.now(); ATT.snap = true;
  ATT.on = true;
  $('home').classList.add('attract');
  return true;
}
/* build the demo's first run ahead of showing it (a no-op once built) */
function attractPrep() {
  if (ATT.st) return true;
  ATT.run = 0;
  if (!guard('attract', () => { attractBuild(); return true; }, false)) { attractClear(); return false; }
  return true;
}
function attractStop() {
  ATT.idle = 0; ATT.last = performance.now();
  if (!ATT.on) { if (ATT.st) attractClear(); return false; }
  ATT.on = false;
  attractClear();
  const h = $('home'); if (h) h.classList.remove('attract');
  return true;
}
function attractStep(dt, t) {
  const S = VROOM.sim, st = ATT.st, c = st.car;
  ATT.acc = Math.min(ATT.acc + dt, C.SIM_DT * C.MAX_STEPS_PER_FRAME);
  while (ATT.acc >= C.SIM_DT) { attractSavePrev(); S.step(st, S.autopilot(st, 1)); ATT.acc -= C.SIM_DT; }
  for (const ev of st.events) {
    guard('attractEvent', () => ATT.world.onEvent(ev, st));
    if (ev.type === 'monster' || ev.type === 'boss') { const r = ATT.mons[ev.a]; if (r) guard('attractEvent', () => r.onEvent(ev.what)); }
  }
  st.events.length = 0;
  const k = ATT.acc / C.SIM_DT, p = ATT.prev, g = ATT.car.group;
  g.position.set(p.x + (c.x - p.x) * k, p.y + (c.y - p.y) * k, p.z + (c.z - p.z) * k);
  g.quaternion.copy(p.q).slerp(ATT.q.set(c.qx, c.qy, c.qz, c.qw), k);
  ATT.car.update(c, dt, t);
  for (let i = 0; i < st.actors.length; i++) {
    const a = st.actors[i], r = ATT.mons[i], q = ATT.prevA[i];
    if (!r) continue;
    let dy = a.yaw - q[3];
    dy -= Math.round(dy / (2 * Math.PI)) * 2 * Math.PI;
    r.group.position.set(q[0] + (a.x - q[0]) * k, q[1] + (a.y - q[1]) * k, q[2] + (a.z - q[2]) * k);
    r.group.rotation.y = q[3] + dy * k;
    r.update(a, dt, t);
  }
  attractCamera(dt, t);
  ATT.world.update(st, dt, t, ATT.cam);
  guard('engineUpdate', () => VROOM.audio.engine.update({ rpm: c.rpm, load: 0.5, speed: c.speed, boost: c.boosting, air: c.air, surf: c.surf, drift: c.drift !== 0 }));
  /* a finished run (or one that somehow stalls) rolls on to the next level */
  if (!st.finished) ATT.doneT = 0; else if (!ATT.doneT) ATT.doneT = performance.now();
  if ((ATT.doneT && performance.now() - ATT.doneT > 2000) || st.t > 180) { ATT.run++; if (!guard('attract', () => { attractBuild(); return true; }, false)) attractStop(); }
}
function attractCamera(dt, t) {
  const K = ATT.K, cam = ATT.cam, c = ATT.st.car, pos = ATT.car.group.position, T = ATT.track, rm = reduced();
  const f = VROOM.sim.frameAt(T, clamp(c.s, 0, T.length), ATT.fr);
  /* shots are timed on the wall clock, so a slow device still sees the cuts */
  const held = (performance.now() - ATT.shotT) / 1000, shot = SHOTS[ATT.shot];
  if (!rm && (held > SHOT_S || (shot === 'trackside' && ATT.plant && held > 1 && K.tmp.copy(pos).sub(ATT.plant).dot(K.want.set(f.tx, f.ty, f.tz)) > 18))) {
    /* a boss on the track favours the head-on shot, so the chase fills the frame */
    const boss = ATT.st.actors.some(a => a.boss && a.alive);
    attractCut(boss && ATT.shot !== 4 && (ATT.run + Math.floor(t / SHOT_S)) % 2 ? 4 : (ATT.shot + 1) % SHOTS.length);
  }
  const sh = SHOTS[ATT.shot], up = K.up.set(f.ux, f.uy, f.uz);
  const at = (b, l, u) => K.want.set(pos.x + f.tx * b + f.rx * l + up.x * u, pos.y + f.ty * b + f.ry * l + up.y * u, pos.z + f.tz * b + f.rz * l + up.z * u);
  let fov = 50, lead = 4, sway = rm ? 0 : Math.sin(t * 0.7);
  if (sh === 'chase') { at(-9 - Math.min(3, Math.abs(c.speed) * 0.05), sway * 1.2, 2.6); fov = 56; }
  else if (sh === 'side') { at(1.5 + sway, 10 * ATT.side, 1.8); fov = 46; lead = 2; }
  else if (sh === 'trackside' && ATT.plant) { K.want.copy(ATT.plant); fov = clamp(14 + 600 / Math.max(10, K.want.distanceTo(pos)), 18, 52); lead = 0; }
  /* the crane rides high behind and off to the side, never straight over the car (that put it under the menu) */
  else if (sh === 'crane') { const h = Math.min(SHOT_S, (performance.now() - ATT.shotT) / 1000); at(-16 + h * 1.5, 7 * ATT.side, 15 - h * 0.8); fov = 50; lead = 8; }
  else { at(12 + sway, 2.5 * ATT.side, 1.3); fov = 46; lead = -6; }
  K.wlook.set(pos.x + f.tx * lead + up.x * 0.9, pos.y + f.ty * lead + up.y * 0.9, pos.z + f.tz * lead + up.z * 0.9);
  const kp = ATT.snap ? 1 : 1 - Math.exp(-dt * (sh === 'trackside' ? 50 : 6));
  if (ATT.snap || K.pos.distanceTo(K.want) > 60) { K.pos.copy(K.want); K.look.copy(K.wlook); K.fov = fov; }
  else { K.pos.lerp(K.want, kp); K.look.lerp(K.wlook, 1 - Math.exp(-dt * 9)); K.fov += (fov - K.fov) * (1 - Math.exp(-dt * 4)); }
  ATT.snap = false;
  cam.position.copy(K.pos); cam.up.copy(up); cam.lookAt(K.look);
  if (Math.abs(cam.fov - K.fov) > 0.05) { cam.fov = K.fov; cam.updateProjectionMatrix(); }
}
/* any input on home: resets the idle clock, and wakes attract mode. The waking press does nothing else, nor
   does a press within 0.6 s of a wake (a mouse glides onto GO and clicks: the glide woke it, the click is eaten) */
function homeInput(e) {
  if (!game || game.current() !== 'home') return;
  if (e.type === 'pointermove') {
    const moved = ATT.mx >= 0 && Math.abs(e.clientX - ATT.mx) + Math.abs(e.clientY - ATT.my) > 8;
    ATT.mx = e.clientX; ATT.my = e.clientY;
    if (!moved) return;
  }
  ATT.idle = 0; ATT.last = performance.now();
  const woke = attractStop();
  if (woke) ATT.woke = ATT.last;
  if (e.type !== 'pointermove' && (woke || performance.now() - ATT.woke < 600)) { e.stopPropagation(); if (e.cancelable) e.preventDefault(); }
}
for (const ev of ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart']) addEventListener(ev, homeInput, { capture: true, passive: false });
function padActive() {
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  for (const g of pads) {
    if (!g || !g.connected) continue;
    if (g.buttons.some(b => b && (b.pressed || b.value > 0.3)) || g.axes.some(a => Math.abs(a) > 0.4)) return true;
  }
  return false;
}
function attractTick(dt, t) {
  /* idle is wall-clock seconds since the last input, so slow frames do not stretch the 20 s */
  const now = performance.now();
  if (!ATT.last) ATT.last = now;
  if (padActive()) attractStop();
  const ovl = $('ovl'), busy = (ovl && ovl.classList.contains('open')) || document.hidden;
  if (busy) { attractStop(); return; }
  ATT.idle = (now - ATT.last) / 1000;
  const at = params.has('attract') ? 1 : ATTRACT_IDLE;
  if (!ATT.on && !ATT.st && !reduced() && ATT.idle >= at - PREP_S) attractPrep();
  if (!ATT.on && ATT.idle >= at) attractStart();
  if (ATT.on && !guard('attractStep', () => { attractStep(dt, t); return true; }, false)) attractStop();
}
VROOM.scenes.home = {
  id: 'home', dom: 'home', view: null,
  enter() {
    const PR = VROOM.save.progress, root = $('homeHud');
    HOME.w = worldOfDay(); HOME.rev = 0; ATT.idle = 0; ATT.last = performance.now();
    root.innerHTML = '';
    homeBuild3D();
    const cur = Math.min(PR.current || 1, C.MAX_LEVEL);
    const wod = el('div', 'chip slam', icons.calendar + emblem(HOME.w) + n(HOME.w, 's'), '--d:.15s'); wod.className += ' wod';
    const go = button({ icon: icons.go + n(cur, 'gl') + (C.isFinale(cur) ? skullSvg().replace('<svg', '<svg class="boss"') : ''), cls: 'go slam pulse', aria: 'go', on: () => race(cur) });
    go.id = 'homeGo'; go.style.setProperty('--d', '.2s');
    const gar = at(button({ icon: icons.garage, cls: 'slam', aria: 'garage', on: () => nav('garage') }), 56, 520, 130, 130); gar.style.setProperty('--d', '.3s');
    const map = at(button({ icon: icons.map, cls: 'slam', aria: 'map', on: () => nav('map') }), 206, 520, 130, 130); map.style.setProperty('--d', '.36s');
    const alb = at(button({ icon: icons.trophy, cls: 'slam', aria: 'album', on: () => openAlbum() }), 356, 534, 104, 104); alb.style.setProperty('--d', '.42s');
    const set = at(button({ icon: icons.gear, cls: 'slam dark', aria: 'settings', on: () => openSettings() }), 476, 534, 104, 104); set.style.setProperty('--d', '.48s');
    const meta = VROOM.save.meta;
    const prof = button({ icon: avatarSvg(meta.avatars[meta.active] || 'pup') + n(meta.active + 1, 's'), cls: 'slam', aria: 'profile', on: () => openProfiles() });
    prof.style.cssText = 'right:24px;top:20px;width:104px;height:104px;--d:.2s';
    prof.querySelector('.n').style.cssText = 'position:absolute;right:8px;bottom:4px';
    const wal = el('div', 'chip slam', icons.star + n(PR.wallet), 'right:146px;top:34px;--d:.25s'); wal.id = 'homeWallet';
    const rev = button({ icon: '', cls: 'ghost', aria: 'rev', on: homeRev }); rev.id = 'homeRev';
    root.append(rev, wod, go, gar, map, alb, set, wal, prof);
    guard('music', () => VROOM.audio.music.play('title'));
    guard('amb', () => VROOM.audio.ambience(0));
    guard('engine', () => VROOM.audio.engine.start(VROOM.save.state.body));
    if (pendingImport) { const c = pendingImport; pendingImport = ''; setTimeout(() => importFlow(c), 400); }
  },
  update(dt, t) {
    attractTick(dt, t);
    if (ATT.on) { homeRender(); return; }
    if (HOME.back) guard('backdropUpdate', () => HOME.back.update(dt, t));
    HOME.rev = Math.max(0, HOME.rev - dt * 1.4);
    const car = HOME.car, rv = HOME.rev, rm = reduced();
    if (car) {
      car.rpm = 0.12 + rv * 0.85 + (rm ? 0 : Math.sin(t * 7) * 0.01);
      car.speed = 0;
      for (const w of car.wheels) { w.comp = 0.5 + rv * 0.25 * Math.sin(t * 40); w.spin += rv * dt * 30; }
      if (HOME.rig) guard('rigUpdate', () => HOME.rig.update(car, dt, t));
      guard('engineUpdate', () => VROOM.audio.engine.update({ rpm: car.rpm, load: rv, speed: 0, boost: 0, air: false, surf: 0 }));
    }
    if (HOME.pod && !rm) {
      HOME.pod.rotation.y += dt * 0.22;
      if (HOME.rig) { HOME.rig.group.position.y = rv * 0.05 * Math.sin(t * 50); HOME.rig.group.rotation.z = rv * 0.02 * Math.sin(t * 33); }
    }
    if (HOME.fx) guard('fxUpdate', () => HOME.fx.update(dt));
    homeRender();
  },
  exit() {
    attractStop();
    guard('engineStop', () => VROOM.audio.engine.stop());
    if (HOME.back) guard('backdropDispose', () => HOME.back.dispose());
    if (HOME.rig) guard('rigDispose', () => HOME.rig.dispose());
    if (HOME.fx) guard('fxDispose', () => HOME.fx.dispose());
    for (const d of HOME.disposables) guard('dispose', () => d.dispose());
    HOME.disposables = []; HOME.back = HOME.rig = HOME.fx = HOME.carScene = HOME.carCam = HOME.pod = HOME.car = null;
    $('homeHud').innerHTML = '';
  },
};

/* ============ 8. map: twelve world plates, a route of ten levels over the world's backdrop ============ */
const ROUTE = [[150, 196], [368, 176], [588, 204], [808, 176], [1030, 204], [1030, 420], [808, 446], [588, 418], [368, 446], [138, 418]];
const MAP = { w: 1, back: null };
const worldOpen = w => !!VROOM.save.levelOpen((w - 1) * C.WORLD_SIZE + 1);
function levelInfo(lv) {
  const rec = VROOM.save.progress.levels[lv] || null;
  const spec = guard('level', () => VROOM.levels.level(lv), null);
  return { rec, total: spec && spec.stars ? spec.stars.length : 0 };
}
function mapWorld(w, first) {
  const root = $('mapHud'), PR = VROOM.save.progress;
  MAP.w = w;
  setAccent(w);
  if (MAP.back) guard('backdropDispose', () => MAP.back.dispose());
  MAP.back = guard('backdrop', () => VROOM.worlds.backdrop(game.ctx, w), null);
  VROOM.scenes.map.view = MAP.back ? { scene: MAP.back.scene, camera: MAP.back.camera } : null;
  guard('amb', () => VROOM.audio.ambience(w));
  root.innerHTML = '';
  /* the chain the route hangs on */
  let d = 'M' + ROUTE[0][0] + ' ' + ROUTE[0][1];
  for (let i = 1; i < ROUTE.length; i++) {
    const [x0, y0] = ROUTE[i - 1], [x1, y1] = ROUTE[i];
    d += i === 5 ? ' C' + (x0 + 120) + ' ' + y0 + ' ' + (x1 + 120) + ' ' + y1 + ' ' + x1 + ' ' + y1 : ' L' + x1 + ' ' + y1;
  }
  const base = (w - 1) * C.WORLD_SIZE;
  let doneTo = 0;
  for (let k = 1; k <= C.WORLD_SIZE; k++) if (PR.levels[base + k]) doneTo = k;
  root.append(el('div', '', '<svg class="route" viewBox="0 0 1200 700" aria-hidden="true"><path d="' + d + '" fill="none" stroke="#050608" stroke-width="22" stroke-linecap="round"/>'
    + '<path d="' + d + '" fill="none" stroke="#4b515b" stroke-width="12" stroke-dasharray="14 8" stroke-linecap="round"/>'
    + '<path d="' + d + '" pathLength="9" fill="none" stroke="var(--acc2)" stroke-width="8" stroke-dasharray="' + Math.max(0, doneTo - 1) + ' 99" stroke-linecap="round" style="filter:drop-shadow(0 0 8px var(--acc2))"/></svg>'));
  let got = 0, all = 0;
  for (let k = 1; k <= C.WORLD_SIZE; k++) {
    const lv = base + k, open = VROOM.save.levelOpen(lv), info = levelInfo(lv), fin = C.isFinale(lv), [cx, cy] = ROUTE[k - 1];
    got += info.rec ? info.rec.best | 0 : 0; all += info.total;
    const size = fin ? 148 : 118;
    let inner;
    if (fin) inner = skullSvg(PR.bosses.includes(w) ? '#8cff3a' : 'var(--acc2)', PR.bosses.includes(w)).replace('<svg', '<svg class="skull"') + n(lv, 's');
    else inner = open ? n(lv) : icons.lock.replace('<svg', '<svg class="ic"');
    if (info.rec) {
      const r = clamp(info.rec.rating | 0, 1, 3);
      inner += '<span class="pips">' + [1, 2, 3].map(i => i <= r ? icons.star : icons.starOff).join('') + '</span>';
      if (info.rec.tier) inner += medalSvg(info.rec.tier).replace('<svg', '<svg class="medal"');
    }
    const b = at(button({ icon: inner, cls: 'lvl slam' + (fin ? ' boss' : '') + (open ? '' : ' locked') + (open && !info.rec ? ' next' : ''), aria: 'level ' + lv,
      on: e => { if (VROOM.save.levelOpen(lv)) race(lv); else deny(e.currentTarget); } }), cx - size / 2, cy - size / 2, size, size);
    b.style.setProperty('--d', (first ? 0.1 : 0) + k * 0.03 + 's');
    root.append(b);
  }
  if (w === C.WORLD_COUNT && VROOM.save.levelOpen(C.PARADE_LEVEL)) {
    const pb = at(button({ icon: icons.flag + icons.trophy.replace('<svg', '<svg style="position:absolute;width:44px;height:44px;right:8px;bottom:8px"'), cls: 'molten slam', aria: 'parade', on: () => race(C.PARADE_LEVEL) }), 640, 262, 118, 118);
    root.append(pb);
  }
  const head = el('div', 'chip head slam', emblem(w) + n(w) + '<span style="width:14px"></span>' + icons.star + n(got) + n('/', 's') + n(all, 's'));
  const home = at(button({ icon: icons.home, aria: 'home', on: () => nav('home') }), 20, 16, 100, 100);
  const gar = button({ icon: icons.garage, aria: 'garage', on: () => nav('garage') }); gar.style.cssText = 'right:20px;top:16px;width:100px;height:100px';
  const wal = el('div', 'chip', icons.star + n(PR.wallet), 'right:136px;top:28px');
  root.append(head, home, gar, wal);
  for (let i = 1; i <= C.WORLD_COUNT; i++) {
    const open = worldOpen(i), on = i === w;
    const tab = at(button({ icon: emblem(i) + n(i) + (open ? '' : icons.lock.replace('<svg', '<svg class="lk"')), cls: 'tab' + (on ? ' on' : '') + (open ? '' : ' locked'), aria: 'world ' + i,
      on: e => { if (!worldOpen(i)) { deny(e.currentTarget); return; } if (i !== MAP.w) mapWorld(i, false); } }), 30 + (i - 1) * 96, 598, 88, 88);
    root.append(tab);
  }
}
VROOM.scenes.map = {
  id: 'map', dom: 'map', view: null,
  enter(p = {}) {
    let w = p.world || C.worldOf(Math.min(C.MAX_LEVEL, VROOM.save.progress.current || 1));
    if (!worldOpen(w)) w = 1;
    mapWorld(w, true);
    guard('music', () => VROOM.audio.music.play('map'));
  },
  update(dt, t) { if (MAP.back) guard('backdropUpdate', () => MAP.back.update(dt, t)); },
  exit() {
    if (MAP.back) guard('backdropDispose', () => MAP.back.dispose());
    MAP.back = null; this.view = null;
    guard('amb', () => VROOM.audio.ambience(0));
    $('mapHud').innerHTML = '';
  },
};

/* ============ 9. results: a slammed gunmetal card, the medal stamp, the payout tallying into the wallet ============ */
const RES = { back: null, timers: [], tally: null };
VROOM.scenes.results = {
  id: 'results', dom: 'results', view: null,
  enter(p = {}) {
    const root = $('resultsHud'), PR = VROOM.save.progress;
    const lvN = p.n || 1, res = p.result || { time: 0, stars: 0, starsTotal: 0, rating: 1, tier: 'C', hits: 0, airTime: 0, driftTime: 0, tricks: 0, respawns: 0, clean: false };
    const rec = p.rec || null, w = worldOfLevel(lvN);
    root.innerHTML = '';
    setAccent(w);
    RES.back = guard('backdrop', () => VROOM.worlds.backdrop(game.ctx, w), null);
    this.view = RES.back ? { scene: RES.back.scene, camera: RES.back.camera } : null;
    const card = el('div', 'panel glow slam'); card.id = 'rCard';
    card.append(el('div', 'stripe'));
    const medal = el('div', 'stamp', medalSvg(res.tier)); medal.id = 'rMedal';
    const rating = el('div'); rating.id = 'rRating';
    const rt = clamp(res.rating | 0, 1, 3);
    for (let i = 1; i <= 3; i++) { const s = el('span', '', i <= rt ? icons.star : icons.starOff).firstChild; s.classList.add(i <= rt ? 'on' : 'off'); s.style.setProperty('--d', (0.8 + i * 0.22) + 's'); rating.append(s); }
    const time = el('div', '', icons.clock + n(fmtTime(res.time))); time.id = 'rTime';
    const best = el('div', rec && rec.newBest && !rec.first ? 'on' : '', sv(P('M32 2 L38 20 L58 10 L46 28 L62 36 L44 40 L50 60 L32 46 L14 60 L20 40 L2 36 L18 28 L6 10 L26 20 Z', '#ffb02e') + P('M24 26 L40 26 L32 44 Z', '#fff6c8') + LL('M32 14 V24', '#fff6c8', 5))); best.id = 'rBest';
    const stars = el('div', '', icons.star + n(res.stars) + n('/', 's') + n(res.starsTotal, 's')); stars.id = 'rStars';
    const stats = el('div'); stats.id = 'rStats';
    const stat = (svg, v) => stats.append(el('div', 'st', svg + n(v, 's')));
    stat(icons.air, (res.airTime || 0).toFixed(1)); stat(icons.drift, (res.driftTime || 0).toFixed(1)); stat(icons.flip, res.tricks | 0); stat(icons.hit, res.hits | 0);
    if (res.respawns) stat(icons.crane, res.respawns | 0);
    const pay = el('div', '', icons.star + n('+' + (rec ? rec.payout | 0 : 0), 'gold')); pay.id = 'rPay';
    card.append(medal, rating, time, best, stars, stats, pay);
    if (C.isFinale(lvN)) { const b = el('div', 'on', skullSvg('#8cff3a', true)); b.id = 'rBoss'; card.append(b); }
    const wal = el('div', 'chip', icons.star + n((PR.wallet - (rec ? rec.payout : 0)) | 0)); wal.id = 'rWallet';
    const nextN = lvN < C.MAX_LEVEL ? lvN + 1 : lvN === C.MAX_LEVEL ? C.PARADE_LEVEL : 0;
    const canNext = nextN && VROOM.save.levelOpen(nextN);
    const again = at(button({ icon: icons.replay, cls: 'rise', aria: 'replay', on: () => race(lvN) }), 190, 534, 120, 120);
    const gar = at(button({ icon: icons.garage, cls: 'rise', aria: 'garage', on: () => nav('garage') }), 330, 534, 120, 120);
    const mapB = at(button({ icon: icons.map, cls: 'rise', aria: 'map', on: () => nav('map', { world: w }) }), 470, 534, 120, 120);
    const home = at(button({ icon: icons.home, cls: 'rise', aria: 'home', on: () => nav('home') }), 610, 534, 120, 120);
    const next = at(button({ icon: icons.next, cls: 'go rise', aria: 'next', on: () => (canNext ? race(nextN) : nav('home')) }), 770, 516, 240, 156);
    [again, gar, mapB, home, next].forEach((b, i) => b.style.setProperty('--d', (0.5 + i * 0.06) + 's'));
    root.append(card, wal, again, gar, mapB, home, next);
    guard('music', () => VROOM.audio.music.play('results'));
    sfx('slam', { v: 0.7 });
    RES.timers.push(setTimeout(() => sfx('medal'), 600));
    for (let i = 1; i <= rt; i++) RES.timers.push(setTimeout(() => sfx('star', { p: 1 + i * 0.12 }), 800 + i * 220));
    /* the payout ticks into the wallet */
    const payout = rec ? rec.payout | 0 : 0, from = (PR.wallet - payout) | 0;
    RES.tally = { t: -1.5, payout, from, shown: -1, wal: wal.querySelector('.n'), walEl: wal };
    if (rec && rec.badges) rec.badges.forEach((id, i) => RES.timers.push(setTimeout(() => { toast(badgeSvg(id)); sfx('unlock'); }, 1900 + i * 700)));
    if (rec && rec.newBest && !rec.first) RES.timers.push(setTimeout(() => sfx('fanfare'), 1150));
  },
  update(dt, t) {
    if (RES.back) guard('backdropUpdate', () => RES.back.update(dt, t));
    const T = RES.tally;
    if (!T) return;
    T.t += dt;
    if (T.t < 0) return;
    const k = reduced() ? 1 : Math.min(1, T.t / Math.max(0.6, Math.min(1.8, T.payout * 0.08)));
    const shown = Math.round(T.payout * k);
    if (shown !== T.shown) {
      T.shown = shown;
      T.wal.textContent = T.from + shown;
      if (shown > 0) { sfx('tick', { p: 1 + shown / Math.max(1, T.payout) * 0.5 }); T.walEl.classList.remove('pop'); void T.walEl.offsetWidth; T.walEl.classList.add('pop'); }
    }
    if (k >= 1) RES.tally = null;
  },
  exit() {
    RES.timers.forEach(clearTimeout); RES.timers = []; RES.tally = null;
    if (RES.back) guard('backdropDispose', () => RES.back.dispose());
    RES.back = null; this.view = null;
    $('resultsHud').innerHTML = '';
  },
};

/* ============ 10. overlays: settings, profiles, the album, the code import ============ */
function openOverlay(kind) {
  const o = $('ovl');
  o.innerHTML = ''; o.className = 'open';
  o.onpointerdown = e => { if (e.target === o && kind !== 'pause') closeOverlay(); };
  return o;
}
function closeOverlay() {
  const o = $('ovl');
  if (!o) return;
  o.innerHTML = ''; o.className = ''; o.onpointerdown = null;
}
const closeBtn = (on = closeOverlay) => { const b = button({ icon: icons.cross, cls: 'dark close', aria: 'close', on }); b.style.width = b.style.height = '96px'; return b; };
function toggleQuiet() {
  const P = VROOM.save.progress;
  P.quiet = !P.quiet;
  guard('quiet', () => VROOM.audio.setQuiet(P.quiet));
  VROOM.save.save();
}
function setCrt(on) { const s = $('stage'); if (s) s.classList.toggle('crt', on); prefSet('vroom.crt', on ? '1' : '0'); }
function openSettings() {
  const o = openOverlay('settings'), PR = VROOM.save.progress;
  o.append(at(el('div', 'panel glow'), 200, 70, 800, 560), closeBtn());
  o.querySelector('.close').style.cssText += ';left:880px;top:48px';
  const row = (y, svg) => o.append(at(el('div', '', svg, 'position:absolute;width:64px;height:64px;opacity:.85'), 250, y + 22));
  /* sound */
  row(110, icons.sound);
  const snd = at(button({ icon: PR.quiet ? icons.mute : icons.sound, cls: PR.quiet ? '' : 'on', aria: 'sound', on: e => { toggleQuiet(); e.currentTarget.innerHTML = PR.quiet ? icons.mute : icons.sound; e.currentTarget.classList.toggle('on', !PR.quiet); } }), 350, 110, 108, 108);
  /* the CRT scanlines, off by default */
  const crtOn = $('stage').classList.contains('crt');
  const crt = at(button({ icon: icons.crt, cls: crtOn ? 'on' : '', aria: 'scanlines', on: e => { const v = !$('stage').classList.contains('crt'); setCrt(v); e.currentTarget.classList.toggle('on', v); } }), 480, 110, 108, 108);
  o.append(snd, crt);
  /* steering: drag, tilt, buttons */
  row(260, icons.drag);
  const modes = [['drag', icons.drag], ['tilt', icons.tilt], ['buttons', icons.buttons]];
  const mb = modes.map(([aria, svg], i) => at(button({ icon: svg, cls: (PR.ctrl.mode | 0) === i ? 'on' : '', aria, on: () => {
    PR.ctrl.mode = i; VROOM.save.save(); mb.forEach((b, j) => b.classList.toggle('on', i === j));
    if (i === 1 && window.DeviceOrientationEvent && typeof window.DeviceOrientationEvent.requestPermission === 'function') window.DeviceOrientationEvent.requestPermission().catch(() => {});
  } }), 350 + i * 130, 260, 108, 108));
  o.append(...mb);
  /* sensitivity, three pips */
  row(410, icons.sens);
  const sb = [1, 2, 3].map(v => at(button({ icon: '<span class="sens">' + '<i class="on"></i>'.repeat(v) + '<i></i>'.repeat(3 - v) + '</span>', cls: (PR.ctrl.sens | 0) === v ? 'on' : '', aria: 'sensitivity ' + v, on: () => {
    PR.ctrl.sens = v; VROOM.save.save(); sb.forEach((b, j) => b.classList.toggle('on', j + 1 === v));
  } }), 350 + (v - 1) * 130, 410, 108, 108));
  sb.forEach(b => { const s = b.querySelector('.sens'); s.style.position = 'static'; });
  o.append(...sb);
}
function readProfile(i) {
  if (i === VROOM.save.meta.active) return VROOM.save.progress;
  try { return JSON.parse(localStorage.getItem('vroom.v2.p' + i)); } catch (e) { return null; }
}
function openProfiles() {
  const o = openOverlay('profiles'), S = VROOM.save, meta = S.meta;
  o.append(at(el('div', 'panel glow'), 70, 40, 1060, 620), closeBtn());
  o.querySelector('.close').style.cssText += ';left:1010px;top:22px';
  for (let i = 0; i < S.MAX_PROFILES; i++) {
    const av = meta.avatars[i], data = av ? readProfile(i) : null, active = i === meta.active;
    const inner = avatarSvg(av || 'pup').replace('<svg', '<svg class="av"') + n(i + 1, 's') + (av ? '<span class="wl">' + icons.star + n(data && Number.isFinite(data.wallet) ? data.wallet : 0, 's') + '</span>' : icons.plus.replace('<svg', '<svg style="position:absolute;width:56px;height:56px;right:14px;bottom:14px"'));
    const card = at(button({ icon: inner, cls: 'pcard' + (av ? '' : ' empty') + (active ? ' on' : ''), aria: 'profile ' + (i + 1), on: () => {
      if (active || !av) pickAvatar(i); else S.switchProfile(i);
    } }), 120 + i * 300, 80, 250, 300);
    o.append(card);
  }
  /* the save code: QR to carry the save to another device, copy and paste the code */
  const qr = at(el('div', 'qr', qrSvg()), 120, 410, 220, 220);
  const copy = at(button({ icon: icons.copy, aria: 'copy code', on: async () => {
    try { const code = await S.exportFullCode(); await navigator.clipboard.writeText(code); toast(icons.check); sfx('buy'); } catch (e) { toast(icons.cross); sfx('deny'); }
  } }), 380, 470, 120, 120);
  const paste = at(button({ icon: icons.paste, aria: 'paste code', on: () => pasteFlow() }), 520, 470, 120, 120);
  o.append(qr, copy, paste);
}
function qrSvg() {
  const m = guard('qr', () => VROOM.save.qrMatrix(), null);
  if (!m || !m.length) return icons.qr;
  const N = m.length;
  let d = '';
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (m[y][x]) d += 'M' + x + ' ' + y + 'h1v1h-1z';
  return '<svg viewBox="-2 -2 ' + (N + 4) + ' ' + (N + 4) + '" shape-rendering="crispEdges" aria-hidden="true"><path d="' + d + '" fill="#0d0e12"/></svg>';
}
function pickAvatar(i) {
  const o = openOverlay('avatar'), S = VROOM.save, meta = S.meta;
  o.append(at(el('div', 'panel glow'), 180, 120, 840, 460), closeBtn(openProfiles));
  o.querySelector('.close').style.cssText += ';left:900px;top:100px';
  S.AVATAR_IDS.forEach((id, k) => {
    const b = at(button({ icon: avatarSvg(id), cls: meta.avatars[i] === id ? 'on' : '', aria: 'avatar ' + id, on: () => {
      const was = meta.avatars[i];
      meta.avatars[i] = id; S.saveMeta();
      if (i === meta.active && was) { openProfiles(); refreshHome(); } else S.switchProfile(i);
    } }), 240 + (k % 3) * 250, 170 + Math.floor(k / 3) * 200, 200, 180);
    b.querySelector('svg').style.cssText = 'width:120px;height:120px';
    o.append(b);
  });
}
function refreshHome() {
  if (!game || game.current() !== 'home') return;
  const meta = VROOM.save.meta, b = document.querySelector('#homeHud [aria-label="profile"]');
  if (b) { b.innerHTML = avatarSvg(meta.avatars[meta.active] || 'pup') + n(meta.active + 1, 's'); b.querySelector('.n').style.cssText = 'position:absolute;right:8px;bottom:4px'; }
}
async function pasteFlow() {
  let text = '';
  try { text = await navigator.clipboard.readText(); } catch (e) {}
  if (text && /VROOM\d\./.test(text)) { importFlow(text.trim()); return; }
  /* no clipboard access: a bare paste box (no words, just the field and a tick) */
  const o = openOverlay('paste');
  o.append(at(el('div', 'panel glow'), 240, 200, 720, 340), closeBtn(openProfiles));
  o.querySelector('.close').style.cssText += ';left:840px;top:180px';
  const ta = document.createElement('textarea'); ta.setAttribute('aria-label', 'save code'); ta.spellcheck = false;
  const ok = at(button({ icon: icons.check, cls: 'go', aria: 'import', on: () => importFlow(ta.value.trim()) }), 520, 420, 160, 100);
  o.append(ta, ok, at(el('div', '', icons.paste, 'position:absolute;width:64px;height:64px'), 290, 230));
  setTimeout(() => ta.focus(), 50);
}
let pendingImport = '';
async function importFlow(code) {
  const S = VROOM.save;
  const data = code ? await S.checkCode(code).catch(() => null) : null;
  if (!data) { toast(icons.cross); sfx('deny'); return; }
  const o = openOverlay('import');
  o.append(at(el('div', 'panel glow'), 300, 150, 600, 400));
  o.append(at(el('div', 'chip', icons.star + n(data.wallet | 0), ''), 380, 210));
  o.append(at(el('div', 'chip', icons.flag + n(Math.min(C.MAX_LEVEL, data.current | 0 || 1)), ''), 640, 210));
  o.append(at(el('div', '', icons.paste, 'position:absolute;width:80px;height:80px'), 560, 310));
  const yes = at(button({ icon: icons.check, cls: 'go', aria: 'confirm', on: () => { S.importData(data); location.reload(); } }), 640, 410, 200, 110);
  const no = at(button({ icon: icons.cross, cls: 'red', aria: 'cancel', on: closeOverlay }), 360, 410, 200, 110);
  o.append(yes, no);
}
function openAlbum() {
  const o = openOverlay('album'), PR = VROOM.save.progress, ids = (VROOM.save.ids && VROOM.save.ids.BADGE_IDS) || C.LEGACY.BADGES;
  o.append(at(el('div', 'panel glow'), 70, 40, 1060, 620), closeBtn());
  o.querySelector('.close').style.cssText += ';left:1010px;top:22px';
  ids.forEach((id, i) => {
    const on = PR.badges.includes(id);
    o.append(at(el('div', 'badge ' + (on ? 'on' : 'off'), badgeSvg(id)), 130 + (i % 6) * 150, 90 + Math.floor(i / 6) * 150));
  });
  /* the bosses beaten, one emblem per world */
  for (let w = 1; w <= C.WORLD_COUNT; w++) {
    const beat = PR.bosses.includes(w);
    const b = at(el('div', 'badge ' + (beat ? 'on' : 'off'), emblem(w, '') + (beat ? skullSvg('#8cff3a', true).replace('<svg', '<svg style="position:absolute;width:44px;height:44px;right:-6px;bottom:-6px"') : '')), 110 + (w - 1) * 82, 430, 76, 76);
    b.querySelector('svg').style.cssText = 'width:52px;height:52px';
    o.append(b);
  }
  o.append(at(el('div', 'chip', skullSvg() + n(PR.bosses.length) + n('/', 's') + n(C.WORLD_COUNT, 's')), 120, 540));
  o.append(at(el('div', 'chip', icons.trophy + n(PR.badges.filter(b => ids.includes(b)).length) + n('/', 's') + n(ids.length, 's')), 420, 540));
}

/* ============ 11. init ============ */
/* film grain and grime specks, painted once into a raster tile (an SVG noise filter re-rasterizes every frame) */
function grain() {
  const gr = $('grime');
  if (!gr) return;
  try {
    const c = document.createElement('canvas'); c.width = c.height = 192;
    const g = c.getContext('2d'), img = g.createImageData(192, 192), d = img.data;
    let x = 1234567;
    for (let i = 0; i < d.length; i += 4) {
      x = (Math.imul(x, 1103515245) + 12345) >>> 0;
      const r = x / 4294967296, dark = r < 0.5;
      d[i] = d[i + 1] = d[i + 2] = dark ? 0 : 255;
      d[i + 3] = dark ? Math.floor(r * 2 * 34) : Math.floor((r - 0.5) * 2 * 10);
    }
    g.putImageData(img, 0, 0);
    gr.style.setProperty('--grain', 'url(' + c.toDataURL('image/png') + ')');
    gr.classList.add('grain');
  } catch (e) {}
}
function init(g) {
  game = g;
  grain();
  guard('quiet', () => VROOM.audio.setQuiet(VROOM.save.progress.quiet));
  if (prefGet('vroom.crt') === '1') setCrt(true);
  holdRace();
  const code = guard('hash', () => VROOM.save.hashCode(), '');
  if (code) pendingImport = code;
}

const attract = { start: attractStart, stop: attractStop, on: () => ATT.on, idle: () => ATT.idle, IDLE: ATTRACT_IDLE,
  _state: () => ATT.st,
  probe: () => ({ on: ATT.on, n: ATT.n, shot: SHOTS[ATT.shot], t: ATT.st ? ATT.st.t : 0, s: ATT.st ? ATT.st.car.s : 0, run: ATT.run, x: attractCarX() }) };
/* where the demo car sits across the stage (stage px, through the shifted lens): the menu holds x < 500 */
function attractCarX() {
  if (!ATT.on || !ATT.car || !ATT.cam) return -1;
  ATT.cam.updateMatrixWorld();
  const v = ATT.K.tmp.copy(ATT.car.group.position).project(ATT.cam);
  return v.z > 1 ? -1 : Math.round((v.x + 1) / 2 * C.STAGE_W);
}
VROOM.ui = { init, hud, controls, button, toast, transition, icons, medalSvg, badgeSvg, avatarSvg, skullSvg, fmtTime, setAccent, worldOfDay, attract, paused: () => paused, counting: () => !!countdown };
