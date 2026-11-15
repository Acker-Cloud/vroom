/* ui-check: the metal grunge shell and every ui-owned scene. The tokens are --m-* (no toybox --v-*), the splash
   shows the logo and hands over to home (a tap skips it), home's plates route to race, garage and map, the map shows
   twelve worlds and ten levels per world with locks that deny, the race HUD, the countdown that holds the sim, pause,
   keyboard and touch controls, results with the payout tallying into the wallet, the overlays (settings, profiles
   with the QR, album), toast and transition, reduced motion (no endless decoration), and on every screen: no words
   but the logo, tap targets >= 64 px, no console errors. Owner: ui. */
'use strict';
const { check, done, open, visibleLetters, smallTargets } = require('./lib.cjs');

const tap = (page, sel) => page.evaluate(s => {
  const b = document.querySelector(s);
  if (!b) return false;
  b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerId: 1 }));
  b.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0, pointerId: 1 }));
  return true;
}, sel);
const scene = page => page.evaluate(() => VROOM.game.current());
const waitScene = (page, id, timeout = 15000) => page.waitForFunction(i => VROOM.game.current() === i, id, { timeout }).then(() => true, () => false);
async function screen(page, name) {
  const letters = await visibleLetters(page), small = await smallTargets(page);
  check(`${name}: no words on screen`, letters.length === 0, letters.join(' | '));
  check(`${name}: tap targets >= 64 px`, small.length === 0, JSON.stringify(small));
}

(async () => {
  const { browser, page, errors } = await open();

  /* ---- the shell: metal tokens, no toybox ---- */
  const tok = await page.evaluate(() => {
    const css = [...document.querySelectorAll('style')].map(s => s.textContent).join('\n');
    const root = getComputedStyle(document.documentElement);
    return { v: (css.match(/--v-[\w-]+/g) || []).length, m: ['--m-soot', '--m-gun', '--m-steel', '--m-rust', '--m-hazard', '--m-molten', '--m-toxic', '--metal', '--steel', '--hazard', '--acc0', '--acc3'].filter(k => !root.getPropertyValue(k).trim()) };
  });
  check('shell defines the metal tokens (--m-*, --metal, --steel, --hazard, --acc0..3)', tok.m.length === 0, tok.m.join(' '));
  check('shell has no toybox --v-* tokens', tok.v === 0, tok.v + ' found');
  const layers = await page.evaluate(() => ['splash', 'home', 'garage', 'garageHud', 'map', 'race', 'raceHud', 'results', 'boot', 'rotate', 'view'].filter(id => !document.getElementById(id)));
  check('shell keeps every scene layer and mount point', layers.length === 0, layers.join(' '));
  const logos = await page.evaluate(() => ({ splash: !!document.querySelector('#splash [data-logo]'), home: !!document.querySelector('#home [data-logo]') }));
  check('the VROOM logo (data-logo) is on the splash and on home', logos.splash && logos.home, JSON.stringify(logos));
  check('the CRT scanlines are off by default', !(await page.evaluate(() => document.getElementById('stage').classList.contains('crt'))));

  /* ---- splash ---- */
  check('boot opens on the splash', (await scene(page)) === 'splash');
  await page.waitForTimeout(700);
  await screen(page, 'splash');
  await page.evaluate(() => document.getElementById('splash').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })));
  check('a tap skips the splash to home', await waitScene(page, 'home', 15000));

  /* ---- home ---- */
  await page.waitForTimeout(600);
  await screen(page, 'home');
  const home = await page.evaluate(() => ['go', 'garage', 'map', 'album', 'settings', 'profile', 'rev'].filter(a => !document.querySelector(`#home button[aria-label="${a}"]`)));
  check('home has GO, garage, map, album, settings, profile and the rev pad', home.length === 0, 'missing ' + home.join(' '));
  const wal = await page.evaluate(() => ({ shown: document.querySelector('#homeWallet .n').textContent, real: String(VROOM.save.progress.wallet) }));
  check('home wallet chip shows the wallet', wal.shown === wal.real, JSON.stringify(wal));
  const wod = await page.evaluate(() => VROOM.ui.worldOfDay());
  check('the world of the day is one of the twelve', wod >= 1 && wod <= 12, String(wod));
  await tap(page, '#homeRev');
  await tap(page, '#home button[aria-label="map"]');
  check('home map plate opens the map', await waitScene(page, 'map'));

  /* ---- map ---- */
  await page.waitForTimeout(500);
  await screen(page, 'map');
  const m = await page.evaluate(() => ({ tabs: document.querySelectorAll('#mapHud .tab').length, lv: document.querySelectorAll('#mapHud .lvl').length, boss: document.querySelectorAll('#mapHud .lvl.boss').length }));
  check('map shows 12 world plates, 10 level plates, 1 boss finale', m.tabs === 12 && m.lv === 10 && m.boss === 1, JSON.stringify(m));
  const lock = await page.evaluate(() => { for (let n = 2; n <= 10; n++) if (!VROOM.save.levelOpen(n)) return n; return 0; });
  if (lock) {
    await tap(page, `#mapHud button[aria-label="level ${lock}"]`);
    await page.waitForTimeout(400);
    check('a locked level plate denies (stays on the map)', (await scene(page)) === 'map');
  }
  await page.evaluate(() => { VROOM.save.progress.levels[10] = { best: 1, rating: 1, t13: 60, tier: 'B' }; });
  await tap(page, '#mapHud button[aria-label="world 2"]');
  await page.waitForTimeout(300);
  const w2 = await page.evaluate(() => [...document.querySelectorAll('#mapHud .lvl')].map(b => b.getAttribute('aria-label')).join(','));
  check('an opened world tab shows its own ten levels', w2.includes('level 11') && w2.includes('level 20'), w2);
  await page.evaluate(() => { delete VROOM.save.progress.levels[10]; });
  await page.evaluate(() => VROOM.game.go('map', { world: 1 }));
  await tap(page, '#mapHud button[aria-label="level 1"]');
  check('an open level plate starts that race', await waitScene(page, 'race'));

  /* ---- race: countdown, HUD, controls, pause ---- */
  await page.waitForTimeout(250);
  const hud = await page.evaluate(() => ['hPause', 'hTime', 'hStars', 'hRail', 'hGauge', 'hBoost', 'ctlGas', 'ctlBrake', 'ctlBoost', 'ctlDrift'].filter(id => !document.getElementById(id)));
  check('race HUD: pause, timer, stars, rail, gauge, boost meter, pedals', hud.length === 0, 'missing ' + hud.join(' '));
  /* the near road under the car (a 300 x 260 stage-px box) stays clear of the gauge and the boost meter */
  const clear = await page.evaluate(() => {
    const st = document.getElementById('stage').getBoundingClientRect(), s = st.width / VROOM.contracts.STAGE_W;
    const box = { l: 362, r: 662, t: 440, b: 700 };
    return ['hGauge', 'hBoost'].filter(id => {
      const r = document.getElementById(id).getBoundingClientRect();
      const l = (r.left - st.left) / s, t = (r.top - st.top) / s, rr = (r.right - st.left) / s, b = (r.bottom - st.top) / s;
      return l < box.r && rr > box.l && t < box.b && b > box.t;
    });
  });
  check('the gauge and boost meter keep off the road just ahead of the car', clear.length === 0, 'overlap ' + clear.join(' '));
  const pivot = await page.evaluate(() => {
    const n = document.querySelector('#hGauge .needle'), g = document.getElementById('hGauge').getBoundingClientRect();
    n.style.transition = 'none';
    const tip = a => { n.style.transform = 'rotate(' + a + 'deg)'; const r = n.getBoundingClientRect(); return [(r.left + r.right) / 2 - g.left, (r.top + r.bottom) / 2 - g.top]; };
    const out = [-130, 0, 130].map(tip); n.style.transition = '';
    return out;
  });
  /* the needle's box centre stays inside the 210 px dial at both ends and top dead centre */
  check('the speedo needle pivots on the dial centre (stays inside the dial)', pivot.every(([x, y]) => x > 20 && x < 190 && y > 10 && y < 200), JSON.stringify(pivot.map(p => p.map(v => Math.round(v)))));
  const cd = await page.evaluate(() => ({ counting: VROOM.ui.counting(), t: VROOM.scenes.race.st ? VROOM.scenes.race.st.t : -1 }));
  check('the countdown holds the sim at t = 0', cd.counting && cd.t === 0, JSON.stringify(cd));
  await screen(page, 'race countdown');
  await page.waitForFunction(() => !VROOM.ui.counting(), null, { timeout: 20000 }).catch(() => {});
  await page.waitForFunction(() => VROOM.scenes.race.st.t > 0, null, { timeout: 20000 }).catch(() => {});
  const ran = await page.evaluate(() => VROOM.scenes.race.st.t);
  check('after GO the sim runs', ran > 0, String(ran));
  await screen(page, 'race');
  const tm = await page.evaluate(() => document.querySelector('#hTime .n').textContent);
  check('the timer reads m:ss.cc', /^\d+:\d\d\.\d\d$/.test(tm), tm);

  const mk = await page.evaluate(() => ({ you: !!document.querySelector('#hRail .mk.you svg #mkChrome'), car: document.querySelectorAll('#hRail .mk svg path[d^="M6 40 L10 28"]').length,
    boss: /<svg/.test(VROOM.ui.icons.markerBoss) && /<svg/.test(VROOM.ui.icons.markerGhost) }));
  check('the rail marker is a chrome arrowhead (no cartoon car); ghost and boss markers are metal pictograms', mk.you && mk.car === 0 && mk.boss, JSON.stringify(mk));
  /* a fine pointer (the desktop, this browser): the touch plates are in the DOM but not on screen */
  const plates = () => page.evaluate(() => (document.getAnimations().forEach(a => { try { a.finish(); } catch (e) { /* endless */ } }), { off: document.getElementById('ctl').classList.contains('off'),
    shown: ['ctlGas', 'ctlBrake', 'ctlBoost', 'ctlDrift'].filter(id => getComputedStyle(document.getElementById(id)).visibility !== 'hidden').length }));
  await page.waitForTimeout(300);
  const plates0 = await plates();
  check('no touch yet on a fine pointer: the touch plates stay off screen', plates0.off && plates0.shown === 0, JSON.stringify(plates0));
  await page.evaluate(() => document.getElementById('stage').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 5, pointerType: 'touch' })));
  await page.waitForTimeout(300);
  const platesT = await plates();
  check('the first touch brings the plates up', !platesT.off && platesT.shown === 4, JSON.stringify(platesT));
  await page.keyboard.down('ArrowUp'); await page.keyboard.down('ArrowLeft'); await page.keyboard.down(' '); await page.keyboard.down('Shift');
  for (let i = 0; i < 30; i++) await page.evaluate(() => VROOM.ui.controls.read());
  const kb = await page.evaluate(() => VROOM.ui.controls.read());
  await page.keyboard.up('ArrowUp'); await page.keyboard.up('ArrowLeft'); await page.keyboard.up(' '); await page.keyboard.up('Shift');
  check('keyboard: up = throttle, left = steer left (ramped to full), space = boost, shift = drift', kb.throttle === 1 && kb.steer === -1 && kb.boost === 1 && kb.drift === 1, JSON.stringify(kb));
  await page.waitForTimeout(300);
  const platesK = await plates();
  const kb0 = await page.evaluate(() => VROOM.ui.controls.read());
  check('keys released: a neutral InputFrame', kb0.throttle === 0 && kb0.steer === 0 && kb0.boost === 0 && kb0.drift === 0, JSON.stringify(kb0));
  const ped = await page.evaluate(() => {
    const g = document.getElementById('ctlGas'), b = document.getElementById('ctlBrake');
    g.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 7 })); b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 8 }));
    const on = VROOM.ui.controls.read();
    g.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 7 })); b.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 8 }));
    const off = VROOM.ui.controls.read();
    return { on, off };
  });
  check('touch pedals: gas and brake held together, released to zero', ped.on.throttle === 1 && ped.on.brake === 1 && ped.off.throttle === 0 && ped.off.brake === 0, JSON.stringify(ped));
  check('keyboard driving clears the touch plates off screen (a mouse-style press does not bring them back)', platesK.off && platesK.shown === 0 && (await plates()).off, JSON.stringify(platesK));
  const steer = await page.evaluate(() => {
    const z = document.getElementById('ctlSteer');
    if (!z) return null;
    const r = z.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
    z.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 9, clientX: x, clientY: y }));
    z.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 9, clientX: x + 200, clientY: y }));
    const right = VROOM.ui.controls.read().steer;
    z.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 9 }));
    return { right, after: VROOM.ui.controls.read().steer };
  });
  check('drag steering: slide right steers right, lift centres', steer && steer.right > 0.9 && steer.after === 0, JSON.stringify(steer));

  await page.evaluate(() => VROOM.ui.hud.event({ type: 'trick', kind: 'flip', n: 2, tick: 1 }));
  const pop = await page.evaluate(() => ({ on: document.getElementById('hPop').classList.contains('on'), txt: document.getElementById('hPop').textContent }));
  check('HUD pops a trick as a pictogram and a numeral (no letters)', pop.on && /^×2$/.test(pop.txt), JSON.stringify(pop));
  for (const ev of [{ type: 'star', i: 0 }, { type: 'checkpoint', i: 0 }, { type: 'land', airT: 2.2, hard: 0.8 }, { type: 'monster', a: 0, what: 'hit' }, { type: 'boss', a: 0, what: 'enter' },
    { type: 'driftBank', t: 1.4, bonus: 0.2 }, { type: 'respawn', s: 10 }, { type: 'nitro', i: 0 }, { type: 'nope' }]) await page.evaluate(e => VROOM.ui.hud.event({ tick: 1, ...e }), ev);
  check('HUD takes every event type without a throw', errors.length === 0, errors.join(' | '));

  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  const t0 = await page.evaluate(() => VROOM.scenes.race.st.t);
  await page.waitForTimeout(500);
  const t1 = await page.evaluate(() => VROOM.scenes.race.st.t);
  const po = await page.evaluate(() => ({ open: document.getElementById('ovl').classList.contains('open'), paused: VROOM.ui.paused(), btns: document.querySelectorAll('#ovl button').length }));
  check('Escape pauses: the overlay opens and the sim stops', po.open && po.paused && po.btns >= 5 && t1 === t0, JSON.stringify({ ...po, t0, t1 }));
  await screen(page, 'pause');
  await page.keyboard.press('Escape');
  await page.waitForFunction(t => VROOM.scenes.race.st.t > t, t1, { timeout: 10000 }).catch(() => {});
  const t2 = await page.evaluate(() => VROOM.scenes.race.st.t);
  check('Escape again resumes', !(await page.evaluate(() => VROOM.ui.paused())) && t2 > t1, `t ${t1} -> ${t2}`);

  /* ---- results ---- */
  await page.evaluate(() => {
    VROOM.save.progress.wallet += 12;
    VROOM.game.go('results', { n: 3, result: { time: 52.37, stars: 7, starsTotal: 9, rating: 2, tier: 'A', hits: 3, airTime: 4.2, driftTime: 6.1, tricks: 2, respawns: 1, clean: false },
      rec: { payout: 12, first: false, newBest: true, newTier: true, badges: ['jump'] } });
  });
  await page.waitForTimeout(700);
  const r = await page.evaluate(() => ({ card: !!document.getElementById('rCard'), medal: !!document.querySelector('#rMedal svg'), on: document.querySelectorAll('#rRating svg.on').length,
    time: document.querySelector('#rTime .n').textContent, btn: ['replay', 'garage', 'map', 'home', 'next'].filter(a => !document.querySelector(`#results button[aria-label="${a}"]`)) }));
  check('results: card, medal stamp, 2 of 3 rating stars, the time, five plates', r.card && r.medal && r.on === 2 && r.time === '0:52.37' && r.btn.length === 0, JSON.stringify(r));
  await screen(page, 'results');
  await page.waitForFunction(() => document.querySelector('#rWallet .n').textContent === String(VROOM.save.progress.wallet), null, { timeout: 20000 }).catch(() => {});
  const tally = await page.evaluate(() => ({ shown: document.querySelector('#rWallet .n').textContent, real: String(VROOM.save.progress.wallet) }));
  check('the payout tallies into the wallet', tally.shown === tally.real, JSON.stringify(tally));
  await page.evaluate(() => { VROOM.save.progress.wallet -= 12; });
  await tap(page, '#results button[aria-label="home"]');
  check('results home plate goes home', await waitScene(page, 'home'));
  await page.waitForTimeout(500);

  /* ---- overlays ---- */
  await tap(page, '#home button[aria-label="settings"]');
  await page.waitForTimeout(400);
  await screen(page, 'settings');
  const q0 = await page.evaluate(() => VROOM.save.progress.quiet);
  await tap(page, '#ovl button[aria-label="sound"]');
  const q1 = await page.evaluate(() => VROOM.save.progress.quiet);
  await tap(page, '#ovl button[aria-label="sound"]');
  check('settings: the sound plate toggles quiet mode', q1 === !q0 && (await page.evaluate(() => VROOM.save.progress.quiet)) === q0);
  await tap(page, '#ovl button[aria-label="scanlines"]');
  const crt = await page.evaluate(() => document.getElementById('stage').classList.contains('crt'));
  await tap(page, '#ovl button[aria-label="scanlines"]');
  check('settings: the CRT plate turns scanlines on and off', crt && !(await page.evaluate(() => document.getElementById('stage').classList.contains('crt'))));
  const mode0 = await page.evaluate(() => VROOM.save.progress.ctrl.mode);
  await tap(page, '#ovl button[aria-label="buttons"]');
  const mode2 = await page.evaluate(() => VROOM.save.progress.ctrl.mode);
  await page.evaluate(m => { VROOM.save.progress.ctrl.mode = m; }, mode0);
  check('settings: the steering plates pick a control mode', mode2 === 2);
  await tap(page, '#ovl .close');
  check('the close plate shuts the overlay', !(await page.evaluate(() => document.getElementById('ovl').classList.contains('open'))));

  await tap(page, '#home button[aria-label="profile"]');
  await page.waitForTimeout(400);
  await screen(page, 'profiles');
  const pr = await page.evaluate(() => ({ cards: document.querySelectorAll('#ovl .pcard').length, qr: !!document.querySelector('#ovl .qr path'), copy: !!document.querySelector('#ovl button[aria-label="copy code"]'), paste: !!document.querySelector('#ovl button[aria-label="paste code"]') }));
  check('profiles: three cards, the save QR, copy and paste plates', pr.cards === 3 && pr.qr && pr.copy && pr.paste, JSON.stringify(pr));
  await tap(page, '#ovl .close');
  await tap(page, '#home button[aria-label="album"]');
  await page.waitForTimeout(400);
  await screen(page, 'album');
  const al = await page.evaluate(() => ({ badges: document.querySelectorAll('#ovl .badge').length, ids: VROOM.save.ids.BADGE_IDS.length }));
  check('album: every badge plus twelve boss emblems', al.badges === al.ids + 12, JSON.stringify(al));
  await tap(page, '#ovl .close');

  /* ---- widgets ---- */
  const w = await page.evaluate(() => new Promise(res => {
    let calls = 0;
    VROOM.ui.toast(VROOM.ui.icons.star);
    const toasts = document.querySelectorAll('#toasts .toast').length;
    VROOM.ui.transition(() => { calls++; });
    VROOM.ui.transition(() => { calls++; });
    setTimeout(() => res({ toasts, calls, b: VROOM.ui.button({ icon: VROOM.ui.icons.go, aria: 'x' }).tagName }), 900);
  }));
  check('toast shows a plate; transition runs fn once and drops a double tap; button makes a <button>', w.toasts === 1 && w.calls === 1 && w.b === 'BUTTON', JSON.stringify(w));
  const ic = await page.evaluate(() => ['go', 'home', 'map', 'garage', 'star', 'lock', 'replay', 'next', 'boost', 'brake', 'pause'].filter(k => !/^<svg/.test(VROOM.ui.icons[k] || '')));
  check('icons: the contract set are SVG strings', ic.length === 0, ic.join(' '));
  const txt = await page.evaluate(() => Object.values(VROOM.ui.icons).filter(s => />[^<]*\p{L}[^<]*</u.test(s)).length);
  check('icons carry no text', txt === 0, String(txt));

  check('no console errors', errors.length === 0, errors.join(' | '));
  await browser.close();

  /* ---- reduced motion: the splash is short and still, no endless decoration ---- */
  const rm = await open('', { reducedMotion: 'reduce' });
  const t = Date.now();
  const ok = await waitScene(rm.page, 'home', 20000);
  check('reduced motion: the splash still hands over to home', ok, (Date.now() - t) + ' ms');
  await rm.page.waitForTimeout(600);
  const loops = await rm.page.evaluate(() => document.getAnimations().filter(a => a.playState === 'running' && a.effect && a.effect.getTiming().iterations === Infinity).length);
  check('reduced motion: no endless CSS animations on home', loops === 0, loops + ' running');
  check('reduced motion: no console errors', rm.errors.length === 0, rm.errors.join(' | '));
  await rm.browser.close();
  done();
})().catch(e => { console.error(e); process.exit(1); });
