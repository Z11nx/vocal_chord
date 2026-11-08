/*
 * anatomy.js — the geometric model of the head.
 *
 * Coordinates are centimetres in a mid-sagittal (side-on, sliced down the
 * middle) view. +x points toward the face (anterior), +y points DOWN.
 * The hard palate's back edge sits near the origin.
 *
 * The key idea: the vocal tract's acoustic shape is *measured from the
 * drawing*. A midline runs from the vocal folds up the throat and out
 * through the lips. At each of N sections we cast a line across the airway
 * and measure the gap between the moving "floor" structures (tongue, lower
 * lip, epiglottis…) and the fixed "ceiling" structures (palate, velum,
 * throat wall, upper lip…). Gap → cross-sectional area → sound.
 */
(function (root) {
  'use strict';

  const N_TRACT = 44;          // waveguide sections, glottis → lips
  const PIVOT = { x: -2.0, y: -1.0 }; // jaw hinge (TMJ, projected)
  const MAX_JAW = 0.30;        // radians at jaw = 1
  const RAY_RANGE = 3.2;       // cm either side of the midline

  // ---------- small vector helpers ----------
  const P = (x, y) => ({ x, y });
  const lerp = (a, b, t) => a + (b - a) * t;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const lerpP = (a, b, t) => P(lerp(a.x, b.x, t), lerp(a.y, b.y, t));
  function rotate(p, c, ang) {
    const s = Math.sin(ang), co = Math.cos(ang);
    const dx = p.x - c.x, dy = p.y - c.y;
    return P(c.x + dx * co - dy * s, c.y + dx * s + dy * co);
  }

  /** Catmull-Rom spline through points. */
  function spline(pts, closed, seg = 8) {
    const out = [];
    const n = pts.length;
    const get = (i) => {
      if (closed) return pts[(i + n) % n];
      return pts[clamp(i, 0, n - 1)];
    };
    const last = closed ? n : n - 1;
    for (let i = 0; i < last; i++) {
      const p0 = get(i - 1), p1 = get(i), p2 = get(i + 1), p3 = get(i + 2);
      for (let k = 0; k < seg; k++) {
        const t = k / seg, t2 = t * t, t3 = t2 * t;
        out.push(P(
          0.5 * (2 * p1.x + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
          0.5 * (2 * p1.y + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3)
        ));
      }
    }
    if (!closed) out.push(pts[n - 1]);
    return out;
  }

  function bezier(p0, p1, p2, p3, n) {
    const out = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n, u = 1 - t;
      out.push(P(
        u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
        u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y
      ));
    }
    return out;
  }

  function polyLength(pts) {
    let L = 0;
    for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    return L;
  }

  /** Resample an open polyline into n equal-length pieces (n+1 points). */
  function resample(pts, n) {
    const total = polyLength(pts);
    const out = [pts[0]];
    let seg = 1, acc = 0;
    for (let k = 1; k < n; k++) {
      const target = (total * k) / n;
      while (seg < pts.length) {
        const a = pts[seg - 1], b = pts[seg];
        const l = Math.hypot(b.x - a.x, b.y - a.y);
        if (acc + l >= target) {
          out.push(lerpP(a, b, (target - acc) / (l || 1)));
          break;
        }
        acc += l; seg++;
      }
    }
    out.push(pts[pts.length - 1]);
    return { pts: out, length: total };
  }

  /** All parameters t where the line o + t·d crosses the polyline. */
  function rayHits(o, d, poly, closed, out) {
    const n = poly.length;
    const last = closed ? n : n - 1;
    for (let i = 0; i < last; i++) {
      const a = poly[i], b = poly[(i + 1) % n];
      const ex = b.x - a.x, ey = b.y - a.y;
      const den = d.x * ey - d.y * ex;
      if (Math.abs(den) < 1e-9) continue;
      const wx = a.x - o.x, wy = a.y - o.y;
      const t = (wx * ey - wy * ex) / den;
      const s = (wx * d.y - wy * d.x) / den;
      if (s >= 0 && s <= 1 && t >= -RAY_RANGE && t <= RAY_RANGE) out.push(t);
    }
    return out;
  }

  // ---------- the vocal-tract midline (glottis → lips) ----------
  const MIDLINE_CTRL = [
    P(-0.85, 8.75), P(-1.05, 7.6), P(-1.3, 6.2), P(-1.45, 4.7), P(-1.42, 3.2),
    P(-1.22, 2.0), P(-0.75, 1.15), P(0.2, 0.85), P(1.5, 0.75), P(2.8, 0.75),
    P(3.9, 1.0), P(4.75, 1.55), P(5.35, 2.15), P(6.1, 2.35), P(7.15, 2.37),
  ];
  const midRes = resample(spline(MIDLINE_CTRL, false, 16), N_TRACT);
  const MID_BOUNDS = midRes.pts;
  const TRACT_LENGTH = midRes.length;
  const SECTIONS = [];
  for (let i = 0; i < N_TRACT; i++) {
    const a = MID_BOUNDS[i], b = MID_BOUNDS[i + 1];
    let tx = b.x - a.x, ty = b.y - a.y;
    const l = Math.hypot(tx, ty) || 1;
    tx /= l; ty /= l;
    SECTIONS.push({ c: lerpP(a, b, 0.5), n: P(ty, -tx), frac: (i + 0.5) / N_TRACT });
  }
  // smooth the normals a little so neighbouring rays don't cross
  for (let pass = 0; pass < 3; pass++) {
    const ns = SECTIONS.map((s) => s.n);
    for (let i = 1; i < N_TRACT - 1; i++) {
      const x = ns[i - 1].x + 2 * ns[i].x + ns[i + 1].x;
      const y = ns[i - 1].y + 2 * ns[i].y + ns[i + 1].y;
      const l = Math.hypot(x, y);
      SECTIONS[i].n = P(x / l, y / l);
    }
  }
  // section where the nasal passage branches off (velopharyngeal port)
  let NOSE_JUNCTION = 0;
  {
    let best = 1e9;
    SECTIONS.forEach((s, i) => {
      const d = Math.hypot(s.c.x - -1.2, s.c.y - 1.75);
      if (d < best) { best = d; NOSE_JUNCTION = i; }
    });
  }

  // ---------- fixed anatomy ----------
  // posterior pharyngeal wall, larynx up to the nasopharynx roof
  const POSTERIOR_WALL = spline([
    P(-1.4, 8.85), P(-1.6, 7.7), P(-1.92, 6.6), P(-2.12, 5.4), P(-2.2, 4.0),
    P(-2.18, 2.6), P(-2.08, 1.4), P(-1.86, 0.3), P(-1.45, -0.7), P(-0.9, -1.45), P(-0.2, -1.95),
  ], false, 6);

  // oral surface of the hard palate, alveolar ridge, upper incisor
  const PALATE_ORAL = spline([
    P(-0.15, 0.62), P(1.0, 0.28), P(2.2, 0.1), P(3.2, 0.15), P(4.0, 0.48),
    P(4.55, 0.95), P(4.95, 1.38),
  ], false, 6);
  const UPPER_INCISOR = [
    P(4.95, 1.38), P(5.18, 1.75), P(5.38, 2.12), P(5.52, 2.3), P(5.74, 2.22),
    P(5.86, 1.7), P(5.9, 1.05), P(5.82, 0.55), P(5.35, 0.62), P(5.0, 0.95),
  ];
  // anterior wall of the larynx (inner surface of thyroid / epiglottis base)
  const LARYNX_FRONT = [P(-0.28, 8.85), P(-0.33, 7.8), P(-0.42, 6.95)];

  // tongue-body centre range (head frame): back/front, low/high
  const TONGUE_X0 = 0.25, TONGUE_X1 = 2.45, TONGUE_Y0 = 3.75, TONGUE_Y1 = 2.3;
  /** how far a point in the middle of the floor of the mouth moves with the jaw */
  function jawDisplacement(jaw) {
    const ref = P(2.0, 4.5);
    const q = rotate(P(ref.x + jaw * 0.25, ref.y), PIVOT, jaw * MAX_JAW);
    return P(q.x - ref.x, q.y - ref.y);
  }

  // ---------- default articulator state ----------
  function defaultState() {
    return {
      tongueX: 0.5,  // 0 back … 1 front
      tongueY: 0.5,  // 0 low  … 1 high
      tipUp: 0.0,    // 0 resting behind lower teeth … 1 touching alveolar ridge
      jaw: 0.3,      // 0 closed … 1 wide open
      lipOpen: 1.0,  // 0 pressed together … 1 relaxed (follow jaw)
      lipRound: 0.0, // 0 spread … 1 rounded & protruded
      velum: 0.0,    // 0 raised (nose sealed) … 1 lowered (nasal)
      larynx: 0.5,   // visual larynx height (follows pitch)
    };
  }

  // ---------- build the moving anatomy for a given state ----------
  function build(s) {
    const jawAng = s.jaw * MAX_JAW;
    const jawShift = s.jaw * 0.25;
    const J = (p, w = 1) => {
      if (w === 0) return p;
      const q = rotate(P(p.x + jawShift * w, p.y), PIVOT, jawAng * w);
      return q;
    };

    // ---- tongue ----
    const tx = s.tongueX, ty = s.tongueY;
    const r = 2.0 + 0.1 * (1 - ty);
    const cHead = P(lerp(TONGUE_X0, TONGUE_X1, tx), lerp(TONGUE_Y0, TONGUE_Y1, ty));
    const jd = jawDisplacement(s.jaw);
    const c = P(cHead.x + jd.x * 0.3, cHead.y + jd.y * 0.6);
    const a0 = (-28 * Math.PI) / 180, a1 = (-205 * Math.PI) / 180;
    const arc = [];
    for (let i = 0; i <= 26; i++) {
      const a = lerp(a0, a1, i / 26);
      arc.push(P(c.x + r * Math.cos(a), c.y + r * Math.sin(a)));
    }
    const arcStart = arc[0], arcEnd = arc[arc.length - 1];
    const hyoid = J(P(0.35, 5.85), 0.35);
    const travelEnd = P(Math.sin(a1), -Math.cos(a1));
    // the root runs down to the vallecula (just in front of the epiglottis), then to the hyoid
    const vallecula = P(hyoid.x - 0.62, hyoid.y - 0.3);
    const root = bezier(arcEnd, P(arcEnd.x + travelEnd.x * 0.9 - 0.15, arcEnd.y + travelEnd.y * 0.9),
      P(vallecula.x - 0.25, vallecula.y - 0.8), vallecula, 10).slice(1);
    root.push(P(lerp(vallecula.x, hyoid.x, 0.5), vallecula.y + 0.28), hyoid);
    const floor = [J(P(1.6, 5.15)), J(P(3.2, 4.35)), J(P(4.25, 3.45)), J(P(4.55, 3.0))];
    // tip
    const tipRest = J(P(4.45 - 0.75 * (1 - tx), 2.55 - 0.15 * ty));
    const tipHigh = J(P(4.72 - 0.25 * (1 - tx), 0.5), 0.15);
    const tip = lerpP(tipRest, tipHigh, clamp(s.tipUp, 0, 1));
    const travelStart = P(Math.sin(a0), -Math.cos(a0));
    const blade = bezier(tip,
      P(tip.x - 0.55, tip.y - 0.25 - 0.25 * s.tipUp),
      P(arcStart.x - travelStart.x * 1.1, arcStart.y - travelStart.y * 1.1),
      arcStart, 12).slice(1, -1);
    const tongue = [...arc, ...root, ...floor, tip, ...blade];

    // ---- lips ----
    const round = clamp(s.lipRound, 0, 1);
    const close = 1 - clamp(s.lipOpen, 0, 1);
    const upperLipBase = [
      [5.88, 0.95, 0.1], [5.98, 1.7, 0.4], [6.18, 2.12, 0.8], [6.62, 2.28, 1], [7.12, 2.3, 1],
      [7.4, 1.92, 1], [7.33, 1.4, 0.8], [7.07, 0.7, 0.35], [6.85, -0.15, 0], [6.1, -0.1, 0],
    ];
    const upperLip = upperLipBase.map(([x, y, w]) => P(x + w * 0.55 * round, y + w * (0.14 * close + 0.12 * round)));
    const upperStomion = upperLip[4];

    const lowerLipBase = [
      [5.72, 2.95, 0.3], [6.2, 2.58, 0.9], [6.7, 2.52, 1], [7.06, 2.52, 1], [7.33, 2.85, 1],
      [7.3, 3.15, 0.9], [6.8, 3.72, 0.3], [6.3, 3.8, 0.1], [5.82, 3.5, 0.1],
    ];
    const lowerJawed = lowerLipBase.map(([x, y]) => J(P(x, y)));
    // how far the lip needs to travel (upward) to meet the upper lip
    const naturalGap = lowerJawed[3].y - upperStomion.y;
    const roundGap = lerp(4, 0.55, round);
    const wantGap = Math.min(naturalGap * (1 - close), roundGap);
    const lift = naturalGap - wantGap + 0.22 * close * close;
    const lowerLip = lowerJawed.map((p, i) => {
      const w = lowerLipBase[i][2];
      return P(p.x + w * 0.5 * round, p.y - lift * w);
    });

    const lowerIncisor = [
      P(4.98, 2.7), P(5.14, 2.3), P(5.3, 2.04), P(5.5, 2.06), P(5.66, 2.55), P(5.68, 3.1), P(5.15, 3.25),
    ].map((p) => J(p));
    const symphysis = [
      P(5.1, 3.15), P(5.72, 3.08), P(6.25, 3.85), P(6.5, 4.7), P(6.22, 5.6), P(5.6, 5.95),
      P(4.9, 5.75), P(4.55, 5.0), P(4.6, 4.0),
    ].map((p) => J(p));
    const mandibleSide = spline([
      P(-2.0, -1.0), P(-2.4, 0.6), P(-2.35, 3.2), P(-1.7, 4.8), P(0.5, 5.25), P(3.5, 5.55),
      P(5.7, 5.95), P(6.5, 4.8), P(6.2, 3.6), P(5.6, 3.0), P(4.7, 3.3), P(3.0, 4.2),
      P(0.8, 4.3), P(-0.9, 3.5), P(-1.5, 1.6), P(-1.2, -0.4),
    ].map((p) => J(p)), true, 6);

    // ---- velum (soft palate) ----
    const v = clamp(s.velum, 0, 1);
    const pns = P(-0.05, 0.38);
    const vC1 = lerpP(P(-1.0, 0.05), P(-0.5, 0.95), v);
    const vC2 = lerpP(P(-1.85, 0.35), P(-0.85, 2.0), v);
    const uvula = lerpP(P(-1.85, 1.45), P(-0.85, 3.05), v);
    const vLine = bezier(pns, vC1, vC2, uvula, 18);
    const velumPoly = [];
    const vTop = [], vBot = [];
    for (let i = 0; i < vLine.length; i++) {
      const a = vLine[Math.max(0, i - 1)], b = vLine[Math.min(vLine.length - 1, i + 1)];
      let nx = b.y - a.y, ny = -(b.x - a.x);
      const l = Math.hypot(nx, ny) || 1; nx /= l; ny /= l;
      const t = i / (vLine.length - 1);
      const th = 0.52 * Math.sin(Math.PI * Math.min(1, t * 1.15 + 0.12)) + 0.04;
      // (nx,ny) points to the upper/posterior (nasal) side
      vTop.push(P(vLine[i].x + nx * th, vLine[i].y + ny * th));
      vBot.push(P(vLine[i].x - nx * th, vLine[i].y - ny * th));
    }
    velumPoly.push(...vTop, ...vBot.reverse());

    // ---- epiglottis (moves slightly with the hyoid) ----
    const eShift = P(hyoid.x - 0.35, hyoid.y - 5.85);
    const epiglottis = [
      P(-0.42, 6.95), P(-0.78, 5.85), P(-1.08, 4.95), P(-1.25, 4.5), P(-1.05, 4.58),
      P(-0.82, 5.3), P(-0.52, 6.0), P(-0.18, 6.6),
    ].map((p, i) => P(p.x + eShift.x * (i < 1 ? 0.2 : 0.8), p.y + eShift.y * (i < 1 ? 0.2 : 0.8)));

    // ---- measure the airway ----
    const inner = [
      { poly: tongue, closed: true, porous: 0 },
      { poly: lowerLip, closed: true, porous: 0 },
      { poly: lowerIncisor, closed: true, porous: 0.32 },
      { poly: epiglottis, closed: true, porous: 0 },
      { poly: LARYNX_FRONT, closed: false, porous: 0 },
    ];
    const outer = [
      { poly: POSTERIOR_WALL, closed: false, porous: 0 },
      { poly: velumPoly, closed: true, porous: 0 },
      { poly: PALATE_ORAL, closed: false, porous: 0 },
      { poly: UPPER_INCISOR, closed: true, porous: 0.32 },
      { poly: upperLip, closed: true, porous: 0 },
    ];

    const areas = new Float32Array(N_TRACT);
    const gaps = new Float32Array(N_TRACT);
    const rays = [];
    const hits = [];
    for (let i = 0; i < N_TRACT; i++) {
      const { c: o, n: d, frac } = SECTIONS[i];
      let innerT = -RAY_RANGE, innerPor = 0;
      for (const st of inner) {
        hits.length = 0;
        rayHits(o, d, st.poly, st.closed, hits);
        for (const t of hits) if (t > innerT) { innerT = t; innerPor = st.porous; }
      }
      let outerT = RAY_RANGE, outerPor = 0;
      for (const st of outer) {
        // below the nasal branch the throat is measured to the back wall; the hanging
        // velum there separates the mouth path from the nose path, it doesn't block it
        if (st.poly === velumPoly && i <= NOSE_JUNCTION) continue;
        hits.length = 0;
        rayHits(o, d, st.poly, st.closed, hits);
        for (const t of hits) if (t < outerT && t > innerT - 1.2) { outerT = t; outerPor = st.porous; }
      }
      let gap = clamp(outerT - innerT, 0, 3.0);
      gap = Math.max(gap, Math.max(innerPor, outerPor));
      gaps[i] = gap;

      // gap (cm) → area (cm²), A = α·d^β with region-specific constants
      let alpha, beta;
      if (frac < 0.12) { alpha = 1.9; beta = 1.4; }        // larynx
      else if (frac < 0.45) { alpha = 2.2; beta = 1.5; }   // pharynx
      else if (frac < 0.9) { alpha = 2.0; beta = 1.45; }   // oral cavity
      else { alpha = 3.6 * lerp(1, 0.3, round); beta = 1.2; } // lips
      areas[i] = gap <= 0.001 ? 0 : alpha * Math.pow(gap, beta);
      rays.push({ a: P(o.x + d.x * innerT, o.y + d.y * innerT), b: P(o.x + d.x * outerT, o.y + d.y * outerT), gap });
    }

    // nasal port: how far the velum hangs away from the throat wall
    const nasalPort = v < 0.04 ? 0 : 2.2 * Math.pow((v - 0.04) / 0.96, 1.3);

    return {
      tongue, tongueCenter: c, tongueTip: tip, upperLip, lowerLip, lowerIncisor, symphysis, mandibleSide,
      velum: velumPoly, uvula, epiglottis, hyoid, rays, areas, gaps, nasalPort,
      jawPoint: (p, w) => J(p, w),
      upperStomion, lowerStomion: lowerLip[3],
    };
  }

  // Inverse helpers used when dragging handles on the diagram.
  function tongueFromPoint(s, p) {
    const jd = jawDisplacement(s.jaw);
    const x = p.x - jd.x * 0.3, y = p.y - jd.y * 0.6;
    return {
      tongueX: clamp((x - TONGUE_X0) / (TONGUE_X1 - TONGUE_X0), 0, 1),
      tongueY: clamp((TONGUE_Y0 - y) / (TONGUE_Y0 - TONGUE_Y1), 0, 1),
    };
  }

  root.Anatomy = {
    N_TRACT, NOSE_JUNCTION, TRACT_LENGTH, SECTIONS, MID_BOUNDS, PIVOT, MAX_JAW,
    POSTERIOR_WALL, PALATE_ORAL, UPPER_INCISOR, LARYNX_FRONT,
    defaultState, build, tongueFromPoint,
    util: { P, lerp, lerpP, clamp, rotate, spline, bezier, resample },
  };
})(typeof window !== 'undefined' ? window : globalThis);
