/* testplan.js — the test floor as arithmetic, not a picture.
 *
 * Pure functions, no DOM, so the browser tab and the node tests run exactly the same code.
 * Everything here is a model of what a wafer-sort test program does:
 *
 *   - an ordered program of tests, each with a limit and a bin
 *   - a die that fails a test stops there (cheap tests first)
 *   - test time = milliseconds per test per die, shared across SITES parallel sites
 *   - a *risk score* computed only from tests that have already run (plus position),
 *     which is what lets an adaptive program skip the rest of the program for a die
 *   - an escape counter: a skipped die that would have failed a later test. This is the
 *     number that decides whether adaptive test is saving money or shipping scrap.
 *
 * The bin semantics reproduce engine/sim.js exactly (same limits, same order:
 * continuity → Vt → Ioff → Idsat → kill), so a plan's bins can be compared to the
 * engine's own bins in the tests.
 */
(function (root) {
  'use strict';

  const SITES = 5;                     // dies touched at once

  // key/limits mirror engine/sim.js sortWafer(); order = bin precedence in the engine
  const TESTS = [
    { id: 'T1', name: 'Continuity', key: 'rc', unit: 'Ω', lsl: 14, usl: 26, ms: 3.2, bin: 6,
      what: 'probe contact + metal short/open' },
    { id: 'T2', name: 'Vt', key: 'vt', unit: 'V', lsl: 0.40, usl: 0.50, ms: 6.5, bin: 2,
      what: 'threshold voltage, the gate-oxide/vt signature' },
    { id: 'T3', name: 'Ioff', key: 'ioff', unit: 'nA/µm', usl: 50, ms: 8.0, bin: 4,
      what: 'off-state leakage, the standby-power signature' },
    { id: 'T4', name: 'Idsat', key: 'idsat', unit: 'µA/µm', lsl: 540, usl: 660, ms: 5.5, bin: 3,
      what: 'drive current, the speed-grade signature' },
    { id: 'T5', name: 'Scan / functional', key: null, unit: 'pass/fail', ms: 14.0, bin: 5,
      what: 'pattern test — the only test that sees a defect, costs the most' },
  ];
  const PROGRAM_MS = TESTS.reduce((a, t) => a + t.ms, 0);

  const pass = (t, d) => {
    if (t.key == null) return d.bin !== 5;                    // functional: engineered pass
    const v = d[t.key];
    return (t.lsl == null || v >= t.lsl) && (t.usl == null || v <= t.usl);
  };

  /* Program bins: first failure in program order wins. Matches the engine's precedence. */
  function binFor(d) {
    for (const t of TESTS) if (!pass(t, d)) return t.bin;
    return 1;
  }

  const mean = a => a.reduce((x, y) => x + y, 0) / (a.length || 1);
  /* engine dies carry x,y but not r (only the DIES mask has it) */
  const rad = d => (d.r != null ? d.r : Math.hypot(d.x || 0, d.y || 0));
  const std = a => { const m = mean(a); return Math.sqrt(mean(a.map(x => (x - m) ** 2))) || 1e-9; };

  /* The reference population: dies that passed the whole program on a known-good wafer.
   * This is the only data a real adaptive program gets to train on before HVM —
   * which is exactly why it has never seen a fail. */
  function fit(dies, refDies) {
    const good = dies.filter(d => d.bin === 1);
    const src = good.length > 20 ? good : dies;
    const m = {}, s = {};
    TESTS.filter(t => t.key).forEach(t => {
      m[t.key] = mean(src.map(d => d[t.key]));
      s[t.key] = std(src.map(d => d[t.key]));
    });
    // wafer-to-wafer spatial feature: what the same die position did on the previous
    // wafer of this lot. Scratches land in the same place every wafer; random defects do not.
    const ref = new Map();
    (refDies || []).forEach(d => ref.set(d.i + ',' + d.j, d.bin === 1 ? 1 : 0));
    return { m, s, n: src.length, r0: mean(src.map(rad)), rs: std(src.map(rad)),
             ref: ref.size ? ref : null, refP: 3.0 };
  }

  /* Risk score: Mahalanobis with a diagonal covariance (i.e. z-scores added in quadrature)
   * over the tests that have already run, plus radial position.
   *
   * The point of scoring *partial* results is the whole trick: after two cheap tests you
   * already know whether this die looks like the healthy centre, and that is enough to
   * decide whether the 14 ms functional test is worth running. A real program uses many
   * more features (upstream FDC, same-wafer neighbours, historical lot); two are enough
   * to show the trade-off honestly. */
  function score(d, model, keys, opts) {
    opts = opts || {};
    const ks = keys || TESTS.filter(t => t.key).map(t => t.key);
    let acc = 0;
    ks.forEach(k => { const z = (d[k] - model.m[k]) / model.s[k]; acc += z * z; });
    let terms = ks.length;
    if (opts.radial !== false && model.rs > 0) {
      const zr = (rad(d) - model.r0) / model.rs;
      acc += (opts.radialWeight == null ? 0.35 : opts.radialWeight) * zr * zr;
      terms++;
    }
    if (opts.ref !== false && model.ref) {          // 0 = same die failed on the wafer before
      const r = model.ref.get(d.i + ',' + d.j);
      if (r === 0) { acc += model.refP == null ? 3.0 : model.refP; terms++; }
    }
    return Math.sqrt(acc / Math.max(1, terms));     // RMS z: ~1 for a healthy die, 3+ for a bad one
  }

  /* Run the program. opts: {adaptive:boolean, thr:number, model, ref:boolean}
   *
   * The adaptive rule is the one real fabs use, in two tiers:
   *   1. a die whose parametric fingerprint is *very* close to the healthy centre may skip
   *      the Idsat test as well as the functional test (aggressive tier);
   *   2. a die that merely looks normal may skip the functional test (normal tier);
   *   3. a die that failed at this position on the previous wafer is never skipped —
   *      that is the one "free" feature available without another measurement.
   * Tiers keep the model honest: the aggressive one is small, so its errors stay small.
   */
  function plan(dies, opts) {
    opts = opts || {};
    const model = opts.model || fit(dies, opts.refDies);
    const adaptive = !!opts.adaptive;
    const thr = opts.thr == null ? 1.6 : opts.thr;
    const coreThr = thr * 0.45;
    const useRef = opts.ref !== false && !!model.ref;
    const per = TESTS.map(t => ({ id: t.id, name: t.name, ran: 0, fail: 0, ms: 0, skipped: 0 }));
    let ms = 0, skippedDies = 0, escapes = 0, caught = 0, blocked = 0;
    const escapeBins = {};
    const dieRows = [];

    dies.forEach(d => {
      const mine = [];
      let stop = false;
      const sc3 = adaptive ? score(d, model, ['rc', 'vt', 'ioff'], { ref: false }) : 0;
      const refFail = useRef && model.ref.get(d.i + ',' + d.j) === 0;
      if (adaptive && useRef && refFail) blocked++;

      for (let i = 0; i < TESTS.length; i++) {
        const t = TESTS[i];
        if (stop) { mine.push({ id: t.id, ran: false, why: 'binned' }); continue; }
        // may this die walk past test i without paying for it?
        let skip = false;
        if (adaptive && !refFail) {
          if (i === 3) skip = sc3 < coreThr;                                    // aggressive tier
          if (i === 4) {
            const scAll = score(d, model, ['rc', 'vt', 'ioff', 'idsat'], { ref: false });
            skip = scAll < thr;
          }
        }
        if (skip) { per[i].skipped++; mine.push({ id: t.id, ran: false, why: 'skipped' }); continue; }
        per[i].ran++; per[i].ms += t.ms; ms += t.ms;
        const ok = pass(t, d);
        mine.push({ id: t.id, ran: true, ok });
        if (!ok) { per[i].fail++; stop = true; caught++; }
      }

      let esc = false;
      const anySkip = mine.some(m => m.why === 'skipped');
      if (anySkip) {
        skippedDies++;
        for (let j = 0; j < TESTS.length; j++) {
          if (mine[j].why === 'skipped' && !pass(TESTS[j], d)) {
            esc = true; escapes++;
            escapeBins[TESTS[j].bin] = (escapeBins[TESTS[j].bin] || 0) + 1;
            break;
          }
        }
      }
      dieRows.push({ die: d, bin: binFor(d), skipped: anySkip, escape: esc, score: score(d, model) });
    });

    const n = dies.length || 1;
    const fullMs = n * PROGRAM_MS;
    return {
      model, thr, adaptive, n, dies,
      per, dieRows,
      testMs: ms,
      fullMs,
      timePerWaferS: ms / SITES / 1000,
      fullTimePerWaferS: fullMs / SITES / 1000,
      savedPct: 100 * (1 - ms / (fullMs || 1)),
      skippedDies, skippedPct: 100 * skippedDies / n,
      escapes, caught, blocked,
      escapeBins,
      dpmo: Math.round(escapes / n * 1e6),
      passOut: 100 * (n - caught - escapes) / n,
    };
  }

  /* Fail-signature classification from die positions and bins — the "wafer-map pattern
   * recognition" a real ML model does, reduced to the two statistics that actually
   * separate the common shapes: where the fails are (radial) and whether they touch. */
  function signature(dies) {
    const n = dies.length || 1;
    const fail = dies.filter(d => d.bin !== 1);
    if (!fail.length) return { kind: 'clean', label: 'no fails', rate: 0, edge: 0, centre: 0, clustered: 0, detail: 'every die passed — nothing to explain' };
    const rate = fail.length / n;
    const ring = (lo, hi) => { const g = dies.filter(d => rad(d) >= lo && rad(d) < hi); return g.length ? g.filter(d => d.bin !== 1).length / g.length : 0; };
    const edge = ring(0.7, 2), centre = ring(0, 0.45);
    // neighbour test on the 16x16 grid the dies came from
    const key = d => d.i + ',' + d.j;
    const failSet = new Set(fail.map(key));
    const NB = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
    let nb = 0;
    fail.forEach(d => {
      NB.forEach(([di, dj]) => { if (failSet.has((d.i + di) + ',' + (d.j + dj))) nb++; });
    });
    const clustered = nb / (fail.length * NB.length);   // 8-neighbour adjacency
    /* Hypothesis ranking. Three statistics, each normalised against "what you would see
     * anyway": radial concentration (edge or centre vs the wafer average) and 8-neighbour
     * adjacency. Strongest wins; nothing strong enough means random. A ring scores high on
     * adjacency too — its dies touch — so radial evidence has to be ranked by strength,
     * not by order of the if-statements. */
    const kEdge = rate > 0 ? edge / rate : 0;
    const kCentre = rate > 0 ? centre / rate : 0;
    const cand = [];
    if (kEdge >= 1.6 && edge >= 0.05) cand.push({ kind: 'edge', k: kEdge, label: 'edge ring — handling or deposition' });
    if (kCentre >= 1.6 && centre >= 0.05) cand.push({ kind: 'centre', k: kCentre, label: 'centre blob — process, not handling' });
    if (clustered >= 0.4) cand.push({ kind: 'cluster', k: clustered / 0.4, label: 'clustered — mechanical or particles' });
    cand.sort((a, b) => b.k - a.k);
    const kind = cand.length ? cand[0].kind : 'random';
    const label = cand.length ? cand[0].label : 'random defects';

    return { kind, label, rate, edge, centre, clustered,
      detail: `edge ${(edge * 100).toFixed(1)}% vs centre ${(centre * 100).toFixed(1)}%, ` +
              `${(clustered * 100).toFixed(0)}% of fails touch another fail` };
  }

  /* Adaptive-test sweep: the whole trade-off in one array, for the chart in the tab.
   * Returns points of {thr, savedPct, dpmo} with a fixed program, so the curve is the
   * model's, not the run's. */
  function sweep(dies, model, opts) {
    const pts = [];
    for (let thr = 1.0; thr <= 4.01; thr += 0.25) {
      const p = plan(dies, Object.assign({}, opts, { adaptive: true, thr, model }));
      pts.push({ thr: +thr.toFixed(2), savedPct: +p.savedPct.toFixed(1), dpmo: p.dpmo, escapes: p.escapes });
    }
    return pts;
  }

  const api = { SITES, TESTS, PROGRAM_MS, binFor, pass, fit, score, plan, signature, sweep };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FabTest = api;
})(typeof window !== 'undefined' ? window : globalThis);
