/* test/testplan.test.js — the test floor's arithmetic, checked against the engine.
 *
 * These tests are the reason the tab can be trusted: the program's bins must equal the
 * engine's bins die for die, the time must be the sum of the tests actually run, and an
 * "escape" must mean exactly one thing — a die that was not tested and would have failed.
 */
const test = require('node:test');
const assert = require('node:assert');
const { createSim } = require('../engine/sim.js');
const T = require('../sim/js/testplan.js');

/* run a seed until one lot has been through wafer sort */
function sortedLot(seed = 9, fault = null) {
  const sim = createSim({ seed, r2r: true, autoHold: true });
  if (fault) sim.setFault(fault, true);
  let guard = 0;
  while (!sim.state.lots.some(l => l.status === 'done' && l.wafers[0].dies) && guard++ < 60000) sim.tick();
  const lot = sim.state.lots.filter(l => l.status === 'done' && l.wafers[0].dies).at(-1);
  assert.ok(lot, 'a lot reached wafer sort');
  return lot;
}

test('program limits reproduce the engine bins exactly', () => {
  for (const seed of [9, 11, 23]) {
    const lot = sortedLot(seed);
    lot.wafers.forEach(w => {
      if (!w.dies) return;
      w.dies.forEach(d => assert.strictEqual(T.binFor(d), d.bin, `seed ${seed} die ${d.i},${d.j}`));
    });
  }
});

test('the fixed program costs one full pass per die and nothing more', () => {
  const dies = sortedLot(9).wafers[0].dies;
  const p = T.plan(dies, {});
  assert.strictEqual(p.adaptive, false);
  assert.strictEqual(p.escapes, 0, 'nothing was skipped, so nothing can escape');
  assert.strictEqual(p.skippedDies, 0);
  // a die binned out early costs less than a full pass, so total <= full pass
  assert.ok(p.testMs <= p.n * T.PROGRAM_MS);
  assert.ok(p.testMs > p.n * T.PROGRAM_MS * 0.9, 'most dies do see most of the program');
  // 188 dies / 5 sites
  assert.ok(Math.abs(p.timePerWaferS - p.testMs / T.SITES / 1000) < 1e-9);
});

test('adaptive test saves time and every escape is a die that skipped a test it failed', () => {
  const lot = sortedLot(23, 'padScratch');
  const dies = lot.wafers[3].dies;
  const model = T.fit(lot.wafers[0].dies, lot.wafers[0].dies);
  const off = T.plan(dies, { model });
  const on = T.plan(dies, { model, adaptive: true, thr: 1.8 });
  assert.ok(on.savedPct > off.savedPct, `adaptive saved ${on.savedPct.toFixed(1)}% vs ${off.savedPct.toFixed(1)}%`);
  assert.ok(on.skippedDies > 0);

  // independent re-check of the escape definition
  const byKey = new Map(on.dieRows.map(r => [r.die.i + ',' + r.die.j, r]));
  let expected = 0;
  dies.forEach(d => {
    const r = byKey.get(d.i + ',' + d.j);
    const wouldFail = T.TESTS.some(t => !T.pass(t, d));
    if (r.skipped && wouldFail) expected++;
  });
  assert.strictEqual(on.escapes, expected);
  assert.strictEqual(on.escapes, on.dieRows.filter(r => r.escape).length);
  // escapes are attributed to the bin they would have been given
  const sumBins = Object.values(on.escapeBins).reduce((a, b) => a + b, 0);
  assert.strictEqual(sumBins, on.escapes);
});

test('a lower threshold tests more dies and lets fewer through', () => {
  const lot = sortedLot(9, 'etchSeason');
  const dies = lot.wafers[2].dies;
  const model = T.fit(lot.wafers[0].dies, lot.wafers[0].dies);
  const strict = T.plan(dies, { model, adaptive: true, thr: 0.9 });
  const loose = T.plan(dies, { model, adaptive: true, thr: 2.6 });
  assert.ok(strict.savedPct <= loose.savedPct);
  assert.ok(strict.skippedDies <= loose.skippedDies);
  assert.ok(strict.escapes <= loose.escapes, 'strict testing cannot escape more than loose testing');
});

test('the sweep is monotone in the threshold and finite everywhere', () => {
  const lot = sortedLot(9);
  const dies = lot.wafers[4].dies;
  const model = T.fit(lot.wafers[0].dies, lot.wafers[0].dies);
  const pts = T.sweep(dies, model, {});
  assert.ok(pts.length >= 8);
  for (let i = 1; i < pts.length; i++) {
    assert.ok(pts[i].savedPct >= pts[i - 1].savedPct - 0.6, `monotone at ${pts[i].thr}`);
    assert.ok(Number.isFinite(pts[i].dpmo));
  }
});

test('a bad die scores above the healthy population', () => {
  const lot = sortedLot(9, 'etchSeason');
  const dies = lot.wafers[1].dies;
  const model = T.fit(lot.wafers[0].dies, lot.wafers[0].dies);
  const good = dies.filter(d => d.bin === 1).map(d => T.score(d, model)).sort((a, b) => a - b);
  const bad = dies.filter(d => d.bin === 3 || d.bin === 2);
  assert.ok(bad.length > 0, 'this fault produces parametric fails');
  const median = good[Math.floor(good.length / 2)];
  const scores = bad.map(d => T.score(d, model));
  assert.ok(scores.filter(s => s > median).length >= Math.ceil(scores.length * 0.8),
    `most parametric fails score above the good median (${scores.map(s => s.toFixed(2)).slice(0, 5)} vs ${median.toFixed(2)})`);
});

test('the reference wafer is what makes a scratch predictable', () => {
  const lot = sortedLot(23, 'padScratch');
  const w = lot.wafers[0].dies;
  const model = T.fit(w, w);                 // ref = the same wafer, as if the pattern repeated
  const p = T.plan(w, { model, adaptive: true, thr: 1.8 });
  assert.ok(p.blocked > 0, 'dies that failed at this position before are never skipped');
});

test('fail signatures separate the shapes they claim to separate', () => {
  const grid = [];
  for (let i = 0; i < 16; i++) for (let j = 0; j < 16; j++) {
    const x = (i + 0.5) / 16 * 2 - 1, y = (j + 0.5) / 16 * 2 - 1, r = Math.hypot(x, y);
    if (r <= 0.92) grid.push({ i, j, x, y, r, bin: 1 });
  }
  const clean = T.signature(grid);
  assert.strictEqual(clean.kind, 'clean');

  const ring = grid.map(d => (d.r > 0.78 ? { ...d, bin: 5 } : d));
  assert.strictEqual(T.signature(ring).kind, 'edge', T.signature(ring).detail);

  const block = grid.map(d => (d.i >= 6 && d.i <= 9 && d.j >= 6 && d.j <= 9 ? { ...d, bin: 5 } : d));
  const bs = T.signature(block);
  assert.ok(['cluster', 'centre'].includes(bs.kind), bs.detail);

  const random = grid.map((d, k) => (k % 37 === 0 ? { ...d, bin: 5 } : d));
  assert.strictEqual(T.signature(random).kind, 'random', T.signature(random).detail);
});

test('the same wafer always produces the same plan', () => {
  const lot = sortedLot(9);
  const dies = lot.wafers[2].dies;
  const a = T.plan(dies, { adaptive: true, thr: 1.6 });
  const b = T.plan(dies, { adaptive: true, thr: 1.6 });
  assert.strictEqual(a.testMs, b.testMs);
  assert.strictEqual(a.escapes, b.escapes);
  assert.deepStrictEqual(a.escapeBins, b.escapeBins);
});
