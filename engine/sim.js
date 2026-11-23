/* FabSim engine — pure model, no DOM. Works in browser (window.FabSim) and Node (require).
 * 1 tick = 1 simulated minute. Lots of 25 wafers flow through a simplified CMOS flow.
 * Every step produces: MES events, FDC sensor traces, sampled metrology -> SPC, per-chamber R2R adjustments.
 * Etch, CVD and CMP have two chambers each, with fixed tool-to-tool mismatch and independent
 * wear/R2R state — so chamber-level yield analysis finds the bad chamber.
 */
(function (root) {
  'use strict';

  function mulberry32(seed) {
    return function () {
      seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function gauss(rng) {
    let u = 0, v = 0;
    while (u === 0) u = rng();
    while (v === 0) v = rng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  function poisson(rng, lambda) {
    const L = Math.exp(-lambda); let k = 0, p = 1;
    do { k++; p *= rng(); } while (p > L);
    return k - 1;
  }
  const mean = a => a.reduce((s, x) => s + x, 0) / (a.length || 1);
  const std = a => { const m = mean(a); return Math.sqrt(mean(a.map(x => (x - m) ** 2))); };
  const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

  const GRID = 16;
  const DIES = [];
  for (let i = 0; i < GRID; i++) for (let j = 0; j < GRID; j++) {
    const x = (i + 0.5) / GRID * 2 - 1, y = (j + 0.5) / GRID * 2 - 1;
    if (x * x + y * y <= 0.92) DIES.push({ i, j, x, y, r: Math.sqrt(x * x + y * y) });
  }
  const SITES = [[0, 0], [0.7, 0], [-0.7, 0], [0, 0.7], [0, -0.7]];
  const SAMPLE_WAFERS = [0, 12, 24];
  const R0 = 0.42; // radial profiles: value = m + a·(r² − R0), so wafer mean ≈ m

  // ---------------- process flow ----------------
  // tools: chambers/tools that can each process one lot at a time. mismatch = fixed tool-to-tool offset.
  const STEPS = [
    { id: 'START', name: 'Lot Start', tools: ['SORTER-01'], area: 'Fab control', time: 5,
      desc: 'Bare 300 mm Si wafers are pulled from stock, laser-scribed with an ID and grouped into a 25-wafer lot in a FOUP. MES creates the lot record and the route (sequence of steps + recipes).',
      dataIn: ['Production plan (ERP)', 'Route & recipe definitions'], dataOut: ['Lot ID, wafer IDs, slot map → MES'] },
    { id: 'OX', name: 'Gate Oxidation', tools: ['FURN-01'], area: 'Diffusion', time: 55,
      recipe: { tempC: 900, timeMin: 30 },
      param: { key: 'tox', label: 'Gate oxide thickness', unit: 'nm', target: 10.0, lsl: 9.5, usl: 10.5, metro: 'Ellipsometer' },
      sensors: ['zone temp (°C)', 'O₂ flow (slm)'],
      desc: 'Si is heated in O₂ at ~900 °C so a thin SiO₂ layer grows (Deal–Grove kinetics). This gate oxide sets the transistor threshold voltage and drive current, so thickness is controlled to ~±0.5 nm.',
      dataIn: ['Recipe (MES)'], dataOut: ['Temp/O₂ traces → FDC', 'Oxide thickness (5 sites × 3 wafers) → SPC', 'Track-in/out → MES'] },
    { id: 'LITHO', name: 'Gate Lithography', tools: ['SCAN-02'], area: 'Photo', time: 45,
      recipe: { doseMJ: 30.0, focusUm: 0.0 },
      param: { key: 'diCD', label: 'After-develop CD', unit: 'nm', target: 90, lsl: 86, usl: 94, metro: 'CD-SEM' },
      sensors: ['stage focus error (µm)', 'dose (mJ/cm²)'],
      desc: 'Coat photoresist → soft bake → expose the gate pattern with 193 nm light through a reticle → post-exposure bake → develop. Dose and focus set the printed line width (CD). An R2R controller tunes dose lot-to-lot from CD-SEM feedback.',
      dataIn: ['Recipe (MES)', "Dose correction ← R2R (feedback from previous lots' CD)"], dataOut: ["Focus/dose traces → FDC", 'DI CD → SPC & → R2R (feed-forward to etch)'] },
    { id: 'ETCH', name: 'Gate Etch', tools: ['ETCH-03A', 'ETCH-03B'], area: 'Etch', time: 40,
      mismatch: { 'ETCH-03A': { offset: 0.35 }, 'ETCH-03B': { offset: -0.40 } },
      recipe: { rfW: 500, trimSec: 20 },
      param: { key: 'fiCD', label: 'Final gate length (FI CD)', unit: 'nm', target: 80, lsl: 76, usl: 84, metro: 'CD-SEM' },
      sensors: ['RF reflected power (W)', 'OES endpoint (a.u.)'],
      desc: 'A Cl₂/HBr plasma transfers the resist pattern into the gate stack. A timed "trim" step shrinks the line. Chamber walls accumulate polymer with RF-hours, raising etch bias until a preventive-maintenance clean. Each chamber has its own bias and its own R2R feed-forward trim, so a mis-matched chamber shows up in chamber-level yield analysis.',
      dataIn: ["DI CD per lot ← R2R feed-forward", 'Chamber RF-hours (equipment state)'], dataOut: ['RF/OES traces → FDC', 'FI CD (= gate length) → SPC', 'Chamber ID per lot → YMS'] },
    { id: 'IMPL', name: 'S/D Ion Implant', tools: ['IMP-01'], area: 'Implant', time: 30,
      recipe: { doseE15: 5.0, energyKeV: 20 },
      param: { key: 'dose', label: 'Implant dose (Faraday)', unit: '1e15/cm²', target: 5.0, lsl: 4.8, usl: 5.2, metro: 'Faraday cup / dosimetry' },
      sensors: ['beam current (mA)', 'chamber vacuum (µTorr)'],
      desc: 'Arsenic ions are accelerated and implanted into source/drain regions. Dose is integrated from beam current in real time; beam instability gives dose non-uniformity.',
      dataIn: ['Recipe (MES)'], dataOut: ['Beam-current trace → FDC', 'Integrated dose → SPC'] },
    { id: 'ANNEAL', name: 'Spike Anneal (RTP)', tools: ['RTP-01'], area: 'Diffusion', time: 20,
      recipe: { peakC: 1050 },
      param: { key: 'rs', label: 'Sheet resistance', unit: 'Ω/□', target: 100, lsl: 90, usl: 110, metro: '4-point probe' },
      sensors: ['pyrometer temp (°C)', 'lamp power (%)'],
      desc: 'Lamps spike the wafer to ~1050 °C for about a second to activate dopants and repair implant damage. Sheet resistance depends on both the implant dose (upstream) and the peak temperature.',
      dataIn: ['Recipe (MES)', 'Implant dose (physically carried on the wafer)'], dataOut: ['Pyrometer trace → FDC', 'Rs → SPC'] },
    { id: 'CVD', name: 'ILD Deposition (PECVD)', tools: ['PECVD-02A', 'PECVD-02B'], area: 'Thin Films', time: 35,
      mismatch: { 'PECVD-02A': { offset: 1.8 }, 'PECVD-02B': { offset: -1.6 } },
      recipe: { timeSec: 120, rfW: 800 },
      param: { key: 'ild', label: 'ILD thickness', unit: 'nm', target: 500, lsl: 480, usl: 520, metro: 'Reflectometer + defect inspection' },
      sensors: ['chamber pressure (Torr)', 'RF power (W)'],
      desc: 'Plasma-enhanced CVD deposits an interlayer dielectric (SiO₂) over the transistors. Flaking from chamber walls can drop particles (killer defects). Two chambers with slightly different deposition rates; a defect-inspection tool scans sampled wafers.',
      dataIn: ['Recipe (MES)'], dataOut: ['Pressure/RF traces → FDC', 'ILD thickness → SPC', 'Defect map → YMS'] },
    { id: 'CMP', name: 'ILD CMP', tools: ['CMP-01A', 'CMP-01B'], area: 'CMP', time: 45,
      mismatch: { 'CMP-01A': { rate: 1.0, offset: 0 }, 'CMP-01B': { rate: 0.985, offset: 1.2 } },
      recipe: { polishSec: 60 },
      param: { key: 'postCmp', label: 'Post-CMP ILD thickness', unit: 'nm', target: 300, lsl: 285, usl: 315, metro: 'Integrated thickness metrology' },
      sensors: ['motor torque (A)', 'pad temperature (°C)'],
      desc: 'Slurry + rotating pad polish the ILD flat. Removal rate decays as the pad wears; each platen has its own pad, its own removal rate and its own R2R polish-time correction (reset when that pad is changed). Debris on a pad causes arc-shaped scratches.',
      dataIn: ['Incoming ILD thickness ← feed-forward', 'Polish-time correction ← R2R'], dataOut: ['Torque/temp traces → FDC', 'Post-CMP thickness → SPC', 'Scratch/defect map → YMS'] },
    { id: 'METAL', name: 'Contact & Metal 1', tools: ['PVD-01'], area: 'Metallization', time: 50,
      recipe: { tinNm: 5 },
      param: { key: 'rc', label: 'Contact resistance', unit: 'Ω', target: 20, lsl: 15, usl: 25, metro: 'Kelvin test structure' },
      sensors: ['target power (kW)', 'base pressure (µTorr)'],
      desc: 'Contacts are etched through the ILD, lined with Ti/TiN, filled with tungsten and capped with Metal-1. Contact resistance depends on the ILD thickness left after CMP (deeper contacts → higher Rc).',
      dataIn: ['Post-CMP thickness (physically on wafer)'], dataOut: ['PVD traces → FDC', 'Contact resistance → SPC'] },
    { id: 'SORT', name: 'Wafer Sort (E-Test)', tools: ['TEST-01'], area: 'Test', time: 55,
      desc: 'Every die is probed: threshold voltage (Vt), drive current (Idsat), off-state leakage and contact continuity. Dies are binned pass/fail and a wafer map is sent to the Yield Management System, which joins it with all upstream data — including which chamber ran each step.',
      dataIn: ['All physical history on the wafer'], dataOut: ['Die bins & parametrics → YMS', 'Lot complete → MES', 'Wafer-level dataset → Data lake'] },
  ];
  const STEP_INDEX = Object.fromEntries(STEPS.map((s, i) => [s.id, i]));

  const BINS = {
    1: { name: 'Pass', color: '#2fbf71' },
    2: { name: 'Vt out of spec', color: '#f5a524' },
    3: { name: 'Idsat low/high', color: '#9b6bff' },
    4: { name: 'High leakage', color: '#ff6b9a' },
    5: { name: 'Defect / short', color: '#e5484d' },
    6: { name: 'Contact open/high Rc', color: '#3fa7ff' },
  };

  const PM_LIMIT = { ETCH: 60, CMP: 50 }; // tool-hours between preventive maintenance (scaled to sim speed)

  // faults are chamber-specific where that makes sense: finding the bad chamber is the point.
  const FAULTS = {
    furnaceDrift: { label: 'Furnace thermocouple drift', tool: 'FURN-01' },
    focusDrift: { label: 'Scanner focus drift', tool: 'SCAN-02' },
    etchSeason: { label: 'Etch wall build-up (chamber A only)', tool: 'ETCH-03A' },
    beamUnstable: { label: 'Implanter beam instability', tool: 'IMP-01' },
    particles: { label: 'PECVD particle excursion (chamber A only)', tool: 'PECVD-02A' },
    padScratch: { label: 'CMP pad debris (platen A only)', tool: 'CMP-01A' },
  };

  function createSim(opts = {}) {
    const rng = mulberry32(opts.seed ?? 42);
    const g = () => gauss(rng);
    const S = {
      t: 0, lotSeq: 0,
      releaseEvery: opts.releaseEvery ?? 60,
      r2r: opts.r2r ?? true,
      autoHold: opts.autoHold ?? true,
      faults: {},
      lots: [],        // active lots + the newest KEEP.doneLots finished ones
      done: [],        // finished lots, oldest first (same objects as in lots)
      tools: {},
      steps: STEPS.map(s => ({
        id: s.id, queue: [], runs: 0,
        tools: s.tools.map(name => {
          const mis = (s.mismatch && s.mismatch[name]) || {};
          const t = {
            name, step: s.id, busy: null, busyUntil: 0, runs: 0,
            hours: 0,                     // RF-hours (etch) or pad-hours (CMP)
            offset: mis.offset || 0,      // fixed tool-to-tool mismatch
            rate: mis.rate ?? 1,          // relative removal/deposition rate
            corr: 0,                      // per-tool R2R correction (dose or polish time)
            drift: 0,                     // fault-driven drift (temperature / focus / bias)
          };
          return t;
        }),
      })),
      spc: Object.fromEntries(STEPS.filter(s => s.param).map(s => [s.param.key, []])),
      spcRun: {},   // Nelson rule 2 run counters, per characteristic
      fdc: Object.fromEntries(STEPS.filter(s => s.sensors).map(s => [s.id, []])),
      events: [],
      listeners: [],
      sorted: [],      // per-lot yield summary (most recent KEEP.sorted)
      rows: [],        // dataset rows as flat arrays (columns in S.cols), built once at Sort, newest KEEP.rows
      cols: null,      // dataset column names, fixed by the first sorted wafer
      spcSigma: {},    // Phase I sigma per characteristic, frozen once the 40-lot baseline exists
      counts: { sorted: 0, ooc: 0, fdcAlarms: 0, rows: 0 },   // all-time totals (arrays above are windows)
      toolStats: {},   // toolName -> {lots, dies, pass, params: {key: [recent means]}}
    };
    S.steps.forEach(ss => ss.tools.forEach(t => { S.tools[t.name] = t; S.toolStats[t.name] = { lots: 0, dies: 0, pass: 0, params: {} }; }));
    // Retention: a long-running tab must not grow without bound. Totals live in S.counts.
    const KEEP = Object.assign({ doneLots: 120, dieMaps: 30, sorted: 2000, rows: 25000, spc: 1000, params: 500 }, opts.keep);
    S.keep = KEEP;
    const toolsOf = id => S.steps[STEP_INDEX[id]].tools;
    const isMulti = id => toolsOf(id).length > 1;

    function emit(e) {
      e.t = S.t; S.events.push(e);
      if (S.events.length > 600) S.events.shift();
      S.listeners.forEach(fn => fn(e));
    }

    function newLot() {
      const id = 'L' + String(++S.lotSeq).padStart(4, '0');
      const wafers = [];
      for (let w = 0; w < 25; w++) wafers.push({
        id: `${id}.${String(w + 1).padStart(2, '0')}`, slot: w + 1,
        s: {}, meas: {}, defects: [], dies: null, yield: null, chambers: {},
      });
      const lot = { id, wafers, step: 0, status: 'queued', hist: [], releasedAt: S.t, holdUntil: 0, ooc: [] };
      S.lots.push(lot);
      S.steps[0].queue.push(lot);
      emit({ sys: 'MES', type: 'create', lot: id, step: 'START', msg: `Lot ${id} created, 25 wafers, route CMOS-GATE-v1` });
      return lot;
    }

    const faultOn = (faultId, toolName) => S.faults[faultId] !== undefined && FAULTS[faultId].tool === toolName;
    const age = f => (S.faults[f] !== undefined ? S.t - S.faults[f] : 0);

    // ---- per-tick drift from active faults, applied to the affected tool only ----
    function updateDrift() {
      Object.values(S.tools).forEach(t => { t.drift = 0; t.focusDrift = 0; t.biasDrift = 0; });
      if (S.faults.furnaceDrift !== undefined) S.tools['FURN-01'].drift = Math.min(6, age('furnaceDrift') * 0.012);
      if (S.faults.focusDrift !== undefined) S.tools['SCAN-02'].focusDrift = Math.min(0.12, age('focusDrift') * 0.00012);
      if (S.faults.etchSeason !== undefined) S.tools['ETCH-03A'].biasDrift = Math.min(6, age('etchSeason') * 0.004);
    }

    // ---- FDC trace (per tool: the trace shows that chamber's signature) ----
    function trace(stepId, recipe, tool) {
      const n = 60, pts1 = [], pts2 = [];
      let alarm = null, s1;
      if (stepId === 'OX') {
        for (let i = 0; i < n; i++) {
          const ramp = i < 12 ? 600 + (recipe.tempC - 600) * i / 12 : i > 50 ? recipe.tempC - (recipe.tempC - 650) * (i - 50) / 10 : recipe.tempC;
          pts1.push(ramp + tool.drift + g() * 0.6);
          pts2.push(i > 12 && i < 50 ? 10 + g() * 0.08 : 0.5 + g() * 0.02);
        }
        s1 = mean(pts1.slice(14, 49));
        if (Math.abs(s1 - recipe.tempC) > 4) alarm = `Soak temp ${s1.toFixed(1)}°C deviates from setpoint`;
      } else if (stepId === 'LITHO') {
        for (let i = 0; i < n; i++) { pts1.push(tool.focusDrift + g() * 0.01 + 0.004 * Math.sin(i / 4)); pts2.push(recipe.doseMJ + g() * 0.05); }
        s1 = mean(pts1);
        if (Math.abs(s1) > 0.06) alarm = `Mean focus error ${s1.toFixed(3)} µm`;
      } else if (stepId === 'ETCH') {
        const bad = faultOn('etchSeason', tool.name);
        for (let i = 0; i < n; i++) {
          // FDC is an excursion detector, not a wear gauge: normal build-up only nudges the trace
          pts1.push(8 + tool.hours * 0.012 + (bad ? 6 + 4 * Math.abs(Math.sin(i * 1.7)) : 0) + Math.abs(g()) * 0.8);
          pts2.push(i < 35 ? 1 + g() * 0.02 : Math.max(0.2, 1 - (i - 35) * 0.04) + g() * 0.02);
        }
        s1 = mean(pts1);
        if (s1 > 14) alarm = `RF reflected power high (${s1.toFixed(1)} W) — match/chamber issue`;
      } else if (stepId === 'IMPL') {
        const bad = faultOn('beamUnstable', tool.name);
        for (let i = 0; i < n; i++) {
          pts1.push(12 + g() * 0.08 + (bad && rng() < 0.12 ? -4 * rng() : 0));
          pts2.push(2 + g() * 0.05);
        }
        s1 = std(pts1);
        if (s1 > 0.4) alarm = `Beam current unstable (σ=${s1.toFixed(2)} mA, glitches)`;
      } else if (stepId === 'ANNEAL') {
        for (let i = 0; i < n; i++) {
          const x = (i - 30) / 4; pts1.push(600 + (recipe.peakC - 600) * Math.exp(-x * x) + g() * 1.2);
          pts2.push(i > 20 && i < 34 ? 85 + g() : 10 + g() * 0.5);
        }
        s1 = Math.max(...pts1);
        if (Math.abs(s1 - recipe.peakC) > 8) alarm = `Peak temp ${s1.toFixed(0)}°C off target`;
      } else if (stepId === 'CVD') {
        const bad = faultOn('particles', tool.name);
        for (let i = 0; i < n; i++) { pts1.push(3.0 + g() * 0.01 + (bad ? 0.06 * Math.sin(i / 3) : 0)); pts2.push(recipe.rfW + g() * 3); }
        s1 = std(pts1);
        if (s1 > 0.03) alarm = `Pressure oscillation (σ=${s1.toFixed(3)} Torr) — wall flaking suspected`;
      } else if (stepId === 'CMP') {
        const bad = faultOn('padScratch', tool.name);
        for (let i = 0; i < n; i++) {
          pts1.push(6 - tool.hours * 0.01 + g() * 0.05 + (bad && rng() < 0.08 ? 1.5 : 0));
          pts2.push(40 + i * 0.1 + g() * 0.2);
        }
        s1 = std(pts1);
        if (s1 > 0.25) alarm = `Torque spikes detected (σ=${s1.toFixed(2)} A)`;
      } else if (stepId === 'METAL') {
        for (let i = 0; i < n; i++) { pts1.push(i < 5 ? i * 2 : 10 + g() * 0.05); pts2.push(0.5 + g() * 0.02); }
        s1 = mean(pts1.slice(5));
      }
      const st = STEPS[STEP_INDEX[stepId]];
      return { series: [{ name: st.sensors[0], pts: pts1 }, { name: st.sensors[1], pts: pts2 }], summary: s1, alarm };
    }

    // ---- one lot through one tool ----
    function processStep(lot, stepId, tool) {
      const st = STEPS[STEP_INDEX[stepId]];
      const recipe = st.recipe ? { ...st.recipe } : {};
      const r2rNotes = [];

      // --- R2R: recipe is set per chamber before the run ---
      if (stepId === 'LITHO' && S.r2r) {
        recipe.doseMJ = +(recipe.doseMJ + tool.corr).toFixed(2);
        r2rNotes.push(`dose ${recipe.doseMJ} mJ/cm² (corr ${tool.corr >= 0 ? '+' : ''}${tool.corr.toFixed(2)})`);
      }
      if (stepId === 'ETCH' && S.r2r) {
        const diMeas = lot.wafers.filter(w => w.meas.diCD).flatMap(w => w.meas.diCD);
        const di = diMeas.length ? mean(diMeas) : 90;
        const predBias = 10 + tool.hours * 0.045 + tool.offset + tool.biasDrift;
        const need = di - 80 - predBias;
        recipe.trimSec = +clamp(20 + need / 0.25, 0, 60).toFixed(1);
        r2rNotes.push(`trim ${recipe.trimSec}s on ${tool.name} (FF from DI CD ${di.toFixed(1)} nm)`);
      }
      if (stepId === 'CMP' && S.r2r) {
        recipe.polishSec = +(recipe.polishSec + tool.corr).toFixed(1);
        r2rNotes.push(`polish ${recipe.polishSec}s on ${tool.name} (corr ${tool.corr >= 0 ? '+' : ''}${tool.corr.toFixed(1)}s)`);
      }

      const tr = st.sensors ? trace(stepId, recipe, tool) : null;

      lot.wafers.forEach((w, wi) => {
        switch (stepId) {
          case 'START': w.s.sub = { m: 10 + g() * 0.5, a: 0, sd: 0.1 }; break;
          case 'OX': {
            const T = recipe.tempC + tool.drift;
            const slotEffect = (wi - 12) * 0.004;
            w.s.tox = { m: 10.0 * Math.exp(0.0125 * (T - 900)) * (recipe.timeMin / 30) + slotEffect + g() * 0.05, a: 0.12, sd: 0.04 };
            break;
          }
          case 'LITHO': {
            const f = tool.focusDrift + g() * 0.01;
            w.s.diCD = { m: 90 - 1.6 * (recipe.doseMJ - 30) + 900 * f * f + g() * 0.5, a: 0.8 + 800 * f * f, sd: 0.6 + Math.abs(f) * 8 };
            break;
          }
          case 'ETCH': {
            const bias = 10 + tool.hours * 0.045 + tool.offset + tool.biasDrift;
            const trimRemoval = recipe.trimSec * 0.25;
            const season = faultOn('etchSeason', tool.name);
            w.s.fiCD = { m: w.s.diCD.m - bias - (trimRemoval - 5) + g() * 0.4,
              a: w.s.diCD.a - 1.5 + (season ? 20 : 0),          // radial non-uniformity: ring of failing edge dies
              sd: Math.hypot(w.s.diCD.sd, season ? 1.2 : 0.5) };
            break;
          }
          case 'IMPL': {
            const unstable = faultOn('beamUnstable', tool.name);
            w.s.dose = { m: recipe.doseE15 * (1 + g() * (unstable ? 0.035 : 0.006)), a: unstable ? 0.25 : 0.03, sd: unstable ? 0.12 : 0.03 };
            break;
          }
          case 'ANNEAL': {
            const peak = recipe.peakC + g() * 1.2;
            w.s.rs = { m: 100 * Math.pow(5.0 / w.s.dose.m, 0.9) * Math.exp(-(peak - 1050) / 60) + g() * 0.8, a: 2 + w.s.dose.a * 15, sd: 1.0 + w.s.dose.sd * 12 };
            break;
          }
          case 'CVD': {
            w.s.ild = { m: 500 * (recipe.timeSec / 120) + tool.offset + g() * 3, a: -12, sd: 2 };
            const nBase = poisson(rng, 2.5);
            for (let k = 0; k < nBase; k++) w.defects.push(randPt(rng, 1, 'particle', 'CVD'));
            if (faultOn('particles', tool.name) && rng() < 0.85) {
              const n = 8 + poisson(rng, 10);
              for (let k = 0; k < n; k++) w.defects.push(randPt(rng, 0.35, 'particle', 'CVD'));
            }
            break;
          }
          case 'CMP': {
            const scratched = faultOn('padScratch', tool.name);
            const rr = 3.4 * (1 - tool.hours * 0.003) * tool.rate * (scratched ? 0.97 : 1);
            w.s.postCmp = { m: w.s.ild.m - rr * recipe.polishSec + tool.offset + g() * 2.5, a: w.s.ild.a + 18, sd: 3 };
            if (scratched && rng() < 0.6) {
              const cx = (rng() - 0.5) * 0.6, cy = (rng() - 0.5) * 0.6, R = 0.4 + rng() * 0.4, a0 = rng() * 6.28, span = 1 + rng() * 1.5;
              for (let k = 0; k < 14; k++) {
                const a = a0 + span * k / 13, x = cx + R * Math.cos(a), y = cy + R * Math.sin(a);
                if (x * x + y * y < 0.9) w.defects.push({ x, y, type: 'scratch', step: 'CMP' });
              }
            }
            const nB = poisson(rng, 1.2);
            for (let k = 0; k < nB; k++) w.defects.push(randPt(rng, 1, 'slurry residue', 'CMP'));
            break;
          }
          case 'METAL':
            w.s.rc = { m: 20 * (w.s.postCmp.m / 300) ** 1.5 + g() * 0.6, a: 1.2, sd: 1.0 }; break;
          case 'SORT':
            sortWafer(w); break;
        }
        if (isMulti(stepId)) w.chambers[stepId] = tool.name;
      });

      // --- tool usage + scheduled PM (per chamber) ---
      if (stepId === 'ETCH' || stepId === 'CMP') {
        tool.hours += st.time / 60;   // real tool-hours: 45 min of polishing = 0.75 pad-hours
        const lim = PM_LIMIT[stepId];
        if (tool.hours >= lim) {
          tool.hours = 0;
          if (stepId === 'CMP') tool.corr = 0; // PM-aware APC: new pad invalidates the correction
          delete S.faults[stepId === 'ETCH' ? 'etchSeason' : 'padScratch'];
          emit({ sys: 'MES', type: 'pm', step: stepId, msg: `PM due at ${lim} h — ${tool.name} serviced, ${stepId === 'CMP' ? 'pad replaced' : 'chamber cleaned'}` });
          emit({ sys: 'R2R', type: 'pm', step: stepId, msg: `${tool.name}: APC notified of PM — ${stepId === 'CMP' ? 'polish-time correction reset to 0 s' : 'bias model reset'}` });
        }
      }

      // --- metrology ---
      let meas = null;
      if (st.param) {
        const k = st.param.key; const vals = [];
        const mNoise = { tox: 0.03, diCD: 0.4, fiCD: 0.4, dose: 0.01, rs: 0.5, ild: 1.5, postCmp: 1.5, rc: 0.3 }[k];
        SAMPLE_WAFERS.forEach(wi => {
          const w = lot.wafers[wi]; const p = w.s[k];
          w.meas[k] = SITES.map(([x, y]) => p.m + p.a * (x * x + y * y - R0) + g() * Math.hypot(p.sd * 0.5, mNoise));
          vals.push(...w.meas[k]);
        });
        meas = { key: k, mean: mean(vals), sd: std(vals), n: vals.length };
      }

      // --- R2R feedback, per tool ---
      if (S.r2r && meas) {
        if (stepId === 'LITHO') {
          tool.corr = clamp(tool.corr + 0.5 * (meas.mean - 90) / 1.6, -6, 6);
          r2rNotes.push(`feedback → next dose corr ${tool.corr.toFixed(2)}`);
        }
        if (stepId === 'CMP') {
          tool.corr = clamp(tool.corr + 0.5 * (meas.mean - 300) / 3.4, -20, 30);
          r2rNotes.push(`feedback → next polish corr ${tool.corr.toFixed(1)}s`);
        }
      }

      let defectCount = null;
      if (stepId === 'CVD' || stepId === 'CMP') defectCount = mean(SAMPLE_WAFERS.map(wi => lot.wafers[wi].defects.filter(d => d.step === stepId).length));
      return { recipe, trace: tr, meas, r2rNotes, defectCount, tool: tool.name };
    }

    function randPt(rng, rad, type, step) {
      let x, y; do { x = (rng() * 2 - 1) * rad; y = (rng() * 2 - 1) * rad; } while (x * x + y * y > Math.min(0.9, rad * rad));
      return { x, y, type, step };
    }
    function dieVal(p, d) { return p.m + p.a * (d.r * d.r - R0) + g() * p.sd; }

    function sortWafer(w) {
      const dies = DIES.map(d => {
        const tox = dieVal(w.s.tox, d), lg = dieVal(w.s.fiCD, d), rs = dieVal(w.s.rs, d), rc = dieVal(w.s.rc, d);
        const vt = 0.45 + 0.035 * (tox - 10) + 0.004 * (lg - 80) + g() * 0.006;
        const idsat = 600 * (10 / tox) * (80 / lg) * (1 - 0.003 * (rs - 100)) * (1 - 0.004 * (rc - 20)) + g() * 6;
        const ioff = 10 * Math.exp(-(vt - 0.45) / 0.03) * (80 / lg) ** 2;
        const half = 1 / GRID;
        const killers = w.defects.filter(df => Math.abs(df.x - d.x) < half && Math.abs(df.y - d.y) < half);
        let bin = 1;
        if (killers.length && rng() < 1 - Math.pow(0.35, killers.length)) bin = 5;
        else if (rc > 26 || rc < 14) bin = 6;
        else if (vt < 0.40 || vt > 0.50) bin = 2;
        else if (ioff > 50) bin = 4;
        else if (idsat < 540 || idsat > 660) bin = 3;
        return { i: d.i, j: d.j, x: d.x, y: d.y, vt, idsat, ioff, rc, bin };
      });
      w.dies = dies;
      w.yield = dies.filter(d => d.bin === 1).length / dies.length;
      w.defectCount = w.defects.length;
      w.vtMean = mean(dies.map(d => d.vt)); w.idsatMean = mean(dies.map(d => d.idsat));
    }

    // I-MR limits: centre line = target, sigma from Phase I mean moving range
    function spcAdd(stepId, lot, meas) {
      const st = STEPS[STEP_INDEX[stepId]]; const p = st.param;
      const arr = S.spc[p.key];
      let cl = p.target, sigma = (p.usl - p.lsl) / 8;
      if (S.spcSigma[p.key] === undefined && arr.length >= 40) {
        // I-MR sigma, floored by the Phase I spread: autocorrelated R2R data makes the
        // moving-range estimate optimistic, which would manufacture false alarms.
        // Computed once from the first 40 lots and frozen (Phase II limits do not move).
        const base = arr.slice(0, 40).map(x => x.v);
        const mr = base.slice(1).map((v, i) => Math.abs(v - base[i]));
        S.spcSigma[p.key] = Math.max(mean(mr) / 1.128, std(base), (p.usl - p.lsl) / 40);
      }
      const phase2 = S.spcSigma[p.key] !== undefined;
      if (phase2) sigma = S.spcSigma[p.key];
      const pt = { lot: lot.id, t: S.t, v: meas.mean, sd: meas.sd, sig: sigma, cl, ucl: cl + 3 * sigma, lcl: cl - 3 * sigma, ooc: null };
      pt.phase = phase2 ? 'II' : 'I';
      if (pt.phase === 'II' && (pt.v > pt.ucl || pt.v < pt.lcl)) pt.ooc = 'Rule 1: beyond 3σ';
      else if (pt.phase === 'II') {
        // Nelson rule 2 as a run counter: flagged once, on the 9th consecutive point on one side
        const side = pt.v > cl ? 1 : pt.v < cl ? -1 : 0;
        const run = S.spcRun[p.key] || { side: 0, n: 0 };
        if (side && side === run.side) run.n++; else { run.side = side; run.n = side ? 1 : 0; }
        S.spcRun[p.key] = run;
        if (run.n === 9) pt.ooc = 'Rule 2: 9 points one side';
      }
      if (pt.v > p.usl || pt.v < p.lsl) pt.ooc = (pt.ooc ? pt.ooc + ' + ' : '') + 'OUT OF SPEC';
      arr.push(pt);
      if (arr.length > KEEP.spc) arr.shift();
      if (pt.ooc) S.counts.ooc++;
      return pt;
    }

    function finishStep(stepState, tool, lot) {
      const stepId = stepState.id; const st = STEPS[STEP_INDEX[stepId]];
      const res = processStep(lot, stepId, tool);
      stepState.runs++; tool.runs++;
      const h = { step: stepId, tool: tool.name, tin: lot._tin, tout: S.t, recipe: res.recipe, r2r: res.r2rNotes, meas: res.meas, fdc: null, spc: null, defects: res.defectCount };
      emit({ sys: 'MES', type: 'trackout', lot: lot.id, step: stepId, msg: `${lot.id} track-out ${st.name} @ ${tool.name}` });
      if (res.trace) {
        S.fdc[stepId].push({ lot: lot.id, tool: tool.name, t: S.t, summary: res.trace.summary, alarm: res.trace.alarm });
        if (S.fdc[stepId].length > 200) S.fdc[stepId].shift();
        if (res.trace.alarm) S.counts.fdcAlarms++;
        h.fdc = res.trace.alarm ? 'ALARM' : 'OK';
        const lastTrace = { lot: lot.id, tool: tool.name, ...res.trace };
        stepState.lastTrace = lastTrace; // for UI
        emit({ sys: 'FDC', type: res.trace.alarm ? 'alarm' : 'trace', lot: lot.id, step: stepId, level: res.trace.alarm ? 'warn' : 'info',
          msg: res.trace.alarm ? `FDC alarm ${tool.name}: ${res.trace.alarm}` : `${tool.name} trace uploaded (60 pts × 2 sensors)` });
      }
      if (res.meas) {
        const pt = spcAdd(stepId, lot, res.meas);
        h.spc = pt.ooc || 'In control';
        emit({ sys: 'SPC', type: pt.ooc ? 'ooc' : 'point', lot: lot.id, step: stepId, level: pt.ooc ? 'error' : 'info',
          msg: `${st.param.metro}: ${st.param.label} = ${res.meas.mean.toFixed(2)} ${st.param.unit}${isMulti(stepId) ? ` [${tool.name}]` : ''}${pt.ooc ? ' — OOC: ' + pt.ooc : ''}` });
        if (pt.ooc) lot.ooc.push({ step: stepId, rule: pt.ooc });
        if (pt.ooc && S.autoHold && !/^Rule 2/.test(pt.ooc)) {
          lot.holdUntil = S.t + 90; lot.status = 'hold';
          emit({ sys: 'MES', type: 'hold', lot: lot.id, step: stepId, level: 'error', msg: `${lot.id} placed ON HOLD after ${stepId} (SPC OOC) — engineering disposition` });
        }
      }
      if (res.r2rNotes.length) emit({ sys: 'R2R', type: 'adjust', lot: lot.id, step: stepId, msg: `${tool.name}: ${res.r2rNotes.join('; ')}` });
      if (stepId === 'SORT') {
        const y = mean(lot.wafers.map(w => w.yield));
        const binCounts = {};
        lot.wafers.forEach(w => w.dies.forEach(d => { binCounts[d.bin] = (binCounts[d.bin] || 0) + 1; }));
        S.sorted.push({ lot: lot.id, t: S.t, yield: y, bins: binCounts, cycleTime: S.t - lot.releasedAt });
        if (S.sorted.length > KEEP.sorted) S.sorted.shift();
        S.counts.sorted++;
        // per-tool yield attribution: which chamber ran this lot at each multi-chamber step
        // include this Sort run (h) so the tester gets credit too; it is pushed to hist below
        [...lot.hist, h].forEach(hh => {
          const ts = S.toolStats[hh.tool];
          if (!ts) return;
          ts.lots++;
          lot.wafers.forEach(w => {
            if (!w.dies) return;
            ts.dies += w.dies.length;
            ts.pass += w.dies.filter(d => d.bin === 1).length;
          });
          if (hh.meas) {
            const a = (ts.params[hh.meas.key] = ts.params[hh.meas.key] || []);
            a.push(hh.meas.mean); if (a.length > KEEP.params) a.shift();
          }
        });
        lot.status = 'done'; lot.yield = y;
        S.done.push(lot);
        // keep die maps for the newest lots only; past that a lot lives on as dataset rows + traveler
        const old = S.done[S.done.length - 1 - KEEP.dieMaps];
        // older lots are already in S.rows; keep only what the traveler and yield trend read
        if (old && old.wafers[0].dies) old.wafers = old.wafers.map(w => ({ id: w.id, slot: w.slot, yield: w.yield, dies: null, defects: [], meas: {}, s: {} }));
        if (S.done.length > KEEP.doneLots) {
          const gone = S.done.shift();
          const i = S.lots.indexOf(gone); if (i >= 0) S.lots.splice(i, 1);
        }
        emit({ sys: 'YMS', type: 'sort', lot: lot.id, step: 'SORT', level: y < 0.8 ? 'warn' : 'info', msg: `${lot.id} sorted: yield ${(y * 100).toFixed(1)}% (${DIES.length * 25} dies)` });
      }
      lot.hist.push(h);
      if (stepId === 'SORT') rowsFor(lot).forEach(r => {
        // flat arrays against one shared column list: ~10x smaller than 37-key objects
        if (!S.cols) S.cols = Object.keys(r);
        S.rows.push(S.cols.map(c => r[c])); S.counts.rows++;
        if (S.rows.length > KEEP.rows) S.rows.shift();
      });
    }

    function tick() {
      S.t++;
      updateDrift();
      if (S.t === 1 || (S.t % S.releaseEvery === 0)) newLot();
      // lots on hold always sit in a step queue, so scan the queues rather than every lot ever made
      S.steps.forEach(ss => ss.queue.forEach(l => { if (l.status === 'hold' && S.t >= l.holdUntil) { l.status = 'queued'; emit({ sys: 'MES', type: 'release', lot: l.id, msg: `${l.id} released from hold` }); } }));
      for (let si = S.steps.length - 1; si >= 0; si--) {
        const ss = S.steps[si];
        // completions first
        ss.tools.forEach(tool => {
          if (tool.busy && S.t >= tool.busyUntil) {
            const lot = tool.busy; tool.busy = null;
            finishStep(ss, tool, lot);
            if (si + 1 < S.steps.length) {
              lot.step = si + 1; if (lot.status !== 'hold') lot.status = 'queued';
              S.steps[si + 1].queue.push(lot);
            }
          }
        });
        // dispatch: idle tools pull the next non-held lot, least-recently-used chamber first
        // (MES balances chamber usage rather than always filling the first chamber)
        const idle = ss.tools.filter(t => !t.busy).sort((a, b) => (a.lastUsed || 0) - (b.lastUsed || 0));
        idle.forEach(tool => {
          const idx = ss.queue.findIndex(l => l.status !== 'hold');
          if (idx < 0) return;
          const lot = ss.queue.splice(idx, 1)[0];
          tool.busy = lot; lot.status = 'processing'; lot._tin = S.t; tool.lastUsed = S.t;
          tool.busyUntil = S.t + STEPS[si].time;
          emit({ sys: 'MES', type: 'trackin', lot: lot.id, step: ss.id, msg: `${lot.id} track-in ${STEPS[si].name} @ ${tool.name}` });
        });
      }
    }

    function setFault(id, on) {
      if (on) { S.faults[id] = S.t; emit({ sys: 'SIM', type: 'fault', level: 'warn', step: FAULTS[id].tool.replace(/-\d+[AB]?$/, ''), msg: `⚠ Fault injected: ${FAULTS[id].label} → ${FAULTS[id].tool}` }); }
      else { delete S.faults[id]; emit({ sys: 'SIM', type: 'fault', msg: `Fault cleared: ${FAULTS[id].label}` }); }
    }
    function pm(which) { // 'ETCH' | 'CMP' | tool name
      const tools = S.tools[which] ? [S.tools[which]] : toolsOf(which);
      if (!tools) return;
      tools.forEach(t => {
        t.hours = 0; if (t.step === 'CMP') t.corr = 0;
        emit({ sys: 'MES', type: 'pm', step: t.step, msg: `Preventive maintenance completed on ${t.name}` });
      });
      if (which === 'ETCH') delete S.faults.etchSeason;
      if (which === 'CMP') delete S.faults.padScratch;
    }

    function rowsFor(l) {
      const rows = [];
      {
        const hBy = Object.fromEntries(l.hist.map(h => [h.step, h]));
        l.wafers.forEach(w => {
          const r = { lot: l.id, wafer: w.id, slot: w.slot, sampled: SAMPLE_WAFERS.includes(w.slot - 1) ? 1 : 0 };
          ['tox', 'diCD', 'fiCD', 'dose', 'rs', 'ild', 'postCmp', 'rc'].forEach(k => {
            r[k + '_true'] = +w.s[k].m.toFixed(3);
            r[k + '_meas'] = w.meas[k] ? +mean(w.meas[k]).toFixed(3) : '';
          });
          r.litho_dose = hBy.LITHO.recipe.doseMJ; r.etch_trim_s = hBy.ETCH.recipe.trimSec; r.cmp_polish_s = hBy.CMP.recipe.polishSec;
          r.etch_chamber = hBy.ETCH.tool; r.cvd_chamber = hBy.CVD.tool; r.cmp_chamber = hBy.CMP.tool;
          ['OX', 'LITHO', 'ETCH', 'IMPL', 'ANNEAL', 'CVD', 'CMP'].forEach(s => { r['fdc_' + s] = hBy[s].fdc === 'ALARM' ? 1 : 0; });
          r.defects = w.defectCount ?? w.defects.length;
          r.mean_vt = +w.vtMean.toFixed(4);
          r.mean_idsat = +w.idsatMean.toFixed(1);
          r.yield = +w.yield.toFixed(4);
          rows.push(r);
        });
      }
      return rows;
    }
    // One object per sorted wafer, oldest first: the newest KEEP.rows (S.counts.rows = all-time total).
    // dataset(n) returns only the newest n, which is what a live table needs.
    function dataset(n) {
      if (!S.cols) return [];
      const src = n ? S.rows.slice(-n) : S.rows;
      return src.map(a => { const o = {}; S.cols.forEach((c, i) => { o[c] = a[i]; }); return o; });
    }

    // CSV straight from the flat rows (no per-row objects); quotes any field that needs it (RFC 4180)
    function csv() {
      if (!S.cols) return '';
      const q = v => { const t = v == null ? '' : String(v); return /[",\n\r]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; };
      return [S.cols.map(q).join(','), ...S.rows.map(a => a.map(q).join(','))].join('\n') + '\n';
    }

    return { state: S, tick, newLot, setFault, pm, dataset, csv, on: fn => S.listeners.push(fn), run(n) { for (let i = 0; i < n; i++) tick(); } };
  }

  const api = { createSim, STEPS, STEP_INDEX, BINS, FAULTS, PM_LIMIT, DIES, GRID, SITES, SAMPLE_WAFERS, mean, std };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FabSim = api;
})(typeof window !== 'undefined' ? window : globalThis);
