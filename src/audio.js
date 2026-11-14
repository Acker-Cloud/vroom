/* audio: every sound synthesized with Web Audio. Owner: ui.
   SCAFFOLD STUB: one master compressor and a click for 'press'; every other name is a silent no-op.
   The ui builder makes the metal soundtrack and SFX (docs/OVERHAUL.md "Audio"). Unknown sfx names
   must stay silent no-ops, never throws, and quiet mode (save.progress.quiet) scales every voice. */

let actx = null, bus = null, quiet = false;
function unlock() {
  try {
    if (!actx) {
      actx = new (window.AudioContext || window.webkitAudioContext)();
      bus = actx.createDynamicsCompressor();
      bus.threshold.value = -14; bus.ratio.value = 8;
      bus.connect(actx.destination);
    }
    if (actx.state === 'suspended') actx.resume();
  } catch (e) { /* stay silent */ }
}
addEventListener('pointerdown', unlock, { capture: true });
addEventListener('keydown', unlock, { capture: true });
function setQuiet(q) { quiet = !!q; }
function blip(f0, f1, dur, vol) {
  if (!actx) return;
  const t = actx.currentTime, o = actx.createOscillator(), g = actx.createGain();
  o.type = 'square'; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur);
  g.gain.setValueAtTime(vol * (quiet ? 0.22 : 1), t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g).connect(bus); o.start(t); o.stop(t + dur + 0.02);
}
function sfx(name, opts) {
  if (name === 'press') blip(320, 140, 0.06, 0.15);
}
const engine = { start(bodyId) {}, update(p) {}, stop() {} };
const music = { play(id) {}, stop(fadeS) {} };
function ambience(w) {}

VROOM.audio = { unlock, setQuiet, sfx, engine, music, ambience };
