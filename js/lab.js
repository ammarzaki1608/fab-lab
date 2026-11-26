/* lab.js — Fab Lab UI: router, sidebars, lesson rendering, live demos.
 * Depends on iso.js (figures), content.js (course), sim.js (the engine, for demos).
 */
(function () {
  'use strict';
  const { COURSE, LESSONS } = window.FABLAB;
  const $ = s => document.querySelector(s);
  const el = (tag, cls, parent, html) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    if (parent) parent.appendChild(n);
    return n;
  };
  const mean = a => a.reduce((s, x) => s + x, 0) / (a.length || 1);
  // colours come from the stylesheet so the canvases follow the chosen tone
  const tk = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

  const DONE_KEY = 'fabLabDone';
  const state = { lessonId: LESSONS[0].id, step: 0, done: new Set(load()) };

  function load() { try { return JSON.parse(localStorage.getItem(DONE_KEY)) || []; } catch (e) { return []; } }
  function save() { try { localStorage.setItem(DONE_KEY, JSON.stringify([...state.done])); } catch (e) { /* private mode */ } }
  const lesson = () => LESSONS.find(l => l.id === state.lessonId) || LESSONS[0];
  const stepCount = l => (l.steps || []).length;

  // ---------------- routing ----------------
  function parse() {
    const parts = (location.hash || '').replace(/^#\/?/, '').split('/').filter(Boolean);
    const l = LESSONS.find(x => x.id === parts[0]);
    if (l) state.lessonId = l.id;
    state.step = Math.max(0, Math.min(stepCount(lesson()) - 1, (parseInt(parts[1], 10) || 1) - 1));
  }
  function go(lessonId, step) {
    const l = LESSONS.find(x => x.id === lessonId) || LESSONS[0];
    const s = Math.max(0, Math.min(stepCount(l) - 1, step == null ? 0 : step));
    location.hash = `#/${l.id}/${s + 1}`;
  }
  addEventListener('hashchange', () => { parse(); render(); window.scrollTo(0, 0); });

  // ---------------- sidebar ----------------
  function renderSidebar() {
    const nav = $('#course'); nav.innerHTML = '';
    COURSE.forEach(ch => {
      const box = el('section', 'chap', nav);
      const done = ch.lessons.filter(l => state.done.has(l.id)).length;
      const head = el('button', 'chap-head', box);
      head.innerHTML = `<span class="chap-no">${ch.no}</span><span class="chap-title">${ch.title}</span>
        <span class="chap-count">${done}/${ch.lessons.length}</span>`;
      head.setAttribute('aria-expanded', 'true');
      const list = el('ul', 'lessons', box);
      ch.lessons.forEach(l => {
        const li = el('li', null, list);
        const a = el('a', 'lesson-link' + (l.id === state.lessonId ? ' on' : '') + (state.done.has(l.id) ? ' done' : ''));
        a.href = `#/${l.id}/1`;
        a.innerHTML = `<span class="tick">${state.done.has(l.id) ? '✓' : ''}</span><span class="lt">${l.title}</span>`;
        li.appendChild(a);
      });
      head.onclick = () => {
        const open = list.hasAttribute('hidden');
        if (open) list.removeAttribute('hidden'); else list.setAttribute('hidden', '');
        head.setAttribute('aria-expanded', String(open));
      };
    });
    const total = LESSONS.length, d = LESSONS.filter(l => state.done.has(l.id)).length;
    $('#progressLine').innerHTML = `<b>${d}</b> / ${total} lessons done
      <span class="bar"><i style="width:${Math.round(100 * d / total)}%"></i></span>`;
    $('#navProgress').textContent = `${d}/${total}`;
    $('#lessonTotal').textContent = `${total} lessons`;
    applyFilter();
  }

  // ---------------- centre: title + figure ----------------
  function renderCentre() {
    const l = lesson(), ch = l.chapter;
    $('#lessonMeta').innerHTML = `<span class="pill dark">${ch.no} ${ch.title}</span>
      <span class="micro">LESSON ${l.indexInChapter + 1} OF ${ch.lessons.length}</span>`;
    $('#lessonTitle').textContent = l.title;
    drawFigure();
  }

  /* The figure and its caption. Step-level figures override the lesson default, and a
   * tone switch repaints through here so the canvas matches the page. */
  const CAPS = {
    layers: 'Every chip is a stack: substrate, oxide, gate, dielectric, metal.',
    foup: 'A FOUP holds 25 wafers and never opens in the fab air.',
    pile: 'Work content is hours; time in the building is weeks.',
    flow: 'Tools along the AMHS rail: the lot moves, the wafers wait.',
    wafer: 'One wafer, 188 dies. The map is the physics, seen from above.',
    twins: 'Twin chambers: same recipe, different machines.',
    chart: 'Control chart: limits from the process, not from the spec.',
  };
  function figureKind() {
    const l = lesson();
    const s = l.steps[state.step];
    return (s && s.figure) || l.figure || 'wafer';
  }
  function drawFigure(caps) {
    const fig = $('#figure');
    const kind = figureKind();
    Iso.draw(fig, kind, {});
    const cap = fig.parentElement.querySelector('.fig-cap');
    if (cap) cap.textContent = (caps || CAPS)[kind] || '';
  }

  // ---------------- handoff to the instrument ----------------
  // The link contract lives in handoff.js so the course and the simulator cannot disagree
  // about parameter names; see that file for what a scenario link carries.
  const { simHref, jumpHref } = window.FabHandoff;

  // The instrument is one click from the header, not only from inside a lesson step.
  for (const [id, kind] of [['#jumpSim', 'sim'], ['#jumpFloor', 'floor']]) {
    const a = $(id);
    if (a) a.href = jumpHref(kind);
  }

  // ---------------- right: the step panel ----------------
  function renderStep() {
    const l = lesson(), steps = l.steps, s = steps[state.step];
    const panel = $('#stepPanel'); panel.innerHTML = '';

    const head = el('div', 'step-head', panel);
    head.innerHTML = `<span class="micro">STEP ${state.step + 1} / ${steps.length}</span>
      <span class="pill accent">${s.tag || 'CONCEPT'}</span>`;
    el('h2', 'step-title', panel, s.head);
    (s.body || []).forEach(p => el('p', 'step-body', panel, p));
    if (s.note) {
      const n = el('div', 'notice', panel);
      n.innerHTML = `<span class="notice-dot"></span><div>${s.note}</div>`;
    }
    if (s.go) {
      const go = el('div', 'go', panel);
      const a = el('a', 'go-link', go, `${s.go.label || 'Open this scenario in FabSim'} <span aria-hidden="true">↗</span>`);
      a.href = simHref(s.go, l.id, state.step + 1);
      a.rel = 'noopener';
      if (s.go.hint) el('p', 'go-hint', go, s.go.hint);
    }
    if (s.demo) panel.appendChild(buildDemo(s.demo));

    // dots + nav
    const dots = el('div', 'dots', panel);
    steps.forEach((_, i) => {
      const d = el('button', 'dot' + (i === state.step ? ' on' : '') + (i < state.step ? ' past' : ''));
      d.setAttribute('aria-label', `Step ${i + 1}`);
      d.onclick = () => go(l.id, i);
      dots.appendChild(d);
    });

    const nav = el('div', 'step-nav', panel);
    const back = el('button', 'btn ghost', nav, '← Back');
    back.disabled = state.step === 0;
    back.onclick = () => (state.step > 0 ? go(l.id, state.step - 1) : prevLesson());
    const last = state.step === steps.length - 1;
    const nextLabel = last ? 'Finish lesson ✓' : `Next: ${steps[state.step + 1].head.toLowerCase()}`;
    const next = el('button', 'btn accent', nav, `${nextLabel} →`);
    next.onclick = () => {
      if (!last) return go(l.id, state.step + 1);
      state.done.add(l.id); save();
      const i = LESSONS.indexOf(l);
      if (i + 1 < LESSONS.length) go(LESSONS[i + 1].id, 0); else { render(); }
    };
    $('#stepCount').textContent = `${state.step + 1}/${steps.length}`;
  }
  function prevLesson() {
    const i = LESSONS.indexOf(lesson());
    if (i > 0) go(LESSONS[i - 1].id, stepCount(LESSONS[i - 1]) - 1);
  }
  function nextLesson() {
    const i = LESSONS.indexOf(lesson());
    if (i + 1 < LESSONS.length) go(LESSONS[i + 1].id, 0);
  }

  // ---------------- live demos (powered by sim.js) ----------------
  function buildDemo(kind) {
    const wrap = el('div', 'demo');
    const barEl = el('div', 'demo-bar', wrap);
    el('span', 'demo-tag', barEl, 'LIVE');
    el('span', 'demo-note', barEl, 'computed by the simulation engine, not hard-coded');
    const btn = el('button', 'btn small', barEl, 'Run ▸');
    const out = el('div', 'demo-out', wrap);
    out.innerHTML = '<p class="muted">Press Run: the engine simulates a few hundred lots in your browser.</p>';
    btn.onclick = () => { btn.disabled = true; btn.textContent = 'Running…'; setTimeout(() => { try { DEMOS[kind](out); } catch (e) { out.innerHTML = `<p class="muted">Demo failed: ${e.message}</p>`; } btn.disabled = false; btn.textContent = 'Run again ▸'; }, 30); };
    return wrap;
  }

  const DEMOS = {
    // 3 of 25 wafers measured: how little is actually known
    sampling(out) {
      out.innerHTML = '';
      const cv = el('canvas', 'demo-canvas', out);
      const dpr = Math.min(2, devicePixelRatio || 1), w = Math.max(260, out.clientWidth || 340), h = 128;
      cv.width = w * dpr; cv.height = h * dpr; cv.style.height = h + 'px';
      const c = cv.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0);
      const sampled = [0, 12, 24];
      for (let i = 0; i < 25; i++) {
        const x = 12 + i * ((w - 24) / 25), isS = sampled.includes(i);
        c.beginPath(); c.arc(x + 8, 52, 8, 0, 7);
        c.fillStyle = isS ? tk('--accent') : tk('--die'); c.fill();
        c.strokeStyle = isS ? tk('--ink') : tk('--die-edge'); c.lineWidth = isS ? 1.8 : 1; c.stroke();
        if (!isS) { c.fillStyle = tk('--muted2'); c.font = '600 8px sans-serif'; c.textAlign = 'center'; c.fillText('?', x + 8, 55); }
        c.fillStyle = isS ? tk('--ink') : tk('--muted2'); c.font = '600 9px sans-serif'; c.fillText(String(i + 1), x + 8, 74);
      }
      c.fillStyle = tk('--muted'); c.font = '600 10px sans-serif'; c.textAlign = 'left';
      c.fillText('25 wafers in the lot — 3 measured (filled), 22 unknown', 14, 100);
      c.fillText(`15 measurements per lot instead of ${188 * 25} die tests`, 14, 116);
      el('p', 'muted', out, 'Measurement is slow and expensive, so it is sampled. The other 22 wafers are estimated from the 3 — that estimation is what virtual metrology models do, and this lab hands you the data for it.');
    },

    // a real die map from a sorted lot
    wafermap(out) {
      out.innerHTML = '';
      const sim = FabSim.createSim({ seed: 9 });
      for (let t = 0; t < 900; t++) sim.tick();
      const S = sim.state;
      const lot = S.done && S.done.length ? S.done[S.done.length - 1] : S.lots.find(l => l.wafers[0].dies);
      const w = lot.wafers[0];
      const cv = el('canvas', 'demo-canvas', out);
      const dpr = Math.min(2, devicePixelRatio || 1), size = 260;
      cv.width = size * dpr; cv.height = size * dpr; cv.style.width = size + 'px'; cv.style.height = size + 'px';
      const c = cv.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0);
      const R = size / 2 - 8, cx = size / 2, cy = size / 2, cell = (R * 2) / FabSim.GRID;
      const colors = { 1: tk('--layer-1'), 2: tk('--layer-2'), 3: tk('--layer-3'), 4: tk('--layer-4'), 5: tk('--accent') };
      w.dies.forEach(d => {
        const x = cx - R + d.i * cell, y = cy - R + d.j * cell;
        c.fillStyle = colors[d.bin] || tk('--die'); c.fillRect(x, y, cell - 1, cell - 1);
      });
      c.beginPath(); c.arc(cx, cy, R, 0, 7); c.strokeStyle = tk('--ink'); c.lineWidth = 1.6; c.stroke();
      const fails = w.dies.filter(d => d.bin !== 1).length;
      el('p', 'demo-read', out, `<b>${lot.id} · wafer ${w.id}</b> — ${w.dies.length} dies, ${fails} failed (${(w.yield * 100).toFixed(1)}% yield). Look at where the highlighted dies sit: a ring, a cluster or a scatter. That shape is the fingerprint of the mechanism.`);
    },

    // real control chart of the etch final CD
    spc(out) {
      out.innerHTML = '';
      const sim = FabSim.createSim({ seed: 7 });
      for (let t = 0; t < 2600; t++) sim.tick();
      const pts = sim.state.spc.fiCD;
      const cv = el('canvas', 'demo-canvas', out);
      const dpr = Math.min(2, devicePixelRatio || 1), w = Math.max(260, out.clientWidth || 340), h = 190;
      cv.width = w * dpr; cv.height = h * dpr; cv.style.height = h + 'px';
      const c = cv.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0);
      const x0 = 44, x1 = w - 14, y0 = 16, y1 = h - 28;
      const last = pts[pts.length - 1], lo = last.lcl - 2, hi = last.ucl + 2;
      const yOf = v => y1 - (v - lo) / (hi - lo) * (y1 - y0);
      c.strokeStyle = tk('--die-edge'); c.lineWidth = 1;
      c.beginPath(); c.moveTo(x0, y1); c.lineTo(x1, y1); c.moveTo(x0, y1); c.lineTo(x0, y0); c.stroke();
      [[last.ucl, 'UCL'], [last.cl, 'CL'], [last.lcl, 'LCL']].forEach(([v, name], i) => {
        c.setLineDash(i === 1 ? [] : [5, 4]); c.strokeStyle = i === 1 ? tk('--muted2') : tk('--accent');
        c.beginPath(); c.moveTo(x0, yOf(v)); c.lineTo(x1, yOf(v)); c.stroke(); c.setLineDash([]);
        c.fillStyle = tk('--muted'); c.font = '600 9px sans-serif'; c.textAlign = 'right'; c.fillText(name, x0 - 6, yOf(v) + 3);
      });
      const n = pts.length, stepX = (x1 - x0) / Math.max(1, n - 1);
      c.strokeStyle = tk('--soft-ink'); c.lineWidth = 1;
      pts.forEach((p, i) => { const x = x0 + i * stepX, y = yOf(p.v); i ? c.lineTo(x, y) : c.moveTo(x, y); }); c.stroke();
      pts.forEach((p, i) => {
        const x = x0 + i * stepX, y = yOf(p.v);
        c.beginPath(); c.arc(x, y, p.ooc ? 3.6 : 2.4, 0, 7); c.fillStyle = p.ooc ? tk('--accent') : tk('--ink'); c.fill();
      });
      c.fillStyle = tk('--muted'); c.font = '600 10px sans-serif'; c.textAlign = 'left';
      c.fillText(`FI CD, nm — ${n} lots, ${pts.filter(p => p.ooc).length} out of control`, x0, h - 8);
      el('p', 'demo-read', out, `Limits are frozen from the first 40 lots: CL ${last.cl.toFixed(1)}, UCL ${last.ucl.toFixed(1)}, LCL ${last.lcl.toFixed(1)} nm. ${last.phase === 'II' ? 'Phase II is watching.' : 'Still in Phase I.'} A slow drift shows up as a run on one side long before any point breaks a limit.`);
    },

    // yield with control vs without, same fault
    r2r(out) {
      out.innerHTML = '';
      const runOne = on => {
        const sim = FabSim.createSim({ seed: 11, r2r: on, autoHold: false });
        for (let t = 0; t < 3000; t++) { if (t === 900) sim.setFault('etchSeason', true); sim.tick(); }
        const ys = sim.state.sorted.filter(x => x.t > 900).map(x => x.yield);
        return { y: mean(ys), n: ys.length };
      };
      const closed = runOne(true), open = runOne(false);
      const cv = el('canvas', 'demo-canvas', out);
      const dpr = Math.min(2, devicePixelRatio || 1), w = Math.max(260, out.clientWidth || 340), h = 210;
      cv.width = w * dpr; cv.height = h * dpr; cv.style.height = h + 'px';
      const c = cv.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0);
      c.fillStyle = tk('--panel'); c.fillRect(0, 0, w, h);
      const bars = [
        { label: 'R2R on', v: closed.y * 100, text: (closed.y * 100).toFixed(1) + '%', color: tk('--green'), sub: `${closed.n} lots` },
        { label: 'R2R off', v: open.y * 100, text: (open.y * 100).toFixed(1) + '%', color: tk('--accent'), sub: `${open.n} lots` },
      ];
      // scale from 80% so the difference is visible but not exaggerated
      const base = 80, max = 100, bw = 74;
      bars.forEach((b, i) => {
        const cx = w / 2 + (i - 0.5) * 170;
        const frac = Math.max(0.02, (b.v - base) / (max - base)), bh = (h - 96) * frac, y = h - 58;
        c.fillStyle = b.color; c.strokeStyle = tk('--ink'); c.lineWidth = 1.6;
        c.beginPath(); c.roundRect ? c.roundRect(cx - bw / 2, y - bh, bw, bh, 3) : c.rect(cx - bw / 2, y - bh, bw, bh);
        c.fill(); c.stroke();
        c.fillStyle = tk('--ink'); c.font = '700 15px sans-serif'; c.textAlign = 'center';
        c.fillText(b.text, cx, y - bh - 12);
        c.font = '600 11px sans-serif'; c.fillStyle = tk('--muted'); c.fillText(b.sub, cx, y - bh + 16);
        c.font = '700 11px sans-serif'; c.fillStyle = tk('--ink'); c.fillText(b.label, cx, y + 18);
      });
      c.strokeStyle = tk('--die-edge'); c.beginPath(); c.moveTo(30, h - 58); c.lineTo(w - 30, h - 58); c.stroke();
      c.fillStyle = tk('--muted'); c.font = '600 9px sans-serif'; c.textAlign = 'left'; c.fillText('yield, axis starts at 80%', 30, h - 44);
      el('p', 'demo-read', out, `Identical fault (etchSeason injected at the same point), identical seed: only the control loop differs. The closed-loop fab absorbs most of it; the open-loop fab loses ${((closed.y - open.y) * 100).toFixed(1)} points of yield. The controller did not fix the chamber — it hid it.`);
    },
  };

  // ---------------- render ----------------
  function render() {
    renderSidebar();
    renderCentre();
    renderStep();
    const l = lesson();
    document.title = `${l.title} · Fab Lab`;
    $('#crumb').innerHTML = `${l.chapter.no} ${l.chapter.title} <span class="sep">/</span> ${l.title}`;
    $('#nextHint').textContent = `Lesson ${l.n} of ${LESSONS.length}`;
  }

  // ---------------- colour tone ----------------
  /* Three light tones, all defined as CSS custom properties in css/style.css. The figure
   * canvas reads the same properties via Iso.refresh(), so one switch repaints everything. */
  const TONE_KEY = 'fabLabTone', TONES = ['cleanroom', 'moss', 'indigo'];
  function applyTone(name, opts) {
    const tone = TONES.indexOf(name) >= 0 ? name : TONES[0];
    document.documentElement.setAttribute('data-tone', tone);
    document.querySelectorAll('.tone').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.tone === tone)));
    try { localStorage.setItem(TONE_KEY, tone); } catch (e) { /* private mode */ }
    Iso.refresh();
    if (!opts || opts.repaint !== false) drawFigure();
  }
  function loadTone() {
    // ?tone=moss wins, so a tone can be linked to (and screenshotted) without clicking
    const q = new URLSearchParams(location.search).get('tone');
    if (TONES.indexOf(q) >= 0) return q;
    try { return localStorage.getItem(TONE_KEY) || TONES[0]; } catch (e) { return TONES[0]; }
  }
  $('#tones').addEventListener('click', e => {
    const b = e.target.closest('.tone');
    if (b) applyTone(b.dataset.tone);
  });

  // ---------------- keys ----------------
  addEventListener('keydown', e => {
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    if (e.key === 'ArrowRight') { e.preventDefault(); state.step < stepCount(lesson()) - 1 ? go(state.lessonId, state.step + 1) : nextLesson(); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); state.step > 0 ? go(state.lessonId, state.step - 1) : prevLesson(); }
  });

  // ---------------- search ----------------
  function applyFilter() {
    const q = ($('#search').value || '').trim().toLowerCase();
    document.querySelectorAll('#course .chap').forEach(chap => {
      let shown = 0;
      chap.querySelectorAll('.lesson-link').forEach(a => {
        const hit = !q || a.textContent.toLowerCase().includes(q);
        a.parentElement.hidden = !hit;
        if (hit) shown++;
      });
      chap.hidden = shown === 0;
    });
  }
  $('#search').addEventListener('input', applyFilter);
  $('#search').addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      const first = [...document.querySelectorAll('#course .lesson-link')].find(a => !a.parentElement.hidden);
      if (first) { go(first.getAttribute('href').slice(2).split('/')[0], 0); $('#search').blur(); }
    }
  });
  addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); $('#search').focus(); }
  });

  // ---------------- glossary ----------------
  const gloss = $('#glossary');
  $('#glossaryBtn').onclick = e => { e.preventDefault(); gloss.showModal(); };
  $('#glossClose').onclick = () => gloss.close();
  gloss.addEventListener('click', e => { if (e.target === gloss) gloss.close(); });

  // sidebar toggle on narrow screens
  $('#menuBtn').onclick = () => document.body.classList.toggle('nav-open');
  document.addEventListener('click', e => {
    if (document.body.classList.contains('nav-open') && !e.target.closest('.sidebar') && !e.target.closest('#menuBtn')) document.body.classList.remove('nav-open');
  });

  applyTone(loadTone(), { repaint: false });   // before the first paint, so there is no flash
  parse();
  render();
  addEventListener('resize', () => drawFigure());
})();
