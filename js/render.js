/*
 * render.js — draws the sliced (mid-sagittal) head on a <canvas>.
 * Everything is drawn in centimetre "world" coordinates; the view transform
 * maps them to pixels.
 */
(function (root) {
  'use strict';
  const { P, lerp, lerpP, clamp, rotate, spline } = Anatomy.util;

  const C = {
    skin: '#ecbfa0', skinShade: '#d9a184', tissue: '#d58f7d', tissueDeep: '#c27a6c',
    bone: '#f1e7d0', boneEdge: '#b9a582', marrow: '#e2cfa8',
    cartilage: '#bcd6e2', cartEdge: '#6f97ad',
    muscle: '#c9505b', muscleLight: '#e57a82', muscleEdge: '#8e2f3a',
    velum: '#d4626d', mucosa: '#e9948f',
    airway: '#160c18', airwayEdge: '#3a1f33',
    brain: '#ecc9cc', brainEdge: '#c79199', gyri: 'rgba(170,100,112,0.45)', cerebellum: '#e3b6bd',
    cord: '#f2dc93', cordEdge: '#c7a956',
    teeth: '#fbf8ef', teethEdge: '#c9bfa7',
    lip: '#c45d66', lipLight: '#da7880',
    disc: '#a8cad8', esophagus: '#df8e8e',
  };

  // ---------- static anatomy (world coords) ----------
  const S = (pts, closed = true, seg = 6) => spline(pts.map(([x, y]) => P(x, y)), closed, seg);

  // The cranium is drawn deeper front-to-back than the airway model needs:
  // points behind the face and above the skull base are pushed backward,
  // fading out toward the throat so the vocal tract itself is untouched.
  const CRANIUM_STRETCH = 0.26;
  function stretch(x, y) {
    if (x >= 0) return P(x, y);
    const t = Math.min(1, Math.max(0, (-1.2 - y) / 5));
    const k = 1 + CRANIUM_STRETCH * t * t * (3 - 2 * t);
    return P(x * k, y);
  }
  const SS = (pts, closed = true, seg = 6) => spline(pts.map(([x, y]) => stretch(x, y)), closed, seg);

  // skin silhouette (upper/back part never moves)
  const FACE_TOP = [
    [7.2, -0.45], [7.95, -0.62], [8.5, -1.0], [8.72, -1.6], [8.42, -2.45], [7.45, -4.0], [6.55, -6.0],
    [5.85, -7.85], [6.12, -9.0], [6.12, -10.6], [5.6, -12.9], [4.2, -15.0], [1.8, -16.6], [-1.5, -17.25],
    [-5.0, -16.45], [-8.0, -14.0], [-9.8, -10.0], [-10.25, -6.0], [-10.0, -3.0], [-9.55, -0.6],
    [-9.25, 2.0], [-9.15, 5.0], [-9.05, 9.0], [-9.0, 14.5],
  ];
  // throat & chin: [x, y, jawWeight]
  const THROAT = [
    [2.2, 14.5, 0], [2.35, 11.0, 0], [2.65, 9.3, 0], [3.05, 8.35, 0], [2.95, 7.6, 0.12], [3.45, 7.0, 0.45],
    [4.6, 6.72, 0.85], [5.75, 6.42, 1], [6.62, 5.82, 1], [7.12, 5.0, 1], [7.15, 4.3, 1], [6.86, 3.78, 1],
  ];

  // cranium arc (forehead → occiput) used for bone & brain
  const SKULL_ARC = SS([
    [6.1, -9.2], [6.1, -10.6], [5.6, -12.9], [4.2, -15.0], [1.8, -16.6], [-1.5, -17.25], [-5.0, -16.45],
    [-8.0, -14.0], [-9.8, -10.0], [-10.25, -6.0], [-9.65, -3.0], [-8.9, -1.2],
  ], false, 8);

  function offsetPath(pts, d, center) {
    return pts.map((p, i) => {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
      let nx = -(b.y - a.y), ny = b.x - a.x;
      const l = Math.hypot(nx, ny) || 1; nx /= l; ny /= l;
      // point the normal toward the centre
      if ((center.x - p.x) * nx + (center.y - p.y) * ny < 0) { nx = -nx; ny = -ny; }
      return P(p.x + nx * d, p.y + ny * d);
    });
  }
  const HEAD_CENTER = stretch(-1.5, -8.5);
  const SKULL_OUT = offsetPath(SKULL_ARC, 0.55, HEAD_CENTER);
  const SKULL_IN = offsetPath(SKULL_ARC, 1.2, HEAD_CENTER);
  const BRAIN_OUT = offsetPath(SKULL_ARC, 1.4, HEAD_CENTER).slice(2, -6);

  const CRANIAL_BASE = SS([
    [5.15, -8.9], [3.6, -7.55], [1.6, -7.0], [0.2, -6.55], [-0.6, -5.5], [-1.35, -5.75], [-2.2, -4.4],
    [-3.3, -2.0], [-2.55, -1.75], [-1.5, -3.2], [-0.2, -4.2], [0.9, -4.75], [2.4, -5.9], [4.0, -6.5],
    [5.3, -7.5], [5.95, -8.2],
  ]);
  const OCCIPUT = SS([
    [-8.9, -1.2], [-7.6, -1.25], [-6.1, -1.5], [-6.0, -2.1], [-7.5, -2.05], [-9.4, -2.5],
  ]);
  const CEREBRUM_BOTTOM = [
    stretch(-8.6, -4.7), stretch(-7.0, -5.5), stretch(-5.0, -6.5), stretch(-2.6, -7.3), stretch(-0.6, -7.0), stretch(1.6, -7.4), stretch(3.6, -7.95), stretch(4.85, -9.1),
  ];
  const CEREBELLUM = SS([
    [-8.55, -4.35], [-6.8, -5.15], [-5.0, -6.05], [-3.75, -5.0], [-3.9, -3.6], [-4.6, -2.65], [-6.2, -2.45], [-7.8, -2.9],
  ]);
  const BRAINSTEM = SS([
    [-2.0, -7.25], [-1.35, -6.4], [-1.55, -5.4], [-2.25, -4.3], [-3.05, -2.4], [-3.75, -1.2], [-4.95, -1.0],
    [-4.65, -2.6], [-3.8, -3.9], [-3.35, -5.4], [-3.2, -6.6],
  ]);
  const CORPUS = SS([[3.0, -9.55], [1.0, -10.9], [-1.8, -11.0], [-3.9, -9.85], [-4.15, -9.25], [-3.3, -9.5], [-1.5, -10.3], [0.9, -10.25], [2.6, -9.25]]);

  const NASAL_AIR = S([
    [-0.9, -1.45], [-0.2, -1.95], [0.55, -4.3], [2.0, -5.65], [3.6, -6.05], [4.95, -5.75], [5.65, -4.6],
    [6.6, -3.35], [7.55, -2.3], [7.95, -1.5], [7.7, -0.72], [7.05, -0.52], [6.0, -0.28], [4.0, -0.2],
    [2.0, -0.13], [0.3, -0.04], [-0.3, 0.2], [-1.2, 0.7], [-1.95, 0.6], [-1.6, -0.5],
  ], true, 6);
  const TURBINATES = [
    S([[0.6, -0.95], [2.0, -1.4], [3.8, -1.35], [4.7, -0.95], [3.6, -0.7], [2.0, -0.62], [0.9, -0.6]]),
    S([[1.2, -2.6], [2.4, -3.15], [3.9, -3.0], [4.4, -2.55], [3.4, -2.25], [2.0, -2.2]]),
    S([[1.3, -4.1], [2.1, -4.5], [3.0, -4.35], [2.4, -3.95], [1.6, -3.85]]),
  ];
  const SPHENOID_SINUS = SS([[-1.2, -4.9], [-0.2, -5.25], [0.6, -4.8], [0.55, -3.9], [-0.4, -3.5], [-1.25, -3.9]]);
  const FRONTAL_SINUS = S([[4.35, -9.7], [5.0, -10.6], [5.45, -10.4], [5.5, -9.4], [5.1, -8.9]]);
  const NASAL_BONE = S([[5.3, -8.0], [5.95, -7.6], [6.45, -6.0], [6.1, -5.85], [5.5, -7.2]]);

  const HARD_PALATE_BONE = S([
    [-0.08, 0.12], [1.0, -0.05], [2.2, -0.12], [3.4, -0.14], [4.6, -0.2], [5.6, -0.3], [6.25, -0.35],
    [5.95, 0.15], [5.75, 0.55], [5.3, 0.62], [4.85, 0.8], [4.3, 0.55], [3.2, 0.02], [2.2, -0.02], [1.0, 0.1], [0.0, 0.42],
  ], true, 5);

  // spine
  const VERTEBRAE = [];
  {
    const tops = [3.25, 4.95, 6.65, 8.35, 10.05, 11.75];
    tops.forEach((t) => VERTEBRAE.push(S([[-2.98, t + 0.05], [-3.0, t + 1.3], [-4.7, t + 1.38], [-4.75, t + 0.02]], true, 3)));
  }
  const C2 = S([[-3.0, 0.75], [-2.95, 2.9], [-4.75, 2.95], [-4.75, 0.7], [-4.35, 0.5], [-4.35, -0.85], [-3.95, -1.15], [-3.6, -0.85], [-3.55, 0.5]], true, 3);
  const C1_ARCH = S([[-2.95, -0.95], [-2.75, -0.35], [-3.2, 0.25], [-3.5, -0.4], [-3.35, -0.95]]);
  const SPINOUS = [
    S([[-6.25, -0.95], [-7.3, -1.0], [-7.4, -0.35], [-6.2, -0.3]]),
    S([[-6.1, 0.9], [-8.0, 1.2], [-8.4, 2.3], [-6.15, 2.4]]),
    S([[-6.1, 3.5], [-7.7, 4.0], [-7.85, 4.6], [-6.1, 4.5]]),
    S([[-6.1, 5.2], [-7.8, 5.8], [-7.95, 6.4], [-6.1, 6.2]]),
    S([[-6.1, 6.9], [-7.9, 7.6], [-8.05, 8.2], [-6.1, 7.9]]),
    S([[-6.1, 8.6], [-8.2, 9.5], [-8.3, 10.1], [-6.1, 9.6]]),
    S([[-6.1, 10.3], [-8.6, 11.4], [-8.7, 12.0], [-6.1, 11.3]]),
  ];

  // larynx & neck
  const THYROID = S([[-0.15, 6.45], [0.72, 6.45], [1.28, 7.3], [1.08, 8.7], [0.2, 9.02], [-0.18, 8.85], [0.4, 8.3], [0.55, 7.2]]);
  const CRICOID_FRONT = S([[-0.2, 9.1], [0.6, 9.15], [0.72, 9.6], [-0.2, 9.65]]);
  const CRICOID_BACK = S([[-1.45, 8.95], [-1.95, 8.75], [-2.0, 10.1], [-1.45, 10.05]]);
  const ARYTENOID = S([[-1.45, 8.85], [-1.55, 8.1], [-1.8, 7.95], [-1.95, 8.75]]);
  const TRACHEA_AIR = S([[-0.3, 8.95], [-1.42, 9.0], [-1.42, 14.5], [0.4, 14.5], [0.38, 9.7], [-0.2, 9.68]], true, 3);
  const ESOPHAGUS = S([[-1.5, 8.95], [-2.4, 9.0], [-2.45, 14.5], [-1.5, 14.5]], true, 3);

  // mouth-floor attachment of tongue muscles (genioglossus fan lines)
  const NOSE_PATH = [P(-1.65, 1.4), P(-1.55, 0.0), P(-0.9, -1.2), P(0.6, -1.9), P(3.0, -1.95), P(5.4, -1.6), P(7.0, -1.1), P(7.4, -0.5), P(7.6, 0.6), P(7.8, 1.6)];

  // ---------- helpers ----------
  function pathFrom(pts, closed = true) {
    const p = new Path2D();
    if (!pts.length) return p;
    p.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) p.lineTo(pts[i].x, pts[i].y);
    if (closed) p.closePath();
    return p;
  }
  function polyLen(pts) { let L = 0; for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y); return L; }
  function pointAt(pts, u) {
    const total = polyLen(pts);
    let target = clamp(u, 0, 1) * total;
    for (let i = 1; i < pts.length; i++) {
      const l = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
      if (target <= l) return lerpP(pts[i - 1], pts[i], target / (l || 1));
      target -= l;
    }
    return pts[pts.length - 1];
  }
  function rng(seed) { let s = seed; return () => ((s = (s * 16807) % 2147483647) / 2147483647); }

  // static brain sulci (deterministic squiggles)
  const SULCI = [];
  {
    const r = rng(42);
    for (let i = 0; i < 26; i++) {
      const a = Math.PI * (1.03 + 0.94 * (i / 25)) + (r() - 0.5) * 0.08;
      const cx = -1.6, cy = -8.6;
      const R0 = 7.1 + r() * 1.0;
      const len = 1.0 + r() * 2.2;
      const pts = [];
      for (let k = 0; k <= 8; k++) {
        const rr = R0 - (len * k) / 8;
        const wig = Math.sin(k * 1.7 + i) * 0.25;
        pts.push(P(cx + Math.cos(a + wig * 0.05) * rr * 1.18 + wig * 0.2, cy + Math.sin(a) * rr * 1.02));
      }
      SULCI.push(pts.map((q) => stretch(q.x, q.y)));
    }
  }

  class HeadRenderer {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.view = { x0: -13.6, x1: 10.2, y0: -17.9, y1: 13.6 };
      this.targetView = Object.assign({}, this.view);
      this.particles = [];
      this.waves = [];
      this.lastT = 0;
      this.waveTimer = 0;
      this.dpr = 1;
      this.resize();
    }
    setZoom(mode) {
      this.targetView = mode === 'tract'
        ? { x0: -5.6, x1: 9.6, y0: -7.0, y1: 12.2 }
        : { x0: -13.6, x1: 10.2, y0: -17.9, y1: 13.6 };
    }
    resize() {
      const r = this.canvas.getBoundingClientRect();
      this.dpr = Math.min(2, window.devicePixelRatio || 1);
      this.w = Math.max(10, r.width); this.h = Math.max(10, r.height);
      this.canvas.width = Math.round(this.w * this.dpr);
      this.canvas.height = Math.round(this.h * this.dpr);
    }
    computeTransform() {
      const v = this.view;
      const vw = v.x1 - v.x0, vh = v.y1 - v.y0;
      const pad = this.w > 640 ? (this.rightPad || 0) : 0;
      const availW = this.w - pad;
      const s = Math.min(availW / vw, this.h / vh);
      this.scale = s;
      this.ox = (availW - vw * s) / 2 - v.x0 * s;
      this.oy = (this.h - vh * s) / 2 - v.y0 * s;
    }
    toScreen(p) { return P(p.x * this.scale + this.ox, p.y * this.scale + this.oy); }
    toWorld(x, y) { return P((x - this.ox) / this.scale, (y - this.oy) / this.scale); }

    /** draggable handles — the "instruments" */
    handles(f) {
      const g = f.geom, st = f.state;
      const lipMid = lerpP(g.upperStomion, g.lowerStomion, 0.5);
      return [
        { id: 'tongue', p: g.tongueCenter, label: 'Tongue', sub: 'the slide', color: '#ff8a8a' },
        { id: 'tip', p: P(g.tongueTip.x - 0.15, g.tongueTip.y - 0.1), label: 'Tongue tip', sub: 'the percussion', color: '#ffb36b', r: 0.36 },
        { id: 'lips', p: P(lipMid.x + 0.55, lipMid.y), label: 'Lips', sub: 'the mute', color: '#ff7ab8' },
        { id: 'jaw', p: g.jawPoint(P(6.35, 5.3), 1), label: 'Jaw', sub: 'the bell', color: '#ffd66b' },
        { id: 'velum', p: P(g.uvula.x + 0.05, g.uvula.y - 0.2), label: 'Soft palate', sub: 'the nasal stop', color: '#b38cff', r: 0.36 },
        { id: 'folds', p: P(-0.85, 8.85), label: 'Vocal folds', sub: 'the strings', color: '#7fd8ff' },
        { id: 'lungs', p: P(-0.5, 12.6), label: 'Lungs', sub: 'the bellows', color: '#8affc1' },
      ].map((h) => Object.assign({ r: 0.44 }, h, { active: f.dragging === h.id, hover: f.hover === h.id, st }));
    }
    hitTest(x, y, f) {
      this.computeTransform();
      const w = this.toWorld(x, y);
      let best = null, bd = 1e9;
      for (const h of this.handles(f)) {
        const d = Math.hypot(h.p.x - w.x, h.p.y - w.y);
        const reach = Math.max(h.r * 1.6, 14 / this.scale);
        if (d < reach && d < bd) { bd = d; best = h.id; }
      }
      return best;
    }

    // ------------------------------------------------------------------ draw
    draw(f) {
      const now = f.time;
      const dt = Math.min(0.05, this.lastT ? now - this.lastT : 0.016);
      this.lastT = now;
      // ease the view
      for (const k of ['x0', 'x1', 'y0', 'y1']) this.view[k] += (this.targetView[k] - this.view[k]) * Math.min(1, dt * 6);
      this.computeTransform();
      const ctx = this.ctx;
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.clearRect(0, 0, this.w, this.h);
      ctx.save();
      ctx.translate(this.ox, this.oy);
      ctx.scale(this.scale, this.scale);
      this.px = 1 / this.scale; // one pixel in world units
      const g = f.geom;

      this.drawSkin(f);
      this.drawSkullAndBrain();
      this.drawSpine();
      this.drawNasal();
      this.drawMandibleGhost(f);
      this.drawAirway(f);
      this.drawUpperJaw(f);
      this.drawLarynx(f);
      this.drawVelum(f);
      this.drawTongue(f);
      this.drawLowerJaw(f);
      this.drawLips(f);
      if (f.showRays) this.drawRays(g);
      this.updateParticles(f, dt);
      this.drawParticles();
      this.drawSoundWaves(f, dt);
      if (f.showLabels) this.drawLeaders(f);
      this.drawHandles(f);
      ctx.restore();
      if (f.showLabels) this.drawLabelText(f);
      this.drawHandleLabels(f);
    }

    fillStroke(path, fill, stroke, lw = 1) {
      const ctx = this.ctx;
      if (fill) { ctx.fillStyle = fill; ctx.fill(path); }
      if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw * this.px; ctx.stroke(path); }
    }

    drawSkin(f) {
      const g = f.geom, ctx = this.ctx;
      const pts = [];
      for (const [x, y, w] of THROAT) pts.push(g.jawPoint(P(x, y), w));
      // lower lip outer surface (front), then upper lip outer
      const ll = g.lowerLip, ul = g.upperLip;
      pts.push(ll[5], ll[4], ll[3]);
      pts.push(ul[4], ul[5], ul[6], ul[7], ul[8]);
      for (const [x, y] of FACE_TOP) pts.push(stretch(x, y));
      const sil = spline(pts, false, 6);
      sil.push(P(-9.0, 16), P(2.2, 16));
      const path = pathFrom(sil);
      this.silhouette = path;
      // deep tissue fill, then a skin band clipped inside the outline
      const grad = ctx.createLinearGradient(-8, 0, 8, 0);
      grad.addColorStop(0, C.tissueDeep); grad.addColorStop(0.6, C.tissue); grad.addColorStop(1, C.tissue);
      ctx.fillStyle = grad;
      ctx.fill(path);
      ctx.save();
      ctx.clip(path);
      ctx.strokeStyle = C.skin;
      ctx.lineWidth = 1.1;
      ctx.stroke(path);
      ctx.strokeStyle = 'rgba(255,230,210,0.35)';
      ctx.lineWidth = 0.25;
      ctx.stroke(path);
      ctx.restore();
      ctx.strokeStyle = 'rgba(120,60,40,0.55)';
      ctx.lineWidth = 1.4 * this.px;
      ctx.stroke(path);
    }

    drawSkullAndBrain() {
      const ctx = this.ctx;
      // brain
      const brainPts = [...BRAIN_OUT, ...CEREBRUM_BOTTOM];
      const brain = pathFrom(spline(brainPts, true, 3));
      const bg = ctx.createRadialGradient(-1, -11, 1, -1, -10, 9);
      bg.addColorStop(0, '#f4d9da'); bg.addColorStop(1, C.brain);
      this.fillStroke(brain, bg, C.brainEdge, 1.2);
      ctx.save();
      ctx.clip(brain);
      ctx.strokeStyle = C.gyri; ctx.lineWidth = 0.09; ctx.lineCap = 'round';
      for (const s of SULCI) ctx.stroke(pathFrom(s, false));
      ctx.restore();
      this.fillStroke(pathFrom(CORPUS), '#f8ecec', 'rgba(160,100,110,0.6)', 1);
      const cb = pathFrom(CEREBELLUM);
      this.fillStroke(cb, C.cerebellum, C.brainEdge, 1.2);
      ctx.save(); ctx.clip(cb);
      ctx.strokeStyle = 'rgba(160,90,100,0.4)'; ctx.lineWidth = 0.06;
      for (let i = 0; i < 9; i++) {
        const a = -2.6 + i * 0.32;
        ctx.beginPath();
        ctx.moveTo(-4.3, -4.1);
        ctx.quadraticCurveTo(-4.3 + Math.cos(a) * 1.8, -4.1 + Math.sin(a) * 1.2, -4.3 + Math.cos(a) * 4.2, -4.1 + Math.sin(a) * 2.2);
        ctx.stroke();
      }
      ctx.restore();
      this.fillStroke(pathFrom(BRAINSTEM), '#e8c0b4', C.brainEdge, 1.2);

      // cranial bone
      const bone = pathFrom([...SKULL_OUT, ...SKULL_IN.slice().reverse()]);
      this.fillStroke(bone, C.bone, C.boneEdge, 1.2);
      ctx.save(); ctx.clip(bone);
      ctx.strokeStyle = C.marrow; ctx.lineWidth = 0.22; ctx.setLineDash([0.12, 0.18]);
      ctx.stroke(pathFrom(offsetPath(SKULL_ARC, 0.88, HEAD_CENTER), false));
      ctx.setLineDash([]);
      ctx.restore();
      this.fillStroke(pathFrom(CRANIAL_BASE), C.bone, C.boneEdge, 1.2);
      this.fillStroke(pathFrom(OCCIPUT), C.bone, C.boneEdge, 1.2);
      this.fillStroke(pathFrom(SPHENOID_SINUS), '#3a2a35', C.boneEdge, 1);
      this.fillStroke(pathFrom(FRONTAL_SINUS), '#3a2a35', C.boneEdge, 1);
      this.fillStroke(pathFrom(NASAL_BONE), C.bone, C.boneEdge, 1);
    }

    drawSpine() {
      const ctx = this.ctx;
      // spinal canal & cord
      const canal = pathFrom(spline([P(-4.95, -1.0), P(-4.9, 3), P(-4.85, 14.5), P(-6.1, 14.5), P(-6.1, 3), P(-6.05, -1.4)], true, 3));
      this.fillStroke(canal, '#d9b9a0', null);
      const cord = pathFrom(spline([P(-4.95, -1.0), P(-5.15, 3), P(-5.12, 14.5), P(-5.85, 14.5), P(-5.85, 3), P(-5.6, -1.2)], true, 3));
      this.fillStroke(cord, C.cord, C.cordEdge, 1);
      // discs behind the bodies
      this.fillStroke(pathFrom([P(-3.0, 2.8), P(-2.98, 14.5), P(-4.75, 14.5), P(-4.75, 2.8)]), C.disc, null);
      const vb = (pts) => this.fillStroke(pathFrom(pts), C.bone, C.boneEdge, 1.1);
      vb(C2); vb(C1_ARCH);
      VERTEBRAE.forEach(vb);
      SPINOUS.forEach(vb);
      // trabecular texture
      ctx.fillStyle = 'rgba(190,165,120,0.35)';
      const r = rng(7);
      for (let i = 0; i < 140; i++) {
        const x = -4.6 + r() * 1.5, y = 0.8 + r() * 13;
        ctx.beginPath(); ctx.arc(x, y, 0.05 + r() * 0.06, 0, Math.PI * 2); ctx.fill();
      }
    }

    drawNasal() {
      const ctx = this.ctx;
      const air = pathFrom(NASAL_AIR);
      this.fillStroke(air, C.airway, null);
      ctx.save(); ctx.clip(air);
      ctx.strokeStyle = C.mucosa; ctx.lineWidth = 0.35; ctx.stroke(air);
      ctx.restore();
      for (const t of TURBINATES) this.fillStroke(pathFrom(t), C.mucosa, '#b85a5e', 1);
    }

    drawAirway(f) {
      const g = f.geom;
      const pts = [];
      pts.push(...Anatomy.POSTERIOR_WALL.slice(0, Anatomy.POSTERIOR_WALL.length - 12));
      pts.push(P(-1.0, 0.75), P(-0.05, 0.62));
      pts.push(...Anatomy.PALATE_ORAL);
      pts.push(P(5.18, 1.75), P(5.38, 2.12), P(5.52, 2.3));
      // upper lip underside (inner → stomion)
      const ul = g.upperLip; pts.push(ul[2], ul[3], ul[4]);
      // lower lip top (stomion → inner)
      const ll = g.lowerLip; pts.push(ll[3], ll[2], ll[1], ll[0]);
      pts.push(...[P(4.9, 3.3), P(4.3, 3.6), P(3.2, 4.4), P(1.6, 5.2)].map((p) => g.jawPoint(p, 1)));
      pts.push(g.hyoid);
      pts.push(P(-0.15, 6.5), ...Anatomy.LARYNX_FRONT.slice().reverse());
      const path = pathFrom(pts);
      const ctx = this.ctx;
      this.fillStroke(path, C.airway, null);
      ctx.save(); ctx.clip(path);
      ctx.strokeStyle = C.mucosa; ctx.lineWidth = 0.3; ctx.stroke(path);
      ctx.restore();
      // trachea & oesophagus
      this.fillStroke(pathFrom(ESOPHAGUS), C.esophagus, '#a85d5d', 1);
      ctx.strokeStyle = '#a85d5d'; ctx.lineWidth = 0.06;
      ctx.beginPath(); ctx.moveTo(-1.95, 9.2); ctx.bezierCurveTo(-2.05, 11, -1.85, 12.5, -1.98, 14.5); ctx.stroke();
      this.fillStroke(pathFrom(TRACHEA_AIR), C.airway, null);
      ctx.save(); ctx.clip(pathFrom(TRACHEA_AIR));
      ctx.strokeStyle = C.mucosa; ctx.lineWidth = 0.28; ctx.stroke(pathFrom(TRACHEA_AIR));
      ctx.restore();
      for (let y = 10.0; y < 14.5; y += 0.6) {
        ctx.beginPath();
        ctx.ellipse(0.42, y, 0.16, 0.22, 0, 0, Math.PI * 2);
        ctx.fillStyle = C.cartilage; ctx.fill();
        ctx.strokeStyle = C.cartEdge; ctx.lineWidth = this.px; ctx.stroke();
      }
    }

    drawUpperJaw(f) {
      const g = f.geom, ctx = this.ctx;
      // gum + maxilla soft tissue between nose floor and mouth roof
      const ul = g.upperLip;
      const tissue = pathFrom([
        P(-0.25, 0.2), P(1.0, -0.06), P(3.0, -0.14), P(5.0, -0.25), P(6.2, -0.3), ul[8], ul[7], ul[6], ul[5], ul[4], ul[3], ul[2], ul[1], ul[0],
        P(5.4, 0.62), P(5.0, 1.0), ...Anatomy.PALATE_ORAL.slice().reverse(),
      ]);
      this.fillStroke(tissue, C.mucosa, null);
      this.fillStroke(pathFrom(HARD_PALATE_BONE), C.bone, C.boneEdge, 1.1);
      // upper incisor
      this.fillStroke(pathFrom(spline(Anatomy.UPPER_INCISOR, true, 4)), C.teeth, C.teethEdge, 1.1);
    }

    drawVelum(f) {
      const g = f.geom, ctx = this.ctx;
      const path = pathFrom(spline(g.velum, true, 2));
      const grad = ctx.createLinearGradient(-1.5, 0, 0, 2);
      grad.addColorStop(0, C.velum); grad.addColorStop(1, '#e98b92');
      this.fillStroke(path, grad, C.muscleEdge, 1.2);
      if (f.hover === 'velum' || f.dragging === 'velum') this.glow(path, '#b38cff');
    }

    drawTongue(f) {
      const g = f.geom, ctx = this.ctx;
      const path = pathFrom(g.tongue);
      const c = g.tongueCenter;
      const grad = ctx.createRadialGradient(c.x + 0.4, c.y - 1.2, 0.2, c.x, c.y, 3.2);
      grad.addColorStop(0, C.muscleLight); grad.addColorStop(0.7, C.muscle); grad.addColorStop(1, '#a83c48');
      this.fillStroke(path, grad, C.muscleEdge, 1.4);
      // muscle fibres fanning from the jaw (genioglossus)
      ctx.save(); ctx.clip(path);
      ctx.strokeStyle = 'rgba(120,30,40,0.16)'; ctx.lineWidth = 0.045;
      const origin = g.jawPoint(P(4.4, 4.3), 1);
      for (let i = 0; i < 14; i++) {
        const a = -Math.PI * 0.18 - (i / 13) * Math.PI * 0.85;
        ctx.beginPath();
        ctx.moveTo(origin.x, origin.y);
        ctx.quadraticCurveTo(origin.x + Math.cos(a) * 2.5, origin.y + Math.sin(a) * 2.2, origin.x + Math.cos(a) * 6, origin.y + Math.sin(a) * 5);
        ctx.stroke();
      }
      ctx.strokeStyle = 'rgba(255,200,200,0.25)'; ctx.lineWidth = 0.12;
      ctx.stroke(pathFrom(g.tongue.slice(2, 24), false));
      ctx.restore();
      if (f.hover === 'tongue' || f.dragging === 'tongue' || f.hover === 'tip' || f.dragging === 'tip') this.glow(path, '#ff8a8a');
    }

    drawMandibleGhost(f) {
      // the mandible's body lies to the side of the cut: show it as a ghost
      const ctx = this.ctx, path = pathFrom(f.geom.mandibleSide);
      ctx.save();
      ctx.globalAlpha = 0.3;
      this.fillStroke(path, C.bone, null);
      ctx.globalAlpha = 0.6;
      ctx.setLineDash([0.2, 0.15]);
      this.fillStroke(path, null, C.boneEdge, 1);
      ctx.restore();
    }

    drawLowerJaw(f) {
      const g = f.geom, ctx = this.ctx;
      this.fillStroke(pathFrom(spline(g.symphysis, true, 4)), C.bone, C.boneEdge, 1.1);
      this.fillStroke(pathFrom(spline(g.lowerIncisor, true, 4)), C.teeth, C.teethEdge, 1.1);
      // hyoid bone
      const h = g.hyoid;
      ctx.beginPath(); ctx.ellipse(h.x + 0.55, h.y + 0.05, 0.55, 0.22, 0.15, 0, Math.PI * 2);
      ctx.fillStyle = C.bone; ctx.fill(); ctx.strokeStyle = C.boneEdge; ctx.lineWidth = this.px; ctx.stroke();
      if (f.hover === 'jaw' || f.dragging === 'jaw') this.glow(pathFrom(spline(g.symphysis, true, 4)), '#ffd66b');
    }

    drawLips(f) {
      const g = f.geom, ctx = this.ctx;
      // lips: flesh inside, skin outside, red vermilion around the mouth opening
      const lip = (pts, skinIdx, innerIdx, redCenter, rx, ry) => {
        const path = pathFrom(spline(pts, true, 4));
        ctx.fillStyle = C.tissue; ctx.fill(path);
        ctx.save(); ctx.clip(path);
        const edge = (idx, color, w) => {
          ctx.strokeStyle = color; ctx.lineWidth = w; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
          ctx.stroke(pathFrom(spline(idx.map((i) => pts[i]), false, 6), false));
        };
        edge(innerIdx, C.mucosa, 0.45);
        edge(skinIdx, C.skin, 1.1);
        const rg = ctx.createRadialGradient(redCenter.x, redCenter.y, 0.05, redCenter.x, redCenter.y, Math.max(rx, ry));
        rg.addColorStop(0, C.lipLight); rg.addColorStop(0.75, C.lip); rg.addColorStop(1, '#a9474f');
        ctx.fillStyle = rg;
        ctx.beginPath(); ctx.ellipse(redCenter.x, redCenter.y, rx, ry, 0, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
        ctx.strokeStyle = 'rgba(120,60,40,0.5)'; ctx.lineWidth = 1.1 * this.px;
        ctx.stroke(path);
        return path;
      };
      const u = g.upperLip, l = g.lowerLip;
      const ul = lip(u, [6, 7, 8], [0, 1, 2], P(u[4].x + 0.02, u[4].y - 0.1), 0.62, 0.72);
      const ll = lip(l, [5, 6, 7], [8, 0, 1], P(l[3].x + 0.05, l[3].y + 0.12), 0.62, 0.68);
      if (f.hover === 'lips' || f.dragging === 'lips') { this.glow(ul, '#ff7ab8'); this.glow(ll, '#ff7ab8'); }
    }

    drawLarynx(f) {
      const ctx = this.ctx, g = f.geom;
      this.fillStroke(pathFrom(THYROID), C.cartilage, C.cartEdge, 1.1);
      this.fillStroke(pathFrom(CRICOID_FRONT), C.cartilage, C.cartEdge, 1.1);
      this.fillStroke(pathFrom(CRICOID_BACK), C.cartilage, C.cartEdge, 1.1);
      this.fillStroke(pathFrom(ARYTENOID), C.cartilage, C.cartEdge, 1.1);
      this.fillStroke(pathFrom(spline(g.epiglottis, true, 3)), C.cartilage, C.cartEdge, 1.1);
      // ventricular (false) folds and the true vocal folds
      const vib = f.voicedLevel || 0;
      const t = f.time;
      const wob = vib * 0.06 * Math.sin(t * 2 * Math.PI * Math.min(30, (f.freq || 120) / 8));
      ctx.fillStyle = '#e9a1a1';
      ctx.beginPath(); ctx.ellipse(-0.36, 8.25, 0.22, 0.14, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(-1.37, 8.25, 0.2, 0.14, 0, 0, Math.PI * 2); ctx.fill();
      const fold = new Path2D();
      fold.moveTo(-0.28, 8.7); fold.quadraticCurveTo(-0.85, 8.7 + wob, -1.42, 8.72);
      fold.lineTo(-1.42, 8.92); fold.quadraticCurveTo(-0.85, 8.95 - wob, -0.28, 8.93); fold.closePath();
      this.fillStroke(fold, '#fbf3ea', '#c9a9a0', 1);
      if (vib > 0.02) {
        ctx.save();
        ctx.globalAlpha = Math.min(1, vib * 1.5);
        ctx.shadowColor = '#7fd8ff'; ctx.shadowBlur = 18;
        ctx.strokeStyle = '#a8e6ff'; ctx.lineWidth = 0.05;
        ctx.stroke(fold);
        ctx.restore();
      }
    }

    glow(path, color) {
      const ctx = this.ctx;
      ctx.save();
      ctx.shadowColor = color; ctx.shadowBlur = 16;
      ctx.strokeStyle = color; ctx.lineWidth = 2 * this.px;
      ctx.stroke(path);
      ctx.restore();
    }

    drawRays(g) {
      const ctx = this.ctx;
      ctx.lineWidth = this.px;
      for (const r of g.rays) {
        if (r.gap > 2.9) continue;
        ctx.strokeStyle = r.gap < 0.05 ? 'rgba(255,80,80,0.9)' : 'rgba(120,220,255,0.55)';
        ctx.beginPath(); ctx.moveTo(r.a.x, r.a.y); ctx.lineTo(r.b.x, r.b.y); ctx.stroke();
      }
    }

    // ---------------------------------------------------------------- air
    updateParticles(f, dt) {
      const g = f.geom;
      const breath = f.breath || 0;
      const N = g.rays.length;
      // spawn
      const rate = breath * 90;
      this.spawnAcc = (this.spawnAcc || 0) + rate * dt;
      while (this.spawnAcc >= 1) {
        this.spawnAcc -= 1;
        if (this.particles.length < 260) this.particles.push({ u: 0, o: Math.random() - 0.5, nose: false, life: 0, voiced: f.voiced });
      }
      const port = g.nasalPort;
      const jIdx = Anatomy.NOSE_JUNCTION;
      for (const p of this.particles) {
        p.life += dt;
        if (p.nose) {
          p.nu += dt * (0.35 + breath * 0.9);
          continue;
        }
        const idx = Math.min(N - 1, Math.floor(p.u * N));
        const area = idx < N ? g.areas[idx] : 5;
        // particles approaching a closure stall: pressure building
        const ahead = g.areas[Math.min(N - 1, idx + 1)];
        let speed = (5 + breath * 14) / Math.sqrt(Math.max(0.5, area));
        if (ahead < 0.01 && p.u * N > idx + 0.5) speed = 0;
        if (area < 0.01) speed = 0.3;
        p.u += (speed * dt) / 16;
        if (idx === jIdx && !p.checked) {
          p.checked = true;
          const oral = g.areas[jIdx + 1] || 0;
          if (port > 0.02 && Math.random() < port / (port + oral + 0.0001)) { p.nose = true; p.nu = 0; }
        }
      }
      this.particles = this.particles.filter((p) => (p.nose ? p.nu < 1.15 : p.u < 1.25) && p.life < 12);
    }
    drawParticles() {
      const ctx = this.ctx;
      const g = this.lastGeom;
      for (const p of this.particles) {
        let pos, alpha = 0.85;
        if (p.nose) {
          pos = pointAt(NOSE_PATH, p.nu);
          alpha = p.nu > 0.85 ? Math.max(0, 1 - (p.nu - 0.85) / 0.3) : 0.85;
          pos = P(pos.x + p.o * 0.6, pos.y);
        } else if (p.u <= 1) {
          const N = g.rays.length;
          const fi = p.u * N;
          const i = Math.min(N - 1, Math.floor(fi));
          const r = g.rays[i];
          const t = clamp(0.5 + p.o * 0.75, 0.05, 0.95);
          pos = lerpP(r.a, r.b, t);
        } else {
          const r = g.rays[g.rays.length - 1];
          const mid = lerpP(r.a, r.b, 0.5);
          const k = (p.u - 1) / 0.25;
          pos = P(mid.x + k * 2.2, mid.y + p.o * k * 2.4);
          alpha = Math.max(0, 0.85 * (1 - k));
        }
        ctx.globalAlpha = alpha;
        ctx.fillStyle = p.voiced ? '#9fe7ff' : '#d8f7ff';
        ctx.beginPath(); ctx.arc(pos.x, pos.y, 0.07, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    drawSoundWaves(f, dt) {
      const ctx = this.ctx, g = f.geom;
      const level = f.rms || 0;
      this.waveTimer += dt;
      const period = 0.09;
      if (level > 0.01 && this.waveTimer > period) {
        this.waveTimer = 0;
        const src = lerpP(g.upperStomion, g.lowerStomion, 0.5);
        const mouthOpen = Math.min(1, g.areas[g.areas.length - 2] / 1.5);
        if (mouthOpen > 0.03) this.waves.push({ x: src.x + 0.3, y: src.y, r: 0.2, a: Math.min(1, level * 5) * Math.sqrt(mouthOpen), hue: f.hue || 190, nose: false });
        if (g.nasalPort > 0.2) this.waves.push({ x: 8.0, y: -0.7, r: 0.2, a: Math.min(1, level * 3) * Math.min(1, g.nasalPort), hue: 270, nose: true });
      }
      for (const w of this.waves) { w.r += dt * 6; w.a *= Math.pow(0.25, dt); }
      this.waves = this.waves.filter((w) => w.a > 0.02 && w.r < 9);
      ctx.lineWidth = 1.6 * this.px;
      for (const w of this.waves) {
        ctx.strokeStyle = `hsla(${w.hue}, 90%, 70%, ${w.a})`;
        ctx.beginPath();
        if (w.nose) ctx.arc(w.x, w.y, w.r, -0.1 * Math.PI, 0.6 * Math.PI);
        else ctx.arc(w.x, w.y, w.r, -0.32 * Math.PI, 0.32 * Math.PI);
        ctx.stroke();
      }
    }

    // ------------------------------------------------------------ handles
    drawHandles(f) {
      const ctx = this.ctx;
      for (const h of this.handles(f)) {
        const r = h.r * (h.hover || h.active ? 1.2 : 1);
        ctx.save();
        ctx.shadowColor = h.color; ctx.shadowBlur = h.active ? 22 : h.hover ? 16 : 8;
        ctx.beginPath(); ctx.arc(h.p.x, h.p.y, r, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(15,10,25,0.35)'; ctx.fill();
        ctx.lineWidth = 2.2 * this.px; ctx.strokeStyle = h.color; ctx.stroke();
        ctx.restore();
        ctx.beginPath(); ctx.arc(h.p.x, h.p.y, r * 0.32, 0, Math.PI * 2);
        ctx.fillStyle = h.color; ctx.fill();
      }
    }
    drawHandleLabels(f) {
      const ctx = this.ctx;
      ctx.save();
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      for (const h of this.handles(f)) {
        if (!(h.hover || h.active)) continue;
        const s = this.toScreen(h.p);
        const txt = `${h.label} · ${h.sub}`;
        ctx.font = '600 13px Inter, system-ui, sans-serif';
        const w = ctx.measureText(txt).width + 18;
        let x = s.x + 18, y = s.y - 30;
        if (x + w > this.w - 4) x = s.x - w - 18;
        ctx.fillStyle = 'rgba(14,10,24,0.92)';
        roundRect(ctx, x, y, w, 26, 8); ctx.fill();
        ctx.strokeStyle = h.color; ctx.lineWidth = 1; ctx.stroke();
        ctx.fillStyle = '#fff';
        ctx.fillText(txt, x + 9, y + 17.5);
      }
      ctx.restore();
    }

    // ------------------------------------------------------------- labels
    labelList(f) {
      const g = f.geom;
      return [
        ['Brain', P(-1.5, -12.5), P(-8.6, -15.6)],
        ['Nasal cavity', P(3.2, -4.6), P(9.2, -8.8)],
        ['Hard palate', P(2.6, -0.05), P(9.2, -5.6)],
        ['Soft palate (velum)', g.uvula, P(-10.6, -1.0)],
        ['Tongue', P(g.tongueCenter.x + 0.2, g.tongueCenter.y + 0.6), P(9.4, 8.6)],
        ['Teeth', P(5.55, 2.0), P(9.4, 3.8)],
        ['Lips', P(7.15, 2.5), P(9.4, 1.6)],
        ['Jaw (mandible)', g.jawPoint(P(5.6, 5.0), 1), P(9.4, 6.4)],
        ['Epiglottis', P(-1.0, 5.0), P(-10.6, 3.4)],
        ['Pharynx', P(-1.7, 3.0), P(-10.6, 1.0)],
        ['Vocal folds', P(-0.9, 8.82), P(-10.6, 7.3)],
        ['Larynx', P(0.9, 7.6), P(9.4, 10.6)],
        ['Trachea → lungs', P(-0.5, 12.0), P(9.4, 12.8)],
        ['Oesophagus', P(-1.95, 12.0), P(-10.6, 11.4)],
        ['Spine', P(-3.9, 5.6), P(-10.6, 5.4)],
        ['Spinal cord', P(-5.5, 9.4), P(-10.6, 9.4)],
      ];
    }
    drawLeaders(f) {
      const ctx = this.ctx;
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = this.px;
      for (const [, a, b] of this.labelList(f)) {
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        ctx.beginPath(); ctx.arc(a.x, a.y, 2.5 * this.px, 0, Math.PI * 2); ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.fill();
      }
    }
    drawLabelText(f) {
      const ctx = this.ctx;
      ctx.save();
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.font = '500 11.5px Inter, system-ui, sans-serif';
      for (const [txt, , b] of this.labelList(f)) {
        const s = this.toScreen(b);
        const w = ctx.measureText(txt).width;
        const right = b.x > 0;
        let x = right ? s.x + 4 : s.x - w - 4;
        x = clamp(x, 4, this.w - w - 4);
        ctx.fillStyle = 'rgba(10,8,18,0.7)';
        roundRect(ctx, x - 4, s.y - 9, w + 8, 18, 5); ctx.fill();
        ctx.fillStyle = '#efe7ff';
        ctx.fillText(txt, x, s.y + 4);
      }
      ctx.restore();
    }
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // drawParticles needs geometry; keep a reference
  const origDraw = HeadRenderer.prototype.draw;
  HeadRenderer.prototype.draw = function (f) { this.lastGeom = f.geom; return origDraw.call(this, f); };

  root.HeadRenderer = HeadRenderer;
})(typeof window !== 'undefined' ? window : globalThis);
