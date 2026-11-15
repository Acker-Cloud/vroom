/* worlds: the 12 environments. Owner: worlds. Contract: VROOM.contracts MODULE_API.worlds.
   Everything here is procedural: geometry from code (low-poly, flat shaded, vertex coloured with per-face
   grime), textures painted on canvases at load and cached in ctx.cache. No image files.

   What a WorldRig holds, all built from the sim's Track arrays (px..rz, hw, surf, flags, piece):
     sky       a gradient dome that follows the camera, a sun / moon / planet with a halo, stars, clouds, aurora
     road      the ribbon (7 columns, halfpipes curve up), kerbs painted in the texture, a thick slab skirt and
               underside, ramp hazard stripes, rumble bands, checkpoint and finish decals, split dividers
     walls     an extruded barrier profile per TF.WALL_L / WALL_R run, textured per world, with posts or merlons
     terrain   embankments falling from the road to the world floor (wider where the road is high, narrowed
               on the inside of bends), a floor plane (rock, sea, lava lake, seabed) or none (orbit, citadel)
     supports  pillars under bridges, trusses under the orbit road, chunks of floating rock under the citadel
     dressing  6 to 10 instanced roadside sets per world, scattered by hash and kept off the road
     overheads gantries / arches / ribs over the road, checkpoint gantries, the start gantry, the finish gate
     landmark  one huge horizon set piece per world (and its satellites), unfogged and tinted to the sky
     weather   rain, snow, ash, embers, sand, spray, bubbles, motes; lightning in the storm worlds
     props     one Object3D per track prop (index = track.props), stars one per spec.stars
   Budget (docs/OVERHAUL.md): under 150 draw calls and 250k triangles in a race view. Props and stars beyond
   the fog are hidden each frame; every repeated piece is an InstancedMesh; no allocation per frame.
   Reduced motion: weather freezes, lightning never flashes, idle spins and swings stop. Gameplay signage
   (boost pad chevrons, checkpoint lamps) still reads. */

const ACCENT = {
  1: ['#fff2a8', '#ffb02e', '#ff5a1a', '#b3200f'], 2: ['#fff0c8', '#ffb35c', '#e8642a', '#8a2a10'], 3: ['#f0e0ff', '#ff4fd8', '#8a4dff', '#2a1070'],
  4: ['#e0f6ff', '#8fd8ff', '#2e8ac8', '#0e3a66'], 5: ['#ffffff', '#bff2ff', '#4cc3f0', '#145a86'], 6: ['#fff6d0', '#ffd36b', '#e0a030', '#7a4a10'],
  7: ['#e0fff6', '#6bffd8', '#2ec2a8', '#0e4f46'], 8: ['#e8e0ff', '#a88cff', '#5a4dff', '#1a1060'], 9: ['#fff2a8', '#ffb02e', '#ff3a0a', '#8a1000'],
  10: ['#fff0f8', '#ff9ad0', '#c84fa0', '#5a1040'], 11: ['#e0fff6', '#6bffd8', '#2ec2c8', '#0e3f66'], 12: ['#fffbe0', '#ffe27a', '#c8b4ff', '#3a2a80'],
};
const accent = w => ACCENT[w] || ACCENT[1];

/* ---------- the look of each world ----------
   sky: zenith, upper, horizon, below-horizon. sun: [colour, elevation rad, azimuth rad, size, halo].
   hemi: [sky, ground, intensity]; key, rim: [colour, intensity]. floor: 'rock' | 'water' | 'lava' | 'sand' | 'cloud' | 'none'.
   road/wall: painter styles below. sets: roadside pools. over: overhead style. land: landmark builder. wx: weather. */
const LOOK = {
  1: { sky: ['#06050a', '#20101a', '#7a2a12', '#ff8a32'], fog: ['#3a180c', 30, 420], sun: ['#ff8a3a', 0.05, 2.6, 160, 0.9], hemi: ['#8a7a98', '#ff6a2a', 1.5],
       key: ['#ffc080', 3.0], rim: ['#ff5a1a', 1.4], floor: 'rock', floorC: ['#16110f', '#241a14'], bank: ['#2a211c', '#3e2c20', '#5a3a22'], stars: 40,
       road: 'plate', roadC: ['#545a64', '#2a2d33'], kerb: ['#f2b705', '#111214'], wall: 'scrap', clouds: ['#3a1a14', 10],
       sets: ['smokestack', 'scrapPile', 'crushedStack', 'slagPot', 'pipeRack', 'lampPost', 'moltenTrough', 'sparkTower', 'girderPile'], over: 'pipebridge', land: 'foundry', wx: 'ash' },
  2: { sky: ['#1a0612', '#6a1418', '#e8642a', '#ffc070'], fog: ['#c45a2e', 60, 640], sun: ['#ffd88a', 0.07, 0.4, 260, 1.2], hemi: ['#ff9a6a', '#3a1008', 1.2],
       key: ['#ffb070', 2.8], rim: ['#ff4a2a', 1.0], floor: 'rock', floorC: ['#6a2410', '#8a3416'], bank: ['#7a2c12', '#9a3e1a', '#5a1e0c'], stars: 20,
       road: 'dirt', roadC: ['#8a4a2a', '#5a2a16'], kerb: ['#e8e0d0', '#8a2a10'], wall: 'rock', clouds: ['#ff9a6a', 14],
       sets: ['mesa', 'deadTree', 'boulder', 'tumbleweed', 'ropeFence', 'skullRock', 'rockArch'], over: 'bonegate', land: 'canyon', wx: 'embers' },
  3: { sky: ['#030008', '#0e0428', '#2a0f6a', '#7a3ae0'], fog: ['#180732', 30, 400], sun: ['#e8e0ff', 0.55, 3.6, 60, 0.6], hemi: ['#5a3aa0', '#ff4fd8', 0.8],
       key: ['#9aa6ff', 1.3], rim: ['#ff4fd8', 1.6], floor: 'rock', floorC: ['#08080e', '#101018'], bank: ['#14141c', '#1c1c26', '#262632'], stars: 120,
       road: 'wet', roadC: ['#14151b', '#0a0a0e'], kerb: ['#ff4fd8', '#1a1a22'], wall: 'jersey', clouds: ['#2a1050', 8],
       sets: ['tower', 'neonSign', 'streetLamp', 'deadCar', 'billboard', 'antenna', 'towerTall'], over: 'signgantry', land: 'skyline', wx: 'drizzle' },
  4: { sky: ['#060a10', '#16222e', '#2e4a60', '#6a8aa0'], fog: ['#1c2c38', 30, 330], sun: ['#cfe8ff', 0.6, 1.2, 50, 0.3], hemi: ['#7aa0c0', '#0e1a24', 1.0],
       key: ['#bfe0ff', 1.5], rim: ['#8fd8ff', 1.0], floor: 'water', floorC: ['#0b2230', '#123444'], bank: ['#3a4048', '#2a2e34', '#4a5058'], stars: 0,
       road: 'pier', roadC: ['#2c3036', '#1a1c20'], kerb: ['#f2b705', '#111214'], wall: 'hazard', clouds: ['#2a3a48', 18],
       sets: ['containerStack', 'bollardRow', 'dockCrane', 'lampPost', 'crateStack', 'warehouse', 'buoy'], over: 'gantrycrane', land: 'docks', wx: 'rain' },
  /* frostbite pass: a frozen iron pass in a night blizzard. Blue-black ice, dark iron and frozen rust, lit by
     sodium lamps (the warm rim and the low amber band in the sky are their glow off the snow cloud) */
  5: { sky: ['#010204', '#060b12', '#141c26', '#3a2814'], fog: ['#121820', 16, 230], sun: ['#8aa0b4', 0.32, 5.4, 34, 0.2], hemi: ['#4a6074', '#3a2010', 1.0],
       key: ['#8ea8c0', 0.95], rim: ['#ff9a32', 1.5], floor: 'rock', floorC: ['#090c11', '#0e131a'], bank: ['#1a2029', '#10151b', '#2a333e'], stars: 0,
       road: 'frostiron', roadC: ['#2c323a', '#12161b'], kerb: ['#b3200f', '#141618'], wall: 'frostiron', clouds: ['#10161e', 22],
       sets: ['sodiumLamp', 'iceSpikes', 'frozenRig', 'chainPost', 'deadPine', 'iceFall', 'rustTank'], over: 'icearch', land: 'peaks', wx: 'blizzard' },
  6: { sky: ['#2a5a90', '#7aa6c4', '#f2dca4', '#fff6d6'], fog: ['#e8ca8e', 40, 440], sun: ['#ffffff', 0.9, 2.2, 120, 1.4], hemi: ['#ffe4a8', '#a06020', 1.0],
       key: ['#fff0c4', 3.0], rim: ['#ffd36b', 0.8], floor: 'sand', floorC: ['#d6a650', '#c4923e'], bank: ['#dcae5c', '#c08c3c', '#e8c070'], stars: 0,
       road: 'cracked', roadC: ['#7a6a5a', '#4a3e34'], kerb: ['#f4f6fa', '#d8322a'], wall: 'rail', clouds: ['#f4e4c0', 6],
       sets: ['ribcage', 'skull', 'tanker', 'cactus', 'duneRock', 'derrick', 'boneSpike'], over: 'ribarch', land: 'bones', wx: 'sand' },
  7: { sky: ['#06141a', '#163438', '#3a6a68', '#9acab8'], fog: ['#2a4a4a', 40, 420], sun: ['#dfffee', 0.25, 4.4, 70, 0.5], hemi: ['#6bffd8', '#0a1a1a', 0.8],
       key: ['#d0fff0', 1.5], rim: ['#2ec2a8', 1.1], floor: 'water', floorC: ['#0c3434', '#124444'], bank: ['#1a1a1c', '#2a2626', '#3a3430'], stars: 30,
       road: 'planks', roadC: ['#4a3e34', '#2a221c'], kerb: ['#e0fff6', '#2a221c'], wall: 'wood', clouds: ['#3a5a5a', 14],
       sets: ['hulk', 'palmDead', 'blackRock', 'drumPile', 'buoy', 'anchorProp', 'netPost'], over: 'shipribs', land: 'wreck', wx: 'spray' },
  8: { sky: ['#000002', '#030214', '#0a0830', '#1a1060'], fog: ['#0a0824', 160, 1400], sun: ['#ffffff', 0.4, 1.0, 50, 1.0], hemi: ['#a88cff', '#1a1060', 0.6],
       key: ['#ffffff', 2.6], rim: ['#5a4dff', 1.6], floor: 'none', floorC: ['#000000', '#000000'], bank: ['#333', '#444', '#555'], stars: 500,
       road: 'hull', roadC: ['#5a5e6a', '#2a2d36'], kerb: ['#a88cff', '#1a1060'], wall: 'energy', clouds: ['#000000', 0],
       sets: ['junk', 'satellite', 'solarPanel', 'fuelTank', 'truss', 'junkBig'], over: 'ringgate', land: 'planet', wx: 'debris' },
  9: { sky: ['#0a0101', '#2e0605', '#8a1a08', '#ff4a10'], fog: ['#3a0c06', 35, 380], sun: ['#ff6a1a', 0.04, 3.1, 200, 1.2], hemi: ['#5a2018', '#ff3a0a', 1.3],
       key: ['#ffb02e', 2.0], rim: ['#ff3a0a', 1.8], floor: 'lava', floorC: ['#ff3a0a', '#8a1000'], bank: ['#141012', '#221614', '#30201a'], stars: 0,
       road: 'basalt', roadC: ['#2a2224', '#141012'], kerb: ['#ff5a1a', '#141012'], wall: 'obsidian', clouds: ['#2a0806', 16],
       sets: ['spire', 'crucible', 'chainPost', 'lavaRock', 'vent', 'skullRock', 'spireTall'], over: 'chainarch', land: 'volcano', wx: 'embers' },
  10: { sky: ['#0a0408', '#2e1428', '#6a3a58', '#7a9040'], fog: ['#3a2834', 26, 330], sun: ['#c8f07a', 0.18, 0.9, 80, 0.7], hemi: ['#a87890', '#2a3a0c', 0.9],
       key: ['#dcc0cc', 1.3], rim: ['#9adf3a', 1.2], floor: 'rock', floorC: ['#22141a', '#180c12'], bank: ['#6a3a4c', '#4a2634', '#34261a'], stars: 30,
       road: 'candy', roadC: ['#5e3e4c', '#32202a'], kerb: ['#8a3b12', '#22160e'], wall: 'rail', clouds: ['#4a2a40', 14],
       sets: ['lollipop', 'tent', 'carousel', 'gumdrop', 'deadTree', 'drumPile', 'bulbPost'], over: 'bulbarch', land: 'carnival', wx: 'motes' },
  11: { sky: ['#000205', '#00101c', '#012e3e', '#0e4f66'], fog: ['#022634', 18, 260], sun: ['#6bffd8', 1.2, 0.5, 120, 0.6], hemi: ['#2ec2c8', '#001010', 0.9],
       key: ['#8affea', 1.1], rim: ['#2ec2c8', 1.4], floor: 'sand', floorC: ['#1a2a2a', '#223434'], bank: ['#1a3030', '#0e2020', '#264040'], stars: 0,
       road: 'glass', roadC: ['#0a3a4a', '#041820'], kerb: ['#6bffd8', '#041820'], wall: 'glass', clouds: ['#000000', 0],
       sets: ['kelp', 'coralGlow', 'subHulk', 'seaRock', 'vent', 'clamProp', 'kelpTall'], over: 'tuberib', land: 'abyss', wx: 'bubbles' },
  12: { sky: ['#06051a', '#221a48', '#5a4a90', '#c8b4ff'], fog: ['#3a3060', 40, 440], sun: ['#fffbe0', 0.35, 2.0, 70, 0.5], hemi: ['#c8b4ff', '#1a1430', 1.0],
       key: ['#fffbe0', 1.7], rim: ['#ffe27a', 1.2], floor: 'cloud', floorC: ['#5a4a90', '#8a7ab8'], bank: ['#444', '#555', '#666'], stars: 60,
       road: 'iron', roadC: ['#4a4652', '#24222a'], kerb: ['#ffe27a', '#24222a'], wall: 'battlement', clouds: ['#4a3a78', 22],
       sets: ['floatRock', 'chainHang', 'watchTower', 'statue', 'banner', 'floatRockBig'], over: 'ironarch', land: 'citadel', wx: 'storm' },
};

/* ---------- small helpers ---------- */
const H = s => parseInt(String(s).slice(1), 16);
const TAU = Math.PI * 2;
function hash(a, b = 0, c = 0) { return VROOM.dmath.hash01(a | 0, b | 0, c | 0); }
function rng(seed) { let s = (seed >>> 0) || 1; return () => { s = (s + 0x6d2b79f5) >>> 0; let t = Math.imul(s ^ (s >>> 15), s | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function cached(ctx, key, make) { if (!ctx.cache.has(key)) ctx.cache.set(key, make()); return ctx.cache.get(key); }

/* ---------- canvas textures ---------- */
function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
function tex(ctx, key, w, h, paint, opts = {}) {
  return cached(ctx, 'tex:' + key, () => {
    const T = ctx.THREE, c = canvas(w, h), g = c.getContext('2d');
    paint(g, w, h, rng(w * 31 + h + key.length * 977));
    const t = new T.CanvasTexture(c);
    t.wrapS = t.wrapT = T.RepeatWrapping;
    t.colorSpace = opts.linear ? T.NoColorSpace : T.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  });
}
function speckle(g, w, h, R, n, cols, rmax = 2) { for (let i = 0; i < n; i++) { g.fillStyle = cols[i % cols.length]; const r = 0.5 + R() * rmax; g.fillRect(R() * w, R() * h, r, r); } }
function blot(g, x, y, r, col, a) { const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, col.replace('A', a)); gr.addColorStop(1, col.replace('A', 0)); g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2); }
function rgba(hex, a) { const v = H(hex); return `rgba(${v >> 16 & 255},${v >> 8 & 255},${v & 255},${a})`; }

/* the road: a 512 x 512 tile covering the full road width (u) and 12 m of length (v). Kerb blocks are painted
   on both edges (3 m each), so the ribbon needs no separate kerb mesh. */
const ROAD_TILE = 12;
function paintRoad(style, P, emissive) {
  return (g, w, h, R) => {
    const [a, b] = P.roadC, [ka, kb] = P.kerb, kerbW = 26;
    g.fillStyle = emissive ? '#000' : a; g.fillRect(0, 0, w, h);
    if (!emissive) speckle(g, w, h, R, 2600, [rgba(b, 0.5), rgba('#ffffff', 0.06), rgba('#000000', 0.25)], 2.5);
    const lane = (col, dash, x = w / 2, lw = 6) => { g.fillStyle = col; for (let y = 0; y < h; y += dash * 2) g.fillRect(x - lw / 2, y, lw, dash); };
    if (style === 'plate' || style === 'hull' || style === 'iron') {
      for (let y = 0; y <= h; y += h / 3) for (let x = kerbW; x <= w - kerbW; x += (w - 2 * kerbW) / 3) {
        if (!emissive) { g.fillStyle = rgba('#000000', 0.45); g.fillRect(x - 2, 0, 4, h); g.fillRect(0, y - 2, w, 4); g.fillStyle = rgba('#c7ccd5', 0.18); g.fillRect(x + 2, 0, 2, h); g.fillRect(0, y + 2, w, 2); }
        else if (style === 'hull') { g.fillStyle = rgba(ACCENT[8][1], 0.9); g.fillRect(x - 1.5, 0, 3, h); }
      }
      if (!emissive) {
        for (let y = 6; y < h; y += h / 3) for (let x = kerbW + 8; x < w - kerbW; x += 22) { g.fillStyle = rgba('#000', 0.5); g.beginPath(); g.arc(x, y + 6, 2.6, 0, TAU); g.fill(); g.fillStyle = rgba('#c7ccd5', 0.4); g.fillRect(x - 1.5, y + 4, 1.5, 1.5); }
        for (let i = 0; i < (style === 'plate' ? 14 : 6); i++) blot(g, R() * w, R() * h, 18 + R() * 50, style === 'iron' ? 'rgba(40,30,60,A)' : 'rgba(138,59,18,A)', 0.45);
        if (style === 'plate') for (let y = 0; y < h; y += 64) { g.fillStyle = rgba('#f2b705', 0.75); g.fillRect(w / 2 - 4, y, 8, 34); }
        if (style === 'iron') for (let y = 20; y < h; y += 128) { g.fillStyle = rgba(ACCENT[12][1], 0.6); g.beginPath(); g.moveTo(w / 2 - 30, y + 30); g.lineTo(w / 2, y); g.lineTo(w / 2 + 30, y + 30); g.lineTo(w / 2 + 30, y + 44); g.lineTo(w / 2, y + 14); g.lineTo(w / 2 - 30, y + 44); g.fill(); }
      }
    } else if (style === 'frostiron') {
      /* dark iron deck plates, frost packed into the seams, frozen rust bleeding from the bolts, dirty slush ruts */
      if (!emissive) {
        for (let i = 0; i < 16; i++) blot(g, R() * w, R() * h, 16 + R() * 46, 'rgba(118,52,20,A)', 0.42);
        for (let i = 0; i < 10; i++) blot(g, R() * w, R() * h, 20 + R() * 40, 'rgba(6,10,16,A)', 0.55);
        for (let y = 0; y <= h; y += h / 4) for (let x = kerbW; x <= w - kerbW; x += (w - 2 * kerbW) / 3) {
          g.fillStyle = rgba('#000000', 0.55); g.fillRect(x - 2, 0, 4, h); g.fillRect(0, y - 2, w, 4);
          g.fillStyle = rgba('#8a9cac', 0.3); g.fillRect(x - 1, 0, 2, h); g.fillRect(0, y - 1, w, 2);
        }
        for (let y = 8; y < h; y += h / 4) for (let x = kerbW + 10; x < w - kerbW; x += 26) { g.fillStyle = rgba('#000', 0.6); g.beginPath(); g.arc(x, y + 6, 2.6, 0, TAU); g.fill(); blot(g, x, y + 12, 7, 'rgba(150,64,22,A)', 0.5); }
        for (const x of [w * 0.3, w * 0.42, w * 0.58, w * 0.7]) { const gr = g.createLinearGradient(x - 12, 0, x + 12, 0); gr.addColorStop(0, rgba('#8a98a4', 0)); gr.addColorStop(0.5, rgba('#8a98a4', 0.32)); gr.addColorStop(1, rgba('#8a98a4', 0)); g.fillStyle = gr; g.fillRect(x - 12, 0, 24, h); }
        speckle(g, w, h, R, 500, [rgba('#c8d6e0', 0.55), rgba('#6a7e90', 0.5)], 2.2);
        g.strokeStyle = rgba('#0a0e14', 0.8); g.lineWidth = 1.5;
        for (let i = 0; i < 12; i++) { let x = R() * w, y = R() * h; g.beginPath(); g.moveTo(x, y); for (let k = 0; k < 5; k++) { x += (R() - 0.5) * 36; y += (R() - 0.5) * 36; g.lineTo(x, y); } g.stroke(); }
        for (let y = 20; y < h; y += 96) { g.fillStyle = rgba('#f2b705', 0.55); g.fillRect(w / 2 - 4, y, 8, 40); }
      }
    } else if (style === 'dirt' || style === 'planks' || style === 'snow' || style === 'cracked') {
      if (!emissive) {
        const rut = style === 'snow' ? rgba('#7a96a8', 0.45) : rgba('#000000', 0.22);
        for (const x of [w * 0.3, w * 0.42, w * 0.58, w * 0.7]) { g.fillStyle = rut; g.fillRect(x - 9, 0, 18, h); }
        if (style === 'dirt') speckle(g, w, h, R, 500, ['#a8643a', '#3a1a0c', '#c27a4a'], 4);
        if (style === 'planks') { for (let y = 0; y < h; y += 32) { g.fillStyle = rgba('#000', 0.55); g.fillRect(kerbW, y, w - kerbW * 2, 3); g.fillStyle = rgba('#8a7a5a', 0.15); g.fillRect(kerbW, y + 3, w - kerbW * 2, 8); } for (let i = 0; i < 40; i++) { g.fillStyle = rgba('#111', 0.7); g.fillRect(kerbW + 10 + R() * (w - 70), Math.floor(R() * 16) * 32 + 12, 3, 3); } }
        if (style === 'snow') speckle(g, w, h, R, 800, ['#ffffff', '#eaf6ff', '#bfe2f0'], 3);
        if (style === 'cracked') { g.strokeStyle = rgba('#1a120c', 0.8); g.lineWidth = 2; for (let i = 0; i < 26; i++) { let x = R() * w, y = R() * h; g.beginPath(); g.moveTo(x, y); for (let k = 0; k < 6; k++) { x += (R() - 0.5) * 40; y += (R() - 0.5) * 40; g.lineTo(x, y); } g.stroke(); } for (let i = 0; i < 10; i++) blot(g, R() * w, R() * h, 30 + R() * 50, 'rgba(214,166,80,A)', 0.7); lane('#e8e0c8', 28); }
      }
    } else if (style === 'wet' || style === 'pier' || style === 'basalt') {
      if (style === 'wet') {
        if (!emissive) for (let i = 0; i < 18; i++) { const x = R() * w, c = i % 2 ? '#ff4fd8' : '#4ff0ff'; const gr = g.createLinearGradient(x - 14, 0, x + 14, 0); gr.addColorStop(0, rgba(c, 0)); gr.addColorStop(0.5, rgba(c, 0.18)); gr.addColorStop(1, rgba(c, 0)); g.fillStyle = gr; g.fillRect(x - 14, R() * h, 28, 60 + R() * 120); }
        lane(emissive ? '#ff4fd8' : '#ff8ae8', 34, w / 2, 7); lane(emissive ? '#4ff0ff' : '#9af8ff', 512, w * 0.12, 5); lane(emissive ? '#4ff0ff' : '#9af8ff', 512, w * 0.88, 5);
      } else if (style === 'pier') {
        if (!emissive) { for (let i = 0; i < 12; i++) blot(g, R() * w, R() * h, 20 + R() * 40, 'rgba(60,90,110,A)', 0.5); lane('#f2b705', 40); lane('#f2b705', 40, w / 2 + 14); }
      } else if (!emissive) {
        g.strokeStyle = '#2a1a14'; g.lineWidth = 3; for (let i = 0; i < 9; i++) { g.strokeRect(R() * w, R() * h, 60 + R() * 120, 50 + R() * 90); }
      }
      if (style === 'basalt') {
        g.strokeStyle = emissive ? '#ff6a1a' : '#ff3a0a'; g.lineWidth = emissive ? 3.5 : 2;
        const R2 = rng(77);
        for (let i = 0; i < 16; i++) { let x = R2() * w, y = R2() * h; g.beginPath(); g.moveTo(x, y); for (let k = 0; k < 7; k++) { x += (R2() - 0.5) * 60; y += (R2() - 0.5) * 60; g.lineTo(x, y); } g.stroke(); }
      }
    } else if (style === 'candy') {
      if (!emissive) {
        for (let y = -w; y < h + w; y += 56) { g.fillStyle = rgba('#fff0f8', 0.35); g.beginPath(); g.moveTo(0, y); g.lineTo(w, y + w * 0.5); g.lineTo(w, y + w * 0.5 + 24); g.lineTo(0, y + 24); g.fill(); }
        for (let i = 0; i < 16; i++) blot(g, R() * w, R() * h, 20 + R() * 60, 'rgba(60,30,20,A)', 0.5);
        for (let i = 0; i < 8; i++) blot(g, R() * w, R() * h, 16 + R() * 30, 'rgba(140,255,58,A)', 0.25);
        g.strokeStyle = rgba('#2a0a1a', 0.8); g.lineWidth = 2; for (let i = 0; i < 14; i++) { let x = R() * w, y = R() * h; g.beginPath(); g.moveTo(x, y); for (let k = 0; k < 5; k++) { x += (R() - 0.5) * 50; y += (R() - 0.5) * 50; g.lineTo(x, y); } g.stroke(); }
      }
    } else if (style === 'glass') {
      if (!emissive) { const gr = g.createLinearGradient(0, 0, w, h); gr.addColorStop(0, '#0e4a5a'); gr.addColorStop(1, '#042028'); g.fillStyle = gr; g.fillRect(0, 0, w, h); }
      g.strokeStyle = emissive ? '#2ec2c8' : rgba('#6bffd8', 0.5); g.lineWidth = 3;
      for (let x = kerbW; x <= w - kerbW; x += (w - kerbW * 2) / 4) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
      for (let y = 0; y <= h; y += h / 4) { g.beginPath(); g.moveTo(kerbW, y); g.lineTo(w - kerbW, y); g.stroke(); }
    }
    /* kerbs: 3 m blocks on both edges, plus a grime band inside them */
    for (let y = 0; y < h; y += h / 4) {
      const c = (y / (h / 4)) % 2 ? kb : ka;
      if (!emissive || style === 'wet' || style === 'glass' || style === 'hull' || style === 'basalt') {
        g.fillStyle = emissive ? (c === ka ? c : '#000') : c;
        g.fillRect(0, y, kerbW, h / 4); g.fillRect(w - kerbW, y, kerbW, h / 4);
      }
    }
    if (!emissive) { const gr = g.createLinearGradient(kerbW, 0, kerbW + 40, 0); gr.addColorStop(0, 'rgba(0,0,0,0.45)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(kerbW, 0, 40, h); const g2 = g.createLinearGradient(w - kerbW, 0, w - kerbW - 40, 0); g2.addColorStop(0, 'rgba(0,0,0,0.45)'); g2.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = g2; g.fillRect(w - kerbW - 40, 0, 40, h); }
  };
}
const EMISSIVE_ROADS = { wet: 1, hull: 1, basalt: 1, glass: 1 };

/* walls: 256 x 128, u along 6 m of wall, v up the face */
function paintWall(style, w) {
  const A = accent(w);
  return (g, W, Hh, R) => {
    const fill = (c) => { g.fillStyle = c; g.fillRect(0, 0, W, Hh); };
    if (style === 'scrap') {
      fill('#2a2622');
      const cols = ['#7a2a1a', '#2a4a6a', '#6a6a2a', '#4a4a50', '#8a5a1a', '#3a5a3a', '#5a2a4a'];
      for (let i = 0; i < 26; i++) { g.fillStyle = cols[i % cols.length]; g.fillRect(R() * W - 20, R() * Hh - 10, 30 + R() * 60, 12 + R() * 24); }
      for (let i = 0; i < 10; i++) blot(g, R() * W, R() * Hh, 20 + R() * 30, 'rgba(138,59,18,A)', 0.6);
      g.strokeStyle = 'rgba(0,0,0,0.6)'; g.lineWidth = 2; for (let y = 10; y < Hh; y += 22) { g.beginPath(); g.moveTo(0, y + R() * 6); g.lineTo(W, y + R() * 6); g.stroke(); }
    } else if (style === 'rock' || style === 'obsidian') {
      fill(style === 'rock' ? '#5a2410' : '#121012');
      for (let i = 0; i < 40; i++) { g.fillStyle = style === 'rock' ? ['#7a3416', '#4a1c0c', '#8a4a26'][i % 3] : ['#1e1a1c', '#2a2226', '#0a0809'][i % 3]; g.beginPath(); const x = R() * W, y = R() * Hh, r = 8 + R() * 22; g.moveTo(x, y - r); g.lineTo(x + r, y); g.lineTo(x + r * 0.3, y + r); g.lineTo(x - r, y + r * 0.4); g.fill(); }
      if (style === 'obsidian') { g.strokeStyle = '#ff5a1a'; g.lineWidth = 2; for (let i = 0; i < 6; i++) { let x = R() * W, y = R() * Hh; g.beginPath(); g.moveTo(x, y); for (let k = 0; k < 5; k++) { x += (R() - 0.5) * 40; y += (R() - 0.5) * 30; g.lineTo(x, y); } g.stroke(); } }
    } else if (style === 'jersey' || style === 'hazard' || style === 'rail' || style === 'snowbank') {
      fill(style === 'snowbank' ? '#e8f4fa' : style === 'rail' ? '#6a5a4a' : '#7a7e84');
      speckle(g, W, Hh, R, 700, ['rgba(0,0,0,0.2)', 'rgba(255,255,255,0.1)'], 2);
      if (style === 'jersey') { g.fillStyle = A[1]; g.fillRect(0, Hh * 0.18, W, 10); g.fillStyle = '#4ff0ff'; g.fillRect(0, Hh * 0.62, W, 6); }
      if (style === 'hazard') { for (let x = -Hh; x < W + Hh; x += 36) { g.fillStyle = '#f2b705'; g.beginPath(); g.moveTo(x, 0); g.lineTo(x + 18, 0); g.lineTo(x + 18 + Hh * 0.45, Hh * 0.45); g.lineTo(x + Hh * 0.45, Hh * 0.45); g.fill(); } g.fillStyle = '#111214'; g.fillRect(0, Hh * 0.45, W, 4); }
      if (style === 'rail') { g.fillStyle = '#9aa0a8'; g.fillRect(0, Hh * 0.15, W, Hh * 0.3); g.fillStyle = 'rgba(0,0,0,0.4)'; g.fillRect(0, Hh * 0.28, W, 4); for (let i = 0; i < 14; i++) blot(g, R() * W, R() * Hh * 0.5, 10 + R() * 26, 'rgba(160,70,20,A)', 0.8); for (let x = 20; x < W; x += 64) { g.fillStyle = '#3a2a20'; g.fillRect(x, 0, 10, Hh); } }
      if (style === 'snowbank') { for (let i = 0; i < 12; i++) blot(g, R() * W, Hh * (0.5 + R() * 0.5), 20 + R() * 30, 'rgba(120,170,200,A)', 0.35); g.fillStyle = '#ffffff'; g.fillRect(0, 0, W, Hh * 0.12); }
    } else if (style === 'frostiron') {
      /* riveted iron crash wall, rust streaks running down under an ice crust and icicles */
      fill('#1c2128');
      for (let x = 0; x < W; x += 64) { g.fillStyle = x % 128 ? '#232930' : '#191d23'; g.fillRect(x, 0, 62, Hh); g.fillStyle = 'rgba(0,0,0,0.6)'; g.fillRect(x + 62, 0, 2, Hh); for (let y = 14; y < Hh; y += 30) { g.fillStyle = '#3a424c'; g.fillRect(x + 6, y, 4, 4); g.fillRect(x + 52, y, 4, 4); } }
      for (let i = 0; i < 14; i++) { const x = R() * W, y = Hh * (0.15 + R() * 0.3), gr = g.createLinearGradient(0, y, 0, y + 50 + R() * 40); gr.addColorStop(0, 'rgba(150,62,20,0.75)'); gr.addColorStop(1, 'rgba(150,62,20,0)'); g.fillStyle = gr; g.fillRect(x, y, 3 + R() * 5, 90); }
      g.fillStyle = A[2]; g.globalAlpha = 0.5; g.fillRect(0, Hh * 0.5, W, 3); g.globalAlpha = 1;
      g.fillStyle = '#8aa0b0'; g.beginPath(); g.moveTo(0, 0); for (let x = 0; x <= W; x += 8) g.lineTo(x, Hh * 0.1 + R() * 8); g.lineTo(W, 0); g.fill();
      g.fillStyle = '#6a8aa4'; for (let x = 4; x < W; x += 10 + R() * 14) { const l = 8 + R() * 26; g.beginPath(); g.moveTo(x - 3, Hh * 0.1); g.lineTo(x + 3, Hh * 0.1); g.lineTo(x, Hh * 0.1 + l); g.fill(); }
      speckle(g, W, Hh, R, 300, ['rgba(200,214,224,0.25)', 'rgba(0,0,0,0.3)'], 2);
    } else if (style === 'wood') {
      fill('#3a2c22'); for (let x = 0; x < W; x += 22) { g.fillStyle = x % 44 ? '#4a3a2c' : '#2e2218'; g.fillRect(x, 0, 20, Hh); g.fillStyle = 'rgba(0,0,0,0.4)'; g.fillRect(x + 20, 0, 2, Hh); }
      g.strokeStyle = '#c8b890'; g.lineWidth = 4; g.beginPath(); for (let x = 0; x <= W; x += 8) g.lineTo(x, Hh * 0.25 + Math.sin(x / W * TAU) * 6); g.stroke();
    } else if (style === 'energy' || style === 'glass') {
      fill(style === 'glass' ? '#0a2a34' : '#1a1c26');
      g.fillStyle = style === 'glass' ? A[1] : A[1]; g.fillRect(0, 4, W, 8); g.fillStyle = A[2]; g.fillRect(0, Hh - 20, W, 6);
      for (let x = 0; x < W; x += 32) { g.fillStyle = 'rgba(255,255,255,0.12)'; g.fillRect(x, 12, 2, Hh - 32); }
    } else if (style === 'cane') {
      fill('#fff0f8'); for (let x = -Hh; x < W + Hh; x += 40) { g.fillStyle = '#c8322a'; g.beginPath(); g.moveTo(x, 0); g.lineTo(x + 20, 0); g.lineTo(x + 20 + Hh, Hh); g.lineTo(x + Hh, Hh); g.fill(); }
      for (let i = 0; i < 18; i++) blot(g, R() * W, R() * Hh, 14 + R() * 30, 'rgba(90,40,20,A)', 0.7);
    } else if (style === 'battlement') {
      fill('#4a4652'); for (let y = 0; y < Hh; y += 20) for (let x = (y / 20) % 2 ? -16 : 0; x < W; x += 32) { g.fillStyle = ['#55505e', '#3e3a46', '#4a4652'][((x + y) / 4 | 0) % 3]; g.fillRect(x + 1, y + 1, 30, 18); }
      for (let i = 0; i < 8; i++) blot(g, R() * W, R() * Hh, 16 + R() * 26, 'rgba(20,16,30,A)', 0.6);
    }
    /* grime at the foot of every wall */
    const gr = g.createLinearGradient(0, Hh, 0, Hh * 0.6); gr.addColorStop(0, 'rgba(0,0,0,0.55)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(0, Hh * 0.6, W, Hh * 0.4);
  };
}
function paintWallGlow(style, w) {
  const A = accent(w);
  return (g, W, Hh) => {
    g.fillStyle = '#000'; g.fillRect(0, 0, W, Hh);
    if (style === 'jersey') { g.fillStyle = A[1]; g.fillRect(0, Hh * 0.18, W, 10); g.fillStyle = '#4ff0ff'; g.fillRect(0, Hh * 0.62, W, 6); }
    if (style === 'energy' || style === 'glass') { g.fillStyle = A[1]; g.fillRect(0, 4, W, 8); g.fillStyle = A[2]; g.fillRect(0, Hh - 20, W, 6); }
    if (style === 'obsidian') { const R = rng(9); g.strokeStyle = '#ff5a1a'; g.lineWidth = 2; for (let i = 0; i < 6; i++) { let x = R() * W, y = R() * Hh; g.beginPath(); g.moveTo(x, y); for (let k = 0; k < 5; k++) { x += (R() - 0.5) * 40; y += (R() - 0.5) * 30; g.lineTo(x, y); } g.stroke(); } }
  };
}
const GLOW_WALLS = { jersey: 1, energy: 1, glass: 1, obsidian: 1 };

function paintChecker(g, w, h) { const n = 8; for (let y = 0; y < 2; y++) for (let x = 0; x < n; x++) { g.fillStyle = (x + y) % 2 ? '#111214' : '#f4f6fa'; g.fillRect(x * w / n, y * h / 2, w / n, h / 2); } }
function paintHazard(g, w, h) { g.fillStyle = '#111214'; g.fillRect(0, 0, w, h); g.fillStyle = '#f2b705'; for (let x = -h; x < w + h; x += 32) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x + 16, 0); g.lineTo(x + 16 + h, h); g.lineTo(x + h, h); g.fill(); } }
function paintChevron(col) {
  return (g, w, h) => {
    g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
    for (let k = 0; k < 2; k++) { const y = k * h / 2; g.fillStyle = col; g.beginPath(); g.moveTo(w * 0.12, y + h * 0.42); g.lineTo(w * 0.5, y + h * 0.06); g.lineTo(w * 0.88, y + h * 0.42); g.lineTo(w * 0.88, y + h * 0.3 + h * 0.18); g.lineTo(w * 0.5, y + h * 0.18); g.lineTo(w * 0.12, y + h * 0.48); g.fill(); }
  };
}
function paintPatch(kind) {
  return (g, w, h, R) => {
    g.clearRect(0, 0, w, h);
    const C = { slick: ['#0a0a0e', 0.92], tarpit: ['#1a0e08', 0.95], puddle: ['#3a6a8a', 0.75], sheet: ['#16324c', 0.85], ice: ['#16324c', 0.85], sandtrap: ['#c89a4a', 0.95], tidepool: ['#2ec2a8', 0.7],
      coolant: ['#1aff8a', 0.7], cinderslick: ['#2a0a04', 0.95], taffy: ['#ff6ab8', 0.92], ink: ['#1a0a2a', 0.92] }[kind] || ['#111', 0.9];
    for (let i = 0; i < 9; i++) { const x = w * (0.25 + R() * 0.5), y = h * (0.2 + R() * 0.6), r = w * (0.18 + R() * 0.16); const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, rgba(C[0], C[1])); gr.addColorStop(0.75, rgba(C[0], C[1])); gr.addColorStop(1, rgba(C[0], 0)); g.fillStyle = gr; g.fillRect(0, 0, w, h); }
    if (kind === 'slick' || kind === 'coolant' || kind === 'ink') for (let i = 0; i < 6; i++) { g.strokeStyle = ['rgba(255,80,220,0.35)', 'rgba(80,255,200,0.3)', 'rgba(255,220,80,0.3)'][i % 3]; g.lineWidth = 3; g.beginPath(); g.arc(w / 2 + (R() - 0.5) * 40, h / 2 + (R() - 0.5) * 40, 20 + R() * 40, 0, TAU); g.stroke(); }
    if (kind === 'sandtrap') { g.strokeStyle = 'rgba(120,80,30,0.6)'; g.lineWidth = 3; for (let y = 20; y < h; y += 16) { g.beginPath(); for (let x = 30; x < w - 30; x += 6) g.lineTo(x, y + Math.sin(x * 0.1) * 3); g.stroke(); } }
    if (kind === 'sheet' || kind === 'ice') { g.strokeStyle = 'rgba(255,255,255,0.8)'; g.lineWidth = 2; for (let i = 0; i < 12; i++) { const x = w * (0.3 + R() * 0.4), y = h * (0.3 + R() * 0.4); g.beginPath(); g.moveTo(x, y); g.lineTo(x + (R() - 0.5) * 60, y + (R() - 0.5) * 60); g.stroke(); } }
    if (kind === 'taffy') { g.strokeStyle = 'rgba(255,240,248,0.6)'; g.lineWidth = 2; for (let i = 0; i < 10; i++) { g.beginPath(); g.moveTo(R() * w, R() * h); g.bezierCurveTo(R() * w, R() * h, R() * w, R() * h, R() * w, R() * h); g.stroke(); } }
  };
}
function paintDot(g, w, h) { const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(255,255,255,0.7)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, h); }
function paintLiquid(kind) {
  return (g, w, h, R) => {
    if (kind === 'lava') {
      g.fillStyle = '#ff3a0a'; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 60; i++) { const x = R() * w, y = R() * h, r = 14 + R() * 40; g.fillStyle = ['#2a0804', '#5a1006', '#1a0402'][i % 3]; g.beginPath(); for (let k = 0; k < 7; k++) { const a = k / 7 * TAU, rr = r * (0.6 + R() * 0.4); g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); } g.fill(); }
      for (let i = 0; i < 30; i++) blot(g, R() * w, R() * h, 10 + R() * 26, 'rgba(255,210,80,A)', 0.7);
    } else if (kind === 'cloud') {
      g.fillStyle = '#5a4a90'; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 70; i++) blot(g, R() * w, R() * h, 20 + R() * 50, i % 3 ? 'rgba(200,180,255,A)' : 'rgba(40,30,80,A)', 0.35);
    } else {
      g.fillStyle = '#0a2230'; g.fillRect(0, 0, w, h);
      g.strokeStyle = 'rgba(160,220,255,0.22)'; g.lineWidth = 2;
      for (let i = 0; i < 90; i++) { const x = R() * w, y = R() * h; g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + 10, y - 4, x + 22 + R() * 20, y); g.stroke(); }
    }
  };
}

/* ---------- geometry kit: merges low-poly parts into one vertex coloured, flat shaded geometry ---------- */
function Kit(T) {
  const parts = [], m = new T.Matrix4(), q = new T.Quaternion(), e = new T.Euler(), v = new T.Vector3(), sc = new T.Vector3();
  const K = {
    parts,
    add(geo, col, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1, grime = 0.22) {
      const g = geo.index ? geo.toNonIndexed() : geo;
      if (g !== geo) geo.dispose();
      e.set(rx, ry, rz); q.setFromEuler(e); m.compose(v.set(x, y, z), q, sc.set(sx, sy, sz)); g.applyMatrix4(m);
      parts.push({ g, c: new T.Color(col), grime });
      return K;
    },
    box(w, h, d, col, x, y, z, rx, ry, rz, gr) { return K.add(new T.BoxGeometry(w, h, d), col, x, y, z, rx, ry, rz, 1, 1, 1, gr); },
    cyl(rt, rb, h, seg, col, x, y, z, rx, ry, rz, gr) { return K.add(new T.CylinderGeometry(rt, rb, h, seg), col, x, y, z, rx, ry, rz, 1, 1, 1, gr); },
    cone(r, h, seg, col, x, y, z, rx, ry, rz, gr) { return K.add(new T.ConeGeometry(r, h, seg), col, x, y, z, rx, ry, rz, 1, 1, 1, gr); },
    ico(r, col, x, y, z, sx = 1, sy = 1, sz = 1, gr, det = 0) { return K.add(new T.IcosahedronGeometry(r, det), col, x, y, z, 0, 0, 0, sx, sy, sz, gr); },
    dodeca(r, col, x, y, z, sx = 1, sy = 1, sz = 1, gr) { return K.add(new T.DodecahedronGeometry(r, 0), col, x, y, z, 0, 0, 0, sx, sy, sz, gr); },
    torus(r, t, rs, ts, col, x, y, z, rx, ry, rz, arc = TAU) { return K.add(new T.TorusGeometry(r, t, rs, ts, arc), col, x, y, z, rx, ry, rz); },
    empty() { return parts.length === 0; },
    build() {
      let n = 0;
      for (const p of parts) n += p.g.attributes.position.count;
      const pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
      let o = 0, tri = 0;
      for (const p of parts) {
        const a = p.g.attributes.position.array;
        pos.set(a, o * 3);
        const cnt = p.g.attributes.position.count;
        for (let i = 0; i < cnt; i++) {
          if (i % 3 === 0) tri++;
          const k = 1 - p.grime * hash(tri, 17, cnt);
          col[(o + i) * 3] = p.c.r * k; col[(o + i) * 3 + 1] = p.c.g * k; col[(o + i) * 3 + 2] = p.c.b * k;
        }
        o += cnt;
        p.g.dispose();
      }
      parts.length = 0;
      const g = new T.BufferGeometry();
      g.setAttribute('position', new T.BufferAttribute(pos, 3));
      g.setAttribute('color', new T.BufferAttribute(col, 3));
      g.computeVertexNormals();
      g.computeBoundingSphere();
      return g;
    },
  };
  return K;
}

/* ---------- roadside sets: each fills a body kit B and a glow kit G (unlit, glowing) in local metres, origin on the ground ---------- */
const SETS = {
  /* foundry */
  smokestack(B, G, A) { B.cyl(1.6, 2.2, 22, 8, '#3a2a24', 0, 11, 0); B.cyl(1.9, 1.9, 1.2, 8, '#5a3a22', 0, 18, 0); B.cyl(1.9, 1.9, 1, 8, '#b3200f', 0, 21, 0); B.box(5, 3, 5, '#2a2420', 0, 1.5, 0); G.cyl(1.4, 1.4, 0.4, 8, A[2], 0, 22.1, 0); },
  scrapPile(B, G, A) { const R = rng(5); for (let i = 0; i < 9; i++) B.box(1 + R() * 2.4, 0.6 + R() * 1.2, 1 + R() * 2.2, ['#6a3a22', '#4a4a50', '#3a5a6a', '#7a6a2a'][i % 4], (R() - 0.5) * 4, 0.5 + R() * 2.2, (R() - 0.5) * 4, R(), R() * 3, R()); B.ico(2.4, '#2e2622', 0, 0.6, 0, 1.4, 0.5, 1.4); },
  crushedStack(B, G, A) { const cols = ['#8a2a1a', '#2a4a7a', '#7a7a2a', '#3a6a3a', '#5a5a60']; for (let i = 0; i < 4; i++) B.box(3.6, 1.1, 1.8, cols[i % 5], 0, 0.55 + i * 1.12, 0, 0, (i % 2) * 0.12 - 0.06, 0.03 * (i - 2)); },
  slagPot(B, G, A) { B.cyl(1.8, 1.3, 2.2, 8, '#2a2420', 0, 1.6, 0); B.box(4.4, 0.4, 0.5, '#3a3430', 0, 1.6, 0); G.cyl(1.6, 1.6, 0.2, 8, A[1], 0, 2.72, 0); B.box(0.5, 2.6, 0.5, '#4a4038', -2.2, 1.3, 0); B.box(0.5, 2.6, 0.5, '#4a4038', 2.2, 1.3, 0); },
  pipeRack(B, G, A) { for (const x of [-3, 3]) B.box(0.5, 6, 0.5, '#3a3a40', x, 3, 0); B.box(7, 0.4, 0.8, '#3a3a40', 0, 5.6, 0); for (let i = 0; i < 3; i++) B.cyl(0.35, 0.35, 12, 8, ['#8a3b12', '#4a5058', '#6b727e'][i], 0, 4.6 + i * 0.75, 0, 0, 0, Math.PI / 2); },
  lampPost(B, G, A) { B.cyl(0.18, 0.25, 8, 6, '#2c3039', 0, 4, 0); B.box(2.2, 0.25, 0.4, '#2c3039', 0.9, 8, 0); G.box(0.9, 0.2, 0.5, A[1], 1.7, 7.8, 0); },
  barrelStack(B, G, A) { const p = [[0, 0], [1.3, 0], [0.65, 1.1], [-0.6, 1.2]]; p.forEach(([x, z], i) => B.cyl(0.6, 0.6, 1.4, 8, i % 2 ? '#3a5a3a' : '#7a3a1a', x, 0.7, z)); B.cyl(0.6, 0.6, 1.4, 8, '#f2b705', 0.65, 2.1, 0.5); },
  moltenTrough(B, G, A) { B.box(14, 0.8, 3.2, '#2a2420', 0, 0.4, 0); B.box(14.4, 0.3, 0.4, '#3a3430', 0, 0.9, 1.6); B.box(14.4, 0.3, 0.4, '#3a3430', 0, 0.9, -1.6); G.box(13.6, 0.12, 2.4, A[2], 0, 0.82, 0); G.box(6, 0.14, 1.2, A[1], -2, 0.86, 0.2); },
  sparkTower(B, G, A) { B.box(1.6, 9, 1.6, '#2c3039', 0, 4.5, 0); B.box(3, 0.6, 3, '#3a3430', 0, 9.2, 0); B.cyl(0.9, 1.3, 1.2, 6, '#1a1412', 0, 10, 0); G.cone(1.1, 4.5, 6, A[1], 0, 12.6, 0); G.cone(0.6, 6, 5, A[0], 0, 13.4, 0); for (let i = 0; i < 6; i++) G.box(0.12, 0.12, 2.6, A[1], Math.cos(i) * 1.4, 11.5 + (i % 3), Math.sin(i) * 1.4, 0.6, i, 0); },
  girderPile(B, G, A) { for (let i = 0; i < 5; i++) B.box(8, 0.5, 0.5, i % 2 ? '#8a3b12' : '#6b727e', 0, 0.25 + (i >> 1) * 0.5, (i - 2) * 0.6, 0, 0.1 * (i - 2), 0); },
  /* ember canyon */
  mesa(B, G, A) { const R = rng(11); B.cyl(6, 9, 18 + R() * 14, 7, '#6a2410', 0, 12, 0); B.cyl(6.5, 6, 2, 7, '#8a3416', 0, 24, 0); B.ico(4, '#4a1a0c', 6, 2, 3, 1.4, 0.8, 1); },
  deadTree(B, G, A) { B.cyl(0.25, 0.45, 5, 5, '#1a0c08', 0, 2.5, 0); B.cyl(0.12, 0.2, 2.6, 4, '#1a0c08', 0.8, 4.4, 0, 0, 0, -0.8); B.cyl(0.1, 0.18, 2.2, 4, '#1a0c08', -0.7, 4, 0.2, 0.3, 0, 0.9); },
  boulder(B, G, A) { B.dodeca(1.8, '#7a2c12', 0, 1.2, 0, 1.3, 0.9, 1.1); B.dodeca(0.9, '#5a1e0c', 1.8, 0.6, 0.8); },
  tumbleweed(B, G, A) { B.ico(0.9, '#5a3a1a', 0, 0.9, 0, 1, 1, 1, 0.5, 1); G.ico(0.55, A[2], 0, 0.9, 0); G.cone(0.5, 1.6, 5, A[1], 0, 1.9, 0); },
  ropeFence(B, G, A) { for (let i = -2; i <= 2; i++) B.cyl(0.12, 0.15, 1.6, 5, '#3a2a1a', i * 2, 0.8, 0); B.box(8.4, 0.08, 0.08, '#c8b890', 0, 1.3, 0); B.box(8.4, 0.08, 0.08, '#c8b890', 0, 0.8, 0); },
  skullRock(B, G, A) { B.ico(2.4, '#d8c8a8', 0, 2.2, 0, 1.1, 1, 1.2); B.box(3, 1.2, 2, '#c8b898', 0, 0.6, 0.8); B.ico(0.6, '#1a0c08', -0.9, 2.4, 2.2); B.ico(0.6, '#1a0c08', 0.9, 2.4, 2.2); G.ico(0.3, A[2], -0.9, 2.4, 2.5); G.ico(0.3, A[2], 0.9, 2.4, 2.5); },
  rockArch(B, G, A) { B.cyl(2.4, 3, 14, 6, '#6a2410', -8, 7, 0); B.cyl(2.4, 3, 14, 6, '#6a2410', 8, 7, 0); B.box(20, 4, 5, '#7a2c12', 0, 15, 0, 0, 0, 0.05); },
  /* neon necropolis */
  tower(B, G, A) { const R = rng(3), h = 18 + R() * 30; B.box(10, h, 10, '#0e0e16', 0, h / 2, 0); for (let y = 3; y < h - 2; y += 3) for (let x = -3; x <= 3; x += 3) if (R() < 0.35) G.box(1.4, 1, 0.1, R() < 0.5 ? A[1] : '#4ff0ff', x, y, 5.06); B.box(2, 3, 2, '#1a1a24', 2, h + 1.5, 1); },
  towerTall(B, G, A) { const h = 60; B.box(12, h, 12, '#0c0c14', 0, h / 2, 0); B.box(8, 12, 8, '#12121c', 0, h + 6, 0); B.cyl(0.15, 0.15, 14, 4, '#3a3a48', 0, h + 19, 0); G.ico(0.5, A[1], 0, h + 26, 0); for (let y = 6; y < h; y += 8) G.box(12.1, 0.4, 12.1, y % 16 ? A[2] : '#4ff0ff', 0, y, 0); },
  neonSign(B, G, A) { B.box(0.3, 7, 0.3, '#2a2a34', 0, 3.5, 0); B.box(5, 3.4, 0.4, '#14141c', 0, 7.4, 0); G.box(3.6, 0.5, 0.1, A[1], 0, 8.6, 0.25); G.box(0.5, 2, 0.1, A[1], 1.5, 7.4, 0.25); G.box(3.6, 0.5, 0.1, '#4ff0ff', 0, 6.2, 0.25); G.cone(0.9, 1.2, 3, '#4ff0ff', -1, 7.4, 0.25, 0, 0, -Math.PI / 2); },
  streetLamp(B, G, A) { B.cyl(0.15, 0.2, 7, 6, '#2a2a34', 0, 3.5, 0); B.box(1.6, 0.2, 0.3, '#2a2a34', 0.6, 7, 0); G.box(0.7, 0.15, 0.4, '#ffe0f8', 1.2, 6.85, 0); },
  deadCar(B, G, A) { B.box(4, 0.9, 1.9, '#3a2a4a', 0, 0.75, 0, 0, 0, 0.08); B.box(2.2, 0.7, 1.7, '#22222e', -0.2, 1.5, 0, 0, 0, 0.08); for (const [x, z] of [[1.3, 0.95], [-1.3, 0.95], [1.3, -0.95]]) B.cyl(0.4, 0.4, 0.3, 8, '#111', x, 0.4, z, Math.PI / 2); },
  billboard(B, G, A) { B.box(0.4, 9, 0.4, '#2a2a34', -3, 4.5, 0); B.box(0.4, 9, 0.4, '#2a2a34', 3, 4.5, 0); B.box(9, 4.4, 0.4, '#16121e', 0, 10, 0); G.cone(1.6, 2.6, 3, A[1], -2, 10, 0.25, 0, 0, -Math.PI / 2); G.box(3.2, 0.5, 0.1, '#4ff0ff', 1.6, 10, 0.25); G.box(8.4, 0.2, 0.1, A[2], 0, 12, 0.25); },
  antenna(B, G, A) { B.cyl(0.1, 0.3, 16, 4, '#3a3a48', 0, 8, 0); for (let y = 4; y < 16; y += 4) B.box(2.4 - y * 0.1, 0.1, 0.1, '#3a3a48', 0, y, 0); G.ico(0.35, '#ff2a2a', 0, 16.2, 0); },
  /* drown docks */
  containerStack(B, G, A) { const cols = ['#a83a22', '#2a5a8a', '#3a7a4a', '#c8a02a', '#5a5a64']; const R = rng(7); for (let i = 0; i < 5; i++) B.box(6, 2.5, 2.4, cols[Math.floor(R() * 5)], (i % 2) * 0.4, 1.25 + Math.floor(i / 2) * 2.5, (i % 2) * 2.5 - 1.2, 0, R() * 0.1 - 0.05, 0, 0.12); },
  bollardRow(B, G, A) { for (let i = -1; i <= 1; i++) { B.cyl(0.35, 0.45, 1, 8, '#1a1c20', i * 3, 0.5, 0); B.cyl(0.5, 0.5, 0.2, 8, '#2a2c30', i * 3, 1.05, 0); } B.box(7, 0.2, 0.2, '#c8b890', 0, 0.8, 0); },
  dockCrane(B, G, A) { for (const [x, z] of [[-3, -3], [3, -3], [-3, 3], [3, 3]]) B.box(0.7, 18, 0.7, '#c8a02a', x, 9, z); B.box(7, 1.4, 7, '#c8a02a', 0, 18.5, 0); B.box(2, 1.2, 30, '#c8a02a', 0, 19.8, 8); B.box(3, 3, 3, '#3a3a40', 0, 21.5, -3); B.box(0.1, 10, 0.1, '#111', 0, 14, 18); B.box(2.4, 0.8, 1.6, '#2a2c30', 0, 9, 18); G.ico(0.35, '#ff3a2a', 0, 21, 23); },
  crateStack(B, G, A) { for (let i = 0; i < 4; i++) B.box(1.5, 1.5, 1.5, '#5a4a32', (i % 2) * 1.6, 0.75 + (i >> 1) * 1.5, (i >> 1) * 0.3); },
  warehouse(B, G, A) { B.box(22, 9, 14, '#3a4048', 0, 4.5, 0); B.box(22.4, 1, 14.4, '#2a2e34', 0, 9.5, 0); for (let x = -9; x <= 9; x += 6) B.box(4, 5, 0.2, '#2a3a4a', x, 2.5, 7.05); G.box(2, 0.4, 0.2, '#ffe0a0', -6, 7, 7.15); G.box(2, 0.4, 0.2, '#ffe0a0', 6, 7, 7.15); },
  buoy(B, G, A) { B.cyl(0.9, 1.2, 1.4, 8, '#c8322a', 0, 0.4, 0); B.cyl(0.2, 0.4, 2, 5, '#f4f6fa', 0, 1.9, 0); G.ico(0.3, A[1], 0, 3, 0); },
  /* frostbite pass */
  pine(B, G, A) { B.cyl(0.25, 0.35, 2, 5, '#3a2a20', 0, 1, 0); for (let k = 0; k < 4; k++) { B.cone(2.6 - k * 0.5, 2.6, 7, '#1e3a34', 0, 2.4 + k * 1.6, 0); B.cone(2.62 - k * 0.5, 0.7, 7, '#f4fbff', 0, 3.4 + k * 1.6, 0); } },
  pineTall(B, G, A) { B.cyl(0.35, 0.5, 3, 5, '#3a2a20', 0, 1.5, 0); for (let k = 0; k < 6; k++) { B.cone(3.6 - k * 0.5, 3.4, 7, '#18302c', 0, 3.6 + k * 2.2, 0); B.cone(3.62 - k * 0.5, 0.9, 7, '#f4fbff', 0, 4.9 + k * 2.2, 0); } },
  iceSpikes(B, G, A) { const R = rng(2); for (let i = 0; i < 6; i++) B.cone(0.5 + R() * 0.8, 3 + R() * 5, 5, i % 2 ? '#1e3a52' : '#2e5672', (R() - 0.5) * 4, 2, (R() - 0.5) * 4, (R() - 0.5) * 0.5, 0, (R() - 0.5) * 0.5, 0.1); B.dodeca(1.6, '#141a22', 0, 0.3, 0, 1.6, 0.4, 1.4); },
  frozenRig(B, G, A) { B.box(6, 3, 3, '#3a2620', 0, 1.5, 0, 0, 0, 0.1); B.box(2.4, 2, 2.6, '#2a2c32', 2.2, 3.6, 0); B.box(6.4, 0.5, 3.4, '#7a8a98', 0, 3.1, 0); B.box(1.2, 3.2, 0.2, '#8a3b12', -1.6, 1.6, 1.55, 0, 0, 0.1); B.cone(0.3, 1.6, 5, '#4a7a9a', -2, 2.2, 1.6, Math.PI); B.cone(0.3, 1.2, 5, '#4a7a9a', 1, 2.2, 1.6, Math.PI); G.box(0.5, 0.3, 0.1, '#ffa030', 2.2, 4, 1.32); },
  sodiumLamp(B, G, A) { B.box(0.3, 9, 0.3, '#1c2026', 0, 4.5, 0); B.box(2.6, 0.3, 0.4, '#1c2026', 1.1, 9, 0); B.box(1.2, 0.45, 0.8, '#2a2e34', 2.2, 8.75, 0); B.box(0.36, 0.3, 0.36, '#8a3b12', 0, 3, 0); B.box(2.7, 0.18, 0.5, '#7a8a98', 1.1, 9.22, 0); G.box(1.0, 0.12, 0.6, '#ffb040', 2.2, 8.5, 0); G.cyl(3.4, 3.4, 0.02, 10, '#3a1c06', 2.2, 0.04, 0); },
  deadPine(B, G, A) { B.cyl(0.22, 0.34, 2.4, 5, '#1a1410', 0, 1.2, 0); for (let k = 0; k < 4; k++) { B.cone(2.2 - k * 0.45, 2.4, 6, '#0c1614', 0, 2.6 + k * 1.5, 0, 0.06, k, 0); B.cone(2.22 - k * 0.45, 0.5, 6, '#7a8a96', 0, 3.4 + k * 1.5, 0, 0.06, k, 0); } },
  rustTank(B, G, A) { B.cyl(1.8, 1.8, 7, 9, '#4a2416', 0, 2.1, 0, 0, 0, Math.PI / 2); B.cyl(1.85, 1.85, 0.4, 9, '#1c2026', 2.6, 2.1, 0, 0, 0, Math.PI / 2); B.cyl(1.85, 1.85, 0.4, 9, '#1c2026', -2.6, 2.1, 0, 0, 0, Math.PI / 2); B.box(7.2, 0.4, 2.6, '#7a8a98', 0, 3.85, 0); for (let i = 0; i < 6; i++) B.cone(0.18, 0.8 + (i % 3) * 0.5, 4, '#4a7a9a', -2.5 + i, 1.0, 1.75, Math.PI); B.box(1.2, 1.2, 3.8, '#2a2e34', 0, 0.6, 0); G.box(0.4, 0.4, 0.1, '#ff3a1a', 3.2, 2.1, 0.9); },
  snowRock(B, G, A) { B.dodeca(1.8, '#5a6a78', 0, 1, 0, 1.3, 0.8, 1.1); B.dodeca(1.82, '#f4fbff', 0, 1.6, 0, 1.2, 0.4, 1.0); },
  iceFall(B, G, A) { B.box(10, 16, 4, '#161c24', 0, 8, -2); B.box(3, 14, 0.4, '#5a2a14', -3, 9, 0.1); for (let i = 0; i < 7; i++) B.cone(0.9, 6 + (i % 3) * 3, 6, i % 2 ? '#2e5672' : '#4a7a9a', -4 + i * 1.3, 12 - (i % 3) * 1.5, 0.4, Math.PI, 0, 0, 0.08); B.box(9, 1.5, 4, '#5a6a78', 0, 0.7, 1.5); },
  snowFence(B, G, A) { for (let i = -3; i <= 3; i++) B.box(0.15, 2.4, 0.15, '#3a2a20', i * 1.2, 1.2, 0); B.box(8, 0.2, 0.1, '#c8322a', 0, 2, 0); B.box(8, 0.8, 0.3, '#f4fbff', 0, 0.4, 0); },
  /* scorch flats */
  ribcage(B, G, A) { for (let i = 0; i < 5; i++) { B.torus(4 - Math.abs(i - 2) * 0.6, 0.35, 4, 8, '#e8dcc0', 0, 0, i * 2.2 - 4.4, 0, Math.PI / 2, 0, Math.PI); } B.cyl(0.5, 0.5, 11, 6, '#d8ccb0', 0, 0.3, 0, Math.PI / 2); },
  skull(B, G, A) { B.ico(3.2, '#e8dcc0', 0, 3, 0, 1.2, 1, 1.4, 0.15, 1); B.box(3.6, 1.4, 3, '#d8ccb0', 0, 0.7, 2.4); B.cone(0.8, 5, 5, '#d8ccb0', -3.2, 5, 0, 0, 0, 0.9); B.cone(0.8, 5, 5, '#d8ccb0', 3.2, 5, 0, 0, 0, -0.9); B.ico(0.9, '#2a1a10', -1.2, 3.4, 4); B.ico(0.9, '#2a1a10', 1.2, 3.4, 4); },
  tanker(B, G, A) { B.cyl(1.6, 1.6, 8, 8, '#8a6a4a', 0, 1.9, 0, Math.PI / 2, 0, 0.3); B.box(2.6, 2.4, 2.8, '#6a3a22', 0, 1.4, 5, 0, 0, 0.3); for (let i = 0; i < 8; i++) B.box(0.5, 0.5, 0.5, '#8a3b12', (i % 3) - 1, 3 + (i % 2), i - 4); },
  cactus(B, G, A) { B.cyl(0.6, 0.7, 6, 7, '#4a6a2a', 0, 3, 0); B.cyl(0.4, 0.4, 2.4, 6, '#4a6a2a', 1.3, 3.6, 0); B.cyl(0.4, 0.4, 1.2, 6, '#4a6a2a', 0.8, 2.6, 0, 0, 0, Math.PI / 2); B.cyl(0.35, 0.35, 2, 6, '#4a6a2a', -1.2, 4, 0); B.cyl(0.35, 0.35, 1, 6, '#4a6a2a', -0.7, 3.2, 0, 0, 0, Math.PI / 2); },
  duneRock(B, G, A) { B.dodeca(3, '#c08c3c', 0, 0.4, 0, 2, 0.6, 1.3); B.dodeca(1.6, '#a0703a', 2, 1.4, 0, 1, 1.3, 1); },
  derrick(B, G, A) { for (const [x, z] of [[-2, -2], [2, -2], [-2, 2], [2, 2]]) B.box(0.3, 16, 0.3, '#3a2a20', x * 0.5, 8, z * 0.5, z * 0.06, 0, -x * 0.06); B.box(3, 0.3, 3, '#3a2a20', 0, 6, 0); B.box(3, 0.3, 3, '#3a2a20', 0, 11, 0); B.box(4, 2, 3, '#5a3a22', 3, 1, 0); G.ico(0.3, '#ff3a2a', 0, 16.2, 0); },
  boneSpike(B, G, A) { B.cone(0.8, 7, 5, '#e8dcc0', 0, 3.2, 0, 0.3, 0, 0.2); B.ico(0.9, '#d8ccb0', 0, 0.4, 0); },
  /* wreck cove */
  hulk(B, G, A) { B.box(26, 8, 8, '#5a3420', 0, 2.4, 0, 0.12, 0, 0.1); B.box(8, 6, 7, '#4a2a1a', -6, 8, 0, 0.12, 0, 0.1); B.cyl(1, 1.2, 7, 8, '#3a2a20', -6, 13, 0); B.cone(4.2, 6, 4, '#4a2e1c', 14, 2.6, 0, 0, Math.PI / 4, -Math.PI / 2); for (let i = 0; i < 12; i++) B.box(2, 2, 0.4, '#8a3b12', -10 + i * 2, 3.5 + (i % 3) * 1.4, 4.1, 0, 0, 0, 0.5); },
  palmDead(B, G, A) { B.cyl(0.25, 0.4, 8, 6, '#2a221c', 0, 4, 0, 0, 0, 0.2); for (let i = 0; i < 5; i++) B.box(3.4, 0.12, 0.6, '#3a3a24', 1 + Math.cos(i * 1.3) * 1.4, 7.8, Math.sin(i * 1.3) * 1.4, 0, i * 1.3, -0.6); },
  blackRock(B, G, A) { B.dodeca(2.2, '#1a1a1c', 0, 1, 0, 1.4, 0.9, 1); B.dodeca(1.2, '#2a2a2c', 2, 0.6, 1); G.box(0.2, 0.2, 0.2, A[1], 0.4, 2.5, 0.5); },
  drumPile(B, G, A) { for (let i = 0; i < 5; i++) B.cyl(0.6, 0.6, 1.4, 8, ['#2a5a5a', '#8a3b12', '#5a5a20'][i % 3], (i % 3) * 1.3 - 1.3, 0.7 + (i > 2 ? 1.4 : 0), i > 2 ? 0.3 : 0, i === 4 ? Math.PI / 2 : 0); },
  anchorProp(B, G, A) { B.box(0.5, 5, 0.5, '#2a2a2e', 0, 2.5, 0, 0, 0, 0.3); B.torus(1.6, 0.25, 4, 8, '#2a2a2e', 0.8, 0.8, 0, 0, 0, Math.PI, Math.PI); B.torus(0.6, 0.18, 4, 8, '#2a2a2e', -0.8, 5, 0); },
  netPost(B, G, A) { B.cyl(0.25, 0.3, 4, 5, '#3a2c22', 0, 2, 0); B.cyl(0.25, 0.3, 4, 5, '#3a2c22', 4, 2, 0); for (let y = 1; y < 4; y += 0.7) B.box(4, 0.05, 0.05, '#8a8a6a', 2, y, 0); G.ico(0.25, A[1], 0, 4.2, 0); },
  /* orbital scrapheap (floats: placed with lift) */
  junk(B, G, A) { const R = rng(13); for (let i = 0; i < 5; i++) B.box(0.8 + R() * 2, 0.5 + R() * 1.5, 0.8 + R() * 2, ['#5a5e6a', '#8a8e9a', '#3a3e4a', '#6a4a8a'][i % 4], (R() - 0.5) * 4, (R() - 0.5) * 3, (R() - 0.5) * 4, R() * 3, R() * 3, R() * 3); G.box(0.3, 0.3, 0.3, A[1], 0, 0, 0); },
  junkBig(B, G, A) { B.cyl(3, 3, 14, 8, '#6a6e7a', 0, 0, 0, 0.4, 0, Math.PI / 2); B.box(16, 0.4, 5, '#2a3a6a', 0, 0, 5, 0, 0, 0.2); B.box(16, 0.4, 5, '#2a3a6a', 0, 0, -5, 0, 0, 0.2); G.box(0.6, 0.6, 14.2, A[2], 0, 3, 0, 0.4, 0, 0); },
  satellite(B, G, A) { B.cyl(0.8, 0.8, 2.4, 8, '#c7ccd5', 0, 0, 0); B.box(6, 0.1, 1.6, '#2a3a8a', 3.6, 0, 0); B.box(6, 0.1, 1.6, '#2a3a8a', -3.6, 0, 0); B.cone(1.2, 0.8, 8, '#e8e8f0', 0, 1.6, 0, Math.PI); G.ico(0.2, '#ff3a2a', 0, -1.3, 0); },
  solarPanel(B, G, A) { B.box(8, 0.2, 4, '#1a2a6a', 0, 0, 0, 0.3, 0.2, 0.1); B.box(0.3, 0.3, 6, '#6b727e', 0, 0, 0); },
  fuelTank(B, G, A) { B.cyl(1.4, 1.4, 6, 8, '#d8d8e0', 0, 0, 0, 0.5, 0, 0.9); B.cyl(1.45, 1.45, 0.5, 8, '#d8322a', 0, 0, 0, 0.5, 0, 0.9); },
  truss(B, G, A) { for (let i = 0; i < 4; i++) B.box(0.3, 0.3, 12, '#6b727e', (i % 2) * 2 - 1, (i >> 1) * 2 - 1, 0); for (let z = -5; z <= 5; z += 2.5) B.box(2.6, 0.2, 0.2, '#8a8e9a', 0, 0, z, 0, 0, 0.785); G.ico(0.2, A[1], 0, 1.2, 6); },
  /* magma forge */
  spire(B, G, A) { B.cone(1.6, 12, 5, '#121012', 0, 6, 0, 0.05, 0, 0.08); B.cone(0.9, 6, 5, '#1a1416', 1.4, 3, 0.6); G.box(0.1, 6, 0.1, A[2], 0.4, 4, 1.05, 0, 0, 0.12); },
  spireTall(B, G, A) { B.cone(4, 34, 5, '#0e0c0e', 0, 17, 0, 0.04, 0, 0.05); B.cone(2, 14, 5, '#161214', 3.5, 7, 1); G.box(0.2, 18, 0.2, A[2], 1, 12, 2.6, 0, 0, 0.1); },
  crucible(B, G, A) { B.cyl(2, 1.4, 3, 8, '#2a2224', 0, 1.6, 0); G.cyl(1.8, 1.8, 0.25, 8, A[1], 0, 3.05, 0); G.cyl(0.25, 0.4, 3, 6, A[2], 2.1, 1.4, 0, 0, 0, 0.5); },
  chainPost(B, G, A) { B.box(1, 5, 1, '#1a1416', 0, 2.5, 0); for (let i = 0; i < 6; i++) B.torus(0.35, 0.1, 4, 6, '#3a3034', 0.9 + i * 0.6, 4.4 - i * 0.6, 0, 0, i % 2 ? Math.PI / 2 : 0, 0); },
  lavaRock(B, G, A) { B.dodeca(2, '#141012', 0, 1, 0, 1.3, 0.9, 1.1); G.box(0.15, 1.4, 0.15, A[2], 0.8, 1.2, 1.6, 0, 0, 0.5); G.box(0.15, 1.0, 0.15, A[1], -0.6, 1.5, 1.6, 0, 0, -0.4); },
  vent(B, G, A) { B.cyl(0.9, 1.6, 2, 7, '#1a1416', 0, 1, 0); G.cyl(0.6, 0.6, 0.2, 7, A[1], 0, 2.05, 0); G.cone(0.6, 3, 6, A[2], 0, 3.6, 0); },
  /* rot sugar carnival */
  lollipop(B, G, A) { B.cyl(0.15, 0.15, 6, 5, '#e8e0d8', 0, 3, 0, 0, 0, 0.15); B.cyl(2, 2, 0.5, 10, '#c84fa0', 0.9, 6.2, 0, Math.PI / 2, 0, 0.15); B.cyl(1.3, 1.3, 0.55, 10, '#8cff3a', 0.9, 6.2, 0, Math.PI / 2, 0, 0.15, 0.3); B.cyl(0.6, 0.6, 0.6, 8, '#fff0f8', 0.9, 6.2, 0, Math.PI / 2, 0, 0.15); },
  teacup(B, G, A) { B.cyl(2.2, 1.4, 2, 9, '#a05a7a', 0, 1.4, 0, 0.15); B.cyl(2.25, 2.25, 0.2, 9, '#8a3b12', 0, 2.4, 0, 0.15); B.torus(0.7, 0.18, 4, 6, '#a05a7a', 2.3, 1.4, 0, 0, Math.PI / 2, 0); B.cyl(2.8, 2.8, 0.4, 9, '#3a2a30', 0, 0.2, 0); },
  tent(B, G, A) { B.cyl(5, 6, 4, 8, '#c84f8a', 0, 2, 0); B.cone(6.2, 5, 8, '#fff0f8', 0, 6.5, 0); for (let i = 0; i < 8; i++) B.box(0.6, 4.1, 0.1, '#5a1040', Math.cos(i / 8 * TAU) * 5.6, 2, Math.sin(i / 8 * TAU) * 5.6, 0, -i / 8 * TAU + Math.PI / 2, 0); B.cyl(0.1, 0.1, 3, 4, '#3a2a30', 0, 10.5, 0); G.ico(0.35, A[1], 0, 12, 0); },
  bulbPost(B, G, A) { B.cyl(0.15, 0.2, 5, 6, '#3a2a30', 0, 2.5, 0); for (let i = 0; i < 4; i++) G.ico(0.28, i % 2 ? '#ffe27a' : '#8cff3a', Math.cos(i * 1.57) * 0.6, 5.2, Math.sin(i * 1.57) * 0.6); },
  gumdrop(B, G, A) { B.cone(2, 2.6, 8, '#5aaa3a', 0, 1.3, 0, 0, 0, 0, 0.35); B.cone(1.4, 1.8, 8, '#c84f8a', 2.6, 0.9, 1); },
  caneProp(B, G, A) { for (let i = 0; i < 6; i++) B.cyl(0.3, 0.3, 1, 6, i % 2 ? '#c8322a' : '#fff0f8', 0, 0.5 + i, 0); B.torus(0.9, 0.3, 5, 8, '#c8322a', 0.9, 6, 0, 0, 0, 0, Math.PI); },
  carousel(B, G, A) { B.cyl(5, 5, 0.6, 12, '#5a2a40', 0, 0.3, 0); B.cyl(0.4, 0.4, 6, 6, '#c8a02a', 0, 3, 0); B.cone(5.6, 2.4, 12, '#c84fa0', 0, 7.2, 0); for (let i = 0; i < 6; i++) { const a = i / 6 * TAU; B.cyl(0.08, 0.08, 5.4, 4, '#c8a02a', Math.cos(a) * 4, 3, Math.sin(a) * 4); B.box(0.5, 1, 1.4, '#e8e0d8', Math.cos(a) * 4, 2 + (i % 2), Math.sin(a) * 4, 0, -a, 0); G.ico(0.2, '#ffe27a', Math.cos(a) * 5.4, 6, Math.sin(a) * 5.4); } },
  /* abyss trench */
  kelp(B, G, A) { for (let i = 0; i < 4; i++) B.cone(0.4, 6 + i * 2, 4, '#1a4a2a', (i - 1.5) * 0.8, 3 + i, (i % 2) * 0.6, 0.1 * (i - 1.5), 0, 0.12 * (i - 1.5)); },
  kelpTall(B, G, A) { for (let i = 0; i < 5; i++) B.cone(0.6, 14 + i * 3, 4, '#163e24', (i - 2) * 1.2, 7 + i * 1.5, (i % 2) * 1, 0.06 * (i - 2), 0, 0.08 * (i - 2)); G.ico(0.3, A[1], 0, 22, 0); },
  coralGlow(B, G, A) { B.dodeca(1.4, '#2a1a3a', 0, 0.7, 0, 1.4, 0.7, 1.2); for (let i = 0; i < 6; i++) G.cyl(0.08, 0.2, 1.6 + (i % 3) * 0.6, 4, i % 2 ? A[1] : '#ff4fd8', (i - 2.5) * 0.45, 1.6, (i % 3 - 1) * 0.5, (i % 3 - 1) * 0.4, 0, (i - 2.5) * 0.25); },
  subHulk(B, G, A) { B.cyl(2.6, 2.6, 18, 9, '#3a4a4a', 0, 2.2, 0, Math.PI / 2, 0, 0.2); B.box(3, 4, 5, '#2a3838', 0, 5.4, 1, 0, 0, 0.2); B.cone(2.6, 4, 9, '#2a3838', 0, 2.2 + Math.sin(0.2) * 11, 11, Math.PI / 2, 0, 0); for (let i = 0; i < 5; i++) G.cyl(0.35, 0.35, 0.1, 8, A[1], 2.62, 2.6, -6 + i * 3, 0, 0, Math.PI / 2); },
  seaRock(B, G, A) { B.dodeca(2.4, '#1a3030', 0, 1, 0, 1.4, 1, 1.1); B.dodeca(1.2, '#264040', 2, 0.6, 1); },
  clamProp(B, G, A) { B.ico(2, '#3a3a5a', 0, 0.6, 0, 1.4, 0.35, 1.2); B.ico(2, '#4a4a6a', 0, 1.6, -0.8, 1.4, 0.3, 1.2); G.ico(0.6, '#f0f8ff', 0, 1, 0.3); },
  /* storm citadel (floats: placed with lift) */
  floatRock(B, G, A) { B.cone(4, 8, 6, '#3a3444', 0, -3, 0, Math.PI); B.cyl(4.2, 4, 1.4, 6, '#4a4652', 0, 1.2, 0); B.cone(2, 4, 5, '#5a5468', 1.4, 3.6, 0.5); },
  floatRockBig(B, G, A) { B.cone(12, 22, 7, '#2e2a38', 0, -10, 0, Math.PI); B.cyl(12.5, 12, 3, 7, '#4a4652', 0, 2, 0); for (let i = 0; i < 3; i++) B.box(3, 8 + i * 4, 3, '#3e3a46', -6 + i * 6, 6 + i * 2, (i - 1) * 3); G.box(0.6, 1, 0.1, A[1], 0, 10, 4.6); },
  chainHang(B, G, A) { for (let i = 0; i < 10; i++) B.torus(0.5, 0.14, 4, 6, '#3a3640', 0, -i * 0.9, 0, 0, i % 2 ? Math.PI / 2 : 0, 0); B.box(1.4, 1.4, 1.4, '#2a2630', 0, -9.6, 0); },
  watchTower(B, G, A) { B.cyl(2.2, 2.8, 16, 8, '#4a4652', 0, 8, 0); for (let i = 0; i < 8; i++) B.box(1, 1.4, 1, '#55505e', Math.cos(i / 8 * TAU) * 2.4, 16.6, Math.sin(i / 8 * TAU) * 2.4); B.cone(2.8, 4, 8, '#2a2630', 0, 19, 0); G.box(0.8, 1.2, 0.1, A[1], 0, 12, 2.6); },
  statue(B, G, A) { B.box(2.4, 1.4, 2.4, '#4a4652', 0, 0.7, 0); B.box(1.4, 4, 1, '#5a5468', 0, 3.4, 0); B.ico(0.8, '#5a5468', 0, 6, 0); B.box(4.4, 0.5, 0.5, '#5a5468', 0, 4.6, 0, 0, 0, 0.3); B.cone(0.3, 3.4, 4, '#6a6478', 2.4, 6, 0); G.ico(0.2, A[1], -0.3, 6.2, 0.7); G.ico(0.2, A[1], 0.3, 6.2, 0.7); },
  banner(B, G, A) { B.cyl(0.12, 0.12, 10, 5, '#2a2630', 0, 5, 0); B.box(2.2, 4, 0.1, '#3a2a80', 1.2, 7.4, 0); G.cone(0.7, 1.4, 3, A[1], 1.2, 7.4, 0.08); },
};
/* sets that hover or hang (orbit and citadel): placed with a lift above or below the road level */
const FLOAT_SETS = { junk: [-14, 16], junkBig: [-30, 30], satellite: [-10, 20], solarPanel: [-20, 20], fuelTank: [-16, 16], truss: [-26, -6], floatRock: [-24, 2], floatRockBig: [-60, -18], chainHang: [-2, 12] };
const BIG_SETS = { rustTank: 1, mesa: 1, tower: 1, towerTall: 1, warehouse: 1, hulk: 1, junkBig: 1, floatRockBig: 1, spireTall: 1, rockArch: 1, dockCrane: 1, iceFall: 1, derrick: 1, smokestack: 1, tent: 1, kelpTall: 1, pineTall: 1, carousel: 1, ribcage: 1, skull: 1, subHulk: 1, watchTower: 1 };

/* ---------- landmarks: the horizon set piece of each world. Built at landmark scale (hundreds of metres) ---------- */
const LANDMARKS = {
  foundry(B, G, A) {
    /* a blast furnace complex: twin stacks, a pouring crucible on a gantry, a molten river spilling below */
    B.cyl(30, 46, 120, 8, '#1c1412', 0, 60, 0); B.cyl(34, 34, 8, 8, '#2a1c16', 0, 124, 0);
    for (const x of [-90, 70, 130]) { B.cyl(9, 12, 170 + x * 0.2, 8, '#140e0c', x, 85 + x * 0.1, -30); B.cyl(10, 10, 6, 8, '#b3200f', x, 168 + x * 0.2, -30); G.cyl(8, 8, 3, 8, A[2], x, 172 + x * 0.2, -30); }
    B.box(260, 10, 14, '#1a1210', 0, 150, 40); B.box(10, 150, 10, '#1a1210', -120, 75, 40); B.box(10, 150, 10, '#1a1210', 120, 75, 40);
    B.cyl(20, 14, 26, 8, '#241a16', 40, 120, 40, 0, 0, 0.6); G.cyl(7, 10, 110, 6, A[1], 60, 55, 44, 0, 0, 0.15); G.box(300, 6, 30, A[2], 40, 3, 70);
    for (let i = 0; i < 12; i++) G.box(4, 2.4, 0.5, i % 3 ? A[1] : A[0], -24 + (i % 4) * 16, 30 + Math.floor(i / 4) * 24, 46.5);
  },
  canyon(B, G, A) {
    for (let i = 0; i < 9; i++) { const x = (i - 4) * 120, h = 80 + ((i * 37) % 90); B.cyl(40 + (i % 3) * 14, 60 + (i % 2) * 20, h, 6, i % 2 ? '#3a0c08' : '#4a120a', x, h / 2, (i % 3) * 40); B.cyl(44 + (i % 3) * 14, 42 + (i % 3) * 14, 6, 6, '#5a1a0c', x, h + 3, (i % 3) * 40); }
    B.box(160, 14, 30, '#2a0806', 60, 140, 20, 0, 0, 0.04); B.cyl(22, 26, 140, 6, '#2a0806', -10, 70, 20); B.cyl(22, 26, 140, 6, '#2a0806', 130, 70, 20);
  },
  skyline(B, G, A) {
    const R = rng(33);
    for (let i = 0; i < 26; i++) {
      const x = (i - 13) * 34 + R() * 10, h = 70 + R() * 180, wdt = 20 + R() * 16;
      B.box(wdt, h, wdt, '#08060e', x, h / 2, R() * 60);
      for (let y = 10; y < h; y += 14) if (R() < 0.6) G.box(wdt + 0.4, 1.4, wdt + 0.4, R() < 0.5 ? A[1] : (R() < 0.5 ? '#4ff0ff' : A[2]), x, y, R() * 60);
      if (R() < 0.4) { B.cyl(0.8, 0.8, 40, 4, '#1a1a24', x, h + 20, 0); G.ico(2, '#ff2a2a', x, h + 41, 0); }
    }
    G.cone(18, 26, 3, A[1], -60, 210, 40, 0, 0, -Math.PI / 2); G.box(40, 6, 2, '#4ff0ff', 40, 180, 50);
  },
  docks(B, G, A) {
    for (let i = 0; i < 4; i++) { const x = (i - 1.5) * 110; for (const [dx, dz] of [[-14, -14], [14, -14], [-14, 14], [14, 14]]) B.box(4, 110, 4, '#7a5a1a', x + dx, 55, dz); B.box(36, 8, 36, '#7a5a1a', x, 112, 0); B.box(10, 8, 150, '#7a5a1a', x, 120, 40); G.ico(2.4, '#ff3a2a', x, 126, 110); }
    B.box(300, 40, 60, '#1a2028', 40, 0, 160); B.box(60, 40, 40, '#222a34', -60, 40, 160); B.cyl(6, 6, 30, 8, '#2a3038', -60, 70, 160);
  },
  peaks(B, G, A) {
    /* black teeth of a range under dirty snow, and a frozen iron dam across the pass, its crest lit by sodium lamps */
    for (let i = 0; i < 11; i++) { const x = (i - 5) * 110, h = 220 + ((i * 53) % 200); B.cone(110 + (i % 3) * 30, h, 5, '#141c26', x, h / 2, (i % 2) * 60); B.cone(46 + (i % 3) * 12, h * 0.36, 5, '#5a6a78', x, h * 0.82, (i % 2) * 60); }
    B.box(200, 100, 30, '#1a2028', 20, 50, -60); for (let i = 0; i < 6; i++) B.box(8, 104, 34, '#242a32', -70 + i * 36, 52, -60);
    for (let i = 0; i < 5; i++) B.box(10, 70, 1, '#4a2210', -52 + i * 36, 50, -44);
    for (let i = 0; i < 10; i++) B.cone(5, 40 + (i % 3) * 14, 5, '#2e5672', -70 + i * 18, 76, -44, Math.PI);
    for (let i = 0; i < 9; i++) G.box(4, 2, 1, '#ffa030', -64 + i * 18, 102, -44);
  },
  bones(B, G, A) {
    /* a titanic skeleton half buried in the flats */
    for (let i = 0; i < 9; i++) B.torus(70 - Math.abs(i - 4) * 9, 5, 4, 10, '#e8dcc0', 0, 0, i * 32 - 128, 0, Math.PI / 2, 0, Math.PI);
    B.cyl(9, 9, 300, 6, '#d8ccb0', 0, 6, 0, Math.PI / 2);
    B.ico(60, '#e8dcc0', 0, 40, 200, 1.1, 0.9, 1.4, 0.15, 1); B.ico(18, '#2a1a10', -24, 52, 270); B.ico(18, '#2a1a10', 24, 52, 270); B.cone(14, 120, 5, '#d8ccb0', -70, 120, 190, 0, 0, 0.9); B.cone(14, 120, 5, '#d8ccb0', 70, 120, 190, 0, 0, -0.9);
    for (let i = 0; i < 3; i++) { B.box(3, 60, 3, '#2a1a10', 200 + i * 60, 30, -80); G.ico(2, '#ff3a2a', 200 + i * 60, 62, -80); }
  },
  wreck(B, G, A) {
    B.box(380, 70, 60, '#3a2214', 0, 10, 0, 0.18, 0, 0.12); B.box(110, 60, 50, '#2e1a10', -90, 70, 0, 0.18, 0, 0.12); B.cyl(9, 11, 60, 8, '#2a1a10', -90, 120, 0, 0, 0, 0.12);
    B.cone(40, 70, 4, '#3a2214', 210, 18, 0, 0, Math.PI / 4, -Math.PI / 2 + 0.12);
    for (let i = 0; i < 20; i++) B.box(12, 12, 2, '#6a3010', -150 + i * 15, 20 + (i % 3) * 14, 31, 0, 0, 0.1, 0.4);
    /* the lighthouse, its beam is animated separately */
    B.cyl(10, 16, 120, 8, '#e0e0e0', 260, 60, 160); for (let y = 20; y < 120; y += 30) B.cyl(14.5 - y * 0.04, 15 - y * 0.04, 12, 8, '#c8322a', 260, y, 160); B.cyl(11, 11, 14, 8, '#1a1a1c', 260, 127, 160); G.cyl(8, 8, 12, 8, '#fff6c0', 260, 127, 160);
  },
  planet(B, G, A) {
    B.ico(620, '#3a2a8a', 0, 0, 0, 1, 1, 1, 0.25, 2); B.ico(624, '#5a4dff', 0, 120, 0, 1, 0.35, 1, 0.3, 2);
    B.torus(1020, 70, 2, 48, '#a88cff', 0, 0, 0, 1.2, 0, 0.2); B.torus(880, 24, 2, 48, '#e8e0ff', 0, 0, 0, 1.2, 0, 0.2);
    B.ico(110, '#8a8e9a', -1100, 500, 300, 1, 1, 1, 0.3, 1);
    G.box(200, 6, 6, A[1], 700, 700, -200, 0.2, 0.3, 0.1);
  },
  volcano(B, G, A) {
    B.cone(420, 340, 9, '#1a0c08', 0, 170, 0); B.cone(150, 60, 9, '#2a1008', 0, 330, 0, Math.PI); G.cyl(120, 120, 6, 9, A[1], 0, 302, 0);
    for (let i = 0; i < 6; i++) { const a = i / 6 * TAU + 0.3; G.box(10, 260, 6, i % 2 ? A[2] : A[1], Math.cos(a) * 150, 150, Math.sin(a) * 150 + 60, -Math.sin(a) * 0.9, 0, Math.cos(a) * 0.9); }
    G.cone(60, 220, 7, A[2], 0, 430, 0); for (let i = 0; i < 6; i++) B.cone(20, 160, 5, '#0e0806', -400 + i * 160, 60, -200);
  },
  carnival(B, G, A) {
    /* a derelict ferris wheel (its rim spins separately), a big top and a broken coaster */
    B.box(8, 120, 8, '#3a2a30', -20, 60, 0, 0, 0, 0.2); B.box(8, 120, 8, '#3a2a30', 20, 60, 0, 0, 0, -0.2);
    B.cyl(60, 70, 50, 10, '#a83a6a', 180, 25, 40); B.cone(76, 60, 10, '#fff0f8', 180, 80, 40); G.ico(4, A[1], 180, 112, 40);
    for (let i = 0; i < 14; i++) B.box(6, 4 + (i % 4) * 8, 6, '#5a2a40', -260 + i * 16, 20 + Math.sin(i * 0.7) * 30 + 30, -40);
    for (let i = 0; i < 13; i++) B.box(16, 3, 8, '#7a3a5a', -260 + i * 16, 50 + Math.sin(i * 0.7) * 30 + 30, -40, 0, 0, Math.cos(i * 0.7) * 0.5);
  },
  abyss(B, G, A) {
    for (let i = 0; i < 12; i++) { const x = (i - 6) * 120, h = 260 + (i * 41) % 160; B.cone(90, h, 5, '#02161e', x, h / 2, (i % 3) * 50); }
    B.cyl(40, 40, 260, 10, '#1a2a2a', 40, 30, 140, Math.PI / 2, 0, 0.3); B.box(60, 50, 80, '#142424', 40, 80, 120, 0, 0, 0.3);
    for (let i = 0; i < 10; i++) G.cyl(5, 5, 1, 8, A[1], 82, 44, 40 + i * 22, 0, 0, Math.PI / 2);
    for (let i = 0; i < 16; i++) B.torus(40 - i * 1.6, 3, 3, 8, '#c8d8d0', -200 + i * 26, 30, -120, 0, Math.PI / 2, 0, Math.PI);
    G.cyl(1.4, 1.4, 120, 4, '#2a4a4a', -340, 120, -120, 0, 0, 0.9); G.ico(10, A[0], -390, 160, -120);
  },
  citadel(B, G, A) {
    B.cone(160, 260, 8, '#2a2636', 0, -80, 0, Math.PI); B.cyl(170, 160, 30, 8, '#4a4652', 0, 60, 0);
    for (let i = 0; i < 8; i++) { const a = i / 8 * TAU; B.cyl(16, 18, 120 + (i % 3) * 40, 8, '#3e3a46', Math.cos(a) * 130, 130 + (i % 3) * 20, Math.sin(a) * 130); B.cone(20, 40, 8, '#24222a', Math.cos(a) * 130, 210 + (i % 3) * 40, Math.sin(a) * 130); G.box(6, 10, 1, A[1], Math.cos(a) * 146, 150, Math.sin(a) * 146, 0, -a + Math.PI / 2, 0); }
    B.cyl(40, 50, 280, 8, '#34303e', 0, 210, 0); B.cone(52, 100, 8, '#1e1c26', 0, 400, 0); G.ico(8, A[2], 0, 456, 0);
    for (let i = 0; i < 4; i++) { const a = i / 4 * TAU + 0.5; B.cone(50, 90, 6, '#2e2a38', Math.cos(a) * 420, -30, Math.sin(a) * 420, Math.PI); B.cyl(52, 50, 10, 6, '#4a4652', Math.cos(a) * 420, 20, Math.sin(a) * 420); for (let k = 0; k < 14; k++) B.torus(5, 1.6, 3, 6, '#3a3640', Math.cos(a) * (160 + k * 18), 50 - k * 2, Math.sin(a) * (160 + k * 18), 0, a + (k % 2) * Math.PI / 2, 0); }
  },
};

/* ---------- overhead structures: unit width beam spans x in [-1, 1] (scaled by half width + 2), legs separate ---------- */
const OVERS = {
  pipebridge(B, G, A) { B.box(2, 1.4, 1.4, '#3a3a40', 0, 8, 0); B.cyl(0.5, 0.5, 2, 8, '#8a3b12', 0, 9.2, 0.5, 0, 0, Math.PI / 2); B.box(2, 0.3, 1.5, '#f2b705', 0, 7.2, 0); G.box(0.12, 0.25, 0.6, A[1], -0.5, 7.0, 0); G.box(0.12, 0.25, 0.6, A[1], 0.5, 7.0, 0); },
  bonegate(B, G, A) { B.box(2, 1.2, 1.2, '#c8b898', 0, 9, 0); for (const x of [-0.7, 0, 0.7]) B.box(0.1, 2.4, 0.2, '#e8dcc0', x, 7.4, 0.6); G.box(0.12, 0.6, 0.1, A[2], 0, 8.8, 0.62); },
  signgantry(B, G, A) { B.box(2, 0.6, 0.6, '#2a2a34', 0, 8, 0); B.box(1.2, 2.6, 0.3, '#14141c', -0.35, 6.6, 0.2); G.cone(0.14, 1.6, 3, A[1], -0.35, 6.6, 0.4, 0, 0, -Math.PI / 2); G.box(0.5, 0.4, 0.1, '#4ff0ff', 0.45, 6.9, 0.3); G.box(2, 0.12, 0.1, A[2], 0, 8.35, 0.32); },
  gantrycrane(B, G, A) { B.box(2, 1.8, 2.2, '#c8a02a', 0, 12, 0); B.box(0.18, 1.2, 1.6, '#3a3a40', 0.3, 10.6, 0); B.box(0.02, 4, 0.1, '#111', 0.3, 8, 0); B.box(0.26, 0.8, 1.2, '#f2b705', 0.3, 6, 0); G.ico(0.04, '#ff3a2a', -0.95, 13, 0); },
  icearch(B, G, A) { B.box(2, 1.4, 1.4, '#1c2026', 0, 8.6, 0, 0, 0, 0, 0.12); B.box(2, 0.3, 1.5, '#7a8a98', 0, 9.4, 0); B.box(2, 0.22, 1.46, '#b3200f', 0, 7.95, 0); for (let i = 0; i < 7; i++) B.cone(0.05, 1.4 + (i % 3) * 0.6, 4, '#4a7a9a', -0.9 + i * 0.3, 7.1, 0.3, Math.PI, 0, 0, 0.05); G.box(0.3, 0.16, 0.5, '#ffb040', -0.5, 7.75, -0.2); G.box(0.3, 0.16, 0.5, '#ffb040', 0.5, 7.75, -0.2); },
  ribarch(B, G, A) { B.torus(1, 0.06, 4, 12, '#e8dcc0', 0, 0, 0, 0, 0, 0, Math.PI); },
  shipribs(B, G, A) { B.torus(1, 0.06, 4, 12, '#4a2a1a', 0, 0, 0, 0, 0, 0, Math.PI); B.box(0.2, 0.3, 1, '#2a1a10', 0, 1, 0); },
  ringgate(B, G, A) { B.torus(1, 0.07, 4, 16, '#6b727e', 0, 0, 0, 0, 0, 0, TAU); G.torus(1.0, 0.025, 3, 16, A[1], 0, 0, 0.12, 0, 0, 0, TAU); },
  chainarch(B, G, A) { B.box(2, 1, 1, '#1a1416', 0, 9, 0); for (let i = 0; i < 9; i++) B.torus(0.05, 0.015, 3, 6, '#3a3034', -0.8 + i * 0.2, 8.1 - Math.sin(i / 8 * Math.PI) * 1.2, 0, 0, i % 2 ? Math.PI / 2 : 0, 0); G.box(1.8, 0.12, 0.1, A[2], 0, 8.45, 0.52); },
  bulbarch(B, G, A) { B.torus(1, 0.05, 4, 12, '#5a2a40', 0, 0, 0, 0, 0, 0, Math.PI); for (let i = 0; i <= 10; i++) { const a = i / 10 * Math.PI; G.ico(0.05, i % 2 ? '#ffe27a' : '#8cff3a', Math.cos(a), Math.sin(a), 0.06); } },
  tuberib(B, G, A) { B.torus(1, 0.05, 4, 12, '#264040', 0, 0, 0, 0, 0, 0, Math.PI); G.torus(1, 0.012, 3, 12, A[1], 0, 0, 0.06, 0, 0, 0, Math.PI); },
  ironarch(B, G, A) { B.box(2, 1.4, 1.2, '#3e3a46', 0, 9, 0); for (let i = 0; i < 6; i++) B.box(0.12, 0.7, 1.3, '#4a4652', -0.85 + i * 0.34, 10, 0); G.box(0.3, 0.5, 0.1, A[1], 0, 8.9, 0.62); },
};
const ARCH_OVERS = { ribarch: 1, shipribs: 1, ringgate: 1, bulbarch: 1, tuberib: 1 };

/* ---------- props: one mesh per track prop. Built per look and shared ---------- */
function propGeo(T, look, w, A) {
  const B = Kit(T), thing = look.split('.')[1] || look;
  const steel = '#6b727e', gun = '#2c3039', rust = '#8a3b12', haz = '#f2b705';
  switch (thing) {
    case 'scrapbox': /* original scrap box: a welded steel cage around corrugated rust panels, a hazard band and corner caps */
      B.box(1.3, 1.3, 1.3, rust, 0, 0.7, 0, 0, 0, 0, 0.35);
      for (const [x, z] of [[-0.66, -0.66], [0.66, -0.66], [-0.66, 0.66], [0.66, 0.66]]) B.box(0.14, 1.44, 0.14, gun, x, 0.72, z);
      for (const y of [0.04, 1.36]) { B.box(1.46, 0.14, 0.14, gun, 0, y, 0.66); B.box(1.46, 0.14, 0.14, gun, 0, y, -0.66); B.box(0.14, 0.14, 1.46, gun, 0.66, y, 0); B.box(0.14, 0.14, 1.46, gun, -0.66, y, 0); }
      B.box(1.34, 0.22, 1.34, haz, 0, 0.7, 0, 0, 0, 0, 0.1); B.box(0.1, 1.2, 1.34, '#5a2a10', 0, 0.7, 0);
      break;
    case 'cone': B.cone(0.42, 1.0, 6, w === 1 ? '#ff5a1a' : A[2], 0, 0.55, 0); B.box(0.8, 0.1, 0.8, '#1a1c21', 0, 0.05, 0); B.cyl(0.26, 0.31, 0.16, 6, '#f4f6fa', 0, 0.6, 0); break;
    case 'nitro': B.cyl(0.42, 0.42, 1.2, 8, '#3aff6a', 0, 1.1, 0, 0, 0, 0, 0.05); B.cyl(0.3, 0.42, 0.3, 8, '#c7ccd5', 0, 1.85, 0); B.cyl(0.42, 0.3, 0.3, 8, '#c7ccd5', 0, 0.35, 0); B.cyl(0.1, 0.1, 0.4, 6, '#f4f6fa', 0, 2.2, 0); B.box(0.86, 0.14, 0.86, haz, 0, 1.1, 0, 0, 0.785, 0); break;
    case 'mine': B.ico(0.55, '#1a1c21', 0, 0.5, 0, 1, 0.7, 1); for (let i = 0; i < 6; i++) { const a = i / 6 * TAU; B.cone(0.12, 0.5, 4, steel, Math.cos(a) * 0.55, 0.55, Math.sin(a) * 0.55, Math.PI / 2, 0, -a + Math.PI / 2); } B.cyl(0.14, 0.14, 0.2, 6, '#ff2a2a', 0, 0.92, 0); break;
    case 'pad': B.box(4, 0.08, 6, '#1a1c21', 0, 0.04, 0); B.box(4.2, 0.06, 0.3, haz, 0, 0.06, 2.9); B.box(4.2, 0.06, 0.3, haz, 0, 0.06, -2.9); break;
    case 'jump': B.box(4, 0.6, 3, '#2c3039', 0, 0.3, 0, -0.18); B.box(4.1, 0.1, 0.4, haz, 0, 0.66, 1.2, -0.18); break;
    /* hard obstacles, a few archetypes in each world's palette */
    case 'wreck': case 'frozenwreck': case 'subwreck': B.box(3.4, 1.0, 1.8, thing === 'frozenwreck' ? '#6a3a24' : thing === 'subwreck' ? '#2a4040' : '#7a2a1a', 0, 0.7, 0, 0, 0, 0.12); B.box(1.8, 0.7, 1.6, '#2a2c30', -0.2, 1.5, 0, 0, 0, 0.12); B.cyl(0.4, 0.4, 0.3, 8, '#111', 1.1, 0.4, 0.95, Math.PI / 2); if (thing === 'frozenwreck') B.box(3.6, 0.3, 2, '#b8cad8', 0, 1.9, 0); break;
    case 'girder': case 'caneRail': case 'panel': for (let i = 0; i < 3; i++) B.box(2.6, 0.4, 0.4, thing === 'caneRail' ? (i % 2 ? '#c8322a' : '#fff0f8') : thing === 'panel' ? '#2a3a8a' : (i % 2 ? rust : steel), 0, 0.2 + i * 0.42, (i - 1) * 0.15, 0, i * 0.2, 0); B.box(2.7, 0.12, 0.5, haz, 0, 1.3, 0); break;
    case 'slagdrum': case 'drum': case 'crucible': case 'gumball': case 'tanker': B.cyl(0.75, 0.75, 1.8, 8, thing === 'gumball' ? '#c84f8a' : thing === 'drum' ? '#2a5a5a' : '#3a3430', 0, 0.9, 0); B.cyl(0.78, 0.78, 0.18, 8, haz, 0, 1.2, 0); B.cyl(0.7, 0.7, 0.06, 8, thing === 'slagdrum' || thing === 'crucible' ? '#ffb02e' : steel, 0, 1.82, 0); break;
    case 'jersey': case 'bollard': case 'ironblock': case 'iceblock': case 'container': case 'crateStack': case 'hullplate':
      B.box(2.2, 1.1, 1.0, { jersey: '#8a8e94', bollard: '#1a1c20', ironblock: '#4a4652', iceblock: '#5aa4d0', container: '#a83a22', crateStack: '#5a4a32', hullplate: '#5a3420' }[thing], 0, 0.55, 0, 0, 0, 0, 0.2);
      B.box(1.6, 0.3, 0.9, thing === 'iceblock' ? '#b8d8ea' : '#6a6e74', 0, 1.25, 0); B.box(2.24, 0.16, 1.04, thing === 'jersey' ? A[1] : haz, 0, 0.3, 0);
      break;
    case 'hydrant': B.cyl(0.4, 0.5, 1.2, 8, '#c8322a', 0, 0.6, 0); B.cyl(0.5, 0.5, 0.2, 8, '#a8221a', 0, 1.25, 0); B.cyl(0.15, 0.15, 1.2, 6, '#c8322a', 0, 0.7, 0, Math.PI / 2); break;
    case 'boulder': case 'slagheap': case 'rubble': case 'snowboulder': case 'sandrock': case 'blackrock': case 'asteroid': case 'lavarock': case 'jawbreaker': case 'seastone': case 'floatrock': case 'obsidian': case 'clam': case 'buoy':
      B.dodeca(1.2, { boulder: '#7a2c12', slagheap: '#2a2220', rubble: '#3a3a44', snowboulder: '#a8b8c6', sandrock: '#c08c3c', blackrock: '#1a1a1c', asteroid: '#5a5e6a', lavarock: '#1a1214', jawbreaker: '#c84fa0', seastone: '#1a3030', floatrock: '#4a4652', obsidian: '#0e0c0e', clam: '#3a3a5a', buoy: '#c8322a' }[thing] || '#555', 0, 0.9, 0, 1.1, 0.85, 1.0, 0.3);
      if (thing === 'jawbreaker') B.dodeca(1.22, '#8cff3a', 0, 0.9, 0, 1.08, 0.3, 1.0);
      if (thing === 'lavarock' || thing === 'obsidian') B.box(0.12, 1.2, 0.12, '#ff5a1a', 0.5, 1, 0.9, 0, 0, 0.4);
      break;
    case 'deadtree': case 'totem': case 'cactus': case 'pylon': case 'bone': case 'icespike': case 'spire': case 'coral': case 'statue': case 'chainpost': case 'satellite': case 'debris': case 'anchor':
      if (thing === 'cactus') { B.cyl(0.5, 0.6, 2.8, 7, '#4a6a2a', 0, 1.4, 0); B.cyl(0.3, 0.3, 1.2, 6, '#4a6a2a', 0.8, 1.8, 0); }
      else if (thing === 'icespike' || thing === 'spire' || thing === 'bone') B.cone(0.8, 3, 5, { icespike: '#5aa4d0', spire: '#121012', bone: '#e8dcc0' }[thing], 0, 1.5, 0, 0.1, 0, 0.1);
      else if (thing === 'satellite' || thing === 'debris') { B.box(1.4, 1.4, 1.4, '#8a8e9a', 0, 0.8, 0, 0.3, 0.4, 0.2); B.box(3, 0.1, 0.9, '#2a3a8a', 0, 1.2, 0, 0.2, 0.3, 0.1); }
      else if (thing === 'anchor') { B.box(0.4, 2.6, 0.4, '#2a2a2e', 0, 1.3, 0); B.torus(1, 0.2, 4, 8, '#2a2a2e', 0, 0.6, 0, 0, 0, Math.PI, Math.PI); }
      else { B.box(0.9, 2.6, 0.9, { deadtree: '#1a0c08', totem: '#5a2410', pylon: steel, coral: '#5a2a4a', statue: '#5a5468', chainpost: '#1a1416' }[thing] || steel, 0, 1.3, 0); B.box(1.4, 0.3, 1.4, haz, 0, 0.15, 0); B.ico(0.5, thing === 'coral' ? '#ff4fd8' : '#3a3a40', 0, 2.8, 0); }
      break;
    default: B.box(1.2, 1.2, 1.2, rust, 0, 0.6, 0);
  }
  return B.build();
}
const PATCH_THINGS = { ice: 1, slick: 1, tarpit: 1, puddle: 1, sheet: 1, sandtrap: 1, tidepool: 1, coolant: 1, cinderslick: 1, taffy: 1, ink: 1 };

/* a chunky 5-point star, gold with an orange rim, standing up */
function starGeo(T) {
  const s = new T.Shape();
  for (let i = 0; i < 10; i++) { const a = Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? 0.38 : 0.9; if (i) s.lineTo(Math.cos(a) * r, Math.sin(a) * r); else s.moveTo(Math.cos(a) * r, Math.sin(a) * r); }
  const g = new T.ExtrudeGeometry(s, { depth: 0.22, bevelEnabled: true, bevelThickness: 0.1, bevelSize: 0.08, bevelSegments: 1 });
  g.translate(0, 0, -0.11);
  return g;
}

/* ---------- the road and everything that follows the centreline ---------- */
function crossH(track, i, k, cols) {
  /* the sim's cross-section (sim.js crossOff): halfpipe lips rise as hp * x^2 past 40 percent of the half
     width, and rumble strips add amp * (1 - cos(2 pi s / wave)) / 2. Read straight from the Track arrays. */
  let h = 0;
  const hp = track.hp ? track.hp[i] : 0;
  if (hp > 0.01) { const d = Math.abs(k / (cols - 1) * 2 - 1), x = Math.min(1.15, Math.max(0, (d - 0.4) / 0.6)); h += hp * x * x; }
  const ra = track.rbA ? track.rbA[i] : 0;
  if (ra > 0.001) h += ra * 0.5 * (1 - Math.cos(TAU * i * track.step / track.rbW[i]));
  return h;
}
/* the samples the meshes use: every second metre (a 2 m chord on a 40 m bend is off by 1 cm), plus both
   sides of every flag or piece change, and every metre of ramps and rumble strips (their stripes are 1.5 m) */
function sampleKeys(track, spec) {
  const n = track.n, TF = VROOM.contracts.TF, M = TF.GAP | TF.WALL_L | TF.WALL_R | TF.COVER, keep = new Uint8Array(n), out = [];
  for (let i = 0; i < n; i++) {
    const p = spec.pieces[track.piece[i]];
    if (i % 2 === 0 || i === n - 1 || (track.flags[i] & TF.RAMP) || (p && p.type === 'rumble')) keep[i] = 1;
    if (i > 0 && (((track.flags[i] ^ track.flags[i - 1]) & M) || track.piece[i] !== track.piece[i - 1])) { keep[i] = 1; keep[i - 1] = 1; }
  }
  for (let i = 0; i < n; i++) if (keep[i]) out.push(i);
  return out;
}
function buildRoad(T, track, spec, L, mats, out, keys) {
  const TF = VROOM.contracts.TF, cols = 7, pieces = spec.pieces, nk = keys.length;
  const pos = new Float32Array(nk * cols * 3), nor = new Float32Array(nk * cols * 3), uv = new Float32Array(nk * cols * 2), col = new Float32Array(nk * cols * 3);
  const idx = [], c0 = new T.Color(), haz = new T.Color('#f2b705'), dark = new T.Color('#1a1c21'), molten = new T.Color(accent(spec.world)[2]), white = new T.Color(1, 1, 1);
  for (let j = 0; j < nk; j++) {
    const i = keys[j], hw = track.hw[i], P = pieces[track.piece[i]], fl = track.flags[i], s = i * track.step;
    for (let k = 0; k < cols; k++) {
      const d = (k / (cols - 1) * 2 - 1) * hw, h = crossH(track, i, k, cols), o = (j * cols + k) * 3;
      pos[o] = track.px[i] + track.rx[i] * d + track.ux[i] * h; pos[o + 1] = track.py[i] + track.ry[i] * d + track.uy[i] * h; pos[o + 2] = track.pz[i] + track.rz[i] * d + track.uz[i] * h;
      nor[o] = track.ux[i]; nor[o + 1] = track.uy[i]; nor[o + 2] = track.uz[i];
      uv[(j * cols + k) * 2] = k / (cols - 1); uv[(j * cols + k) * 2 + 1] = s / ROAD_TILE;
      c0.setRGB(1, 1, 1);
      if (fl & TF.RAMP) c0.copy(Math.floor(s / 1.5) % 2 ? haz : dark).lerp(white, 0.15);
      if (P && P.type === 'rumble' && Math.floor(s / ((P.wave || 4) / 2)) % 2) c0.setRGB(0.72, 0.72, 0.72);
      if (P && P.surf && P.surf !== track.world.surf && SURF_TINT[P.surf]) c0.multiply(spec.world === 5 && P.surf === 'ice' ? BLACK_ICE : SURF_TINT[P.surf]);
      if (track.hp && track.hp[i] > 0.5 && (k === 0 || k === cols - 1)) c0.copy(molten);
      if (track.mid && track.mid[i] > 0.3 && k === (cols - 1) / 2) c0.multiplyScalar(0.35);
      col[o] = c0.r; col[o + 1] = c0.g; col[o + 2] = c0.b;
    }
    if (j > 0 && !(track.flags[keys[j - 1]] & TF.GAP) && !(fl & TF.GAP)) for (let k = 0; k < cols - 1; k++) {
      const a = (j - 1) * cols + k, b = a + 1, c = j * cols + k, d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
  }
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.BufferAttribute(pos, 3)); g.setAttribute('normal', new T.BufferAttribute(nor, 3));
  g.setAttribute('uv', new T.BufferAttribute(uv, 2)); g.setAttribute('color', new T.BufferAttribute(col, 3));
  g.setIndex(idx); g.computeBoundingSphere();
  const road = new T.Mesh(g, mats.road); road.receiveShadow = true;
  out.push(road);
  return road;
}
const SURF_TINT_HEX = { ice: '#cfefff', snow: '#f4fbff', steel: '#b8bcc4', asphalt: '#8a8a90', dirt: '#c08060', sand: '#f0d090', mud: '#7a5a3a', glass: '#80e0f0', cloud: '#e8e0ff', sugar: '#f0b0d0', oil: '#555', water: '#80b0d0', lava: '#ff8040' };
const SURF_TINT = {};
let BLACK_ICE = null;   /* frost's ice runs read blue-black against its iron deck */

/* slab skirts, underside, walls, kerb posts: one vertex coloured geometry plus one textured wall geometry */
function buildEdges(T, track, spec, L, mats, out, opts, keys) {
  const TF = VROOM.contracts.TF;
  const sk = [], skc = [], wp = [], wu = [];
  const slab = new T.Color(L.bank[0]).multiplyScalar(0.7), under = new T.Color(L.bank[1]).multiplyScalar(0.5);
  const v = (arr, i, d, h) => { arr.push(track.px[i] + track.rx[i] * d + track.ux[i] * h, track.py[i] + track.ry[i] * d + track.uy[i] * h, track.pz[i] + track.rz[i] * d + track.uz[i] * h); };
  const quad = (arr, carr, c, a0, a1, b0, b1) => { arr.push(...a0, ...b0, ...a1, ...a1, ...b0, ...b1); for (let k = 0; k < 6; k++) carr.push(c.r, c.g, c.b); };
  const P = (i, d, h) => { const o = []; v(o, i, d, h); return o; };
  const depth = opts.slab;
  for (let j = 1; j < keys.length; j++) {
    const i = keys[j], ip = keys[j - 1];
    if ((track.flags[i] & TF.GAP) || (track.flags[ip] & TF.GAP)) continue;
    const h0 = track.hw[ip], h1 = track.hw[i];
    const e0 = crossH(track, ip, 0, 7), e1 = crossH(track, i, 0, 7);
    /* skirts down both edges and the underside */
    quad(sk, skc, slab, P(ip, -h0, e0), P(i, -h1, e1), P(ip, -h0 - 0.3, -depth), P(i, -h1 - 0.3, -depth));
    quad(sk, skc, slab, P(i, h1, e1), P(ip, h0, e0), P(i, h1 + 0.3, -depth), P(ip, h0 + 0.3, -depth));
    quad(sk, skc, under, P(i, -h1 - 0.3, -depth), P(ip, -h0 - 0.3, -depth), P(i, h1 + 0.3, -depth), P(ip, h0 + 0.3, -depth));
    /* walls: the profile inner foot, inner top, outer top, outer foot */
    if (!opts.walls) continue;
    for (const side of [-1, 1]) {
      const bit = side < 0 ? TF.WALL_L : TF.WALL_R;
      if (!(track.flags[i] & bit) || !(track.flags[ip] & bit)) continue;
      const wh = opts.wallH, th = opts.wallT, s0 = ip * track.step / 6, s1 = i * track.step / 6;
      const prof = [[0, 0, 1], [0, wh, 0.6], [th, wh, 0.4], [th, -1.2, 0]];
      for (let k = 0; k < 3; k++) {
        const [da, ha, va] = prof[k], [db, hb, vb] = prof[k + 1];
        const A0 = P(ip, side * (h0 + da), ha + e0), A1 = P(i, side * (h1 + da), ha + e1), B0 = P(ip, side * (h0 + db), hb + e0), B1 = P(i, side * (h1 + db), hb + e1);
        const tri = side < 0 ? [A0, A1, B0, A1, B1, B0] : [A0, B0, A1, A1, B0, B1];
        const tuv = side < 0 ? [[s0, va], [s1, va], [s0, vb], [s1, va], [s1, vb], [s0, vb]] : [[s0, va], [s0, vb], [s1, va], [s1, va], [s0, vb], [s1, vb]];
        for (let q = 0; q < 6; q++) { wp.push(...tri[q]); wu.push(tuv[q][0], tuv[q][1]); }
      }
    }
  }
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(sk, 3)); g.setAttribute('color', new T.Float32BufferAttribute(skc, 3)); g.computeVertexNormals();
  const m = new T.Mesh(g, mats.vc); out.push(m);
  if (wp.length) {
    const wg = new T.BufferGeometry();
    wg.setAttribute('position', new T.Float32BufferAttribute(wp, 3)); wg.setAttribute('uv', new T.Float32BufferAttribute(wu, 2)); wg.computeVertexNormals();
    const wm = new T.Mesh(wg, mats.wall); wm.receiveShadow = true; out.push(wm);
  }
}

/* embankments from the road edge down to the world floor, every 3 m. Wider where the road is higher,
   narrowed on the inside of bends so nothing folds through the road. Skipped on bridges, gaps, loops. */
function buildTerrain(T, track, spec, L, mats, out, floorY) {
  const n = track.n, TF = VROOM.contracts.TF, pieces = spec.pieces, stride = 3;
  const pos = [], colA = [], c = [new T.Color(L.bank[0]), new T.Color(L.bank[1]), new T.Color(L.bank[2])], tmp = new T.Color();
  const open = i => {
    const p = pieces[track.piece[i]];
    return (track.flags[i] & (TF.GAP | TF.LOOP)) || (p && p.deco === 'bridge') || track.uy[i] < 0.85;
  };
  /* signed curvature per sample: + turning right */
  const kap = new Float32Array(n);
  for (let i = 1; i < n - 1; i++) { const cx = track.tz[i - 1] * track.tx[i + 1] - track.tx[i - 1] * track.tz[i + 1]; kap[i] = -cx / (2 * track.step); }
  const smooth = new Float32Array(n);
  for (let i = 0; i < n; i++) { let a = 0, m = 0; for (let j = Math.max(0, i - 8); j <= Math.min(n - 1, i + 8); j++) { a += kap[j]; m++; } smooth[i] = a / m; }
  const ring = (i, side) => {
    const hw = track.hw[i] + 0.6, rx = track.rx[i], rz = track.rz[i], rl = Math.hypot(rx, rz) || 1, hx = rx / rl, hz = rz / rl;
    const x0 = track.px[i] + rx * side * hw, y0 = track.py[i] + track.ry[i] * side * hw - 0.25, z0 = track.pz[i] + rz * side * hw;
    const drop = Math.max(0, y0 - floorY);
    let wdt = Math.min(110, 10 + drop * 1.3);
    const k = smooth[i] * side;   /* > 0 means this side is the inside of the bend */
    if (k > 0.0005) wdt = Math.min(wdt, Math.max(2, 0.7 / k - hw));
    const sh = 3 + hash(i, side, 5) * 2, j = hash(i, side, 9);
    return [[x0, y0, z0], [x0 + hx * side * sh, y0 - 0.3 - j * 0.6, z0 + hz * side * sh], [x0 + hx * side * (sh + wdt * 0.5), Math.max(floorY, y0 - drop * 0.55) + (j - 0.5) * 2, z0 + hz * side * (sh + wdt * 0.5)], [x0 + hx * side * (sh + wdt), floorY - 0.5, z0 + hz * side * (sh + wdt)]];
  };
  let prev = null;
  for (let i = 0; i < n; i += stride) {
    const ii = Math.min(i, n - 1);
    if (open(ii)) { prev = null; continue; }
    const cur = [ring(ii, -1), ring(ii, 1)];
    if (prev) for (let s = 0; s < 2; s++) for (let k = 0; k < 3; k++) {
      const a0 = prev[s][k], a1 = prev[s][k + 1], b0 = cur[s][k], b1 = cur[s][k + 1];
      const tri = s === 0 ? [a0, b0, a1, a1, b0, b1] : [a0, a1, b0, a1, b1, b0];
      for (let q = 0; q < 6; q++) { pos.push(...tri[q]); tmp.copy(c[Math.min(2, k)]).multiplyScalar(0.8 + 0.35 * hash(ii + q, k, s)); colA.push(tmp.r, tmp.g, tmp.b); }
    }
    prev = cur;
  }
  if (!pos.length) return;
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new T.Float32BufferAttribute(colA, 3)); g.computeVertexNormals();
  const m = new T.Mesh(g, mats.vc); m.receiveShadow = true; out.push(m);
}

/* ---------- world building ---------- */
function makeMats(ctx, w, L) {
  const T = ctx.THREE, A = accent(w);
  const roadMap = tex(ctx, 'road' + w, 512, 512, paintRoad(L.road, L, false));
  const roadEm = EMISSIVE_ROADS[L.road] ? tex(ctx, 'roadE' + w, 512, 512, paintRoad(L.road, L, true)) : null;
  const wallMap = tex(ctx, 'wall' + w, 256, 128, paintWall(L.wall, w));
  const wallEm = GLOW_WALLS[L.wall] ? tex(ctx, 'wallE' + w, 256, 128, paintWallGlow(L.wall, w)) : null;
  const wet = L.road === 'wet' || L.road === 'pier' || L.road === 'glass';
  const mats = {
    road: new T.MeshStandardMaterial({ map: roadMap, vertexColors: true, roughness: wet ? 0.32 : L.road === 'frostiron' ? 0.5 : 0.82, metalness: L.road === 'plate' || L.road === 'hull' || L.road === 'iron' || L.road === 'frostiron' ? 0.45 : 0.08,
      emissiveMap: roadEm, emissive: roadEm ? new T.Color(1, 1, 1) : new T.Color(0, 0, 0), emissiveIntensity: roadEm ? 1.4 : 0, side: T.DoubleSide }),
    wall: new T.MeshStandardMaterial({ map: wallMap, roughness: 0.8, metalness: 0.2, emissiveMap: wallEm, emissive: wallEm ? new T.Color(1, 1, 1) : new T.Color(0, 0, 0), emissiveIntensity: wallEm ? 1.2 : 0,
      side: T.DoubleSide, transparent: L.wall === 'glass', opacity: L.wall === 'glass' ? 0.7 : 1, flatShading: true }),
    vc: new T.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.9, metalness: 0.05, side: T.DoubleSide }),
    set: new T.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.78, metalness: 0.18 }),
    glow: new T.MeshBasicMaterial({ vertexColors: true, toneMapped: false }),
    far: new T.MeshBasicMaterial({ vertexColors: true, fog: false }),
    farGlow: new T.MeshBasicMaterial({ vertexColors: true, fog: false, toneMapped: false }),
    prop: new T.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.6, metalness: 0.35 }),
    star: new T.MeshStandardMaterial({ color: 0xffc820, emissive: 0xff7a00, emissiveIntensity: 0.65, metalness: 0.6, roughness: 0.3, flatShading: true }),
    nitroGlow: new T.MeshBasicMaterial({ color: 0x8cff3a, toneMapped: false, transparent: true, opacity: 0.35, depthWrite: false, blending: T.AdditiveBlending }),
    pad: new T.MeshBasicMaterial({ map: tex(ctx, 'chev', 128, 256, paintChevron(A[1])), toneMapped: false, transparent: true, blending: T.AdditiveBlending, depthWrite: false }),
    checker: new T.MeshStandardMaterial({ map: tex(ctx, 'checker', 256, 64, paintChecker), roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -2 }),
    hazard: new T.MeshStandardMaterial({ map: tex(ctx, 'hazard', 256, 64, paintHazard), roughness: 0.7, metalness: 0.2, polygonOffset: true, polygonOffsetFactor: -2 }),
    lampOff: new T.MeshBasicMaterial({ color: new T.Color(A[2]), toneMapped: false }),
    lampOn: new T.MeshBasicMaterial({ color: 0x8cff3a, toneMapped: false }),
    lampRed: new T.MeshBasicMaterial({ color: 0xff2a1a, toneMapped: false }),
  };
  mats.wall.map.repeat.set(1, 1);
  return mats;
}

function sky(T, L, w, list) {
  const g = new T.SphereGeometry(2600, 32, 16), p = g.attributes.position, c = new Float32Array(p.count * 3);
  const st = L.sky.map(x => new T.Color(x)), tmp = new T.Color();
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i) / 2600;
    if (y > 0.35) tmp.copy(st[1]).lerp(st[0], Math.min(1, (y - 0.35) / 0.65));
    else if (y > 0.04) tmp.copy(st[2]).lerp(st[1], (y - 0.04) / 0.31);
    else if (y > -0.06) tmp.copy(st[3]).lerp(st[2], (y + 0.06) / 0.1);
    else tmp.copy(st[3]).lerp(new T.Color(L.fog[0]), Math.min(1, (-0.06 - y) * 4));
    c[i * 3] = tmp.r; c[i * 3 + 1] = tmp.g; c[i * 3 + 2] = tmp.b;
  }
  g.setAttribute('color', new T.BufferAttribute(c, 3));
  const m = new T.MeshBasicMaterial({ vertexColors: true, side: T.BackSide, fog: false, depthWrite: false });
  list.push(g, m);
  const mesh = new T.Mesh(g, m); mesh.renderOrder = -10;
  return mesh;
}

function buildWorld(ctx, track, spec, opts = {}) {
  const T = ctx.THREE, w = spec.world, L = LOOK[w] || LOOK[1], A = accent(w), TF = VROOM.contracts.TF;
  const scene = new T.Scene(), disposables = [], low = ctx.quality === 'low', rm = !!ctx.reducedMotion;
  const R = rng(spec.seed || w);
  for (const k in SURF_TINT_HEX) SURF_TINT[k] = SURF_TINT[k] || new T.Color(SURF_TINT_HEX[k]);
  BLACK_ICE = BLACK_ICE || new T.Color('#6a9cd4');
  const mats = makeMats(ctx, w, L);
  for (const k in mats) disposables.push(mats[k]);

  /* fog and lights */
  const fogC = new T.Color(L.fog[0]);
  scene.background = fogC.clone();
  scene.fog = new T.Fog(fogC, L.fog[1], opts.fogFar || L.fog[2]);
  const hemi = new T.HemisphereLight(new T.Color(L.hemi[0]), new T.Color(L.hemi[1]), L.hemi[2]);
  scene.add(hemi);
  const [sunC, el, az] = L.sun, sunDir = new T.Vector3(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az));
  const keyDir = sunDir.clone(); keyDir.y = Math.max(keyDir.y, 0.45); keyDir.normalize();
  const key = new T.DirectionalLight(new T.Color(L.key[0]), L.key[1]);
  key.position.copy(keyDir).multiplyScalar(120); scene.add(key); scene.add(key.target);
  const shadows = !low && ctx.renderer && !opts.noShadow;
  if (shadows) {
    ctx.renderer.shadowMap.enabled = true; ctx.renderer.shadowMap.type = T.PCFShadowMap;
    key.castShadow = true; key.shadow.mapSize.set(1024, 1024);
    const sc = key.shadow.camera; sc.left = -45; sc.right = 45; sc.top = 45; sc.bottom = -45; sc.near = 10; sc.far = 320; key.shadow.bias = -0.0008;
  }
  const rim = new T.DirectionalLight(new T.Color(L.rim[0]), L.rim[1]);
  rim.position.set(-keyDir.x * 100, 40, -keyDir.z * 100); scene.add(rim);

  /* sky: dome, sun or moon, stars, clouds, aurora. The group follows the camera */
  const skyG = new T.Group(); skyG.add(sky(T, L, w, disposables)); scene.add(skyG);
  const dotTex = tex(ctx, 'dot', 64, 64, paintDot);
  const sunMat = new T.MeshBasicMaterial({ color: new T.Color(sunC), fog: false, toneMapped: false, depthWrite: false });
  const haloMat = new T.MeshBasicMaterial({ map: dotTex, color: new T.Color(sunC), fog: false, toneMapped: false, transparent: true, opacity: L.sun[4] * 0.6, depthWrite: false, blending: T.AdditiveBlending });
  const sunGeo = new T.CircleGeometry(1, 24), sunMesh = new T.Mesh(sunGeo, sunMat), halo = new T.Mesh(sunGeo, haloMat);
  disposables.push(sunMat, haloMat, sunGeo);
  sunMesh.position.copy(sunDir).multiplyScalar(2300); sunMesh.scale.setScalar(L.sun[3]); sunMesh.lookAt(0, 0, 0); sunMesh.renderOrder = -9;
  halo.position.copy(sunDir).multiplyScalar(2280); halo.scale.setScalar(L.sun[3] * 5.5); halo.lookAt(0, 0, 0); halo.renderOrder = -8;
  if (w !== 11) skyG.add(sunMesh); skyG.add(halo);
  if (L.stars) {
    const n = low ? L.stars >> 1 : L.stars, sp = new Float32Array(n * 3), sr = rng(w * 7);
    for (let i = 0; i < n; i++) { const a = sr() * TAU, y = w === 8 ? sr() * 2 - 1 : 0.08 + sr() * 0.92, r = Math.sqrt(1 - y * y); sp[i * 3] = Math.cos(a) * r * 2400; sp[i * 3 + 1] = y * 2400; sp[i * 3 + 2] = Math.sin(a) * r * 2400; }
    const g = new T.BufferGeometry(); g.setAttribute('position', new T.BufferAttribute(sp, 3));
    const m = new T.PointsMaterial({ color: 0xffffff, size: 2.2, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.9, depthWrite: false });
    const pts = new T.Points(g, m); pts.renderOrder = -9; skyG.add(pts); disposables.push(g, m);
  }
  if (L.clouds[1]) {
    /* banks of chunky puffs, tinted halfway to the sky behind them so they sit in the air */
    const K = Kit(T), cr = rng(w * 3), cc = new T.Color(L.clouds[0]).lerp(new T.Color(L.sky[1]), 0.35);
    for (let i = 0; i < L.clouds[1]; i++) {
      const a = cr() * TAU, d = 1600 + cr() * 600, y = (w === 12 ? -160 + cr() * 460 : 120 + cr() * 380), ca = Math.cos(a), sa = Math.sin(a);
      for (let k = 0; k < 4; k++) {
        const off = (k - 1.5) * 70 + cr() * 30, r = 50 + cr() * 50 * (k === 1 || k === 2 ? 1.6 : 1);
        K.ico(r, cc, ca * d - sa * off, y + (k === 1 || k === 2 ? 25 : 0), sa * d + ca * off, 1.3, 0.62, 1.3, 0.12, 1);
      }
    }
    const g = K.build(), m = new T.Mesh(g, mats.far); m.renderOrder = -7; skyG.add(m); disposables.push(g);
  }
  let aurora = null;
  if (w === 8) {
    const K = Kit(T);
    for (let i = 0; i < 5; i++) K.box(900, 160 + i * 30, 1, i % 2 ? A[1] : A[2], (i - 2) * 300, 640 + i * 40, -1800 + i * 90, 0.2, i * 0.4 - 0.8, 0.05, 0);
    const g = K.build(), m = new T.MeshBasicMaterial({ vertexColors: true, fog: false, transparent: true, opacity: 0.22, depthWrite: false, blending: T.AdditiveBlending, side: T.DoubleSide, toneMapped: false });
    aurora = new T.Mesh(g, m); aurora.renderOrder = -6; skyG.add(aurora); disposables.push(g, m);
  }

  /* the course */
  const statics = [];
  let minY = Infinity, maxY = -Infinity, cx = 0, cz = 0;
  for (let i = 0; i < track.n; i++) { minY = Math.min(minY, track.py[i]); maxY = Math.max(maxY, track.py[i]); cx += track.px[i]; cz += track.pz[i]; }
  cx /= track.n; cz /= track.n;
  let rad = 0;
  for (let i = 0; i < track.n; i += 8) rad = Math.max(rad, Math.hypot(track.px[i] - cx, track.pz[i] - cz));
  const floorY = minY - 4, hasFloor = L.floor !== 'none' && L.floor !== 'cloud';
  const keys = sampleKeys(track, spec);
  buildRoad(T, track, spec, L, mats, statics, keys);
  const wallH = { scrap: 1.6, rock: 1.4, jersey: 1.1, hazard: 1.1, snowbank: 1.3, frostiron: 1.5, rail: 1.0, wood: 1.0, energy: 0.9, obsidian: 1.4, cane: 1.0, glass: 1.0, battlement: 1.5 }[L.wall] || 1.2;
  buildEdges(T, track, spec, L, mats, statics, { slab: w === 8 || w === 12 ? 2.4 : 1.4, walls: true, wallH, wallT: 0.7 }, keys);
  if (hasFloor) buildTerrain(T, track, spec, L, mats, statics, floorY);
  for (const m of statics) { scene.add(m); disposables.push(m.geometry); }

  /* the floor: rock and sand planes, a sea, a lava lake, a cloud sea far below */
  let liquid = null;
  if (L.floor !== 'none') {
    const fy = L.floor === 'cloud' ? minY - 70 : floorY - 0.4, size = Math.max(3000, rad * 2 + 2400);
    const g = new T.PlaneGeometry(size, size, 1, 1); g.rotateX(-Math.PI / 2); disposables.push(g);
    let m;
    if (L.floor === 'water' || L.floor === 'lava' || L.floor === 'cloud') {
      const lt = tex(ctx, 'liquid' + L.floor, 256, 256, paintLiquid(L.floor)).clone(); lt.needsUpdate = true; lt.repeat.set(size / 60, size / 60); disposables.push(lt);
      m = L.floor === 'lava' ? new T.MeshBasicMaterial({ map: lt, toneMapped: false })
        : new T.MeshStandardMaterial({ map: lt, roughness: L.floor === 'water' ? 0.2 : 1, metalness: L.floor === 'water' ? 0.5 : 0, transparent: L.floor === 'cloud', opacity: 0.85 });
      liquid = lt;
    } else m = new T.MeshStandardMaterial({ color: new T.Color(L.floorC[0]), roughness: 1, flatShading: true });
    disposables.push(m);
    const fl = new T.Mesh(g, m); fl.position.set(cx, fy, cz); fl.receiveShadow = !!(L.floor !== 'lava'); scene.add(fl);
  }

  /* grid for keeping dressing off the road: 20 m cells of sample indices */
  const grid = new Map(), cell = 20;
  for (let i = 0; i < track.n; i += 2) { const k = Math.floor(track.px[i] / cell) + ',' + Math.floor(track.pz[i] / cell); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(i); }
  const nearRoad = (x, z, m) => {
    const gx = Math.floor(x / cell), gz = Math.floor(z / cell), reach = Math.ceil((m + 12) / cell);
    for (let a = -reach; a <= reach; a++) for (let b = -reach; b <= reach; b++) {
      const list = grid.get((gx + a) + ',' + (gz + b)); if (!list) continue;
      for (const i of list) { const dx = track.px[i] - x, dz = track.pz[i] - z, lim = track.hw[i] + m; if (dx * dx + dz * dz < lim * lim) return true; }
    }
    return false;
  };

  /* roadside dressing: instanced sets along both sides */
  const sets = L.sets, perSet = Math.round((low ? 0.5 : 1) * Math.min(90, 18 + track.length / 60));
  const m4 = new T.Matrix4(), q = new T.Quaternion(), e = new T.Euler(), vp = new T.Vector3(), vs = new T.Vector3();
  const instanced = [];
  sets.forEach(name => {
    const B = Kit(T), G = Kit(T);
    SETS[name](B, G, A);
    const big = !!BIG_SETS[name], float = FLOAT_SETS[name], count = big ? Math.ceil(perSet * 0.35) : perSet;
    const mats4 = [];
    for (let k = 0, tries = 0; k < count && tries < count * 6; tries++) {
      const s = R() * track.length, i = Math.min(track.n - 1, Math.floor(s / track.step)), side = R() < 0.5 ? -1 : 1;
      const off = track.hw[i] + (big ? 22 + R() * 70 : 5 + R() * 26) + (float ? 6 : 0);
      const rx = track.rx[i], rz = track.rz[i], rl = Math.hypot(rx, rz) || 1;
      const x = track.px[i] + rx / rl * side * off, z = track.pz[i] + rz / rl * side * off;
      if (nearRoad(x, z, big ? 18 : 5)) continue;
      let y;
      if (float) y = track.py[i] + float[0] + R() * (float[1] - float[0]);
      else if (hasFloor) { const drop = Math.max(0, track.py[i] - floorY), shoulder = 10 + drop * 1.3; y = off - track.hw[i] < shoulder ? Math.max(floorY, track.py[i] - drop * (off - track.hw[i]) / shoulder) - 0.3 : floorY - 0.3; }
      else y = track.py[i] - 2;
      const sc = (big ? 1 : 0.8) + R() * (big ? 0.8 : 0.6);
      e.set(float ? R() * 0.6 - 0.3 : 0, R() * TAU, float ? R() * 0.6 - 0.3 : 0); q.setFromEuler(e);
      m4.compose(vp.set(x, y, z), q, vs.set(sc, sc, sc));
      mats4.push(m4.clone());
      k++;
    }
    if (!mats4.length) { B.build().dispose(); if (!G.empty()) G.build().dispose(); return; }
    const bg = B.build(), im = new T.InstancedMesh(bg, mats.set, mats4.length);
    mats4.forEach((mm, k) => im.setMatrixAt(k, mm)); im.computeBoundingSphere(); im.receiveShadow = true;
    scene.add(im); disposables.push(bg); instanced.push(im);
    if (!G.empty()) { const gg = G.build(), gm = new T.InstancedMesh(gg, mats.glow, mats4.length); mats4.forEach((mm, k) => gm.setMatrixAt(k, mm)); gm.computeBoundingSphere(); scene.add(gm); disposables.push(gg); }
  });

  /* supports: pillars under bridges and high road, trusses (orbit), hanging rock (citadel) */
  {
    const K = Kit(T), posts = [];
    const styleCol = L.bank[1];
    if (w === 8) K.box(1, 1, 1, '#6b727e', 0, -0.5, 0).box(0.3, 0.3, 1.2, '#8a8e9a', 0, -0.5, 0.4, 0.785);
    else if (w === 12) K.cone(1, 1, 6, '#3a3444', 0, -0.5, 0, Math.PI);
    else K.cyl(1, 1.2, 1, 6, styleCol, 0, -0.5, 0);
    for (let i = 6; i < track.n; i += 14) {
      if (track.flags[i] & TF.GAP) continue;
      const p = spec.pieces[track.piece[i]], high = track.py[i] - floorY > 6;
      const need = w === 8 || w === 12 || (p && p.deco === 'bridge') || (track.flags[i] & TF.LOOP) || (high && hasFloor);
      if (!need || track.uy[i] < 0.6) continue;
      const depth = w === 8 ? 3.2 : w === 12 ? 9 + hash(i, 3) * 14 : Math.max(2, track.py[i] - floorY);
      for (const side of [-1, 1]) {
        const d = side * (track.hw[i] - 1.2);
        m4.compose(vp.set(track.px[i] + track.rx[i] * d, track.py[i] - (w === 8 || w === 12 ? 1.4 : 0.8), track.pz[i] + track.rz[i] * d), q.identity(), vs.set(w === 8 ? 1 : 1.1, depth, w === 8 ? 1 : 1.1));
        posts.push(m4.clone());
      }
    }
    if (posts.length) { const g = K.build(), im = new T.InstancedMesh(g, mats.set, posts.length); posts.forEach((mm, k) => im.setMatrixAt(k, mm)); im.computeBoundingSphere(); scene.add(im); disposables.push(g); }
    else K.build().dispose();
  }

  /* tunnels (TF.COVER): ribs every 6 m and a roof shell */
  {
    const ribs = [], shellP = [];
    const glassy = w === 11;
    for (let i = 0; i < track.n; i++) {
      if (!(track.flags[i] & TF.COVER)) continue;
      const hw = track.hw[i] + 0.8, top = Math.max(6.5, hw * 0.95);
      if (i % 8 === 0) {
        e.set(0, 0, 0);
        const basis = new T.Matrix4().makeBasis(new T.Vector3(-track.rx[i], -track.ry[i], -track.rz[i]), new T.Vector3(track.ux[i], track.uy[i], track.uz[i]), new T.Vector3(track.tx[i], track.ty[i], track.tz[i]));
        q.setFromRotationMatrix(basis);
        m4.compose(vp.set(track.px[i], track.py[i], track.pz[i]), q, vs.set(hw, top, 1)); ribs.push(m4.clone());
      }
      if (i > 0 && (i % 2 === 0 || i === track.n - 1) && (track.flags[i - 2] & TF.COVER)) {
        const segs = 8;
        for (let k = 0; k < segs; k++) {
          const a0 = k / segs * Math.PI, a1 = (k + 1) / segs * Math.PI;
          const pt = (j, a) => { const hwj = track.hw[j] + 0.8, tj = Math.max(6.5, hwj * 0.95), d = Math.cos(a) * hwj, h = Math.sin(a) * tj; return [track.px[j] + track.rx[j] * d + track.ux[j] * h, track.py[j] + track.ry[j] * d + track.uy[j] * h, track.pz[j] + track.rz[j] * d + track.uz[j] * h]; };
          const p00 = pt(i - 2, a0), p01 = pt(i - 2, a1), p10 = pt(i, a0), p11 = pt(i, a1);
          shellP.push(...p00, ...p10, ...p01, ...p01, ...p10, ...p11);
        }
      }
    }
    if (ribs.length) {
      const K = Kit(T), G = Kit(T);
      K.torus(1, 0.06, 3, 8, glassy ? '#264040' : L.bank[1], 0, 0, 0, 0, 0, 0, Math.PI);
      G.box(0.1, 0.03, 0.4, glassy ? A[1] : A[1], 0, 0.98, 0);
      const g = K.build(), gg = G.build(), im = new T.InstancedMesh(g, mats.set, ribs.length), gm = new T.InstancedMesh(gg, mats.glow, ribs.length);
      ribs.forEach((mm, k) => { im.setMatrixAt(k, mm); gm.setMatrixAt(k, mm); }); im.computeBoundingSphere(); gm.computeBoundingSphere();
      scene.add(im, gm); disposables.push(g, gg);
    }
    if (shellP.length) {
      const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(shellP, 3)); g.computeVertexNormals();
      const m = glassy ? new T.MeshStandardMaterial({ color: new T.Color(A[2]), transparent: true, opacity: 0.16, roughness: 0.1, metalness: 0.4, side: T.DoubleSide, depthWrite: false, emissive: new T.Color(A[3]), emissiveIntensity: 0.4 })
        : new T.MeshStandardMaterial({ color: new T.Color(L.bank[0]), roughness: 0.9, flatShading: true, side: T.DoubleSide });
      const sh = new T.Mesh(g, m); scene.add(sh); disposables.push(g, m);
    }
  }

  /* split pieces: a median barrier down the centre, hazard nose at each end */
  {
    const medP = [];
    for (let i = 1; i < track.n; i++) {
      /* the median the sim collides with: half width track.mid, a low wall with a hazard nose */
      const m0 = track.mid ? track.mid[i - 1] : 0, m1 = track.mid ? track.mid[i] : 0;
      if (m0 < 0.15 && m1 < 0.15) continue;
      const pv = (j, d, h) => [track.px[j] + track.rx[j] * d + track.ux[j] * h, track.py[j] + track.ry[j] * d + track.uy[j] * h, track.pz[j] + track.rz[j] * d + track.uz[j] * h];
      const hh = 1.2;
      for (const [s0, h0, s1, h1] of [[-1, 0, -1, hh], [-1, hh, 1, hh], [1, hh, 1, 0]]) { const a0 = pv(i - 1, s0 * m0, h0), a1 = pv(i - 1, s1 * m0, h1), b0 = pv(i, s0 * m1, h0), b1 = pv(i, s1 * m1, h1); medP.push(...a0, ...b0, ...a1, ...a1, ...b0, ...b1); }
    }
    if (medP.length) { const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(medP, 3)); g.computeVertexNormals(); const m = new T.Mesh(g, mats.wall); scene.add(m); disposables.push(g); }
  }

  /* decals: start grid, checkpoint stripes, the finish line */
  const decal = (s, len, mat, liftH = 0.04) => {
    const i0 = Math.max(0, Math.floor((s - len / 2) / track.step)), i1 = Math.min(track.n - 1, Math.ceil((s + len / 2) / track.step)), p = [], uv = [];
    for (let i = i0; i <= i1; i++) {
      const hw = track.hw[i] - 0.4, u = (i - i0) / Math.max(1, i1 - i0);
      for (const d of [-hw, hw]) p.push(track.px[i] + track.rx[i] * d + track.ux[i] * liftH, track.py[i] + track.ry[i] * d + track.uy[i] * liftH, track.pz[i] + track.rz[i] * d + track.uz[i] * liftH);
      uv.push(0, u, 4, u);
    }
    const idx = [];
    for (let k = 0; k < i1 - i0; k++) { const a = k * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(p, 3)); g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
    const m = new T.Mesh(g, mat); m.receiveShadow = true; scene.add(m); disposables.push(g); return m;
  };
  if (!opts.backdrop) {
    decal(track.finishS, 4, mats.checker);
    decal(6, 1.2, mats.checker);
    for (const s of track.checkpoints) decal(s, 1.6, mats.hazard);
  }

  /* gantries: overheads every ~170 m, checkpoint gantries with lamps, the start lights, the finish gate */
  const lamps = [], startLamps = [], culls = [];
  {
    const OB = Kit(T), OG = Kit(T), LB = Kit(T);
    OVERS[L.over](OB, OG, A);
    const arch = !!ARCH_OVERS[L.over];
    LB.box(0.9, 1, 0.9, '#2c3039', 0, 0.5, 0).box(0.7, 1, 0.7, w === 3 ? '#2a2a34' : '#3a3a40', 0, 0.5, 0);
    LB.box(1.2, 0.08, 1.2, '#f2b705', 0, 0.92, 0);
    const beams = [], legs = [], spots = [];
    const okAt = i => {
      if (i < 20 || i > track.n - 30) return false;
      const p = spec.pieces[track.piece[i]];
      if (!p || track.flags[i] & (TF.GAP | TF.COVER | TF.LOOP | TF.RAMP) || (track.hp && track.hp[i] > 0.1) || (track.mid && track.mid[i] > 0.1) || track.uy[i] < 0.93) return false;
      return Math.abs(i * track.step - track.finishS) > 30 && !track.checkpoints.some(c => Math.abs(c - i * track.step) < 30);
    };
    for (let s = 120; s < track.length - 40; s += 150 + R() * 60) { let i = Math.floor(s / track.step); for (let k = 0; k < 20 && !okAt(i); k++) i++; if (okAt(i)) spots.push(i); }
    for (const i of spots) {
      const hw = track.hw[i] + 2, yaw = Math.atan2(track.tx[i], track.tz[i]);
      e.set(0, yaw, 0); q.setFromEuler(e);
      if (arch) { m4.compose(vp.set(track.px[i], track.py[i], track.pz[i]), q, vs.set(hw, Math.max(8, hw * 1.05), hw * 0.6)); beams.push(m4.clone()); continue; }
      m4.compose(vp.set(track.px[i], track.py[i], track.pz[i]), q, vs.set(hw, 1, 1)); beams.push(m4.clone());
      for (const side of [-1, 1]) { const d = side * hw; m4.compose(vp.set(track.px[i] + track.rx[i] * d, track.py[i] - 1, track.pz[i] + track.rz[i] * d), q, vs.set(1, 9, 1)); legs.push(m4.clone()); }
    }
    const add = (K, mat, list) => { if (!list.length || K.empty()) { if (!K.empty()) K.build().dispose(); return; } const g = K.build(), im = new T.InstancedMesh(g, mat, list.length); list.forEach((mm, k) => im.setMatrixAt(k, mm)); im.computeBoundingSphere(); im.castShadow = !low; scene.add(im); disposables.push(g); };
    add(OB, mats.set, beams); add(OG, mats.glow, beams); add(LB, mats.set, legs);

    /* checkpoint and start gantries: hazard beams with a lamp bar that turns toxic when passed */
    /* each gantry is two draw calls: the merged frame and its lamp bar (the bar swaps material when passed) */
    const lampK = Kit(T);
    for (let k = -2; k <= 2; k++) lampK.box(1.1, 0.55, 0.3, '#ffffff', k * 1.6, 7.6, -0.5, 0, 0, 0, 0);
    const lampGeo = lampK.build(); disposables.push(lampGeo);
    const gantry = (s, list, onMat) => {
      const i = Math.min(track.n - 1, Math.floor(s / track.step)), hw = track.hw[i] + 1.6, yaw = Math.atan2(track.tx[i], track.tz[i]), y = track.py[i];
      const grp = new T.Group(); grp.position.set(track.px[i], y, track.pz[i]); grp.rotation.y = yaw;
      const K = Kit(T);
      K.box(hw * 2 + 0.8, 0.9, 0.9, '#2c3039', 0, 7.6, 0).box(hw * 2 + 0.8, 0.14, 0.94, '#f2b705', 0, 7.2, 0).box(hw * 2 + 0.8, 0.14, 0.94, '#f2b705', 0, 8.0, 0);
      for (const side of [-1, 1]) K.box(0.8, 7.6, 0.8, '#2c3039', side * hw, 3.8, 0).box(0.84, 0.6, 0.84, '#f2b705', side * hw, 2.2, 0);
      const g = K.build(); disposables.push(g);
      const frame = new T.Mesh(g, mats.set); frame.castShadow = !low; grp.add(frame);
      const lm = new T.Mesh(lampGeo, onMat); grp.add(lm); list.push(lm);
      scene.add(grp); culls.push(grp);
      return grp;
    };
    if (!opts.backdrop) {
      for (const s of track.checkpoints) { const l = []; gantry(s, l, mats.lampOff); lamps.push(l); }
      gantry(14, startLamps, mats.lampRed);
      /* the finish gate: two hazard towers, a chequered banner, flags */
      const fi = Math.min(track.n - 1, Math.floor(track.finishS / track.step)), fhw = track.hw[fi] + 2.4;
      const F = Kit(T), FG = Kit(T);
      for (const side of [-1, 1]) { F.box(2, 12, 2, '#2c3039', side * fhw, 6, 0).box(2.1, 1, 2.1, '#f2b705', side * fhw, 3, 0).box(2.1, 1, 2.1, '#f2b705', side * fhw, 6, 0).box(2.1, 1, 2.1, '#f2b705', side * fhw, 9, 0); F.cyl(0.08, 0.08, 4, 4, '#c7ccd5', side * fhw, 14, 0); F.box(1.6, 1, 0.05, '#f4f6fa', side * fhw + side * 0.8, 15.4, 0); FG.ico(0.5, A[1], side * fhw, 12.4, 0); }
      F.box(fhw * 2 + 2, 0.8, 1, '#2c3039', 0, 12, 0);
      const fg = F.build(), fgg = FG.build(), gate = new T.Group(); disposables.push(fg, fgg);
      gate.add(new T.Mesh(fg, mats.set), new T.Mesh(fgg, mats.glow));
      const ban = new T.Mesh(new T.PlaneGeometry(fhw * 2, 2.4), mats.checker); ban.position.set(0, 10.2, 0.55); gate.add(ban); disposables.push(ban.geometry);
      const ban2 = ban.clone(); ban2.rotation.y = Math.PI; ban2.position.z = -0.55; gate.add(ban2);
      gate.position.set(track.px[fi], track.py[fi], track.pz[fi]); gate.rotation.y = Math.atan2(track.tx[fi], track.tz[fi]);
      scene.add(gate);
    }
  }

  /* the landmark: ahead of the finish (you race toward it) plus a twin off to one side */
  const landGroup = new T.Group(); scene.add(landGroup);
  let beam = null, wheelRim = null;
  {
    const B = Kit(T), G = Kit(T);
    LANDMARKS[L.land](B, G, A);
    /* aerial perspective: tint the far set toward the horizon colour */
    const hz = new T.Color(L.sky[2]), fogc = new T.Color(L.fog[0]);
    for (const p of B.parts) p.c.lerp(fogc, 0.45).lerp(hz, 0.1);
    const g = B.build(), gg = G.empty() ? null : G.build();
    disposables.push(g); if (gg) disposables.push(gg);
    const fi = Math.min(track.n - 1, Math.floor(track.finishS / track.step));
    const place = (mesh, x, z, yaw, s) => { mesh.position.set(x, (L.floor === 'cloud' ? minY : floorY) - 2, z); mesh.rotation.y = yaw; mesh.scale.setScalar(s); landGroup.add(mesh); };
    const dist = (w === 8 ? 1700 : 700) + rad * 0.3;
    const fx = opts.landAt ? opts.landAt[0] : track.px[fi] + track.tx[fi] * dist, fz = opts.landAt ? opts.landAt[1] : track.pz[fi] + track.tz[fi] * dist;
    const yaw = Math.atan2(track.px[fi] - fx, track.pz[fi] - fz);
    const ls = opts.landScale || (w === 8 ? 1 : 1.5);
    const main = new T.Mesh(g, mats.far); place(main, fx, fz, yaw, ls);
    if (gg) place(new T.Mesh(gg, mats.farGlow), fx, fz, yaw, ls);
    if (!opts.backdrop && w !== 8) {
      /* a second, farther copy on the other side of the course reads as a range */
      const a2 = Math.atan2(cz - fz, cx - fx) + 0.9, d2 = rad + 1100;
      const second = new T.Mesh(g, mats.far); place(second, cx + Math.cos(a2) * d2, cz + Math.sin(a2) * d2, a2, 0.8);
    }
    if (w === 7) {
      /* the lighthouse beam sweeps over the course */
      const bg = new T.ConeGeometry(30, 900, 12, 1, true); bg.translate(0, 450, 0); bg.rotateX(Math.PI / 2);
      const bm = new T.MeshBasicMaterial({ color: 0xfff6c0, transparent: true, opacity: 0.08, depthWrite: false, blending: T.AdditiveBlending, fog: false, side: T.DoubleSide, toneMapped: false });
      beam = new T.Mesh(bg, bm); beam.position.set(260, 127, 160); main.add(beam); disposables.push(bg, bm);
    }
    if (w === 10) {
      const K = Kit(T), GK = Kit(T);
      K.torus(56, 2.2, 4, 24, '#5a2a40', 0, 0, 0); for (let i = 0; i < 12; i++) { const a = i / 12 * TAU; K.box(1.2, 56, 1.2, '#4a2a38', Math.cos(a) * 28, Math.sin(a) * 28, 0, 0, 0, a + Math.PI / 2); K.box(6, 6, 6, i % 2 ? '#c84fa0' : '#8cff3a', Math.cos(a) * 56, Math.sin(a) * 56, 0); GK.ico(1.2, i % 2 ? '#ffe27a' : '#8cff3a', Math.cos(a) * 58, Math.sin(a) * 58, 3.5); }
      const rg = K.build(), rgg = GK.build(); disposables.push(rg, rgg);
      wheelRim = new T.Group(); wheelRim.add(new T.Mesh(rg, mats.far), new T.Mesh(rgg, mats.farGlow)); wheelRim.position.set(0, 120, 6); main.add(wheelRim);
    }
  }

  /* weather: particles in a box that follows the camera */
  const wx = makeWeather(ctx, L.wx, A, low, rm, dotTex, disposables);
  if (wx) scene.add(wx.obj);
  let flash = 0, nextFlash = 3 + R() * 5, bolt = null;
  if ((L.wx === 'rain' || L.wx === 'storm') && !rm) {
    const pts = [];
    let x = 0, y = 0;
    for (let i = 0; i < 14; i++) { const nx = x + (R() - 0.5) * 50, ny = y - 40 - R() * 30; pts.push(x, y, 0, nx, ny, 0); x = nx; y = ny; if (i % 4 === 2) pts.push(x, y, 0, x + 40, y - 50, 0); }
    const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(pts, 3));
    const m = new T.LineBasicMaterial({ color: 0xf0f0ff, fog: false, toneMapped: false, transparent: true, opacity: 1 });
    bolt = new T.LineSegments(g, m); bolt.visible = false; scene.add(bolt); disposables.push(g, m);
  }

  /* props: one mesh per track prop */
  const propGeos = new Map(), propMeshes = [], baseQ = [], tq = new T.Quaternion(), te = new T.Euler(), basis = new T.Matrix4();
  const vx = new T.Vector3(), vy = new T.Vector3(), vz = new T.Vector3();
  const patchMats = new Map();
  const fr = {};
  (track.props || []).forEach(p => {
    const thing = (p.look || '').split('.')[1] || p.cat, cat = VROOM.contracts.PROP_CAT[p.cat] || {};
    VROOM.sim.frameAt(track, p.s, fr);
    vx.set(-fr.rx, -fr.ry, -fr.rz); vy.set(fr.ux, fr.uy, fr.uz); vz.set(fr.tx, fr.ty, fr.tz);
    basis.makeBasis(vx, vy, vz);
    const bq = new T.Quaternion().setFromRotationMatrix(basis);
    let mesh;
    if (cat.kind === 'patch' || PATCH_THINGS[thing]) {
      if (!patchMats.has(thing)) { const m = new T.MeshStandardMaterial({ map: tex(ctx, 'patch' + thing, 128, 128, paintPatch(thing)), transparent: true, roughness: thing === 'puddle' || thing === 'sheet' || thing === 'tidepool' ? 0.1 : 0.6, metalness: 0.3, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3 }); patchMats.set(thing, m); disposables.push(m); }
      const len = p.len || cat.len || 8, wd = (p.w || cat.w || 2.5) * 2;
      const g = new T.PlaneGeometry(wd, len); g.rotateX(-Math.PI / 2); g.translate(0, 0.05, 0); disposables.push(g);
      mesh = new T.Mesh(g, patchMats.get(thing)); mesh.receiveShadow = true;
    } else if (p.cat === 'boost' || p.cat === 'jumpPad') {
      const len = p.len || cat.len || 6, wd = (p.w || cat.w || 2) * 2;
      const key = 'pad' + len + 'x' + wd;
      if (!propGeos.has(key)) { const K = Kit(T); K.box(wd + 0.4, 0.1, len + 0.4, '#1a1c21', 0, 0.05, 0).box(wd + 0.5, 0.08, 0.3, '#f2b705', 0, 0.08, len / 2).box(wd + 0.5, 0.08, 0.3, '#f2b705', 0, 0.08, -len / 2); if (p.cat === 'jumpPad') K.box(wd, 0.5, len * 0.6, '#2c3039', 0, 0.25, 0, -0.2); propGeos.set(key, K.build()); }
      mesh = new T.Group();
      mesh.add(new T.Mesh(propGeos.get(key), mats.prop));
      const pg = new T.PlaneGeometry(wd, len); pg.rotateX(-Math.PI / 2); pg.translate(0, p.cat === 'jumpPad' ? 0.55 : 0.12, 0); disposables.push(pg);
      const chev = new T.Mesh(pg, mats.pad); chev.rotation.y = Math.PI; mesh.add(chev);
    } else {
      const key = thing;
      if (!propGeos.has(key)) propGeos.set(key, propGeo(T, p.look || thing, w, A));
      mesh = new T.Mesh(propGeos.get(key), mats.prop); mesh.castShadow = !low && cat.kind === 'hard';
      if (p.cat === 'nitro') { const gl = new T.Mesh(cached(ctx, 'nitroGlowGeo', () => new T.IcosahedronGeometry(1.1, 1)), mats.nitroGlow); gl.position.y = 1.1; mesh.add(gl); }
      if (p.cat === 'barrier' || p.cat === 'boulder' || p.cat === 'pillar') { const r = p.r || cat.r || 1; mesh.scale.setScalar(Math.max(0.8, r)); }
    }
    mesh.position.set(p.x, p.y, p.z); mesh.quaternion.copy(bq);
    baseQ.push(bq); scene.add(mesh); propMeshes.push(mesh);
  });
  for (const g of propGeos.values()) disposables.push(g);

  /* stars */
  const sGeo = cached(ctx, 'starGeo', () => starGeo(T)), starMeshes = [], starYaw = [];
  for (const s of spec.stars) {
    const m = new T.Mesh(sGeo, mats.star), p = VROOM.sim.toWorld(track, s.s, s.d, s.h);
    VROOM.sim.frameAt(track, s.s, fr);
    m.position.set(p[0], p[1] + 0.3, p[2]);
    starYaw.push(Math.atan2(fr.tx, fr.tz));
    m.rotation.y = starYaw[starYaw.length - 1];
    scene.add(m); starMeshes.push(m);
  }

  /* the respawn crane: a hook and cable that drops onto the car */
  const crane = new T.Group();
  {
    const K = Kit(T);
    K.box(0.12, 40, 0.12, '#1a1c21', 0, 20.8, 0).box(1.6, 0.5, 0.5, '#f2b705', 0, 0.8, 0).box(0.3, 1.6, 0.3, '#6b727e', -0.7, 0, 0, 0, 0, 0.3).box(0.3, 1.6, 0.3, '#6b727e', 0.7, 0, 0, 0, 0, -0.3).box(2.4, 0.3, 0.3, '#6b727e', 0, -0.6, 0);
    const g = K.build(); disposables.push(g);
    crane.add(new T.Mesh(g, mats.set)); crane.visible = false; scene.add(crane);
  }
  let craneT = -1; const craneAt = new T.Vector3();

  /* fx */
  const fx = VROOM.fx && VROOM.fx.create ? VROOM.fx.create(ctx, scene) : null;
  const fxPos = [0, 0, 0], fxDir = { dir: [0, 1, 0], color: null, n: 0, id: 0, up: [0, 1, 0], speed: 0, w: 0.35 };
  let dustT = 0, smokeT = 0, nitroT = 0, trailT = 0;
  /* a boss leaves a wake: embers in the world's hot accent under soot (frost's soot is cold iron grey) */
  const trailO = { n: 3, color: A[1], soot: w === 5 ? '#262c34' : w === 12 || w === 8 ? '#2a2638' : '#1c1a1e' };
  const dustCol = { 2: '#a8643a', 3: '#d8b070', 5: '#ffffff', 6: '#ffffff', 4: '#5a3a22', 12: '#ff9ad0' };

  const camPos = new T.Vector3();
  const rig = {
    scene, props: propMeshes, stars: starMeshes, sun: key,
    update(st, dt, t, camera) {
      if (camera) camPos.copy(camera.position);
      skyG.position.copy(camPos);
      const c = st && st.car;
      if (c) {
        key.position.set(c.x + keyDir.x * 120, c.y + keyDir.y * 120, c.z + keyDir.z * 120);
        key.target.position.set(c.x, c.y, c.z); key.target.updateMatrixWorld();
      }
      /* props: pose from the sim, hidden past the fog */
      const far = Math.min(320, L.fog[2] * 0.8), far2 = far * far;
      if (st && st.props) for (let i = 0; i < propMeshes.length; i++) {
        const p = st.props[i], m = propMeshes[i];
        if (!p) continue;
        const dx = p.x - camPos.x, dy = p.y - camPos.y, dz = p.z - camPos.z;
        m.visible = p.alive !== false && dx * dx + dy * dy + dz * dz < far2;
        if (!m.visible) continue;
        m.position.set(p.x, p.y, p.z);
        if (p.rx || p.ry || p.rz) { te.set(p.rx || 0, p.ry || 0, p.rz || 0); tq.setFromEuler(te); m.quaternion.copy(baseQ[i]).multiply(tq); }
      }
      for (const g of culls) { const dx = g.position.x - camPos.x, dz = g.position.z - camPos.z; g.visible = dx * dx + dz * dz < far2 * 1.6; }
      if (st && st.stars) for (let i = 0; i < starMeshes.length; i++) {
        const m = starMeshes[i], dx = m.position.x - camPos.x, dz = m.position.z - camPos.z;
        m.visible = !st.stars[i] && dx * dx + dz * dz < far2;
        if (m.visible && !rm) m.rotation.y = starYaw[i] + t * 2.6 + i;
      }
      /* animated surfaces and set pieces */
      mats.pad.map.offset.y = rm ? 0 : -(t * 1.6) % 1;
      if (liquid && !rm) { liquid.offset.x = (t * (L.floor === 'lava' ? 0.012 : 0.02)) % 1; liquid.offset.y = (t * 0.008) % 1; }
      if (beam && !rm) beam.rotation.y = t * 0.6;
      if (wheelRim && !rm) wheelRim.rotation.z = t * 0.05;
      if (aurora && !rm) aurora.material.opacity = 0.16 + 0.08 * Math.sin(t * 0.4);
      if (wx) wx.update(dt, camPos, rm);
      /* start lights go green when the car moves */
      if (c && startLamps.length && c.speed > 0.5 && startLamps[0].material !== mats.lampOn) for (const l of startLamps) l.material = mats.lampOn;
      /* lightning */
      if (bolt) {
        nextFlash -= dt;
        if (nextFlash < 0) { flash = 0.18; nextFlash = 4 + R() * 7; const a = R() * TAU; bolt.position.set(camPos.x + Math.cos(a) * 500, camPos.y + 320, camPos.z + Math.sin(a) * 500); bolt.lookAt(camPos.x, bolt.position.y, camPos.z); bolt.scale.setScalar(4 + R() * 3); if (fx && R() < 0.3 && c) { fxPos[0] = c.x + (R() - 0.5) * 30; fxPos[1] = c.y; fxPos[2] = c.z + (R() - 0.5) * 30; fx.emit('sparks', fxPos, { n: 30 }); } }
        if (flash > 0) { flash -= dt; hemi.intensity = L.hemi[2] * (1 + 4 * Math.max(0, flash) / 0.18); bolt.visible = flash > 0.06; }
        else { hemi.intensity = L.hemi[2]; bolt.visible = false; }
      }
      /* the crane hook */
      if (craneT >= 0) {
        craneT += dt;
        const k = craneT < 0.5 ? 1 - craneT / 0.5 : craneT < 1.0 ? 0 : (craneT - 1.0) / 0.8;
        crane.position.set(craneAt.x, craneAt.y + 3.2 + k * k * 34, craneAt.z);
        if (c && craneT < 1.0) craneAt.set(c.x, c.y, c.z);
        if (craneT > 1.8) { craneT = -1; crane.visible = false; }
      }
      /* continuous wheel fx: dust on loose surfaces, skids when sliding, nitro flame while boosting */
      if (fx && c) {
        const loose = dustCol[c.surf];
        dustT -= dt; smokeT -= dt; nitroT -= dt;
        if (!c.air && c.speed > 9 && loose && dustT <= 0 && c.wheels) {
          dustT = low ? 0.16 : 0.09;
          const wl = c.wheels[2 + ((t * 60) & 1)];
          fxPos[0] = wl.x; fxPos[1] = wl.y; fxPos[2] = wl.z; fxDir.color = loose; fxDir.n = 2; fxDir.dir[0] = c.vx * 0.02; fxDir.dir[1] = 1; fxDir.dir[2] = c.vz * 0.02;
          fx.emit(c.surf === 5 || c.surf === 6 ? 'snow' : 'dust', fxPos, fxDir);
        }
        if (c.wheels && !c.air) for (let k = 2; k < 4; k++) {
          const wl = c.wheels[k];
          if (wl.contact && (wl.slip > 0.45 || c.drift)) { fxPos[0] = wl.x; fxPos[1] = wl.y; fxPos[2] = wl.z; fxDir.id = k; fxDir.w = 0.36; fxDir.up[0] = 0; fxDir.up[1] = 1; fxDir.up[2] = 0; fx.emit('skid', fxPos, fxDir); if (smokeT <= 0) { smokeT = 0.08; fxDir.n = 1; fxDir.color = null; fx.emit('smoke', fxPos, fxDir); } }
          else fx.emit('skid', null, { id: k });
        }
        trailT -= dt;
        if (st.actors && trailT <= 0) {
          trailT = low ? 0.12 : 0.06;
          for (let i = 0; i < st.actors.length; i++) {
            const a = st.actors[i];
            if (!a.boss || !a.alive || a.defeated || a.state === 'idle' || a.state === 'gone') continue;
            const dx = a.x - camPos.x, dz = a.z - camPos.z;
            if (dx * dx + dz * dz > far2) continue;
            const K = VROOM.monsterAI && VROOM.monsterAI.KINDS[a.kind], hh = K ? K.h : 6;
            fxPos[0] = a.x; fxPos[1] = a.y + hh * 0.35; fxPos[2] = a.z;
            fx.emit('trail', fxPos, trailO);
          }
        }
        if (c.boosting && nitroT <= 0) {
          nitroT = 0.03;
          const sp = Math.max(1, c.speed), bx = -c.vx / sp, bz = -c.vz / sp;
          fxPos[0] = c.x + bx * 2.4; fxPos[1] = c.y + 1.0; fxPos[2] = c.z + bz * 2.4; fxDir.dir[0] = bx; fxDir.dir[1] = 0.1; fxDir.dir[2] = bz; fxDir.n = 3; fxDir.color = null;
          fx.emit('nitro', fxPos, fxDir);
        }
      }
      if (fx) fx.update(dt);
    },
    onEvent(ev, st) {
      if (!fx || !ev) return;
      const c = st && st.car, at = (x, y, z) => { fxPos[0] = x; fxPos[1] = y; fxPos[2] = z; return fxPos; };
      const o = { n: 0, color: null, dir: [0, 1, 0], big: 0 };
      switch (ev.type) {
        case 'star': { const m = starMeshes[ev.i]; if (m) fx.emit('stars', at(m.position.x, m.position.y, m.position.z), o); break; }
        case 'nitro': if (c) fx.emit('nitro', at(c.x, c.y + 1, c.z), { n: 14 }); break;
        case 'pad': if (c) fx.emit('sparks', at(c.x, c.y + 0.3, c.z), { n: 10, color: A[1] }); break;
        case 'hit': {
          const p = st.props && st.props[ev.i], cat = p && VROOM.contracts.PROP_CAT[p.cat];
          if (!p) break;
          if (p.cat === 'mine') { fx.emit('explosion', at(p.x, p.y + 0.5, p.z), o); break; }
          if (cat && cat.kind === 'soft') { o.color = p.cat === 'crate' ? '#8a3b12' : A[2]; o.n = p.cat === 'crate' ? 14 : 6; fx.emit('debris', at(p.x, p.y + 0.6, p.z), o); fx.emit('dust', fxPos, { n: 4 }); }
          else if (cat && cat.kind === 'hard') fx.emit('sparks', at(p.x, p.y + 0.8, p.z), { n: 22 });
          else if (cat && cat.kind === 'patch' && (p.cat === 'water' || p.cat === 'mud')) fx.emit('splash', at(c ? c.x : p.x, p.y, c ? c.z : p.z), { color: p.cat === 'mud' ? '#5a3a22' : null });
          break;
        }
        case 'wall': case 'scrape':
          if (c) { const side = ev.side || 1, f = VROOM.sim.frameAt(st.track, c.s, fr); fx.emit('sparks', at(c.x + f.rx * side * 1.2, c.y + 0.6, c.z + f.rz * side * 1.2), { n: ev.type === 'wall' ? 26 : 5 }); }
          break;
        case 'land': if (c) { fx.emit(c.surf === 5 || c.surf === 6 ? 'snow' : 'dust', at(c.x, c.y + 0.2, c.z), { n: 6 + Math.round((ev.hard || 0) * 10), color: dustCol[c.surf] || '#6b6258' }); if ((ev.hard || 0) > 0.5) fx.emit('sparks', fxPos, { n: 16 }); } break;
        case 'spin': if (c) fx.emit('smoke', at(c.x, c.y + 0.5, c.z), { n: 8 }); break;
        case 'surface': if (c && (ev.surf === 8)) fx.emit('splash', at(c.x, c.y, c.z), o); break;
        case 'respawn': if (c) { craneT = 0; crane.visible = true; craneAt.set(c.x, c.y, c.z); crane.position.set(c.x, c.y + 36, c.z); fx.emit('dust', at(c.x, c.y, c.z), { n: 8 }); } break;
        case 'checkpoint': {
          const l = lamps[ev.i]; if (l) for (const lm of l) lm.material = mats.lampOn;
          const s = st.track.checkpoints[ev.i]; if (s !== undefined) { const p = VROOM.sim.toWorld(st.track, s, 0, 7.6); fx.emit('sparks', at(p[0], p[1], p[2]), { n: 30, color: '#8cff3a' }); }
          break;
        }
        case 'finish': { const p = VROOM.sim.toWorld(st.track, st.track.finishS, 0, 12); for (let k = 0; k < 3; k++) fx.emit('explosion', at(p[0] + (k - 1) * 8, p[1] + 4 + k * 3, p[2]), { firework: 1, color: [A[1], '#8cff3a', '#f4f6fa'][k] }); fx.emit('stars', at(p[0], p[1], p[2]), { n: 30 }); break; }
        case 'monster': case 'boss': {
          const a = st.actors && st.actors[ev.a]; if (!a) break;
          if (ev.what === 'stomp' || ev.what === 'lunge' || ev.what === 'attack' || ev.what === 'enter') fx.emit('dust', at(a.x, a.y + 0.3, a.z), { n: ev.type === 'boss' ? 14 : 6, color: dustCol[st.car.surf] || '#6b6258', big: ev.type === 'boss' ? 1 : 0 });
          if (ev.what === 'hit' && c) fx.emit('sparks', at(c.x, c.y + 1, c.z), { n: 20 });
          if (ev.what === 'defeat') fx.emit('explosion', at(a.x, a.y + 3, a.z), { big: 1 });
          /* a boss arrives in a blast: the road erupts, sparks in the world's hot accent */
          if (ev.type === 'boss' && ev.what === 'enter') { fx.emit('explosion', at(a.x, a.y + 2, a.z), { big: 1 }); fx.emit('sparks', fxPos, { n: 40, color: A[1], speed: 1.6 }); fx.emit('smoke', fxPos, { n: 10, color: trailO.soot }); }
          break;
        }
        default: break;
      }
    },
    dispose() {
      if (fx) fx.dispose();
      if (wx) wx.dispose();
      for (const d of disposables) if (d && d.dispose) d.dispose();
      scene.traverse(o => { if (o.isInstancedMesh) o.dispose(); });
    },
  };
  /* leave the stars facing their road at load so the first frame reads */
  return rig;
}

/* ---------- weather ---------- */
function makeWeather(ctx, kind, A, low, rm, dotTex, disposables) {
  const T = ctx.THREE;
  const cfg = {
    ash: { n: 900, box: [90, 50, 90], vel: [0.6, -1.2, 0.3], col: '#c8b8a8', size: 0.35, add: false, op: 0.7, sway: 1.2, glowN: 200, glowCol: '#ffb02e' },
    embers: { n: 700, box: [90, 50, 90], vel: [0.8, 2.2, 0.2], col: '#ff7a2a', size: 0.4, add: true, op: 0.95, sway: 1.6 },
    drizzle: { n: 900, box: [70, 40, 70], vel: [0.5, -16, 0.3], col: '#c8b8ff', size: 0, add: false, op: 0.35, streak: 0.8 },
    rain: { n: 1800, box: [70, 40, 70], vel: [3, -30, 1], col: '#bfe0ff', size: 0, add: false, op: 0.45, streak: 1.6 },
    storm: { n: 1500, box: [70, 40, 70], vel: [5, -28, 2], col: '#d8ccff', size: 0, add: false, op: 0.45, streak: 1.5 },
    snow: { n: 2200, box: [80, 40, 80], vel: [7, -4, 2], col: '#ffffff', size: 0.32, add: false, op: 0.95, sway: 2.5 },
    /* a night blizzard driving across the pass: dense grey-white flakes on a hard slant, a few amber-lit by the lamps */
    blizzard: { n: 3200, box: [70, 34, 70], vel: [18, -6, 7], col: '#b8c6d2', size: 0.26, add: false, op: 0.85, sway: 4, glowN: 260, glowCol: '#ffa040' },
    sand: { n: 1600, box: [90, 24, 90], vel: [16, -0.5, 6], col: '#e8c88a', size: 0.26, add: false, op: 0.7, sway: 2 },
    spray: { n: 700, box: [80, 30, 80], vel: [3, -0.6, 1], col: '#dff6ee', size: 0.3, add: false, op: 0.45, sway: 1.5 },
    debris: { n: 300, box: [120, 60, 120], vel: [0.3, 0.1, 0.4], col: '#a88cff', size: 0.7, add: true, op: 0.7, sway: 0.6 },
    motes: { n: 700, box: [80, 30, 80], vel: [0.4, 0.5, 0.2], col: '#ff9ad0', size: 0.35, add: true, op: 0.8, sway: 1.4, glowN: 200, glowCol: '#8cff3a' },
    bubbles: { n: 900, box: [70, 40, 70], vel: [0.2, 3, 0.1], col: '#bff8ff', size: 0.3, add: true, op: 0.6, sway: 0.8, glowN: 400, glowCol: '#6bffd8' },
  }[kind];
  if (!cfg) return null;
  const n = Math.round(cfg.n * (low ? 0.4 : 1)), [bx, by, bz] = cfg.box, R = rng(n + bx);
  const group = new T.Group(), systems = [];
  const mk = (count, col, add, size, op) => {
    const streak = cfg.streak, p = new Float32Array(count * 3 * (streak ? 2 : 1)), seed = new Float32Array(count);
    for (let i = 0; i < count; i++) { const x = (R() - 0.5) * bx, y = (R() - 0.5) * by, z = (R() - 0.5) * bz; seed[i] = R() * TAU; if (streak) { p.set([x, y, z, x - cfg.vel[0] * 0.03, y - cfg.vel[1] * 0.03 * streak, z - cfg.vel[2] * 0.03], i * 6); } else p.set([x, y, z], i * 3); }
    const g = new T.BufferGeometry(); g.setAttribute('position', new T.BufferAttribute(p, 3));
    let obj, m;
    if (streak) { m = new T.LineBasicMaterial({ color: new T.Color(col), transparent: true, opacity: op, fog: true, depthWrite: false }); obj = new T.LineSegments(g, m); }
    else { m = new T.PointsMaterial({ color: new T.Color(col), size, map: dotTex, transparent: true, opacity: op, depthWrite: false, blending: add ? T.AdditiveBlending : T.NormalBlending, fog: true, toneMapped: !add }); obj = new T.Points(g, m); }
    obj.frustumCulled = false;
    group.add(obj); disposables.push(g, m);
    systems.push({ p, seed, count, attr: g.attributes.position, streak });
  };
  mk(n, cfg.col, cfg.add, cfg.size, cfg.op);
  if (cfg.glowN) mk(Math.round(cfg.glowN * (low ? 0.4 : 1)), cfg.glowCol, true, cfg.size * 1.3, 0.9);
  let t = 0;
  const off = new Float32Array(3);
  return {
    obj: group,
    update(dt, cam, frozen) {
      if (!frozen) t += dt;
      off[0] = cam.x; off[1] = cam.y; off[2] = cam.z;
      for (const S of systems) {
        const p = S.p, st = S.streak ? 6 : 3, sw = cfg.sway || 0;
        for (let i = 0; i < S.count; i++) {
          const o = i * st, ph = S.seed[i];
          let x = p[o] + (frozen ? 0 : (cfg.vel[0] + Math.sin(t * 1.3 + ph) * sw) * dt), y = p[o + 1] + (frozen ? 0 : cfg.vel[1] * dt * (0.7 + 0.6 * ((ph * 7) % 1))), z = p[o + 2] + (frozen ? 0 : (cfg.vel[2] + Math.cos(t * 1.1 + ph) * sw) * dt);
          /* wrap into the box around the camera */
          let rx = x - off[0], ry = y - off[1], rz = z - off[2];
          if (rx > bx / 2) x -= bx; else if (rx < -bx / 2) x += bx;
          if (ry > by / 2) y -= by; else if (ry < -by / 2) y += by;
          if (rz > bz / 2) z -= bz; else if (rz < -bz / 2) z += bz;
          rx = x; ry = y; rz = z;
          p[o] = rx; p[o + 1] = ry; p[o + 2] = rz;
          if (S.streak) { p[o + 3] = rx - cfg.vel[0] * 0.03; p[o + 4] = ry - cfg.vel[1] * 0.03 * S.streak; p[o + 5] = rz - cfg.vel[2] * 0.03; }
        }
        S.attr.needsUpdate = true;
      }
    },
    dispose() {},
  };
}

/* ---------- menus: the world-of-the-day diorama, the world card, the accent, the emblem ---------- */
function miniSpec(w) {
  const sp = { n: 0, world: w, seed: 1000 + w, kind: 'free',
    pieces: [{ type: 'straight', len: 60, w: 8 }, { type: 'bend', len: 140, angle: -0.7, bank: -0.1, w: 8 }, { type: 'crest', len: 60, h: 2, w: 8 }, { type: 'bend', len: 120, angle: 0.9, bank: 0.12, w: 8 },
      { type: 'straight', len: 120, w: 8 }, { type: 'bend', len: 160, angle: -1.2, bank: -0.15, w: 8 }, { type: 'straight', len: 200, w: 8 }],
    props: [{ cat: 'crate', look: (LOOK[w] ? VROOM.levels.WORLDS[w].key : 'foundry') + '.scrapbox', s: 96, d: -5 }, { cat: 'crate', look: VROOM.levels.WORLDS[w].key + '.scrapbox', s: 97.4, d: -3.4 },
      { cat: 'nitro', look: VROOM.levels.WORLDS[w].key + '.nitro', s: 84, d: 4 }, { cat: 'boost', look: VROOM.levels.WORLDS[w].key + '.pad', s: 70, d: 0 }],
    stars: [{ s: 40, d: 2, h: 1.4 }, { s: 52, d: 2.5, h: 1.4 }, { s: 64, d: 3, h: 1.4 }], monsters: [], boss: null, par: { S: 0, A: 0, B: 0 } };
  if (w === 11) sp.pieces.forEach((p, i) => { if (i > 0 && p.type !== 'crest') p.deco = 'tunnel'; });
  return sp;
}
function backdrop(ctx, w) {
  const T = ctx.THREE, spec = miniSpec(w), track = VROOM.sim.buildTrack(spec);
  /* the camera looks back down the road from s = 150: the car spot is s = 132, the landmark rises behind it */
  const camS = 158, spotS = 132, f = {}, b = {};
  VROOM.sim.frameAt(track, camS, f); VROOM.sim.frameAt(track, 0, b);
  const ld = w === 8 ? 2200 : 700, land = [b.x - b.tx * ld, b.z - b.tz * ld];
  const rig = buildWorld(ctx, track, spec, { backdrop: true, landAt: land, landScale: 0.9, noShadow: true });
  const camera = new T.PerspectiveCamera(48, 1200 / 700, 0.5, 6000);
  const spot = VROOM.sim.toWorld(track, spotS, 0, 0), sf = VROOM.sim.frameAt(track, spotS, {});
  const base = VROOM.sim.toWorld(track, camS, 5.5, 4.2), look = VROOM.sim.toWorld(track, spotS - 30, -1, 3.2);
  const fake = { car: null, props: track.props.map(p => ({ ...p })), stars: new Uint8Array(spec.stars.length) };
  let tt = 0;
  return {
    scene: rig.scene, camera,
    /* where the home screen parks the player's machine: on the road, nose toward the camera */
    spot: { pos: spot, yaw: Math.atan2(-sf.tx, -sf.tz) },
    update(dt, t) {
      tt = ctx.reducedMotion ? 0 : t;
      const sway = ctx.reducedMotion ? 0 : Math.sin(tt * 0.12) * 3;
      camera.position.set(base[0] + f.rx * sway, base[1] + (ctx.reducedMotion ? 0 : Math.sin(tt * 0.2) * 0.4), base[2] + f.rz * sway);
      camera.lookAt(look[0], look[1], look[2]);
      rig.update(fake, dt, tt, camera);
    },
    dispose() { rig.dispose(); },
  };
}
/* a still card of the world for menus: rendered once with the game's renderer, cached per size */
function card(ctx, w, width = 376, height = 220) {
  const key = 'card:' + w + ':' + width + 'x' + height;
  if (ctx.cache.has(key)) return ctx.cache.get(key);
  const c = canvas(width, height), g = c.getContext('2d'), A = accent(w), L = LOOK[w] || LOOK[1];
  const r = ctx.renderer;
  let ok = false;
  if (r) {
    try {
      const bd = backdrop(ctx, w), el = r.domElement;
      bd.camera.aspect = el.width / el.height; bd.camera.updateProjectionMatrix();
      bd.update(1 / 60, 4); bd.update(1 / 60, 4);
      r.render(bd.scene, bd.camera);
      const k = Math.max(width / el.width, height / el.height), sw = width / k, sh = height / k;
      g.drawImage(el, (el.width - sw) / 2, (el.height - sh) / 2, sw, sh, 0, 0, width, height);
      bd.dispose(); ok = true;
    } catch (e) { ok = false; }
  }
  if (!ok) {
    const gr = g.createLinearGradient(0, 0, 0, height); L.sky.forEach((col, i) => gr.addColorStop([0, 0.45, 0.8, 1][i], col)); g.fillStyle = gr; g.fillRect(0, 0, width, height);
    g.fillStyle = A[3]; g.beginPath(); g.moveTo(0, height); for (let x = 0; x <= width; x += width / 12) g.lineTo(x, height * (0.62 + 0.12 * Math.sin(x * 0.05 + w))); g.lineTo(width, height); g.fill();
  }
  ctx.cache.set(key, c);
  return c;
}

const ICON_ART = {
  1: a => `<path d="M14 18h36l-5 16H19z" fill="${a[3]}" stroke="${a[0]}" stroke-width="3"/><path d="M41 30c6 6 6 14 0 20-6-6-6-14 0-20z" fill="${a[1]}"/><path d="M38 34l-4 14" stroke="${a[0]}" stroke-width="3"/>`,
  2: a => `<circle cx="32" cy="30" r="15" fill="${a[1]}"/><path d="M6 46l10-12 6 6 8-14 10 12 6-6 12 14z" fill="${a[3]}"/>`,
  3: a => `<path d="M12 50V26h8v24M24 50V14h10v36M38 50V22h8v28" fill="#140a2a" stroke="${a[1]}" stroke-width="3"/><path d="M40 12a8 8 0 1 0 10 10a7 7 0 0 1-10-10z" fill="${a[0]}"/>`,
  4: a => `<path d="M32 12v34M22 20h20M18 38c2 10 26 10 28 0" fill="none" stroke="${a[1]}" stroke-width="5" stroke-linecap="round"/><path d="M46 8l-6 12h6l-8 12" fill="none" stroke="${a[0]}" stroke-width="3"/>`,
  5: a => `<path d="M6 50l18-28 8 10 8-16 18 34z" fill="${a[3]}"/><path d="M24 22l6 8 4-4 6-10 6 12" fill="none" stroke="${a[0]}" stroke-width="4"/><path d="M48 10v12M42 16h12M44 12l8 8M52 12l-8 8" stroke="${a[0]}" stroke-width="2"/>`,
  6: a => `<circle cx="44" cy="20" r="9" fill="${a[0]}"/><path d="M14 44c0-10 6-16 14-16s14 6 14 16l-4 6H18z" fill="#e8dcc0"/><circle cx="23" cy="40" r="3.5" fill="${a[3]}"/><circle cx="33" cy="40" r="3.5" fill="${a[3]}"/><path d="M16 30l-6-8M40 30l6-8" stroke="#e8dcc0" stroke-width="4"/>`,
  7: a => `<path d="M26 52l2-30h8l2 30z" fill="${a[0]}" stroke="${a[3]}" stroke-width="2"/><path d="M28 30h8M27 40h10" stroke="#c8322a" stroke-width="4"/><rect x="26" y="14" width="12" height="8" fill="${a[1]}"/><path d="M38 16l20-6v14z" fill="${a[1]}" opacity="0.6"/>`,
  8: a => `<circle cx="32" cy="32" r="13" fill="${a[2]}"/><ellipse cx="32" cy="32" rx="26" ry="8" fill="none" stroke="${a[0]}" stroke-width="3" transform="rotate(-18 32 32)"/>`,
  9: a => `<path d="M8 52l16-26h16l16 26z" fill="#1a0c08" stroke="${a[2]}" stroke-width="3"/><path d="M26 26l-6-12M32 24V8M38 26l6-12" stroke="${a[1]}" stroke-width="4" stroke-linecap="round"/><path d="M28 28l-4 22M36 28l4 22" stroke="${a[2]}" stroke-width="3"/>`,
  10: a => `<path d="M32 36v20" stroke="#e8e0d8" stroke-width="4"/><circle cx="32" cy="24" r="16" fill="${a[2]}"/><path d="M32 24m-10 0a10 10 0 0 1 20 0a6 6 0 0 1-12 0a2 2 0 0 1 4 0" fill="none" stroke="#8cff3a" stroke-width="3"/><path d="M40 12l-4 8 5 4-4 6" fill="none" stroke="#1a0a14" stroke-width="2.5"/>`,
  11: a => `<path d="M14 44c4-14 14-20 26-18 8 2 12 8 12 14-8 6-20 10-38 4z" fill="#0e3f46"/><path d="M38 28c0-10 6-16 14-16" fill="none" stroke="${a[2]}" stroke-width="3"/><circle cx="52" cy="12" r="5" fill="${a[0]}"/><circle cx="42" cy="36" r="3" fill="${a[1]}"/><path d="M18 44l4-4 4 4 4-4 4 4" fill="none" stroke="${a[0]}" stroke-width="2"/>`,
  12: a => `<path d="M20 54V24l4-4h16l4 4v30z" fill="#3e3a46" stroke="${a[2]}" stroke-width="3"/><path d="M18 24h28M22 18v6M30 18v6M38 18v6" stroke="${a[2]}" stroke-width="3"/><path d="M36 4l-10 16h8l-6 14" fill="none" stroke="${a[1]}" stroke-width="4" stroke-linejoin="round"/>`,
};
function icon(w) {
  const a = accent(w), art = ICON_ART[w] || ICON_ART[1];
  /* a riveted steel roundel with the world's own emblem, no letters */
  return `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><circle cx="32" cy="32" r="30" fill="${a[3]}" stroke="#6b727e" stroke-width="3"/><circle cx="32" cy="32" r="25" fill="#1a1c21" stroke="${a[2]}" stroke-width="2"/>` +
    `<circle cx="32" cy="5" r="1.8" fill="#c7ccd5"/><circle cx="32" cy="59" r="1.8" fill="#c7ccd5"/><circle cx="5" cy="32" r="1.8" fill="#c7ccd5"/><circle cx="59" cy="32" r="1.8" fill="#c7ccd5"/>` + art(a) + `</svg>`;
}

/* ---------- dev preview: ?scene=dev:worlds-tour&level=N&s=metres&fly=1&h=height ---------- */
VROOM.scenes['dev:worlds-tour'] = (() => {
  let rig = null, st = null, track = null, cam = null, s0 = 60, fly = false, hgt = 5, lat = 0;
  return {
    id: 'dev:worlds-tour', dom: null, view: null,
    enter() {
      const ctx = VROOM.game.ctx, T = ctx.THREE, q = new URLSearchParams(location.search), n = +q.get('level') || 5;
      const spec = VROOM.levels.level(n); track = VROOM.sim.buildTrack(spec);
      st = VROOM.sim.newRace(track, VROOM.sim.carParams(VROOM.catalog.stats(VROOM.save.state), {}), { seed: spec.seed, mode: 'race', monsters: false });
      rig = buildWorld(ctx, track, spec);
      cam = new T.PerspectiveCamera(62, 1200 / 700, 0.1, 6000);
      s0 = +q.get('s') || 60; fly = q.get('fly') === '1'; hgt = +q.get('h') || 5; lat = +q.get('d') || 0;
      this.view = { scene: rig.scene, camera: cam };
    },
    update(dt, t) {
      const s = fly ? (s0 + t * 30) % (track.length - 30) : s0;
      const p = VROOM.sim.toWorld(track, s, lat, hgt), a = VROOM.sim.toWorld(track, Math.min(track.length - 1, s + 26), lat * 0.5, 1.6);
      cam.position.set(p[0], p[1], p[2]); cam.lookAt(a[0], a[1], a[2]);
      const c = st.car; c.x = p[0]; c.y = p[1] - hgt; c.z = p[2]; c.speed = 0;
      rig.update(st, dt, t, cam);
    },
    exit() { if (rig) rig.dispose(); rig = null; this.view = null; },
  };
})();

VROOM.worlds = { buildWorld, backdrop, accent, icon, card, LOOK };
