/*
 * dsp.js — the physical voice model.
 *
 *  ┌────────┐  glottal pulses  ┌──────────────────────── vocal tract ─────────────────────┐
 *  │ lungs  │ ───────────────▶ │ 44 cylindrical sections, Kelly–Lochbaum scattering       │ ─▶ lips
 *  │ folds  │  + breath noise  │ turbulence injected at the tightest constriction         │
 *  └────────┘                  │            └─ nasal branch at the soft palate ─────────── │ ─▶ nostrils
 *                              └──────────────────────────────────────────────────────────┘
 *
 * The processor code is written as a normal function so it is readable, then
 * stringified into a Blob URL. That lets the app run straight from file://
 * without a dev server.
 */
(function (root) {
  'use strict';

  function voiceProcessorModule() {
    const TAU = Math.PI * 2;

    // ---------------------------------------------------------------- noise
    class Rng {
      constructor(seed) { this.s = seed >>> 0 || 1; }
      next() { // xorshift32 → [-1, 1)
        let x = this.s;
        x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
        this.s = x >>> 0;
        return (this.s / 2147483648) - 1;
      }
    }

    // Simple RBJ band-pass biquad
    class BandPass {
      constructor(sr, f, q) { this.sr = sr; this.x1 = this.x2 = this.y1 = this.y2 = 0; this.set(f, q); }
      set(f, q) {
        const w = TAU * Math.min(f, this.sr * 0.45) / this.sr;
        const alpha = Math.sin(w) / (2 * q);
        const a0 = 1 + alpha;
        this.b0 = alpha / a0; this.b2 = -alpha / a0;
        this.a1 = (-2 * Math.cos(w)) / a0; this.a2 = (1 - alpha) / a0;
      }
      run(x) {
        const y = this.b0 * x + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
        this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = y;
        return y;
      }
    }

    // ------------------------------------------------------------- glottis
    // Liljencrants–Fant style glottal flow-derivative waveform, shaped by
    // "tension": slack folds → soft, breathy pulses; tense folds → sharp,
    // bright pulses with a short closing phase.
    class Glottis {
      constructor(sr, seed) {
        this.sr = sr;
        this.phase = 0;
        this.freq = 220;
        this.rng = new Rng(seed);
        this.wob = 0; this.wobT = 0;
        this.vibPhase = Math.random();
        this.setShape(0.6);
        this.shape = 0.6;
      }
      setShape(tension) {
        const Rd = Math.max(0.5, Math.min(2.7, 3 * (1 - tension)));
        const Ra = -0.01 + 0.048 * Rd;
        const Rk = 0.224 + 0.118 * Rd;
        const Rg = (Rk / 4) * (0.5 + 1.2 * Rk) / (0.11 * Rd - Ra * (0.5 + 1.2 * Rk));
        const Ta = Ra, Tp = 1 / (2 * Rg), Te = Tp + Tp * Rk;
        const eps = 1 / Ta;
        const shift = Math.exp(-eps * (1 - Te));
        const delta = 1 - shift;
        let rhs = (1 / eps) * (shift - 1) + (1 - Te) * shift;
        rhs = rhs / delta;
        const lower = -(Te - Tp) / 2 + rhs;
        const upper = -lower;
        const omega = Math.PI / Tp;
        const s = Math.sin(omega * Te);
        const y = (-Math.PI * s * upper) / (Tp * 2);
        const z = Math.log(y);
        const alpha = z / (Tp / 2 - Te);
        const E0 = -1 / (s * Math.exp(alpha * Te));
        Object.assign(this, { Te, eps, shift, delta, omega, alpha, E0 });
      }
      wave(t) {
        if (t > this.Te) return (-Math.exp(-this.eps * (t - this.Te)) + this.shift) / this.delta;
        return this.E0 * Math.exp(this.alpha * t) * Math.sin(this.omega * t);
      }
      /** advance one sample; returns [pulse, openness 0..1] */
      step(targetFreq, tension, vibDepth, vibRate) {
        // slow random wobble — the "life" in a held note
        this.wobT -= 1;
        if (this.wobT <= 0) { this.wobT = this.sr * 0.08; this.wobTarget = this.rng.next(); }
        this.wob += ((this.wobTarget || 0) - this.wob) * 0.0004;
        this.vibPhase += vibRate / this.sr;
        if (this.vibPhase > 1) this.vibPhase -= 1;
        const semis = vibDepth * Math.sin(TAU * this.vibPhase) + this.wob * 0.06;
        this.freq = targetFreq * Math.pow(2, semis / 12);

        this.phase += this.freq / this.sr;
        if (this.phase >= 1) {
          this.phase -= 1;
          this.shape += (tension - this.shape) * 0.5;
          this.setShape(this.shape);
        }
        const out = this.wave(this.phase);
        const open = this.phase < this.Te ? Math.sin(Math.PI * this.phase / this.Te) : 0;
        return [out, open];
      }
    }

    // --------------------------------------------------------------- tract
    // Pressure-wave formulation: at every junction the scattered waves are
    // p_out = p_J − p_in, with p_J = 2·Σ(A·p_in) / ΣA.
    class Tract {
      constructor(n, noseAt, noseN) {
        this.n = n; this.noseAt = noseAt; this.noseN = noseN;
        this.R = new Float64Array(n); this.L = new Float64Array(n);
        this.nR = new Float64Array(noseN); this.nL = new Float64Array(noseN);
        this.jR = new Float64Array(n + 1); this.jL = new Float64Array(n + 1);
        this.njR = new Float64Array(noseN + 1); this.njL = new Float64Array(noseN + 1);
        this.A = new Float64Array(n).fill(3);
        this.noseA = new Float64Array(noseN);
        // nasal passage: narrow port → wide cavities → narrow nostrils
        for (let i = 0; i < noseN; i++) {
          const t = i / (noseN - 1);
          let a = t < 0.15 ? 2.2 + 8 * t : t < 0.75 ? 3.5 + 1.4 * Math.sin(Math.PI * (t - 0.15) / 0.6) : 3.5 - 7 * (t - 0.75);
          this.noseA[i] = Math.max(0.9, a);
        }
        this.portA = 0;
        this.glottalRefl = 0.75;
        this.lipRefl = -0.85;
        this.noseRefl = -0.85;
        this.loss = 0.9992;
        this.noseLoss = 0.996;
        this.lipOut = 0; this.noseOut = 0;
      }
      step(src, noiseAt, noise) {
        const { n, R, L, A, jR, jL } = this;
        const J = this.noseAt;
        jR[0] = L[0] * this.glottalRefl + src;
        jL[n] = R[n - 1] * this.lipRefl;
        for (let i = 1; i < n; i++) {
          if (i === J) continue;
          const a1 = A[i - 1], a2 = A[i];
          const pj = (2 * (a1 * R[i - 1] + a2 * L[i])) / (a1 + a2);
          jL[i] = pj - R[i - 1];
          jR[i] = pj - L[i];
        }
        // three-way junction into the nose
        const nR = this.nR, nL = this.nL, nA = this.noseA;
        {
          const a1 = A[J - 1], a2 = A[J], a3 = this.portA;
          const pj = (2 * (a1 * R[J - 1] + a2 * L[J] + a3 * nL[0])) / (a1 + a2 + a3);
          jL[J] = pj - R[J - 1];
          jR[J] = pj - L[J];
          this.njR[0] = pj - nL[0];
        }
        const m = this.noseN, njR = this.njR, njL = this.njL;
        njL[m] = nR[m - 1] * this.noseRefl;
        for (let i = 1; i < m; i++) {
          const a1 = nA[i - 1], a2 = nA[i];
          const pj = (2 * (a1 * nR[i - 1] + a2 * nL[i])) / (a1 + a2);
          njL[i] = pj - nR[i - 1];
          njR[i] = pj - nL[i];
        }
        const loss = this.loss;
        for (let i = 0; i < n; i++) {
          R[i] = jR[i] * loss;
          L[i] = jL[i + 1] * loss;
        }
        if (noiseAt > 0 && noiseAt < n) { R[noiseAt] += noise * 0.5; L[noiseAt - 1] += noise * 0.5; }
        const nl = this.noseLoss;
        for (let i = 0; i < m; i++) {
          nR[i] = njR[i] * nl;
          nL[i] = njL[i + 1] * nl;
        }
        // radiated sound follows volume flow (area × pressure wave)
        this.lipOut = R[n - 1] * A[n - 1];
        this.noseOut = nR[m - 1] * nA[m - 1];
        // keep everything finite if something goes wild
        if (!(Math.abs(R[0]) < 1e6)) { R.fill(0); L.fill(0); nR.fill(0); nL.fill(0); }
      }
    }

    // --------------------------------------------------------------- voice
    class Voice {
      constructor(sr, n, noseAt, seed) {
        this.sr = sr;
        this.glottis = new Glottis(sr, seed);
        this.tract = new Tract(n, noseAt, 30);
        this.rng = new Rng(seed * 7 + 3);
        this.aspFilter = new BandPass(sr, 1400, 0.5);
        this.fricFilter = new BandPass(sr, 3500, 0.9);
        this.gain = 0; this.targetGain = 0;
        this.semis = 0; this.pan = 0;
        this.prevOut = 0; this.dc = 0;
      }
    }

    class VocalProcessor extends AudioWorkletProcessor {
      constructor(options) {
        super();
        const o = (options && options.processorOptions) || {};
        this.n = o.n || 44;
        this.noseAt = o.noseAt || 17;
        this.sr = sampleRate;
        this.voices = [0, 1, 2, 3].map((i) => new Voice(this.sr, this.n, this.noseAt, 1234 + i * 977));
        this.voices[0].targetGain = 1;
        this.targetA = new Float64Array(this.n).fill(3);
        this.curA = new Float64Array(this.n).fill(3);
        this.targetPort = 0; this.curPort = 0;
        this.p = {
          freq: 220, tension: 0.6, breath: 0, voicing: 1, breathiness: 0.12,
          vibDepth: 0.25, vibRate: 5.5, glide: 0.06, volume: 0.8,
        };
        this.freq = 220;
        this.breath = 0;
        this.voicing = 1;
        this.harmony = [{ semis: 0, pan: 0, gain: 1 }];
        this.counter = 0;
        // turbulence bookkeeping
        this.constrIdx = -1; this.constrAmt = 0;
        this.closed = false; this.burst = 0; this.burstIdx = -1;
        this.meter = 0; this.meterCount = 0; this.openness = 0;
        this.port.onmessage = (e) => this.onMessage(e.data);
      }

      onMessage(d) {
        if (d.type === 'areas') {
          for (let i = 0; i < this.n; i++) this.targetA[i] = d.areas[i];
          this.targetPort = d.port;
        } else if (d.type === 'params') {
          Object.assign(this.p, d.params);
        } else if (d.type === 'harmony') {
          this.harmony = d.voices;
          this.voices.forEach((v, i) => {
            const h = d.voices[i];
            if (h) { v.semis = h.semis; v.pan = h.pan; v.targetGain = h.gain; }
            else v.targetGain = 0;
          });
        } else if (d.type === 'reset') {
          this.voices.forEach((v) => { v.tract.R.fill(0); v.tract.L.fill(0); v.tract.nR.fill(0); v.tract.nL.fill(0); });
        }
      }

      /** Smooth the tract shape toward its target and locate constrictions. */
      updateShape() {
        const k = 0.35;
        const n = this.n, A = this.curA, T = this.targetA;
        for (let i = 0; i < n; i++) A[i] += (T[i] - A[i]) * k;
        this.curPort += (this.targetPort - this.curPort) * k;
        const minA = 0.0005;
        for (const v of this.voices) {
          const tA = v.tract.A;
          for (let i = 0; i < n; i++) tA[i] = Math.max(minA, A[i]);
          v.tract.portA = this.curPort;
          v.tract.noseA[0] = Math.max(minA, this.curPort);
        }
        // tightest point in the mouth / upper pharynx (fricatives & stops)
        let best = 1e9, idx = -1;
        const start = Math.floor(n * 0.3);
        for (let i = start; i < n; i++) if (A[i] < best) { best = A[i]; idx = i; }
        const wasClosed = this.closed;
        this.closed = best < 0.02;
        let amt = 0;
        if (best >= 0.02 && best < 0.13) amt = 1;
        else if (best >= 0.13 && best < 0.42) amt = (0.42 - best) / 0.29;
        this.constrIdx = Math.min(n - 1, idx + 1);
        this.constrAmt = amt * amt;
        if (wasClosed && !this.closed) { this.burst = 1; this.burstIdx = this.constrIdx; }
        // brighter hiss the further forward the constriction is
        const pos = idx / n;
        const fc = 900 + Math.pow(Math.max(0, pos - 0.3) / 0.7, 2.2) * 5200;
        for (const v of this.voices) v.fricFilter.set(fc, 0.8);
      }

      process(inputs, outputs) {
        const out = outputs[0];
        const left = out[0], right = out[1] || out[0];
        const p = this.p, sr = this.sr;
        const glideK = 1 - Math.exp(-1 / (Math.max(0.002, p.glide) * sr));
        const tenseK = 1 - Math.exp(-1 / (0.03 * sr));
        let sumSq = 0;
        for (let s = 0; s < left.length; s++) {
          if ((this.counter++ & 15) === 0) this.updateShape();
          // breath: quick attack, softer release
          const bk = p.breath > this.breath ? 1 / (0.025 * sr) : 1 / (0.09 * sr);
          this.breath += (p.breath - this.breath) * Math.min(1, bk * 4);
          this.voicing += (p.voicing - this.voicing) * (1 / (0.012 * sr));
          this.freq *= Math.pow(p.freq / this.freq, glideK);
          this.burst *= 1 - 1 / (0.012 * sr);

          const breath = this.breath;
          // when the mouth is sealed and the nose closed, airflow stalls
          const flow = this.closed && this.curPort < 0.05 ? 0.25 : 1;
          let L = 0, R = 0;
          for (let vi = 0; vi < this.voices.length; vi++) {
            const v = this.voices[vi];
            v.gain += (v.targetGain - v.gain) * 0.0005;
            if (v.gain < 1e-4 && v.targetGain === 0) continue;
            const f = this.freq * Math.pow(2, v.semis / 12);
            const [pulse, open] = v.glottis.step(f, p.tension, p.vibDepth, p.vibRate);
            if (vi === 0) this.openness = open;
            const voiced = pulse * this.voicing * breath * flow;
            // aspiration: breathy voice, whisper when voicing is off
            const white = v.rng.next();
            const aspAmt = breath * (p.breathiness * (0.35 + 0.65 * open) * this.voicing + (1 - this.voicing) * 0.22);
            const asp = v.aspFilter.run(white) * aspAmt * 0.9;
            // turbulence at the constriction + plosive burst
            const fric = v.fricFilter.run(v.rng.next());
            const fricAmt = breath * (this.constrAmt * 0.55 + this.burst * 1.4 * (this.voicing * 0.4 + 0.6));
            const noiseIdx = this.burst > 0.05 && this.constrAmt < 0.1 ? this.burstIdx : this.constrIdx;
            const src = (voiced * 0.6 + asp) * 0.25;
            const tr = v.tract;
            tr.step(src, noiseIdx, fric * fricAmt * 0.5);
            let o = tr.lipOut + tr.noseOut;
            tr.step(src, noiseIdx, fric * fricAmt * 0.5);
            o += tr.lipOut + tr.noseOut;
            // lip radiation (gentle high-pass) + DC block
            const rad = o - v.prevOut * 0.6;
            v.prevOut = o;
            v.dc += (rad - v.dc) * 0.001;
            const y = (rad - v.dc) * v.gain;
            const pan = v.pan;
            L += y * (1 - Math.max(0, pan));
            R += y * (1 + Math.min(0, pan));
          }
          const vol = p.volume * 1.5;
          const l = Math.tanh(L * vol), r = Math.tanh(R * vol);
          left[s] = l; if (right !== left) right[s] = r;
          sumSq += l * l;
        }
        this.meter += sumSq; this.meterCount += left.length;
        if (this.meterCount > 1024) {
          this.port.postMessage({ type: 'meter', rms: Math.sqrt(this.meter / this.meterCount), open: this.openness, freq: this.freq, constr: this.constrAmt, burst: this.burst });
          this.meter = 0; this.meterCount = 0;
        }
        return true;
      }
    }

    registerProcessor('vocal-instrument', VocalProcessor);
    return VocalProcessor;
  }

  root.voiceProcessorModule = voiceProcessorModule;
  root.VOICE_PROCESSOR_SOURCE = '(' + voiceProcessorModule.toString() + ')();';
})(typeof window !== 'undefined' ? window : globalThis);
