/* Fab floor overlay — the DOM half of the physical view.
 *
 * Owns a full-window canvas, the click/hover handling and the cutaway panel.
 * All geometry lives in floor.js; this file only turns simulation state into
 * pixels and text. Nothing here mutates the simulation.
 */
(function (root) {
  'use strict';
  const FF = root.FabFloor || (typeof require === 'function' ? require('./floor.js') : null);

  const el = (tag, cls, html) => { const n = document.createElement(tag); if (cls) n.className = cls; if (html != null) n.innerHTML = html; return n; };
  let ctx = null, canvas = null, side = null, bar = null, wrap = null, guide = null;
  let view = FF.createFloor();
  let raf = null, last = 0, getState = null, hooks = {};
  let lastState = null, lastSel = null, hover = null, mouse = { x: 0, y: 0 };

  function build() {
    if (wrap) return;
    wrap = el('div', 'floor-view');
    wrap.hidden = true;
    bar = el('div', 'floor-bar');
    bar.innerHTML = `
      <b>Fab floor</b>
      <span class="muted">wafers travel as FOUPs on the overhead rail · click a tool for the inside</span>
      <span class="grow"></span>
      <label class="muted" style="display:flex;gap:6px;align-items:center">follow
        <select id="fvFollow"><option value="">none</option></select></label>
      <button id="fvGuide" title="How to read this view (?)">? Guide</button>
      <button id="fvPause">❚❚ Pause</button>
      <button id="fvClose" class="primary">✕ Close</button>`;
    const body = el('div', 'floor-body');
    canvas = el('canvas', 'floor-canvas');
    side = el('aside', 'floor-side');
    body.append(canvas, side);
    guide = el('div', 'floor-guide');
    guide.hidden = true;
    guide.innerHTML = `
      <div class="fg-head"><b>How to read the floor</b><span class="grow"></span>
        <button id="fgClose">Got it</button></div>
      <ol class="fg-steps">
        <li><b>One box = one tool.</b> The name is area + number; a letter suffix is a twin chamber
            doing the same step (<code>ETCH-03A</code> / <code>ETCH-03B</code>).</li>
        <li><b>The line under the name</b> is the lot inside that tool right now, or <code>idle</code>.</li>
        <li><b>The amber dial</b> is how much of this run's process time is already spent (0–100%).
            No dial = the tool is empty.</li>
        <li><b>FOUPs</b> are boxes of 25 wafers. They ride the rail between bays; a number by a tool
            means lots queued there waiting for it.</li>
        <li><b>A red pulsing outline</b> means an injected fault sits on that tool — and only there.
            That is the same evidence the Chambers tab gives you as numbers.</li>
        <li><b>Click a machine</b> (or use <kbd>←</kbd> <kbd>→</kbd>) for the inside:
            load port → load lock → transfer → process chamber → unload, with the phase the lot is in.</li>
      </ol>
      <div class="fg-keys">
        <span><kbd>f</kbd> open</span><span><kbd>p</kbd> pause</span>
        <span><kbd>←</kbd> <kbd>→</kbd> next tool</span><span><kbd>?</kbd> this guide</span>
        <span><kbd>Esc</kbd> close</span>
      </div>
      <p class="fg-try">Try this: press <kbd>Esc</kbd>, inject <b>etchSeason</b> in the header, press
        <kbd>f</kbd> again — one etch chamber turns red while its twin stays clean.</p>`;
    wrap.append(bar, body, guide);
    document.body.append(wrap);

    canvas.addEventListener('mousemove', e => {
      const r = canvas.getBoundingClientRect();
      mouse = { x: e.clientX - r.left, y: e.clientY - r.top };
      const b = FF.pick(mouse.x, mouse.y, r.width, r.height);
      hover = b ? { x: b.x, y: b.y, h: b.h } : null;
      canvas.style.cursor = b ? 'pointer' : 'default';
    });
    canvas.addEventListener('click', e => {
      const r = canvas.getBoundingClientRect();
      const b = FF.pick(e.clientX - r.left, e.clientY - r.top, r.width, r.height);
      view.selected = b ? b.name : null;
      lastSel = null;                       // force the panel to rebuild
      if (guideOpen()) showGuide(false);
    });
    bar.querySelector('#fvGuide').onclick = () => showGuide(true);
    guide.querySelector('#fgClose').onclick = () => showGuide(false);
    bar.querySelector('#fvClose').onclick = close;
    bar.querySelector('#fvPause').onclick = () => { if (hooks.pause) hooks.pause(); syncPause(); };
    bar.querySelector('#fvFollow').onchange = e => { view.follow = e.target.value || null; };
  }

  function syncPause() {
    const playing = hooks.isPlaying ? hooks.isPlaying() : true;
    const b = bar && bar.querySelector('#fvPause');
    if (b) b.textContent = playing ? '❚❚ Pause' : '▶ Play';
  }

  function showGuide(on) {
    if (!guide) return;
    guide.hidden = !on;
    const b = bar && bar.querySelector('#fvGuide');
    if (b) b.classList.toggle('on', !!on);
    if (on) { try { localStorage.setItem('fabFloorGuide', '1'); } catch (e) { /* private mode */ } }
  }
  const guideOpen = () => !!guide && !guide.hidden;

  function open(opts) {
    hooks = opts || {};
    getState = hooks.getState;
    build();
    wrap.hidden = false;
    document.body.classList.add('floor-open');
    const st = getState();
    if (st !== lastState) { view = FF.createFloor(); lastState = st; }
    if (opts.select && FF.bayByName[opts.select]) view.selected = opts.select;
    lastSel = null; last = 0;
    syncPause();
    refreshFollow();
    const q = new URLSearchParams(location.search).get('guide');   // ?guide=1 / ?guide=0 overrides first-run
    let seen = false;
    try { seen = !!localStorage.getItem('fabFloorGuide'); } catch (e) { seen = false; }
    showGuide(q === '1' ? true : q === '0' ? false : !seen);
    renderSide(st); lastSel = view.selected;      // panel is correct before the first frame
    if (!raf) raf = requestAnimationFrame(frame);
    addEventListener('keydown', onKey);
  }

  function close() {
    if (!wrap) return;
    wrap.hidden = true;
    showGuide(false);
    document.body.classList.remove('floor-open');
    if (raf) { cancelAnimationFrame(raf); raf = null; }
    removeEventListener('keydown', onKey);
  }

  function onKey(e) {
    if (e.key === '?' || e.key === 'h' || e.key === 'H') { showGuide(!guideOpen()); e.preventDefault(); return; }
    if (e.key === 'Escape') { if (guideOpen()) { showGuide(false); return; } close(); return; }
    if (e.key === 'p' || e.key === 'P') { if (hooks.pause) hooks.pause(); syncPause(); return; }
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {      // step through the bays without the mouse
      const d = e.key === 'ArrowRight' ? 1 : -1;
      const i = FF.BAYS.findIndex(b => b.name === view.selected);
      const n = i < 0 ? (d > 0 ? 0 : FF.BAYS.length - 1) : (i + d + FF.BAYS.length) % FF.BAYS.length;
      view.selected = FF.BAYS[n].name;
      lastSel = null;
      e.preventDefault();
    }
  }
  const isOpen = () => !!wrap && !wrap.hidden;

  function refreshFollow() {
    if (!bar) return;
    const sel = bar.querySelector('#fvFollow');
    const st = getState();
    const live = st.lots.filter(l => l.status !== 'done').slice(-14).reverse();
    const cur = view.follow || '';
    sel.innerHTML = `<option value="">none</option>` + live.map(l => `<option value="${l.id}">${l.id} · ${st.steps[l.step] ? st.steps[l.step].id : ''}</option>`).join('');
    sel.value = live.some(l => l.id === cur) ? cur : '';
    view.follow = sel.value || null;
  }

  function frame(now) {
    if (!isOpen()) { raf = null; return; }
    const dt = last ? Math.min(0.06, (now - last) / 1000) : 0.016;
    last = now;
    const st = getState();
    if (st !== lastState) { view = FF.createFloor(); lastState = st; lastSel = null; }
    FF.step(view, st, dt, hooks.speed ? Math.sqrt(hooks.speed()) : 1);

    const dpr = root.devicePixelRatio || 1;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (w > 80 && h > 80) {                       // no layout yet (or hidden): keep animating, skip drawing
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
      }
      ctx = canvas.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      FF.draw(ctx, w, h, st, view, { hover });
    }

    if (view.selected !== lastSel) { renderSide(st); lastSel = view.selected; }
    updateSide(st);
    raf = requestAnimationFrame(frame);
  }

  // ---------------- side panel ----------------
  const chip = (t, cls) => `<span class="pill ${cls || ''}">${t}</span>`;

  function renderSide(st) {
    if (!side) return;
    if (!view.selected) {
      const live = st.lots.filter(l => l.status !== 'done');
      const proc = live.filter(l => l.status === 'processing').length;
      const hold = live.filter(l => l.status === 'hold').length;
      const queued = live.length - proc - hold;
      const moving = Object.values(view.foups).filter(f => f.status !== 'done' && f.path.length).length;
      side.innerHTML = `
        <h3 style="margin:0 0 4px">Inside the fab</h3>
        <p class="muted" style="margin-top:0">A lot never leaves its FOUP. The FOUP rides the overhead rail between bays, docks at a load port, and only the wafers move inside the tool.</p>
        <div class="kpis-mini">
          <div><b>${proc}</b><span>processing</span></div>
          <div><b>${queued}</b><span>queued</span></div>
          <div><b>${moving}</b><span>on the rail</span></div>
          <div><b>${hold}</b><span>on hold</span></div>
        </div>
        <p class="muted">Click any machine for its cutaway (or step through the bays with ← →): load port → load lock → transfer chamber → process chamber, with the phase the lot is in right now.</p>
        <div class="side-note">Every hop you see costs real cycle time: this fab runs ~6.5 h per lot at 25 wafers. A production fab is weeks, because of queues, batching and rework — not because the tools are slow.</div>`;
      return;
    }
    const bay = FF.bayByName[view.selected];
    const info = FF.toolAt(st, view.selected);
    const twins = FF.BAYS.filter(b => b.step === bay.step && b.name !== bay.name).map(b => b.name);
    const phases = FF.PHASES[bay.kind] || FF.PHASES.cluster;
    side.innerHTML = `
      <h3 style="margin:0 0 2px">${bay.name}</h3>
      <div class="muted" style="margin-bottom:8px">${bay.area}${info ? ' · runs step ' + info.step.id : ''}${twins.length ? ' · twin: ' + twins.join(', ') : ''}</div>
      <div id="fvState"></div>
      <div class="phase-strip" id="fvPhases">${phases.map((p, i) => `<div class="ph" data-i="${i}" style="flex:${p.f}"><span>${p.t}</span></div>`).join('')}</div>
      <div class="wafer-track"><div class="wafer-track-rail"></div><div class="wafer-dot" id="fvWafer"></div><div class="wafer-label" id="fvPhaseLbl"></div></div>
      <div id="fvStats" class="side-kv"></div>
      <div class="side-note">The inside sequence is a labelled abstraction of a real machine — the sim tracks timing and wafer state, not gas flow or plasmas.</div>`;
  }

  function updateSide(st) {
    if (!side || !view.selected) {
      // keep the overview numbers fresh without rebuilding the DOM
      if (side && !view.selected && side.dataset.tick !== String(Math.floor(st.t / 5))) {
        side.dataset.tick = String(Math.floor(st.t / 5));
        const live = st.lots.filter(l => l.status !== 'done');
        const proc = live.filter(l => l.status === 'processing').length;
        const hold = live.filter(l => l.status === 'hold').length;
        const moving = Object.values(view.foups).filter(f => f.status !== 'done' && f.path.length).length;
        const nums = side.querySelectorAll('.kpis-mini b');
        if (nums.length === 4) { nums[0].textContent = proc; nums[1].textContent = live.length - proc - hold; nums[2].textContent = moving; nums[3].textContent = hold; }
      }
      return;
    }
    const bay = FF.bayByName[view.selected];
    const info = FF.toolAt(st, view.selected);
    if (!info) return;
    const tool = info.tool;
    const busy = tool.busy;
    const pi = FF.phaseIndex(tool, st);
    const phases = FF.PHASES[bay.kind] || FF.PHASES.cluster;
    const dur = busy ? tool.busyUntil - busy._tin : 0;
    const prog = busy && dur > 0 ? Math.max(0, Math.min(1, (st.t - busy._tin) / dur)) : 0;
    const faulted = Object.keys(st.faults || {}).find(k => FF.isFaultOnTool(k, bay.name));

    const stEl = side.querySelector('#fvState');
    if (stEl) stEl.innerHTML = busy
      ? `${chip('RUNNING', 'warn')} ${chip(busy.id)} <span class="muted">step ${info.step.id} · ${Math.round(prog * 100)}% · phase ${pi + 1}/${phases.length}</span>`
      : `${chip(faulted ? 'FAULTED' : 'IDLE', faulted ? 'bad' : 'good')} <span class="muted">waiting for the next lot</span>`;

    side.querySelectorAll('#fvPhases .ph').forEach((n, i) => {
      n.classList.toggle('cur', busy && i === pi);
      n.classList.toggle('done', busy && i < pi);
    });
    const dot = side.querySelector('#fvWafer'), lbl = side.querySelector('#fvPhaseLbl');
    if (dot) { dot.style.left = busy ? `calc(${(prog * 100).toFixed(1)}% - 7px)` : '-20px'; dot.style.opacity = busy ? 1 : 0; }
    if (lbl) lbl.textContent = busy ? phases[pi].t : '';

    const stats = side.querySelector('#fvStats');
    if (stats) {
      const wears = info.step.id === 'ETCH' || info.step.id === 'CMP';   // only these tools accrue PM hours
      const controls = wears || info.step.id === 'LITHO';
      const rows = [];
      if (wears) rows.push(['Hours since PM', `${tool.hours.toFixed(1)} h <span class="muted">/ ${info.step.id === 'ETCH' ? 60 : 50} h</span>`]);
      rows.push(['Runs total', tool.runs != null ? tool.runs : '—']);
      if (controls) rows.push(['R2R correction', (tool.corr > 0 ? '+' : '') + (tool.corr || 0).toFixed(2)]);
      rows.push(['Lot in tool', busy ? busy.id + ' (' + busy.wafers.length + ' wafers)' : '—']);
      rows.push(['Fault', faulted ? chip(faulted, 'bad') : '<span class="muted">none</span>']);
      stats.innerHTML = rows.map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('');
    }
  }

  root.FabFloorUI = { open, close, isOpen, refreshFollow, syncPause };
})(typeof globalThis !== 'undefined' ? globalThis : this);
