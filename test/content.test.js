/* Content tests: the course is data, so it can be checked like data.
 * These catch the failure mode a hand-written site always has — a lesson that renders
 * to an empty panel, a figure that does not exist, a demo id with no implementation,
 * or copy that drifts from the engine it describes.
 */
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');

require('../js/iso.js');
require('../js/content.js');
const FabSim = require('../engine/sim.js');
const { COURSE, LESSONS } = globalThis.FABLAB;
const Iso = globalThis.Iso;
const labSrc = fs.readFileSync(path.join(__dirname, '..', 'js', 'lab.js'), 'utf8');

test('every lesson is complete and routable', () => {
  const ids = new Set();
  LESSONS.forEach(l => {
    assert.ok(l.id && !ids.has(l.id), `unique id: ${l.id}`);
    ids.add(l.id);
    assert.ok(l.title && l.title.length < 46, `${l.id} has a short title`);
    assert.ok(l.steps.length >= 4, `${l.id} has at least 4 steps (${l.steps.length})`);
    l.steps.forEach((s, i) => {
      const where = `${l.id} step ${i + 1}`;
      assert.ok(s.head && s.head.length < 70, `${where} has a short heading`);
      assert.ok(Array.isArray(s.body) && s.body.length >= 1, `${where} has body text`);
      s.body.forEach(b => assert.ok(typeof b === 'string' && b.length > 40, `${where} paragraph is a real sentence`));
      assert.ok(s.head.length + s.body.join(' ').length < 900, `${where} fits one screen`);
    });
  });
  assert.ok(LESSONS.length >= 12, `${LESSONS.length} lessons`);
});

test('figure kinds all exist in the drawing module', () => {
  LESSONS.forEach(l => {
    assert.ok(Iso.FIG[l.figure || 'wafer'], `${l.id}: figure "${l.figure}" exists`);
    l.steps.forEach(s => { if (s.figure) assert.ok(Iso.FIG[s.figure], `${l.id}: step figure "${s.figure}" exists`); });
  });
});

test('every live demo referenced by the course is implemented', () => {
  const used = new Set();
  LESSONS.forEach(l => l.steps.forEach(s => { if (s.demo) used.add(s.demo); }));
  assert.ok(used.size >= 3, 'the course uses live demos');
  used.forEach(id => assert.ok(new RegExp(`\\n\\s+${id}\\(out\\)`).test(labSrc), `demo "${id}" is implemented in lab.js`));
});

test('chapters are numbered in order and counts agree', () => {
  COURSE.forEach((ch, i) => {
    assert.strictEqual(ch.no, String(i + 1).padStart(2, '0'));
    assert.ok(ch.lessons.length >= 2, `${ch.title} has lessons`);
    ch.lessons.forEach(l => assert.strictEqual(l.chapter, ch));
  });
  assert.strictEqual(LESSONS.reduce((n, l) => n + 1, 0), COURSE.reduce((n, c) => n + c.lessons.length, 0));
});

test('copy that quotes engine numbers still matches the engine', () => {
  const total = FabSim.STEPS.reduce((n, s) => n + s.time, 0);
  assert.strictEqual(total, 380);
  const all = LESSONS.flatMap(l => l.steps.flatMap(s => s.body.concat(s.note || ''))).join(' ');
  assert.match(all, /380 minutes/, 'the 380-minute total is stated');
  assert.match(all, /10 ± 0\.5/, 'oxide spec');
  assert.match(all, /90 ± 4/, 'litho CD spec');
  assert.match(all, /80 ± 4/, 'final CD spec');
  assert.match(all, /500 ± 20/, 'ILD spec');
  assert.match(all, /300 ± 15/, 'post-CMP spec');
  assert.strictEqual(FabSim.DIES.length, 188);
  assert.match(all, /188/, 'die count is stated');
  assert.deepStrictEqual(FabSim.SAMPLE_WAFERS, [0, 12, 24]);
});

test('no broken inline html: tags balance in every paragraph', () => {
  const tags = ['b', 'code', 'i', 'br'];
  LESSONS.forEach(l => l.steps.forEach((s, i) => {
    s.body.concat(s.note || '').forEach(txt => {
      tags.forEach(t => {
        if (t === 'br') return;
        const open = (txt.match(new RegExp(`<${t}>`, 'g')) || []).length;
        const close = (txt.match(new RegExp(`</${t}>`, 'g')) || []).length;
        assert.strictEqual(open, close, `${l.id} step ${i + 1}: <${t}> balanced`);
      });
    });
  }));
});

test('index.html loads every script and stylesheet it needs', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  ['css/style.css', 'js/handoff.js', 'js/iso.js', 'js/content.js', 'engine/sim.js', 'js/lab.js'].forEach(f => {
    assert.match(html, new RegExp(f.replace(/[./]/g, '\\$&')), `${f} is referenced`);
  });
  ['figure', 'course', 'stepPanel', 'lessonTitle', 'search'].forEach(id => {
    assert.match(html, new RegExp(`id="${id}"`), `#${id} exists for lab.js`);
  });
});

/* ---------- colour tone ----------
 * The palette is CSS data, so it gets data tests: every tone must define the whole token
 * set (a missing token silently falls back to the browser default), stay light and
 * readable, and match the header swatch that advertises it.
 */
const css = fs.readFileSync(path.join(__dirname, '..', 'css', 'style.css'), 'utf8');
const TOKENS = ['paper', 'panel', 'paper2', 'panel2', 'line', 'ink', 'body', 'muted', 'muted2', 'soft-ink',
  'accent', 'accent-ink', 'accent-soft', 'hl', 'hl-line', 'hl-ink', 'notice', 'notice-line', 'notice-ink',
  'code-ink', 'die', 'die-edge', 'grid', 'layer-1', 'layer-2', 'layer-3', 'layer-4', 'layer-5', 'green', 'shadow'];

function palettes() {
  const out = {};
  const re = /\[data-tone="([\w-]+)"\][^{]*\{([^}]*)\}/g;
  let m;
  while ((m = re.exec(css))) {
    const decls = {};
    (m[2].match(/--[\w-]+:\s*[^;]+;/g) || []).forEach(d => {
      const [k, v] = d.replace(';', '').split(/:\s*/);
      decls[k.slice(2)] = v.trim();
    });
    if (!out[m[1]] || Object.keys(decls).length > Object.keys(out[m[1]]).length) out[m[1]] = decls;
  }
  return out;
}
const PAL = palettes();

function lum(hex) {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
  const [r, g, b] = [0, 2, 4].map(i => parseInt(full.slice(i, i + 2), 16) / 255)
    .map(v => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const contrast = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

test('all three tones define the whole token set', () => {
  assert.deepStrictEqual(Object.keys(PAL).sort(), ['cleanroom', 'indigo', 'moss']);
  Object.entries(PAL).forEach(([name, p]) => {
    TOKENS.forEach(t => assert.ok(p[t], `${name} defines --${t}`));
    assert.match(p.paper, /^#[0-9A-Fa-f]{6}$/, `${name} --paper is a hex colour`);
  });
});

test('every tone is light: paper is brighter than ink, and text stays readable', () => {
  Object.entries(PAL).forEach(([name, p]) => {
    assert.ok(lum(p.paper) > 0.75, `${name} paper is a light surface (luminance ${lum(p.paper).toFixed(2)})`);
    assert.ok(lum(p.ink) < 0.06, `${name} ink is near-black (luminance ${lum(p.ink).toFixed(3)})`);
    const checks = [
      ['ink on paper', p.ink, p.paper, 10],
      ['body on panel', p.body, p.panel, 7],
      ['muted on paper', p.muted, p.paper, 4.5],
      ['accent-ink on accent', p['accent-ink'], p.accent, 4.5],
      ['hl-ink on hl', p['hl-ink'], p.hl, 5],
      ['notice-ink on notice', p['notice-ink'], p.notice, 5],
      ['soft-ink on paper', p['soft-ink'], p.paper, 5],
    ];
    checks.forEach(([label, fg, bg, min]) => {
      const c = contrast(fg, bg);
      assert.ok(c >= min, `${name}: ${label} ${c.toFixed(2)}:1 >= ${min}:1`);
    });
  });
});

test('the header swatches advertise their own palette', () => {
  const re = /\.tone\[data-tone="([\w-]+)"\]\s*\{([^}]*)\}/g;
  let m, seen = 0;
  while ((m = re.exec(css))) {
    seen++;
    const sw = /--sw:\s*(#[0-9A-Fa-f]{6})/.exec(m[2]), ring = /--sw-ring:\s*(#[0-9A-Fa-f]{6})/.exec(m[2]);
    assert.ok(sw && ring, `${m[1]} swatch has both colours`);
    assert.strictEqual(sw[1].toUpperCase(), PAL[m[1]].paper.toUpperCase(), `${m[1]} swatch uses its paper colour`);
    assert.strictEqual(ring[1].toUpperCase(), PAL[m[1]].accent.toUpperCase(), `${m[1]} swatch uses its accent`);
  }
  assert.strictEqual(seen, 3, 'three swatches, one per tone');
});

test('no colour is hardcoded outside the palette blocks', () => {
  const stripped = css
    .replace(/\[data-tone="[\w-]+"\][^{]*\{[^}]*\}/g, '')   // palette + swatch blocks
    .replace(/--[\w-]+:\s*#[0-9A-Fa-f]{3,6};/g, '');          // token declarations
  const leftover = stripped.match(/#[0-9A-Fa-f]{6}\b/g) || [];
  assert.deepStrictEqual(leftover, [], 'styles go through custom properties');
});

test('the header exposes the tone switcher and remembers the choice', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  ['cleanroom', 'moss', 'indigo'].forEach(t => {
    assert.match(html, new RegExp(`class="tone" data-tone="${t}"`), `${t} button`);
  });
  assert.match(html, /id="tones"/, 'switcher group');
  assert.match(labSrc, /localStorage\.setItem\(TONE_KEY/, 'choice is saved');
  assert.match(labSrc, /Iso\.refresh\(\)/, 'canvas is repainted on switch');
  assert.match(labSrc, /URLSearchParams\(location\.search\)\.get\('tone'\)/, 'a tone can be deep-linked');
});

test('chapter 06 quotes the test-program numbers the module actually runs', () => {
  const T = require('../sim/js/testplan.js');
  const ch = COURSE.find(c => c.no === '06');
  assert.ok(ch, 'chapter 06 exists');
  assert.strictEqual(ch.lessons.length, 5);
  assert.deepStrictEqual(ch.lessons.map(l => l.id),
    ['test-phases', 'test-program', 'first-silicon', 'test-data', 'ai-in-test']);
  const text = ch.lessons.flatMap(l => l.steps.flatMap(s => s.body.concat(s.note || ''))).join(' ');
  assert.match(text, /37\.2 ms/, 'per-die program cost is quoted');
  assert.match(text, new RegExp(`188 × 37\\.2 ÷ 5`), 'the touches arithmetic is quoted');
  // the numbers in the copy are the ones the module computes
  assert.strictEqual(+T.PROGRAM_MS.toFixed(1), 37.2);
  assert.strictEqual(T.SITES, 5);
  assert.ok(Math.abs(T.plan(FabSim.DIES.map(d => ({ ...d, rc: 20, vt: 0.45, ioff: 10, idsat: 600, bin: 1 })), {}).timePerWaferS - 1.4) < 0.05);
  assert.match(text, /5 sites/, 'site count is stated');
  // both roles named, and named in the phase they actually sit in
  assert.match(ch.lessons[0].steps[1].note, /graduate test \/ product engineering/i);
  assert.match(ch.lessons[0].steps[1].note, /production test engineering/i);
  // the chapter is about roles, not about one employer: no company is named anywhere in it
  assert.doesNotMatch(text, /\bAMD\b|Micron|Intel\b|TSMC|Samsung\b|Infineon|GlobalFoundries/);
});
