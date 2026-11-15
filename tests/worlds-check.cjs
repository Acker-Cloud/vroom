/* worlds-check: the 12 environments in Chromium. Owner: worlds.
   - accents, emblems (SVG, no letters), cards and the world-of-the-day backdrops for every world
   - every world builds from a real level: one prop mesh per track prop, one star per spec star, renders inside
     the budget from cameras along the course (docs/OVERHAUL.md: the whole race view under 150 draw calls and
     250k triangles; the world gets WORLD_CALLS / WORLD_TRIS of that, the rest is the car and the monsters)
   - update / onEvent take every sim event without throwing, dispose frees the GPU geometry
   - fx: every kind emits and decays back to nothing, unknown kinds are silent
   - reduced motion: stars stop spinning, weather freezes
   - no console errors, no network requests beyond the page */
'use strict';
const { check, done, open } = require('./lib.cjs');
const WORLD_CALLS = 115, WORLD_TRIS = 200000;

(async () => {
  const { browser, page, errors, requests } = await open('scene=boot');
  const api = await page.evaluate(() => ['buildWorld', 'backdrop', 'accent', 'icon', 'card'].filter(k => typeof (VROOM.worlds || {})[k] !== 'function'));
  check('VROOM.worlds publishes buildWorld, backdrop, accent, icon (and card)', api.length === 0, api.join(' '));

  const look = await page.evaluate(() => {
    const out = { acc: [], icons: [], letters: [], text: 0, bad: [] };
    for (let w = 1; w <= 12; w++) {
      const a = VROOM.worlds.accent(w);
      if (!Array.isArray(a) || a.length !== 4 || !a.every(h => /^#[0-9a-f]{6}$/i.test(h))) out.bad.push(w);
      out.acc.push(a.join());
      const svg = VROOM.worlds.icon(w), doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
      if (doc.querySelector('parsererror') || doc.documentElement.nodeName !== 'svg') out.bad.push('icon' + w);
      if (doc.querySelector('text')) out.text++;
      if (/\p{L}/u.test(doc.documentElement.textContent)) out.letters.push(w);
      out.icons.push(svg);
    }
    return { ...out, accU: new Set(out.acc).size, iconU: new Set(out.icons).size };
  });
  check('accent(w): four #hex colours for every world', look.bad.filter(b => typeof b === 'number').length === 0, look.bad.join(' '));
  check('icon(w): 12 distinct well-formed SVG emblems with no text and no letters', look.iconU === 12 && look.text === 0 && look.letters.length === 0 && !look.bad.some(b => String(b).startsWith('icon')), JSON.stringify(look.letters));

  /* every world, built from a mid-world level, measured from cameras along the course */
  const worlds = await page.evaluate(({ WORLD_CALLS, WORLD_TRIS }) => {
    const ctx = VROOM.game.ctx, r = ctx.renderer, rows = [];
    const cam = new THREE.PerspectiveCamera(62, 1200 / 700, 0.1, 3000);
    const evs = ['star', 'nitro', 'pad', 'hit', 'wall', 'scrape', 'land', 'spin', 'surface', 'respawn', 'checkpoint', 'finish', 'monster', 'boss', 'jump', 'trick', 'drift', 'driftBank', 'boost', 'nope'];
    for (let w = 1; w <= 12; w++) {
      const row = { w, calls: 0, tris: 0, err: '' };
      try {
        const geo0 = r.info.memory.geometries;
        const spec = VROOM.levels.level(w * 10 - 5), track = VROOM.sim.buildTrack(spec);
        const st = VROOM.sim.newRace(track, VROOM.sim.carParams(VROOM.catalog.stats({ body: 'monster', wheels: 'monster', extras: {} }), {}), { seed: spec.seed, mode: 'race' });
        const rig = VROOM.worlds.buildWorld(ctx, track, spec);
        row.props = rig.props.length === track.props.length && rig.stars.length === spec.stars.length;
        row.scene = !!(rig.scene && rig.scene.isScene && rig.scene.fog && typeof rig.update === 'function' && typeof rig.onEvent === 'function');
        for (let k = 1; k <= 5; k++) {
          const s = track.finishS * k / 6, p = VROOM.sim.toWorld(track, s - 8, 0, 3.4), a = VROOM.sim.toWorld(track, s + 20, 0, 1.2);
          cam.position.set(p[0], p[1], p[2]); cam.lookAt(a[0], a[1], a[2]);
          const c = st.car; c.x = p[0]; c.y = p[1] - 3.4; c.z = p[2]; c.s = s;
          rig.update(st, 1 / 60, k, cam);
          r.render(rig.scene, cam);
          row.calls = Math.max(row.calls, r.info.render.calls); row.tris = Math.max(row.tris, r.info.render.triangles);
        }
        for (const type of evs) rig.onEvent({ type, tick: 1, i: 0, a: 0, what: type === 'boss' ? 'defeat' : 'stomp', side: 1, hard: 0.8, surf: 8, cat: 'crate' }, st);
        rig.update(st, 1 / 60, 9, cam); r.render(rig.scene, cam);
        rig.dispose();
        r.render(new THREE.Scene(), cam);
        row.leak = r.info.memory.geometries - geo0;
      } catch (e) { row.err = String(e && e.stack || e).slice(0, 300); }
      rows.push(row);
    }
    return rows;
  }, { WORLD_CALLS, WORLD_TRIS });
  const broken = worlds.filter(r => r.err || !r.props || !r.scene);
  check('all 12 worlds build: fog, one prop mesh per track prop, one star per spec star, every event taken', broken.length === 0, broken.map(r => r.w + ':' + (r.err || 'shape')).join(' | '));
  const heavy = worlds.filter(r => r.calls > WORLD_CALLS || r.tris > WORLD_TRIS);
  check(`every world renders under ${WORLD_CALLS} draw calls and ${WORLD_TRIS / 1000}k triangles (leaves room for the car and monsters)`, heavy.length === 0,
    worlds.map(r => `${r.w}:${r.calls}/${Math.round(r.tris / 1000)}k`).join(' '));
  const leaks = worlds.filter(r => r.leak > 2);
  check('dispose() frees the world geometry', leaks.length === 0, leaks.map(r => r.w + ':+' + r.leak).join(' '));

  const menus = await page.evaluate(() => {
    const ctx = VROOM.game.ctx, out = { bad: [], card: null };
    for (let w = 1; w <= 12; w++) {
      try {
        const b = VROOM.worlds.backdrop(ctx, w);
        b.update(1 / 60, 2); ctx.renderer.render(b.scene, b.camera);
        if (!b.scene || !b.camera || !b.spot || b.spot.pos.length !== 3) out.bad.push(w);
        b.dispose();
      } catch (e) { out.bad.push(w + ':' + e); }
    }
    const c = VROOM.worlds.card(ctx, 3, 200, 120), g = c.getContext('2d'), d = g.getImageData(0, 0, 200, 120).data;
    let lo = 255, hi = 0;
    for (let i = 0; i < d.length; i += 4 * 37) { const v = d[i] + d[i + 1] + d[i + 2]; lo = Math.min(lo, v); hi = Math.max(hi, v); }
    out.card = { w: c.width, h: c.height, spread: hi - lo, cached: VROOM.worlds.card(ctx, 3, 200, 120) === c };
    return out;
  });
  check('backdrop(ctx, w) renders every world with a parking spot for the player machine', menus.bad.length === 0, menus.bad.join(' '));
  check('card(ctx, w) paints a non-blank, cached still of the world', menus.card.w === 200 && menus.card.h === 120 && menus.card.spread > 60 && menus.card.cached, JSON.stringify(menus.card));

  const fx = await page.evaluate(() => {
    const ctx = VROOM.game.ctx, scene = new THREE.Scene(), rig = VROOM.fx.create(ctx, scene), out = {};
    const kinds = ['sparks', 'dust', 'smoke', 'fire', 'explosion', 'splash', 'debris', 'snow', 'shards', 'nitro', 'stars'];
    try {
      for (const k of kinds) for (let i = 0; i < 3; i++) rig.emit(k, [i, 1, 0], { n: 6, color: '#ff5a1a', dir: [0, 0, -1] });
      for (let i = 0; i < 20; i++) rig.emit('skid', [i * 0.8, 0, 0], { id: 1, w: 0.35 });
      rig.emit('skid', null, { id: 1 }); rig.emit('nope', [0, 0, 0]); rig.emit('sparks', null);
      rig.update(0.05);
      const live = () => { let n = 0; scene.traverse(o => { if (o.isInstancedMesh) n += o.count; }); return n; };
      out.live = live();
      for (let i = 0; i < 80; i++) rig.update(0.05);
      out.after = live();
      rig.dispose();
      out.left = scene.children.length;
    } catch (e) { out.err = String(e); }
    return out;
  });
  check('fx: every kind emits, decays back to nothing, unknown kinds and null positions are silent', !fx.err && fx.live > 40 && fx.after === 0 && fx.left === 0, JSON.stringify(fx));

  check('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  const foreign = requests.filter(u => !u.startsWith(new URL(page.url()).origin) && !u.startsWith('data:') && !u.startsWith('blob:'));
  check('no foreign network requests', foreign.length === 0, foreign.slice(0, 3).join(' '));
  await browser.close();

  /* reduced motion: decorative motion stops */
  const rm = await open('scene=boot', { reducedMotion: 'reduce' });
  const still = await rm.page.evaluate(() => {
    const ctx = VROOM.game.ctx, spec = VROOM.levels.level(35), track = VROOM.sim.buildTrack(spec);
    const st = VROOM.sim.newRace(track, VROOM.sim.carParams(VROOM.catalog.stats({ body: 'monster', wheels: 'monster', extras: {} }), {}), { seed: 1, mode: 'race', monsters: false });
    const rig = VROOM.worlds.buildWorld(ctx, track, spec), cam = new THREE.PerspectiveCamera();
    const p = VROOM.sim.toWorld(track, spec.stars[0].s - 10, 0, 3); cam.position.set(p[0], p[1], p[2]);
    let pts = null; rig.scene.traverse(o => { if (o.isLineSegments && o.geometry.attributes.position.count > 500) pts = o; if (!pts && o.isPoints && o.geometry.attributes.position.count > 400 && o.frustumCulled === false) pts = o; });
    rig.update(st, 1 / 60, 1, cam);
    const a = rig.stars[0].rotation.y, w0 = pts ? pts.geometry.attributes.position.array[0] : 0;
    rig.update(st, 0.5, 3, cam); rig.update(st, 0.5, 5, cam);
    const out = { rm: ctx.reducedMotion, star: rig.stars[0].rotation.y === a, weather: !pts || pts.geometry.attributes.position.array[0] === w0, hasWx: !!pts };
    rig.dispose();
    return out;
  });
  check('reduced motion: stars stop spinning and the weather freezes', still.rm && still.star && still.weather && still.hasWx, JSON.stringify(still));
  check('no console errors under reduced motion', rm.errors.length === 0, rm.errors.slice(0, 3).join(' | '));
  await rm.browser.close();
  done();
})().catch(e => { console.error(e); process.exit(1); });
