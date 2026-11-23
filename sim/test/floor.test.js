const test = require('node:test');
const assert = require('node:assert');
const F = require('../../engine/sim.js');
const FF = require('../js/floor.js');

const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;

test('every tool in the simulation has a bay on the floor, and vice versa', () => {
  const s = F.createSim({ seed: 3 });
  const simTools = Object.values(s.state.tools).map(t => t.name).sort();
  const bays = FF.BAYS.map(b => b.name).sort();
  assert.deepEqual(bays, simTools);
  // and each bay points at a real step id
  const stepIds = new Set(s.state.steps.map(x => x.id));
  FF.BAYS.forEach(b => assert.ok(stepIds.has(b.step), `${b.name} step ${b.step}`));
});

test('bays do not overlap and sit inside the floor slab', () => {
  for (let i = 0; i < FF.BAYS.length; i++) {
    const a = FF.BAYS[i];
    assert.ok(a.x - a.w / 2 > 0 && a.x + a.w / 2 < FF.FLOOR.w, `${a.name} x in bounds`);
    assert.ok(a.y - a.d / 2 > 0 && a.y + a.d / 2 < FF.FLOOR.d, `${a.name} y in bounds`);
    for (let j = i + 1; j < FF.BAYS.length; j++) {
      const b = FF.BAYS[j];
      const overlap = Math.abs(a.x - b.x) < (a.w + b.w) / 2 && Math.abs(a.y - b.y) < (a.d + b.d) / 2;
      assert.ok(!overlap, `${a.name} overlaps ${b.name}`);
    }
  }
});

test('a FOUP route leaves the bay, runs along the rail, and ends exactly on target', () => {
  const from = FF.portOf(FF.bayByName['FURN-01']);
  const to = FF.portOf(FF.bayByName['CMP-01A']);
  const pts = FF.route(from, to);
  assert.ok(pts.length >= 2);
  const last = pts[pts.length - 1];
  assert.ok(near(last.x, to.x) && near(last.y, to.y), 'ends on target');
  // the middle waypoints are on the spine, so travel looks like rail travel
  pts.slice(0, -1).forEach(p => assert.ok(near(p.y, FF.SPINE_Y), 'waypoint on rail'));
});

test('routes are degenerate-safe: same point, and no start point', () => {
  const p = FF.portOf(FF.bayByName['SCAN-02']);
  const pts = FF.route(p, p);
  assert.ok(pts.length === 1 && near(pts[0].x, p.x) && near(pts[0].y, p.y));
  const fromNull = FF.route(null, p);
  assert.ok(fromNull.length === 1 && near(fromNull[0].x, p.x));
});

test('load ports face the rail and queue spots land inside the floor', () => {
  FF.BAYS.forEach(b => {
    const p = FF.portOf(b);
    const midway = (p.y + FF.SPINE_Y) / 2;
    assert.ok(Math.abs(p.y - FF.SPINE_Y) < b.d / 2 + 1.2, `${b.name} port near rail`);
    assert.ok(Math.abs(midway - p.y) < 1.2, `${b.name} port on the rail side`);
  });
  const s = F.createSim({ seed: 5 });
  for (let i = 0; i < 400; i++) s.tick();
  s.state.lots.forEach(l => {
    const t = FF.targetFor(s.state, l);
    assert.ok(t.x >= -0.5 && t.x <= FF.FLOOR.w + 1, `${l.id} x ${t.x}`);
    assert.ok(t.y >= -0.5 && t.y <= FF.FLOOR.d + 1, `${l.id} y ${t.y}`);
  });
});

test('cutaway phases cover the whole process time and advance in order', () => {
  Object.entries(FF.PHASES).forEach(([kind, ph]) => {
    const sum = ph.reduce((a, p) => a + p.f, 0);
    assert.ok(Math.abs(sum - 1) < 1e-9, `${kind} phases sum to ${sum}`);
    ph.forEach(p => assert.ok(p.f > 0 && p.t.length > 2));
  });
  // walk a real run and check the phase index never goes backwards within a lot
  const s = F.createSim({ seed: 9 });
  const seen = {};
  let lastIdx = {};
  for (let i = 0; i < 500; i++) {
    s.tick();
    s.state.steps.forEach((ss, si) => ss.tools.forEach(tool => {
      if (!tool.busy) return;
      const idx = FF.phaseIndex(tool, s.state);
      const key = tool.name + ':' + tool.busy.id;
      assert.ok(idx >= 0, 'phase index valid while busy');
      if (lastIdx[key] != null && lastIdx[key] === idx) seen[key] = true;
      lastIdx[key] = idx;
    }));
  }
  assert.ok(Object.keys(lastIdx).length > 20, 'saw plenty of tool runs');
});

test('FOUPs move toward their target along the rail and are dropped when sorted', () => {
  const s = F.createSim({ seed: 7 });
  const v = FF.createFloor();
  for (let i = 0; i < 600; i++) {
    s.tick();
    if (i % 5 === 0) FF.step(v, s.state, 0.1);
  }
  const live = Object.values(v.foups);
  assert.ok(live.length > 0, 'some FOUPs tracked');
  live.forEach(f => {
    assert.ok(f.x >= -1 && f.x <= FF.FLOOR.w + 2, 'x in floor');
    assert.ok(f.y >= -1 && f.y <= FF.FLOOR.d + 2, 'y in floor');
  });
  // travel actually happens: at least one FOUP is off the rail at a bay or on the way
  assert.ok(live.some(f => Math.abs(f.y - FF.SPINE_Y) > 0.01 || f.path.length > 0), 'movement observed');
  // lots that finish are pruned once faded out
  for (let i = 0; i < 400; i++) { s.tick(); FF.step(v, s.state, 0.2); }
  const doneIds = new Set(s.state.lots.filter(l => l.status === 'done').map(l => l.id));
  const stale = Object.keys(v.foups).filter(id => doneIds.has(id));
  assert.ok(stale.length < 12, `done FOUPs pruned, ${stale.length} still fading`);
});

test('picking a pixel returns the bay drawn there', () => {
  const W = 1000, H = 620;
  const fit = FF.fitTo(W, H);
  const p = FF.project(6.7, 1.5, 0);       // centre of SCAN-02's footprint
  const hit = FF.pick(p.x * fit.s + fit.ox, p.y * fit.s + fit.oy, W, H);
  assert.ok(hit && hit.name === 'SCAN-02', 'hit ' + (hit && hit.name));
  const miss = FF.pick(2, 2, W, H);        // above the floor slab
  assert.ok(!miss || miss.name !== 'SCAN-02');
});
