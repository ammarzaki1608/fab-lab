# Fab Lab + FabSim

**Live:** [course](https://ammarzaki1608.github.io/fab-lab/) · [instrument](https://ammarzaki1608.github.io/fab-lab/sim/)

A semiconductor fab you can read at lesson speed and then open up and prod. 23 lessons,
97 steps, 12 of them wired to a live scenario — put a fault into a running fab and watch
it surface as an SPC point, an FDC alarm, a yield loss, and one guilty chamber. The last
chapter is about the jobs that do that on purpose: product and test engineering, and the
adaptive test program the instrument will run on real dies for you.

No account, no backend, no build step: plain HTML, CSS and canvas, served as files.

One tree, two surfaces on one simulation engine:

- **Fab Lab** at `/` — a guided course: 23 lessons in 6 chapters, hand-drawn isometric
  figures, live demos, one idea per screen.
- **FabSim** at `/sim/` — the instrument: live flow, SPC charts, chamber matching,
  wafer maps, the fab floor, a wafer-sort test floor, CSV export.

They are joined by a link contract (`js/handoff.js`) and by a single copy of the engine
(`engine/sim.js`), not by a build step. No dependencies, no bundler: plain HTML, CSS, JS.
You do not have to read the course to use the instrument: the header carries two doors,
**Simulator ↗** and **Fab floor ↗**, live on every page. The floor overlay carries its own
**← Course** link, because it covers the instrument's header.

```
python3 serve.py 8092 .    # course at /, simulator at /sim/
npm test                   # 64 tests: course, figures, engine invariants, handoff links, test plan
```

`serve.py` is a static server that adds `Cache-Control: no-store`, so edits show up on
reload. Any static host works too — the site is just files, and every internal link is
relative, so it also works from a GitHub Pages *project* site (`/<repo>/`).

## What it is for

The reader is assumed to know nothing about fabs. Each lesson is 3–6 steps: a concept,
then the number that makes it concrete, then what goes wrong. Two things keep it honest:

- **Numbers come from the engine.** Process times, specs (oxide 10 ±0.5 nm, gate CD
  80 ±4 nm, ILD 500 ±20 nm, post-CMP 300 ±15 nm), die count per wafer (188) and the
  sampling plan (wafers 1, 13, 25) are read from `js/sim.js` at build time by the tests,
  not retyped into prose. If the engine changes, a test fails.
- **Demos are the simulation, not an animation of it.** `sampling`, `wafermap`, `spc`
  and `r2r` run `FabSim` in the page and draw the result. The wafer map shows a real
  lot's dies with real bins.

## Layout

```
index.html
css/style.css      design tokens (3 tones), three-pane shell, figure frame
js/iso.js          isometric canvas figures: pile, flow, wafer, twins, layers, chart, foup, phases, tester, shmoo
js/content.js      the course: COURSE + 23 LESSONS, each a list of steps
js/lab.js          hash router, sidebar, step panel, live demos, tone switcher
js/handoff.js      the link contract: lesson step <-> simulator scenario
engine/sim.js      the process engine — the only copy in the tree
engine/sim.sha256.json  its recorded hash, so a silent second copy fails a test
sim/index.html     FabSim (the instrument), unchanged except for the handoff
sim/js/*           ui, charts, floor, floor-ui, testplan (the ATE program), testui
sim/css/style.css  the instrument's own dark palette
serve.py           dev server with no-store, serves the whole tree
test/content.test.js   course and palette are data: checked as data
test/render.test.js    every figure drawn into a mock canvas and measured
test/engine.test.js    one engine, one copy, both apps point at it
test/handoff.test.js   every scenario link names a real fault, tab and speed
test/testplan.test.js  the test program: bins match the engine, skips save time, escapes counted
sim/test/*.test.js     the engine's own behaviour and the floor geometry
```

## Three panes

Left: the course tree, with finished lessons ticked. Centre: the lesson's figure.
Right: the current step, its notice card, an optional demo, and Back / Next.

Routing is `#/lesson-id/step`, so any step is linkable. `←`/`→` move between steps,
`Ctrl K` focuses search.

## Colour tone

Three light tones, switchable from the chips in the header and remembered in
`localStorage`; `?tone=cleanroom|moss|indigo` deep-links one.

| tone | paper | accent | character |
|---|---|---|---|
| `cleanroom` (default) | `#F3F7F9` | `#0E7C86` | cool instrument panel |
| `moss` | `#F5F6EF` | `#4E7A3A` | warm botanical, olive |
| `indigo` | `#F4F5FB` | `#3D5BD9` | cool grey, data-heavy |

They are CSS custom properties, and `js/iso.js` reads the same properties for the
canvas, so one switch repaints the figures too. Tests enforce that each tone defines
every token, that paper stays light (luminance > 0.75) and text stays readable
(ink-on-paper ≥ 10:1, body ≥ 7:1, muted ≥ 4.5:1, accent ≥ 4.5:1), that the header
swatches match the palettes they advertise, and that no colour is hardcoded outside
the palette blocks.

## Tests

- **content**: unique lesson ids, ≥4 steps each, figure and demo ids exist, chapter
  numbering, engine-number agreement, balanced inline HTML, palette completeness,
  contrast, swatch/palette agreement, no stray hex colours.
- **render**: every figure is drawn into a mock 2D context at 700×384, 340×280 and
  980×460; the test asserts points are finite and inside the canvas (unclipped ones),
  that the layer labels sit in their right-hand column and do not collide, that two
  draws are identical, and that a zero-size layout still falls back to a usable canvas.

The figures fit themselves with `frameFor()`, which measures the 3D extents and then
scales — hand-placed origins are how isometric diagrams end up spilling off the edge.

## How the two apps are glued

**One engine.** `engine/sim.js` is the only copy. The course loads `engine/sim.js`, the
instrument loads `../engine/sim.js`. `test/engine.test.js` walks the tree and fails if a
second `sim.js` ever appears, or if either page goes back to a private copy. A physics
edit is now one file and two test suites, instead of two files you have to remember.

**One link contract.** `js/handoff.js` builds every scenario URL, so the two apps cannot
disagree about parameter names:

| parameter | what it does |
|---|---|
| `fault` | inject a fault on load (`etchSeason`, `furnaceDrift`, `focusDrift`, `beamUnstable`, `particles`, `padScratch`) |
| `tab` | open a tab (`step`, `spc`, `yield`, `test`, `chambers`, `lot`, `data`, `learn`) |
| `speed` | 0–7, the instrument's speed slider |
| `r2r=0`, `autoHold=0` | preset the control loops off |
| `floor=1`, `sel=ETCH-03A` | open the fab-floor overlay, optionally on one bay |
| `seed` | pin the run so a lesson reproduces the same numbers every time |
| `atest=1`, `thr=1.6`, `amode=bin\|score\|skipped` | the test floor: adaptive test on, its threshold, and which map it draws |
| `back` | where "← Course" returns to (same-site relative only) |

Twelve lesson steps carry a copper button that opens the scenario the paragraph just
described (`#find-the-fault/5` → `?fault=etchSeason&tab=chambers&speed=7&floor=1&sel=ETCH-03A&seed=9&back=…`).
The instrument answers in the Learn tab with lesson links back, and every run gets a
"← Course" chip in the header that returns to the exact step it came from.

`npm test` asserts the links are real: the fault exists in `FAULTS`, the tab exists in
the tab bar, the speed is in range, the seed is pinned, and the round trip through
`readScenario()` returns what the lesson meant. Renaming a fault breaks a test instead of
breaking a lesson.

**Not one palette.** The course is paper, the instrument is a dark console — deliberately.
They share structure (type scale, chips, radii) and the engine, not colours.

## Hosting on GitHub Pages

The tree is a project site already: no build, no absolute paths, no server-side anything.

1. Put these files at the repository root (the `index.html` here must be the repo root
   `index.html`).
2. Settings → Pages → *Deploy from a branch* → `main` / `/ (root)`. `.nojekyll` is
   included so nothing is filtered.
3. The site appears at `https://<user>.github.io/<repo>/`: the course at that URL, the
   instrument at `<repo>/sim/`. All handoff links are relative, so they resolve under the
   `/<repo>/` prefix without a base tag.

A custom domain works the same way. If you would rather the instrument sit at the domain
root, swap the two directories — nothing in the code assumes which one is on top, beyond
the two script paths in the two `index.html` files.
