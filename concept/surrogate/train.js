// PURPLE CONCEPT - trains the surrogate models of a lap simulator (docs/concept/SURROGATE.md).
//   node concept/surrogate/train.js --sim physics                 # the physics lap sim (concept/sim/), Silverstone, centred on the Red Bull car
//   node concept/surrogate/train.js --sim v0                      # sim v0 (the game's lap model, concept/bench.js), Silverstone + Monza
//   options: --circuits a,b  --n 6000  --seed 1  --workers <cpus>  --classes quadratic,rbf,mlp  --rbf-centres 600  --mlp-epochs 400
//            --out concept/surrogate/models  --quick (n=600, short MLP: a smoke run)  --sim-module <path> --sim-export <fn> (any sim
//            with the contract sim(pc, trackId, conditions)) --centre concept-baseline | team:<id> | sim-baseline  --box concept | teams
// Steps: (1) the training box in the RAW PhysicalCar space (features.js) and its centre car; (2) a seeded Latin hypercube, half over
// the whole box and half over a core box around the centre; (3) the sim on every point (worker threads); (4) 70/15/15 split;
// three model classes per target: quadratic response surface with interactions (ridge), RBF kernel ridge with a quadratic mean on
// a subset (GP-lite), a 2×32 tanh MLP (Adam); (5) per target the class with the lowest VALIDATION error is kept; the TEST split
// and fresh checks (concept designs, team cars, candidate-change ranking) are reported through the saved model's own code path.
// Never writes outside --out (default concept/surrogate/models); refuses data/ and data-mock/. No network, no Mubit.
"use strict";
const path = require("path"), fs = require("fs"), os = require("os");
const { Worker, isMainThread, parentPort, workerData } = require("worker_threads");
const F = require("./features.js");

// ---------------------------------------------------------------------------------------------------------------------------
// sims. module paths are relative to this file; `fn` is the export with the sim contract.
const SIMS = {
  physics: { module: "../sim/index.js", fn: "simulateLap", circuits: ["silverstone"], centre: "team:redbull", box: "teams", apex: true },   // --circuits monza,monaco,spa,hungaroring: the multi-track models
  v0: { module: "../bench.js", fn: "simV0", circuits: ["silverstone", "monza"], centre: "concept-baseline", box: "concept", apex: false },
};

// absolute margins around the box (per RAW field): added beyond the observed range (team cars or concept designs). For fields the
// source never varies they set the whole span around the centre. Chosen to cover design changes, calibration scales (± ~10 %) and
// the error bars of a telemetry-derived car; documented in SURROGATE.md §2.
const MARGIN = {
  mass_kg: [8, 30], fuel_kg: [8, 8], wheelbase_m: [0.2, 0.2], cog_height_m: [0.04, 0.04], weight_dist_front: [0.03, 0.03],
  cla_corner_m2: ["12%", "12%"], balance_corner: [0.04, 0.04], cda_corner_m2: ["12%", "12%"], sm_cla_ratio: [0.12, 0.12],
  sm_balance_shift: [0.05, 0.05], sm_cda_ratio: [0.1, 0.1], ride_height_mm: [15, 35], ride_sens_per_mm: [0.006, 0.024],
  stall_margin_mm: [5, 25], ice_kw: [40, 40], mguk_kw: [30, 30], es_deploy_mj: [4, 4], es_harvest_mj: [2.5, 2.5],
  mu_x: [0.12, 0.12], mu_y: [0.12, 0.12], load_sens: ["40%", "40%"], drivetrain_eff: [0.03, 0.02],
  // features v5 (more-factors v1): the set-up / gearing fields the concept's parameter domains reach (concept/parts.js), with room
  lltd_offset: [0.2, 0.16], heave_n_per_mm: ["60%", "130%"], brake_bias_front: [0.08, 0.10], gear_top_kmh: ["14%", "14%"], gear_step: [0.08, 0.09],
};
// hard physical limits on the box
const HARD = {
  mass_kg: [700, 900], fuel_kg: [0, 110], weight_dist_front: [0.3, 0.6], balance_corner: [0.15, 0.85], sm_cla_ratio: [0.05, 1], sm_cda_ratio: [0.2, 1],
  ride_height_mm: [10, 80], ride_sens_per_mm: [0, 0.05], ice_kw: [100, 600], mguk_kw: [0, 400], es_deploy_mj: [0, 20], es_harvest_mj: [0, 12],
  mu_x: [0.8, 2.6], mu_y: [0.8, 2.6], load_sens: [0, 0.3], drivetrain_eff: [0.85, 0.99], cla_corner_m2: [0.5, 9], cda_corner_m2: [0.4, 2.5], cog_height_m: [0.15, 0.45],
  lltd_offset: [-0.3, 0.3], heave_n_per_mm: [800, 10000], brake_bias_front: [0.4, 0.75], gear_top_kmh: [250, 450], gear_step: [1.03, 1.3],
};
// DOE tiers: share of the runs and the box fraction each spans (centre ± frac of the way to each edge). Most runs sit where the
// optimiser works (near the centre); the whole box keeps the edges honest.
const TIERS = [{ share: 0.4, frac: 1 }, { share: 0.3, frac: 0.5 }, { share: 0.3, frac: 0.2 }];

// ---------------------------------------------------------------------------------------------------------------------------
// numerics
function seededRng(seed) { return require("./surrogate.js").xorshift(seed); }
function gaussFn(rng) { return require("./surrogate.js").gaussFrom(rng); }
function shuffle(a, rng) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
// Latin hypercube in [lo, hi]^d: one point per stratum per dimension, strata permuted independently
function lhs(n, lo, hi, rng) {
  const d = lo.length, X = Array.from({ length: n }, () => new Float64Array(d));
  for (let j = 0; j < d; j++) {
    const perm = shuffle(Array.from({ length: n }, (_, i) => i), rng);
    for (let i = 0; i < n; i++) X[i][j] = lo[j] + ((perm[i] + rng()) / n) * (hi[j] - lo[j]);
  }
  return X;
}
// Cholesky A = L Lᵀ in place (lower triangle, row-major p×p); returns false if not positive definite
function cholesky(A, p) {
  for (let j = 0; j < p; j++) {
    let s = A[j * p + j];
    for (let k = 0; k < j; k++) s -= A[j * p + k] * A[j * p + k];
    if (!(s > 0)) return false;
    const d = Math.sqrt(s); A[j * p + j] = d;
    for (let i = j + 1; i < p; i++) { let t = A[i * p + j]; for (let k = 0; k < j; k++) t -= A[i * p + k] * A[j * p + k]; A[i * p + j] = t / d; }
  }
  return true;
}
// solve L Lᵀ x = b for each column of B (p×T row-major), in place
function cholSolve(L, p, B, T) {
  for (let t = 0; t < T; t++) {
    for (let i = 0; i < p; i++) { let s = B[i * T + t]; for (let k = 0; k < i; k++) s -= L[i * p + k] * B[k * T + t]; B[i * T + t] = s / L[i * p + i]; }
    for (let i = p - 1; i >= 0; i--) { let s = B[i * T + t]; for (let k = i + 1; k < p; k++) s -= L[k * p + i] * B[k * T + t]; B[i * T + t] = s / L[i * p + i]; }
  }
  return B;
}
const rmseOf = (p, y) => { let s = 0; for (let i = 0; i < y.length; i++) s += (p[i] - y[i]) ** 2; return Math.sqrt(s / y.length); };
function metrics(p, y) {
  let s = 0, mx = 0, m = 0;
  for (let i = 0; i < y.length; i++) m += y[i]; m /= y.length;
  let sst = 0;
  for (let i = 0; i < y.length; i++) { const e = p[i] - y[i]; s += e * e; if (Math.abs(e) > mx) mx = Math.abs(e); sst += (y[i] - m) ** 2; }
  return { rmse: Math.sqrt(s / y.length), max_abs: mx, r2: sst > 0 ? 1 - s / sst : 1, n: y.length };
}
function ranks(a) {
  const idx = a.map((v, i) => i).sort((i, j) => a[i] - a[j]), r = new Array(a.length);
  for (let k = 0; k < idx.length;) { let e = k; while (e + 1 < idx.length && a[idx[e + 1]] === a[idx[k]]) e++; const avg = (k + e) / 2 + 1; for (let q = k; q <= e; q++) r[idx[q]] = avg; k = e + 1; }
  return r;
}
function spearman(a, b) {
  const ra = ranks(a), rb = ranks(b), n = a.length; let ma = 0, mb = 0;
  for (let i = 0; i < n; i++) { ma += ra[i]; mb += rb[i]; } ma /= n; mb /= n;
  let sab = 0, saa = 0, sbb = 0;
  for (let i = 0; i < n; i++) { sab += (ra[i] - ma) * (rb[i] - mb); saa += (ra[i] - ma) ** 2; sbb += (rb[i] - mb) ** 2; }
  return saa > 0 && sbb > 0 ? sab / Math.sqrt(saa * sbb) : 0;
}
const sig = (v, d) => (Number.isFinite(v) ? +v.toPrecision(d || 10) : v);
const rnd = (a, d) => Array.from(a, v => sig(v, d || 8));

// ---------------------------------------------------------------------------------------------------------------------------
// sim outputs -> flat named targets. Names: lap_s, s1_s..s3_s, speed_trap_kmh, vmin_kmh, vmax_kmh, deployed_mj, harvested_mj,
// speeds.<name> (km/h), apex.<corner> (km/h, the minimum speed in the sim's corner window). Constant targets are dropped later.
function flatten(r, apex) {
  const o = { lap_s: r.lap_s };
  if (Array.isArray(r.sectors_s) && r.sectors_s.length === 3) { o.s1_s = r.sectors_s[0]; o.s2_s = r.sectors_s[1]; o.s3_s = r.sectors_s[2]; }
  for (const k of ["speed_trap_kmh", "vmin_kmh", "vmax_kmh"]) if (typeof r[k] === "number") o[k] = r[k];
  if (r.energy) for (const k of ["deployed_mj", "harvested_mj"]) if (typeof r.energy[k] === "number") o[k] = r.energy[k];
  if (r.speeds_kmh) for (const k of Object.keys(r.speeds_kmh)) if (typeof r.speeds_kmh[k] === "number") o["speeds." + k] = r.speeds_kmh[k];
  if (Array.isArray(r.apex_kmh)) r.apex_kmh.forEach((v, i) => { if (typeof v === "number") o["apex.c" + (i + 1)] = v; });
  if (apex) for (const k of Object.keys(apex)) o["apex." + k] = apex[k];
  return o;
}

// the sim, loaded in this thread (main or worker). Returns run(pc, circuit) -> flat targets, and meta.
function loadSim(spec) {
  const mod = require(path.resolve(__dirname, spec.module)), fn = mod[spec.fn];
  if (typeof fn !== "function") throw new Error("train: " + spec.module + " has no function " + spec.fn);
  const apexWin = {};
  // per-corner apex speeds: the sim's corner windows (cornerTable) applied to its own speed profile (opts.debug.vf): the same
  // numbers cornerTable reports as sim_min_kmh, from one lap instead of two
  function windows(circuit) {
    if (!spec.apex || typeof mod.cornerTable !== "function" || typeof mod.buildTrack !== "function") return null;
    if (apexWin[circuit] !== undefined) return apexWin[circuit];
    try {
      const tr = mod.buildTrack(circuit), rows = mod.cornerTable(null, circuit);
      apexWin[circuit] = { tr, rows: rows.map(r => ({ name: r.name.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, ""), i0: tr.idxAtS(r.s0), i1: tr.idxAtS(r.s1), check: r.sim_min_kmh })) };
    } catch (e) { apexWin[circuit] = null; }
    return apexWin[circuit];
  }
  function run(pc, circuit) {
    const w = windows(circuit);
    const r = w ? fn(pc, circuit, null, { debug: true }) : fn(pc, circuit, null);
    let apex = null;
    if (w && r.debug && r.debug.vf) {
      apex = {}; const vf = r.debug.vf, n = w.tr.n;
      for (const row of w.rows) { let m = Infinity; for (let i = row.i0; i !== row.i1; i = (i + 1) % n) if (vf[i] < m) m = vf[i]; apex[row.name] = Math.round(m * 36) / 10; }
    }
    return { flat: flatten(r, apex), label: r.label };
  }
  return { mod, run, windows };
}

// ---------------------------------------------------------------------------------------------------------------------------
// worker side: evaluate batches of cars
if (!isMainThread && workerData && workerData.__surrogateWorker) {
  const sim = loadSim(workerData.spec);
  parentPort.on("message", msg => {
    try { parentPort.postMessage({ id: msg.id, rows: msg.cars.map(pc => sim.run(pc, msg.circuit)) }); }
    catch (e) { parentPort.postMessage({ id: msg.id, error: String(e && e.stack || e) }); }
  });
}

// main side: run `cars` through the sim, in `workers` threads (0 = in this thread). Order-preserving, deterministic.
async function runSim(spec, cars, circuit, workers, local) {
  if (!workers) { const sim = local || loadSim(spec); return cars.map(pc => sim.run(pc, circuit)); }
  const out = new Array(cars.length), chunk = 25, jobs = [];
  for (let i = 0; i < cars.length; i += chunk) jobs.push(i);
  const pool = Array.from({ length: Math.min(workers, jobs.length) }, () => new Worker(__filename, { workerData: { __surrogateWorker: true, spec } }));
  let next = 0;
  await Promise.all(pool.map(w => new Promise((resolve, reject) => {
    const send = () => { if (next >= jobs.length) { w.terminate(); resolve(); return; } const i = jobs[next++]; w.postMessage({ id: i, circuit, cars: cars.slice(i, i + chunk) }); };
    w.on("message", m => { if (m.error) { w.terminate(); reject(new Error(m.error)); return; } m.rows.forEach((r, k) => { out[m.id + k] = r; }); send(); });
    w.on("error", reject);
    send();
  })));
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------------
// the box and the centre car
function stripCar(pc) { const c = JSON.parse(JSON.stringify(pc)); delete c.sources; return c; }
function conceptDesigns(n, seed) {   // uniform random concept designs over the parameter domains (quantised)
  const design = require("../design.js"), parts = require("../parts.js"), rng = seededRng(seed), B = design.baseline(), out = [];
  for (let k = 0; k < n; k++) {
    const d = design.clone(B); d.id = "rand" + k;
    for (const s of parts.PARAMS) { let v = s.min + rng() * (s.max - s.min); v = Math.round((v - s.min) / s.step) * s.step + s.min; d.params[s.part][s.param] = +Math.min(s.max, v).toFixed(6); }
    out.push(d);
  }
  return out;
}
// multi-track (docs/concept/SIM.md "Multi-track"): on a circuit other than Silverstone a sim that exports teamCarsAt(circuit) gives
// the team cars with their fitted set-up there, and baselineCar(team, circuit) the centre car; Silverstone is unchanged
function teamCarsFor(simMod, circuit) {
  if (circuit && circuit !== "silverstone" && typeof simMod.teamCarsAt === "function") return simMod.teamCarsAt(circuit);
  return typeof simMod.teamCars === "function" ? simMod.teamCars() : [];
}
function centreCar(spec, simMod, circuit) {
  if (spec.centre === "concept-baseline") { const phys = require("../physical.js"), design = require("../design.js"); return stripCar(phys.physical(design.baseline())); }
  if (spec.centre === "sim-baseline") return stripCar(simMod.baselineCar());
  const m = /^team:(.+)$/.exec(spec.centre || "");
  if (m) return stripCar(circuit && circuit !== "silverstone" && typeof simMod.teamCarsAt === "function" ? simMod.baselineCar(m[1], circuit) : simMod.baselineCar(m[1]));
  throw new Error("train: unknown --centre " + spec.centre);
}
function marginOf(name, side, centre) { const m = MARGIN[name][side]; return typeof m === "string" ? (parseFloat(m) / 100) * Math.abs(centre) : m; }
// box: { lo, hi, centre (raw vector), sources }. mode "concept": range of physical() over random concept designs; "teams": range
// of the sim's fitted team cars. Either way + MARGIN, inside HARD.
function buildBox(spec, centre, simMod, seed, circuit) {
  const c = F.rawVector(centre), d = c.length, lo = Float64Array.from(c), hi = Float64Array.from(c);
  let source;
  if (spec.box === "concept") {
    const phys = require("../physical.js"), ds = conceptDesigns(3000, seed + 7919);
    for (const dz of ds) { const x = F.rawVector(phys.physical(dz)); for (let j = 0; j < d; j++) { if (x[j] < lo[j]) lo[j] = x[j]; if (x[j] > hi[j]) hi[j] = x[j]; } }
    source = "physical() of 3000 uniform random concept designs over the part domains (concept/parts.js) + MARGIN";
  } else if (spec.box === "teams") {
    const cars = teamCarsFor(simMod, circuit);
    for (const car of cars) { const x = F.rawVector(car); for (let j = 0; j < d; j++) { if (x[j] < lo[j]) lo[j] = x[j]; if (x[j] > hi[j]) hi[j] = x[j]; } }
    source = "the sim's " + cars.length + " fitted team cars (teamCars()) and the centre car + MARGIN";
  } else throw new Error("train: unknown --box " + spec.box);
  for (let j = 0; j < d; j++) {
    const n = F.RAW_NAMES[j], h = HARD[n];
    lo[j] -= marginOf(n, 0, c[j]); hi[j] += marginOf(n, 1, c[j]);
    if (spec.box === "teams" && n === "stall_margin_mm") lo[j] = Math.max(lo[j], 0);   // a stalled floor halves CLA in the physics sim: a jump, kept out of the box
    if (h) { lo[j] = Math.max(lo[j], h[0]); hi[j] = Math.min(hi[j], h[1]); }
  }
  return { lo, hi, centre: c, source, stall_in_doe: lo[F.RI.stall_margin_mm] < 0 };
}
function coreBox(box, frac) {
  const lo = new Float64Array(box.lo.length), hi = new Float64Array(box.lo.length);
  for (let j = 0; j < lo.length; j++) { lo[j] = box.centre[j] - frac * (box.centre[j] - box.lo[j]); hi[j] = box.centre[j] + frac * (box.hi[j] - box.centre[j]); }
  return { lo, hi };
}

// ---------------------------------------------------------------------------------------------------------------------------
// model classes. Z: standardised features (n × NF arrays), Y: { target: Float64Array }
const S = require("./surrogate.js");
function fitQuadratic(Ztr, Ytr, Zva, Yva, targets) {
  const p = S.NQ, n = Ztr.length, T = targets.length, q = new Float64Array(p);
  const A = new Float64Array(p * p), B = new Float64Array(p * T);
  for (let r = 0; r < n; r++) {
    S.quadBasis(Ztr[r], q);
    for (let i = 0; i < p; i++) { const qi = q[i]; if (qi === 0) continue; const o = i * p; for (let j = i; j < p; j++) A[o + j] += qi * q[j]; for (let t = 0; t < T; t++) B[i * T + t] += qi * Ytr[targets[t]][r]; }
  }
  for (let i = 0; i < p; i++) for (let j = 0; j < i; j++) A[i * p + j] = A[j * p + i];
  const Qva = Zva.map(z => S.quadBasis(z, new Float64Array(p)));
  const best = targets.map(() => ({ rmse: Infinity }));
  for (const lam of [1e-7, 1e-5, 1e-4, 1e-3, 1e-2, 3e-2, 0.1, 0.3, 1]) {
    const L = Float64Array.from(A); for (let i = 1; i < p; i++) L[i * p + i] += lam * n;
    if (!cholesky(L, p)) continue;
    const W = cholSolve(L, p, Float64Array.from(B), T);
    targets.forEach((t, k) => {
      const coef = new Float64Array(p); for (let i = 0; i < p; i++) coef[i] = W[i * T + k];
      const pred = Qva.map(qv => S.dot(coef, qv)), e = rmseOf(pred, Yva[t]);
      if (e < best[k].rmse) best[k] = { rmse: e, lambda: lam, coef };
    });
  }
  const out = {}; targets.forEach((t, k) => { out[t] = best[k]; });
  return out;
}
// RBF kernel ridge (GP posterior mean with a fixed kernel) on the residual of the quadratic, on M training points as centres
function fitRbf(Ztr, Ytr, Zva, Yva, targets, quad, M, rng) {
  const idx = shuffle(Array.from({ length: Ztr.length }, (_, i) => i), rng).slice(0, Math.min(M, Ztr.length));
  M = idx.length;
  const d = F.NAMES.length, Cn = new Float64Array(M * d); idx.forEach((r, k) => Cn.set(Ztr[r], k * d));
  const T = targets.length, q = new Float64Array(S.NQ);
  const res = targets.map(t => { const c = quad[t].coef; return idx.map(r => Ytr[t][r] - S.dot(c, S.quadBasis(Ztr[r], q))); });
  const scale = res.map(r => { let m = 0; for (const v of r) m += v; m /= r.length; let s = 0; for (const v of r) s += (v - m) ** 2; return Math.sqrt(s / r.length) || 1; });
  const D2 = new Float64Array(M * M);
  for (let a = 0; a < M; a++) for (let b = a; b < M; b++) { let s = 0; for (let i = 0; i < d; i++) { const e = Cn[a * d + i] - Cn[b * d + i]; s += e * e; } D2[a * M + b] = D2[b * M + a] = s; }
  const Dva = Zva.map(z => S.sqDist(z, Cn, M, new Float64Array(M)));
  const qva = Zva.map((z, r) => targets.map(t => S.dot(quad[t].coef, S.quadBasis(z, q))));
  const best = targets.map(() => ({ rmse: Infinity }));
  for (const ell of [1.5, 2.5, 4, 6, 9]) {
    const inv = 1 / (2 * ell * ell);
    for (const noise of [1e-3, 1e-2, 1e-1]) {
      const K = new Float64Array(M * M); for (let i = 0; i < M * M; i++) K[i] = Math.exp(-D2[i] * inv); for (let i = 0; i < M; i++) K[i * M + i] += noise;
      if (!cholesky(K, M)) continue;
      const Bm = new Float64Array(M * T); for (let k = 0; k < M; k++) for (let t = 0; t < T; t++) Bm[k * T + t] = res[t][k] / scale[t];
      cholSolve(K, M, Bm, T);
      targets.forEach((t, k) => {
        const alpha = new Float64Array(M); for (let i = 0; i < M; i++) alpha[i] = Bm[i * T + k];
        const pred = Dva.map((d2, r) => qva[r][k] + scale[k] * S.rbfSum(d2, alpha, inv)), e = rmseOf(pred, Yva[t]);
        if (e < best[k].rmse) best[k] = { rmse: e, ell, noise, alpha, scale: scale[k] };
      });
    }
  }
  const out = { centres: Cn, M, targets: {} }; targets.forEach((t, k) => { out.targets[t] = best[k]; });
  return out;
}
// 2×H tanh MLP, all targets at once (standardised outputs), Adam with cosine learning-rate decay, best-validation weights kept
function fitMlp(Ztr, Ytr, Zva, Yva, targets, opts, rng) {
  const H = opts.hidden || 32, d0 = F.NAMES.length, T = targets.length, n = Ztr.length, E = opts.epochs || 400, bs = 32;
  const gauss = gaussFn(rng);
  const ym = targets.map(t => { let m = 0; for (const v of Ytr[t]) m += v; return m / n; });
  const ys = targets.map((t, k) => { let s = 0; for (const v of Ytr[t]) s += (v - ym[k]) ** 2; return Math.sqrt(s / n) || 1; });
  const Yn = Array.from({ length: n }, (_, r) => Float64Array.from(targets, (t, k) => (Ytr[t][r] - ym[k]) / ys[k]));
  const init = (fi, fo) => Float64Array.from({ length: fi * fo }, () => gauss() * Math.sqrt(1 / fi));
  const P = { W1: init(d0, H), b1: new Float64Array(H), W2: init(H, H), b2: new Float64Array(H), W3: init(H, T).map(v => v * 0.5), b3: new Float64Array(T) };
  const keys = Object.keys(P), G = {}, M1 = {}, M2 = {};
  for (const k of keys) { G[k] = new Float64Array(P[k].length); M1[k] = new Float64Array(P[k].length); M2[k] = new Float64Array(P[k].length); }
  const net = () => ({ sizes: [d0, H, H, T], W1: P.W1, b1: P.b1, W2: P.W2, b2: P.b2, W3: P.W3, b3: P.b3 });
  const h1 = new Float64Array(H), h2 = new Float64Array(H), o = new Float64Array(T), g3 = new Float64Array(T), g2 = new Float64Array(H), g1 = new Float64Array(H);
  const valErr = () => { const nt = net(), out = new Float64Array(T); let s = 0; for (let r = 0; r < Zva.length; r++) { S.mlpForward(nt, Zva[r], h1, h2, out); for (let k = 0; k < T; k++) s += ((out[k] * ys[k] + ym[k] - Yva[targets[k]][r]) / ys[k]) ** 2; } return s / (Zva.length * T); };
  const order = Array.from({ length: n }, (_, i) => i);
  let step = 0, best = { err: Infinity, P: null, epoch: 0 };
  const lr0 = opts.lr || 3e-3, b1m = 0.9, b2m = 0.999, wd = 1e-6;
  for (let ep = 0; ep < E; ep++) {
    shuffle(order, rng);
    const lr = 1e-5 + 0.5 * (lr0 - 1e-5) * (1 + Math.cos(Math.PI * ep / E));
    for (let s0 = 0; s0 < n; s0 += bs) {
      for (const k of keys) G[k].fill(0);
      const m = Math.min(bs, n - s0);
      for (let b = 0; b < m; b++) {
        const r = order[s0 + b], z = Ztr[r], yv = Yn[r];
        S.mlpForward(net(), z, h1, h2, o);
        for (let k = 0; k < T; k++) g3[k] = (2 * (o[k] - yv[k])) / (m * T);
        g2.fill(0);
        for (let k = 0; k < T; k++) { const gk = g3[k], ok = k * H; G.b3[k] += gk; for (let j = 0; j < H; j++) { G.W3[ok + j] += gk * h2[j]; g2[j] += gk * P.W3[ok + j]; } }
        g1.fill(0);
        for (let j = 0; j < H; j++) { const gj = g2[j] * (1 - h2[j] * h2[j]), oj = j * H; G.b2[j] += gj; for (let i = 0; i < H; i++) { G.W2[oj + i] += gj * h1[i]; g1[i] += gj * P.W2[oj + i]; } }
        for (let j = 0; j < H; j++) { const gj = g1[j] * (1 - h1[j] * h1[j]), oj = j * d0; G.b1[j] += gj; for (let i = 0; i < d0; i++) G.W1[oj + i] += gj * z[i]; }
      }
      step++;
      const c1 = 1 - Math.pow(b1m, step), c2 = 1 - Math.pow(b2m, step);
      for (const k of keys) {
        const p = P[k], g = G[k], m1 = M1[k], m2 = M2[k], decay = k[0] === "W" ? wd : 0;
        for (let i = 0; i < p.length; i++) { const gi = g[i] + decay * p[i]; m1[i] = b1m * m1[i] + (1 - b1m) * gi; m2[i] = b2m * m2[i] + (1 - b2m) * gi * gi; p[i] -= lr * (m1[i] / c1) / (Math.sqrt(m2[i] / c2) + 1e-8); }
      }
    }
    if ((ep + 1) % 10 === 0 || ep === E - 1) { const e = valErr(); if (e < best.err) best = { err: e, epoch: ep + 1, P: Object.fromEntries(keys.map(k => [k, Float64Array.from(P[k])])) }; }
  }
  const W = best.P, nt = { sizes: [d0, H, H, T], W1: W.W1, b1: W.b1, W2: W.W2, b2: W.b2, W3: W.W3, b3: W.b3 }, out = new Float64Array(T);
  const val = targets.map(() => []);
  for (let r = 0; r < Zva.length; r++) { S.mlpForward(nt, Zva[r], h1, h2, out); for (let k = 0; k < T; k++) val[k].push(out[k] * ys[k] + ym[k]); }
  const per = {}; targets.forEach((t, k) => { per[t] = { rmse: rmseOf(val[k], Yva[t]), out: k }; });
  return { net: Object.assign(nt, { y_mean: Float64Array.from(ym), y_std: Float64Array.from(ys) }), epoch: best.epoch, targets: per };
}

// a model JSON (format purple-surrogate/1) from fitted classes and a per-target choice
function assemble(base, choice, fits, targets) {
  const m = Object.assign({}, base, { targets: {}, rbf: null, mlp: null });
  for (const t of targets) {
    const c = choice[t];
    if (c === "quadratic") m.targets[t] = { model: "quadratic", coef: rnd(fits.quadratic[t].coef), lambda: fits.quadratic[t].lambda };
    else if (c === "rbf") { const r = fits.rbf.targets[t]; m.targets[t] = { model: "rbf", coef: rnd(fits.quadratic[t].coef), alpha: rnd(r.alpha), ell: r.ell, noise: r.noise, scale: sig(r.scale) }; }
    else if (c === "mlp") m.targets[t] = { model: "mlp", out: fits.mlp.targets[t].out, coef: rnd(fits.quadratic[t].coef), lambda: fits.quadratic[t].lambda };
  }
  if (targets.some(t => choice[t] === "rbf")) { const d = F.NAMES.length; m.rbf = { centres: Array.from({ length: fits.rbf.M }, (_, k) => rnd(fits.rbf.centres.subarray(k * d, (k + 1) * d))) }; }
  if (targets.some(t => choice[t] === "mlp")) { const n = fits.mlp.net; m.mlp = { sizes: n.sizes, activation: "tanh", W1: rnd(n.W1), b1: rnd(n.b1), W2: rnd(n.W2), b2: rnd(n.b2), W3: rnd(n.W3), b3: rnd(n.b3), y_mean: rnd(n.y_mean), y_std: rnd(n.y_std), epoch: fits.mlp.epoch } ; }
  return m;
}

// ---------------------------------------------------------------------------------------------------------------------------
// train one (sim, circuit). opts: { name, spec | simFn (in-process sim(pc, circuit) -> result), label?, circuit, n, seed, workers,
// classes, rbfCentres, mlpEpochs, centreCar?, box?, checks (concept-design / ranking / team checks), log }
async function train(opts) {
  const log = opts.log || (() => {});
  const circuit = opts.circuit, seed = opts.seed == null ? 1 : opts.seed, n = opts.n || 6000;
  const classes = opts.classes || ["quadratic", "rbf", "mlp"];
  const local = opts.simFn ? { run: (pc, c) => { const r = opts.simFn(pc, c); return { flat: flatten(r, null), label: r.label }; }, mod: {} } : loadSim(opts.spec);
  const spec = opts.spec || { centre: "given", box: "given" };
  const centre = opts.centreCar ? stripCar(opts.centreCar) : centreCar(spec, local.mod, circuit);
  const box = opts.box || buildBox(spec, centre, local.mod, seed, circuit);
  const rng = seededRng(seed);
  // DOE: one Latin hypercube per tier
  let X = [], left = n; const tierN = [];
  TIERS.forEach((tier, k) => { const m = k === TIERS.length - 1 ? left : Math.round(tier.share * n); left -= m; tierN.push(m); const b = coreBox(box, tier.frac); X = X.concat(lhs(m, b.lo, b.hi, rng)); });
  const cars = X.map((x, i) => F.fromRaw(x, centre, "doe" + i));
  const t0 = Date.now();
  const runs = await runSim(opts.spec, cars, circuit, opts.simFn ? 0 : opts.workers, local);
  log("  " + circuit + ": " + n + " sim runs in " + ((Date.now() - t0) / 1000).toFixed(1) + " s");
  const simLabel = opts.label || runs[0].label || opts.name;
  // targets: present and finite in every run, not constant
  const names = Object.keys(runs[0].flat).filter(k => runs.every(r => Number.isFinite(r.flat[k])));
  const targets = names.filter(k => { const v = runs.map(r => r.flat[k]); return Math.max(...v) - Math.min(...v) > 1e-9; });
  const Y = {}; for (const t of targets) Y[t] = Float64Array.from(runs, r => r.flat[t]);
  // features, standardised on the training split
  const Fx = cars.map(pc => F.features(pc));
  const perm = shuffle(Array.from({ length: n }, (_, i) => i), rng);
  const nte = Math.round(0.15 * n), nva = Math.round(0.15 * n);
  const iTe = perm.slice(0, nte), iVa = perm.slice(nte, nte + nva), iTr = perm.slice(nte + nva);
  const nf = F.NAMES.length, mean = new Float64Array(nf), std = new Float64Array(nf);
  for (const i of iTr) for (let j = 0; j < nf; j++) mean[j] += Fx[i][j] / iTr.length;
  for (const i of iTr) for (let j = 0; j < nf; j++) std[j] += (Fx[i][j] - mean[j]) ** 2 / iTr.length;
  for (let j = 0; j < nf; j++) std[j] = Math.sqrt(std[j]) > 1e-12 ? Math.sqrt(std[j]) : 1;
  const Z = Fx.map(f => Float64Array.from(f, (v, j) => (v - mean[j]) / std[j]));
  const pick = (idx) => ({ Z: idx.map(i => Z[i]), Y: Object.fromEntries(targets.map(t => [t, Float64Array.from(idx, i => Y[t][i])])) });
  const tr = pick(iTr), va = pick(iVa);
  const fits = {}, tf = {};
  let t1 = Date.now();
  fits.quadratic = fitQuadratic(tr.Z, tr.Y, va.Z, va.Y, targets); tf.quadratic = Date.now() - t1;
  log("  quadratic fitted (" + S.NQ + " terms) in " + tf.quadratic + " ms");
  if (classes.includes("rbf")) { t1 = Date.now(); fits.rbf = fitRbf(tr.Z, tr.Y, va.Z, va.Y, targets, fits.quadratic, opts.rbfCentres || 600, seededRng(seed + 1)); tf.rbf = Date.now() - t1; log("  rbf fitted (" + fits.rbf.M + " centres) in " + tf.rbf + " ms"); }
  if (classes.includes("mlp")) { t1 = Date.now(); fits.mlp = fitMlp(tr.Z, tr.Y, va.Z, va.Y, targets, { epochs: opts.mlpEpochs || 400 }, seededRng(seed + 2)); tf.mlp = Date.now() - t1; log("  mlp fitted (best epoch " + fits.mlp.epoch + ") in " + tf.mlp + " ms"); }
  // choice per target: the lowest validation RMSE
  const choice = {}, valRmse = {};
  for (const t of targets) {
    valRmse[t] = {}; let bestC = "quadratic", bestE = Infinity;
    for (const c of classes) { const e = c === "quadratic" ? fits.quadratic[t].rmse : c === "rbf" ? fits.rbf.targets[t].rmse : fits.mlp.targets[t].rmse; valRmse[t][c] = e; if (e < bestE) { bestE = e; bestC = c; } }
    choice[t] = bestC;
  }
  const base = {
    format: S.FORMAT, sim: opts.name, sim_label: simLabel, circuit, features_version: F.VERSION,
    trained: { n, seed, doe: "Latin hypercubes, seeded: " + TIERS.map((t, k) => tierN[k] + " over centre ± " + t.frac * 100 + " % of the box").join(", "), split: { train: iTr.length, validation: iVa.length, test: iTe.length }, classes, conditions: "the sim's defaults (conditions = null)" },
    raw: { names: F.RAW_NAMES, lo: rnd(box.lo), hi: rnd(box.hi), centre: rnd(box.centre), source: box.source, stall_in_doe: box.stall_in_doe },
    fixed: F.FIXED.map(f => ({ name: f.name, value: f.get(centre), rel_tol: f.rel_tol })),
    feat: { names: F.NAMES, mean: rnd(mean), std: rnd(std) },
    centre_car: centre,
    // the sim's own outputs for the centre car at training time: if the sim later answers differently, the surrogate is stale
    sim_fingerprint: (() => { const f = local.run(centre, circuit).flat; return { lap_s: f.lap_s, speed_trap_kmh: f.speed_trap_kmh, vmin_kmh: f.vmin_kmh }; })(),
  };
  // the test split through every class (each assembled as if it were the only one) and through the chosen mix
  const evalModel = (m, idx) => {
    S.register(m);
    const pred = Object.fromEntries(targets.map(t => [t, []]));
    for (const i of idx) { const p = S.predict(cars[i], circuit, { sim: m.sim, allowExtrapolation: true }); for (const t of targets) pred[t].push(getT(p, t)); }
    return pred;
  };
  const classReport = {};
  for (const c of classes) {
    const m = assemble(Object.assign({}, base, { sim: "__eval_" + opts.name + "_" + c }), Object.fromEntries(targets.map(t => [t, c])), fits, targets);
    const pred = evalModel(m, iTe);
    classReport[c] = Object.fromEntries(targets.map(t => [t, roundM(metrics(pred[t], Array.from(iTe, i => Y[t][i])))]));
  }
  const model = assemble(base, choice, fits, targets);
  const pred = evalModel(model, iTe);
  const chosen = Object.fromEntries(targets.map(t => [t, Object.assign({ model: choice[t] }, roundM(metrics(pred[t], Array.from(iTe, i => Y[t][i]))))]));
  // error vs distance from the training centre (test split, chosen model)
  const bins = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 1.0001];
  const dist = iTe.map(i => S.boxDistance(cars[i], circuit, opts.name));
  const byDist = bins.slice(0, -1).map((b, k) => {
    const sel = iTe.map((i, j) => j).filter(j => dist[j] >= b && dist[j] < bins[k + 1]);
    const row = { from: b, to: Math.min(1, bins[k + 1]), n: sel.length };
    for (const t of ["lap_s", "speed_trap_kmh", "vmin_kmh"]) if (Y[t] && sel.length) row[t + "_rmse"] = sig(rmseOf(sel.map(j => pred[t][j]), sel.map(j => Y[t][iTe[j]])), 4);
    return row;
  });
  model.report = {
    test: { per_class: classReport, chosen }, validation_rmse: roundObj(valRmse), chosen: Object.fromEntries(targets.map(t => [t, { model: choice[t], rmse: chosen[t].rmse }])),
    error_vs_distance: { definition: "distance = max over RAW fields of |x − centre| / (box half-width on that side); test split, chosen models", bins: byDist },
  };
  if (opts.checks !== false) model.report.checks = await checks(opts, model, centre, local, circuit, seed, log);
  S.register(model);
  Object.defineProperty(model, "__fit_ms", { value: tf, enumerable: false, configurable: true, writable: true });
  return model;
}
const getT = (p, t) => (t === "s1_s" ? p.sectors_s[0] : t === "s2_s" ? p.sectors_s[1] : t === "s3_s" ? p.sectors_s[2] : t.startsWith("apex.") ? p.apex_kmh[t.slice(5)] : t.startsWith("speeds.") ? p.speeds_kmh[t.slice(7)] : p[t]);
const roundM = m => ({ rmse: sig(m.rmse, 4), max_abs: sig(m.max_abs, 4), r2: sig(m.r2, 6), n: m.n });
const roundObj = o => JSON.parse(JSON.stringify(o, (k, v) => (typeof v === "number" ? sig(v, 4) : v)));

// fresh checks on cars the DOE never drew: concept designs (through physical(); for a box built on a sim's own cars the design
// is carried RELATIVE to the concept baseline onto the centre car, surrogate.relativeCar), the sim's team cars, and the ranking of
// optimiser candidate changes (ES generations: 8 mutations of a parent; Spearman ρ of Δlap surrogate vs sim)
async function checks(opts, model, centre, local, circuit, seed, log) {
  const design = require("../design.js"), phys = require("../physical.js");
  const B = design.baseline(), ref = stripCar(phys.physical(B)), rel = !!(opts.spec && opts.spec.box === "teams");
  const carOf = d => { const pc = stripCar(phys.physical(d)); return rel ? S.relativeCar(pc, ref, centre) : pc; };
  const rng = seededRng(seed + 3), out = {};
  // (a) concept designs: mutations of the baseline (σ 0.05-0.2) and uniform random designs
  const near = [], far = conceptDesigns(150, seed + 11);
  for (let k = 0; k < 150; k++) { let d = B; const steps = 1 + Math.floor(rng() * 4); for (let s = 0; s < steps; s++) d = design.mutate(d, rng, [0.05, 0.1, 0.2][k % 3]).design; near.push(d); }
  // (b) ranking: 40 parents (random walks from the baseline), 8 children each (σ 0.08, as the default ES)
  const gens = [];
  for (let g = 0; g < 40; g++) { let par = B; const steps = Math.floor(rng() * 6); for (let s = 0; s < steps; s++) par = design.mutate(par, rng, 0.1).design; const kids = []; for (let c = 0; c < 8; c++) kids.push(design.mutate(par, rng, 0.08).design); gens.push({ par, kids }); }
  const teamCars = teamCarsFor(local.mod, circuit).map(stripCar);
  const all = near.concat(far).map(carOf), genCars = []; for (const g of gens) { genCars.push(carOf(g.par)); for (const k of g.kids) genCars.push(carOf(k)); }
  const pool = all.concat(genCars, teamCars);
  const t0 = Date.now();
  const runs = await runSim(opts.spec, pool, circuit, opts.simFn ? 0 : opts.workers, local);
  log("  checks: " + pool.length + " sim runs in " + ((Date.now() - t0) / 1000).toFixed(1) + " s");
  const surr = pool.map(pc => S.predict(pc, circuit, { sim: model.sim }));
  const grp = (from, to, name) => {
    const sel = []; for (let i = from; i < to; i++) if (surr[i].ok) sel.push(i);
    const r = { n: to - from, n_in_box: sel.length };
    if (sel.length) { const m = metrics(sel.map(i => surr[i].lap_s), sel.map(i => runs[i].flat.lap_s)); r.lap_rmse_s = sig(m.rmse, 4); r.lap_max_abs_s = sig(m.max_abs, 4); }
    if (sel.length && runs[sel[0]].flat.speed_trap_kmh != null) r.trap_rmse_kmh = sig(rmseOf(sel.map(i => surr[i].speed_trap_kmh), sel.map(i => runs[i].flat.speed_trap_kmh)), 4);
    out[name] = r;
  };
  grp(0, 150, "concept_mutations"); grp(150, 300, "concept_random"); grp(300 + genCars.length, pool.length, "team_cars");
  if (teamCars.length) out.team_cars.rows = teamCars.map((c, k) => { const i = 300 + genCars.length + k; return { id: c.id, sim_lap_s: runs[i].flat.lap_s, surrogate_lap_s: surr[i].ok ? sig(surr[i].lap_s, 6) : null, in_box: surr[i].ok }; });
  // ranking
  const dSim = [], dSur = [], within = []; let agreeSign = 0, nSign = 0, bestSame = 0, nGen = 0, keepAgree = 0, nKeep = 0;
  let o = 300;
  for (let g = 0; g < gens.length; g++) {
    const pi = o; o += 1; const ks = []; for (let c = 0; c < 8; c++) ks.push(o + c); o += 8;
    if (!surr[pi].ok) continue;
    const ok = ks.filter(i => surr[i].ok); if (ok.length < 3) continue;
    const a = ok.map(i => runs[i].flat.lap_s - runs[pi].flat.lap_s), b = ok.map(i => surr[i].lap_s - surr[pi].lap_s);
    for (let k = 0; k < ok.length; k++) { dSim.push(a[k]); dSur.push(b[k]); if (Math.abs(a[k]) > 0.002) { nSign++; if (Math.sign(a[k]) === Math.sign(b[k])) agreeSign++; } nKeep++; if ((a[k] < 0) === (b[k] < 0)) keepAgree++; }
    within.push(spearman(a, b)); nGen++;
    const ia = a.indexOf(Math.min(...a)), ib = b.indexOf(Math.min(...b)); if (ia === ib) bestSame++;
  }
  out.ranking = {
    n_pairs: dSim.length, spearman_rho: sig(spearman(dSim, dSur), 4),
    sign_agreement: nSign ? sig(agreeSign / nSign, 4) : null, sign_pairs: nSign,
    keep_decision_agreement: nKeep ? sig(keepAgree / nKeep, 4) : null,
    generations: nGen, mean_within_generation_rho: nGen ? sig(within.reduce((s, v) => s + v, 0) / nGen, 4) : null, best_child_same: nGen ? sig(bestSame / nGen, 4) : null,
    definition: "40 parents (random walks from the concept baseline) × 8 children (design.mutate σ 0.08); Δlap = child − parent; " + (rel ? "designs carried relative to the concept baseline onto the centre car" : "designs through physical()"),
  };
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------------
// CLI
function args(argv) {
  const a = {}; for (let i = 0; i < argv.length; i++) { const m = /^--([a-z-]+)$/.exec(argv[i]); if (!m) continue; const nx = argv[i + 1]; if (nx == null || nx.startsWith("--")) a[m[1]] = true; else { a[m[1]] = nx; i++; } }
  return a;
}
function table(model) {
  const r = model.report, classes = model.trained.classes, lines = [];
  const unit = t => (/_s$/.test(t) ? "ms" : /_mj$/.test(t) ? "MJ" : "km/h"), sc = t => (/_s$/.test(t) ? 1000 : 1);
  lines.push("| target | " + classes.map(c => c + " RMSE / max / R²").join(" | ") + " | chosen |");
  lines.push("|---|" + classes.map(() => "---|").join("") + "---|");
  for (const t of Object.keys(model.targets)) {
    const u = unit(t), f = v => (v * sc(t)).toFixed(u === "MJ" ? 3 : u === "ms" ? 1 : 2);
    lines.push("| " + t + " (" + u + ") | " + classes.map(c => { const m = r.test.per_class[c][t]; return f(m.rmse) + " / " + f(m.max_abs) + " / " + m.r2.toFixed(4); }).join(" | ") + " | " + r.chosen[t].model + " |");
  }
  return lines.join("\n");
}
async function main() {
  const a = args(process.argv.slice(2));
  const name = a["sim-name"] || a.sim || "physics";
  const spec = Object.assign({}, SIMS[name] || {});
  if (a["sim-module"]) spec.module = path.relative(__dirname, path.resolve(a["sim-module"]));
  if (a["sim-export"]) spec.fn = a["sim-export"];
  if (a.centre) spec.centre = a.centre;
  if (a.box) spec.box = a.box;
  if (!spec.module) throw new Error("train: unknown --sim " + name + " (known: " + Object.keys(SIMS).join(", ") + "; or give --sim-module and --sim-export)");
  spec.centre = spec.centre || "sim-baseline"; spec.box = spec.box || "concept";
  const circuits = a.circuits ? String(a.circuits).split(",") : spec.circuits || ["silverstone"];
  const quick = !!a.quick, n = +(a.n || (quick ? 600 : 6000)), seed = +(a.seed || 1);
  const workers = a.workers != null ? +a.workers : Math.max(1, Math.min(8, os.cpus().length));
  const out = path.resolve(a.out || path.join(__dirname, "models"));
  const repo = path.resolve(__dirname, "..", ".."), rel = path.relative(repo, out).split(path.sep);
  if (rel[0] === "data" || rel[0] === "data-mock") throw new Error("train: refusing to write inside " + rel[0] + "/");
  fs.mkdirSync(out, { recursive: true });
  const classes = a.classes ? String(a.classes).split(",") : ["quadratic", "rbf", "mlp"];
  console.log("surrogate train: sim " + name + " (" + spec.module + " " + spec.fn + "), circuits " + circuits.join(",") + ", n " + n + ", seed " + seed + ", workers " + workers + ", classes " + classes.join(","));
  for (const circuit of circuits) {
    const t0 = Date.now();
    const model = await train({ name, spec, circuit, n, seed, workers, classes, rbfCentres: +(a["rbf-centres"] || 600), mlpEpochs: +(a["mlp-epochs"] || (quick ? 60 : 400)), log: s => console.log(s) });
    // machine-dependent numbers live under report.machine (everything else in the file is byte-deterministic for a seed)
    model.report.machine = { timing: S.timing(circuit, name), fit_ms: model.__fit_ms, note: "wall-clock numbers of the training machine; not deterministic" };
    delete model.__fit_ms;
    for (const c of classes) model.report.machine.timing["lap_" + c + "_us"] = S.timing(circuit, "__eval_" + name + "_" + c, 20000, 3).lap_only_us;   // each class on its own
    model.report.machine.train_s = +((Date.now() - t0) / 1000).toFixed(1);
    const f = path.join(out, name + "-" + circuit + ".json");
    fs.writeFileSync(f, JSON.stringify(model) + "\n");
    console.log("\n" + name + " · " + circuit + " → " + path.relative(process.cwd(), f) + " (" + (fs.statSync(f).size / 1024).toFixed(0) + " KB), " + model.report.machine.train_s + " s");
    console.log(table(model));
    console.log("error vs distance:", JSON.stringify(model.report.error_vs_distance.bins));
    console.log("checks:", JSON.stringify(Object.assign({}, model.report.checks, { team_cars: model.report.checks.team_cars && Object.assign({}, model.report.checks.team_cars, { rows: undefined }) })));
    console.log("timing (µs/call):", JSON.stringify(model.report.machine.timing));
  }
}

module.exports = { SIMS, MARGIN, HARD, TIERS, train, buildBox, coreBox, lhs, flatten, spearman, metrics, cholesky, cholSolve, table, loadSim };
if (isMainThread && require.main === module) main().catch(e => { console.error(e && e.stack || e); process.exit(1); });
