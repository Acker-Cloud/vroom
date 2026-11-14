/* ui: every DOM layer: splash, home, map, results, HUD, overlays, widgets, controls. Owner: ui.
   SCAFFOLD STUB: plain metal plates and pictogram buttons, no words (the VROOM logo is the one word,
   data-logo). The ui builder makes the real thing (docs/OVERHAUL.md "Look bible" and "Scenes").
   Contract: VROOM.contracts MODULE_API.ui and the Scene API. */

const $ = id => document.getElementById(id);
const icons = {
  go: '<svg viewBox="0 0 64 64"><path d="M16 8 L54 32 L16 56 Z" fill="#fff"/></svg>',
  home: '<svg viewBox="0 0 64 64"><path d="M8 32 L32 10 L56 32 V56 H40 V40 H24 V56 H8 Z" fill="#c7ccd5"/></svg>',
  map: '<svg viewBox="0 0 64 64"><path d="M6 14 L22 8 L42 14 L58 8 V50 L42 56 L22 50 L6 56 Z" fill="#c7ccd5"/><path d="M22 8 V50 M42 14 V56" stroke="#2c3039" stroke-width="4"/></svg>',
  garage: '<svg viewBox="0 0 64 64"><path d="M44 6 a13 13 0 0 0 -12 18 L10 46 a7 7 0 0 0 10 10 L42 34 a13 13 0 0 0 16 -13 l-9 6 -8 -8 6 -9 Z" fill="#c7ccd5"/></svg>',
  star: '<svg viewBox="0 0 64 64"><path d="M32 2 L40 22 L62 24 L45 39 L51 61 L32 48 L13 61 L19 39 L2 24 L24 22 Z" fill="#ffd02e" stroke="#8a5a08" stroke-width="3"/></svg>',
  lock: '<svg viewBox="0 0 64 64"><rect x="12" y="28" width="40" height="30" rx="4" fill="#9aa3b0"/><path d="M20 28 V20 a12 12 0 0 1 24 0 V28" stroke="#9aa3b0" stroke-width="8" fill="none"/></svg>',
  replay: '<svg viewBox="0 0 64 64"><path d="M50 32 A18 18 0 1 1 32 14" stroke="#fff" stroke-width="7" fill="none"/><path d="M28 4 L42 14 L28 24 Z" fill="#fff"/></svg>',
  next: '<svg viewBox="0 0 64 64"><path d="M10 10 L36 32 L10 54 Z M32 10 L58 32 L32 54 Z" fill="#fff"/></svg>',
  boost: '<svg viewBox="0 0 64 64"><path d="M36 4 L14 36 H30 L26 60 L50 26 H34 Z" fill="#ffb02e"/></svg>',
  brake: '<svg viewBox="0 0 64 64"><rect x="14" y="14" width="36" height="36" rx="4" fill="#d8322a"/></svg>',
};
let game = null;
function button({ icon = '', cls = '', aria = '', on } = {}) {
  const b = document.createElement('button');
  b.className = 'plate ' + cls; b.innerHTML = icon; if (aria) b.setAttribute('aria-label', aria);
  b.addEventListener('pointerdown', e => { e.stopPropagation(); VROOM.audio.sfx('press'); if (on) on(e); });
  return b;
}
function toast(svg) {}
function transition(fn) { fn(); }

/* ---- controls: keyboard plus on-screen pedals ---- */
const keys = new Set(), touch = { gas: 0, brake: 0, boost: 0, steer: 0 };
addEventListener('keydown', e => keys.add(e.key.toLowerCase()));
addEventListener('keyup', e => keys.delete(e.key.toLowerCase()));
const controls = {
  read() {
    const k = c => keys.has(c);
    const steer = (k('arrowright') || k('d') ? 1 : 0) - (k('arrowleft') || k('a') ? 1 : 0) || touch.steer;
    return { steer, throttle: k('arrowup') || k('w') || touch.gas ? 1 : 0, brake: k('arrowdown') || k('s') || touch.brake ? 1 : 0,
      boost: k(' ') || k('shift') || touch.boost ? 1 : 0, drift: k('x') ? 1 : 0 };
  },
  show() {
    const hud = $('raceHud');
    const hold = (b, key) => { b.addEventListener('pointerdown', () => { touch[key] = 1; }); for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) b.addEventListener(ev, () => { touch[key] = 0; }); };
    const gas = button({ icon: icons.go, cls: 'go', aria: 'gas' }); gas.style.cssText = 'right:30px;bottom:30px;width:150px;height:150px'; hold(gas, 'gas');
    const brake = button({ icon: icons.brake, aria: 'brake' }); brake.style.cssText = 'right:200px;bottom:30px;width:110px;height:110px'; hold(brake, 'brake');
    const boost = button({ icon: icons.boost, aria: 'boost' }); boost.style.cssText = 'right:30px;bottom:200px'; hold(boost, 'boost');
    const pad = document.createElement('div'); pad.className = 'live'; pad.style.cssText = 'position:absolute;left:0;bottom:0;width:560px;height:420px';
    pad.addEventListener('pointermove', e => { if (e.buttons) touch.steer = Math.max(-1, Math.min(1, (e.offsetX - 280) / 200)); });
    pad.addEventListener('pointerup', () => { touch.steer = 0; });
    hud.append(pad, gas, brake, boost);
  },
  hide() { Object.assign(touch, { gas: 0, brake: 0, boost: 0, steer: 0 }); },
};

/* ---- HUD ---- */
let hudStars = null;
const hud = {
  show(spec) {
    const hud = $('raceHud'); hud.innerHTML = '';
    hudStars = document.createElement('div');
    hudStars.style.cssText = 'position:absolute;left:150px;top:30px;padding:10px 20px;background:var(--metal);border:3px solid var(--m-steel);border-radius:10px;font:900 40px var(--font)';
    const home = button({ icon: icons.home, aria: 'home', on: () => game.go('home') }); home.style.cssText = 'left:30px;top:20px';
    hud.append(home, hudStars);
  },
  update(st) { if (hudStars) hudStars.textContent = st.starsGot + ' / ' + st.stars.length; },
  event(ev) {},
  hide() { $('raceHud').innerHTML = ''; hudStars = null; },
};

/* ---- scenes ---- */
let splashT = 0;
VROOM.scenes.splash = {
  id: 'splash', dom: 'splash', view: null,
  enter() { splashT = 0; $('splash').onpointerdown = () => game.go('home'); },
  update(dt) { splashT += dt; if (splashT > 1.6) game.go('home'); },
  exit() { $('splash').onpointerdown = null; },
};
let homeBack = null;
VROOM.scenes.home = {
  id: 'home', dom: 'home', view: null,
  enter() {
    const el = $('home'); el.innerHTML = '';
    const go = button({ icon: icons.go, cls: 'go', aria: 'go', on: () => game.startRace(VROOM.save.progress.current) }); go.style.cssText = 'left:500px;top:440px;width:200px;height:140px';
    const gar = button({ icon: icons.garage, aria: 'garage', on: () => game.go('garage') }); gar.style.cssText = 'left:40px;bottom:40px';
    const map = button({ icon: icons.map, aria: 'map', on: () => game.go('map') }); map.style.cssText = 'right:40px;bottom:40px';
    el.append(go, gar, map);
    homeBack = VROOM.worlds.backdrop(game.ctx, VROOM.contracts.worldOf(VROOM.save.progress.current));
    this.view = { scene: homeBack.scene, camera: homeBack.camera };
  },
  update(dt, t) { if (homeBack) homeBack.update(dt, t); },
  exit() { if (homeBack) homeBack.dispose(); homeBack = null; this.view = null; },
};
VROOM.scenes.map = {
  id: 'map', dom: 'map', view: null,
  enter(params = {}) {
    const el = $('map'); el.innerHTML = '';
    const C = VROOM.contracts, w = params.world || C.worldOf(VROOM.save.progress.current);
    for (let k = 1; k <= C.WORLD_SIZE; k++) {
      const n = (w - 1) * C.WORLD_SIZE + k, open = VROOM.save.levelOpen(n);
      const b = button({ icon: open ? String(n) : icons.lock, aria: 'level ' + n, cls: open ? '' : 'locked', on: () => { if (open) game.startRace(n); else VROOM.audio.sfx('deny'); } });
      b.style.cssText = `left:${120 + ((k - 1) % 5) * 200}px;top:${200 + Math.floor((k - 1) / 5) * 180}px;width:140px;height:120px`;
      el.append(b);
    }
    const home = button({ icon: icons.home, aria: 'home', on: () => game.go('home') }); home.style.cssText = 'left:30px;top:30px';
    el.append(home);
  },
  update() {}, exit() {},
};
VROOM.scenes.results = {
  id: 'results', dom: 'results', view: null,
  enter(p) {
    const el = $('results'); el.innerHTML = '';
    const card = document.createElement('div');
    card.style.cssText = 'position:absolute;left:350px;top:140px;width:500px;height:240px;display:grid;place-items:center;background:var(--metal);border:4px solid var(--m-steel);border-radius:10px;font:900 70px var(--font)';
    card.innerHTML = `<span>${icons.star.replace('<svg', '<svg width="80" height="80"')} ${p.result.stars}</span><span style="font-size:44px">${p.result.time.toFixed(2)}</span>`;
    const again = button({ icon: icons.replay, aria: 'replay', on: () => game.startRace(p.n) }); again.style.cssText = 'left:350px;top:430px';
    const next = button({ icon: icons.next, cls: 'go', aria: 'next', on: () => game.startRace(Math.min(VROOM.contracts.MAX_LEVEL, p.n + 1)) }); next.style.cssText = 'left:720px;top:430px;width:130px';
    const home = button({ icon: icons.home, aria: 'home', on: () => game.go('home') }); home.style.cssText = 'left:540px;top:430px';
    el.append(card, again, home, next);
  },
  update() {}, exit() {},
};

function init(g) { game = g; VROOM.audio.setQuiet(VROOM.save.progress.quiet); }

VROOM.ui = { init, hud, controls, button, toast, transition, icons };
