/* fx: particles and impact juice for any THREE.Scene. Owner: worlds.
   SCAFFOLD STUB: emit() is a no-op. The worlds builder adds sparks, dust, smoke, fire, explosions,
   splashes, debris, skid marks and nitro flames (docs/OVERHAUL.md "FX"), pooled, capped by ctx.quality,
   with decorative motion cut under ctx.reducedMotion. */

function create(ctx, scene) {
  return { emit(kind, pos, opts) {}, update(dt) {}, dispose() {} };
}

VROOM.fx = { create };
