/* Render tests: draw every figure into a mock 2D context and inspect the geometry.
 * A canvas figure fails silently — it just draws off the edge or produces NaN and you see
 * a blank box. So the assertions here are geometric: every coordinate finite, and every
 * unclipped coordinate inside the canvas. (Hatched faces are clipped by the canvas itself,
 * so those are only checked for finite values.)
 */
const test = require('node:test');
const assert = require('node:assert');
require('../js/iso.js');
const Iso = globalThis.Iso;

function mockCtx(w, h) {
  const pts = [];
  let clipped = false;
  const stack = [];
  const ctx = {
    canvas: { width: w, height: h },
    _pts: pts,
    globalAlpha: 1, lineWidth: 1, lineCap: 'butt', lineJoin: 'miter', font: '', fillStyle: '', strokeStyle: '', textAlign: 'left', textBaseline: 'alphabetic',
    setTransform() {}, clearRect() {}, setLineDash() {}, save() { stack.push(clipped); }, restore() { clipped = stack.length ? stack.pop() : false; },
    fillRect(x, y, ww, hh) { pts.push([x, y, clipped, 'fr'], [x + ww, y + hh, clipped, 'fr']); },
    strokeRect(x, y, ww, hh) { pts.push([x, y, clipped, 'sr'], [x + ww, y + hh, clipped, 'sr']); },
    roundRect(x, y, ww, hh) { pts.push([x, y, clipped, 'rr'], [x + ww, y + hh, clipped, 'rr']); },
    clip() { clipped = true; }, beginPath() {}, closePath() {}, arcTo() {}, fill() {}, stroke() {},
    moveTo(x, y) { pts.push([x, y, clipped, 'move']); },
    lineTo(x, y) { pts.push([x, y, clipped, 'line']); },
    arc(x, y, r) { pts.push([x, y, clipped, 'arc']); pts.push([x, y - r, clipped, 'arc']); pts.push([x, y + r, clipped, 'arc']); pts.push([x - r, y, clipped, 'arc']); pts.push([x + r, y, clipped, 'arc']); },
    fillText(t, x, y) {
      // honour textAlign, or a centred label looks like it overflows the canvas
      const wpx = t.length * 6.2;
      const left = this.textAlign === 'center' ? x - wpx / 2 : this.textAlign === 'right' ? x - wpx : x;
      pts.push([left, y, clipped, `text:${t}`], [left + wpx, y, clipped, 'text-end']);
    },
    measureText(t) { return { width: t.length * 6.2 }; },
  };
  return ctx;
}

const SIZES = [[700, 384], [340, 280], [980, 460]];

test('every figure draws inside the canvas at three sizes', () => {
  Object.keys(Iso.FIG).forEach(kind => {
    SIZES.forEach(([w, h]) => {
      const ctx = mockCtx(w, h);
      Iso.FIG[kind](ctx, w, h, {});
      const pts = ctx._pts;
      assert.ok(pts.length > 20, `${kind} ${w}x${h} actually drew something (${pts.length} points)`);
      pts.forEach(([x, y, clipped, tag]) => {
        assert.ok(Number.isFinite(x) && Number.isFinite(y), `${kind}: NaN coordinate at ${tag}`);
        if (clipped) return;
        assert.ok(x >= -2 && x <= w + 2, `${kind} ${w}x${h}: x=${x.toFixed(1)} outside 0..${w} (${tag})`);
        assert.ok(y >= -2 && y <= h + 2, `${kind} ${w}x${h}: y=${y.toFixed(1)} outside 0..${h} (${tag})`);
      });
    });
  });
});

test('the layer stack fits and its labels stay in the right column', () => {
  const w = 700, h = 384, ctx = mockCtx(w, h);
  Iso.FIG.layers(ctx, w, h);
  const texts = ctx._pts.filter(p => p[3].startsWith('text:'));
  const names = texts.filter(p => /Si substrate|SiO|poly-Si|ILD|metal 1/.test(p[3]));
  assert.strictEqual(names.length, 5, 'five layer labels');
  names.forEach(([x]) => {
    assert.ok(x > w * 0.45, `label starts in the right half (x=${x.toFixed(0)})`);
    assert.ok(x + 90 < w, 'label fits before the right edge');
  });
  // labels must not collide vertically
  const ys = names.map(p => p[1]).sort((a, b) => a - b);
  for (let i = 1; i < ys.length; i++) assert.ok(ys[i] - ys[i - 1] > 13, `labels are separated (${(ys[i] - ys[i - 1]).toFixed(1)} px)`);
});

test('figures are deterministic: two draws produce identical geometry', () => {
  ['pile', 'flow', 'wafer', 'twins', 'layers', 'chart', 'foup'].forEach(kind => {
    const a = mockCtx(700, 384), b = mockCtx(700, 384);
    Iso.FIG[kind](a, 700, 384, {});
    Iso.FIG[kind](b, 700, 384, {});
    assert.deepStrictEqual(a._pts, b._pts, `${kind} is stable (seeded jitter)`);
  });
});

test('draw() survives a zero-size layout by falling back to a usable canvas', () => {
  const canvas = {
    clientWidth: 0, clientHeight: 0, parentElement: { clientWidth: 0 },
    getBoundingClientRect: () => ({ width: 0, height: 0 }),
    getContext: () => mockCtx(640, 384),
    width: 0, height: 0, style: {},
  };
  Iso.draw(canvas, 'layers', {});
  assert.ok(canvas.width >= 240 && canvas.height >= 180, `fallback size ${canvas.width}x${canvas.height}`);
});
