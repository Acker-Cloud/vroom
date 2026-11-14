/* dmath: bit-exact maths for the sim region. Owner: integrator (from PuttX). DOM-free.
   The ** operator is out too (it is Math.pow).
   The sim may use + - * /, Math.sqrt, Math.abs, Math.min, Math.max, Math.floor, Math.ceil, Math.round,
   Math.trunc, Math.sign, Math.imul and these. Never Math.sin/cos/tan/atan2/exp/pow/hypot/log/random:
   engines approximate them differently, and the Swift port must match the JS bits. */

/* sin, cos and exp to the bit, the same in every engine: fdlibm (the library V8 and Node use) in
   plain arithmetic. Engines are free to approximate Math.sin, Math.cos and Math.exp differently, and
   Chromium and Safari do, so a line the solver proves in Node could roll elsewhere in a browser.
   These give Node's exact bits everywhere (beyond 800 000 radians they fall back to Math). */
const { dsin, dcos, dexp } = (() => {
  const F = new Float64Array(1), I = new Int32Array(F.buffer);   // little-endian: I[1] high word, I[0] low word
  const hi = x => { F[0] = x; return I[1]; };
  const withHi = (x, h) => { F[0] = x; I[1] = h; return F[0]; };
  const fromWords = (h, l) => { I[1] = h; I[0] = l; return F[0]; };
  const S1 = -1.66666666666666324348e-01, S2 = 8.33333333332248946124e-03, S3 = -1.98412698298579493134e-04, S4 = 2.75573137070700676789e-06, S5 = -2.50507602534068634195e-08, S6 = 1.58969099521155010221e-10;
  function ksin(x, y, iy) {
    const ix = hi(x) & 0x7fffffff;
    if (ix < 0x3e400000 && (x | 0) === 0) return x;
    const z = x * x, v = z * x, r = S2 + z * (S3 + z * (S4 + z * (S5 + z * S6)));
    return iy === 0 ? x + v * (S1 + z * r) : x - ((z * (0.5 * y - v * r) - y) - v * S1);
  }
  const C1 = 4.16666666666666019037e-02, C2 = -1.38888888888741095749e-03, C3 = 2.48015872894767294178e-05, C4 = -2.75573143513906633035e-07, C5 = 2.08757232129817482790e-09, C6 = -1.13596475577881948265e-11;
  function kcos(x, y) {
    const ix = hi(x) & 0x7fffffff;
    if (ix < 0x3e400000 && (x | 0) === 0) return 1;
    const z = x * x, r = z * (C1 + z * (C2 + z * (C3 + z * (C4 + z * (C5 + z * C6)))));
    if (ix < 0x3FD33333) return 1 - (0.5 * z - (z * r - x * y));
    const qx = ix > 0x3fe90000 ? 0.28125 : fromWords(ix - 0x00200000, 0), hz = 0.5 * z - qx, a = 1 - qx;
    return a - (hz - (z * r - x * y));
  }
  const pio2_1 = 1.57079632673412561417e+00, pio2_1t = 6.07710050650619224932e-11, pio2_2 = 6.07710050630396597660e-11, pio2_2t = 2.02226624879595063154e-21, pio2_3 = 2.02226624871116645580e-21, pio2_3t = 8.47842766036889956997e-32, invpio2 = 6.36619772367581382433e-01;
  const NPIO2 = [0x3FF921FB, 0x400921FB, 0x4012D97C, 0x401921FB, 0x401F6A7A, 0x4022D97C, 0x4025FDBB, 0x402921FB, 0x402C463A, 0x402F6A7A, 0x4031475C, 0x4032D97C, 0x40346B9C, 0x4035FDBB, 0x40378FDB, 0x403921FB, 0x403AB41B, 0x403C463A, 0x403DD85A, 0x403F6A7A, 0x40407E4C, 0x4041475C, 0x4042106C, 0x4042D97C, 0x4043A28C, 0x40446B9C, 0x404534AC, 0x4045FDBB, 0x4046C6CB, 0x40478FDB, 0x404858EB, 0x404921FB];
  const Y = [0, 0];
  function remPio2(x) {   /* |x| <= 2^19 pi/2 only (the sim never needs more) */
    const hx = hi(x), ix = hx & 0x7fffffff;
    if (ix <= 0x3fe921fb) { Y[0] = x; Y[1] = 0; return 0; }
    if (ix < 0x4002d97c) {
      let z;
      if (hx > 0) { z = x - pio2_1; if (ix !== 0x3ff921fb) { Y[0] = z - pio2_1t; Y[1] = (z - Y[0]) - pio2_1t; } else { z -= pio2_2; Y[0] = z - pio2_2t; Y[1] = (z - Y[0]) - pio2_2t; } return 1; }
      z = x + pio2_1; if (ix !== 0x3ff921fb) { Y[0] = z + pio2_1t; Y[1] = (z - Y[0]) + pio2_1t; } else { z += pio2_2; Y[0] = z + pio2_2t; Y[1] = (z - Y[0]) + pio2_2t; } return -1;
    }
    let t = Math.abs(x); const n = (t * invpio2 + 0.5) | 0, fn = n;
    let r = t - fn * pio2_1, w = fn * pio2_1t;
    if (n < 32 && ix !== NPIO2[n - 1]) Y[0] = r - w;
    else {
      const j = ix >> 20; Y[0] = r - w; let i = j - ((hi(Y[0]) >> 20) & 0x7ff);
      if (i > 16) { t = r; w = fn * pio2_2; r = t - w; w = fn * pio2_2t - ((t - r) - w); Y[0] = r - w; i = j - ((hi(Y[0]) >> 20) & 0x7ff);
        if (i > 49) { t = r; w = fn * pio2_3; r = t - w; w = fn * pio2_3t - ((t - r) - w); Y[0] = r - w; } }
    }
    Y[1] = (r - Y[0]) - w;
    if (hx < 0) { Y[0] = -Y[0]; Y[1] = -Y[1]; return -n; }
    return n;
  }
  function dsin(x) { const ix = hi(x) & 0x7fffffff; if (ix > 0x413921fb) return Math.sin(x); if (ix <= 0x3fe921fb) return ksin(x, 0, 0); const n = remPio2(x); switch (n & 3) { case 0: return ksin(Y[0], Y[1], 1); case 1: return kcos(Y[0], Y[1]); case 2: return -ksin(Y[0], Y[1], 1); default: return -kcos(Y[0], Y[1]); } }
  function dcos(x) { const ix = hi(x) & 0x7fffffff; if (ix > 0x413921fb) return Math.cos(x); if (ix <= 0x3fe921fb) return kcos(x, 0); const n = remPio2(x); switch (n & 3) { case 0: return kcos(Y[0], Y[1]); case 1: return -ksin(Y[0], Y[1], 1); case 2: return -kcos(Y[0], Y[1]); default: return ksin(Y[0], Y[1], 1); } }
  const ln2HI = [6.93147180369123816490e-01, -6.93147180369123816490e-01], ln2LO = [1.90821492927058770002e-10, -1.90821492927058770002e-10], invln2 = 1.44269504088896338700e+00;
  const P1 = 1.66666666666666019037e-01, P2 = -2.77777777770155933842e-03, P3 = 6.61375632143793436117e-05, P4 = -1.65339022054652515390e-06, P5 = 4.13813679705723846039e-08, twom1000 = 9.33263618503218878990e-302;
  function dexp(x) {
    let hx = hi(x); const xsb = (hx >>> 31) & 1; hx &= 0x7fffffff;
    let k = 0, hiv = 0, lo = 0;
    if (hx >= 0x40862E42) { if (x !== x) return x; if (x > 7.09782712893383973096e+02) return Infinity; if (x < -7.45133219101941108420e+02) return 0; }
    if (hx > 0x3fd62e42) {
      if (hx < 0x3FF0A2B2) { hiv = x - ln2HI[xsb]; lo = ln2LO[xsb]; k = 1 - xsb - xsb; }
      else { k = (invln2 * x + (xsb ? -0.5 : 0.5)) | 0; const t = k; hiv = x - t * ln2HI[0]; lo = t * ln2LO[0]; }
      x = hiv - lo;
    } else if (hx < 0x3e300000) { return 1 + x; }
    const t = x * x, c = x - t * (P1 + t * (P2 + t * (P3 + t * (P4 + t * P5))));
    if (k === 0) return 1 - ((x * c) / (c - 2.0) - x);
    const y = 1 - ((lo - (x * c) / (2.0 - c)) - hiv);
    if (k >= -1021) return withHi(y, hi(y) + (k << 20));
    return withHi(y, hi(y) + ((k + 1000) << 20)) * twom1000;
  }
  return { dsin, dcos, dexp };
})();
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
/* a 2D length from sqrt, which IEEE pins down exactly in every engine (Math.hypot is not) */
const hyp = (a, b) => Math.sqrt(a * a + b * b);
/* atan2 from dsin/dcos-free arithmetic: a polynomial atan (max error ~2e-6 rad), the same bits in every engine */
function datan2(y, x) {
  if (x === 0 && y === 0) return 0;
  const ax = Math.abs(x), ay = Math.abs(y), inv = ay > ax, z = inv ? ax / ay : ay / ax, z2 = z * z;
  let a = z * (0.99997726 + z2 * (-0.33262347 + z2 * (0.19354346 + z2 * (-0.11643287 + z2 * (0.05265332 + z2 * -0.01172120)))));
  if (inv) a = Math.PI / 2 - a;
  if (x < 0) a = Math.PI - a;
  return y < 0 ? -a : a;
}
/* the seeded stream: state is one uint32 kept in SimState.rng, so a race is (seed, inputs) and nothing else */
function rngNext(st) {   /* st = { rng: uint32 } -> [0, 1) and advances st.rng */
  let t = (st.rng = (st.rng + 0x6d2b79f5) >>> 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
/* a stateless hash of integers to [0, 1): level generation, scenery scatter */
function hash01(a, b = 0, c = 0) {
  let x = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263) + Math.imul(c | 0, -2047124777)) >>> 0;
  x = Math.imul(x ^ (x >>> 13), 1274126177) >>> 0;
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}
VROOM.dmath = Object.freeze({ dsin, dcos, dexp, datan2, clamp, hyp, rngNext, hash01 });
