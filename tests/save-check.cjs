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
  done();
})().catch(e => { console.error(e); process.exit(1); });
