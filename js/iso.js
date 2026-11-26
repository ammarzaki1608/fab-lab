/* iso.js — hand-drawn isometric illustrations for Fab Lab.
 * No dependencies, no images: every figure is drawn on canvas from a few primitives
 * (jittered lines, cream faces, coral hatch). Deterministic: the same figure always
 * looks the same, because the jitter is seeded from the figure name.
 */
(function (root) {
  'use strict';

  /* Colours are read from the stylesheet's custom properties, so switching the page tone
   * repaints the illustrations too. Fallbacks keep the module usable in Node (tests). */
  let INK = '#10202A', PAPER = '#FFFFFF', PAPER2 = '#E9F0F4', GRID = '#E6EEF2',
    CORAL = '#0E7C86', CORAL_SOFT = '#C7E6E7', MUTED = '#5F7382', LINE = '#D7E2E9',
    DIE = '#E8EFF3', DIE_EDGE = '#D2DEE6', LAYERS = ['#E4EDF2', '#C7E6E7', '#DCE7EC', '#A9D6D8', '#BFDAE6'];
  let tokenKey = null;

  function cssVar(name, fallback) {
    try {
      const cs = root.getComputedStyle(root.document.documentElement);
      const v = cs.getPropertyValue(name).trim();
      return v || fallback;
    } catch (e) { return fallback; }                 // no DOM (node tests)
  }

  function readTokens(force) {
    const tone = (root.document && root.document.documentElement.getAttribute('data-tone')) || 'cleanroom';
    if (!force && tone === tokenKey) return;
    tokenKey = tone;
    INK = cssVar('--ink', INK); PAPER = cssVar('--panel', PAPER);
    PAPER2 = cssVar('--paper2', PAPER2); GRID = cssVar('--grid', GRID);
    CORAL = cssVar('--accent', CORAL); CORAL_SOFT = cssVar('--accent-soft', CORAL_SOFT);
    MUTED = cssVar('--muted', MUTED); LINE = cssVar('--line', LINE);
    DIE = cssVar('--die', DIE); DIE_EDGE = cssVar('--die-edge', DIE_EDGE);
    LAYERS = [1, 2, 3, 4, 5].map((i) => cssVar('--layer-' + i, LAYERS[i - 1]));
  }

  // a tone change invalidates the cache; the UI calls this before redrawing
  function refresh() { readTokens(true); }

  const SANS = 'ui-sans-serif, "Segoe UI", system-ui, -apple-system, Arial, sans-serif';
  const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const hash = s => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };

  // ---------- primitives ----------
  function jline(ctx, rng, x1, y1, x2, y2, jitter = 0.7, segs = 3) {
    const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len, ny = dx / len;
    ctx.beginPath(); ctx.moveTo(x1, y1);
    for (let i = 1; i <= segs; i++) {
      const t = i / segs, off = i === segs ? 0 : (rng() - 0.5) * 2 * jitter;
      ctx.lineTo(x1 + dx * t + nx * off, y1 + dy * t + ny * off);
    }
    ctx.stroke();
  }
  const path = (ctx, pts) => { ctx.beginPath(); pts.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])); ctx.closePath(); };

  function hatch(ctx, pts, gap = 7) {
    // diagonal coral stripes clipped to a face: the signature of the reference style
    ctx.save(); path(ctx, pts); ctx.clip();
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    pts.forEach(([x, y]) => { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); });
    ctx.strokeStyle = CORAL; ctx.lineWidth = 1.4; ctx.globalAlpha = 0.75;
    for (let x = minX - (maxY - minY); x < maxX; x += gap) {
      ctx.beginPath(); ctx.moveTo(x, maxY); ctx.lineTo(x + (maxY - minY), minY); ctx.stroke();
    }
    ctx.restore();
  }

  // wrap a line of text to a pixel width (labels must fit narrow canvases too)
  function wrap(ctx, text, maxW) {
    if (!maxW) return [text];
    const words = String(text).split(' '), lines = [];
    let cur = '';
    words.forEach(wd => {
      const next = cur ? cur + ' ' + wd : wd;
      if (ctx.measureText(next).width > maxW && cur) { lines.push(cur); cur = wd; } else cur = next;
    });
    if (cur) lines.push(cur);
    return lines;
  }

  function label(ctx, x, y, main, sub, opts = {}) {
    if (main == null) return;              // a missing label is not an error
    main = String(main); if (sub != null) sub = String(sub);
    ctx.save();
    ctx.textAlign = opts.align || 'center';
    const maxW = opts.maxW ? opts.maxW : 0;
    ctx.fillStyle = opts.color || INK;
    ctx.font = `${opts.weight || 700} ${opts.size || 13}px ${opts.mono ? MONO : SANS}`;
    const mainLines = wrap(ctx, main, maxW);
    mainLines.forEach((line, i) => ctx.fillText(line, x, y - (mainLines.length - 1 - i) * 15));
    if (sub) {
      ctx.fillStyle = MUTED; ctx.font = `500 10.5px ${SANS}`;
      wrap(ctx, sub, maxW).forEach((line, i) => ctx.fillText(line, x, y + 14 + i * 13));
    }
    ctx.restore();
  }

  function pill(ctx, x, y, text, opts = {}) {
    ctx.save();
    ctx.font = `700 11px ${SANS}`;
    const w = ctx.measureText(text).width + 18, h = 22;
    ctx.fillStyle = opts.bg || INK;
    roundRect(ctx, x - w / 2, y - h / 2, w, h, h / 2); ctx.fill();
    ctx.fillStyle = opts.fg || '#FFFBF6'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, x, y + 0.5);
    ctx.restore();
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  // isometric projection: unit cube -> screen
  const U = (x, y, z) => [(x - y) * 0.866, (x + y) * 0.5 - z];

  /* Fit any set of 3D points into the canvas.
   * Hand-placed origins are how isometric diagrams end up spilling off the edge: the
   * extents depend on how many layers or blocks you draw. So measure first, then scale. */
  function frameFor(w, h, pts, pad) {
    pad = Object.assign({ x: 24, y: 24, l: 24, r: 24, t: 24, b: 24 }, pad || {});
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    pts.forEach(([x, y, z]) => {
      const [sx, sy] = U(x, y, z);
      minX = Math.min(minX, sx); maxX = Math.max(maxX, sx);
      minY = Math.min(minY, sy); maxY = Math.max(maxY, sy);
    });
    const bw = Math.max(0.001, maxX - minX), bh = Math.max(0.001, maxY - minY);
    const availW = w - pad.l - pad.r, availH = h - pad.t - pad.b;
    const S = Math.min(availW / bw, availH / bh);
    const ox = pad.l + (availW - bw * S) / 2 - minX * S;
    const oy = pad.t + (availH - bh * S) / 2 - minY * S;
    return { S, P: (x, y, z) => { const [sx, sy] = U(x, y, z); return [ox + sx * S, oy + sy * S]; } };
  }
  // the eight corners of a box, for framing
  const corners = (x0, y0, z0, w, d, h) => [[x0, y0, z0], [x0 + w, y0, z0], [x0, y0 + d, z0], [x0 + w, y0 + d, z0],
    [x0, y0, z0 + h], [x0 + w, y0, z0 + h], [x0, y0 + d, z0 + h], [x0 + w, y0 + d, z0 + h]];

  function box(ctx, rng, P, x0, y0, w, d, z0, h, o = {}) {
    const top = [P(x0, y0, z0 + h), P(x0 + w, y0, z0 + h), P(x0 + w, y0 + d, z0 + h), P(x0, y0 + d, z0 + h)];
    const left = [P(x0, y0 + d, z0), P(x0 + w, y0 + d, z0), P(x0 + w, y0 + d, z0 + h), P(x0, y0 + d, z0 + h)];
    const right = [P(x0 + w, y0, z0), P(x0 + w, y0 + d, z0), P(x0 + w, y0 + d, z0 + h), P(x0 + w, y0, z0 + h)];
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.fillStyle = o.side || PAPER2; path(ctx, left); ctx.fill();
    if (o.hatch !== false) hatch(ctx, left, o.gap || 8);
    ctx.fillStyle = o.face || PAPER; path(ctx, right); ctx.fill();
    ctx.fillStyle = o.top || PAPER; path(ctx, top); ctx.fill();
    ctx.strokeStyle = o.stroke || INK; ctx.lineWidth = o.lw || 1.7;
    [top, left, right].forEach(f => {
      ctx.beginPath();
      f.forEach((p, i) => { if (i) jline(ctx, rng, f[i - 1][0], f[i - 1][1], p[0], p[1], 0.5); else ctx.moveTo(p[0], p[1]); });
    });
  }

  function grid(ctx, w, h) {
    ctx.save(); ctx.strokeStyle = GRID; ctx.lineWidth = 1;
    for (let x = 0; x < w; x += 26) { ctx.beginPath(); ctx.moveTo(x + .5, 0); ctx.lineTo(x + .5, h); ctx.stroke(); }
    for (let y = 0; y < h; y += 26) { ctx.beginPath(); ctx.moveTo(0, y + .5); ctx.lineTo(w, y + .5); ctx.stroke(); }
    ctx.restore();
  }

  // ---------- figures ----------
  const FIG = {};

  // piles of cubes, like a step-count diagram: count grows, shape stays the same
  FIG.pile = (ctx, w, h, o = {}) => {
    readTokens();
    const rng = mulberry32(hash('pile'));
    const stacks = o.stacks || [{ n: 1, label: '1 lot' }, { n: 2, label: '2' }, { n: 3, label: '3' }, { n: 4, label: '4' }];
    const meta = (o.meta || [{ label: 'process time', sub: '6 h' }, { label: 'queue', sub: '+1 h' }, { label: 'queue', sub: '+9 h' }, { label: 'cycle time', sub: 'weeks' }]);
    const pts = [];
    stacks.forEach((st, i) => { pts.push(...corners(i * 1.9, -i * 1.15, 0, 1, 1, Math.max(1, st.n))); });
    const F = frameFor(w, h, pts, { l: 26, r: 26, t: 16, b: 54 });
    stacks.forEach((st, i) => {
      const bx = i * 1.9, by = -i * 1.15;
      for (let z = 0; z < st.n; z++) box(ctx, rng, F.P, bx, by, 1, 1, z, 1, { gap: 6 });
      const base = F.P(bx + 0.5, by + 1, 0);
      label(ctx, base[0], h - 30, meta[i] ? meta[i].label : '', meta[i] ? meta[i].sub : '', { size: 12 });
    });
  };

  // tools along the AMHS rail, with FOUPs riding above them
  FIG.flow = (ctx, w, h, o = {}) => {
    readTokens();
    const rng = mulberry32(hash('flow'));
    const bays = o.bays || ['LITHO', 'ETCH', 'IMPL', 'CVD', 'CMP'];
    const n = bays.length, railY = 2.0;
    const pts = [];
    bays.forEach((_, i) => { pts.push(...corners(i * 1.75, 0, 0, 1.25, 1.1, 1.5)); });
    pts.push([-0.3, railY, 2.75], [n * 1.75 - 0.5, railY, 2.75]);
    const F = frameFor(w, h, pts, { l: 24, r: 24, t: 16, b: 52 });
    const a = F.P(-0.3, railY, 2.45), b = F.P(n * 1.75 - 0.5, railY, 2.45);
    ctx.strokeStyle = LINE; ctx.lineWidth = 5; ctx.lineCap = 'round';
    jline(ctx, rng, a[0], a[1], b[0], b[1], 0.5, 2);
    bays.forEach((name, i) => {
      const bx = i * 1.75;
      box(ctx, rng, F.P, bx, 0, 1.25, 1.1, 0, 1.5, { gap: 7 });
      if (i < n - 1) {
        const f = F.P(bx + 1.35, railY, 2.45);
        ctx.fillStyle = PAPER; ctx.strokeStyle = INK; ctx.lineWidth = 1.4;
        roundRect(ctx, f[0] - 8, f[1] - 10, 16, 10, 2); ctx.fill(); ctx.stroke();
      }
      const p = F.P(bx + 0.6, 1.1, 0);
      label(ctx, p[0], h - 26, name, null, { size: 10.5 });
    });
    if (o.caption) label(ctx, w / 2, 20, o.caption, null, { size: 11, weight: 500, color: MUTED });
  };

  // a wafer map: dies in a circular grid, an edge-ring signature in coral
  FIG.wafer = (ctx, w, h) => {
    readTokens();
    const rng = mulberry32(hash('wafer'));
    const R = Math.min(w * 0.30, h * 0.40), cx = w / 2, cy = h / 2 - 8;
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, 7); ctx.fillStyle = PAPER; ctx.fill();
    ctx.strokeStyle = INK; ctx.lineWidth = 1.8; ctx.stroke();
    const G = 13, cell = (R * 2) / G;
    for (let i = 0; i < G; i++) for (let j = 0; j < G; j++) {
      const x = cx - R + (i + 0.5) * cell, y = cy - R + (j + 0.5) * cell;
      if (Math.hypot(x - cx, y - cy) > R - cell * 0.45) continue;
      const r = Math.hypot(x - cx, y - cy) / R;
      const edge = r > 0.78 && rng() < 0.72;
      const scatter = rng() < 0.05;
      ctx.fillStyle = edge || scatter ? CORAL_SOFT : DIE;
      ctx.strokeStyle = DIE_EDGE; ctx.lineWidth = 1;
      ctx.fillRect(x - cell * 0.42, y - cell * 0.42, cell * 0.84, cell * 0.84);
      if (edge || scatter) { ctx.strokeStyle = CORAL; ctx.strokeRect(x - cell * 0.42, y - cell * 0.42, cell * 0.84, cell * 0.84); }
    }
    ctx.restore();
    label(ctx, cx, cy + R + 22, 'edge-ring signature', 'radial CD or thickness non-uniformity', { maxW: w - 40 });
  };

  // twin chambers, the left one faulted
  FIG.twins = (ctx, w, h, o = {}) => {
    readTokens();
    const rng = mulberry32(hash('twins'));
    const pts = [...corners(0, 0, 0, 1.6, 1.5, 1.8), ...corners(2.7, 0, 0, 1.6, 1.5, 1.8)];
    const F = frameFor(w, h, pts, { l: 30, r: 30, t: 20, b: 56 });
    box(ctx, rng, F.P, 0, 0, 1.6, 1.5, 0, 1.8, { gap: 7 });
    box(ctx, rng, F.P, 2.7, 0, 1.6, 1.5, 0, 1.8, { gap: 7 });
    const a = F.P(0.8, 1.5, 0), b = F.P(3.5, 1.5, 0);
    label(ctx, a[0], h - 32, o.aLabel || 'ETCH-03A', o.aSub || 'drifts with RF hours');
    label(ctx, b[0], h - 32, o.bLabel || 'ETCH-03B', o.bSub || 'held at baseline');
    ctx.save(); ctx.strokeStyle = CORAL; ctx.lineWidth = 2.2; ctx.setLineDash([6, 4]);
    const t = [F.P(0, 0, 1.86), F.P(1.6, 0, 1.86), F.P(1.6, 1.5, 1.86), F.P(0, 1.5, 1.86)];
    ctx.beginPath(); t.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])); ctx.closePath(); ctx.stroke();
    ctx.restore();
    if (o.caption) label(ctx, w / 2, 20, o.caption, null, { size: 11, weight: 500, color: MUTED });
  };

  // a cross-section stack with labels in a clean right-hand column
  FIG.layers = (ctx, w, h) => {
    readTokens();
    const rng = mulberry32(hash('layers'));
    const rows = [
      { t: 1.45, face: LAYERS[0], name: 'Si substrate', note: 'the wafer' },
      { t: 0.34, face: LAYERS[1], name: 'SiO₂', note: 'oxidation · 10 nm' },
      { t: 0.48, face: LAYERS[2], name: 'poly-Si gate', note: 'litho + etch · 80 nm' },
      { t: 0.30, face: LAYERS[3], name: 'ILD', note: 'PECVD · 500 nm' },
      { t: 0.42, face: LAYERS[4], name: 'metal 1', note: 'PVD · contacts' },
    ];
    const W = 2.6, D = 2.6, gap = 0.06;
    const zTot = rows.reduce((n, r) => n + r.t + gap, 0);
    const F = frameFor(w, h, corners(0, 0, 0, W, D, zTot), { l: 24, r: Math.min(w * 0.42, 240), t: 20, b: 30 });
    let z = 0;
    const labelX = w - Math.min(w * 0.40, 226);
    rows.forEach((r, i) => {
      box(ctx, rng, F.P, 0, 0, W, D, z, r.t, { face: r.face, top: i === rows.length - 1 ? PAPER2 : r.face, side: LAYERS[0], gap: 9 });
      const anchor = F.P(W, 0, z + r.t / 2);
      ctx.save();
      ctx.strokeStyle = LINE; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(anchor[0], anchor[1]); ctx.lineTo(labelX - 10, anchor[1]); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = INK; ctx.font = `700 12px ${SANS}`; ctx.textAlign = 'left';
      ctx.fillText(r.name, labelX, anchor[1] - 1);
      ctx.fillStyle = MUTED; ctx.font = `500 10.5px ${SANS}`;
      ctx.fillText(r.note, labelX, anchor[1] + 12);
      ctx.restore();
      z += r.t + gap;
    });
  };

  // SPC control chart: limits, points, a late drift, one excursion
  FIG.chart = (ctx, w, h) => {
    readTokens();
    const rng = mulberry32(hash('chart'));
    const x0 = 52, x1 = w - 22, y0 = 26, y1 = h - 44;
    const lo = 88, hi = 98;
    const yOf = v => y1 - (v - lo) / (hi - lo) * (y1 - y0);
    ctx.strokeStyle = '#DCCFC0'; ctx.lineWidth = 1.2;
    jline(ctx, rng, x0, y1, x1, y1, 0.4, 2);
    jline(ctx, rng, x0, y1, x0, y0, 0.4, 2);
    ctx.setLineDash([5, 4]); ctx.strokeStyle = CORAL; ctx.lineWidth = 1.4;
    [94, 90].forEach(v => jline(ctx, rng, x0, yOf(v), x1, yOf(v), 0.4, 2));
    ctx.setLineDash([]); ctx.strokeStyle = LINE;
    jline(ctx, rng, x0, yOf(92), x1, yOf(92), 0.4, 2);
    ctx.save(); ctx.font = `600 10px ${SANS}`; ctx.fillStyle = MUTED; ctx.textAlign = 'right';
    [['UCL', 94], ['CL', 92], ['LCL', 90]].forEach(([name, v]) => ctx.fillText(name, x0 - 7, yOf(v) + 3));
    ctx.restore();
    const n = 26; let v = 92; let prev = null;
    for (let i = 0; i < n; i++) {
      v += (rng() - 0.5) * 0.45 + (i > 15 ? 0.16 : 0);
      v = Math.max(86, Math.min(97, v));
      const px = x0 + (x1 - x0) * (i / (n - 1)), py = yOf(v);
      if (prev) { ctx.strokeStyle = MUTED; ctx.globalAlpha = 0.55; ctx.lineWidth = 1.1; ctx.beginPath(); ctx.moveTo(prev[0], prev[1]); ctx.lineTo(px, py); ctx.stroke(); }
      const ooc = v > 94;
      ctx.beginPath(); ctx.arc(px, py, ooc ? 4 : 2.8, 0, 7);
      ctx.fillStyle = ooc ? CORAL : INK; ctx.fill();
      prev = [px, py];
    }
    label(ctx, (x0 + x1) / 2, h - 12, 'FI CD, nm · lot sequence →', null, { size: 11, weight: 500, color: MUTED });
  };

  // one FOUP, with the wafers visible inside
  FIG.foup = (ctx, w, h) => {
    readTokens();
    const rng = mulberry32(hash('foup'));
    const W = 1.7, D = 1.7, H = 2.2;
    const F = frameFor(w, h, corners(0, 0, 0, W, D, H), { l: 30, r: 30, t: 20, b: 62 });
    box(ctx, rng, F.P, 0, 0, W, D, 0, 0.16, { gap: 8 });
    for (let i = 0; i < 8; i++) {
      const z = 0.26 + i * 0.21;
      const a = F.P(0.08, 0.08, z), b = F.P(W - 0.08, D - 0.08, z);
      ctx.save(); ctx.strokeStyle = i % 3 === 0 ? CORAL : LINE; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); ctx.restore();
    }
    box(ctx, rng, F.P, 0, 0, W, D, H - 0.14, 0.14, { gap: 8 });
    label(ctx, w / 2, h - 38, 'one FOUP = 25 wafers', 'the lot is never unpacked — only the wafers move inside the tool', { size: 12, maxW: w - 40 });
  };

  // six phases of one product's life, as a staircase. Two steps are hatched: the two jobs.
  FIG.phases = (ctx, w, h, o = {}) => {
    readTokens();
    const rng = mulberry32(hash('phases'));
    const names = o.names || ['DESIGN', 'BRING-UP', 'CHARACTERISE', 'PRODUCTION', 'RAMP', 'RETURNS'];
    const subs = o.subs || ['RTL · DFT', 'first silicon', 'shmoo', 'test program', 'yield', 'RMA · FA'];
    const flags = o.flags || { 1: 'GRADUATE ROLE', 3: 'PRODUCTION ROLE' };
    const n = names.length;
    const pts = [];
    for (let i = 0; i < n; i++) pts.push(...corners(i * 1.72, 0, 0, 1.15, 1.15, 0.42 + i * 0.26));
    const F = frameFor(w, h, pts, { l: 24, r: 24, t: 40, b: 70 });
    for (let i = 0; i < n; i++) {
      const hgt = 0.42 + i * 0.26, bx = i * 1.72;
      const hot = flags[i] != null;
      box(ctx, rng, F.P, bx, 0, 1.15, 1.15, 0, hgt, {
        top: hot ? CORAL_SOFT : PAPER, face: hot ? '#FFFFFF' : PAPER, side: PAPER2, gap: 9,
      });
      const top = F.P(bx + 0.57, 0.57, hgt);
      if (hot) {
        ctx.save(); ctx.strokeStyle = CORAL; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(top[0], top[1] - 16, 12, 0, 7); ctx.stroke();
        ctx.fillStyle = CORAL; ctx.beginPath(); ctx.arc(top[0], top[1] - 16, 3.2, 0, 7); ctx.fill();
        ctx.restore();
        label(ctx, top[0], top[1] - 34, flags[i], null, { size: 9.5, color: CORAL, weight: 800 });
      }
      const base = F.P(bx + 0.57, 1.15, 0);
      /* two staggered rows: six labels across one row would run into each other */
      label(ctx, base[0], h - (i % 2 ? 38 : 54), names[i], subs[i], { size: 9, maxW: 84, weight: 700 });
    }
    label(ctx, w / 2, h - 8, 'one product, six phases — the same building, different jobs', null, { size: 10.5, weight: 500, color: MUTED, maxW: w - 30 });
  };

  // an ATE: rack, probe card, 5-site wafer touch, and the data it leaves behind
  FIG.tester = (ctx, w, h, o = {}) => {
    readTokens();
    const rng = mulberry32(hash('tester'));
    const pts = [
      ...corners(0, 0, 0, 1.15, 1.15, 2.5),          // rack
      ...corners(1.85, 0.35, 0, 1.75, 1.75, 0.62),   // stage
      ...corners(2.15, 0.65, 1.5, 1.15, 1.15, 0.16), // probe card
      ...corners(4.55, 0.55, 0, 1.1, 1.1, 0.8),      // data box
    ];
    const F = frameFor(w, h, pts, { l: 30, r: 26, t: 22, b: 56 });
    // rack with slots
    box(ctx, rng, F.P, 0, 0, 1.15, 1.15, 0, 2.5, { top: PAPER, gap: 10 });
    for (let i = 0; i < 6; i++) {
      const z = 0.28 + i * 0.34;
      const a = F.P(1.15, 0.12, z), b = F.P(1.15, 1.03, z);
      ctx.strokeStyle = LINE; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
    }
    // stage and wafer
    box(ctx, rng, F.P, 1.85, 0.35, 1.75, 1.75, 0, 0.55, { top: PAPER2, hatch: false });
    box(ctx, rng, F.P, 1.95, 0.45, 1.55, 1.55, 0.55, 0.07, { top: DIE, hatch: false });
    // 5 sites touching 5 dies
    const SITES5 = [[0.5, 0.5], [0.5, 0.12], [0.5, 0.88], [0.12, 0.5], [0.88, 0.5]];
    SITES5.forEach(([sx, sy]) => {
      const p = F.P(1.95 + sx * 1.55, 0.45 + sy * 1.55, 0.62);
      ctx.fillStyle = CORAL; ctx.beginPath(); ctx.arc(p[0], p[1], 3.4, 0, 7); ctx.fill();
      ctx.strokeStyle = CORAL; ctx.globalAlpha = .5; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(p[0], p[1], 7, 0, 7); ctx.stroke(); ctx.globalAlpha = 1;
    });
    // probe card above, with needles
    box(ctx, rng, F.P, 2.15, 0.65, 1.15, 1.15, 1.5, 0.16, { top: CORAL_SOFT, gap: 6 });
    SITES5.forEach(([sx, sy]) => {
      const a = F.P(2.15 + 0.25 + sx * 0.65, 0.65 + 0.25 + sy * 0.65, 1.5);
      const b = F.P(1.95 + sx * 1.55, 0.45 + sy * 1.55, 0.68);
      ctx.strokeStyle = MUTED; ctx.lineWidth = 1; ctx.setLineDash([2, 3]);
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); ctx.setLineDash([]);
    });
    box(ctx, rng, F.P, 4.55, 0.55, 1.1, 1.1, 0, 0.8, { top: PAPER, gap: 8 });
    // cable, drawn after the box so it visibly plugs into its left face
    const c1 = F.P(1.15, 0.6, 1.9), c2 = F.P(4.55, 1.1, 0.42);
    const kneeX = c1[0] + 26, kneeY = c2[1] - 10;
    ctx.strokeStyle = CORAL; ctx.lineWidth = 1.6;
    jline(ctx, rng, c1[0], c1[1], kneeX, kneeY, 1.2, 4);
    jline(ctx, rng, kneeX, kneeY, c2[0], c2[1], 1.2, 4);
    ctx.fillStyle = CORAL; ctx.beginPath(); ctx.arc(c2[0], c2[1], 2.6, 0, 7); ctx.fill();
    const rkTop = F.P(0.57, 0.57, 2.5);
    label(ctx, rkTop[0], rkTop[1] - 12, 'ATE', 'tester + test program', { size: 11, maxW: 110 });
    const dbTop = F.P(5.1, 0.55, 0.8);
    label(ctx, dbTop[0], dbTop[1] - 26, 'test data', 'STDF → data lake', { size: 10.5, maxW: 96 });
    label(ctx, w / 2, h - 8, '5 sites touch 5 dies at once — 188 dies is 38 touches, not 188', null, { size: 10.5, weight: 500, color: MUTED, maxW: w - 30 });
  };

  // shmoo: one test, swept over voltage x frequency. The pass/fail edge is the product.
  FIG.shmoo = (ctx, w, h, o = {}) => {
    readTokens();
    const rng = mulberry32(hash('shmoo'));
    const L = 58, R = w - 24, T = 22, B = h - 46;
    const cols = 14, rows = 9;
    const cw = (R - L) / cols, ch = (B - T) / rows;
    const fmax = v => 250 + 700 * Math.pow((v - 0.75) / 0.30, 0.62);   // MHz at that Vdd
    for (let c = 0; c < cols; c++) {
      const v = 0.75 + (c + 0.5) / cols * 0.30;
      for (let r = 0; r < rows; r++) {
        /* canvas y grows downward, so the highest frequency is drawn on the top row */
        const f = 900 - (r + 0.5) / rows * 600;
        const x = L + c * cw, y = T + r * ch;
        const pass = f < fmax(v) * (1 + (rng() - 0.5) * 0.03);
        const cell = [[x, y], [x + cw, y], [x + cw, y + ch], [x, y + ch]];
        ctx.fillStyle = pass ? PAPER : '#FFFFFF';
        path(ctx, cell); ctx.fill();
        if (pass) { ctx.strokeStyle = LINE; ctx.lineWidth = 1; path(ctx, cell); ctx.stroke(); }
        else hatch(ctx, cell, 5);
        if (!pass) { ctx.strokeStyle = CORAL; ctx.lineWidth = .8; ctx.globalAlpha = .5; path(ctx, cell); ctx.stroke(); ctx.globalAlpha = 1; }
      }
    }
    // shipping window
    ctx.save(); ctx.setLineDash([6, 4]); ctx.strokeStyle = INK; ctx.lineWidth = 1.6;
    ctx.strokeRect(L + cw * 7, T + ch * 1, cw * 6, ch * 5); ctx.restore();
    label(ctx, L + cw * 10, T + ch * 1 + 14, 'shipping window', 'guardbanded, not the edge', { size: 10, maxW: 120 });
    // axes
    ctx.strokeStyle = INK; ctx.lineWidth = 1.4;
    jline(ctx, rng, L, B, R, B, .3, 2); jline(ctx, rng, L, B, L, T, .3, 2);
    ctx.fillStyle = MUTED; ctx.font = `600 9.5px ${SANS}`; ctx.textAlign = 'center';
    for (let c = 0; c <= cols; c += 3.5) ctx.fillText((0.75 + c / cols * 0.30).toFixed(2), L + c * cw, B + 14);
    ctx.textAlign = 'right';
    for (let r = 0; r <= rows; r += 3) ctx.fillText((900 - r / rows * 600).toFixed(0), L - 6, T + r * ch + 4);
    label(ctx, (L + R) / 2, h - 22, 'Vdd, V →', null, { size: 10, weight: 600, color: INK });
    label(ctx, 8, T - 9, 'MHz ↑', null, { size: 9.5, weight: 600, color: INK, align: 'left' });
    /* legend: the two cell styles are the whole message */
    const ly = h - 22;
    ctx.fillStyle = PAPER; path(ctx, [[R - 132, ly - 8], [R - 118, ly - 8], [R - 118, ly + 4], [R - 132, ly + 4]]); ctx.fill();
    ctx.strokeStyle = LINE; ctx.lineWidth = 1; path(ctx, [[R - 132, ly - 8], [R - 118, ly - 8], [R - 118, ly + 4], [R - 132, ly + 4]]); ctx.stroke();
    label(ctx, R - 112, ly - 1, 'passes', null, { size: 9.5, color: MUTED, align: 'left' });
    hatch(ctx, [[R - 66, ly - 8], [R - 52, ly - 8], [R - 52, ly + 4], [R - 66, ly + 4]], 4);
    label(ctx, R - 46, ly - 1, 'fails', null, { size: 9.5, color: MUTED, align: 'left' });
  };

  function draw(canvas, kind, opts = {}) {
    const dpr = Math.min(2, root.devicePixelRatio || 1);
    // never trust a zero-sized layout (hidden pane, headless browser): fall back to the parent
    const rect = canvas.getBoundingClientRect ? canvas.getBoundingClientRect() : { width: 0, height: 0 };
    let w = Math.round(rect.width || canvas.clientWidth || 0);
    let h = Math.round(rect.height || canvas.clientHeight || 0);
    if (w < 60) w = (canvas.parentElement && canvas.parentElement.clientWidth) || 640;
    if (h < 60) h = 384;
    w = Math.max(240, w); h = Math.max(180, h);
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = PAPER; ctx.fillRect(0, 0, w, h);
    grid(ctx, w, h);
    (FIG[kind] || FIG.wafer)(ctx, w, h, opts);
    return canvas;
  }

  root.Iso = { draw, FIG, label, pill, refresh, readTokens,
    get INK() { return INK; }, get CORAL() { return CORAL; }, get MUTED() { return MUTED; }, get PAPER() { return PAPER; }, SANS, MONO };
})(typeof window !== 'undefined' ? window : globalThis);
