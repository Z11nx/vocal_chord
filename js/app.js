/*
 * app.js — wires the anatomy, the voice engine and the UI together.
 */
(function () {
  'use strict';
  const { VOWELS, CONSONANTS, HARMONY, SCALES, VOICE_TYPES, SONGS } = Presets;
  const { clamp, lerp } = Anatomy.util;
  const $ = (id) => document.getElementById(id);
  const NOTE_NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
  const noteName = (m) => NOTE_NAMES[((Math.round(m) % 12) + 12) % 12] + (Math.floor(Math.round(m) / 12) - 1);
  const midiToHz = (m) => 440 * Math.pow(2, (m - 69) / 12);
  const store = {
    get(k, d) { try { const v = localStorage.getItem('vocalchord.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('vocalchord.' + k, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } },
  };

  // ================================================================ audio
  class AudioEngine {
    constructor() { this.ready = false; this.meter = { rms: 0, freq: 0 }; }
    async start() {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      this.ctx = new Ctx({ latencyHint: 'interactive' });
      const opts = { n: Anatomy.N_TRACT, noseAt: Anatomy.NOSE_JUNCTION };
      try {
        if (!this.ctx.audioWorklet || location.protocol === 'file:') throw new Error('worklet unavailable');
        const url = URL.createObjectURL(new Blob([VOICE_PROCESSOR_SOURCE], { type: 'application/javascript' }));
        await this.ctx.audioWorklet.addModule(url);
        this.node = new AudioWorkletNode(this.ctx, 'vocal-instrument', {
          numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2], processorOptions: opts,
        });
        this.port = this.node.port;
        this.mode = 'worklet';
      } catch (err) {
        // file:// pages can't load worklets from blobs: run the same DSP on the main thread
        this.startFallback(opts);
      }
      const c = this.ctx;
      this.dry = c.createGain();
      this.wet = c.createGain();
      this.conv = c.createConvolver();
      this.conv.buffer = this.makeImpulse(2.6);
      this.master = c.createGain();
      this.comp = c.createDynamicsCompressor();
      this.comp.threshold.value = -16; this.comp.ratio.value = 3.5; this.comp.attack.value = 0.005; this.comp.release.value = 0.2;
      this.analyser = c.createAnalyser();
      this.analyser.fftSize = 4096;
      this.analyser.smoothingTimeConstant = 0.6;
      this.node.connect(this.dry).connect(this.master);
      this.node.connect(this.conv).connect(this.wet).connect(this.master);
      this.master.connect(this.comp).connect(c.destination);
      this.comp.connect(this.analyser);
      this.port.onmessage = (e) => { if (e.data.type === 'meter') this.meter = e.data; };
      this.freqData = new Float32Array(this.analyser.frequencyBinCount);
      this.ready = true;
    }
    startFallback(opts) {
      const engine = this;
      let Proc = null;
      const g = window;
      const saved = { A: g.AudioWorkletProcessor, R: g.registerProcessor, S: g.sampleRate };
      const fakePort = { onmessage: null, postMessage(msg) { if (engine.port.onmessage) engine.port.onmessage({ data: msg }); } };
      g.AudioWorkletProcessor = class { constructor() { this.port = fakePort; } };
      g.registerProcessor = (name, cls) => { Proc = cls; };
      g.sampleRate = this.ctx.sampleRate;
      try { voiceProcessorModule(); } finally {
        g.AudioWorkletProcessor = saved.A; g.registerProcessor = saved.R;
        if (saved.S === undefined) delete g.sampleRate; else g.sampleRate = saved.S;
      }
      g.sampleRate = this.ctx.sampleRate; // the processor reads it lazily
      const proc = new Proc({ processorOptions: opts });
      // messages to the processor
      this.port = { onmessage: null, postMessage(d) { proc.port.onmessage && proc.port.onmessage({ data: d }); } };
      const sp = this.ctx.createScriptProcessor(1024, 0, 2);
      sp.onaudioprocess = (e) => {
        const L = e.outputBuffer.getChannelData(0), R = e.outputBuffer.getChannelData(1);
        proc.process([], [[L, R]]);
      };
      this.node = sp;
      this.mode = 'main-thread';
    }
    makeImpulse(seconds) {
      const c = this.ctx, len = Math.floor(c.sampleRate * seconds);
      const buf = c.createBuffer(2, len, c.sampleRate);
      for (let ch = 0; ch < 2; ch++) {
        const d = buf.getChannelData(ch);
        let lp = 0;
        for (let i = 0; i < len; i++) {
          const t = i / c.sampleRate;
          const decay = Math.pow(1 - i / len, 2.2) * Math.exp(-t * 1.6);
          const k = 0.75 - 0.6 * (i / len); // darker as it decays
          lp += ((Math.random() * 2 - 1) - lp) * k;
          d[i] = lp * decay * (t < 0.012 ? t / 0.012 : 1);
        }
      }
      return buf;
    }
    setMix(reverb, volume) {
      if (!this.ready) return;
      const t = this.ctx.currentTime;
      this.wet.gain.setTargetAtTime(reverb * 0.85, t, 0.05);
      this.dry.gain.setTargetAtTime(1 - reverb * 0.3, t, 0.05);
      this.master.gain.setTargetAtTime(volume * 1.1, t, 0.05);
    }
    params(p) { if (this.ready) this.port.postMessage({ type: 'params', params: p }); }
    areas(a, port) { if (this.ready) this.port.postMessage({ type: 'areas', areas: a, port }); }
    harmony(v) { if (this.ready) this.port.postMessage({ type: 'harmony', voices: v }); }
  }
  const audio = new AudioEngine();

  // ================================================================ state
  const art = Anatomy.defaultState();         // what is drawn & heard right now
  const base = Object.assign({}, art);        // where the performer has put things
  Object.assign(base, VOWELS.schwa.shape);
  const ART_KEYS = ['tongueX', 'tongueY', 'tipUp', 'jaw', 'lipOpen', 'lipRound', 'velum'];
  let gestures = [];                          // timed consonant overrides
  const voice = {
    voiceType: store.get('voiceType', 'tenor'),
    octave: 0,
    midi: 57, targetMidi: 57,
    tension: 0.62, breathiness: 0.12, vibrato: 0.3, glide: 0.2, loudness: 0.75,
    whisper: false, drone: false, noteStart: 0,
    harmony: 'solo', scale: store.get('scale', 'major'), key: store.get('key', 0),
  };
  const gate = { keys: [], drag: false, pulseUntil: 0 };
  const view = { labels: window.innerWidth > 700, rays: false, zoom: 'full', hover: null, dragging: null };
  const now = () => performance.now() / 1000;

  function isGateOpen(t) {
    return voice.drone || gate.keys.length > 0 || gate.drag || t < gate.pulseUntil;
  }
  function setPitch(m, retrigger = true) {
    voice.targetMidi = m;
    if (retrigger) voice.noteStart = now();
  }

  // ============================================================ gestures
  function addGesture(sym, t0, holdOverride) {
    const c = CONSONANTS[sym];
    if (!c) return t0;
    const hold = holdOverride || c.hold;
    gestures.push({ sym, shape: c.shape, start: t0, end: t0 + hold, voice: c.voice, voiceEnd: t0 + hold + (c.post || 0), boost: c.kind === 'aspirate' });
    return t0 + hold;
  }
  function setVowel(key) {
    const v = VOWELS[key];
    if (!v) return;
    Object.assign(base, v.shape, { velum: 0, lipOpen: v.shape.lipOpen != null ? v.shape.lipOpen : 1 });
    if (key === 'hum') Object.assign(base, { lipOpen: 0, velum: 1 });
    syncSliders();
    refreshVowelPads(key);
  }
  VOWELS.hum = { ipa: 'm̩', label: 'mm', word: 'hum', ref: [], shape: Object.assign({}, VOWELS.schwa.shape, { lipOpen: 0, velum: 1, jaw: 0.15 }) };

  // ============================================================== speech
  // A planned utterance (see speech.js) is a list of timed segments, each a
  // target shape for the articulators plus voicing and pitch.
  const speech = { plan: null, start: 0, idx: 0, word: -1, onEnd: null };
  function playPlan(plan, opts = {}) {
    speech.plan = plan;
    speech.start = now() + (opts.delay || 0);
    speech.idx = 0;
    speech.word = -1;
    speech.chips = !!opts.chips;
    voice.noteStart = speech.start;
    hideHint();
  }
  function stopSpeech() {
    if (!speech.plan) return;
    // leave the mouth where the last vowel put it
    const segs = speech.plan.segments;
    for (let i = segs.length - 1; i >= 0; i--) {
      if (segs[i].kind === 'vowel') { Object.assign(base, segs[i].shape2 || segs[i].shape); break; }
    }
    base.lipOpen = 1; base.velum = 0; base.tipUp = 0;
    const wasChips = speech.chips;
    speech.plan = null;
    syncSliders();
    if (wasChips) { highlightWord(-1); setSayButtons(false); }
  }
  /** current segment of the utterance, or null */
  function speechSegment(t) {
    const p = speech.plan;
    if (!p) return null;
    const rel = t - speech.start;
    if (rel < 0) return null;
    if (rel >= p.duration) { stopSpeech(); return null; }
    const segs = p.segments;
    while (speech.idx < segs.length - 1 && rel >= segs[speech.idx].start + segs[speech.idx].dur) speech.idx++;
    const seg = segs[speech.idx];
    return { seg, rel, prog: clamp((rel - seg.start) / seg.dur, 0, 1) };
  }

  // =========================================================== animation
  let lastFrame = now();
  let geom = Anatomy.build(art);
  function frame() {
    const t = now();
    const dt = Math.min(0.05, t - lastFrame);
    lastFrame = t;
    gestures = gestures.filter((g) => t < Math.max(g.end, g.voiceEnd) + 0.05);

    // target = performer's base + any active consonant gesture
    const target = Object.assign({}, base);
    let voicing = voice.whisper ? 0 : 1;
    let gestureActive = false, boost = false;
    for (const g of gestures) {
      if (t >= g.start && t < g.end) { Object.assign(target, g.shape); gestureActive = true; if (g.boost) boost = true; }
      if (t >= g.start && t < g.voiceEnd && g.voice === 0) voicing = 0;
    }
    // spoken / sung words
    const sp = speechSegment(t);
    let speaking = false;
    if (sp) {
      const { seg, rel, prog } = sp;
      speaking = seg.kind !== 'pause';
      if (seg.shape) {
        Object.assign(target, seg.shape);
        if (seg.shape2) {
          const e = clamp((prog - 0.3) / 0.6, 0, 1);
          for (const key of ART_KEYS) if (seg.shape2[key] != null) target[key] = lerp(seg.shape[key], seg.shape2[key], e);
        }
      }
      if (seg.voice === 0 || (seg.voiceDelay && rel - seg.start < seg.voiceDelay)) voicing = 0;
      if (seg.boost) boost = true;
      // pitch follows the plan unless a piano key is held ("talk box")
      if (seg.midi != null && !gate.keys.length) voice.targetMidi = lerp(seg.midi, seg.midi2 != null ? seg.midi2 : seg.midi, prog);
      if (speech.chips && seg.word != null && seg.word !== speech.word) { speech.word = seg.word; highlightWord(seg.word); }
      gestureActive = true;
    }
    const tau = sp ? (sp.seg.kind === 'vowel' ? 0.03 : 0.016) : gestureActive ? 0.018 : 0.055;
    const k = 1 - Math.exp(-dt / tau);
    for (const key of ART_KEYS) {
      const fast = view.dragging && dragKeys[view.dragging] && dragKeys[view.dragging].includes(key);
      art[key] += (target[key] - art[key]) * (fast ? Math.min(1, k * 2.5) : k);
    }
    // larynx rises with pitch (visual)
    art.larynx = clamp((voice.targetMidi - 40) / 40, 0, 1);
    geom = Anatomy.build(art);

    const open = isGateOpen(t) || speaking;
    const speakMode = speech.plan && speech.plan.mode === 'speak';
    const vibRamp = clamp((t - voice.noteStart - 0.25) / 0.6, 0, 1);
    if (audio.ready) {
      audio.areas(geom.areas, geom.nasalPort);
      audio.params({
        freq: midiToHz(voice.targetMidi),
        tension: voice.tension,
        breath: open ? voice.loudness : 0,
        voicing,
        breathiness: boost ? 1 : voice.breathiness,
        vibDepth: speakMode ? 0 : voice.vibrato * 0.7 * vibRamp,
        vibRate: 5.0 + voice.vibrato * 1.2,
        glide: speakMode ? 0.035 : speech.plan ? 0.03 : 0.004 + Math.pow(voice.glide, 2) * 0.3,
        volume: 0.85,
      });
    }

    const m = audio.meter || {};
    renderer.draw({
      state: art, geom, time: t,
      breath: open ? voice.loudness : 0,
      voiced: voicing > 0.5,
      voicedLevel: open && voicing ? voice.loudness : 0,
      freq: m.freq || midiToHz(voice.targetMidi),
      rms: audio.ready ? (m.rms || 0) : 0,
      hue: 190 + ((voice.targetMidi % 12) / 12) * 120,
      showLabels: view.labels, showRays: view.rays,
      hover: view.hover, dragging: view.dragging,
    });
    drawFolds(t, open, voicing);
    drawSpectrum();
    updateReadouts(t, open);
    updateSequencer(t);
    requestAnimationFrame(frame);
  }

  // ============================================================== canvas
  const canvas = $('head');
  const renderer = new HeadRenderer(canvas);
  const hudEl = document.querySelector('.hud');
  new ResizeObserver(() => {
    renderer.resize();
    renderer.rightPad = hudEl.offsetWidth + 24;
  }).observe(canvas);

  const dragKeys = {
    tongue: ['tongueX', 'tongueY'], tip: ['tipUp'], jaw: ['jaw'], lips: ['lipOpen', 'lipRound'], velum: ['velum'],
    folds: [], lungs: [],
  };
  const INST_CARD = { tongue: 'tongue', tip: 'tongue', jaw: 'jaw', lips: 'lips', velum: 'velum', folds: 'folds', lungs: 'lungs' };
  let drag = null;
  function frameInfo() { return { state: art, geom, hover: view.hover, dragging: view.dragging }; }
  function localXY(e) { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }

  canvas.addEventListener('pointerdown', (e) => {
    const [x, y] = localXY(e);
    const id = renderer.hitTest(x, y, frameInfo());
    if (!id) return;
    ensureAudio();
    canvas.setPointerCapture(e.pointerId);
    const w = renderer.toWorld(x, y);
    drag = { id, start: w, base: Object.assign({}, base), midi: voice.targetMidi, loud: voice.loudness };
    view.dragging = id;
    gate.drag = true;
    if (id === 'folds' || id === 'lungs') voice.noteStart = now();
    canvas.classList.add('grabbing');
    litCard(id);
    hideHint();
    e.preventDefault();
  });
  canvas.addEventListener('pointermove', (e) => {
    const [x, y] = localXY(e);
    if (!drag) {
      const id = renderer.hitTest(x, y, frameInfo());
      view.hover = id;
      canvas.classList.toggle('grab', !!id);
      litCard(id);
      return;
    }
    const w = renderer.toWorld(x, y);
    const dx = w.x - drag.start.x, dy = w.y - drag.start.y;
    const b = drag.base;
    switch (drag.id) {
      case 'tongue': Object.assign(base, Anatomy.tongueFromPoint(art, w)); break;
      case 'tip': base.tipUp = clamp(b.tipUp - dy / 1.9, 0, 1); break;
      case 'jaw': base.jaw = clamp(b.jaw + dy / 2.4, 0, 1); break;
      case 'lips':
        base.lipOpen = clamp(b.lipOpen + dy / 0.9, 0, 1);
        base.lipRound = clamp(b.lipRound + dx / 1.2, 0, 1);
        break;
      case 'velum': base.velum = clamp(b.velum + dy / 1.5, 0, 1); break;
      case 'folds': {
        let m = drag.midi - dy * 3;
        if (voice.scale !== 'chromatic') m = snapToScale(m);
        setPitch(clamp(m, 28, 88), false);
        break;
      }
      case 'lungs': voice.loudness = clamp(drag.loud - dy / 3, 0, 1); $('loudness').value = voice.loudness; break;
    }
    syncSliders();
  });
  const endDrag = () => {
    if (!drag) return;
    drag = null; view.dragging = null; gate.drag = false;
    canvas.classList.remove('grabbing');
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('pointerleave', () => { if (!drag) { view.hover = null; litCard(null); } });

  function litCard(id) {
    document.querySelectorAll('.card').forEach((c) => c.classList.toggle('lit', !!id && c.dataset.inst === INST_CARD[id]));
  }
  document.querySelectorAll('.card').forEach((c) => {
    const sw = c.querySelector('.swatch');
    if (sw) c.style.setProperty('--c', sw.style.getPropertyValue('--c'));
  });

  // ============================================================= sliders
  const sliderBind = {
    tipUp: (v) => (base.tipUp = v), jaw: (v) => (base.jaw = v), lipOpen: (v) => (base.lipOpen = v),
    lipRound: (v) => (base.lipRound = v), velum: (v) => (base.velum = v),
    tension: (v) => (voice.tension = v), breathiness: (v) => (voice.breathiness = v),
    vibrato: (v) => (voice.vibrato = v), glide: (v) => (voice.glide = v), loudness: (v) => (voice.loudness = v),
  };
  for (const [id, fn] of Object.entries(sliderBind)) {
    $(id).addEventListener('input', (e) => { fn(parseFloat(e.target.value)); ensureAudio(); });
    // touching an articulator slider while silent gives a short sung preview
    if (ART_KEYS.includes(id)) $(id).addEventListener('pointerdown', () => pulse(0.5));
  }
  function syncSliders() {
    for (const k of ['tipUp', 'jaw', 'lipOpen', 'lipRound', 'velum']) {
      const el = $(k);
      if (document.activeElement !== el) el.value = base[k];
    }
    placeVowelDot();
  }

  $('drone').addEventListener('click', () => toggleDrone());
  function toggleDrone(force) {
    voice.drone = force != null ? force : !voice.drone;
    $('drone').setAttribute('aria-pressed', voice.drone);
    if (voice.drone) { ensureAudio(); voice.noteStart = now(); hideHint(); }
  }
  $('whisper').addEventListener('click', () => {
    voice.whisper = !voice.whisper;
    $('whisper').setAttribute('aria-pressed', voice.whisper);
  });

  // ============================================================ vowel pad
  const pad = $('vowelPad');
  const PAD = { top: 14, bottom: 136, leftTop: 22, leftBottom: 92, right: 206 };
  function padFromTongue(tx, ty) {
    const y = lerp(PAD.bottom, PAD.top, ty);
    const left = lerp(PAD.leftBottom, PAD.leftTop, ty);
    return [lerp(PAD.right, left, tx), y];
  }
  function tongueFromPad(x, y) {
    const ty = clamp((PAD.bottom - y) / (PAD.bottom - PAD.top), 0, 1);
    const left = lerp(PAD.leftBottom, PAD.leftTop, ty);
    return { tongueX: clamp((PAD.right - x) / (PAD.right - left), 0, 1), tongueY: ty };
  }
  {
    const g = $('vowelPadLabels');
    for (const [k, v] of Object.entries(VOWELS)) {
      if (k === 'hum') continue;
      const [x, y] = padFromTongue(v.shape.tongueX, v.shape.tongueY);
      const t = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      t.setAttribute('x', x + 9); t.setAttribute('y', y + 4); t.setAttribute('class', 'vlabel');
      t.textContent = v.ipa;
      g.appendChild(t);
    }
  }
  function placeVowelDot() {
    const [x, y] = padFromTongue(base.tongueX, base.tongueY);
    const dot = $('vowelPadDot');
    dot.setAttribute('cx', x); dot.setAttribute('cy', y);
  }
  let padDrag = false;
  function padMove(e) {
    const r = pad.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * 220, y = ((e.clientY - r.top) / r.height) * 150;
    const tt = tongueFromPad(x, y);
    Object.assign(base, tt);
    base.jaw = lerp(0.1, 0.7, 1 - tt.tongueY);
    syncSliders();
  }
  pad.addEventListener('pointerdown', (e) => { padDrag = true; pad.setPointerCapture(e.pointerId); ensureAudio(); gate.drag = true; voice.noteStart = now(); padMove(e); litCard('tongue'); });
  pad.addEventListener('pointermove', (e) => { if (padDrag) padMove(e); });
  const padUp = () => { if (padDrag) { padDrag = false; gate.drag = false; litCard(null); } };
  pad.addEventListener('pointerup', padUp);
  pad.addEventListener('pointercancel', padUp);

  // ================================================================ pads
  const VOWEL_ORDER = ['i', 'e', 'ae', 'a', 'o', 'u', 'schwa', 'hum'];
  for (const [i, k] of VOWEL_ORDER.entries()) {
    const v = VOWELS[k];
    const b = document.createElement('button');
    b.className = 'pad'; b.dataset.vowel = k;
    b.innerHTML = `<b>${v.ipa}</b><small>${v.label}${i < 7 ? ' · ' + (i + 1) : ''}</small>`;
    b.title = `as in “${v.word}”`;
    b.addEventListener('click', () => { ensureAudio(); setVowel(k); pulse(0.7); });
    $('vowelPads').appendChild(b);
  }
  function refreshVowelPads(k) {
    document.querySelectorAll('[data-vowel]').forEach((b) => b.classList.toggle('on', b.dataset.vowel === k));
  }
  for (const [k, c] of Object.entries(CONSONANTS)) {
    if (c.hidden) continue;
    const b = document.createElement('button');
    b.className = `pad cons ${c.kind}`;
    b.innerHTML = `<b>${c.label}</b><small>${c.kind}</small>`;
    b.title = `${c.kind}${c.voice ? ' (voiced)' : ' (voiceless)'}`;
    b.addEventListener('click', () => {
      ensureAudio();
      const end = addGesture(k, now() + 0.02);
      pulse(end - now() + 0.35);
      b.classList.add('hit'); setTimeout(() => b.classList.remove('hit'), 120);
    });
    $('consPads').appendChild(b);
  }
  /** briefly open the breath so a click makes a sound */
  function pulse(seconds) {
    const t = now();
    if (!isGateOpen(t)) voice.noteStart = t;
    gate.pulseUntil = Math.max(gate.pulseUntil, t + seconds);
    hideHint();
  }

  // =============================================================== piano
  const KEYMAP = ['a', 'w', 's', 'e', 'd', 'f', 't', 'g', 'y', 'h', 'u', 'j', 'k', 'o', 'l', 'p', ';', "'"];
  const pianoEl = $('piano');
  let pianoKeys = [];
  function baseMidi() { return VOICE_TYPES[voice.voiceType].base - (VOICE_TYPES[voice.voiceType].base % 12) + voice.octave * 12; }
  function inScale(m) { return SCALES[voice.scale].includes((((m - voice.key) % 12) + 12) % 12); }
  function snapToScale(m) {
    let best = Math.round(m), bd = 1e9;
    for (let c = Math.floor(m) - 2; c <= Math.ceil(m) + 2; c++) if (inScale(c) && Math.abs(c - m) < bd) { bd = Math.abs(c - m); best = c; }
    return best;
  }
  function buildPiano() {
    pianoEl.innerHTML = '';
    pianoKeys = [];
    const start = baseMidi();
    const count = 25;
    const whites = [];
    for (let i = 0; i < count; i++) { const m = start + i; if (![1, 3, 6, 8, 10].includes(m % 12)) whites.push(m); }
    const ww = 100 / whites.length;
    let wi = 0;
    for (let i = 0; i < count; i++) {
      const m = start + i;
      const black = [1, 3, 6, 8, 10].includes(m % 12);
      const el = document.createElement('div');
      el.className = (black ? 'bkey' : 'wkey') + (inScale(m) ? '' : ' out');
      el.dataset.midi = m;
      if (black) { el.style.left = `calc(${wi * ww}% - ${ww * 0.3}%)`; el.style.width = `${ww * 0.6}%`; }
      else { el.style.left = `${wi * ww}%`; el.style.width = `${ww}%`; wi++; }
      const label = m % 12 === 0 ? noteName(m) : '';
      const kb = KEYMAP[i] ? `<span class="kb">${KEYMAP[i].toUpperCase()}</span>` : '';
      el.innerHTML = kb + label;
      pianoEl.appendChild(el);
      pianoKeys.push(el);
    }
    $('octLabel').textContent = 'Oct ' + (Math.floor(start / 12) - 1);
  }
  function noteOn(m, src) {
    ensureAudio();
    gate.keys = gate.keys.filter((k) => k.src !== src);
    gate.keys.push({ m, src });
    setPitch(m);
    highlightKeys();
    hideHint();
  }
  function noteOff(src) {
    gate.keys = gate.keys.filter((k) => k.src !== src);
    if (gate.keys.length) setPitch(gate.keys[gate.keys.length - 1].m, false);
    highlightKeys();
  }
  function highlightKeys() {
    const held = new Set(gate.keys.map((k) => k.m));
    pianoKeys.forEach((el) => el.classList.toggle('down', held.has(+el.dataset.midi)));
  }
  let pianoPointer = null;
  pianoEl.addEventListener('pointerdown', (e) => {
    const el = e.target.closest('[data-midi]');
    if (!el) return;
    pianoEl.setPointerCapture(e.pointerId);
    pianoPointer = e.pointerId;
    noteOn(+el.dataset.midi, 'mouse');
  });
  pianoEl.addEventListener('pointermove', (e) => {
    if (pianoPointer !== e.pointerId) return;
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const key = el && el.closest && el.closest('[data-midi]');
    if (key && +key.dataset.midi !== voice.targetMidi) noteOn(+key.dataset.midi, 'mouse');
  });
  const pianoUp = (e) => { if (pianoPointer === e.pointerId) { pianoPointer = null; noteOff('mouse'); } };
  pianoEl.addEventListener('pointerup', pianoUp);
  pianoEl.addEventListener('pointercancel', pianoUp);

  $('octDown').addEventListener('click', () => { voice.octave = Math.max(-2, voice.octave - 1); buildPiano(); renderSteps(); });
  $('octUp').addEventListener('click', () => { voice.octave = Math.min(2, voice.octave + 1); buildPiano(); renderSteps(); });

  // ============================================================ keyboard
  const typing = (e) => e.target && (e.target.tagName === 'INPUT' && e.target.type === 'text' || e.target.tagName === 'SELECT');
  window.addEventListener('keydown', (e) => {
    if (typing(e) || e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key.toLowerCase();
    const idx = KEYMAP.indexOf(k);
    if (idx >= 0) { if (!e.repeat) noteOn(baseMidi() + idx, 'kb:' + k); e.preventDefault(); return; }
    if (/^[1-8]$/.test(k)) { setVowel(VOWEL_ORDER[+k - 1]); if (!isGateOpen(now())) pulse(0.6); return; }
    if (k === ' ') { toggleDrone(); e.preventDefault(); return; }
    if (k === 'z') $('octDown').click();
    if (k === 'x') $('octUp').click();
    if (k === 'l' && e.shiftKey) $('labelsBtn').click();
  });
  window.addEventListener('keyup', (e) => {
    const k = e.key.toLowerCase();
    if (KEYMAP.includes(k)) noteOff('kb:' + k);
  });
  window.addEventListener('blur', () => { gate.keys = []; highlightKeys(); });

  // ========================================================== top / misc
  for (const [k, v] of Object.entries(VOICE_TYPES)) $('voiceType').add(new Option(v.label, k, false, k === voice.voiceType));
  for (const [k, v] of Object.entries(HARMONY)) $('harmony').add(new Option(v.label, k));
  for (const k of Object.keys(SCALES)) $('scale').add(new Option(k[0].toUpperCase() + k.slice(1), k, false, k === voice.scale));
  NOTE_NAMES.forEach((n, i) => $('keyRoot').add(new Option(n, i, false, i === voice.key)));
  for (const [k, v] of Object.entries(SONGS)) $('song').add(new Option(v.label, k));

  function applyVoiceType() {
    const vt = VOICE_TYPES[voice.voiceType];
    voice.tension = vt.tension; $('tension').value = vt.tension;
    setPitch(vt.base + 5, false);
    buildPiano(); renderSteps();
    store.set('voiceType', voice.voiceType);
  }
  $('voiceType').addEventListener('change', (e) => { voice.voiceType = e.target.value; applyVoiceType(); });
  $('harmony').addEventListener('change', (e) => { voice.harmony = e.target.value; audio.harmony(HARMONY[voice.harmony].voices); });
  $('scale').addEventListener('change', (e) => { voice.scale = e.target.value; store.set('scale', voice.scale); buildPiano(); renderSteps(); });
  $('keyRoot').addEventListener('change', (e) => { voice.key = +e.target.value; store.set('key', voice.key); buildPiano(); renderSteps(); });
  const mix = () => audio.setMix(parseFloat($('reverb').value), parseFloat($('volume').value));
  $('reverb').addEventListener('input', mix);
  $('volume').addEventListener('input', mix);

  $('zoomBtn').addEventListener('click', () => {
    view.zoom = view.zoom === 'full' ? 'tract' : 'full';
    renderer.setZoom(view.zoom);
    $('zoomBtn').textContent = view.zoom === 'full' ? 'Zoom to vocal tract' : 'Show whole head';
  });
  $('labelsBtn').addEventListener('click', () => { view.labels = !view.labels; $('labelsBtn').setAttribute('aria-pressed', view.labels); });
  $('raysBtn').addEventListener('click', () => { view.rays = !view.rays; $('raysBtn').setAttribute('aria-pressed', view.rays); });

  const powerBtn = $('power');
  let starting = null;
  function ensureAudio() {
    if (audio.ready) { if (audio.ctx.state !== 'running') audio.ctx.resume(); return Promise.resolve(); }
    if (!starting) {
      starting = audio.start().then(() => {
        mix();
        audio.harmony(HARMONY[voice.harmony].voices);
        powerBtn.setAttribute('aria-pressed', 'true');
        powerBtn.querySelector('.txt').textContent = 'Sound on';
      }).catch((err) => {
        console.error(err);
        powerBtn.querySelector('.txt').textContent = 'Audio unavailable';
        starting = null;
      });
    }
    return starting;
  }
  powerBtn.addEventListener('click', () => {
    if (audio.ready && audio.ctx.state === 'running') {
      audio.ctx.suspend();
      powerBtn.setAttribute('aria-pressed', 'false');
      powerBtn.querySelector('.txt').textContent = 'Sound off';
      return;
    }
    ensureAudio().then(() => {
      if (audio.ready) {
        audio.ctx.resume();
        powerBtn.setAttribute('aria-pressed', 'true');
        powerBtn.querySelector('.txt').textContent = 'Sound on';
        pulse(0.9);
      }
    });
  });
  let hintGone = false;
  function hideHint() { if (!hintGone) { hintGone = true; setTimeout(() => $('hint').classList.add('gone'), 2500); } }

  // ======================================================= readouts/HUD
  let lastReadout = 0;
  function updateReadouts(t, open) {
    if (t - lastReadout < 0.08) return;
    lastReadout = t;
    const m = voice.targetMidi;
    $('noteName').textContent = noteName(m);
    $('noteHz').textContent = `${midiToHz(m).toFixed(1)} Hz${open ? '' : ' · silent'}`;
    $('vowelGuess').textContent = guessSound();
  }
  function guessSound() {
    if (art.lipOpen < 0.15 && art.velum > 0.4) return 'mm (hum)';
    if (art.lipOpen < 0.1) return 'lips closed';
    if (art.velum > 0.4 && art.tipUp > 0.9) return 'nn (hum)';
    if (art.velum > 0.4 && art.tongueY > 0.95) return 'ng (hum)';
    if (art.tipUp > 0.9) return 'tongue tip closed';
    let best = 'uh', bd = 1e9;
    for (const [k, v] of Object.entries(VOWELS)) {
      if (k === 'hum') continue;
      const s = v.shape;
      const d = (s.tongueX - art.tongueX) ** 2 + (s.tongueY - art.tongueY) ** 2 * 1.3 + (s.lipRound - art.lipRound) ** 2 * 0.6 + (s.jaw - art.jaw) ** 2 * 0.3;
      if (d < bd) { bd = d; best = `${v.ipa}  (“${v.word}”)`; }
    }
    return (art.velum > 0.35 ? 'nasal ' : '') + best;
  }

  const spec = $('spectrum');
  const sctx = spec.getContext('2d');
  function drawSpectrum() {
    const r = spec.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (spec.width !== Math.round(r.width * dpr)) { spec.width = Math.round(r.width * dpr); spec.height = Math.round(r.height * dpr); }
    const W = spec.width, H = spec.height;
    sctx.clearRect(0, 0, W, H);
    sctx.strokeStyle = 'rgba(255,255,255,0.07)';
    sctx.lineWidth = 1;
    const maxHz = 5000;
    for (let f = 1000; f < maxHz; f += 1000) { const x = (f / maxHz) * W; sctx.beginPath(); sctx.moveTo(x, 0); sctx.lineTo(x, H); sctx.stroke(); }
    sctx.fillStyle = 'rgba(200,190,230,0.5)';
    sctx.font = `${9 * dpr}px Inter, sans-serif`;
    for (let f = 1000; f < maxHz; f += 1000) sctx.fillText(`${f / 1000}k`, (f / maxHz) * W + 2 * dpr, H - 3 * dpr);
    if (!audio.ready) return;
    audio.analyser.getFloatFrequencyData(audio.freqData);
    const d = audio.freqData;
    const binHz = audio.ctx.sampleRate / audio.analyser.fftSize;
    const nb = Math.floor(maxHz / binHz);
    const yOf = (db) => H - clamp((db + 110) / 85, 0, 1) * H;
    const grad = sctx.createLinearGradient(0, 0, W, 0);
    grad.addColorStop(0, '#7fd8ff'); grad.addColorStop(0.5, '#b38cff'); grad.addColorStop(1, '#ff8a8a');
    sctx.beginPath();
    sctx.moveTo(0, H);
    for (let i = 1; i < nb; i++) sctx.lineTo((i / nb) * W, yOf(d[i]));
    sctx.lineTo(W, H); sctx.closePath();
    sctx.globalAlpha = 0.35; sctx.fillStyle = grad; sctx.fill();
    sctx.globalAlpha = 1; sctx.strokeStyle = grad; sctx.lineWidth = 1.2 * dpr; sctx.stroke();
    // spectral envelope → formant peaks
    const env = [];
    const win = Math.round(160 / binHz);
    for (let i = 0; i < nb; i++) {
      let mx = -200; for (let j = i - win; j <= i + win; j++) if (j > 0 && j < nb && d[j] > mx) mx = d[j];
      env.push(mx);
    }
    const sm = env.map((_, i) => { let a = 0, c = 0; for (let j = i - win; j <= i + win; j++) if (j >= 0 && j < nb) { a += env[j]; c++; } return a / c; });
    const peaks = [];
    const W2 = Math.round(220 / binHz);
    for (let i = Math.round(180 / binHz); i < nb - W2; i++) {
      let ok = sm[i] > -95;
      for (let j = i - W2; j <= i + W2 && ok; j++) if (j !== i && sm[j] > sm[i]) ok = false;
      if (ok) { peaks.push(i); i += W2; }
    }
    sctx.fillStyle = '#fff';
    peaks.slice(0, 3).forEach((i, n) => {
      const x = (i / nb) * W;
      sctx.strokeStyle = 'rgba(255,255,255,0.5)';
      sctx.setLineDash([3 * dpr, 3 * dpr]);
      sctx.beginPath(); sctx.moveTo(x, yOf(sm[i]) - 4 * dpr); sctx.lineTo(x, H); sctx.stroke();
      sctx.setLineDash([]);
      sctx.fillText(`F${n + 1}`, x + 3 * dpr, Math.max(10 * dpr, yOf(sm[i]) - 4 * dpr));
    });
  }

  // top-down laryngoscope view of the vocal folds
  const fv = $('foldsView');
  const fctx = fv.getContext('2d');
  let foldPhase = 0, foldOpen = 1;
  function drawFolds(t, open, voicing) {
    const W = fv.width, H = fv.height, cx = W / 2, cy = H / 2;
    fctx.clearRect(0, 0, W, H);
    const voiced = open && voicing > 0.5;
    const target = !open ? 1 : voiced ? 0.08 + voice.breathiness * 0.25 : 0.45;
    foldOpen += (target - foldOpen) * 0.15;
    const f = midiToHz(voice.targetMidi);
    foldPhase += (1 / 60) * (5 + f / 60) * Math.PI * 2;
    const vib = voiced ? (0.5 + 0.5 * Math.sin(foldPhase)) * 0.22 * voice.loudness : 0;
    const gapAng = (foldOpen + vib) * 0.42;
    const len = H * (0.62 + voice.tension * 0.12);
    // airway backdrop
    fctx.fillStyle = '#2a1520';
    fctx.beginPath(); fctx.arc(cx, cy, W * 0.48, 0, Math.PI * 2); fctx.fill();
    const top = P2(cx, cy - len / 2);
    // trachea glimpse between folds
    fctx.fillStyle = '#05030a';
    fctx.beginPath();
    fctx.moveTo(top.x, top.y);
    fctx.lineTo(cx - Math.sin(gapAng) * len, top.y + Math.cos(gapAng) * len);
    fctx.lineTo(cx + Math.sin(gapAng) * len, top.y + Math.cos(gapAng) * len);
    fctx.closePath(); fctx.fill();
    // folds
    const thick = 10 - voice.tension * 4;
    for (const s of [-1, 1]) {
      fctx.save();
      fctx.translate(top.x, top.y);
      fctx.rotate(-s * gapAng);
      const g = fctx.createLinearGradient(0, 0, s * thick * 2, 0);
      g.addColorStop(0, '#fffaf3'); g.addColorStop(1, '#e8b6b0');
      fctx.fillStyle = g;
      fctx.beginPath();
      fctx.moveTo(0, 0);
      fctx.quadraticCurveTo(s * thick * 1.6, len * 0.5, s * thick * 0.9, len);
      fctx.lineTo(0, len); fctx.closePath(); fctx.fill();
      fctx.restore();
    }
    // arytenoids & epiglottis
    fctx.fillStyle = '#d98d92';
    for (const s of [-1, 1]) { fctx.beginPath(); fctx.ellipse(cx + s * (Math.sin(gapAng) * len + 8), top.y + len + 4, 9, 7, 0, 0, Math.PI * 2); fctx.fill(); }
    fctx.strokeStyle = '#bcd6e2'; fctx.lineWidth = 5;
    fctx.beginPath(); fctx.arc(cx, top.y + 2, 22, Math.PI * 1.15, Math.PI * 1.85); fctx.stroke();
    if (voiced) {
      fctx.strokeStyle = 'rgba(127,216,255,0.6)'; fctx.lineWidth = 2;
      fctx.beginPath(); fctx.arc(cx, cy, W * 0.47, 0, Math.PI * 2); fctx.stroke();
    }
  }
  const P2 = (x, y) => ({ x, y });

  // ============================================================ sequencer
  let pattern = store.get('pattern', null);
  const seq = { playing: false, step: -1, nextTime: 0, bpm: 100 };
  function loadSong(key) {
    const s = SONGS[key];
    pattern = s.steps.map(([n, syl]) => ({ n, syl }));
    seq.bpm = s.bpm; $('bpm').value = s.bpm; $('bpmVal').textContent = s.bpm;
    renderSteps(); savePattern();
  }
  function savePattern() { store.set('pattern', pattern); }
  function stepNoteOptions() {
    const opts = [['', '—']];
    const b = baseMidi();
    for (let i = -5; i <= 19; i++) if (voice.scale === 'chromatic' || inScale(b + i)) opts.push([String(i), noteName(b + i)]);
    return opts;
  }
  function renderSteps() {
    const wrap = $('steps');
    wrap.innerHTML = '';
    const opts = stepNoteOptions();
    pattern.forEach((st, i) => {
      const d = document.createElement('div');
      d.className = 'step' + (i % 4 === 0 ? ' beat' : '');
      const sel = document.createElement('select');
      for (const [v, l] of opts) sel.add(new Option(l, v));
      if (st.n != null && !opts.some(([v]) => v === String(st.n))) sel.add(new Option(noteName(baseMidi() + st.n), String(st.n)));
      sel.value = st.n == null ? '' : String(st.n);
      sel.addEventListener('change', () => { st.n = sel.value === '' ? null : +sel.value; savePattern(); });
      const inp = document.createElement('input');
      inp.type = 'text'; inp.value = st.syl || ''; inp.maxLength = 6; inp.placeholder = '…';
      inp.addEventListener('input', () => { st.syl = inp.value; savePattern(); });
      const num = document.createElement('div'); num.className = 'num'; num.textContent = i + 1;
      d.append(num, sel, inp);
      wrap.appendChild(d);
    });
  }
  function updateSequencer(t) {
    if (!seq.playing) return;
    const stepDur = 60 / seq.bpm / 2;
    while (t >= seq.nextTime) {
      seq.step = (seq.step + 1) % pattern.length;
      const st = pattern[seq.step];
      const nextSt = pattern[(seq.step + 1) % pattern.length];
      document.querySelectorAll('.step').forEach((el, i) => el.classList.toggle('now', i === seq.step));
      if (st.n == null) { if (speech.plan && !speech.chips) stopSpeech(); }
      else {
        const plan = Speech.plan(st.syl || 'ah', { mode: 'step', midi: baseMidi() + st.n, stepDur: stepDur * (nextSt.n == null ? 0.85 : 1.02) });
        playPlan(plan);
      }
      seq.nextTime += stepDur;
      if (t - seq.nextTime > 1) seq.nextTime = t + stepDur; // fell behind (tab hidden)
    }
  }
  $('seqPlay').addEventListener('click', () => {
    seq.playing = !seq.playing;
    $('seqPlay').setAttribute('aria-pressed', seq.playing);
    $('seqPlay').textContent = seq.playing ? '■ Stop' : '▶ Play';
    if (seq.playing) { ensureAudio(); seq.step = -1; seq.nextTime = now() + 0.05; hideHint(); }
    else { stopSpeech(); document.querySelectorAll('.step').forEach((el) => el.classList.remove('now')); }
  });
  $('song').addEventListener('change', (e) => loadSong(e.target.value));
  $('bpm').addEventListener('input', (e) => { seq.bpm = +e.target.value; $('bpmVal').textContent = seq.bpm; });
  $('seqClear').addEventListener('click', () => { pattern = pattern.map(() => ({ n: null, syl: '' })); renderSteps(); savePattern(); });

  // ========================================================== say / sing
  const sayInput = $('sayText');
  const sayWords = $('sayWords');
  function sayText(mode) {
    const text = sayInput.value.trim();
    if (!text) return;
    ensureAudio();
    if (seq.playing) $('seqPlay').click();
    const vt = VOICE_TYPES[voice.voiceType];
    const rate = parseFloat($('sayRate').value);
    const plan = Speech.plan(text, {
      mode,
      midi: mode === 'speak' ? vt.base - 3 : baseMidi(),
      rate, bpm: seq.bpm * rate, scale: SCALES[voice.scale === 'chromatic' ? 'major' : voice.scale], key: voice.key,
    });
    renderWordChips(plan.words);
    store.set('sayText', text);
    setSayButtons(mode);
    playPlan(plan, { chips: true, delay: 0.05 });
  }
  function renderWordChips(words) {
    sayWords.innerHTML = '';
    words.forEach((w) => {
      const el = document.createElement('span');
      el.className = 'word-chip';
      el.innerHTML = `<b></b><small></small>`;
      el.querySelector('b').textContent = w.word;
      el.querySelector('small').textContent = '/' + w.ipa + '/';
      sayWords.appendChild(el);
    });
  }
  function highlightWord(i) {
    sayWords.querySelectorAll('.word-chip').forEach((el, k) => el.classList.toggle('now', k === i));
  }
  function setSayButtons(mode) {
    $('speakBtn').classList.toggle('active', mode === 'speak');
    $('singBtn').classList.toggle('active', mode === 'sing');
  }
  $('speakBtn').addEventListener('click', () => sayText('speak'));
  $('singBtn').addEventListener('click', () => sayText('sing'));
  $('sayStop').addEventListener('click', () => stopSpeech());
  sayInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); sayText(e.shiftKey ? 'sing' : 'speak'); }
    e.stopPropagation();
  });
  sayInput.addEventListener('keyup', (e) => e.stopPropagation());
  document.querySelectorAll('[data-say]').forEach((b) => b.addEventListener('click', () => {
    sayInput.value = b.dataset.say;
    sayText(b.dataset.mode || 'speak');
  }));
  sayInput.value = store.get('sayText', 'Hello! I am a singing head. How are you today?');
  $('sayRate').addEventListener('input', (e) => { $('sayRateVal').textContent = (+e.target.value).toFixed(2) + '×'; });

  // ================================================================ boot
  setPitch(VOICE_TYPES[voice.voiceType].base + 5, false);
  voice.tension = VOICE_TYPES[voice.voiceType].tension; $('tension').value = voice.tension;
  buildPiano();
  if (!pattern) loadSong('twinkle'); else { renderSteps(); seq.bpm = +$('bpm').value; }
  $('labelsBtn').setAttribute('aria-pressed', view.labels);
  syncSliders();
  refreshVowelPads('schwa');
  requestAnimationFrame(frame);

  // expose for debugging / tests
  window.vocalChord = { art, base, voice, gate, audio, setVowel, renderer, view, speech, sayText };
})();
