/* content.js — the course, as data. Every lesson is a list of steps; one step = one idea.
 * Nothing here knows about the DOM: lab.js renders it, iso.js draws the figures.
 * Numbers match the fab-sim engine (step times, specs, die count), so the lessons and the
 * live demos cannot drift apart.
 */
(function (root) {
  'use strict';

  const COURSE = [
    {
      no: '01', title: 'Foundations', blurb: 'What a fab is, and why it is a building full of plumbing.',
      lessons: [
        {
          id: 'what-a-fab-does', title: 'What a fab actually does', figure: 'layers',
          steps: [
            {
              tag: 'CONCEPT', head: 'A chip is built, not printed',
              body: ['A chip is a stack of very thin layers of material — insulating oxide, conducting metal, and the silicon itself — shaped with incredible precision. The job of a fab is to add a layer, cut a pattern into it, and repeat.'],
            },
            {
              tag: 'CONCEPT', head: 'Same recipe, 188 times a wafer',
              body: ['One 300 mm silicon wafer is divided into <b>188 identical chips</b> (dies). Every process step treats the whole wafer at once, so one lot carries 25 wafers × 188 dies = <b>4,700 chips</b> through the same recipe.'],
            },
            {
              tag: 'NOTICE', head: 'Front end, then back end',
              body: ['<b>Front end</b> builds the transistors: oxidation, lithography, etch, implant, anneal. <b>Back end</b> wires them together: dielectric deposition, polish, metal. Test comes last, and only then is the wafer cut into single chips.'],
              note: 'This lab models the front end plus the first metal layer — ten steps, not the 1,000+ of a real fab. The logic is the same at every scale: add, pattern, measure, correct.',
            },
            {
              tag: 'WHY', head: 'Why it takes a whole building',
              body: ['Each step needs its own machine, its own chemistry and its own clean environment: a speck of dust the size of a virus kills a die. So the fab is a machine for keeping wafers clean, in vacuum or in inert gas, and moving them between tools without ever touching a human hand.'],
            },
          ],
        },
        {
          id: 'wafers-lots-foups', title: 'Wafers, dies and lots', figure: 'foup',
          steps: [
            {
              tag: 'CONCEPT', head: 'The unit of work is a lot, not a wafer',
              body: ['Wafers travel in a sealed plastic box called a <b>FOUP</b>, 25 wafers at a time. That box is the <b>lot</b>. From that moment until the wafer is cut, the 25 wafers stay together and share one history: one route, one set of recipes, one record.'],
            },
            {
              tag: 'DATA', head: 'What the factory actually tracks',
              go: {"label": "See a traveler in the app", "tab": "lot", "speed": 7},
              body: ['For every lot: an ID (<code>L0042</code>), 25 wafer IDs, the route, the recipe used at each step, which machine and which chamber ran it, and when. That record is called the <b>traveler</b>, and it is the spine of every analysis later.'],
              note: 'The simulator\'s <b>Lot traveler</b> tab shows one row by row: tool, track-in/out time, the recipe actually used after correction, metrology, sensor and control-chart verdicts.',
            },
            {
              tag: 'CONCEPT', head: 'Only the wafers move inside',
              body: ['The FOUP docks at the tool\'s <b>load port</b>. A robot takes one wafer out, sends it through a load lock into vacuum, processes it, and puts it back in the same slot. The box never opens in the open air of the fab — that is the whole point of the box.'],
            },
            {
              tag: 'WHY', head: 'Why 25?',
              body: ['Bigger batches mean fewer trips and fuller tools, but more wafers exposed if a step goes wrong, and longer waits for the batch to fill. 25 is the industry compromise for 300 mm wafers. A furnace is the exception: it loads ~100 wafers at once, which is one reason oxidation is cheap per wafer.'],
            },
          ],
        },
        {
          id: 'six-hours-weeks', title: 'Six hours of work, weeks of waiting', figure: 'pile',
          steps: [
            {
              tag: 'DATA', head: 'Add up the actual process times',
              body: ['Start 5 min · oxidation 55 · lithography 45 · etch 40 · implant 30 · anneal 20 · deposition 35 · polish 45 · metal 50 · test 55. Total = <b>380 minutes</b>, about 6⅓ hours.'],
            },
            {
              tag: 'CONCEPT', head: 'That is not how long a lot takes',
              body: ['In this simulation a lot finishes in about <b>6.5 hours</b>, because queues are short: a new lot starts every hour and the tools just about keep up. In a real fab the same wafer spends <b>6–12 weeks</b> in the building.'],
              figure: 'flow',
            },
            {
              tag: 'WHY', head: 'Where the weeks go',
              body: ['Waiting. Hundreds of steps, hundreds of tools, and a tool only runs your lot when it is free, set up for your recipe, and has a full batch. Wafers queue in front of almost every step — that queue is called <b>WIP</b> (work in progress), and reducing it without starving tools is a whole discipline.'],
              note: 'Rule of thumb (Little\'s law): cycle time ≈ WIP ÷ throughput. Halve the WIP at the same output and you halve the wait.',
            },
            {
              tag: 'TRY', head: 'Feel the difference',
              go: {"label": "Run it: one bad furnace, watch WIP climb", "fault": "furnaceDrift", "speed": 7, "tab": "step"},
              body: ['In fab-sim, set the speed to 7 and watch the WIP counter. Then inject a fault on one furnace: lots pile up behind it, WIP climbs, and cycle time follows — the same failure mode as a real bottleneck.'],
            },
          ],
        },
      ],
    },

    {
      no: '02', title: 'The ten steps', blurb: 'One process at a time: what it does, what it measures, how it drifts.',
      lessons: [
        {
          id: 'oxidation', title: 'Oxidation: growing glass', figure: 'layers',
          steps: [
            {
              tag: 'CONCEPT', head: 'You cannot deposit this layer — you grow it',
              body: ['Heat silicon to about 900 °C in oxygen and the surface turns into silicon dioxide. The oxide grows <b>into</b> the silicon, so it is perfectly clean and stuck to the wafer at an atomic level. This is the gate insulator: the layer the transistor switches across.'],
            },
            {
              tag: 'DATA', head: 'The number that matters: 10 nm ± 0.5',
              body: ['The spec for gate oxide thickness is <b>10 ± 0.5 nm</b>. Too thin and the transistor leaks; too thick and it is too slow to switch. A 5% error is a real problem, which is why this step is measured on every lot.'],
            },
            {
              tag: 'CONCEPT', head: 'Temperature is exponential',
              body: ['Growth rate follows an Arrhenius law: <code>tox ≈ 10 · e^(0.0125 · (T − 900))</code>. Ten degrees too hot is not "a bit more oxide" — it is several percent, which is already outside spec. Small temperature errors become large thickness errors.'],
              note: 'That single exponent is why a drifting thermocouple is one of the most useful faults to study. Everything downstream — threshold voltage, leakage, yield — moves with it.',
            },
            {
              tag: 'DATA', head: 'Measured, but only partly',
              body: ['You cannot measure all 25 wafers in production. The simulator measures <b>3 wafers (slots 1, 13, 25) at 5 sites each</b> — 15 numbers per lot. Everything else about that lot is inferred. Keep that in mind: later, an ML model will be asked to guess the unmeasured 22.'],
            },
            {
              tag: 'WHY', head: 'Why there is no automatic correction here',
              body: ['Oxidation runs in a furnace holding a big batch, and the loop is slow: you would need to cool down, measure and requalify. So there is no run-to-run controller on this step in the lab — which is exactly why a furnace drift is so destructive, and why the data systems have to catch it instead.'],
            },
          ],
        },
        {
          id: 'lithography', title: 'Lithography: drawing the pattern', figure: 'wafer',
          steps: [
            {
              tag: 'CONCEPT', head: 'Light through a mask, into a resist',
              body: ['Spin a light-sensitive resist onto the wafer, shine deep-UV light through a mask that carries the pattern, then develop. Where the light hit, the resist washes away. That resist is now a stencil for the next step.'],
            },
            {
              tag: 'DATA', head: 'Critical dimension: 90 nm ± 4',
              body: ['The width of the printed line is the <b>CD</b>. After develop the spec is <b>90 ± 4 nm</b>. After etch it shrinks: the final gate length is <b>80 ± 4 nm</b>. Two different numbers, both checked, because the second one is what the transistor actually gets.'],
            },
            {
              tag: 'CONCEPT', head: 'Dose and focus: the two knobs',
              body: ['More dose means a wider line: <code>CD ≈ 90 − 1.6 · (dose − 30) + 900 · focus²</code>. Notice the shape: dose is a straight line, focus is <b>quadratic</b> — the classic Bossung curve. Defocus hurts in both directions and the penalty grows fast.'],
            },
            {
              tag: 'DATA', head: 'The controller adjusts dose, not focus',
              go: {"label": "Run it with the controller off", "hint": "\u2026and watch the CD distribution widen; the focus term is quadratic, so both edges of the wafer pay.", "fault": "focusDrift", "r2r": false, "speed": 7, "tab": "spc"},
              body: ['Run-to-run control measures the CD of the last lot and nudges the dose for the next one. Focus errors come from the machine\'s optics and are much harder to trim away. That asymmetry is why a focus drift is a nastier fault than a dose drift.'],
              note: 'In fab-sim: turn R2R off, inject focusDrift and watch CD distribution widen — the quadratic term punishes both edges of the wafer at once.',
            },
          ],
        },
        {
          id: 'etch', title: 'Etch: cutting the stencil', figure: 'twins',
          steps: [
            {
              tag: 'CONCEPT', head: 'Plasma removes what the resist does not protect',
              body: ['A reactive plasma eats the exposed material. Where resist remains, nothing happens. The resist pattern is transferred into the film — and, because the etch is not perfectly directional, the line also gets a little narrower than the resist was.'],
            },
            {
              tag: 'DATA', head: 'Final gate length = printed CD − bias − trim',
              body: ['<code>FI = DI − bias − trim</code>. <b>Bias</b> is the natural sideways etch, <b>trim</b> is the deliberate extra time the controller adds. Spec on the final gate length is <b>80 ± 4 nm</b>.'],
            },
            {
              tag: 'CONCEPT', head: 'Chambers are not clones',
              body: ['This step has two chambers, and each has a fixed mismatch: same recipe, slightly different result. MES sends each lot to the <b>least recently used</b> idle chamber, so traffic splits evenly — and a chamber problem affects half the lots, which is both good news and bad news.'],
              note: 'Good: half the damage. Bad: half the lots look fine, so the pooled average hides it. You have to split the data by chamber to see it — the entire point of chamber matching.',
            },
            {
              tag: 'CONCEPT', head: 'Wear is real: bias grows with RF hours',
              body: ['Every hour of plasma changes the chamber walls, so the bias creeps: <code>bias = 10 + 0.045 · hours</code>. After 60 hours it is 12.7 nm instead of 10. <b>Preventive maintenance</b> resets the hours — and the numbers snap back.'],
            },
            {
              tag: 'TRY', head: 'Watch a controller chase a worn chamber',
              body: ['With R2R on, the loop keeps trimming so the final CD stays on target while the chamber ages. Switch R2R off and the CD walks out of spec with the hours — same chamber, same wear, no correction.'],
            },
          ],
        },
        {
          id: 'implant-anneal', title: 'Implant and anneal: doping', figure: 'flow',
          steps: [
            {
              tag: 'CONCEPT', head: 'Fire ions into the silicon',
              body: ['Source and drain regions have to conduct, so dopant atoms are shot into the wafer at high energy. The dose is measured electrically, in units of 10¹⁵ atoms/cm². Spec here is <b>5.0 ± 0.2</b>, a tight 4% window.'],
            },
            {
              tag: 'CONCEPT', head: 'Then heal the damage',
              body: ['Implanting wrecks the crystal lattice. A rapid thermal anneal — seconds at about 1,050 °C — repairs it and switches the dopants on. The result is measured as <b>sheet resistance</b>: 100 ± 10 Ω/□. Too little anneal means high resistance; too much means the dopants spread.'],
            },
            {
              tag: 'DATA', head: 'One measurement for two steps',
              body: ['Notice that the sheet-resistance check stands in for both: it is the first place an implant problem or an anneal problem becomes visible as a number. This is common in fabs — one metrology step certifies several process steps, which makes root-causing harder.'],
            },
            {
              tag: 'NOTICE', head: 'The unstable beam',
              body: ['The implanter\'s beam current wanders in this lab: the dose drifts and gets noisier. Because sheet resistance depends on dose, the effect arrives one step later — the signature of a fault that hides behind its own metrology.'],
            },
          ],
        },
        {
          id: 'deposit-polish', title: 'Deposition and polish', figure: 'layers',
          steps: [
            {
              tag: 'CONCEPT', head: 'Build up, then flatten',
              body: ['PECVD deposits an insulating film (the interlayer dielectric) over the transistors. It arrives 500 nm thick, and it arrives <b>lumpy</b> — it follows the shape underneath. The next layer needs a flat surface, so CMP grinds it back to 300 nm.'],
            },
            {
              tag: 'DATA', head: 'Two thickness specs, two failure modes',
              body: ['Deposition: <b>500 ± 20 nm</b>. Polish: <b>300 ± 15 nm</b>. Too thin after polish and the metal above will short to the layer below; too thick and the contact will not open. Thickness errors are geometric: they show up on the wafer as rings, not as random dots.'],
            },
            {
              tag: 'CONCEPT', head: 'Polish rate falls as the pad wears',
              body: ['<code>rate = 3.4 · (1 − 0.003 · hours)</code> — after 50 hours the same polish time removes noticeably less. So post-polish thickness creeps up. R2R compensates by adding polish seconds; maintenance (a new pad) resets it.'],
            },
            {
              tag: 'NOTICE', head: 'The two dirtiest failures in the lab',
              body: ['<b>Particles</b> fall from chamber walls onto the wafer and kill the die they land on — a centre cluster on the map. <b>Scratches</b> come from slurry debris dragged by the pad — arcs. Both leave the averages looking fine and only the map telling the truth.'],
            },
          ],
        },
        {
          id: 'sort-test', title: 'Wafer sort: the verdict', figure: 'wafer',
          steps: [
            {
              tag: 'CONCEPT', head: 'Probe every die, electrically',
              body: ['At the end, a probe card touches each die in turn and measures it: threshold voltage, drive current, leakage, contact resistance. 188 dies per wafer, 4,700 per lot. Each die gets a verdict — a <b>bin</b>.'],
            },
            {
              tag: 'DATA', head: 'Bin 1 is pass; the rest are reasons',
              body: ['Bin 1 passes. Other bins record <i>why</i> a die failed: too slow, too leaky, open contact. The mix is the <b>Pareto</b> — the first thing a yield engineer reads, because it says which failure mode to chase.'],
            },
            {
              tag: 'CONCEPT', head: 'Yield is the product of everything before it',
              body: ['A die fails because of a physical accumulation: a thin oxide raises threshold voltage, a wide gate lowers drive current, a particle kills it outright. Yield at sort is the join of every upstream step — the reason sorting data is the training set, not just a score.'],
            },
            {
              tag: 'TRY', head: 'Read a real map',
              go: {"label": "Open the wafer maps", "tab": "yield", "speed": 7},
              body: ['Below is a die map generated live by the engine: 188 dies, one bin per die. The highlighted dies failed. Ask yourself what shape the failures make before reading the caption — the shape is the clue to the cause.'],
              demo: 'wafermap',
            },
          ],
        },
      ],
    },

    {
      no: '03', title: 'The data systems', blurb: 'MES, FDC, SPC, R2R: who records, who watches, who adjusts.',
      lessons: [
        {
          id: 'mes', title: 'MES: the system of record', figure: 'flow',
          steps: [
            {
              tag: 'CONCEPT', head: 'One system owns "where is everything"',
              body: ['The <b>Manufacturing Execution System</b> holds the route, decides which lot goes to which tool, records every track-in and track-out, and blocks a lot that is not allowed to move. If MES is down, the fab stops even though the tools work.'],
            },
            {
              tag: 'CONCEPT', head: 'Dispatch is a policy, not a queue',
              body: ['In this lab: when a tool frees up, MES picks the next non-held lot in that step\'s queue, and for multi-chamber steps it prefers the <b>least recently used</b> chamber so wear spreads evenly. Change the policy and the whole fab changes shape.'],
            },
            {
              tag: 'DATA', head: 'The traveler is the join key',
              go: {"label": "Open a real traveler, row by row", "tab": "lot", "speed": 7},
              body: ['Every analysis later — yield by chamber, SPC, root cause — is a <b>join</b> between a measurement and the traveler row that says which tool, chamber, recipe and time produced it. No traveler, no attribution. This is why MES data quality is a real engineering job.'],
            },
            {
              tag: 'NOTICE', head: 'MES can also stop the line',
              body: ['When a control chart flags an out-of-control lot, MES puts it <b>on hold</b>: it stays in the queue, marked, and waits for an engineer\'s disposition. Automatic hold is powerful and dangerous — a badly tuned chart can hold the whole fab.'],
            },
          ],
        },
        {
          id: 'fdc', title: 'FDC: watching the machine, not the wafer', figure: 'chart',
          steps: [
            {
              tag: 'CONCEPT', head: 'Sensors, every run, every second',
              body: ['While a tool runs, it streams sensor traces: RF power, pressure, gas flow, temperature, endpoint. <b>Fault Detection and Classification</b> compares the shape of each trace against a golden run and alarms when it drifts. It needs no wafer measurement at all.'],
            },
            {
              tag: 'DATA', head: '60 points × 2 sensors, per run',
              body: ['In this lab each step uploads a compressed trace per lot: a summary of the two most telling sensors. A healthy fab produces <b>zero alarms</b> — the detector is tuned to be quiet, because an alarm you learn to ignore is worse than no alarm.'],
            },
            {
              tag: 'CONCEPT', head: 'Early, but not authoritative',
              go: {"label": "Run it: FDC alarms on the first lot", "fault": "furnaceDrift", "speed": 7, "tab": "step"},
              body: ['FDC sees the process, not the product. It can tell you "this chamber\'s temperature soak is 6 °C high" twenty lots before a wafer finally fails a spec. What it cannot tell you is whether the wafer is still good — that is metrology\'s job.'],
              note: 'That is the division of labour: FDC catches the cause early and cheaply; SPC catches the effect late and expensively. Fabs need both, and this lab is built to show you why.',
            },
            {
              tag: 'WHY', head: 'Why the alarm threshold is the hard part',
              body: ['Set it tight and every normal fluctuation pages someone — alarm fatigue, and engineers start ignoring it. Set it loose and you miss the drift. Real fabs tune per chamber, per recipe, and review false-alarm rates as a metric.'],
            },
          ],
        },
        {
          id: 'spc', title: 'SPC: is the process in control?', figure: 'chart',
          steps: [
            {
              tag: 'CONCEPT', head: 'Plot the measurement, draw the limits',
              body: ['<b>Statistical process control</b> charts a measured parameter over lot number, with a centre line and ±3σ limits. The limits come from the process itself — not from the spec. A point outside the limits means something changed, even if the part still passes.'],
            },
            {
              tag: 'CONCEPT', head: 'Phase I learns, Phase II watches',
              body: ['The first 40 lots set the baseline (Phase I). The limits are then <b>frozen</b>. From lot 41 the chart is watched (Phase II). If you kept recomputing the limits from recent data, a slow drift would drag the limits along with it and never trip — a classic and expensive mistake.'],
              note: 'In this lab σ is computed from the first 40 lots and stored once. It is also floored by the observed spread: run-to-run control makes consecutive lots similar, which would otherwise produce fake-narrow limits and constant false alarms.',
            },
            {
              tag: 'DATA', head: 'Two simple rules catch most real problems',
              body: ['<b>Rule 1:</b> one point beyond 3σ — a spike. <b>Rule 2:</b> nine points in a row on the same side of centre — a shift, even if every point is inside the limits. Rule 2 is how a slow drift gets caught before it becomes scrap.'],
            },
            {
              tag: 'TRY', head: 'Find the shift',
              go: {"label": "Run it: etch chamber A seasons, SPC walks", "fault": "etchSeason", "speed": 7, "tab": "spc"},
              body: ['This chart is generated by the engine with no fault injected: normal run-to-run variation only. Now inject furnaceDrift in the app and watch the points walk up, one lot at a time, until the chart finally speaks.'],
              demo: 'spc',
            },
          ],
        },
        {
          id: 'r2r', title: 'R2R: closing the loop', figure: 'chart',
          steps: [
            {
              tag: 'CONCEPT', head: 'Measure the last lot, adjust the next',
              body: ['<b>Run-to-run control</b> (also called APC) reads the measurement of the lot just finished and changes the recipe of the lot about to start: a bit more dose, a bit less polish time. It is a feedback loop with a one-lot delay.'],
            },
            {
              tag: 'CONCEPT', head: 'Feedback and feed-forward are different',
              body: ['<b>Feedback</b> fixes a step using its own measurement (CD too small → more dose). <b>Feed-forward</b> passes the measurement downstream: the printed CD decides the etch trim time, so a litho error is compensated during etch. Both are in this lab.'],
            },
            {
              tag: 'DATA', head: 'One controller per chamber',
              body: ['Because the chambers differ, each chamber keeps its own correction. That is what makes closed-loop chambers <i>converge</i>: two chambers that start 0.75 nm apart end up matching, and the pooled chart narrows. Open the loop and the mismatch becomes visible again.'],
            },
            {
              tag: 'NOTICE', head: 'Control hides problems — on purpose and otherwise',
              body: ['A good controller makes the process look boring: the number sits on target and nothing alarms. But the machine underneath can still be degrading. If your only view is the controlled output, you will not notice until the correction runs out of range.'],
              note: 'This is why fabs watch the <b>correction itself</b> as a signal, not just the result. A dose correction creeping upward lot after lot is a machine telling you it is tired.',
            },
            {
              tag: 'TRY', head: 'Open and close the loop',
              go: {"label": "Run it with R2R off, then on", "hint": "Same fault, same seed: only the control loop changes.", "fault": "focusDrift", "r2r": false, "speed": 7, "tab": "spc"},
              body: ['Run the demo: the same fault, with and without control. The gap between the two bars is the value of the loop — and the smaller number is not "no problem", just "problem absorbed".'],
              demo: 'r2r',
            },
          ],
        },
      ],
    },

    {
      no: '04', title: 'Yield', blurb: 'Turning a wafer map into a machine name.',
      lessons: [
        {
          id: 'what-yield-is', title: 'What yield is', figure: 'wafer',
          steps: [
            {
              tag: 'CONCEPT', head: 'Yield is a fraction of dies, not of wafers',
              body: ['If 186 of 188 dies pass, that wafer\'s yield is 98.9%. A lot\'s yield is the mean over 25 wafers. One bad wafer is diluted 25-fold, which is why a single dramatic map can hide inside a healthy-looking lot number.'],
            },
            {
              tag: 'DATA', head: 'The Pareto tells you where to work',
              body: ['Failures arrive in bins, and the bin list is ranked: this run\'s biggest loss first. An engineer\'s week is spent moving the top bar down. Fixing the second bar while the first is untouched changes almost nothing.'],
            },
            {
              tag: 'CONCEPT', head: 'Every die failure has a physical cause upstream',
              body: ['A die does not "fail at test". It fails because its gate oxide was thin, or a particle landed on it, or its contact was not opened. Sorting only <i>reports</i> the failure; the cause is in the ten steps and their travelers.'],
            },
            {
              tag: 'WHY', head: 'Why 98% still costs a fortune',
              body: ['A fab making 4,700 dies per lot, 24 lots a day, loses ~94 dies per lot at 98%. At a few dollars per good die that is real money every single day — which is why yield engineers exist and why a 1% gain is a big deal.'],
            },
          ],
        },
        {
          id: 'wafer-maps', title: 'Wafer maps: the shape is the clue', figure: 'wafer',
          steps: [
            {
              tag: 'CONCEPT', head: 'A map is a picture of a cause',
              body: ['Plot which dies failed, keeping their position on the wafer, and patterns appear. The pattern is not decorative: it is the physical footprint of the mechanism that caused it. Learning to read shapes is the fastest root-cause tool in the fab.'],
            },
            {
              tag: 'DATA', head: 'Four signatures worth memorising',
              body: [
                '<b>Centre cluster</b> → something fell on the wafer or gas flow was wrong in the middle (particles).<br>' +
                '<b>Edge ring</b> → a radial effect: temperature, thickness or CD non-uniformity across the wafer.<br>' +
                '<b>Arcs</b> → mechanical dragging: slurry debris, a scratch from handling (CMP).<br>' +
                '<b>Whole wafer shifted</b> → all dies slightly wrong: a recipe or a tool offset, not a spot event.',
              ],
            },
            {
              tag: 'CONCEPT', head: 'A shape is a hypothesis, not a diagnosis',
              body: ['Seeing an edge ring tells you the effect is radial. It does not tell you which step: oxide thickness, deposited film and polished thickness all vary radially, on three different tools. To narrow it, test the radial numbers, not the picture: is the mean off, or only the edge?'],
            },
            {
              tag: 'NOTICE', head: 'Averages are blind to this',
              go: {"label": "Open the wafer maps", "tab": "yield", "speed": 7},
              body: ['A particle kills a few dies; the mean oxide thickness barely moves and the SPC chart stays quiet. The map is the only place the event is visible. This is exactly why fabs build image classifiers for wafer maps — the signal is spatial, not statistical.'],
              demo: 'wafermap',
            },
          ],
        },
        {
          id: 'chamber-matching', title: 'Chamber matching: naming the tool', figure: 'twins',
          steps: [
            {
              tag: 'CONCEPT', head: 'A yield number is useless without "on which tool"',
              body: ['Two chambers, one recipe, 98% overall yield. That average could be 98/98 — or 96/100. Only the split tells you. <b>Chamber matching</b> is the practice of keeping twins identical and of reporting every metric per chamber.'],
            },
            {
              tag: 'DATA', head: 'Join the map to the traveler',
              body: ['For each finished lot, look up which chamber ran each multi-chamber step (the traveler has it), then group yield by chamber. In this lab that table is the Chambers tab — and it names the bad chamber every time.'],
              note: 'Run the lab\'s own check: inject etchSeason, wait 500 lots, compare ETCH-03A with ETCH-03B. The gap is one to three points, and it is unmistakable once split — invisible in the pooled number.',
            },
            {
              tag: 'CONCEPT', head: 'Why the good twin matters',
              go: {"label": "Run it: same fault, one chamber", "fault": "etchSeason", "tab": "chambers", "speed": 7},
              body: ['The healthy chamber is a built-in control: same recipe, same period, same lots. When one twin is 2% worse, the difference cannot be the recipe or the material — it is the chamber. That is the cleanest experiment a fab ever gets, and it happens by accident every day.'],
            },
            {
              tag: 'WHY', head: 'Matching is maintenance, not luck',
              body: ['Fabs qualify chambers against each other after every maintenance event: run the same test wafer, compare, adjust hardware until they match. A chamber that will not match is taken out of service — because every lot it runs is a lot you cannot compare.'],
            },
          ],
        },
      ],
    },

    {
      no: '05', title: 'Putting it together', blurb: 'From a bad number to a machine name, the way engineers do it.',
      lessons: [
        {
          id: 'find-the-fault', title: 'Find the fault from the data', figure: 'chart',
          steps: [
            {
              tag: 'CONCEPT', head: 'Work backwards, one system at a time',
              body: ['A yield drop lands on your desk. The method is always the same: <b>which parameter</b> moved, <b>which step</b> owns that parameter, <b>which tool or chamber</b> ran the affected lots, and <b>since when</b>. Four questions, in that order.'],
            },
            {
              tag: 'DATA', head: 'Pick the telling parameter',
              body: ['Yield alone is a symptom. Split the fails by bin: if it is "too slow", suspect gate length or oxide; if it is "leaky", suspect oxide or contact; if it is "defect", go to the map. The bin mix narrows the search before you look at a single chart.'],
            },
            {
              tag: 'CONCEPT', head: 'Use the split, not the average',
              body: ['Group that parameter by tool, by chamber, by time. Often the answer is a step function — everything before Tuesday was fine. A step change is a hardware event (a PM, a part swap, a new chamber); a ramp is wear; a scatter is a random defect mechanism.'],
            },
            {
              tag: 'CONCEPT', head: 'Confirm with a second, independent signal',
              body: ['Never close on one chart. Here: FDC says the chamber\'s bias drifted, SPC says the final CD walked, the map says the effect is radial (edge-heavy), and the traveler says the affected lots all came from one chamber. Four independent sources, one story.'],
              note: 'If your sources disagree, you have not found the cause yet — you have found a coincidence.',
            },
            {
              tag: 'TRY', head: 'Do it yourself',
              go: {"label": "Open the app and inject something blind", "hint": "Fault dropdown, any fault. Work the four questions before you read what you picked.", "fault": "etchSeason", "speed": 7, "tab": "chambers", "floor": true, "sel": "ETCH-03A"},
              body: ['In fab-sim, do not look at the fault dropdown. Inject a fault, then work the four questions: press the fault only when you are ready to check yourself. That loop — symptom, split, confirm — is the actual job.'],
            },
          ],
        },
        {
          id: 'why-both', title: 'Why a fab needs both FDC and SPC', figure: 'chart',
          steps: [
            {
              tag: 'CONCEPT', head: 'Cause versus effect, hours apart',
              body: ['Oxidation takes 55 minutes; the first measurement that reveals a problem happens within the same lot, but the effect on <b>yield</b> only appears at sort, hours later, after every other step has run. Data systems buy you that time back — or fail to.'],
            },
            {
              tag: 'DATA', head: 'The furnace case, in numbers',
              body: ['Furnace thermocouple drifts: oxide grows, threshold voltage rises, and yield falls hard — there is no controller on this step to absorb it. <b>FDC</b> sees the soak temperature leave its envelope while the first lot is still inside. <b>SPC</b> sees the thickness 40 minutes later. Sort sees the yield an hour after that.'],
            },
            {
              tag: 'CONCEPT', head: 'Each system has a different failure mode',
              body: ['FDC without SPC: you fix causes that turn out not to matter, and you argue about alarms. SPC without FDC: you find out late, from expensive product, and your chart only covers the 3 wafers you measured. Together, one warns and the other confirms.'],
            },
            {
              tag: 'WHY', head: 'And a controller changes the argument',
              body: ['Add R2R and the same furnace drift looks harmless in the output — until the correction saturates. So a mature fab watches <b>three</b> things: the trace, the measurement, and the correction the controller had to apply. The third is the earliest warning of all.'],
            },
            {
              tag: 'TRY', head: 'Run the experiment',
              go: {"label": "Run it: furnace drift, read all four tabs", "fault": "furnaceDrift", "speed": 7, "tab": "chambers"},
              body: ['In fab-sim: inject furnaceDrift, then read FDC (instant alarm), SPC (thickness chart), Chambers (no split — one furnace), and Yield (collapses). Now inject etchSeason instead and watch which of the four reacts differently.'],
              demo: 'r2r',
            },
          ],
        },
      ],
    },
    {
      no: '06', title: 'Test & product engineering', blurb: 'The job after the fab: prove the part works, then prove it every time, cheaply.',
      lessons: [
        {
          id: 'test-phases', title: 'Six phases, six different jobs', figure: 'phases',
          steps: [
            {
              tag: 'CONCEPT', head: 'A product has a life, not a step',
              body: ['Everything before this chapter happens to one lot at a time. A <b>product</b> is different: it is designed once, brought to life once, characterised once, then manufactured five million times. Test engineers live across that whole arc — which is why two job adverts with the same words can be completely different jobs.'],
            },
            {
              tag: 'CONCEPT', head: 'The six phases, and who stands in each',
              body: ['<b>Design</b> (RTL, scan insertion, DFT) → <b>bring-up</b> (first silicon, debug the patterns) → <b>characterisation</b> (shmoo, corners, guardbands) → <b>production test</b> (the test program that runs forever) → <b>ramp and HVM</b> (yield, excursions, cost) → <b>returns</b> (RMA, failure analysis, back to design).'],
              note: 'A <b>graduate test / product engineering</b> role sits at bring-up and characterisation: validate test conditions, methodology and content on first silicon, analyse failures, optimise the patterns. A <b>production test engineering</b> role at a memory maker sits at production test and ramp: own the test program for HVM, cut test time, and mine the test data with AI/ML. Same vocabulary, opposite end of the timeline.',
            },
            {
              tag: 'DATA', head: 'What actually changes between them',
              body: ['Bring-up answers <b>“does this design work at all, and under what conditions?”</b> — a handful of parts, thousands of measurements, no labels yet. Production test answers <b>“does this part work, in 4 seconds, for the next two years?”</b> — millions of parts, one verdict each, and a cost target per second.'],
            },
            {
              tag: 'WHY', head: 'Why the AI skills transfer, and why they do not transfer for free',
              body: ['Python, statistics and pattern recognition are the same. But bring-up data is <b>small, hand-labelled and non-stationary</b> (yesterday\'s part is a different design), while production data is <b>huge, unlabelled and drifting</b> (every part is nominally identical, and that is the trap). A model that shines on one is usually naive on the other.'],
            },
          ],
        },
        {
          id: 'test-program', title: 'A test program is a program', figure: 'tester',
          steps: [
            {
              tag: 'CONCEPT', head: 'A probe card touches 5 dies at once',
              body: ['At wafer sort the wafer sits on a stage under a <b>probe card</b>: one set of needles per die, so a <b>site</b> tests one die at a time and five sites test five dies in parallel. A 188-die wafer is 38 touches, not 188. Everything about test cost is really about that number.'],
            },
            {
              tag: 'CONCEPT', head: 'The program is an ordered list of tests',
              body: ['Each entry: a condition (voltage, temperature, timing), a measurement, a <b>limit</b>, and the <b>bin</b> a failure assigns. Continuity → Vt → Idsat → Ioff → scan/functional. Order matters: cheap tests first, because a die that fails continuity never needs the expensive one.'],
              note: 'A bin is not a number, it is a disposal decision: bin 1 ships, bin 2–4 are parametric fails (some can be sold down a speed grade), bin 5 is a kill, bin 6 is contact — the probe card, not the die.'
            },
            {
              tag: 'DATA', head: 'The arithmetic of test time',
              body: ['In the simulator: 188 dies per wafer, 5 sites, and a program of 3.2 + 6.5 + 8.0 + 5.5 + 14.0 = 37.2 ms per die. That is 188 × 37.2 ÷ 5 ≈ <b>1.4 s of touch time per wafer</b>, plus handling. Cut one test by 2 ms and you save 75 ms a wafer — which at a million wafers is 21 hours of tester time.'],
            },
            {
              tag: 'TRY', head: 'Read the program, then move the slider',
              go: {"label": "Open the test floor", "tab": "test", "speed": 7},
              body: ['The new <b>Test floor</b> tab runs that program on a sorted wafer: per-test pass/fail, the bin of every die, and the time it took. Then switch on adaptive test and watch what happens to test time — and to the parts you let through.'],
            },
          ],
        },
        {
          id: 'first-silicon', title: 'First silicon: the job is to find the bug', figure: 'shmoo',
          steps: [
            {
              tag: 'CONCEPT', head: 'Nothing is known yet, so nothing can be assumed',
              body: ['On first silicon there is no known-good part to compare against. The tester is running patterns that were written from a simulation, on a design that has never been manufactured. So bring-up is not measurement — it is <b>search</b>: does it power up, does the scan chain shift, does it fail at all corners or one?'],
            },
            {
              tag: 'DATA', head: 'The shmoo plot is the instrument',
              body: ['Sweep two conditions and colour the pass/fail grid: voltage down one axis, frequency up the other. The shape of the boundary is the answer. A clean diagonal edge means the part is working as designed and running out of timing margin. A hole in the middle or a ragged edge means a real defect — and its shape usually names the circuit.'],
            },
            {
              tag: 'CONCEPT', head: 'Characterisation writes the guardband',
              body: ['Production needs one number per die, not a map. So characterisation turns the boundary into limits with margin: the shipping window in the figure is deliberately inside the pass region, because parts drift with temperature, age and supplier. That margin is a decision, and it costs yield — which is why it gets argued over.'],
            },
            {
              tag: 'CONCEPT', head: 'Bench gear is part of the job',
              body: ['This is where the oscilloscope, logic analyser and voltmeter in a test-engineering job advert come from: when a scan pattern fails on silicon but passes in simulation, you probe the board, not the database. Python is used to automate the sweeps and parse the logs — not to replace the probe.'],
            },
          ],
        },
        {
          id: 'test-data', title: 'Every die is a row', figure: 'wafer',
          steps: [
            {
              tag: 'CONCEPT', head: 'Sort output is a table, not a picture',
              body: ['The tester writes <b>STDF</b>: one record per die, one column per test, plus the wafer and die coordinates. A wafer is ~188 rows; a lot is ~4,700; a year of one product is billions. The wafer map is just that table, reshaped.'],
            },
            {
              tag: 'DATA', head: 'The join is what makes it valuable',
              body: ['Each die carries its lot and wafer ID, and the lot carries its <b>traveler</b> — every tool and chamber that touched it. Join test data to process history and you can ask the only question that pays: which machine made the failing dies? That join is why the fab spends so much effort on ID tracking.'],
            },
            {
              tag: 'CONCEPT', head: 'Attribute data and variable data are different problems',
              body: ['<b>Attribute</b>: pass/fail, a bin. <b>Variable</b>: the measured value, continuous. Bins are easy to count and hide everything; parametrics are noisy but carry the trend. Most beginner mistakes come from modelling bins and then wondering why the model cannot say <i>why</i>.'],
            },
            {
              tag: 'TRY', head: 'Look at the same wafer three ways',
              go: {"label": "Open it: bins, then score", "tab": "test", "speed": 7, "amode": "score", "fault": "padScratch"},
              body: ['In the test floor, switch the map between <b>bins</b>, <b>score</b> (distance from the healthy centre) and <b>skipped</b> (what adaptive test let go). Same 188 dies, three completely different pictures — and only the third one is about money.'],
            },
          ],
        },
        {
          id: 'ai-in-test', title: 'Where AI helps, and where it lies', figure: 'chart',
          steps: [
            {
              tag: 'DATA', head: 'Four things ML genuinely does here',
              body: ['<b>1.</b> Wafer-map pattern recognition: classify the shape (edge ring, centre blob, scratch, random) in milliseconds instead of an engineer\'s afternoon. <b>2.</b> Anomaly detection on parametrics: flag a die or a lot that is inside limits but unlike its neighbours. <b>3.</b> Fail-signature clustering: group dies that fail the same way, so one root cause covers 400 parts. <b>4.</b> Adaptive test: predict which tests a die can safely skip.'],
            },
            {
              tag: 'CONCEPT', head: 'Prediction is cheap; a decision is not',
              body: ['A model that outputs a risk score is harmless. A model that <b>skips a test</b>, or gates a shipment, is a manufacturing decision with an escape cost attached. That is why the job adverts keep repeating “evaluate”, “validate”, “responsible use” and “engineering judgement” — the hard part is not the model, it is the threshold and who signs for it.'],
            },
            {
              tag: 'WHY', head: 'The four ways these models lie',
              body: ['<b>Drift</b>: the fab changes, the model does not — train on January, run in June, and it silently misses a new mechanism. <b>Skew</b>: trained on shipped (passing) parts, so it has never seen a real fail. <b>Leakage</b>: the feature quietly encodes the answer, e.g. the tool ID of the chamber that happens to be broken this month. <b>Threshold</b>: tuned on last quarter\'s data, never re-checked against escapes.'],
              note: 'The honest test of a test-engineering model is not accuracy — it is <b>escapes per million parts at a fixed test-time budget</b>, measured on parts it has never seen.'
            },
            {
              tag: 'TRY', head: 'Turn it on and count the escapes',
              go: {"label": "Run it: adaptive test on", "tab": "test", "speed": 7, "atest": 1, "thr": 2.6,
                "hint": "Watch test time fall, then watch escapes appear. Move the threshold until both are acceptable — that trade-off is the job."},
              body: ['In the test floor, adaptive test skips the remaining tests for dies whose running score is below the threshold. Lower the threshold and you test more (costlier, safer); raise it and you ship parts you never measured. Every setting is a position on that curve — there is no free one.'],
            },
          ],
        },
      ],
    },
  ];

  // flatten for routing and progress
  const LESSONS = [];
  COURSE.forEach(ch => ch.lessons.forEach((l, i) => { l.chapter = ch; l.indexInChapter = i; LESSONS.push(l); }));
  LESSONS.forEach((l, i) => { l.n = i + 1; });

  root.FABLAB = { COURSE, LESSONS };
})(typeof window !== 'undefined' ? window : globalThis);
