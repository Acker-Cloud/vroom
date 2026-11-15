/* levels: the 12 worlds' physics constants and all 120 level specs. Owner: worlds. DOM-free (sim region).
   Every course is authored from the contracts PIECES vocabulary by a seeded course grammar: each world has
   its own mix of features (canyon jumps, city hairpins, dune rollers, chain bridges over cloud gaps ...),
   and difficulty climbs with the level number (narrower roads, longer gaps, more hazards, more monsters).
   level(n) is deterministic: same n, same spec, in every engine. Only VROOM.dmath is used for maths
   (hash01 for every choice, dsin / dcos for arcs), so this file ports to Swift with the sim.

   Course grammar
     start      a wide straight with the grid, no hazards for the first 60 m
     features   chosen from the world's weighted table (FEATURES below), gated by difficulty
     finish     a long straight run to the flag
   Placement rules that keep every level fair (tests/levels-check.cjs proves them):
     - nothing hard or slippery on ramps, gaps, loops, corkscrews, or within 25 m after a landing
     - at every s at least a 4.5 m lane stays clear of hard props
     - monsters wait beside the road (|d| > half width) and never inside a jump
   Par: par.A is the time a clean, fast run takes (paceOf below); S is tighter, B looser. The fairness
   suite proves the autopilot against them; if a level fails it, fix the content here, never the suite. */

const C = VROOM.contracts, M = VROOM.dmath;

/* world physics. gravity m/s2; airDrag 1/s on airborne speed; surf the default road surface.
   monsters: the creature kinds that live here (monsters.sim.js KINDS); boss: the finale chase. */
const WORLDS = {
  1:  { id: 1,  key: 'foundry',  gravity: 9.8,  airDrag: 0.02, surf: 'steel',   monsters: ['rivetrat', 'magnetmaw'],      boss: 'slagcolossus' },
  2:  { id: 2,  key: 'ember',    gravity: 9.8,  airDrag: 0.02, surf: 'dirt',    monsters: ['duskvulture', 'cliffjaw'],    boss: 'duskback' },
  3:  { id: 3,  key: 'neon',     gravity: 9.8,  airDrag: 0.02, surf: 'asphalt', monsters: ['grabber', 'neonhound'],       boss: 'lampmoth' },
  4:  { id: 4,  key: 'docks',    gravity: 9.8,  airDrag: 0.03, surf: 'asphalt', monsters: ['guttereel', 'docktoad'],      boss: 'bilgekraken' },
  5:  { id: 5,  key: 'frost',    gravity: 9.8,  airDrag: 0.02, surf: 'snow',    monsters: ['icewolf', 'snowbrute'],       boss: 'glaciergolem' },
  6:  { id: 6,  key: 'scorch',   gravity: 9.8,  airDrag: 0.02, surf: 'sand',    monsters: ['sandshark', 'stingtail'],     boss: 'gritmaw' },
  7:  { id: 7,  key: 'wreck',    gravity: 9.8,  airDrag: 0.02, surf: 'sand',    monsters: ['hermittank', 'gullswarm'],    boss: 'tidecrusher' },
  8:  { id: 8,  key: 'orbit',    gravity: 3.6,  airDrag: 0.0,  surf: 'steel',   monsters: ['voidgrub', 'droneswarm'],     boss: 'starmaw' },
  9:  { id: 9,  key: 'magma',    gravity: 9.8,  airDrag: 0.02, surf: 'asphalt', monsters: ['cinderbat', 'magmander'],     boss: 'moltentitan' },
  10: { id: 10, key: 'rotsugar', gravity: 9.8,  airDrag: 0.02, surf: 'sugar',   monsters: ['gumghoul', 'licorash'],       boss: 'sourjaw' },
  11: { id: 11, key: 'abyss',    gravity: 6.0,  airDrag: 0.25, surf: 'glass',   monsters: ['anglerlurk', 'jellymine'],    boss: 'trenchleviathan' },
  12: { id: 12, key: 'citadel',  gravity: 8.0,  airDrag: 0.04, surf: 'steel',   monsters: ['gargohawk', 'cloudwraith'],   boss: 'tempestwyrm' },
};

/* per-world course character: feature weights, the slippery patch, the hard obstacles, surfaces for
   variety sections, deco tags the renderer dresses (tunnel = covered, bridge = over a drop, pipe = foundry duct) */
const STYLE = {
  1:  { patch: ['oil', 'slick'], hard: ['wreck', 'girder', 'slagdrum'], rock: 'slagheap', alt: 'asphalt', tunnel: 'pipe',
        f: { run: 3, sweep: 3, hairpin: 1, chicane: 2, jump: 3, rollers: 1.5, gauntlet: 3, tunnel: 1.2, rumble: 2, hill: 1, megajump: 0.8, split: 1, corkscrew: 0.5 } },
  2:  { patch: ['oil', 'tarpit'], hard: ['boulder', 'deadtree', 'totem'], rock: 'boulder', alt: 'asphalt', tunnel: 'tunnel',
        f: { sweep: 3, jump: 4, bridge: 3, hill: 2, rollers: 2, hairpin: 2, chicane: 1, drop: 2, megajump: 1.5, run: 1, gauntlet: 1.2 } },
  3:  { patch: ['oil', 'slick'], hard: ['jersey', 'wreck', 'hydrant'], rock: 'rubble', alt: 'steel', tunnel: 'tunnel',
        f: { citycorner: 3, chicane: 3, split: 3, run: 2, jump: 2, tunnel: 2, bowl: 1, gauntlet: 2, loop: 0.7, corkscrew: 0.8, hairpin: 1 } },
  4:  { patch: ['water', 'puddle'], hard: ['container', 'bollard', 'crateStack'], rock: 'buoy', alt: 'steel', tunnel: 'tunnel',
        f: { run: 2, gauntlet: 3, jump: 3, bridge: 2.5, sweep: 2, chicane: 2, rumble: 2, split: 1, hairpin: 1, megajump: 0.6 } },
  5:  { patch: ['ice', 'sheet'], hard: ['iceblock', 'frozenwreck', 'icespike'], rock: 'snowboulder', alt: 'ice', tunnel: 'tunnel',
        f: { sweep: 3, drop: 3, hill: 2, hairpin: 2, gauntlet: 2, tunnel: 2, jump: 2, bowl: 1, corkscrew: 1, megajump: 1 } },
  6:  { patch: ['mud', 'sandtrap'], hard: ['bone', 'tanker', 'cactus'], rock: 'sandrock', alt: 'asphalt', tunnel: 'tunnel',
        f: { rollers: 4, jump: 3, sweep: 2, gauntlet: 2, run: 2, megajump: 2, bowl: 1, halfpipe: 1 } },
  7:  { patch: ['water', 'tidepool'], hard: ['anchor', 'hullplate', 'drum'], rock: 'blackrock', alt: 'dirt', tunnel: 'tunnel',
        f: { rollers: 2, sweep: 3, gauntlet: 2, jump: 3, bridge: 2, split: 1, halfpipe: 1.5, hairpin: 1, megajump: 0.8 } },
  8:  { patch: ['oil', 'coolant'], hard: ['debris', 'satellite', 'panel'], rock: 'asteroid', alt: 'glass', tunnel: 'tunnel',
        f: { jump: 4, megajump: 3, corkscrew: 3, loop: 2, bowl: 1, split: 1, run: 1, halfpipe: 1, sweep: 1 } },
  9:  { patch: ['oil', 'cinderslick'], hard: ['obsidian', 'crucible', 'spire'], rock: 'lavarock', alt: 'steel', tunnel: 'tunnel',
        f: { bridge: 3, jump: 3, gauntlet: 3, hairpin: 2, sweep: 2, megajump: 1.5, corkscrew: 1, loop: 1, drop: 1 } },
  10: { patch: ['mud', 'taffy'], hard: ['jawbreaker', 'caneRail', 'gumball'], rock: 'jawbreaker', alt: 'asphalt', tunnel: 'tunnel',
        f: { halfpipe: 3, loop: 2, corkscrew: 2, gauntlet: 3, chicane: 2, jump: 2, rollers: 2, bowl: 1.5, split: 1 } },
  11: { patch: ['oil', 'ink'], hard: ['coral', 'subwreck', 'clam'], rock: 'seastone', alt: 'steel', tunnel: 'tunnel',
        f: { sweep: 3, corkscrew: 3, hill: 2, jump: 2, gauntlet: 2, halfpipe: 2, loop: 1, rollers: 1 } },
  12: { patch: ['water', 'puddle'], hard: ['statue', 'ironblock', 'chainpost'], rock: 'floatrock', alt: 'cloud', tunnel: 'tunnel',
        f: { jump: 3, megajump: 2, bridge: 3, corkscrew: 2, loop: 1.5, hairpin: 2, split: 1.5, gauntlet: 2, bowl: 1, halfpipe: 1, sweep: 1 } },
};
/* features that need a minimum difficulty (0..1 over the whole game) before they appear */
const GATE = { megajump: 0.14, corkscrew: 0.2, loop: 0.3, halfpipe: 0.22, split: 0.12, bowl: 0.15, drop: 0.05, hairpin: 0.04, citycorner: 0 };

const PI = Math.PI;
const clamp = M.clamp;
const r1 = x => Math.round(x * 10) / 10;
const r2 = x => Math.round(x * 100) / 100;

/* ---- the course builder: pieces end to end, with every placement relative to a piece's start ---- */
function builder(n, w, seed) {
  let ctr = 0;
  const B = {
    n, w, W: WORLDS[w], S: STYLE[w], seed,
    pieces: [], props: [], stars: [], monsters: [], s: 0, hw: 8,
    safe: [],       /* [s0, s1]: no hard props, patches or monsters (jumps, loops, corkscrews, landings) */
    slots: [],      /* [s0, s1, side]: stretches a monster may wait beside */
    R: () => M.hash01(seed, ctr++, 911),
    pick(list) { return list[Math.floor(B.R() * list.length) % list.length]; },
    between(a, b) { return a + (b - a) * B.R(); },
    sign() { return B.R() < 0.5 ? -1 : 1; },
    piece(type, len, args = {}) {
      const p = { type, len: Math.round(len), ...args };
      if (p.w === undefined) p.w = B.hw;
      const s0 = B.s;
      B.pieces.push(p);
      B.s += type === 'loop' ? Math.round(2 * PI * p.radius) : p.len;
      B.hw = p.w;
      return s0;
    },
    star(s, d, h = 1.1) { B.stars.push({ s: r1(s), d: r1(d), h: r1(h) }); },
    starLine(s0, s1, d0, d1, k, h = 1.1) { for (let i = 0; i < k; i++) { const u = k > 1 ? i / (k - 1) : 0.5; B.star(s0 + (s1 - s0) * u, d0 + (d1 - d0) * u, h); } },
    prop(cat, thing, s, d, extra) { B.props.push({ cat, look: B.W.key + '.' + thing, s: r1(s), d: r1(d), ...extra }); },
    noHaz(s0, s1) { B.safe.push([s0, s1]); },
    clear(s0, s1) { return !B.safe.some(([a, b]) => s1 > a && s0 < b); },
    slot(s0, s1) { if (s1 - s0 > 30) B.slots.push([s0, s1]); },
  };
  return B;
}

/* ---- features. Each appends pieces and places what lives on them. d is difficulty 0..1 ---- */
const F = {
  run(B, d) {
    const len = B.between(70, 130), s0 = B.piece('straight', len, { w: B.hw });
    const k = 3 + Math.floor(B.R() * 2), side = B.sign() * B.R() * (B.hw - 2.5);
    B.starLine(s0 + 15, s0 + len - 20, -side, side, k);
    if (B.R() < 0.6) B.prop('boost', 'pad', s0 + len * 0.5, B.R() < 0.5 ? 0 : side * 0.6);
    if (B.R() < 0.7) crates(B, s0 + len * 0.75, -side * 0.7, d);
    B.slot(s0 + 10, s0 + len - 10);
  },
  sweep(B, d) {
    const sg = B.sign(), ang = sg * B.between(0.45, 0.8 + d * 0.5), len = B.between(100, 160), w = B.hw;
    const s0 = B.piece('bend', len, { angle: r2(ang), bank: r2(sg * B.between(0.06, 0.16)), w });
    /* the racing line: outside, apex inside, outside */
    for (let i = 0; i < 4; i++) { const u = i / 3, line = -sg * (w - 2.5) * (1 - 2 * M.dsin(PI * u)); B.star(s0 + len * (0.1 + 0.8 * u), clamp(line, -w + 2, w - 2)); }
    if (B.R() < 0.4) B.prop('cone', 'cone', s0 + len * 0.5, sg * (w - 1.2));
    B.slot(s0 + 10, s0 + len - 10);
  },
  hairpin(B, d) {
    const sg = B.sign(), ang = sg * B.between(1.7, 2.3 + d * 0.5), len = B.between(110, 150), w = Math.max(6.5, B.hw);
    const a = B.piece('straight', 40, { w });
    for (let i = 0; i < 3; i++) B.prop('cone', 'cone', a + 8 + i * 12, -sg * (w - 1.0));
    const s0 = B.piece('bend', len, { angle: r2(ang), bank: r2(sg * B.between(0.12, 0.22)), w });
    B.starLine(s0 + len * 0.3, s0 + len * 0.7, sg * (w - 2.5), sg * (w - 2.5), 3);
    B.piece('straight', 30, { w: B.hw });
  },
  citycorner(B, d) {
    /* a hard city block: two near-90 degree turns the same way or a dogleg */
    const sg = B.sign(), w = Math.max(6, 7.5 - d * 1.2), same = B.R() < 0.5;
    B.piece('straight', B.between(40, 70), { w });
    const s0 = B.piece('bend', B.between(45, 60), { angle: r2(sg * B.between(1.3, 1.6)), bank: r2(sg * 0.06), w });
    B.starLine(s0 + 10, s0 + 40, sg * 3, sg * 3, 3);
    const mid = B.piece('straight', B.between(50, 90), { w });
    crates(B, mid + 25, -sg * 2.5, d);
    B.slot(mid, mid + 50);
    B.piece('bend', B.between(45, 60), { angle: r2((same ? sg : -sg) * B.between(1.2, 1.5)), bank: 0, w });
  },
  chicane(B, d) {
    const sg = B.sign(), a = B.between(0.55, 0.9 + d * 0.3), w = B.hw;
    const s0 = B.piece('bend', 55, { angle: r2(sg * a), bank: r2(sg * 0.08), w });
    const s1 = B.piece('bend', 55, { angle: r2(-sg * a), bank: r2(-sg * 0.08), w });
    B.star(s0 + 30, sg * 3); B.star(s1, 0); B.star(s1 + 25, -sg * 3);
    if (d > 0.25) B.prop('barrier', B.pick(B.S.hard), s1, sg * (w - 1.6));
  },
  rollers(B, d) {
    const k = 2 + Math.floor(B.R() * 3), w = B.hw;
    for (let i = 0; i < k; i++) {
      const len = B.between(40, 60), h = B.between(1.4, 2.2 + d * 1.4), s0 = B.piece('crest', len, { h: r1(h), w });
      B.star(s0 + len / 2, (B.R() - 0.5) * (w - 3), i % 2 ? 3.4 : 1.4);
    }
    B.noHaz(B.s - 10, B.s + 15);
  },
  hill(B, d) {
    const len = B.between(110, 160), rise = B.sign() * B.between(8, 14 + d * 10), s0 = B.piece('hill', len, { rise: r1(rise), w: B.hw });
    B.starLine(s0 + 20, s0 + len - 20, -2, 2, 3);
    B.slot(s0 + 20, s0 + len - 20);
  },
  drop(B, d) {
    const len = B.between(130, 180), s0 = B.piece('hill', len, { rise: r1(-B.between(16, 26 + d * 10)), w: B.hw });
    B.starLine(s0 + 20, s0 + len - 20, 3, -3, 4);
    B.prop('boost', 'pad', s0 + len * 0.3, 0);
    B.slot(s0 + 20, s0 + len - 20);
  },
  jump(B, d) {
    const w = B.hw, a = B.piece('straight', 36, { w });
    if (d > 0.2 || B.R() < 0.5) B.prop('boost', 'pad', a + 16, 0);
    else B.prop('nitro', 'nitro', a + 18, 0);
    const rise = B.between(2.4, 3.4 + d * 1.2), lip = B.between(0.22, 0.3 + d * 0.06);
    const r0 = B.piece('ramp', 22, { rise: r1(rise), lip: r2(lip), w });
    const gl = Math.round(B.between(10, 12) + d * 12), drop = r1(B.between(0.5, 3 + d * 3));
    const g0 = B.piece('gap', gl, { drop, w });
    arc(B, g0, gl, lip, 27, drop);
    const l0 = B.piece('straight', 46, { w });
    B.noHaz(r0 - 6, l0 + 28);
    B.slot(l0 + 28, l0 + 46);
  },
  megajump(B, d) {
    const w = Math.max(7, B.hw), a = B.piece('straight', 50, { w });
    B.prop('boost', 'pad', a + 14, 0); B.prop('boost', 'pad', a + 34, 0);
    const lip = B.between(0.34, 0.4), r0 = B.piece('ramp', 32, { rise: r1(B.between(5, 7)), lip: r2(lip), w });
    const gl = Math.round(B.between(22, 28) + d * 10), drop = r1(B.between(6, 10 + d * 4));
    const g0 = B.piece('gap', gl, { drop, w: w + 1 });
    arc(B, g0, gl, lip, 33, drop);
    const l0 = B.piece('straight', 60, { w: w + 1 });
    B.prop('nitro', 'nitro', l0 + 40, 0);
    B.noHaz(r0 - 6, l0 + 34);
  },
  corkscrew(B, d) {
    const w = Math.max(6.5, B.hw - 0.5), a = B.piece('straight', 34, { w });
    B.prop('boost', 'pad', a + 12, 0);
    const len = B.between(120, 160), s0 = B.piece('corkscrew', len, { turns: B.sign(), w });
    B.starLine(s0 + 20, s0 + len - 20, 0, 0, 5);
    const e = B.piece('straight', 40, { w });
    B.noHaz(a + 20, e + 20);
  },
  loop(B, d) {
    const w = Math.max(6.5, B.hw - 0.5), a = B.piece('straight', 70, { w });
    B.prop('boost', 'pad', a + 20, 0); B.prop('boost', 'pad', a + 45, 0);
    const radius = Math.round(B.between(11, 14)), s0 = B.piece('loop', 0, { radius, w });
    const L = Math.round(2 * PI * radius);
    B.starLine(s0 + L * 0.3, s0 + L * 0.7, 0, 0, 3);
    const e = B.piece('straight', 50, { w });
    B.noHaz(a + 30, e + 30);
  },
  halfpipe(B, d) {
    const w = Math.max(8, B.hw + 1.5), len = B.between(110, 160), s0 = B.piece('halfpipe', len, { wallH: r1(B.between(3, 4.5)), w });
    for (let i = 0; i < 5; i++) B.star(s0 + 12 + i * (len - 24) / 4, (i % 2 ? 1 : -1) * (w - 3.5), 1.4);
    B.noHaz(s0, s0 + len);
  },
  split(B, d) {
    /* the sim widens the road by sep / 2 and builds a median of half width sep / 2 - w: two w-wide lanes */
    const w = r1(B.between(5, 5.6)), sep = r1(w * 2 + B.between(2.5, 4)), len = B.between(130, 190);
    B.piece('straight', 30, { w });   /* funnel to the lane width first, so the median opens at full size */
    const s0 = B.piece('split', len, { sep, w }), sg = B.sign(), lane = sep / 2;
    B.starLine(s0 + 25, s0 + len - 25, sg * lane, sg * lane, 5);
    B.prop('boost', 'pad', s0 + len * 0.35, -sg * lane); B.prop('boost', 'pad', s0 + len * 0.65, -sg * lane);
    if (d > 0.3) B.prop('crate', 'scrapbox', s0 + len * 0.5, sg * lane);
    B.noHaz(s0 - 30, s0 + len + 30);
    B.piece('straight', 30, { w: r1(w + 1.5) });
  },
  rumble(B, d) {
    const len = B.between(60, 100), s0 = B.piece('rumble', len, { amp: r2(B.between(0.14, 0.24 + d * 0.1)), wave: r1(B.between(3, 5)), w: B.hw });
    B.starLine(s0 + 10, s0 + len - 10, 0, 0, 2);
    B.slot(s0, s0 + len);
  },
  bowl(B, d) {
    const sg = B.sign(), w = Math.max(8, B.hw), len = B.between(170, 230);
    const s0 = B.piece('banked', len, { angle: r2(sg * B.between(2.2, 3.0)), bank: r2(sg * B.between(0.28, 0.4)), w });
    B.starLine(s0 + 20, s0 + len - 20, sg * (w - 3), sg * (w - 3), 5);
    B.prop('nitro', 'nitro', s0 + len / 2, -sg * (w - 3));
    B.slot(s0 + 20, s0 + len - 20);
  },
  gauntlet(B, d) {
    const w = Math.max(7, B.hw), len = B.between(140, 190), s0 = B.piece('straight', len, { w });
    /* slalom: hard props alternate sides, always leaving more than half the road open, 32 m or more apart.
       Mines sit in a barrier's shadow (just past it, on its side), where only a corner cut finds them. */
    const gapS = 42 - d * 10;
    let side = B.sign(), s = s0 + 22, k = 0;
    for (; s < s0 + len - 18; s += gapS, k++) {
      B.prop('barrier', B.pick(B.S.hard), s, side * (w - 2.6));
      if (d > 0.35 && B.R() < 0.5) B.prop('crate', 'scrapbox', s + gapS / 2, -side * (w - 2.2));
      if ((d > 0.45 && k === 1) || (d > 0.7 && k === 3)) B.prop('mine', 'mine', s + 8, side * (w - 2.4));
      side = -side;
    }
    const [pc, pl] = B.S.patch;
    B.prop(pc, pl, s0 + len * 0.45, r1((B.R() - 0.5) * (w - 4)));
    B.starLine(s0 + 20, s0 + len - 20, 0, 0, 4);
    B.slot(s0 + 20, s0 + len - 10);
  },
  bridge(B, d) {
    const w = Math.max(6, B.hw - 1), len = B.between(80, 130);
    const s0 = B.piece('straight', len, { w, deco: 'bridge' });
    B.starLine(s0 + 12, s0 + len - 12, 0, 0, 4);
    if (d > 0.3 && B.R() < 0.5) {
      /* a broken span: a ramp and a short hop in the middle of the bridge */
      const r0 = B.piece('ramp', 18, { rise: 2, lip: 0.24, w, deco: 'bridge' });
      const gl = Math.round(9 + d * 6), g0 = B.piece('gap', gl, { drop: 1, w });
      arc(B, g0, gl, 0.24, 25, 1);
      const l0 = B.piece('straight', 50, { w, deco: 'bridge' });
      B.noHaz(r0 - 6, l0 + 28);
    } else B.prop('nitro', 'nitro', s0 + len - 10, 0);
  },
  tunnel(B, d) {
    const w = B.hw, len = B.between(110, 170), sg = B.sign(), deco = B.S.tunnel;
    const s0 = B.piece('bend', len, { angle: r2(sg * B.between(0.3, 0.7)), bank: r2(sg * 0.08), w, deco });
    B.starLine(s0 + 15, s0 + len - 15, -sg * 2, sg * 2, 4);
    B.slot(s0 + 20, s0 + len - 20);
  },
};

/* stars along the expected flight over a gap: launch speed v off a lip of pitch lip, world gravity */
function arc(B, g0, gl, lip, v, drop) {
  const g = B.W.gravity, vx = v * M.dcos(lip), vy = v * M.dsin(lip);
  for (let i = 1; i <= 3; i++) {
    const x = gl * i / 4, t = x / vx, y = vy * t - 0.5 * g * t * t;
    B.star(g0 + x, 0, Math.max(0.6, y + 1.0));
  }
  if (drop > 6) B.star(g0 + gl + 6, 0, 1.2);
}
function crates(B, s, d, diff) {
  const k = 2 + Math.floor(B.R() * (2 + diff * 3));
  for (let i = 0; i < k; i++) B.prop('crate', 'scrapbox', s + (i >> 1) * 2.2, d + (i & 1 ? 1.6 : 0));
}

/* ---- par: a pace model of a fast clean run (metres per second per piece), surface and world scaled ---- */
const SURF_PACE = { asphalt: 1, steel: 1, dirt: 0.95, sand: 0.9, mud: 0.8, ice: 0.82, snow: 0.9, oil: 0.85, water: 0.88, lava: 0.9, glass: 1, cloud: 0.9, sugar: 0.92 };
const V_TOP = 36;     /* a fast run's cruising speed on a straight, m/s */
const A_LAT = 8.5;    /* lateral grip a good line uses, m/s2 */
function paceOf(p, W) {
  let v = V_TOP;
  if (p.type === 'bend' || p.type === 'banked') {
    const R = p.len / Math.max(0.05, Math.abs(p.angle)), bank = Math.abs(p.bank || 0);
    v = Math.min(V_TOP, Math.sqrt(A_LAT * (W.gravity / 9.8) * (1 + bank * 1.5) * R));   /* grip scales with gravity */
  }
  if (p.type === 'corkscrew') v = 27;
  if (p.type === 'loop') v = 25;
  if (p.type === 'halfpipe') v = 30;
  if (p.type === 'rumble') v = 28;
  if (p.type === 'crest') v = 32;
  if (p.type === 'split') v = 33;
  if (p.type === 'ramp' || p.type === 'gap') v = 32;
  const sv = SURF_PACE[p.surf || W.surf] || 1;
  return v * sv * (W.airDrag > 0.1 ? 0.9 : 1);
}
function parOf(pieces, W, props, boss, monsters) {
  let t = 3.0;   /* the launch from the grid */
  pieces.forEach((p, i) => {
    const q = pieces[i + 1];
    if (p.type === 'ramp' && q && q.type === 'gap') {
      /* a jump: a good run arrives just over the speed that clears the gap (slow in low gravity), then rebuilds */
      const lip = Math.max(0.12, p.lip || 0.25), need = Math.sqrt(W.gravity * q.len / M.dsin(2 * lip)), jv = Math.min(V_TOP, need * 1.15 + 4);
      t += (p.len + q.len) / jv + 110 * Math.max(0, 1 / jv - 1 / V_TOP);
      return;
    }
    if (p.type === 'gap' && i > 0 && pieces[i - 1].type === 'ramp') return;
    t += (p.type === 'loop' ? 2 * PI * p.radius : p.len) / paceOf(p, W);
  });
  for (const q of props) {
    const k = C.PROP_CAT[q.cat].kind;
    if (k === 'patch') t += 0.25;
    if (k === 'hard' || k === 'trap') t += 0.4;   /* every dodge costs a little line */
  }
  t += 0.6 * monsters;   /* a lunge or two lands even on a good run */
  if (boss) t *= 1.08;   /* the boss knocks you about */
  const r = x => Math.round(x * 10) / 10;
  return { S: r(t * 0.82), A: r(t * 1.06), B: r(t * 1.3) };
}

/* ---- the level ---- */
function lengthFor(w, k, boss) {
  /* courses grow through world 3, then get harder, not longer. Low gravity and thick water are slow going
     (soft corners, floaty jumps), so those courses are shorter to keep the same race time. */
  const L = (w <= 3 ? 1150 + (w - 1) * 450 + k * 40 : 2150 + k * 35) * (w === 8 ? 0.8 : w === 11 ? 0.9 : 1);
  return boss ? L + 120 : L;
}
function weighted(B, d) {
  const tbl = B.S.f, keys = Object.keys(tbl).filter(k => (GATE[k] || 0) <= d);
  let total = 0;
  for (const k of keys) total += tbl[k];
  let x = B.R() * total;
  for (const k of keys) { x -= tbl[k]; if (x <= 0) return k; }
  return keys[keys.length - 1];
}
function course(B, d, target, opts = {}) {
  const base = B.hw = r1(8 - d * 1.8);
  const s0 = B.piece('straight', opts.free ? 30 : 60, { w: B.hw });
  B.noHaz(s0, s0 + 60);
  if (!opts.free) B.starLine(30, 55, 0, 0, 3);
  let last = '', prev2 = '';
  const intro = opts.intro || [];
  for (const k of intro) { F[k](B, d); B.hw = base; prev2 = last; last = k; }
  while (B.s < target - 140) {
    let k = weighted(B, d);
    for (let tries = 0; (k === last || (k === prev2 && B.R() < 0.5)) && tries < 6; tries++) k = weighted(B, d);
    /* world 11 rides a glass tube: most open-air pieces get the tunnel deco */
    F[k](B, d);
    B.hw = base;   /* every feature hands the next one the course's own width (pieces ease between widths) */
    prev2 = last; last = k;
  }
  const f0 = B.piece('straight', opts.free ? 60 : 140, { w: r1(base + 1) });
  if (!opts.free) { B.starLine(f0 + 20, f0 + 70, -3, 3, 4); B.prop('boost', 'pad', f0 + 30, 0); }
  B.noHaz(f0 + 60, f0 + 140);
}
function tube(B) {
  /* open air around every jump: the tube ends before a ramp and starts again after the landing straight */
  const P = B.pieces, open = t => t === 'gap' || t === 'ramp' || t === 'loop' || t === 'halfpipe' || t === 'split' || t === 'crest';
  P.forEach((p, i) => {
    if (p.deco !== undefined || open(p.type)) return;
    if ((P[i + 1] && open(P[i + 1].type)) || (P[i - 1] && P[i - 1].type === 'gap')) return;
    p.deco = 'tunnel';
  });
}
function surfaces(B, d) {
  /* a world's alternate surface on a few straights and bends for variety (ice on the pass, cloud on the citadel ...) */
  const alt = B.S.alt;
  B.pieces.forEach((p, i) => {
    if (i < 2 || i > B.pieces.length - 3 || p.surf || p.type === 'gap' || p.type === 'loop' || p.type === 'ramp') return;
    if ((p.type === 'straight' || p.type === 'bend' || p.type === 'rumble') && M.hash01(B.seed, i, 4242) < 0.12 + d * 0.1) p.surf = alt;
  });
}
function place(B, k, boss) {
  /* monsters: one kind early, both later, more of them as the world goes on. Candidate spots are the
     middles (and thirds) of open pieces, away from every jump; picks keep 110 m apart. */
  const W = B.W, want = 1 + Math.floor(k * 0.55) + (B.w > 6 ? 1 : 0), cand = [];
  let a = 0;
  for (const p of B.pieces) {
    const len = p.type === 'loop' ? Math.round(2 * PI * p.radius) : p.len;
    if (len >= 40 && (p.type === 'straight' || p.type === 'bend' || p.type === 'hill' || p.type === 'banked' || p.type === 'rumble' || p.type === 'crest'))
      for (const f of len > 90 ? [0.25, 0.5, 0.75] : [0.5]) { const s = a + len * f; if (s > 140 && s < B.s - 180 && B.clear(s - 12, s + 12)) cand.push(r1(s)); }
    a += len;
  }
  const order = cand.map((s, i) => [M.hash01(B.seed, i, 5151), s]).sort((x, y) => x[0] - y[0]).map(x => x[1]);
  const used = [];
  for (const s of order) {
    if (used.length >= want) break;
    if (used.some(u => Math.abs(u - s) < 110)) continue;
    used.push(s);
  }
  used.sort((x, y) => x - y).forEach((s, i) => {
    const kind = k <= 2 ? W.monsters[0] : W.monsters[i % 2], side = M.hash01(B.seed, i, 6161) < 0.5 ? -1 : 1;
    B.monsters.push({ kind, s, d: r1(side * (hwAt(B, s) + 4)), side });
  });
  /* nitro: one every ~500 m on a clear straight-ish stretch */
  for (let s = 400; s < B.s - 300; s += 520) if (B.clear(s - 5, s + 5)) B.prop('nitro', 'nitro', s, r1((M.hash01(B.seed, s, 7171) - 0.5) * 6));
  /* roadside cones and rocks as dressing the car can clip (soft only) */
  for (let s = 120; s < B.s - 150; s += 180) if (B.clear(s - 4, s + 4)) B.prop('cone', 'cone', s, (M.hash01(B.seed, s, 8181) < 0.5 ? -1 : 1) * (hwAt(B, s) - 0.9));
  /* drop props that fell into a jump or off the road (features place before they know the next piece) */
  B.props = B.props.filter(p => {
    const kind = C.PROP_CAT[p.cat].kind, hw = hwAt(B, p.s), hard = kind === 'hard' || kind === 'patch' || kind === 'trap';
    if (hard && !B.clear(p.s - 4, p.s + 4)) return false;
    if (inGap(B, p.s, 3) || p.s < 60 || p.s > B.s - 30) return false;
    p.d = r1(clamp(p.d, -hw + 1, hw - 1));
    return true;
  });
  B.stars = B.stars.filter(s => s.s > 20 && s.s < B.s - 25);
  if (boss) B.monsters = B.monsters.filter(m => m.s > 300);
}
function pieceAt(B, s) {
  let a = 0;
  for (const p of B.pieces) { const L = p.type === 'loop' ? Math.round(2 * PI * p.radius) : p.len; if (s < a + L) return { p, a, L }; a += L; }
  return { p: B.pieces[B.pieces.length - 1], a: a - 1, L: 1 };
}
function hwAt(B, s) { return pieceAt(B, s).p.w; }
function inGap(B, s, m) { const q = pieceAt(B, s); return q.p.type === 'gap' || (pieceAt(B, s + m).p.type === 'gap') || (pieceAt(B, Math.max(0, s - m)).p.type === 'gap'); }

const cache = new Map();
function level(n) {
  if (cache.has(n)) return cache.get(n);
  n = Math.round(n);
  const parade = n === C.PARADE_LEVEL;
  const w = parade ? 12 : C.worldOf(n), k = parade ? 3 : ((n - 1) % C.WORLD_SIZE) + 1, boss = !parade && C.isFinale(n);
  const seed = (Math.imul(n, 2654435761) >>> 0) || 1, B = builder(n, w, seed);
  /* difficulty over the whole game, with a bump on each world's last few levels */
  const d = parade ? 0.1 : clamp(((w - 1) * C.WORLD_SIZE + k - 1) / (C.MAX_LEVEL - 1) * 0.85 + (k >= 8 ? 0.06 : 0) + (boss ? 0.05 : 0), 0, 1);
  const intro = n === 1 ? ['sweep', 'run', 'jump', 'rollers'] : k === 1 ? [Object.keys(STYLE[w].f)[0]] : [];
  course(B, d, lengthFor(w, k, boss), { intro });
  if (w === 11) tube(B);
  surfaces(B, d);
  place(B, k, boss);
  if (parade) { B.monsters = []; B.props = B.props.filter(p => C.PROP_CAT[p.cat].kind !== 'hard' && p.cat !== 'mine'); }
  const spec = {
    n, world: w, seed, kind: parade ? 'parade' : boss ? 'boss' : 'race',
    pieces: B.pieces, props: B.props, stars: B.stars, monsters: B.monsters,
    boss: boss ? { kind: WORLDS[w].boss, startS: -40 } : null,
    par: parOf(B.pieces, WORLDS[w], B.props, boss, B.monsters.length),
  };
  cache.set(n, spec);
  return spec;
}
/* endless free drive: segment k of a seeded run (the game appends segments as the car nears the end).
   Each segment is a short course of the world k cycles through, without a grid or a flag. */
function free(seed, k) {
  const w = 1 + (((k % C.WORLD_COUNT) + C.WORLD_COUNT) % C.WORLD_COUNT), s = ((seed >>> 0) + Math.imul(k + 1, 40503)) >>> 0 || 1, B = builder(0, w, s);
  const d = clamp(0.15 + k * 0.04, 0, 0.8);
  course(B, d, 520, { free: true });
  if (w === 11) tube(B);
  B.props = B.props.filter(p => p.s > 40 && p.s < B.s - 20);
  return { n: 0, world: w, seed: s, kind: 'free', pieces: B.pieces, props: B.props, stars: B.stars.filter(q => q.s > 20), monsters: [], boss: null, par: { S: 0, A: 0, B: 0 } };
}

VROOM.levels = { WORLDS, level, free, STYLE };
