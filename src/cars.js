/* cars: low-poly vehicle meshes and the garage scene. Owner: cars.
   SCAFFOLD STUB: a gunmetal box on four tyres, and a garage that spins it with GO and map plates.
   The cars builder designs the roster (docs/OVERHAUL.md "Vehicle roster"): every legacy id plus the v13
   machines, paint / decal / buddy / extras / number / damage / grime, and the garage shop flow.
   Contract: VROOM.contracts MODULE_API.cars and the Scene API. Model nose-on-+z, metres, origin on the ground. */

const tmpMats = [];
function paintHex(build) {
  const p = VROOM.catalog.PAINTS[build.color];
  return p && p.base ? parseInt(p.base.slice(1), 16) : 0x888888;
}
function buildCar(ctx, build, opts = {}) {
  const T = ctx.THREE, st = VROOM.catalog.stats(build), group = new T.Group();
  const body = new T.Group(); group.add(body);
  const mat = new T.MeshStandardMaterial({ color: paintHex(build), metalness: 0.6, roughness: 0.45, flatShading: true });
  const dark = new T.MeshStandardMaterial({ color: 0x1a1c21, roughness: 0.9, flatShading: true });
  tmpMats.push(mat, dark);
  const hull = new T.Mesh(new T.BoxGeometry(st.size.w * 0.9, st.size.h * 0.5, st.size.l), mat);
  hull.position.y = st.rideH + st.size.h * 0.25;
  const cab = new T.Mesh(new T.BoxGeometry(st.size.w * 0.7, st.size.h * 0.35, st.size.l * 0.4), dark);
  cab.position.set(0, st.rideH + st.size.h * 0.67, -st.size.l * 0.05);
  body.add(hull, cab);
  const wheels = [];
  for (let k = 0; k < 4; k++) {
    const pivot = new T.Group(), tyre = new T.Mesh(new T.CylinderGeometry(st.wheelR, st.wheelR, 0.45, 10), dark);
    tyre.rotation.z = Math.PI / 2; pivot.add(tyre);
    pivot.position.set(k % 2 ? -st.track / 2 : st.track / 2, st.wheelR, k < 2 ? st.wheelbase / 2 : -st.wheelbase / 2);
    group.add(pivot); wheels.push(pivot);
  }
  return {
    group, wheels,
    anchors: { exhaust: [[0.5, st.rideH + 0.4, -st.size.l / 2]], cam: [0, st.size.h + 1.5, -6], roof: [0, st.rideH + st.size.h, 0] },
    update(car, dt, t) {
      car.wheels.forEach((w, k) => { wheels[k].rotation.set(w.spin, k < 2 ? w.steer : 0, 0, 'YXZ'); });
    },
    setDamage(n) {}, setGrime(g) {},
    dispose() { group.traverse(o => { if (o.geometry) o.geometry.dispose(); }); mat.dispose(); dark.dispose(); },
  };
}
function thumb(ctx, build, px = 256) {
  const c = document.createElement('canvas'); c.width = c.height = px;
  return c;
}

/* ---- the garage scene ---- */
const garage = {
  id: 'garage', dom: 'garage', view: null, rig: null,
  enter() {
    const ctx = VROOM.game.ctx, T = ctx.THREE, scene = new T.Scene();
    scene.background = new T.Color(0x15171c);
    scene.add(new T.HemisphereLight(0xc7ccd5, 0x2a1a10, 1.2));
    const key = new T.DirectionalLight(0xffb02e, 2.4); key.position.set(4, 6, 3); scene.add(key);
    const floor = new T.Mesh(new T.CylinderGeometry(5, 5, 0.2, 24), new T.MeshStandardMaterial({ color: 0x2c3039, metalness: 0.8, roughness: 0.5, flatShading: true }));
    floor.position.y = -0.1; scene.add(floor);
    this.rig = buildCar(ctx, VROOM.save.state); scene.add(this.rig.group);
    const camera = new T.PerspectiveCamera(40, 1200 / 700, 0.1, 100); camera.position.set(6, 3.2, 7); camera.lookAt(0, 1, 0);
    this.view = { scene, camera };
    const hud = document.getElementById('garageHud'); hud.innerHTML = '';
    if (VROOM.ui && VROOM.ui.button) {
      const go = VROOM.ui.button({ icon: VROOM.ui.icons.go, cls: 'go', aria: 'go', on: () => VROOM.game.startRace(VROOM.save.progress.current) });
      go.style.cssText = 'right:40px;bottom:40px;width:180px;height:120px';
      const map = VROOM.ui.button({ icon: VROOM.ui.icons.map, aria: 'map', on: () => VROOM.game.go('map') });
      map.style.cssText = 'left:40px;bottom:40px';
      const home = VROOM.ui.button({ icon: VROOM.ui.icons.home, aria: 'home', on: () => VROOM.game.go('home') });
      home.style.cssText = 'left:40px;top:40px';
      hud.append(go, map, home);
    }
  },
  update(dt, t) { if (this.rig) this.rig.group.rotation.y = t * 0.4; },
  exit() { if (this.rig) this.rig.dispose(); this.rig = null; this.view = null; },
};
VROOM.scenes.garage = garage;

VROOM.cars = { buildCar, thumb };
