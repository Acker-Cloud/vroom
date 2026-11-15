/* game: boot, renderer, scene router, the frame loop and the race glue. Owner: integrator.
   Runs last. Reads every other module through VROOM.<name>; owns VROOM.scenes.race and the chase camera.
   The race steps the deterministic sim at the one fixed SIM_DT and renders the car and monsters
   interpolated between the last two sim ticks, so the picture is smooth at any frame rate and the sim
   never sees a frame time. A best run's packed inputs replay through a second SimState as the ghost.
   URL switches (dev, tests, screenshots):
     ?scene=<id>   open that scene first (splash, home, garage, map, race, results, or a dev:* scene)
     ?level=N      race level N (with no ?scene, the race opens straight away)
     ?world=N      the map on world N (with ?scene=race: that world's first level, or its finale with ?boss)
     ?bot=1        the autopilot drives (and the countdown is skipped)
     ?garage       the v12 switch: straight to the garage      ?nosplash   skip the splash
     ?quality=low  no shadows, fewer particles               ?noghost    no ghost car */

const C = VROOM.contracts;
const stage = document.getElementById('stage'), view = document.getElementById('view');
const params = new URLSearchParams(location.search);
const reducedMotion = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
let renderer = null;
try {
  renderer = new THREE.WebGLRenderer({ canvas: view, antialias: true, powerPreference: 'high-performance' });
  renderer.setSize(C.STAGE_W, C.STAGE_H, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
} catch (e) { console.warn('webgl unavailable', e); }
const ctx = { THREE, renderer, quality: params.get('quality') === 'low' ? 'low' : 'high', reducedMotion, cache: new Map() };

/* the stage is a fixed 1200x700 letterboxed and scaled; the canvas draws at the pixels it really covers */
let stageScale = 1;
function fit() {
  stageScale = Math.min(innerWidth / C.STAGE_W, innerHeight / C.STAGE_H);
  stage.style.transform = `translate(-50%,-50%) scale(${stageScale})`;
  if (renderer) renderer.setPixelRatio(Math.max(0.5, Math.min(2, (window.devicePixelRatio || 1) * stageScale)));
}
addEventListener('resize', fit);
addEventListener('orientationchange', () => { fit(); setTimeout(fit, 350); });
if (window.visualViewport) visualViewport.addEventListener('resize', fit);
fit();

/* ---- the placeholder scene: a spinning gunmetal block, shown when a scene id is missing ---- */
VROOM.scenes.boot = (() => {
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(45, C.STAGE_W / C.STAGE_H, 0.1, 100);
  scene.background = new THREE.Color(0x15171c);
  scene.add(new THREE.HemisphereLight(0xc7ccd5, 0x2a1a10, 1.2));
  const key = new THREE.DirectionalLight(0xffb02e, 2.5); key.position.set(3, 5, 4); scene.add(key);
  const block = new THREE.Mesh(new THREE.BoxGeometry(2, 1, 3), new THREE.MeshStandardMaterial({ color: 0x555b66, metalness: 0.8, roughness: 0.35, flatShading: true }));
  scene.add(block); camera.position.set(4, 3, 5); camera.lookAt(0, 0, 0);
  return { id: 'boot', dom: 'boot', view: { scene, camera }, enter() {}, exit() {}, update(dt, t) { block.rotation.y = t; } };
})();

/* ---- router ---- */
let current = null, currentId = '';
function go(id, p = {}) {
  const next = VROOM.scenes[id] || VROOM.scenes.boot;
  if (current && current.exit) {
    try { current.exit(); } catch (e) { console.error('scene exit', currentId, e); }
  }
  current = next; currentId = VROOM.scenes[id] ? id : 'boot';
  for (const s of document.querySelectorAll('.scene')) s.classList.toggle('active', s.id === current.dom);
  if (current.enter) current.enter(p);
  updateGate.place();
}

/* ---- the race ---- */
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
/* the build a replay was driven with: a ghost only replays bit-exact in the same machine with the same upgrades */
function buildKey() {
  const s = VROOM.save.state, u = VROOM.save.progress.upgrades;
  return [s.body, s.wheels, Object.keys(s.extras).filter(k => s.extras[k]).sort().join('+'), C.LEGACY.UPGRADES.map(k => u[k] | 0).join('')].join('|');
}
function carParams() {
  const s = VROOM.save.state, st = VROOM.catalog.stats(s), body = VROOM.catalog.BODIES[s.body];
  if (body && !st.cls) st.cls = body.cls;
  return VROOM.sim.carParams(st, VROOM.save.progress.upgrades);
}
/* sim events -> sound. Everything else about an event is the world's (fx), the monster rig's and the HUD's */
function sfxFor(ev, st) {
  const A = VROOM.audio, kindOf = i => st.actors[i] && st.actors[i].kind;
  switch (ev.type) {
    case 'star': case 'nitro': case 'pad': case 'jump': case 'trick': case 'scrape': case 'spin': case 'checkpoint': case 'respawn': case 'finish':
      A.sfx(ev.type, ev); break;
    case 'boost': if (ev.on) A.sfx('boost'); break;
    case 'drift': if (ev.on) A.sfx('skid', { v: 0.7 }); break;
    case 'driftBank': A.sfx('whoosh', { p: 1.2 }); break;
    case 'surface': if (C.SURF[ev.surf] === 'water') A.sfx('splash'); break;
    case 'land': A.sfx(ev.hard > 0.5 ? 'landHard' : 'land', ev); break;
    case 'wall': A.sfx('wall', { v: clamp((ev.impulse || 4) / 12, 0.3, 1) }); break;
    case 'hit':
      if (ev.cat === 'mine') A.sfx('explosion');
      else if (C.PROP_CAT[ev.cat] && C.PROP_CAT[ev.cat].kind === 'soft') A.sfx('crunch', ev);
      else A.sfx('hit', ev);
      break;
    case 'monster': {
      const name = { hit: 'monsterHit', tell: 'monsterTell', lunge: 'monsterRoar', roar: 'monsterRoar', stomp: 'slam' }[ev.what];
      if (name) A.sfx(name, { kind: kindOf(ev.a) });
      break;
    }
    case 'boss': {
      const name = { defeat: 'bossDefeat', attack: 'bossStomp', hit: 'monsterHit', enter: 'bossRoar', roar: 'bossRoar', enrage: 'bossRoar' }[ev.what];
      if (name) A.sfx(name, { kind: kindOf(ev.a) });
      break;
    }
  }
}
const V3 = () => new THREE.Vector3();
const race = {
  id: 'race', dom: 'race', view: null,
  enter({ n = VROOM.save.progress.current } = {}) {
    const S = VROOM.sim, spec = VROOM.levels.level(n), track = S.buildTrack(spec), P = carParams();
    const st = S.newRace(track, P, { seed: spec.seed, mode: 'race' });
    const world = VROOM.worlds.buildWorld(ctx, track, spec);
    const car = VROOM.cars.buildCar(ctx, VROOM.save.state);
    world.scene.add(car.group);
    car.setDamage(VROOM.save.progress.damage);
    const mons = st.actors.map(a => { const r = VROOM.monsters.build(ctx, a.kind); world.scene.add(r.group); return r; });
    const camera = new THREE.PerspectiveCamera(62, C.STAGE_W / C.STAGE_H, 0.1, 3000);
    Object.assign(this, { n, spec, track, st, world, car, mons, camera, acc: 0, inputs: [], doneT: 0, hitStop: 0, shake: 0, maxAir: 0, maxDrift: 0,
      bot: params.get('bot') === '1', key: buildKey(), ghost: null,
      prev: { x: 0, y: 0, z: 0, q: new THREE.Quaternion() }, prevA: st.actors.map(a => [a.x, a.y, a.z, a.yaw]),
      cam: { fwd: V3(), up: new THREE.Vector3(0, 1, 0), pos: V3(), look: V3(), fov: 62 }, tmpQ: new THREE.Quaternion(), frame: {} });
    this.savePrev();
    this.ghost = this.makeGhost(P);
    this.view = { scene: world.scene, camera };
    VROOM.ui.hud.show(spec); VROOM.ui.controls.show();
    VROOM.audio.engine.start(VROOM.save.state.body); VROOM.audio.music.play(spec.kind === 'boss' ? 'boss' : 'w' + spec.world); VROOM.audio.ambience(spec.world);
    this.placeCamera(0, true);
  },
  /* the ghost: the stored best run's inputs replayed through its own SimState (deterministic, so it drives the same line) */
  makeGhost(P) {
    const lv = VROOM.save.progress.levels[this.n], r = lv && lv.replay;
    if (params.has('noghost') || !r || r.b !== this.key) return null;
    const inputs = VROOM.save.decodeReplay(r.rle);
    if (inputs.length !== r.ticks) return null;
    const st = VROOM.sim.newRace(this.track, P, { seed: this.spec.seed, mode: 'race' });
    const rig = VROOM.cars.buildCar(ctx, VROOM.save.state, { ghost: true, shadows: false, fill: false });
    this.world.scene.add(rig.group);
    return { st, inputs, i: 0, rig, prev: { x: st.car.x, y: st.car.y, z: st.car.z, q: new THREE.Quaternion(st.car.qx, st.car.qy, st.car.qz, st.car.qw) }, fade: 1 };
  },
  savePrev() {
    const c = this.st.car, p = this.prev;
    p.x = c.x; p.y = c.y; p.z = c.z; p.q.set(c.qx, c.qy, c.qz, c.qw);
    this.st.actors.forEach((a, i) => { const q = this.prevA[i] || (this.prevA[i] = [0, 0, 0, 0]); q[0] = a.x; q[1] = a.y; q[2] = a.z; q[3] = a.yaw; });
    const g = this.ghost;
    if (g) { const gc = g.st.car; g.prev.x = gc.x; g.prev.y = gc.y; g.prev.z = gc.z; g.prev.q.set(gc.qx, gc.qy, gc.qz, gc.qw); }
  },
  update(dt, t) {
    const S = VROOM.sim, st = this.st;
    if (this.hitStop > 0) { this.hitStop -= dt; dt = 0; }
    this.acc = Math.min(this.acc + dt, C.SIM_DT * C.MAX_STEPS_PER_FRAME);
    while (this.acc >= C.SIM_DT) {
      this.savePrev();
      const input = this.bot ? S.autopilot(st, 1) : VROOM.ui.controls.read();
      if (!st.finished) this.inputs.push(S.packInput(input));
      S.step(st, input);
      const g = this.ghost;
      if (g && g.i < g.inputs.length) { S.step(g.st, S.unpackInput(g.inputs[g.i++])); g.st.events.length = 0; }
      this.acc -= C.SIM_DT;
    }
    for (const ev of st.events) this.route(ev);
    st.events.length = 0;
    const k = this.acc / C.SIM_DT, c = st.car, p = this.prev;
    this.car.group.position.set(p.x + (c.x - p.x) * k, p.y + (c.y - p.y) * k, p.z + (c.z - p.z) * k);
    this.car.group.quaternion.copy(p.q).slerp(this.tmpQ.set(c.qx, c.qy, c.qz, c.qw), k);
    this.car.update(c, dt, t);
    st.actors.forEach((a, i) => {
      const r = this.mons[i], q = this.prevA[i];
      if (!r) return;
      if (q) {
        let dy = a.yaw - q[3];
        dy -= Math.round(dy / (2 * Math.PI)) * 2 * Math.PI;
        r.group.position.set(q[0] + (a.x - q[0]) * k, q[1] + (a.y - q[1]) * k, q[2] + (a.z - q[2]) * k);
        r.group.rotation.y = q[3] + dy * k;
      } else { r.group.position.set(a.x, a.y, a.z); r.group.rotation.y = a.yaw; }
      r.update(a, dt, t);
    });
    this.drawGhost(k, dt, t);
    this.world.update(st, dt, t, this.camera);
    VROOM.ui.hud.update(st);
    const inp = this.bot ? null : VROOM.ui.controls.read();
    VROOM.audio.engine.update({ rpm: c.rpm, load: inp ? inp.throttle : 1, speed: c.speed, boost: c.boosting, air: c.air, surf: c.surf });
    this.placeCamera(dt, false);
    if (st.finished && (this.doneT += dt) > 1.2) this.finish();
  },
  drawGhost(k, dt, t) {
    const g = this.ghost;
    if (!g) return;
    const c = g.st.car, p = g.prev, grp = g.rig.group;
    grp.position.set(p.x + (c.x - p.x) * k, p.y + (c.y - p.y) * k, p.z + (c.z - p.z) * k);
    grp.quaternion.copy(p.q).slerp(this.tmpQ.set(c.qx, c.qy, c.qz, c.qw), k);
    g.rig.update(c, dt, t);
    /* the twin fades out once its run is over, and never sits on top of the camera */
    if (g.st.finished || g.i >= g.inputs.length) g.fade = Math.max(0, g.fade - dt);
    const near = this.camera.position.distanceTo(grp.position) < 4;
    grp.visible = g.fade > 0 && !near;
  },
  route(ev) {
    const st = this.st;
    try { sfxFor(ev, st); } catch (e) { /* a missing sound never stops the race */ }
    if (ev.type === 'monster' || ev.type === 'boss') { const r = this.mons[ev.a]; if (r) r.onEvent(ev.what); }
    if (ev.type === 'land') { this.maxAir = Math.max(this.maxAir, ev.airT || 0); if (ev.hard > 0.5) this.bump(0.35 * ev.hard); }
    if (ev.type === 'driftBank') this.maxDrift = Math.max(this.maxDrift, ev.t || 0);
    if (ev.type === 'wall' && (ev.impulse || 0) > 6) this.bump(0.25);
    if ((ev.type === 'monster' || ev.type === 'boss') && ev.what === 'hit') { this.bump(0.6); this.hitStop = 0.06; }
    if (ev.type === 'boss' && ev.what === 'attack') this.bump(0.3);
    if (ev.type === 'hit' && ev.cat === 'mine') { this.bump(0.7); this.hitStop = 0.06; }
    this.world.onEvent(ev, st);
    VROOM.ui.hud.event(ev);
  },
  bump(a) { if (!reducedMotion) this.shake = Math.min(1, this.shake + a); },
  /* chase camera: behind the direction of travel, up along the road's own up (so loops and corkscrews
     carry the view round), pulled back and widened with speed and boost. Snaps after a crane respawn. */
  placeCamera(dt, snap) {
    const c = this.st.car, cam = this.camera, K = this.cam, pos = this.car.group.position;
    const f = VROOM.sim.frameAt(this.track, clamp(c.s, 0, this.track.length), this.frame);
    const sp = Math.sqrt(c.vx * c.vx + c.vy * c.vy + c.vz * c.vz);
    const want = V3();
    if (sp > 4 && !c.air) want.set(c.vx / sp, c.vy / sp, c.vz / sp);
    else if (sp > 4) want.set(c.vx, c.vy * 0.3, c.vz).normalize();
    else want.set(0, 0, 1).applyQuaternion(this.car.group.quaternion);
    want.lerp(V3().set(f.tx, f.ty, f.tz), c.air ? 0.4 : 0.25).normalize();
    const up = V3().set(f.ux, f.uy, f.uz);
    if (c.air || c.respawnT > 0) up.lerp(V3().set(0, 1, 0), 0.5).normalize();
    const kf = snap ? 1 : 1 - Math.exp(-dt * 4.5), ku = snap ? 1 : 1 - Math.exp(-dt * 3);
    K.fwd.lerp(want, kf).normalize(); K.up.lerp(up, ku).normalize();
    /* sized to the machine: a 8x8 carrier sits as far up the screen as a dragster, clear of the gauge */
    const sz = this.car.size || { l: 4.5, h: 2.4 };
    const dist = 2.6 + sz.l * 1.05 + Math.min(4, sp * 0.06) + (c.boosting ? 1.2 : 0), height = 1.6 + sz.h * 0.85 + Math.min(1.2, sp * 0.015);
    const target = V3().copy(pos).addScaledVector(K.fwd, -dist).addScaledVector(K.up, height);
    if (snap || K.pos.distanceTo(target) > 40) K.pos.copy(target); else K.pos.lerp(target, 1 - Math.exp(-dt * 10));
    K.look.copy(pos).addScaledVector(K.up, 0.5 + sz.h * 0.15).addScaledVector(K.fwd, 3);
    cam.position.copy(K.pos);
    if (this.shake > 0 && !reducedMotion) {
      const a = this.shake * this.shake * 0.35, t = performance.now() * 0.05;
      cam.position.x += Math.sin(t * 1.7) * a; cam.position.y += Math.sin(t * 2.3) * a; cam.position.z += Math.cos(t * 1.9) * a;
      this.shake = Math.max(0, this.shake - dt * 2.5);
    }
    cam.up.copy(K.up);
    cam.lookAt(K.look);
    const fov = 62 + Math.min(10, sp * 0.12) + (c.boosting ? 6 : 0);
    K.fov += (fov - K.fov) * (snap ? 1 : 1 - Math.exp(-dt * 3));
    if (Math.abs(cam.fov - K.fov) > 0.05) { cam.fov = K.fov; cam.updateProjectionMatrix(); }
  },
  finish() {
    const S = VROOM.sim, result = S.result(this.st), n = this.n;
    result.bonus = VROOM.monsterAI && VROOM.monsterAI.bonus ? VROOM.monsterAI.bonus(this.st.actors) : 0;
    result.maxAir = this.maxAir; result.maxDrift = this.maxDrift;
    const replay = { t: result.time, ticks: this.inputs.length, rle: VROOM.save.encodeReplay(this.inputs), b: this.key };
    const rec = n >= 1 && n <= C.PARADE_LEVEL ? VROOM.save.recordRun(n, result, replay) : null;
    go('results', { n, result, rec });
  },
  exit() {
    if (!this.world) return;
    VROOM.ui.hud.hide(); VROOM.ui.controls.hide(); VROOM.audio.engine.stop();
    this.mons.forEach(r => r.dispose()); this.car.dispose(); if (this.ghost) this.ghost.rig.dispose(); this.world.dispose();
    this.world = null; this.view = null; this.ghost = null;
  },
};
VROOM.scenes.race = race;
function startRace(n) { go('race', { n }); }

/* ---- the new-version gate ----
   No service worker: a stale game is Safari's cache or a home-screen app left running. Compare the
   APP_VERSION this page booted with against a fresh copy of the page on boot, on coming back to the
   foreground and every 10 minutes; a different version shows a hazard plate that reloads on a held
   press (a quick tap does nothing, so a stray tap cannot reload). Shown on home only, under the avatar. */
const updateGate = (() => {
  const HOLD_MS = 1600, RING = 2 * Math.PI * 46;
  let btn = null, ready = false, last = 0, holdT = null, raf = 0, t0 = 0;
  function make() {
    if (btn || !VROOM.ui || !VROOM.ui.button) return;
    const icon = `<svg viewBox="0 0 100 100" width="100%" height="100%"><circle cx="50" cy="50" r="46" fill="none" stroke="#111214" stroke-width="8"/>`
      + `<circle class="ring" cx="50" cy="50" r="46" fill="none" stroke="#8cff3a" stroke-width="8" stroke-dasharray="${RING.toFixed(1)}" stroke-dashoffset="${RING.toFixed(1)}" transform="rotate(-90 50 50)"/>`
      + '<g class="arrows" fill="none" stroke="#f4f6fa" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"><path d="M30 44 A21 21 0 0 1 68 36"/><path d="M70 56 A21 21 0 0 1 32 64"/><path d="M60 26 L70 36 L58 42"/><path d="M40 74 L30 64 L42 58"/></g></svg>';
    btn = VROOM.ui.button({ icon, cls: 'go', aria: 'new version ready: press and hold to update', on: e => start(e) });
    btn.id = 'updateBtn';
    btn.style.cssText = 'position:absolute;left:1078px;top:140px;width:100px;height:100px;padding:6px;z-index:40;display:none';
    for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) btn.addEventListener(ev, end);
    stage.append(btn);
  }
  const ring = () => btn && btn.querySelector('.ring');
  function start(e) {
    if (e && e.pointerId !== undefined) { try { btn.setPointerCapture(e.pointerId); } catch (err) { /* capture is best effort */ } }
    end();
    t0 = performance.now();
    (function fill() {
      const f = Math.min(1, (performance.now() - t0) / HOLD_MS), r = ring();
      if (r) r.setAttribute('stroke-dashoffset', (RING * (1 - f)).toFixed(1));
      if (f < 1) raf = requestAnimationFrame(fill);
    })();
    holdT = setTimeout(() => {
      VROOM.save.save();
      try { VROOM.audio.sfx('unlock'); } catch (err) { /* silent is fine */ }
      setTimeout(() => location.replace(location.pathname + '?v=' + Date.now() + location.hash), 300);
    }, HOLD_MS);
  }
  function end() {
    clearTimeout(holdT); cancelAnimationFrame(raf); holdT = null;
    const r = ring(); if (r) r.setAttribute('stroke-dashoffset', RING.toFixed(1));
  }
  function place() { make(); if (btn) btn.style.display = ready && currentId === 'home' ? 'block' : 'none'; }
  async function check(force) {
    if (location.protocol === 'file:' || (!force && Date.now() - last < 30000)) return;
    last = Date.now();
    try {
      const res = await fetch(location.pathname + '?v=' + Date.now(), { cache: 'no-store' });
      if (!res.ok) return;
      const v = ((await res.text()).match(/APP_VERSION = '([\d.]+)'/) || [])[1];
      if (v && v !== C.APP_VERSION) { ready = v; place(); }
    } catch (e) { /* offline: keep playing what we have */ }
  }
  return { check, place, ready: () => ready, version: C.APP_VERSION };
})();

/* ---- the frame loop ---- */
let last = 0, clock = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = last ? Math.min(0.1, (now - last) / 1000) : 1 / 60;
  last = now; clock += dt;
  try {
    if (current && current.update) current.update(dt, clock);
    if (renderer && current && current.view) renderer.render(current.view.scene, current.view.camera);
  } catch (e) {
    if (!frame.warned) { console.error('frame', currentId, e); frame.warned = true; }
  }
}

VROOM.game = { go, ctx, startRace, current: () => currentId, stageScale: () => stageScale, race, update: updateGate };

/* ---- boot ---- */
VROOM.save.load();
if (VROOM.ui && VROOM.ui.init) VROOM.ui.init(VROOM.game);
const worldParam = clamp(+params.get('world') | 0, 0, C.WORLD_COUNT);
const levelParam = +params.get('level') | 0;
let toGarage = false;
try { toGarage = sessionStorage.getItem('vroom.toGarage') === '1'; sessionStorage.removeItem('vroom.toGarage'); } catch (e) { /* private mode */ }
let first = params.get('scene');
if (!first) first = /[?&]garage\b/.test(location.search) || toGarage ? 'garage' : levelParam ? 'race' : worldParam ? 'map' : params.has('nosplash') ? 'home' : 'splash';
if (first === 'race') {
  const n = levelParam ? clamp(levelParam, 1, C.PARADE_LEVEL) : worldParam ? (worldParam - 1) * C.WORLD_SIZE + (params.has('boss') ? C.WORLD_SIZE : 1) : VROOM.save.progress.current;
  startRace(n);
} else go(first, first === 'map' && worldParam ? { world: worldParam } : {});
requestAnimationFrame(frame);
setTimeout(() => updateGate.check(), 2500);
setInterval(() => updateGate.check(), 10 * 60 * 1000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) updateGate.check(); });
window.booted = true;
