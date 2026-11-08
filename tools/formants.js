'use strict';
(function(){// Offline check: build the anatomy for each vowel, run the real DSP tract
// with an impulse, and report formant peaks + tightest constriction.
// usage: node tools/formants.js

require('../js/anatomy.js');
let Proc;
globalThis.sampleRate = 48000;
globalThis.AudioWorkletProcessor = class { constructor() { this.port = { postMessage() {} }; } };
globalThis.registerProcessor = (name, cls) => { Proc = cls; };
require('../js/dsp.js');
globalThis.voiceProcessorModule();
const { Anatomy } = globalThis;
const presets = require('../js/presets.js');

function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < len / 2; k++) {
        const wr = Math.cos(ang * k), wi = Math.sin(ang * k);
        const ar = re[i + k + len / 2], ai = im[i + k + len / 2];
        const tr = ar * wr - ai * wi, ti = ar * wi + ai * wr;
        re[i + k + len / 2] = re[i + k] - tr; im[i + k + len / 2] = im[i + k] - ti;
        re[i + k] += tr; im[i + k] += ti;
      }
    }
  }
}

function analyse(state, from = 10) {
  const g = Anatomy.build(state);
  const p = new Proc({ processorOptions: { n: Anatomy.N_TRACT, noseAt: Anatomy.NOSE_JUNCTION } });
  const v = p.voices[0];
  for (let i = 0; i < Anatomy.N_TRACT; i++) v.tract.A[i] = Math.max(0.0005, g.areas[i]);
  v.tract.portA = g.nasalPort;
  v.tract.noseA[0] = Math.max(0.0005, g.nasalPort);
  const N = 8192;
  const re = new Float64Array(N), im = new Float64Array(N);
  for (let s = 0; s < N; s++) {
    const src = s === 0 ? 1 : 0;
    v.tract.step(src, -1, 0);
    let o = v.tract.lipOut + v.tract.noseOut;
    v.tract.step(0, -1, 0);
    o += v.tract.lipOut + v.tract.noseOut;
    re[s] = o;
  }
  fft(re, im);
  const mag = [];
  for (let k = 0; k < N / 2; k++) mag.push(20 * Math.log10(Math.hypot(re[k], im[k]) + 1e-12));
  const hz = (k) => (k * sampleRate) / N;
  const sm = mag.map((_, k) => { let a = 0, c = 0; for (let j = -4; j <= 4; j++) { const q = mag[k + j]; if (q !== undefined) { a += q; c++; } } return a / c; });
  const peaks = [];
  const W = 12;
  for (let k = W; k < N / 2 - W; k++) {
    if (hz(k) > 4500) break;
    let ok = true;
    for (let j = -W; j <= W; j++) if (j && sm[k + j] > sm[k]) { ok = false; break; }
    if (ok && hz(k) > 120) peaks.push(Math.round(hz(k)));
  }
  let minA = 1e9, minI = 0;
  for (let i = from; i < Anatomy.N_TRACT; i++) if (g.areas[i] < minA) { minA = g.areas[i]; minI = i; }
  return { peaks, minA: minA.toFixed(3), minI, areas: Array.from(g.areas).map((a) => a.toFixed(1)).join(' ') };
}

module.exports = { analyse };
if (require.main !== module) return;
console.log('tract length', Anatomy.TRACT_LENGTH.toFixed(2), 'cm; nose junction', Anatomy.NOSE_JUNCTION);
const verbose = process.argv.includes('-v');
for (const [name, pr] of Object.entries(presets.VOWELS)) {
  const st = Object.assign(Anatomy.defaultState(), pr.shape);
  const r = analyse(st);
  console.log(`${name.padEnd(4)} target ${pr.ref.join('/').padEnd(15)} got ${r.peaks.slice(0, 4).join('/').padEnd(22)} min ${r.minA}@${r.minI}`);
  if (verbose) console.log('     ', r.areas);
}
for (const [name, c] of Object.entries(presets.CONSONANTS)) {
  const st = Object.assign(Anatomy.defaultState(), presets.VOWELS.a.shape, c.shape);
  const r = analyse(st, 20);
  console.log(`  /${name}/ min area ${r.minA} at ${r.minI}`);
}

})();