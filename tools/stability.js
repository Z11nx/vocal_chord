// Runs the full AudioWorklet processor offline through vowels, consonant
// closures and harmony changes; checks that the output stays finite and sane.
// usage: node tools/stability.js
'use strict';
require('../js/anatomy.js');
require('../js/presets.js');
let Proc;
globalThis.sampleRate = 48000;
globalThis.AudioWorkletProcessor = class { constructor() { this.port = { postMessage() {} }; } };
globalThis.registerProcessor = (n, c) => { Proc = c; };
require('../js/dsp.js');
globalThis.voiceProcessorModule();
const { Anatomy, Presets } = globalThis;

const p = new Proc({ processorOptions: { n: Anatomy.N_TRACT, noseAt: Anatomy.NOSE_JUNCTION } });
const block = 128;
const outL = new Float32Array(block), outR = new Float32Array(block);
function run(seconds, shape, params) {
  const st = Object.assign(Anatomy.defaultState(), shape);
  const g = Anatomy.build(st);
  p.onMessage({ type: 'areas', areas: g.areas, port: g.nasalPort });
  p.onMessage({ type: 'params', params });
  let peak = 0, sq = 0, n = 0;
  for (let b = 0; b < (seconds * sampleRate) / block; b++) {
    p.process([], [[outL, outR]]);
    for (let i = 0; i < block; i++) {
      const v = outL[i];
      if (!Number.isFinite(v)) throw new Error('non-finite output');
      peak = Math.max(peak, Math.abs(v)); sq += v * v; n++;
    }
  }
  return { peak: peak.toFixed(3), rms: Math.sqrt(sq / n).toFixed(4) };
}
const base = { freq: 130, breath: 0.8, voicing: 1, tension: 0.6 };
for (const [k, v] of Object.entries(Presets.VOWELS)) console.log('vowel', k.padEnd(6), run(0.4, v.shape, base));
for (const [k, c] of Object.entries(Presets.CONSONANTS)) {
  const r = run(0.15, Object.assign({}, Presets.VOWELS.a.shape, c.shape), Object.assign({}, base, { voicing: c.voice }));
  const rel = run(0.15, Presets.VOWELS.a.shape, base);
  console.log('cons ', k.padEnd(6), 'hold', r, 'release', rel);
}
p.onMessage({ type: 'harmony', voices: Presets.HARMONY.major.voices });
console.log('major triad', run(1, Presets.VOWELS.o.shape, Object.assign({}, base, { freq: 440, tension: 0.9 })));
console.log('whisper    ', run(0.5, Presets.VOWELS.a.shape, Object.assign({}, base, { voicing: 0 })));
console.log('silence    ', run(0.5, Presets.VOWELS.a.shape, Object.assign({}, base, { breath: 0 })));
console.log('OK');
