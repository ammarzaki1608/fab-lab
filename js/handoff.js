/* handoff.js — the link contract between the course (/) and the instrument (/sim/).
 *
 * Both apps are static files served from one directory tree, so every link between them
 * is relative. That is what lets the same tree work on localhost, on any static host, and
 * on a GitHub Pages *project* site (where the site lives at /<repo>/ instead of the root).
 *
 * Pure functions, no DOM: the tests assert the exact URLs, so the two apps cannot quietly
 * disagree about the parameter names.
 *
 * A scenario link carries:
 *   fault, tab, speed (0-7), r2r=0, autoHold=0, floor=1, sel=<TOOL>, seed=<n>, back=<lesson>
 * seed is pinned so a lesson reproduces the same run every time; back sends the reader
 * home to the step they left.
 */
(function (root) {
  'use strict';

  const SIM = 'sim/index.html';
  const COURSE = '../index.html';         // as seen from /sim/
  const DEFAULT_SEED = 9;
  const TABS = ['step', 'spc', 'yield', 'chambers', 'lot', 'data', 'learn'];
  const SPEEDS = [0, 1, 2, 3, 4, 5, 6, 7];

  /* stepNo is the 1-based number the course puts in its own URL (#/lesson/3). */
  function simHref(go, lessonId, stepNo) {
    const g = go || {};
    const q = new URLSearchParams();
    if (g.fault) q.set('fault', g.fault);
    if (g.tab) q.set('tab', g.tab);
    if (g.speed != null) q.set('speed', String(g.speed));
    if (g.r2r === false) q.set('r2r', '0');
    if (g.autoHold === false) q.set('autoHold', '0');
    if (g.floor) q.set('floor', '1');
    if (g.sel) q.set('sel', g.sel);
    q.set('seed', String(g.seed != null ? g.seed : DEFAULT_SEED));
    if (lessonId) q.set('back', `${COURSE}#/${lessonId}/${stepNo || 1}`);
    return `${SIM}?${q}`;
  }

  /* The instrument's side of the same contract: which tab and scenario a URL asks for.
   * Used to keep the URL parsing in one place and testable. */
  function readScenario(search) {
    const q = new URLSearchParams(search || '');
    const num = v => (v != null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : null);
    const tab = TABS.includes(q.get('tab')) ? q.get('tab') : null;
    const speed = num(q.get('speed'));
    const seed = num(q.get('seed'));
    return {
      fault: q.get('fault') || null,
      tab,
      speed: speed != null && SPEEDS.includes(speed) ? speed : null,
      seed: seed != null ? seed : null,
      r2r: q.get('r2r') === '0' || q.get('r2r') === 'off' ? false : (q.get('r2r') ? true : null),
      autoHold: q.get('autoHold') === '0' || q.get('autoHold') === 'off' ? false : (q.get('autoHold') ? true : null),
      floor: q.get('floor') === '1' || q.get('floor') === 'true',
      sel: q.get('sel') || null,
      back: q.get('back') || null,
    };
  }

  /* Only same-site relative paths are accepted back into the course, so a shared link
   * cannot point the "← Course" button at somewhere else. */
  function safeBack(back) {
    return typeof back === 'string' && /^(\.\.\/|\.\/|\/(?!\/))[^\s]*$/.test(back) ? back : COURSE;
  }

  root.FabHandoff = { SIM, COURSE, DEFAULT_SEED, TABS, SPEEDS, simHref, readScenario, safeBack };
})(typeof window !== 'undefined' ? window : globalThis);
