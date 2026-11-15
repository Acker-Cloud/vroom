/* fx: particles and impact juice for any THREE.Scene. Owner: worlds. Contract: MODULE_API.fx.
   create(ctx, scene) -> { emit(kind, [x, y, z], opts), update(dt), dispose() }
   kinds: sparks dust smoke fire explosion splash debris snow shards nitro stars skid trail
   opts (all optional): n count, color '#hex', dir [x, y, z] bias, speed multiplier, big 0|1, firework 0|1,
   skid only: id (one strip per id, a wheel index), w strip width, up [x, y, z]; emit('skid', null, { id }) ends a strip.
   trail: a boss's wake, opts.color the hot embers (soot billows behind them).

   Three pools, all allocated up front (no allocation per frame or per emit):
     chunk  low-poly icosahedrons, lit and flat shaded: debris, splash, the odd clod of snow
     puff   soft camera-facing billboards: a quad per particle, turned to the camera in the vertex shader,
            a painted puff with an alpha falloff, faded in and out per particle, fogged: dust, smoke, powder snow
     glow   octahedrons, unlit and additive: sparks (stretched along their velocity), fire, nitro, stars, shards
     skid   a ring buffer of quads with per-vertex alpha that fade out
   Capacity follows ctx.quality. Under ctx.reducedMotion every burst is halved and shortened, and the
   firework / big flash variants drop to a plain puff: feedback stays, spectacle goes. */

function create(ctx, scene) {
  const T = ctx.THREE, low = ctx.quality === 'low', rm = !!ctx.reducedMotion;
  const CAP = { chunk: low ? 220 : 640, puff: low ? 160 : 420, glow: low ? 260 : 900, skid: low ? 200 : 600 };
  const scaleN = (low ? 0.5 : 1) * (rm ? 0.5 : 1);

  /* ---- particle pools ---- */
  function pool(cap, geo, mat, extra) {
    const mesh = new T.InstancedMesh(geo, mat, cap);
    mesh.instanceMatrix.setUsage(T.DynamicDrawUsage);
    mesh.setColorAt(0, new T.Color(1, 1, 1));
    mesh.instanceColor.setUsage(T.DynamicDrawUsage);
    let alpha = null, spinA = null;
    if (extra) {
      alpha = new T.InstancedBufferAttribute(new Float32Array(cap), 1).setUsage(T.DynamicDrawUsage);
      spinA = new T.InstancedBufferAttribute(new Float32Array(cap), 1).setUsage(T.DynamicDrawUsage);
      geo.setAttribute('aAlpha', alpha); geo.setAttribute('aSpin', spinA);
    }
    mesh.frustumCulled = false; mesh.count = 0;
    scene.add(mesh);
    return {
      mesh, cap, live: 0, next: 0, alpha, spinA,
      px: new Float32Array(cap), py: new Float32Array(cap), pz: new Float32Array(cap),
      vx: new Float32Array(cap), vy: new Float32Array(cap), vz: new Float32Array(cap),
      life: new Float32Array(cap), max: new Float32Array(cap), s0: new Float32Array(cap), s1: new Float32Array(cap),
      grav: new Float32Array(cap), drag: new Float32Array(cap), spin: new Float32Array(cap), stretch: new Uint8Array(cap),
      cr: new Float32Array(cap), cg: new Float32Array(cap), cb: new Float32Array(cap), op: new Float32Array(cap), hi: 0,
    };
  }
  const chunkGeo = new T.IcosahedronGeometry(1, 0), glowGeo = new T.OctahedronGeometry(1, 0);
  const chunkMat = new T.MeshStandardMaterial({ flatShading: true, roughness: 0.9, metalness: 0.05, vertexColors: false });
  const glowMat = new T.MeshBasicMaterial({ transparent: true, blending: T.AdditiveBlending, depthWrite: false, toneMapped: false });
  /* the billboard puff: a soft lumpy disc painted once, alpha falling off to nothing at the rim */
  const puffCan = document.createElement('canvas'); puffCan.width = puffCan.height = 64;
  {
    const g = puffCan.getContext('2d');
    let ps = 777;
    const pr = () => { ps = (Math.imul(ps, 1664525) + 1013904223) >>> 0; return ps / 4294967296; };
    const lump = (x, y, r, a) => { const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, `rgba(255,255,255,${a})`); gr.addColorStop(0.55, `rgba(255,255,255,${a * 0.45})`); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); };
    lump(32, 32, 30, 0.75);
    for (let i = 0; i < 7; i++) { const a = pr() * Math.PI * 2, d = 6 + pr() * 9; lump(32 + Math.cos(a) * d, 32 + Math.sin(a) * d, 9 + pr() * 9, 0.35); }
    /* a darker core edge so a billow has shape, not a flat disc */
    const id = g.getImageData(0, 0, 64, 64), D = id.data;
    for (let i = 0; i < D.length; i += 4) { const x = (i / 4) % 64 - 32, y = Math.floor(i / 256) - 32, r = Math.sqrt(x * x + y * y) / 32, v = 255 * (0.62 + 0.38 * Math.max(0, 1 - r * 1.15) + (pr() - 0.5) * 0.08); D[i] = D[i + 1] = D[i + 2] = Math.max(0, Math.min(255, v)); D[i + 3] = Math.min(255, D[i + 3] * Math.max(0, 1 - Math.pow(r, 3))); }
    g.putImageData(id, 0, 0);
  }
  const puffTex = new T.CanvasTexture(puffCan);
  const puffGeo = new T.PlaneGeometry(2, 2);
  const puffMat = new T.ShaderMaterial({
    uniforms: T.UniformsUtils.merge([T.UniformsLib.fog, { map: { value: null }, light: { value: 0.82 } }]),
    vertexShader: `attribute float aAlpha; attribute float aSpin; varying vec2 vUv; varying float vAlpha; varying vec3 vCol;
      #include <common>
      #include <fog_pars_vertex>
      void main() {
        vUv = uv; vAlpha = aAlpha;
        #ifdef USE_INSTANCING_COLOR
          vCol = instanceColor;
        #else
          vCol = vec3(1.0);
        #endif
        vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        float s = length(instanceMatrix[0].xyz), c = cos(aSpin), n = sin(aSpin);
        mvPosition.xy += vec2(position.x * c - position.y * n, position.x * n + position.y * c) * s;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: `uniform sampler2D map; uniform float light; varying vec2 vUv; varying float vAlpha; varying vec3 vCol;
      #include <common>
      #include <fog_pars_fragment>
      void main() {
        vec4 t = texture2D(map, vUv);
        float a = t.a * vAlpha;
        if (a < 0.004) discard;
        gl_FragColor = vec4(vCol * t.rgb * light, a);
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
    transparent: true, depthWrite: false, fog: true,
  });
  puffMat.uniforms.map.value = puffTex;
  const P = { chunk: pool(CAP.chunk, chunkGeo, chunkMat), puff: pool(CAP.puff, puffGeo, puffMat, true), glow: pool(CAP.glow, glowGeo, glowMat) };

  /* ---- skid marks ---- */
  const SK = CAP.skid, skPos = new Float32Array(SK * 4 * 3), skCol = new Float32Array(SK * 4 * 4), skAge = new Float32Array(SK).fill(99);
  const skIdx = new Uint32Array(SK * 6);
  for (let i = 0; i < SK; i++) { const a = i * 4; skIdx.set([a, a + 1, a + 2, a + 1, a + 3, a + 2], i * 6); }
  const skGeo = new T.BufferGeometry();
  skGeo.setAttribute('position', new T.BufferAttribute(skPos, 3).setUsage(T.DynamicDrawUsage));
  skGeo.setAttribute('color', new T.BufferAttribute(skCol, 4).setUsage(T.DynamicDrawUsage));
  skGeo.setIndex(new T.BufferAttribute(skIdx, 1));
  const skMat = new T.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 });
  const skMesh = new T.Mesh(skGeo, skMat); skMesh.frustumCulled = false; scene.add(skMesh);
  let skNext = 0, skDirty = false;
  const skLast = [];   /* per strip id: [x, y, z, valid] */
  for (let i = 0; i < 8; i++) skLast.push(new Float32Array(4));

  /* ---- helpers ---- */
  const col = new T.Color(), m4 = new T.Matrix4(), q = new T.Quaternion(), e = new T.Euler(), v = new T.Vector3(), sc = new T.Vector3(), dirV = new T.Vector3(), zAxis = new T.Vector3(0, 0, 1);
  let seed = 12345;
  const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const parse = (c, fallback) => { col.set(c || fallback); return col; };
  const haze = new T.Color(0x8a8c92);
  const greyed = (c, fallback) => parse(c, fallback).lerp(haze, 0.45);
  function spawn(Pl, x, y, z, vx, vy, vz, life, s0, s1, g, drag, c, stretch = 0, spin = 0, op = 1) {
    const i = Pl.next;
    Pl.next = (Pl.next + 1) % Pl.cap;
    Pl.px[i] = x; Pl.py[i] = y; Pl.pz[i] = z; Pl.vx[i] = vx; Pl.vy[i] = vy; Pl.vz[i] = vz;
    Pl.life[i] = life; Pl.max[i] = life; Pl.s0[i] = s0; Pl.s1[i] = s1; Pl.grav[i] = g; Pl.drag[i] = drag;
    Pl.cr[i] = c.r; Pl.cg[i] = c.g; Pl.cb[i] = c.b; Pl.stretch[i] = stretch; Pl.spin[i] = spin; Pl.op[i] = op;
    if (i + 1 > Pl.hi) Pl.hi = i + 1;
  }
  const sphere = (speed, up = 0) => { const a = rnd() * Math.PI * 2, z = rnd() * 2 - 1, r = Math.sqrt(1 - z * z); v.set(Math.cos(a) * r * speed, Math.abs(z) * speed * (0.4 + up) + up * speed * 0.6, Math.sin(a) * r * speed); return v; };
  const count = (opts, def) => Math.max(1, Math.round(((opts && opts.n) || def) * scaleN));

  const KINDS = {
    sparks(x, y, z, o) {
      const c = parse(o.color, '#ffb02e'), n = count(o, 14), sp = (o.speed || 1);
      for (let k = 0; k < n; k++) { sphere((7 + rnd() * 10) * sp, 0.5); spawn(P.glow, x, y, z, v.x, v.y, v.z, 0.3 + rnd() * 0.4, 0.09, 0.03, 20, 1.2, k % 3 ? c : col.set('#fff2a8'), 1); parse(o.color, '#ffb02e'); }
    },
    dust(x, y, z, o) {
      const c = greyed(o.color, '#7a6a58'), n = count(o, 6), big = o.big ? 2 : 1, d = o.dir;
      for (let k = 0; k < n; k++) { sphere(1.5 + rnd() * 2.5 * big, 0.6); spawn(P.puff, x + (rnd() - 0.5) * big, y + 0.3, z + (rnd() - 0.5) * big, v.x + (d ? d[0] * 3 : 0), v.y * 0.5 + 0.8, v.z + (d ? d[2] * 3 : 0), 0.7 + rnd() * 0.6, 0.35 * big, (0.9 + rnd() * 0.5) * big, -0.4, 2.6, c, 0, (rnd() - 0.5) * 1.6, 0.55); }
    },
    smoke(x, y, z, o) {
      const c = greyed(o.color, '#3a3a40'), n = count(o, 5);
      for (let k = 0; k < n; k++) { sphere(1 + rnd() * 1.5, 1); spawn(P.puff, x, y + 0.2, z, v.x, 1.2 + rnd() * 1.6, v.z, 0.9 + rnd() * 0.8, 0.4, 1.8 + rnd() * 0.9, -1.0, 1.4, c, 0, (rnd() - 0.5) * 1.2, 0.6); }
    },
    fire(x, y, z, o) {
      const n = count(o, 8);
      for (let k = 0; k < n; k++) { sphere(1.6, 1); spawn(P.glow, x + (rnd() - 0.5), y, z + (rnd() - 0.5), v.x, 2.5 + rnd() * 3, v.z, 0.35 + rnd() * 0.35, 0.7, 0.1, -2, 1, col.set(k % 2 ? '#ff5a1a' : '#ffb02e')); }
    },
    explosion(x, y, z, o) {
      const big = o.big ? 1.8 : 1, fw = o.firework && !rm;
      if (fw) {
        const c = parse(o.color, '#ffb02e'), n = count(o, 46);
        for (let k = 0; k < n; k++) { sphere(14 + rnd() * 6, 0); spawn(P.glow, x, y, z, v.x, v.y, v.z, 0.9 + rnd() * 0.5, 0.18, 0.05, 6, 1.4, c, 1); }
        return;
      }
      if (!rm) spawn(P.glow, x, y, z, 0, 0, 0, 0.16, 5 * big, 7 * big, 0, 0, col.set('#fff2a8'));
      for (let k = 0, n = count({ n: 20 * big }, 0); k < n; k++) { sphere(5 + rnd() * 8, 0.6); spawn(P.glow, x, y, z, v.x, v.y, v.z, 0.3 + rnd() * 0.4, 1.1 * big, 0.1, -3, 2, col.set(k % 3 ? '#ff5a1a' : '#ffd36b')); }
      for (let k = 0, n = count({ n: 10 * big }, 0); k < n; k++) { sphere(3 + rnd() * 3, 0.8); spawn(P.puff, x, y, z, v.x, v.y + 2, v.z, 1.3 + rnd(), 1.0 * big, 3.4 * big, -1, 1.4, col.set(k % 2 ? '#2a2a2e' : '#4a4038'), 0, (rnd() - 0.5) * 0.8, 0.8); }
      KINDS.sparks(x, y, z, { n: 18 * big, speed: 1.4 });
      KINDS.debris(x, y, z, { n: 8, color: '#2c3039' });
    },
    splash(x, y, z, o) {
      const c = parse(o.color, '#cfefff'), n = count(o, 16);
      for (let k = 0; k < n; k++) { sphere(4 + rnd() * 4, 0.9); spawn(P.chunk, x, y + 0.2, z, v.x * 0.8, v.y + 3, v.z * 0.8, 0.6 + rnd() * 0.5, 0.25, 0.08, 18, 0.6, c); }
    },
    debris(x, y, z, o) {
      const c = parse(o.color, '#8a3b12'), n = count(o, 10);
      for (let k = 0; k < n; k++) { sphere(6 + rnd() * 7, 0.6); spawn(P.chunk, x, y, z, v.x, v.y + 2, v.z, 1.0 + rnd() * 0.8, 0.18 + rnd() * 0.3, 0.1, 22, 0.3, k % 3 ? c : col.set('#2c3039'), 0, 8); parse(o.color, '#8a3b12'); }
    },
    snow(x, y, z, o) {
      const n = count(o, 10), d = o.dir;
      for (let k = 0; k < n; k++) {
        sphere(1.5 + rnd() * 2.5, 0.8);
        if (o.big && k % 3 === 0) spawn(P.chunk, x, y + 0.1, z, v.x, v.y, v.z, 0.45 + rnd() * 0.35, 0.1, 0.22, 4, 2.4, col.set('#dff2ff'), 0, 1.5);
        else spawn(P.puff, x, y + 0.25, z, v.x + (d ? d[0] * 3 : 0), v.y * 0.6 + 0.6, v.z + (d ? d[2] * 3 : 0), 0.6 + rnd() * 0.5, 0.3, 1.1 + rnd() * 0.5, 0.6, 2.4, col.set(k % 2 ? '#9aaab8' : '#7e90a0'), 0, (rnd() - 0.5) * 1.4, 0.5);
      }
    },
    shards(x, y, z, o) {
      const c = parse(o.color, '#bff2ff'), n = count(o, 12);
      for (let k = 0; k < n; k++) { sphere(6 + rnd() * 6, 0.6); spawn(P.glow, x, y, z, v.x, v.y, v.z, 0.5 + rnd() * 0.4, 0.18, 0.05, 18, 0.5, c, 1); }
    },
    nitro(x, y, z, o) {
      const n = count(o, 12), d = o.dir || [0, 0, -1];
      for (let k = 0; k < n; k++) { spawn(P.glow, x + (rnd() - 0.5) * 0.4, y + (rnd() - 0.5) * 0.3, z + (rnd() - 0.5) * 0.4, d[0] * 12 + (rnd() - 0.5) * 2, d[1] * 12 + rnd(), d[2] * 12 + (rnd() - 0.5) * 2, 0.14 + rnd() * 0.1, 0.32, 0.06, 0, 2, col.set(k % 3 ? '#4ff0ff' : '#8cff3a')); }
    },
    stars(x, y, z, o) {
      const c = parse(o.color, '#ffd02e'), n = count(o, 12);
      for (let k = 0; k < n; k++) { sphere(5 + rnd() * 4, 0.4); spawn(P.glow, x, y, z, v.x, v.y, v.z, 0.4 + rnd() * 0.3, 0.16, 0.03, 6, 2.5, k % 2 ? c : col.set('#fff2a8')); parse(o.color, '#ffd02e'); }
    },
    trail(x, y, z, o) {
      /* a boss's wake: hot embers that hang and fall, under a billow of soot */
      const c = parse(o.color, '#ff5a1a'), n = count(o, 4);
      for (let k = 0; k < n; k++) { sphere(1.2 + rnd() * 2, 0.5); spawn(P.glow, x + (rnd() - 0.5) * 2, y + rnd() * 2, z + (rnd() - 0.5) * 2, v.x, v.y + 1.5, v.z, 0.5 + rnd() * 0.5, 0.22, 0.04, 3, 1.2, k % 2 ? c : col.set('#fff2a8'), 1); parse(o.color, '#ff5a1a'); }
      for (let k = 0; k < Math.max(1, n >> 1); k++) spawn(P.puff, x + (rnd() - 0.5) * 2.4, y + 0.6 + rnd(), z + (rnd() - 0.5) * 2.4, (rnd() - 0.5) * 1.2, 1.4 + rnd(), (rnd() - 0.5) * 1.2, 1.1 + rnd() * 0.6, 1.2, 3.2 + rnd() * 1.2, -0.6, 1.2, col.set(o.soot || '#1c1a1e'), 0, (rnd() - 0.5) * 0.8, 0.55);
    },
    skid(x, y, z, o) {
      const id = (o && o.id) || 0, L = skLast[id % skLast.length];
      if (x === null) { L[3] = 0; return; }
      if (!L[3]) { L[0] = x; L[1] = y; L[2] = z; L[3] = 1; return; }
      const dx = x - L[0], dz = z - L[2], d2 = dx * dx + dz * dz;
      if (d2 < 0.36) return;
      if (d2 > 16) { L[0] = x; L[1] = y; L[2] = z; return; }
      const len = Math.sqrt(d2), w = (o.w || 0.35) / len, nx = -dz * w, nz = dx * w, i = skNext;
      skNext = (skNext + 1) % SK;
      const lift = 0.04;
      skPos.set([L[0] - nx, L[1] + lift, L[2] - nz, L[0] + nx, L[1] + lift, L[2] + nz, x - nx, y + lift, z - nz, x + nx, y + lift, z + nz], i * 12);
      skAge[i] = 0; skDirty = true;
      L[0] = x; L[1] = y; L[2] = z;
    },
  };

  function emit(kind, pos, opts) {
    const f = KINDS[kind];
    if (!f) return;
    if (kind === 'skid') { f(pos ? pos[0] : null, pos ? pos[1] : 0, pos ? pos[2] : 0, opts || {}); return; }
    if (!pos) return;
    f(pos[0], pos[1], pos[2], opts || {});
  }

  function step(Pl, dt, glow) {
    const mesh = Pl.mesh;
    let any = 0;
    for (let i = 0; i < Pl.hi; i++) {
      if (Pl.life[i] <= 0) { if (Pl.max[i] > 0) { Pl.max[i] = 0; m4.makeScale(0, 0, 0); mesh.setMatrixAt(i, m4); if (Pl.alpha) Pl.alpha.array[i] = 0; } continue; }
      any = i + 1;
      Pl.life[i] -= dt;
      const k = Math.max(0, Pl.life[i] / Pl.max[i]), dr = Math.max(0, 1 - Pl.drag[i] * dt);
      Pl.vx[i] *= dr; Pl.vz[i] *= dr; Pl.vy[i] = Pl.vy[i] * dr - Pl.grav[i] * dt;
      Pl.px[i] += Pl.vx[i] * dt; Pl.py[i] += Pl.vy[i] * dt; Pl.pz[i] += Pl.vz[i] * dt;
      const s = Pl.life[i] <= 0 ? 0 : Pl.s1[i] + (Pl.s0[i] - Pl.s1[i]) * k;
      v.set(Pl.px[i], Pl.py[i], Pl.pz[i]);
      if (Pl.alpha) {
        /* a billboard: position and size in the matrix, the turn and the fade in their own attributes.
           It fades in over its first tenth and thins away over its last half instead of popping */
        const age = 1 - k, a = Pl.life[i] <= 0 ? 0 : Pl.op[i] * Math.min(1, age / 0.1) * Math.min(1, k / 0.5);
        Pl.alpha.array[i] = a; Pl.spinA.array[i] = (Pl.max[i] - Pl.life[i]) * Pl.spin[i] + i * 2.39;
        q.identity(); sc.set(s, s, s);
      } else if (Pl.stretch[i]) {
        dirV.set(Pl.vx[i], Pl.vy[i], Pl.vz[i]);
        const sp = dirV.length();
        if (sp > 0.01) q.setFromUnitVectors(zAxis, dirV.multiplyScalar(1 / sp)); else q.identity();
        sc.set(s, s, s * (1 + sp * 0.12));
      } else {
        const a = (Pl.max[i] - Pl.life[i]) * Pl.spin[i] + i;
        e.set(a, a * 0.7, 0); q.setFromEuler(e); sc.set(s, s, s);
      }
      m4.compose(v, q, sc);
      mesh.setMatrixAt(i, m4);
      const fade = glow ? k : 1;
      col.setRGB(Pl.cr[i] * fade, Pl.cg[i] * fade, Pl.cb[i] * fade);
      mesh.setColorAt(i, col);
    }
    Pl.hi = any;
    mesh.count = any;
    if (any) { mesh.instanceMatrix.needsUpdate = true; mesh.instanceColor.needsUpdate = true; if (Pl.alpha) { Pl.alpha.needsUpdate = true; Pl.spinA.needsUpdate = true; } }
  }

  function update(dt) {
    dt = Math.min(0.05, dt);
    step(P.chunk, dt, false);
    step(P.puff, dt, false);
    step(P.glow, dt, true);
    /* skids fade over 5 s */
    let live = false;
    for (let i = 0; i < SK; i++) {
      if (skAge[i] > 6) continue;
      skAge[i] += dt;
      const a = skAge[i] > 6 ? 0 : 0.55 * Math.max(0, 1 - skAge[i] / 6);
      for (let k = 0; k < 4; k++) { const o = (i * 4 + k) * 4; skCol[o] = 0.04; skCol[o + 1] = 0.04; skCol[o + 2] = 0.05; skCol[o + 3] = a; }
      if (skAge[i] > 6) for (let k = 0; k < 12; k++) skPos[i * 12 + k] = 0;
      live = true;
    }
    if (live || skDirty) { skGeo.attributes.position.needsUpdate = true; skGeo.attributes.color.needsUpdate = true; skDirty = false; }
    skMesh.visible = live;
  }

  function dispose() {
    for (const k in P) { scene.remove(P[k].mesh); P[k].mesh.dispose(); }
    scene.remove(skMesh);
    chunkGeo.dispose(); glowGeo.dispose(); puffGeo.dispose(); puffMat.dispose(); puffTex.dispose(); chunkMat.dispose(); glowMat.dispose(); skGeo.dispose(); skMat.dispose();
  }

  return { emit, update, dispose };
}

VROOM.fx = { create };
