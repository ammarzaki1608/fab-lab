/* FabSim UI: renders the flow diagram, animates data packets, and drives the analysis tabs. */
(function () {
  'use strict';
  const { createSim, STEPS, STEP_INDEX, BINS, FAULTS, DIES, GRID, SAMPLE_WAFERS, mean } = window.FabSim;
  // one read of the query string: scenario links (where we came from, seed, control state)
  const Q = new URLSearchParams(location.search);
  const $ = s => document.querySelector(s);
  const el = (tag, attrs = {}, parent) => {
    const ns = ['svg', 'g', 'rect', 'text', 'line', 'path', 'circle', 'defs', 'marker', 'polyline', 'title'].includes(tag);
    const e = ns ? document.createElementNS('http://www.w3.org/2000/svg', tag) : document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) { if (k === 'text') e.textContent = v; else if (k === 'html') e.innerHTML = v; else e.setAttribute(k, v); }
    if (parent) parent.appendChild(e); return e;
  };
  const SYS_COLOR = { MES: '#8aa4c8', FDC: '#f5a524', SPC: '#3fd0c9', R2R: '#b07cff', YMS: '#2fbf71', SIM: '#e5484d' };
  const SPEEDS = [0.25, 0.5, 1, 2, 5, 10, 20, 40]; // sim minutes per animation frame
  const fmtT = t => { const d = Math.floor(t / 1440), m = t % 1440; return `D${d + 1} ${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };

  let sim, playing = true, acc = 0, selStep = 'LITHO', selLot = null, selWafer = 0, yieldLot = null, mapMode = 'bin', activeTab = 'step';
  let packets = [], lastPanel = 0;
  const evFilter = { MES: true, FDC: true, SPC: true, R2R: true, YMS: true, SIM: true };

  // ---------------- flow diagram ----------------
  const svg = $('#flow');
  const SX = i => 130 + i * 111, SW = 100, STOP = 8, SBOT = 110;
  const LANES = { MES: 146, FDC: 170, SPC: 194, R2R: 218, YMS: 242 };
  // compact labels for the 100px boxes (full names stay in the tooltip + step detail)
  const SHORT = { 'Gate Lithography': 'Gate Litho', 'S/D Ion Implant': 'S/D Implant', 'Spike Anneal (RTP)': 'Spike Anneal',
    'ILD Deposition (PECVD)': 'ILD Deposition', 'Contact & Metal 1': 'Contact+Metal 1', 'Wafer Sort (E-Test)': 'Wafer Sort' };
  const SYS_SUB = { MES: 'Mfg Execution System', FDC: 'Fault Detection', SPC: 'Stat. Process Control', R2R: 'Run-to-Run control', YMS: 'Yield Mgmt + Data lake' };
  const stepLanes = id => id === 'START' ? ['MES'] : id === 'SORT' ? ['MES', 'YMS'] : ['LITHO', 'ETCH', 'CMP'].includes(id) ? ['MES', 'FDC', 'SPC', 'R2R'] : ['MES', 'FDC', 'SPC'];
  const stepEls = {};
  let pktLayer;

  function buildFlow() {
    svg.innerHTML = '';
    const defs = el('defs', {}, svg);
    const mk = el('marker', { id: 'arr', viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 6, markerHeight: 6, orient: 'auto-start-reverse' }, defs);
    el('path', { d: 'M0,0 L10,5 L0,10 z', fill: '#3b4757' }, mk);
    // lanes + system boxes
    Object.entries(LANES).forEach(([sys, y]) => {
      el('line', { x1: 112, y1: y, x2: 1232, y2: y, class: 'lane', stroke: SYS_COLOR[sys] }, svg);
      el('rect', { x: 2, y: y - 12, width: 108, height: 24, rx: 5, class: 'sysbox', stroke: SYS_COLOR[sys] }, svg);
      el('text', { x: 8, y: y - 1, class: 'syslbl', fill: SYS_COLOR[sys], text: sys === 'R2R' ? 'R2R / APC' : sys }, svg);
      el('text', { x: 8, y: y + 8.5, class: 'syssub', text: SYS_SUB[sys] }, svg);
    });
    el('text', { x: 8, y: 30, fill: '#7f8da0', 'font-size': 10, text: 'PHYSICAL FLOW →' }, svg);
    el('text', { x: 8, y: 44, fill: '#7f8da0', 'font-size': 9, text: 'lots move step to step' }, svg);
    el('text', { x: 8, y: 132, fill: '#7f8da0', 'font-size': 10, text: 'DATA SYSTEMS ↓' }, svg);
    // vertical connectors
    STEPS.forEach((s, i) => {
      const cx = SX(i) + SW / 2, lanes = stepLanes(s.id);
      const maxY = Math.max(...lanes.map(l => LANES[l]));
      el('line', { x1: cx, y1: SBOT, x2: cx, y2: maxY, class: 'vconn' }, svg);
      lanes.forEach(l => el('circle', { cx, cy: LANES[l], r: 3, class: 'junc', fill: SYS_COLOR[l] }, svg));
      if (i < STEPS.length - 1) el('line', { x1: SX(i) + SW + 1, y1: 63, x2: SX(i + 1) - 2, y2: 63, class: 'wflow' }, svg);
    });
    // step boxes
    STEPS.forEach((s, i) => {
      const g = el('g', { class: 'step', 'data-id': s.id, transform: `translate(${SX(i)},${STOP})` }, svg);
      el('rect', { x: 0, y: 0, width: SW, height: SBOT - STOP, rx: 7, class: 'step-box' }, g);
      el('text', { x: 7, y: 12, class: 'ar', text: (s.area || '') }, g);
      el('text', { x: 7, y: 25, class: 'nm', text: SHORT[s.name] || s.name }, g);
      const toolLabel = s.tools.length > 1 ? `${s.tools.length} chambers` : s.tools[0];
      el('text', { x: 7, y: 36, class: 'tl', text: toolLabel.length > 20 ? toolLabel.slice(0, 19) + '…' : toolLabel }, g);
      const cur = el('text', { x: 7, y: 51, class: 'cur', text: '' }, g);
      const q = el('text', { x: 7, y: 63, class: 'q', text: '' }, g);
      const tokens = el('g', { transform: 'translate(8,73)' }, g);
      // one progress bar per chamber, chamber tag to the left of its bar
      const multi = s.tools.length > 1;
      const bars = s.tools.map((name, k) => {
        const y = 83 + k * 11;
        el('rect', { x: multi ? 18 : 7, y, width: SW - (multi ? 25 : 14), height: 5, rx: 2, class: 'pbg' }, g);
        const pfg = el('rect', { x: multi ? 18 : 7, y, width: 0, height: 5, rx: 2, class: 'pfg' }, g);
        if (multi) el('text', { x: 7, y: y + 5, class: 'chn', text: name.split('-').pop() }, g);
        return pfg;
      });
      const warn = el('text', { x: SW - 16, y: 15, class: 'warnicon', text: '' }, g);
      el('title', { text: `${s.name} — ${s.tools.join(', ')}\nClick for details` }, g);
      g.addEventListener('click', () => { selStep = s.id; showTab('step'); renderPanel(true); updateFlow(); });
      stepEls[s.id] = { g, cur, q, pfg: bars, tokens, warn, step: s };
    });
    pktLayer = el('g', {}, svg);
  }

  function updateFlow() {
    const S = sim.state;
    const faultSteps = new Set(Object.keys(S.faults).map(f => FAULTS[f].step));
    STEPS.forEach((s, i) => {
      const ss = S.steps[i], e = stepEls[s.id];
      e.g.classList.toggle('sel', s.id === selStep);
      e.g.classList.toggle('fault', faultSteps.has(s.id));
      e.warn.textContent = faultSteps.has(s.id) ? '⚠' : '';
      const busy = ss.tools.filter(t => t.busy);
      e.cur.textContent = busy.length ? (s.tools.length > 1 ? `${busy.length}/${ss.tools.length} busy` : '▶ ' + busy[0].busy.id) : 'idle';
      const holds = ss.queue.filter(l => l.status === 'hold').length;
      e.q.textContent = `Q ${ss.queue.length}${holds ? `/${holds}H` : ''}  RUN ${ss.runs}`;
      ss.tools.forEach((t, k) => {
        const prog = t.busy ? 1 - (t.busyUntil - S.t) / s.time : 0;
        const bar = e.pfg[k]; if (!bar) return;
        bar.setAttribute('width', Math.max(0, Math.min(1, prog)) * (SW - (ss.tools.length > 1 ? 25 : 14)));
        bar.setAttribute('class', 'pfg' + (faultSteps.has(s.id) && t.name === (S.faults && Object.keys(S.faults).map(f => FAULTS[f].tool)[0]) ? ' bad' : ''));
      });
      // queue tokens
      const n = Math.min(ss.queue.length, 10);
      if (e.tokens.childElementCount !== n || e.tokens.dataset.h !== String(holds)) {
        e.tokens.innerHTML = ''; e.tokens.dataset.h = holds;
        ss.queue.slice(0, 10).forEach((l, k) => el('rect', { x: k * 8.6, y: 0, width: 7, height: 7, rx: 1.5, class: l.status === 'hold' ? 'hold-token' : 'lot-token' }, e.tokens));
      }
    });
    $('#faultsActive').innerHTML = Object.keys(S.faults).map(f => `<span class="f">⚠ ${FAULTS[f].label} <button data-clear="${f}">clear</button></span>`).join('');
  }

  // packets: polyline paths animated over `dur` ms
  function spawnPacket(e) {
    if (packets.length > 140 || !e.step || e.sys === 'SIM') return;
    const i = STEP_INDEX[e.step]; if (i === undefined) return;
    const cx = SX(i) + SW / 2; const lane = LANES[e.sys]; if (!lane) return;
    let pts;
    if (e.sys === 'R2R') pts = [[110, lane], [cx, lane], [cx, SBOT]];      // controller → tool
    else pts = [[cx, SBOT], [cx, lane], [110, lane]];                       // tool → system
    const c = el('circle', { r: e.level === 'error' || e.level === 'warn' ? 4.5 : 3.2, class: 'pkt', fill: e.level === 'error' ? '#e5484d' : SYS_COLOR[e.sys] }, pktLayer);
    const lens = []; let L = 0;
    for (let k = 1; k < pts.length; k++) { const d = Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]); lens.push(d); L += d; }
    packets.push({ c, pts, lens, L, t0: performance.now(), dur: 500 + L * 1.1 });
    // flash step box on alarms
    if (e.type === 'alarm' || e.type === 'ooc') {
      const g = stepEls[e.step].g, cls = e.type === 'alarm' ? 'flash-FDC' : 'flash-SPC';
      g.classList.add(cls); setTimeout(() => g.classList.remove(cls), 700);
    }
  }
  function animPackets(now) {
    packets = packets.filter(p => {
      const f = (now - p.t0) / p.dur;
      if (f >= 1) { p.c.remove(); return false; }
      let d = f * p.L, k = 0;
      while (k < p.lens.length - 1 && d > p.lens[k]) { d -= p.lens[k]; k++; }
      const a = p.pts[k], b = p.pts[k + 1], u = Math.min(1, d / p.lens[k]);
      p.c.setAttribute('cx', a[0] + (b[0] - a[0]) * u); p.c.setAttribute('cy', a[1] + (b[1] - a[1]) * u);
      return true;
    });
  }

  // ---------------- KPIs ----------------
  function renderKpis() {
    const S = sim.state;
    const wip = S.lots.filter(l => l.status !== 'done').length;
    const done = S.counts.sorted;   // all-time; S.sorted is a rolling window
    const last = S.sorted.at(-1);
    const last10 = S.sorted.slice(-10);
    const y10 = last10.length ? mean(last10.map(x => x.yield)) : null;
    const ct = last10.length ? mean(last10.map(x => x.cycleTime)) : null;
    const ooc = S.counts.ooc, fdc = S.counts.fdcAlarms;   // all-time totals (the chart arrays are windows)
    const holds = S.lots.filter(l => l.status === 'hold').length;
    const yc = y => y == null ? '' : y > 0.95 ? 'good' : y > 0.85 ? 'warn' : 'bad';
    const k = [
      ['Sim clock', fmtT(S.t), ''], ['WIP lots', wip, ''], ['On hold', holds, holds ? 'bad' : ''], ['Lots sorted', done, ''],
      ['Last lot yield', last ? (last.yield * 100).toFixed(1) + '%' : '—', yc(last && last.yield)],
      ['Yield (last 10)', y10 != null ? (y10 * 100).toFixed(1) + '%' : '—', yc(y10)],
      ['SPC OOC / FDC alarms', `${ooc} / ${fdc}`, ooc + fdc ? 'warn' : ''],
      ['Cycle time', ct ? (ct / 60).toFixed(1) + ' h' : '—', ''],
    ];
    $('#kpis').innerHTML = k.map(([l, v, c]) => `<div class="kpi"><div class="l">${l}</div><div class="v ${c}">${v}</div></div>`).join('');
  }

  // ---------------- event stream ----------------
  const evList = $('#evList');
  function addEvent(e) {
    if (!evFilter[e.sys]) return;
    const li = el('li', { class: e.level || '' });
    li.innerHTML = `<span class="tt">${fmtT(e.t)}</span><span class="sy" style="color:${SYS_COLOR[e.sys]}">${e.sys}</span><span class="ms"></span>`;
    li.lastChild.textContent = e.msg;
    evList.prepend(li);
    while (evList.childElementCount > 250) evList.lastChild.remove();
  }
  function buildFilters() {
    const f = $('#evFilters'); f.innerHTML = '';
    Object.keys(evFilter).forEach(s => {
      const b = el('button', { class: evFilter[s] ? 'on' : '', style: `color:${SYS_COLOR[s]};border-color:${SYS_COLOR[s]}55`, text: s }, f);
      b.onclick = () => { evFilter[s] = !evFilter[s]; b.classList.toggle('on', evFilter[s]); };
    });
  }

  // ---------------- tabs ----------------
  const TABS = ['step', 'spc', 'yield', 'test', 'chambers', 'lot', 'data', 'learn'];
  function showTab(t) {
    if (!TABS.includes(t)) t = 'step';
    activeTab = t;
    document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === t));
    document.querySelectorAll('.tab').forEach(d => d.classList.toggle('on', d.id === 'tab-' + t));
    if (location.hash.slice(1) !== t) history.replaceState(null, '', '#' + t);  // deep-linkable tabs
  }
  $('#tabs').addEventListener('click', e => { if (e.target.dataset.tab) { showTab(e.target.dataset.tab); renderPanel(true); } });

  const spcColors = (arr) => arr.map(p => p.ooc ? '#e5484d' : null);
  function spcChart(cv, key, n = 60) {
    const st = STEPS.find(s => s.param && s.param.key === key), p = st.param;
    const arr = sim.state.spc[key].slice(-n);
    const lastPt = arr.at(-1);
    const hl = [{ y: p.usl, color: '#e5484d', label: 'USL' }, { y: p.lsl, color: '#e5484d', label: 'LSL' }, { y: p.target, color: '#5b6b80', dash: [2, 3] }];
    if (lastPt) { hl.push({ y: lastPt.ucl, color: '#3fd0c9', dash: [5, 4], label: 'UCL' }, { y: lastPt.lcl, color: '#3fd0c9', dash: [5, 4], label: 'LCL' }); }
    Charts.line(cv, { series: [{ pts: arr.map(x => x.v), color: '#3fd0c9', dots: true, dotColors: spcColors(arr) }], hlines: hl, xLabel: `last ${arr.length} lots` });
  }

  function renderStep(full) {
    const s = STEPS[STEP_INDEX[selStep]], ss = sim.state.steps[STEP_INDEX[selStep]], S = sim.state;
    const box = $('#tab-step');
    if (full || box.dataset.step !== selStep) {
      box.dataset.step = selStep;
      box.innerHTML = `
        <div class="row"><h3 style="margin:0">${s.name}</h3><span class="pill">${s.area}</span><span class="pill">${s.tools.join(' / ')}</span>
          <span class="muted">process time ${s.time} min/lot</span></div>
        <p class="desc">${s.desc}</p>
        <div class="grid3">
          <div><h4>Data in</h4><ul class="io">${s.dataIn.map(x => `<li>${x}</li>`).join('')}</ul></div>
          <div><h4>Data out</h4><ul class="io">${s.dataOut.map(x => `<li>${x}</li>`).join('')}</ul></div>
          <div><h4>Last run</h4><div class="kv" id="stLast"></div></div>
        </div>
        ${ss.tools.length > 1 ? `<h4>Parallel chambers — this is why chamber matching matters</h4><div id="stChambers"></div>` : ''}
        ${s.sensors ? `<h4>FDC sensor traces (last run, 1 point = 1 s window)</h4>
        <div class="grid2">
          <div class="chartbox"><div class="cap"><b>${s.sensors[0]}</b><span id="fdcA"></span></div><canvas class="chart" id="cvTrA"></canvas></div>
          <div class="chartbox"><div class="cap"><b>${s.sensors[1]}</b><span></span></div><canvas class="chart" id="cvTrB"></canvas></div>
        </div>` : ''}
        ${s.param ? `<div class="grid2" style="margin-top:12px">
          <div class="chartbox"><div class="cap"><b>SPC: ${s.param.label} (${s.param.unit})</b><span>${s.param.metro}</span></div><canvas class="chart" id="cvStSpc"></canvas></div>
          <div><h4>Metrology — sampled wafers × 5 sites (last lot)</h4><div id="stMeas"></div></div>
        </div>` : ''}
        ${selStep === 'SORT' ? `<p class="desc">See the <b>Wafer maps &amp; yield</b> tab for die-level results.</p>` : ''}`;
    }
    const lr = ss.lastRun;
    const eq = [];
    const kv = lr ? [['lot', lr.lot], ...Object.entries(lr.recipe).map(([k, v]) => ['recipe.' + k, v]),
      ...(lr.meas ? [['meas mean', lr.meas.mean.toFixed(3)], ['meas σ', lr.meas.sd.toFixed(3)]] : []),
      ...(lr.defectCount != null ? [['defects/wafer', lr.defectCount.toFixed(1)]] : []),
      ...(lr.r2rNotes.length ? [['R2R', lr.r2rNotes.join(' | ')]] : []), ...eq] : [['status', 'no lot processed yet'], ...eq];
    const lastEl = $('#stLast'); if (lastEl) lastEl.innerHTML = kv.map(([k, v]) => `<span class="k">${k}</span><span>${v}</span>`).join('');
    const chEl = $('#stChambers');
    if (chEl) {
      chEl.innerHTML = `<table><tr><th>chamber</th><th>state</th><th>hours</th><th>fixed offset</th><th>R2R corr</th><th>lots</th><th>yield</th><th></th></tr>` +
        ss.tools.map(t => {
          const ts = S.toolStats[t.name] || { lots: 0, dies: 0, pass: 0 };
          const y = ts.dies ? (ts.pass / ts.dies * 100).toFixed(1) + '%' : '—';
          const bad = ts.dies && ts.pass / ts.dies < 0.95;
          return `<tr><td>${t.name}</td><td>${t.busy ? '▶ ' + t.busy.id : 'idle'}</td><td>${Math.round(t.hours)}</td>
            <td>${t.offset > 0 ? '+' : ''}${t.offset}${s.recipe && s.recipe.polishSec && t.rate !== undefined && s.id === 'CMP' ? '' : ''}</td>
            <td>${t.corr ? (t.corr > 0 ? '+' : '') + t.corr.toFixed(2) : '—'}</td><td>${ts.lots}</td>
            <td class="${bad ? 'bad' : ''}">${y}</td>
            <td><button data-pm="${t.name}">PM</button></td></tr>`;
        }).join('') + `</table>
        <p class="muted" style="margin-top:6px">Each chamber carries its own fixed mismatch, its own wear (hours since PM) and its own R2R correction. PM one chamber and only that chamber is affected.</p>`;
      chEl.querySelectorAll('button[data-pm]').forEach(b => { b.onclick = () => { sim.pm(b.dataset.pm); renderStep(true); }; });
    }
    if (s.sensors) {
      const tr = ss.lastTrace;
      Charts.line($('#cvTrA'), { series: [{ pts: tr ? tr.series[0].pts : [], color: '#f5a524' }] });
      Charts.line($('#cvTrB'), { series: [{ pts: tr ? tr.series[1].pts : [], color: '#ffcf7a' }] });
      $('#fdcA').innerHTML = tr ? (tr.alarm ? `<span class="pill bad">ALARM: ${tr.alarm}</span>` : `<span class="pill good">FDC OK</span>`) : '';
    }
    if (s.param) {
      spcChart($('#cvStSpc'), s.param.key);
      const lot = lr && S.lots.find(l => l.id === lr.lot);
      if (lot) {
        const k = s.param.key;
        $('#stMeas').innerHTML = `<table><tr><th>wafer</th><th>center</th><th>E</th><th>W</th><th>N</th><th>S</th><th>mean</th></tr>` +
          SAMPLE_WAFERS.map(wi => { const w = lot.wafers[wi]; const m = w.meas[k] || [];
            return `<tr><td>${w.id}</td>${m.map(v => `<td class="${v > s.param.usl || v < s.param.lsl ? 'bad' : ''}">${v.toFixed(2)}</td>`).join('')}<td>${mean(m).toFixed(2)}</td></tr>`; }).join('') +
          `</table><p class="muted" style="margin-top:6px">Only 3 of 25 wafers are measured — the other 22 are "blind". Predicting them from FDC data is <b>virtual metrology</b>.</p>`;
      }
    }
  }

  function renderSpc(full) {
    const box = $('#tab-spc');
    const params = STEPS.filter(s => s.param);
    if (full || !box.childElementCount) {
      box.innerHTML = `<div class="grid2">${params.map(s => `<div class="chartbox"><div class="cap"><b>${s.name}: ${s.param.label}</b><span id="spcs-${s.param.key}"></span></div><canvas class="chart" id="spc-${s.param.key}"></canvas></div>`).join('')}</div>
      <p class="desc" style="margin-top:10px">Each point is one lot's mean of 15 metrology readings. Teal dashed = control limits (±3σ, frozen after a 40-lot <b>Phase I</b> study: no alarms during Phase I, then σ = max(moving range / 1.128, Phase I spread) so autocorrelated R2R data does not manufacture false alarms). Red = spec limits. Red dots = rule 1 (beyond 3σ, which raises a hold) or rule 2 (9 consecutive points on one side — flagged once per run, a warning, and it rarely stops the line). Control limits describe the <i>process</i>; spec limits describe the <i>customer</i>. A few false alarms per hundred lots are statistically normal at 3σ.</p>`;
    }
    params.forEach(s => {
      const k = s.param.key, arr = sim.state.spc[k];
      spcChart($('#spc-' + k), k);
      const n = arr.filter(p => p.ooc).length, last = arr.at(-1);
      $('#spcs-' + k).innerHTML = `${last ? last.v.toFixed(2) + ' ' + s.param.unit : ''} ${n ? `<span class="pill bad">${n} OOC</span>` : '<span class="pill good">in control</span>'}`;
    });
  }

  function dieColor(d) {
    if (mapMode === 'bin') return BINS[d.bin].color;
    if (mapMode === 'vt') return Charts.cmap((d.vt - 0.38) / 0.14);
    if (mapMode === 'idsat') return Charts.cmap((d.idsat - 500) / 200);
    if (mapMode === 'rc') return Charts.cmap((d.rc - 12) / 16);
    return '#2a3442';
  }
  function renderYield(full) {
    const box = $('#tab-yield'), S = sim.state;
    const done = S.lots.filter(l => l.status === 'done' && l.wafers[0].dies);
    if (!done.length) { box.innerHTML = '<p class="muted">No lot has reached Wafer Sort yet. The first lot needs ~7 simulated hours; increase the speed.</p>'; box.dataset.built = ''; return; }
    if (!yieldLot || !done.find(l => l.id === yieldLot)) yieldLot = done.at(-1).id;
    if (full || !box.dataset.built) {
      box.dataset.built = '1';
      box.innerHTML = `
        <div class="grid2">
          <div class="chartbox"><div class="cap"><b>Lot yield trend</b><span>green line = 95% goal</span></div><canvas class="chart" id="cvYield"></canvas></div>
          <div class="chartbox"><div class="cap"><b>Fail-bin Pareto (last 10 lots, % of dies)</b></div><canvas class="chart" id="cvPareto"></canvas></div>
        </div>
        <div class="row" style="margin-top:12px">
          <b>Lot</b><select id="ySel"></select>
          <b>Map</b><select id="mSel"><option value="bin">Bin</option><option value="vt">Vt</option><option value="idsat">Idsat</option><option value="rc">Contact R</option></select>
          <label class="muted"><input type="checkbox" id="defChk" checked> overlay defects</label>
          <label class="muted"><input type="checkbox" id="followChk" checked> follow latest lot</label>
        </div>
        <div style="display:grid;grid-template-columns:minmax(0,1fr) 380px;gap:14px">
          <div><div class="thumbs" id="thumbs"></div><div class="binleg">${Object.entries(BINS).map(([b, v]) => `<span><i style="background:${v.color}"></i>${b} ${v.name}</span>`).join('')}</div>
            <p class="muted">Spatial signatures point to root causes: a <b>center cluster</b> → CVD particles; <b>arcs</b> → CMP scratches; <b>ring/edge</b> fails → radial CD or thickness non-uniformity; <b>whole wafer</b> shifts → a tool or recipe drift.</p></div>
          <div><canvas class="bigmap" id="bigMap"></canvas><div id="dieInfo" class="muted" style="font-family:var(--mono);font-size:11.5px;margin-top:6px">hover a die</div></div>
        </div>`;
      $('#mSel').value = mapMode;
      $('#mSel').onchange = e => { mapMode = e.target.value; renderYield(false); };
      $('#ySel').onchange = e => { yieldLot = e.target.value; $('#followChk').checked = false; selWafer = 0; renderYield(false); };
      $('#defChk').onchange = () => renderYield(false);
      const big = $('#bigMap');
      big.onmousemove = ev => {
        const r = big.getBoundingClientRect(); const lot = S.lots.find(l => l.id === yieldLot); if (!lot || !big._wm) return;
        const d = big._wm.toDie(ev.clientX - r.left, ev.clientY - r.top);
        $('#dieInfo').textContent = d ? `die (${d.i},${d.j})  bin ${d.bin} ${BINS[d.bin].name}\nVt ${d.vt.toFixed(3)} V  Idsat ${d.idsat.toFixed(0)} µA/µm  Ioff ${d.ioff.toFixed(1)} nA  Rc ${d.rc.toFixed(1)} Ω` : 'hover a die';
        $('#dieInfo').style.whiteSpace = 'pre';
      };
    }
    if ($('#followChk').checked) yieldLot = done.at(-1).id;
    const ySel = $('#ySel');
    // rebuild when the list *contents* change: once die maps are capped the count stays at 30 forever
    const ySig = done.length + ':' + done[0].id + ':' + done.at(-1).id;
    if (ySel.dataset.sig !== ySig) { ySel.dataset.sig = ySig; ySel.innerHTML = done.map(l => `<option>${l.id}</option>`).join(''); }
    ySel.value = yieldLot;
    const ys = S.sorted.slice(-60);
    Charts.line($('#cvYield'), { series: [{ pts: ys.map(x => x.yield * 100), color: '#2fbf71', dots: true, dotColors: ys.map(x => x.yield < 0.85 ? '#e5484d' : null) }], hlines: [{ y: 95, color: '#2fbf7155', dash: [4, 4] }], yMax: 100, xLabel: `last ${ys.length} lots` });
    const bins = {}; let tot = 0;
    S.sorted.slice(-10).forEach(x => Object.entries(x.bins).forEach(([b, c]) => { bins[b] = (bins[b] || 0) + c; tot += c; }));
    Charts.bars($('#cvPareto'), Object.entries(bins).filter(([b]) => b !== '1').sort((a, b) => b[1] - a[1]).map(([b, c]) => ({ label: `${b} ${BINS[b].name}`, value: 100 * c / tot, color: BINS[b].color })), { fmt: v => v.toFixed(2) + '%' });
    const lot = S.lots.find(l => l.id === yieldLot);
    const th = $('#thumbs');
    if (th.dataset.lot !== lot.id || th.dataset.mode !== mapMode) {
      th.dataset.lot = lot.id; th.dataset.mode = mapMode; th.innerHTML = '';
      lot.wafers.forEach((w, wi) => {
        const d = el('div', {}, th); const cv = el('canvas', { class: wi === selWafer ? 'sel' : '' }, d);
        el('div', { class: 'tl', text: `#${w.slot} ${(w.yield * 100).toFixed(0)}%` }, d);
        cv.onclick = () => { selWafer = wi; th.querySelectorAll('canvas').forEach((c, k) => c.classList.toggle('sel', k === wi)); drawBig(); };
        requestAnimationFrame(() => Charts.wafer(cv, w.dies, GRID, dieColor, null, { thumb: true }));
      });
    }
    drawBig();
    function drawBig() {
      const w = lot.wafers[selWafer]; const big = $('#bigMap');
      big._wm = Charts.wafer(big, w.dies, GRID, dieColor, $('#defChk').checked ? w.defects : null);
      const c = big.getContext('2d'); c.fillStyle = '#d7dee8'; c.font = '12px ui-monospace,monospace';
      c.fillText(`${w.id}  yield ${(w.yield * 100).toFixed(1)}%  defects ${w.defects.length}`, 8, 16);
    }
  }

  /* The test floor: arithmetic from testplan.js, view from testui.js.
   * It needs the engine's die data, so it only works once a lot has been sorted. */
  function renderTest() {
    const box = $('#tab-test');
    FabTestUI.render(box, { S: sim.state, BINS, GRID, DIES, Charts });
  }

  function renderChambers(full) {
    const box = $('#tab-chambers'), S = sim.state;
    const multi = STEPS.filter(s => s.tools.length > 1);
    if (full || !box.dataset.built) {
      box.dataset.built = '1';
      box.innerHTML = `<div class="grid2">
          <div class="chartbox"><div class="cap"><b>Yield loss by chamber</b><span id="chHint"></span></div><canvas class="chart tall" id="cvChYield"></canvas></div>
          <div class="chartbox"><div class="cap"><b>Mean offset from target</b><span>nm · how far each chamber sits from the target</span></div><canvas class="chart tall" id="cvChParam"></canvas></div>
        </div>
        <h4>Chamber state</h4><div class="scroll" id="chTable"></div>
        <p class="desc" style="margin-top:10px">Lots are dispatched to the <b>least recently used idle chamber</b>, so parallel chambers see roughly equal traffic. Each carries a fixed tool-to-tool mismatch, independent wear and its own R2R correction. This is the analysis a yield engineer runs after a yield drop — <i>join the wafer map to the chamber that ran each step</i> and look for one chamber that is worse.</p>`;
    }
    const rows = [];
    STEPS.forEach((s, i) => S.steps[i].tools.forEach(t => {   // live tool objects (hours, offset, corr)
      const ts = S.toolStats[t.name] || { lots: 0, dies: 0, pass: 0, params: {} };
      rows.push({ s, t, ts, y: ts.dies ? ts.pass / ts.dies : null });
    }));
    const multiRows = rows.filter(r => r.s.tools.length > 1);
    // yield LOSS, so a 1.2% difference between chambers is actually visible
    Charts.bars($('#cvChYield'), multiRows.map(r => {
      const loss = r.y == null ? 0 : (1 - r.y) * 100;
      return { label: r.t.name, value: loss, color: loss > 5 ? '#e5484d' : loss > 3 ? '#f5a524' : '#2fbf71' };
    }), { fmt: v => v.toFixed(2) + '%', labelW: 100 });
    // deviation from target, in nm, so different characteristics share one axis
    const TARGET = { fiCD: 80, ild: 95, postCmp: 300 };
    const paramItems = [];
    const pick = (tool, key) => {
      const ps = (S.toolStats[tool] || { params: {} }).params[key];
      if (ps && ps.length) paramItems.push({ label: `${tool} ${key}`, value: mean(ps) - TARGET[key], color: '#3fd0c9' });
    };
    pick('ETCH-03A', 'fiCD'); pick('ETCH-03B', 'fiCD');
    pick('PECVD-02A', 'ild'); pick('PECVD-02B', 'ild');
    pick('CMP-01A', 'postCmp'); pick('CMP-01B', 'postCmp');
    Charts.bars($('#cvChParam'), paramItems, { fmt: v => (v >= 0 ? '+' : '') + v.toFixed(2), labelW: 150 });
    const worst = multiRows.filter(r => r.y != null).sort((a, b) => a.y - b.y)[0];
    const spread = Math.max(...multiRows.map(r => r.y ?? 1)) - Math.min(...multiRows.map(r => r.y ?? 1));
    $('#chHint').innerHTML = worst && spread > 0.02 ? `<span class="pill bad">worst: ${worst.t.name} (${(worst.y * 100).toFixed(1)}% yield)</span>` : `<span class="pill good">chambers matched</span>`;
    $('#chTable').innerHTML = `<table><tr><th>tool</th><th>step</th><th>lots</th><th>yield</th><th>hours since PM</th><th>fixed offset</th><th>R2R corr</th><th>mean param</th></tr>` +
      rows.map(r => {
        const ps = Object.entries(r.ts.params || {}).map(([k, v]) => `${k} ${mean(v).toFixed(1)}`).join(' ');
        const ytxt = r.y == null ? '—' : (r.y * 100).toFixed(1) + '%';
        return `<tr><td>${r.t.name}</td><td>${r.s.id}</td><td>${r.ts.lots}</td><td class="${r.y != null && r.y < 0.95 ? 'bad' : r.y != null && r.y < 0.97 ? 'warn' : ''}">${ytxt}</td>
          <td>${r.t.hours ? Math.round(r.t.hours) : '—'}</td><td>${r.t.offset ? (r.t.offset > 0 ? '+' : '') + r.t.offset : '—'}</td>
          <td>${r.t.corr ? (r.t.corr > 0 ? '+' : '') + r.t.corr.toFixed(1) : '—'}</td><td>${ps || '—'}</td></tr>`;
      }).join('') + `</table>`;
  }

  function renderLot(full) {
    const box = $('#tab-lot'), S = sim.state;
    if (!selLot || !S.lots.find(l => l.id === selLot)) selLot = (S.lots.find(l => l.status === 'done') || S.lots[0] || {}).id;
    if (full || !box.dataset.built) {
      box.dataset.built = '1';
      box.innerHTML = `<div class="row"><b>Lot</b><select id="lSel"></select><span id="lStat"></span></div>
        <p class="desc">The <b>lot traveler</b> (genealogy) is what MES stores: which tool, which recipe (after R2R adjustment), when, and what the metrology, FDC and SPC verdicts were. Joining this context to test results is the core of yield analysis.</p>
        <div class="scroll" id="lTable"></div>`;
      $('#lSel').onchange = e => { selLot = e.target.value; renderLot(false); };
    }
    const sel = $('#lSel');
    const lSig = S.lots.length ? S.lots.length + ':' + S.lots[0].id + ':' + S.lots.at(-1).id : '';
    if (sel.dataset.sig !== lSig) { sel.dataset.sig = lSig; sel.innerHTML = S.lots.map(l => `<option>${l.id}</option>`).join(''); }
    sel.value = selLot;
    const lot = S.lots.find(l => l.id === selLot); if (!lot) return;
    const stc = { done: 'good', hold: 'bad', processing: 'warn', queued: '' }[lot.status];
    $('#lStat').innerHTML = `<span class="pill ${stc}">${lot.status}</span> <span class="muted">at ${STEPS[lot.step].name}</span> ${lot.yield != null ? `<span class="pill">yield ${(lot.yield * 100).toFixed(1)}%</span>` : ''} ${lot.ooc.length ? `<span class="pill bad">${lot.ooc.length} OOC</span>` : ''}`;
    $('#lTable').innerHTML = `<table><tr><th>step</th><th>tool</th><th>track-in</th><th>track-out</th><th>recipe (actual)</th><th>R2R</th><th>metrology</th><th>FDC</th><th>SPC</th></tr>` +
      lot.hist.map(h => {
        const st = STEPS[STEP_INDEX[h.step]];
        const m = h.meas ? `${st.param.label}: ${h.meas.mean.toFixed(2)} ${st.param.unit}` : (h.step === 'SORT' ? `yield ${(lot.yield * 100).toFixed(1)}%` : '—');
        return `<tr><td>${st.name}</td><td>${h.tool}</td><td>${fmtT(h.tin)}</td><td>${fmtT(h.tout)}</td><td>${Object.entries(h.recipe).map(([k, v]) => `${k}=${v}`).join(' ') || '—'}</td>
          <td>${h.r2r.length ? 'adjusted' : '—'}</td><td>${m}</td>
          <td class="${h.fdc === 'ALARM' ? 'bad' : h.fdc ? 'good' : ''}">${h.fdc || '—'}</td><td class="${h.spc && h.spc !== 'In control' ? 'bad' : h.spc ? 'good' : ''}">${h.spc || '—'}</td></tr>`;
      }).join('') + `</table>`;
  }

  function renderData(full) {
    const box = $('#tab-data'), S = sim.state;
    const rows = sim.dataset(40);   // only what the table shows; the full set can be 25k rows
    if (full || !box.dataset.built) {
      box.dataset.built = '1';
      box.innerHTML = `<div class="row"><button id="dlCsv" class="primary">⬇ Download CSV</button><span id="dCount" class="muted"></span></div>
        <p class="desc">One row per sorted wafer, joined across every step: the hidden <code>*_true</code> physical values, the <code>*_meas</code> metrology (only sampled wafers), actual recipe after R2R, FDC alarm flags, defect count and test results. This is the shape of data fab ML teams work with. Ideas: predict <code>yield</code> from upstream features, predict <code>tox_true</code> for un-measured wafers (virtual metrology), or classify fault type.</p>
        <div class="scroll" id="dTable"></div>`;
      $('#dlCsv').onclick = () => {
        const blob = new Blob([sim.csv()], { type: 'text/csv' });
        const a = el('a', { href: URL.createObjectURL(blob), download: `fabsim_wafers_${sim.state.t}.csv` }); document.body.appendChild(a); a.click(); a.remove();
      };
    }
    const n = S.rows.length, cols = S.cols ? S.cols.length : 0;
    $('#dCount').textContent = `${n.toLocaleString()} wafers × ${cols} columns` +
      (S.counts.rows > n ? ` (newest ${n.toLocaleString()} of ${S.counts.rows.toLocaleString()} sorted; older rows roll off to keep the tab light)` : '');
    const show = rows.slice().reverse();
    $('#dTable').innerHTML = show.length ? `<table><tr>${Object.keys(show[0]).map(c => `<th>${c}</th>`).join('')}</tr>${show.map(r => `<tr>${Object.values(r).map(v => `<td>${v}</td>`).join('')}</tr>`).join('')}</table>` : '<p class="muted" style="padding:10px">No sorted wafers yet.</p>';
  }

  function renderLearn() {
    const box = $('#tab-learn'); if (box.dataset.built) return; box.dataset.built = '1';
    box.innerHTML = `<div class="learn">
      <h3>What you are watching</h3>
      <p>A simplified CMOS front-end flow (gate stack → source/drain → first dielectric and metal) running in a virtual fab. 1 tick = 1 simulated minute. A new 25-wafer lot starts every hour. Each step has one tool with a process time, so queues form in front of the slow tools (Sort, Oxidation at ~92% utilisation).</p>
      <h3>Two flows at once</h3>
      <ul>
        <li><b>Physical flow (top row):</b> the wafers. Their physical state (oxide thickness, gate length, dopant dose…) builds up step by step. A thin oxide from step 2 shows up as a Vt failure at step 10, 7 hours later.</li>
        <li><b>Data flow (lanes):</b> every step talks to the data systems.
          <b style="color:var(--MES)">MES</b> logs track-in/out and recipes;
          <b style="color:var(--FDC)">FDC</b> receives sensor traces from every run and alarms on abnormal signatures;
          <b style="color:var(--SPC)">SPC</b> charts sampled metrology and flags out-of-control lots (and MES can place them on hold);
          <b style="color:var(--R2R)">R2R/APC</b> computes recipe corrections — feedback (litho dose, CMP polish time) and feed-forward (litho CD → etch trim time);
          <b style="color:var(--YMS)">YMS</b> receives die-level test results and joins them with everything upstream.</li>
      </ul>
      <h3>Parallel chambers (chamber matching)</h3>
      <p>Etch, ILD deposition and CMP each have <b>two chambers</b>. MES dispatches each lot to the <b>least recently used idle chamber</b>, so both see roughly half the traffic. Each chamber has its own fixed tool-to-tool mismatch, its own wear (hours since PM) and its own R2R correction — so a fault that hits one chamber halves the damage but also makes it <i>findable</i>: open the <b>Chambers</b> tab and yield-per-chamber names the bad tool, while the good chamber keeps running at baseline. This is what yield engineers actually do with wafer-map data: join it to the chamber that ran each step.</p>
      <p>Note what per-chamber R2R does to the fixed mismatch: with R2R on, the two etch chambers converge to the same FI CD (the controllers absorb the offset); with R2R off, the mismatch stays visible (≈0.75 nm apart) and widens the pooled SPC distribution.</p>
      <h3>The fab floor (physical view)</h3>
      <p>Press <b>🏭 Fab floor</b> (or <b>f</b>) for a second view of the <i>same</i> simulation. Nothing is re-timed: it reads the same lot, tool and fault state, and only decides where each FOUP is drawn.</p>
      <ul>
        <li><b>What you see is what happens:</b> a lot is 25 wafers in a FOUP. The FOUP rides the overhead rail (<i>AMHS</i>) from bay to bay, docks at a load port, and only the wafers move inside. The cyan machine shows a dial with the share of its process time already spent.</li>
        <li><b>Click a machine</b> (or cycle with <b>← →</b>) for its cutaway: load port → load lock → transfer chamber → process chamber → unload, with the phase the lot is in right now, plus hours since PM, runs and the R2R correction.</li>
        <li><b>Honest abstraction:</b> a real furnace loads a ~100-wafer boat, not 25, and a real fab moves wafers between dozens of bays over kilometres of rail. The batching and the transport time are not modelled — the floor is a picture of the flow, not a queueing simulation of the building.</li>
        <li><b>First time:</b> the floor opens with a <b>How to read the floor</b> card (six lines, then it stays out of the way). Get it back with the <b>? Guide</b> button in the bar or the <b>?</b> key.</li>
        <li><b>Keyboard:</b> <b>f</b> opens the floor, <b>Esc</b> closes it, <b>p</b> pauses or resumes, <b>← →</b> steps through the bays. Deep link: <code>?floor=1&amp;sel=ETCH-03A</code> (add <code>guide=1</code> to force the card open).</li>
      </ul>
      <h3>Try these experiments</h3>
      <ol>
        <li><b>Turn R2R off</b> and wait ~20 lots. The etch chamber and CMP pad drift with use, so FI CD and post-CMP thickness walk out of spec, and contact resistance follows. Turn R2R back on and they recover.</li>
        <li><b>Scanner focus drift:</b> with R2R the dose loop absorbs most of it (~93% yield). Without R2R yield drops to ~60%. FDC flags the focus error before SPC does.</li>
        <li><b>Furnace thermocouple drift:</b> there is no R2R on oxidation, so oxide thickens, Vt rises and yield collapses. FDC sees the soak-temperature deviation and SPC catches the thickness. This is why fabs need both.</li>
        <li><b>PECVD particles / CMP scratches:</b> metrology means look fine, but wafer maps show center clusters or arcs, and bin 5 (defects) dominates the Pareto. Spatial pattern recognition on wafer maps is a classic CNN use case.</li>
        <li><b>Etch wall build-up</b> (chamber A only), then press <b>PM Etch</b> (both chambers) or use the per-chamber <b>PM</b> button in the step detail — notice PM on one chamber leaves the other's hours untouched.</li>
        <li><b>Chamber attribution:</b> inject a particle or pad scratch, wait a few lots, then open <b>Chambers</b>: the faulted chamber's yield drops while its twin stays at baseline.</li>
        <li><b>See a fault on the floor:</b> open <b>🏭 Fab floor</b>, inject <b>etchSeason</b>, then select <b>ETCH-03A</b> (or use <code>?fault=etchSeason&amp;floor=1&amp;sel=ETCH-03A</code>). That one chamber carries a pulsing red outline while ETCH-03B stays clean — the same evidence the Chambers tab gives you as numbers.</li>
      </ol>
      <h3>Physics models (simplified, directionally real)</h3>
      <ul>
        <li>Oxide: <code>tox ≈ 10nm · e^(0.0125·(T−900))</code> (Arrhenius-like growth)</li>
        <li>Litho CD: <code>90 − 1.6·(dose−30) + 900·focus²</code> (Bossung curve)</li>
        <li>Etch: <code>FI = DI − bias(RF-hours) − trim</code></li>
        <li>Rs: <code>∝ dose^−0.9 · e^−(T−1050)/60</code>; Rc <code>∝ (post-CMP thickness)^1.5</code></li>
        <li>Device: <code>Vt = 0.45 + 0.035·Δtox + 0.004·ΔLg</code>, <code>Idsat ∝ 1/(tox·Lg)</code>, <code>Ioff ∝ e^(−ΔVt/30mV)</code></li>
        <li>Each parameter has a wafer mean, a radial (center-to-edge) profile and die-level noise. Defects kill the die they land on with ~65% probability.</li>
      </ul>
      <h3>Behind this dashboard: a short course</h3>
      <p>If the vocabulary is new, <a href="../index.html">Fab Lab</a> teaches the same engine one idea per screen — 18 lessons, 77 steps, no dashboards. Jump straight to the part a tab here is showing:</p>
      <ul class="xlinks">
        <li><a href="../index.html#/mes/1">MES</a> · <a href="../index.html#/fdc/1">FDC</a> · <a href="../index.html#/spc/1">SPC</a> · <a href="../index.html#/r2r/1">R2R</a> — what the five buses actually do</li>
        <li><a href="../index.html#/chamber-matching/1">Chamber matching</a> — why a fault on one chamber is findable in the Chambers tab</li>
        <li><a href="../index.html#/wafer-maps/1">Wafer maps</a> — a shape is a hypothesis, not a diagnosis</li>
        <li><a href="../index.html#/find-the-fault/1">Find the fault</a> — the four-question loop to practise here</li>
        <li><a href="../index.html#/why-both/1">Why both FDC and SPC</a> — the argument this app is built to make</li>
      </ul></div>`;
  }

  function renderPanel(full) {
    if (activeTab === 'step') renderStep(full);
    else if (activeTab === 'spc') renderSpc(full);
    else if (activeTab === 'yield') renderYield(full);
    else if (activeTab === 'test') renderTest();
    else if (activeTab === 'chambers') renderChambers(full);
    else if (activeTab === 'lot') renderLot(full);
    else if (activeTab === 'data') renderData(full);
    else renderLearn();
  }

  // ---------------- controls ----------------
  let booted = false;
  function newSim() {
    // ?seed= pins the very first run so a link from the course reproduces exactly;
    // Reset (and every later run) goes back to a fresh random seed.
    const pinned = Number(Q.get('seed'));
    const seed = !booted && Q.has('seed') && Number.isFinite(pinned) ? pinned : Date.now() % 100000;
    booted = true;
    sim = createSim({ seed, r2r: $('#r2r').checked, autoHold: $('#autoHold').checked });
    window.sim = sim;   // debug hook: window.sim.state in the console
    sim.on(e => { addEvent(e); spawnPacket(e); });
    packets.forEach(p => p.c.remove()); packets = []; evList.innerHTML = '';
    selLot = null; yieldLot = null; selWafer = 0;
    ['tab-yield', 'tab-test', 'tab-lot', 'tab-data', 'tab-spc', 'tab-chambers'].forEach(id => { const b = document.getElementById(id); b.dataset.built = ''; b.innerHTML = ''; });
    renderPanel(true);
  }
  const fs = $('#faultSel');
  fs.innerHTML = Object.entries(FAULTS).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('');
  $('#btnFault').onclick = () => { if (!sim.state.faults[fs.value]) sim.setFault(fs.value, true); updateFlow(); };
  $('#faultsActive').addEventListener('click', e => { const f = e.target.dataset.clear; if (f) { sim.setFault(f, false); updateFlow(); } });
  $('#btnPmEtch').onclick = () => { sim.pm('ETCH'); renderPanel(true); };
  $('#btnPmCmp').onclick = () => { sim.pm('CMP'); renderPanel(true); };
  $('#r2r').onchange = e => { sim.state.r2r = e.target.checked; addEvent({ t: sim.state.t, sys: 'SIM', msg: `R2R control ${e.target.checked ? 'ENABLED' : 'DISABLED'}`, level: 'warn' }); };
  $('#autoHold').onchange = e => { sim.state.autoHold = e.target.checked; };
  $('#btnReset').onclick = newSim;
  const openFloor = (sel) => FabFloorUI.open({
    select: sel || null,
    getState: () => sim.state,
    pause: () => { playing = !playing; $('#btnPlay').textContent = playing ? '❚❚ Pause' : '▶ Play'; },
    isPlaying: () => playing,
    speed: () => SPEEDS[spd.value],
  });
  $('#btnFloor').onclick = openFloor;
  // f = floor, p = pause (the floor overlay handles its own keys once open)
  document.addEventListener('keydown', e => {
    if (e.target && /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
    if ((e.key === 'f' || e.key === 'F') && !FabFloorUI.isOpen()) { e.preventDefault(); openFloor(); }
  });
  $('#btnPlay').onclick = () => { playing = !playing; $('#btnPlay').textContent = playing ? '❚❚ Pause' : '▶ Play'; };
  const spd = $('#speed'), spdL = $('#speedLbl');
  const updSpd = () => { const v = SPEEDS[spd.value]; spdL.textContent = `${v * 60 >= 60 ? (v * 60 / 60).toFixed(0) + 'h' : v * 60 + 'min'}/s`; };
  spd.oninput = updSpd; updSpd();

  // ---------------- main loop ----------------
  function frame(now) {
    if (playing) {
      acc += SPEEDS[spd.value];
      while (acc >= 1) { sim.tick(); acc -= 1; }
    }
    animPackets(now);
    updateFlow();
    if (now - lastPanel > 300) { lastPanel = now; renderKpis(); renderPanel(false); }
    requestAnimationFrame(frame);
  }

  // control state can be preset by a link, e.g. ?r2r=0 for "watch it drift without the controller"
  if (Q.get('r2r') === '0' || Q.get('r2r') === 'off') $('#r2r').checked = false;
  if (Q.get('autoHold') === '0' || Q.get('autoHold') === 'off') $('#autoHold').checked = false;
  buildFlow(); buildFilters(); newSim(); renderLearn();
  addEventListener('hashchange', () => { showTab(location.hash.slice(1)); renderPanel(true); });
  if (location.hash) showTab(location.hash.slice(1));

  // Shareable scenario links: ?fault=padScratch&speed=4&tab=chambers (speed 0-7, tab = any tab id)
  {
    const q = Q;
    const f = q.get('fault');
    if (f && FAULTS[f]) { fs.value = f; sim.setFault(f, true); updateFlow(); }
    const sp = parseInt(q.get('speed'), 10);
    if (!Number.isNaN(sp) && sp >= 0 && sp <= SPEEDS.length - 1) { spd.value = sp; updSpd(); }
    const t = q.get('tab');
    if (t) showTab(t);
    // ?tab=test&atest=1&thr=2.6&amode=score — the test-floor scenario a lesson hands over
    if (window.FabTestUI) {
      FabTestUI.configure({
        adaptive: q.get('atest') === '1' || q.get('atest') === 'true' || q.get('atest') === 'on' ? true : null,
        thr: Number.isFinite(Number(q.get('thr'))) && q.get('thr') ? Number(q.get('thr')) : null,
        mode: q.get('amode'),
      });
    }
    // ?floor=1 opens the physical view straight away; ?floor=1&sel=ETCH-03A picks a bay
    if (q.has('floor')) openFloor(q.get('sel'));

    // A link back to the course, only if this build actually sits next to one.
    // ?back= is the course's own handoff and wins; otherwise probe once and stay hidden.
    {
      const a = $('#courseLink');
      const back = Q.get('back');
      const safe = window.FabHandoff ? FabHandoff.safeBack(back) : '../index.html';
      if (back) { a.href = safe; a.hidden = false; }
      else fetch('../index.html', { method: 'HEAD' })
        .then(r => { if (r.ok) a.hidden = false; })
        .catch(() => { /* standalone copy of the simulator: no course to link to */ });
    }
  }
  requestAnimationFrame(frame);
  window.__fab = () => sim; // debug handle
})();
