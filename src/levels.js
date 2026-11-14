/* levels: the 12 worlds' physics constants and all 120 level specs. Owner: worlds. DOM-free (sim region).
   SCAFFOLD STUB: a short placeholder course per level built only from the contracts PIECES vocabulary.
   The worlds builder authors the real courses (docs/OVERHAUL.md "Worlds" and "Levels"), keeping
   level(n) deterministic: same n, same spec, in every engine (use VROOM.dmath.hash01, never Math.random). */

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

const cache = new Map();
function level(n) {
  if (cache.has(n)) return cache.get(n);
  const w = n === C.PARADE_LEVEL ? 12 : C.worldOf(n), W = WORLDS[w], seed = (Math.imul(n, 2654435761) >>> 0) || 1, R = k => M.hash01(n, k, 77);
  const pieces = [{ type: 'straight', len: 60 }];
  for (let k = 0; k < 6; k++) {
    const turn = (R(k) - 0.5) * 1.6;
    pieces.push({ type: 'bend', len: 80, angle: turn, bank: -turn * 0.2 });
    pieces.push(k % 3 === 2 ? { type: 'ramp', len: 20, rise: 2, lip: 0.25 } : { type: 'hill', len: 60, rise: (R(k + 9) - 0.5) * 12 });
    if (k % 3 === 2) pieces.push({ type: 'gap', len: 14, drop: 2 });
  }
  pieces.push({ type: 'straight', len: 80 });
  const stars = [], props = [], monsters = [];
  for (let k = 0; k < 20; k++) stars.push({ s: 80 + k * 30, d: (R(k + 30) - 0.5) * 8, h: 1 });
  for (let k = 0; k < 6; k++) props.push({ cat: k % 2 ? 'cone' : 'boost', look: W.key + (k % 2 ? '.cone' : '.boost'), s: 150 + k * 90, d: (R(k + 50) - 0.5) * 6 });
  W.monsters.forEach((kind, k) => monsters.push({ kind, s: 250 + k * 250, d: 0, side: k % 2 ? 1 : -1 }));
  const spec = { n, world: w, seed, kind: n === C.PARADE_LEVEL ? 'parade' : C.isFinale(n) ? 'boss' : 'race', pieces, props, stars, monsters,
    boss: C.isFinale(n) ? { kind: W.boss, startS: -40 } : null, par: { S: 40, A: 50, B: 65 } };
  cache.set(n, spec);
  return spec;
}
/* endless free drive: segment k of a seeded run (the game appends segments as the car nears the end) */
function free(seed, k) {
  return { n: 0, world: 1 + (k % C.WORLD_COUNT), seed: (seed + k) >>> 0, kind: 'free', pieces: [{ type: 'straight', len: 200 }], props: [], stars: [], monsters: [], boss: null, par: { S: 0, A: 0, B: 0 } };
}

VROOM.levels = { WORLDS, level, free };
