/* save: the v12 save format, kept whole, plus the v13 fields. Owner: integrator.
   Ported from legacy/v12/index.html sections 4 (STATE + SAVE) and 17 (PROFILES + SAVE CODES).
   SAVE DATA IS FOREVER:
     - localStorage keys stay vroom.v2.p<n> (one per profile) and vroom.meta; vroom.v1 and the
       single-profile vroom.v2 still migrate on load.
     - Every catalog order is LEGACY (contracts.js, frozen) followed by VROOM.catalog.NEW_* (append only).
     - VROOM1 compact codes are format 3: count-prefixed lists, so appended ids never break old codes.
       New code fields go on the END of the v3 tail behind a `pos + n <= bytes.length * 8` guard.
     - New JSON fields get a default in load() for older saves. Unknown fields round-trip untouched.
   tests/save-check.cjs replays tests/fixtures/v12-saves.json (captured from the v12.9 game) and
   tests/fixtures/v13.29-saves.json (the last hosted 2D build, 13.29) through this file.
   DOM-light on purpose: localStorage / location / history are reached through guards so Node can run it. */

const C = VROOM.contracts, L = C.LEGACY;
const cat = () => VROOM.catalog || {};
const newIds = key => (Array.isArray(cat()[key]) ? cat()[key] : []);
const store = (() => { try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch (e) { return null; } })();
const lsGet = k => { try { return store ? store.getItem(k) : null; } catch (e) { return null; } };
const lsSet = (k, v) => { try { if (store) store.setItem(k, v); } catch (e) {} };
const lsDel = k => { try { if (store) store.removeItem(k); } catch (e) {} };

/* ---- the live catalog orders: LEGACY then v13 appends (built once, at load, after catalog.js ran) ---- */
const BODY_ORDER = [...L.BODY_ORDER, ...newIds('NEW_BODY_IDS')];
const WHEEL_ORDER = [...L.WHEEL_ORDER, ...newIds('NEW_WHEEL_IDS')];
const COLORS = [...L.COLORS, ...newIds('NEW_PAINT_IDS')];
const DECAL_ORDER = [...L.DECAL_ORDER, ...newIds('NEW_DECAL_IDS')];
const BUDDY_ORDER = [...L.BUDDY_ORDER, ...newIds('NEW_BUDDY_IDS')];
const EXTRA_ORDER = [...L.EXTRAS, ...newIds('NEW_EXTRA_IDS')];
/* v13 badges append here (integrator): boss = first boss beaten, air = 3 s of air, drift = a 3 s drift, sweep = every star on a level */
const V13_BADGES = ['boss', 'air', 'drift', 'sweep'];
const BADGE_IDS = [...L.BADGES, ...V13_BADGES];
const CODE_BODIES = [...L.CODE_BODIES, ...newIds('NEW_BODY_IDS')];
const CODE_WHEELS = [...L.CODE_WHEELS, ...newIds('NEW_WHEEL_IDS')];
const CODE_COLORS = [...L.CODE_COLORS, ...newIds('NEW_PAINT_IDS')];
const CODE_COLORS_V2 = 6;   /* v1/v2 codes carry only the first six paid colors */
const CODE_V2 = { body: 10, wheels: 5, extras: 3, buddy: 6, decals: 5 };   /* v1/v2 fixed flag-run lengths */
const CODE_EXTRAS = [...L.CODE_EXTRAS, ...newIds('NEW_EXTRA_IDS')];
const CODE_BADGES = L.CODE_BADGES;   /* FROZEN for the v1/v2 layout */
const CODE_DECALS = [...L.CODE_DECALS, ...newIds('NEW_DECAL_IDS')];
const ids = Object.freeze({ BODY_ORDER, WHEEL_ORDER, COLORS, DECAL_ORDER, BUDDY_ORDER, EXTRA_ORDER, BADGE_IDS,
  CODE_BODIES, CODE_WHEELS, CODE_COLORS, CODE_EXTRAS, CODE_DECALS, CODE_BADGES });

/* ---- prices and ownership ---- */
const SECRET = { color: new Set([...L.SECRET_COLORS, ...Object.values(cat().PAINTS || {}).filter(p => p && p.secret).map(p => p.id)]) };
const KIND_LIST = { body: BODY_ORDER, wheels: WHEEL_ORDER, color: COLORS, extras: EXTRA_ORDER, decal: DECAL_ORDER, buddy: BUDDY_ORDER };
function price(kind, id) {
  const c = cat();
  if (typeof c.price === 'function') { const p = c.price(kind, id); if (Number.isFinite(p)) return p; }
  return (L.PRICES[kind] && L.PRICES[kind][id]) || 0;
}
const legacyPaid = (kind, id) => !!(L.PRICES[kind] && L.PRICES[kind][id] > 0);
const isSecret = (kind, id) => !!(SECRET[kind] && SECRET[kind].has(id));
/* buddies were never free in v12 (found in capsules); everything else priced 0 is owned by everyone */
function owns(kind, id) {
  if (kind === 'buddy') return progress.owned.buddy.includes(id) || (price('buddy', id) === 0 && !L.BUDDY_ORDER.includes(id) && BUDDY_ORDER.includes(id));
  return (price(kind, id) === 0 && !isSecret(kind, id) && KIND_LIST[kind].includes(id)) || progress.owned[kind].includes(id);
}

/* workbench ladders, 3 pips each (v12 prices). v13 meaning: engine = power, armor = knock resistance,
   magnet = star pull radius, tank = boost tank size, springs = suspension and air control */
const UPG = { engine: [60, 150, 350], armor: [50, 120, 300], magnet: [40, 100, 250], tank: [50, 120, 300], springs: [50, 120, 300] };
const MAX_DAMAGE = 9, REPAIR_RATE = 2;
const FUEL_MAX = 8, TREAD_MAX = 8;   /* v12 upkeep: retired from play in v13 but kept and round-tripped in saves */
const TIER_RANK = { S: 3, A: 2, B: 1, C: 0 };
const PHOTO_SLOTS = C.WORLD_COUNT + 1;   /* 13.23 photo wall: a frame per world and the parade's */
const NUMBER_RE = /^\d{1,2}$/;
const clampInt = (v, a, b) => (Number.isFinite(v) ? Math.min(b, Math.max(a, Math.floor(v))) : a);

/* ---- the state ---- */
const blankExtras = () => Object.fromEntries(EXTRA_ORDER.map(k => [k, false]));
/* 14.1: a new save starts in the catalog's starter build (the Mauler in two-tone m:furnace); a loaded save overwrites it */
const STARTER = cat().STARTER || { body: 'monster', wheels: 'monster', color: '#e53935', buddy: null, decal: 'none', number: '' };
const state = { body: STARTER.body, wheels: STARTER.wheels, color: STARTER.color, buddy: STARTER.buddy, decal: STARTER.decal, number: STARTER.number, extras: blankExtras() };
const progress = {
  wallet: 0, owned: { body: [], wheels: [], color: [], extras: [], buddy: [], decal: [] }, levels: {}, current: 1,
  muddy: false, fuel: FUEL_MAX, tread: TREAD_MAX, damage: 0, upgrades: { engine: 0, armor: 0, magnet: 0, tank: 0, springs: 0 },
  quiet: false, badges: [], photos: [], lastGift: '',
  /* 13.x fields of the 2D line (13.1..13.29), unused here but kept and written back: the free-drive day and its stars, what the album has shown */
  freeDay: '', freeUsed: 0, albumSeen: [],
  /* v13 fields (13.0): bosses = worlds whose finale boss is beaten; ctrl = control scheme (0 pedals + wheel, 1 tilt, 2 buttons) and steering sensitivity 1..3 */
  bosses: [], ctrl: { mode: 0, sens: 2 },
};
let extra = {};   /* unknown top-level fields from a newer or older save: written back untouched */
const KNOWN = new Set(['build', ...Object.keys(progress)]);

/* ---- profiles: up to 3 players, each a buddy-face avatar ---- */
const MAX_PROFILES = 3;
const AVATAR_IDS = ['pup', 'kitty', 'ducky', 'dino', 'penguin', 'monkey'];
const meta = { active: 0, avatars: ['pup', null, null] };
(function loadMeta() {
  try {
    const m = JSON.parse(lsGet('vroom.meta'));
    if (m && Number.isInteger(m.active) && Array.isArray(m.avatars)) {
      meta.active = Math.min(MAX_PROFILES - 1, Math.max(0, m.active));
      meta.avatars = [0, 1, 2].map(i => AVATAR_IDS.includes(m.avatars[i]) ? m.avatars[i] : null);
      /* 13.x: a deleted slot stays empty (even slot 0); the active one always wears a face */
      if (!meta.avatars[meta.active]) meta.avatars[meta.active] = AVATAR_IDS.find(a => !meta.avatars.includes(a)) || 'pup';
    }
  } catch (e) {}
  /* migrate the single-profile era: vroom.v2 becomes profile 0 */
  if (lsGet('vroom.v2') && !lsGet('vroom.v2.p0')) { lsSet('vroom.v2.p0', lsGet('vroom.v2')); lsDel('vroom.v2'); }
  saveMeta();
})();
function saveMeta() { lsSet('vroom.meta', JSON.stringify(meta)); }
function saveKey() { return 'vroom.v2.p' + meta.active; }
function switchProfile(i) {
  save();
  meta.active = Math.min(MAX_PROFILES - 1, Math.max(0, i | 0));
  saveMeta();
  try { sessionStorage.setItem('vroom.toGarage', '1'); } catch (e) {}
  if (typeof location !== 'undefined') location.reload();
}

/* v12 ghost traces { t, p: [pos, lane, jumpY]... } are kept (validated) but unused in v13 */
function ghostValid(g) {
  return !!g && typeof g === 'object' && Number.isFinite(g.t) && g.t > 0 && g.t < 600 && Array.isArray(g.p)
    && g.p.length >= 6 && g.p.length % 3 === 0 && g.p.length <= 9000 && g.p.every(n => Number.isFinite(n));
}
/* v13 replays: { t, ticks, rle, b } where rle is the packed-input run-length string from encodeReplay and
   b the build key it was driven with (a ghost only replays in the same machine). Touch steering changes
   almost every tick, so a 2 minute run can need about 100k characters; REPLAY_MAX leaves room for 5 min. */
const REPLAY_MAX = 250000;
function replayValid(r) {
  return !!r && typeof r === 'object' && Number.isFinite(r.t) && r.t > 0 && r.t < 900 && Number.isInteger(r.ticks) && r.ticks > 0 && typeof r.rle === 'string' && r.rle.length < REPLAY_MAX;
}
const replayCopy = r => (typeof r.b === 'string' ? { t: r.t, ticks: r.ticks, rle: r.rle, b: r.b } : { t: r.t, ticks: r.ticks, rle: r.rle });

function load() {
  let saved = null;
  try { saved = JSON.parse(lsGet(saveKey())); } catch (e) {}
  if (!saved && meta.active === 0) {
    try { const v1 = JSON.parse(lsGet('vroom.v1')); if (v1) saved = { build: v1 }; } catch (e) {}
  }
  if (!saved || typeof saved !== 'object') return false;
  apply(saved);
  return true;
}
/* apply a parsed save object (localStorage, a full code, or a decoded compact code) over the defaults */
function apply(saved) {
  extra = {};
  for (const k in saved) if (!KNOWN.has(k)) extra[k] = saved[k];
  const b = saved.build || {};
  if (BODY_ORDER.includes(b.body)) state.body = b.body;
  if (WHEEL_ORDER.includes(b.wheels)) state.wheels = b.wheels;
  if (COLORS.includes(b.color)) state.color = b.color;
  for (const k in state.extras) state.extras[k] = !!(b.extras && b.extras[k]);
  if (Number.isFinite(saved.wallet) && saved.wallet >= 0) progress.wallet = Math.floor(saved.wallet);
  if (saved.owned) for (const kind of ['body', 'wheels', 'color', 'extras', 'decal']) {
    if (Array.isArray(saved.owned[kind])) progress.owned[kind] = saved.owned[kind].filter(id => KIND_LIST[kind].includes(id) && (legacyPaid(kind, id) || price(kind, id) > 0 || isSecret(kind, id)));
  }
  if (saved.levels) for (const n in saved.levels) {
    const lv = saved.levels[n], num = +n;
    if (num >= 1 && num <= C.PARADE_LEVEL && lv && Number.isFinite(lv.best)) {
      const out = progress.levels[num] = { best: lv.best, rating: Math.min(3, Math.max(1, lv.rating || 1)) };
      if (Number.isFinite(lv.bestTime) && lv.bestTime > 0) out.bestTime = lv.bestTime;   /* a v12 time: kept, never compared with v13 times */
      if (TIER_RANK[lv.tier] !== undefined) out.tier = lv.tier;
      if (ghostValid(lv.ghost)) out.ghost = { t: lv.ghost.t, p: lv.ghost.p.slice() };
      if (Number.isFinite(lv.t13) && lv.t13 > 0) out.t13 = lv.t13;                      /* 13.0: best v13 time */
      if (replayValid(lv.replay)) out.replay = replayCopy(lv.replay);
    }
  }
  if (Number.isFinite(saved.current) && saved.current >= 1 && saved.current <= C.MAX_LEVEL) progress.current = Math.floor(saved.current);
  progress.quiet = !!saved.quiet;
  progress.muddy = !!saved.muddy;
  if (b.decal && DECAL_ORDER.includes(b.decal)) state.decal = b.decal;
  state.number = typeof b.number === 'string' && NUMBER_RE.test(b.number) ? b.number : '';
  if (saved.owned && Array.isArray(saved.owned.buddy)) progress.owned.buddy = saved.owned.buddy.filter(id => BUDDY_ORDER.includes(id));
  state.buddy = b.buddy && BUDDY_ORDER.includes(b.buddy) ? b.buddy : null;
  if (Array.isArray(saved.badges)) progress.badges = saved.badges.filter(id => BADGE_IDS.includes(id));
  if (Array.isArray(saved.photos)) {   /* v12 kept the 6 latest finishes, 13.23 one per world plus the parade (13) */
    progress.photos = saved.photos.filter(p =>
      p && p.b && p.b.extras && BODY_ORDER.includes(p.b.body) && WHEEL_ORDER.includes(p.b.wheels) && COLORS.includes(p.b.color)).slice(0, PHOTO_SLOTS);
  }
  progress.albumSeen = Array.isArray(saved.albumSeen) ? saved.albumSeen.filter(k => typeof k === 'string').slice(0, 60) : [];
  if (Number.isFinite(saved.damage)) progress.damage = Math.min(MAX_DAMAGE, Math.max(0, Math.floor(saved.damage)));
  progress.fuel = Number.isFinite(saved.fuel) ? Math.min(FUEL_MAX + 6, Math.max(0, saved.fuel)) : FUEL_MAX;
  progress.tread = Number.isFinite(saved.tread) ? Math.min(TREAD_MAX, Math.max(0, saved.tread)) : TREAD_MAX;
  if (saved.upgrades) for (const k of L.UPGRADES) {
    if (Number.isFinite(saved.upgrades[k])) progress.upgrades[k] = Math.min(3, Math.max(0, Math.floor(saved.upgrades[k])));
  }
  progress.fuel = Math.min(FUEL_MAX + 2 * progress.upgrades.tank, progress.fuel);
  progress.lastGift = typeof saved.lastGift === 'string' ? saved.lastGift : '';
  progress.freeDay = typeof saved.freeDay === 'string' ? saved.freeDay : '';
  progress.freeUsed = Number.isFinite(saved.freeUsed) ? Math.max(0, Math.floor(saved.freeUsed)) : 0;
  /* 13.0 fields: older saves get the defaults */
  progress.bosses = Array.isArray(saved.bosses) ? [...new Set(saved.bosses.filter(w => Number.isInteger(w) && w >= 1 && w <= C.WORLD_COUNT))].sort((a, b) => a - b) : [];
  const ctrl = saved.ctrl || {};
  progress.ctrl = { mode: [0, 1, 2].includes(ctrl.mode) ? ctrl.mode : 0, sens: [1, 2, 3].includes(ctrl.sens) ? ctrl.sens : 2 };
  /* a build using a part no longer owned falls back to the free starter */
  if (!owns('body', state.body)) state.body = owns('body', 'monster') ? 'monster' : 'dump';
  if (!owns('wheels', state.wheels)) state.wheels = 'normal';
  if (!owns('color', state.color)) state.color = '#e53935';
  if (state.decal !== 'none' && !owns('decal', state.decal)) state.decal = 'none';
  if (state.buddy && !owns('buddy', state.buddy)) state.buddy = null;
  for (const k in state.extras) if (state.extras[k] && !owns('extras', k)) state.extras[k] = false;
}
function snapshot() { return { ...extra, build: state, ...progress }; }
/* localStorage holds about 5 MB per origin, shared by all 3 profiles. Replays are the only big thing in a
   save, so when a write is refused the longest replay in ANY profile goes first (the ghosts are a keepsake;
   stars, times and parts never are). Another profile's save is rewritten without that replay. */
function save() {
  if (!store) return;
  const others = {};
  for (let p = 0; p < MAX_PROFILES; p++) {
    if (p === meta.active) continue;
    try { const o = JSON.parse(lsGet('vroom.v2.p' + p)); if (o && o.levels) others[p] = o; } catch (e) {}
  }
  for (let tries = 0; tries < 2000; tries++) {
    try { store.setItem(saveKey(), JSON.stringify(snapshot())); return; } catch (e) { /* quota: shed a replay and retry */ }
    let worst = null, len = -1;
    const pick = (p, levels) => {
      for (const n in levels) {
        const r = levels[n] && levels[n].replay;
        if (r && typeof r.rle === 'string' && r.rle.length > len) { worst = { p, levels, n }; len = r.rle.length; }
      }
    };
    pick(meta.active, progress.levels);
    for (const p in others) pick(+p, others[p].levels);
    if (!worst) return;
    delete worst.levels[worst.n].replay;
    if (worst.p !== meta.active) { try { store.setItem('vroom.v2.p' + worst.p, JSON.stringify(others[worst.p])); } catch (e) {} }
  }
}

/* ---- the economy ---- */
function buy(kind, id) {
  if (kind === 'upgrade') {
    const lvl = progress.upgrades[id] | 0, cost = UPG[id] && UPG[id][lvl];
    if (!cost || progress.wallet < cost) return false;
    progress.wallet -= cost; progress.upgrades[id] = lvl + 1; badge('buy'); save(); return true;
  }
  if (!KIND_LIST[kind] || !KIND_LIST[kind].includes(id)) return false;
  if (owns(kind, id)) return true;
  const cost = price(kind, id);
  if (isSecret(kind, id) || cost <= 0 || progress.wallet < cost) return false;
  progress.wallet -= cost; progress.owned[kind].push(id); badge('buy'); save();
  return true;
}
const upgradePrice = k => (UPG[k] && UPG[k][progress.upgrades[k] | 0]) || 0;
const repairPrice = () => progress.damage * REPAIR_RATE;
function repair() {
  const cost = repairPrice();
  if (!cost || progress.wallet < cost) return false;
  progress.wallet -= cost; progress.damage = 0; save(); return true;
}
function badge(id) {
  if (!BADGE_IDS.includes(id) || progress.badges.includes(id)) return false;
  progress.badges.push(id); return true;
}
const levelOpen = n => n === 1 || (n >= 1 && n <= C.MAX_LEVEL && !!progress.levels[n - 1]) || (n === C.PARADE_LEVEL && !!progress.levels[C.MAX_LEVEL]);
/* bank a finished race. result = sim.result(); replay = { t, ticks, rle } or null. Stars only go up:
   every best is kept, the wallet only grows here. -> { payout, first, newBest, newTier, badges: [ids] } */
function recordRun(n, result, replay) {
  const prev = progress.levels[n], first = !prev, badgesBefore = progress.badges.length;
  const lv = progress.levels[n] = prev || { best: 0, rating: 1 };
  const newBest = !lv.t13 || result.time < lv.t13;
  lv.best = Math.max(lv.best, result.stars | 0);
  lv.rating = Math.max(lv.rating, Math.min(3, Math.max(1, result.rating | 0)));
  if (newBest) { lv.t13 = result.time; if (replay && replayValid(replay)) lv.replay = replayCopy(replay); }
  const newTier = TIER_RANK[result.tier] !== undefined && (lv.tier === undefined || TIER_RANK[result.tier] > TIER_RANK[lv.tier]);
  if (newTier) lv.tier = result.tier;
  /* bonus: boss stars from monsterAI.bonus (3 smashed, 2 outrun untouched, 1 outrun) */
  let payout = (result.stars | 0) + 3 + (result.clean ? 2 : 0) + clampInt(result.bonus, 0, 3);
  if (C.isFinale(n) && first) payout += 25;
  if (C.isFinale(n) && !progress.bosses.includes(C.worldOf(n))) { progress.bosses.push(C.worldOf(n)); progress.bosses.sort((a, b) => a - b); badge('boss'); }
  if (n === C.PARADE_LEVEL) { payout += first ? 100 : 10; badge('champ'); }
  progress.wallet = Math.min(999999, progress.wallet + payout);
  if (n < C.MAX_LEVEL) progress.current = Math.max(progress.current, n + 1);
  progress.damage = Math.min(MAX_DAMAGE, progress.damage + (result.hits ? Math.min(3, Math.ceil(result.hits / 3)) : 0));
  if (result.airTime > 0) badge('jump');
  if (result.clean) badge('clean');
  if (result.tier === 'S') badge('s');
  if (C.isFinale(n) && first) badge('world');
  if (result.stars > 0 && result.stars === result.starsTotal) badge('sweep');
  if (result.maxAir >= 3) badge('air');
  if (result.maxDrift >= 3) badge('drift');
  save();
  return { payout, first, newBest, newTier, badges: progress.badges.slice(badgesBefore) };
}

/* ---- replays: packed inputs per tick, run-length encoded as "value*count," pairs in base 36 ---- */
function encodeReplay(packed) {
  let out = '', i = 0;
  while (i < packed.length) { let j = i; while (j < packed.length && packed[j] === packed[i]) j++; out += packed[i].toString(36) + (j - i > 1 ? '*' + (j - i).toString(36) : '') + ','; i = j; }
  return out;
}
function decodeReplay(rle) {
  const out = [];
  for (const part of rle.split(',')) { if (!part) continue; const [v, n] = part.split('*'); const val = parseInt(v, 36), k = n ? parseInt(n, 36) : 1; for (let i = 0; i < k; i++) out.push(val); }
  return out;
}

/* ============ save codes (v12 section 17, unchanged in layout) ============ */
const b64url = {
  enc(bytes) {
    let s = '';
    for (const b of bytes) s += String.fromCharCode(b);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  },
  dec(str) {
    const s = atob(str.replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(s, c => c.charCodeAt(0));
  }
};
/* compact binary save: everything except photos, best times and replays, small enough for a QR.
   Format 3: every list is count-prefixed and the build rides along. Append only, never reorder. */
function packCompact() {
  const bits = [];
  const pushBits = (val, n) => { for (let i = n - 1; i >= 0; i--) bits.push((val >> i) & 1); };
  const pushList = (list, has) => { pushBits(list.length, 8); for (const id of list) pushBits(has(id) ? 1 : 0, 1); };
  pushBits(3, 8);                                     /* format version */
  pushBits(Math.min(65535, progress.wallet), 16);
  pushBits(progress.current, 8);
  pushBits(progress.damage, 4);
  pushBits(progress.quiet ? 1 : 0, 1);
  pushBits(progress.muddy ? 1 : 0, 1);
  pushBits(progress.upgrades.engine, 2); pushBits(progress.upgrades.armor, 2); pushBits(progress.upgrades.magnet, 2);
  pushList(CODE_BODIES, id => progress.owned.body.includes(id));
  pushList(CODE_WHEELS, id => progress.owned.wheels.includes(id));
  pushList(CODE_COLORS, id => progress.owned.color.includes(id));
  pushList(CODE_EXTRAS, id => progress.owned.extras.includes(id));
  pushList(CODE_DECALS, id => progress.owned.decal.includes(id));
  pushList(BUDDY_ORDER, id => progress.owned.buddy.includes(id));
  pushList(BADGE_IDS, id => progress.badges.includes(id));
  /* the build: indices into the (append-only) catalog orders, 8 bits each */
  pushBits(Math.max(0, BODY_ORDER.indexOf(state.body)), 8);
  pushBits(Math.max(0, WHEEL_ORDER.indexOf(state.wheels)), 8);
  pushBits(Math.max(0, COLORS.indexOf(state.color)), 8);
  pushBits(Math.max(0, DECAL_ORDER.indexOf(state.decal)), 8);
  pushBits(state.buddy ? BUDDY_ORDER.indexOf(state.buddy) + 1 : 0, 8);
  pushList(EXTRA_ORDER, id => !!state.extras[id]);
  while (bits.length % 8) pushBits(0, 1);
  pushBits(C.MAX_LEVEL, 8);
  for (let n = 1; n <= C.MAX_LEVEL; n++) {
    const lv = progress.levels[n];
    pushBits(lv ? lv.rating : 0, 2);
    pushBits(lv && lv.tier ? TIER_RANK[lv.tier] : 0, 2);
  }
  /* v3 tail (12.2): whole units of fuel + tread; a code without the tail reads as full */
  pushBits(Math.ceil(progress.fuel), 4); pushBits(Math.ceil(progress.tread), 4);
  pushBits(state.number ? parseInt(state.number, 10) + 1 : 0, 7);   /* 12.3: race number, 0 = none */
  pushBits(progress.upgrades.tank, 2); pushBits(progress.upgrades.springs, 2);   /* 12.7: the two newer ladders */
  /* 13.0 tail: the bosses beaten, one bit per world (worlds 1..12) */
  for (let w = 1; w <= C.WORLD_COUNT; w++) pushBits(progress.bosses.includes(w) ? 1 : 0, 1);
  const bytes = new Uint8Array(Math.ceil(bits.length / 8));
  bits.forEach((b, i) => { if (b) bytes[i >> 3] |= 128 >> (i & 7); });
  return 'VROOM1.' + b64url.enc(bytes);
}
function unpackCompact(code) {
  const bytes = b64url.dec(code);
  let pos = 0;
  const read = n => { let v = 0; for (let i = 0; i < n; i++) { v = (v << 1) | ((bytes[pos >> 3] >> (7 - (pos & 7))) & 1); pos++; } return v; };
  const ver = read(8);
  if (ver !== 1 && ver !== 2 && ver !== 3) return null;
  const out = {
    build: { body: 'dump', wheels: 'normal', color: '#fdd835', buddy: null, decal: 'none', number: '', extras: { horn: false, beacon: false, flag: false } },
    wallet: read(16), current: read(8),
    damage: read(4), quiet: !!read(1),
    owned: { body: [], wheels: [], color: [], extras: [], buddy: [], decal: [] },
    levels: {}, badges: [], photos: [],
    upgrades: null
  };
  const TIER_OF = ['C', 'B', 'A', 'S'];
  if (ver === 3) {
    out.muddy = !!read(1);
    out.upgrades = { engine: read(2), armor: read(2), magnet: read(2) };
    const readList = (list, onHit) => { const n = read(8); for (let i = 0; i < n; i++) if (read(1) && list[i] !== undefined) onHit(list[i]); };
    readList(CODE_BODIES, id => out.owned.body.push(id));
    readList(CODE_WHEELS, id => out.owned.wheels.push(id));
    readList(CODE_COLORS, id => out.owned.color.push(id));
    readList(CODE_EXTRAS, id => out.owned.extras.push(id));
    readList(CODE_DECALS, id => out.owned.decal.push(id));
    readList(BUDDY_ORDER, id => out.owned.buddy.push(id));
    readList(BADGE_IDS, id => out.badges.push(id));
    out.build.body = BODY_ORDER[read(8)] || 'dump';
    out.build.wheels = WHEEL_ORDER[read(8)] || 'normal';
    out.build.color = COLORS[read(8)] || '#fdd835';
    out.build.decal = DECAL_ORDER[read(8)] || 'none';
    const bi = read(8);
    if (bi) out.build.buddy = BUDDY_ORDER[bi - 1] || null;
    readList(EXTRA_ORDER, id => { out.build.extras[id] = true; });
    while (pos % 8) read(1);
    const nLevels = read(8);
    for (let n = 1; n <= nLevels; n++) {
      const rating = read(2), tr = read(2);
      if (rating && n <= C.MAX_LEVEL) out.levels[n] = { best: 0, rating, tier: TIER_OF[tr] };
    }
    if (pos > bytes.length * 8) return null;
    if (pos + 8 <= bytes.length * 8) { out.fuel = Math.min(FUEL_MAX + 6, read(4)); out.tread = Math.min(TREAD_MAX, read(4)); }
    if (pos + 7 <= bytes.length * 8) { const n = read(7); if (n) out.build.number = String(Math.min(99, n - 1)); }
    if (pos + 4 <= bytes.length * 8) { out.upgrades.tank = read(2); out.upgrades.springs = read(2); }   /* 12.7 tail */
    if (pos + C.WORLD_COUNT <= bytes.length * 8) {   /* 13.0 tail; a v12 code's zero padding reads as no bosses */
      out.bosses = [];
      for (let w = 1; w <= C.WORLD_COUNT; w++) if (read(1)) out.bosses.push(w);
    }
    return out;
  }
  const buddyIdx = read(3);
  out.upgrades = { engine: read(2), armor: read(2), magnet: read(2) };
  read(2);
  /* formats 1-2 carried fixed-width flag runs: the catalog as it stood then (CODE_V2), not today's */
  const colors = CODE_COLORS.slice(0, CODE_COLORS_V2);
  for (const [list, kind] of [[CODE_BODIES.slice(0, CODE_V2.body), 'body'], [CODE_WHEELS.slice(0, CODE_V2.wheels), 'wheels'], [colors, 'color'], [CODE_EXTRAS.slice(0, CODE_V2.extras), 'extras']]) {
    for (const id of list) if (read(1) && id) out.owned[kind].push(id);
  }
  for (const id of BUDDY_ORDER.slice(0, CODE_V2.buddy)) if (read(1)) out.owned.buddy.push(id);
  for (const id of CODE_BADGES) if (read(1)) out.badges.push(id);
  while (pos % 8) read(1);
  for (let n = 1; n <= 80; n++) {   /* formats 1-2 always carried exactly 80 levels */
    const rating = read(2), tr = read(2);
    if (rating) out.levels[n] = { best: 0, rating, tier: TIER_OF[tr] };
  }
  if (ver >= 2 && pos + 9 <= bytes.length * 8) {
    for (const id of CODE_DECALS.slice(0, CODE_V2.decals)) if (read(1)) out.owned.decal.push(id);
    const di = read(3);
    if (di) out.build.decal = DECAL_ORDER[di] || 'none';
    out.muddy = !!read(1);
  }
  if (buddyIdx) out.build.buddy = BUDDY_ORDER[buddyIdx - 1];
  if (pos > bytes.length * 8) return null;   /* truncated code: the reads ran past the payload */
  return out;
}
/* full text code: the entire save, gzip-compressed where the platform can */
async function exportFullCode() {
  /* ghost traces, replays, the daily gift and free-drive stamps and the album's seen list are local keepsakes: they never ride in a save code */
  const levels = {};
  for (const n in progress.levels) { const { ghost, replay, ...rest } = progress.levels[n]; void ghost; void replay; levels[n] = rest; }
  const json = JSON.stringify({ ...snapshot(), levels, lastGift: undefined, freeDay: undefined, freeUsed: undefined, albumSeen: undefined });
  if (typeof CompressionStream !== 'undefined') {
    const stream = new Blob([json]).stream().pipeThrough(new CompressionStream('gzip'));
    const buf = await new Response(stream).arrayBuffer();
    return 'VROOM2.' + b64url.enc(new Uint8Array(buf));
  }
  return 'VROOM3.' + b64url.enc(new TextEncoder().encode(json));
}
async function decodeSaveCode(code) {
  /* 13.x: a code pasted back from a message comes wrapped in whatever text rode along with it: pick the token out */
  const m = /VROOM[123]\.[A-Za-z0-9_-]+/.exec(code || '');
  code = m ? m[0] : (code || '').trim();
  if (code.startsWith('VROOM1.')) return unpackCompact(code.slice(7));
  if (code.startsWith('VROOM2.')) {
    const stream = new Blob([b64url.dec(code.slice(7))]).stream().pipeThrough(new DecompressionStream('gzip'));
    return JSON.parse(await new Response(stream).text());
  }
  if (code.startsWith('VROOM3.')) return JSON.parse(new TextDecoder().decode(b64url.dec(code.slice(7))));
  return null;
}
/* decode a code and check it looks like a save -> the data (for the wordless confirm) or null */
async function checkCode(code) {
  let data = null;
  try { data = await decodeSaveCode(code); } catch (e) {}
  return data && data.owned && Number.isFinite(data.wallet) ? data : null;
}
/* the player confirmed: the decoded data becomes this profile's save (the caller reloads the page) */
function importData(data) {
  /* a 13.x full code carries the player's avatar: it comes along when no other slot wears it already */
  const { avatar, ...rest } = data;
  if (AVATAR_IDS.includes(avatar) && !meta.avatars.some((a, i) => a === avatar && i !== meta.active)) { meta.avatars[meta.active] = avatar; saveMeta(); }
  lsSet(saveKey(), JSON.stringify(rest));
}
/* a save code in the URL (a scanned QR opened the hosted game): read once at load, then cleared */
let hashCode = '';
try {
  if (typeof location !== 'undefined' && location.hash.startsWith('#save=')) {
    try { hashCode = decodeURIComponent(location.hash.slice(6)); } catch (e) {}
    if (typeof history !== 'undefined') history.replaceState(null, '', location.pathname + location.search);
  }
} catch (e) {}


/* ---- QR encoder: byte mode, ECC level L, versions 1-10 ----
   v1-5 are single-block; v6-10 split data into Reed-Solomon blocks and interleave
   codewords per the spec, v7+ carry the 18-bit BCH version-info blocks. Verified
   byte-exact against jsQR across every version boundary in tests/. */
function qrEncode(text) {
  const BLOCKS = [null,
    [19], [34], [55], [80], [108],
    [68, 68], [78, 78], [97, 97], [116, 116],
    [68, 68, 69, 69]
  ];
  const ECPB = [0, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18];
  const ALIGN = [null, [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];
  const data = new TextEncoder().encode(text);
  let ver = 0, dataCW = 0;
  for (let v = 1; v <= 10; v++) {
    dataCW = BLOCKS[v].reduce((a, b) => a + b, 0);
    if (data.length <= dataCW - (v >= 10 ? 3 : 2)) { ver = v; break; }
  }
  if (!ver) return null;
  /* bitstream -> data codewords */
  const bits = [];
  const pushBits = (val, n) => { for (let i = n - 1; i >= 0; i--) bits.push((val >> i) & 1); };
  pushBits(4, 4); pushBits(data.length, ver >= 10 ? 16 : 8);
  for (const b of data) pushBits(b, 8);
  pushBits(0, Math.min(4, dataCW * 8 - bits.length));
  while (bits.length % 8) pushBits(0, 1);
  const cw = [];
  for (let i = 0; i < bits.length; i += 8) cw.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
  for (let pad = 0; cw.length < dataCW; pad++) cw.push(pad % 2 ? 0x11 : 0xEC);
  /* Reed-Solomon over GF(256), one remainder per block */
  const gexp = new Array(512), glog = new Array(256);
  for (let i = 0, x = 1; i < 255; i++) { gexp[i] = x; glog[x] = i; x <<= 1; if (x & 256) x ^= 0x11d; }
  for (let i = 255; i < 512; i++) gexp[i] = gexp[i - 255];
  const ecLen = ECPB[ver];
  let gen = [1];
  for (let i = 0; i < ecLen; i++) {
    const next = new Array(gen.length + 1).fill(0);
    for (let j = 0; j < gen.length; j++) {
      next[j] ^= gexp[(glog[gen[j]] + i) % 255];
      next[j + 1] ^= gen[j];
    }
    gen = next;
  }
  const rsRemainder = block => {
    const ec = new Array(ecLen).fill(0);
    for (const c of block) {
      const factor = c ^ ec.shift();
      ec.push(0);
      if (factor) for (let j = 0; j < gen.length - 1; j++) ec[j] ^= gexp[(glog[gen[gen.length - 2 - j]] + glog[factor]) % 255];
    }
    return ec;
  };
  /* split -> per-block EC -> interleave */
  const blocksData = [];
  let off = 0;
  for (const len of BLOCKS[ver]) { blocksData.push(cw.slice(off, off + len)); off += len; }
  const blocksEC = blocksData.map(rsRemainder);
  const all = [];
  const maxD = Math.max(...BLOCKS[ver]);
  for (let i = 0; i < maxD; i++) for (const bd of blocksData) if (i < bd.length) all.push(bd[i]);
  for (let i = 0; i < ecLen; i++) for (const be of blocksEC) all.push(be[i]);
  /* matrix */
  const size = 17 + 4 * ver;
  const M = Array.from({ length: size }, () => new Array(size).fill(null));   /* null = free for data */
  const setRegion = (r, c, pattern) => pattern.forEach((row, dr) => row.forEach((v, dc) => {
    if (r + dr >= 0 && r + dr < size && c + dc >= 0 && c + dc < size) M[r + dr][c + dc] = v;
  }));
  const finder = [...Array(7)].map((_, r) => [...Array(7)].map((_, c) =>
    (r === 0 || r === 6 || c === 0 || c === 6 || (r >= 2 && r <= 4 && c >= 2 && c <= 4)) ? 1 : 0));
  setRegion(0, 0, finder); setRegion(0, size - 7, finder); setRegion(size - 7, 0, finder);
  for (let i = 0; i < 8; i++) {
    M[7][i] = 0; M[i][7] = 0;
    M[7][size - 1 - i] = 0; M[i][size - 8] = 0;
    M[size - 8][i] = 0; M[size - 1 - i][7] = 0;
  }
  /* alignment grid: all center pairs except the three finder corners */
  const align = [...Array(5)].map((_, r) => [...Array(5)].map((_, c) =>
    (r === 0 || r === 4 || c === 0 || c === 4 || (r === 2 && c === 2)) ? 1 : 0));
  for (const ar of ALIGN[ver]) for (const ac of ALIGN[ver]) {
    if ((ar <= 8 && ac <= 8) || (ar <= 8 && ac >= size - 9) || (ar >= size - 9 && ac <= 8)) continue;
    setRegion(ar - 2, ac - 2, align);
  }
  for (let i = 8; i < size - 8; i++) { if (M[6][i] === null) M[6][i] = i % 2 ? 0 : 1; if (M[i][6] === null) M[i][6] = i % 2 ? 0 : 1; }
  M[size - 8][8] = 1;   /* dark module */
  /* reserve format info cells */
  const fmtCells = [];
  for (let i = 0; i <= 5; i++) fmtCells.push([8, i], [i, 8]);
  fmtCells.push([8, 7], [8, 8], [7, 8]);
  for (let i = 0; i < 8; i++) fmtCells.push([8, size - 1 - i], [size - 1 - i, 8]);
  fmtCells.forEach(([r, c]) => { if (M[r][c] === null) M[r][c] = 0; });
  /* version info blocks (v7+): 18-bit BCH(18,6), poly 0x1F25 */
  if (ver >= 7) {
    let rem = ver << 12;
    for (let i = 17; i >= 12; i--) if ((rem >> i) & 1) rem ^= 0x1F25 << (i - 12);
    const vi = (ver << 12) | rem;
    for (let j = 0; j < 18; j++) {
      const bit = (vi >> j) & 1;
      M[size - 11 + (j % 3)][Math.floor(j / 3)] = bit;   /* bottom-left block */
      M[Math.floor(j / 3)][size - 11 + (j % 3)] = bit;   /* top-right block */
    }
  }
  /* zigzag data placement with mask 0: (r+c)%2===0 flips */
  let bitIdx = 0;
  const totalBits = all.length * 8;
  let upward = true;
  for (let col = size - 1; col > 0; col -= 2) {
    if (col === 6) col--;
    for (let i = 0; i < size; i++) {
      const r = upward ? size - 1 - i : i;
      for (const c of [col, col - 1]) {
        if (M[r][c] !== null) continue;
        let bit = bitIdx < totalBits ? (all[bitIdx >> 3] >> (7 - (bitIdx & 7))) & 1 : 0;
        bitIdx++;
        if ((r + c) % 2 === 0) bit ^= 1;
        M[r][c] = bit;
      }
    }
    upward = !upward;
  }
  /* format info: ECC L (01) + mask 0 (000) -> BCH(15,5), XOR 0x5412 */
  let fmt = 0b01000 << 10;
  let frem = fmt;
  for (let i = 14; i >= 10; i--) if ((frem >> i) & 1) frem ^= 0x537 << (i - 10);
  fmt = (fmt | frem) ^ 0x5412;
  const fbit = i => (fmt >> i) & 1;
  for (let i = 0; i <= 5; i++) { M[8][i] = fbit(14 - i); M[i][8] = fbit(i); }
  M[8][7] = fbit(8); M[8][8] = fbit(7); M[7][8] = fbit(6);
  for (let i = 0; i < 8; i++) M[8][size - 1 - i] = fbit(i);
  for (let i = 0; i < 7; i++) M[size - 1 - i][8] = fbit(14 - i);   /* 7 bits; (size-8,8) is the dark module */
  return M;
}
/* the QR carries the full hosted URL, so a camera opens the game with the save ready to import;
   falls back to the bare code if ever too big. -> boolean[][] (true = dark) or null */
const SAVE_URL_PREFIX = 'https://acker-cloud.github.io/vroom/#save=';
function qrMatrix() {
  const code = packCompact();
  return qrEncode(SAVE_URL_PREFIX + code) || qrEncode(code);
}

VROOM.save = {
  ids, state, progress, meta, MAX_PROFILES, AVATAR_IDS, UPG, MAX_DAMAGE, TIER_RANK,
  load, save, apply, snapshot, owns, price, isSecret, buy, upgradePrice, repairPrice, repair, badge, levelOpen, recordRun,
  switchProfile, saveMeta, encodeReplay, decodeReplay,
  packCompact, unpackCompact, exportFullCode, decodeSaveCode, checkCode, importData, qrEncode, qrMatrix, SAVE_URL_PREFIX,
  hashCode: () => hashCode,
};
