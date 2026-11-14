/* game: boot, renderer, scene router, the frame loop and the race glue. Owner: integrator.
   Runs last. Reads every other module through VROOM.<name>; owns VROOM.scenes.race and the chase camera.
   URL switches (dev and tests): ?scene=<id> opens that scene first (splash, home, garage, map, race,
   results, or a dev:* scene), ?level=N picks the race level, ?bot=1 lets sim.autopilot drive,
   ?garage (the v12 switch) skips to the garage, ?nosplash skips the splash. */

const C = VROOM.contracts;
const stage = document.getElementById('stage'), view = document.getElementById('view');
const params = new URLSearchParams(location.search);
let stageScale = 1;
function fit() {
  stageScale = Math.min(innerWidth / C.STAGE_W, innerHeight / C.STAGE_H);
  stage.style.transform = `translate(-50%,-50%) scale(${stageScale})`;
}
addEventListener('resize', fit);
addEventListener('orientationchange', () => { fit(); setTimeout(fit, 350); });
if (window.visualViewport) visualViewport.addEventListener('resize', fit);
fit();

const reducedMotion = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
let renderer = null;
try {
  renderer = new THREE.WebGLRenderer({ canvas: view, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.setSize(C.STAGE_W, C.STAGE_H, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
} catch (e) { console.warn('webgl unavailable', e); }
const ctx = { THREE, renderer, quality: params.get('quality') === 'low' ? 'low' : 'high', reducedMotion, cache: new Map() };

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
  if (current && current.exit) current.exit();
  current = next; currentId = VROOM.scenes[id] ? id : 'boot';
  for (const s of document.querySelectorAll('.scene')) s.classList.toggle('active', s.id === current.dom);
  if (current.enter) current.enter(p);
}

/* ---- the race ---- */
const SFX_OF = { star: 'star', nitro: 'nitro', pad: 'pad', jump: 'jump', trick: 'trick', hit: 'hit', scrape: 'scrape', wall: 'wall', spin: 'spin',
  checkpoint: 'checkpoint', respawn: 'respawn', finish: 'finish' };
const race = {
  id: 'race', dom: 'race', view: null,
  enter({ n = VROOM.save.progress.current } = {}) {
    const S = VROOM.sim, spec = VROOM.levels.level(n), track = S.buildTrack(spec);
    const st = S.newRace(track, S.carParams(VROOM.catalog.stats(VROOM.save.state), VROOM.save.progress.upgrades), { seed: spec.seed, mode: 'race' });
    const world = VROOM.worlds.buildWorld(ctx, track, spec);
    const car = VROOM.cars.buildCar(ctx, VROOM.save.state);
    world.scene.add(car.group);
    car.setDamage(VROOM.save.progress.damage);
    const mons = st.actors.map(a => { const r = VROOM.monsters.build(ctx, a.kind); world.scene.add(r.group); return r; });
    const fx = VROOM.fx.create(ctx, world.scene);
    const camera = new THREE.PerspectiveCamera(62, C.STAGE_W / C.STAGE_H, 0.1, 3000);
    Object.assign(this, { n, spec, track, st, world, car, mons, fx, camera, acc: 0, inputs: [], doneT: 0, bot: params.get('bot') === '1' });
    this.view = { scene: world.scene, camera };
    VROOM.ui.hud.show(spec); VROOM.ui.controls.show();
    VROOM.audio.engine.start(VROOM.save.state.body); VROOM.audio.music.play(spec.kind === 'boss' ? 'boss' : 'w' + spec.world); VROOM.audio.ambience(spec.world);
    this.placeCamera(1);
  },
  update(dt, t) {
    const S = VROOM.sim, st = this.st;
    this.acc = Math.min(this.acc + dt, C.SIM_DT * C.MAX_STEPS_PER_FRAME);
    while (this.acc >= C.SIM_DT) {
      const input = this.bot ? S.autopilot(st, 1) : VROOM.ui.controls.read();
      if (!st.finished) this.inputs.push(S.packInput(input));
      S.step(st, input);
      this.acc -= C.SIM_DT;
    }
    for (const ev of st.events) this.route(ev);
    st.events.length = 0;
    const c = st.car;
    this.car.group.position.set(c.x, c.y, c.z);
    this.car.group.quaternion.set(c.qx, c.qy, c.qz, c.qw);
    this.car.update(c, dt, t);
    st.actors.forEach((a, i) => { const r = this.mons[i]; if (!r) return; r.group.position.set(a.x, a.y, a.z); r.group.rotation.y = a.yaw; r.update(a, dt, t); });
    this.world.update(st, dt, t, this.camera);
    this.fx.update(dt);
    VROOM.ui.hud.update(st);
    VROOM.audio.engine.update({ rpm: c.rpm, load: 0, speed: c.speed, boost: c.boosting, air: c.air, surf: c.surf });
    this.placeCamera(Math.min(1, dt * 6));
    if (st.finished && (this.doneT += dt) > 1.2) this.finish();
  },
  route(ev) {
    if (SFX_OF[ev.type]) VROOM.audio.sfx(SFX_OF[ev.type], ev);
    if (ev.type === 'land') VROOM.audio.sfx(ev.hard > 0.5 ? 'landHard' : 'land', ev);
    if (ev.type === 'monster') { const r = this.mons[ev.a]; if (r) r.onEvent(ev.what); VROOM.audio.sfx(ev.what === 'hit' ? 'monsterHit' : ev.what === 'tell' ? 'monsterTell' : 'monsterRoar', { kind: this.st.actors[ev.a] && this.st.actors[ev.a].kind }); }
    if (ev.type === 'boss') { const r = this.mons[ev.a]; if (r) r.onEvent(ev.what); VROOM.audio.sfx(ev.what === 'defeat' ? 'bossDefeat' : ev.what === 'attack' ? 'bossStomp' : 'bossRoar'); }
    this.world.onEvent(ev, this.st);
    VROOM.ui.hud.event(ev);
  },
  placeCamera(k) {
    const c = this.st.car, cam = this.camera, q = new THREE.Quaternion(c.qx, c.qy, c.qz, c.qw);
    const back = new THREE.Vector3(0, 3.2, -8).applyQuaternion(q).add(new THREE.Vector3(c.x, c.y, c.z));
    cam.position.lerp(back, k);
    cam.lookAt(c.x, c.y + 1.4, c.z);
  },
  finish() {
    const S = VROOM.sim, result = S.result(this.st), n = this.n;
    const replay = { t: result.time, ticks: this.inputs.length, rle: VROOM.save.encodeReplay(this.inputs) };
    const rec = n >= 1 && n <= C.PARADE_LEVEL ? VROOM.save.recordRun(n, result, replay) : null;
    go('results', { n, result, rec });
  },
  exit() {
    if (!this.world) return;
    VROOM.ui.hud.hide(); VROOM.ui.controls.hide(); VROOM.audio.engine.stop();
    this.mons.forEach(r => r.dispose()); this.car.dispose(); this.fx.dispose(); this.world.dispose();
    this.world = null; this.view = null;
  },
};
VROOM.scenes.race = race;
function startRace(n) { go('race', { n }); }

/* ---- the frame loop ---- */
let last = 0, clock = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = last ? Math.min(0.1, (now - last) / 1000) : 1 / 60;
  last = now; clock += dt;
  if (current && current.update) current.update(dt, clock);
  if (renderer && current && current.view) renderer.render(current.view.scene, current.view.camera);
}

VROOM.game = { go, ctx, startRace, current: () => currentId, stageScale: () => stageScale };

/* ---- boot ---- */
VROOM.save.load();
if (VROOM.ui && VROOM.ui.init) VROOM.ui.init(VROOM.game);
const first = params.get('scene') || (/[?&]garage\b/.test(location.search) ? 'garage' : params.has('nosplash') ? 'home' : 'splash');
if (first === 'race') startRace(+params.get('level') || VROOM.save.progress.current);
else go(first);
requestAnimationFrame(frame);
window.booted = true;
