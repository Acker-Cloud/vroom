/* worlds: the 12 environments, road meshes, roadside sets, props, skies and menu backdrops. Owner: worlds.
   SCAFFOLD STUB: a fogged sky, a flat-shaded road ribbon meshed straight from the Track arrays, boxes for
   props, spinning stars, and a simple backdrop. The worlds builder makes every world loud
   (docs/OVERHAUL.md "Worlds"). Contract: VROOM.contracts MODULE_API.worlds. */

const ACCENT = {
  1: ['#fff2a8', '#ffb02e', '#ff5a1a', '#b3200f'], 2: ['#fff0c8', '#ffb35c', '#e8642a', '#8a2a10'], 3: ['#f0e0ff', '#ff4fd8', '#8a4dff', '#2a1070'],
  4: ['#e0f6ff', '#8fd8ff', '#2e8ac8', '#0e3a66'], 5: ['#ffffff', '#bff2ff', '#4cc3f0', '#145a86'], 6: ['#fff6d0', '#ffd36b', '#e0a030', '#7a4a10'],
  7: ['#e0fff6', '#6bffd8', '#2ec2a8', '#0e4f46'], 8: ['#e8e0ff', '#a88cff', '#5a4dff', '#1a1060'], 9: ['#fff2a8', '#ffb02e', '#ff3a0a', '#8a1000'],
  10: ['#fff0f8', '#ff9ad0', '#c84fa0', '#5a1040'], 11: ['#e0fff6', '#6bffd8', '#2ec2c8', '#0e3f66'], 12: ['#fffbe0', '#ffe27a', '#c8b4ff', '#3a2a80'],
};
const accent = w => ACCENT[w] || ACCENT[1];
const hex = s => parseInt(s.slice(1), 16);
function icon(w) {
  const a = accent(w);
  return `<svg viewBox="0 0 64 64"><circle cx="32" cy="32" r="26" fill="${a[2]}" stroke="${a[0]}" stroke-width="5"/></svg>`;
}

function roadGeometry(T, track) {
  const pos = [], idx = [];
  for (let i = 0; i < track.n; i++) {
    const hw = track.hw[i];
    pos.push(track.px[i] - track.rx[i] * hw, track.py[i] - track.ry[i] * hw, track.pz[i] - track.rz[i] * hw,
             track.px[i] + track.rx[i] * hw, track.py[i] + track.ry[i] * hw, track.pz[i] + track.rz[i] * hw);
    if (i > 0 && !(track.flags[i - 1] & VROOM.contracts.TF.GAP)) { const a = (i - 1) * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  }
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}
function buildWorld(ctx, track, spec) {
  const T = ctx.THREE, a = accent(spec.world), scene = new T.Scene(), disposables = [];
  scene.background = new T.Color(hex(a[3]));
  scene.fog = new T.Fog(hex(a[3]), 60, 420);
  scene.add(new T.HemisphereLight(hex(a[1]), 0x1a1c21, 1.1));
  const sun = new T.DirectionalLight(hex(a[0]), 2.2); sun.position.set(-60, 120, 40); scene.add(sun);
  const roadMat = new T.MeshStandardMaterial({ color: 0x2c3039, roughness: 0.85, metalness: 0.2, flatShading: true, side: T.DoubleSide });
  const road = new T.Mesh(roadGeometry(T, track), roadMat); scene.add(road); disposables.push(road.geometry, roadMat);
  const propMat = new T.MeshStandardMaterial({ color: hex(a[2]), flatShading: true }), starMat = new T.MeshStandardMaterial({ color: 0xffd02e, emissive: 0x6a4a00, flatShading: true });
  const box = new T.BoxGeometry(1, 1, 1), oct = new T.OctahedronGeometry(0.6);
  disposables.push(propMat, starMat, box, oct);
  const props = track.props.map(p => { const m = new T.Mesh(box, propMat); m.position.set(p.x, p.y + 0.5, p.z); scene.add(m); return m; });
  const stars = spec.stars.map(s => { const m = new T.Mesh(oct, starMat); const w = VROOM.sim.toWorld(track, s.s, s.d, s.h); m.position.set(w[0], w[1], w[2]); scene.add(m); return m; });
  return {
    scene, props, stars, sun,
    update(st, dt, t, camera) {
      stars.forEach((m, i) => { m.visible = !st.stars[i]; m.rotation.y = t * 3; });
      st.props.forEach((p, i) => { props[i].visible = p.alive; });
    },
    onEvent(ev, st) {},
    dispose() { disposables.forEach(d => d.dispose()); },
  };
}
function backdrop(ctx, w) {
  const T = ctx.THREE, a = accent(w), scene = new T.Scene();
  scene.background = new T.Color(hex(a[3]));
  scene.fog = new T.Fog(hex(a[3]), 20, 120);
  scene.add(new T.HemisphereLight(hex(a[1]), 0x0d0e12, 1.3));
  const mat = new T.MeshStandardMaterial({ color: 0x1a1c21, flatShading: true }), geo = new T.BoxGeometry(1, 1, 1);
  for (let i = 0; i < 24; i++) {
    const m = new T.Mesh(geo, mat), h = 4 + VROOM.dmath.hash01(i, w) * 18;
    m.scale.set(4, h, 4); m.position.set((i - 12) * 7, h / 2, -40 - VROOM.dmath.hash01(i, w, 3) * 30); scene.add(m);
  }
  const camera = new T.PerspectiveCamera(50, 1200 / 700, 0.1, 400); camera.position.set(0, 6, 20);
  return {
    scene, camera,
    update(dt, t) { camera.position.x = Math.sin(t * 0.1) * 6; camera.lookAt(0, 6, -40); },
    dispose() { mat.dispose(); geo.dispose(); },
  };
}

VROOM.worlds = { buildWorld, backdrop, accent, icon };
