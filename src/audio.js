/* audio: every sound synthesized with Web Audio, nothing sampled, all original. Owner: ui.
   One master chain (buses -> master gain -> compressor -> out); quiet mode (save.progress.quiet) scales the master.
   - sfx(name, opts)   every name in contracts.SFX, plus a few private ones ('roar', 'rev', 'surface'); unknown names are silent no-ops.
                       opts = { v: volume 0..1, p: pitch multiplier, pan: -1..1, kind: monster kind (voices differ per kind) }
   - engine            per class voice (brute, hauler, racer, tank, hover, freak): detuned saws and a sub through a
                       driven shaper, a firing-rate pulse, a noise rumble, a boost whine, off-throttle crackle, gravel offroad,
                       and a held tyre howl: engine.update({ ..., drift, slip }) while a power slide lasts.
   - music             a lookahead step sequencer: palm-muted power-chord chugs through a distortion stack, a drum machine
                       with a gated snare, a bass, a lead in each world's scale. 'title' 'garage' 'map' 'w1'..'w12' 'boss' 'results'.
   - ambience(w)       a looped bed per world (foundry rumble, rain, wind, surf, hum, lava, deep water, storm) with one-shots.
   Nothing makes a sound before the first gesture (unlock); calls made earlier are remembered and start then. */

let actx = null, master = null, comp = null, busSfx = null, busMusic = null, busEng = null, busAmb = null, verb = null, noiseBuf = null;
let quiet = false, voices = 0, meter = null, meterBuf = null;
const last = Object.create(null);
const want = { music: '', engine: '', amb: 0 };
const VOL = { sfx: 0.9, music: 0.42, eng: 0.5, amb: 0.32 };
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const mtof = m => 440 * Math.pow(2, (m - 69) / 12);

function build() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return false;
  actx = new AC({ latencyHint: 'interactive' });
  comp = actx.createDynamicsCompressor();
  comp.threshold.value = -16; comp.knee.value = 10; comp.ratio.value = 6; comp.attack.value = 0.004; comp.release.value = 0.2;
  master = actx.createGain(); master.gain.value = quiet ? 0.22 : 1;
  master.connect(comp).connect(actx.destination);
  meter = actx.createAnalyser(); meter.fftSize = 1024; meterBuf = new Float32Array(meter.fftSize); comp.connect(meter);
  const bus = v => { const g = actx.createGain(); g.gain.value = v; g.connect(master); return g; };
  busSfx = bus(VOL.sfx); busMusic = bus(VOL.music); busEng = bus(VOL.eng); busAmb = bus(VOL.amb);
  /* one plate reverb from decaying noise, shared by slams, snares and the lead */
  const len = Math.floor(actx.sampleRate * 1.6), ir = actx.createBuffer(2, len, actx.sampleRate);
  for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2); }
  verb = actx.createConvolver(); verb.buffer = ir;
  const vg = actx.createGain(); vg.gain.value = 0.5; verb.connect(vg).connect(master);
  noiseBuf = actx.createBuffer(1, actx.sampleRate * 2, actx.sampleRate);
  const nd = noiseBuf.getChannelData(0);
  for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
  return true;
}
function unlock() {
  try {
    if (!actx && !build()) return;
    if (actx.state === 'suspended') actx.resume();
    if (want.music && !song) music.play(want.music);
    if (want.engine && !eng) engine.start(want.engine);
    if (want.amb && !amb) ambience(want.amb);
  } catch (e) { /* stay silent */ }
}
addEventListener('pointerdown', unlock, { capture: true });
addEventListener('keydown', unlock, { capture: true });
document.addEventListener('visibilitychange', () => {
  if (!actx) return;
  try { if (document.hidden) actx.suspend(); else actx.resume(); } catch (e) {}
});
function setQuiet(q) {
  quiet = !!q;
  if (master) master.gain.setTargetAtTime(quiet ? 0.22 : 1, actx.currentTime, 0.05);
}
const live = () => actx && actx.state !== 'closed';

/* ---------- building blocks ---------- */
const curves = {};
function shaper(k) {
  if (!curves[k]) {
    const n = 1024, c = new Float32Array(n);
    for (let i = 0; i < n; i++) { const x = i * 2 / n - 1; c[i] = (1 + k) * x / (1 + k * Math.abs(x)); }
    curves[k] = c;
  }
  const s = actx.createWaveShaper(); s.curve = curves[k]; s.oversample = '2x';
  return s;
}
function out(dest, pan) {
  if (!pan || !actx.createStereoPanner) return dest;
  const p = actx.createStereoPanner(); p.pan.value = clamp(pan, -1, 1); p.connect(dest);
  return p;
}
/* an enveloped oscillator: attack a, peak v, decay to silence over d, optional pitch glide to f1 */
function tone(t, { type = 'square', f = 440, f1 = 0, glide = 0, a = 0.004, d = 0.2, v = 0.3, dest = busSfx, detune = 0, send = 0, drive = 0, lp = 0 }) {
  const o = actx.createOscillator(), g = actx.createGain();
  o.type = type; o.frequency.setValueAtTime(f, t); o.detune.value = detune;
  if (f1) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + (glide || d));
  g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(v, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  let head = o;
  if (lp) { const fl = actx.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.value = lp; head.connect(fl); head = fl; }
  if (drive) { const s = shaper(drive); head.connect(s); head = s; }
  head.connect(g); g.connect(dest);
  if (send) { const sg = actx.createGain(); sg.gain.value = send; g.connect(sg); sg.connect(verb); }
  o.start(t); o.stop(t + a + d + 0.05);
  voices++; o.onended = () => { voices--; };
  return o;
}
/* an enveloped noise burst through a filter, optional filter sweep to f1 */
function hiss(t, { type = 'bandpass', f = 1200, f1 = 0, q = 1, a = 0.002, d = 0.2, v = 0.3, dest = busSfx, send = 0, drive = 0, rate = 1 }) {
  const s = actx.createBufferSource(), fl = actx.createBiquadFilter(), g = actx.createGain();
  s.buffer = noiseBuf; s.playbackRate.value = rate;
  fl.type = type; fl.frequency.setValueAtTime(f, t); fl.Q.value = q;
  if (f1) fl.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + a + d);
  g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(v, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  let head = fl;
  s.connect(fl);
  if (drive) { const sh = shaper(drive); fl.connect(sh); head = sh; }
  head.connect(g); g.connect(dest);
  if (send) { const sg = actx.createGain(); sg.gain.value = send; g.connect(sg); sg.connect(verb); }
  s.start(t, Math.random() * 1.5); s.stop(t + a + d + 0.05);
  voices++; s.onended = () => { voices--; };
  return s;
}
/* struck metal: inharmonic partials, the clank of the whole game */
function clank(t, f, v, dest, d = 0.18, send = 0.15) {
  for (const [r, k] of [[1, 1], [2.76, 0.55], [5.4, 0.3], [8.93, 0.15]]) tone(t, { type: 'sine', f: f * r, d: d / Math.sqrt(r), v: v * k, dest, send });
  hiss(t, { type: 'highpass', f: 3000, d: 0.03, v: v * 0.6, dest });
}
/* a power chord (root, fifth, octave, each a detuned pair) into one amp: a palm mute darkens the strings before the drive */
function power(t, root, d, v, dest, { mute = false, drive = 30 } = {}) {
  const sum = actx.createGain(), pre = actx.createBiquadFilter(), sh = shaper(drive), cab = actx.createBiquadFilter(), env = actx.createGain();
  const dur = mute ? 0.11 : d;
  sum.gain.value = 0.35;
  pre.type = 'lowpass'; pre.frequency.value = mute ? 520 : 5000;
  cab.type = 'lowpass'; cab.frequency.value = mute ? 2000 : 3600; cab.Q.value = 1.2;
  env.gain.setValueAtTime(0.0001, t); env.gain.linearRampToValueAtTime(v, t + 0.004); env.gain.setValueAtTime(v, t + dur * 0.5); env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  sum.connect(pre); pre.connect(sh); sh.connect(cab); cab.connect(env); env.connect(dest);
  for (const iv of [0, 7, 12]) for (const dt of [-9, 9]) {
    const o = actx.createOscillator(), g = actx.createGain();
    o.type = 'sawtooth'; o.frequency.value = mtof(root + iv); o.detune.value = dt; g.gain.value = iv === 12 ? 0.5 : 1;
    o.connect(g); g.connect(sum); o.start(t); o.stop(t + dur + 0.05);
  }
  voices++; setTimeout(() => { voices--; }, (dur + 0.2) * 1000);
}
const KIND_PITCH = kind => { let h = 7; for (const ch of String(kind || '')) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return 0.7 + (h % 1000) / 1000 * 0.7; };

/* ---------- sfx ---------- */
const GAP = { scrape: 0.09, skid: 0.14, tick: 0.035, hit: 0.05, wall: 0.08, star: 0.04, press: 0.03, land: 0.1, monsterTell: 0.25, monsterRoar: 0.3, surface: 0.2 };
const SFX = {
  press(t, v, p, o) { clank(t, 520 * p, 0.22 * v, o, 0.12, 0.05); tone(t, { type: 'square', f: 180 * p, f1: 90 * p, d: 0.05, v: 0.12 * v, dest: o }); },
  deny(t, v, p, o) { for (const k of [0, 0.13]) tone(t + k, { type: 'sawtooth', f: 98 * p, d: 0.1, v: 0.22 * v, dest: o, drive: 20, lp: 1200 }); },
  buy(t, v, p, o) { for (let i = 0; i < 4; i++) hiss(t + i * 0.045, { type: 'highpass', f: 2500, d: 0.025, v: 0.3 * v, dest: o }); clank(t + 0.2, 880 * p, 0.3 * v, o, 0.6, 0.3); },
  unlock(t, v, p, o) { power(t, 52, 0.5, 0.14 * v, o); tone(t, { type: 'sawtooth', f: 220 * p, f1: 880 * p, d: 0.35, v: 0.1 * v, dest: o, lp: 3000 }); clank(t + 0.3, 1320 * p, 0.2 * v, o, 0.5, 0.3); },
  star(t, v, p, o) { [1320, 1760, 2640].forEach((f, i) => tone(t + i * 0.045, { type: 'triangle', f: f * p, d: 0.16, v: 0.16 * v, dest: o, send: 0.2 })); },
  nitro(t, v, p, o) { hiss(t, { f: 400, f1: 5000, q: 2, a: 0.05, d: 0.4, v: 0.35 * v, dest: o }); tone(t, { type: 'sine', f: 600 * p, f1: 1800 * p, d: 0.3, v: 0.1 * v, dest: o }); },
  boost(t, v, p, o) { hiss(t, { type: 'lowpass', f: 300, f1: 2400, q: 3, a: 0.03, d: 0.8, v: 0.5 * v, dest: o, drive: 8 }); tone(t, { type: 'sawtooth', f: 90 * p, f1: 260 * p, d: 0.7, v: 0.12 * v, dest: o, drive: 12, lp: 1600 }); },
  pad(t, v, p, o) { tone(t, { type: 'square', f: 300 * p, f1: 1400 * p, d: 0.18, v: 0.12 * v, dest: o, lp: 4000 }); hiss(t, { f: 800, f1: 4000, d: 0.2, v: 0.2 * v, dest: o }); },
  jump(t, v, p, o) { hiss(t, { f: 600, f1: 1800, q: 1.5, a: 0.02, d: 0.3, v: 0.25 * v, dest: o }); },
  land(t, v, p, o) { tone(t, { type: 'sine', f: 90 * p, f1: 40, d: 0.2, v: 0.5 * v, dest: o }); hiss(t, { f: 900, q: 4, d: 0.12, v: 0.15 * v, dest: o }); },
  landHard(t, v, p, o) { tone(t, { type: 'sine', f: 80 * p, f1: 30, d: 0.35, v: 0.8 * v, dest: o }); hiss(t, { type: 'lowpass', f: 3000, f1: 300, d: 0.4, v: 0.6 * v, dest: o, drive: 20, send: 0.2 }); clank(t, 240 * p, 0.25 * v, o, 0.3); },
  trick(t, v, p, o) { hiss(t, { f: 900, f1: 2600, d: 0.25, v: 0.2 * v, dest: o }); clank(t + 0.1, 1100 * p, 0.25 * v, o, 0.5, 0.35); },
  hit(t, v, p, o) { hiss(t, { type: 'lowpass', f: 2600, f1: 400, d: 0.18, v: 0.55 * v, dest: o, drive: 15 }); tone(t, { type: 'square', f: 170 * p, f1: 60, d: 0.12, v: 0.25 * v, dest: o, lp: 900 }); clank(t, 330 * p, 0.12 * v, o, 0.2); },
  crunch(t, v, p, o) { hiss(t, { type: 'lowpass', f: 4000, f1: 200, d: 0.5, v: 0.7 * v, dest: o, drive: 40, send: 0.25 }); tone(t, { type: 'sine', f: 70, f1: 32, d: 0.4, v: 0.6 * v, dest: o }); for (let i = 1; i < 5; i++) clank(t + i * 0.04, (200 + i * 90) * p, 0.08 * v, o, 0.15, 0); },
  scrape(t, v, p, o) { hiss(t, { f: 2600 * p, q: 6, a: 0.01, d: 0.12, v: 0.3 * v, dest: o, drive: 10 }); hiss(t, { f: 5200 * p, q: 10, d: 0.08, v: 0.15 * v, dest: o }); },
  wall(t, v, p, o) { tone(t, { type: 'sine', f: 70 * p, f1: 35, d: 0.3, v: 0.7 * v, dest: o }); clank(t, 150 * p, 0.3 * v, o, 0.4, 0.3); hiss(t, { type: 'lowpass', f: 1800, f1: 300, d: 0.25, v: 0.4 * v, dest: o, drive: 20 }); },
  skid(t, v, p, o) { tone(t, { type: 'sawtooth', f: 860 * p, f1: 640 * p, d: 0.22, v: 0.06 * v, dest: o, lp: 2400 }); hiss(t, { f: 1500, q: 3, d: 0.2, v: 0.2 * v, dest: o }); },
  spin(t, v, p, o) { for (let i = 0; i < 4; i++) hiss(t + i * 0.09, { f: 1200 - i * 200, q: 3, d: 0.08, v: 0.2 * v, dest: o }); tone(t, { type: 'sawtooth', f: 400 * p, f1: 90 * p, d: 0.5, v: 0.08 * v, dest: o, lp: 1500 }); },
  horn(t, v, p, o) { for (const f of [233, 277, 349]) tone(t, { type: 'sawtooth', f: f * p, a: 0.02, d: 0.55, v: 0.07 * v, dest: o, drive: 6, lp: 2200 }); },
  count(t, v, p, o) { tone(t, { type: 'square', f: 440 * p, d: 0.22, v: 0.15 * v, dest: o, lp: 2500, send: 0.15 }); clank(t, 880 * p, 0.12 * v, o, 0.3); tone(t, { type: 'sine', f: 55, f1: 40, d: 0.2, v: 0.4 * v, dest: o }); },
  go(t, v, p, o) { tone(t, { type: 'square', f: 880 * p, d: 0.4, v: 0.16 * v, dest: o, lp: 3500, send: 0.25 }); power(t, 40, 0.7, 0.16 * v, o); tone(t, { type: 'sine', f: 60, f1: 35, d: 0.4, v: 0.7 * v, dest: o }); hiss(t, { type: 'highpass', f: 5000, d: 0.9, v: 0.15 * v, dest: o, send: 0.3 }); },
  checkpoint(t, v, p, o) { tone(t, { type: 'triangle', f: 988 * p, d: 0.12, v: 0.16 * v, dest: o }); tone(t + 0.08, { type: 'triangle', f: 1319 * p, d: 0.25, v: 0.16 * v, dest: o, send: 0.2 }); clank(t, 600 * p, 0.1 * v, o, 0.2); },
  finish(t, v, p, o) { power(t, 40, 1.2, 0.18 * v, o); hiss(t, { type: 'highpass', f: 4000, d: 1.4, v: 0.25 * v, dest: o, send: 0.4 }); tone(t, { type: 'sine', f: 55, f1: 38, d: 0.6, v: 0.7 * v, dest: o }); },
  fanfare(t, v, p, o) { [[40, 0], [47, 0.18], [45, 0.36], [52, 0.54]].forEach(([r, k]) => power(t + k, r, k === 0.54 ? 1 : 0.16, 0.16 * v, o)); hiss(t + 0.54, { type: 'highpass', f: 4000, d: 1.2, v: 0.2 * v, dest: o, send: 0.3 }); },
  medal(t, v, p, o) { tone(t, { type: 'sine', f: 60, f1: 40, d: 0.3, v: 0.6 * v, dest: o }); clank(t, 440 * p, 0.35 * v, o, 1.2, 0.5); },
  tick(t, v, p, o) { tone(t, { type: 'square', f: 1800 * p, d: 0.025, v: 0.06 * v, dest: o }); },
  respawn(t, v, p, o) { for (let i = 0; i < 10; i++) tone(t + i * 0.05, { type: 'square', f: 120 + (i % 2) * 30, d: 0.03, v: 0.1 * v, dest: o, lp: 800 }); clank(t + 0.55, 200 * p, 0.3 * v, o, 0.4, 0.2); },
  splash(t, v, p, o) { hiss(t, { type: 'lowpass', f: 2000, f1: 300, a: 0.01, d: 0.6, v: 0.5 * v, dest: o }); for (let i = 0; i < 5; i++) tone(t + 0.05 + i * 0.06, { type: 'sine', f: (300 + Math.random() * 500) * p, f1: 900 * p, d: 0.05, v: 0.06 * v, dest: o }); },
  explosion(t, v, p, o) { hiss(t, { type: 'lowpass', f: 3000, f1: 80, d: 1.3, v: 0.9 * v, dest: o, drive: 30, send: 0.35 }); tone(t, { type: 'sine', f: 70, f1: 24, d: 1, v: 0.9 * v, dest: o }); },
  monsterTell(t, v, p, o, k) { const kp = KIND_PITCH(k) * p; growl(t, 70 * kp, 110 * kp, 0.6, 0.25 * v, o); },
  monsterRoar(t, v, p, o, k) { const kp = KIND_PITCH(k) * p; growl(t, 120 * kp, 70 * kp, 0.9, 0.4 * v, o); hiss(t, { f: 700 * kp, f1: 300, q: 2, a: 0.05, d: 0.8, v: 0.3 * v, dest: o, drive: 20 }); },
  monsterHit(t, v, p, o, k) { const kp = KIND_PITCH(k) * p; tone(t, { type: 'sawtooth', f: 420 * kp, f1: 140 * kp, d: 0.25, v: 0.15 * v, dest: o, drive: 10, lp: 2000 }); tone(t, { type: 'sine', f: 90, f1: 40, d: 0.2, v: 0.5 * v, dest: o }); },
  bossRoar(t, v, p, o) { growl(t, 70 * p, 40 * p, 1.6, 0.55 * v, o); growl(t + 0.05, 105 * p, 60 * p, 1.4, 0.3 * v, o); hiss(t, { f: 500, f1: 180, q: 1.5, a: 0.1, d: 1.4, v: 0.4 * v, dest: o, drive: 30, send: 0.4 }); },
  bossStomp(t, v, p, o) { tone(t, { type: 'sine', f: 50 * p, f1: 22, d: 0.7, v: 1 * v, dest: o }); hiss(t, { type: 'lowpass', f: 600, f1: 60, d: 0.8, v: 0.6 * v, dest: o, send: 0.3 }); },
  bossDefeat(t, v, p, o) { growl(t, 140 * p, 30 * p, 2.2, 0.5 * v, o); SFX.explosion(t + 0.3, v, p, o); SFX.fanfare(t + 1.2, v, p, o); },
  slam(t, v, p, o) {
    tone(t, { type: 'sine', f: 64 * p, f1: 28, d: 0.6, v: 1 * v, dest: o });
    hiss(t, { type: 'lowpass', f: 5000, f1: 200, d: 0.5, v: 0.7 * v, dest: o, drive: 25, send: 0.5 });
    clank(t, 180 * p, 0.35 * v, o, 0.9, 0.6); clank(t + 0.01, 523 * p, 0.15 * v, o, 0.6, 0.4);
  },
  whoosh(t, v, p, o) { hiss(t, { f: 300 * p, f1: 3000 * p, q: 1.2, a: 0.08, d: 0.25, v: 0.35 * v, dest: o }); },
  /* private: the tyres changing ground (kind = the SURF key): a steel clank, an ice crackle, a mud slap, a gravel spray */
  surface(t, v, p, o, k) {
    if (k === 'water') { SFX.splash(t, v, p, o); return; }
    if (k === 'steel' || k === 'glass') { clank(t, (k === 'glass' ? 1500 : 620) * p, 0.16 * v, o, 0.25, 0.1); hiss(t, { type: 'highpass', f: 4000, d: 0.06, v: 0.12 * v, dest: o }); return; }
    if (k === 'ice') { for (let i = 0; i < 6; i++) hiss(t + i * 0.025, { type: 'highpass', f: 5000 + i * 300, d: 0.02, v: 0.16 * v, dest: o }); return; }
    if (k === 'mud' || k === 'oil' || k === 'sugar') { hiss(t, { type: 'lowpass', f: 900, f1: 200, a: 0.01, d: 0.22, v: 0.4 * v, dest: o, drive: 6 }); tone(t, { type: 'sine', f: 120 * p, f1: 60, d: 0.12, v: 0.25 * v, dest: o }); return; }
    if (k === 'lava') { hiss(t, { f: 1200, f1: 3000, q: 1, d: 0.5, v: 0.3 * v, dest: o }); return; }
    hiss(t, { f: 1800 * p, f1: 900 * p, q: 1, a: 0.01, d: 0.25, v: 0.3 * v, dest: o });
  },
  /* private: the splash roar and the home rev */
  roar(t, v, p, o) { tone(t, { type: 'sawtooth', f: 45 * p, f1: 160 * p, glide: 0.5, a: 0.02, d: 1.3, v: 0.25 * v, dest: o, drive: 30, lp: 1800 }); tone(t, { type: 'sawtooth', f: 45.6 * p, f1: 162 * p, glide: 0.5, a: 0.02, d: 1.3, v: 0.2 * v, dest: o, drive: 30, lp: 1400 }); hiss(t, { type: 'lowpass', f: 300, f1: 1400, d: 1.2, v: 0.25 * v, dest: o }); },
  rev(t, v, p, o) { tone(t, { type: 'sawtooth', f: 50 * p, f1: 140 * p, glide: 0.25, a: 0.01, d: 0.6, v: 0.12 * v, dest: o, drive: 25, lp: 1600 }); },
};
function growl(t, f0, f1, d, v, dest) {
  const o = actx.createOscillator(), o2 = actx.createOscillator(), lfo = actx.createOscillator(), lg = actx.createGain(), bp = actx.createBiquadFilter(), g = actx.createGain(), sh = shaper(25);
  o.type = 'sawtooth'; o2.type = 'square';
  o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + d);
  o2.frequency.setValueAtTime(f0 * 0.502, t); o2.frequency.exponentialRampToValueAtTime(f1 * 0.502, t + d);
  lfo.frequency.value = 23 + Math.random() * 9; lg.gain.value = f0 * 0.25; lfo.connect(lg); lg.connect(o.frequency);
  bp.type = 'bandpass'; bp.Q.value = 2.5; bp.frequency.setValueAtTime(500, t); bp.frequency.linearRampToValueAtTime(1100, t + d * 0.3); bp.frequency.linearRampToValueAtTime(400, t + d);
  g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(v, t + 0.08); g.gain.setValueAtTime(v, t + d * 0.6); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
  o.connect(bp); o2.connect(bp); bp.connect(sh); sh.connect(g); g.connect(dest);
  const sg = actx.createGain(); sg.gain.value = 0.3; g.connect(sg); sg.connect(verb);
  for (const x of [o, o2, lfo]) { x.start(t); x.stop(t + d + 0.05); }
  voices++; o.onended = () => { voices--; };
}
function sfx(name, opts) {
  const fn = SFX[name];
  if (!fn || !live()) return;
  if (!opts || typeof opts !== 'object') opts = {};
  const t = actx.currentTime;
  if (last[name] !== undefined && t - last[name] < (GAP[name] || 0.02)) return;
  if (voices > 160 && name !== 'press') return;
  last[name] = t;
  const v = clamp(Number.isFinite(opts.v) ? opts.v : 1, 0, 1.5), p = clamp(Number.isFinite(opts.p) ? opts.p : 1, 0.25, 4);
  try { fn(t + 0.005, v, p, out(busSfx, Number.isFinite(opts.pan) ? opts.pan : 0), opts.kind); } catch (e) { /* a bad voice never breaks the game */ }
}

/* ---------- engine ---------- */
const VOICE = {
  brute:  { base: 34, range: 150, sub: 0.6, noise: 0.35, pulse: 0.55, cut: 900,  crackle: 1,   whine: 0.6 },
  hauler: { base: 26, range: 95,  sub: 0.8, noise: 0.55, pulse: 0.7,  cut: 700,  crackle: 0.4, whine: 0.9 },
  racer:  { base: 52, range: 290, sub: 0.3, noise: 0.2,  pulse: 0.4,  cut: 1600, crackle: 1.4, whine: 0.5 },
  tank:   { base: 22, range: 70,  sub: 1,   noise: 0.7,  pulse: 0.8,  cut: 600,  crackle: 0.2, whine: 0.4 },
  hover:  { base: 120, range: 600, sub: 0.1, noise: 0.5, pulse: 0.05, cut: 2600, crackle: 0,   whine: 1.2, turbine: true },
  freak:  { base: 40, range: 170, sub: 0.5, noise: 0.4,  pulse: 0.6,  cut: 1100, crackle: 0.8, whine: 0.7, wobble: true },
};
const OFFROAD = new Set([2, 3, 4, 6, 12]);   /* dirt sand mud snow sugar: gravel hiss under the tyres */
let eng = null;
function classOf(bodyId) { const b = VROOM.catalog && VROOM.catalog.BODIES && VROOM.catalog.BODIES[bodyId]; return (b && VOICE[b.cls]) ? b.cls : 'brute'; }
const engine = {
  start(bodyId) {
    want.engine = bodyId || 'monster';
    if (!live()) return;
    if (eng) engine.stop(true);
    const V = VOICE[classOf(want.engine)], t = actx.currentTime;
    const g = actx.createGain(); g.gain.value = 0; g.connect(busEng);
    const lp = actx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = V.cut; lp.Q.value = 2;
    const sh = shaper(V.turbine ? 4 : 18), am = actx.createGain(); am.gain.value = 1 - V.pulse * 0.5;
    sh.connect(lp); lp.connect(am); am.connect(g);
    const o1 = actx.createOscillator(), o2 = actx.createOscillator(), sub = actx.createOscillator();
    o1.type = 'sawtooth'; o2.type = 'sawtooth'; sub.type = V.turbine ? 'sine' : 'square';
    o2.detune.value = V.wobble ? 38 : 14;
    const mix = actx.createGain(); mix.gain.value = 0.35; const sg = actx.createGain(); sg.gain.value = V.sub * 0.5;
    o1.connect(mix); o2.connect(mix); sub.connect(sg); sg.connect(mix); mix.connect(sh);
    /* the firing pulse: a square LFO at the firing rate wobbling the level, the lumpy idle */
    const lfo = actx.createOscillator(), lg = actx.createGain(); lfo.type = 'square'; lg.gain.value = V.pulse * 0.5; lfo.connect(lg); lg.connect(am.gain);
    /* rumble and gravel */
    const ns = actx.createBufferSource(); ns.buffer = noiseBuf; ns.loop = true;
    const nf = actx.createBiquadFilter(); nf.type = 'bandpass'; nf.Q.value = 1.2; nf.frequency.value = 200;
    const ng = actx.createGain(); ng.gain.value = 0; ns.connect(nf); nf.connect(ng); ng.connect(g);
    const gf = actx.createBiquadFilter(); gf.type = 'highpass'; gf.frequency.value = 2500;
    const gg = actx.createGain(); gg.gain.value = 0; ns.connect(gf); gf.connect(gg); gg.connect(busEng);
    /* the boost whine */
    const wh = actx.createOscillator(), wg = actx.createGain(); wh.type = V.turbine ? 'sawtooth' : 'sine'; wg.gain.value = 0;
    const wf = actx.createBiquadFilter(); wf.type = 'bandpass'; wf.Q.value = 6; wf.frequency.value = 2000;
    wh.connect(wf); wf.connect(wg); wg.connect(busEng);
    /* the tyre howl of a power slide: narrow noise plus a wavering squeal, held as long as the drift */
    const sf = actx.createBiquadFilter(); sf.type = 'bandpass'; sf.Q.value = 7; sf.frequency.value = 1700;
    const sq = actx.createOscillator(), sqg = actx.createGain(), sgn = actx.createGain(); sq.type = 'sawtooth'; sq.frequency.value = 820; sqg.gain.value = 0.06;
    sgn.gain.value = 0; ns.connect(sf); sq.connect(sqg); sqg.connect(sf); sf.connect(sgn); sgn.connect(busEng);
    for (const x of [o1, o2, sub, lfo, ns, wh, sq]) x.start(t);
    g.gain.setTargetAtTime(1, t, 0.15);
    eng = { V, g, lp, o1, o2, sub, lfo, ns, nf, ng, gg, wh, wg, wf, sf, sq, sgn, srcs: [o1, o2, sub, lfo, ns, wh, sq], rpm: 0.1, crackT: 0 };
    engine.update({ rpm: 0.1, load: 0, speed: 0 });
  },
  update(s) {
    if (!eng || !s || !live()) return;
    const E = eng, V = E.V, t = actx.currentTime, k = 0.045;
    const rpm = clamp(Number.isFinite(s.rpm) ? s.rpm : 0, 0, 1), load = clamp(Number.isFinite(s.load) ? s.load : 0, 0, 1);
    const f = V.base + rpm * V.range;
    E.o1.frequency.setTargetAtTime(f, t, k); E.o2.frequency.setTargetAtTime(f, t, k); E.sub.frequency.setTargetAtTime(f * 0.5, t, k);
    E.lfo.frequency.setTargetAtTime(V.turbine ? 7 : f * 0.5, t, k);
    E.lp.frequency.setTargetAtTime(V.cut * (0.6 + load * 1.4) + rpm * 1400, t, k);
    E.nf.frequency.setTargetAtTime(150 + rpm * 700, t, k);
    E.ng.gain.setTargetAtTime(V.noise * (0.12 + load * 0.35) * (s.air ? 0.5 : 1), t, k);
    const speed = Math.abs(Number.isFinite(s.speed) ? s.speed : 0);
    E.gg.gain.setTargetAtTime(!s.air && OFFROAD.has(s.surf | 0) ? clamp(speed / 40, 0, 1) * 0.12 : 0, t, 0.08);
    const boost = s.boost ? 1 : 0;
    E.wh.frequency.setTargetAtTime(V.turbine ? f * 4 : 1400 + rpm * 2600, t, k);
    E.wf.frequency.setTargetAtTime(V.turbine ? f * 4 : 1400 + rpm * 2600, t, k);
    E.wg.gain.setTargetAtTime(boost * 0.08 * V.whine + (V.turbine ? 0.03 + rpm * 0.05 : 0), t, 0.08);
    /* the slide: full howl in a drift, a little chirp from raw wheel slip, none in the air; ice and water hush it */
    const slip = clamp(Number.isFinite(s.slip) ? s.slip : 0, 0, 1), sur = s.surf | 0;
    const howl = s.air ? 0 : Math.max(s.drift ? 0.75 + 0.25 * slip : 0, slip > 0.35 ? (slip - 0.35) * 0.6 : 0) * clamp(speed / 12, 0, 1) * (sur === 5 || sur === 8 ? 0.3 : OFFROAD.has(sur) ? 0.55 : 1);
    E.sgn.gain.setTargetAtTime(howl * 0.22, t, howl > 0 ? 0.04 : 0.12);
    E.sf.frequency.setTargetAtTime(1300 + speed * 18 + (Math.random() - 0.5) * 240, t, 0.05);
    E.sq.frequency.setTargetAtTime(700 + speed * 6 + Math.sin(t * 23) * 40, t, 0.05);
    /* off-throttle crackle: revs falling with the foot off pop the exhaust */
    if (V.crackle && E.rpm - rpm > 0.004 && load < 0.1 && rpm > 0.3 && t > E.crackT) {
      E.crackT = t + 0.04 + Math.random() * 0.12;
      hiss(t, { type: 'bandpass', f: 600 + Math.random() * 900, q: 3, d: 0.03, v: 0.25 * V.crackle, dest: busEng, drive: 30 });
    }
    E.rpm = rpm;
  },
  stop(keepWant) {
    if (keepWant !== true) want.engine = '';
    if (!eng) return;
    const E = eng, t = actx.currentTime;
    eng = null;
    E.g.gain.setTargetAtTime(0, t, 0.06); E.wg.gain.setTargetAtTime(0, t, 0.05); E.gg.gain.setTargetAtTime(0, t, 0.05); E.sgn.gain.setTargetAtTime(0, t, 0.05);
    for (const x of E.srcs) { try { x.stop(t + 0.4); } catch (e) {} }
  },
};

/* ---------- music: a lookahead sequencer, sixteen steps a bar ----------
   A song: bpm, root (MIDI), scale, a chord progression in scale degrees (one per bar), a riff (16 chars:
   x palm-muted chug, X open power chord, - hold, . rest, 1..7 a single picked scale note), kick and snare
   patterns, a lead motif and a feel ('half' halftime snare, 'blast' blast beat, 'groove' light). */
const SCALES = { phrygian: [0, 1, 3, 5, 7, 8, 10], aeolian: [0, 2, 3, 5, 7, 8, 10], harm: [0, 2, 3, 5, 7, 8, 11], phrygdom: [0, 1, 4, 5, 7, 8, 10],
  locrian: [0, 1, 3, 5, 6, 8, 10], dorian: [0, 2, 3, 5, 7, 9, 10], mixo: [0, 2, 4, 5, 7, 9, 10], whole: [0, 2, 4, 6, 8, 10, 12], dim: [0, 2, 3, 5, 6, 8, 9, 11] };
const SONGS = {
  title:   { bpm: 152, root: 40, scale: 'phrygian', prog: [0, 0, 5, 6, 0, 0, 1, 4], riff: 'x.xxX-x.xxX-x3x2', kick: 'x.x.x...x.x.x...', lead: [7, 8, 7, 5, 4, 5, 3, 1], feel: 'drive' },
  garage:  { bpm: 116, root: 43, scale: 'dorian', prog: [0, 0, 3, 4], riff: 'X--.x.x.X--.x.xx', kick: 'x.....x.x.......', lead: [5, 4, 3, 2], feel: 'groove' },
  map:     { bpm: 128, root: 38, scale: 'aeolian', prog: [0, 5, 3, 4], riff: 'x.x.xx.xX-.x.x.x', kick: 'x...x.x.x...x...', lead: [1, 3, 5, 4, 3, 1], feel: 'groove' },
  results: { bpm: 140, root: 45, scale: 'mixo', prog: [0, 6, 3, 0], riff: 'X-x.X-x.X-xxX---', kick: 'x.x.x.x.x.x.x.x.', lead: [8, 7, 5, 6, 5, 3, 5], feel: 'drive' },
  boss:    { bpm: 186, root: 34, scale: 'locrian', prog: [0, 1, 0, 4, 0, 1, 6, 4], riff: 'xxxxX-xxxxX-x1x4', kick: 'xxxxxxxxxxxxxxxx', lead: [5, 4, 2, 1, 2, 4, 5, 8], feel: 'blast' },
  w1:  { bpm: 162, root: 40, scale: 'phrygian', prog: [0, 0, 1, 0, 0, 0, 6, 5], riff: 'x.xxx.xxX-x.xxX-', kick: 'x.xxx.x.x.xxx.x.', lead: [5, 6, 5, 3, 2, 1], feel: 'drive' },
  w2:  { bpm: 148, root: 38, scale: 'phrygdom', prog: [0, 1, 0, 6], riff: 'X--.x.x.X--.x1x2', kick: 'x..x..x.x..x..x.', lead: [1, 2, 3, 5, 3, 2, 1, 2], feel: 'half' },
  w3:  { bpm: 140, root: 42, scale: 'dorian', prog: [0, 5, 3, 6], riff: 'x.x.x.x.X-x.x.xx', kick: 'x...x...x...x...', lead: [5, 8, 7, 5, 4, 5, 3, 4], feel: 'drive', arp: true },
  w4:  { bpm: 154, root: 37, scale: 'aeolian', prog: [0, 0, 5, 4, 0, 0, 3, 4], riff: 'xx.xxx.xX-xx.xX-', kick: 'x.x..xx.x.x..xx.', lead: [1, 3, 4, 5, 4, 3], feel: 'drive' },
  w5:  { bpm: 168, root: 35, scale: 'harm', prog: [0, 5, 3, 4], riff: 'x.x.xxx.X-x.xxx.', kick: 'x.x.x.x.x.x.x.x.', lead: [5, 6, 7, 8, 7, 6, 5, 4], feel: 'drive' },
  w6:  { bpm: 144, root: 38, scale: 'phrygdom', prog: [0, 1, 0, 4], riff: 'X-.xx.xxX-.x1x2x', kick: 'x..x.x..x..x.x..', lead: [1, 2, 3, 2, 5, 4, 3, 2], feel: 'half' },
  w7:  { bpm: 156, root: 45, scale: 'dorian', prog: [0, 6, 5, 6], riff: 'x.xx.xx.X-x.xx.x', kick: 'x.x...x.x.x...x.', lead: [3, 4, 5, 7, 5, 4], feel: 'drive' },
  w8:  { bpm: 132, root: 43, scale: 'whole', prog: [0, 2, 0, 4], riff: 'X---x.x.X---x.x.', kick: 'x.......x.x.....', lead: [1, 3, 5, 6, 5, 3], feel: 'half', arp: true },
  w9:  { bpm: 176, root: 36, scale: 'locrian', prog: [0, 1, 0, 4, 0, 1, 2, 4], riff: 'xxx.xxx.X-xxx.X-', kick: 'xxx.xxx.xxx.xxx.', lead: [5, 4, 2, 1, 2], feel: 'drive' },
  w10: { bpm: 150, root: 41, scale: 'dim', prog: [0, 3, 6, 3], riff: 'X-.x.xX-.x.x1234', kick: 'x..x..x.x..x..x.', lead: [1, 3, 5, 8, 7, 5, 3, 2], feel: 'drive' },
  w11: { bpm: 104, root: 37, scale: 'aeolian', prog: [0, 5, 6, 4], riff: 'X-----x.X-----x.', kick: 'x.......x..x....', lead: [5, 4, 3, 1], feel: 'half' },
  w12: { bpm: 172, root: 40, scale: 'harm', prog: [0, 5, 3, 4, 0, 5, 6, 4], riff: 'x.xxX-x.xxX-xxxx', kick: 'x.xxx.xxx.xxx.xx', lead: [5, 6, 7, 8, 9, 8, 7, 5], feel: 'drive' },
};
let song = null, seqTimer = 0;
function stopSong(fadeS) {
  if (!song) return;
  const s = song; song = null;
  s.g.gain.setTargetAtTime(0, actx.currentTime, Math.max(0.01, fadeS / 3));
  setTimeout(() => { try { s.g.disconnect(); } catch (e) {} }, (fadeS + 0.5) * 1000);
  if (seqTimer) { clearInterval(seqTimer); seqTimer = 0; }
}
function deg(S, d) { const sc = SCALES[S.scale]; const o = Math.floor(d / sc.length); return sc[((d % sc.length) + sc.length) % sc.length] + 12 * o; }
function scheduleStep(S, step, t) {
  const dest = song.g, spb = 60 / S.bpm / 4, bar = Math.floor(step / 16) % S.prog.length, i = step % 16, sect = Math.floor(step / 16) % (S.prog.length * 2);
  const root = S.root + deg(S, S.prog[bar]), ch = S.riff[i];
  /* guitar */
  if (ch === 'x') power(t, root, spb, 0.1, dest, { mute: true });
  else if (ch === 'X') { let hold = 1; while (S.riff[i + hold] === '-') hold++; power(t, root, spb * hold * 0.95, 0.11, dest); }
  else if (ch >= '1' && ch <= '9') tone(t, { type: 'sawtooth', f: mtof(root + 12 + deg(S, +ch - 1)), d: spb * 0.9, v: 0.06, dest, drive: 30, lp: 2600 });
  /* bass follows the chugs */
  if (ch === 'x' || ch === 'X') tone(t, { type: 'sawtooth', f: mtof(root - 12), d: ch === 'X' ? spb * 2 : spb * 0.8, v: 0.14, dest, lp: 380 });
  /* drums */
  const blast = S.feel === 'blast', half = S.feel === 'half';
  if (S.kick[i] === 'x') { tone(t, { type: 'sine', f: 150, f1: 42, glide: 0.09, d: 0.16, v: 0.75, dest }); tone(t, { type: 'square', f: 1200, f1: 200, d: 0.012, v: 0.06, dest }); }
  const snareHit = blast ? i % 2 === 1 : half ? i === 8 : i === 4 || i === 12;
  if (snareHit) {
    /* the gated snare: big, reverbed, chopped */
    const g = actx.createGain(); g.gain.setValueAtTime(1, t); g.gain.setValueAtTime(1, t + 0.14); g.gain.linearRampToValueAtTime(0, t + 0.16); g.connect(dest);
    hiss(t, { f: 1900, q: 0.8, d: 0.22, v: blast ? 0.25 : 0.42, dest: g, send: 0.5 });
    tone(t, { type: 'triangle', f: 210, f1: 150, d: 0.08, v: 0.25, dest: g });
  }
  if (S.feel !== 'groove' || i % 2 === 0) hiss(t, { type: 'highpass', f: 7500, d: i % 4 === 2 ? 0.08 : 0.025, v: 0.08, dest });
  if (i === 0 && bar === 0) hiss(t, { type: 'highpass', f: 4000, d: 1.4, v: 0.16, dest, send: 0.3 });
  /* the lead: every second pass through the progression, the world's motif, an octave up with an echo */
  if (sect >= S.prog.length && i % 4 === 0 && S.lead) {
    const note = S.lead[((Math.floor(step / 4)) % S.lead.length)];
    if (note) {
      const f = mtof(S.root + 24 + deg(S, note - 1));
      tone(t, { type: 'square', f, d: spb * 3.6, v: 0.045, dest, drive: 8, lp: 3800, send: 0.35 });
      tone(t + spb * 3, { type: 'square', f, d: spb * 2.5, v: 0.018, dest, lp: 2400 });
    }
  }
  if (S.arp && i % 2 === 1) tone(t, { type: 'square', f: mtof(root + 24 + [0, 7, 12, 15][(i >> 1) % 4]), d: spb * 0.7, v: 0.025, dest, lp: 3000 });
}
function tickSeq() {
  if (!song || !live()) return;
  const ahead = actx.currentTime + 0.14;
  while (song.next < ahead) {
    if (song.next > actx.currentTime - 0.05) scheduleStep(song.S, song.step, song.next);
    song.step++; song.next += 60 / song.S.bpm / 4;
  }
}
const music = {
  play(id) {
    if (!SONGS[id]) return;
    want.music = id;
    if (!live()) return;
    if (song && song.id === id) return;
    stopSong(0.4);
    const g = actx.createGain(); g.gain.value = 0; g.connect(busMusic);
    g.gain.setTargetAtTime(1, actx.currentTime + 0.05, 0.2);
    song = { id, S: SONGS[id], g, step: 0, next: actx.currentTime + 0.1 };
    if (!seqTimer) seqTimer = setInterval(tickSeq, 25);
    tickSeq();
  },
  stop(fadeS = 0.6) { want.music = ''; stopSong(fadeS); },
  current: () => (song ? song.id : ''),
};

/* ---------- ambience: a filtered noise bed per world plus timed one-shots ---------- */
const AMB = {
  1:  { f: 120, type: 'lowpass', q: 0.8, v: 0.6, lfo: 0.2, shot: t => clank(t, 140 + Math.random() * 300, 0.12, busAmb, 0.6, 0.5), every: 2.5 },
  2:  { f: 500, type: 'bandpass', q: 0.6, v: 0.35, lfo: 0.08, shot: t => hiss(t, { f: 2500, q: 3, d: 0.05, v: 0.1, dest: busAmb }), every: 1.4 },
  3:  { f: 90, type: 'lowpass', q: 1, v: 0.5, lfo: 0.05, hum: 60, shot: t => tone(t, { type: 'sine', f: 1200 + Math.random() * 600, f1: 400, d: 0.6, v: 0.03, dest: busAmb, send: 0.4 }), every: 3.5 },
  4:  { f: 4000, type: 'highpass', q: 0.5, v: 0.6, lfo: 0.15, shot: t => thunder(t), every: 9 },
  5:  { f: 700, type: 'bandpass', q: 0.4, v: 0.7, lfo: 0.25 },
  6:  { f: 900, type: 'bandpass', q: 0.5, v: 0.35, lfo: 0.1 },
  7:  { f: 400, type: 'lowpass', q: 0.6, v: 0.7, lfo: 0.12, swell: true },
  8:  { f: 200, type: 'lowpass', q: 4, v: 0.25, lfo: 0.04, hum: 41, shot: t => tone(t, { type: 'sine', f: 2400, f1: 2300, d: 1.2, v: 0.02, dest: busAmb, send: 0.6 }), every: 5 },
  9:  { f: 160, type: 'lowpass', q: 1, v: 0.7, lfo: 0.3, shot: t => hiss(t, { type: 'lowpass', f: 400, f1: 80, d: 0.5, v: 0.25, dest: busAmb }), every: 1.8 },
  10: { f: 300, type: 'lowpass', q: 1, v: 0.3, lfo: 0.1, shot: t => { for (let i = 0; i < 3; i++) tone(t + i * 0.18, { type: 'triangle', f: [523, 494, 466][i], d: 0.3, v: 0.025, dest: busAmb, send: 0.5 }); }, every: 6 },
  11: { f: 140, type: 'lowpass', q: 2, v: 0.6, lfo: 0.06, shot: t => { for (let i = 0; i < 4; i++) tone(t + i * 0.07, { type: 'sine', f: 300 + Math.random() * 500, f1: 900, d: 0.06, v: 0.04, dest: busAmb }); }, every: 2.2 },
  12: { f: 600, type: 'bandpass', q: 0.4, v: 0.6, lfo: 0.2, shot: t => thunder(t), every: 7 },
};
function thunder(t) { hiss(t, { type: 'lowpass', f: 1200, f1: 60, a: 0.02, d: 2.4, v: 0.5, dest: busAmb, send: 0.4 }); tone(t, { type: 'sine', f: 45, f1: 25, d: 2, v: 0.35, dest: busAmb }); }
let amb = null;
function ambience(w) {
  w = w | 0;
  want.amb = w;
  if (!live()) return;
  if (amb && amb.w === w) return;
  if (amb) {
    const a = amb; amb = null; clearInterval(a.timer);
    a.g.gain.setTargetAtTime(0, actx.currentTime, 0.3);
    setTimeout(() => { for (const s of a.srcs) { try { s.stop(); } catch (e) {} } try { a.g.disconnect(); } catch (e) {} }, 1500);
  }
  const A = AMB[w];
  if (!A) return;
  const t = actx.currentTime, g = actx.createGain(); g.gain.value = 0; g.connect(busAmb); g.gain.setTargetAtTime(A.v, t, 0.5);
  const ns = actx.createBufferSource(); ns.buffer = noiseBuf; ns.loop = true; ns.playbackRate.value = 0.5;
  const f = actx.createBiquadFilter(); f.type = A.type; f.frequency.value = A.f; f.Q.value = A.q;
  const lfo = actx.createOscillator(), lg = actx.createGain(); lfo.frequency.value = A.lfo; lg.gain.value = A.f * (A.swell ? 0.9 : 0.4);
  lfo.connect(lg); lg.connect(f.frequency);
  ns.connect(f); f.connect(g);
  const srcs = [ns, lfo];
  if (A.swell) { const sg = actx.createGain(), sl = actx.createOscillator(), sd = actx.createGain(); sg.gain.value = 0.6; sl.frequency.value = 0.12; sd.gain.value = 0.4; sl.connect(sd); sd.connect(sg.gain); f.disconnect(); f.connect(sg); sg.connect(g); sl.start(t); srcs.push(sl); }
  if (A.hum) { const h = actx.createOscillator(), hg = actx.createGain(); h.frequency.value = A.hum; hg.gain.value = 0.06; h.connect(hg); hg.connect(g); h.start(t); srcs.push(h); }
  ns.start(t); lfo.start(t);
  const timer = A.shot ? setInterval(() => { if (live() && amb && amb.w === w && Math.random() < 0.7) { try { A.shot(actx.currentTime + 0.05); } catch (e) {} } }, A.every * 1000) : 0;
  amb = { w, g, srcs, timer };
}

/* a test probe: the suites read the context state, the master level and what is playing */
function level() {
  if (!meter) return 0;
  meter.getFloatTimeDomainData(meterBuf);
  let sum = 0;
  for (const v of meterBuf) sum += v * v;
  return Math.sqrt(sum / meterBuf.length);
}
const probe = () => ({ state: actx ? actx.state : 'none', quiet, master: master ? master.gain.value : null, music: song ? song.id : '', engine: !!eng, amb: amb ? amb.w : 0, voices, level: level() });
VROOM.audio = { unlock, setQuiet, sfx, engine, music, ambience, SONGS: Object.keys(SONGS), probe };
