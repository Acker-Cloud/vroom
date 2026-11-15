/* cars: low-poly heavy-metal machines and the garage. Owner: cars.
   Contract: VROOM.contracts MODULE_API.cars and the Scene API. Car space: +z nose, +y up, +x the car's LEFT,
   origin on the ground under the chassis centre, metres. Every dimension comes from VROOM.catalog.stats(build),
   so the mesh matches what the sim simulates.

   How a machine is made:
     Kit        collects parts (unit geometry + matrix + tint) per material key, then merges each key into ONE
                mesh, so a whole body is about seven draw calls. Tints ride in vertex colours.
     MATS       a handful of shared materials (dark, chrome, steel, rough, rust, hazard, glass, glow) cached in
                ctx.cache, plus the per-rig paint and decal materials (paint takes grime and damage).
     wheels     one InstancedMesh per wheel material, so 4, 6 or 8 wheels cost two or three draw calls. The
                contract's wheels[4] are plain Object3D pivots (FL FR RL RR) the instances follow.
     BODIES     one builder per catalog body: chassis, panels, the oversized silhouette feature, exposed
                mechanicals, lights, exhaust anchors, decal and roundel spots, animated sub-parts.
   Textures (grime, rust, brushed steel, tread, hazard, paint patterns, decals, numbers) are drawn on canvases
   once and cached. No image files, no network. Visual randomness uses a seeded hash, never Math.random, so a
   machine always looks the same. */

const TAU = Math.PI * 2, HP = Math.PI / 2;
let T = null;   /* THREE, bound on first use from ctx */
const cat = () => VROOM.catalog;
const memo = (ctx, key, make) => { let v = ctx.cache.get(key); if (v === undefined) { v = make(); ctx.cache.set(key, v); } return v; };

/* seeded visual noise (mulberry32) */
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const hashStr = s => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; };

/* ======================================================================================================
   1. canvases and textures
   ====================================================================================================== */
function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h || w; return c; }
function texture(ctx, key, w, h, draw, o = {}) {
  return memo(ctx, 'cars.tx.' + key, () => {
    const c = canvas(w, h), g = c.getContext('2d');
    draw(g, w, h, rng(hashStr(key)));
    const t = new T.CanvasTexture(c);
    t.colorSpace = o.linear ? T.NoColorSpace : T.SRGBColorSpace;
    t.wrapS = t.wrapT = T.RepeatWrapping;
    t.anisotropy = 4;
    if (o.repeat) t.repeat.set(o.repeat[0], o.repeat[1]);
    t.userData.canvas = c;
    return t;
  });
}
function speckle(g, w, h, r, n, col, a0, a1, s0, s1) {
  for (let i = 0; i < n; i++) {
    g.globalAlpha = a0 + r() * (a1 - a0); g.fillStyle = col;
    const s = s0 + r() * (s1 - s0); g.fillRect(r() * w, r() * h, s, s * (0.4 + r()));
  }
  g.globalAlpha = 1;
}
function blot(g, x, y, rad, col, a) {
  const gr = g.createRadialGradient(x, y, 0, x, y, rad);
  gr.addColorStop(0, col); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.globalAlpha = a; g.fillStyle = gr; g.beginPath(); g.arc(x, y, rad, 0, TAU); g.fill(); g.globalAlpha = 1;
}
function scratches(g, w, h, r, n, col, a) {
  g.strokeStyle = col; g.lineWidth = 1;
  for (let i = 0; i < n; i++) {
    const x = r() * w, y = r() * h, l = 8 + r() * 40, an = r() * TAU;
    g.globalAlpha = a * (0.4 + r() * 0.6); g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(an) * l, y + Math.sin(an) * l); g.stroke();
  }
  g.globalAlpha = 1;
}
/* grime: a near-white multiply map. Dirt pools at the bottom of every face (v = 0 is the bottom of a box side).
   Pushed hard so the wear still reads at chase-cam distance: heavy road dirt, rust blooms and long rust runs. */
function grimeDraw(g, w, h, r) {
  g.fillStyle = '#f0ede8'; g.fillRect(0, 0, w, h);
  speckle(g, w, h, r, 1400, '#5a5248', 0.1, 0.42, 1, 3.5);
  for (let i = 0; i < 18; i++) blot(g, r() * w, r() * h, 8 + r() * 26, '#7a3010', 0.35 + r() * 0.3);
  for (let i = 0; i < 10; i++) blot(g, r() * w, r() * h, 3 + r() * 6, '#c7ccd5', 0.5);
  scratches(g, w, h, r, 80, '#ffffff', 0.7); scratches(g, w, h, r, 60, '#2a241c', 0.55);
  const gr = g.createLinearGradient(0, h, 0, h * 0.55);
  gr.addColorStop(0, 'rgba(56,44,32,0.85)'); gr.addColorStop(1, 'rgba(56,44,32,0)');
  g.fillStyle = gr; g.fillRect(0, h * 0.55, w, h * 0.45);
  for (let i = 0; i < 26; i++) {   /* rust runs from the top edge */
    const x = r() * w, l = 24 + r() * 90;
    const s = g.createLinearGradient(0, 0, 0, l); s.addColorStop(0, 'rgba(130,52,14,0.75)'); s.addColorStop(1, 'rgba(130,52,14,0)');
    g.fillStyle = s; g.fillRect(x, 0, 3 + r() * 5, l);
  }
}
const grimeTex = ctx => texture(ctx, 'grime', 256, 256, grimeDraw);
const steelTex = ctx => texture(ctx, 'steel', 256, 256, (g, w, h, r) => {
  g.fillStyle = '#c9cdd3'; g.fillRect(0, 0, w, h);
  for (let y = 0; y < h; y++) { g.globalAlpha = 0.05 + r() * 0.12; g.fillStyle = r() < 0.5 ? '#ffffff' : '#7d838d'; g.fillRect(0, y, w, 1); }
  g.globalAlpha = 1;
  scratches(g, w, h, r, 120, '#ffffff', 0.5); scratches(g, w, h, r, 70, '#4b515b', 0.4);
  for (let i = 0; i < 8; i++) blot(g, r() * w, r() * h, 8 + r() * 20, '#5a4a3a', 0.2);
});
const rustTex = ctx => texture(ctx, 'rust', 256, 256, (g, w, h, r) => {
  g.fillStyle = '#7a3410'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 70; i++) blot(g, r() * w, r() * h, 5 + r() * 26, ['#a84a1a', '#4a1e08', '#c2561c', '#5c3a22'][i % 4], 0.5);
  speckle(g, w, h, r, 1400, '#2a1006', 0.2, 0.6, 1, 2.5);
  speckle(g, w, h, r, 500, '#d8742c', 0.2, 0.5, 1, 2);
  scratches(g, w, h, r, 30, '#8d939d', 0.5);
});
const hazardTex = ctx => texture(ctx, 'hazard', 128, 128, (g, w, h, r) => {
  g.fillStyle = '#111214'; g.fillRect(0, 0, w, h);
  g.fillStyle = '#f2b705';
  for (let i = -2; i < 4; i++) { g.beginPath(); g.moveTo(i * 64, 0); g.lineTo(i * 64 + 32, 0); g.lineTo(i * 64 + 32 + h, h); g.lineTo(i * 64 + h, h); g.fill(); }
  speckle(g, w, h, r, 300, '#111214', 0.1, 0.4, 1, 3); scratches(g, w, h, r, 30, '#c7ccd5', 0.5);
});
/* tyre tread: u runs around the tyre, v across it */
const treadTex = ctx => texture(ctx, 'tread', 256, 64, (g, w, h, r) => {
  g.fillStyle = '#1d1e21'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 16; i++) {
    const x = i * 16;
    g.fillStyle = '#2b2c30'; g.beginPath(); g.moveTo(x, 4); g.lineTo(x + 10, 4); g.lineTo(x + 14, 28); g.lineTo(x + 4, 28); g.fill();
    g.beginPath(); g.moveTo(x + 4, 36); g.lineTo(x + 14, 36); g.lineTo(x + 10, 60); g.lineTo(x, 60); g.fill();
    g.fillStyle = '#0e0f11'; g.fillRect(x + 12, 0, 3, h);
  }
  g.fillStyle = '#0e0f11'; g.fillRect(0, 30, w, 4);
  speckle(g, w, h, r, 200, '#4a4036', 0.2, 0.5, 1, 2);
}, { repeat: [3, 1] });
/* the env map: a dark bay with warm lamps above and molten glow low. A CubeTexture of canvases, so any renderer can use it. */
function envMap(ctx) {
  return memo(ctx, 'cars.env', () => {
    const face = (k) => {
      const c = canvas(64), g = c.getContext('2d'), r = rng(77 + k);
      const gr = g.createLinearGradient(0, 0, 0, 64);
      gr.addColorStop(0, k === 2 ? '#2a2c30' : '#22252b'); gr.addColorStop(0.55, '#101216'); gr.addColorStop(1, k === 3 ? '#1a0e08' : '#2a160c');
      g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
      if (k === 2) { g.fillStyle = '#a89878'; g.fillRect(16, 24, 8, 16); g.fillRect(40, 24, 8, 16); }
      else if (k !== 3) {
        g.fillStyle = '#d9dde4'; g.fillRect(0, 10, 64, 3);
        g.fillStyle = '#ffd59a'; g.fillRect(8 + r() * 30, 18, 16, 6);
        blot(g, 32, 58, 26, '#ff6a1a', 0.7);
      } else blot(g, 32, 32, 30, '#ff5a1a', 0.25);
      return c;
    };
    const t = new T.CubeTexture([0, 1, 2, 3, 4, 5].map(face));
    t.colorSpace = T.SRGBColorSpace; t.needsUpdate = true;
    return t;
  });
}

/* ---- paint patterns: [canvas draw, emissive draw?] by catalog `pattern` ---- */
function flamePath(g, x0, y0, len, thick, r) {
  g.beginPath(); g.moveTo(x0, y0 - thick);
  const n = 5;
  for (let i = 0; i < n; i++) {
    const t0 = i / n, t1 = (i + 0.5) / n, t2 = (i + 1) / n;
    g.quadraticCurveTo(x0 + len * t1, y0 - thick * (1 - t0) - 6 - r() * 14, x0 + len * t2, y0 - thick * (1 - t2) * 0.6);
  }
  g.quadraticCurveTo(x0 + len * 1.05, y0, x0 + len, y0 + 4);
  for (let i = n; i > 0; i--) {
    const t1 = (i - 0.5) / n, t2 = (i - 1) / n;
    g.quadraticCurveTo(x0 + len * t1, y0 + thick * (1 - t1) + 6 + r() * 12, x0 + len * t2, y0 + thick * (1 - t2) * 0.6);
  }
  g.closePath();
}
function star5(g, x, y, R, rr) {
  g.beginPath();
  for (let i = 0; i < 10; i++) { const a = -HP + i * Math.PI / 5, q = i % 2 ? rr : R; g.lineTo(x + Math.cos(a) * q, y + Math.sin(a) * q); }
  g.closePath();
}
function boltPath(g, x, y, s) {
  g.beginPath(); g.moveTo(x + 0.1 * s, y - 0.5 * s); g.lineTo(x + 0.45 * s, y - 0.5 * s); g.lineTo(x + 0.15 * s, y - 0.05 * s);
  g.lineTo(x + 0.4 * s, y - 0.05 * s); g.lineTo(x - 0.25 * s, y + 0.55 * s); g.lineTo(x - 0.02 * s, y + 0.08 * s); g.lineTo(x - 0.25 * s, y + 0.08 * s); g.closePath();
}
const PATTERNS = {
  spectrum(g, w, h, r) { const c = ['#d8322a', '#ff7a1a', '#f2b705', '#5fd34a', '#2e8ac8', '#8a4dff']; c.forEach((k, i) => { g.fillStyle = k; g.fillRect(0, i * h / 6, w, h / 6 + 1); }); },
  stripes(g, w, h, r, p) { g.fillStyle = p.ink; g.fillRect(w * 0.36, 0, w * 0.1, h); g.fillRect(w * 0.54, 0, w * 0.1, h); g.fillStyle = '#111214'; g.fillRect(w * 0.345, 0, 6, h); g.fillRect(w * 0.645, 0, 6, h); },
  flames(g, w, h, r) {
    for (let i = 0; i < 4; i++) {
      const y = h * (0.2 + i * 0.2), gr = g.createLinearGradient(0, 0, w, 0);
      gr.addColorStop(0, '#fff2a8'); gr.addColorStop(0.3, '#ffb02e'); gr.addColorStop(0.7, '#ff5a1a'); gr.addColorStop(1, '#b3200f');
      g.fillStyle = gr; flamePath(g, -10, y, w * (0.7 + r() * 0.3), 34, r); g.fill();
      g.strokeStyle = '#111214'; g.lineWidth = 4; g.stroke();
    }
  },
  halftone(g, w, h, r, p) { g.fillStyle = p.ink; for (let y = 0; y < h; y += 24) for (let x = (y / 24) % 2 * 12; x < w; x += 24) { g.beginPath(); g.arc(x, y, 2 + 8 * (y / h), 0, TAU); g.fill(); } },
  checker(g, w, h, r, p) { g.fillStyle = p.ink; const s = w / 8; for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) if ((x + y) % 2) g.fillRect(x * s, y * s, s, s); },
  urban(g, w, h, r, p) { for (const col of ['#7d8075', p.ink, '#9aa094', '#3d3f39']) { g.fillStyle = col; for (let i = 0; i < 14; i++) { g.beginPath(); const x = r() * w, y = r() * h; for (let k = 0; k < 7; k++) { const a = k / 7 * TAU, q = 20 + r() * 40; g.lineTo(x + Math.cos(a) * q, y + Math.sin(a) * q * 0.7); } g.fill(); } } },
  swirl(g, w, h, r, p) { g.fillStyle = p.ink; for (let i = -8; i < 16; i++) { g.beginPath(); g.moveTo(i * 48, 0); g.lineTo(i * 48 + 22, 0); g.lineTo(i * 48 + 22 + h * 0.7, h); g.lineTo(i * 48 + h * 0.7, h); g.fill(); } PATTERNS.drips(g, w, h, r, { ink: '#5a1040' }); },
  nebula(g, w, h, r, p) { for (let i = 0; i < 9; i++) blot(g, r() * w, r() * h, 60 + r() * 120, ['#a88cff', '#ff4fd8', '#5a4dff'][i % 3], 0.35); speckle(g, w, h, r, 260, '#ffffff', 0.5, 1, 1, 2.5); },
  brushed(g, w, h, r) { for (let y = 0; y < h; y += 2) { g.globalAlpha = 0.05 + r() * 0.18; g.fillStyle = r() < 0.5 ? '#ffffff' : '#000000'; g.fillRect(0, y, w, 2); } g.globalAlpha = 1; },
  spots(g, w, h, r, p) { for (let i = 0; i < 46; i++) { const x = r() * w, y = r() * h, q = 10 + r() * 16; g.strokeStyle = p.ink; g.lineWidth = 6; g.beginPath(); g.arc(x, y, q, r() * 2, r() * 2 + 4.6); g.stroke(); g.fillStyle = '#8a5a18'; g.beginPath(); g.arc(x, y, q * 0.5, 0, TAU); g.fill(); } },
  drips(g, w, h, r, p) { g.fillStyle = p.ink; g.fillRect(0, 0, w, 26); for (let i = 0; i < 18; i++) { const x = r() * w, l = 30 + r() * 120, q = 5 + r() * 9; g.fillRect(x - q / 2, 0, q, l); g.beginPath(); g.arc(x, l, q * 0.75, 0, TAU); g.fill(); } },
  bolts(g, w, h, r, p) { for (let i = 0; i < 9; i++) { g.fillStyle = p.ink; boltPath(g, r() * w, r() * h, 60 + r() * 50); g.fill(); g.strokeStyle = '#111214'; g.lineWidth = 4; g.stroke(); } },
  oilslick(g, w, h, r) { for (let y = 0; y < h; y += 4) { const hue = (y / h * 540 + Math.sin(y * 0.05) * 60) % 360; g.fillStyle = `hsl(${hue},80%,45%)`; g.fillRect(0, y, w, 4); } for (let i = 0; i < 12; i++) blot(g, r() * w, r() * h, 40 + r() * 80, '#000000', 0.35); },
  rust(g, w, h, r) { for (let i = 0; i < 90; i++) blot(g, r() * w, r() * h, 8 + r() * 40, ['#a84a1a', '#4a1e08', '#c2561c', '#3a2a1a'][i % 4], 0.55); speckle(g, w, h, r, 2400, '#2a1006', 0.2, 0.6, 1, 3); },
  cracks(g, w, h, r, p) { crackLines(g, w, h, r, p.ink, 5); },
  hazard(g, w, h, r, p) { g.fillStyle = p.ink; for (let i = -6; i < 10; i++) { g.beginPath(); g.moveTo(i * 96, 0); g.lineTo(i * 96 + 48, 0); g.lineTo(i * 96 + 48 + h, h); g.lineTo(i * 96 + h, h); g.fill(); } },
  ooze(g, w, h, r, p) { PATTERNS.drips(g, w, h, r, p); for (let i = 0; i < 20; i++) blot(g, r() * w, r() * h, 10 + r() * 30, p.ink, 0.35); },
  woodland(g, w, h, r, p) { for (const col of ['#6b6a3a', p.ink, '#7a6440', '#1d2010']) { g.fillStyle = col; for (let i = 0; i < 16; i++) { g.beginPath(); const x = r() * w, y = r() * h; for (let k = 0; k < 8; k++) { const a = k / 8 * TAU, q = 16 + r() * 34; g.lineTo(x + Math.cos(a) * q, y + Math.sin(a) * q); } g.fill(); } } },
};
function crackLines(g, w, h, r, col, lw) {
  g.strokeStyle = col; g.lineCap = 'round';
  for (let i = 0; i < 26; i++) {
    let x = r() * w, y = r() * h; g.lineWidth = lw * (0.4 + r());
    g.beginPath(); g.moveTo(x, y);
    for (let k = 0; k < 6; k++) { x += (r() - 0.5) * 70; y += (r() - 0.5) * 70; g.lineTo(x, y); }
    g.stroke();
  }
}
/* the paint's colour map (base + pattern + light grime) and, for glowing finishes, an emissive map */
function paintMaps(ctx, p) {
  const map = texture(ctx, 'paint.' + p.id, 512, 512, (g, w, h, r) => {
    g.fillStyle = p.base; g.fillRect(0, 0, w, h);
    if (p.pattern && PATTERNS[p.pattern]) PATTERNS[p.pattern](g, w, h, r, p);
    g.globalCompositeOperation = 'multiply'; g.drawImage(grimeTex(ctx).userData.canvas, 0, 0, w, h); g.globalCompositeOperation = 'source-over';
  });
  let emissive = null;
  if (p.glow) emissive = texture(ctx, 'paintGlow.' + p.id, 512, 512, (g, w, h, r) => {
    g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
    const r2 = rng(hashStr('paint.' + p.id));   /* the same stream as the colour map, so cracks line up */
    if (PATTERNS[p.pattern]) PATTERNS[p.pattern](g, w, h, r2, { ...p, ink: '#ffffff' });
  });
  return { map, emissive };
}

/* ======================================================================================================
   2. geometry: unit parts, the trapezoid box, and the Kit that merges parts per material
   ====================================================================================================== */
function flat(geo) { const g = geo.index ? geo.toNonIndexed() : geo; if (!g.attributes.uv) g.setAttribute('uv', new T.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2)); g.computeVertexNormals(); return g; }
function chamferBox(c) {
  const s = 0.5 - c, sh = new T.Shape();
  sh.moveTo(-s + c, -s); sh.lineTo(s - c, -s); sh.lineTo(s, -s + c); sh.lineTo(s, s - c); sh.lineTo(s - c, s); sh.lineTo(-s + c, s); sh.lineTo(-s, s - c); sh.lineTo(-s, -s + c); sh.closePath();
  const g = new T.ExtrudeGeometry(sh, { depth: 1 - 2 * c, bevelEnabled: true, bevelThickness: c, bevelSize: c, bevelSegments: 1, curveSegments: 1 });
  g.translate(0, 0, -(1 - 2 * c) / 2);
  /* box-style uvs: project each vertex on its dominant face axis */
  const pos = g.attributes.position, uv = new Float32Array(pos.count * 2);
  g.computeVertexNormals();
  const nrm = g.attributes.normal;
  for (let i = 0; i < pos.count; i++) {
    const ax = Math.abs(nrm.getX(i)), ay = Math.abs(nrm.getY(i)), az = Math.abs(nrm.getZ(i));
    const x = pos.getX(i) + 0.5, y = pos.getY(i) + 0.5, z = pos.getZ(i) + 0.5;
    if (ax >= ay && ax >= az) { uv[i * 2] = z; uv[i * 2 + 1] = y; } else if (az >= ay) { uv[i * 2] = x; uv[i * 2 + 1] = y; } else { uv[i * 2] = x; uv[i * 2 + 1] = z; }
  }
  g.setAttribute('uv', new T.BufferAttribute(uv, 2));
  return g;
}
/* trapezoid box: bottom bw x bl, top tw x tl (fractions of 1), top centre shifted tz along z; y from -0.5 to 0.5 */
function tboxGeo(tw, tl, tz, bw = 1, bl = 1) {
  const b = [[-bw / 2, -0.5, -bl / 2], [bw / 2, -0.5, -bl / 2], [bw / 2, -0.5, bl / 2], [-bw / 2, -0.5, bl / 2]];
  const t = [[-tw / 2, 0.5, tz - tl / 2], [tw / 2, 0.5, tz - tl / 2], [tw / 2, 0.5, tz + tl / 2], [-tw / 2, 0.5, tz + tl / 2]];
  const quads = [[t[3], t[2], t[1], t[0]], [b[0], b[1], b[2], b[3]], [b[3], b[2], t[2], t[3]], [b[1], b[0], t[0], t[1]], [b[2], b[1], t[1], t[2]], [b[0], b[3], t[3], t[0]]];
  const pos = [], uv = [];
  for (const q of quads) {
    for (const i of [0, 1, 2, 0, 2, 3]) pos.push(...q[i]);
    uv.push(0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1);
  }
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}
function unit(ctx, name) {
  return memo(ctx, 'cars.u.' + name, () => {
    const [kind, a, b, c] = name.split(':');
    switch (kind) {
      case 'box': return flat(new T.BoxGeometry(1, 1, 1));
      case 'cbox': return flat(chamferBox(+a || 0.14));
      case 'cyl': return flat(new T.CylinderGeometry(+(b || 0.5), 0.5, 1, +a || 8, 1, c === 'o'));
      case 'cone': return flat(new T.ConeGeometry(0.5, 1, +a || 8));
      case 'ico': return flat(new T.IcosahedronGeometry(0.5, +a || 0));
      case 'tor': return flat(new T.TorusGeometry(0.5, +(b || 0.14), 6, +a || 12));
      case 'hemi': return flat(new T.SphereGeometry(0.5, +a || 10, 4, 0, TAU, 0, HP));
      case 'plane': return flat(new T.PlaneGeometry(1, 1));
      case 'planeF': { const g = flat(new T.PlaneGeometry(1, 1)), uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setX(i, 1 - uv.getX(i)); return g; }
      case 'tb': return flat(tboxGeo(+a, +b, +c));
      case 'tb5': { const [tw, tl, tz, bw, bl] = a.split(',').map(Number); return flat(tboxGeo(tw, tl, tz, bw, bl)); }
      default: throw new Error('cars: unknown unit ' + name);
    }
  });
}
const AX = { y: [0, 0, 0], x: [0, 0, -HP], z: [HP, 0, 0], '+y': [0, 0, 0], '-y': [Math.PI, 0, 0], '+x': [0, 0, -HP], '-x': [0, 0, HP], '+z': [HP, 0, 0], '-z': [-HP, 0, 0] };
const _m = { q: null, qa: null, e: null, p: null, s: null };
function tmp() { if (!_m.q) { _m.q = new T.Quaternion(); _m.qa = new T.Quaternion(); _m.e = new T.Euler(); _m.p = new T.Vector3(); _m.s = new T.Vector3(); } return _m; }

/* tints: vertex colours on the shared materials */
const TINT = {
  white: 0xffffff, chassis: 0x2a2d34, black: 0x131416, gun: 0x3c414b, rubber: 0x1c1d20,
  chrome: 0xf2f5fa, gold: 0xe0aa2a, copper: 0xd2793e, blackchrome: 0x40444c, steel: 0x8d939d, darksteel: 0x5d636d,
  bone: 0xd9ccae, wood: 0x5c3b22, sail: 0x9c8a66, frost: 0xe8f9ff, ice: 0xbff2ff, olive: 0x4f5a2c, red: 0xb3200f, yellow: 0xf2b705, cream: 0xe8dcc0, pink: 0xff9ad0,
  light: 0xfff2d2, tail: 0xff2a14, hot: 0xff6a1a, amber: 0xffa21a, toxic: 0x8cff3a, cyan: 0x8fe8ff, violet: 0xb48cff, magenta: 0xff4fd8, molten: 0xffb02e,
};
class Kit {
  constructor(ctx) { this.ctx = ctx; this.parts = []; this.subs = []; this.anims = []; this.decals = []; this.roundels = []; this.exhaust = []; this.smoke = []; this.spots = {}; }
  /* the one primitive: unit geometry, position, scale, euler (after the axis turn), tint */
  put(key, uname, x, y, z, sx, sy, sz, o = {}) {
    const t = tmp(), m = new T.Matrix4();
    t.e.set(o.rx || 0, o.ry || 0, o.rz || 0, o.order || 'XYZ'); t.q.setFromEuler(t.e);
    if (o.axis) { const a = AX[o.axis]; t.e.set(a[0], a[1], a[2]); t.qa.setFromEuler(t.e); t.q.multiply(t.qa); }
    m.compose(t.p.set(x, y, z), t.q, t.s.set(sx, sy, sz));
    this.parts.push({ key, geo: unit(this.ctx, uname), m, tint: TINT[o.tint] !== undefined ? TINT[o.tint] : (o.tint !== undefined ? o.tint : 0xffffff) });
    return this;
  }
  box(key, x, y, z, w, h, l, o = {}) { return this.put(key, o.sharp ? 'box' : 'cbox:' + (o.c || 0.14), x, y, z, w, h, l, o); }
  /* trapezoid: top width / length as fractions, top shifted tz (fraction of l) */
  tb(key, x, y, z, w, h, l, tw, tl, tz = 0, o = {}) { return this.put(key, `tb:${tw}:${tl}:${tz}`, x, y, z, w, h, l, o); }
  cyl(key, x, y, z, r, len, axis = 'y', o = {}) { return this.put(key, `cyl:${o.n || 8}:${o.r2 !== undefined ? o.r2 / 2 : 0.5}${o.open ? ':o' : ''}`, x, y, z, r * 2, len, r * 2, { ...o, axis }); }
  cone(key, x, y, z, r, len, dir = '+y', o = {}) { return this.put(key, `cone:${o.n || 6}`, x, y, z, r * 2, len, r * 2, { ...o, axis: dir }); }
  ball(key, x, y, z, r, o = {}) { return this.put(key, `ico:${o.d || 0}`, x, y, z, r * 2 * (o.sx || 1), r * 2 * (o.sy || 1), r * 2 * (o.sz || 1), o); }
  dome(key, x, y, z, r, o = {}) { return this.put(key, `hemi:${o.n || 10}`, x, y, z, r * 2 * (o.sx || 1), r * 2 * (o.sy || 1), r * 2 * (o.sz || 1), o); }
  /* torus of radius R around `axis` */
  ring(key, x, y, z, R, axis = 'z', o = {}) { return this.put(key, `tor:${o.n || 12}:${o.t || 0.14}`, x, y, z, R * 2, R * 2, R * 2, { ...o, ...(axis === 'x' ? { ry: HP } : axis === 'y' ? { rx: HP } : {}) }); }
  /* a round bar from a to b */
  rod(key, a, b, r, o = {}) {
    const t = tmp(), dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2], len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6;
    const m = new T.Matrix4(), dir = new T.Vector3(dx / len, dy / len, dz / len);
    t.q.setFromUnitVectors(new T.Vector3(0, 1, 0), dir);
    m.compose(t.p.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2), t.q, t.s.set(r * 2, len, r * 2));
    this.parts.push({ key, geo: unit(this.ctx, `cyl:${o.n || 6}:0.5`), m, tint: TINT[o.tint] !== undefined ? TINT[o.tint] : 0xffffff });
    return this;
  }
  /* a bent bar through points */
  path(key, pts, r, o = {}) { for (let i = 0; i + 1 < pts.length; i++) { this.rod(key, pts[i], pts[i + 1], r, o); if (i) this.ball(key, pts[i][0], pts[i][1], pts[i][2], r * 1.05, o); } return this; }
  /* call fn for the left (+1) and right (-1) side */
  mir(fn) { fn(1); fn(-1); return this; }
  rivets(key, from, to, n, r = 0.045, o = {}) {
    for (let i = 0; i < n; i++) { const f = n === 1 ? 0.5 : i / (n - 1); this.ball(key, from[0] + (to[0] - from[0]) * f, from[1] + (to[1] - from[1]) * f, from[2] + (to[2] - from[2]) * f, r, { tint: o.tint || 'steel' }); }
    return this;
  }
  /* a stencil spot: decals on both doors, number roundels, hood art. x is the panel's half width there. */
  side(x, y, z, s) { this.decals.push({ x, y, z, s, side: 1 }, { x, y, z, s, side: -1 }); return this; }
  hood(y, z, s, tilt = 0) { this.decals.push({ x: 0, y, z, s, top: true, tilt }); return this; }
  roundel(x, y, z, s) { this.roundels.push({ x, y, z, s, side: 1 }, { x, y, z, s, side: -1 }); return this; }
  /* exhaust outlet at p pointing along dir (unit) */
  pipe(p, dir = [0, 1, 0], s = 1) { this.exhaust.push({ p, dir, s }); return this; }
  /* an animated sub-assembly: its own pivot at (x, y, z), turned rx; its parts are in pivot space */
  sub(name, x, y, z, rx = 0) { const k = new Kit(this.ctx); k.name = name; k.at = [x, y, z]; k.rx = rx; this.subs.push(k); return k; }
  /* where extras and buddies mount: roof, hood, rear, nose */
  spot(name, x, y, z, w = 1, l = 1) { this.spots[name] = { x, y, z, w, l }; return this; }
  anim(fn) { this.anims.push(fn); return this; }
}
/* merge one material's parts into a single non-indexed geometry with vertex colours */
function merge(parts) {
  let n = 0;
  for (const p of parts) n += p.geo.attributes.position.count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2), col = new Float32Array(n * 3);
  const v = new T.Vector3(), nm = new T.Matrix3(), c = new T.Color();
  let o = 0;
  for (const p of parts) {
    const P = p.geo.attributes.position, N = p.geo.attributes.normal, U = p.geo.attributes.uv;
    nm.getNormalMatrix(p.m); c.setHex(p.tint);
    for (let i = 0; i < P.count; i++, o++) {
      v.fromBufferAttribute(P, i).applyMatrix4(p.m); pos[o * 3] = v.x; pos[o * 3 + 1] = v.y; pos[o * 3 + 2] = v.z;
      v.fromBufferAttribute(N, i).applyMatrix3(nm).normalize(); nor[o * 3] = v.x; nor[o * 3 + 1] = v.y; nor[o * 3 + 2] = v.z;
      uv[o * 2] = U.getX(i); uv[o * 2 + 1] = U.getY(i);
      col[o * 3] = c.r; col[o * 3 + 1] = c.g; col[o * 3 + 2] = c.b;
    }
  }
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.BufferAttribute(pos, 3));
  g.setAttribute('normal', new T.BufferAttribute(nor, 3));
  g.setAttribute('uv', new T.BufferAttribute(uv, 2));
  g.setAttribute('color', new T.BufferAttribute(col, 3));
  g.computeBoundingSphere();
  return g;
}

/* ======================================================================================================
   3. materials
   ====================================================================================================== */
function std(ctx, o) {
  const m = new T.MeshStandardMaterial({ flatShading: true, vertexColors: true, envMap: envMap(ctx), ...o });
  return m;
}
/* the edge light and the two-tone split, patched into the standard shader (no extra draw calls).
   Rim: a warm fresnel glow on faces turned away from the camera, so a dark machine still cuts a silhouette
   against a dark world. Two-tone: below uSplit (body-space metres, from the aBodyY attribute finishKit bakes
   into paint geometry) the paint is uLow, above it uHigh, with a uStripe pinstripe on the line. */
const RIM = 0xffd8b0;
function shade(m, o) {
  const u = { uRim: { value: new T.Color(RIM).multiplyScalar(o.rim) } };
  if (o.low) Object.assign(u, { uLow: { value: new T.Color(o.low) }, uHigh: { value: new T.Color(o.high) }, uStripe: { value: new T.Color(o.stripe) }, uSplit: { value: 1 } });
  m.userData.shade = u;
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, u);
    let f = 'uniform vec3 uRim;\n' + sh.fragmentShader.replace('#include <emissivemap_fragment>',
      '#include <emissivemap_fragment>\n{ float rf = smoothstep(0.5, 1.0, 1.0 - abs(dot(normalize(normal), normalize(vViewPosition)))); totalEmissiveRadiance += uRim * rf * rf; }');
    if (o.low) {
      sh.vertexShader = 'attribute float aBodyY;\nvarying float vBodyY;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvBodyY = aBodyY;');
      f = 'uniform vec3 uLow;\nuniform vec3 uHigh;\nuniform vec3 uStripe;\nuniform float uSplit;\nvarying float vBodyY;\n' + f.replace('#include <color_fragment>',
        '#include <color_fragment>\n{ float e = vBodyY - uSplit; diffuseColor.rgb *= abs(e) < 0.04 ? uStripe : (e < 0.0 ? uLow : uHigh); }');
    }
    sh.fragmentShader = f;
  };
  m.customProgramCacheKey = () => 'cars.shade' + (o.low ? '.tt' : '');
  return m;
}
/* set the two-tone line on a rig's paint: a share of the way up the painted parts (or the body's own split) */
function splitPaint(meshes, m, frac = 0.3, at) {
  const u = m.userData.shade;
  if (!u || !u.uSplit) return;
  let lo = Infinity, hi = -Infinity;
  for (const me of meshes) {
    const a = me.name === 'paint' && me.geometry.attributes.aBodyY;
    if (a) for (let i = 0; i < a.count; i++) { const y = a.array[i]; if (y < lo) lo = y; if (y > hi) hi = y; }
  }
  if (hi > lo) u.uSplit.value = at !== undefined ? at : lo + (hi - lo) * frac;
}
function shared(ctx) {
  return memo(ctx, 'cars.mats', () => ({
    dark: shade(std(ctx, { color: 0xffffff, metalness: 0.55, roughness: 0.68, map: grimeTex(ctx), envMapIntensity: 0.6, side: T.DoubleSide }), { rim: 0.36 }),
    chrome: shade(std(ctx, { color: 0xffffff, metalness: 1, roughness: 0.14, envMapIntensity: 1.5 }), { rim: 0.3 }),
    steel: shade(std(ctx, { color: 0xffffff, metalness: 0.85, roughness: 0.42, map: steelTex(ctx), envMapIntensity: 1 }), { rim: 0.38 }),
    rough: shade(std(ctx, { color: 0xffffff, metalness: 0.05, roughness: 0.88, map: grimeTex(ctx), envMapIntensity: 0.3 }), { rim: 0.3 }),
    rust: shade(std(ctx, { color: 0xffffff, metalness: 0.3, roughness: 0.9, map: rustTex(ctx), envMapIntensity: 0.3 }), { rim: 0.3 }),
    hazard: shade(std(ctx, { color: 0xffffff, metalness: 0.3, roughness: 0.6, map: hazardTex(ctx), envMapIntensity: 0.4 }), { rim: 0.3 }),
    glass: std(ctx, { color: 0x1a2029, metalness: 0.9, roughness: 0.06, envMapIntensity: 1.6, emissive: 0x070a10, vertexColors: false }),
    glow: new T.MeshBasicMaterial({ color: 0xffffff, vertexColors: true }),
    ice: std(ctx, { color: 0xbff2ff, metalness: 0.2, roughness: 0.05, transparent: true, opacity: 0.82, emissive: 0x1a5a7a, vertexColors: false, envMapIntensity: 1.6 }),
    tyre: new T.MeshStandardMaterial({ color: 0xffffff, map: treadTex(ctx), metalness: 0, roughness: 0.92, flatShading: true, vertexColors: true }),
    flame: new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, blending: T.AdditiveBlending, depthWrite: false, side: T.DoubleSide }),
    beam: new T.MeshBasicMaterial({ color: 0x8cff3a, transparent: true, opacity: 0.3, blending: T.AdditiveBlending, depthWrite: false, side: T.DoubleSide }),
    ghost: new T.MeshBasicMaterial({ color: 0x8fe8ff, transparent: true, opacity: 0.28, blending: T.AdditiveBlending, depthWrite: false }),
  }));
}
function paintMaterial(ctx, paintId) {
  const p = cat().PAINTS[paintId] || cat().PAINTS['#e53935'], maps = paintMaps(ctx, p);
  const textured = p.kind === 'pattern' || (p.kind === 'metal' && !!p.pattern);
  const m = std(ctx, { color: textured || p.low ? 0xffffff : new T.Color(p.base), metalness: p.metal, roughness: p.rough,
    map: textured ? maps.map : grimeTex(ctx), envMapIntensity: p.kind === 'metal' ? 1.4 : 0.75 });
  if (maps.emissive) { m.emissiveMap = maps.emissive; m.emissive = new T.Color(p.glow); m.emissiveIntensity = 1.4; }
  shade(m, p.low ? { rim: 0.45, low: p.low, high: p.base, stripe: p.stripe || '#ffb02e' } : { rim: 0.45 });
  m.userData.base = m.color.clone(); m.userData.rough = m.roughness;
  return m;
}

/* ======================================================================================================
   4. wheels: built along x with the face on +x, merged per material and cached per (id, r, width)
   ====================================================================================================== */
function tyre(k, r, w, n = 14, slick = false) {
  k.cyl('tyre', 0, 0, 0, r, w, 'x', { n, tint: slick ? 0xb8b8b8 : 0xffffff });
  k.cyl('tyre', 0, 0, 0, r * 0.93, w * 1.1, 'x', { n, tint: 0x9a9a9a });
  k.cyl('dark', -w * 0.52, 0, 0, r * 0.55, 0.04, 'x', { n: 10, tint: 'black' });
}
/* radial blocks around the x axis: n of them, centred at radius rr */
function around(k, key, n, rr, x, sx, sy, sz, o = {}) {
  for (let i = 0; i < n; i++) { const a = (i + (o.phase || 0)) / n * TAU; k.box(key, x, Math.cos(a) * rr, Math.sin(a) * rr, sx, sy, sz, { ...o, rx: a + (o.rx || 0) }); }
}
function aroundCone(k, key, n, rr, x, rad, len, o = {}) {
  for (let i = 0; i < n; i++) {
    const a = i / n * TAU, c = Math.cos(a), s = Math.sin(a);
    k.put(key, `cone:${o.n || 4}`, x, c * (rr + len / 2), s * (rr + len / 2), rad * 2, len, rad * 2, { rx: a, tint: o.tint });
  }
}
function disc(k, key, R, x, t, o = {}) { return k.cyl(key, x, 0, 0, R, t, 'x', o); }
function boltRing(k, n, R, x, r = 0.035, tint = 'chrome') { for (let i = 0; i < n; i++) { const a = i / n * TAU; k.ball('chrome', x, Math.cos(a) * R, Math.sin(a) * R, r, { tint }); } }
const WHEEL_STYLE = {
  normal(k, r, w, f) {
    tyre(k, r, w, 14); around(k, 'tyre', 16, r * 0.98, 0, w * 0.92, r * 0.1, r * 0.16, { tint: 0xd0d0d0, sharp: true });
    disc(k, 'steel', r * 0.6, f, 0.07, { n: 12 }); disc(k, 'dark', r * 0.5, f + 0.02, 0.05, { n: 12, tint: 'gun' });
    for (let i = 0; i < 6; i++) { const a = i / 6 * TAU; k.cyl('dark', f + 0.04, Math.cos(a) * r * 0.36, Math.sin(a) * r * 0.36, r * 0.07, 0.04, 'x', { n: 6, tint: 'black' }); }
    disc(k, 'chrome', r * 0.17, f + 0.05, 0.07, { n: 8 });
  },
  monster(k, r, w, f) {
    tyre(k, r, w, 16);
    for (let i = 0; i < 18; i++) {   /* chevron paddle lugs */
      const a = i / 18 * TAU, rr = r * 1.0;
      k.box('tyre', w * 0.24, Math.cos(a) * rr, Math.sin(a) * rr, w * 0.46, r * 0.16, r * 0.2, { rx: a, ry: 0.35, tint: 0xd8d8d8 });
      k.box('tyre', -w * 0.24, Math.cos(a + 0.17) * rr, Math.sin(a + 0.17) * rr, w * 0.46, r * 0.16, r * 0.2, { rx: a + 0.17, ry: -0.35, tint: 0xd8d8d8 });
    }
    disc(k, 'dark', r * 0.62, f - 0.02, 0.08, { n: 14, tint: 'gun' });
    k.ring('chrome', f + 0.03, 0, 0, r * 0.56, 'x', { t: 0.07, n: 16 });
    boltRing(k, 16, r * 0.56, f + 0.08, 0.03);
    disc(k, 'chrome', r * 0.28, f + 0.02, 0.1, { n: 10 }); disc(k, 'dark', r * 0.12, f + 0.08, 0.06, { n: 6, tint: 'black' });
  },
  racing(k, r, w, f) {
    tyre(k, r, w, 16, true); disc(k, 'dark', r * 0.74, f - 0.01, 0.05, { n: 16, tint: 'black' });
    k.ring('chrome', f, 0, 0, r * 0.71, 'x', { t: 0.05, n: 16 });
    around(k, 'chrome', 5, r * 0.4, f + 0.02, 0.05, r * 0.6, r * 0.12);
    disc(k, 'chrome', r * 0.14, f + 0.04, 0.08, { n: 8 });
  },
  gold(k, r, w, f) {
    tyre(k, r, w, 14); around(k, 'tyre', 14, r * 0.98, 0, w * 0.9, r * 0.08, r * 0.18, { tint: 0xd0d0d0, sharp: true });
    k.ring('chrome', f, 0, 0, r * 0.6, 'x', { t: 0.06, n: 16, tint: 'gold' });
    around(k, 'chrome', 8, r * 0.33, f, 0.05, r * 0.52, r * 0.07, { tint: 'gold', rx: 0.2 });
    disc(k, 'chrome', r * 0.16, f + 0.03, 0.08, { n: 8, tint: 'gold' });
  },
  flower(k, r, w, f) {   /* sawblade */
    tyre(k, r, w, 14); disc(k, 'steel', r * 0.6, f, 0.04, { n: 16 });
    for (let i = 0; i < 14; i++) { const a = i / 14 * TAU; k.put('steel', 'tb:0:0.2:0.4', f, Math.cos(a) * r * 0.64, Math.sin(a) * r * 0.64, 0.04, r * 0.14, r * 0.22, { rx: a }); }
    disc(k, 'glow', r * 0.15, f + 0.03, 0.05, { n: 8, tint: 'hot' }); boltRing(k, 6, r * 0.25, f + 0.03);
  },
  tank(k, r, w, f) {
    tyre(k, r, w, 12); around(k, 'steel', 12, r * 0.98, 0, w * 1.02, r * 0.07, r * 0.3, { tint: 'darksteel', sharp: true });
    disc(k, 'dark', r * 0.7, f, 0.1, { n: 12, tint: 'olive' }); boltRing(k, 10, r * 0.55, f + 0.06, 0.035, 'darksteel');
    k.cone('steel', f + 0.12, 0, 0, r * 0.2, 0.16, '+x', { n: 8 });
  },
  glow(k, r, w, f) {
    tyre(k, r, w, 14); around(k, 'tyre', 14, r * 0.98, 0, w * 0.9, r * 0.08, r * 0.18, { tint: 0xd0d0d0, sharp: true });
    disc(k, 'dark', r * 0.64, f - 0.01, 0.05, { n: 16, tint: 'black' });
    k.ring('glow', f + 0.02, 0, 0, r * 0.55, 'x', { t: 0.05, n: 16, tint: 'toxic' }); k.ring('glow', f + 0.02, 0, 0, r * 0.3, 'x', { t: 0.06, n: 12, tint: 'toxic' });
    around(k, 'dark', 4, r * 0.42, f + 0.02, 0.05, r * 0.26, r * 0.08, { tint: 'gun' });
  },
  star(k, r, w, f) {
    tyre(k, r, w, 14); around(k, 'tyre', 14, r * 0.98, 0, w * 0.9, r * 0.08, r * 0.18, { tint: 0xd0d0d0, sharp: true });
    disc(k, 'dark', r * 0.62, f - 0.01, 0.05, { n: 16, tint: 'black' }); k.ring('chrome', f, 0, 0, r * 0.6, 'x', { t: 0.05, n: 16 });
    for (let i = 0; i < 5; i++) { const a = i / 5 * TAU; k.put('chrome', 'tb:0:0.1:0', f + 0.02, Math.cos(a) * r * 0.3, Math.sin(a) * r * 0.3, 0.06, r * 0.56, r * 0.26, { rx: a }); }
    disc(k, 'glow', r * 0.1, f + 0.05, 0.05, { n: 6, tint: 'amber' });
  },
  donut(k, r, w, f) {   /* fat ribbed balloon */
    k.cyl('tyre', 0, 0, 0, r * 0.92, w, 'x', { n: 16, tint: 0xb0b0b0 });
    for (let i = 0; i < 4; i++) k.ring('tyre', -w * 0.36 + i * w * 0.24, 0, 0, r * 0.86, 'x', { t: 0.18, n: 16, tint: 0xe0e0e0 });
    disc(k, 'chrome', r * 0.42, f, 0.08, { n: 12, tint: 'copper' }); boltRing(k, 8, r * 0.3, f + 0.05, 0.03); disc(k, 'dark', r * 0.12, f + 0.06, 0.05, { n: 6, tint: 'black' });
  },
  cookie(k, r, w, f) {   /* cog rim */
    tyre(k, r, w, 14); around(k, 'tyre', 14, r * 0.98, 0, w * 0.9, r * 0.08, r * 0.18, { tint: 0xd0d0d0, sharp: true });
    disc(k, 'steel', r * 0.5, f, 0.08, { n: 16, tint: 'darksteel' }); around(k, 'steel', 12, r * 0.55, f, 0.08, r * 0.14, r * 0.14, { sharp: true, tint: 'darksteel' });
    disc(k, 'chrome', r * 0.22, f + 0.04, 0.08, { n: 6 }); boltRing(k, 6, r * 0.36, f + 0.05);
  },
  lava(k, r, w, f) {
    tyre(k, r, w, 14); k.ring('glow', 0, 0, 0, r * 0.98, 'x', { t: 0.02, n: 16, tint: 'hot' });
    disc(k, 'dark', r * 0.62, f - 0.01, 0.05, { n: 14, tint: 'black' });
    around(k, 'glow', 6, r * 0.34, f + 0.01, 0.04, r * 0.5, r * 0.05, { tint: 'hot', rx: 0.4 });
    disc(k, 'glow', r * 0.16, f + 0.03, 0.06, { n: 7, tint: 'molten' });
  },
  bubble(k, r, w, f) {
    tyre(k, r, w, 14); around(k, 'tyre', 14, r * 0.98, 0, w * 0.9, r * 0.08, r * 0.18, { tint: 0xd0d0d0, sharp: true });
    k.dome('chrome', f, 0, 0, r * 0.62, { rz: -HP, sy: 0.45, n: 10 }); boltRing(k, 10, r * 0.6, f + 0.02, 0.03, 'steel');
  },
  crystal(k, r, w, f) {
    tyre(k, r, w, 14); around(k, 'tyre', 14, r * 0.98, 0, w * 0.9, r * 0.08, r * 0.18, { tint: 0xd0d0d0, sharp: true });
    disc(k, 'dark', r * 0.6, f - 0.01, 0.05, { n: 12, tint: 'black' });
    for (let i = 0; i < 7; i++) { const a = i / 7 * TAU; k.put('ice', 'cone:4', f + 0.06, Math.cos(a) * r * 0.3, Math.sin(a) * r * 0.3, r * 0.16, r * 0.56, r * 0.16, { rx: a }); }
    k.ball('ice', f + 0.06, 0, 0, r * 0.16);
  },
  disco(k, r, w, f) {
    tyre(k, r, w, 14); around(k, 'tyre', 14, r * 0.98, 0, w * 0.9, r * 0.08, r * 0.18, { tint: 0xd0d0d0, sharp: true });
    k.ring('chrome', f, 0, 0, r * 0.6, 'x', { t: 0.06, n: 16 }); disc(k, 'dark', r * 0.58, f - 0.01, 0.04, { n: 16, tint: 'black' });
    k.ball('chrome', f + 0.04, 0, 0, r * 0.4, { d: 1, sx: 0.5 });
  },
  spike(k, r, w, f) {
    tyre(k, r, w, 14); around(k, 'tyre', 16, r * 0.98, 0, w * 0.9, r * 0.1, r * 0.16, { tint: 0xd0d0d0, sharp: true });
    for (let j = -1; j <= 1; j += 2) aroundCone(k, 'chrome', 12, r * 1.02, j * w * 0.25, 0.03, r * 0.1, { tint: 'steel' });
    disc(k, 'dark', r * 0.58, f, 0.06, { n: 12, tint: 'gun' }); boltRing(k, 8, r * 0.46, f + 0.04, 0.035);
    k.cone('chrome', f + r * 0.3, 0, 0, r * 0.16, r * 0.55, '+x', { n: 6 });
  },
  chain(k, r, w, f) {
    tyre(k, r, w, 14);
    for (let i = 0; i < 10; i++) { const a = i / 10 * TAU; for (let j = -1; j <= 1; j++) k.put('steel', 'tor:6:0.2', j * w * 0.3, Math.cos(a) * r * 1.0, Math.sin(a) * r * 1.0, w * 0.34, w * 0.34, w * 0.34, { rx: a, ry: (j & 1) ? 0 : HP, tint: 'darksteel' }); }
    disc(k, 'steel', r * 0.58, f, 0.07, { n: 12 }); boltRing(k, 6, r * 0.38, f + 0.04, 0.04); disc(k, 'chrome', r * 0.16, f + 0.04, 0.08, { n: 8 });
  },
  paddle(k, r, w, f) {
    tyre(k, r, w, 12, true); around(k, 'tyre', 10, r * 1.02, 0, w * 1.0, r * 0.26, r * 0.07, { tint: 0xe0e0e0, sharp: true });
    disc(k, 'dark', r * 0.56, f, 0.07, { n: 12, tint: 'yellow' }); boltRing(k, 8, r * 0.44, f + 0.04, 0.035, 'darksteel'); disc(k, 'dark', r * 0.16, f + 0.05, 0.07, { n: 6, tint: 'black' });
  },
  rustrim(k, r, w, f) {
    tyre(k, r, w, 12); around(k, 'tyre', 12, r * 0.98, 0, w * 0.9, r * 0.08, r * 0.2, { tint: 0xc0c0c0, sharp: true });
    k.ring('rust', f - 0.02, 0, 0, r * 0.6, 'x', { t: 0.07, n: 14 });
    for (let i = 0; i < 8; i++) { const a = i / 8 * TAU; k.rod('rust', [f, 0, 0], [f - 0.02, Math.cos(a) * r * 0.58, Math.sin(a) * r * 0.58], 0.035); }
    disc(k, 'rust', r * 0.16, f + 0.02, 0.12, { n: 8 });
  },
  turbine(k, r, w, f) {
    tyre(k, r, w, 14, true); disc(k, 'dark', r * 0.7, f - 0.01, 0.05, { n: 16, tint: 'black' });
    k.ring('chrome', f, 0, 0, r * 0.68, 'x', { t: 0.05, n: 16 });
    around(k, 'chrome', 14, r * 0.42, f + 0.01, 0.03, r * 0.5, r * 0.12, { ry: 0.6 });
    k.cone('chrome', f + 0.06, 0, 0, r * 0.16, 0.18, '+x', { n: 8 }); k.ring('glow', f + 0.02, 0, 0, r * 0.2, 'x', { t: 0.08, n: 10, tint: 'cyan' });
  },
  skullcap(k, r, w, f) {
    tyre(k, r, w, 14); around(k, 'tyre', 16, r * 0.98, 0, w * 0.9, r * 0.1, r * 0.16, { tint: 0xd0d0d0, sharp: true });
    disc(k, 'dark', r * 0.62, f - 0.01, 0.06, { n: 14, tint: 'black' }); k.ring('rough', f, 0, 0, r * 0.58, 'x', { t: 0.08, n: 14, tint: 'bone' });
    k.ball('rough', f + 0.08, r * 0.06, 0, r * 0.32, { d: 1, sx: 0.55, tint: 'bone' });
    k.mir(s => k.ball('dark', f + 0.22, r * 0.1, s * r * 0.12, r * 0.09, { tint: 'black' }));
    k.mir(s => k.ball('glow', f + 0.25, r * 0.1, s * r * 0.12, r * 0.035, { tint: 'hot' }));
    for (let i = -2; i <= 2; i++) k.box('rough', f + 0.12, -r * 0.2, i * r * 0.07, 0.06, r * 0.12, r * 0.05, { sharp: true, tint: 'bone' });
  },
};
/* merged wheel geometry per material key, cached; `face` puts the rim just outside the tyre */
function wheelGeos(ctx, id, r, w) {
  const style = WHEEL_STYLE[id] ? id : 'normal';
  return memo(ctx, `cars.wheel.${style}.${r.toFixed(3)}.${w.toFixed(3)}`, () => {
    const k = new Kit(ctx);
    WHEEL_STYLE[style](k, r, w, w / 2 + 0.01);
    const by = new Map();
    for (const p of k.parts) { if (!by.has(p.key)) by.set(p.key, []); by.get(p.key).push(p); }
    const out = new Map();
    for (const [key, parts] of by) out.set(key, merge(parts));
    return out;
  });
}

/* ======================================================================================================
   5. shared assemblies: frames, cabs, lights, engines, exhausts, cages
   ====================================================================================================== */
const P2 = 0x8a8a8a, P3 = 0x5e5e5e;   /* paint shading tints: second tone, third tone */
const r3 = v => +v.toFixed(3);
/* the part of a trapezoid box between height fractions f0..f1, grown by g: glass bands, trims */
function band(k, key, x, y0, z, w, h, l, tw, tl, tz, f0, f1, g = 1.03, o = {}) {
  const wb = w * (1 - (1 - tw) * f0) * g, wt = w * (1 - (1 - tw) * f1) * g, lb = l * (1 - (1 - tl) * f0) * g, lt = l * (1 - (1 - tl) * f1) * g;
  const zb = z + tz * l * f0, zt = z + tz * l * f1;
  return k.tb(key, x, y0 + h * (f0 + f1) / 2, zb, wb, h * (f1 - f0), lb, r3(wt / wb), r3(lt / lb), r3((zt - zb) / lb), o);
}
/* a cab: painted shell, glass band, roof rim; z is the bottom centre */
function cab(k, z, y0, w, h, l, tw = 0.86, tl = 0.72, tz = -0.06, o = {}) {
  k.tb('paint', 0, y0 + h / 2, z, w, h, l, tw, tl, tz, { tint: o.tint });
  band(k, 'glass', 0, y0, z, w, h, l, tw, tl, tz, o.g0 || 0.3, o.g1 || 0.86, 1.025);
  band(k, 'dark', 0, y0, z, w, h, l, tw, tl, tz, 0.9, 1.0, 1.01, { tint: 'gun' });
  k.spot('roof', 0, y0 + h, z + tz * l, w * tw * 0.8, l * tl * 0.8);
}
function rails(k, d, y, x = d.tr * 0.28, len = d.wb + d.R * 1.8) {
  k.mir(s => k.box('dark', s * x, y, 0, 0.16, 0.24, len, { tint: 'chassis' }));
  for (const z of [d.fz, d.rz, 0]) k.box('dark', 0, y, z, x * 2, 0.14, 0.16, { tint: 'chassis', sharp: true });
}
function lamps(k, z, y, x, r = 0.14, tint = 'light') {
  k.mir(s => { k.cyl('dark', s * x, y, z, r * 1.3, 0.14, 'z', { n: 8, tint: 'black' }); k.cyl('glow', s * x, y, z + 0.06, r, 0.05, 'z', { n: 8, tint }); });
}
/* tail lights read first from the chase cam: a big lamp in a black bezel with a white-hot core */
function tails(k, z, y, x, w = 0.28, h = 0.14) {
  const W = Math.max(0.1, Math.min(w * 1.5, 2 * x - 0.2)), H = h * 1.7;
  k.mir(s => {
    k.box('dark', s * x, y, z + 0.03, W + 0.1, H + 0.1, 0.08, { tint: 'black', sharp: true });
    k.box('glow', s * x, y, z - 0.015, W, H, 0.04, { tint: 'tail', sharp: true });
    k.box('glow', s * x, y, z - 0.04, W * 0.45, H * 0.4, 0.02, { tint: 0xffc0a8, sharp: true });
  });
}
function grille(k, z, y, w, h, bars = 4, key = 'chrome') {
  k.box('dark', 0, y, z, w, h, 0.12, { tint: 'black' });
  for (let i = 0; i < bars; i++) k.box(key, 0, y - h / 2 + (i + 0.5) * h / bars, z + 0.06, w * 0.92, h / bars * 0.38, 0.05, { sharp: true });
}
function stack(k, x, y0, z, h, r = 0.09, cap = false) {
  k.cyl('chrome', x, y0 + h / 2, z, r, h, 'y', { n: 8 });
  k.cyl('dark', x, y0 + h * 0.35, z, r * 1.35, h * 0.3, 'y', { n: 8, tint: 'gun' });
  k.cyl('glow', x, y0 + h + 0.005, z, r * 0.72, 0.02, 'y', { n: 8, tint: 'hot' });
  if (cap) k.box('chrome', x, y0 + h + 0.06, z - r * 0.3, r * 2.4, 0.03, r * 2.4, { rx: -0.5, sharp: true });
  k.pipe([x, y0 + h, z], [0, 1, 0]);
}
function rearPipe(k, x, y, z, len, r = 0.08, dir = [0, 0, -1]) {
  k.cyl('chrome', x, y, z - len / 2, r, len, 'z', { n: 8 });
  k.cyl('glow', x, y, z - len - 0.005, r * 0.72, 0.02, 'z', { n: 8, tint: 'hot' });
  k.pipe([x, y, z - len], dir);
}
function blower(k, x, y, z, s = 1) {
  k.box('chrome', x, y + 0.14 * s, z, 0.46 * s, 0.28 * s, 0.72 * s, { c: 0.08 });
  for (let i = 0; i < 4; i++) k.box('chrome', x, y + 0.14 * s, z - 0.27 * s + i * 0.18 * s, 0.5 * s, 0.22 * s, 0.04 * s, { sharp: true, tint: 'steel' });
  k.box('dark', x, y + 0.04 * s, z + 0.4 * s, 0.4 * s, 0.24 * s, 0.1 * s, { tint: 'black' });
  k.tb('dark', x, y + 0.4 * s, z + 0.02 * s, 0.54 * s, 0.24 * s, 0.58 * s, 0.86, 0.6, -0.15, { tint: 'black' });
  k.box('glow', x, y + 0.4 * s, z + 0.33 * s, 0.4 * s, 0.12 * s, 0.02, { tint: 'hot', sharp: true });
}
/* an exposed V8: block, heads, chrome covers, headers, and optionally a blower and velocity stacks */
function v8(k, x, y, z, s = 1, o = {}) {
  k.box('steel', x, y, z, 0.62 * s, 0.46 * s, 0.92 * s, { tint: 'darksteel' });
  k.mir(m => {
    k.box('steel', x + m * 0.27 * s, y + 0.24 * s, z, 0.24 * s, 0.18 * s, 0.86 * s, { rz: m * 0.55, tint: 'steel' });
    k.box('chrome', x + m * 0.33 * s, y + 0.33 * s, z, 0.18 * s, 0.07 * s, 0.82 * s, { rz: m * 0.55 });
    for (let i = 0; i < 4; i++) k.rod('chrome', [x + m * 0.32 * s, y, z - 0.3 * s + i * 0.2 * s], [x + m * 0.52 * s, y - 0.28 * s, z - 0.25 * s + i * 0.18 * s], 0.035 * s, { n: 5, tint: 'copper' });
  });
  k.cyl('dark', x, y + 0.02 * s, z + 0.5 * s, 0.16 * s, 0.06 * s, 'z', { n: 10, tint: 'black' });
  if (o.blower) blower(k, x, y + 0.34 * s, z, s * 0.9);
  if (o.stacks) for (let i = 0; i < 4; i++) k.mir(m => k.cyl('chrome', x + m * 0.12 * s, y + (o.blower ? 0.86 : 0.42) * s, z - 0.24 * s + i * 0.16 * s, 0.055 * s, 0.22 * s, 'y', { n: 6, r2: 1.3 }));
  if (o.filter) k.cyl('chrome', x, y + 0.46 * s, z, 0.3 * s, 0.1 * s, 'y', { n: 12 });
}
function lightbar(k, y, z, w, n = 4, tint = 'light') {
  k.box('dark', 0, y, z, w, 0.14, 0.2, { tint: 'black' });
  for (let i = 0; i < n; i++) k.cyl('glow', -w / 2 + (i + 0.5) * w / n, y, z + 0.1, Math.min(0.08, w / n * 0.3), 0.03, 'z', { n: 8, tint });
}
function bullbar(k, z, y0, y1, w, r = 0.06) {
  k.mir(s => k.rod('steel', [s * w / 2, y0, z], [s * w / 2, y1, z], r));
  k.rod('steel', [w / 2, y1, z], [-w / 2, y1, z], r); k.rod('steel', [w / 2, (y0 + y1) / 2, z + 0.04], [-w / 2, (y0 + y1) / 2, z + 0.04], r);
  k.mir(s => k.rod('steel', [s * w * 0.2, y0, z + 0.05], [s * w * 0.2, y1, z + 0.05], r * 0.8));
}
/* a fender arch over a wheel at (x, zc): three plates on a circle */
function arch(k, key, x, zc, R, wid, o = {}) {
  const rr = R * 1.16;
  for (const a of [-0.85, -0.3, 0.3, 0.85]) k.box(key, x, R + Math.cos(a) * rr, zc + Math.sin(a) * rr, wid, 0.08, R * 0.62, { rx: a, tint: o.tint || 'chassis' });
}
function cones(k, key, pts, dir, r, len, tint) { for (const p of pts) k.cone(key, p[0], p[1], p[2], r, len, dir, { n: 5, tint }); }
function plates(k, x, y, z, w, h, l, tint = 'darksteel') {
  k.box('steel', x, y, z, w, h, l, { tint, c: 0.06 });
  const side = Math.sign(x) || 1, xo = x + side * w / 2;
  k.rivets('chrome', [xo, y + h * 0.38, z - l * 0.42], [xo, y + h * 0.38, z + l * 0.42], 4, 0.035, { tint: 'steel' });
  k.rivets('chrome', [xo, y - h * 0.38, z - l * 0.42], [xo, y - h * 0.38, z + l * 0.42], 4, 0.035, { tint: 'steel' });
}
/* forward-facing cab box for the trucks: shell, windscreen, side glass, grille, bumper, lamps */
function truckCab(k, d, zc, w, y0, h, l, o = {}) {
  k.box('paint', 0, y0 + h / 2, zc, w, h, l);
  k.box('glass', 0, y0 + h * 0.72, zc + l / 2 + 0.01, w * 0.86, h * 0.36, 0.04, { sharp: true });
  k.mir(s => k.box('glass', s * (w / 2 + 0.01), y0 + h * 0.72, zc + l * 0.08, 0.04, h * 0.32, l * 0.6, { sharp: true }));
  k.box('dark', 0, y0 + h + 0.04, zc, w * 0.96, 0.08, l * 0.96, { tint: 'gun' });
  grille(k, zc + l / 2 + 0.02, y0 + h * 0.3, w * 0.62, h * 0.36, 5);
  k.box('steel', 0, y0 + 0.02, zc + l / 2 + 0.12, w * 1.04, 0.3, 0.24, { tint: 'darksteel' });
  lamps(k, zc + l / 2 + 0.03, y0 + h * 0.3, w * 0.4, 0.13);
  k.rivets('chrome', [w / 2 + 0.01, y0 + h * 0.12, zc - l * 0.42], [w / 2 + 0.01, y0 + h * 0.12, zc + l * 0.42], 5, 0.035);
  k.rivets('chrome', [-w / 2 - 0.01, y0 + h * 0.12, zc - l * 0.42], [-w / 2 - 0.01, y0 + h * 0.12, zc + l * 0.42], 5, 0.035);
  k.spot('roof', 0, y0 + h + 0.08, zc, w * 0.8, l * 0.7);
  k.roundel(w / 2 + 0.005, y0 + h * 0.42, zc - l * 0.1, Math.min(0.55, h * 0.38));
  if (!o.noHood) k.spot('hood', 0, y0 + h + 0.08, zc, w * 0.6, l * 0.5);
}
function tracks(k, d, wid = 0.8) {
  k.mir(s => {
    const x = s * d.tr / 2, len = d.wb, R = d.R * 1.04;
    k.box('track', x, R * 2 - 0.05, 0, wid, 0.1, len, { sharp: true });
    k.box('track', x, 0.05, 0, wid, 0.1, len, { sharp: true });
    for (const z of [d.fz, d.rz]) k.cyl('track', x, R, z, R, wid, 'x', { n: 12 });
    k.box('paint', x, R, 0, wid * 0.7, R * 1.3, len * 0.92, { tint: P3 });
    for (let i = 1; i < 5; i++) k.cyl('dark', x + s * wid * 0.36, R * 0.55, d.rz + i * len / 5, R * 0.36, 0.08, 'x', { n: 8, tint: 'gun' });
    k.box('dark', x, R * 1.9, 0, wid * 1.1, 0.06, len * 0.96, { tint: 'chassis' });
  });
}
/* a drive arm from the frame to the hub (static; sells the long-travel look) */
function arms(k, d, y, xIn = d.tr * 0.22) {
  for (const z of [d.fz, d.rz]) k.mir(s => {
    k.rod('dark', [s * xIn, y, z + 0.32], [s * (d.tr / 2 - 0.2), d.R, z], 0.05, { tint: 'chassis' });
    k.rod('dark', [s * xIn, y, z - 0.32], [s * (d.tr / 2 - 0.2), d.R, z], 0.05, { tint: 'chassis' });
  });
}

/* ======================================================================================================
   6. the roster: one builder per catalog body. d = { L, W, H, wb, tr, R, rh, fz, rz, ww }
      Every builder lights its nose, puts exhaust outlets (k.pipe), decal spots (k.side / k.hood) and the
      number roundel (k.roundel), and a roof spot for buddies and roof extras.
   ====================================================================================================== */
const BODY_DEFS = {
  /* ---- brutes ---- */
  monster: { shocks: { x: 0.62, y: 1.95, dz: 0.28 }, build(k, d) {
    rails(k, d, 1.02); arms(k, d, 1.02);
    k.box('paint', 0, 1.42, 0.05, 2.15, 0.5, 4.3);
    k.box('dark', 0, 1.16, 0.05, 2.0, 0.12, 4.0, { tint: 'chassis' });
    k.tb('paint', 0, 1.78, 1.35, 2.05, 0.22, 1.6, 0.92, 0.95, 0.02);
    grille(k, 2.21, 1.45, 1.5, 0.42, 4); bullbar(k, 2.4, 1.05, 1.75, 2.1); lamps(k, 2.22, 1.6, 0.82, 0.13);
    cab(k, -0.05, 1.67, 2.0, 0.72, 1.4, 0.86, 0.72, -0.05);
    k.mir(s => { k.box('paint', s * 1.02, 1.86, -1.42, 0.12, 0.38, 1.5, { tint: P2 }); });
    k.box('paint', 0, 1.86, -2.14, 2.1, 0.38, 0.1, { tint: P2 });
    k.path('chrome', [[0.86, 1.67, -0.82], [0.86, 2.48, -0.88], [-0.86, 2.48, -0.88], [-0.86, 1.67, -0.82]], 0.055);
    k.rod('chrome', [0.86, 2.48, -0.88], [0.6, 1.67, -1.95], 0.045); k.rod('chrome', [-0.86, 2.48, -0.88], [-0.6, 1.67, -1.95], 0.045);
    lightbar(k, 2.56, -0.88, 1.6, 4);
    blower(k, 0, 1.88, 1.25, 0.75);
    k.mir(s => stack(k, s * 0.95, 1.62, -0.42, 1.3, 0.09, true));
    k.mir(s => { for (const z of [d.fz, d.rz]) arch(k, 'dark', s * 1.12, z, d.R, 0.5); });
    k.rivets('chrome', [1.08, 1.6, -2.0], [1.08, 1.6, 2.0], 9);
    k.rivets('chrome', [-1.08, 1.6, -2.0], [-1.08, 1.6, 2.0], 9);
    tails(k, -2.2, 1.55, 0.8);
    k.side(1.08, 1.42, -1.2, 0.62); k.roundel(1.08, 1.42, 0.25, 0.46); k.hood(1.9, 1.5, 0.9, -0.05);
  } },
  tractor: { fs: 0.62, rs: 1.12, build(k, d) {
    rails(k, d, 0.95, 0.4);
    k.tb('paint', 0, 1.35, 1.1, 1.0, 0.72, 2.0, 0.9, 0.95);
    grille(k, 2.12, 1.32, 0.86, 0.58, 5);
    k.mir(s => k.box('dark', s * 0.52, 1.35, 1.1, 0.04, 0.42, 1.4, { tint: 'black' }));
    stack(k, 0.3, 1.71, 1.65, 0.95, 0.1, true);
    const ro = k.sub('roller', 0, 0.62, 2.6);
    ro.cyl('steel', 0, 0, 0, 0.36, 2.0, 'x', { n: 10, tint: 'darksteel' });
    for (let j = 0; j < 5; j++) aroundCone(ro, 'steel', 8, 0.36, -0.8 + j * 0.4, 0.06, 0.24, { tint: 'steel' });
    k.mir(s => { k.rod('dark', [s * 1.05, 0.62, 2.6], [s * 0.42, 0.95, 1.6], 0.07, { tint: 'chassis' }); k.cyl('dark', s * 1.06, 0.62, 2.6, 0.12, 0.12, 'x', { tint: 'gun' }); });
    k.anim((p, c, dt, t, calm, rig) => { p.roller.rotation.x = rig.wheels[0].userData.spin * (d.R * 0.62 / 0.42); });
    k.box('dark', 0, 1.3, -0.6, 1.5, 0.16, 1.5, { tint: 'chassis' });
    k.box('dark', 0, 1.6, -0.85, 0.6, 0.5, 0.12, { tint: 'black' });
    k.ring('dark', 0, 1.75, -0.2, 0.2, 'x', { t: 0.12, tint: 'black', rx: -0.6 });
    k.mir(s => arch(k, 'paint', s * d.tr / 2, d.rz, d.R * 1.12, 0.78, { tint: 0xffffff }));
    for (const [x, z] of [[0.78, 0.05], [-0.78, 0.05], [0.78, -1.3], [-0.78, -1.3]]) k.rod('dark', [x, 1.38, z], [x, 2.62, z], 0.05, { tint: 'chassis' });
    k.box('paint', 0, 2.66, -0.6, 1.75, 0.09, 1.65, { tint: P2 });
    lightbar(k, 2.78, 0.2, 1.2, 3); lamps(k, 2.12, 1.62, 0.32, 0.11);
    cones(k, 'steel', [[0.5, 0.75, -1.9], [0, 0.75, -1.9], [-0.5, 0.75, -1.9]], '-z', 0.09, 0.6, 'darksteel');
    k.box('dark', 0, 0.85, -1.75, 1.3, 0.14, 0.2, { tint: 'chassis' });
    tails(k, -1.85, 1.4, 0.6, 0.2);
    k.side(0.52, 1.36, 1.55, 0.5); k.roundel(0.52, 1.36, 0.6, 0.42); k.hood(1.72, 1.2, 0.7);
    k.spot('roof', 0, 2.72, -0.6, 1.4, 1.2);
  } },
  dino: { shocks: { x: 0.62, y: 1.9, dz: 0.28 }, build(k, d) {
    rails(k, d, 1.02); arms(k, d, 1.02);
    k.box('dark', 0, 1.36, -0.1, 1.95, 0.36, 4.1, { tint: 'chassis' });
    cab(k, -0.35, 1.54, 1.75, 0.78, 1.6, 0.84, 0.7, -0.05);
    k.mir(s => k.tb('paint', s * 0.98, 1.85, -0.35, 0.14, 0.62, 2.6, 0.6, 0.9, 0, { tint: P2 }));
    k.ball('rough', 0, 1.82, 1.55, 0.78, { d: 1, sx: 1.25, sy: 0.62, sz: 1.2, tint: 'bone' });
    k.tb('rough', 0, 1.7, 2.05, 1.1, 0.42, 0.8, 0.8, 0.6, 0.1, { tint: 'bone' });
    k.mir(s => { k.ball('dark', s * 0.42, 2.02, 1.85, 0.2, { tint: 'black' }); k.ball('glow', s * 0.44, 2.04, 1.95, 0.08, { tint: 'hot' }); });
    for (let i = 0; i < 7; i++) k.cone('rough', -0.48 + i * 0.16, 1.44, 2.38, 0.05, 0.22, '-y', { n: 4, tint: 'bone' });
    k.mir(s => k.cone('rough', s * 0.35, 2.15, 1.8, 0.1, 0.7, '+z', { n: 6, tint: 'bone', rx: -0.5 }));
    const jaw = k.sub('jaw', 0, 1.42, 1.5);
    jaw.tb('rough', 0, -0.1, 0.45, 0.95, 0.18, 0.8, 0.9, 0.8, 0.05, { tint: 'bone' });
    for (let i = 0; i < 6; i++) jaw.cone('rough', -0.36 + i * 0.145, 0.06, 0.78, 0.045, 0.18, '+y', { n: 4, tint: 'bone' });
    k.anim((p, c, dt, t, calm) => { p.jaw.rotation.x = c.boosting ? 0.35 : calm ? 0.05 : 0.05 + Math.max(0, Math.sin(t * 2.3)) * 0.12; });
    for (let i = 0; i < 4; i++) {
      const z = 0.6 - i * 0.55;
      k.path('rough', [[1.02, 1.5, z], [1.08, 2.0, z], [0.7, 2.48, z - 0.05], [0, 2.6, z - 0.08], [-0.7, 2.48, z - 0.05], [-1.08, 2.0, z], [-1.02, 1.5, z]], 0.06, { tint: 'bone' });
    }
    k.rod('rough', [0, 2.62, 0.7], [0, 2.4, -2.1], 0.07, { tint: 'bone' });
    for (let i = 0; i < 8; i++) k.cone('rough', 0, 2.66 - i * 0.03, 0.55 - i * 0.36, 0.08, 0.3 - i * 0.02, '+y', { n: 4, tint: 'bone', rx: -0.4 });
    k.mir(s => stack(k, s * 0.92, 1.55, -1.6, 1.2, 0.09));
    k.mir(s => { for (const z of [d.fz, d.rz]) arch(k, 'rough', s * 1.14, z, d.R, 0.5, { tint: 'bone' }); });
    tails(k, -2.12, 1.45, 0.7); lamps(k, 2.25, 1.35, 0.7, 0.1, 'amber');
    k.side(1.06, 1.85, -0.6, 0.55); k.roundel(1.06, 1.85, 0.25, 0.42); k.hood(2.15, 1.3, 0.6);
    k.spot('roof', 0, 2.68, -0.6, 1.0, 1.0);
  } },
  howler: { shocks: { x: 0.5, y: 1.8, dz: 0.2 }, build(k, d) {
    k.box('dark', 0, 0.95, 0, 1.2, 0.1, 3.4, { tint: 'chassis' }); arms(k, d, 0.98, 0.45);
    k.tb('paint', 0, 1.08, 1.55, 1.2, 0.36, 1.0, 0.7, 0.6, -0.1);
    const t = 0.05, hoopM = [[0.62, 0.98, -0.3], [0.64, 1.88, -0.42], [-0.64, 1.88, -0.42], [-0.62, 0.98, -0.3]], hoopF = [[0.6, 1.02, 0.95], [0.5, 1.72, 0.5], [-0.5, 1.72, 0.5], [-0.6, 1.02, 0.95]];
    k.path('paint', hoopM, t, { tint: P2 }); k.path('paint', hoopF, t, { tint: P2 });
    k.mir(s => {
      k.rod('paint', [s * 0.64, 1.88, -0.42], [s * 0.5, 1.72, 0.5], t, { tint: P2 });
      k.rod('paint', [s * 0.64, 1.88, -0.42], [s * 0.45, 1.25, -1.65], t, { tint: P2 });
      k.rod('paint', [s * 0.6, 1.02, 0.95], [s * 0.4, 1.0, 2.0], t, { tint: P2 });
      k.rod('paint', [s * 0.62, 0.98, -0.3], [s * 0.45, 1.0, -1.7], t, { tint: P2 });
      k.rod('paint', [s * 0.62, 1.35, -0.32], [s * 0.6, 1.35, 0.9], t, { tint: P2 });
    });
    k.rod('paint', [0.64, 1.88, -0.42], [-0.6, 0.98, -0.3], t, { tint: P2 });
    k.mir(s => { k.box('dark', s * 0.3, 1.2, -0.05, 0.46, 0.5, 0.5, { tint: 'black' }); k.box('dark', s * 0.3, 1.5, -0.32, 0.46, 0.6, 0.12, { tint: 'black' }); });
    v8(k, 0, 1.2, -1.15, 0.55, { filter: true });
    k.mir(s => { k.rod('chrome', [s * 0.3, 1.15, -1.5], [s * 0.35, 1.75, -1.85], 0.06); k.pipe([s * 0.35, 1.75, -1.85], [0, 0.7, -0.7]); });
    k.ring('dark', 0, 1.45, -1.95, 0.42, 'z', { t: 0.32, tint: 'rubber' });
    lightbar(k, 1.96, -0.42, 1.2, 4); lamps(k, 2.05, 1.12, 0.3, 0.11);
    k.side(0.42, 1.1, 1.45, 0.3); k.roundel(0.45, 1.08, 1.0, 0.3); k.hood(1.27, 1.5, 0.62, -0.25);
    k.spot('roof', 0, 1.95, -0.2, 1.1, 0.8);
  } },
  /* ---- haulers ---- */
  dump: { build(k, d) {
    rails(k, d, 0.78, 0.45, d.L * 0.9);
    truckCab(k, d, 2.25, 2.3, 0.9, 1.5, 1.3);
    stack(k, -1.22, 1.2, 1.5, 1.6, 0.1, true);
    const bed = k.sub('bed', 0, 1.02, -2.85);
    bed.tb('paint', 0, 0.7, 2.1, 2.36, 1.3, 4.2, 1.06, 1.02, 0.01);
    for (let i = 0; i < 6; i++) bed.mir(s => bed.box('dark', s * 1.24, 0.72, 0.35 + i * 0.7, 0.1, 1.25, 0.14, { tint: 'chassis', sharp: true }));
    bed.box('steel', 0, 1.36, 2.1, 2.55, 0.1, 4.3, { tint: 'darksteel' });
    bed.box('paint', 0, 1.42, 4.6, 2.4, 0.1, 0.9, { tint: P2 });
    const rr = rng(11);
    for (let i = 0; i < 16; i++) bed.ball(i % 3 ? 'dark' : 'glow', -0.9 + rr() * 1.8, 1.35 + rr() * 0.35, 0.6 + rr() * 3.0, 0.22 + rr() * 0.28, { tint: i % 3 ? 'gun' : (i % 2 ? 'hot' : 'molten') });
    bed.box('glow', 0, 1.33, 2.1, 2.2, 0.04, 3.9, { tint: 0x8a2a10, sharp: true });
    k.anim((p, c, dt, t, calm) => { p.bed.rotation.x = calm ? 0 : -Math.max(0, Math.sin(t * 0.25)) * 0.05; });
    tails(k, -2.92, 0.95, 0.95); k.box('hazard', 0, 0.8, -2.93, 2.3, 0.3, 0.05, { sharp: true });
    k.spot('rear', 0, 2.3, -2.6); k.side(1.24, 1.75, -0.6, 1.05);
  } },
  mixer: { build(k, d) {
    rails(k, d, 0.78, 0.45, d.L * 0.9);
    truckCab(k, d, 2.4, 2.2, 0.9, 1.45, 1.2);
    stack(k, 1.15, 1.2, 1.7, 1.5, 0.1, true);
    k.box('dark', 0, 1.05, 1.2, 1.4, 0.5, 0.4, { tint: 'chassis' }); k.box('dark', 0, 1.0, -2.2, 1.2, 0.4, 0.5, { tint: 'chassis' });
    k.cyl('steel', 0, 1.6, 1.35, 0.5, 1.1, 'x', { n: 10, tint: 'darksteel' });
    const drum = k.sub('drum', 0, 1.95, -0.6, -0.16);
    drum.cyl('paint', 0, 0, 0, 1.08, 2.4, 'z', { n: 12 });
    drum.cyl('paint', 0, 0, -1.65, 0.45, 0.9, 'z', { n: 12, r2: 2.4, tint: P2 });
    drum.cyl('paint', 0, 0, 1.55, 1.08, 0.7, 'z', { n: 12, r2: 0.55, tint: P2 });
    drum.cyl('hazard', 0, 0, 0.6, 1.1, 0.28, 'z', { n: 12 });
    for (let i = 0; i < 28; i++) { const a = i * 0.68, z = -1.2 + i * 0.09; drum.put('steel', 'cone:4', Math.cos(a) * 1.15, Math.sin(a) * 1.15, z, 0.14, 0.32, 0.14, { rz: a - HP, order: 'XYZ' }); }
    for (let i = 0; i < 3; i++) drum.ring('chrome', 0, 0, -0.9 + i * 0.8, 1.09, 'z', { t: 0.04, n: 12 });
    k.anim((p, c, dt, t, calm) => { p.drum.rotation.z += dt * ((calm ? 0.3 : 1.6) + c.speed * 0.05); });
    k.tb('steel', 0, 1.25, -2.65, 0.6, 0.12, 0.8, 0.8, 0.8, -0.2, { rx: 0.5, tint: 'darksteel' });
    tails(k, -3.0, 0.95, 0.95); k.box('hazard', 0, 0.8, -3.0, 2.3, 0.28, 0.05, { sharp: true });
    k.spot('rear', 0, 1.1, -3.0); k.side(1.11, 1.25, 2.75, 0.34);
  } },
  fire: { build(k, d) {
    rails(k, d, 0.78, 0.45, d.L * 0.9);
    truckCab(k, d, 2.55, 2.4, 0.88, 1.45, 1.3);
    k.box('paint', 0, 1.6, -0.85, 2.42, 1.45, 4.5);
    k.mir(s => { for (let j = 0; j < 3; j++) for (let i = 0; i < 6; i++) k.box('steel', s * 1.22, 1.15 + i * 0.16, -2.6 + j * 1.3, 0.04, 0.1, 1.05, { sharp: true, tint: 'steel' }); });
    k.box('dark', 0, 2.36, -0.85, 2.3, 0.06, 4.4, { tint: 'chassis' });
    const lad = k.sub('ladder', 0, 2.5, -2.6);
    lad.cyl('steel', 0, 0, 0, 0.45, 0.2, 'y', { n: 10, tint: 'darksteel' });
    lad.mir(s => lad.box('chrome', s * 0.42, 0.28, 2.0, 0.08, 0.12, 4.6, { sharp: true }));
    for (let i = 0; i < 12; i++) lad.rod('chrome', [0.42, 0.28, -0.1 + i * 0.4], [-0.42, 0.28, -0.1 + i * 0.4], 0.03);
    lad.rod('steel', [0, 0.1, 0.2], [0, 0.28, 1.4], 0.1, { tint: 'darksteel' });
    k.anim((p, c, dt, t, calm) => { p.ladder.rotation.y = calm ? 0 : Math.sin(t * 0.4) * 0.05; });
    k.cyl('steel', 0, 2.42, 2.4, 0.2, 0.15, 'y', { n: 8, tint: 'darksteel' });
    k.rod('chrome', [0, 2.5, 2.4], [0, 2.75, 3.1], 0.09); k.cone('chrome', 0, 2.8, 3.25, 0.12, 0.25, '+z', { n: 8, rx: -0.3 });
    const fa = k.sub('flashA', 0, 2.42, 2.1), fb = k.sub('flashB', 0, 2.42, 2.1);
    k.box('dark', 0, 2.38, 2.1, 1.9, 0.12, 0.25, { tint: 'black' });
    fa.box('glow', 0.6, 0.06, 0, 0.5, 0.14, 0.24, { tint: 'red', sharp: true }); fb.box('glow', -0.6, 0.06, 0, 0.5, 0.14, 0.24, { tint: 'amber', sharp: true });
    k.anim((p, c, dt, t, calm) => { const on = calm || Math.floor(t * 5) % 2 === 0; p.flashA.visible = on; p.flashB.visible = calm || !on; });
    k.mir(s => k.ring('dark', s * 1.15, 1.7, 0.85, 0.3, 'x', { t: 0.25, tint: 'red' }));
    k.box('hazard', 0, 1.3, -3.12, 2.3, 0.9, 0.05, { sharp: true }); tails(k, -3.14, 1.9, 1.0);
    stack(k, -1.0, 2.25, 1.75, 0.7, 0.08, true);
    k.side(1.22, 2.05, -0.2, 0.55); k.spot('rear', 0, 2.4, -3.0); k.spot('roof', 0, 2.42, -0.4, 1.6, 2.0);
  } },
  icecream: { build(k, d) {
    rails(k, d, 0.72, 0.45);
    k.tb('paint', 0, 1.78, -0.35, 2.3, 1.95, 4.2, 0.96, 0.98);
    k.tb('paint', 0, 1.2, 2.05, 2.25, 0.8, 0.9, 0.95, 0.8, -0.1, { tint: P2 });
    k.tb('glass', 0, 2.02, 1.78, 2.15, 0.62, 0.34, 1, 0.35, -0.3);
    k.mir(s => k.box('glass', s * 1.12, 2.02, 1.35, 0.04, 0.5, 0.6, { sharp: true }));
    grille(k, 2.52, 1.12, 1.4, 0.36, 3); k.box('steel', 0, 0.82, 2.55, 2.35, 0.28, 0.22, { tint: 'darksteel' }); lamps(k, 2.5, 1.28, 0.85, 0.13, 'cyan');
    k.box('dark', 1.16, 1.95, -0.5, 0.05, 0.7, 1.6, { tint: 'black' });
    k.box('hazard', 1.32, 2.36, -0.5, 0.38, 0.05, 1.8, { rz: -0.35 });
    const rr = rng(23);
    for (let i = 0; i < 26; i++) { const sx = i % 2 ? 1 : -1, z = -2.4 + (i >> 1) * 0.34; k.ball('rough', sx * 1.08, 2.76, z, 0.12 + rr() * 0.1, { tint: 'frost' }); if (i % 3 === 0) k.cone('ice', sx * 1.14, 2.6, z, 0.05, 0.3 + rr() * 0.25, '-y', { n: 4 }); }
    for (let i = 0; i < 8; i++) k.cone('ice', 1.2, 2.3, -1.2 + i * 0.2, 0.035, 0.18 + rr() * 0.18, '-y', { n: 4 });
    k.box('steel', 0, 2.85, 1.0, 1.2, 0.22, 0.6, { tint: 'darksteel' }); k.ring('dark', 0, 2.97, 1.0, 0.22, 'y', { t: 0.1, tint: 'black' });
    const cone = k.sub('cone', 0, 2.76, -0.7);
    cone.cone('rough', 0, 0.55, 0, 0.44, 1.1, '-y', { n: 8, tint: 0xc8924a });
    for (let i = 0; i < 3; i++) cone.ring('rough', 0, 0.75 - i * 0.22, 0, 0.36 - i * 0.08, 'y', { t: 0.06, n: 8, tint: 0x8a5a28 });
    cone.ball('rough', 0, 1.28, 0, 0.56, { d: 1, sy: 0.85, tint: 'pink' });
    for (let i = 0; i < 9; i++) { const a = i / 9 * TAU; cone.cone('rough', Math.sin(a) * 0.5, 1.02, Math.cos(a) * 0.5, 0.05, 0.22, '-y', { n: 4, tint: 'bone' }); }
    cone.mir(s => cone.ball('glow', s * 0.2, 1.38, 0.45, 0.09, { tint: 'toxic' }));
    cone.ball('rough', 0.3, 1.0, 0.35, 0.09, { tint: 'pink' }); cone.ball('rough', -0.36, 0.86, 0.2, 0.07, { tint: 'pink' });
    k.anim((p, c, dt, t, calm) => { p.cone.rotation.z = calm ? 0 : Math.sin(t * 1.7) * 0.08; p.cone.rotation.y = calm ? 0 : Math.sin(t * 0.6) * 0.3; });
    tails(k, -2.47, 1.4, 0.95); k.box('hazard', 0, 0.85, -2.48, 2.2, 0.26, 0.05, { sharp: true }); rearPipe(k, -0.7, 0.6, -2.45, 0.25, 0.08);
    k.side(1.16, 1.4, -0.5, 0.8); k.roundel(1.13, 1.55, 1.35, 0.4);
    k.spot('roof', 0, 2.78, 0.6, 1.0, 0.8); k.spot('rear', 0, 2.2, -2.45);
  } },
  schoolbus: { build(k, d) {
    rails(k, d, 0.72, 0.5, d.L * 0.9);
    k.box('paint', 0, 1.9, -0.3, 2.5, 2.2, 6.3);
    k.tb('paint', 0, 1.3, 3.2, 2.3, 1.0, 0.8, 0.9, 0.7, -0.2, { tint: P2 });
    grille(k, 3.6, 1.25, 1.4, 0.5, 4); k.box('steel', 0, 0.85, 3.62, 2.5, 0.3, 0.24, { tint: 'darksteel' }); lamps(k, 3.55, 1.45, 0.9, 0.14);
    k.box('glass', 0, 2.35, 2.86, 2.2, 0.8, 0.04, { sharp: true });
    k.mir(s => {
      k.box('glass', s * 1.26, 2.35, -0.3, 0.04, 0.7, 5.6, { sharp: true });
      for (let i = 0; i < 15; i++) k.rod('steel', [s * 1.29, 1.98, -3.0 + i * 0.4], [s * 1.29, 2.72, -3.0 + i * 0.4], 0.028, { tint: 'darksteel' });
      k.rod('steel', [s * 1.3, 2.35, -3.1], [s * 1.3, 2.35, 2.5], 0.03, { tint: 'darksteel' });
      k.box('hazard', s * 1.27, 1.06, -0.3, 0.04, 0.26, 6.0, { sharp: true });
      k.box('dark', s * 1.27, 1.6, -0.3, 0.06, 0.08, 6.2, { tint: 'black' });
    });
    for (let i = 0; i < 8; i++) k.rod('steel', [-1.0 + i * 0.28, 1.98, 2.9], [-1.0 + i * 0.28, 2.72, 2.9], 0.028, { tint: 'darksteel' });
    k.tb('steel', 0, 3.22, 2.75, 2.6, 0.5, 0.7, 1, 0.25, 0.4, { tint: 'darksteel' }); k.box('hazard', 0, 3.02, 3.12, 2.6, 0.1, 0.05, { sharp: true });
    for (const [z, nm] of [[0.6, 't1'], [-1.8, 't2']]) {
      const tu = k.sub(nm, 0, 3.0, z); tu.dome('steel', 0, 0, 0, 0.5, { tint: 'darksteel' }); tu.cyl('dark', 0, 0.15, 0.55, 0.07, 0.6, 'z', { tint: 'black' }); tu.box('glow', 0, 0.22, 0.38, 0.3, 0.05, 0.05, { tint: 'hot', sharp: true });
    }
    k.anim((p, c, dt, t, calm) => { if (calm) return; p.t1.rotation.y = Math.sin(t * 0.7) * 0.6; p.t2.rotation.y = Math.PI + Math.sin(t * 0.5 + 1) * 0.7; });
    for (const x of [1.1, -1.1]) for (const z of [2.75, -3.35]) k.ball('glow', x, 3.05, z, 0.1, { tint: 'amber' });
    tails(k, -3.47, 1.4, 1.0); k.box('hazard', 0, 0.9, -3.47, 2.4, 0.3, 0.05, { sharp: true }); k.mir(s => stack(k, s * 1.12, 2.6, -3.2, 0.9, 0.09, true));
    k.side(1.28, 1.42, -1.6, 0.85); k.roundel(1.28, 1.4, 0.9, 0.55); k.hood(1.81, 3.25, 0.7);
    k.spot('roof', 0, 3.0, -0.6, 1.6, 2.0); k.spot('rear', 0, 2.4, -3.4);
  } },
  ambulance: { skip: 'bar', build(k, d) {
    rails(k, d, 0.75, 0.45);
    truckCab(k, d, 1.95, 2.3, 0.88, 1.4, 1.1);
    k.box('paint', 0, 1.78, -0.78, 2.42, 1.95, 3.9, { tint: P2 });
    k.mir(s => { plates(k, s * 1.24, 1.35, -0.78, 0.06, 0.6, 3.5); plates(k, s * 1.24, 2.25, -0.78, 0.06, 0.55, 3.5, 'steel'); });
    k.mir(s => { const x = s * 1.29, y = 1.82; for (const [a, b] of [[[x, y, -2.2], [x, y, -1.5]], [[x, y, -1.5], [x, y + 0.35, -1.25]], [[x, y + 0.35, -1.25], [x, y - 0.4, -0.85]], [[x, y - 0.4, -0.85], [x, y, -0.6]], [[x, y, -0.6], [x, y, 0.4]]]) k.rod('glow', a, b, 0.035, { tint: 'toxic' }); });
    for (const [x, nm, tint] of [[0.95, 'b1', 'red'], [-0.95, 'b2', 'amber']]) {
      k.cyl('dark', x, 2.8, 1.0, 0.18, 0.08, 'y', { tint: 'black' });
      const b = k.sub(nm, x, 2.9, 1.0); b.dome('glow', 0, -0.06, 0, 0.18, { tint, sy: 1.4 }); b.box('glow', 0, 0.02, 0, 0.06, 0.16, 0.3, { tint: 0x111111, sharp: true });
    }
    k.anim((p, c, dt, t, calm) => { if (calm) return; p.b1.rotation.y = t * 6; p.b2.rotation.y = -t * 6; });
    bullbar(k, 2.8, 0.7, 1.5, 2.2, 0.07); stack(k, -1.2, 1.3, 1.3, 1.6, 0.09, true);
    tails(k, -2.75, 1.4, 1.0); k.box('hazard', 0, 0.95, -2.76, 2.3, 0.3, 0.05, { sharp: true });
    k.side(1.3, 2.3, -1.6, 0.55);
    k.spot('roof', 0, 2.76, -0.8, 1.6, 2.4); k.spot('rear', 0, 2.3, -2.7);
  } },
  tusk: { build(k, d) {
    rails(k, d, 0.82, 0.5, d.L * 0.92);
    k.tb('paint', 0, 1.5, 1.95, 1.95, 0.95, 2.0, 0.88, 0.95);
    grille(k, 2.96, 1.42, 1.5, 0.78, 6);
    cab(k, 0.25, 1.02, 2.3, 1.55, 1.5, 0.9, 0.8, -0.05, { g0: 0.58, g1: 0.78 });
    k.mir(s => { stack(k, s * 1.12, 1.3, -0.55, 2.0, 0.12, true); k.box('steel', s * 1.15, 1.95, -0.55, 0.08, 0.6, 0.3, { tint: 'darksteel' }); });
    k.box('steel', 0, 0.85, 3.05, 2.6, 0.4, 0.3, { tint: 'darksteel' });
    cones(k, 'steel', [[0.9, 0.85, 3.2], [0.3, 0.85, 3.2], [-0.3, 0.85, 3.2], [-0.9, 0.85, 3.2]], '+z', 0.1, 0.4, 'steel');
    k.mir(s => {
      k.path('rough', [[s * 1.0, 0.95, 3.0], [s * 1.25, 1.05, 3.6], [s * 1.3, 1.45, 4.05]], 0.16, { tint: 'bone' });
      k.cone('rough', s * 1.3, 1.75, 4.15, 0.16, 0.65, '+y', { n: 6, tint: 'bone', rx: 0.35 });
      k.ring('steel', s * 1.1, 0.98, 3.28, 0.2, 'z', { t: 0.2, tint: 'darksteel', rx: 0.5 });
    });
    lamps(k, 2.97, 2.05, 0.55, 0.12, 'amber');
    k.box('steel', 0, 1.05, -1.6, 2.2, 0.14, 2.2, { tint: 'darksteel' }); k.cyl('steel', 0, 1.15, -1.8, 0.6, 0.08, 'y', { n: 10 });
    k.path('dark', [[0.95, 1.1, -2.9], [0.95, 2.1, -2.8], [-0.95, 2.1, -2.8], [-0.95, 1.1, -2.9]], 0.07, { tint: 'chassis' });
    k.box('rust', 0.5, 1.45, -2.3, 0.7, 0.55, 0.6); k.box('dark', -0.5, 1.4, -2.3, 0.7, 0.5, 0.6, { tint: 'olive' });
    for (let i = 0; i < 3; i++) k.cone('steel', -0.9 + i * 0.9, 2.18, -2.8, 0.07, 0.3, '+y', { n: 5, tint: 'steel' });
    tails(k, -3.0, 1.1, 1.0);
    k.side(1.17, 1.9, 0.0, 0.55); k.roundel(0.88, 1.5, 1.7, 0.45); k.hood(1.99, 1.9, 1.0, -0.03);
    k.spot('rear', 0, 2.2, -2.8);
  } },
  dredge: { build(k, d) {
    rails(k, d, 1.25, 0.55, d.L * 0.9);
    k.tb('paint', 0, 2.42, -0.6, 3.2, 1.4, 4.6, 1.05, 1.08, 0.03);
    for (let i = 0; i < 6; i++) k.mir(s => k.box('dark', s * 1.66, 2.45, -2.6 + i * 0.75, 0.1, 1.3, 0.14, { tint: 'chassis', sharp: true, rz: s * 0.04 }));
    k.box('paint', 0, 3.15, 2.25, 3.3, 0.14, 1.5, { tint: P2 });
    k.box('dark', 0, 1.58, 2.35, 3.0, 0.22, 1.5, { tint: 'chassis' });
    k.box('paint', 0.85, 2.2, 2.4, 1.0, 0.95, 1.0); k.box('glass', 0.85, 2.38, 2.92, 0.85, 0.45, 0.04, { sharp: true }); k.box('glass', 1.36, 2.38, 2.4, 0.04, 0.45, 0.7, { sharp: true });
    grille(k, 3.08, 1.85, 1.1, 0.8, 6, 'steel');
    k.rod('hazard', [-1.4, 0.5, 3.0], [-0.9, 1.6, 2.9], 0.06);
    k.path('dark', [[-1.45, 1.68, 3.05], [-1.45, 2.3, 3.05], [1.45, 2.3, 3.05]], 0.04, { tint: 'yellow' });
    k.box('hazard', 0, 1.25, 3.12, 3.1, 0.3, 0.12, { sharp: true });
    k.mir(s => stack(k, s * 0.4, 2.6, 1.95, 1.3, 0.11, true));
    lamps(k, 3.1, 2.6, 1.3, 0.14);
    tails(k, -2.95, 1.6, 1.3);
    k.side(1.64, 2.45, -0.8, 1.2); k.roundel(1.36, 2.15, 2.4, 0.4);
    k.spot('roof', 0, 3.25, 2.2, 2.4, 1.0); k.spot('rear', 0, 2.8, -2.9);
  } },
  wrecker: { build(k, d) {
    rails(k, d, 0.8, 0.45, d.L * 0.9);
    k.tb('paint', 0, 1.25, 1.95, 1.8, 0.7, 1.6, 0.9, 0.95);
    grille(k, 2.76, 1.2, 1.3, 0.55, 5); k.box('steel', 0, 0.82, 2.82, 2.3, 0.3, 0.24, { tint: 'darksteel' }); lamps(k, 2.75, 1.4, 0.7, 0.13);
    cab(k, 0.6, 0.95, 2.1, 1.35, 1.25, 0.9, 0.8, -0.05);
    stack(k, -1.0, 1.25, 0.0, 1.5, 0.09, true);
    k.box('steel', 0, 1.12, -1.4, 2.3, 0.14, 2.6, { tint: 'darksteel' });
    k.mir(s => k.box('rust', s * 1.0, 1.45, -1.4, 0.3, 0.55, 2.2));
    k.cyl('steel', 0, 1.42, -0.5, 0.25, 1.2, 'x', { n: 10, tint: 'darksteel' }); k.ring('hazard', 0, 1.42, -0.5, 0.26, 'x', { t: 0.08 });
    const boom = k.sub('boom', 0, 1.35, -1.9, -0.55);
    boom.tb('dark', 0, 0.9, 0, 0.32, 1.8, 0.4, 0.8, 0.8, 0, { tint: 'yellow' });
    boom.box('hazard', 0, 1.75, 0.0, 0.34, 0.12, 0.5, { sharp: true });
    boom.cyl('chrome', 0, 0.6, 0.35, 0.06, 1.0, 'y', { n: 6 });
    const hook = boom.sub('hook', 0, 1.8, -0.25, 0.55);
    for (let i = 0; i < 6; i++) hook.put('steel', 'tor:6:0.2', 0, -0.12 - i * 0.14, 0, 0.14, 0.18, 0.14, { ry: i % 2 ? HP : 0, tint: 'darksteel' });
    hook.ring('steel', 0, -1.05, 0.06, 0.16, 'x', { t: 0.22, n: 8, tint: 'darksteel' }); hook.cone('steel', 0, -1.2, 0.22, 0.05, 0.15, '+y', { n: 4, tint: 'darksteel' });
    k.anim((p, c, dt, t, calm, rig) => { p.hook.rotation.x = 0.55 + (calm ? 0 : Math.sin(t * 1.9) * 0.08) + Math.max(-0.4, Math.min(0.4, rig.sway.ax * 0.03)); });
    for (const x of [0.75, -0.75]) { const b = k.sub(x > 0 ? 'b1' : 'b2', x, 2.38, 0.6); b.dome('glow', 0, 0, 0, 0.16, { tint: 'amber', sy: 1.3 }); b.box('glow', 0, 0.06, 0, 0.05, 0.14, 0.28, { tint: 0x111111, sharp: true }); }
    k.anim((p, c, dt, t, calm) => { if (calm) return; p.b1.rotation.y = t * 5; p.b2.rotation.y = -t * 5 + 1; });
    tails(k, -2.75, 1.0, 1.0); k.box('hazard', 0, 0.85, -2.76, 2.3, 0.25, 0.05, { sharp: true });
    k.side(1.06, 1.55, 0.6, 0.5); k.roundel(0.86, 1.25, 1.95, 0.4); k.hood(1.6, 2.0, 0.8);
    k.spot('rear', 0, 1.9, -2.6);
  } },
  /* ---- tanks ---- */
  digger: { tracked: true, frame: { l: 6.6, h: 3.6 }, build(k, d) {
    tracks(k, d, 0.82);
    k.box('dark', 0, d.R * 1.3, 0, d.tr * 0.7, 0.4, d.wb * 0.8, { tint: 'chassis' });
    const house = k.sub('house', 0, 1.3, -0.2);
    house.cyl('steel', 0, -0.06, 0, 1.0, 0.14, 'y', { n: 14, tint: 'darksteel' });
    house.box('paint', 0, 0.5, -0.45, 2.6, 0.95, 2.9);
    house.box('dark', 0, 0.48, -1.95, 2.6, 0.92, 0.7, { tint: 'gun' }); house.box('hazard', 0, 0.48, -2.31, 2.5, 0.5, 0.05, { sharp: true });
    house.box('paint', 0.72, 1.55, 0.55, 1.0, 1.2, 1.2, { tint: P2 });
    house.box('glass', 0.72, 1.65, 1.16, 0.85, 0.85, 0.04, { sharp: true }); house.box('glass', 1.23, 1.65, 0.55, 0.04, 0.8, 0.95, { sharp: true });
    house.box('dark', 0.72, 2.18, 0.55, 1.1, 0.08, 1.3, { tint: 'gun' });
    house.mir(s => house.box('dark', -0.55 + s * 0.3, 1.0, -1.0, 0.04, 0.12, 1.4, { tint: 'black' }));
    stack(house, -0.9, 0.95, -1.2, 0.9, 0.09, true); k.pipe([-0.9, 3.2, -1.4], [0, 1, 0]);
    const arm = house.sub('arm', -0.35, 0.95, 0.9);
    arm.tb('dark', 0, 1.1, 0.6, 0.38, 2.4, 0.5, 0.9, 0.8, 1.4, { rx: 0.62, tint: 'yellow' });
    arm.rod('chrome', [0.25, 0.2, 0.3], [0.25, 1.6, 1.4], 0.06); arm.rod('chrome', [-0.25, 0.2, 0.3], [-0.25, 1.6, 1.4], 0.06);
    arm.tb('dark', 0, 1.25, 2.7, 0.32, 1.6, 0.42, 0.9, 0.9, -0.6, { rx: -0.25, tint: 'yellow' });
    arm.tb('steel', 0, 0.35, 3.15, 0.95, 0.75, 0.7, 1.1, 0.6, 0.3, { tint: 'darksteel' });
    for (let i = 0; i < 5; i++) arm.cone('steel', -0.36 + i * 0.18, -0.05, 3.32, 0.06, 0.24, '-y', { n: 4, rx: 0.4, tint: 'steel' });
    k.anim((p, c, dt, t, calm) => { if (!calm) { p.arm.rotation.x = Math.sin(t * 0.8) * 0.1 - 0.05; p.house.rotation.y = Math.sin(t * 0.3) * 0.08; } });
    lamps(k, 1.45, 2.7, 0.4, 0.09);
    k.side(1.31, 1.8, -0.7, 0.75); k.roundel(1.23, 2.95, 0.4, 0.38);
    k.spot('roof', 0.72, 3.56, 0.35, 0.8, 0.9); k.spot('rear', 0, 2.2, -2.5); k.spot('hood', -0.6, 2.3, -0.8, 1.0, 1.2);
  } },
  bulldozer: { tracked: true, build(k, d) {
    tracks(k, d, 0.85);
    k.box('dark', 0, d.R * 1.3, 0, d.tr * 0.7, 0.4, d.wb * 0.8, { tint: 'chassis' });
    k.tb('paint', 0, 1.6, 0.55, 1.7, 0.95, 2.2, 0.88, 0.95);
    k.mir(s => k.box('dark', s * 0.86, 1.6, 0.6, 0.04, 0.5, 1.6, { tint: 'black' }));
    stack(k, 0.35, 2.05, 1.2, 0.85, 0.09, true);
    k.box('paint', 0, 1.35, -1.15, 2.3, 0.5, 1.7, { tint: P2 });
    for (const [x, z] of [[0.92, -0.35], [-0.92, -0.35], [0.92, -1.95], [-0.92, -1.95]]) k.rod('dark', [x, 1.6, z], [x, 2.74, z], 0.06, { tint: 'chassis' });
    k.box('paint', 0, 2.8, -1.15, 2.05, 0.12, 1.85);
    k.box('glass', 0, 2.2, -1.15, 1.6, 1.0, 1.4, { sharp: true });
    k.box('paint', 0, 0.98, 2.78, 3.3, 0.72, 0.18, { rx: -0.32 }); k.box('paint', 0, 0.42, 2.9, 3.3, 0.42, 0.18, { rx: 0.25, tint: P2 });
    k.box('hazard', 0, 1.36, 2.62, 3.3, 0.12, 0.2, { sharp: true });
    k.mir(s => k.box('paint', s * 1.66, 0.8, 2.75, 0.1, 1.0, 0.5, { tint: P3 }));
    for (let i = 0; i < 9; i++) k.cone('steel', -1.5 + i * 0.375, 0.2, 3.05, 0.08, 0.28, '+z', { n: 4, rx: 0.4, tint: 'steel' });
    k.mir(s => { k.rod('dark', [s * 1.15, 0.6, 1.4], [s * 1.2, 0.7, 2.65], 0.1, { tint: 'chassis' }); k.rod('chrome', [s * 0.7, 1.9, 1.5], [s * 0.9, 1.2, 2.6], 0.07); });
    k.box('dark', 0, 1.0, -2.2, 1.6, 0.18, 0.25, { tint: 'chassis' });
    cones(k, 'steel', [[0.6, 0.6, -2.35], [0, 0.6, -2.35], [-0.6, 0.6, -2.35]], '-y', 0.1, 0.55, 'darksteel');
    lamps(k, 1.68, 1.95, 0.55, 0.1); lightbar(k, 2.92, -0.3, 1.4, 3);
    k.side(1.17, 1.38, -1.15, 0.45); k.roundel(0.86, 1.62, 0.6, 0.4); k.hood(2.08, 0.6, 0.9);
    k.spot('roof', 0, 2.86, -1.15, 1.6, 1.4); k.spot('rear', 0, 1.7, -2.0);
  } },
  train: { build(k, d) {
    k.box('dark', 0, 1.05, 0, 2.3, 0.26, 5.9, { tint: 'chassis' });
    k.cyl('paint', 0, 1.95, 0.85, 0.85, 3.4, 'z', { n: 12 });
    for (let i = 0; i < 5; i++) k.ring('chrome', 0, 1.95, -0.6 + i * 0.7, 0.86, 'z', { t: 0.04, n: 12, tint: 'gold' });
    k.cyl('dark', 0, 1.95, 2.72, 0.88, 0.36, 'z', { n: 12, tint: 'gun' });
    k.cyl('dark', 0, 1.95, 2.92, 0.72, 0.06, 'z', { n: 12, tint: 'black' }); boltRingZ(k, 10, 0.6, 1.95, 2.96);
    k.cyl('dark', 0, 2.92, 2.75, 0.32, 0.34, 'z', { n: 10, tint: 'black' }); k.cyl('glow', 0, 2.92, 2.93, 0.25, 0.04, 'z', { n: 10, tint: 'light' });
    k.cyl('dark', 0, 3.0, 2.25, 0.2, 0.8, 'y', { n: 10, r2: 1.9, tint: 'gun' }); k.ring('chrome', 0, 3.42, 2.25, 0.36, 'y', { t: 0.08, tint: 'copper' });
    k.pipe([0, 3.42, 2.25], [0, 1, 0], 1.4);
    k.dome('chrome', 0, 2.74, 1.25, 0.36, { tint: 'gold' }); k.dome('paint', 0, 2.74, 0.2, 0.3, { tint: P2 });
    k.cone('chrome', 0, 2.95, 1.25, 0.08, 0.2, '+y', { tint: 'gold' });
    k.box('paint', 0, 2.25, -1.85, 2.5, 1.9, 1.7, { tint: P2 });
    k.box('dark', 0, 3.24, -1.85, 2.75, 0.12, 1.95, { tint: 'gun' });
    k.mir(s => k.box('glass', s * 1.26, 2.6, -1.85, 0.04, 0.6, 0.9, { sharp: true }));
    k.box('glow', 0, 1.6, -2.71, 1.0, 0.5, 0.04, { tint: 'hot', sharp: true });
    for (let i = 0; i < 9; i++) { const x = -1.0 + i * 0.25; k.rod('steel', [x, 1.0, 2.95], [x * 0.35, 0.12, 3.5], 0.04, { tint: 'darksteel' }); }
    k.rod('steel', [1.05, 1.0, 2.98], [-1.05, 1.0, 2.98], 0.06, { tint: 'darksteel' });
    k.mir(s => { k.cyl('steel', s * 1.05, 1.25, 2.3, 0.22, 0.8, 'z', { n: 8, tint: 'darksteel' }); k.cyl('chrome', s * 1.05, 1.25, 2.72, 0.12, 0.06, 'z', { n: 8 }); });
    const ox = d.tr / 2 + d.ww / 2 + 0.06;
    k.mir(s => { const rod = k.sub(s > 0 ? 'rodL' : 'rodR', s * ox, d.R, 0); rod.box('steel', 0, 0, 0, 0.07, 0.14, d.wb + 0.3, { tint: 'steel', sharp: true }); rod.mir(m => rod.cyl('chrome', 0, 0, m * d.wb / 2, 0.1, 0.1, 'x', { n: 8 })); });
    k.anim((p, c, dt, t, calm, rig) => { const a = rig.wheels[2].userData.spin, cr = d.R * 0.42; for (const nm of ['rodL', 'rodR']) { p[nm].position.y = d.R + Math.cos(a) * cr; p[nm].position.z = Math.sin(a) * cr; } });
    tails(k, -2.73, 1.3, 1.0);
    k.side(1.26, 1.85, -1.85, 0.7); k.roundel(0.88, 1.95, 1.55, 0.5);
    k.spot('roof', 0, 3.3, -1.85, 1.8, 1.4); k.spot('hood', 0, 2.82, 0.7, 0.8, 1.6); k.spot('rear', 0, 2.6, -2.7);
  } },
  anvil: { build(k, d) {
    rails(k, d, 0.95, 0.55, d.L * 0.9);
    k.tb('paint', 0, 1.9, 1.75, 3.0, 1.6, 2.5, 0.82, 0.42, -0.25);
    band(k, 'glass', 0, 1.1, 1.75, 3.0, 1.6, 2.5, 0.82, 0.42, -0.25, 0.7, 0.8, 1.02);
    k.tb('paint', 0, 2.05, -1.55, 3.0, 1.9, 3.2, 1.07, 1.06, 0, { tint: P2 });
    for (let i = 0; i < 5; i++) k.mir(s => k.box('dark', s * 1.58, 2.05, -2.9 + i * 0.68, 0.1, 1.8, 0.14, { tint: 'chassis', sharp: true }));
    const rr = rng(41);
    for (let i = 0; i < 18; i++) k.ball(i % 4 ? 'dark' : 'glow', -1.2 + rr() * 2.4, 3.0 + rr() * 0.25, -2.9 + rr() * 2.7, 0.22 + rr() * 0.3, { tint: i % 4 ? 'gun' : 'hot', d: 0 });
    k.tb('steel', 0, 1.05, 3.05, 2.6, 0.65, 0.65, 1.15, 1.6, 0.2, { tint: 'darksteel' });
    k.cone('steel', 0, 1.2, 3.85, 0.3, 1.0, '+z', { n: 8, tint: 'darksteel' });
    k.mir(s => { plates(k, s * 1.52, 1.15, 0, 0.08, 0.5, 5.6); for (const z of [d.fz, d.rz]) arch(k, 'dark', s * 1.45, z, d.R, 0.7); });
    k.mir(s => stack(k, s * 1.25, 2.4, 0.2, 1.35, 0.13, true));
    k.rivets('chrome', [1.0, 2.62, 2.2], [-1.0, 2.62, 2.2], 8, 0.05);
    lamps(k, 3.0, 1.5, 1.1, 0.15, 'amber'); lightbar(k, 2.78, 1.1, 1.8, 5);
    tails(k, -3.18, 1.4, 1.3); k.box('hazard', 0, 1.0, -3.18, 2.8, 0.4, 0.05, { sharp: true });
    k.side(1.6, 2.1, -1.5, 1.1); k.roundel(1.42, 1.9, 1.3, 0.5);
    k.spot('roof', 0, 2.72, 1.4, 1.8, 0.8); k.spot('rear', 0, 3.0, -3.0); k.spot('hood', 0, 2.72, 2.1, 1.4, 0.5);
  } },
  bulwark: { build(k, d) {
    k.tb('paint', 0, 1.25, 0, 2.6, 0.9, 6.0, 1.1, 0.96);
    k.tb('paint', 0, 2.05, -0.35, 2.86, 0.7, 5.3, 0.84, 0.86, -0.02, { tint: P2 });
    k.tb('paint', 0, 1.45, 3.0, 2.6, 0.82, 0.62, 1.0, 0.1, -0.45);
    k.cyl('steel', 0.5, 2.5, 0.6, 0.45, 0.25, 'y', { n: 10, tint: 'darksteel' }); k.dome('steel', 0.5, 2.62, 0.6, 0.36, { tint: 'darksteel' });
    for (let i = 0; i < 4; i++) { const a = i / 4 * TAU; k.box('glass', 0.5 + Math.sin(a) * 0.42, 2.56, 0.6 + Math.cos(a) * 0.42, 0.18, 0.08, 0.06, { ry: a, sharp: true }); }
    k.box('steel', -0.5, 2.42, -1.4, 0.9, 0.08, 0.9, { tint: 'darksteel' }); k.rivets('chrome', [-0.9, 2.47, -1.4], [-0.1, 2.47, -1.4], 5);
    k.mir(s => { for (let i = 0; i < 3; i++) k.cyl('dark', s * (1.1 - i * 0.15), 2.5, 1.9, 0.07, 0.36, 'z', { n: 6, rx: -0.6, tint: 'black' }); });
    k.mir(s => k.rod('dark', [s * 1.1, 2.4, -2.6], [s * 1.25, 4.2, -2.9], 0.018, { tint: 'black' }));
    k.mir(s => { k.box('dark', s * 1.48, 1.55, -0.3, 0.12, 0.42, 5.6, { tint: 'olive' }); k.rivets('chrome', [s * 1.55, 1.7, -2.9], [s * 1.55, 1.7, 2.3], 10); });
    k.box('rust', 0, 2.5, -2.5, 1.6, 0.35, 0.7); k.box('dark', 0.9, 1.9, 2.7, 0.5, 0.3, 0.3, { tint: 'olive' });
    lamps(k, 3.0, 1.55, 1.05, 0.12); k.box('glass', 0, 1.85, 2.92, 1.4, 0.1, 0.04, { rx: -0.9, sharp: true });
    k.mir(s => { k.box('dark', s * 1.3, 2.2, -2.2, 0.2, 0.3, 0.6, { tint: 'gun' }); k.pipe([s * 1.42, 2.25, -2.3], [s * 0.6, 0.5, -0.6]); });
    tails(k, -3.0, 1.4, 1.1); k.box('hazard', 0, 1.0, -3.0, 2.4, 0.3, 0.05, { sharp: true });
    k.side(1.32, 1.25, -0.6, 0.85); k.roundel(1.18, 2.05, 1.2, 0.5); k.hood(2.45, 1.6, 0.8);
    k.spot('roof', -0.4, 2.42, -0.6, 1.4, 1.8); k.spot('rear', 0, 2.4, -2.9);
  } },
  /* ---- racers ---- */
  police: { build(k, d) {
    k.tb('paint', 0, 0.63, 0, 2.1, 0.66, 4.8, 0.95, 0.96);
    k.tb('paint', 0, 0.63, 2.25, 2.0, 0.56, 0.55, 0.98, 0.35, -0.3, { tint: P2 });
    cab(k, -0.3, 0.96, 1.72, 0.52, 2.2, 0.8, 0.6, -0.08);
    k.mir(s => plates(k, s * 1.06, 0.62, -0.3, 0.06, 0.42, 1.7));
    bullbar(k, 2.62, 0.35, 0.95, 1.5, 0.06);
    cones(k, 'steel', [[0.5, 0.65, 2.7], [-0.5, 0.65, 2.7]], '+z', 0.07, 0.3, 'steel');
    grille(k, 2.5, 0.55, 1.2, 0.26, 3); lamps(k, 2.5, 0.78, 0.75, 0.11);
    const bar = k.sub('bar', 0, 1.53, -0.25);
    bar.box('dark', 0, 0, 0, 1.3, 0.1, 0.3, { tint: 'black' });
    const fa = bar.sub('flashA', 0, 0.09, 0), fb = bar.sub('flashB', 0, 0.09, 0);
    fa.box('glow', 0.35, 0, 0, 0.52, 0.12, 0.26, { tint: 'red', sharp: true }); fb.box('glow', -0.35, 0, 0, 0.52, 0.12, 0.26, { tint: 'amber', sharp: true });
    k.anim((p, c, dt, t, calm) => { const on = calm || Math.floor(t * 6) % 2 === 0; p.flashA.visible = on; p.flashB.visible = calm || !on; });
    k.box('paint', 0, 1.06, -2.35, 1.9, 0.06, 0.4, { tint: P3 }); k.mir(s => k.box('dark', s * 0.85, 0.98, -2.35, 0.06, 0.14, 0.3, { tint: 'black' }));
    k.mir(s => rearPipe(k, s * 0.55, 0.35, -2.35, 0.3, 0.07));
    tails(k, -2.41, 0.78, 0.75, 0.32, 0.12);
    k.side(1.06, 0.62, 1.5, 0.42); k.roundel(1.1, 0.62, -0.3, 0.4); k.hood(0.98, 1.55, 0.8, -0.1);
    k.spot('rear', 0, 1.1, -2.3);
  } },
  race: { skip: 'wing', fs: 0.62, rs: 1.45, build(k, d) {
    k.tb('paint', 0, 0.55, 0.3, 0.72, 0.4, 4.6, 0.7, 0.9);
    k.cone('paint', 0, 0.55, 2.9, 0.26, 0.6, '+z', { n: 8, tint: P2 });
    k.rod('steel', [1.0, 0.26, 2.4], [-1.0, 0.26, 2.4], 0.05, { tint: 'darksteel' });
    k.mir(s => k.rod('steel', [s * 0.25, 0.45, 2.1], [s * 0.85, 0.26, 2.4], 0.035, { tint: 'darksteel' }));
    v8(k, 0, 0.88, 0.45, 0.62, { blower: true, stacks: true });
    k.mir(s => { for (let i = 0; i < 4; i++) { const z = 0.25 + i * 0.13; k.rod('chrome', [s * 0.22, 0.85, z], [s * 0.42, 1.12, z - 0.18], 0.035, { tint: 'copper' }); if (i === 1) k.pipe([s * 0.42, 1.12, z - 0.18], [s * 0.4, 0.75, -0.5], 0.6); } });
    k.path('chrome', [[0.3, 0.72, -0.4], [0.28, 1.25, -0.6], [-0.28, 1.25, -0.6], [-0.3, 0.72, -0.4]], 0.04);
    k.rod('chrome', [0, 1.25, -0.6], [0, 0.8, 0.0], 0.035);
    k.box('dark', 0, 0.8, -0.9, 0.5, 0.42, 0.5, { tint: 'black' });
    k.box('glass', 0, 0.95, -0.25, 0.5, 0.2, 0.04, { rx: -0.6, sharp: true });
    k.mir(s => k.rod('dark', [s * 0.35, 0.75, -2.0], [s * 0.45, 1.6, -2.35], 0.04, { tint: 'chassis' }));
    k.tb('paint', 0, 1.65, -2.4, 1.9, 0.08, 0.6, 1, 0.8, -0.05, { tint: P2 });
    k.mir(s => k.box('dark', s * 0.96, 1.62, -2.4, 0.04, 0.45, 0.7, { tint: 'black' }));
    k.cyl('steel', 0, d.R * 1.45, d.rz, 0.12, d.tr - 0.4, 'x', { n: 8, tint: 'darksteel' });
    k.box('dark', 0, 0.62, -2.6, 0.4, 0.3, 0.3, { tint: 'black' }); tails(k, -2.76, 0.62, 0.12, 0.12, 0.08);
    lamps(k, 2.75, 0.6, 0.15, 0.06, 'light');
    k.side(0.36, 0.55, 1.6, 0.34); k.roundel(0.37, 0.56, -1.5, 0.32); k.hood(0.76, 1.4, 0.5);
    k.spot('roof', 0, 1.3, -0.6, 0.5, 0.4); k.spot('rear', 0, 1.7, -2.4); k.spot('hood', 0, 1.6, 0.45, 0.5, 0.6);
  } },
  rocket: { skip: 'wing', build(k, d) {
    k.cyl('paint', 0, 0.75, -0.2, 0.5, 3.6, 'z', { n: 10 });
    k.cone('paint', 0, 0.75, 2.2, 0.5, 1.2, '+z', { n: 10, tint: P2 });
    k.cone('chrome', 0, 0.75, 2.86, 0.06, 0.2, '+z', { n: 6 });
    k.mir(s => { k.cyl('paint', s * 0.88, 0.48, -0.1, 0.17, 2.8, 'z', { n: 8, tint: P3 }); k.cone('paint', s * 0.88, 0.48, 1.45, 0.17, 0.4, '+z', { n: 8, tint: P3 }); k.box('dark', s * 0.6, 0.6, -0.1, 0.5, 0.06, 1.2, { tint: 'chassis' }); });
    k.ball('glass', 0, 1.12, 0.6, 0.38, { d: 1, sz: 2.0, sy: 0.75 });
    k.tb('paint', 0, 1.45, -1.75, 0.05, 0.9, 1.0, 1, 0.45, -0.3, { tint: P2 });
    k.mir(s => k.tb('paint', s * 0.7, 0.85, -1.7, 0.05, 0.9, 0.9, 1, 0.4, -0.3, { rz: s * 1.0, tint: P2 }));
    k.cyl('dark', 0, 0.75, -2.3, 0.42, 0.6, 'z', { n: 10, r2: 1.25, tint: 'gun' });
    k.cyl('glow', 0, 0.75, -2.62, 0.34, 0.04, 'z', { n: 10, tint: 'hot' });
    k.pipe([0, 0.75, -2.62], [0, 0, -1], 2.2);
    for (let i = 0; i < 4; i++) k.ring('chrome', 0, 0.75, 1.3 - i * 0.85, 0.51, 'z', { t: 0.03, n: 10, tint: 'steel' });
    k.mir(s => k.rivets('chrome', [s * 0.5, 0.75, 1.4], [s * 0.5, 0.75, -1.9], 9, 0.03));
    lamps(k, 1.65, 0.48, 0.88, 0.08, 'cyan');
    k.side(0.51, 0.75, 0.2, 0.42); k.roundel(0.5, 0.78, -1.0, 0.36); k.hood(1.26, 1.5, 0.35);
    k.spot('roof', 0, 1.42, 0.3, 0.4, 0.5); k.spot('rear', 0, 1.25, -2.2);
  } },
  limo: { build(k, d) {
    k.tb('paint', 0, 0.68, 0, 2.1, 0.76, 6.5, 0.97, 0.98);
    cab(k, -0.55, 1.06, 1.82, 0.58, 4.4, 0.88, 0.94, -0.02);
    k.mir(s => { k.box('chrome', s * 1.05, 0.82, 0, 0.03, 0.05, 6.2, { sharp: true }); k.tb('chrome', s * 0.92, 1.28, -2.0, 0.04, 0.3, 0.7, 1, 0.6, 0, { tint: 'chrome' }); k.tb('chrome', s * 0.92, 1.48, -2.0, 0.04, 0.12, 0.42, 1, 0.5, 0); });
    grille(k, 3.25, 0.62, 1.4, 0.36, 5);
    for (const x of [-0.42, 0, 0.42]) { k.ball('chrome', x, 0.66, 3.33, 0.14, { d: 1, sy: 1.1 }); k.mir(m => k.ball('dark', x + m * 0.05, 0.69, 3.45, 0.035, { tint: 'black' })); }
    k.ball('chrome', 0, 1.13, 2.55, 0.1, { d: 1 }); k.mir(s => k.tb('chrome', s * 0.16, 1.15, 2.5, 0.25, 0.03, 0.12, 0.4, 1, 0, { rz: -s * 0.4 }));
    lamps(k, 3.23, 0.82, 0.8, 0.1, 'amber');
    k.mir(s => k.rod('steel', [s * 0.7, 1.68, 0.9], [s * 0.7, 1.68, -2.4], 0.035, { tint: 'darksteel' }));
    for (let i = 0; i < 6; i++) k.mir(s => k.cone('steel', s * 0.7, 1.78, 0.7 - i * 0.6, 0.04, 0.2, '+y', { n: 4, tint: 'steel' }));
    k.mir(s => { k.box('dark', s * 0.92, 1.25, -3.1, 0.16, 0.24, 0.16, { tint: 'black' }); k.box('glow', s * 0.92, 1.25, -3.1, 0.1, 0.18, 0.1, { tint: 'hot', sharp: true }); });
    k.mir(s => rearPipe(k, s * 0.6, 0.36, -3.2, 0.25, 0.07));
    tails(k, -3.26, 0.8, 0.8, 0.3, 0.1);
    k.side(1.05, 0.68, 1.6, 0.5); k.roundel(1.06, 0.66, -0.3, 0.42); k.hood(1.08, 2.6, 0.9, -0.03);
    k.spot('rear', 0, 1.1, -3.1);
  } },
  gnasher: { build(k, d) {
    k.tb('paint', 0, 0.62, -0.25, 2.0, 0.62, 4.5, 0.8, 0.85, -0.04);
    k.ball('glass', 0, 1.0, -0.1, 0.42, { d: 1, sz: 1.8, sy: 0.6 });
    const ro = k.sub('rotor', 0, 0.52, 2.42);
    ro.cyl('steel', 0, 0, 0, 0.36, 1.8, 'x', { n: 10, tint: 'darksteel' });
    for (let j = 0; j < 6; j++) for (let i = 0; i < 6; i++) { const a = i / 6 * TAU + j * 0.5; ro.put('steel', 'tb:0:0.3:0.4', -0.75 + j * 0.3, Math.cos(a) * 0.42, Math.sin(a) * 0.42, 0.08, 0.22, 0.22, { rx: a, tint: 'steel' }); }
    k.mir(s => { k.box('paint', s * 1.0, 0.6, 2.35, 0.14, 0.75, 0.95, { tint: P2 }); k.box('hazard', s * 1.08, 0.6, 2.35, 0.03, 0.5, 0.8, { sharp: true }); k.rod('steel', [s * 0.95, 0.52, 2.42], [s * 0.6, 0.55, 1.6], 0.06, { tint: 'darksteel' }); });
    k.anim((p, c, dt, t, calm) => { p.rotor.rotation.x += dt * ((calm ? 1 : 9) + c.speed * 0.4); });
    v8(k, 0, 0.98, -1.4, 0.6, { blower: true });
    k.mir(s => { k.rod('chrome', [s * 0.3, 0.9, -1.8], [s * 0.4, 0.95, -2.5], 0.06); k.pipe([s * 0.4, 0.95, -2.5], [0, 0.2, -1]); });
    k.mir(s => k.rod('dark', [s * 0.5, 0.9, -2.1], [s * 0.55, 1.55, -2.35], 0.04, { tint: 'chassis' }));
    k.tb('paint', 0, 1.6, -2.4, 2.0, 0.08, 0.55, 1, 0.8, -0.05, { tint: P3 });
    tails(k, -2.5, 0.65, 0.7, 0.3, 0.1); lamps(k, 1.95, 0.7, 0.75, 0.08, 'hot');
    k.side(0.86, 0.62, 0.6, 0.45); k.roundel(0.86, 0.6, -0.8, 0.38); k.hood(0.94, 1.2, 0.6, -0.08);
    k.spot('roof', 0, 1.22, -0.2, 0.5, 0.5); k.spot('rear', 0, 1.65, -2.4);
  } },
  cinder: { fs: 0.85, rs: 1.15, build(k, d) {
    k.mir(s => k.box('dark', s * 0.38, 0.45, 0.6, 0.12, 0.16, 3.6, { tint: 'chassis' }));
    k.tb('paint', 0, 0.76, -0.6, 1.55, 0.56, 2.6, 0.95, 0.95);
    cab(k, -0.72, 1.04, 1.38, 0.44, 1.3, 0.92, 0.75, -0.08, { g0: 0.2, g1: 0.75 });
    k.mir(s => arch(k, 'paint', s * 0.85, d.rz, d.R * 1.15, 0.6, { tint: 0xffffff }));
    v8(k, 0, 0.92, 1.15, 0.78, { blower: true, stacks: true });
    k.tb('chrome', 0, 0.85, 2.05, 0.75, 0.7, 0.2, 0.8, 0.8); k.box('dark', 0, 0.85, 2.16, 0.6, 0.55, 0.04, { tint: 'black' });
    k.rod('steel', [0.9, d.R * 0.85, d.fz], [-0.9, d.R * 0.85, d.fz], 0.05, { tint: 'chrome' });
    k.mir(s => { k.rod('chrome', [s * 0.4, 0.9, 2.0], [s * 0.6, 1.08, 2.1], 0.03); k.cyl('chrome', s * 0.6, 1.08, 2.12, 0.14, 0.14, 'z', { n: 8, r2: 1.2 }); k.cyl('glow', s * 0.6, 1.08, 2.2, 0.11, 0.03, 'z', { n: 8, tint: 'light' }); });
    k.mir(s => {
      for (let i = 0; i < 4; i++) k.rod('chrome', [s * 0.36, 0.85, 0.9 + i * 0.15], [s * 0.82, 0.42, 0.75], 0.035, { tint: 'chrome' });
      k.cyl('chrome', s * 0.85, 0.42, -0.4, 0.09, 2.3, 'z', { n: 8 }); k.ring('chrome', s * 0.85, 0.42, 0.2, 0.1, 'z', { t: 0.3, tint: 'steel' });
      k.cyl('glow', s * 0.85, 0.42, -1.56, 0.065, 0.02, 'z', { tint: 'hot' }); k.pipe([s * 0.85, 0.42, -1.56], [0, 0, -1]);
    });
    tails(k, -1.92, 0.75, 0.55, 0.14, 0.14);
    k.side(0.78, 0.76, -0.9, 0.42); k.roundel(0.78, 0.76, -0.1, 0.38); k.hood(1.05, -1.6, 0.5);
    k.spot('rear', 0, 1.06, -1.8); k.spot('hood', 0, 1.8, 1.15, 0.5, 0.7);
  } },
  /* ---- hovers ---- */
  ufo: { skip: 'fins', hover: true, build(k, d) {
    k.cyl('paint', 0, 1.05, 0, 2.1, 0.36, 'y', { n: 16, r2: 0.55 });
    k.cyl('paint', 0, 0.75, 0, 1.2, 0.26, 'y', { n: 16, r2: 1.75, tint: P2 });
    k.cyl('steel', 0, 0.89, 0, 2.12, 0.12, 'y', { n: 16, tint: 'darksteel' });
    k.dome('glass', 0, 1.22, -0.1, 0.8, { sy: 0.8, n: 12 }); k.ball('glow', 0, 1.32, -0.1, 0.3, { tint: 'toxic', d: 1 });
    const li = k.sub('lights', 0, 0.89, 0);
    for (let i = 0; i < 12; i++) { const a = i / 12 * TAU; li.ball('glow', Math.sin(a) * 2.14, 0, Math.cos(a) * 2.14, 0.09, { tint: i % 2 ? 'amber' : 'toxic' }); }
    k.anim((p, c, dt, t, calm) => { p.lights.rotation.y += dt * (calm ? 0 : 0.8); });
    k.cone('beam', 0, 0.36, 0, 1.0, 0.72, '+y', { n: 12 });
    k.box('glow', 0, 1.02, 1.9, 1.3, 0.08, 0.2, { tint: 'hot', sharp: true, rx: 0.2 });
    k.mir(s => k.rod('dark', [s * 0.4, 1.45, -0.6], [s * 0.6, 2.0, -0.9], 0.02, { tint: 'black' }));
    k.mir(s => k.ball('glow', s * 0.6, 2.02, -0.92, 0.05, { tint: 'red' }));
    for (const [x, z] of [[1.3, 1.3], [-1.3, 1.3], [1.3, -1.3], [-1.3, -1.3]]) k.ring('dark', x, d.R * 0.55, z, 0.42, 'y', { t: 0.18, tint: 'gun' });
    for (let i = 0; i < 8; i++) { const a = i / 8 * TAU + 0.2; k.ball('chrome', Math.sin(a) * 1.5, 1.2, Math.cos(a) * 1.5, 0.04, { tint: 'steel' }); }
    k.hood(1.24, 1.15, 0.7);
    k.roundel(1.65, 0.78, 0, 0.42);
    k.spot('roof', 0, 1.7, -0.1, 0.6, 0.6); k.spot('rear', 0, 1.2, -1.9);
    k.pipe([0, 0.62, 0], [0, -1, 0], 0.8);
  } },
  hover: { hover: true, build(k, d) {
    k.tb('paint', 0, 0.95, 0.1, 2.6, 0.55, 4.5, 0.9, 0.85, 0.03);
    k.tb('paint', 0, 0.95, 2.45, 2.36, 0.5, 0.6, 0.8, 0.3, -0.3, { tint: P2 });
    k.tb('dark', 0, 0.45, 0.1, 2.9, 0.45, 5.0, 0.96, 0.97, 0, { tint: 'rubber' });
    k.ball('glass', 0, 1.33, 0.9, 0.62, { d: 1, sx: 1.1, sy: 0.55, sz: 1.4 });
    k.mir(s => {
      const y = 1.62, z = -1.75;
      k.cyl('dark', s * 0.78, y, z, 0.6, 0.55, 'z', { n: 14, open: true, tint: 'gun' }); k.ring('chrome', s * 0.78, y, z + 0.28, 0.6, 'z', { t: 0.1, n: 14 }); k.ring('hazard', s * 0.78, y, z - 0.28, 0.6, 'z', { t: 0.1, n: 14 });
      k.tb('dark', s * 0.78, 1.18, z, 0.5, 0.42, 0.7, 0.6, 0.8, 0, { tint: 'chassis' });
      k.box('dark', s * 0.78, y, z, 0.08, 1.15, 0.06, { tint: 'gun', sharp: true }); k.box('dark', s * 0.78, y, z, 1.15, 0.08, 0.06, { tint: 'gun', sharp: true });
      k.tb('paint', s * 0.78, y + 0.1, z - 0.62, 0.06, 0.9, 0.45, 1, 0.7, -0.2, { tint: P3 });
      const fan = k.sub(s > 0 ? 'fanL' : 'fanR', s * 0.78, y, z + 0.05);
      for (let i = 0; i < 7; i++) { const a = i / 7 * TAU; fan.box('chrome', Math.cos(a) * 0.28, Math.sin(a) * 0.28, 0, 0.14, 0.48, 0.03, { rz: a + HP, ry: 0.5, tint: 'steel', sharp: true }); }
      fan.cyl('glow', 0, 0, -0.05, 0.12, 0.06, 'z', { tint: 'cyan' });
      k.pipe([s * 0.78, 1.62, -2.05], [0, 0, -1], 1.5);
    });
    k.anim((p, c, dt, t, calm) => { const w = dt * ((calm ? 2 : 14) + c.speed * 0.6); p.fanL.rotation.z += w; p.fanR.rotation.z -= w; });
    k.mir(s => k.box('dark', s * 0.6, 1.25, 0.0, 0.5, 0.05, 1.2, { tint: 'black' }));
    for (const [x, z] of [[1.0, 1.4], [-1.0, 1.4], [1.0, -1.4], [-1.0, -1.4]]) k.ring('dark', x, d.R * 0.55, z, 0.4, 'y', { t: 0.16, tint: 'gun' });
    lamps(k, 2.74, 0.95, 0.6, 0.09, 'cyan');
    k.side(1.23, 0.95, 0.4, 0.5); k.roundel(1.18, 0.95, -0.8, 0.4); k.hood(1.23, 1.9, 0.6, -0.1);
    k.spot('roof', 0, 1.62, 0.6, 0.6, 0.7); k.spot('rear', 0, 1.3, -2.2);
  } },
  /* ---- freaks ---- */
  dragon: { build(k, d) {
    rails(k, d, 0.72, 0.45);
    k.tb('paint', 0, 1.25, -0.35, 2.4, 1.0, 4.2, 0.85, 0.9);
    cab(k, 0.15, 1.75, 1.8, 0.62, 1.5, 0.8, 0.7, -0.05, { g0: 0.4, g1: 0.75 });
    k.mir(s => { for (let r = 0; r < 2; r++) for (let i = 0; i < 7; i++) k.tb('paint', s * (1.12 - r * 0.06), 1.0 + r * 0.4, -2.1 + i * 0.55 + r * 0.25, 0.1, 0.36, 0.55, 1, 0.5, -0.25, { rz: -s * 0.12, tint: r ? P2 : P3 }); });
    k.tb('paint', 0, 1.3, 1.95, 1.5, 0.75, 1.0, 0.8, 0.65, 0.05);
    k.tb('paint', 0, 1.24, 2.65, 1.15, 0.5, 0.6, 0.85, 0.75, 0.05, { tint: P2 });
    k.mir(s => { k.ball('glow', s * 0.52, 1.6, 2.25, 0.1, { tint: 'hot' }); k.tb('dark', s * 0.5, 1.72, 2.2, 0.35, 0.1, 0.4, 0.6, 1, 0, { rz: s * 0.3, tint: 'black' }); k.ball('glow', s * 0.25, 1.32, 2.97, 0.05, { tint: 'hot' }); });
    k.mir(s => k.path('rough', [[s * 0.45, 1.68, 1.9], [s * 0.62, 2.05, 1.4], [s * 0.66, 2.3, 0.85]], 0.08, { tint: 'bone' }));
    k.mir(s => k.cone('rough', s * 0.66, 2.38, 0.8, 0.08, 0.3, '+y', { n: 5, tint: 'bone', rx: -0.6 }));
    for (let i = 0; i < 7; i++) k.cone('rough', -0.45 + i * 0.15, 0.98, 2.95, 0.04, 0.2, '-y', { n: 4, tint: 'bone' });
    const jaw = k.sub('jaw', 0, 0.92, 2.0);
    jaw.tb('dark', 0, -0.06, 0.45, 1.05, 0.15, 0.9, 0.9, 0.8, 0.05, { tint: 'gun' });
    for (let i = 0; i < 6; i++) jaw.cone('rough', -0.38 + i * 0.15, 0.06, 0.86, 0.04, 0.17, '+y', { n: 4, tint: 'bone' });
    k.anim((p, c, dt, t, calm) => { p.jaw.rotation.x = c.boosting ? 0.4 : calm ? 0.06 : 0.06 + Math.max(0, Math.sin(t * 1.8)) * 0.14; });
    for (let i = 0; i < 9; i++) k.cone('rough', 0, (i < 3 ? 2.42 : 1.8) - (i < 3 ? 0 : i * 0.02), 0.6 - i * 0.36, 0.1, 0.38 - i * 0.02, '+y', { n: 4, tint: 'bone', rx: -0.5 });
    k.mir(s => stack(k, s * 0.95, 1.75, -1.3, 1.0, 0.09));
    tails(k, -2.47, 1.3, 0.9);
    k.side(1.16, 2.0, 0.1, 0.45); k.roundel(1.18, 1.25, -0.6, 0.42); k.hood(1.69, 2.0, 0.7, -0.12);
    k.spot('rear', 0, 1.8, -2.4);
  } },
  royal: { build(k, d) {
    rails(k, d, 0.7, 0.45);
    k.tb('paint', 0, 1.2, -0.35, 2.0, 0.8, 3.4, 1.15, 1.08);
    k.tb('paint', 0, 2.0, -0.35, 2.3, 0.8, 3.67, 0.88, 0.88, 0, { tint: P2 });
    k.tb('paint', 0, 2.55, -0.35, 2.02, 0.3, 3.22, 0.7, 0.75);
    k.box('chrome', 0, 1.6, -0.35, 2.38, 0.08, 3.72, { tint: 'gold' }); k.box('chrome', 0, 2.41, -0.35, 2.06, 0.06, 3.26, { tint: 'gold' });
    k.mir(s => { for (const z of [-1.2, 0.5]) { k.box('glass', s * 1.09, 2.0, z, 0.04, 0.5, 0.8, { sharp: true }); k.box('chrome', s * 1.1, 2.0, z, 0.03, 0.58, 0.88, { tint: 'gold', c: 0.2 }); } });
    for (let i = 0; i < 8; i++) { const a = i / 8 * TAU; k.cone('chrome', Math.sin(a) * 0.55, 2.86, -0.35 + Math.cos(a) * 0.9, 0.08, 0.32, '+y', { n: 5, tint: 'gold' }); }
    k.ball('chrome', 0, 2.92, -0.35, 0.2, { d: 1, tint: 'gold' }); k.cone('chrome', 0, 3.16, -0.35, 0.05, 0.25, '+y', { tint: 'gold' });
    k.box('paint', 0, 1.25, 1.8, 1.8, 0.6, 1.0, { tint: P3 }); k.box('dark', 0, 1.62, 1.9, 1.5, 0.14, 0.6, { tint: 'wood' });
    grille(k, 2.32, 1.15, 1.2, 0.4, 4, 'chrome');
    k.mir(s => { k.box('chrome', s * 0.95, 1.85, 2.2, 0.22, 0.32, 0.22, { tint: 'gold' }); k.box('glow', s * 0.95, 1.85, 2.2, 0.16, 0.26, 0.24, { tint: 'amber', sharp: true }); k.cone('chrome', s * 0.95, 2.1, 2.2, 0.14, 0.2, '+y', { n: 4, tint: 'gold' }); });
    k.mir(s => k.rivets('chrome', [s * 1.16, 1.25, -1.9], [s * 1.16, 1.25, 1.2], 9, 0.04, { tint: 'gold' }));
    k.box('dark', 0, 0.9, -2.35, 1.6, 0.1, 0.5, { tint: 'wood' });
    k.mir(s => rearPipe(k, s * 0.6, 0.6, -2.3, 0.2, 0.07));
    tails(k, -2.1, 1.3, 0.8);
    k.side(1.16, 1.2, -0.35, 0.6); k.roundel(1.0, 2.0, -0.35, 0.36); k.hood(1.56, 1.85, 0.6);
    k.spot('roof', 0, 2.72, -1.4, 1.0, 0.6); k.spot('rear', 0, 2.2, -2.2);
  } },
  submarine: { build(k, d) {
    rails(k, d, 0.62, 0.45);
    k.cyl('paint', 0, 1.45, -0.1, 0.95, 3.8, 'z', { n: 12 });
    k.ball('paint', 0, 1.45, 1.75, 0.95, { d: 1, sz: 1.1 });
    k.cone('paint', 0, 1.45, -2.45, 0.95, 0.9, '-z', { n: 12, tint: P2 });
    for (let i = 0; i < 4; i++) k.ring('steel', 0, 1.45, 1.2 - i * 0.95, 0.96, 'z', { t: 0.04, n: 12, tint: 'darksteel' });
    k.tb('paint', 0, 2.65, -0.2, 0.8, 0.8, 1.6, 0.85, 0.75, -0.05, { tint: P2 });
    k.rod('steel', [0.15, 3.05, 0.0], [0.15, 3.75, 0.0], 0.05, { tint: 'darksteel' }); k.box('steel', 0.15, 3.8, 0.12, 0.12, 0.12, 0.3, { tint: 'darksteel' }); k.cyl('glass', 0.15, 3.8, 0.28, 0.05, 0.04, 'z', {});
    k.mir(s => { k.tb('paint', s * 0.55, 2.7, 0.2, 0.5, 0.05, 0.5, 1, 0.5, -0.2, { tint: P3 }); k.tb('paint', s * 1.1, 1.45, 1.4, 0.45, 0.05, 0.5, 1, 0.5, -0.2, { tint: P3 }); });
    k.mir(s => { for (const z of [-1.2, -0.4, 0.4, 1.2]) { k.ring('chrome', s * 0.9, 1.62, z, 0.17, 'x', { t: 0.15, n: 10, tint: 'copper' }); k.cyl('glow', s * 0.9, 1.62, z, 0.13, 0.04, 'x', { n: 10, tint: z > 0 ? 'cyan' : 'amber' }); } });
    const prop = k.sub('prop', 0, 1.45, -2.92);
    for (let i = 0; i < 4; i++) { const a = i / 4 * TAU; prop.box('chrome', Math.cos(a) * 0.32, Math.sin(a) * 0.32, 0, 0.16, 0.55, 0.04, { rz: a + HP, ry: 0.6, tint: 'copper', sharp: true }); }
    prop.ball('chrome', 0, 0, 0, 0.12, { tint: 'copper' });
    k.anim((p, c, dt, t, calm) => { p.prop.rotation.z += dt * ((calm ? 0.5 : 6) + c.speed * 0.5); });
    k.mir(s => { for (const z of [d.fz, d.rz]) k.rod('dark', [s * 0.6, 1.0, z], [s * (d.tr / 2 - 0.2), d.R, z], 0.08, { tint: 'chassis' }); });
    k.mir(s => k.rivets('chrome', [s * 0.94, 1.2, 1.6], [s * 0.94, 1.2, -1.9], 10, 0.035));
    lamps(k, 2.75, 1.45, 0.35, 0.1, 'cyan');
    k.side(0.41, 2.65, -0.2, 0.45); k.roundel(0.96, 1.3, 0.0, 0.42); k.hood(2.32, 0.8, 0.6, 0.15);
    k.spot('roof', 0, 3.05, -0.4, 0.5, 0.6); k.spot('rear', 0, 2.0, -2.5);
    k.pipe([0, 1.45, -3.0], [0, 0, -1], 1.2);
  } },
  pirate: { frame: { h: 4.4 }, build(k, d) {
    rails(k, d, 0.62, 0.45);
    k.tb('rough', 0, 1.2, 0, 2.0, 1.0, 5.0, 1.25, 1.1, 0, { tint: 'wood' });
    for (let i = 0; i < 4; i++) k.box('rough', 0, 0.85 + i * 0.22, 0, 2.06 + i * 0.12, 0.03, 5.1 + i * 0.12, { tint: 0x3a2414, sharp: true });
    k.box('paint', 0, 1.66, 0, 2.55, 0.14, 5.6);
    k.tb('rough', 0, 1.35, 2.75, 2.2, 0.72, 0.9, 0.55, 0.6, 0.35, { tint: 'wood' });
    k.rod('rough', [0, 1.65, 3.1], [0, 2.3, 4.0], 0.07, { tint: 'wood' });
    k.box('rough', 0, 2.05, -2.15, 2.3, 0.75, 1.3, { tint: 'wood' }); k.box('paint', 0, 2.45, -2.15, 2.4, 0.1, 1.4, { tint: P2 });
    for (let i = 0; i < 3; i++) k.box('glow', -0.6 + i * 0.6, 2.05, -2.81, 0.3, 0.35, 0.03, { tint: 'amber', sharp: true });
    k.cyl('rough', 0, 3.25, 0.3, 0.1, 3.3, 'y', { n: 8, tint: 'wood' });
    k.rod('rough', [1.3, 4.3, 0.35], [-1.3, 4.3, 0.35], 0.06, { tint: 'wood' }); k.rod('rough', [1.1, 2.7, 0.35], [-1.1, 2.7, 0.35], 0.06, { tint: 'wood' });
    k.cyl('rough', 0, 4.7, 0.3, 0.32, 0.25, 'y', { n: 8, tint: 'wood', open: false });
    const sail = k.sub('sail', 0, 3.5, 0.42);
    sail.box('rough', 0, 0.35, 0, 2.4, 0.95, 0.04, { tint: 'sail', sharp: true }); sail.box('rough', 0, -0.48, 0.05, 2.15, 0.7, 0.04, { tint: 'sail', sharp: true, rx: 0.15 });
    sail.box('rough', 0.6, -0.95, 0.1, 0.5, 0.25, 0.03, { tint: 'sail', rz: 0.4, sharp: true });
    sail.ball('rough', 0, 0.2, 0.04, 0.22, { tint: 'black', sz: 0.15, d: 1 }); sail.mir(m => sail.ball('rough', m * 0.08, 0.24, 0.06, 0.05, { tint: 'sail', sz: 0.2 }));
    k.anim((p, c, dt, t, calm) => { p.sail.rotation.x = -Math.min(0.35, c.speed * 0.01) - (calm ? 0 : Math.sin(t * 1.2) * 0.04); p.sail.rotation.y = calm ? 0 : Math.sin(t * 0.7) * 0.06; });
    k.mir(s => { for (const z of [-1.0, 0.0, 1.0]) k.cyl('dark', s * 1.25, 1.25, z, 0.11, 0.5, 'x', { n: 8, tint: 'black' }); });
    k.mir(s => rearPipe(k, s * 0.7, 0.75, -2.55, 0.3, 0.1));
    k.mir(s => { for (const z of [d.fz, d.rz]) k.rod('dark', [s * 0.7, 0.9, z], [s * (d.tr / 2 - 0.2), d.R, z], 0.08, { tint: 'chassis' }); });
    k.side(1.19, 2.05, -2.15, 0.55); k.roundel(1.24, 1.2, -1.5, 0.4); k.hood(1.74, 1.6, 0.7);
    k.spot('roof', 0, 2.52, -2.1, 1.6, 1.0); k.spot('rear', 0, 2.6, -2.7);
  } },
  unicorn: { build(k, d) {
    rails(k, d, 0.6, 0.45);
    k.tb('paint', 0, 0.95, -0.1, 2.1, 0.8, 4.6, 0.85, 0.8, -0.05);
    k.tb('paint', 0, 0.86, 2.2, 1.9, 0.56, 0.6, 0.8, 0.4, -0.35, { tint: P2 });
    cab(k, -0.55, 1.35, 1.55, 0.55, 1.8, 0.75, 0.55, -0.1);
    k.cone('chrome', 0, 1.12, 3.15, 0.2, 1.7, '+z', { n: 8, rx: -0.12 });
    for (let i = 0; i < 6; i++) k.ring('chrome', 0, 1.1 + i * 0.03, 2.5 + i * 0.22, 0.19 - i * 0.028, 'z', { t: 0.12, n: 8, tint: 'gold', rx: 0.3 });
    const tint = ['magenta', 'violet', 'toxic', 'cyan', 'hot'];
    for (let j = 0; j < 7; j++) {
      const x = -0.3 + j * 0.1, key = j % 2 ? 'glow' : 'paint';
      k.path(key, [[x, 1.92, 0.3], [x * 1.3, 2.05, -0.5], [x * 1.6, 1.7, -1.6], [x * 2.0, 1.2, -2.55]], 0.035, { tint: key === 'glow' ? tint[j % 5] : P3 });
    }
    k.mir(s => { k.box('glow', s * 0.6, 1.0, 2.38, 0.36, 0.08, 0.1, { rz: s * 0.25, tint: 'cyan', sharp: true }); k.cone('steel', s * 0.95, 0.7, d.fz + 0.6, 0.07, 0.3, '+z', { n: 4, tint: 'steel' }); });
    k.mir(s => rearPipe(k, s * 0.5, 0.5, -2.3, 0.3, 0.08));
    tails(k, -2.41, 0.95, 0.75, 0.3, 0.1);
    k.side(1.0, 0.95, 0.9, 0.5); k.roundel(1.0, 0.95, -0.5, 0.42); k.hood(1.28, 1.5, 0.7, -0.08);
    k.spot('roof', 0, 1.9, -0.6, 0.6, 0.6); k.spot('rear', 0, 1.4, -2.3);
  } },
};
function boltRingZ(k, n, R, y, z) { for (let i = 0; i < n; i++) { const a = i / n * TAU; k.ball('chrome', Math.cos(a) * R, y + Math.sin(a) * R, z, 0.04, { tint: 'steel' }); } }

/* ---- class signatures: the bolt-ons every machine of a class wears, so a class reads at a glance from the
   chase cam. brute: roof spotlight pods and hazard mud flaps; hauler: a heavy bull bar and twin flame
   stacks; racer: a hood scoop, a big rear wing and twin rear pipes; tank: riveted armour skirts; hover: rear
   thruster rings and tail fins; freak: flame-spitting zoomie pipes and a spiked roof crown. A body opts out
   of a piece with def.skip (a space-separated list), where its own design already does that job. ---- */
function spotPod(k, x, y, z, r) {
  k.cyl('chrome', x, y, z, r, r * 1.2, 'z', { n: 10, tint: 'blackchrome' });
  k.ring('chrome', x, y, z + r * 0.6, r * 0.92, 'z', { t: 0.16, n: 10 });
  k.cyl('glow', x, y, z + r * 0.62, r * 0.8, 0.02, 'z', { n: 10, tint: 'light' });
  k.rod('dark', [x, y - r, z], [x, y - r - 0.16, z], 0.04, { tint: 'black' });
}
const SIGNATURE = {
  brute(k, S, d, b, skip) {
    const r = S.roof;
    if (!skip.includes('pods')) {
      const x = Math.min(r.w * 0.42, 0.62), z = r.z + r.l * 0.4, y = r.y + 0.06;
      k.box('dark', 0, y + 0.06, z, x * 2 + 0.36, 0.08, 0.12, { tint: 'black', sharp: true });
      k.mir(s => spotPod(k, s * x, y + 0.3, z, 0.17));
    }
    if (!skip.includes('flaps')) k.mir(s => {
      const x = s * d.tr / 2, z = d.rz - d.R * 1.05 - 0.06;
      k.box('dark', x, d.R * 0.95, z, d.ww * 0.9, d.R * 0.8, 0.05, { tint: 'black', sharp: true });
      k.box('hazard', x, d.R * 0.7, z - 0.03, d.ww * 0.9, d.R * 0.24, 0.02, { sharp: true });
      k.rod('dark', [x, d.R * 1.4, z], [x * 0.55, d.R * 1.5, z + 0.25], 0.035, { tint: 'chassis' });
    });
  },
  hauler(k, S, d, b, skip) {
    if (!skip.includes('bar')) {
      const z = d.L / 2 + 0.3, y0 = d.rh + 0.1, y1 = d.rh + 1.05, w = d.W * 0.86;
      bullbar(k, z, y0, y1, w, 0.075);
      k.box('hazard', 0, y0 + 0.12, z + 0.05, w * 0.98, 0.2, 0.1, { sharp: true });
      k.mir(s => k.rod('steel', [s * w * 0.45, y0 + 0.2, z], [s * w * 0.45, y0 + 0.2, z - 0.42], 0.06, { tint: 'darksteel' }));
    }
    if (!skip.includes('stacks') && k.exhaust.filter(e => e.dir[1] > 0.5).length < 2) {
      const r = S.roof, z = r.z - r.l * 0.5 - 0.15, x = Math.min(d.W / 2 - 0.12, r.w * 0.62 + 0.18);
      k.mir(s => stack(k, s * x, r.y - 0.9, z, 1.55, 0.11, true));
    }
  },
  racer(k, S, d, b, skip) {
    const h = S.hood, rr = S.rear;
    if (!skip.includes('scoop')) {
      k.tb('paint', h.x, h.y + 0.12, h.z, 0.62, 0.24, 0.8, 0.8, 0.7, -0.15, { tint: P2 });
      k.box('dark', h.x, h.y + 0.14, h.z + 0.38, 0.48, 0.14, 0.04, { tint: 'black', sharp: true });
      k.box('glow', h.x, h.y + 0.13, h.z + 0.39, 0.4, 0.05, 0.02, { tint: 'hot', sharp: true });
    }
    if (!skip.includes('wing') && !b.extras.spoiler) {
      const y = rr.y + 0.55, z = rr.z + 0.25, w = d.W * 1.0;
      k.box('dark', 0, y, z, w, 0.07, 0.55, { tint: 'black', rx: -0.12 });
      k.box('hazard', 0, y + 0.045, z - 0.2, w * 0.98, 0.02, 0.12, { sharp: true, rx: -0.12 });
      k.mir(s => { k.box('paint', s * w / 2, y + 0.02, z, 0.05, 0.36, 0.7, { tint: P2 }); k.rod('steel', [s * w * 0.25, rr.y, z + 0.2], [s * w * 0.25, y - 0.03, z + 0.05], 0.04, { tint: 'darksteel' }); });
    }
    if (!skip.includes('pipes') && !k.exhaust.some(e => e.dir[2] < -0.5)) k.mir(s => rearPipe(k, s * 0.3, d.rh + 0.18, -d.L / 2 + 0.15, 0.3, 0.1));
  },
  tank(k, S, d, b, skip) {
    if (skip.includes('skirts')) return;
    const x = Math.max(d.W / 2, d.tr / 2 + Math.max(d.ww, 0.8) / 2) + 0.06, y = d.R * 1.55, h = d.R * 0.8, len = d.wb * 0.92 + d.R;
    k.mir(s => {
      /* all on 'dark' (tinted): a tracked machine is already near the draw-call budget */
      k.box('dark', s * x, y, 0, 0.08, h, len, { tint: 'darksteel', c: 0.06 });
      for (const f of [0.38, -0.38]) k.rivets('dark', [s * (x + 0.045), y + h * f, -len * 0.44], [s * (x + 0.045), y + h * f, len * 0.44], 6, 0.04, { tint: 'steel' });
      k.box('hazard', s * (x + 0.045), y - h * 0.32, len / 2 - 0.25, 0.02, h * 0.3, 0.5, { sharp: true });
      k.box('hazard', s * (x + 0.045), y - h * 0.32, -len / 2 + 0.25, 0.02, h * 0.3, 0.5, { sharp: true });
    });
  },
  hover(k, S, d, b, skip) {
    const rr = S.rear;
    if (!skip.includes('thrust')) k.mir(s => {
      const x = s * d.W * 0.3, y = rr.y, z = rr.z + 0.1;
      k.cyl('dark', x, y, z + 0.3, 0.26, 0.6, 'z', { n: 10, tint: 'gun' });
      k.ring('chrome', x, y, z, 0.27, 'z', { t: 0.2, n: 10 });
      k.cyl('glow', x, y, z - 0.01, 0.2, 0.02, 'z', { n: 10, tint: 'cyan' });
      k.pipe([x, y, z - 0.02], [0, 0, -1], 1.3);
    });
    if (!skip.includes('fins')) k.mir(s => k.tb('paint', s * d.W * 0.3, rr.y + 0.45, rr.z + 0.4, 0.06, 0.6, 0.8, 1, 0.35, -0.35, { tint: P2 }));
  },
  freak(k, S, d, b, skip) {
    if (!skip.includes('zoomies')) k.mir(s => {
      const x = s * (d.W / 2 + 0.06), y = d.rh + 0.55, z = d.L * 0.12;
      for (let i = 0; i < 3; i++) {
        const zi = z - i * 0.28, a = [x, y, zi], e = [x + s * 0.12, y + 0.42, zi - 0.32];
        k.rod('chrome', a, e, 0.055, { tint: 'chrome' });
        k.cyl('glow', e[0], e[1], e[2], 0.04, 0.02, 'y', { tint: 'hot' });
        if (i === 0) k.pipe(e, [s * 0.15, 0.7, -0.7], 0.8);
      }
    });
    if (!skip.includes('crown')) {
      const r = S.roof;
      for (let i = 0; i < 3; i++) k.cone('steel', (i - 1) * Math.min(0.32, r.w * 0.3), r.y + 0.17, r.z + r.l * 0.3, 0.07, 0.34, '+y', { n: 5, tint: 'steel', rx: -0.3 });
    }
  },
};

/* ======================================================================================================
   7. extras (bolt-ons), buddies (roof mascots) and stencils
   ====================================================================================================== */
const EXTRA_BUILD = {
  horn(k, S) { const r = S.roof; k.mir(s => { k.box('dark', s * 0.22, r.y + 0.05, r.z + r.l * 0.3, 0.12, 0.08, 0.3, { tint: 'black' }); k.cone('chrome', s * 0.22, r.y + 0.14, r.z + r.l * 0.3 + 0.05, 0.1, 0.55, '-z', { n: 8 }); }); },
  beacon(k, S) {
    const r = S.roof, b = k.sub('xbeacon', r.x + r.w * 0.32, r.y, r.z - r.l * 0.25);
    b.cyl('glow', 0, 0.04, 0, 0.16, 0.08, 'y', { tint: 0x111111 }); b.dome('glow', 0, 0.07, 0, 0.15, { tint: 'amber', sy: 1.5 });
    b.box('glow', 0, 0.16, 0, 0.05, 0.14, 0.26, { tint: 0x111111, sharp: true });
    k.anim((p, c, dt, t, calm) => { if (!calm) p.xbeacon.rotation.y = t * 7; });
  },
  flag(k, S, d) {
    const f = k.sub('xflag', d.W * 0.42, S.rear.y, S.rear.z + 0.25);
    f.rod('chrome', [0, 0, 0], [0, 1.7, 0], 0.025); f.ball('chrome', 0, 1.72, 0, 0.05, { tint: 'gold' });
    f.box('paint', 0, 1.45, -0.32, 0.02, 0.4, 0.6, { sharp: true }); f.box('paint', 0, 1.2, -0.25, 0.02, 0.14, 0.45, { sharp: true, tint: P2, rx: 0.1 });
    f.ball('rough', 0, 1.45, -0.3, 0.09, { tint: 'black', sx: 0.2, d: 1 });
    k.anim((p, c, dt, t, calm) => { p.xflag.rotation.y = (calm ? 0 : Math.sin(t * 6 + c.speed * 0.1) * 0.25) - Math.min(0.2, c.speed * 0.004); });
  },
  wings(k, S, d) { k.mir(s => k.tb('paint', s * (d.W / 2 - 0.08), S.rear.y + 0.3, -d.L * 0.3, 0.06, 0.7, 0.9, 1, 0.25, -0.4, { tint: P2 })); },
  booster(k, S, d) {
    const r = S.rear;
    k.mir(s => {
      k.cyl('chrome', s * 0.25, r.y + 0.2, r.z + 0.55, 0.15, 0.8, 'z', { n: 10, tint: 'cyan' }); k.dome('chrome', s * 0.25, r.y + 0.2, r.z + 0.95, 0.15, { rx: HP, tint: 'cyan' });
      k.cyl('hazard', s * 0.25, r.y + 0.2, r.z + 0.4, 0.155, 0.12, 'z', { n: 10 });
      k.rod('chrome', [s * 0.25, r.y + 0.36, r.z + 0.9], [s * 0.1, r.y + 0.4, r.z + 1.3], 0.025, { tint: 'copper' });
      k.cyl('glow', s * 0.25, r.y + 0.2, r.z + 0.13, 0.1, 0.03, 'z', { tint: 'cyan' }); k.pipe([s * 0.25, r.y + 0.2, r.z + 0.12], [0, 0, -1], 1.2);
    });
  },
  partyhat(k, S, d, build) {
    if (build.buddy && cat().BUDDIES[build.buddy]) return;   /* the helmet goes on the buddy instead */
    const r = S.roof;
    k.dome('steel', r.x, r.y, r.z, 0.36, { tint: 'darksteel' }); k.ring('chrome', r.x, r.y + 0.02, r.z, 0.36, 'y', { t: 0.06, n: 12, tint: 'steel' });
    for (let i = 0; i < 5; i++) { const a = i / 5 * TAU; k.cone('chrome', r.x + Math.sin(a) * 0.2, r.y + 0.3, r.z + Math.cos(a) * 0.2, 0.06, 0.28, '+y', { n: 5, tint: 'steel', rx: Math.cos(a) * 0.4, rz: -Math.sin(a) * 0.4 }); }
    k.cone('chrome', r.x, r.y + 0.48, r.z, 0.07, 0.35, '+y', { n: 5 });
  },
  spoiler(k, S, d) {
    const r = S.rear, y = Math.max(r.y + 0.55, d.H * 0.6);
    k.tb('paint', 0, y, r.z + 0.35, d.W * 0.95, 0.08, 0.62, 1, 0.8, -0.05, { tint: P2 });
    k.mir(s => { k.box('dark', s * d.W * 0.475, y - 0.05, r.z + 0.35, 0.04, 0.35, 0.7, { tint: 'black' }); k.rod('dark', [s * 0.4, r.y, r.z + 0.5], [s * 0.4, y, r.z + 0.4], 0.04, { tint: 'chassis' }); });
  },
  antenna(k, S, d) {
    const a = k.sub('xantenna', -d.W * 0.4, S.rear.y, S.rear.z + 0.3);
    a.rod('dark', [0, 0, 0], [0, 1.8, 0], 0.016, { tint: 'black' }); a.ball('rough', 0, 1.85, 0, 0.08, { tint: 'bone', d: 1 }); a.ball('glow', 0, 1.97, 0, 0.035, { tint: 'red' });
    k.anim((p, c, dt, t, calm, rig) => { p.xantenna.rotation.x = -Math.min(0.5, c.speed * 0.01) + (calm ? 0 : Math.sin(t * 5) * 0.05) - rig.sway.ax * 0.01; });
  },
  surf(k, S) {
    const r = S.roof, l = Math.max(1.5, r.l * 1.5);
    k.mir(s => k.rod('dark', [s * 0.35, r.y + 0.02, r.z - l * 0.3], [s * 0.35, r.y + 0.02, r.z + l * 0.3], 0.03, { tint: 'black' }));
    k.box('steel', 0, r.y + 0.14, r.z, 0.62, 0.06, l, { tint: 'darksteel' }); k.box('hazard', 0, r.y + 0.15, r.z + l * 0.45, 0.6, 0.065, l * 0.1, { sharp: true });
    k.rivets('chrome', [0.26, r.y + 0.18, r.z - l * 0.4], [0.26, r.y + 0.18, r.z + l * 0.35], 6, 0.03); k.rivets('chrome', [-0.26, r.y + 0.18, r.z - l * 0.4], [-0.26, r.y + 0.18, r.z + l * 0.35], 6, 0.03);
  },
  bubbles(k, S, d) {
    const r = S.rear;
    k.mir(s => { k.cyl('dark', s * d.W * 0.36, r.y, r.z + 0.25, 0.15, 0.5, 'y', { n: 8, tint: 'olive' }); k.cyl('glow', s * d.W * 0.36, r.y + 0.26, r.z + 0.25, 0.08, 0.03, 'y', { tint: 'toxic' }); k.smoke.push([s * d.W * 0.36, r.y + 0.27, r.z + 0.25]); });
  },
  jetpack(k, S) {
    const r = S.roof;
    k.mir(s => {
      k.cyl('dark', s * 0.32, r.y + 0.22, r.z - r.l * 0.2, 0.16, 0.9, 'z', { n: 10, tint: 'gun' });
      k.cone('dark', s * 0.32, r.y + 0.22, r.z - r.l * 0.2 + 0.6, 0.16, 0.3, '+z', { n: 10, tint: 'gun' });
      k.cyl('steel', s * 0.32, r.y + 0.22, r.z - r.l * 0.2 - 0.55, 0.12, 0.2, 'z', { n: 10, r2: 1.4, tint: 'darksteel' });
      k.cyl('glow', s * 0.32, r.y + 0.22, r.z - r.l * 0.2 - 0.66, 0.12, 0.03, 'z', { tint: 'hot' });
      k.pipe([s * 0.32, r.y + 0.22, r.z - r.l * 0.2 - 0.67], [0, -0.15, -1], 1.4);
    });
    k.box('dark', 0, r.y + 0.05, r.z - r.l * 0.2, 0.9, 0.1, 0.5, { tint: 'chassis' });
  },
  trophyrack(k, S) {
    const r = S.roof;
    k.box('dark', 0, r.y + 0.04, r.z, 1.0, 0.08, 0.4, { tint: 'chassis' });
    for (const x of [-0.35, 0, 0.35]) { const big = x === 0 ? 1.25 : 1; k.cyl('chrome', x, r.y + 0.16 * big, r.z, 0.06 * big, 0.2 * big, 'y', { n: 8, r2: 2.2, tint: 'gold' }); k.ball('chrome', x, r.y + 0.36 * big, r.z, 0.12 * big, { d: 1, tint: 'gold' }); k.mir(m => k.ball('dark', x + m * 0.045 * big, r.y + 0.38 * big, r.z + 0.1 * big, 0.03 * big, { tint: 'black' })); }
  },
  rollcage(k, S, d) {
    const r = S.roof, x = Math.min(d.W / 2 - 0.05, r.w * 0.7 + 0.15), y = r.y + 0.18, z0 = r.z - r.l * 0.6 - 0.1, z1 = r.z + r.l * 0.6 + 0.1, yb = d.rh + 0.35;
    k.mir(s => { k.rod('dark', [s * x, yb, z0], [s * x, y, z0], 0.05, { tint: 'chassis' }); k.rod('dark', [s * x, yb, z1], [s * x, y, z1], 0.05, { tint: 'chassis' }); k.rod('dark', [s * x, y, z0], [s * x, y, z1], 0.05, { tint: 'chassis' }); });
    k.rod('dark', [x, y, z0], [-x, y, z0], 0.05, { tint: 'chassis' }); k.rod('dark', [x, y, z1], [-x, y, z1], 0.05, { tint: 'chassis' }); k.rod('dark', [x, y, z0], [-x, y, z1], 0.045, { tint: 'chassis' });
  },
  ram(k, S, d) {
    const n = S.nose;
    k.box('steel', 0, n.y, n.z + 0.18, d.W * 0.92, 0.36, 0.26, { tint: 'darksteel' }); k.box('hazard', 0, n.y + 0.2, n.z + 0.2, d.W * 0.9, 0.06, 0.22, { sharp: true });
    for (const x of [-0.6, 0, 0.6]) k.cone('chrome', x * d.W / 2.2, n.y, n.z + 0.5, 0.1, 0.45, '+z', { n: 6, tint: 'steel' });
  },
  sidepipes(k, S, d) {
    const y = Math.max(0.3, d.rh + 0.1), len = d.wb * 0.7, x = d.W / 2 + 0.08;
    k.mir(s => { k.cyl('chrome', s * x, y, 0, 0.09, len, 'z', { n: 8 }); k.ring('chrome', s * x, y, len * 0.2, 0.1, 'z', { t: 0.3, tint: 'steel' }); k.cyl('glow', s * x, y, -len / 2 - 0.005, 0.065, 0.02, 'z', { tint: 'hot' }); k.pipe([s * x, y, -len / 2], [0, 0, -1]); });
  },
  searchlights(k, S) {
    const r = S.roof;
    lightbar(k, r.y + 0.1, r.z + r.l * 0.35, Math.min(1.8, r.w * 1.2 + 0.4), 5);
    k.mir(s => { k.cyl('dark', s * (r.w * 0.5 + 0.2), r.y + 0.3, r.z + r.l * 0.35, 0.16, 0.2, 'z', { n: 10, tint: 'black' }); k.cyl('glow', s * (r.w * 0.5 + 0.2), r.y + 0.3, r.z + r.l * 0.35 + 0.11, 0.13, 0.02, 'z', { n: 10, tint: 'light' }); });
  },
  blower(k, S) { const h = S.hood; blower(k, h.x, h.y, h.z, 0.7); },
  plating(k, S, d) { k.mir(s => plates(k, s * (d.W / 2 + 0.03), d.rh + Math.min(0.6, d.H * 0.25), 0, 0.06, 0.45, d.L * 0.55)); },
};
/* buddies: big-headed roof mascots on a spring. Head built around its centre. */
const fur = t => ({ tint: t });
const BUDDY_BUILD = {
  pup(h) { h.ball('rough', 0, 0, 0, 0.26, { d: 1, sy: 0.9, ...fur(0xb07840) }); h.box('rough', 0, -0.08, 0.2, 0.26, 0.18, 0.18, fur('cream')); h.ball('dark', 0, -0.02, 0.3, 0.05, { tint: 'black' }); h.mir(s => { h.cone('rough', s * 0.22, 0.12, 0, 0.09, 0.22, '-y', { ...fur(0x5a3a1a), rz: s * 0.6 }); h.ball('glow', s * 0.09, 0.06, 0.22, 0.04, { tint: 'amber' }); }); h.ring('dark', 0, -0.24, 0, 0.18, 'y', { t: 0.2, tint: 'black' }); for (let i = 0; i < 6; i++) { const a = i / 6 * TAU; h.cone('chrome', Math.sin(a) * 0.2, -0.24, Math.cos(a) * 0.2, 0.025, 0.1, '+y', { tint: 'steel', rx: Math.cos(a) * 1.4, rz: -Math.sin(a) * 1.4 }); } },
  kitty(h) { h.ball('rough', 0, 0, 0, 0.25, { d: 1, ...fur(0x6a6a72) }); h.cone('rough', 0.14, 0.24, 0, 0.08, 0.2, '+y', fur(0x6a6a72)); h.cone('rough', -0.14, 0.2, 0, 0.08, 0.12, '+y', { ...fur(0x6a6a72), rz: 0.5 }); h.mir(s => { h.ball('glow', s * 0.09, 0.04, 0.21, 0.045, { tint: 'toxic', sx: 0.45 }); h.rod('rough', [s * 0.08, -0.06, 0.22], [s * 0.3, -0.04, 0.24], 0.006, fur('cream')); }); h.ball('rough', 0, -0.04, 0.25, 0.03, fur('pink')); },
  ducky(h) { h.ball('rough', 0, 0, 0, 0.25, { d: 1, ...fur(0xf2c400) }); h.tb('rough', 0, -0.04, 0.22, 0.2, 0.08, 0.2, 0.8, 0.6, 0.2, fur(0xff8a1a)); for (let i = 0; i < 4; i++) h.cone('rough', 0, 0.24, 0.12 - i * 0.09, 0.04, 0.16, '+y', fur('red')); h.mir(s => { h.ball('glow', s * 0.1, 0.07, 0.2, 0.045, { tint: 'light' }); h.ball('dark', s * 0.1, 0.07, 0.235, 0.02, { tint: 'black' }); }); },
  dino(h) { h.ball('rough', 0, 0, 0, 0.22, { d: 1, ...fur(0x4f8a2c) }); h.tb('rough', 0, -0.04, 0.18, 0.24, 0.18, 0.3, 0.8, 0.7, 0.1, fur(0x4f8a2c)); for (let i = 0; i < 4; i++) h.cone('rough', -0.08 + i * 0.055, -0.13, 0.42, 0.015, 0.06, '-y', fur('bone')); h.mir(s => h.ball('glow', s * 0.1, 0.08, 0.15, 0.04, { tint: 'hot' })); for (let i = 0; i < 3; i++) h.cone('rough', 0, 0.2 - i * 0.04, -0.05 - i * 0.1, 0.04, 0.12, '+y', fur(0x2f5a1a)); },
  penguin(h) { h.ball('rough', 0, 0, 0, 0.25, { d: 1, ...fur(0x18191c) }); h.ball('rough', 0, -0.04, 0.08, 0.2, { d: 1, ...fur(0xe8e8e8), sz: 0.9 }); h.cone('rough', 0, -0.06, 0.28, 0.05, 0.14, '+z', fur(0xff8a1a)); h.mir(s => { h.ring('chrome', s * 0.09, 0.06, 0.21, 0.06, 'z', { t: 0.3 }); h.cyl('glass', s * 0.09, 0.06, 0.22, 0.05, 0.02, 'z', {}); }); h.ring('dark', 0, 0.06, 0, 0.25, 'y', { t: 0.06, tint: 'black' }); },
  monkey(h) { h.ball('rough', 0, 0, 0, 0.24, { d: 1, ...fur(0x7a4a26) }); h.ball('rough', 0, -0.06, 0.14, 0.15, { d: 1, ...fur('cream'), sy: 0.8 }); h.mir(s => { h.ball('rough', s * 0.25, 0.02, 0, 0.08, fur('cream')); h.ball('glow', s * 0.07, 0.02, 0.2, 0.03, { tint: 'amber' }); h.ring('chrome', s * 0.08, 0.16, 0.18, 0.05, 'z', { t: 0.3, rx: -0.5, tint: 'copper' }); }); h.ring('dark', 0, 0.16, 0, 0.24, 'y', { t: 0.05, tint: 'black', rx: -0.3 }); },
  fox(h) { h.ball('rough', 0, 0, 0, 0.24, { d: 1, ...fur(0xd86a20) }); h.cone('rough', 0, -0.05, 0.25, 0.1, 0.22, '+z', fur(0xd86a20)); h.ball('dark', 0, -0.05, 0.37, 0.025, { tint: 'black' }); h.mir(s => { h.cone('rough', s * 0.13, 0.25, -0.02, 0.07, 0.2, '+y', { ...fur(0xd86a20), rz: -s * 0.2 }); h.ball('rough', s * 0.13, -0.08, 0.12, 0.08, fur('cream')); }); h.ball('glow', -0.08, 0.06, 0.2, 0.035, { tint: 'amber' }); h.box('dark', 0.08, 0.06, 0.21, 0.1, 0.08, 0.03, { tint: 'black' }); h.rod('dark', [0.08, 0.06, 0.22], [0.24, 0.14, -0.05], 0.008, { tint: 'black' }); },
  bunny(h) { h.ball('rough', 0, 0, 0, 0.24, { d: 1, ...fur(0xe8e4dc) }); h.box('rough', 0.08, 0.32, -0.02, 0.07, 0.38, 0.04, { ...fur(0xe8e4dc), rz: -0.1 }); h.box('rough', -0.1, 0.24, -0.02, 0.07, 0.24, 0.04, { ...fur(0xe8e4dc), rz: 0.9 }); h.ball('chrome', 0.08, 0.2, 0.03, 0.025, { tint: 'steel' }); h.mir(s => h.ball('glow', s * 0.08, 0.04, 0.2, 0.04, { tint: 'red' })); h.mir(s => h.box('rough', s * 0.025, -0.12, 0.21, 0.04, 0.07, 0.02, fur('white'))); },
  frog(h) { h.ball('rough', 0, 0, 0, 0.22, { d: 1, sx: 1.35, sy: 0.75, ...fur(0x5fae3a) }); h.mir(s => { h.ball('rough', s * 0.15, 0.15, 0.06, 0.09, fur(0x5fae3a)); h.ball('glow', s * 0.15, 0.17, 0.13, 0.05, { tint: 'toxic' }); }); h.box('dark', 0, -0.06, 0.2, 0.36, 0.02, 0.04, { tint: 'black' }); },
  robot(h) { h.box('rust', 0, 0, 0, 0.42, 0.36, 0.36); h.box('glow', 0, 0.04, 0.185, 0.3, 0.07, 0.02, { tint: 'cyan', sharp: true }); h.rod('dark', [0, 0.18, 0], [0, 0.36, 0], 0.015, { tint: 'black' }); h.ball('glow', 0, 0.38, 0, 0.04, { tint: 'red' }); h.mir(s => { h.cyl('steel', s * 0.23, 0, 0, 0.07, 0.06, 'x', { tint: 'darksteel' }); }); h.rivets('chrome', [-0.15, -0.12, 0.185], [0.15, -0.12, 0.185], 4, 0.02); },
  gremlin(h) { h.ball('rough', 0, 0, 0, 0.23, { d: 1, ...fur(0x6a7a4a) }); h.mir(s => { h.tb('rough', s * 0.3, 0.06, 0, 0.36, 0.3, 0.04, 0.1, 1, 0, { ...fur(0x8a6a5a), rz: -s * 1.2 }); h.ball('glow', s * 0.08, 0.05, 0.19, 0.045, { tint: 'red' }); h.cone('rough', s * 0.05, -0.12, 0.2, 0.018, 0.08, '-y', fur('bone')); }); },
  skullbot(h) { h.ball('chrome', 0, 0.02, 0, 0.24, { d: 1, sy: 0.95 }); h.box('chrome', 0, -0.16, 0.06, 0.24, 0.1, 0.2, { tint: 'steel' }); h.mir(s => { h.ball('dark', s * 0.09, 0.04, 0.18, 0.07, { tint: 'black' }); h.ball('glow', s * 0.09, 0.04, 0.22, 0.03, { tint: 'red' }); }); for (let i = 0; i < 4; i++) h.box('chrome', -0.075 + i * 0.05, -0.12, 0.16, 0.03, 0.06, 0.02, { tint: 'steel', sharp: true }); },
};
function buddyKit(k, id, helmet, at) {
  const b = k.sub('buddy', at.x, at.y, at.z);
  b.cyl('chrome', 0, 0.02, 0, 0.14, 0.04, 'y', { tint: 'blackchrome' });
  for (let i = 0; i < 4; i++) b.ring('chrome', 0, 0.07 + i * 0.05, 0, 0.06, 'y', { t: 0.25, n: 8, tint: 'steel' });
  const h = b.sub('bhead', 0, 0.48, 0);
  (BUDDY_BUILD[id] || BUDDY_BUILD.robot)(h);
  if (helmet) { h.dome('steel', 0, 0.12, 0, 0.27, { tint: 'darksteel' }); for (let i = 0; i < 5; i++) { const a = i / 5 * TAU; h.cone('chrome', Math.sin(a) * 0.15, 0.32, Math.cos(a) * 0.15, 0.04, 0.16, '+y', { tint: 'steel', rx: Math.cos(a) * 0.5, rz: -Math.sin(a) * 0.5 }); } }
}

/* ---- stencil art for decals: 256 x 256, transparent, worn. The nose is to the LEFT of the image. ---- */
function wear(g, w, h, r) { g.globalCompositeOperation = 'destination-out'; speckle(g, w, h, r, 420, '#000', 0.3, 0.9, 1, 4); scratches(g, w, h, r, 30, '#000', 0.8); g.globalCompositeOperation = 'source-over'; }
function outline(g, lw = 10) { g.lineJoin = 'round'; g.strokeStyle = '#111214'; g.lineWidth = lw; g.stroke(); }
const DECAL_ART = {
  flame(g, w, h, r) { for (let i = 0; i < 3; i++) { const gr = g.createLinearGradient(0, 0, w, 0); gr.addColorStop(0, '#fff2a8'); gr.addColorStop(0.35, '#ffb02e'); gr.addColorStop(0.75, '#ff5a1a'); gr.addColorStop(1, '#b3200f'); g.fillStyle = gr; flamePath(g, 10, 80 + i * 50, w * (0.82 - i * 0.1), 30, r); outline(g, 8); g.fill(); } },
  star(g, w, h) { star5(g, w / 2, h / 2 + 8, 118, 50); outline(g, 18); const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#fff2a8'); gr.addColorStop(0.5, '#ffb02e'); gr.addColorStop(1, '#c2561c'); g.fillStyle = gr; g.fill(); g.fillStyle = '#111214'; for (const [x, y] of [[128, 70], [80, 140], [176, 140]]) { g.beginPath(); g.arc(x, y, 7, 0, TAU); g.fill(); } },
  heart(g, w, h) { g.beginPath(); g.moveTo(128, 220); g.bezierCurveTo(10, 140, 30, 30, 128, 80); g.bezierCurveTo(226, 30, 246, 140, 128, 220); outline(g, 16); g.fillStyle = '#d8322a'; g.fill(); g.strokeStyle = '#111214'; g.lineWidth = 9; g.beginPath(); g.moveTo(128, 82); g.lineTo(110, 120); g.lineTo(140, 145); g.lineTo(118, 190); g.stroke(); g.lineWidth = 5; for (let i = 0; i < 4; i++) { g.beginPath(); g.moveTo(104 + i * 4, 112 + i * 22); g.lineTo(140 + i * 4, 118 + i * 22); g.stroke(); } },
  bolt(g, w, h) { boltPath(g, 128, 128, 220); outline(g, 16); g.fillStyle = '#f2b705'; g.fill(); },
  eyes(g, w, h) { for (const s of [-1, 1]) { const x = 128 + s * 62; g.beginPath(); g.moveTo(x - 52, 110 - s * 0); g.lineTo(x + 52, 110 + s * 30); g.lineTo(x + 40, 170); g.lineTo(x - 40, 170); g.closePath(); outline(g, 14); g.fillStyle = '#f4f6fa'; g.fill(); g.fillStyle = '#ffb02e'; g.beginPath(); g.arc(x, 148, 22, 0, TAU); g.fill(); g.fillStyle = '#111214'; g.beginPath(); g.arc(x, 150, 10, 0, TAU); g.fill(); } },
  rainbow(g, w, h) { const c = ['#d8322a', '#ff7a1a', '#f2b705', '#5fd34a', '#2e8ac8', '#8a4dff']; g.lineCap = 'butt'; c.forEach((k, i) => { g.strokeStyle = k; g.lineWidth = 20; g.beginPath(); g.moveTo(10, 200 - i * 20); g.bezierCurveTo(90, 40 - i * 20, 170, 220 - i * 20, 250, 60 - i * 20); g.stroke(); }); },
  dinofoot(g, w, h) { g.fillStyle = '#111214'; g.beginPath(); g.ellipse(128, 170, 50, 40, 0, 0, TAU); g.fill(); for (const [x, y, a] of [[60, 80, -0.5], [128, 50, 0], [196, 80, 0.5]]) { g.save(); g.translate(x, y); g.rotate(a); g.beginPath(); g.moveTo(-22, 50); g.lineTo(0, -40); g.lineTo(22, 50); g.closePath(); g.fill(); g.restore(); } g.fillStyle = '#c2561c'; g.beginPath(); g.ellipse(128, 170, 34, 26, 0, 0, TAU); g.fill(); },
  flower(g, w, h) { g.beginPath(); for (let i = 0; i < 28; i++) { const a = i / 28 * TAU, q = i % 2 ? 92 : 118; g.lineTo(128 + Math.cos(a) * q, 128 + Math.sin(a) * q); } g.closePath(); outline(g, 10); g.fillStyle = '#c7ccd5'; g.fill(); g.fillStyle = '#6b727e'; g.beginPath(); g.arc(128, 128, 60, 0, TAU); g.fill(); g.fillStyle = '#ff5a1a'; g.beginPath(); g.arc(128, 128, 22, 0, TAU); g.fill(); },
  skull(g, w, h) { g.beginPath(); g.arc(128, 110, 86, Math.PI * 0.85, Math.PI * 2.15); g.lineTo(178, 200); g.lineTo(78, 200); g.closePath(); outline(g, 14); g.fillStyle = '#ece4d0'; g.fill(); g.fillStyle = '#111214'; for (const x of [92, 164]) { g.beginPath(); g.ellipse(x, 120, 26, 30, 0, 0, TAU); g.fill(); } g.beginPath(); g.moveTo(128, 145); g.lineTo(114, 172); g.lineTo(142, 172); g.fill(); for (let i = 0; i < 4; i++) g.fillRect(92 + i * 20, 186, 6, 22); },
  hazard(g, w, h) { g.save(); g.beginPath(); g.rect(10, 70, 236, 116); g.clip(); g.fillStyle = '#f2b705'; g.fillRect(0, 0, w, h); g.fillStyle = '#111214'; for (let i = -4; i < 8; i++) { g.beginPath(); g.moveTo(i * 48, 70); g.lineTo(i * 48 + 24, 70); g.lineTo(i * 48 + 140, 186); g.lineTo(i * 48 + 116, 186); g.fill(); } g.restore(); g.beginPath(); g.rect(10, 70, 236, 116); outline(g, 10); },
  claws(g, w, h) { for (let i = 0; i < 3; i++) { g.beginPath(); g.moveTo(40 + i * 30, 30); g.quadraticCurveTo(110 + i * 30, 120, 190 + i * 30, 230); g.lineTo(178 + i * 30, 232); g.quadraticCurveTo(100 + i * 30, 128, 30 + i * 30, 34); g.closePath(); g.fillStyle = '#111214'; g.fill(); g.strokeStyle = '#c7ccd5'; g.lineWidth = 4; g.stroke(); } },
  cog(g, w, h) { g.beginPath(); for (let i = 0; i < 24; i++) { const a = (i + 0.5) / 24 * TAU, q = (i >> 1) % 2 ? 90 : 118; g.lineTo(128 + Math.cos(a) * q, 128 + Math.sin(a) * q); } g.closePath(); outline(g, 10); g.fillStyle = '#9aa3b0'; g.fill(); g.fillStyle = '#111214'; g.beginPath(); g.arc(128, 128, 36, 0, TAU); g.fill(); },
  fangs(g, w, h) { g.beginPath(); g.moveTo(8, 128); g.quadraticCurveTo(80, 40, 250, 90); g.lineTo(250, 170); g.quadraticCurveTo(80, 216, 8, 128); outline(g, 12); g.fillStyle = '#5a0c0c'; g.fill(); g.fillStyle = '#f4f6fa'; for (let i = 0; i < 7; i++) { const x = 40 + i * 30; g.beginPath(); g.moveTo(x, 90 - i * 0.5); g.lineTo(x + 22, 92); g.lineTo(x + 11, 130); g.fill(); g.beginPath(); g.moveTo(x + 6, 168); g.lineTo(x + 28, 166); g.lineTo(x + 17, 132); g.fill(); } g.fillStyle = '#ffb02e'; g.beginPath(); g.arc(225, 105, 10, 0, TAU); g.fill(); },
};
function decalTex(ctx, id) {
  return texture(ctx, 'decal.' + id, 256, 256, (g, w, h, r) => { g.clearRect(0, 0, w, h); if (DECAL_ART[id]) DECAL_ART[id](g, w, h, r); wear(g, w, h, r); });
}
function numberTex(ctx, num) {
  return texture(ctx, 'num.' + num, 128, 128, (g, w, h, r) => {
    g.clearRect(0, 0, w, h);
    g.beginPath(); g.arc(64, 64, 60, 0, TAU); g.fillStyle = '#111214'; g.fill();
    g.beginPath(); g.arc(64, 64, 52, 0, TAU); g.fillStyle = '#ece8de'; g.fill();
    g.fillStyle = '#111214'; g.font = 'italic 900 ' + (num.length > 1 ? 58 : 72) + 'px "Arial Black", Impact, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(num, 64, 68);
    wear(g, w, h, r);
  });
}

/* ======================================================================================================
   8. the rig: buildCar(ctx, build, opts) -> CarRig
   ====================================================================================================== */
const NOSHADOW = new Set(['glow', 'beam', 'flame', 'glass', 'ice', 'decal', 'roundel']);
const MUD = { r: 0.29, g: 0.23, b: 0.16 };
function normBuild(b) {
  const C = cat(); b = b || {};
  return {
    body: C.BODIES[b.body] ? b.body : 'monster', wheels: C.WHEELS[b.wheels] ? b.wheels : 'monster',
    color: C.PAINTS[b.color] ? b.color : '#e53935', decal: C.DECALS[b.decal] ? b.decal : 'none',
    buddy: b.buddy && C.BUDDIES[b.buddy] ? b.buddy : null, number: typeof b.number === 'string' && /^\d{1,2}$/.test(b.number) ? b.number : '',
    extras: { ...(b.extras || {}) },
  };
}
function dims(st, body, wheel) {
  const b = body.stats;
  return { L: b.size.l, W: b.size.w, H: b.size.h, wb: st.wheelbase, tr: st.track, R: b.wheelR, rh: b.rideH, fz: st.wheelbase / 2, rz: -st.wheelbase / 2,
    ww: wheel.width, lift: st.wheelR - b.wheelR };
}
function finishKit(k, parent, mats, rig, oy = 0) {
  const by = new Map();
  for (const p of k.parts) { if (!by.has(p.key)) by.set(p.key, []); by.get(p.key).push(p); }
  for (const [key, parts] of by) {
    const geo = merge(parts), mesh = new T.Mesh(geo, rig.ghost ? mats.ghost : (mats[key] || mats.dark));
    if (key === 'paint') {   /* body-space height for the two-tone line (sub-assemblies add their pivot's) */
      const P = geo.attributes.position, by2 = new Float32Array(P.count);
      for (let i = 0; i < P.count; i++) by2[i] = P.array[i * 3 + 1] + oy;
      geo.setAttribute('aBodyY', new T.BufferAttribute(by2, 1));
    }
    rig.own.push(geo); mesh.name = key;
    mesh.castShadow = rig.shadows && !NOSHADOW.has(key);
    parent.add(mesh); rig.meshes.push(mesh);
    if (key === 'paint' || key === 'dark' || key === 'steel') rig.dentable.push(mesh);
  }
  for (const s of k.subs) {
    const g = new T.Group(); g.name = s.name; g.position.set(s.at[0], s.at[1], s.at[2]); g.rotation.x = s.rx || 0;
    parent.add(g); rig.parts[s.name] = g; finishKit(s, g, mats, rig, oy + s.at[1]);
  }
  rig.anims.push(...k.anims);
}
/* a flame: widest at the pipe, tapering to a point one unit out along +y */
function flameGeo(ctx) { return memo(ctx, 'cars.g.flame', () => { const g = new T.ConeGeometry(0.5, 1, 8, 1, true); g.translate(0, 0.5, 0); return g; }); }
function coiloverGeo(ctx) {
  return memo(ctx, 'cars.g.coilover', () => {
    const k = new Kit(ctx);
    k.cyl('chrome', 0, 0.3, 0, 0.05, 0.6, 'y', { n: 6, tint: 'chrome' });
    k.cyl('chrome', 0, 0.75, 0, 0.075, 0.5, 'y', { n: 6, tint: 'darksteel' });
    for (let i = 0; i < 7; i++) k.ring('chrome', 0, 0.12 + i * 0.12, 0, 0.11, 'y', { t: 0.22, n: 8, tint: 'hot' });
    return merge(k.parts);
  });
}
const BODY_SCALE = { tracks: 0.92 };
function buildCar(ctx, build, opts = {}) {
  T = ctx.THREE;
  build = normBuild(build);
  const C = cat(), body = C.BODIES[build.body], wheel = C.WHEELS[build.wheels], st = C.stats(build), def = BODY_DEFS[body.id] || BODY_DEFS.monster;
  const d = dims(st, body, wheel), calm = !!ctx.reducedMotion;
  const rig = { own: [], meshes: [], dentable: [], anims: [], parts: {}, ghost: !!opts.ghost, shadows: opts.shadows !== false && ctx.quality !== 'low' && !opts.ghost,
    sway: { ax: 0, lat: 0, last: 0, roll: 0, pitch: 0, bob: 0, bobV: 0, bx: 0, bz: 0, bvx: 0, bvz: 0 }, damage: 0, grime: 0 };

  /* the body */
  const k = new Kit(ctx);
  def.build(k, d, st, build);
  const S = k.spots;
  S.roof = S.roof || { x: 0, y: d.H, z: 0, w: d.W * 0.6, l: d.L * 0.25 };
  S.hood = S.hood || { x: 0, y: d.H * 0.75, z: d.L * 0.3, w: d.W * 0.5, l: d.L * 0.2 };
  S.rear = S.rear || { x: 0, y: d.rh + 0.8, z: -d.L / 2 + 0.2 };
  S.nose = S.nose || { x: 0, y: d.rh + 0.35, z: d.L / 2 };
  if (SIGNATURE[body.cls]) SIGNATURE[body.cls](k, S, d, build, def.skip || '');
  for (const id of Object.keys(build.extras)) if (build.extras[id] && EXTRA_BUILD[id]) EXTRA_BUILD[id](k, S, d, build);
  if (build.buddy) buddyKit(k, build.buddy, !!build.extras.partyhat, S.roof);
  const paintDef = cat().PAINTS[build.color], stencil = build.decal !== 'none' ? build.decal : (paintDef && paintDef.stencil) || 'none';
  if (stencil !== 'none') for (const p of k.decals) {
    if (!(p.s > 0)) continue;
    if (p.top) k.put('decal', 'plane', p.x, p.y + 0.012, p.z, p.s * 1.2, p.s * 1.2, 1, { rx: -HP + (p.tilt || 0), ry: Math.PI, order: 'YXZ' });
    else k.put('decal', p.side > 0 ? 'plane' : 'planeF', p.side * (p.x + 0.014), p.y, p.z, p.s * 1.25, p.s * 1.25, 1, { ry: p.side * HP });
  }
  if (build.number) for (const p of k.roundels) k.put('roundel', 'plane', p.side * (p.x + 0.02), p.y, p.z, p.s, p.s, 1, { ry: p.side * HP });

  const mats = { ...shared(ctx), paint: paintMaterial(ctx, build.color) };
  rig.own.push(mats.paint);
  if (k.decals.length && stencil !== 'none') { mats.decal = new T.MeshStandardMaterial({ map: decalTex(ctx, stencil), transparent: true, alphaTest: 0.3, metalness: 0.3, roughness: 0.55, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }); rig.own.push(mats.decal); }
  if (build.number) { mats.roundel = new T.MeshStandardMaterial({ map: numberTex(ctx, build.number), transparent: true, alphaTest: 0.3, metalness: 0.1, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }); rig.own.push(mats.roundel); }
  if (def.tracked) {
    const tt = treadTex(ctx).clone(); tt.repeat.set(1, 6); tt.needsUpdate = true;
    mats.track = shade(new T.MeshStandardMaterial({ color: 0x9a9a9a, map: tt, metalness: 0.4, roughness: 0.8, flatShading: true, vertexColors: true }), { rim: 0.3 });
    rig.own.push(mats.track, tt); rig.trackTex = tt;
  }

  const group = new T.Group(); group.name = 'car:' + body.id;
  const pivotY = d.R + d.lift, sway = new T.Group(), bodyG = new T.Group();
  sway.position.y = pivotY; bodyG.position.y = -pivotY + d.lift;
  group.add(sway); sway.add(bodyG);
  finishKit(k, bodyG, mats, rig);
  splitPaint(rig.meshes, mats.paint, def.split);
  /* a chase-cam fill so the machine pops against dark worlds (opts.fill === false turns it off) */
  if (opts.fill !== false && !rig.ghost) { const fl = new T.PointLight(0xffe6c8, opts.fill || 28, Math.max(9, d.L * 2), 1.4); fl.position.set(0, d.H + d.lift + 1.6, -d.L * 0.85); group.add(fl); }

  /* exhaust flames: one instance per outlet, in body space */
  let flames = null;
  const nX = k.exhaust.length;
  if (nX && !rig.ghost) {   /* outer cone then white-hot core per outlet, one draw call: instance colours tint them */
    flames = new T.InstancedMesh(flameGeo(ctx), mats.flame, nX * 2); flames.frustumCulled = false; bodyG.add(flames);
    const cOut = new T.Color(0xff4a10), cCore = new T.Color(0xffe8a0);
    for (let i = 0; i < nX; i++) { flames.setColorAt(i, cOut); flames.setColorAt(nX + i, cCore); }
    flames.instanceColor.needsUpdate = true;
  }

  /* wheels: four contract pivots, plus dummies for extra axles; one InstancedMesh per wheel material */
  const fs = def.fs || 1, rs = def.rs || 1, scl = def.tracked ? BODY_SCALE.tracks : 1, hover = !!def.hover;
  const spots = [];
  for (let i = 0; i < 4; i++) spots.push({ x: i % 2 ? -d.tr / 2 : d.tr / 2, z: i < 2 ? d.fz : d.rz, front: i < 2, src: i, s: (i < 2 ? fs : rs) * scl });
  if (body.axles === 3) for (const x of [d.tr / 2, -d.tr / 2]) spots.push({ x, z: d.rz + 1.3, front: false, src: x > 0 ? 2 : 3, s: rs * scl });
  if (body.axles === 4) for (const x of [d.tr / 2, -d.tr / 2]) { spots.push({ x, z: d.fz - d.wb / 3, front: true, src: x > 0 ? 0 : 1, s: fs * scl, steerK: 0.5 }); spots.push({ x, z: d.rz + d.wb / 3, front: false, src: x > 0 ? 2 : 3, s: rs * scl }); }
  const pivots = spots.map((p, i) => { const o = new T.Object3D(); o.name = ['FL', 'FR', 'RL', 'RR'][i] || 'X' + i; o.position.set(p.x, st.wheelR * p.s, p.z); o.userData.spin = 0; group.add(o); return o; });
  const orient = spots.map(p => { const m = new T.Matrix4(); if (hover) { m.makeRotationZ(-HP); m.scale(new T.Vector3(p.s * 0.35, p.s * 0.85, p.s * 0.85)); } else { if (p.x < 0) m.makeRotationY(Math.PI); m.scale(new T.Vector3(p.s, p.s, p.s)); } return m; });
  const geos = wheelGeos(ctx, build.wheels, st.wheelR, wheel.width);
  const wheelMeshes = [];
  for (const [key, geo] of geos) {
    const im = new T.InstancedMesh(geo, rig.ghost ? mats.ghost : (mats[key] || mats.dark), spots.length);
    im.frustumCulled = false; im.castShadow = rig.shadows && key !== 'glow' && key !== 'ice'; im.name = 'wheels.' + key;
    group.add(im); wheelMeshes.push(im);
  }
  /* coilovers from the frame to each hub */
  let shocks = null;
  const sh = def.shocks;
  if (sh && !rig.ghost) { shocks = new T.InstancedMesh(coiloverGeo(ctx), mats.chrome, 4); shocks.frustumCulled = false; shocks.castShadow = rig.shadows; group.add(shocks); }

  const compRest = Math.min(0.9, Math.max(0.05, st.mass * 9.81 / 4 / st.suspK / st.suspTravel));
  const travel = st.suspTravel, softness = Math.min(1.6, Math.max(0.4, 45000 / st.suspK));
  const rest = { speed: 0, rpm: 0.08, boosting: false, air: false, wheels: [0, 1, 2, 3].map(() => ({ comp: compRest, spin: 0, steer: 0, contact: true })) };
  const tm = new T.Matrix4(), tm2 = new T.Matrix4(), tv = new T.Vector3(), tv2 = new T.Vector3(), tq = new T.Quaternion(), ts = new T.Vector3(), up = new T.Vector3(0, 1, 0);
  const lift = d.lift;

  function update(car, dt = 1 / 60, t = 0) {
    car = car || rest;
    const sp = car.speed || 0, dtc = Math.max(1e-3, dt), w = rig.sway, cw = car.wheels || rest.wheels;
    /* body sway: pitch on accel and brake, roll into corners, a little engine shake */
    const ax = Math.max(-40, Math.min(40, (sp - w.last) / dtc)); w.last = sp;
    w.ax += (ax - w.ax) * Math.min(1, dt * 6);
    const lat = car.air ? 0 : ((cw[0] && cw[0].steer) || 0) * sp;
    w.lat += (lat - w.lat) * Math.min(1, dt * 5);
    let pitch = Math.max(-0.07, Math.min(0.07, -w.ax * 0.0022 * softness)), roll = Math.max(-0.09, Math.min(0.09, -w.lat * 0.005 * softness));
    if (!calm) { const e = 0.4 + (car.rpm || 0); roll += Math.sin(t * 47) * 0.0022 * e; pitch += Math.sin(t * 31) * 0.0016 * e; }
    w.pitch += (pitch - w.pitch) * Math.min(1, dt * 8); w.roll += (roll - w.roll) * Math.min(1, dt * 8);
    sway.rotation.set(w.pitch, 0, w.roll);
    /* wheels */
    for (let i = 0; i < spots.length; i++) {
      const p = spots[i], src = cw[p.src] || rest.wheels[0], pv = pivots[i];
      const comp = Number.isFinite(src.comp) ? src.comp : compRest;
      const hubY = (hover ? 0.3 : st.wheelR * p.s) + Math.max(-travel, Math.min(travel, (comp - compRest) * travel));   /* compression lifts the wheel toward the body */
      pv.position.set(p.x, hubY, p.z);
      pv.rotation.set(0, p.front ? -(src.steer || 0) * (p.steerK || 1) : 0, 0);
      const spin = (src.spin || 0) + (hover ? t * 9 : 0);
      pv.userData.spin = spin;
      pv.updateMatrix();
      tm.multiplyMatrices(pv.matrix, tm2.makeRotationX(spin)).multiply(orient[i]);
      for (const im of wheelMeshes) im.setMatrixAt(i, tm);
    }
    for (const im of wheelMeshes) im.instanceMatrix.needsUpdate = true;
    if (shocks) {
      sway.updateMatrix(); bodyG.updateMatrix(); tm2.multiplyMatrices(sway.matrix, bodyG.matrix);
      for (let i = 0; i < 4; i++) {
        const p = spots[i], pv = pivots[i], sx = Math.sign(p.x);
        tv.set(sx * sh.x, sh.y, p.z + (p.front ? -sh.dz : sh.dz)).applyMatrix4(tm2);
        tv2.set(p.x - sx * 0.18, pv.position.y, p.z);
        ts.subVectors(tv, tv2); const len = ts.length(); ts.divideScalar(len || 1);
        tq.setFromUnitVectors(up, ts); tm.compose(tv2, tq, ts.set(1, len, 1));
        shocks.setMatrixAt(i, tm);
      }
      shocks.instanceMatrix.needsUpdate = true;
    }
    /* flames */
    if (flames) {
      /* boost: a long roaring cone with a white-hot core; high revs: short blue-orange pops */
      const boost = !!car.boosting, rpm = car.rpm || 0;
      for (let i = 0; i < nX; i++) {
        const e = k.exhaust[i], fl = calm ? 0.5 : 0.5 + 0.5 * Math.sin(t * 61 + i * 2.3) * Math.sin(t * 23 + i);
        const len = boost ? e.s * (1.7 + fl * 0.9) : (rpm > 0.7 ? e.s * (rpm - 0.7) * 2.2 * fl : 0);
        tv.set(e.dir[0], e.dir[1], e.dir[2]);
        if (tv.y > 0.5) tv.z -= Math.min(0.9, Math.abs(sp) * 0.025);   /* stack flames lean back with speed */
        tv.normalize(); tq.setFromUnitVectors(up, tv);
        const wdt = len > 0 ? (0.24 + 0.1 * e.s) * (boost ? 1 + fl * 0.25 : 0.8) : 1e-4;
        tv2.set(e.p[0], e.p[1], e.p[2]);
        tm.compose(tv2, tq, ts.set(wdt, Math.max(1e-4, len), wdt)); flames.setMatrixAt(i, tm);
        tm.compose(tv2, tq, ts.set(wdt * 0.5, Math.max(1e-4, len * 0.62), wdt * 0.5)); flames.setMatrixAt(nX + i, tm);
      }
      flames.instanceMatrix.needsUpdate = true;
    }
    if (rig.trackTex) rig.trackTex.offset.y -= sp * dt * 0.25;
    /* buddy bobble: a damped spring kicked by accel and corners */
    if (rig.parts.bhead) {
      const kx = -w.ax * 0.02, kz = w.lat * 0.02;
      w.bvx += ((kx - w.bx) * 60 - w.bvx * 4) * dt; w.bx += w.bvx * dt;
      w.bvz += ((kz - w.bz) * 60 - w.bvz * 4) * dt; w.bz += w.bvz * dt;
      const idle = calm ? 0 : Math.sin(t * 2.1) * 0.05;
      rig.parts.bhead.rotation.set(Math.max(-0.6, Math.min(0.6, w.bx)) + idle * 0.5, calm ? 0 : Math.sin(t * 0.9) * 0.15, Math.max(-0.6, Math.min(0.6, w.bz)) + idle);
    }
    for (const fn of rig.anims) fn(rig.parts, car, dt, t, calm, rigApi);
  }
  function refreshPaint() {
    const m = mats.paint, b = m.userData.base;
    m.color.setRGB(b.r + (MUD.r - b.r) * rig.grime * 0.55, b.g + (MUD.g - b.g) * rig.grime * 0.55, b.b + (MUD.b - b.b) * rig.grime * 0.55).multiplyScalar(1 - rig.damage * 0.025);
    m.roughness = Math.min(1, m.userData.rough + rig.grime * 0.4 + rig.damage * 0.03);
  }
  function setDamage(n) {
    n = Math.max(0, Math.min(9, +n || 0)); rig.damage = n;
    const amp = n / 9 * 0.085;
    for (const mesh of rig.dentable) {
      const g = mesh.geometry, a = g.attributes.position;
      if (!g.userData.orig) g.userData.orig = a.array.slice();
      const o = g.userData.orig, p = a.array;
      for (let i = 0; i < p.length; i += 3) {
        let h = Math.imul(Math.round(o[i] * 40) | 0, 73856093) ^ Math.imul(Math.round(o[i + 1] * 40) | 0, 19349663) ^ Math.imul(Math.round(o[i + 2] * 40) | 0, 83492791);
        h = Math.imul(h ^ (h >>> 13), 1274126177); const h0 = ((h >>> 0) % 1000) / 1000;
        h = Math.imul(h ^ (h >>> 15), 2246822519); const h1 = ((h >>> 0) % 1000) / 1000;
        h = Math.imul(h ^ (h >>> 13), 3266489917); const h2 = ((h >>> 0) % 1000) / 1000, h3 = (((h >>> 7) >>> 0) % 1000) / 1000;
        const on = n > 0 && h0 < 0.3 + n * 0.05 ? amp : 0;
        p[i] = o[i] + (h1 - 0.5) * on * 2; p[i + 1] = o[i + 1] + (h2 - 0.65) * on * 2; p[i + 2] = o[i + 2] + (h3 - 0.5) * on * 2;
      }
      a.needsUpdate = true;
    }
    refreshPaint();
  }
  function setGrime(g) { rig.grime = Math.max(0, Math.min(1, +g || 0)); refreshPaint(); }
  function dispose() {
    group.removeFromParent();
    for (const o of rig.own) if (o && o.dispose) o.dispose();
    for (const im of wheelMeshes) im.dispose();
    if (flames) flames.dispose(); if (shocks) shocks.dispose();
  }
  const L = v => [v[0], v[1] + lift, v[2]];
  const rigApi = {
    group, wheels: pivots.slice(0, 4), update, setDamage, setGrime, dispose,
    anchors: {
      exhaust: k.exhaust.map(e => L(e.p)), cam: [0, d.H + lift + 1.6, -Math.max(6, d.L * 1.35)], roof: L([S.roof.x, S.roof.y, S.roof.z]),
      smoke: k.smoke.map(L), nose: L([0, S.nose.y, S.nose.z]), rear: L([0, S.rear.y, S.rear.z]),
    },
    parts: rig.parts, sway: rig.sway, stats: st, build, size: { l: d.L, w: Math.max(d.W, d.tr + wheel.width), h: d.H + lift },
    drawCalls: () => { let n = 0; group.traverse(o => { if (o.isMesh && o.visible) n++; }); return n; },
    triangles: () => { let n = 0; group.traverse(o => { if (o.isMesh && o.geometry) { const c = o.geometry.attributes.position.count / 3; n += c * (o.isInstancedMesh ? o.count : 1); } }); return Math.round(n); },
  };
  group.userData.rig = rigApi;
  update(rest, 1 / 60, 0);
  return rigApi;
}

/* ======================================================================================================
   9. thumbnails: a private little renderer (so its colour pipeline matches the screen) and a lit stage
   ====================================================================================================== */
let TR = null;
function thumbStage(ctx) {
  if (TR !== null) return TR;
  try {
    const c = canvas(256), r = new T.WebGLRenderer({ canvas: c, antialias: true, alpha: true, preserveDrawingBuffer: true });
    r.outputColorSpace = T.SRGBColorSpace; r.toneMapping = T.ACESFilmicToneMapping; r.toneMappingExposure = 1.0; r.setClearColor(0x000000, 0);
    const scene = new T.Scene();
    scene.add(new T.HemisphereLight(0xb8c0cc, 0x3a2010, 1.1));
    const key = new T.DirectionalLight(0xffe2b0, 2.3); key.position.set(5, 5, 6); scene.add(key);
    const rim = new T.DirectionalLight(0xff6a1a, 2.6); rim.position.set(-5, 3, -6); scene.add(rim);
    const fill = new T.DirectionalLight(0x8fd8ff, 0.7); fill.position.set(-6, 2, 4); scene.add(fill);
    TR = { r, scene, cam: new T.PerspectiveCamera(28, 1, 0.05, 200) };
  } catch (e) { TR = false; }
  return TR;
}
/* render obj (radius rad around centre cy) from a three-quarter front view into a fresh 2D canvas */
function snap(ctx, obj, px, rad, cy, view = {}) {
  const out = canvas(px), stage = thumbStage(ctx);
  if (!stage) return out;
  stage.r.setSize(px, px, false);
  stage.scene.add(obj);
  const a = view.yaw !== undefined ? view.yaw : 0.75, el = view.pitch !== undefined ? view.pitch : 0.32, dist = rad / Math.sin(stage.cam.fov * Math.PI / 360) * (view.zoom || 1.05);
  stage.cam.position.set(Math.sin(a) * Math.cos(el) * dist, cy + Math.sin(el) * dist, Math.cos(a) * Math.cos(el) * dist);
  stage.cam.lookAt(0, cy, 0); stage.cam.updateProjectionMatrix();
  stage.r.toneMappingExposure = view.light || 1;
  stage.r.render(stage.scene, stage.cam);
  out.getContext('2d').drawImage(stage.r.domElement, 0, 0, px, px);
  stage.scene.remove(obj);
  return out;
}
const buildKey = b => [b.body, b.wheels, b.color, b.decal, b.buddy || '', b.number, Object.keys(b.extras).filter(k => b.extras[k]).sort().join('+')].join('|');
function copyCanvas(c) { const o = canvas(c.width, c.height); o.getContext('2d').drawImage(c, 0, 0); return o; }
function thumb(ctx, build, px = 256, view) {
  T = ctx.THREE;
  const b = normBuild(build), cache = memo(ctx, 'cars.thumbs', () => new Map()), key = buildKey(b) + '@' + px + (view ? JSON.stringify(view) : '');
  if (!cache.has(key)) {
    const rig = buildCar(ctx, b, { shadows: false, fill: false }), s = rig.size;
    const f = (BODY_DEFS[b.body] && BODY_DEFS[b.body].frame) || {}, h = f.h || s.h, l = f.l || s.l;
    const rad = Math.sqrt(l * l + s.w * s.w + h * h) / 2;
    cache.set(key, snap(ctx, rig.group, px, rad, h * 0.45, view));
    rig.dispose();
  }
  return copyCanvas(cache.get(key));
}
/* a single part on its own: wheel, extra, buddy or paint sample. For the garage tiles. */
function partThumb(ctx, kind, id, build, px = 160) {
  T = ctx.THREE;
  const cache = memo(ctx, 'cars.thumbs', () => new Map()), b = normBuild(build), key = `part.${kind}.${id}.${kind === 'extras' || kind === 'buddy' ? b.color : ''}@${px}`;
  if (cache.has(key)) return copyCanvas(cache.get(key));
  if (kind === 'body') { const c = thumb(ctx, { ...b, body: id, buddy: null, decal: 'none', number: '', extras: {} }, px); cache.set(key, c); return copyCanvas(c); }
  const k = new Kit(ctx), mats = { ...shared(ctx), paint: paintMaterial(ctx, kind === 'color' ? id : b.color) };
  let rad = 0.8, cy = 0.4, view;
  if (kind === 'wheels') {
    const w = cat().WHEELS[id]; for (const [key2, geo] of wheelGeos(ctx, id, 0.6, w.width)) k.parts.push({ key: key2, geo, m: new T.Matrix4(), tint: 0xffffff, raw: true });
    view = { yaw: 1.2, pitch: 0.15, light: 1.8 };
  } else if (kind === 'color') {
    k.box('paint', 0, 0.35, 0, 1.2, 0.5, 1.2, { c: 0.18 }); k.ball('paint', 0, 0.85, 0, 0.42, { d: 1 }); k.box('dark', 0, 0.04, 0, 1.4, 0.08, 1.4, { tint: 'gun' });
    rad = 0.9; cy = 0.45;
  } else if (kind === 'buddy') {
    buddyKit(k, id, false, { x: 0, y: 0, z: 0 }); view = { yaw: 0.5, pitch: 0.15, zoom: 0.9 };
  } else if (kind === 'extras' && EXTRA_BUILD[id]) {
    const d = { L: 2.6, W: 1.6, H: 0.8, wb: 2, tr: 1.4, R: 0.3, rh: 0.2, fz: 1, rz: -1, ww: 0.3, lift: 0 };
    const S = { roof: { x: 0, y: 0.8, z: 0, w: 0.9, l: 0.8 }, hood: { x: 0, y: 0.8, z: 0.6, w: 0.6, l: 0.5 }, rear: { x: 0, y: 0.8, z: -1.2 }, nose: { x: 0, y: 0.45, z: 1.3 } };
    EXTRA_BUILD[id](k, S, d, { buddy: null, extras: {} });
    view = { yaw: 0.8, pitch: 0.35, zoom: 0.95 };
  }
  const g = new T.Group(), rig = { own: [], meshes: [], dentable: [], anims: [], parts: {}, shadows: false };
  const raw = k.parts.filter(p => p.raw);
  for (const p of raw) g.add(new T.Mesh(p.geo, mats[p.key] || mats.dark));
  k.parts = k.parts.filter(p => !p.raw);
  finishKit(k, g, mats, rig);
  splitPaint(rig.meshes, mats.paint, 0.45);
  if (kind === 'wheels') g.rotation.y = 0;
  const box = new T.Box3().setFromObject(g), ctr = box.getCenter(new T.Vector3()), sz = box.getSize(new T.Vector3());
  g.position.set(-ctr.x, 0, -ctr.z);
  rad = Math.max(0.2, sz.length() / 2); cy = ctr.y;
  const c = snap(ctx, g, px, rad, cy, view);
  for (const o of rig.own) o.dispose();
  mats.paint.dispose();
  cache.set(key, c);
  return copyCanvas(c);
}
function decalThumb(ctx, id, px = 160) {
  T = ctx.THREE;
  const c = canvas(px), g = c.getContext('2d');
  const gr = g.createLinearGradient(0, 0, 0, px); gr.addColorStop(0, '#555b66'); gr.addColorStop(1, '#24272e'); g.fillStyle = gr; g.fillRect(0, 0, px, px);
  if (id !== 'none') g.drawImage(decalTex(ctx, id).userData.canvas, px * 0.08, px * 0.08, px * 0.84, px * 0.84);
  else { g.strokeStyle = '#9aa3b0'; g.lineWidth = px * 0.06; g.beginPath(); g.arc(px / 2, px / 2, px * 0.3, 0, TAU); g.moveTo(px * 0.29, px * 0.71); g.lineTo(px * 0.71, px * 0.29); g.stroke(); }
  return c;
}


/* ======================================================================================================
   10. the garage bay: a grimy foundry workshop at night. Turntable lift under hazard posts, chain hoists,
       a hanging engine, drums and tyre stacks, a furnace mouth glowing in the back wall, a welder throwing
       sparks, dust in the work lights. Decorative motion stops under reduced motion.
   ====================================================================================================== */
function bayTextures(ctx) {
  return {
    floor: texture(ctx, 'bay.floor', 1024, 1024, (g, w, h, r) => {
      g.fillStyle = '#30343b'; g.fillRect(0, 0, w, h);
      for (let y = 0; y < h; y += 16) for (let x = (y / 16) % 2 * 8; x < w; x += 16) {
        g.save(); g.translate(x, y); g.rotate(((x + y) / 16) % 2 ? 0.8 : -0.8);
        g.fillStyle = '#4b515b'; g.fillRect(-5, -1.5, 10, 3); g.fillStyle = '#1c1f24'; g.fillRect(-5, 1.5, 10, 1.2); g.restore();
      }
      for (let i = 0; i < 26; i++) blot(g, r() * w, r() * h, 20 + r() * 90, '#0a0a0c', 0.5);
      for (let i = 0; i < 10; i++) blot(g, r() * w, r() * h, 10 + r() * 40, '#5a2a10', 0.35);
      g.strokeStyle = 'rgba(10,10,12,0.5)'; g.lineWidth = 14;
      for (let i = 0; i < 6; i++) { g.beginPath(); g.arc(512, 512, 150 + i * 60 + r() * 30, r() * 6, r() * 6 + 2); g.stroke(); }
      g.lineWidth = 10; g.setLineDash([26, 18]); g.strokeStyle = 'rgba(242,183,5,0.75)'; g.beginPath(); g.arc(512, 512, 118, 0, TAU); g.stroke(); g.setLineDash([]);
      scratches(g, w, h, r, 400, '#8d939d', 0.25);
    }),
    wall: texture(ctx, 'bay.wall', 512, 512, (g, w, h, r) => {
      g.fillStyle = '#3a3f48'; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 40; i++) { const x = r() * w, l = 60 + r() * 300, s = g.createLinearGradient(0, 0, 0, l); s.addColorStop(0, 'rgba(138,59,18,0.7)'); s.addColorStop(1, 'rgba(138,59,18,0)'); g.fillStyle = s; g.fillRect(x, r() * 100, 3 + r() * 10, l); }
      for (let i = 0; i < 30; i++) blot(g, r() * w, r() * h, 10 + r() * 50, ['#5a2a10', '#16181c', '#8a3b12'][i % 3], 0.4);
      const gr = g.createLinearGradient(0, h, 0, h * 0.6); gr.addColorStop(0, 'rgba(10,10,12,0.8)'); gr.addColorStop(1, 'rgba(10,10,12,0)'); g.fillStyle = gr; g.fillRect(0, h * 0.6, w, h * 0.4);
      speckle(g, w, h, r, 800, '#111214', 0.2, 0.5, 1, 3);
    }, { repeat: [6, 1] }),
    top: texture(ctx, 'bay.top', 512, 512, (g, w, h, r) => {
      g.fillStyle = '#4b515b'; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 48; i++) { g.save(); g.translate(256, 256); g.rotate(i / 48 * TAU); g.fillStyle = i % 2 ? '#2c3039' : '#5d636d'; g.fillRect(40, -3, 216, 6); g.restore(); }
      g.fillStyle = '#24272e'; g.beginPath(); g.arc(256, 256, 44, 0, TAU); g.fill();
      for (let i = 0; i < 16; i++) { const a = i / 16 * TAU; g.fillStyle = '#c7ccd5'; g.beginPath(); g.arc(256 + Math.cos(a) * 236, 256 + Math.sin(a) * 236, 6, 0, TAU); g.fill(); }
      for (let i = 0; i < 12; i++) blot(g, r() * w, r() * h, 20 + r() * 40, '#0a0a0c', 0.4);
      scratches(g, w, h, r, 200, '#c7ccd5', 0.3);
    }),
  };
}
function corrugated(w, h, pitch = 0.42, depth = 0.12) {
  const pos = [], uv = [], n = Math.round(w / pitch);
  for (let i = 0; i < n; i++) {
    const x0 = -w / 2 + i * pitch, xm = x0 + pitch / 2, x1 = x0 + pitch;
    for (const [a, za, b, zb] of [[x0, 0, xm, depth], [xm, depth, x1, 0]]) {
      pos.push(a, 0, za, b, 0, zb, b, h, zb, a, 0, za, b, h, zb, a, h, za);
      const ua = (a + w / 2) / w, ub = (b + w / 2) / w; uv.push(ua, 0, ub, 0, ub, 1, ua, 0, ub, 1, ua, 1);
    }
  }
  const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2)); g.computeVertexNormals();
  return g;
}
const SPARKS = 260;
function buildBay(ctx) {
  const scene = new T.Scene(), calm = !!ctx.reducedMotion, high = ctx.quality !== 'low', own = [];
  const add = (o, ...x) => { scene.add(o); own.push(...x); return o; };
  scene.background = new T.Color(0x0b0c0f); scene.fog = new T.Fog(0x0b0c0f, 16, 42);
  const tx = bayTextures(ctx), M = shared(ctx);
  scene.add(new T.HemisphereLight(0x7a8290, 0x2a1408, 0.75));
  const key = new T.SpotLight(0xffd9a0, 420, 0, 0.55, 0.65, 2); key.position.set(3.2, 9.5, 4.5); key.target.position.set(0, 0.8, 0);
  if (high) { key.castShadow = true; key.shadow.mapSize.set(1024, 1024); key.shadow.bias = -0.0004; key.shadow.camera.near = 3; key.shadow.camera.far = 20; }
  scene.add(key, key.target);
  const rim = new T.SpotLight(0x8fd8ff, 160, 0, 0.6, 0.8, 2); rim.position.set(-6, 6, -6); rim.target.position.set(0, 1, 0); scene.add(rim, rim.target);
  const molten = new T.PointLight(0xff5a1a, 90, 22, 1.6); molten.position.set(-3.5, 1.4, -7.6); scene.add(molten);
  const weld = new T.PointLight(0xbfe6ff, 0, 9, 1.6); weld.position.set(6.4, 1.4, -5.6); scene.add(weld);
  const floorMat = new T.MeshStandardMaterial({ map: tx.floor, metalness: 0.7, roughness: 0.5, envMap: envMap(ctx), envMapIntensity: 0.5 });
  const floor = add(new T.Mesh(new T.PlaneGeometry(44, 44), floorMat), floorMat); floor.rotation.x = -HP; floor.receiveShadow = high; own.push(floor.geometry);
  const wallMat = new T.MeshStandardMaterial({ map: tx.wall, metalness: 0.6, roughness: 0.6, flatShading: true, envMap: envMap(ctx), envMapIntensity: 0.4 });
  const back = add(new T.Mesh(corrugated(40, 11), wallMat), wallMat); back.position.set(0, 0, -9.5); own.push(back.geometry);
  const side = new T.Mesh(back.geometry, wallMat); side.position.set(-11.5, 0, 0); side.rotation.y = HP; scene.add(side);
  /* everything else is one Kit, merged per material, plus a few movers */
  const k = new Kit(ctx), parts = {};
  /* turntable lift */
  const tt = k.sub('turntable', 0, 0, 0);
  tt.cyl('dark', 0, 0.1, 0, 3.45, 0.2, 'y', { n: 40, tint: 'gun' });
  tt.cyl('hazard', 0, 0.11, 0, 3.55, 0.12, 'y', { n: 40 });
  for (let i = 0; i < 20; i++) { const a = i / 20 * TAU; tt.ball('chrome', Math.cos(a) * 3.3, 0.21, Math.sin(a) * 3.3, 0.05, { tint: 'steel' }); }
  k.cyl('dark', 0, 0.03, 0, 3.9, 0.06, 'y', { n: 40, tint: 'black' });
  k.mir(s => {
    const x = s * 4.6, z = -2.6;
    k.box('hazard', x, 2.6, z, 0.55, 5.2, 0.55, { sharp: true }); k.box('dark', x, 0.1, z, 1.1, 0.2, 1.1, { tint: 'gun' });
    k.cyl('chrome', x - s * 0.45, 1.6, z + 0.3, 0.08, 3.0, 'y', { n: 8 }); k.cyl('dark', x - s * 0.45, 0.6, z + 0.3, 0.14, 1.2, 'y', { n: 8, tint: 'chassis' });
    k.box('dark', x - s * 0.9, 3.2, z + 0.4, 1.4, 0.25, 0.4, { tint: 'chassis' });
    k.cyl('dark', x, 5.3, z, 0.2, 0.1, 'y', { tint: 'black' });
    const b = k.sub(s > 0 ? 'beaconL' : 'beaconR', x, 5.36, z); b.dome('glow', 0, 0, 0, 0.2, { tint: 'amber', sy: 1.4 }); b.box('dark', 0, 0.1, 0, 0.06, 0.2, 0.36, { tint: 'black', sharp: true });
  });
  k.box('dark', 0, 5.25, -2.6, 9.8, 0.4, 0.4, { tint: 'chassis' }); k.box('hazard', 0, 5.0, -2.37, 9.2, 0.16, 0.06, { sharp: true });
  /* ceiling rail, chain hoists, a hanging engine and a swinging hook */
  k.box('dark', 0, 8.0, -0.5, 30, 0.5, 0.3, { tint: 'chassis' }); k.box('dark', 0, 7.72, -0.5, 30, 0.08, 0.7, { tint: 'chassis' }); k.box('dark', 0, 8.28, -0.5, 30, 0.08, 0.7, { tint: 'chassis' });
  for (const [nm, x, len, load] of [['hoistA', -6.2, 3.2, 'engine'], ['hoistB', 6.8, 4.6, 'hook'], ['hoistC', -1.4, 1.6, 'hook']]) {
    k.box('steel', x, 7.55, -0.5, 0.5, 0.3, 0.8, { tint: 'yellow' });
    const h = k.sub(nm, x, 7.35, -0.5);
    for (let i = 0; i < len / 0.16; i++) h.put('steel', 'tor:6:0.22', 0, -0.08 - i * 0.16, 0, 0.12, 0.18, 0.12, { ry: i % 2 ? HP : 0, tint: 'darksteel' });
    h.ring('steel', 0, -len - 0.2, 0.05, 0.18, 'x', { t: 0.25, n: 8, tint: 'darksteel' });
    if (load === 'engine') { v8(h, 0, -len - 1.05, 0, 1.4, { blower: true }); h.rod('steel', [0, -len - 0.2, 0], [0.5, -len - 0.65, 0.4], 0.03, { tint: 'darksteel' }); h.rod('steel', [0, -len - 0.2, 0], [-0.5, -len - 0.65, -0.4], 0.03, { tint: 'darksteel' }); }
  }
  /* furnace mouth in the back wall */
  k.box('dark', -3.5, 1.4, -9.3, 3.2, 2.4, 0.4, { tint: 'black' }); k.box('glow', -3.5, 1.3, -9.25, 2.6, 1.8, 0.1, { tint: 'hot', sharp: true });
  for (let i = 0; i < 7; i++) k.box('dark', -4.7 + i * 0.4, 1.3, -9.12, 0.12, 1.9, 0.12, { tint: 'chassis', sharp: true });
  k.tb('dark', -3.5, 3.0, -9.2, 3.6, 0.8, 0.8, 0.6, 0.6, 0, { tint: 'gun' }); k.cyl('dark', -3.5, 6.5, -9.2, 0.5, 6, 'y', { n: 10, tint: 'gun' });
  /* drums, tyre stacks, toolbox, workbench */
  const rr = rng(5);
  for (const [x, z, tint] of [[6.6, -4.2, 'red'], [7.5, -4.6, 'olive'], [7.1, -3.4, 'gun'], [6.0, -5.2, 'red'], [-7.6, 2.8, 'olive']]) { k.cyl(tint === 'gun' ? 'rust' : 'dark', x, 0.55, z, 0.42, 1.1, 'y', { n: 12, tint: tint === 'gun' ? undefined : tint }); k.ring('dark', x, 0.3, z, 0.43, 'y', { t: 0.06, tint: 'black' }); k.ring('dark', x, 0.85, z, 0.43, 'y', { t: 0.06, tint: 'black' }); }
  k.cyl('hazard', 7.5, 1.18, -4.6, 0.43, 0.14, 'y', { n: 12 });
  for (const [x, z, n] of [[-7.4, -4.2, 6], [-6.2, -5.4, 4], [-8.4, -2.4, 3]]) for (let i = 0; i < n; i++) k.ring('dark', x + (rr() - 0.5) * 0.12, 0.2 + i * 0.38, z, 0.62, 'y', { t: 0.42, n: 12, tint: 'rubber' });
  k.box('dark', -8.6, 1.2, 0.2, 1.0, 2.4, 1.8, { tint: 'red' });
  for (let i = 0; i < 6; i++) k.box('chrome', -8.08, 0.3 + i * 0.36, 0.2, 0.04, 0.06, 1.2, { sharp: true, tint: 'steel' });
  k.box('dark', 6.8, 1.0, -6.4, 3.2, 0.12, 1.2, { tint: 'chassis' }); k.mir(s => k.box('dark', 6.8 + s * 1.4, 0.5, -6.4, 0.12, 1.0, 1.0, { tint: 'chassis' }));
  k.box('steel', 6.0, 1.22, -6.3, 0.4, 0.3, 0.3, { tint: 'darksteel' }); k.box('rust', 7.4, 1.25, -6.4, 0.8, 0.35, 0.6);
  k.rod('dark', [6.5, 1.1, -6.0], [6.4, 1.45, -5.6], 0.04, { tint: 'black' });
  /* hanging work lamps with light cones */
  for (const x of [-1.6, 1.6]) {
    k.rod('dark', [x, 8, 0.6], [x, 6.6, 0.6], 0.02, { tint: 'black' });
    k.cone('dark', x, 6.45, 0.6, 0.45, 0.4, '+y', { n: 10, tint: 'gun' }); k.ball('glow', x, 6.25, 0.6, 0.14, { tint: 'light' });
    k.put('beamW', 'cone:16', x, 3.1, 0.6, 3.6, 6.4, 3.6, {});
  }
  const mats = { ...M, beamW: new T.MeshBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0.045, blending: T.AdditiveBlending, depthWrite: false, side: T.DoubleSide }) };
  own.push(mats.beamW);
  const rig = { own, meshes: [], dentable: [], anims: [], parts, shadows: high };
  finishKit(k, scene, mats, rig);
  for (const m of rig.meshes) { m.receiveShadow = high && (m.name === 'dark' || m.name === 'hazard'); }
  /* sparks and dust: two Points pools */
  const sp = { pos: new Float32Array(SPARKS * 3), vel: new Float32Array(SPARKS * 3), life: new Float32Array(SPARKS), next: 0 };
  const sGeo = new T.BufferGeometry(); sGeo.setAttribute('position', new T.BufferAttribute(sp.pos, 3)); own.push(sGeo);
  const sMat = new T.PointsMaterial({ color: 0xffc070, size: 0.09, transparent: true, blending: T.AdditiveBlending, depthWrite: false }); own.push(sMat);
  const sparks = new T.Points(sGeo, sMat); sparks.frustumCulled = false; scene.add(sparks);
  for (let i = 0; i < SPARKS; i++) sp.pos[i * 3 + 1] = -99;
  function burst(x, y, z, n, power = 1) {
    for (let j = 0; j < n; j++) {
      const i = sp.next; sp.next = (sp.next + 1) % SPARKS;
      sp.pos[i * 3] = x; sp.pos[i * 3 + 1] = y; sp.pos[i * 3 + 2] = z;
      const a = rr() * TAU, u = rr();
      sp.vel[i * 3] = Math.cos(a) * (1 + u * 3) * power; sp.vel[i * 3 + 1] = (1.5 + rr() * 4) * power; sp.vel[i * 3 + 2] = Math.sin(a) * (1 + u * 3) * power;
      sp.life[i] = 0.5 + rr() * 0.9;
    }
  }
  const DUST = 150, dust = new Float32Array(DUST * 3);
  for (let i = 0; i < DUST; i++) { dust[i * 3] = (rr() - 0.5) * 7; dust[i * 3 + 1] = rr() * 6.2; dust[i * 3 + 2] = (rr() - 0.5) * 5 + 0.6; }
  const dGeo = new T.BufferGeometry(); dGeo.setAttribute('position', new T.BufferAttribute(dust, 3)); own.push(dGeo);
  const dMat = new T.PointsMaterial({ color: 0xffe2b0, size: 0.035, transparent: true, opacity: 0.55, depthWrite: false }); own.push(dMat);
  scene.add(new T.Points(dGeo, dMat));
  let weldT = 0, weldOn = 0;
  function update(dt, t) {
    if (!calm) {
      parts.beaconL.rotation.y = t * 4; parts.beaconR.rotation.y = -t * 4 + 1;
      parts.hoistB.rotation.z = Math.sin(t * 0.7) * 0.06; parts.hoistB.rotation.x = Math.sin(t * 0.53) * 0.04;
      parts.hoistA.rotation.y = Math.sin(t * 0.2) * 0.3; parts.hoistC.rotation.z = Math.sin(t * 0.9 + 1) * 0.05;
      molten.intensity = 80 + Math.sin(t * 3.1) * 10 + Math.sin(t * 7.7) * 6;
      weldT -= dt;
      if (weldT <= 0) { weldOn = weldOn ? 0 : 0.4 + rr() * 1.2; weldT = weldOn || 0.6 + rr() * 2.2; }
      weld.intensity = weldOn ? 18 + rr() * 30 : 0;
      if (weldOn) burst(6.4, 1.15, -5.7, 3, 0.7);
      for (let i = 0; i < DUST; i++) { dust[i * 3 + 1] += dt * 0.06; dust[i * 3] += Math.sin(t * 0.3 + i) * dt * 0.03; if (dust[i * 3 + 1] > 6.2) dust[i * 3 + 1] = 0; }
      dGeo.attributes.position.needsUpdate = true;
    }
    for (let i = 0; i < SPARKS; i++) {
      if (sp.life[i] <= 0) continue;
      sp.life[i] -= dt;
      sp.vel[i * 3 + 1] -= 9.8 * dt;
      sp.pos[i * 3] += sp.vel[i * 3] * dt; sp.pos[i * 3 + 1] += sp.vel[i * 3 + 1] * dt; sp.pos[i * 3 + 2] += sp.vel[i * 3 + 2] * dt;
      if (sp.pos[i * 3 + 1] < 0.02) { sp.pos[i * 3 + 1] = 0.02; sp.vel[i * 3 + 1] *= -0.35; sp.vel[i * 3] *= 0.6; sp.vel[i * 3 + 2] *= 0.6; }
      if (sp.life[i] <= 0) sp.pos[i * 3 + 1] = -99;
    }
    sGeo.attributes.position.needsUpdate = true;
  }
  function dispose() { for (const o of own) if (o && o.dispose) o.dispose(); }
  return { scene, turntable: parts.turntable, update, burst, dispose, key };
}

/* ======================================================================================================
   11. the garage scene (VROOM.scenes.garage): tabs, part strip, stat bars, buy plate, workbench.
       Wordless: pictograms, numerals and stars only. Every target is at least 88 stage px.
       Selecting an owned part bolts it on; selecting a locked part previews it with a buy plate.
   ====================================================================================================== */
const svg = (body, vb = 64) => `<svg viewBox="0 0 ${vb} ${vb}" aria-hidden="true">${body}</svg>`;
const INK = '#c7ccd5', HOT = '#ff5a1a';
const GX_ICONS = {
  body: svg(`<path d="M6 36 L10 24 L24 22 L30 14 L46 14 L50 24 L58 26 L58 38 Z" fill="${INK}"/><rect x="31" y="17" width="12" height="7" fill="#2c3039"/><circle cx="18" cy="42" r="10" fill="#1a1c21" stroke="${INK}" stroke-width="4"/><circle cx="47" cy="42" r="10" fill="#1a1c21" stroke="${INK}" stroke-width="4"/><path d="M50 14 V6 M54 14 V8" stroke="${HOT}" stroke-width="3"/>`),
  wheels: svg(`<circle cx="32" cy="32" r="26" fill="#1a1c21" stroke="${INK}" stroke-width="5" stroke-dasharray="7 4"/><circle cx="32" cy="32" r="14" fill="none" stroke="${INK}" stroke-width="4"/><path d="M32 18 V46 M18 32 H46 M22 22 L42 42 M42 22 L22 42" stroke="${INK}" stroke-width="3"/><circle cx="32" cy="32" r="5" fill="${HOT}"/>`),
  color: svg(`<rect x="18" y="20" width="22" height="38" rx="4" fill="${INK}"/><rect x="22" y="10" width="14" height="10" fill="#6b727e"/><rect x="25" y="5" width="8" height="6" fill="${HOT}"/><path d="M40 9 L56 4 M40 12 L58 12 M40 15 L56 20" stroke="${HOT}" stroke-width="3"/><rect x="18" y="32" width="22" height="10" fill="${HOT}"/>`),
  decal: svg(`<path d="M10 52 C10 30 26 34 22 14 C34 22 30 32 38 30 C36 22 42 18 46 10 C54 26 58 40 50 52 Z" fill="${HOT}" stroke="#111214" stroke-width="3"/><path d="M22 52 C22 42 30 42 30 34 C38 42 42 46 38 52 Z" fill="#ffd36b"/>`),
  extras: svg(`<path d="M4 22 H60 L56 30 H8 Z" fill="${INK}"/><rect x="14" y="30" width="5" height="16" fill="#6b727e"/><rect x="45" y="30" width="5" height="16" fill="#6b727e"/><rect x="8" y="46" width="48" height="10" rx="3" fill="#383d47"/><circle cx="16" cy="51" r="2.5" fill="${HOT}"/><circle cx="48" cy="51" r="2.5" fill="${HOT}"/>`),
  buddy: svg(`<circle cx="32" cy="22" r="17" fill="${INK}"/><circle cx="25" cy="20" r="4" fill="${HOT}"/><circle cx="39" cy="20" r="4" fill="${HOT}"/><path d="M24 30 H40" stroke="#1a1c21" stroke-width="3"/><path d="M26 40 h12 M24 45 h16 M26 50 h12" stroke="#6b727e" stroke-width="4"/><rect x="20" y="54" width="24" height="6" rx="2" fill="#383d47"/>`),
  number: svg(`<circle cx="32" cy="32" r="27" fill="#ece8de" stroke="#111214" stroke-width="4"/><path d="M26 14 L22 50 M40 14 L36 50 M14 26 H50 M12 39 H48" stroke="#111214" stroke-width="5"/>`),
  bench: svg(`<path d="M12 50 L36 26 M40 8 a10 10 0 1 0 14 14 l-8 -2 -4 -4 Z" stroke="${INK}" stroke-width="7" fill="none" stroke-linecap="round"/><rect x="34" y="34" width="20" height="22" rx="2" fill="#6b727e"/><rect x="38" y="28" width="12" height="8" fill="${HOT}"/>`),
  engine: svg(`<rect x="10" y="24" width="40" height="26" rx="3" fill="${INK}"/><rect x="18" y="12" width="24" height="12" fill="#6b727e"/><rect x="24" y="6" width="12" height="6" fill="${HOT}"/><rect x="50" y="30" width="8" height="12" fill="#6b727e"/><rect x="4" y="30" width="6" height="12" fill="#6b727e"/>`),
  armor: svg(`<path d="M32 6 L54 14 V32 C54 46 42 54 32 58 C22 54 10 46 10 32 V14 Z" fill="${INK}" stroke="#111214" stroke-width="3"/><circle cx="20" cy="18" r="2.5" fill="#383d47"/><circle cx="44" cy="18" r="2.5" fill="#383d47"/><path d="M32 16 V48" stroke="#6b727e" stroke-width="4"/>`),
  magnet: svg(`<path d="M14 8 V32 a18 18 0 0 0 36 0 V8 H40 V32 a8 8 0 0 1 -16 0 V8 Z" fill="${HOT}" stroke="#111214" stroke-width="3"/><rect x="14" y="8" width="10" height="8" fill="${INK}"/><rect x="40" y="8" width="10" height="8" fill="${INK}"/>`),
  tank: svg(`<rect x="16" y="12" width="32" height="46" rx="8" fill="${INK}"/><rect x="26" y="4" width="12" height="9" fill="#6b727e"/><rect x="16" y="30" width="32" height="8" fill="${HOT}"/><path d="M28 22 L22 36 H30 L26 50" stroke="#111214" stroke-width="3" fill="none"/>`),
  springs: svg(`<path d="M18 8 H46 M18 56 H46" stroke="#6b727e" stroke-width="6"/><path d="M20 14 L44 20 L20 26 L44 32 L20 38 L44 44 L20 50" stroke="${HOT}" stroke-width="5" fill="none" stroke-linejoin="round"/>`),
  repair: svg(`<path d="M8 52 L30 30" stroke="#6b727e" stroke-width="8" stroke-linecap="round"/><path d="M26 14 L42 30 L52 20 L36 4 Z" fill="${INK}" stroke="#111214" stroke-width="3"/><path d="M40 44 l4 8 l4 -8 l8 -2 l-8 -3 l-4 -8 l-4 8 l-8 3 Z" fill="${HOT}"/>`),
  speed: svg(`<path d="M8 44 A24 24 0 1 1 56 44" stroke="${INK}" stroke-width="6" fill="none"/><path d="M32 44 L48 22" stroke="${HOT}" stroke-width="5" stroke-linecap="round"/><circle cx="32" cy="44" r="5" fill="${INK}"/>`),
  power: svg(`<path d="M36 4 L14 36 H30 L26 60 L50 26 H34 Z" fill="${HOT}" stroke="#111214" stroke-width="2"/>`),
  grip: svg(`<circle cx="32" cy="32" r="24" fill="#1a1c21" stroke="${INK}" stroke-width="6"/><path d="M14 22 l8 4 M10 34 l9 1 M14 46 l8 -4 M50 22 l-8 4 M54 34 l-9 1 M50 46 l-8 -4" stroke="${INK}" stroke-width="4"/><circle cx="32" cy="32" r="8" fill="${HOT}"/>`),
  air: svg(`<path d="M6 54 Q32 -6 58 54" stroke="${INK}" stroke-width="4" fill="none" stroke-dasharray="6 5"/><rect x="24" y="14" width="16" height="9" rx="2" fill="${HOT}" transform="rotate(-12 32 18)"/>`),
  prev: svg(`<path d="M42 8 L16 32 L42 56" stroke="${INK}" stroke-width="9" fill="none" stroke-linejoin="round"/>`),
  next: svg(`<path d="M22 8 L48 32 L22 56" stroke="${INK}" stroke-width="9" fill="none" stroke-linejoin="round"/>`),
  none: svg(`<circle cx="32" cy="32" r="22" stroke="#9aa3b0" stroke-width="6" fill="none"/><path d="M17 47 L47 17" stroke="#9aa3b0" stroke-width="6"/>`),
  star: svg(`<path d="M32 2 L40 22 L62 24 L45 39 L51 61 L32 48 L13 61 L19 39 L2 24 L24 22 Z" fill="#ffd02e" stroke="#8a5a08" stroke-width="3"/>`),
  plus: svg(`<path d="M32 10 V54 M10 32 H54" stroke="${INK}" stroke-width="10"/>`),
  minus: svg(`<path d="M10 32 H54" stroke="${INK}" stroke-width="10"/>`),
};
const GX_CSS = `
#garageHud { position: absolute; inset: 0; }
#garageHud .gx { position: absolute; padding: 0; display: grid; place-items: center; overflow: hidden; border-radius: 10px; }
#garageHud .gx svg { width: 72%; height: 72%; }
#garageHud .gx-tab svg { width: 80%; height: 80%; }
#garageHud .gx-tab { width: 100px; height: 96px; top: 16px; }
#garageHud .gx-tab.on { border-color: var(--m-molten-hi); box-shadow: 0 0 22px var(--m-molten), 0 6px 0 #050608; background: linear-gradient(#6b5040, #3a2a22 55%, #24272e); }
#garageHud .gx-tile { width: 120px; height: 120px; top: 560px; background: linear-gradient(#383d47, #1a1c21); }
#garageHud .gx-tile canvas { width: 112px; height: 112px; pointer-events: none; }
#garageHud .gx-tile.on { border-color: var(--m-molten-hi); box-shadow: 0 0 24px var(--m-molten), 0 6px 0 #050608; }
#garageHud .gx-tile.sel { border-color: var(--m-hazard); box-shadow: 0 0 0 4px var(--m-hazard-ink), 0 0 0 8px var(--m-hazard), 0 6px 0 #050608; }
#garageHud .gx-tile.locked canvas { filter: grayscale(0.65) brightness(0.6) sepia(0.45); }
#garageHud .gx-tile.locked::after { content: ''; position: absolute; inset: 0; pointer-events: none;
  background: radial-gradient(circle at 12% 88%, rgba(138,59,18,.55), transparent 32%), radial-gradient(circle at 92% 10%, rgba(138,59,18,.45), transparent 26%); }
#garageHud .gx-tag { position: absolute; left: 4px; right: 4px; bottom: 4px; height: 30px; display: flex; align-items: center; justify-content: center; gap: 4px;
  background: rgba(13,14,18,.85); border-radius: 6px; font: italic 900 22px var(--font); color: #fff; -webkit-text-stroke: 1px #000; z-index: 1; }
#garageHud .gx-tag svg { width: 22px; height: 22px; }
#garageHud .gx-pips { position: absolute; bottom: 8px; left: 0; right: 0; display: flex; justify-content: center; gap: 6px; }
#garageHud .gx-pips i { width: 18px; height: 10px; border-radius: 2px; background: #1a1c21; border: 2px solid #6b727e; }
#garageHud .gx-pips i.f { background: var(--m-molten); border-color: var(--m-molten-hi); box-shadow: 0 0 8px var(--m-molten); }
#garageHud .gx-tile .gx-ico { position: absolute; top: 10px; left: 24px; width: 72px; height: 72px; }
#garageHud .gx-tile .gx-ico svg { width: 100%; height: 100%; }
#garageHud .gx-arrow { width: 88px; height: 120px; top: 560px; }
#garageHud .gx-go { width: 204px; height: 124px; left: 980px; top: 558px; border: 6px solid transparent;
  background: linear-gradient(#8ad57a, var(--m-go) 50%, var(--m-go-deep)) padding-box, var(--hazard) border-box; }
#garageHud .gx-buy { left: 450px; top: 438px; width: 300px; height: 100px; border: 6px solid transparent; display: flex; gap: 10px; align-items: center; justify-content: center;
  background: linear-gradient(#ffb02e, #ff5a1a 55%, #b3200f) padding-box, var(--hazard) border-box; font: italic 900 52px var(--font); color: #fff;
  -webkit-text-stroke: 2px #000; paint-order: stroke fill; text-shadow: 0 4px 0 #000; }
#garageHud .gx-buy svg { width: 64px; height: 64px; }
#garageHud .gx-buy.poor { background: linear-gradient(#6b727e, #4b515b 55%, #2c3039) padding-box, linear-gradient(#8a3b12, #5a2a10) border-box; color: #9aa3b0; }
#garageHud .gx-buy.max { display: none; }
#garageHud .gx-wallet { position: absolute; left: 990px; top: 16px; width: 194px; height: 96px; display: flex; align-items: center; justify-content: center; gap: 8px;
  background: var(--metal); border: 4px solid var(--m-steel); border-radius: 10px; box-shadow: var(--shadow-plate); font: italic 900 42px var(--font); color: #fff;
  -webkit-text-stroke: 2px #000; paint-order: stroke fill; }
#garageHud .gx-wallet svg { width: 46px; height: 46px; flex: none; }
#garageHud .gx-stats { position: absolute; left: 16px; top: 128px; width: 212px; padding: 10px 10px 4px; background: rgba(26,28,33,.82); border: 4px solid var(--m-steel);
  border-radius: 10px; box-shadow: var(--shadow-plate); }
#garageHud .gx-row { display: flex; align-items: center; gap: 8px; height: 44px; }
#garageHud .gx-row svg { width: 36px; height: 36px; flex: none; }
#garageHud .gx-bar { flex: 1; display: grid; grid-template-columns: repeat(10, 1fr); gap: 3px; height: 18px; }
#garageHud .gx-bar b { background: #1a1c21; border: 1px solid #383d47; transform: skewX(-14deg); }
#garageHud .gx-bar b.f { background: linear-gradient(#e6e9ef, #9aa3b0); border-color: #c7ccd5; }
#garageHud .gx-bar b.up { background: linear-gradient(var(--m-toxic), #4a9a1a); border-color: var(--m-toxic); box-shadow: 0 0 6px var(--m-toxic); }
#garageHud .gx-bar b.dn { background: #1a1c21; border-color: var(--m-deny); }
#garageHud .gx-roundel { position: absolute; top: 560px; width: 120px; height: 120px; border-radius: 50%; display: grid; place-items: center; background: #ece8de;
  border: 8px solid #111214; font: italic 900 60px var(--font); color: #111214; box-shadow: 0 6px 0 #050608; }
#garageHud .gx-drag { position: absolute; left: 240px; top: 120px; width: 730px; height: 310px; touch-action: none; }
#garageHud .gx-dents { position: absolute; top: 8px; right: 8px; font: italic 900 26px var(--font); color: #fff; -webkit-text-stroke: 1px #000; }
`;
const TABS = ['body', 'wheels', 'color', 'decal', 'extras', 'buddy', 'number', 'bench'];
const UPGRADE_KEYS = ['engine', 'armor', 'magnet', 'tank', 'springs'];
const PAGE = 5;
function tabItems(tab) {
  const C = cat(), S = VROOM.save, ids = S.ids || {};
  const list = (order, table) => (order || Object.keys(table)).filter(id => table[id]);
  switch (tab) {
    case 'body': return list(ids.BODY_ORDER, C.BODIES);
    case 'wheels': return list(ids.WHEEL_ORDER, C.WHEELS);
    case 'color': return list(ids.COLORS, C.PAINTS).filter(id => !C.PAINTS[id].secret || S.owns('color', id));
    case 'decal': return list(ids.DECAL_ORDER, C.DECALS);
    case 'extras': return list(ids.EXTRA_ORDER, C.EXTRAS);
    case 'buddy': return ['none', ...list(ids.BUDDY_ORDER, C.BUDDIES)];
    case 'bench': return [...UPGRADE_KEYS, 'repair'];
    default: return [];
  }
}
const kindOf = tab => (tab === 'bench' ? 'upgrade' : tab);
const stateKey = { body: 'body', wheels: 'wheels', color: 'color', decal: 'decal', buddy: 'buddy' };
function el(tag, cls, html) { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; }
function plateButton(icon, cls, aria, on) {
  const ui = VROOM.ui;
  if (ui && ui.button) return ui.button({ icon, cls: 'gx ' + cls, aria, on });
  const b = el('button', 'plate gx ' + cls, icon); b.setAttribute('aria-label', aria); b.addEventListener('pointerdown', e => { e.stopPropagation(); if (on) on(e); }); return b;
}
const sfx = (n, o) => { try { if (VROOM.audio && VROOM.audio.sfx) VROOM.audio.sfx(n, o); } catch (e) {} };
const STAT_ROWS = [
  ['speed', s => (s.topSpeed - 30) / 26],
  ['power', s => (s.power / s.mass - 90) / 150],
  ['grip', s => (s.grip - 0.75) / 0.6],
  ['armor', s => s.armor],
  ['air', s => (s.airControl - 1.2) / 3.0],
];
/* the upgrade ladders as the stat bars preview them (the sim's carParams owns the real effect) */
function withUpgrades(st, up) {
  const s = { ...st };
  s.power *= 1 + 0.08 * (up.engine || 0); s.topSpeed *= 1 + 0.03 * (up.engine || 0);
  s.armor = Math.min(1, s.armor + 0.07 * (up.armor || 0)); s.airControl += 0.25 * (up.springs || 0);
  return s;
}
const garage = {
  id: 'garage', dom: 'garage', view: null,
  enter(params = {}) {
    const ctx = VROOM.game.ctx; T = ctx.THREE;
    this.ctx = ctx; this.calm = !!ctx.reducedMotion;
    this.tab = TABS.includes(params.tab) ? params.tab : 'body';
    this.page = -1; this.pick = null; this.queue = []; this.spin = 0.55; this.dragX = null; this.idle = 0; this.drop = 0; this.shake = 0;
    this.bay = buildBay(ctx);
    this.camera = new T.PerspectiveCamera(36, 1200 / 700, 0.1, 120);
    this.view = { scene: this.bay.scene, camera: this.camera };
    this.mountHud();
    this.rebuild();
    try { if (VROOM.audio && VROOM.audio.music) VROOM.audio.music.play('garage'); } catch (e) {}
  },
  exit() {
    if (this.rig) this.rig.dispose(); this.rig = null;
    if (this.bay) this.bay.dispose(); this.bay = null;
    const hud = document.getElementById('garageHud'); if (hud) hud.innerHTML = '';
    this.queue = []; this.view = null;
  },
  /* the build on show: the saved build, or the saved build with the part under preview */
  shown() {
    const s = VROOM.save.state, b = { ...s, extras: { ...s.extras } }, p = this.pick;
    if (p && p.kind !== 'upgrade' && p.kind !== 'repair') {
      if (p.kind === 'extras') b.extras[p.id] = true;
      else if (p.kind === 'buddy') b.buddy = p.id === 'none' ? null : p.id;
      else b[stateKey[p.kind]] = p.id;
    }
    return b;
  },
  rebuild(bolt) {
    const ctx = this.ctx, b = this.shown();
    if (this.rig) this.rig.dispose();
    this.rig = buildCar(ctx, b, { fill: false });
    this.rig.setDamage(VROOM.save.progress.damage || 0);
    this.bay.turntable.add(this.rig.group); this.rig.group.position.y = 0.21;
    const s = this.rig.size; this.camDist = Math.max(10.5, Math.max(s.l, s.h * 1.7, s.w * 1.6) * 2.05); this.camY = s.h * 0.5 + 0.2;
    if (bolt) { this.drop = 1; this.shake = this.calm ? 0 : 0.35; this.bay.burst(0, 0.4, 0, 70, 1.3); }
    this.stats();
  },
  mountHud() {
    const hud = document.getElementById('garageHud'); hud.innerHTML = '';
    hud.appendChild(el('style', '', GX_CSS));
    const drag = el('div', 'live gx-drag'); hud.appendChild(drag);
    drag.addEventListener('pointerdown', e => { this.dragX = e.clientX; this.idle = 0; try { drag.setPointerCapture(e.pointerId); } catch (x) {} });
    drag.addEventListener('pointermove', e => { if (this.dragX === null) return; const sc = (VROOM.game.stageScale && VROOM.game.stageScale()) || 1; this.spin += (e.clientX - this.dragX) / sc * 0.012; this.dragX = e.clientX; });
    for (const ev of ['pointerup', 'pointercancel']) drag.addEventListener(ev, () => { this.dragX = null; this.idle = 0; });
    const home = plateButton(VROOM.ui && VROOM.ui.icons && VROOM.ui.icons.home || GX_ICONS.none, '', 'home', () => VROOM.game.go('home'));
    home.style.cssText = 'left:16px;top:16px;width:96px;height:96px'; hud.appendChild(home);
    const map = plateButton(VROOM.ui && VROOM.ui.icons && VROOM.ui.icons.map || GX_ICONS.none, '', 'map', () => VROOM.game.go('map'));
    map.style.cssText = 'left:16px;top:586px;width:96px;height:96px'; hud.appendChild(map);
    const go = plateButton(VROOM.ui && VROOM.ui.icons && VROOM.ui.icons.go || GX_ICONS.next, 'gx-go', 'go', () => VROOM.game.startRace(VROOM.save.progress.current));
    hud.appendChild(go);
    this.tabEls = TABS.map((t, i) => {
      const b = plateButton(GX_ICONS[t], 'gx-tab', 'tab ' + t, () => this.setTab(t));
      b.style.left = (124 + i * 106) + 'px'; hud.appendChild(b); return b;
    });
    this.wallet = el('div', 'gx-wallet', GX_ICONS.star + '<span>0</span>'); this.wallet.setAttribute('aria-label', 'stars'); hud.appendChild(this.wallet);
    this.walletShown = VROOM.save.progress.wallet;
    this.statsEl = el('div', 'gx-stats'); this.statsEl.setAttribute('aria-label', 'stats');
    this.statRows = STAT_ROWS.map(([icon]) => { const r = el('div', 'gx-row', GX_ICONS[icon]), bar = el('div', 'gx-bar'); for (let i = 0; i < 10; i++) bar.appendChild(el('b')); r.appendChild(bar); this.statsEl.appendChild(r); return bar; });
    hud.appendChild(this.statsEl);
    this.prev = plateButton(GX_ICONS.prev, 'gx-arrow', 'previous', () => this.flip(-1)); this.prev.style.left = '124px'; hud.appendChild(this.prev);
    this.next = plateButton(GX_ICONS.next, 'gx-arrow', 'next', () => this.flip(1)); this.next.style.left = '868px'; hud.appendChild(this.next);
    this.strip = el('div', ''); this.strip.style.cssText = 'position:absolute;inset:0;pointer-events:none'; hud.appendChild(this.strip);
    this.buy = plateButton(GX_ICONS.star + '<span>0</span>', 'gx-buy', 'buy', () => this.purchase()); this.buy.style.display = 'none'; hud.appendChild(this.buy);
    this.setTab(this.tab);
  },
  setTab(t) {
    this.tab = t; this.page = -1;
    if (this.pick) { this.pick = null; this.rebuild(); }
    this.tabEls.forEach((b, i) => b.classList.toggle('on', TABS[i] === t));
    this.fill();
  },
  flip(dir) {
    const n = tabItems(this.tab).length, pages = Math.max(1, Math.ceil(n / PAGE));
    this.page = (this.page + dir + pages) % pages; this.fill();
  },
  equipped(tab, id) {
    const s = VROOM.save.state;
    if (tab === 'extras') return !!s.extras[id];
    if (tab === 'buddy') return (s.buddy || 'none') === id;
    return s[stateKey[tab]] === id;
  },
  fill() {
    const tab = this.tab, items = tabItems(tab), S = VROOM.save;
    this.strip.innerHTML = ''; this.queue = [];
    const arrows = tab !== 'number' && items.length > PAGE;
    this.prev.style.display = this.next.style.display = arrows ? '' : 'none';
    if (tab === 'number') return this.fillNumber();
    if (this.page < 0) { const i = items.findIndex(id => tab !== 'bench' && this.equipped(tab, id)); this.page = i > 0 ? Math.floor(i / PAGE) : 0; }
    const slice = items.slice(this.page * PAGE, this.page * PAGE + PAGE);
    slice.forEach((id, j) => {
      const kind = kindOf(tab), b = plateButton('', 'gx-tile', tab + ' ' + id, () => this.choose(tab, id));
      b.style.left = (124 + 96 + 8 + j * 128) + 'px';
      if (tab === 'bench') this.benchTile(b, id);
      else {
        const owned = id === 'none' || S.owns(kind, id), price = id === 'none' ? 0 : S.price(kind, id);
        if (!owned) { b.classList.add('locked'); b.appendChild(el('div', 'gx-tag', GX_ICONS.star + '<span>' + price + '</span>')); }
        if (this.equipped(tab, id)) b.classList.add('on');
        if (this.pick && this.pick.kind === kind && this.pick.id === id) b.classList.add('sel');
        const cv = canvas(160); cv.width = cv.height = 8; b.prepend(cv);
        this.queue.push(() => { const c = this.tileArt(tab, id); if (cv.parentNode) cv.replaceWith(c); });
      }
      this.strip.appendChild(b);
    });
    this.buyPlate();
  },
  tileArt(tab, id) {
    const ctx = this.ctx, b = VROOM.save.state;
    if (tab === 'decal') return decalThumb(ctx, id, 160);
    if (tab === 'buddy' && id === 'none') { const c = canvas(160), g = c.getContext('2d'); const img = new Image(); img.src = 'data:image/svg+xml,' + encodeURIComponent(GX_ICONS.none.replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160" ')); img.onload = () => g.drawImage(img, 30, 30, 100, 100); return c; }
    return partThumb(ctx, tab, id, b, 160);
  },
  benchTile(b, id) {
    const P = VROOM.save.progress;
    if (id === 'repair') {
      b.appendChild(el('div', 'gx-ico', GX_ICONS.repair));
      const dents = el('div', 'gx-dents', String(P.damage || 0)); b.appendChild(dents);
      const price = VROOM.save.repairPrice ? VROOM.save.repairPrice() : 0;
      if (price > 0) b.appendChild(el('div', 'gx-tag', GX_ICONS.star + '<span>' + price + '</span>')); else b.classList.add('on');
    } else {
      const lvl = (P.upgrades && P.upgrades[id]) || 0;
      b.appendChild(el('div', 'gx-ico', GX_ICONS[id]));
      const pips = el('div', 'gx-pips'); for (let i = 0; i < 3; i++) pips.appendChild(el('i', i < lvl ? 'f' : '')); b.appendChild(pips);
      if (lvl >= 3) b.classList.add('on');
    }
    if (this.pick && this.pick.id === id) b.classList.add('sel');
  },
  fillNumber() {
    const S = VROOM.save, cur = S.state.number;
    const set = n => { S.state.number = n; S.save(); this.rebuild(true); this.fill(); sfx('slam'); };
    const val = cur === '' ? -1 : +cur;
    const tiles = [
      ['none', GX_ICONS.none, () => set('')],
      ['minus ten', GX_ICONS.minus + '<b style="position:absolute;bottom:6px;font:italic 900 26px var(--font)">10</b>', () => set(String(Math.max(0, val - 10)))],
      ['minus one', GX_ICONS.minus, () => set(String(val <= 0 ? 99 : val - 1))],
      null,
      ['plus one', GX_ICONS.plus, () => set(String(val >= 99 ? 0 : val + 1))],
      ['plus ten', GX_ICONS.plus + '<b style="position:absolute;bottom:6px;font:italic 900 26px var(--font)">10</b>', () => set(String(Math.min(99, Math.max(0, val) + 10)))],
    ];
    tiles.forEach((t, j) => {
      const x = 124 + j * 128;
      if (!t) { const r = el('div', 'gx-roundel', cur === '' ? '' : cur); r.style.left = x + 'px'; r.setAttribute('aria-label', 'number'); if (cur === '') r.innerHTML = GX_ICONS.none; this.strip.appendChild(r); return; }
      const b = plateButton(t[1], 'gx-tile', t[0], t[2]); b.style.left = x + 'px'; if (t[0] === 'none' && cur === '') b.classList.add('on'); this.strip.appendChild(b);
    });
    this.buyPlate();
  },
  choose(tab, id) {
    const S = VROOM.save, kind = kindOf(tab);
    this.idle = 0;
    if (tab === 'bench') {
      if (id === 'repair') { this.pick = (S.progress.damage || 0) > 0 ? { kind: 'repair', id } : null; }
      else this.pick = ((S.progress.upgrades || {})[id] || 0) < 3 ? { kind: 'upgrade', id } : null;
      this.fill(); this.stats(); return;
    }
    const owned = id === 'none' || S.owns(kind, id);
    if (owned) {
      if (tab === 'extras') S.state.extras[id] = !S.state.extras[id];
      else if (tab === 'buddy') S.state.buddy = id === 'none' ? null : id;
      else S.state[stateKey[tab]] = id;
      S.save(); this.pick = null; this.rebuild(true); sfx('slam');
    } else { this.pick = { kind, id }; this.rebuild(); sfx('whoosh'); }
    this.fill();
  },
  buyPlate() {
    const p = this.pick, S = VROOM.save, b = this.buy;
    if (!p) { b.style.display = 'none'; return; }
    const price = p.kind === 'upgrade' ? S.upgradePrice(p.id) : p.kind === 'repair' ? S.repairPrice() : S.price(p.kind, p.id);
    b.style.display = '';
    b.querySelector('span').textContent = String(price);
    b.classList.toggle('poor', S.progress.wallet < price);
    b.setAttribute('aria-label', 'buy ' + price);
  },
  purchase() {
    const p = this.pick, S = VROOM.save;
    if (!p) return;
    const ok = p.kind === 'repair' ? S.repair() : S.buy(p.kind, p.id);
    if (!ok) {
      sfx('deny');
      if (!this.calm && this.buy.animate) this.buy.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-14px)' }, { transform: 'translateX(12px)' }, { transform: 'translateX(-8px)' }, { transform: 'translateX(0)' }], { duration: 320 });
      return;
    }
    if (p.kind === 'extras') S.state.extras[p.id] = true;
    else if (p.kind === 'buddy') S.state.buddy = p.id;
    else if (stateKey[p.kind]) S.state[stateKey[p.kind]] = p.id;
    S.save();
    this.pick = p.kind === 'upgrade' && ((S.progress.upgrades[p.id] || 0) < 3) ? p : null;
    sfx('buy'); this.rebuild(true); this.fill();
  },
  stats() {
    if (!this.statRows) return;
    const C = cat(), S = VROOM.save, up = S.progress.upgrades || {};
    const cur = withUpgrades(C.stats(S.state), up);
    let nxt = withUpgrades(C.stats(this.shown()), up);
    if (this.pick && this.pick.kind === 'upgrade') nxt = withUpgrades(C.stats(S.state), { ...up, [this.pick.id]: (up[this.pick.id] || 0) + 1 });
    STAT_ROWS.forEach(([, f], r) => {
      const a = Math.round(Math.max(0, Math.min(1, f(cur))) * 10), b = Math.round(Math.max(0, Math.min(1, f(nxt))) * 10), bar = this.statRows[r];
      for (let i = 0; i < 10; i++) bar.children[i].className = i < Math.min(a, b) ? 'f' : i < b ? 'up' : i < a ? 'dn' : '';
    });
  },
  update(dt, t) {
    if (!this.bay) return;
    for (let n = 0; n < 2 && this.queue.length; n++) this.queue.shift()();
    this.idle += dt;
    if (this.dragX === null && !this.calm) this.spin += dt * (this.idle > 2 ? 0.32 : 0.08);
    this.bay.turntable.rotation.y = this.spin;
    this.drop = Math.max(0, this.drop - dt * 2.4);
    if (this.rig) {
      const d = this.drop;
      this.rig.group.position.y = 0.21 + (d > 0 ? Math.abs(Math.sin(d * Math.PI * 1.5)) * d * 0.6 : 0);
      this.rig.update(null, dt, t);
    }
    this.bay.update(dt, t);
    /* camera: a slow orbit sway around the turntable, shake on a bolt-on */
    const yaw = 0.62 + (this.calm ? 0 : Math.sin(t * 0.21) * 0.06), el2 = 0.2 + (this.calm ? 0 : Math.sin(t * 0.17) * 0.02);
    const dist = this.camDist || 9, cy = this.camY || 1.2;
    this.shake = Math.max(0, this.shake - dt);
    const sh = this.shake * 0.25;
    this.camera.position.set(Math.sin(yaw) * Math.cos(el2) * dist + (sh ? Math.sin(t * 90) * sh : 0), cy + Math.sin(el2) * dist + (sh ? Math.cos(t * 77) * sh : 0), Math.cos(yaw) * Math.cos(el2) * dist);
    this.camera.lookAt(0, cy - 0.55, 0);
    /* wallet ticks toward the real number */
    const w = VROOM.save.progress.wallet;
    if (this.walletShown !== w) { const dlt = w - this.walletShown; this.walletShown += Math.abs(dlt) < 2 ? dlt : Math.round(dlt * Math.min(1, dt * 8)) || Math.sign(dlt); }
    const span = this.wallet.querySelector('span'); const txt = String(this.walletShown); if (span.textContent !== txt) span.textContent = txt;
    if (this.pick) this.buy.classList.toggle('poor', VROOM.save.progress.wallet < +this.buy.querySelector('span').textContent);
  },
};
VROOM.scenes.garage = garage;

VROOM.cars = { buildCar, thumb, partThumb, decalThumb, BODY_DEFS };
