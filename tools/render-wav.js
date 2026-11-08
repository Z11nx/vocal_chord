// Renders a short sung phrase through the real DSP to a WAV file, smoothing the
// articulators like the app does. usage: node tools/render-wav.js out.wav
'use strict';
const fs = require('fs');
require('../js/anatomy.js'); require('../js/presets.js');
let Proc;
globalThis.sampleRate = 44100;
globalThis.AudioWorkletProcessor = class { constructor() { this.port = { postMessage() {} }; } };
globalThis.registerProcessor = (n, c) => { Proc = c; };
require('../js/dsp.js'); globalThis.voiceProcessorModule();
const { Anatomy, Presets } = globalThis;
const p = new Proc({ processorOptions: { n: Anatomy.N_TRACT, noseAt: Anatomy.NOSE_JUNCTION } });
// [time, syllable, midi]
const score = [[0, 'ma', 50], [0.5, 'li', 53], [1.0, 'pa', 55], [1.5, 'su', 57], [2.0, 'ko', 55], [2.5, 'na', 53], [3.0, 'ee', 50], [3.8, null]];
const art = Object.assign(Anatomy.defaultState(), Presets.VOWELS.schwa.shape);
let base = Object.assign({}, art), gestures = [], freq = 220, breath = 0;
const fps = 120, block = Math.round(sampleRate / fps);
const out = [];
const L = new Float32Array(block), R = new Float32Array(block);
for (let t = 0; t < 4.2; t += block / sampleRate) {
  for (const ev of score) if (ev[0] <= t && !ev.done) {
    ev.done = true;
    if (!ev[1]) { breath = 0; continue; }
    breath = 0.8; freq = 440 * Math.pow(2, (ev[2] - 69) / 12);
    const s = Presets.parseSyllable(ev[1]);
    let tt = t;
    for (const c of s.onset) { const C = Presets.CONSONANTS[c]; gestures.push({ shape: C.shape, start: tt, end: tt + C.hold, voice: C.voice, vEnd: tt + C.hold + (C.post || 0) }); tt += C.hold; }
    if (s.vowel) Object.assign(base, Presets.VOWELS[s.vowel].shape, { velum: 0 });
  }
  const target = Object.assign({}, base); let voicing = 1, active = false;
  for (const g of gestures) { if (t >= g.start && t < g.end) { Object.assign(target, g.shape); active = true; } if (t >= g.start && t < g.vEnd && !g.voice) voicing = 0; }
  const k = 1 - Math.exp(-(block / sampleRate) / (active ? 0.018 : 0.055));
  for (const key of Object.keys(target)) art[key] += (target[key] - art[key]) * k;
  const g = Anatomy.build(art);
  p.onMessage({ type: 'areas', areas: g.areas, port: g.nasalPort });
  p.onMessage({ type: 'params', params: { freq, breath, voicing, tension: 0.6, vibDepth: 0.2 } });
  p.process([], [[L, R]]);
  out.push(...L);
}
const n = out.length, buf = Buffer.alloc(44 + n * 2);
buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVEfmt ', 8); buf.writeUInt32LE(16, 16);
buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(sampleRate, 24); buf.writeUInt32LE(sampleRate * 2, 28);
buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
for (let i = 0; i < n; i++) buf.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(out[i] * 32767))), 44 + i * 2);
fs.writeFileSync(process.argv[2] || 'phrase.wav', buf);
console.log('wrote', n / sampleRate, 's');
