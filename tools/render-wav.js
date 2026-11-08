// Speaks or sings text through the real DSP into a WAV file, smoothing the
// articulators like the app does.
// usage: node tools/render-wav.js out.wav "some text" [speak|sing]
'use strict';
const fs = require('fs');
require('../js/anatomy.js'); require('../js/presets.js'); require('../js/speech.js');
let Proc;
globalThis.sampleRate = 44100;
globalThis.AudioWorkletProcessor = class { constructor() { this.port = { postMessage() {} }; } };
globalThis.registerProcessor = (n, c) => { Proc = c; };
require('../js/dsp.js'); globalThis.voiceProcessorModule();
const { Anatomy, Presets } = globalThis;
const p = new Proc({ processorOptions: { n: Anatomy.N_TRACT, noseAt: Anatomy.NOSE_JUNCTION } });
const text = process.argv[3] || 'Hello! I am a singing head. How are you today?';
const mode = process.argv[4] || 'speak';
const plan = globalThis.Speech.plan(text, { mode, midi: mode === 'speak' ? 49 : 48 });
const art = Object.assign(Anatomy.defaultState(), Presets.VOWELS.schwa.shape);
const fps = 120, block = Math.round(sampleRate / fps);
const out = [];
const L = new Float32Array(block), R = new Float32Array(block);
const keys = ['tongueX', 'tongueY', 'tipUp', 'jaw', 'lipOpen', 'lipRound', 'velum'];
let idx = 0;
for (let t = 0; t < plan.duration + 0.3; t += block / sampleRate) {
  const segs = plan.segments;
  while (idx < segs.length - 1 && t >= segs[idx].start + segs[idx].dur) idx++;
  const seg = t < plan.duration ? segs[idx] : { kind: 'pause' };
  const prog = seg.dur ? Math.min(1, (t - seg.start) / seg.dur) : 0;
  const target = Object.assign({}, art, seg.shape || {});
  if (seg.shape2) { const e = Math.min(1, Math.max(0, (prog - 0.3) / 0.6)); for (const k of keys) if (seg.shape2[k] != null) target[k] = seg.shape[k] + (seg.shape2[k] - seg.shape[k]) * e; }
  const k = 1 - Math.exp(-(block / sampleRate) / (seg.kind === 'vowel' ? 0.03 : 0.016));
  for (const key of keys) art[key] += (target[key] - art[key]) * k;
  const voicing = seg.voice === 0 || (seg.voiceDelay && t - seg.start < seg.voiceDelay) ? 0 : 1;
  const midi = seg.midi != null ? seg.midi + ((seg.midi2 ?? seg.midi) - seg.midi) * prog : 48;
  const g = Anatomy.build(art);
  p.onMessage({ type: 'areas', areas: g.areas, port: g.nasalPort });
  p.onMessage({ type: 'params', params: { freq: 440 * Math.pow(2, (midi - 69) / 12), breath: seg.kind === 'pause' ? 0 : 0.8, voicing, tension: 0.6, vibDepth: mode === 'speak' ? 0 : 0.2, glide: 0.035, breathiness: seg.boost ? 1 : 0.12 } });
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
