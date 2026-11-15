/* catalog: every part's id, price and physical stats. Owner: cars. DOM-free, deterministic (sim region):
   plain arithmetic only, no Math.sin / pow / random, so the iOS port reads the same numbers.

   SAVE DATA IS FOREVER. Every id in contracts.LEGACY stays here (redesigned freely), v12 free parts stay
   price 0, v12 paid parts keep a price > 0, and v13 additions go ONLY on the end of the NEW_* arrays.

   The roster is heavy machines built from scrap and plate (docs/OVERHAUL.md section 3). A body's class sets
   its feel (CLASS below); each body then nudges the class with its own dimensions and quirks, so the sim's
   suspension, inertia and contact sizes match the mesh cars.js draws from the same numbers.
   Units: kg, m, N/m, N s/m, W, m/s, rad. armor 0..1 (share of a knock shrugged off). */

const L = VROOM.contracts.LEGACY;

/* ---- class baselines: the feel table ---- */
const CLASS = {
  /* monster trucks: soft long-travel suspension, huge air, bounce through hits, average grip */
  brute:  { mass: 1900, wheelbase: 3.0, track: 2.3, cgH: 1.25, rideH: 0.85, wheelR: 0.8, suspK: 38000, suspC: 3600, suspTravel: 0.6,
    power: 270000, topSpeed: 40, grip: 1.0, driftGrip: 0.7, brake: 13, steerMax: 0.52, airControl: 2.6, boostPower: 125000, armor: 0.45,
    size: { l: 4.6, w: 2.6, h: 2.4 } },
  /* heavy and stable, slow to turn, shrug off monsters, strong boost */
  hauler: { mass: 2600, wheelbase: 3.4, track: 2.1, cgH: 1.1, rideH: 0.6, wheelR: 0.6, suspK: 70000, suspC: 7000, suspTravel: 0.32,
    power: 330000, topSpeed: 38, grip: 1.0, driftGrip: 0.75, brake: 12, steerMax: 0.46, airControl: 1.6, boostPower: 170000, armor: 0.55,
    size: { l: 5.6, w: 2.5, h: 2.8 } },
  /* low, stiff, fastest, grippy, knocked around */
  racer:  { mass: 1150, wheelbase: 2.7, track: 1.85, cgH: 0.55, rideH: 0.25, wheelR: 0.4, suspK: 52000, suspC: 5000, suspTravel: 0.18,
    power: 250000, topSpeed: 50, grip: 1.22, driftGrip: 0.78, brake: 16, steerMax: 0.58, airControl: 2.0, boostPower: 110000, armor: 0.12,
    size: { l: 4.6, w: 2.0, h: 1.3 } },
  /* slowest, best armour and traction, nearly unstoppable */
  tank:   { mass: 3400, wheelbase: 3.2, track: 2.3, cgH: 1.0, rideH: 0.45, wheelR: 0.55, suspK: 110000, suspC: 11000, suspTravel: 0.25,
    power: 380000, topSpeed: 34, grip: 1.18, driftGrip: 0.9, brake: 15, steerMax: 0.44, airControl: 1.4, boostPower: 150000, armor: 0.8,
    size: { l: 5.2, w: 2.8, h: 2.6 } },
  /* floats over patches, slides, best air control */
  hover:  { mass: 950, wheelbase: 2.8, track: 2.0, cgH: 0.7, rideH: 0.7, wheelR: 0.35, suspK: 26000, suspC: 2400, suspTravel: 0.5,
    power: 190000, topSpeed: 48, grip: 0.82, driftGrip: 0.62, brake: 11, steerMax: 0.6, airControl: 3.6, boostPower: 115000, armor: 0.12,
    size: { l: 4.8, w: 2.8, h: 1.4 } },
  /* the odd ones: balanced, each with one quirk */
  freak:  { mass: 1700, wheelbase: 3.0, track: 2.1, cgH: 0.95, rideH: 0.55, wheelR: 0.55, suspK: 46000, suspC: 4600, suspTravel: 0.38,
    power: 270000, topSpeed: 45, grip: 1.06, driftGrip: 0.74, brake: 14, steerMax: 0.54, airControl: 2.3, boostPower: 130000, armor: 0.35,
    size: { l: 4.8, w: 2.3, h: 2.2 } },
};

/* ---- bodies: [id, class, price, overrides]. Legacy prices come from contracts.LEGACY (v12 free stays free).
   drive: 'wheels' | 'tracks' | 'hover' tells cars.js how to dress the four contact points; axles > 2 adds
   dummy wheels (they copy the rear pair's spin). Names in comments are the v13 machines. ---- */
const ROSTER = [
  ['dump',      'hauler', null, { mass: 2800, wheelbase: 3.6, size: { l: 5.8, w: 2.5, h: 2.9 }, axles: 3 }],              /* Slag Hauler */
  ['digger',    'tank',   null, { mass: 3600, topSpeed: 33, grip: 1.24, wheelbase: 3.0, wheelR: 0.5, size: { l: 5.0, w: 2.8, h: 3.0 }, drive: 'tracks' }], /* Excavator Crawler */
  ['mixer',     'hauler', null, { mass: 2900, wheelbase: 3.8, boostPower: 180000, size: { l: 6.0, w: 2.5, h: 3.0 }, axles: 3 }], /* Grinder */
  ['fire',      'hauler', null, { mass: 2700, topSpeed: 39, wheelbase: 4.0, steerMax: 0.44, size: { l: 6.4, w: 2.5, h: 2.9 } }], /* Inferno Engine */
  ['monster',   'brute',  null, {}],                                                                                     /* Mauler: the default */
  ['police',    'racer',  null, { mass: 1350, topSpeed: 49, grip: 1.2, armor: 0.25, wheelbase: 2.9, track: 1.9, size: { l: 4.9, w: 2.1, h: 1.5 } }], /* Interceptor */
  ['race',      'racer',  null, { mass: 950, power: 270000, topSpeed: 53, grip: 1.25, armor: 0.06, wheelbase: 3.6, track: 1.9, wheelR: 0.42, size: { l: 5.6, w: 2.0, h: 1.2 } }], /* Pistonhead */
  ['tractor',   'brute',  null, { mass: 2300, topSpeed: 37, grip: 1.12, armor: 0.55, wheelbase: 2.8, wheelR: 0.85, size: { l: 4.4, w: 2.6, h: 2.7 } }], /* Plough Brute */
  ['icecream',  'hauler', null, { mass: 2300, topSpeed: 39, wheelbase: 3.2, size: { l: 5.0, w: 2.4, h: 3.0 } }],          /* Freezer Van */
  ['rocket',    'racer',  null, { mass: 1000, topSpeed: 54, grip: 1.12, boostPower: 160000, armor: 0.08, wheelbase: 3.4, size: { l: 5.6, w: 2.0, h: 1.3 } }], /* Rocket Sled */
  ['ufo',       'hover',  null, { mass: 900, airControl: 3.9, wheelbase: 2.6, track: 2.6, size: { l: 4.4, w: 4.0, h: 1.6 }, drive: 'hover' }], /* Saucer */
  ['limo',      'racer',  null, { mass: 1600, topSpeed: 50, grip: 1.15, armor: 0.22, steerMax: 0.5, wheelbase: 4.4, track: 1.95, size: { l: 6.6, w: 2.1, h: 1.6 } }], /* Stretch Hearse */
  ['dragon',    'freak',  null, { mass: 2100, topSpeed: 44, armor: 0.6, wheelbase: 3.2, size: { l: 5.4, w: 2.5, h: 2.4 } }],  /* Wyrm Rig: the ram shrugs */
  ['train',     'tank',   null, { mass: 3800, power: 400000, topSpeed: 34, armor: 0.85, wheelbase: 3.8, wheelR: 0.7, size: { l: 6.2, w: 2.6, h: 3.2 } }], /* Locomotive */
  ['royal',     'freak',  null, { mass: 2000, topSpeed: 44, grip: 1.15, armor: 0.45, wheelbase: 3.1, size: { l: 5.2, w: 2.4, h: 2.8 } }], /* Iron Carriage: grips */
  ['bulldozer', 'tank',   null, { mass: 3500, grip: 1.22, armor: 0.82, wheelbase: 3.0, track: 2.4, size: { l: 5.0, w: 3.0, h: 2.8 }, drive: 'tracks' }], /* Dozer */
  ['schoolbus', 'hauler', null, { mass: 3000, topSpeed: 37, armor: 0.62, steerMax: 0.42, wheelbase: 4.6, track: 2.2, size: { l: 7.0, w: 2.6, h: 3.2 } }], /* Riot Bus */
  ['ambulance', 'hauler', null, { mass: 2400, topSpeed: 41, armor: 0.5, wheelbase: 3.4, size: { l: 5.4, w: 2.4, h: 2.9 } }], /* Med Hauler */
  ['submarine', 'freak',  null, { mass: 1900, airControl: 3.0, wheelbase: 3.4, size: { l: 5.6, w: 2.3, h: 2.6 } }],       /* Sub Crawler: floaty */
  ['pirate',    'freak',  null, { mass: 2200, topSpeed: 43, armor: 0.5, wheelbase: 3.6, size: { l: 6.0, w: 2.5, h: 2.6 } }],  /* Galleon Rig */
  ['dino',      'brute',  null, { mass: 2100, topSpeed: 41, armor: 0.55, wheelR: 0.85, size: { l: 4.8, w: 2.7, h: 2.5 } }],  /* Fossil Crusher */
  ['unicorn',   'freak',  null, { mass: 1400, topSpeed: 49, grip: 1.1, armor: 0.2, boostPower: 150000, size: { l: 5.0, w: 2.2, h: 2.0 } }], /* Ironhorn */
  ['hover',     'hover',  null, { mass: 1000, topSpeed: 52, airControl: 4.0, size: { l: 5.0, w: 2.8, h: 1.6 }, drive: 'hover' }], /* Hover Ship */
  /* ---- v13 machines (NEW_BODY_IDS order) ---- */
  ['tusk',      'hauler', 450,  { mass: 3100, topSpeed: 39, armor: 0.7, wheelbase: 4.0, track: 2.3, size: { l: 6.2, w: 2.7, h: 2.8 }, axles: 3 }], /* war rig */
  ['anvil',     'tank',   1500, { mass: 4800, power: 460000, topSpeed: 33, armor: 0.95, wheelbase: 4.2, track: 2.5, wheelR: 0.75, size: { l: 6.4, w: 3.0, h: 3.2 } }], /* ore hauler */
  ['gnasher',   'racer',  600,  { mass: 1250, topSpeed: 52, grip: 1.2, armor: 0.3, wheelbase: 3.2, size: { l: 5.4, w: 2.1, h: 1.4 } }], /* rotor dragster */
  ['howler',    'brute',  150,  { mass: 1300, suspK: 26000, suspC: 2900, suspTravel: 0.8, topSpeed: 45, airControl: 3.2, armor: 0.25, wheelR: 0.65, rideH: 0.75, size: { l: 4.4, w: 2.5, h: 2.0 } }], /* dune buggy */
  ['dredge',    'hauler', 750,  { mass: 3600, wheelR: 1.0, rideH: 1.1, suspTravel: 0.5, suspK: 60000, topSpeed: 36, armor: 0.7, wheelbase: 3.8, track: 2.8, size: { l: 6.0, w: 3.2, h: 3.6 } }], /* mining dumper */
  ['bulwark',   'tank',   1000, { mass: 4200, topSpeed: 36, grip: 1.2, armor: 0.9, wheelbase: 4.6, wheelR: 0.6, size: { l: 6.6, w: 2.9, h: 2.7 }, axles: 4 }], /* 8x8 carrier */
  ['cinder',    'racer',  250,  { mass: 1250, power: 300000, topSpeed: 51, grip: 1.18, wheelbase: 2.9, size: { l: 4.6, w: 2.0, h: 1.4 } }], /* hot rod */
  ['wrecker',   'freak',  350,  { mass: 2300, topSpeed: 43, boostPower: 170000, armor: 0.55, wheelbase: 3.4, size: { l: 5.6, w: 2.4, h: 2.6 } }], /* tow truck */
];
const NEW_BODY_IDS = ['tusk', 'anvil', 'gnasher', 'howler', 'dredge', 'bulwark', 'cinder', 'wrecker'];

const STAT_KEYS = ['mass', 'wheelbase', 'track', 'cgH', 'rideH', 'wheelR', 'suspK', 'suspC', 'suspTravel', 'power', 'topSpeed', 'grip', 'driftGrip',
  'brake', 'steerMax', 'airControl', 'boostPower', 'armor'];
const BODIES = {};
for (const [id, cls, newPrice, o] of ROSTER) {
  const base = CLASS[cls], stats = {};
  for (const k of STAT_KEYS) stats[k] = o[k] !== undefined ? o[k] : base[k];
  stats.size = { ...base.size, ...(o.size || {}) };
  const price = newPrice !== null ? newPrice : (L.PRICES.body[id] || 0);
  BODIES[id] = { id, cls, price, stats, drive: o.drive || (cls === 'hover' ? 'hover' : 'wheels'), axles: o.axles || 2 };
}

/* ---- wheels: r is the radius on a chassis built for it; stats() clamps it to 0.8..1.3 of the body's own,
   so monster tyres lift a racer without turning it into a stilt walker ---- */
const WHEEL_ROWS = [
  /* id,        price, r,    width, grip, mass   look */
  ['normal',   0,   0.55, 0.42, 1.00, 30],   /* steelie: six-lug pressed steel, block tread */
  ['monster',  0,   0.80, 0.70, 1.00, 60],   /* knobby paddle-lug tyre, chrome beadlock */
  ['racing',   0,   0.40, 0.45, 1.06, 20],   /* low-profile slick, five-spoke */
  ['gold',     30,  0.55, 0.45, 1.00, 32],   /* gold-plated spokes */
  ['flower',   50,  0.60, 0.45, 1.04, 34],   /* sawblade rim */
  ['tank',     70,  0.60, 0.55, 1.08, 70],   /* armoured road wheel, track cleats */
  ['glow',     90,  0.55, 0.45, 1.02, 30],   /* toxic neon ring */
  ['star',     120, 0.55, 0.45, 1.02, 30],   /* five-point throwing-star spokes */
  ['donut',    50,  0.65, 0.80, 1.06, 50],   /* fat ribbed balloon */
  ['cookie',   50,  0.60, 0.50, 1.05, 40],   /* cog rim */
  ['lava',     80,  0.60, 0.50, 1.04, 40],   /* cracked molten rim */
  ['bubble',   85,  0.60, 0.50, 1.00, 36],   /* riveted dome cap */
  ['crystal',  120, 0.55, 0.45, 1.07, 30],   /* ice shard rim */
  ['disco',    220, 0.55, 0.45, 1.03, 30],   /* mirror-ball hub */
  /* ---- v13 (NEW_WHEEL_IDS order) ---- */
  ['spike',    150, 0.70, 0.60, 1.10, 55],   /* studded tyre, spiked hub */
  ['chain',    180, 0.65, 0.55, 1.12, 50],   /* snow chains over the tread */
  ['paddle',   220, 0.75, 0.70, 1.06, 55],   /* sand paddles */
  ['rustrim',  40,  0.60, 0.50, 0.98, 36],   /* rusted wagon spokes */
  ['turbine',  320, 0.55, 0.50, 1.08, 34],   /* turbine-blade rim */
  ['skullcap', 260, 0.70, 0.60, 1.06, 48],   /* bone hubcap */
];
const NEW_WHEEL_IDS = ['spike', 'chain', 'paddle', 'rustrim', 'turbine', 'skullcap'];
const WHEELS = {};
for (const [id, p, r, width, grip, mass] of WHEEL_ROWS) WHEELS[id] = { id, price: L.PRICES.wheels[id] !== undefined ? L.PRICES.wheels[id] : p, r, width, grip, mass };

/* ---- paints. kind solid = candy metallic flake over the hex; metal = a bare metal finish; pattern = a
   canvas texture (cars.js draws it from `pattern`) over the base ---- */
const PAINT_ROWS = [
  /* id,              kind,      base,      metal, rough, extra */
  ['#e53935',       'solid',   '#e53935', 0.55, 0.32],
  ['#1e88e5',       'solid',   '#1e88e5', 0.55, 0.32],
  ['#fdd835',       'solid',   '#fdd835', 0.5,  0.34],
  ['#43a047',       'solid',   '#43a047', 0.55, 0.34],
  ['#fb8c00',       'solid',   '#fb8c00', 0.55, 0.32],
  ['#ec407a',       'solid',   '#ec407a', 0.55, 0.32],
  ['#8e24aa',       'solid',   '#8e24aa', 0.6,  0.3],
  ['#00acc1',       'solid',   '#00acc1', 0.6,  0.3],
  ['#9ccc65',       'solid',   '#9ccc65', 0.5,  0.36],
  ['#f5f5f5',       'solid',   '#f5f5f5', 0.4,  0.38],
  ['#37474f',       'solid',   '#37474f', 0.6,  0.42],
  ['rainbow',       'pattern', '#e53935', 0.6,  0.3,  { pattern: 'spectrum' }],
  ['p:stripes',     'pattern', '#d8322a', 0.55, 0.32, { pattern: 'stripes', ink: '#f4f6fa' }],
  ['p:flames',      'pattern', '#16171b', 0.6,  0.3,  { pattern: 'flames', ink: '#ff5a1a' }],
  ['p:dots',        'pattern', '#2c3039', 0.55, 0.4,  { pattern: 'halftone', ink: '#ffb02e' }],
  ['p:checker',     'pattern', '#f4f6fa', 0.45, 0.35, { pattern: 'checker', ink: '#111214' }],
  ['p:camo',        'pattern', '#5c5f52', 0.2,  0.7,  { pattern: 'urban', ink: '#2a2c27' }],
  ['p:candy',       'pattern', '#c84fa0', 0.6,  0.28, { pattern: 'swirl', ink: '#fff0f8' }],
  ['p:galaxy',      'pattern', '#1a1060', 0.7,  0.25, { pattern: 'nebula', ink: '#a88cff' }],
  ['p:gold',        'metal',   '#d9a521', 1.0,  0.22, { pattern: 'brushed' }],
  ['p:leopard',     'pattern', '#e0a030', 0.5,  0.4,  { pattern: 'spots', ink: '#1a1108' }],
  ['p:bubblegum',   'pattern', '#ff9ad0', 0.5,  0.34, { pattern: 'drips', ink: '#5a1040' }],
  ['p:bolt',        'pattern', '#2c3039', 0.6,  0.35, { pattern: 'bolts', ink: '#f2b705' }],
  ['p:rainbowshine', 'pattern', '#2a1070', 1.0, 0.15, { pattern: 'oilslick', secret: true }],
  /* ---- v13 metal finishes (NEW_PAINT_IDS order) ---- */
  ['m:gunmetal',    'metal',   '#4b515b', 0.95, 0.38, { pattern: 'brushed' }],
  ['m:chrome',      'metal',   '#e8ecf2', 1.0,  0.06],
  ['m:rust',        'pattern', '#8a3b12', 0.3,  0.85, { pattern: 'rust', ink: '#c2561c' }],
  ['m:molten',      'pattern', '#1a0d08', 0.4,  0.6,  { pattern: 'cracks', ink: '#ff5a1a', glow: '#ff7a1a' }],
  ['m:hazard',      'pattern', '#f2b705', 0.4,  0.45, { pattern: 'hazard', ink: '#111214' }],
  ['m:toxic',       'pattern', '#1f2a12', 0.5,  0.4,  { pattern: 'ooze', ink: '#8cff3a', glow: '#8cff3a' }],
  ['m:blackchrome', 'metal',   '#20232a', 1.0,  0.08],
  ['m:camo',        'pattern', '#4f5a2c', 0.2,  0.75, { pattern: 'woodland', ink: '#2b2f18' }],
  /* v14 two-tone metallics: base over the top, `low` under the belt line, a `stripe` pinstripe between.
     A `stencil` is a decal id the paint wears itself while the build's own decal is 'none'. */
  ['m:furnace',     'metal',   '#d0281a', 0.7,  0.3,  { low: '#4b515b', stripe: '#ffb02e', stencil: 'flame' }],   /* the starter: furnace red over gunmetal, flame stencils */
  ['m:venom',       'metal',   '#5fae1a', 0.75, 0.3,  { low: '#16171b', stripe: '#8cff3a' }],
  ['m:bonewhite',   'metal',   '#d9ccae', 0.6,  0.36, { low: '#3a2a1a', stripe: '#b3200f' }],
  ['m:cobalt',      'metal',   '#1f5fa8', 0.8,  0.28, { low: '#20232a', stripe: '#c7ccd5' }],
];
const NEW_PAINT_IDS = ['m:gunmetal', 'm:chrome', 'm:rust', 'm:molten', 'm:hazard', 'm:toxic', 'm:blackchrome', 'm:camo',
  'm:furnace', 'm:venom', 'm:bonewhite', 'm:cobalt'];
/* m:furnace is free: it is the starter paint (STARTER below), so every save owns it */
const NEW_PAINT_PRICES = { 'm:gunmetal': 40, 'm:chrome': 150, 'm:rust': 30, 'm:molten': 220, 'm:hazard': 80, 'm:toxic': 180, 'm:blackchrome': 260, 'm:camo': 60,
  'm:furnace': 0, 'm:venom': 160, 'm:bonewhite': 120, 'm:cobalt': 140 };
const PAINTS = {};
for (const [id, kind, base, metal, rough, x = {}] of PAINT_ROWS) {
  const price = NEW_PAINT_PRICES[id] !== undefined ? NEW_PAINT_PRICES[id] : (L.PRICES.color[id] || 0);
  PAINTS[id] = { id, price, kind, base, metal, rough, ...x, secret: !!x.secret || L.SECRET_COLORS.includes(id) };
}

/* ---- decals: stencils on the doors and hood ---- */
const DECAL_ROWS = [
  ['none', 0], ['flame', 0], ['star', 0], ['heart', 0], ['bolt', 0], ['eyes', 0], ['rainbow', 0], ['dinofoot', 0], ['flower', 0],
  /* v13 */
  ['skull', 70], ['hazard', 45], ['claws', 55], ['cog', 40], ['fangs', 90],
];
const NEW_DECAL_IDS = ['skull', 'hazard', 'claws', 'cog', 'fangs'];
const DECALS = {};
for (const [id, p] of DECAL_ROWS) DECALS[id] = { id, price: L.PRICES.decal[id] !== undefined ? L.PRICES.decal[id] : p };

/* ---- extras: bolt-ons. mods add to CarStats (small: a build is a flavour, never a cheat code) ---- */
const EXTRA_ROWS = [
  ['horn',       0,   {}],                                             /* twin chrome air horns */
  ['beacon',     0,   {}],                                             /* amber rotating beacon */
  ['flag',       0,   {}],                                             /* tattered whip flag */
  ['wings',      0,   { grip: 0.02, airControl: 0.3, mass: 30 }],      /* shark spoiler fins */
  ['booster',    0,   { boostPower: 20000, mass: 40 }],                /* nitro bottles */
  ['partyhat',   0,   { armor: 0.02 }],                                /* spiked helmet */
  ['spoiler',    0,   { grip: 0.04, topSpeed: -0.4, mass: 25 }],       /* big rear wing on struts */
  ['antenna',    0,   {}],                                             /* whip antenna, skull knob */
  ['surf',       0,   { airControl: 0.15, mass: 20 }],                 /* riveted roof blade */
  ['bubbles',    0,   { mass: 15 }],                                   /* smoke canisters */
  ['jetpack',    0,   { airControl: 0.6, boostPower: 10000, mass: 60 }], /* twin roof thrusters */
  ['trophyrack', 0,   { mass: 30 }],                                   /* gold skull trophies */
  /* v13 */
  ['rollcage',   120, { armor: 0.04, mass: 80 }],
  ['ram',        160, { armor: 0.06, mass: 120 }],
  ['sidepipes',  140, { power: 8000, mass: 30 }],
  ['searchlights', 90, { mass: 20 }],
  ['blower',     260, { power: 18000, mass: 50 }],
  ['plating',    220, { armor: 0.08, mass: 200, topSpeed: -0.5 }],
];
const NEW_EXTRA_IDS = ['rollcage', 'ram', 'sidepipes', 'searchlights', 'blower', 'plating'];
const EXTRAS = {};
for (const [id, p, mods] of EXTRA_ROWS) EXTRAS[id] = { id, price: L.PRICES.extras[id] !== undefined ? L.PRICES.extras[id] : p, mods };

/* ---- buddies: dashboard bobbleheads and roof mascots. v12 buddies came from capsules (never free);
   in v13 the garage sells them ---- */
const BUDDY_ROWS = [
  ['pup', 40], ['kitty', 40], ['ducky', 45], ['dino', 60], ['penguin', 50], ['monkey', 55], ['fox', 60], ['bunny', 50], ['frog', 45], ['robot', 90],
  /* v13 */
  ['gremlin', 120], ['skullbot', 150],
];
const NEW_BUDDY_IDS = ['gremlin', 'skullbot'];
const BUDDIES = {};
for (const [id, p] of BUDDY_ROWS) BUDDIES[id] = { id, price: p };

const TABLE = { body: BODIES, wheels: WHEELS, color: PAINTS, decal: DECALS, extras: EXTRAS, buddy: BUDDIES };
/* stars for a part; undefined for an unknown id (save.js then falls back to the v12 price) */
function price(kind, id) { const t = TABLE[kind], p = t && Object.prototype.hasOwnProperty.call(t, id) ? t[id] : null; return p ? p.price : undefined; }

/* the build a brand-new save starts with (v14): the Mauler in two-tone furnace metallic, which wears its own flame
   stencils (every v12 decal costs stars, so the free paint carries the livery). Every part is free. Existing
   saves keep their own build; save.js seeds a fresh state from this. */
const STARTER = Object.freeze({ body: 'monster', wheels: 'monster', color: 'm:furnace', decal: 'none', buddy: null, number: '', extras: Object.freeze({}) });

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
/* the build's CarStats: the body's, with the wheel's radius (clamped to the chassis, which lifts the ride
   height by the same amount), grip and mass, then every enabled extra's mods added. A fresh object. */
function stats(build) {
  const body = BODIES[build && build.body] || BODIES.monster, wh = WHEELS[build && build.wheels] || WHEELS.monster;
  const b = body.stats, s = { ...b, size: { ...b.size } };
  s.wheelR = clamp(wh.r, b.wheelR * 0.8, b.wheelR * 1.3);
  s.rideH = b.rideH + (s.wheelR - b.wheelR);
  s.cgH = b.cgH + (s.wheelR - b.wheelR);
  s.size.h = b.size.h + (s.wheelR - b.wheelR);
  s.grip = b.grip * wh.grip;
  s.mass = b.mass + 4 * (wh.mass - 40);
  const ex = (build && build.extras) || {};
  for (const id of Object.keys(ex)) {
    if (!ex[id] || !EXTRAS[id]) continue;
    const m = EXTRAS[id].mods;
    for (const k of Object.keys(m)) if (typeof s[k] === 'number') s[k] += m[k];
  }
  s.armor = clamp(s.armor, 0, 1);
  return s;
}

VROOM.catalog = { CLASS, BODIES, WHEELS, PAINTS, DECALS, EXTRAS, BUDDIES, NEW_BODY_IDS, NEW_WHEEL_IDS, NEW_PAINT_IDS, NEW_DECAL_IDS, NEW_EXTRA_IDS, NEW_BUDDY_IDS, STARTER, price, stats };
