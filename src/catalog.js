/* catalog: every part's id, price and physical stats. Owner: cars. DOM-free, deterministic (sim region).
   SCAFFOLD STUB: every legacy id exists with placeholder stats so saves validate and the sim can run.
   The cars builder replaces the stats, adds the v13 roster to the NEW_* arrays (append only, forever)
   and keeps every legacy id (redesigned freely, see docs/OVERHAUL.md "Vehicle roster").
   Rules: v12 free parts stay price 0 (dump digger mixer fire monster; normal monster racing wheels;
   the first six colours; decal none; extras horn beacon flag). Buddies are never free if they were v12 buddies. */

const L = VROOM.contracts.LEGACY;

/* CarStats baseline: a 1.6 t brute on 1 m tyres. SI units. */
const BASE = { mass: 1600, wheelbase: 2.8, track: 1.9, cgH: 0.9, rideH: 0.55, wheelR: 0.5, suspK: 42000, suspC: 4200, suspTravel: 0.35,
  power: 260000, topSpeed: 42, grip: 1.05, driftGrip: 0.72, brake: 14, steerMax: 0.55, airControl: 2.2, boostPower: 120000, armor: 0.3,
  size: { l: 4.4, w: 2.2, h: 1.8 } };
const CLS = {
  hauler: { mass: 2400, power: 300000, topSpeed: 38, grip: 1.0, armor: 0.5 },
  brute:  { mass: 1900, wheelR: 0.75, rideH: 0.8, suspTravel: 0.55, topSpeed: 40, grip: 1.0, armor: 0.45 },
  racer:  { mass: 1100, wheelR: 0.36, rideH: 0.25, suspTravel: 0.18, power: 240000, topSpeed: 50, grip: 1.25, armor: 0.1 },
  hover:  { mass: 900, wheelR: 0.3, rideH: 0.6, topSpeed: 52, grip: 0.8, driftGrip: 0.6, airControl: 3.5, armor: 0.1 },
  tank:   { mass: 3200, power: 340000, topSpeed: 34, grip: 1.15, armor: 0.75 },
  freak:  { mass: 1500, topSpeed: 46, grip: 1.05, armor: 0.3 },
};
const BODY_CLS = { dump: 'hauler', digger: 'tank', mixer: 'hauler', fire: 'hauler', monster: 'brute', police: 'racer', race: 'racer', tractor: 'brute',
  icecream: 'hauler', rocket: 'racer', ufo: 'hover', limo: 'racer', dragon: 'freak', train: 'tank', royal: 'freak', bulldozer: 'tank',
  schoolbus: 'hauler', ambulance: 'hauler', submarine: 'freak', pirate: 'freak', dino: 'brute', unicorn: 'freak', hover: 'hover' };
const statsFor = cls => ({ ...BASE, ...CLS[cls], size: { ...BASE.size } });

const BODIES = {};
for (const id of L.BODY_ORDER) BODIES[id] = { id, cls: BODY_CLS[id], price: L.PRICES.body[id] || 0, stats: statsFor(BODY_CLS[id]) };
const WHEELS = {};
for (const id of L.WHEEL_ORDER) WHEELS[id] = { id, price: L.PRICES.wheels[id] || 0, r: id === 'monster' ? 0.8 : id === 'racing' ? 0.36 : 0.5, width: 0.4, grip: 1, mass: 30 };
const PAINTS = {};
for (const id of L.COLORS) PAINTS[id] = { id, price: L.PRICES.color[id] || 0, kind: id.startsWith('p:') ? 'pattern' : 'solid', base: id.startsWith('#') ? id : '#888888', metal: 0.5, rough: 0.5, secret: L.SECRET_COLORS.includes(id) };
const DECALS = {};
for (const id of L.DECAL_ORDER) DECALS[id] = { id, price: L.PRICES.decal[id] || 0 };
const EXTRAS = {};
for (const id of L.EXTRAS) EXTRAS[id] = { id, price: L.PRICES.extras[id] || 0, mods: {} };
const BUDDIES = {};
for (const id of L.BUDDY_ORDER) BUDDIES[id] = { id, price: 0 };

/* v13 additions, in append order. Once shipped an id never moves. */
const NEW_BODY_IDS = [], NEW_WHEEL_IDS = [], NEW_PAINT_IDS = [], NEW_DECAL_IDS = [], NEW_EXTRA_IDS = [], NEW_BUDDY_IDS = [];

const TABLE = { body: BODIES, wheels: WHEELS, color: PAINTS, decal: DECALS, extras: EXTRAS, buddy: BUDDIES };
/* stars for a part; undefined for an unknown id (save.js then falls back to the v12 price) */
function price(kind, id) { const t = TABLE[kind], p = t && t[id]; return p ? p.price : undefined; }
/* the build's CarStats: body stats, the wheel's radius and grip, every enabled extra's mods added */
function stats(build) {
  const body = BODIES[build && build.body] || BODIES.monster, wh = WHEELS[build && build.wheels] || WHEELS.normal;
  const s = { ...body.stats, size: { ...body.stats.size } };
  s.wheelR = Math.max(s.wheelR, wh.r);
  s.grip *= wh.grip;
  for (const id in (build && build.extras) || {}) if (build.extras[id] && EXTRAS[id]) for (const k in EXTRAS[id].mods) s[k] += EXTRAS[id].mods[k];
  return s;
}

VROOM.catalog = { BODIES, WHEELS, PAINTS, DECALS, EXTRAS, BUDDIES, NEW_BODY_IDS, NEW_WHEEL_IDS, NEW_PAINT_IDS, NEW_DECAL_IDS, NEW_EXTRA_IDS, NEW_BUDDY_IDS, price, stats };
