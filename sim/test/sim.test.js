const test = require('node:test');
const assert = require('node:assert');
const F = require('../../engine/sim.js');

const run = (opts, ticks, faultAt, faults = []) => {
  const s = F.createSim({ seed: 11, autoHold: false, ...opts });
  for (let t = 0; t < ticks; t++) { if (t === faultAt) faults.forEach(f => s.setFault(f, true)); s.tick(); }
  return s;
};
const postYield = (s, after) => F.mean(s.state.sorted.filter(x => x.t > after).map(x => x.yield));

test('lots flow through all 10 steps and get sorted', () => {
  const s = run({}, 2000);
  assert.ok(s.state.sorted.length > 15);
  const lot = s.state.lots.find(l => l.status === 'done');
  assert.deepStrictEqual(lot.hist.map(h => h.step), F.STEPS.map(x => x.id));
});

test('same seed => identical results (reproducible)', () => {
  const a = run({}, 1500), b = run({}, 1500);
  assert.deepStrictEqual(a.state.sorted.map(x => x.yield), b.state.sorted.map(x => x.yield));
});

test('healthy fab: high yield, no SPC false alarms with R2R', () => {
  const s = run({}, 4000);
  assert.ok(postYield(s, 0) > 0.97);
  const ooc = Object.values(s.state.spc).reduce((n, a) => n + a.filter(p => p.ooc).length, 0);
  assert.ok(ooc <= 5, `ooc=${ooc}`); // ~200 Phase-II points: a few false alarms are statistically expected
});

test('without R2R, etch & CMP drift push FI CD and post-CMP thickness out of control', () => {
  const closed = run({}, 8000).state, open = run({ r2r: false }, 8000).state;
  const tail = a => F.mean(a.slice(-20).map(p => p.v));
  const ooc = a => a.filter(p => p.ooc).length;
  // open loop drifts away from target ...
  assert.ok(tail(open.spc.postCmp) > 315, `post-CMP ${tail(open.spc.postCmp).toFixed(1)} nm`);
  assert.ok(tail(open.spc.fiCD) < 79, `FI CD ${tail(open.spc.fiCD).toFixed(1)} nm`);
  // ... and SPC catches it, on both characteristics
  assert.ok(ooc(open.spc.postCmp) > 10 && ooc(open.spc.fiCD) > 3);
  // while closed loop stays put
  assert.ok(Math.abs(tail(closed.spc.postCmp) - 300) < 4 && ooc(closed.spc.postCmp) <= 3);
  assert.ok(Math.abs(tail(closed.spc.fiCD) - 80) < 0.8 && ooc(closed.spc.fiCD) <= 2);
});

test('R2R absorbs scanner focus drift; open loop does not', () => {
  const on = run({ r2r: true }, 4000, 1500, ['focusDrift']);
  const off = run({ r2r: false }, 4000, 1500, ['focusDrift']);
  assert.ok(postYield(on, 2400) - postYield(off, 2400) > 0.2);
});

test('furnace drift: FDC alarms, SPC flags oxide thickness, and failures are parametric not defect', () => {
  const s = run({}, 4000, 1500, ['furnaceDrift']);
  assert.ok(s.state.fdc.OX.some(x => x.alarm));
  assert.ok(s.state.spc.tox.filter(p => p.ooc).length > 10);
  const last = s.state.sorted.at(-1);
  const bin = b => last.bins[b] || 0;
  // a thicker gate oxide costs drive current (bin 3) and eventually Vt (bin 2) — not defects (bin 5)
  assert.ok(bin(3) + bin(2) > bin(5) * 2, `parametric ${bin(2) + bin(3)} vs defect ${bin(5)}`);
  assert.ok(postYield(s, 2600) < 0.97);
});

test('particle excursion shows up as defect bin, not as a metrology shift', () => {
  const s = run({}, 4000, 1500, ['particles']);
  const last5 = s.state.sorted.slice(-5);
  const def = last5.reduce((n, x) => n + (x.bins[5] || 0), 0);
  assert.ok(def > 300, `defect dies=${def}`);
  assert.ok(s.state.spc.ild.slice(-10).every(p => p.v > 480 && p.v < 520));
});

test('PM on a chamber resets only that chamber', () => {
  const s = run({}, 2000);
  const S = s.state;
  assert.ok(S.tools['ETCH-03A'].hours > 0 && S.tools['ETCH-03B'].hours > 0);
  const bHours = S.tools['ETCH-03B'].hours;
  s.pm('ETCH-03A');
  assert.strictEqual(S.tools['ETCH-03A'].hours, 0);
  assert.strictEqual(S.tools['ETCH-03B'].hours, bHours);
});

test('MES balances lot dispatch across parallel chambers', () => {
  const s = run({}, 3000);
  const ts = s.state.toolStats;
  for (const pair of [['ETCH-03A', 'ETCH-03B'], ['PECVD-02A', 'PECVD-02B'], ['CMP-01A', 'CMP-01B']]) {
    const [a, b] = pair.map(n => ts[n].lots);
    assert.ok(a > 0 && b > 0, `both chambers used: ${pair} ${a}/${b}`);
    assert.ok(Math.abs(a - b) / Math.max(a, b) < 0.3, `balanced: ${pair} ${a}/${b}`);
  }
});

test('a chamber-specific fault is attributable by chamber-level yield analysis', () => {
  const s = run({}, 4000, 1500, ['etchSeason']);
  const ts = s.state.toolStats;
  const ya = ts['ETCH-03A'].pass / ts['ETCH-03A'].dies, yb = ts['ETCH-03B'].pass / ts['ETCH-03B'].dies;
  assert.ok(yb - ya > 0.02, `chamber A ${ya.toFixed(3)} vs B ${yb.toFixed(3)}`);
  assert.ok(s.state.fdc.ETCH.some(x => x.alarm && x.tool === 'ETCH-03A'));
  assert.ok(!s.state.fdc.ETCH.some(x => x.alarm && x.tool === 'ETCH-03B'));
});

test('per-chamber R2R matches the chambers; open loop leaves the mismatch visible', () => {
  const delta = st => {
    const a = st.toolStats['ETCH-03A'].params.fiCD, b = st.toolStats['ETCH-03B'].params.fiCD;
    return Math.abs(F.mean(a) - F.mean(b));
  };
  const closed = run({}, 4000).state, open = run({ r2r: false }, 4000).state;
  assert.ok(delta(closed) < 0.2, `closed loop should match chambers: ${delta(closed).toFixed(2)} nm`);
  assert.ok(delta(open) > 0.4, `open loop should expose mismatch: ${delta(open).toFixed(2)} nm`);
});

test('auto-hold puts OOC lots on hold and releases them', () => {
  const s = F.createSim({ seed: 11, autoHold: true });
  for (let t = 0; t < 3500; t++) { if (t === 800) s.setFault('furnaceDrift', true); s.tick(); }
  const evs = s.state.events.map(e => e.type);
  assert.ok(evs.includes('hold') && evs.includes('release'));
});

test('dataset: one row per sorted wafer with true/meas/recipe/fdc/yield columns', () => {
  const s = run({}, 3000);
  const d = s.dataset();
  assert.strictEqual(d.length, s.state.sorted.length * 25);
  for (const c of ['tox_true', 'tox_meas', 'litho_dose', 'etch_trim_s', 'etch_chamber', 'cvd_chamber', 'cmp_chamber', 'fdc_ETCH', 'defects', 'yield']) assert.ok(c in d[0], c);
  assert.strictEqual(d.filter(r => r.sampled).length, s.state.sorted.length * 3);
});

// ---- long-running tab: memory stays bounded, totals stay exact ----
const KEEP_SMALL = { doneLots: 12, dieMaps: 5, sorted: 20, rows: 300, spc: 50, params: 10 };

test('retention: windows are capped while all-time counters keep counting', () => {
  const s = run({ keep: KEEP_SMALL }, 4000);
  const S = s.state;
  assert.ok(S.counts.sorted > 40, `enough lots sorted to exceed every window: ${S.counts.sorted}`);
  assert.strictEqual(S.done.length, KEEP_SMALL.doneLots);
  assert.ok(S.lots.filter(l => l.status === 'done').length === KEEP_SMALL.doneLots);
  assert.strictEqual(S.lots.filter(l => l.wafers[0].dies).length, KEEP_SMALL.dieMaps, 'die maps only for the newest lots');
  assert.strictEqual(S.sorted.length, KEEP_SMALL.sorted);
  assert.strictEqual(S.rows.length, KEEP_SMALL.rows);
  assert.strictEqual(S.counts.rows, S.counts.sorted * 25);
  Object.values(S.spc).forEach(a => assert.ok(a.length <= KEEP_SMALL.spc));
  Object.values(S.toolStats).forEach(ts => Object.values(ts.params).forEach(a => assert.ok(a.length <= KEEP_SMALL.params)));
  // the newest rows belong to the newest sorted lots
  assert.strictEqual(s.dataset(1)[0].lot, S.sorted.at(-1).lot);
});

test('retention does not change the physics: capped and uncapped runs agree', () => {
  const a = run({ keep: KEEP_SMALL }, 4000, 1500, ['etchSeason']).state;
  const b = run({}, 4000, 1500, ['etchSeason']).state;
  assert.strictEqual(a.counts.sorted, b.counts.sorted);
  assert.strictEqual(a.counts.ooc, b.counts.ooc);
  assert.strictEqual(a.counts.fdcAlarms, b.counts.fdcAlarms);
  assert.deepStrictEqual(a.sorted.map(x => x.yield), b.sorted.slice(-KEEP_SMALL.sorted).map(x => x.yield));
  assert.deepStrictEqual(a.spcSigma, b.spcSigma, 'Phase I limits are frozen, not recomputed from a moving window');
});

test('counters match the underlying events (nothing double-counted)', () => {
  const s = run({}, 3000, 800, ['furnaceDrift']);
  const S = s.state;
  assert.strictEqual(S.counts.sorted, S.sorted.length);
  assert.strictEqual(S.counts.ooc, Object.values(S.spc).reduce((n, a) => n + a.filter(p => p.ooc).length, 0));
  assert.ok(S.counts.fdcAlarms > 0);
});

test('csv(): header + one line per row, same width, quoted when needed', () => {
  const s = run({}, 2500);
  const lines = s.csv().trimEnd().split('\n');
  assert.strictEqual(lines[0], s.state.cols.join(','));
  assert.strictEqual(lines.length - 1, s.state.rows.length);
  lines.forEach(l => assert.strictEqual(l.split(',').length, s.state.cols.length));
  // object view and CSV agree on a value
  const last = s.dataset(1)[0];
  assert.ok(lines.at(-1).startsWith(`${last.lot},${last.wafer},`));
});

test('wafer sort tool gets per-tool stats like every other tool', () => {
  const s = run({}, 2500);
  const ts = s.state.toolStats['TEST-01'];
  assert.strictEqual(ts.lots, s.state.counts.sorted);
  assert.ok(ts.dies > 0 && ts.pass > 0 && ts.pass <= ts.dies);
});
