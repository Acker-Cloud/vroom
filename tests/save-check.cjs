/* save-check: v12 saves and save codes still load in v13. Owner: integrator. Node only.
   tests/fixtures/v12-saves.json was captured from the shipped v12.9 game (legacy/v12/index.html):
   its localStorage saves, its VROOM1 compact codes and VROOM2 full codes, and its catalog lists.
   tests/fixtures/v13.29-saves.json was captured the same way from the last hosted 2D build (legacy/v13.29/index.html):
   a three-slot localStorage with a deleted slot 0, the 13.x fields (photo wall, album seen list, free-drive day),
   and its VROOM1, VROOM2 and VROOM3 codes. */
'use strict';
const fs = require('fs'), path = require('path');
const { check, done } = require('./lib.cjs');
const { simSource, ROOT } = require('../scripts/build.cjs');
const fx = require('./fixtures/v12-saves.json');
const f13 = require('./fixtures/v13.29-saves.json');

/* a fresh VROOM with the sim region and save.js loaded over the given localStorage contents */
function boot(ls = {}) {
  const mem = new Map(Object.entries(ls));
  globalThis.localStorage = { getItem: k => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: k => mem.delete(k) };
  const VROOM = { scenes: {} };
  const saveSrc = fs.readFileSync(path.join(ROOT, 'src/save.js'), 'utf8');
  new Function('VROOM', simSource() + `\n(function (VROOM) { 'use strict';\n${saveSrc}\n})(VROOM);`)(VROOM);
  VROOM.save.load();
  return { V: VROOM, S: VROOM.save, mem };
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
/* codes carry ownership as flags in catalog order, so compare owned lists as sets */
const sameSet = (a, b) => same([...(a || [])].sort(), [...(b || [])].sort());

(async () => {
  const { V } = boot();
  const L = V.contracts.LEGACY, lists = fx.cases[0].lists;
  for (const k of ['BODY_ORDER', 'WHEEL_ORDER', 'COLORS', 'DECAL_ORDER', 'BUDDY_ORDER', 'CODE_BODIES', 'CODE_WHEELS', 'CODE_COLORS', 'CODE_EXTRAS', 'CODE_DECALS', 'CODE_BADGES']) {
    check(`LEGACY.${k} is the v12 list exactly`, same(L[k], lists[k]));
    const live = V.save.ids[k];
    if (live) check(`save.ids.${k} starts with the v12 list (append only)`, same(live.slice(0, lists[k].length), lists[k]));
  }
  check('LEGACY.EXTRAS is the v12 extras order', same(L.EXTRAS, lists.EXTRAS));
  check('save.ids.EXTRA_ORDER starts with it', same(V.save.ids.EXTRA_ORDER.slice(0, lists.EXTRAS.length), lists.EXTRAS));
  check('save.ids.BADGE_IDS starts with the v12 badges', same(V.save.ids.BADGE_IDS.slice(0, lists.BADGES.length), lists.BADGES));
  check('LEGACY.PRICES are the v12 prices', same(L.PRICES, lists.PRICES));

  for (const c of fx.cases) {
    const { S } = boot({ 'vroom.v2.p0': JSON.stringify(c.saved), 'vroom.meta': JSON.stringify({ active: 0, avatars: ['pup', null, null] }) });
    const sv = c.saved;
    check(`${c.label}: wallet, current, damage load`, S.progress.wallet === sv.wallet && S.progress.current === sv.current && S.progress.damage === sv.damage);
    check(`${c.label}: every owned list loads`, ['body', 'wheels', 'color', 'extras', 'decal', 'buddy'].every(k => same(S.progress.owned[k], sv.owned[k])), JSON.stringify(S.progress.owned));
    check(`${c.label}: levels keep rating, tier and v12 best time`, Object.keys(sv.levels).every(n => S.progress.levels[n] && S.progress.levels[n].rating === sv.levels[n].rating && S.progress.levels[n].tier === sv.levels[n].tier && S.progress.levels[n].bestTime === sv.levels[n].bestTime));
    check(`${c.label}: upgrades and badges load`, same(S.progress.upgrades, sv.upgrades) && same(S.progress.badges, sv.badges));
    const b = sv.build, s = S.state;
    if (c.label === 'played') check(`${c.label}: the saved build loads`, s.body === b.body && s.wheels === b.wheels && s.color === b.color && s.decal === b.decal && s.buddy === b.buddy && s.number === b.number && s.extras.wings && s.extras.jetpack && s.extras.horn, JSON.stringify(s));

    const d = S.unpackCompact(c.compact.slice(7));
    check(`${c.label}: the v12 VROOM1 code decodes`, !!d && d.wallet === sv.wallet && d.current === sv.current && ['body', 'wheels', 'color', 'extras', 'decal', 'buddy'].every(k => sameSet(d.owned[k], sv.owned[k])) && sameSet(d.badges, sv.badges));
    check(`${c.label}: its build, fuel, tread, number and upgrades decode`, d.build.body === b.body && d.build.wheels === b.wheels && d.build.color === b.color && d.build.number === b.number
      && d.fuel === Math.ceil(sv.fuel) && d.tread === Math.ceil(sv.tread) && same(d.upgrades, sv.upgrades) && same(d.bosses || [], []));
    const full = await S.decodeSaveCode(c.full);
    check(`${c.label}: the v12 VROOM2 full code decodes`, !!full && full.wallet === sv.wallet && same(full.owned, sv.owned));
    const re = S.unpackCompact(S.packCompact().slice(7));
    check(`${c.label}: a v13 code round-trips the loaded save`, re.wallet === sv.wallet && sameSet(re.owned.body, sv.owned.body) && re.build.body === S.state.body && same(re.upgrades, sv.upgrades));
  }

  /* 13.29: the 2D line kept shipping after v12.9; its players' saves and codes load whole */
  {
    const L13 = f13.lists, Lg = V.contracts.LEGACY;
    for (const k of ['BODY_ORDER', 'WHEEL_ORDER', 'COLORS', 'DECAL_ORDER', 'BUDDY_ORDER', 'EXTRAS', 'BADGES', 'CODE_BODIES', 'CODE_WHEELS', 'CODE_COLORS', 'CODE_EXTRAS', 'CODE_DECALS', 'CODE_BADGES'])
      check(`13.29 appended nothing to ${k}: LEGACY matches it`, same(Lg[k], L13[k]));
    check('13.29 avatars are the six save.AVATAR_IDS', same(V.save.AVATAR_IDS, L13.AVATAR_IDS));
    const sv = f13.played.saved, ls = f13.localStorage;
    const { S: P2 } = boot(ls);
    check('13.29 profiles: the active slot and a deleted slot 0 load as they were', P2.meta.active === 2 && same(P2.meta.avatars, [null, 'kitty', 'monkey']), JSON.stringify(P2.meta));
    check('13.29 profiles: the active kid\'s own save loads', P2.progress.wallet === 88 && Object.keys(P2.progress.levels).length === 3 && P2.state.body === 'police' && same(P2.progress.owned.buddy, ['pup']));
    const { S: P, mem } = boot({ ...ls, 'vroom.meta': JSON.stringify({ active: 1, avatars: [null, 'kitty', 'monkey'] }) });
    const pr = P.progress, st = P.state, b = sv.build;
    check('13.29 save: wallet, current, damage, mud, quiet, fuel and tread load', pr.wallet === sv.wallet && pr.current === sv.current && pr.damage === sv.damage && pr.muddy === sv.muddy && pr.quiet === sv.quiet && pr.fuel === sv.fuel && pr.tread === sv.tread);
    check('13.29 save: every owned list loads (secret paint too)', ['body', 'wheels', 'color', 'extras', 'decal', 'buddy'].every(k => same(pr.owned[k], sv.owned[k])), JSON.stringify(pr.owned));
    check('13.29 save: upgrades and badges load', same(pr.upgrades, sv.upgrades) && same(pr.badges, sv.badges));
    check('13.29 save: all 96 levels keep best, rating, tier, time and ghost', Object.keys(sv.levels).length === 96 && same(pr.levels, sv.levels));
    check('13.29 save: the build loads', st.body === b.body && st.wheels === b.wheels && st.color === b.color && st.buddy === b.buddy && st.decal === b.decal && st.number === b.number
      && Object.keys(b.extras).every(k => st.extras[k] === b.extras[k]), JSON.stringify(st));
    check('13.23 photo wall: all 11 frames load (10 worlds and the parade), not the v12 six', sv.photos.length === 11 && same(pr.photos, sv.photos), String(pr.photos.length));
    check('13.x album seen list, free-drive day and daily gift load', same(pr.albumSeen, sv.albumSeen) && pr.freeDay === sv.freeDay && pr.freeUsed === sv.freeUsed && pr.lastGift === sv.lastGift);
    P.save();
    const re = JSON.parse(mem.get('vroom.v2.p1'));
    check('13.29 save: re-saved, every 13.29 field is written back unchanged', Object.keys(sv).filter(k => k !== 'build').every(k => same(re[k], sv[k])),
      Object.keys(sv).filter(k => k !== 'build' && !same(re[k], sv[k])).join(','));
    check('13.29 save: re-saved, the build keeps every 13.29 part', Object.keys(b).filter(k => k !== 'extras').every(k => re.build[k] === b[k]) && Object.keys(b.extras).every(k => re.build.extras[k] === b.extras[k]));
    check('13.29 save: re-saving leaves the other slots alone', mem.get('vroom.v2.p2') === ls['vroom.v2.p2'] && !mem.has('vroom.v2.p0'));
    const { S: P3 } = boot(Object.fromEntries(mem));
    check('13.29 save: a second load of the re-saved file is identical', same(P3.snapshot(), P.snapshot()));

    /* records only improve: the 13.29 tier and v12-era time stay when a v14 run is worse */
    const sLv = Object.keys(sv.levels).find(n => sv.levels[n].tier === 'S' && sv.levels[n].ghost), cLv = Object.keys(sv.levels).find(n => sv.levels[n].tier === 'C' && n % 10 !== 0);
    P.recordRun(+sLv, { time: 99, stars: 0, starsTotal: 20, rating: 1, tier: 'B', hits: 0, airTime: 0, clean: false });
    P.recordRun(+cLv, { time: 30, stars: 1, starsTotal: 20, rating: 1, tier: 'A', hits: 0, airTime: 0, clean: false });
    const ls1 = pr.levels[sLv], lc = pr.levels[cLv];
    check('TIER_RANK: a worse v14 run keeps the 13.29 S, best, rating, time and ghost', ls1.tier === 'S' && ls1.best === sv.levels[sLv].best && ls1.rating === sv.levels[sLv].rating && ls1.bestTime === sv.levels[sLv].bestTime && same(ls1.ghost, sv.levels[sLv].ghost) && ls1.t13 === 99, JSON.stringify(ls1));
    check('TIER_RANK: a better v14 tier replaces the 13.29 C', lc.tier === 'A' && lc.best === sv.levels[cLv].best && lc.bestTime === sv.levels[cLv].bestTime, JSON.stringify(lc));

    /* the three 13.29 code formats */
    const d = P.unpackCompact(f13.played.compact.slice(7));
    check('13.29 VROOM1 code: wallet, current, damage, mud, quiet, owned and badges decode', !!d && d.wallet === sv.wallet && d.current === sv.current && d.damage === sv.damage && d.muddy === sv.muddy && d.quiet === sv.quiet
      && ['body', 'wheels', 'color', 'extras', 'decal', 'buddy'].every(k => sameSet(d.owned[k], sv.owned[k])) && sameSet(d.badges, sv.badges.filter(x => V.save.ids.BADGE_IDS.includes(x))));
    check('13.29 VROOM1 code: build, upgrades, fuel, tread and number decode', d.build.body === b.body && d.build.wheels === b.wheels && d.build.color === b.color && d.build.decal === b.decal && d.build.buddy === b.buddy && d.build.number === b.number
      && Object.keys(b.extras).every(k => !!d.build.extras[k] === b.extras[k]) && same(d.upgrades, sv.upgrades) && d.fuel === Math.ceil(sv.fuel) && d.tread === Math.ceil(sv.tread) && same(d.bosses || [], []));
    check('13.29 VROOM1 code: every level rating and tier decodes', Object.keys(sv.levels).every(n => d.levels[n] && d.levels[n].rating === sv.levels[n].rating && d.levels[n].tier === sv.levels[n].tier) && Object.keys(d.levels).length === 96);
    const exported = { ...sv, levels: Object.fromEntries(Object.entries(sv.levels).map(([n, { ghost, ...lv }]) => (void ghost, [n, lv]))) };
    for (const [fmt, code] of [['VROOM2 (gzip)', f13.played.full], ['VROOM3 (plain)', f13.played.plain]]) {
      const full = await P.decodeSaveCode(code);
      check(`13.29 ${fmt} code decodes whole: wallet, owned, levels, photos, badges, upgrades and the avatar`, !!full && full.wallet === sv.wallet && same(full.owned, sv.owned) && same(full.levels, exported.levels)
        && same(full.photos, sv.photos) && same(full.badges, sv.badges) && same(full.upgrades, sv.upgrades) && full.avatar === 'penguin' && full.freeDay === undefined && full.albumSeen === undefined);
      const wrapped = await P.checkCode('here is my car! ' + code + ' :)');
      check(`13.29 ${fmt} code still decodes pasted inside a message`, !!wrapped && wrapped.wallet === sv.wallet);
    }
    const sec = await P.decodeSaveCode(f13.second.full);
    check('13.29 second kid\'s full code decodes', !!sec && sec.wallet === 88 && sec.avatar === 'monkey');

    /* importing a 13.29 full code into a slot: its avatar comes along unless another slot wears it */
    const { S: I, mem: im } = boot(ls);
    I.importData(await I.checkCode(f13.played.full));
    const { S: I2 } = boot(Object.fromEntries(im));
    check('importing a 13.29 full code lands the save and its avatar in the active slot', I2.meta.active === 2 && same(I2.meta.avatars, [null, 'kitty', 'penguin']) && I2.progress.wallet === sv.wallet
      && same(I2.progress.levels, exported.levels) && same(I2.progress.photos, sv.photos) && !('avatar' in JSON.parse(im.get('vroom.v2.p2'))));
    const { S: J, mem: jm } = boot(ls);
    J.importData({ ...(await J.checkCode(f13.second.full)), avatar: 'kitty' });
    check('an imported avatar another slot already wears is not taken', same(JSON.parse(jm.get('vroom.meta')).avatars, [null, 'kitty', 'monkey']));
    const rc = P.unpackCompact(P.packCompact().slice(7));
    check('a v14 code of the loaded 13.29 save round-trips', rc.wallet === pr.wallet && rc.build.body === st.body && same(rc.upgrades, pr.upgrades) && ['body', 'wheels', 'color', 'extras', 'decal', 'buddy'].every(k => sameSet(rc.owned[k], pr.owned[k])));
  }

  const { S: F, mem } = boot();
  check('a fresh save starts in a free, owned monster truck', F.state.body === 'monster' && F.owns('body', 'monster'));
  check('a fresh save cannot buy what it cannot afford', F.buy('body', 'hover') === false && F.progress.wallet === 0);
  F.progress.levels[1] = { best: 9, rating: 3, tier: 'S', bestTime: 12 };
  const rec = F.recordRun(1, { time: 50, stars: 4, starsTotal: 20, rating: 1, tier: 'C', hits: 0, airTime: 1, clean: true });
  const lv = F.progress.levels[1];
  check('recordRun: stars only go up (bests and tier kept, wallet grows)', lv.best === 9 && lv.rating === 3 && lv.tier === 'S' && lv.t13 === 50 && F.progress.wallet === rec.payout && rec.payout > 0);
  F.recordRun(10, { time: 80, stars: 1, starsTotal: 20, rating: 1, tier: 'B', hits: 4, airTime: 0, clean: false });
  check('recordRun: a finale banks its boss and the 13.0 code tail carries it', same(F.progress.bosses, [1]) && same(F.unpackCompact(F.packCompact().slice(7)).bosses, [1]));
  const packed = [1, 1, 1, 5, 5, 300000, 2];
  check('replays round-trip through encodeReplay / decodeReplay', same(F.decodeReplay(F.encodeReplay(packed)), packed));
  const withExtra = { ...fx.cases[1].saved, futureField: { a: 1 } };
  const { S: U, mem: um } = boot({ 'vroom.v2.p0': JSON.stringify(withExtra) });
  U.save();
  check('unknown save fields round-trip untouched', same(JSON.parse(um.get('vroom.v2.p0')).futureField, { a: 1 }));
  check('saves stay on the vroom.v2.p<n> key', mem.has('vroom.meta') && [...um.keys()].includes('vroom.v2.p0'));
  const v1 = boot({ 'vroom.v1': JSON.stringify({ body: 'fire', wheels: 'racing', color: '#43a047', extras: { horn: true } }) });
  check('a v1 save still migrates', v1.S.state.body === 'fire' && v1.S.state.wheels === 'racing' && v1.S.state.extras.horn);

  /* the economy rules v12's damage, parade and verify suites guarded, on the v13 recordRun */
  {
    const { S: E } = boot();
    E.progress.wallet = 1000;
    E.recordRun(1, { time: 60, stars: 0, starsTotal: 10, rating: 1, tier: 'C', hits: 30, airTime: 0, clean: false });
    E.recordRun(2, { time: 60, stars: 0, starsTotal: 10, rating: 1, tier: 'C', hits: 30, airTime: 0, clean: false });
    E.recordRun(3, { time: 60, stars: 0, starsTotal: 10, rating: 1, tier: 'C', hits: 30, airTime: 0, clean: false });
    check('hits dent the machine, capped at 9', E.progress.damage === 9, String(E.progress.damage));
    const w0 = E.progress.wallet, cost = E.repairPrice();
    check('repair costs 2 stars a dent and hammers every dent out', cost === 18 && E.repair() && E.progress.damage === 0 && E.progress.wallet === w0 - 18);
    const u0 = E.progress.wallet;
    check('upgrade ladders charge 60 / 150 / 350 and stop at 3 pips', E.buy('upgrade', 'engine') && E.buy('upgrade', 'engine') && E.buy('upgrade', 'engine') && !E.buy('upgrade', 'engine') && E.progress.upgrades.engine === 3 && E.progress.wallet === u0 - 560);
    const p1 = E.recordRun(10, { time: 80, stars: 5, starsTotal: 20, rating: 1, tier: 'B', hits: 1, airTime: 0, clean: false, bonus: 3 });
    const p2 = E.recordRun(10, { time: 80, stars: 5, starsTotal: 20, rating: 1, tier: 'B', hits: 1, airTime: 0, clean: false, bonus: 1 });
    check('a finale pays its first-clear bonus once, plus the boss bonus stars', p1.payout === 5 + 3 + 25 + 3 && p2.payout === 5 + 3 + 1, p1.payout + ' ' + p2.payout);
    const b = E.recordRun(4, { time: 50, stars: 1, starsTotal: 9, rating: 1, tier: 'C', hits: 0, airTime: 4, clean: true, maxAir: 3.2, maxDrift: 3.5 });
    check('3 s of air and a 3 s drift earn the v13 badges', b.badges.includes('air') && b.badges.includes('drift'), JSON.stringify(b.badges));
    check('the parade stays shut until level 120 is cleared', !E.levelOpen(121));
    for (let n = 1; n <= 120; n++) if (!E.progress.levels[n]) E.progress.levels[n] = { best: 1, rating: 1 };
    const par = E.recordRun(121, { time: 70, stars: 3, starsTotal: 10, rating: 1, tier: 'C', hits: 0, airTime: 0, clean: false });
    const par2 = E.recordRun(121, { time: 70, stars: 3, starsTotal: 10, rating: 1, tier: 'C', hits: 0, airTime: 0, clean: false });
    check('the parade opens after 120, pays its 100-star jackpot once and the champ badge', E.levelOpen(121) && par.payout === 106 && par2.payout === 16 && E.progress.badges.includes('champ'));
  }
  /* a full localStorage sheds the longest replays and still saves the stars */
  {
    let cap = 1e9;
    const mem = new Map();
    globalThis.localStorage = { getItem: k => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => { if (String(v).length > cap) throw new Error('QuotaExceededError'); mem.set(k, String(v)); }, removeItem: k => mem.delete(k) };
    const VROOM = { scenes: {} };
    new Function('VROOM', simSource() + `\n(function (VROOM) { 'use strict';\n${fs.readFileSync(path.join(ROOT, 'src/save.js'), 'utf8')}\n})(VROOM);`)(VROOM);
    const Q = VROOM.save;
    Q.recordRun(1, { time: 40, stars: 2, starsTotal: 5, rating: 1, tier: 'C', hits: 0, airTime: 0, clean: true }, { t: 40, ticks: 2, rle: 'a'.repeat(4000) + ',', b: 'k' });
    cap = 3000;
    Q.recordRun(2, { time: 40, stars: 2, starsTotal: 5, rating: 1, tier: 'C', hits: 0, airTime: 0, clean: true }, { t: 40, ticks: 2, rle: 'b,'.repeat(100), b: 'k' });
    const j = JSON.parse(mem.get('vroom.v2.p0') || 'null');
    check('a full localStorage drops the longest replay, never the progress', !!j && j.levels[1].t13 === 40 && !j.levels[1].replay && !!j.levels[2].replay && j.current === 3);
    cap = 1e9;
  }
  /* three profiles share one origin quota: another profile's replays are shed so this one's stars land */
  {
    let QUOTA = Infinity;
    const mem = new Map();
    const used = () => [...mem].reduce((a, [k, v]) => a + k.length + v.length, 0);
    globalThis.localStorage = {
      getItem: k => (mem.has(k) ? mem.get(k) : null),
      setItem: (k, v) => { v = String(v); const old = mem.has(k) ? k.length + mem.get(k).length : 0; if (used() - old + k.length + v.length > QUOTA) throw new Error('QuotaExceededError'); mem.set(k, v); },
      removeItem: k => mem.delete(k),
    };
    const reload = globalThis.location;
    globalThis.location = { reload() {} };
    const bootQ = () => {
      const VROOM = { scenes: {} };
      new Function('VROOM', simSource() + `\n(function (VROOM) { 'use strict';\n${fs.readFileSync(path.join(ROOT, 'src/save.js'), 'utf8')}\n})(VROOM);`)(VROOM);
      VROOM.save.load();
      return VROOM.save;
    };
    const res = { time: 40, stars: 2, starsTotal: 5, rating: 1, tier: 'C', hits: 0, airTime: 0, clean: true };
    let Q = bootQ();
    for (let n = 1; n <= 40; n++) Q.recordRun(n, res, { t: 40, ticks: 2, rle: 'z'.repeat(9000) + ',', b: 'k' });
    QUOTA = used() + 3000;   /* profile 0's replays fill the origin to within 3 kB */
    Q.switchProfile(1); Q = bootQ();
    for (let n = 1; n <= 40; n++) Q.recordRun(n, res, null);
    Q.switchProfile(2); Q = bootQ();
    for (let n = 1; n <= 30; n++) Q.recordRun(n, { ...res, time: 41.123456 + n / 7 }, null);
    Q.progress.wallet = 500; Q.save();
    const p0 = JSON.parse(mem.get('vroom.v2.p0') || 'null'), p1 = JSON.parse(mem.get('vroom.v2.p1') || 'null'), p2 = JSON.parse(mem.get('vroom.v2.p2') || 'null');
    check('3 profiles on one shared quota: every profile keeps all its levels, replays are shed instead',
      !!p0 && !!p1 && !!p2 && Object.keys(p0.levels).length === 40 && Object.keys(p1.levels).length === 40 && Object.keys(p2.levels).length === 30
      && p2.current === 31 && p2.wallet === 500 && Object.values(p0.levels).some(l => !l.replay),
      p2 ? Object.keys(p2.levels).length + ' levels, current ' + p2.current : 'no p2');
    globalThis.location = reload;
  }
  /* profiles: three players on their own keys */
  {
    const { S: A, mem: m } = boot();
    A.progress.wallet = 77; A.save();
    A.switchProfile(1);
    const ls = Object.fromEntries(m);
    const { S: B } = boot(ls);
    check('switching profile opens an empty save on vroom.v2.p1', B.meta.active === 1 && B.progress.wallet === 0);
    const ls2 = Object.fromEntries(m); ls2['vroom.meta'] = JSON.stringify({ active: 0, avatars: ['pup', 'kitty', null] });
    const { S: C0 } = boot(ls2);
    check('and switching back finds profile 0 untouched', C0.progress.wallet === 77);
  }
  /* the save QR decodes byte-exact (v12 profile-check), with the URL the hosted game reads */
  {
    let jsQR = null;
    try { jsQR = require('jsqr'); } catch (e) { /* optional */ }
    const { S: Z } = boot({ 'vroom.v2.p0': JSON.stringify(fx.cases[1].saved) });
    const M = Z.qrMatrix(), q = 4, size = (M.length + 8) * q, img = new Uint8ClampedArray(size * size * 4).fill(255);
    for (let r = 0; r < M.length; r++) for (let c = 0; c < M.length; c++) if (M[r][c]) for (let y = 0; y < q; y++) for (let x = 0; x < q; x++) { const i = (((r + 4) * q + y) * size + (c + 4) * q + x) * 4; img[i] = img[i + 1] = img[i + 2] = 0; }
    const got = jsQR ? jsQR(img, size, size) : null;
    check('the save QR scans (jsQR) to the hosted URL carrying this save code', !!got && got.data === Z.SAVE_URL_PREFIX + Z.packCompact(), got ? got.data.slice(0, 60) : 'no decode');
  }
  done();
})().catch(e => { console.error(e); process.exit(1); });
