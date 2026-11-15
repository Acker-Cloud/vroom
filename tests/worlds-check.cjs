/* worlds-check: the 12 environments in Chromium. Owner: worlds.
   - accents, emblems (SVG, no letters), cards and the world-of-the-day backdrops for every world
   - every world builds from a real level: one prop mesh per track prop, one star per spec star, renders inside
     the budget from cameras along the course (docs/OVERHAUL.md: the whole race view under 150 draw calls and
     250k triangles; the world gets WORLD_CALLS / WORLD_TRIS of that, the rest is the car and the monsters)
   - update / onEvent take every sim event without throwing, dispose frees the GPU geometry
   - overhead beams stay off jump flights (structurally, and under the autopilot on all 120 levels)
   - fx: every kind emits and decays back to nothing, unknown kinds are silent; smoke, dust and water spray are
     pooled, camera-facing billboards with an alpha falloff (not lit solids); a boss leaves a particle trail and arrives in a blast
   - frost is on the grunge brief: a dark frame, a dark iron deck, warm sodium light in it
   - creatures (src/monsters.js): drawn true to their sim radius, eye glints, a world-contrast rim that runs hot
     through a tell, bosses at least their 14.0 size with their own light and a rise-up entrance
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

  /* overheads stay off flights: none within 230 m after a ramp lip or a gap, none within 120 m after a crest,
     steep hill, halfpipe, split or loop; and the autopilot, driving all 120 levels, passes under every beam with its wheels
     at most 2 m off the road (4 m under the tall arches), so the chase camera (4 to 5 m above the car) never
     flies through one (14.1 review: level 13's bonegate filled the screen) */
  const over = await page.evaluate(() => {
    const S = VROOM.sim, TF = VROOM.contracts.TF, ctx = VROOM.game.ctx, near = [], high = [], F = {};
    let count = 0;
    for (let n = 1; n <= 120; n++) {
      const spec = VROOM.levels.level(n), track = S.buildTrack(spec);
      const rig = VROOM.worlds.buildWorld(ctx, track, spec), ov = rig.overheads || [], arch = rig.overArch;
      rig.dispose();
      for (const s of ov) {
        const i0 = Math.round(s / track.step);
        for (let j = i0; j >= 0 && j >= i0 - 230 / track.step; j--) {
          const p = spec.pieces[track.piece[j]], hop = (p && (/^(crest|halfpipe|split)$/.test(p.type) || (p.type === 'hill' && Math.abs(p.rise || 0) > 0.1 * (p.len || 1)))) || (track.flags[j] & TF.LOOP);
          if ((track.flags[j] & (TF.RAMP | TF.GAP)) || (hop && (i0 - j) * track.step <= 120)) { near.push(n + '@' + Math.round(s)); break; }
        }
      }
      const st = S.newRace(track, S.carParams(VROOM.catalog.stats({ body: 'monster', wheels: 'monster', extras: {} }), {}), { seed: spec.seed, mode: 'race' });
      const hi = new Float32Array(track.n);
      while (!st.finished && st.tick < 60 * 240) {
        S.step(st, S.autopilot(st, 1)); st.events.length = 0;
        const c = st.car, f = S.frameAt(track, Math.max(0, Math.min(track.length, c.s)), F), pt = S.toWorld(track, c.s, c.d, 0);
        const h = (c.x - pt[0]) * f.ux + (c.y - pt[1]) * f.uy + (c.z - pt[2]) * f.uz, i = Math.max(0, Math.min(track.n - 1, Math.round(c.s / track.step)));
        if (h > hi[i]) hi[i] = h;
      }
      for (const s of ov) {
        count++;
        let m = 0;
        for (let i = Math.round(s / track.step) - 4; i <= Math.round(s / track.step) + 4; i++) if (i >= 0 && i < track.n) m = Math.max(m, hi[i]);
        if (m > (arch ? 4 : 2)) high.push(n + '@' + Math.round(s) + ':' + m.toFixed(1));
      }
    }
    return { count, near, high };
  });
  check('overhead beams stay off jump flights: none just past a ramp, gap, crest, halfpipe, split or loop, and the autopilot passes under every one on the road',
    over.count > 400 && over.near.length === 0 && over.high.length === 0, `${over.count} overheads; near ${over.near.slice(0, 5).join(' ')}; high ${over.high.slice(0, 5).join(' ')}`);

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

  const bb = await page.evaluate(() => {
    const ctx = VROOM.game.ctx, scene = new THREE.Scene(), rig = VROOM.fx.create(ctx, scene), out = {};
    try {
      const pools = scene.children.filter(o => o.isInstancedMesh), kids0 = scene.children.length;
      const puff = pools.find(o => o.geometry.attributes.aAlpha);
      out.puff = !!puff;
      if (puff) {
        const m = puff.material, g = puff.geometry;
        out.billboard = m.isShaderMaterial && /modelViewMatrix \* instanceMatrix \* vec4\(0\.0, 0\.0, 0\.0, 1\.0\)/.test(m.vertexShader) && g.type === 'PlaneGeometry';
        out.soft = m.transparent && !m.depthWrite && !!m.uniforms.map.value && m.fog;
        const cap = puff.instanceMatrix.count;
        for (let i = 0; i < 400; i++) { rig.emit(i % 2 ? 'smoke' : 'dust', [i % 7, 0, 0], { n: 6 }); }
        rig.update(0.05);
        const a = g.attributes.aAlpha.array, live = puff.count;
        let lo = 1, hi = 0; for (let i = 0; i < live; i++) { lo = Math.min(lo, a[i]); hi = Math.max(hi, a[i]); }
        out.alpha = { lo: +lo.toFixed(2), hi: +hi.toFixed(2) };
        out.pooled = puff.instanceMatrix.count === cap && scene.children.length === kids0 && live <= cap;
        /* the painted puff falls off to nothing at its rim */
        const img = m.uniforms.map.value.image, c2 = img.getContext('2d').getImageData(0, 0, img.width, img.height).data, at = (x, y) => c2[(y * img.width + x) * 4 + 3];
        out.falloff = { mid: at(img.width >> 1, img.height >> 1), edge: at(1, img.height >> 1), corner: at(0, 0) };
        /* life: a puff fades in, then thins away */
        for (let i = 0; i < 80; i++) rig.update(0.05);
        out.after = puff.count;
        /* water spray is puffs too (lit chunks read as white rocks): a splash adds puffs and no solids */
        const chunk = pools.find(o => o.geometry.type === 'IcosahedronGeometry'), solid0 = chunk ? chunk.count : -1;
        rig.emit('splash', [0, 0, 0], { n: 12 }); rig.update(0.02);
        out.splash = { puffs: puff.count, solids: chunk ? chunk.count - solid0 : -1 };
      }
      rig.dispose();
    } catch (e) { out.err = String(e); }
    return out;
  });
  check('fx: smoke and dust are soft camera-facing billboards (pooled, alpha falloff, faded per particle), not lit solids',
    !bb.err && bb.puff && bb.billboard && bb.soft && bb.pooled && bb.alpha.hi > 0.2 && bb.alpha.hi <= 1 && bb.falloff.mid > 150 && bb.falloff.edge < 30 && bb.falloff.corner === 0 && bb.after === 0 && bb.splash.puffs >= 12 && bb.splash.solids === 0, JSON.stringify(bb));

  const trail = await page.evaluate(() => {
    const ctx = VROOM.game.ctx, out = {};
    try {
      const spec = VROOM.levels.level(10), track = VROOM.sim.buildTrack(spec);
      const st = VROOM.sim.newRace(track, VROOM.sim.carParams(VROOM.catalog.stats({ body: 'monster', wheels: 'monster', extras: {} }), {}), { seed: spec.seed, mode: 'race' });
      const rig = VROOM.worlds.buildWorld(ctx, track, spec), cam = new THREE.PerspectiveCamera(62, 1.7, 0.1, 3000);
      const boss = st.actors.find(a => a.boss), c = st.car;
      const live = () => { let n = 0; rig.scene.traverse(o => { if (o.isInstancedMesh && o.geometry.type !== 'BufferGeometry') n += o.count; }); return n; };
      cam.position.set(c.x, c.y + 4, c.z - 8); cam.lookAt(c.x, c.y, c.z);
      boss.x = c.x + 6; boss.y = c.y; boss.z = c.z + 6; boss.alive = true; boss.defeated = false;
      boss.state = 'idle'; for (let i = 0; i < 20; i++) rig.update(st, 1 / 30, i / 30, cam);
      out.idle = live();
      boss.state = 'chase'; for (let i = 0; i < 20; i++) rig.update(st, 1 / 30, 1 + i / 30, cam);
      out.chase = live();
      rig.onEvent({ type: 'boss', what: 'enter', a: st.actors.indexOf(boss), tick: 1 }, st); rig.update(st, 1 / 60, 3, cam);
      out.enter = live();
      rig.dispose();
    } catch (e) { out.err = String(e); }
    return out;
  });
  check('a chasing boss leaves a particle trail (none while it waits), and arrives in a blast', !trail.err && trail.chase > trail.idle + 20 && trail.enter > trail.chase + 30, JSON.stringify(trail));

  /* frost: the grunge brief, measured off a frame from the start line */
  const frost = await page.evaluate(() => {
    const ctx = VROOM.game.ctx, r = ctx.renderer, out = {};
    const frame = n => {
      const spec = VROOM.levels.level(n), track = VROOM.sim.buildTrack(spec);
      const st = VROOM.sim.newRace(track, VROOM.sim.carParams(VROOM.catalog.stats({ body: 'monster', wheels: 'monster', extras: {} }), {}), { seed: spec.seed, mode: 'race', monsters: false });
      const rig = VROOM.worlds.buildWorld(ctx, track, spec), cam = new THREE.PerspectiveCamera(62, 1200 / 700, 0.1, 3000);
      const p = VROOM.sim.toWorld(track, 40, 0, 4), a = VROOM.sim.toWorld(track, 70, 0, 1);
      cam.position.set(p[0], p[1], p[2]); cam.lookAt(a[0], a[1], a[2]);
      rig.update(st, 1 / 60, 1, cam); r.render(rig.scene, cam);
      const gl = r.getContext(), W = gl.drawingBufferWidth, H = gl.drawingBufferHeight, px = new Uint8Array(W * H * 4);
      gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
      let sum = 0, warm = 0, cnt = 0;
      for (let i = 0; i < px.length; i += 4 * 13) { const l = (0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]) / 255; sum += l; cnt++; if (px[i] > 120 && px[i] > px[i + 2] * 1.5) warm++; }
      rig.dispose();
      return { luma: +(sum / cnt).toFixed(3), warm };
    };
    try {
      out.frost = frame(45); out.foundry = frame(5);
      const road = ctx.cache.get('tex:road5');
      if (road) { const d = road.image.getContext('2d').getImageData(0, 0, 512, 512).data; let s2 = 0; for (let i = 0; i < d.length; i += 4 * 97) s2 += (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255; out.deck = +(s2 / (d.length / (4 * 97))).toFixed(3); }
    } catch (e) { out.err = String(e); }
    return out;
  });
  check('frost is dark iron and blue-black ice, not a clean white: a dark frame, a dark deck, sodium-warm light in it',
    !frost.err && frost.frost.luma < 0.2 && frost.deck < 0.25 && frost.frost.warm > 0, JSON.stringify(frost));

  /* creatures: true to size, eye glints, rim, telegraph glow, bosses lit with an entrance */
  const mon = await page.evaluate(() => {
    const ctx = VROOM.game.ctx, K = VROOM.monsterAI.KINDS, out = { size: [], glint: [], rim: [], boss: [] };
    const NO = /^(wing|tail|ground|anchor|lure)/, v = new THREE.Vector3();
    const actor = (k, state) => ({ i: 0, kind: k, arche: K[k].arche, s: 0, d: 0, h: 0, x: 0, y: 0, z: 0, yaw: 0, vs: 10, vd: 0, vh: 0, state, stateT: 0.4, tellT: K[k].tell || 0.8, r: K[k].r, alive: true, boss: K[k].arche === 'boss', mark: 0, mx: 0, my: 0, mz: 0, gy: 0, enraged: false, defeated: false });
    for (const k of Object.keys(K)) {
      if (K[k].arche === 'debris') continue;
      const rig = VROOM.monsters.build(ctx, k), scene = new THREE.Scene();
      scene.add(rig.group); rig.group.updateMatrixWorld(true);
      /* footprint in the rest pose: furthest solid vertex from the centre in the ground plane */
      let fp = 0;
      rig.group.traverse(o => {
        if (!o.isMesh || o.isInstancedMesh || !o.material.isMeshStandardMaterial) return;
        for (let p = o.parent; p && p !== rig.group; p = p.parent) if (NO.test(p.name)) return;
        const a = o.geometry.attributes.position;
        for (let i = 0; i < a.count; i++) { v.fromBufferAttribute(a, i).applyMatrix4(o.matrixWorld); fp = Math.max(fp, Math.hypot(v.x, v.z)); }
      });
      out.size.push({ k, arche: K[k].arche, ratio: +(fp / K[k].r).toFixed(2) });
      let glint = null, solid = null;
      rig.group.traverse(o => { if (o.isSprite) glint = o; if (o.isMesh && o.material.userData && o.material.userData.rim) solid = o.material; });
      /* the peak over a few frames: the tell pulses */
      const read = st => { const a = actor(k, st), o = { gs: 0, rk: 0 }; for (let i = 0; i < 12; i++) { rig.update(a, 1 / 60, 1 + i * 0.013); o.gs = Math.max(o.gs, glint ? glint.scale.x : 0); o.rk = Math.max(o.rk, solid ? solid.userData.rim.rimK.value : 0); } return o; };
      const idle = read(K[k].arche === 'boss' ? 'chase' : 'idle'), tell = read('tell');
      out.glint.push({ k, has: !!glint, flare: tell.gs > idle.gs * 1.15 });
      out.rim.push({ k, has: !!(solid && solid.onBeforeCompile), hot: tell.rk > idle.rk * 1.5 });
      if (K[k].arche === 'boss') {
        const a = actor(k, 'chase'); rig.update(a, 1 / 60, 1);
        let lamp = null; scene.traverse(o => { if (o.isPointLight) lamp = o; });
        for (let i = 0; i < 30; i++) rig.update(a, 1 / 30, 1 + i / 30);
        const lit = lamp ? lamp.intensity : 0, body = rig.group.getObjectByName('body'), y0 = body.position.y;
        rig.onEvent('enter'); rig.update(a, 1 / 60, 3);
        const risen = body.position.y < y0 - 0.5;
        for (let i = 0; i < 60; i++) rig.update(a, 1 / 30, 3 + i / 30);
        const settled = Math.abs(body.position.y - y0) < 0.5;
        a.state = 'idle'; rig.update(a, 1 / 60, 6);
        const dark = lamp ? lamp.intensity === 0 : false;
        rig.dispose();
        let left = false; scene.traverse(o => { if (o.isPointLight) left = true; });
        out.boss.push({ k, lamp: !!lamp, lit: lit > 10, risen, settled, dark, freed: !left, ratio: +(fp / K[k].r).toFixed(2) });
      } else rig.dispose();
    }
    return out;
  });
  const offSize = mon.size.filter(m => m.arche !== 'boss' && (m.ratio < 1.0 || m.ratio > 1.25));
  check('creatures are drawn true to their sim radius (footprint 1.0 to 1.25 r, wings and tails aside), so a near miss looks like one', offSize.length === 0 && mon.size.length >= 36, offSize.map(m => m.k + ':' + m.ratio).join(' '));
  const noGlint = mon.glint.filter(g => !g.has || !g.flare);
  check('every creature and boss has glowing eye glints that flare through a tell', noGlint.length === 0, JSON.stringify(noGlint));
  const noRim = mon.rim.filter(g => !g.has || !g.hot);
  check('every creature has a world-contrast rim light that runs hot through its tell (the lunge telegraph)', noRim.length === 0, JSON.stringify(noRim));
  const badBoss = mon.boss.filter(b => !b.lamp || !b.lit || !b.risen || !b.settled || !b.dark || !b.freed || b.ratio < 1.35);
  check('bosses: huge (at least 1.35 r), carry their own light (dark while away, freed on dispose), rise up out of the road on entering', badBoss.length === 0 && mon.boss.length === 12, JSON.stringify(badBoss));

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
