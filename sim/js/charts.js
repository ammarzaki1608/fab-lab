/* Tiny canvas chart helpers (no dependencies). */
(function (root) {
  'use strict';
  function setup(cv) {
    const dpr = window.devicePixelRatio || 1;
    const w = cv.clientWidth || 300, h = cv.clientHeight || 150;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
    const ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
    return { ctx, w, h };
  }
  const fmt = v => Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(2);

  /* line chart
   * opts: { series:[{pts:[y...], color, dots, dotColors?}], hlines:[{y,color,dash,label}], yMin,yMax, xLabels? }
   */
  function line(cv, opts) {
    const { ctx, w, h } = setup(cv);
    const pad = { l: 44, r: 8, t: 8, b: 16 };
    const all = [];
    opts.series.forEach(s => s.pts.forEach(v => Number.isFinite(v) && all.push(v)));
    (opts.hlines || []).forEach(l => all.push(l.y));
    if (!all.length) { ctx.fillStyle = '#7f8da0'; ctx.font = '12px system-ui'; ctx.fillText('waiting for data…', 12, h / 2); return; }
    let lo = opts.yMin ?? Math.min(...all), hi = opts.yMax ?? Math.max(...all);
    if (hi - lo < 1e-9) { hi += 1; lo -= 1; }
    const m = (hi - lo) * 0.08; lo -= m; hi += m;
    const n = Math.max(...opts.series.map(s => s.pts.length), 2);
    const X = i => pad.l + (w - pad.l - pad.r) * (n === 1 ? 0.5 : i / (n - 1));
    const Y = v => pad.t + (h - pad.t - pad.b) * (1 - (v - lo) / (hi - lo));
    // grid
    ctx.strokeStyle = '#1e2733'; ctx.lineWidth = 1; ctx.fillStyle = '#7f8da0'; ctx.font = '10px ui-monospace,monospace';
    for (let k = 0; k <= 4; k++) {
      const v = lo + (hi - lo) * k / 4, y = Y(v);
      ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(w - pad.r, y); ctx.stroke();
      ctx.fillText(fmt(v), 4, y + 3);
    }
    (opts.hlines || []).forEach(l => {
      ctx.strokeStyle = l.color; ctx.setLineDash(l.dash || []); ctx.beginPath();
      ctx.moveTo(pad.l, Y(l.y)); ctx.lineTo(w - pad.r, Y(l.y)); ctx.stroke(); ctx.setLineDash([]);
      if (l.label) { ctx.fillStyle = l.color; ctx.fillText(l.label, w - pad.r - ctx.measureText(l.label).width - 2, Y(l.y) - 3); }
    });
    opts.series.forEach(s => {
      ctx.strokeStyle = s.color; ctx.lineWidth = s.width || 1.4; ctx.beginPath();
      let started = false;
      s.pts.forEach((v, i) => { if (!Number.isFinite(v)) return; if (!started) { ctx.moveTo(X(i), Y(v)); started = true; } else ctx.lineTo(X(i), Y(v)); });
      ctx.stroke();
      if (s.dots) s.pts.forEach((v, i) => {
        if (!Number.isFinite(v)) return;
        ctx.fillStyle = (s.dotColors && s.dotColors[i]) || s.color;
        ctx.beginPath(); ctx.arc(X(i), Y(v), s.dotColors && s.dotColors[i] && s.dotColors[i] !== s.color ? 3.5 : 2.2, 0, 7); ctx.fill();
      });
    });
    if (opts.xLabel) { ctx.fillStyle = '#7f8da0'; ctx.fillText(opts.xLabel, pad.l, h - 3); }
  }

  /* horizontal bar chart: items [{label, value, color}] */
  function bars(cv, items, opts = {}) {
    const { ctx, w, h } = setup(cv);
    if (!items.length) { ctx.fillStyle = '#7f8da0'; ctx.font = '12px system-ui'; ctx.fillText('waiting for data…', 12, h / 2); return; }
    const max = Math.max(...items.map(i => i.value), 1e-9);
    const rowH = Math.min(26, (h - 8) / items.length), lw = opts.labelW || 130;
    ctx.font = '11px system-ui';
    items.forEach((it, k) => {
      const y = 4 + k * rowH;
      ctx.fillStyle = '#b8c3d1'; ctx.fillText(it.label, 4, y + rowH * 0.65);
      const bw = (w - lw - 60) * it.value / max;
      ctx.fillStyle = it.color; ctx.fillRect(lw, y + 3, Math.max(1, bw), rowH - 6);
      ctx.fillStyle = '#d7dee8'; ctx.font = '10.5px ui-monospace,monospace';
      ctx.fillText(opts.fmt ? opts.fmt(it.value) : String(it.value), lw + bw + 4, y + rowH * 0.65); ctx.font = '11px system-ui';
    });
  }

  /* wafer map: dies [{i,j,...}], colorFn(die) -> css color; defects [{x,y}] optional */
  function wafer(cv, dies, grid, colorFn, defects, opts = {}) {
    const { ctx, w, h } = setup(cv);
    const size = Math.min(w, h), ox = (w - size) / 2, oy = (h - size) / 2, R = size / 2 - 2;
    ctx.fillStyle = '#1a222d'; ctx.beginPath(); ctx.arc(ox + size / 2, oy + size / 2, R, 0, 7); ctx.fill();
    // notch
    ctx.fillStyle = '#0f141c'; ctx.beginPath(); ctx.arc(ox + size / 2, oy + size - 2, Math.max(2, size * 0.02), 0, 7); ctx.fill();
    const cell = (2 * R) / grid * 0.98, gap = opts.thumb ? 0.4 : 1;
    const toPx = (x, y) => [ox + size / 2 + x * R / 1.0 * 0.98, oy + size / 2 - y * R * 0.98];
    dies.forEach(d => {
      const [px, py] = toPx(d.x, d.y);
      ctx.fillStyle = colorFn(d);
      ctx.fillRect(px - cell / 2 + gap / 2, py - cell / 2 + gap / 2, cell - gap, cell - gap);
    });
    if (defects && defects.length) {
      ctx.fillStyle = '#ffffff';
      defects.forEach(df => { const [px, py] = toPx(df.x, df.y); ctx.beginPath(); ctx.arc(px, py, opts.thumb ? 0.9 : 1.8, 0, 7); ctx.fill(); });
    }
    return { toDie(mx, my) {
      let best = null, bd = 1e9;
      dies.forEach(d => { const [px, py] = toPx(d.x, d.y); const dd = (px - mx) ** 2 + (py - my) ** 2; if (dd < bd) { bd = dd; best = d; } });
      return bd < cell * cell ? best : null;
    } };
  }

  // continuous colormap (viridis-ish)
  function cmap(t) {
    t = Math.max(0, Math.min(1, t));
    const stops = [[68, 1, 84], [59, 82, 139], [33, 145, 140], [94, 201, 98], [253, 231, 37]];
    const s = t * (stops.length - 1), i = Math.min(stops.length - 2, Math.floor(s)), f = s - i;
    const c = stops[i].map((v, k) => Math.round(v + (stops[i + 1][k] - v) * f));
    return `rgb(${c[0]},${c[1]},${c[2]})`;
  }

  root.Charts = { line, bars, wafer, cmap };
})(window);
