/* engine.test.js — the structural glue: one engine, one copy, one set of consumers.
 *
 * The course and the instrument must run the *same* simulation, or the numbers in the
 * lessons drift away from the numbers in the dashboards. That used to be enforced by
 * remembering to copy js/sim.js into both apps. Now it is a test.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.join(__dirname, '..');
const ENGINE = path.join(ROOT, 'engine', 'sim.js');

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}
const files = walk(ROOT);
const rel = p => path.relative(ROOT, p).split(path.sep).join('/');

test('there is exactly one simulation engine in the tree', () => {
  const copies = files.filter(f => path.basename(f) === 'sim.js' || path.basename(f) === 'sim.min.js');
  assert.deepStrictEqual(copies.map(rel), ['engine/sim.js'],
    'the engine must exist once, at engine/sim.js — a second copy is how the two apps drift apart');
});

test('both apps load that one engine, by relative path', () => {
  const course = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const instrument = fs.readFileSync(path.join(ROOT, 'sim', 'index.html'), 'utf8');
  assert.match(course, /<script src="engine\/sim\.js\?v=\d+"><\/script>/);
  assert.match(instrument, /<script src="\.\.\/engine\/sim\.js\?v=\d+"><\/script>/);
  // no app may reach for a private copy again
  for (const [name, html] of [['index.html', course], ['sim/index.html', instrument]]) {
    assert.doesNotMatch(html, /src="(\.\.\/)?js\/sim\.js/, `${name} still points at its own copy of the engine`);
  }
});

test('the shared engine is the shipped one (recorded hash)', () => {
  const recorded = JSON.parse(fs.readFileSync(path.join(ROOT, 'engine', 'sim.sha256.json'), 'utf8'));
  const src = fs.readFileSync(ENGINE);
  const sha = crypto.createHash('sha256').update(src).digest('hex');
  assert.strictEqual(sha, recorded.sha256,
    'engine/sim.js changed: physics edits are fine, but re-record the hash in engine/sim.sha256.json and re-run both test suites');
  assert.strictEqual(src.toString('utf8').trim().split('\n').length, recorded.lines);
});

test('the engine still exports what its consumers destructure', () => {
  const F = require(ENGINE);
  for (const k of ['createSim', 'STEPS', 'STEP_INDEX', 'BINS', 'FAULTS', 'DIES', 'GRID', 'SAMPLE_WAFERS', 'mean'])
    assert.ok(F[k] != null, `engine no longer exports ${k}`);
  assert.strictEqual(F.DIES.length, 188);
  assert.strictEqual(F.STEPS.reduce((s, x) => s + x.time, 0), 380);
});

test('the course and the instrument agree on the tab list', () => {
  require(path.join(ROOT, 'js', 'handoff.js'));
  const H = globalThis.FabHandoff;
  const html = fs.readFileSync(path.join(ROOT, 'sim', 'index.html'), 'utf8');
  const inApp = [...html.matchAll(/data-tab="([a-z]+)"/g)].map(m => m[1]);
  assert.deepStrictEqual([...H.TABS].sort(), [...inApp].sort(),
    'handoff.js TABS and the instrument\'s tab bar disagree — a lesson link would land on a dead tab');
});
