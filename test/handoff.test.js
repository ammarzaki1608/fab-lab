/* handoff.test.js — the lesson → scenario links.
 *
 * Every "open it in the app" link is a promise: the fault exists, the tab exists, the
 * speed is in range, and what the simulator reads back is what the lesson meant. A
 * renamed fault or a dropped tab would otherwise turn a lesson button into a dead end.
 */
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

require('../js/handoff.js');
const H = globalThis.FabHandoff;
const FabSim = require('../engine/sim.js');
require('../js/content.js');
const { COURSE, LESSONS } = globalThis.FABLAB;

const steps = [];
for (const ch of COURSE) for (const l of ch.lessons) (l.steps || []).forEach((s, i) => steps.push({ ch: ch.no, lesson: l, step: s, i }));
const linked = steps.filter(x => x.step.go);

const text = s => [s.head, ...(s.body || []), s.note || ''].join(' ');

test('the course is wired to the instrument in both directions', () => {
  assert.ok(linked.length >= 10, `only ${linked.length} lesson steps hand off to the simulator`);
  const chapters = new Set(linked.map(x => x.ch));
  assert.ok(chapters.size >= 4, 'handoff links should not all live in one chapter');
  const read = f => require('node:fs').readFileSync(path.join(__dirname, '..', f), 'utf8');
  assert.match(read('sim/index.html'), /id="courseLink"/, 'the instrument has no way back to the course');
  assert.match(read('sim/js/ui.js'), /href="\.\.\/index\.html#\/spc\/1"/, 'the Learn tab lost its lesson cross-references');
  assert.match(read('sim/js/ui.js'), /FabHandoff\.safeBack/, 'the back link no longer goes through the shared sanitiser');
});

test('every scenario link names a real fault, tab and speed', () => {
  assert.deepStrictEqual(Object.keys(FabSim.FAULTS).sort(), ['beamUnstable', 'etchSeason', 'focusDrift', 'furnaceDrift', 'padScratch', 'particles']);
  for (const { lesson, step } of linked) {
    const g = step.go;
    if (g.fault) assert.ok(FabSim.FAULTS[g.fault], `${lesson.id}: unknown fault "${g.fault}"`);
    if (g.tab) assert.ok(H.TABS.includes(g.tab), `${lesson.id}: unknown tab "${g.tab}"`);
    if (g.speed != null) assert.ok(H.SPEEDS.includes(g.speed), `${lesson.id}: speed ${g.speed} is outside 0-7`);
    if (g.floor && !g.tab) assert.fail(`${lesson.id}: ?floor=1 without ?tab= opens the overlay on an arbitrary tab`);
    assert.ok(g.label && g.label.length > 8, `${lesson.id}: handoff needs a label that says what will happen`);
  }
});

test('a scenario link survives the round trip through the simulator', () => {
  for (const { lesson, step, i } of linked) {
    const href = H.simHref(step.go, lesson.id, i + 1);
    assert.ok(href.startsWith('sim/index.html?'), 'links must stay relative — a Pages project site is not served from /');
    const back = H.readScenario(href.slice(href.indexOf('?') + 1));
    const g = step.go;
    assert.strictEqual(back.fault, g.fault || null, `${lesson.id}: fault lost in the URL`);
    assert.strictEqual(back.tab, g.tab || null, `${lesson.id}: tab lost in the URL`);
    if (g.speed != null) assert.strictEqual(back.speed, g.speed);
    assert.strictEqual(back.seed, g.seed != null ? g.seed : H.DEFAULT_SEED, `${lesson.id}: every link must pin a seed`);
    assert.strictEqual(back.back, `${H.COURSE}#/${lesson.id}/${i + 1}`, `${lesson.id}: the simulator cannot send the reader back`);
    if (g.r2r === false) assert.strictEqual(back.r2r, false, `${lesson.id}: ?r2r=0 lost`);
    if (g.floor) assert.strictEqual(back.floor, true);
    if (g.sel) assert.strictEqual(back.sel, g.sel);
  }
});

test('an explicit link is exact, so the contract is readable in a screenshot', () => {
  const href = H.simHref({ fault: 'etchSeason', speed: 7, tab: 'chambers', sel: 'ETCH-03A', floor: true }, 'find-the-fault', 2);
  assert.strictEqual(href,
    'sim/index.html?fault=etchSeason&tab=chambers&speed=7&floor=1&sel=ETCH-03A&seed=9&back=' +
    encodeURIComponent('../index.html#/find-the-fault/2'));
});

test('a link cannot point the back button off-site', () => {
  for (const bad of ['https://evil.example/x', 'javascript:alert(1)', '//evil.example', 'data:text/html,x', '', null])
    assert.strictEqual(H.safeBack(bad), H.COURSE, `safeBack accepted ${JSON.stringify(bad)}`);
  assert.strictEqual(H.safeBack('../index.html#/spc/2'), '../index.html#/spc/2');
});

test('prose about the simulator always carries a link to it', () => {
  const prose = steps.filter(x => /fab-sim/i.test(text(x.step)));
  assert.ok(prose.length >= 3, 'no lesson names FabSim in prose any more — is this test still meaningful?');
  for (const { lesson, step } of prose)
    assert.ok(step.go, `${lesson.id}: "${step.head}" tells the reader to open the simulator but gives them no link`);
});

test('readScenario ignores junk instead of trusting it', () => {
  const j = H.readScenario('?tab=nope&speed=99&seed=abc&r2r=maybe');
  assert.strictEqual(j.tab, null);
  assert.strictEqual(j.speed, null);
  assert.strictEqual(j.seed, null);
  assert.strictEqual(j.r2r, true, 'anything truthy that is not 0/off means "on"');
  assert.strictEqual(H.readScenario('').floor, false);
});

test('the instrument is one click from the course header, not only from a lesson', () => {
  const read = f => require('node:fs').readFileSync(path.join(__dirname, '..', f), 'utf8');
  const html = read('index.html');
  for (const id of ['jumpSim', 'jumpFloor']) {
    assert.match(html, new RegExp(`id="${id}"`), `the header has no #${id} pill`);
  }
  // both doors are built by the shared contract, so the parameter names cannot drift
  assert.match(read('js/lab.js'), /jumpHref\('sim'\)|jumpHref\(kind\)/, 'lab.js does not wire the pills');
  const floor = H.jumpHref('floor');
  assert.match(floor, /^sim\/index\.html\?/, 'a jump link must stay inside the tree, relative');
  const q = H.readScenario(floor.split('?')[1]);
  assert.strictEqual(q.floor, true, 'the floor pill does not ask for the floor');
  assert.ok(q.tab, '?floor=1 needs an explicit tab or the overlay opens on an arbitrary one');
  assert.strictEqual(H.readScenario(H.jumpHref('sim').split('?')[1]).floor, false, 'the simulator pill opens the floor');
  assert.strictEqual(H.jumpHref('nonsense'), H.jumpHref('sim'), 'an unknown jump should fall back, not throw');
});
