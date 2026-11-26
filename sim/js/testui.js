/* testui.js — the "Test floor (ATE)" tab: a wafer-sort program you can watch and tune.
 *
 * All the arithmetic lives in testplan.js (pure, tested in node). This file is only the
 * view: pick a sorted wafer, run the program, colour the map three different ways, and
 * move the adaptive-test threshold to see test time and escapes trade against each other.
 */
(function (root) {
  'use strict';

  const fmt = (v, n) => v.toLocaleString(undefined, { minimumFractionDigits: n || 0, maximumFractionDigits: n || 0 });

  const st = { lotId: null, wafer: null, mode: 'bin', adaptive: false, thr: 1.6, built: false };

  function doneLots(S) { return (S.lots || []).filter(l => l.status === 'done' && l.wafers[0] && l.wafers[0].dies); }
  function wafersOf(lot) { return lot.wafers.map((w, i) => ({ w, i })).filter(x => x.w && x.w.dies); }

  /* configure(): called once from a deep link before the first render */
  function configure(opts) {
    opts = opts || {};
    if (opts.adaptive != null) st.adaptive = !!opts.adaptive;
    if (opts.thr != null && Number.isFinite(+opts.thr)) st.thr = Math.max(0.6, Math.min(3, +opts.thr));
    if (opts.mode && ['bin', 'score', 'skipped'].includes(opts.mode)) st.mode = opts.mode;
  }

  const ADVICE = {
    cluster: 'Fails touching each other are mechanical: a scratch from a sorter or a pad, or particles that landed together. Look at the handling steps and the CMP pad before you look at a recipe.',
    edge: 'Edge-heavy fails are about the edge: clamp rings, deposition uniformity, handling at the wafer rim. A chamber problem usually shows as a ring, not a circle.',
    centre: 'A centre blob is process, not handling: gas flow, spin-coat, or a hot spot. It is also the shape R2R controllers create when they chase a drifting chamber.',
    random: 'No spatial structure and no adjacency: these are single-die mechanisms — a particle, a probe mark, a mask defect. Only a die-level test catches them.',
    clean: 'Nothing failed on this wafer. That is not the same as a good process — check that the fault list is empty and the yield tab agrees.',
  };

  function build(box, X) {
    box.innerHTML = `
      <div class="row" style="margin-bottom:6px">
        <h3 style="margin:0">Test floor — wafer sort</h3>
        <span class="pill">ATE · 5 sites</span>
        <span class="muted" id="ateSub"></span>
      </div>
      <p class="desc">A real test program, run on the dies this fab actually produced. Left: pick a wafer and a way to look at it. Right: the program, its cost, and what adaptive test would let through. Move the threshold and watch the two numbers disagree.</p>
      <div class="row" style="gap:14px;flex-wrap:wrap;margin:8px 0 10px">
        <label class="muted">wafer <select id="ateW"></select></label>
        <span class="muted">map</span>
        <span class="seg" id="ateMode">
          <button data-m="bin" class="on">bins</button><button data-m="score">score</button><button data-m="skipped">skipped</button>
        </span>
        <label class="muted"><input type="checkbox" id="ateAdapt"> adaptive test</label>
        <label class="muted" id="ateThrWrap">threshold <b id="ateThrV">1.60</b>
          <input type="range" id="ateThr" min="0.6" max="3" step="0.05" value="1.6" style="width:120px;vertical-align:middle">
        </label>
        <span class="seg" id="atePresets">
          <button data-t="0.9">safe</button><button data-t="1.6">balanced</button><button data-t="2.4">cheap</button>
        </span>
      </div>
      <div class="grid2" style="align-items:start">
        <div class="chartbox" style="margin:0">
          <div class="cap"><b id="ateMapCap">Die bins</b><span id="ateMapSub"></span></div>
          <canvas id="ateMap" style="height:320px;width:100%"></canvas>
          <div class="muted" id="ateLegend" style="font-size:11.5px;margin-top:2px;text-align:center"></div>
        </div>
        <div>
          <div class="kpis-mini" style="grid-template-columns:1fr 1fr 1fr">
            <div><b id="ateTime">–</b><span>test time / wafer</span></div>
            <div><b id="ateSaved">–</b><span>time saved</span></div>
            <div><b id="ateDpmo">–</b><span>escapes / million</span></div>
            <div><b id="ateSkip">–</b><span>dies not fully tested</span></div>
            <div><b id="ateEsc">–</b><span>escapes on this wafer</span></div>
            <div><b id="ateOut">–</b><span>ship from this wafer</span></div>
          </div>
          <div class="chartbox" style="margin:10px 0 0">
            <div class="cap"><b>Test program</b><span id="ateProgSub"></span></div>
            <table id="ateProg" style="width:100%;font-size:12px"></table>
          </div>
        </div>
      </div>
      <div class="chartbox" style="margin-top:10px">
        <div class="cap"><b id="ateSigT">Fail signature</b><span id="ateSigS"></span></div>
        <p class="desc" id="ateSig" style="margin:4px 0 0"></p>
      </div>`;

    if (X.S) { /* nothing: state not needed until update */ }
    const S = X.S;
    const lots = doneLots(S);
    if (!st.lotId || !lots.find(l => l.id === st.lotId)) st.lotId = lots.length ? lots.at(-1).id : null;
    const lot = lots.find(l => l.id === st.lotId);
    if (lot) {
      const ws = wafersOf(lot);
      /* start on the second wafer: the first has no earlier wafer to use as reference */
      if (st.wafer == null || !ws.find(x => x.i === st.wafer)) st.wafer = ws.length > 1 ? ws[1].i : ws[0].i;
      $('#ateW').innerHTML = ws.map(x => `<option value="${x.i}">${x.w.id}</option>`).join('');
      $('#ateW').value = String(st.wafer);
    }
    $('#ateW').onchange = e => { st.wafer = +e.target.value; update(box, X); };
    $('#ateMode').onclick = e => {
      const m = e.target.dataset.m; if (!m) return;
      st.mode = m;
      [...$('#ateMode').children].forEach(b => b.classList.toggle('on', b.dataset.m === m));
      update(box, X);
    };
    $('#ateAdapt').checked = st.adaptive;
    $('#ateAdapt').onchange = e => { st.adaptive = e.target.checked; update(box, X); };
    const thr = $('#ateThr');
    thr.value = String(st.thr);
    thr.oninput = e => { st.thr = +e.target.value; update(box, X); };
    $('#atePresets').onclick = e => {
      const t = e.target.dataset.t; if (!t) return;
      st.thr = +t; thr.value = t;
      if (!st.adaptive) { st.adaptive = true; $('#ateAdapt').checked = true; }
      update(box, X);
    };
    st.built = true;
  }

  function update(box, X) {
    const S = X.S, BINS = X.BINS, GRID = X.GRID;
    const lots = doneLots(S);
    if (!lots.length) {
      box.innerHTML = `<h3 style="margin:0 0 6px">Test floor — wafer sort</h3>
        <p class="muted">No lot has reached Wafer Sort yet. The first lot needs ~7 simulated hours — raise the speed, or let it run.
        ${S.sorted && S.sorted.length ? '' : ''}Then come back: the program runs on real dies, not on a picture.</p>`;
      st.built = false; return;
    }
    if (!st.built) { build(box, X); return; }
    const lot = lots.find(l => l.id === st.lotId) || lots.at(-1);
    st.lotId = lot.id;
    const ws = wafersOf(lot);
    const cur = ws.find(x => x.i === st.wafer) || ws.at(-1);
    const dies = cur.w.dies;
    // reference wafer: the one sorted just before this one in the same lot
    const refIdx = ws.findIndex(x => x.i === cur.i);
    const refW = ws[Math.max(0, refIdx - 1)] || ws[0];
    const model = FabTest.fit(refW.w.dies, refW.w.dies);
    const p = FabTest.plan(dies, { model, adaptive: st.adaptive, thr: st.thr });
    const rowOf = new Map(p.dieRows.map(r => [r.die.i + ',' + r.die.j, r]));

    $('#ateSub').textContent = `lot ${lot.id} · wafer ${cur.w.id} · ${dies.length} dies · reference ${refW.w.id}` +
      (refW.w.id === cur.w.id ? ' (first wafer in the lot — no earlier reference)' : '');
    $('#ateThrV').textContent = st.thr.toFixed(2);
    $('#ateThrWrap').style.opacity = st.adaptive ? 1 : .45;

    // ---- map
    const mode = st.mode;
    const colorOf = d => {
      const r = rowOf.get(d.i + ',' + d.j);
      if (mode === 'score') return X.Charts.cmap(Math.min(1, r.score / 3.2));
      if (mode === 'skipped') {
        if (r.escape) return '#e5484d';
        if (r.skipped) return '#3a4a5e';
        return d.bin === 1 ? '#2f6f66' : BINS[d.bin].color;
      }
      return BINS[d.bin].color;
    };
    X.Charts.wafer($('#ateMap'), dies, GRID, colorOf, cur.w.defects && cur.w.defects.length ? cur.w.defects : null);
    const counts = {};
    dies.forEach(d => { counts[d.bin] = (counts[d.bin] || 0) + 1; });
    if (mode === 'bin') {
      $('#ateMapCap').textContent = 'Die bins';
      $('#ateLegend').innerHTML = Object.keys(counts).sort().map(b =>
        `<span style="color:${BINS[b].color}">■</span> bin ${b} ${BINS[b].name} ${counts[b]}`).join(' &nbsp; ');
      $('#ateMapSub').textContent = `${dies.length - (counts[1] || 0)} fails`;
    } else if (mode === 'score') {
      $('#ateMapCap').textContent = 'Risk score (distance from the healthy centre)';
      $('#ateMapSub').textContent = `fitted on ${model.n} good dies of ${refW.w.id}`;
      $('#ateLegend').innerHTML = [0, .25, .5, .75, 1].map(t => `<span style="color:${X.Charts.cmap(t)}">■</span>`).join('') +
        ' &nbsp; 0 → 3.2σ &nbsp; <span class="muted">this is the number the skip rule reads</span>';
    } else {
      $('#ateMapCap').textContent = st.adaptive ? 'What the program skipped' : 'What the program would skip (adaptive off)';
      $('#ateMapSub').textContent = st.adaptive ? `threshold ${st.thr.toFixed(2)}` : 'turn adaptive test on to see it';
      $('#ateLegend').innerHTML = `<span style="color:#2f6f66">■</span> fully tested, passed &nbsp; ` +
        `<span style="color:#3a4a5e">■</span> skipped tests &nbsp; ` +
        `<span style="color:#e5484d">■</span> escaped (skipped a test it would have failed)`;
    }
    $('#ateTime').textContent = `${p.timePerWaferS.toFixed(2)} s`;
    $('#ateSaved').textContent = `${p.savedPct.toFixed(0)}%`;
    $('#ateSaved').className = p.savedPct > 0 ? 'good' : '';
    $('#ateDpmo').textContent = fmt(p.dpmo);
    $('#ateDpmo').className = p.dpmo > 0 ? 'bad' : 'good';
    $('#ateSkip').textContent = `${p.skippedPct.toFixed(0)}%`;
    $('#ateEsc').textContent = String(p.escapes);
    $('#ateEsc').className = p.escapes ? 'bad' : 'good';
    $('#ateOut').textContent = `${p.passOut.toFixed(1)}%`;
    const maxMs = Math.max(...p.per.map(t => t.ms), 1);
    $('#ateProgSub').textContent = `${FabTest.PROGRAM_MS.toFixed(1)} ms/die nominal · ${(dies.length / FabTest.SITES).toFixed(0)} touches at ${FabTest.SITES} sites`;
    $('#ateProg').innerHTML = `<tr class="muted"><th style="text-align:left">test</th><th>ms</th><th>ran</th><th>skipped</th><th>failed</th><th style="text-align:left">cost</th></tr>` +
      p.per.map((t, i) => `<tr>
        <td>${t.id} ${t.name}<div class="muted" style="font-size:10.5px">${FabTest.TESTS[i].what}</div></td>
        <td style="text-align:center">${FabTest.TESTS[i].ms.toFixed(1)}</td>
        <td style="text-align:center">${t.ran}</td>
        <td style="text-align:center">${t.skipped || ''}</td>
        <td style="text-align:center" class="${t.fail ? 'bad' : ''}">${t.fail || ''}</td>
        <td><div style="height:6px;background:#1e2733;border-radius:3px"><div style="height:6px;width:${(t.ms / maxMs * 100).toFixed(0)}%;background:#3fd0c9;border-radius:3px"></div></div></td>
      </tr>`).join('');
    const sig = FabTest.signature(dies);
    $('#ateSigT').textContent = `Fail signature — ${sig.label}`;
    $('#ateSigS').textContent = `${(sig.rate * 100).toFixed(1)}% of dies failed`;
    $('#ateSig').innerHTML = `${sig.detail}. <br><span class="muted">${ADVICE[sig.kind] || ''}</span> ` +
      `<span class="muted">A classifier on a 16×16 map is a heuristic, not a proof — this is the "wafer-map pattern recognition" job, before the model.</span>`;
  }

  /* one place that resolves a selector, used by both build() and update(); callers pass '#id' */
  const $ = sel => document.querySelector(sel);

  root.FabTestUI = {
    configure,
    render(box, X) { if (!st.built) build(box, X); update(box, X); },
    reset: () => { st.built = false; },
    state: st,
  };
})(typeof window !== 'undefined' ? window : globalThis);
