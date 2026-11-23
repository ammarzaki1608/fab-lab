/* Fab floor — a physical view of the same simulation.
 *
 * sim.js models what happens (state, timing, yield). This file only decides where
 * a FOUP is on the floor and how a machine looks while it works: an isometric bay
 * layout, an overhead rail (AMHS), and the inside of a tool as a sequence of
 * phases (load port -> load lock -> transfer chamber -> process chamber).
 *
 * No simulation state is modified here, so every number in the other tabs stays
 * authoritative. Pure geometry + a canvas draw call: runs in Node for tests.
 */
(function (root) {
  'use strict';

  // ---------------- floor plan ----------------
  // World units: x right, y away from the viewer. The rail runs along SPINE_Y.
  const SPINE_Y = 4.0;
  const FLOOR = { w: 15.6, d: 8.0 };
  const ROWS = { north: 1.5, south: 6.5 };

  // kind drives the silhouette on the floor and the cutaway phases.
  const BAYS = [
    { name: 'SORTER-01', step: 'START',  area: 'Fab control', kind: 'sorter',     x: 1.7,  y: ROWS.north, w: 2.0, d: 1.4, h: 0.55 },
    { name: 'FURN-01',   step: 'OX',     area: 'Diffusion',   kind: 'furnace',    x: 4.1,  y: ROWS.north, w: 2.2, d: 1.4, h: 0.95 },
    { name: 'SCAN-02',   step: 'LITHO',  area: 'Litho',       kind: 'scanner',    x: 6.7,  y: ROWS.north, w: 2.4, d: 1.4, h: 0.80 },
    { name: 'ETCH-03A',  step: 'ETCH',   area: 'Etch',        kind: 'cluster',    x: 9.4,  y: ROWS.north, w: 1.6, d: 1.4, h: 0.75 },
    { name: 'ETCH-03B',  step: 'ETCH',   area: 'Etch',        kind: 'cluster',    x: 11.4, y: ROWS.north, w: 1.6, d: 1.4, h: 0.75 },
    { name: 'IMP-01',    step: 'IMPL',   area: 'Implant',     kind: 'implanter',  x: 13.6, y: ROWS.north, w: 2.0, d: 1.4, h: 0.85 },

    { name: 'RTP-01',    step: 'ANNEAL', area: 'Diffusion',   kind: 'rtp',        x: 2.0,  y: ROWS.south, w: 1.8, d: 1.4, h: 0.65 },
    { name: 'PECVD-02A', step: 'CVD',    area: 'Deposition',  kind: 'cluster',    x: 4.2,  y: ROWS.south, w: 1.6, d: 1.4, h: 0.75 },
    { name: 'PECVD-02B', step: 'CVD',    area: 'Deposition',  kind: 'cluster',    x: 6.2,  y: ROWS.south, w: 1.6, d: 1.4, h: 0.75 },
    { name: 'CMP-01A',   step: 'CMP',    area: 'CMP',         kind: 'cmp',        x: 8.2,  y: ROWS.south, w: 1.8, d: 1.4, h: 0.60 },
    { name: 'CMP-01B',   step: 'CMP',    area: 'CMP',         kind: 'polisher',   x: 10.2, y: ROWS.south, w: 1.7, d: 1.4, h: 0.60 },
    { name: 'PVD-01',    step: 'METAL',  area: 'Deposition',  kind: 'cluster',    x: 12.2, y: ROWS.south, w: 1.7, d: 1.4, h: 0.75 },
    { name: 'TEST-01',   step: 'SORT',   area: 'Test',        kind: 'tester',     x: 14.2, y: ROWS.south, w: 1.6, d: 1.4, h: 0.65 },
  ];

  const STOCKERS = [{ x: 0.5, y: SPINE_Y, name: 'STOCKER A' }, { x: 15.0, y: SPINE_Y, name: 'STOCKER B' }];

  // The inside of each machine, as fractions of the process time. A labelled
  // abstraction of a real sequence — the sim does not model gas flow or plasmas.
  const PHASES = {
    cluster:   [{ t: 'Load port', f: 0.10 }, { t: 'Load lock · pump', f: 0.12 }, { t: 'Transfer robot', f: 0.08 }, { t: 'Process chamber', f: 0.55 }, { t: 'Vent · unload', f: 0.15 }],
    furnace:   [{ t: 'Load port', f: 0.08 }, { t: 'Boat load', f: 0.17 }, { t: 'Ramp to setpoint', f: 0.15 }, { t: 'Soak · oxidation', f: 0.40 }, { t: 'Cool · unload', f: 0.20 }],
    scanner:   [{ t: 'Track · coat', f: 0.18 }, { t: 'Expose (scanner)', f: 0.42 }, { t: 'Track · develop', f: 0.22 }, { t: 'Inspect · unload', f: 0.18 }],
    implanter: [{ t: 'Load port', f: 0.08 }, { t: 'Beam tune', f: 0.17 }, { t: 'Scan · implant', f: 0.55 }, { t: 'Unload', f: 0.20 }],
    rtp:       [{ t: 'Load', f: 0.10 }, { t: 'Ramp', f: 0.15 }, { t: 'Spike anneal', f: 0.25 }, { t: 'Cool', f: 0.35 }, { t: 'Unload', f: 0.15 }],
    cmp:       [{ t: 'Load · align', f: 0.10 }, { t: 'Polish (platen)', f: 0.60 }, { t: 'Clean · dry', f: 0.20 }, { t: 'Unload', f: 0.10 }],
    polisher:  [{ t: 'Load · align', f: 0.10 }, { t: 'Polish (platen)', f: 0.60 }, { t: 'Clean · dry', f: 0.20 }, { t: 'Unload', f: 0.10 }],
    tester:    [{ t: 'Load · align card', f: 0.10 }, { t: 'Probe every die', f: 0.75 }, { t: 'Bin · unload', f: 0.15 }],
    sorter:    [{ t: 'Load FOUP', f: 0.15 }, { t: 'Read IDs · slot map', f: 0.60 }, { t: 'Unload', f: 0.25 }],
  };

  const bayByName = {};
  BAYS.forEach(b => { bayByName[b.name] = b; });
  const stepToolNames = {};   // step id -> bay names, in layout order

  function portOf(bay) {
    const side = bay.y < SPINE_Y ? 1 : -1;
    return { x: bay.x, y: bay.y + side * (bay.d / 2 + 0.40) };
  }

  function queueAnchor(stepId) {
    const bays = BAYS.filter(b => b.step === stepId);
    if (!bays.length) return { x: FLOOR.w / 2, y: SPINE_Y };
    return { x: bays.reduce((s, b) => s + b.x, 0) / bays.length, y: bays[0].y < SPINE_Y ? SPINE_Y - 0.55 : SPINE_Y + 0.55 };
  }

  /* Route a FOUP along the rail: leave the bay, travel the spine, drop into the
   * target. Returns waypoints after `from`; the last one is exactly `to`. */
  function route(from, to) {
    if (!from) return [{ x: to.x, y: to.y }];
    if (Math.hypot(to.x - from.x, to.y - from.y) < 0.05) return [{ x: to.x, y: to.y }];
    const pts = [];
    const offRail = Math.abs(from.y - SPINE_Y) > 0.06;
    if (offRail) pts.push({ x: from.x, y: SPINE_Y });
    if (Math.abs(to.y - SPINE_Y) > 0.06 || offRail) pts.push({ x: to.x, y: SPINE_Y });
    pts.push({ x: to.x, y: to.y });
    return pts.filter((p, i) => i === 0 || Math.hypot(p.x - pts[i - 1].x, p.y - pts[i - 1].y) > 0.02);
  }

  // ---------------- isometric projection ----------------
  const K = { x: 34, y: 17, z: 30 };
  function project(x, y, z) { return { x: (x - y) * K.x, y: (x + y) * K.y - (z || 0) * K.z }; }
  function unproject(sx, sy) {           // floor plane only (z = 0)
    const u = sx / K.x, v = sy / K.y;
    return { x: (u + v) / 2, y: (v - u) / 2 };
  }

  // ---------------- FOUP tracking (view state only) ----------------
  const SPEED = 4.6;       // world units per second
  const MAX_QUEUE = 5;

  function createFloor() { return { foups: {}, selected: null, follow: null, t: 0 }; }

  function targetFor(state, lot) {
    if (lot.status === 'done') { const b = bayByName['TEST-01']; return { x: b.x - 1.5, y: portOf(b).y, done: true }; }
    if (lot.status === 'hold') return { x: 15.1, y: 7.4, hold: true };
    if (lot.status === 'processing') {
      const ss = state.steps[lot.step];
      const tool = ss && ss.tools.find(t => t.busy && t.busy.id === lot.id);
      const bay = tool && bayByName[tool.name];
      if (bay) return portOf(bay);
    }
    const ss = state.steps[lot.step];
    const a = queueAnchor(ss ? ss.id : 'START');
    const q = ss ? ss.queue : [];
    const i = Math.max(0, Math.min(MAX_QUEUE - 1, q.indexOf(lot)));
    return { x: a.x - 0.72 * (MAX_QUEUE - 1) / 2 + i * 0.72, y: a.y };
  }

  /* Advance every FOUP toward its target along the rail, in real time, so the
   * animation looks the same at 1 min/s and at 40 h/s. */
  function step(v, state, dt, mul) {
    const live = {};
    state.lots.forEach(lot => {
      const existing = v.foups[lot.id];
      if (lot.status === 'done' && !existing) return;
      const tgt = targetFor(state, lot);
      let f = existing;
      if (!f) f = v.foups[lot.id] = { x: tgt.x, y: tgt.y, path: [], alpha: 1, doneAt: 0 };
      live[lot.id] = true;

      const last = f.path.length ? f.path[f.path.length - 1] : f;
      if (Math.hypot(tgt.x - last.x, tgt.y - last.y) > 0.05) f.path = route({ x: f.x, y: f.y }, tgt);
      let budget = SPEED * Math.max(1, Math.min(6, mul || 1)) * dt;   // keep up at high sim speed
      while (budget > 0 && f.path.length) {
        const w = f.path[0], dx = w.x - f.x, dy = w.y - f.y, d = Math.hypot(dx, dy);
        if (d < 1e-4) { f.path.shift(); continue; }
        if (d <= budget) { f.x = w.x; f.y = w.y; budget -= d; f.path.shift(); }
        else { f.x += dx / d * budget; f.y += dy / d * budget; budget = 0; }
      }
      f.lot = lot; f.status = lot.status; f.hold = !!tgt.hold;
      if (lot.status === 'done') { f.doneAt = f.doneAt || v.t; f.alpha = Math.max(0, 1 - (v.t - f.doneAt) / 2200); }
      else { f.doneAt = 0; f.alpha = 1; }
    });
    Object.keys(v.foups).forEach(id => { if (!live[id] || v.foups[id].alpha <= 0.01) delete v.foups[id]; });
    v.t += (dt || 0) * 1000;
  }

  function phaseIndex(tool, state) {
    if (!tool.busy) return -1;
    const dur = tool.busyUntil - tool.busy._tin;
    const p = dur > 0 ? (state.t - tool.busy._tin) / dur : 0;
    const bay = bayByName[tool.name];
    const phases = PHASES[bay ? bay.kind : 'cluster'] || PHASES.cluster;
    let acc = 0;
    for (let i = 0; i < phases.length; i++) { acc += phases[i].f; if (p <= acc) return i; }
    return phases.length - 1;
  }

  function toolAt(state, name) {
    for (const s of state.steps) { const t = s.tools.find(x => x.name === name); if (t) return { tool: t, step: s }; }
    return null;
  }

  const fmtT = t => `D${Math.floor(t / 1440) + 1} ${String(Math.floor((t % 1440) / 60)).padStart(2, '0')}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

  // ---------------- drawing ----------------
  const COL = {
    floor: '#0d131b', floorEdge: '#1b2634', grid: '#16202c',
    topNorth: '#22303f', topSouth: '#1e2b39', topEdge: '#2d3d4f',
    faceL: '#161f2a', faceR: '#1b2531', port: '#2b3949',
    rail: '#31465c', railLit: '#415b74',
    text: '#9fb0c3', dim: '#5d6f83',
    queued: '#7c8ea3', processing: '#f0b03c', hold: '#e2564a', done: '#57b97e',
  };

  function fitTo(W, H) {
    const corners = [[0, 0], [FLOOR.w, 0], [0, FLOOR.d], [FLOOR.w, FLOOR.d]].map(([x, y]) => project(x, y, 0));
    const xs = corners.map(c => c.x), ys = corners.map(c => c.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const pad = 46;
    const s = Math.min((W - pad * 2) / (maxX - minX), (H - pad * 2) / (maxY - minY));
    return { s, ox: W / 2 - ((minX + maxX) / 2) * s, oy: H / 2 - ((minY + maxY) / 2) * s };
  }

  function draw(ctx, W, H, state, v, opts) {
    const o = opts || {};
    const fit = fitTo(W, H);
    const P = (x, y, z) => { const p = project(x, y, z || 0); return { x: p.x * fit.s + fit.ox, y: p.y * fit.s + fit.oy }; };
    ctx.clearRect(0, 0, W, H);

    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#0b1119'); bg.addColorStop(1, '#070b10');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);

    const poly = (pts, fill, stroke, lw) => {
      ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.closePath();
      if (fill) { ctx.fillStyle = fill; ctx.fill(); }
      if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw || 1; ctx.stroke(); }
    };

    // floor slab
    poly([P(0, 0), P(FLOOR.w, 0), P(FLOOR.w, FLOOR.d), P(0, FLOOR.d)], COL.floor, COL.floorEdge, 1.5);
    ctx.strokeStyle = COL.grid; ctx.lineWidth = 1;
    for (let x = 1; x < FLOOR.w; x += 1) { const a = P(x, 0), b = P(x, FLOOR.d); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); }
    for (let y = 1; y < FLOOR.d; y += 1) { const a = P(0, y), b = P(FLOOR.w, y); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); }

    // overhead rail (AMHS) + spurs to each bay
    const railPath = () => { const a = P(0.3, SPINE_Y), b = P(FLOOR.w - 0.3, SPINE_Y); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); };
    ctx.strokeStyle = COL.rail; ctx.lineWidth = 3.5; railPath();
    ctx.strokeStyle = COL.railLit; ctx.lineWidth = 1; ctx.setLineDash([7, 7]); railPath(); ctx.setLineDash([]);
    ctx.strokeStyle = COL.rail; ctx.lineWidth = 2;
    BAYS.forEach(b => { const p = portOf(b), a = P(p.x, SPINE_Y), c = P(p.x, p.y); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(c.x, c.y); ctx.stroke(); });

    // stockers
    STOCKERS.forEach(s => {
      const w = 0.9, h = 0.5;
      poly([P(s.x - w, SPINE_Y - w), P(s.x + w, SPINE_Y - w), P(s.x + w, SPINE_Y + w), P(s.x - w, SPINE_Y + w)], '#1a232e', '#2a3a4b', 1);
      poly([P(s.x - w, SPINE_Y - w, h), P(s.x + w, SPINE_Y - w, h), P(s.x + w, SPINE_Y + w, h), P(s.x - w, SPINE_Y + w, h)], '#20303f', '#2a3a4b', 1);
    });

    // tools under construction: a box per bay, with a per-kind detail on top
    const items = [];
    BAYS.forEach(b => items.push({ depth: b.x + b.y, kind: 'tool', bay: b }));
    Object.values(v.foups).forEach(f => items.push({ depth: f.x + f.y + 0.2, kind: 'foup', f }));
    items.sort((a, b) => a.depth - b.depth);

    items.forEach(it => {
      if (it.kind === 'tool') drawTool(it.bay);
      else drawFoup(it.f);
    });

    function drawTool(b) {
      const x0 = b.x - b.w / 2, x1 = b.x + b.w / 2, y0 = b.y - b.d / 2, y1 = b.y + b.d / 2, h = b.h;
      const isSel = v.selected === b.name;
      const info = toolAt(state, b.name);
      const busy = info && info.tool.busy;
      const faulted = state.faults && Object.keys(state.faults).some(k => (state.faults[k], k) && isFaultOnTool(k, b.name));

      poly([P(x0, y1, h), P(x1, y1, h), P(x1, y1, 0), P(x0, y1, 0)], COL.faceL);           // front-left wall
      poly([P(x1, y1, h), P(x1, y0, h), P(x1, y0, 0), P(x1, y1, 0)], COL.faceR);            // front-right wall
      poly([P(x0, y0, h), P(x1, y0, h), P(x1, y1, h), P(x0, y1, h)], isSel ? '#2f4a5f' : (b.y < SPINE_Y ? COL.topNorth : COL.topSouth), isSel ? '#8fd0ff' : COL.topEdge, isSel ? 2 : 1);

      // load port nub facing the rail
      const p = portOf(b), side = b.y < SPINE_Y ? 1 : -1;
      poly([P(p.x - 0.28, p.y - 0.16, 0.30), P(p.x + 0.28, p.y - 0.16, 0.30), P(p.x + 0.28, p.y + 0.16, 0.30), P(p.x - 0.28, p.y + 0.16, 0.30)], COL.port, '#33465a', 1);

      detail(b, P, side);

      // busy: the machine is lit up and shows a dial with the elapsed share of its process time
      if (busy) {
        const dur = busy.busyUntil - busy._tin, prog = dur > 0 ? Math.max(0, Math.min(1, (state.t - busy._tin) / dur)) : 0;
        poly([P(x0, y0, h), P(x1, y0, h), P(x1, y1, h), P(x0, y1, h)], 'rgba(240,176,60,.10)', null);
        const c = P(b.x, b.y, h + 0.55), r = 14;
        ctx.beginPath(); ctx.arc(c.x, c.y, r, 0, Math.PI * 2); ctx.strokeStyle = '#1d2a37'; ctx.lineWidth = 5; ctx.stroke();
        ctx.beginPath(); ctx.arc(c.x, c.y, r, -Math.PI / 2, -Math.PI / 2 + prog * Math.PI * 2); ctx.strokeStyle = COL.processing; ctx.lineWidth = 5; ctx.stroke();
        ctx.fillStyle = COL.processing; ctx.font = '700 10px ui-monospace, monospace';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(Math.round(prog * 100) + '', c.x, c.y + 1);
      }
      if (faulted) {
        const pulse = 0.45 + 0.35 * Math.sin(v.t / 240);
        ctx.strokeStyle = `rgba(226,86,74,${pulse.toFixed(2)})`; ctx.lineWidth = 2.5;
        const c = P(b.x, b.y, h + 0.02);
        poly([P(x0, y0, h), P(x1, y0, h), P(x1, y1, h), P(x0, y1, h)], null, `rgba(226,86,74,${pulse.toFixed(2)})`, 2.5);
        ctx.beginPath(); ctx.arc(c.x, c.y, 6, 0, Math.PI * 2); ctx.stroke();
      }

      // label
      const lc = P(b.x, b.y, h + (busy ? 0.95 : 0.55));
      ctx.font = '600 11px ui-monospace, SFMono-Regular, Menlo, monospace';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = isSel ? '#cfe6fa' : COL.text;
      ctx.fillText(b.name, lc.x, lc.y);
      if (busy) {
        ctx.font = '10px ui-monospace, monospace';
        ctx.fillStyle = COL.processing;
        ctx.fillText(`${busy.id} · ${fmtT(state.t).replace(/^D\d+ /, '')}`, lc.x, lc.y + 12);
      } else if (info) {
        ctx.font = '10px ui-monospace, monospace';
        ctx.fillStyle = COL.dim;
        ctx.fillText(info.tool.hours ? `${info.tool.hours.toFixed(0)} h since PM` : 'idle', lc.x, lc.y + 12);
      }
    }

    function detail(b, P, side) {
      const x0 = b.x - b.w / 2, x1 = b.x + b.w / 2, y0 = b.y - b.d / 2, y1 = b.y + b.d / 2, h = b.h;
      if (b.kind === 'furnace') {                       // horizontal tube + boat
        poly([P(x0 + 0.15, b.y - 0.12, h + 0.30), P(x1 - 0.15, b.y - 0.12, h + 0.30), P(x1 - 0.15, b.y + 0.12, h + 0.30), P(x0 + 0.15, b.y + 0.12, h + 0.30)], '#33465a', '#41586f', 1);
        poly([P(x0 + 0.15, b.y - 0.12, h + 0.30), P(x1 - 0.15, b.y - 0.12, h + 0.30), P(x1 - 0.15, b.y - 0.12, h + 0.02), P(x0 + 0.15, b.y - 0.12, h + 0.02)], '#22303f', null);
      } else if (b.kind === 'scanner') {                // sloped scanner hood + track wings
        poly([P(x0 + 0.2, y0 + 0.2, h + 0.5), P(x1 - 0.4, y0 + 0.2, h + 0.5), P(x1 - 0.2, y1 - 0.2, h + 0.1), P(x0 + 0.4, y1 - 0.2, h + 0.1)], '#2b3c4d', '#3a5165', 1);
        poly([P(x0, y0 + 0.45, h + 0.22), P(x0 + 0.18, y0 + 0.45, h + 0.22), P(x0 + 0.18, y1 - 0.15, h + 0.22), P(x0, y1 - 0.15, h + 0.22)], '#3a5064', null);
      } else if (b.kind === 'cluster') {                // two chambers on the transfer module
        [-0.32, 0.32].forEach(dx => {
          const cx = b.x + dx * b.w;
          poly([P(cx - 0.3, b.y - 0.3, h + 0.34), P(cx + 0.3, b.y - 0.3, h + 0.34), P(cx + 0.3, b.y + 0.3, h + 0.34), P(cx - 0.3, b.y + 0.3, h + 0.34)], '#2f4356', '#3d566c', 1);
          poly([P(cx - 0.3, b.y + 0.3, h + 0.34), P(cx + 0.3, b.y + 0.3, h + 0.34), P(cx + 0.3, b.y + 0.3, h), P(cx - 0.3, b.y + 0.3, h)], '#1d2833', null);
        });
      } else if (b.kind === 'implanter') {              // beam line arm
        poly([P(x0 + 0.1, b.y, h + 0.18), P(x1 - 0.1, b.y - 0.18, h + 0.18), P(x1 - 0.1, b.y + 0.18, h + 0.18), P(x0 + 0.1, b.y + 0.18, h + 0.18)], '#3a5064', '#48627a', 1);
      } else if (b.kind === 'cmp' || b.kind === 'polisher') {   // rotating platen
        const c = P(b.x, b.y, h + 0.06);
        ctx.beginPath(); ctx.ellipse(c.x, c.y, 15, 7.5, 0, 0, Math.PI * 2);
        ctx.fillStyle = '#2e4256'; ctx.fill(); ctx.strokeStyle = '#40596f'; ctx.lineWidth = 1; ctx.stroke();
      } else if (b.kind === 'tester') {                 // probe tower
        poly([P(b.x - 0.22, b.y - 0.22, h + 0.55), P(b.x + 0.22, b.y - 0.22, h + 0.55), P(b.x + 0.22, b.y + 0.22, h + 0.55), P(b.x - 0.22, b.y + 0.22, h + 0.55)], '#33465a', '#41586f', 1);
      } else {                                          // sorter: slot rails on top
        poly([P(x0 + 0.2, b.y - 0.1, h + 0.12), P(x1 - 0.2, b.y - 0.1, h + 0.12), P(x1 - 0.2, b.y + 0.1, h + 0.12), P(x0 + 0.2, b.y + 0.1, h + 0.12)], '#33465a', null);
      }
    }

    function drawFoup(f) {
      const s = 0.26, h = 0.34;
      const x0 = f.x - s, x1 = f.x + s, y0 = f.y - s, y1 = f.y + s;
      ctx.globalAlpha = f.alpha;
      poly([P(x0, y1, h), P(x1, y1, h), P(x1, y1, 0), P(x0, y1, 0)], '#1a232d');
      poly([P(x1, y1, h), P(x1, y0, h), P(x1, y0, 0), P(x1, y1, 0)], '#1f2a36');
      const lid = f.status === 'processing' ? COL.processing : f.status === 'hold' ? COL.hold : f.status === 'done' ? COL.done : COL.queued;
      poly([P(x0, y0, h), P(x1, y0, h), P(x1, y1, h), P(x0, y1, h)], lid, '#0d141c', 1);
      if (v.follow && f.lot && v.follow === f.lot.id) {
        const c = P(f.x, f.y, h * 0.5), r = 14 + 2 * Math.sin(v.t / 220);
        ctx.strokeStyle = 'rgba(143,208,255,.85)'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(c.x, c.y, r, 0, Math.PI * 2); ctx.stroke();
      }
      if (f.status === 'processing' || f.status === 'hold') {
        ctx.font = '600 10px ui-monospace, monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        const c = P(f.x, f.y, h + 0.28);
        ctx.fillStyle = f.status === 'hold' ? COL.hold : COL.processing;
        ctx.fillText(f.lot.id + (f.status === 'hold' ? ' HOLD' : ''), c.x, c.y);
      }
      ctx.globalAlpha = 1;
    }

    // hover / selection ring is drawn by the caller (needs the pointer)
    if (o.hover) {
      const c = P(o.hover.x, o.hover.y, o.hover.h || 0);
      ctx.strokeStyle = 'rgba(143,208,255,.5)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(c.x, c.y, 4, 0, Math.PI * 2); ctx.stroke();
    }

    // legend
    ctx.font = '11px ui-monospace, monospace'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    const legend = [[COL.queued, 'FOUP queued'], [COL.processing, 'processing'], [COL.hold, 'on hold'], [COL.done, 'sorted']];
    legend.forEach(([c, t], i) => {
      const x = 14, y = H - 16 - i * 15;
      ctx.fillStyle = c; ctx.fillRect(x, y - 4, 9, 8);
      ctx.fillStyle = COL.dim; ctx.fillText(t, x + 15, y);
    });
    return fit;
  }

  // which fault (if any) is planted on this tool
  function isFaultOnTool(faultId, toolName) {
    const map = { furnaceDrift: 'FURN-01', focusDrift: 'SCAN-02', etchSeason: 'ETCH-03A', beamUnstable: 'IMP-01', particles: 'PECVD-02A', padScratch: 'CMP-01A' };
    return map[faultId] === toolName;
  }

  // bay under a screen point (canvas pixels)
  function pick(px, py, W, H) {
    const fit = fitTo(W, H);
    const w = unproject((px - fit.ox) / fit.s, (py - fit.oy) / fit.s);
    return BAYS.find(b => Math.abs(w.x - b.x) <= b.w / 2 + 0.1 && Math.abs(w.y - b.y) <= b.d / 2 + 0.1) || null;
  }

  const api = {
    BAYS, PHASES, STOCKERS, SPINE_Y, FLOOR, K, SPEED,
    bayByName, portOf, queueAnchor, route, project, unproject, pick, fitTo,
    createFloor, step, targetFor, phaseIndex, toolAt, isFaultOnTool, fmtT, draw,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.FabFloor = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
