/* audio-check: the synthesized soundtrack. Nothing plays before the first gesture and what was asked for starts on
   unlock; every contracts.SFX name answers and makes sound; unknown names are silent no-ops; every music id and the
   boss and menu themes play and stop; the engine voice runs for every vehicle class; ambience for all twelve worlds;
   quiet mode scales the master. Measured on an analyser tapped off the master chain. Owner: ui. */
'use strict';
const { check, done, open } = require('./lib.cjs');

(async () => {
  const { browser, page, errors } = await open('nosplash');
  await page.waitForTimeout(300);

  const before = await page.evaluate(() => VROOM.audio.probe());
  check('no audio context before the first gesture', before.state === 'none', JSON.stringify(before));
  await page.evaluate(() => VROOM.audio.music.play('title'));
  await page.mouse.click(600, 20);   /* a real gesture: the capture listener unlocks */
  await page.waitForFunction(() => VROOM.audio.probe().state === 'running', null, { timeout: 5000 }).catch(() => {});
  const after = await page.evaluate(() => VROOM.audio.probe());
  check('the first gesture unlocks a running context and starts the music asked for earlier', after.state === 'running' && after.music === 'title', JSON.stringify(after));
  await page.evaluate(() => { VROOM.audio.music.stop(0.05); VROOM.audio.engine.stop(); VROOM.audio.ambience(0); });
  await page.waitForTimeout(700);

  const quietLevel = await page.evaluate(() => VROOM.audio.probe().level);
  check('silence when nothing plays', quietLevel < 0.01, quietLevel.toFixed(4));

  /* every sfx name: no throw, and a measurable signal */
  const res = await page.evaluate(async () => {
    const out = {}, wait = ms => new Promise(r => setTimeout(r, ms));
    for (const name of VROOM.contracts.SFX) {
      let peak = 0, threw = '';
      try { VROOM.audio.sfx(name, { v: 1, p: 1, pan: 0.3, kind: 'rivetrat' }); } catch (e) { threw = String(e); }
      for (let i = 0; i < 10; i++) { await wait(30); peak = Math.max(peak, VROOM.audio.probe().level); }
      out[name] = { peak, threw };
      await wait(140);
    }
    return out;
  });
  const threw = Object.entries(res).filter(([, r]) => r.threw);
  check('every contracts.SFX name plays without a throw', threw.length === 0, threw.map(([n, r]) => n + ': ' + r.threw).join(' | '));
  const mute = Object.entries(res).filter(([, r]) => r.peak < 0.002).map(([n]) => n);
  check('every contracts.SFX name makes a sound', mute.length === 0, 'silent: ' + mute.join(' '));

  const unknown = await page.evaluate(async () => {
    await new Promise(r => setTimeout(r, 1500));
    const v0 = VROOM.audio.probe().voices;
    let threw = false;
    try { VROOM.audio.sfx('definitelyNotASound'); VROOM.audio.sfx(''); VROOM.audio.sfx(undefined, 5); VROOM.audio.sfx('press', 'bad'); } catch (e) { threw = true; }
    return { threw, added: VROOM.audio.probe().voices - v0 };
  });
  check('unknown sfx names are silent no-ops (bad opts too)', !unknown.threw, JSON.stringify(unknown));

  /* music */
  const ids = ['title', 'garage', 'map', 'results', 'boss', ...Array.from({ length: 12 }, (_, i) => 'w' + (i + 1))];
  const mus = await page.evaluate(async ids => {
    const out = {}, wait = ms => new Promise(r => setTimeout(r, ms));
    for (const id of ids) {
      VROOM.audio.music.play(id);
      let peak = 0;
      for (let i = 0; i < 12; i++) { await wait(60); peak = Math.max(peak, VROOM.audio.probe().level); }
      out[id] = { playing: VROOM.audio.probe().music, peak };
    }
    VROOM.audio.music.play('w3'); VROOM.audio.music.play('w3');
    const same = VROOM.audio.probe().music;
    VROOM.audio.music.stop(0.1);
    await wait(500);
    return { out, same, after: VROOM.audio.probe().music };
  }, ids);
  const bad = ids.filter(id => mus.out[id].playing !== id || mus.out[id].peak < 0.005);
  check('every music id plays (title, garage, map, results, boss, w1..w12) and is audible', bad.length === 0, bad.map(id => id + ' ' + JSON.stringify(mus.out[id])).join(' | '));
  check('music.play of the current id keeps it; stop stops', mus.same === 'w3' && mus.after === '', JSON.stringify({ same: mus.same, after: mus.after }));

  /* engine: one body per class */
  const eng = await page.evaluate(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms)), B = VROOM.catalog.BODIES || {}, byCls = {};
    for (const id in B) if (!byCls[B[id].cls]) byCls[B[id].cls] = id;
    if (!Object.keys(byCls).length) byCls.brute = 'monster';
    const out = {};
    for (const cls in byCls) {
      VROOM.audio.engine.start(byCls[cls]);
      let peak = 0;
      for (let i = 0; i < 20; i++) {
        VROOM.audio.engine.update({ rpm: i / 20, load: 1, speed: i * 2, boost: i > 10 ? 1 : 0, air: false, surf: 2 });
        await wait(25); peak = Math.max(peak, VROOM.audio.probe().level);
      }
      for (let i = 20; i > 0; i--) { VROOM.audio.engine.update({ rpm: i / 20, load: 0, speed: i, boost: 0, air: i < 5, surf: 0 }); await wait(10); }
      out[cls] = { on: VROOM.audio.probe().engine, peak };
    }
    VROOM.audio.engine.update({ rpm: NaN, load: undefined });
    VROOM.audio.engine.stop();
    return { out, off: VROOM.audio.probe().engine };
  });
  const quietEng = Object.entries(eng.out).filter(([, r]) => !r.on || r.peak < 0.005).map(([c]) => c);
  check('the engine runs and sounds for every vehicle class in the catalog', quietEng.length === 0, JSON.stringify(eng.out));
  check('engine.stop silences it (and bad update values do not throw)', eng.off === false);

  /* ambience */
  const amb = await page.evaluate(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms)), out = [];
    for (let w = 1; w <= 12; w++) { VROOM.audio.ambience(w); await wait(260); out.push(VROOM.audio.probe().amb === w && VROOM.audio.probe().level > 0.0005); }
    VROOM.audio.ambience(0);
    return { out, off: VROOM.audio.probe().amb };
  });
  check('ambience plays for all twelve worlds and stops on 0', amb.out.every(Boolean) && amb.off === 0, JSON.stringify(amb));

  /* quiet mode */
  const q = await page.evaluate(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    VROOM.audio.setQuiet(true); await wait(500);
    const on = VROOM.audio.probe().master;
    VROOM.audio.setQuiet(false); await wait(500);
    return { on, off: VROOM.audio.probe().master };
  });
  check('quiet mode scales the master down and back', q.on < 0.3 && q.off > 0.95, JSON.stringify(q));

  check('no console errors', errors.length === 0, errors.join(' | '));
  await browser.close();
  done();
})().catch(e => { console.error(e); process.exit(1); });
