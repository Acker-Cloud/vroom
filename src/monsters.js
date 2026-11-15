/* monsters: creature and boss meshes and their animation. Owner: monsters.
   build(ctx, kind) -> MonsterRig { group, update(actorState, dt, t), onEvent(what), dispose() }
   group: origin on the ground under the creature, +z faces its travel. game.js sets group.position from
   actor x, y, z and group.rotation.y from actor.yaw, then calls update(), which poses the pivots from
   actor.state / stateT / phase and draws the telegraphs (impact ring, sweep stripe, diver shadow) at
   the world points monsters.sim.js publishes (actor.mx/my/mz, actor.gy, actor.ax/ay/az).

   Look (docs/OVERHAUL.md section 4): original designs only, chunky low-poly, flat shaded, big readable
   heads, eyes glowing in the world accent, a strong silhouette per kind, scary-fun and never gory.
   Every kind is a blueprint of named pivots (body, head, jaw, legs, arms, wings, tail, ...) whose
   shapes merge into one vertex-coloured mesh per pivot plus one unlit glow mesh, so a creature costs a
   handful of draw calls. Long bodies (worms, serpents, tentacles, tethers) are one InstancedMesh.
   Geometry is cached per kind in ctx.cache; a rig owns only its materials. Decorative motion (idle
   breathing, sway, tremble, dust rings) is off under ctx.reducedMotion; gameplay poses stay.

   Also registers the dev scene 'dev:monsters-zoo' (?scene=dev:monsters-zoo [&w=N] [&kind=id] [&state=s]):
   the roster on a turntable floor, cycling states, for previews and screenshots. */

const ACC = {
  1: ['#fff2a8', '#ffb02e', '#ff5a1a', '#b3200f'], 2: ['#fff0c8', '#ffb35c', '#e8642a', '#8a2a10'], 3: ['#f0e0ff', '#ff4fd8', '#8a4dff', '#2a1070'],
  4: ['#e0f6ff', '#8fd8ff', '#2e8ac8', '#0e3a66'], 5: ['#ffffff', '#bff2ff', '#4cc3f0', '#145a86'], 6: ['#fff6d0', '#ffd36b', '#e0a030', '#7a4a10'],
  7: ['#e0fff6', '#6bffd8', '#2ec2a8', '#0e4f46'], 8: ['#e8e0ff', '#a88cff', '#5a4dff', '#1a1060'], 9: ['#fff2a8', '#ffb02e', '#ff3a0a', '#8a1000'],
  10: ['#fff0f8', '#ff9ad0', '#c84fa0', '#5a1040'], 11: ['#e0fff6', '#6bffd8', '#2ec2c8', '#0e3f66'], 12: ['#fffbe0', '#ffe27a', '#c8b4ff', '#3a2a80'],
};
function accent(w) {
  try { const a = VROOM.worlds && VROOM.worlds.accent && VROOM.worlds.accent(w); if (a && a.length === 4) return a; } catch (e) { /* worlds not ready: use the bible's table */ }
  return ACC[w] || ACC[1];
}
const hex = s => parseInt(String(s).replace('#', ''), 16);

/* shared materials palette (sRGB hex) */
const SOOT = 0x16171b, IRON = 0x3b3f47, GUN = 0x2c3039, STEEL = 0x858c97, CHROME = 0xc7ccd5, RUST = 0x8a3b12, RUSTHI = 0xc2561c,
  BONE = 0xd8cdb0, BONED = 0x8f8268, HAZ = 0xf2b705, TEETH = 0xeee6cf, BLACK = 0x0c0c0f;

/* ---------- blueprint kit: shapes are data until realize() turns them into merged geometry ---------- */
function shape(L, t, a, c, x, y, z, rx, ry, rz, sx, sy, sz) {
  L.push({ t, a, c, p: [x || 0, y || 0, z || 0], r: [rx || 0, ry || 0, rz || 0], s: [sx || 1, sy || 1, sz || 1] });
}
const box = (L, w, h, d, c, x, y, z, rx, ry, rz) => shape(L, 'box', [w, h, d], c, x, y, z, rx, ry, rz);
const cyl = (L, rt, rb, h, seg, c, x, y, z, rx, ry, rz) => shape(L, 'cyl', [rt, rb, h, seg], c, x, y, z, rx, ry, rz);
const cone = (L, r, h, seg, c, x, y, z, rx, ry, rz) => shape(L, 'cone', [r, h, seg], c, x, y, z, rx, ry, rz);
const blob = (L, t, r, c, x, y, z, sx, sy, sz, rx, ry, rz) => shape(L, t, [r], c, x, y, z, rx, ry, rz, sx, sy, sz);
const tor = (L, R, tb, rs, ts, c, x, y, z, rx, ry, rz, arc) => shape(L, 'tor', [R, tb, rs, ts, arc || Math.PI * 2], c, x, y, z, rx, ry, rz);
const sym = f => { f(1); f(-1); };
/* a glowing eye with a dark socket behind it */
function eye(p, r, x, y, z, col, sock) { r *= 1.5; blob(p.solid, 'oct', r * 1.45, sock === undefined ? SOOT : sock, x, y, z - r * 0.35, 1, 1, 0.7); blob(p.glow, 'oct', r, col, x, y, z, 1, 1, 0.8); }
function teeth(L, n, w, y, z, h, col, down, r) {   /* a row of cone teeth across x */
  for (let k = 0; k < n; k++) { const x = -w / 2 + (k + 0.5) * w / n; cone(L, r || h * 0.35, h, 4, col || TEETH, x, y, z, down ? Math.PI : 0, 0, 0); }
}
/* a striped sphere from stacked frusta: band k spans an equal height slice of a radius R ball */
function candyBall(L, R, bands, y, z) {
  const n = bands.length, h = 2 * R / n, rAt = v => Math.sqrt(Math.max(0.0001, R * R - v * v));
  for (let k = 0; k < n; k++) { const y0 = -R + k * h, y1 = y0 + h; cyl(L, Math.max(0.15, rAt(y1)), Math.max(0.15, rAt(y0)), h, 12, bands[k], 0, y + (y0 + y1) / 2, z); }
}
function blueprint(fn, pal) {
  const B = { parts: [], chain: null, flags: {} };
  const api = {
    part(name, parent, x, y, z) { const p = { name, parent: parent || null, pos: [x || 0, y || 0, z || 0], solid: [], glow: [] }; B.parts.push(p); return p; },
    chain(o) { B.chain = { solid: [], glow: [], n: 8, sp: 1, taper: 0.5, mode: 'trail', at: [0, 1, -1], amp: 0.5, ampY: 0.3, w: 3, arms: 1, ...o }; return B.chain; },
    flag(k, v) { B.flags[k] = v; },
  };
  fn(api, pal);
  return B;
}
function hashf(a, b) { let x = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263)) >>> 0; x = Math.imul(x ^ (x >>> 13), 1274126177) >>> 0; return ((x ^ (x >>> 16)) >>> 0) / 4294967296; }
function geomOf(T, it) {
  const a = it.a;
  switch (it.t) {
    case 'box': return new T.BoxGeometry(a[0], a[1], a[2]);
    case 'cyl': return new T.CylinderGeometry(a[0], a[1], a[2], a[3]);
    case 'cone': return new T.ConeGeometry(a[0], a[1], a[2]);
    case 'ico': return new T.IcosahedronGeometry(a[0], 0);
    case 'ico1': return new T.IcosahedronGeometry(a[0], 1);
    case 'dod': return new T.DodecahedronGeometry(a[0], 0);
    case 'oct': return new T.OctahedronGeometry(a[0], 0);
    case 'tet': return new T.TetrahedronGeometry(a[0], 0);
    case 'sph': return new T.SphereGeometry(a[0], 8, 6);
    case 'tor': return new T.TorusGeometry(a[0], a[1], a[2], a[3], a[4]);
    default: return new T.BoxGeometry(0.1, 0.1, 0.1);
  }
}
/* merge shapes into one non-indexed geometry with per-face colour jitter (the grimy faceted look) */
function merge(T, items, seed, jitter) {
  if (!items.length) return null;
  const pos = [], col = [], m = new T.Matrix4(), q = new T.Quaternion(), e = new T.Euler(), c = new T.Color(), v = new T.Vector3(), sc = new T.Vector3();
  let tri = 0;
  for (const it of items) {
    const g0 = geomOf(T, it), g = g0.index ? g0.toNonIndexed() : g0;
    m.compose(v.set(it.p[0], it.p[1], it.p[2]), q.setFromEuler(e.set(it.r[0], it.r[1], it.r[2])), sc.set(it.s[0], it.s[1], it.s[2]));
    g.applyMatrix4(m);
    const P = g.attributes.position.array;
    c.setHex(it.c);
    for (let i = 0; i < P.length; i += 9, tri++) {
      const f = jitter ? 0.8 + 0.34 * hashf(tri, seed) : 1;
      for (let k = 0; k < 9; k++) pos.push(P[i + k]);
      for (let k = 0; k < 3; k++) col.push(c.r * f, c.g * f, c.b * f);
    }
    if (g !== g0) g.dispose();
    g0.dispose();
  }
  const out = new T.BufferGeometry();
  out.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
  out.setAttribute('color', new T.Float32BufferAttribute(col, 3));
  out.computeVertexNormals();
  out.computeBoundingSphere();
  return out;
}
function realize(T, kind, B) {
  const seed = [...kind].reduce((h, ch) => Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0, 2166136261);
  const k = B.flags.scale || 1, sc = g => { if (g && k !== 1) { g.scale(k, k, k); g.computeBoundingSphere(); } return g; };
  const parts = B.parts.map((p, i) => ({ name: p.name, parent: p.parent, pos: p.pos.map(v => v * k), solid: sc(merge(T, p.solid, seed + i, true)), glow: sc(merge(T, p.glow, seed + i, false)) }));
  const chain = B.chain ? { ...B.chain, sp: B.chain.sp * k, at: B.chain.at.map(v => v * k), solidG: sc(merge(T, B.chain.solid, seed + 99, true)), glowG: sc(merge(T, B.chain.glow, seed + 98, false)) } : null;
  return { parts, chain, flags: B.flags };
}

/* ---------- the roster: every design is our own ---------- */
const D = {};

/* 1 Scrapyard Foundry */
D.rivetrat = (B, A) => {   /* a scrap rat: riveted rust-plate hunch, sheet-metal ears, chain tail */
  B.flag('scale', 1.3);
  const b = B.part('body', null, 0, 0.32, 0);
  box(b.solid, 0.46, 0.32, 0.72, RUST, 0, 0, 0);
  box(b.solid, 0.4, 0.14, 0.5, RUSTHI, 0, 0.2, -0.04, -0.25);
  sym(s => { box(b.solid, 0.06, 0.06, 0.06, STEEL, s * 0.2, 0.12, 0.22); box(b.solid, 0.06, 0.06, 0.06, STEEL, s * 0.2, 0.12, -0.2); });
  cone(b.solid, 0.18, 0.42, 5, IRON, 0, 0.02, 0.52, Math.PI / 2);
  blob(b.solid, 'oct', 0.07, SOOT, 0, 0.0, 0.74);
  sym(s => { box(b.solid, 0.03, 0.22, 0.16, STEEL, s * 0.15, 0.24, 0.3, 0, 0, s * 0.5); box(b.solid, 0.08, 0.26, 0.1, IRON, s * 0.18, -0.2, 0.24); box(b.solid, 0.08, 0.26, 0.1, IRON, s * 0.18, -0.2, -0.24); });
  sym(s => eye(b, 0.045, s * 0.09, 0.1, 0.5, hex(A[1])));
  const t = B.part('tail', 'body', 0, 0.02, -0.36);
  for (let k = 0; k < 4; k++) tor(t.solid, 0.06, 0.02, 3, 6, k % 2 ? STEEL : IRON, 0, 0, -0.08 - k * 0.11, 0, k % 2 ? Math.PI / 2 : 0, 0);
  B.flag('legsIn', true);
};
D.magnetmaw = (B, A) => {   /* junk golem: crushed-car torso, a hunched head, a horseshoe electromagnet for a maw */
  const b = B.part('body', null, 0, 1.25, 0);
  box(b.solid, 1.7, 0.8, 1.15, 0x7a2a24, 0, 0, 0, 0, 0.12, 0.05);
  box(b.solid, 1.5, 0.7, 1.05, 0x2e6b6b, 0.05, 0.7, -0.1, 0.12, -0.18, -0.06);
  sym(s => { box(b.solid, 0.35, 0.3, 0.12, SOOT, s * 0.4, 0.05, 0.6); cyl(b.solid, 0.13, 0.13, 0.32, 6, STEEL, s * 0.85, 0.35, 0, 0, 0, Math.PI / 2); box(b.solid, 0.55, 0.5, 0.55, 0x8b7a2a, s * 0.95, 1.05, -0.1, 0.2, 0, s * 0.3); });
  box(b.solid, 1.6, 0.14, 0.12, HAZ, 0, 0.36, 0.6);
  box(b.glow, 1.0, 0.07, 0.05, hex(A[2]), 0, -0.2, 0.6);
  const h = B.part('head', 'body', 0, 1.15, 0.45);
  box(h.solid, 1.1, 0.6, 0.85, IRON, 0, 0.15, 0.15);
  box(h.solid, 1.25, 0.2, 0.95, HAZ, 0, 0.5, 0.18, 0.12);
  for (let k = 0; k < 5; k++) box(h.solid, 0.12, 0.22, 0.97, SOOT, -0.5 + k * 0.25, 0.5, 0.18, 0.12, 0, 0.6);
  sym(s => eye(h, 0.12, s * 0.28, 0.17, 0.62, hex(A[0])));
  const j = B.part('jaw', 'head', 0, -0.15, 0.45);
  tor(j.solid, 0.6, 0.2, 5, 12, 0xb3200f, 0, 0, 0.35, -Math.PI / 2, 0, Math.PI, Math.PI);
  sym(s => box(j.solid, 0.36, 0.36, 0.42, CHROME, s * 0.6, 0, 0.42));
  tor(j.glow, 0.6, 0.23, 4, 12, hex(A[1]), 0, 0, 0.35, -Math.PI / 2, 0, Math.PI + 0.9, Math.PI - 1.8);
  sym(s => blob(j.glow, 'oct', 0.13, hex(A[0]), s * 0.6, 0, 0.7));
  sym(s => {
    const a = B.part(s > 0 ? 'armL' : 'armR', 'body', s * 1.05, 0.65, 0);
    box(a.solid, 0.4, 1.25, 0.4, IRON, 0, -0.5, 0, 0, 0, s * 0.1);
    box(a.solid, 0.65, 0.55, 0.65, 0x5a5f66, s * 0.05, -1.2, 0.05);
    cone(a.solid, 0.11, 0.3, 4, RUSTHI, s * 0.2, -1.4, 0.3, Math.PI / 2);
    const l = B.part(s > 0 ? 'legL' : 'legR', null, s * 0.48, 0.9, 0);
    box(l.solid, 0.55, 0.9, 0.65, 0x4a4e56, 0, -0.45, 0);
    box(l.solid, 0.7, 0.2, 0.85, SOOT, 0, -0.85, 0.08);
  });
};
D.slagcolossus = (B, A) => {   /* crane-armed scrap giant: furnace chest, ladle of slag, crane boom and hook */
  const b = B.part('body', null, 0, 4.4, 0);
  cyl(b.solid, 1.7, 1.4, 3.0, 8, RUST, 0, 0.6, 0);
  cyl(b.solid, 1.85, 1.85, 0.35, 8, IRON, 0, -0.9, 0);
  cyl(b.solid, 1.8, 1.7, 0.3, 8, IRON, 0, 2.05, 0);
  box(b.solid, 1.5, 1.1, 0.5, SOOT, 0, 0.7, 1.4);
  box(b.glow, 1.2, 0.85, 0.2, hex(A[2]), 0, 0.7, 1.55);
  for (let k = 0; k < 4; k++) box(b.solid, 0.12, 1.0, 0.12, STEEL, -0.45 + k * 0.3, 0.7, 1.68);
  sym(s => { cyl(b.solid, 0.28, 0.32, 1.6, 6, IRON, s * 1.0, 2.8, -0.7); cyl(b.glow, 0.24, 0.24, 0.1, 6, hex(A[1]), s * 1.0, 3.62, -0.7); });
  box(b.solid, 3.2, 0.5, 0.5, HAZ, 0, -0.6, 1.3, 0, 0, 0);
  for (let k = 0; k < 6; k++) box(b.solid, 0.25, 0.52, 0.52, SOOT, -1.25 + k * 0.5, -0.6, 1.31, 0, 0, 0.6);
  const h = B.part('head', 'body', 0, 2.35, 0.4);
  box(h.solid, 1.3, 0.9, 1.1, IRON, 0, 0.4, 0);
  box(h.solid, 1.4, 0.2, 1.2, HAZ, 0, 0.92, 0);
  box(h.glow, 1.0, 0.18, 0.05, hex(A[1]), 0, 0.45, 0.56);
  cone(h.solid, 0.12, 0.6, 4, STEEL, 0.5, 1.2, -0.2);
  const j = B.part('jaw', 'head', 0, 0.05, 0.2);
  box(j.solid, 1.2, 0.25, 0.8, GUN, 0, -0.1, 0.1);
  teeth(j.solid, 5, 1.0, 0.1, 0.45, 0.25, STEEL);
  const aL = B.part('armL', 'body', 2.0, 1.6, 0);   /* the ladle */
  box(aL.solid, 0.7, 0.7, 0.7, IRON, 0, 0, 0);
  box(aL.solid, 0.5, 2.6, 0.5, RUST, 0.2, -1.4, 0, 0, 0, 0.15);
  cyl(aL.solid, 0.95, 0.65, 0.9, 8, 0x4a4e56, 0.45, -3.0, 0.3);
  cyl(aL.glow, 0.85, 0.85, 0.12, 8, hex(A[1]), 0.45, -2.58, 0.3);
  cone(aL.glow, 0.2, 0.9, 5, hex(A[2]), 1.3, -3.2, 0.3, Math.PI);
  const aR = B.part('armR', 'body', -2.0, 1.6, 0);   /* the crane boom */
  box(aR.solid, 0.8, 0.8, 0.8, IRON, 0, 0, 0);
  box(aR.solid, 0.3, 3.4, 0.3, HAZ, -0.35, -1.8, 0.25, 0, 0, -0.08);
  box(aR.solid, 0.3, 3.4, 0.3, HAZ, -0.35, -1.8, -0.25, 0, 0, -0.08);
  for (let k = 0; k < 5; k++) box(aR.solid, 0.08, 0.7, 0.08, SOOT, -0.35 - k * 0.02, -0.6 - k * 0.65, 0, 0.9, 0, 0);
  box(aR.solid, 0.06, 1.2, 0.06, STEEL, -0.6, -3.9, 0);
  tor(aR.solid, 0.35, 0.1, 4, 8, CHROME, -0.6, -4.6, 0, 0, Math.PI / 2, 0, Math.PI * 1.4);
  sym(s => {
    const l = B.part(s > 0 ? 'legL' : 'legR', null, s * 1.0, 3.5, 0);
    cyl(l.solid, 0.65, 0.8, 2.4, 7, IRON, 0, -1.4, 0);
    box(l.solid, 1.0, 0.5, 0.9, RUSTHI, 0, -1.0, 0.45, 0.3);
    box(l.solid, 1.4, 0.7, 2.0, SOOT, 0, -3.15, 0.3);
    box(l.solid, 1.45, 0.18, 2.05, HAZ, 0, -2.75, 0.3);
  });
};

/* 2 Ember Canyon */
D.duskvulture = (B, A) => {   /* bone bird: skull with a long hooked beak, rib cage, ragged leather wings */
  B.flag('scale', 1.5);
  const b = B.part('body', null, 0, 0.7, 0);
  blob(b.solid, 'ico', 0.4, 0x3d1a14, 0, 0, 0, 0.9, 0.8, 1.4);
  for (let k = 0; k < 4; k++) tor(b.solid, 0.34 - k * 0.03, 0.03, 3, 8, BONE, 0, -0.02, 0.25 - k * 0.15, 0, 0, Math.PI / 2, Math.PI);
  cone(b.solid, 0.25, 0.7, 4, 0x2a120e, 0, 0.05, -0.75, -Math.PI / 2);
  const h = B.part('head', 'body', 0, 0.25, 0.55);
  box(h.solid, 0.34, 0.34, 0.4, BONE, 0, 0, 0);
  cone(h.solid, 0.12, 0.6, 4, BONED, 0, -0.05, 0.45, Math.PI / 2 + 0.25);
  cone(h.solid, 0.12, 0.3, 4, 0x3d1a14, 0, 0.18, -0.15, -0.6);
  sym(s => eye(h, 0.06, s * 0.12, 0.05, 0.19, hex(A[1])));
  sym(s => {
    const w = B.part(s > 0 ? 'wingL' : 'wingR', 'body', s * 0.3, 0.1, 0);
    box(w.solid, 0.05, 0.05, 0.05, BONE, 0, 0, 0);
    box(w.solid, 1.3, 0.06, 0.08, BONE, s * 0.65, 0.02, 0.15);
    box(w.solid, 1.3, 0.04, 0.7, 0x5a2218, s * 0.7, 0, -0.2);
    box(w.solid, 0.9, 0.04, 0.55, 0x3d1a14, s * 1.55, -0.02, -0.15, 0, s * -0.2, 0);
    for (let k = 0; k < 3; k++) box(w.solid, 0.2, 0.03, 0.5, 0x2a120e, s * (1.0 + k * 0.4), -0.01, -0.62);
  });
};
D.cliffjaw = (B, A) => {   /* rock-skinned lizard: slab-plated back, broad shovel head */
  B.flag('scale', 1.3);
  const b = B.part('body', null, 0, 0.6, 0);
  box(b.solid, 1.0, 0.55, 2.0, 0x7a3f26, 0, 0, 0);
  for (let k = 0; k < 5; k++) blob(b.solid, 'dod', 0.32 - k * 0.02, k % 2 ? 0x5a3020 : 0x8f5636, 0, 0.32, 0.7 - k * 0.38, 1.2, 0.6, 1);
  box(b.glow, 0.08, 0.06, 1.6, hex(A[2]), 0, 0.55, -0.1);
  const h = B.part('head', 'body', 0, 0.05, 1.05);
  box(h.solid, 1.1, 0.35, 0.8, 0x8f5636, 0, 0.12, 0.3);
  blob(h.solid, 'dod', 0.22, 0x5a3020, 0, 0.32, 0.1, 1.6, 0.6, 1);
  sym(s => { eye(h, 0.07, s * 0.4, 0.3, 0.45, hex(A[1])); cone(h.solid, 0.08, 0.3, 4, BONE, s * 0.48, 0.38, 0.05, -0.5); });
  const j = B.part('jaw', 'head', 0, -0.08, 0.05);
  box(j.solid, 1.0, 0.18, 0.75, 0x6a3420, 0, -0.05, 0.3);
  teeth(j.solid, 6, 0.9, 0.08, 0.62, 0.14, TEETH);
  const t = B.part('tail', 'body', 0, 0, -1.0);
  cone(t.solid, 0.35, 1.6, 5, 0x7a3f26, 0, 0, -0.75, -Math.PI / 2);
  for (const [nm, z] of [['legF', 0.6], ['legB', -0.6]]) {
    const l = B.part(nm, 'body', 0, -0.15, z);
    sym(s => { box(l.solid, 0.5, 0.18, 0.22, 0x6a3420, s * 0.65, 0, 0); box(l.solid, 0.2, 0.4, 0.22, 0x5a3020, s * 0.85, -0.25, 0.05); });
  }
};
D.duskback = (B, A) => {   /* canyon-sized armoured beast: banded plate shell, horned brow, club tail; curls to roll */
  const b = B.part('body', null, 0, 3.2, 0);
  blob(b.solid, 'ico1', 2.9, 0x5a2c1c, 0, 0, 0, 1.05, 0.95, 1.15);
  for (let k = 0; k < 6; k++) tor(b.solid, 2.85, 0.22, 4, 14, k % 2 ? 0x8a4a2c : 0x3a1c12, 0, 0, -2.0 + k * 0.8, 0, 0, 0);
  for (let k = 0; k < 6; k++) cone(b.solid, 0.35, 1.1, 4, BONE, 0, 3.0, -2.0 + k * 0.8);
  sym(s => { for (let k = 0; k < 3; k++) cone(b.solid, 0.25, 0.8, 4, BONED, s * 2.2, 2.0, -1.2 + k * 1.2, 0, 0, s * -0.9); });
  for (let k = 0; k < 3; k++) box(b.glow, 0.1, 0.1, 1.2, hex(A[2]), 0, 2.95, -1.6 + k * 1.6);
  const h = B.part('head', 'body', 0, -0.6, 2.7);
  box(h.solid, 2.2, 1.4, 1.4, 0x6e3a22, 0, 0, 0.3);
  box(h.solid, 2.4, 0.5, 1.5, 0x3a1c12, 0, 0.75, 0.25);
  sym(s => { cone(h.solid, 0.3, 1.6, 5, BONE, s * 1.15, 1.2, 0.4, -0.5, 0, s * -0.6); eye(h, 0.18, s * 0.6, 0.35, 1.02, hex(A[1])); });
  const j = B.part('jaw', 'head', 0, -0.5, 0.4);
  box(j.solid, 1.9, 0.45, 1.1, 0x5a2c1c, 0, -0.1, 0.3);
  teeth(j.solid, 6, 1.6, 0.2, 0.8, 0.35, TEETH);
  const t = B.part('tail', 'body', 0, -0.8, -3.0);
  cone(t.solid, 0.7, 2.4, 6, 0x5a2c1c, 0, 0, -1.0, -Math.PI / 2);
  blob(t.solid, 'dod', 0.85, 0x3a1c12, 0, 0, -2.3);
  for (const [nm, z] of [['legF', 1.6], ['legB', -1.6]]) {
    const l = B.part(nm, null, 0, 1.6, z);
    sym(s => { box(l.solid, 0.9, 1.7, 1.0, 0x3a1c12, s * 1.9, -0.8, 0); box(l.solid, 1.0, 0.35, 1.3, BONED, s * 1.9, -1.55, 0.15); });
  }
  B.flag('roller', true);
};

/* 3 Neon Necropolis */
D.grabber = (B, A) => {   /* a long grey arm from a manhole: neon veins, three hooked fingers */
  const b = B.part('body', null, 0, 0.3, 0);
  box(b.solid, 0.6, 0.45, 0.5, 0x4a4652, 0, 0, 0);
  box(b.glow, 0.06, 0.5, 0.06, hex(A[1]), 0.15, -0.05, 0.26);
  const j = B.part('jaw', 'body', 0, 0.2, 0);
  for (let k = 0; k < 3; k++) {
    const a = -0.5 + k * 0.5;
    box(j.solid, 0.12, 0.7, 0.14, 0x5a5664, Math.sin(a) * 0.25, 0.35, Math.cos(a) * 0.12, 0.25, 0, -a * 0.5);
    cone(j.solid, 0.08, 0.3, 4, BLACK, Math.sin(a) * 0.32, 0.82, Math.cos(a) * 0.22, 0.6);
  }
  const g = B.part('ground', null, 0, 0, 0);
  cyl(g.solid, 0.95, 0.95, 0.1, 10, IRON, 0, 0.05, 0);
  for (let k = 0; k < 3; k++) box(g.solid, 1.5, 0.12, 0.08, SOOT, 0, 0.11, -0.4 + k * 0.4);
  tor(g.glow, 0.98, 0.06, 3, 12, hex(A[1]), 0, 0.06, 0, Math.PI / 2, 0, 0);
  const c = B.chain({ mode: 'arm', n: 7, sp: 0.55, taper: 0.25, at: [0, 0, 0] });
  cyl(c.solid, 0.22, 0.26, 0.6, 6, 0x4a4652, 0, 0, 0, Math.PI / 2, 0, 0);
  tor(c.solid, 0.25, 0.05, 3, 6, 0x5a5664, 0, 0, 0.25);
  box(c.glow, 0.05, 0.05, 0.55, hex(A[1]), 0.2, 0.05, 0);
};
D.neonhound = (B, A) => {   /* skeletal hound: glowing tube ribs, a visor slit for eyes */
  B.flag('scale', 1.35);
  const b = B.part('body', null, 0, 0.85, 0);
  box(b.solid, 0.45, 0.4, 1.3, 0x22202a, 0, 0, 0);
  for (let k = 0; k < 5; k++) sym(s => box(b.glow, 0.04, 0.32, 0.05, hex(A[1]), s * 0.24, -0.02, 0.4 - k * 0.2, 0, 0, s * 0.2));
  for (let k = 0; k < 5; k++) cone(b.solid, 0.06, 0.25, 4, STEEL, 0, 0.28, 0.45 - k * 0.22);
  const h = B.part('head', 'body', 0, 0.2, 0.72);
  box(h.solid, 0.34, 0.32, 0.4, 0x2c2a36, 0, 0, 0);
  box(h.solid, 0.24, 0.2, 0.42, 0x2c2a36, 0, -0.06, 0.36);
  box(h.glow, 0.36, 0.06, 0.05, hex(A[0]), 0, 0.06, 0.21);
  sym(s => cone(h.solid, 0.08, 0.3, 4, 0x2c2a36, s * 0.12, 0.26, -0.08, -0.3));
  tor(h.solid, 0.22, 0.04, 3, 8, CHROME, 0, -0.04, -0.18, 0, 0, 0);
  const j = B.part('jaw', 'head', 0, -0.14, 0.15);
  box(j.solid, 0.22, 0.08, 0.42, 0x1a1820, 0, 0, 0.18);
  teeth(j.solid, 4, 0.18, 0.06, 0.36, 0.08, TEETH);
  const t = B.part('tail', 'body', 0, 0.12, -0.65);
  box(t.solid, 0.06, 0.06, 0.6, 0x22202a, 0, 0.1, -0.28, 0.5);
  box(t.glow, 0.05, 0.05, 0.12, hex(A[1]), 0, 0.26, -0.55, 0.5);
  for (const [nm, z] of [['legF', 0.45], ['legB', -0.45]]) {
    const l = B.part(nm, 'body', 0, -0.1, z);
    sym(s => { box(l.solid, 0.1, 0.75, 0.12, 0x1a1820, s * 0.17, -0.4, 0); box(l.solid, 0.14, 0.06, 0.2, STEEL, s * 0.17, -0.77, 0.04); });
  }
};
D.lampmoth = (B, A) => {   /* giant moth: furred thorax, compound eyes, plumed antennae, eye-spot wings */
  const b = B.part('body', null, 0, 3.0, 0);
  blob(b.solid, 'ico', 0.9, 0x3a2e3c, 0, 0, 0.2, 1, 1, 1.2);
  for (let k = 0; k < 4; k++) blob(b.solid, 'ico', 0.75 - k * 0.12, k % 2 ? 0x4a3a46 : 0x2a2030, 0, -0.1 - k * 0.05, -0.9 - k * 0.55, 1, 0.9, 0.8);
  for (let k = 0; k < 3; k++) tor(b.glow, 0.6 - k * 0.12, 0.05, 3, 10, hex(A[2]), 0, -0.1, -1.1 - k * 0.55, 0, 0, 0);
  sym(s => { for (let k = 0; k < 3; k++) box(b.solid, 0.06, 1.0, 0.06, SOOT, s * 0.5, -0.8, 0.5 - k * 0.35, 0, 0, s * 0.4); });
  const h = B.part('head', 'body', 0, 0.2, 1.2);
  blob(h.solid, 'ico', 0.55, 0x2a2030, 0, 0, 0);
  sym(s => { blob(h.glow, 'ico', 0.36, hex(A[1]), s * 0.42, 0.05, 0.25, 0.9, 1.1, 0.9); });
  sym(s => { box(h.solid, 0.05, 1.3, 0.05, BONED, s * 0.3, 0.9, 0.3, 0.5, 0, s * -0.5); for (let k = 0; k < 4; k++) box(h.solid, 0.4 - k * 0.06, 0.03, 0.14, BONED, s * (0.42 + k * 0.1), 0.7 + k * 0.22, 0.55 + k * 0.12, 0.5, 0, s * -0.5); });
  sym(s => {
    const w = B.part(s > 0 ? 'wingL' : 'wingR', 'body', s * 0.6, 0.35, 0.2);
    box(w.solid, 3.6, 0.07, 2.4, 0x5a4458, s * 1.9, 0, 0.6, 0, s * 0.2, 0);
    box(w.solid, 2.6, 0.06, 1.9, 0x3a2a3c, s * 1.5, -0.04, -1.3, 0, s * -0.35, 0);
    box(w.solid, 3.4, 0.08, 0.14, 0x1a141c, s * 1.9, 0.03, 1.7, 0, s * 0.2, 0);
    tor(w.glow, 0.42, 0.12, 3, 10, hex(A[1]), s * 2.2, 0.06, 0.6, Math.PI / 2, 0, 0);
    blob(w.glow, 'oct', 0.18, hex(A[0]), s * 2.2, 0.06, 0.6, 1, 0.3, 1);
    tor(w.glow, 0.3, 0.09, 3, 10, hex(A[2]), s * 1.7, 0.02, -1.4, Math.PI / 2, 0, 0);
  });
  B.flag('flyer', true);
};

/* 4 Drown Docks */
D.guttereel = (B, A) => {   /* puddle eel: a crested head with an underbite, a long ringed body */
  const b = B.part('body', null, 0, 0.6, 0);
  box(b.solid, 0.7, 0.55, 0.9, 0x24423e, 0, 0, 0.1);
  blob(b.solid, 'oct', 0.32, 0x1a302c, 0, 0.3, -0.05, 1, 0.6, 1.4);
  for (let k = 0; k < 4; k++) cone(b.solid, 0.1, 0.45 - k * 0.07, 4, 0x3e6a5e, 0, 0.45, 0.25 - k * 0.22, -0.4);
  sym(s => eye(b, 0.08, s * 0.3, 0.15, 0.45, hex(A[0])));
  const j = B.part('jaw', 'body', 0, -0.25, 0.1);
  box(j.solid, 0.78, 0.22, 0.95, 0x2e5650, 0, -0.05, 0.2);
  teeth(j.solid, 5, 0.7, 0.12, 0.62, 0.2, TEETH);
  const g = B.part('ground', null, 0, 0, 0);
  cyl(g.solid, 1.3, 1.3, 0.03, 12, 0x0c1a22, 0, 0.02, 0);
  tor(g.glow, 1.25, 0.04, 3, 14, hex(A[2]), 0, 0.04, 0, Math.PI / 2, 0, 0);
  const c = B.chain({ mode: 'rise', n: 7, sp: 0.55, taper: 0.4, at: [0, 0.4, -0.3] });
  cyl(c.solid, 0.32, 0.32, 0.55, 7, 0x24423e, 0, 0, 0, Math.PI / 2, 0, 0);
  cone(c.solid, 0.06, 0.25, 3, 0x3e6a5e, 0, 0.35, 0);
  tor(c.glow, 0.33, 0.03, 3, 8, hex(A[1]), 0, 0, 0, 0, 0, 0);
};
D.docktoad = (B, A) => {   /* bollard-sized toad: barnacle warts, a wide jaw, lamp-bulb eyes */
  const b = B.part('body', null, 0, 1.0, 0);
  blob(b.solid, 'ico1', 1.0, 0x4a5a2a, 0, 0, 0, 1.25, 0.75, 1.15);
  for (let k = 0; k < 9; k++) blob(b.solid, 'ico', 0.14, k % 3 ? 0x6a7a3a : BONED, Math.sin(k * 2.3) * 0.8, 0.45 + (k % 3) * 0.12, Math.cos(k * 2.3) * 0.6);
  for (let k = 0; k < 4; k++) blob(b.glow, 'oct', 0.07, hex(A[1]), Math.sin(k * 1.9 + 1) * 0.7, 0.6, Math.cos(k * 1.9 + 1) * 0.5 - 0.2);
  sym(s => { blob(b.solid, 'ico', 0.3, 0x3a4a22, s * 0.55, 0.7, 0.55); eye(b, 0.17, s * 0.58, 0.82, 0.74, hex(A[0])); });
  box(b.solid, 1.9, 0.08, 0.1, SOOT, 0, -0.08, 1.05, 0, 0, 0);
  const j = B.part('jaw', 'body', 0, -0.25, 0.15);
  blob(j.solid, 'ico', 0.9, 0x6a6a3a, 0, -0.05, 0.25, 1.25, 0.35, 1.0);
  blob(j.glow, 'ico', 0.45, hex(A[2]), 0, -0.25, 0.4, 1.3, 0.5, 1);
  const lf = B.part('legF', 'body', 0, -0.45, 0.6);
  sym(s => box(lf.solid, 0.3, 0.7, 0.3, 0x3a4a22, s * 0.75, -0.2, 0.1, 0.3));
  const lb = B.part('legB', 'body', 0, -0.35, -0.6);
  sym(s => { box(lb.solid, 0.45, 0.4, 1.0, 0x4a5a2a, s * 1.05, 0, 0); box(lb.solid, 0.5, 0.12, 0.7, 0x3a4a22, s * 1.1, -0.35, 0.3); });
};
D.bilgekraken = (B, A) => {   /* bilge kraken: a riveted plate-armoured mantle, lantern eyes, a ring of tentacles */
  const b = B.part('body', null, 0, 2.6, 0);
  blob(b.solid, 'ico1', 1.8, 0x5a2a3a, 0, 1.2, -0.3, 1, 1.5, 1.05);
  for (let k = 0; k < 5; k++) { const a = k * 1.25; box(b.solid, 1.2, 1.4, 0.15, k % 2 ? RUST : IRON, Math.sin(a) * 1.55, 1.6, Math.cos(a) * 1.55 - 0.3, 0.1, a, 0); }
  for (let k = 0; k < 8; k++) blob(b.solid, 'ico', 0.2, BONED, Math.sin(k * 0.8) * 1.6, 2.6 + (k % 2) * 0.4, Math.cos(k * 0.8) * 1.3 - 0.3);
  sym(s => { cyl(b.solid, 0.75, 0.75, 0.3, 10, CHROME, s * 1.35, 0.4, 0.9, 0, 0, Math.PI / 2 + s * 0.4); blob(b.glow, 'ico', 0.55, hex(A[1]), s * 1.42, 0.4, 1.0, 0.6, 1, 1); });
  cone(b.solid, 0.5, 0.9, 5, SOOT, 0, -0.5, 1.4, Math.PI * 0.7);
  const c = B.chain({ mode: 'tentacles', n: 9, sp: 0.7, taper: 0.75, arms: 8, at: [0, -0.4, 0], amp: 0.6 });
  cyl(c.solid, 0.48, 0.48, 0.72, 7, 0x5a2a3a, 0, 0, 0, Math.PI / 2, 0, 0);
  sym(s => blob(c.glow, 'oct', 0.11, hex(A[2]), s * 0.28, -0.36, 0, 1, 0.5, 1));
};

/* 5 Frostbite Pass */
D.icewolf = (B, A) => {   /* frost wolf: shaggy grey hide, a ridge of ice shards, frost breath eyes */
  B.flag('scale', 1.3);
  const b = B.part('body', null, 0, 0.9, 0);
  box(b.solid, 0.6, 0.55, 1.35, 0x8a9aa6, 0, 0, 0);
  blob(b.solid, 'dod', 0.45, 0xb8c6cf, 0, 0.05, 0.45, 1, 0.9, 1);
  for (let k = 0; k < 5; k++) blob(b.glow, 'oct', 0.12, hex(k % 2 ? A[1] : A[2]), 0, 0.38, 0.4 - k * 0.22, 0.6, 2.2 - k * 0.2, 0.6);
  const h = B.part('head', 'body', 0, 0.2, 0.8);
  box(h.solid, 0.42, 0.38, 0.42, 0xb8c6cf, 0, 0, 0);
  box(h.solid, 0.26, 0.2, 0.42, 0x8a9aa6, 0, -0.08, 0.36);
  sym(s => { cone(h.solid, 0.1, 0.3, 4, 0x6a7a86, s * 0.14, 0.32, -0.05); eye(h, 0.05, s * 0.13, 0.08, 0.22, hex(A[0])); });
  const j = B.part('jaw', 'head', 0, -0.16, 0.18);
  box(j.solid, 0.24, 0.08, 0.38, 0x6a7a86, 0, 0, 0.16);
  teeth(j.solid, 4, 0.2, 0.06, 0.32, 0.08, TEETH);
  const t = B.part('tail', 'body', 0, 0.12, -0.7);
  blob(t.solid, 'dod', 0.2, 0xb8c6cf, 0, 0, -0.35, 0.8, 0.8, 2);
  for (const [nm, z] of [['legF', 0.45], ['legB', -0.45]]) {
    const l = B.part(nm, 'body', 0, -0.2, z);
    sym(s => box(l.solid, 0.14, 0.7, 0.16, 0x6a7a86, s * 0.2, -0.35, 0));
  }
};
D.snowbrute = (B, A) => {   /* shaggy brute: a mountain of matted fur, knuckle-walking arms, yellowed tusks */
  const b = B.part('body', null, 0, 1.6, 0);
  blob(b.solid, 'dod', 1.3, 0xd8dee4, 0, 0.3, 0, 1.15, 1.1, 0.95);
  for (let k = 0; k < 10; k++) cone(b.solid, 0.22, 0.6, 4, k % 2 ? 0xc0c8d0 : 0xe8eef2, Math.sin(k * 0.63) * 1.25, 0.3 - (k % 3) * 0.3, Math.cos(k * 0.63) * 1.05, Math.PI + 0.3, k * 0.63, 0);
  box(b.solid, 1.6, 0.6, 0.4, 0x5a6a76, 0, -0.65, 0.5);
  const h = B.part('head', 'body', 0, 1.25, 0.7);
  blob(h.solid, 'dod', 0.5, 0xc0c8d0, 0, 0, 0, 1.2, 0.9, 1);
  box(h.solid, 0.7, 0.3, 0.2, 0x3a4652, 0, 0.0, 0.45);
  sym(s => { eye(h, 0.07, s * 0.2, 0.08, 0.5, hex(A[2])); cone(h.solid, 0.08, 0.4, 4, 0xe0d8b0, s * 0.22, -0.2, 0.5, -0.4); });
  sym(s => {
    const a = B.part(s > 0 ? 'armL' : 'armR', 'body', s * 1.25, 0.6, 0.2);
    box(a.solid, 0.5, 1.5, 0.55, 0xd0d8de, 0, -0.65, 0, 0, 0, s * 0.12);
    blob(a.solid, 'dod', 0.42, 0x8a9aa6, s * 0.1, -1.5, 0.05);
    for (let k = 0; k < 3; k++) cone(a.solid, 0.06, 0.2, 3, BLACK, s * (0.0 + k * 0.1), -1.75, 0.3, Math.PI / 2 + 0.6);
  });
  const lf = B.part('legF', 'body', 0, -0.9, 0);
  sym(s => box(lf.solid, 0.55, 0.7, 0.6, 0xb0bac2, s * 0.55, -0.15, 0));
};
D.glaciergolem = (B, A) => {   /* a walking glacier: crystal plates, a frozen gear and pipe in its chest, a crown of shards */
  const b = B.part('body', null, 0, 4.6, 0);
  blob(b.solid, 'dod', 2.2, 0x9ad0e6, 0, 0.4, 0, 1.05, 1.15, 0.9);
  for (let k = 0; k < 7; k++) blob(b.solid, 'oct', 0.8, k % 2 ? 0xbfe6f4 : 0x6aaecc, Math.sin(k * 0.9) * 1.9, 0.2 + Math.cos(k * 1.7) * 1.1, Math.cos(k * 0.9) * 1.4, 0.7, 1.3, 0.7, 0, k, 0);
  blob(b.glow, 'ico', 1.0, hex(A[2]), 0, 0.3, 0.9, 1, 1.2, 0.6);
  tor(b.solid, 0.75, 0.18, 4, 10, RUST, 0.6, 0.5, 1.75, 0, 0.3, 0);
  cyl(b.solid, 0.22, 0.22, 2.2, 6, IRON, -0.8, 0.2, 1.4, 0, 0, 0.9);
  const h = B.part('head', 'body', 0, 2.5, 0.3);
  blob(h.solid, 'oct', 0.85, 0xbfe6f4, 0, 0, 0, 1.2, 0.8, 1);
  for (let k = 0; k < 6; k++) cone(h.solid, 0.22, 1.0 + (k % 2) * 0.6, 4, 0xe8f8ff, -0.75 + k * 0.3, 0.75, -0.1, -0.2, 0, -0.4 + k * 0.16);
  box(h.solid, 1.1, 0.34, 0.2, 0x145a86, 0, 0.08, 0.8); box(h.glow, 0.95, 0.16, 0.06, hex(A[1]), 0, 0.08, 0.92);
  const j = B.part('jaw', 'head', 0, -0.35, 0.3);
  box(j.solid, 1.0, 0.35, 0.6, 0x6aaecc, 0, -0.1, 0.1);
  sym(s => {
    const a = B.part(s > 0 ? 'armL' : 'armR', 'body', s * 2.3, 1.3, 0);
    blob(a.solid, 'oct', 0.7, 0x6aaecc, 0, 0, 0, 1, 1, 1);
    box(a.solid, 0.8, 2.6, 0.8, 0x9ad0e6, s * 0.2, -1.5, 0.1, 0, 0, s * 0.12);
    blob(a.solid, 'dod', 1.0, 0xbfe6f4, s * 0.35, -3.1, 0.2, 1, 1.1, 1);
    blob(a.glow, 'oct', 0.35, hex(A[2]), s * 0.35, -3.1, 0.95);
    const l = B.part(s > 0 ? 'legL' : 'legR', null, s * 1.1, 3.0, 0);
    box(l.solid, 1.2, 2.8, 1.3, 0x6aaecc, 0, -1.5, 0);
    blob(l.solid, 'oct', 0.9, 0xbfe6f4, 0, -2.6, 0.3, 1.1, 0.6, 1.3);
  });
};

/* 6 Scorch Flats */
D.sandshark = (B, A) => {   /* dune shark: sun-bleached scarred hide, a tall fin that cuts the sand first */
  const b = B.part('body', null, 0, 0.9, 0);
  blob(b.solid, 'oct', 0.85, 0xc8b48a, 0, 0, 0, 0.9, 0.85, 2.3);
  blob(b.solid, 'oct', 0.75, 0xe8dcc0, 0, -0.25, 0.1, 0.85, 0.5, 2.1);
  cone(b.solid, 0.4, 1.3, 4, 0xa8946a, 0, 1.05, -0.3, -0.35);
  sym(s => { cone(b.solid, 0.25, 0.9, 4, 0xa8946a, s * 0.75, -0.25, 0.4, 0.3, 0, s * 1.2); for (let k = 0; k < 3; k++) box(b.solid, 0.03, 0.4, 0.06, SOOT, s * 0.72, 0.05, 0.95 - k * 0.15); });
  sym(s => eye(b, 0.09, s * 0.42, 0.25, 1.35, hex(A[2])));
  box(b.solid, 0.1, 0.4, 0.05, 0x7a5a3a, 0.2, 0.55, 0.3, 0, 0, 0.6);
  const j = B.part('jaw', 'body', 0, -0.35, 1.0);
  box(j.solid, 0.9, 0.2, 0.9, 0xe8dcc0, 0, -0.05, 0.25);
  teeth(j.solid, 6, 0.8, 0.12, 0.62, 0.22, TEETH);
  const t = B.part('tail', 'body', 0, 0, -1.8);
  cone(t.solid, 0.35, 0.9, 4, 0xa8946a, 0, 0.5, -0.2, -0.6);
  cone(t.solid, 0.3, 0.7, 4, 0xa8946a, 0, -0.35, -0.2, -2.4);
  const g = B.part('ground', null, 0, 0, 0);
  for (let k = 0; k < 7; k++) blob(g.solid, 'tet', 0.35, 0xd8b878, Math.sin(k * 0.9) * 1.6, 0.1, Math.cos(k * 0.9) * 1.6, 1, 0.5, 1, 0, k, 0);
};
D.stingtail = (B, A) => {   /* scorpion: banded plates, crusher pincers, a five-joint tail with a molten stinger */
  B.flag('scale', 1.15);
  const b = B.part('body', null, 0, 0.75, 0);
  for (let k = 0; k < 4; k++) box(b.solid, 1.3 - k * 0.1, 0.45, 0.45, k % 2 ? 0x3a2818 : 0x5a3a1e, 0, 0, 0.6 - k * 0.42);
  box(b.solid, 1.0, 0.4, 0.5, 0x2a1a10, 0, 0.05, 0.9);
  sym(s => { eye(b, 0.06, s * 0.15, 0.3, 1.13, hex(A[1])); eye(b, 0.04, s * 0.32, 0.22, 1.1, hex(A[1])); });
  const t = B.part('tail', 'body', 0, 0.2, -0.95);
  for (let k = 0; k < 6; k++) { const a = 0.35 + k * 0.55; box(t.solid, 0.42 - k * 0.04, 0.34, 0.5, k % 2 ? 0x3a2818 : 0x5a3a1e, 0, 0.9 - 0.9 * Math.cos(a), -0.9 * Math.sin(a), a); }
  blob(t.solid, 'ico', 0.3, 0x2a1a10, 0, 1.75, 0.6);
  cone(t.glow, 0.15, 0.7, 5, hex(A[2]), 0, 1.45, 0.95, 2.4);
  sym(s => {
    const a = B.part(s > 0 ? 'armL' : 'armR', 'body', s * 0.6, 0, 1.0);
    box(a.solid, 0.22, 0.22, 0.8, 0x5a3a1e, s * 0.1, 0, 0.35, 0, s * -0.4, 0);
    box(a.solid, 0.45, 0.35, 0.6, 0x3a2818, s * 0.35, 0, 0.9);
    box(a.solid, 0.12, 0.2, 0.55, 0x2a1a10, s * 0.48, 0.05, 1.35, 0, s * 0.3, 0);
    box(a.solid, 0.12, 0.2, 0.5, 0x2a1a10, s * 0.22, 0.05, 1.33, 0, s * -0.3, 0);
  });
  for (const [nm, z] of [['legF', 0.4], ['legB', -0.3]]) {
    const l = B.part(nm, 'body', 0, -0.1, z);
    sym(s => { for (let k = 0; k < 2; k++) { box(l.solid, 0.6, 0.1, 0.1, 0x2a1a10, s * 0.85, 0.05, k * 0.3 - 0.15, 0, 0, s * -0.4); box(l.solid, 0.1, 0.6, 0.1, 0x2a1a10, s * 1.15, -0.4, k * 0.3 - 0.15); } });
  }
};
D.gritmaw = (B, A) => {   /* ringed sand lamprey: a round mouth of inward teeth rings, glowing throat */
  const b = B.part('body', null, 0, 3.0, 0);
  cyl(b.solid, 2.3, 2.1, 2.2, 10, 0xa88a5a, 0, 0, 0, Math.PI / 2, 0, 0);
  tor(b.solid, 2.1, 0.35, 4, 12, 0x6a5232, 0, 0, 1.1);
  for (let r = 0; r < 3; r++) for (let k = 0; k < 10; k++) { const a = k * 0.628 + r * 0.3, R = 1.7 - r * 0.45; cone(b.solid, 0.18, 0.7 - r * 0.12, 4, TEETH, Math.cos(a) * R, Math.sin(a) * R, 1.15 - r * 0.2, Math.PI / 2, 0, a + Math.PI / 2); }
  cyl(b.glow, 0.85, 0.85, 0.1, 10, hex(A[2]), 0, 0, 0.6, Math.PI / 2, 0, 0);
  for (let k = 0; k < 6; k++) { const a = k * 1.047 + 0.5; blob(b.glow, 'oct', 0.14, hex(A[1]), Math.cos(a) * 2.25, Math.sin(a) * 2.25, 0.5); }
  for (let k = 0; k < 6; k++) cone(b.solid, 0.3, 1.1, 4, 0x6a5232, 0, 2.2, -0.6 + k * 0.0, -0.9 + k * 0.3, 0, 0);
  const g = B.part('ground', null, 0, 0, 0);
  for (let k = 0; k < 10; k++) blob(g.solid, 'dod', 0.6, k % 2 ? 0xb8945a : 0x7a6038, Math.sin(k * 0.63) * 3.1, 0.1, Math.cos(k * 0.63) * 3.1, 1, 0.45, 1);
  const c = B.chain({ mode: 'hump', n: 10, sp: 1.9, taper: 0.35, at: [0, 0, -1.2], amp: 0.6, ampY: 1.0 });
  cyl(c.solid, 2.0, 2.0, 1.8, 10, 0xa88a5a, 0, 0, 0, Math.PI / 2, 0, 0);
  tor(c.solid, 2.0, 0.22, 3, 12, 0x6a5232, 0, 0, 0.85);
  cone(c.solid, 0.25, 0.7, 4, 0x6a5232, 0, 2.1, 0);
};

/* 7 Wreck Cove */
D.hermittank = (B, A) => {   /* hermit crab in a rusted oil drum: one crusher claw, stalk eyes */
  B.flag('scale', 1.15);
  const b = B.part('body', null, 0, 0.95, -0.2);
  cyl(b.solid, 0.8, 0.8, 1.6, 10, 0x2e5a50, 0, 0.1, -0.2, Math.PI / 2, 0, 0);
  tor(b.solid, 0.8, 0.07, 3, 10, RUST, 0, 0.1, 0.3);
  tor(b.solid, 0.8, 0.07, 3, 10, RUST, 0, 0.1, -0.7);
  cyl(b.solid, 0.81, 0.81, 0.22, 10, HAZ, 0, 0.1, -0.2, Math.PI / 2, 0, 0);
  blob(b.solid, 'ico', 0.6, 0xa84a2a, 0, -0.15, 0.6, 1.2, 0.8, 1);
  sym(s => { box(b.solid, 0.06, 0.5, 0.06, 0x8a3a22, s * 0.2, 0.25, 0.95, 0.3); eye(b, 0.07, s * 0.24, 0.52, 1.05, hex(A[1])); });
  const aL = B.part('armL', 'body', 0.55, -0.15, 0.9);
  box(aL.solid, 0.25, 0.25, 0.6, 0xa84a2a, 0, 0, 0.2);
  box(aL.solid, 0.6, 0.55, 0.75, 0xc25a32, 0.1, 0.05, 0.75);
  box(aL.solid, 0.22, 0.3, 0.6, 0x8a3a22, 0.25, 0.32, 1.1, 0.3);
  const aR = B.part('armR', 'body', -0.5, -0.2, 0.85);
  box(aR.solid, 0.18, 0.18, 0.5, 0xa84a2a, 0, 0, 0.2);
  box(aR.solid, 0.3, 0.25, 0.4, 0xc25a32, 0, 0, 0.5);
  for (const [nm, z] of [['legF', 0.5], ['legB', 0.1]]) {
    const l = B.part(nm, 'body', 0, -0.4, z);
    sym(s => { box(l.solid, 0.7, 0.1, 0.1, 0x8a3a22, s * 0.85, 0.1, 0, 0, 0, s * -0.5); box(l.solid, 0.09, 0.5, 0.09, 0x8a3a22, s * 1.18, -0.25, 0); });
  }
};
D.gullswarm = (B, A) => {   /* scavenger gull: grimy white, a hooked beak, red-rimmed glowing eyes */
  B.flag('scale', 1.4);
  const b = B.part('body', null, 0, 0.5, 0);
  blob(b.solid, 'oct', 0.32, 0xd8d8d0, 0, 0, 0, 0.9, 0.85, 1.6);
  blob(b.solid, 'oct', 0.2, 0xe8e8e0, 0, 0.12, 0.42);
  cone(b.solid, 0.07, 0.3, 4, 0xe0b020, 0, 0.08, 0.7, Math.PI / 2 + 0.3);
  cone(b.solid, 0.18, 0.4, 4, 0x6a6e74, 0, 0.0, -0.6, -Math.PI / 2);
  sym(s => eye(b, 0.045, s * 0.12, 0.17, 0.52, hex(A[3]), 0xc02020));
  sym(s => {
    const w = B.part(s > 0 ? 'wingL' : 'wingR', 'body', s * 0.2, 0.08, 0);
    box(w.solid, 0.8, 0.04, 0.38, 0x9aa0a6, s * 0.42, 0, 0);
    box(w.solid, 0.55, 0.03, 0.3, 0x3a3e44, s * 0.95, 0, -0.05, 0, s * 0.25, 0);
  });
};
D.tidecrusher = (B, A) => {   /* a crab the size of a hulk: ship-hull carapace, glowing portholes, a funnel, one giant claw */
  const b = B.part('body', null, 0, 2.3, 0);
  box(b.solid, 5.2, 1.5, 3.8, 0x2a4a48, 0, 0, 0);
  box(b.solid, 4.6, 0.8, 3.3, RUST, 0, 1.0, -0.2);
  box(b.solid, 5.3, 0.25, 3.9, 0x8a2a1a, 0, -0.55, 0);
  cone(b.solid, 0.5, 1.4, 4, 0x2a4a48, 0, 0.0, 2.35, Math.PI / 2);
  for (let k = 0; k < 4; k++) { cyl(b.solid, 0.32, 0.32, 0.12, 8, CHROME, -1.6 + k * 1.05, 0.15, 1.92, Math.PI / 2, 0, 0); cyl(b.glow, 0.24, 0.24, 0.1, 8, hex(A[1]), -1.6 + k * 1.05, 0.15, 1.97, Math.PI / 2, 0, 0); }
  cyl(b.solid, 0.5, 0.65, 1.5, 8, 0x1a1a1c, 1.3, 2.0, -0.9);
  cyl(b.solid, 0.67, 0.67, 0.3, 8, HAZ, 1.3, 2.5, -0.9);
  for (let k = 0; k < 10; k++) blob(b.solid, 'ico', 0.22, BONED, Math.sin(k * 1.7) * 2.2, 1.4, Math.cos(k * 1.3) * 1.4 - 0.2);
  sym(s => { cyl(b.solid, 0.13, 0.13, 1.5, 5, 0x8a2a1a, s * 0.75, 1.2, 1.6, 0.25); eye(b, 0.2, s * 0.75, 2.0, 1.85, hex(A[0])); });
  teeth(b.solid, 6, 2.2, -0.5, 1.95, 0.4, TEETH, true, 0.12);
  const aL = B.part('armL', 'body', 2.2, -0.2, 1.6);   /* the crusher */
  box(aL.solid, 0.8, 0.8, 1.6, 0xa84a2a, 0.3, 0, 0.6, 0, -0.5, 0);
  box(aL.solid, 2.0, 1.7, 2.0, 0xc25a32, 0.9, 0.2, 1.9);
  box(aL.solid, 1.7, 0.6, 1.8, 0xd06a3a, 0.9, 0.95, 3.4, -0.25);
  box(aL.solid, 1.5, 0.5, 1.5, 0x8a3a22, 0.9, -0.45, 3.2, 0.2);
  teeth(aL.solid, 4, 1.4, 0.65, 3.6, 0.45, TEETH, true, 0.16);
  const aR = B.part('armR', 'body', -2.2, -0.2, 1.6);
  box(aR.solid, 0.6, 0.6, 1.3, 0xa84a2a, -0.2, 0, 0.5, 0, 0.5, 0);
  box(aR.solid, 1.0, 0.8, 1.3, 0xc25a32, -0.6, 0, 1.4);
  box(aR.solid, 0.8, 0.3, 0.9, 0x8a3a22, -0.6, 0.45, 2.2, -0.3);
  for (const [nm, s] of [['legL', 1], ['legR', -1]]) {
    const l = B.part(nm, null, s * 2.4, 2.0, 0);
    for (let k = 0; k < 3; k++) { const z = -1.4 + k * 1.1; box(l.solid, 1.9, 0.38, 0.38, 0x8a3a22, s * 0.85, 0.75, z, 0, -s * 0.15 * (k - 1), s * 0.55); box(l.solid, 0.34, 2.9, 0.34, 0x6a2a18, s * 2.0, -0.4, z + (k - 1) * 0.25, 0, 0, s * -0.35); cone(l.solid, 0.17, 0.5, 4, BONED, s * 2.45, -1.85, z + (k - 1) * 0.25, Math.PI); }
  }
};

/* 8 Orbital Scrapheap */
D.voidgrub = (B, A) => {   /* crater grub: pale ringed body, three-way mandibles, glowing spiracles */
  const b = B.part('body', null, 0, 0.9, 0);
  blob(b.solid, 'ico', 0.75, 0xd8d0e8, 0, 0, 0, 1, 1, 1.1);
  sym(s => eye(b, 0.07, s * 0.3, 0.3, 0.62, hex(A[1])));
  blob(b.glow, 'oct', 0.12, hex(A[0]), 0, 0.45, 0.55);
  const j = B.part('jaw', 'body', 0, -0.1, 0.65);
  for (let k = 0; k < 3; k++) { const a = k * 2.094 - Math.PI / 2; box(j.solid, 0.14, 0.14, 0.7, 0x4a3a6a, Math.cos(a) * 0.3, Math.sin(a) * 0.3, 0.3, -Math.sin(a) * 0.5, Math.cos(a) * 0.5, 0); }
  const g = B.part('ground', null, 0, 0, 0);
  tor(g.solid, 1.4, 0.3, 4, 10, 0x4a4a5a, 0, 0.05, 0, Math.PI / 2, 0, 0);
  tor(g.glow, 1.0, 0.06, 3, 10, hex(A[2]), 0, 0.08, 0, Math.PI / 2, 0, 0);
  const c = B.chain({ mode: 'rise', n: 6, sp: 0.6, taper: 0.3, at: [0, 0, -0.5] });
  blob(c.solid, 'ico', 0.68, 0xc8c0d8, 0, 0, 0, 1, 1, 0.75);
  sym(s => blob(c.glow, 'oct', 0.09, hex(A[1]), s * 0.62, 0.15, 0));
};
D.droneswarm = (B, A) => {   /* scrap drone: a welded box, one big lens, four rotors */
  B.flag('scale', 1.4);
  const b = B.part('body', null, 0, 0.35, 0);
  box(b.solid, 0.55, 0.3, 0.55, 0x5a5f6a, 0, 0, 0);
  box(b.solid, 0.4, 0.12, 0.4, HAZ, 0, 0.2, -0.04);
  cyl(b.solid, 0.17, 0.17, 0.12, 8, SOOT, 0, 0, 0.3, Math.PI / 2, 0, 0);
  cyl(b.glow, 0.12, 0.12, 0.05, 8, hex(A[1]), 0, 0, 0.37, Math.PI / 2, 0, 0);
  for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2 + Math.PI / 4; box(b.solid, 0.5, 0.05, 0.06, IRON, Math.cos(a) * 0.4, 0.05, Math.sin(a) * 0.4, 0, -a, 0); }
  box(b.solid, 0.04, 0.3, 0.04, STEEL, 0.1, -0.28, -0.1, 0.3);
  const r = B.part('spin', 'body', 0, 0.12, 0);
  for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2 + Math.PI / 4; box(r.solid, 0.5, 0.02, 0.07, CHROME, Math.cos(a) * 0.6, 0, Math.sin(a) * 0.6, 0, -a + 0.8, 0); }
};
D.starmaw = (B, A) => {   /* void leech: a ring mouth of chrome teeth around a violet glow, a long ringed body */
  const b = B.part('body', null, 0, 1.5, 0);
  tor(b.solid, 1.9, 0.6, 6, 14, 0x2a2240, 0, 0, 0.6);
  for (let k = 0; k < 14; k++) { const a = k * 0.449; cone(b.solid, 0.18, 0.9, 4, CHROME, Math.cos(a) * 1.4, Math.sin(a) * 1.4, 0.75, Math.PI / 2, 0, a + Math.PI / 2); }
  cyl(b.glow, 1.3, 0.6, 1.6, 12, hex(A[2]), 0, 0, -0.2, Math.PI / 2, 0, 0);
  blob(b.glow, 'ico', 0.4, hex(A[0]), 0, 0, 0.3);
  cyl(b.solid, 2.1, 1.7, 1.4, 12, 0x1a1630, 0, 0, -0.5, Math.PI / 2, 0, 0);
  for (let k = 0; k < 8; k++) { const a = k * 0.785; cone(b.solid, 0.15, 1.6, 4, 0x3a2e5a, Math.cos(a) * 2.3, Math.sin(a) * 2.3, 0.0, 0.3, 0, a - Math.PI / 2); blob(b.glow, 'oct', 0.12, hex(A[1]), Math.cos(a) * 3.0, Math.sin(a) * 3.0, 0.3); }
  const c = B.chain({ mode: 'trail', n: 10, sp: 1.5, taper: 0.6, at: [0, 0, -1.2], amp: 1.3, ampY: 0.9, w: 2.2 });
  cyl(c.solid, 1.5, 1.5, 1.4, 10, 0x2a2240, 0, 0, 0, Math.PI / 2, 0, 0);
  tor(c.glow, 1.52, 0.08, 3, 12, hex(A[2]), 0, 0, 0.6);
  B.flag('flyer', true);
};

/* 9 Magma Forge */
D.cinderbat = (B, A) => {   /* fire bat: obsidian body with molten seams, glowing membrane wings */
  B.flag('scale', 1.4);
  const b = B.part('body', null, 0, 0.6, 0);
  blob(b.solid, 'oct', 0.4, 0x1a1414, 0, 0, 0, 0.9, 1, 1.2);
  box(b.glow, 0.05, 0.5, 0.05, hex(A[2]), 0.1, 0, 0.36, 0, 0, 0.4);
  sym(s => { cone(b.solid, 0.12, 0.5, 4, 0x1a1414, s * 0.18, 0.5, 0.1, -0.2, 0, s * -0.3); eye(b, 0.06, s * 0.12, 0.15, 0.38, hex(A[0])); });
  teeth(b.solid, 2, 0.12, -0.12, 0.38, 0.12, TEETH, true);
  sym(s => {
    const w = B.part(s > 0 ? 'wingL' : 'wingR', 'body', s * 0.3, 0.1, 0);
    for (let k = 0; k < 3; k++) box(w.solid, 0.05, 0.05, 0.9 - k * 0.2, 0x2a1a14, s * (0.4 + k * 0.4), 0, -0.1, 0, s * (0.5 - k * 0.3), 0);
    box(w.glow, 1.3, 0.03, 0.7, hex(A[2]), s * 0.7, -0.02, -0.15, 0, 0, 0);
    box(w.glow, 0.5, 0.03, 0.4, hex(A[1]), s * 0.55, 0, 0, 0, 0, 0);
  });
};
D.magmander = (B, A) => {   /* lava salamander: crusted black hide with molten spots, a frilled flat head */
  B.flag('scale', 1.2);
  const b = B.part('body', null, 0, 0.55, 0);
  box(b.solid, 0.9, 0.45, 1.9, 0x1e1614, 0, 0, 0);
  for (let k = 0; k < 7; k++) blob(b.glow, 'oct', 0.13, hex(k % 2 ? A[1] : A[2]), Math.sin(k * 2.1) * 0.35, 0.24, 0.7 - k * 0.22, 1, 0.4, 1);
  const h = B.part('head', 'body', 0, 0.05, 1.0);
  box(h.solid, 1.0, 0.3, 0.75, 0x2a1e1a, 0, 0.05, 0.3);
  sym(s => { cone(h.solid, 0.25, 0.7, 3, 0x3a1a10, s * 0.6, 0.15, 0.0, 0, 0, s * -1.3); eye(h, 0.07, s * 0.36, 0.22, 0.48, hex(A[0])); });
  cone(h.glow, 0.14, 0.4, 3, hex(A[1]), 0.45, 0.15, 0.0, 0, 0, -1.3);
  const j = B.part('jaw', 'head', 0, -0.08, 0.05);
  box(j.solid, 0.9, 0.14, 0.7, 0x3a1a10, 0, -0.04, 0.28);
  box(j.glow, 0.7, 0.05, 0.5, hex(A[2]), 0, 0.04, 0.3);
  const t = B.part('tail', 'body', 0, 0, -0.95);
  cone(t.solid, 0.3, 1.5, 5, 0x1e1614, 0, 0, -0.7, -Math.PI / 2);
  blob(t.glow, 'oct', 0.12, hex(A[1]), 0, 0.2, -0.6);
  for (const [nm, z] of [['legF', 0.55], ['legB', -0.55]]) {
    const l = B.part(nm, 'body', 0, -0.1, z);
    sym(s => { box(l.solid, 0.45, 0.16, 0.2, 0x2a1e1a, s * 0.6, 0, 0); box(l.solid, 0.18, 0.36, 0.2, 0x1e1614, s * 0.8, -0.22, 0.05); });
  }
};
D.moltentitan = (B, A) => {   /* cracked lava giant: obsidian plates over a molten core, ram horns, magma fists */
  const b = B.part('body', null, 0, 5.0, 0);
  blob(b.glow, 'ico', 1.9, hex(A[2]), 0, 0.5, 0, 1.1, 1.2, 0.9);
  for (let k = 0; k < 9; k++) blob(b.solid, 'dod', 1.0, k % 2 ? 0x1a1414 : 0x2a2220, Math.sin(k * 0.7) * 1.7, -0.3 + (k % 3) * 0.9, Math.cos(k * 0.7) * 1.3, 1, 0.8, 0.7, k, k * 0.5, 0);
  box(b.solid, 3.6, 0.6, 2.2, 0x1a1414, 0, -1.1, 0);
  const h = B.part('head', 'body', 0, 2.5, 0.6);
  blob(h.solid, 'dod', 0.9, 0x2a2220, 0, 0, 0, 1.2, 0.9, 1);
  sym(s => { tor(h.solid, 0.6, 0.2, 4, 8, 0x3a2e2a, s * 0.9, 0.4, -0.1, 0, Math.PI / 2, 0, Math.PI * 1.3); eye(h, 0.17, s * 0.35, 0.15, 0.85, hex(A[0])); });
  const j = B.part('jaw', 'head', 0, -0.45, 0.3);
  box(j.solid, 1.3, 0.4, 0.8, 0x1a1414, 0, -0.1, 0.2);
  box(j.glow, 1.0, 0.1, 0.5, hex(A[1]), 0, 0.12, 0.25);
  sym(s => {
    const a = B.part(s > 0 ? 'armL' : 'armR', 'body', s * 2.4, 1.2, 0);
    blob(a.solid, 'dod', 0.95, 0x2a2220, 0, 0, 0);
    box(a.solid, 0.9, 2.6, 0.9, 0x1a1414, s * 0.2, -1.6, 0.1, 0, 0, s * 0.1);
    blob(a.solid, 'dod', 1.05, 0x2a2220, s * 0.35, -3.2, 0.2);
    blob(a.glow, 'oct', 0.65, hex(A[1]), s * 0.35, -3.2, 0.6, 1.2, 1, 1);
    const l = B.part(s > 0 ? 'legL' : 'legR', null, s * 1.2, 3.6, 0);
    box(l.solid, 1.3, 3.2, 1.3, 0x1a1414, 0, -1.8, 0);
    box(l.glow, 0.2, 2.4, 0.1, hex(A[2]), s * 0.2, -1.8, 0.66);
    box(l.solid, 1.6, 0.5, 2.0, 0x2a2220, 0, -3.4, 0.3);
  });
};

/* 10 Rot Sugar Carnival */
D.gumghoul = (B, A) => {   /* gumdrop ghoul: a sugar-crusted drop with a sour grin and stubby arms */
  B.flag('scale', 1.2);
  const b = B.part('body', null, 0, 0.0, 0);
  cyl(b.solid, 0.35, 0.6, 0.75, 8, 0x8a2a5a, 0, 0.4, 0);
  blob(b.solid, 'sph', 0.36, 0x9a3a6a, 0, 0.78, 0, 1, 0.7, 1);
  for (let k = 0; k < 10; k++) blob(b.solid, 'tet', 0.07, 0xf0e8f0, Math.sin(k * 1.9) * 0.45, 0.3 + (k % 4) * 0.15, Math.cos(k * 1.9) * 0.45);
  box(b.glow, 0.42, 0.08, 0.05, hex(A[1]), 0, 0.5, 0.52, 0, 0, 0.0);
  teeth(b.solid, 4, 0.36, 0.46, 0.53, 0.07, 0xd8ffb0);
  sym(s => { eye(b, 0.07, s * 0.15, 0.72, 0.38, 0x9cff3a); box(b.solid, 0.16, 0.16, 0.3, 0x7a2050, s * 0.5, 0.45, 0.1, 0, 0, s * -0.6); cone(b.solid, 0.08, 0.3, 4, 0x8a2a5a, s * 0.3, 0.05, 0.42, Math.PI); });
};
D.licorash = (B, A) => {   /* licorice whip: a sticky coiled heap with one eye; the barbed whip tip is the hitbox */
  const b = B.part('body', null, 0, 0.35, 0);
  blob(b.solid, 'oct', 0.38, 0x2a0a10, 0, 0, 0, 1, 1, 1.4);
  for (let k = 0; k < 5; k++) cone(b.solid, 0.08, 0.35, 3, 0x6a1020, Math.sin(k * 1.25) * 0.3, Math.cos(k * 1.25) * 0.3, 0.1, Math.PI / 2, 0, k * 1.25);
  blob(b.glow, 'oct', 0.1, hex(A[1]), 0, 0, 0.5);
  const an = B.part('anchor', null, 0, 0, 0);
  for (let k = 0; k < 4; k++) tor(an.solid, 0.8 - k * 0.15, 0.22, 5, 12, k % 2 ? 0x3a0a14 : 0x1a0608, 0, 0.25 + k * 0.32, 0, Math.PI / 2, 0, 0);
  blob(an.solid, 'ico', 0.4, 0x2a0a10, 0, 1.55, 0);
  eye(an, 0.2, 0, 1.6, 0.32, hex(A[1]), 0xf0e8f0);
  for (let k = 0; k < 6; k++) blob(an.glow, 'oct', 0.07, 0x9cff3a, Math.sin(k) * 0.7, 0.2 + k * 0.2, Math.cos(k) * 0.7);
  const c = B.chain({ mode: 'tether', n: 10, sp: 1, taper: 0.4, at: [0, 0.3, 0] });
  cyl(c.solid, 0.2, 0.2, 1.0, 6, 0x2a0a10, 0, 0, 0, Math.PI / 2, 0, 0);
  tor(c.solid, 0.2, 0.06, 3, 6, 0x6a1020, 0, 0, 0.3);
};
D.sourjaw = (B, A) => {   /* jawbreaker beast: a cracked striped candy shell, sour light through the cracks, a sugar-tooth jaw */
  const b = B.part('body', null, 0, 3.3, 0);
  const bands = [0xd04a8a, 0xf0e0e8, 0x6a2a8a, 0xf0e0e8, 0x2a8a8a];
  candyBall(b.solid, 2.7, bands, 0, 0);
  for (let k = 0; k < 7; k++) box(b.glow, 0.12, 1.2 + (k % 3) * 0.5, 0.12, 0x9cff3a, Math.sin(k * 0.9) * 2.45, 0.2 + Math.cos(k * 1.4) * 1.0, Math.cos(k * 0.9) * 2.45, 0.3, k * 0.9, (k % 2 ? 0.5 : -0.4));
  sym(s => eye(b, 0.25, s * 0.75, 0.9, 2.28, 0x9cff3a, 0x3a0a2a));
  const j = B.part('jaw', 'body', 0, -0.6, 1.2);
  box(j.solid, 3.0, 0.7, 1.8, 0xd04a8a, 0, -0.4, 0.7);
  for (let k = 0; k < 6; k++) blob(j.solid, 'oct', 0.28, 0xf8f8ff, -1.2 + k * 0.48, 0.1, 1.45, 0.8, 1.6, 0.8);
  for (const [nm, z] of [['legF', 1.0], ['legB', -1.0]]) {
    const l = B.part(nm, null, 0, 1.2, z);
    sym(s => { cyl(l.solid, 0.35, 0.45, 1.2, 6, 0x5a1a40, s * 1.9, -0.55, 0); box(l.solid, 0.9, 0.3, 1.0, 0x3a0a2a, s * 1.9, -1.1, 0.15); });
  }
  B.flag('roller', true);
};

/* 11 Abyss Trench */
D.anglerlurk = (B, A) => {   /* angler: a pit of needle teeth under a swaying lure */
  const b = B.part('body', null, 0, 1.1, 0);
  blob(b.solid, 'ico1', 1.0, 0x1a2a34, 0, 0, 0, 1.0, 0.9, 1.2);
  sym(s => { cone(b.solid, 0.3, 0.8, 4, 0x24424e, s * 0.95, 0, -0.3, 0, 0, s * -1.2); eye(b, 0.07, s * 0.5, 0.45, 0.85, hex(A[0])); });
  cone(b.solid, 0.4, 1.0, 4, 0x24424e, 0, 0.1, -1.4, -Math.PI / 2);
  teeth(b.solid, 7, 1.4, -0.2, 1.08, 0.35, TEETH, true, 0.06);
  const j = B.part('jaw', 'body', 0, -0.35, 0.2);
  box(j.solid, 1.6, 0.3, 1.2, 0x24424e, 0, -0.1, 0.45);
  teeth(j.solid, 8, 1.5, 0.15, 1.0, 0.45, TEETH, false, 0.06);
  const l = B.part('lure', 'body', 0, 0.85, 0.5);
  box(l.solid, 0.07, 0.07, 1.1, 0x24424e, 0, 0.35, 0.4, -0.7);
  box(l.solid, 0.07, 0.07, 0.6, 0x24424e, 0, 0.6, 1.05, 0.8);
  blob(l.glow, 'ico', 0.2, hex(A[1]), 0, 0.35, 1.3);
};
D.jellymine = (B, A) => {   /* drifting jelly mine: a glowing bell studded with spiked horns, trailing tendrils */
  const b = B.part('body', null, 0, 0.6, 0);
  blob(b.solid, 'sph', 0.8, 0x2a5a7a, 0, 0.4, 0, 1, 0.75, 1);
  blob(b.glow, 'ico', 0.45, hex(A[1]), 0, 0.35, 0);
  for (let k = 0; k < 8; k++) { const a = k * 0.785; cone(b.solid, 0.08, 0.4, 4, STEEL, Math.cos(a) * 0.72, 0.5, Math.sin(a) * 0.72, Math.sin(a) * 0.9, 0, -Math.cos(a) * 0.9); blob(b.glow, 'oct', 0.06, hex(A[0]), Math.cos(a) * 0.92, 0.62, Math.sin(a) * 0.92); }
  cone(b.solid, 0.1, 0.5, 4, STEEL, 0, 1.15, 0);
  const t = B.part('tail', 'body', 0, 0, 0);
  for (let k = 0; k < 7; k++) { const a = k * 0.9; cone(t.solid, 0.06, 1.2, 3, 0x3a7a9a, Math.cos(a) * 0.45, -0.55, Math.sin(a) * 0.45, Math.PI + Math.sin(a) * 0.2, 0, Math.cos(a) * 0.2); }
  blob(t.glow, 'oct', 0.05, hex(A[2]), 0, -1.1, 0.3);
  B.flag('flyer', true);
};
D.trenchleviathan = (B, A) => {   /* armoured sea serpent: plated head, lantern eyes, a ridge of fins down a long body */
  const b = B.part('body', null, 0, 2.2, 0);
  box(b.solid, 2.3, 1.6, 3.0, 0x1e3a4a, 0, 0, 0.3);
  box(b.solid, 2.5, 0.5, 2.6, 0x0e2a36, 0, 0.9, 0.1, -0.1);
  for (let k = 0; k < 4; k++) box(b.solid, 2.4 - k * 0.3, 0.2, 0.6, STEEL, 0, 1.15, -0.8 + k * 0.6, -0.2);
  sym(s => { cyl(b.solid, 0.5, 0.5, 0.2, 8, CHROME, s * 1.15, 0.3, 1.2, 0, 0, Math.PI / 2); blob(b.glow, 'ico', 0.38, hex(A[1]), s * 1.25, 0.3, 1.25, 0.5, 1, 1); cone(b.solid, 0.25, 1.4, 4, 0x2e5a6a, s * 1.0, 1.0, -0.9, -0.9, 0, s * -0.5); });
  teeth(b.solid, 7, 2.0, -0.85, 1.75, 0.4, TEETH, true, 0.1);
  const j = B.part('jaw', 'body', 0, -0.8, 0.0);
  box(j.solid, 2.1, 0.5, 2.6, 0x16303c, 0, -0.2, 0.6);
  teeth(j.solid, 7, 1.9, 0.15, 1.8, 0.45, TEETH, false, 0.1);
  const c = B.chain({ mode: 'trail', n: 11, sp: 1.6, taper: 0.7, at: [0, 0, -1.3], amp: 1.6, ampY: 0.7, w: 2.6 });
  cyl(c.solid, 1.1, 1.1, 1.6, 8, 0x1e3a4a, 0, 0, 0, Math.PI / 2, 0, 0);
  cone(c.solid, 0.3, 1.2, 3, 0x2e5a6a, 0, 1.3, -0.2, -0.4);
  sym(s => blob(c.glow, 'oct', 0.12, hex(A[2]), s * 1.05, -0.2, 0));
};

/* 12 Storm Citadel */
D.gargohawk = (B, A) => {   /* iron gargoyle hawk: riveted stone-iron body, blade feathers, a hooked beak and horns */
  B.flag('scale', 1.3);
  const b = B.part('body', null, 0, 0.75, 0);
  box(b.solid, 0.55, 0.5, 1.1, 0x4a4a52, 0, 0, 0, 0.1);
  box(b.solid, 0.5, 0.45, 0.45, 0x5a5a64, 0, 0.25, 0.62);
  cone(b.solid, 0.12, 0.4, 4, 0xd0b050, 0, 0.12, 0.98, Math.PI / 2 + 0.5);
  sym(s => { cone(b.solid, 0.07, 0.4, 4, 0x2a2a30, s * 0.18, 0.55, 0.55, -0.6, 0, s * -0.3); eye(b, 0.06, s * 0.15, 0.32, 0.85, hex(A[1])); });
  for (let k = 0; k < 3; k++) box(b.solid, 0.12, 0.05, 0.5, 0x3a3a42, -0.12 + k * 0.12, 0.0, -0.75, -0.2, -0.2 + k * 0.2, 0);
  sym(s => {
    const w = B.part(s > 0 ? 'wingL' : 'wingR', 'body', s * 0.27, 0.15, 0.1);
    box(w.solid, 1.0, 0.08, 0.5, 0x5a5a64, s * 0.5, 0, 0);
    for (let k = 0; k < 4; k++) box(w.solid, 0.18, 0.05, 0.8 - k * 0.1, k % 2 ? 0x3a3a42 : 0x6a6a74, s * (0.9 + k * 0.22), -0.02, -0.35, 0, s * (0.1 + k * 0.12), 0);
    box(w.glow, 0.9, 0.03, 0.05, hex(A[2]), s * 0.6, 0.05, 0.25);
  });
};
D.cloudwraith = (B, A) => {   /* storm wraith: a torn slate cloak, a hood of darkness, crackling hands */
  const b = B.part('body', null, 0, 0.2, 0);
  cone(b.solid, 0.9, 2.2, 7, 0x3a3e52, 0, 1.2, 0);
  for (let k = 0; k < 7; k++) { const a = k * 0.9; cone(b.solid, 0.2, 0.7, 3, 0x2a2e40, Math.sin(a) * 0.75, 0.05, Math.cos(a) * 0.75, Math.PI, 0, 0); }
  const h = B.part('head', 'body', 0, 2.2, 0.1);
  cone(h.solid, 0.5, 0.9, 6, 0x2a2e40, 0, 0.25, -0.05, -0.2);
  blob(h.solid, 'oct', 0.32, BLACK, 0, -0.05, 0.22);
  sym(s => blob(h.glow, 'oct', 0.07, hex(A[1]), s * 0.11, 0.0, 0.4, 1, 0.6, 1));
  sym(s => {
    const a = B.part(s > 0 ? 'armL' : 'armR', 'body', s * 0.55, 1.7, 0.1);
    box(a.solid, 0.22, 0.9, 0.22, 0x3a3e52, s * 0.15, -0.35, 0.2, -0.5, 0, s * 0.4);
    for (let k = 0; k < 3; k++) box(a.glow, 0.05, 0.4, 0.05, hex(k % 2 ? A[0] : A[2]), s * (0.35 + k * 0.08), -0.85, 0.55, 0.4 + k * 0.4, 0, s * (k - 1) * 0.6);
  });
  B.flag('flyer', true);
};
D.tempestwyrm = (B, A) => {   /* lightning-scaled sky serpent: a horned crested head, gold fins, a crackling body */
  const b = B.part('body', null, 0, 1.8, 0);
  box(b.solid, 1.8, 1.3, 3.2, 0x2e2a5a, 0, 0, 0.4);
  box(b.solid, 1.4, 0.6, 1.5, 0x3a3470, 0, -0.2, 2.1);
  for (let k = 0; k < 5; k++) cone(b.solid, 0.18, 1.2 + k * 0.15, 4, 0xd8b040, 0, 0.9, -0.6 + k * 0.35, -1.1 + k * 0.08);
  sym(s => { cone(b.solid, 0.22, 1.8, 4, 0xe8d8a0, s * 0.7, 0.9, -0.6, -1.0, 0, s * -0.4); eye(b, 0.16, s * 0.72, 0.35, 1.45, hex(A[1])); });
  teeth(b.solid, 5, 1.2, -0.55, 2.8, 0.3, TEETH, true, 0.08);
  const j = B.part('jaw', 'body', 0, -0.6, 1.0);
  box(j.solid, 1.3, 0.35, 2.0, 0x1e1a40, 0, -0.1, 1.0);
  box(j.glow, 0.9, 0.08, 1.4, hex(A[2]), 0, 0.1, 1.0);
  const c = B.chain({ mode: 'trail', n: 12, sp: 1.4, taper: 0.75, at: [0, 0, -1.2], amp: 1.8, ampY: 1.4, w: 3 });
  cyl(c.solid, 0.9, 0.9, 1.4, 8, 0x2e2a5a, 0, 0, 0, Math.PI / 2, 0, 0);
  sym(s => cone(c.solid, 0.3, 1.2, 3, 0xd8b040, s * 1.0, 0.3, 0, 0, 0, s * -1.2));
  box(c.glow, 0.12, 0.5, 1.3, hex(A[0]), 0, 0.9, 0, 0, 0, 0);
  B.flag('flyer', true);
};

/* ---------- debris: boss and thrower ammunition ---------- */
function debrisDesign(kind, w) {
  return (B, A) => {
    const b = B.part('body', null, 0, 0, 0), H = A, hot = hex(H[1]), mid = hex(H[2]);
    switch (kind) {
      case 'slagblob': blob(b.glow, 'ico', 1.0, mid, 0, 0.9, 0, 1, 0.8, 1); for (let k = 0; k < 5; k++) blob(b.solid, 'dod', 0.45, SOOT, Math.sin(k * 1.3) * 0.7, 1.1 + (k % 2) * 0.3, Math.cos(k * 1.3) * 0.7); blob(b.glow, 'oct', 0.5, hot, 0, 1.5, 0); break;
      case 'cranehook': tor(b.solid, 0.9, 0.3, 5, 10, CHROME, 0, 1.4, 0, 0, Math.PI / 2, 0, Math.PI * 1.4); box(b.solid, 0.8, 0.6, 0.8, HAZ, 0, 2.6, 0); for (let k = 0; k < 6; k++) tor(b.solid, 0.2, 0.07, 3, 6, STEEL, 0, 3.1 + k * 0.32, 0, 0, k % 2 ? Math.PI / 2 : 0, 0); break;
      case 'mesarock': case 'emberclod': case 'gritclod': { const big = kind === 'mesarock'; blob(b.solid, 'dod', big ? 1.6 : 1.2, big ? 0x7a3f26 : 0x5a3020, 0, big ? 1.6 : 1.1, 0); blob(b.solid, 'dod', big ? 0.8 : 0.6, 0x8f5636, 0.5, big ? 2.4 : 1.6, 0.4); if (!big) blob(b.glow, 'oct', 0.5, mid, -0.4, 1.1, 0.6); break; }
      case 'sparkorb': blob(b.glow, 'oct', 0.7, hot, 0, 1.0, 0); for (let k = 0; k < 6; k++) cone(b.glow, 0.12, 0.9, 3, mid, 0, 1.0, 0, k, k * 1.1, k * 0.6); break;
      case 'dustwave': case 'bilgewave': case 'tidesurge': case 'stormfront': {
        const c = kind === 'dustwave' ? 0x5a3e6a : kind === 'stormfront' ? 0x3a3e52 : 0x2e6a8a;
        for (let k = 0; k < 5; k++) blob(b.solid, 'ico', 1.0 - (k % 2) * 0.2, c, 0, 0.9 + (k % 2) * 0.5, -2 + k, 1, 1.2, 1);
        for (let k = 0; k < 4; k++) blob(b.glow, 'oct', 0.3, k % 2 ? hot : mid, 0.3, 1.6, -1.5 + k);
        break;
      }
      case 'tentacle': for (let k = 0; k < 7; k++) cyl(b.solid, 0.95 - k * 0.12, 1.05 - k * 0.12, 1.0, 7, 0x5a2a3a, Math.sin(k * 0.5) * 0.3, 0.5 + k * 0.95, 0); for (let k = 0; k < 6; k++) blob(b.glow, 'oct', 0.15, mid, 0, 0.8 + k * 0.95, 0.75 - k * 0.1); break;
      case 'snowball': case 'avalanche': { const R = kind === 'avalanche' ? 1.9 : 1.5; blob(b.solid, 'ico1', R, 0xe8eef2, 0, R, 0); for (let k = 0; k < 4; k++) blob(b.solid, 'oct', 0.4, 0xbfe6f4, Math.sin(k * 1.6) * R, R + Math.cos(k * 1.6) * R * 0.6, Math.cos(k) * R * 0.6); break; }
      case 'icespear': cone(b.solid, 0.6, 3.0, 5, 0xbfe6f4, 0, 1.5, 0); cone(b.glow, 0.25, 2.0, 4, hot, 0, 1.4, 0); break;
      case 'sandspout': case 'magmaspout': case 'ventspout': {
        const c = kind === 'sandspout' ? 0xd8b878 : kind === 'ventspout' ? 0x2e6a8a : 0x2a1e1a;
        cyl(b.solid, 0.9, 1.3, 4.2, 7, c, 0, 2.1, 0);
        for (let k = 0; k < 6; k++) blob(b.solid, 'ico', 0.8 + (k % 3) * 0.2, c, Math.sin(k * 1.05) * 1.0, 4.2 + (k % 2) * 0.5, Math.cos(k * 1.05) * 1.0);
        for (let k = 0; k < 6; k++) blob(b.solid, 'tet', 0.4, SOOT, Math.sin(k * 1.3) * 1.7, 0.2 + k * 0.7, Math.cos(k * 1.3) * 1.7);
        if (kind !== 'sandspout') { cyl(b.glow, 0.55, 0.8, 4.0, 7, mid, 0, 2.0, 0.2); blob(b.glow, 'ico', 0.9, hot, 0, 4.6, 0); }
        break;
      }
      case 'clawsweep': box(b.solid, 1.8, 2.0, 3.0, 0xc25a32, 0, 1.3, 0); box(b.solid, 1.4, 0.8, 1.6, 0x8a3a22, 0, 2.6, 0.6, 0.3); teeth(b.solid, 4, 2.6, 0.3, 1.4, 0.5, TEETH, false, 0.2); break;
      case 'hulkchunk': box(b.solid, 2.4, 0.4, 1.8, RUST, 0, 0.6, 0, 0.2, 0.3, 0.1); box(b.solid, 1.2, 1.2, 0.3, 0x2a4a48, 0.4, 1.1, 0.2, 0.3); cyl(b.glow, 0.25, 0.25, 0.1, 8, hot, 0.4, 1.3, 0.38, Math.PI / 2, 0, 0); break;
      case 'voidorb': blob(b.glow, 'ico', 0.8, mid, 0, 1.2, 0); tor(b.solid, 1.2, 0.12, 3, 12, CHROME, 0, 1.2, 0, 0.6, 0, 0); tor(b.solid, 1.1, 0.1, 3, 12, IRON, 0, 1.2, 0, -0.6, 0.6, 0); break;
      case 'junkroller': blob(b.solid, 'ico', 1.4, 0x5a5f6a, 0, 1.5, 0); for (let k = 0; k < 6; k++) box(b.solid, 0.9, 0.5, 0.5, k % 2 ? RUST : HAZ, Math.sin(k) * 1.2, 1.5 + Math.cos(k * 1.3) * 1.0, Math.cos(k) * 1.0, k, k * 0.5, 0); blob(b.glow, 'oct', 0.3, hot, 0, 2.9, 0); break;
      case 'lavabomb': blob(b.glow, 'ico', 0.9, mid, 0, 1.0, 0); for (let k = 0; k < 5; k++) blob(b.solid, 'dod', 0.42, SOOT, Math.sin(k * 1.3) * 0.65, 1.0 + Math.cos(k * 2.1) * 0.55, Math.cos(k * 1.3) * 0.65); break;
      case 'jawshard': blob(b.solid, 'oct', 1.0, 0xd04a8a, 0, 1.0, 0, 0.8, 1.4, 0.6); blob(b.solid, 'oct', 0.6, 0xf0e0e8, 0.4, 1.4, 0.2, 0.8, 1.2, 0.6); box(b.glow, 0.1, 1.2, 0.1, 0x9cff3a, 0, 1.0, 0.5, 0.4); break;
      case 'gobstop': { candyBall(b.solid, 1.6, [0xd04a8a, 0xf0e0e8, 0x6a2a8a, 0xf0e0e8, 0x2a8a8a], 1.6, 0); box(b.glow, 0.1, 1.4, 0.1, 0x9cff3a, 1.1, 1.6, 0.9, 0.3, 0.4, 0); break; }
      case 'boltstrike': {
        let px = 0, py = 0;
        for (let k = 0; k < 9; k++) { const nx = (k % 2 ? -0.7 : 0.7) * (k ? 1 : 0.3), ny = py + 1.15, L = Math.sqrt((nx - px) * (nx - px) + 1.15 * 1.15); box(b.glow, 0.3, L + 0.15, 0.3, k % 3 ? hex(H[0]) : hot, (px + nx) / 2, (py + ny) / 2, 0, 0, 0, Math.atan2(px - nx, 1.15)); px = nx; py = ny; } cyl(b.glow, 1.2, 1.2, 0.1, 10, mid, 0, 0.05, 0); break; }
      default: blob(b.solid, 'dod', 1.0, RUST, 0, 1.0, 0);
    }
    void w;
  };
}

/* ---------- rigs ---------- */
function designOf(kind) {
  const K = VROOM.monsterAI.KINDS[kind];
  if (D[kind]) return D[kind];
  if (K && K.arche === 'debris') return debrisDesign(kind, K.world);
  /* an unknown kind (a level renamed something): a hulking rusted placeholder that still reads as a monster */
  return (B, A) => { const b = B.part('body', null, 0, (K ? K.h : 2) * 0.5, 0); blob(b.solid, 'dod', K ? K.r : 1, RUST, 0, 0, 0, 1, (K ? K.h / K.r : 2) * 0.5, 1); sym(s => eye(b, 0.12, s * 0.3, 0.3, (K ? K.r : 1) * 0.9, hex(A[0]))); };
}
function geometryFor(ctx, kind) {
  const key = 'mon:' + kind;
  if (ctx.cache && ctx.cache.has(key)) return ctx.cache.get(key);
  const K = VROOM.monsterAI.KINDS[kind], A = accent(K ? K.world : 1);
  const g = realize(ctx.THREE, kind, blueprint(designOf(kind), A));
  if (ctx.cache) ctx.cache.set(key, g);
  return g;
}
function overlayGeo(ctx, name) {
  const T = ctx.THREE, key = 'mon:ov:' + name;
  if (ctx.cache && ctx.cache.has(key)) return ctx.cache.get(key);
  let g;
  if (name === 'ring') g = new T.RingGeometry(0.72, 1, 28, 1);
  else if (name === 'disc') g = new T.CircleGeometry(1, 20);
  else if (name === 'stripe') g = new T.PlaneGeometry(1, 1);
  else g = new T.RingGeometry(0.85, 1, 24, 1);
  g.rotateX(-Math.PI / 2);
  if (ctx.cache) ctx.cache.set(key, g);
  return g;
}

function build(ctx, kind) {
  const T = ctx.THREE, K = VROOM.monsterAI.KINDS[kind] || { kind, world: 1, arche: 'lurker', r: 1, h: 2, fly: 0, style: 'walk' };
  const G = geometryFor(ctx, kind), rm = !!ctx.reducedMotion;
  const group = new T.Group();
  group.name = 'monster:' + kind;
  const solidMat = new T.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.66, metalness: 0.3, emissive: 0x000000 });
  const glowMat = new T.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
  const piv = {}, mats = [solidMat, glowMat];
  for (const p of G.parts) {
    const o = new T.Group();
    o.name = p.name; o.position.set(p.pos[0], p.pos[1], p.pos[2]);
    o.userData.base = o.position.clone();
    if (p.solid) { const m = new T.Mesh(p.solid, solidMat); m.castShadow = K.arche === 'boss'; o.add(m); }
    if (p.glow) o.add(new T.Mesh(p.glow, glowMat));
    piv[p.name] = o;
  }
  for (const p of G.parts) (p.parent && piv[p.parent] ? piv[p.parent] : group).add(piv[p.name]);
  /* the long body: one InstancedMesh for every segment */
  let chain = null;
  if (G.chain && G.chain.solidG) {
    const c = G.chain, count = c.n * (c.mode === 'tentacles' ? c.arms : 1);
    const mesh = new T.InstancedMesh(c.solidG, solidMat, count);
    mesh.frustumCulled = false;
    group.add(mesh);
    let glow = null;
    if (c.glowG) { glow = new T.InstancedMesh(c.glowG, glowMat, count); glow.frustumCulled = false; group.add(glow); }
    chain = { c, mesh, glow, count, dummy: new T.Object3D() };
  }
  /* telegraphs, made on first use so a swarm member that never marks pays nothing */
  const ov = {};
  function overlay(name, color, opacity, additive) {
    if (ov[name]) return ov[name];
    const mat = new T.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, toneMapped: false, side: T.DoubleSide, blending: additive ? T.AdditiveBlending : T.NormalBlending });
    mats.push(mat);
    const m = new T.Mesh(overlayGeo(ctx, name === 'shadow' ? 'disc' : name === 'dust' ? 'dust' : name), mat);
    m.renderOrder = 2; m.visible = false; group.add(m);
    return (ov[name] = m);
  }
  const hot = new T.Color(0xff5a1a), hazard = new T.Color(0xf2b705);

  /* smoothed pose channels */
  const P = { rise: 0, crouch: 0, lean: 0, jaw: 0, arms: 0, glow: 1, wing: 0.3, wrate: 3, run: 0, trem: 0, tilt: 0, tuck: 0, cyc: 0, roll: 0, flash: 0, dust: -1, wob: 0, spin: 0, ev: '', evT: 9 };
  const loc = [0, 0, 0], AT = [0, 0, 0];
  function toLocal(x, y, z) {
    const dx = x - group.position.x, dy = y - group.position.y, dz = z - group.position.z, c = Math.cos(group.rotation.y), s = Math.sin(group.rotation.y);
    loc[0] = dx * c - dz * s; loc[1] = dy; loc[2] = dx * s + dz * c;
    return loc;
  }
  const isBoss = K.arche === 'boss', isDebris = K.arche === 'debris', flyer = !!G.flags.flyer || K.arche === 'diver' || (K.fly > 0 && K.arche !== 'boss');
  const sm = (cur, tgt, k) => cur + (tgt - cur) * k;

  function poseChain(a, dt, t) {
    const { c, mesh, glow, dummy } = chain;
    const n = c.n, groundY = toLocal(group.position.x, a.gy === undefined ? group.position.y : a.gy, group.position.z)[1];
    const hideAll = a.state === 'gone' || (!isBoss && a.state === 'idle' && (K.arche === 'burrower'));
    let idx = 0;
    const put = (x, y, z, px, py, pz, s) => {
      dummy.position.set(x, y, z);
      if (px !== x || py !== y || pz !== z) dummy.lookAt(px, py, pz); else dummy.rotation.set(0, 0, 0);
      if (hideAll) dummy.scale.setScalar(0.0001); else dummy.scale.set(s, s, 1);
      dummy.updateMatrix();
      mesh.setMatrixAt(idx, dummy.matrix); if (glow) glow.setMatrixAt(idx, dummy.matrix); idx++;
    };
    const wv = rm ? 0 : 1, bp = piv.body ? piv.body.position : null;
    /* chains hang off the body pivot: follow its rise, crouch and bob (the arm and tether modes place themselves) */
    const at = c.mode === 'tether' || c.mode === 'arm' || !bp ? c.at : AT;
    if (at === AT) { AT[0] = c.at[0] + bp.x; AT[1] = c.at[1] + bp.y; AT[2] = c.at[2] + bp.z; }
    if (c.mode === 'tentacles') {
      const slam = a.state === 'attack' || a.state === 'tell' ? 1 : 0;
      for (let arm = 0; arm < c.arms; arm++) {
        const ang = arm / c.arms * Math.PI * 2 + 0.2, ca = Math.sin(ang), sa = Math.cos(ang), front = Math.max(0, sa);
        let x = at[0] + ca * 1.3, y = at[1], z = at[2] + sa * 1.3, pitch = 0.55 + slam * front * 0.9;
        for (let k = 0; k < n; k++) {
          const u = (k + 1) / n, wave = Math.sin(t * 1.8 * (wv || 0.3) + arm * 1.7 + k * 0.6) * 0.18;
          pitch -= 0.32 - (k > n * 0.65 ? 0.55 : 0) + wave;
          const L = c.sp, nx = x + ca * Math.cos(pitch) * L, nz = z + sa * Math.cos(pitch) * L, ny = Math.max(groundY + 0.35 * (1 - u), y + Math.sin(pitch) * L);
          put((x + nx) / 2, (y + ny) / 2, (z + nz) / 2, nx, ny, nz, 1 - c.taper * u);
          x = nx; y = ny; z = nz;
        }
      }
    } else if (c.mode === 'tether' || c.mode === 'arm') {
      let ax, ay, az;
      if (c.mode === 'tether' && a.tether && a.ax !== undefined) { const L = toLocal(a.ax, a.ay, a.az); ax = L[0]; ay = L[1] + at[1]; az = L[2]; }
      else { ax = 0; ay = groundY - 0.5; az = 0; }
      const lift0 = c.mode === 'arm' && piv.body ? piv.body.position.y - piv.body.userData.base.y : 0;
      const bx = at[0], by = at[1] + lift0, bz = at[2], len = Math.sqrt((bx - ax) * (bx - ax) + (by - ay) * (by - ay) + (bz - az) * (bz - az));
      const lift = c.mode === 'arm' ? 0 : 0.6 + len * 0.15, wig = c.mode === 'arm' ? 0.35 : 0.25;
      let px = ax, py = ay, pz = az;
      for (let k = 0; k < n; k++) {
        const u = (k + 1) / n, s4 = 4 * u * (1 - u);
        const x = ax + (bx - ax) * u + Math.sin(t * 6 * wv + k) * wig * s4 * wv, y = ay + (by - ay) * u + lift * s4, z = az + (bz - az) * u;
        const sc = Math.max(0.05, Math.min(1.4, len / (n * c.sp)));
        dummy.position.set((x + px) / 2, (y + py) / 2, (z + pz) / 2);
        dummy.lookAt(x, y, z);
        dummy.scale.set(1 - c.taper * u * 0.5, 1 - c.taper * u * 0.5, hideAll ? 0.0001 : sc);
        if (hideAll) dummy.scale.setScalar(0.0001);
        dummy.updateMatrix();
        mesh.setMatrixAt(idx, dummy.matrix); if (glow) glow.setMatrixAt(idx, dummy.matrix); idx++;
        px = x; py = y; pz = z;
      }
    } else {
      /* trail (flying serpents), hump (a burrowing boss in its sand) or rise (an eruption, the body dives back down) */
      const out = a.state === 'lunge' || a.state === 'stagger' || a.state === 'attack' || a.state === 'recover';
      const mode = c.mode === 'trail' ? 'trail' : (c.mode === 'rise' && out) || (c.mode === 'hump' && out && a.h > -1) ? 'rise' : c.mode === 'hump' ? 'hump' : 'rise';
      let px = at[0], py = at[1], pz = at[2];
      for (let k = 0; k < n; k++) {
        const u = (k + 1) / n;
        let x, y, z;
        if (mode === 'trail') { x = at[0] + Math.sin(t * c.w * 0.5 * wv - k * 0.55 + P.cyc * 0.2) * c.amp * u * 1.2; y = at[1] + Math.sin(t * c.w * 0.4 - k * 0.6) * c.ampY * u; z = at[2] - (k + 0.5) * c.sp; if (flyer || isBoss) y = Math.max(groundY + 0.6 * (1 - c.taper * u), y); }
        else if (mode === 'hump') { x = at[0] + Math.sin(t * 1.3 * wv - k * 0.5) * c.amp; z = at[2] - (k + 0.5) * c.sp; y = groundY + Math.sin(k * 0.75 - t * 3) * c.ampY * 1.6 - 0.6; }
        else { x = at[0] + Math.sin(t * 3 * wv - k * 0.7) * 0.25 * u; z = at[2] - (k + 0.5) * c.sp * 0.55; y = at[1] - (k + 0.5) * c.sp * 0.85; }
        put(x, y, z, px, py, pz, 1 - c.taper * u);
        px = x; py = y; pz = z;
      }
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (glow) glow.instanceMatrix.needsUpdate = true;
  }

  function update(a, dt, t) {
    if (!a) return;
    const st = a.state, u = a.stateT || 0;
    const hidden = st === 'gone' || (isBoss && st === 'idle') || (isDebris && st === 'gone');
    group.visible = !hidden;
    if (hidden) return;
    const k = 1 - Math.exp(-dt * 11), kf = 1 - Math.exp(-dt * 22);
    let crouch = 0, lean = 0, jaw = 0.06, arms = 0, glow = 1, wing = 0.3, wrate = 3, run = 0, trem = 0, tilt = 0, tuck = 0;
    const speed = Math.abs(a.vs || 0) + Math.abs(a.vd || 0);
    switch (st) {
      case 'idle': glow = K.arche === 'lurker' ? 0.7 : 0.95; wing = 0.35; wrate = 2.2; break;
      case 'tell': crouch = 0.16; lean = -0.18; jaw = 0.6; glow = 2.0 + 0.8 * Math.sin(t * 22); trem = 1; arms = -0.7; wing = 0.55; wrate = 6; run = isBoss ? 0.6 : 0; break;
      case 'lunge': lean = 0.35; jaw = 0.95; glow = 2.2; run = 1; arms = 1; wing = 0.9; wrate = 11; break;
      case 'attack': lean = 0.3; jaw = 0.9; glow = 2.4; run = 0.8; arms = u < 0.25 ? -1.2 : 1.1; wing = 0.9; wrate = 9; break;
      case 'recover': jaw = 0.15; lean = -0.05; glow = 0.9; run = 0.4; wing = 0.4; wrate = 4; break;
      case 'roam': case 'chase': jaw = 0.25 + 0.25 * Math.sin(t * 6); glow = 1.25; run = Math.min(1, 0.3 + speed / 25); wing = 0.7; wrate = 5; break;
      case 'stagger': jaw = 0.4; glow = 0.35; crouch = 0.12; tilt = 0.25 * Math.sin(u * 9) * Math.max(0, 1 - u); run = 0.1; wing = 0.15; break;
      default: break;
    }
    if (a.enraged) glow *= 1.35;
    if (a.defeated) { glow = Math.max(0, 1.2 - u * 0.5); tilt = Math.min(1.1, u * 0.7); crouch = Math.min(0.5, u * 0.3); jaw = 0.9; run = 0; }
    if (isBoss && (st === 'chase' || st === 'attack') && G.flags.roller && (a.vs || 0) > 14) tuck = 1;
    if (K.arche === 'diver' && st === 'lunge') { lean = 0.9 * Math.max(0, 1 - u / 0.45); wing = 0.1; wrate = 2; }
    P.crouch = sm(P.crouch, crouch, k); P.lean = sm(P.lean, lean, k); P.jaw = sm(P.jaw, jaw, kf); P.arms = sm(P.arms, arms, kf);
    P.glow = sm(P.glow, glow, kf); P.wing = sm(P.wing, wing, k); P.wrate = sm(P.wrate, wrate, k); P.run = sm(P.run, run, k);
    P.trem = sm(P.trem, rm ? 0 : trem, kf); P.tilt = sm(P.tilt, tilt, k); P.tuck = sm(P.tuck, tuck, k * 0.5);
    P.cyc += dt * (3 + P.run * 9 + speed * 0.25);
    P.flash = Math.max(0, P.flash - dt * 6);
    const H = K.h, idle = rm ? 0 : 1;

    const body = piv.body;
    if (body) {
      const b0 = body.userData.base;
      const bob = idle * Math.sin(t * 2.2 + (a.i || 0)) * 0.025 * H + P.run * Math.abs(Math.sin(P.cyc)) * 0.06 * H;
      /* a burrower's eruption: the body bursts up out of its hole by its own height, then sinks back */
      let rise = 0;
      if (K.arche === 'burrower') rise = st === 'lunge' ? Math.min(1, u / 0.16) * (u > 0.7 ? Math.max(0, 1 - (u - 0.7) * 3) : 1) : 0;
      P.rise = sm(P.rise || 0, rise, kf);
      body.position.y = b0.y * (1 - P.crouch) + bob + P.rise * H * 0.75;
      body.rotation.x = P.lean - P.rise * (K.kind === 'sandshark' ? 0.9 : 0.35);
      body.rotation.z = P.trem * Math.sin(t * 47) * 0.05 + P.tilt;
      if (G.flags.roller) {
        P.roll += dt * (a.vs || 0) / Math.max(1, K.r) * P.tuck;
        body.rotation.x = P.lean * (1 - P.tuck) + P.roll;
      }
      if (isDebris) {
        if (K.mode === 'roll') { P.roll += dt * Math.abs(a.vs || 0) / Math.max(0.5, K.r); body.rotation.x = P.roll; }
        else if (K.mode === 'fall' && st === 'tell') { body.rotation.x += dt * 5; body.rotation.z += dt * 3; }
        else if (K.mode === 'sweep') { body.rotation.x = 0; body.rotation.z = 0; body.rotation.y = 0; }
        else if (st !== 'tell') { body.rotation.x = 0; body.rotation.z = 0; }
        const sq = st === 'lunge' && K.mode === 'fall' ? 1 - 0.3 * Math.max(0, 1 - u * 4) : 1;
        body.scale.set(1 / Math.sqrt(sq), sq, 1 / Math.sqrt(sq));
        if (st === 'recover' || st === 'stagger') body.scale.multiplyScalar(Math.max(0.05, 1 - u * 1.2));
      } else body.scale.set(1 + 0.02 * idle * Math.sin(t * 2.2), 1 - P.crouch * 0.3 + 0.025 * idle * Math.sin(t * 2.2 + 1), 1);
    }
    if (piv.head) { piv.head.rotation.x = -P.jaw * 0.18 + P.crouch * -0.6; piv.head.rotation.y = idle * Math.sin(t * 0.8 + (a.i || 0)) * 0.25 * (st === 'idle' ? 1 : 0.2); piv.head.scale.setScalar(1 - 0.6 * P.tuck); }
    if (piv.jaw) piv.jaw.rotation.x = P.jaw * 0.65;
    if (piv.tail) piv.tail.rotation.y = Math.sin(t * (2 + P.run * 6)) * 0.35 * (idle || P.run);
    if (K.kind === 'stingtail' && piv.tail) piv.tail.rotation.x = st === 'tell' ? -0.4 : st === 'lunge' ? 0.7 : 0;
    const sw = Math.sin(P.cyc) * 0.7 * P.run;
    if (piv.legF) piv.legF.rotation.x = sw;
    if (piv.legB) piv.legB.rotation.x = -sw;
    if (piv.legL) piv.legL.rotation.x = sw * 0.6;
    if (piv.legR) piv.legR.rotation.x = -sw * 0.6;
    if (K.hop && piv.legB) piv.legB.rotation.x = (a.h || 0) > 0.25 ? -0.9 : 0.35;
    if (piv.legF && P.tuck) piv.legF.scale.setScalar(1 - 0.7 * P.tuck);
    if (piv.legB && P.tuck) piv.legB.scale.setScalar(1 - 0.7 * P.tuck);
    if (piv.armL) piv.armL.rotation.x = -P.arms * 1.1 + sw * 0.4;
    if (piv.armR) piv.armR.rotation.x = -P.arms * 1.1 * (st === 'attack' ? 0.6 : 1) - sw * 0.4;
    if (piv.wingL || piv.wingR) {
      const fl = Math.sin(t * P.wrate * (flyer || K.arche === 'diver' ? 1 : 0.5)) * P.wing * (rm && st === 'idle' ? 0 : 1) + 0.12;
      if (piv.wingL) piv.wingL.rotation.z = fl;
      if (piv.wingR) piv.wingR.rotation.z = -fl;
    }
    if (piv.spin) piv.spin.rotation.y += dt * 38;
    if (piv.lure) piv.lure.rotation.x = Math.sin(t * 1.7) * 0.18 * idle + (st === 'tell' ? -0.3 : 0);
    /* parts that live on the ground or at the anchor, not on the moving body */
    if (piv.ground) {
      const gl = toLocal(group.position.x, a.gy === undefined ? group.position.y : a.gy, group.position.z);
      piv.ground.position.set(0, gl[1] + 0.02, 0);
      piv.ground.rotation.y = -group.rotation.y * 0 + (K.kind === 'grabber' && st === 'tell' ? Math.sin(t * 40) * 0.05 : 0);
      piv.ground.visible = st !== 'idle' || isBoss;
      if (K.kind === 'grabber') piv.ground.position.y += st === 'tell' ? Math.abs(Math.sin(t * 30)) * 0.12 : 0;
    }
    if (piv.anchor) {
      if (a.tether && a.ax !== undefined) { const L = toLocal(a.ax, a.ay, a.az); piv.anchor.position.set(L[0], L[1], L[2]); piv.anchor.rotation.y = -group.rotation.y + Math.sin(t) * 0.1 * idle; }
      else piv.anchor.position.set(0, 0, -1.5);
    }
    if (chain) poseChain(a, dt, t);

    glowMat.color.setScalar(Math.max(0.15, P.glow));
    solidMat.emissive.setRGB(P.flash * 0.9, P.flash * 0.75, P.flash * 0.6);

    /* telegraphs */
    const showMark = a.mark && st !== 'gone' && !a.defeated;
    if (showMark && a.mark !== 3) {
      const L = toLocal(a.mx, a.my, a.mz), urg = a.tellT ? Math.min(1, u / Math.max(0.2, a.tellT)) : 0.5;
      const pulse = 0.55 + 0.45 * Math.sin(t * (10 + urg * 22));
      if (a.mark === 1) {
        const m = overlay('ring', hazard.getHex(), 0.9, true);
        m.visible = true; m.position.set(L[0], L[1] + 0.06, L[2]);
        const R = (K.r + 0.6) * (1.4 - 0.4 * urg);
        m.scale.set(R, 1, R); m.material.opacity = 0.35 + 0.55 * pulse; m.material.color.copy(urg > 0.7 ? hot : hazard);
        if (ov.stripe) ov.stripe.visible = false;
      } else {
        const m = overlay('stripe', hazard.getHex(), 0.6, true);
        m.visible = true; m.position.set(L[0], L[1] + 0.06, L[2]);
        m.rotation.y = 0; m.scale.set(Math.max(1.5, K.r * 2), 1, 18);
        m.material.opacity = 0.25 + 0.4 * pulse; m.material.color.copy(urg > 0.7 ? hot : hazard);
        if (ov.ring) ov.ring.visible = false;
      }
    } else { if (ov.ring) ov.ring.visible = false; if (ov.stripe) ov.stripe.visible = false; }
    /* a flyer's shadow: on the road under it, or on the marked dive spot during a diver's tell */
    if (flyer || (isDebris && K.mode === 'fall') || (isBoss && (a.h || 0) > 1.5)) {
      const m = overlay('shadow', 0x000000, 0.4, false);
      let sx = group.position.x, sy = a.gy === undefined ? group.position.y : a.gy, sz = group.position.z, op = 0.45;
      if (a.mark === 3 || (isDebris && a.mark === 1)) { sx = a.mx; sy = a.my; sz = a.mz; op = 0.35 + 0.35 * Math.min(1, u / Math.max(0.2, a.tellT || 1)); }
      const L = toLocal(sx, sy, sz), hgt = Math.max(0, (a.h || 0));
      m.visible = st !== 'gone'; m.position.set(L[0], L[1] + 0.04, L[2]);
      const R = K.r * (1.2 + Math.min(1.5, hgt * 0.04));
      m.scale.set(R, 1, R); m.material.opacity = op * Math.max(0.3, 1 - hgt * 0.025);
    }
    /* dust and shock ring after a stomp, an eruption or a landing */
    P.evT += dt;
    if (ov.dust) {
      const d = ov.dust, life = 0.55;
      if (P.evT < life && !rm) {
        const e = P.evT / life, R = (K.r + 0.5) * (1 + e * 3);
        const gl = toLocal(group.position.x, a.gy === undefined ? group.position.y : a.gy, group.position.z);
        d.visible = true; d.position.set(0, gl[1] + 0.08, 0); d.scale.set(R, 1, R); d.material.opacity = 0.7 * (1 - e);
      } else d.visible = false;
    }
  }
  function onEvent(what) {
    P.ev = what;
    if (what === 'hit') P.flash = 1;
    if (what === 'stomp' || what === 'attack' || what === 'lunge' && (K.arche === 'burrower') || what === 'defeat' || what === 'enter') {
      if (!rm) { overlay('dust', 0xd8c8a8, 0.7, false); P.evT = 0; }
    }
    if (what === 'enrage') P.flash = 0.6;
    if (what === 'defeat') P.flash = 1;
  }
  function dispose() {
    group.removeFromParent();
    for (const m of mats) m.dispose();
    if (chain) { chain.mesh.dispose(); if (chain.glow) chain.glow.dispose(); }
  }
  return { group, update, onEvent, dispose };
}

/* ---------- dev scene: the zoo ---------- */
VROOM.scenes['dev:monsters-zoo'] = (() => {
  let T = null, scene = null, camera = null, rigs = [], floor = [], q = null;
  const STATES = ['idle', 'tell', 'lunge', 'recover', 'roam', 'attack', 'stagger'];
  function actorFor(kind, i) {
    const K = VROOM.monsterAI.KINDS[kind];
    return { i, kind, arche: K.arche, s: 0, d: 0, h: 0, x: 0, y: 0, z: 0, yaw: 0, vs: 14, vd: 0, vh: 0, state: 'idle', stateT: 0, hp: 3, r: K.r, mass: K.mass, phase: i,
      alive: true, boss: K.arche === 'boss', hot: false, mark: 0, mx: 0, my: 0, mz: 0, gy: 0, tether: !!K.tether, ax: 0, ay: 0, az: 0, tellT: 1, side: 1, enraged: false, defeated: false };
  }
  return {
    id: 'dev:monsters-zoo', dom: null, view: null,
    enter() {
      const ctx = VROOM.game.ctx; T = ctx.THREE; q = new URLSearchParams(location.search);
      const w = +q.get('w') || 0, only = q.get('kind'), K = VROOM.monsterAI.KINDS;
      const A = accent(w || 1);
      scene = new T.Scene();
      scene.background = new T.Color(A[3]).multiplyScalar(0.45);
      scene.fog = new T.Fog(scene.background.getHex(), 40, 160);
      scene.add(new T.HemisphereLight(new T.Color(A[1]), 0x3a2a20, 2.2));
      const key = new T.DirectionalLight(0xfff4e8, 3.4); key.position.set(-10, 20, 22); scene.add(key);
      const rim = new T.DirectionalLight(new T.Color(A[2]), 3.0); rim.position.set(12, 10, -20); scene.add(rim);
      const fl = new T.Mesh(new T.CircleGeometry(120, 48), new T.MeshStandardMaterial({ color: 0x24262c, roughness: 0.9, metalness: 0.2, flatShading: true }));
      fl.rotation.x = -Math.PI / 2; scene.add(fl); floor.push(fl);
      const stripeMat = new T.MeshStandardMaterial({ color: 0xf2b705, roughness: 0.7 });
      for (let k = -6; k <= 6; k++) { const s = new T.Mesh(new T.BoxGeometry(0.4, 0.02, 3), stripeMat); s.position.set(k * 6, 0.01, 18); scene.add(s); floor.push(s); }
      let kinds = Object.keys(K).filter(k => (only ? k === only : w ? K[k].world === w : K[k].arche !== 'debris'));
      if (w && !only) kinds.sort((a, b) => (K[a].arche === 'boss') - (K[b].arche === 'boss') || (K[a].arche === 'debris') - (K[b].arche === 'debris'));
      let x = 0;
      const cols = w || only ? kinds.length : 12, gapX = w || only ? 1 : 0;
      kinds.forEach((kind, i) => {
        const r = build(ctx, kind), Kk = K[kind], a = actorFor(kind, i);
        const wid = Math.max(2.4, Kk.r * 2.6);
        let px, pz;
        if (w || only) { px = x + wid / 2; x += wid + 1.2 * gapX; pz = 0; }
        else { const row = Kk.arche === 'boss' ? 0 : 1 + Math.floor(i % 2), col = Kk.world - 1; px = (col - 5.5) * 11; pz = row === 0 ? -14 : row * 6 - 2; void cols; }
        r.group.position.set(px, 0, pz);
        r.group.rotation.y = 0.35;
        scene.add(r.group);
        rigs.push({ r, a, kind });
      });
      if (w || only) for (const g of rigs) g.r.group.position.x -= x / 2;
      camera = new T.PerspectiveCamera(38, 1200 / 700, 0.1, 400);
      const span = w || only ? Math.max(6, x) : 130, tall = rigs.reduce((m, g) => Math.max(m, K[g.kind].h + (K[g.kind].style === 'fly' ? 3 : 0)), 1);
      if (w || only) { camera.position.set(span * 0.08, tall * 0.55 + 1.5, Math.max(span * 0.78, tall * 1.9) + 2); camera.lookAt(0, tall * 0.42, 0); }
      else { camera.position.set(0, 34, 92); camera.lookAt(0, 2, -4); }
      this.view = { scene, camera };
    },
    update(dt, t) {
      const force = q && q.get('state'), per = 1.6;
      for (const g of rigs) {
        const a = g.a, K = VROOM.monsterAI.KINDS[g.kind];
        const idx = force ? -1 : Math.floor(t / per + g.a.i * 0.37) % STATES.length;
        let want = force || STATES[idx];
        if (K.arche === 'boss' && want === 'idle') want = 'chase';
        if (a.state !== want) { a.state = want; a.stateT = 0; if (want === 'lunge' || want === 'attack') g.r.onEvent('stomp'); if (want === 'stagger') g.r.onEvent('hit'); }
        a.stateT += dt; a.phase += dt;
        if (force && q.get('hold')) a.stateT = Math.min(a.stateT, +q.get('hold'));
        a.h = K.arche === 'diver' || (K.fly && K.arche !== 'boss') ? 1.2 : K.style === 'fly' ? 3 : K.style === 'swim' ? 1.5 : 0;
        a.x = g.r.group.position.x; a.y = a.h; a.z = g.r.group.position.z; a.gy = 0; a.yaw = g.r.group.rotation.y;
        a.mark = a.state === 'tell' ? (K.arche === 'diver' ? 3 : K.arche === 'swarm' || K.mode === 'sweep' ? 2 : 1) : 0;
        a.mx = a.x + Math.sin(a.yaw) * (K.r + 2); a.my = 0; a.mz = a.z + Math.cos(a.yaw) * (K.r + 2);
        a.ax = a.x - 4; a.ay = 0; a.az = a.z - 1.5;
        g.r.group.position.y = a.h;
        if (!(q && q.get('spin') === '0')) g.r.group.rotation.y = 0.35 + Math.sin(t * 0.25) * 0.6;
        else if (q.get('yaw')) g.r.group.rotation.y = +q.get('yaw');
        g.r.update(a, dt, t);
      }
    },
    exit() { for (const g of rigs) g.r.dispose(); rigs = []; for (const f of floor) { f.geometry.dispose(); } floor = []; scene = null; this.view = null; },
  };
})();

VROOM.monsters = { build };
