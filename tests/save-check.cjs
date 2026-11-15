/* save-check: v12 saves and save codes still load in v13. Owner: integrator. Node only.
   tests/fixtures/v12-saves.json was captured from the shipped v12.9 game (legacy/v12/index.html):
   its localStorage saves, its VROOM1 compact codes and VROOM2 full codes, and its catalog lists. */
'use strict';
const fs = require('fs'), path = require('path');
const { check, done } = require('./lib.cjs');
const { simSource, ROOT } = require('../scripts/build.cjs');
const fx = require('./fixtures/v12-saves.json');

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
