// PURPLE CONCEPT - surrogate models of a lap simulator: microsecond approximations of sim(PhysicalCar, circuit) for the
// optimiser and for uncertainty propagation. Trained by concept/surrogate/train.js on a design of experiments over the
// PhysicalCar space; one saved model per (sim, circuit) in concept/surrogate/models/<sim>-<circuit>.json; method, accuracy and
// limits in docs/concept/SURROGATE.md. A surrogate imitates its sim and nothing else: its error is measured against the sim,
// never against a real car, and it refuses to answer outside the box it was trained in.
//
//   predict(pc, circuit, { sim, allowExtrapolation })  -> { ok, lap_s, sectors_s[3], speed_trap_kmh, vmin_kmh, vmax_kmh, ...,
//                                                          extrapolating, out_of_box, label: "surrogate of <sim label> · RMSE x ms" }
//   predictLap(pc, circuit, sim?)                      -> lap_s (number; NaN outside the training box). The fast path.
//   predictWithUncertainty(pcMean, pcStd, n, { circuit, sim, seed })  Monte Carlo: per-target mean / std / p05 / p95
//   asSim(circuit?, { sim, fallback })                 -> a sim(pc, trackId, conditions) for concept/bench.js { sim }
//   inBox(pc, circuit, sim) · load(sim, circuit) · register(model) · available() · timing(circuit, sim)
// Dual browser / Node: window.EI.concept.surrogate and module.exports. In the browser, register() each model JSON first.
(function () {
  const root = typeof window !== "undefined" ? window : globalThis;
  const EI = (root.EI = root.EI || {}); const C = (EI.concept = EI.concept || {});
  const F = C.surrogateFeatures || (typeof require === "function" ? require("./features.js") : null);
  const FORMAT = "purple-surrogate/1";
  const NF = F.FEATURES.length, NR = F.RAW.length, NQ = 1 + NF + (NF * (NF + 1)) / 2;
  let defaultSim = (typeof process !== "undefined" && process.env && process.env.PURPLE_SURROGATE_SIM) || "physics";

  // ---- model registry
  const models = {};
  const key = (sim, circuit) => sim + "-" + circuit;
  function modelsDir() { return require("path").join(__dirname, "models"); }
  function register(m) {
    if (!m || m.format !== FORMAT) throw new Error("surrogate: not a " + FORMAT + " model");
    if (m.features_version !== F.VERSION) throw new Error("surrogate: model " + key(m.sim, m.circuit) + " was fitted on '" + m.features_version + "', this code computes '" + F.VERSION + "': retrain");
    if (m.feat.names.join() !== F.NAMES.join() || m.raw.names.join() !== F.RAW_NAMES.join()) throw new Error("surrogate: feature / raw lists differ from features.js: retrain");
    models[key(m.sim, m.circuit)] = prepare(m);
    return models[key(m.sim, m.circuit)];
  }
  function load(sim, circuit) {
    sim = sim || defaultSim; circuit = circuit || "silverstone";
    const k = key(sim, circuit);
    if (models[k]) return models[k];
    if (typeof require !== "function") throw new Error("surrogate: no model " + k + " registered");
    const fs = require("fs"), path = require("path"), f = path.join(modelsDir(), k + ".json");
    if (!/^[a-z0-9_.-]+$/i.test(k) || !fs.existsSync(f)) throw new Error("surrogate: no saved model " + k + " (train it: node concept/surrogate/train.js --sim " + sim + " --circuits " + circuit + ")");
    return register(JSON.parse(fs.readFileSync(f, "utf8")));
  }
  function available() {
    const out = Object.keys(models).map(k => ({ sim: models[k].sim, circuit: models[k].circuit }));
    if (typeof require === "function") {
      const fs = require("fs");
      try { for (const f of fs.readdirSync(modelsDir())) { const m = /^(.+)-([a-z0-9_]+)\.json$/.exec(f); if (m && !models[f.slice(0, -5)]) out.push({ sim: m[1], circuit: m[2] }); } } catch (e) { /* no models dir */ }
    }
    return out;
  }
  function setDefaultSim(sim) { defaultSim = sim; }

  // typed arrays and per-call scratch, once per model
  function prepare(m) {
    const P = {
      sim: m.sim, circuit: m.circuit, sim_label: m.sim_label, json: m,
      lo: Float64Array.from(m.raw.lo), hi: Float64Array.from(m.raw.hi), centre: Float64Array.from(m.raw.centre),
      fmean: Float64Array.from(m.feat.mean), fstd: Float64Array.from(m.feat.std), fixed: m.fixed, stall_ok: m.raw.stall_in_doe !== false,
      targets: Object.keys(m.targets), t: {}, needMlp: false, rbfC: null,
      x: new Float64Array(NR), f: new Float64Array(NF), z: new Float64Array(NF), q: new Float64Array(NQ), d2: null, h1: null, h2: null, mo: null,
    };
    for (const name of P.targets) {
      const t = m.targets[name], o = { model: t.model };
      if (!t.coef) throw new Error("surrogate: target " + name + " has no quadratic coefficients");
      o.coef = Float64Array.from(t.coef);
      if (t.model === "rbf") { o.alpha = Float64Array.from(t.alpha); o.inv2l2 = 1 / (2 * t.ell * t.ell); o.scale = t.scale; }
      if (t.model === "mlp") { o.out = t.out; P.needMlp = true; }
      P.t[name] = o;
    }
    if (m.rbf) { P.rbfC = Float64Array.from([].concat(...m.rbf.centres)); P.rbfM = m.rbf.centres.length; P.d2 = new Float64Array(P.rbfM); }
    if (m.mlp) {
      const n = m.mlp;
      P.mlp = { sizes: n.sizes, W1: Float64Array.from(n.W1), b1: Float64Array.from(n.b1), W2: Float64Array.from(n.W2), b2: Float64Array.from(n.b2), W3: Float64Array.from(n.W3), b3: Float64Array.from(n.b3), ym: Float64Array.from(n.y_mean), ys: Float64Array.from(n.y_std) };
      P.h1 = new Float64Array(n.sizes[1]); P.h2 = new Float64Array(n.sizes[2]); P.mo = new Float64Array(n.sizes[3]);
    }
    const lapT = m.report && m.report.chosen && m.report.chosen.lap_s;
    P.lap_rmse_ms = lapT ? lapT.rmse * 1000 : null;
    const qT = m.report && m.report.test && m.report.test.per_class && m.report.test.per_class.quadratic && m.report.test.per_class.quadratic.lap_s;
    P.quad_lap_rmse_ms = qT ? qT.rmse * 1000 : null;
    P.label = "surrogate of " + m.sim_label + " · RMSE " + (P.lap_rmse_ms == null ? "?" : P.lap_rmse_ms.toFixed(1)) + " ms";
    return P;
  }

  // ---- the three model classes (shared with train.js, so training and prediction run the same arithmetic)
  // quadratic basis on standardised features z: [1, z_i, z_i z_j (i ≤ j)]
  function quadBasis(z, q) {
    const n = z.length; let k = 0; q[k++] = 1;
    for (let i = 0; i < n; i++) q[k++] = z[i];
    for (let i = 0; i < n; i++) { const zi = z[i]; for (let j = i; j < n; j++) q[k++] = zi * z[j]; }
    return q;
  }
  function dot(a, b) { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; }
  // squared distances from z to every RBF centre (row-major, d columns)
  function sqDist(z, centres, m, d2) {
    const d = z.length;
    for (let k = 0, o = 0; k < m; k++, o += d) { let s = 0; for (let i = 0; i < d; i++) { const e = z[i] - centres[o + i]; s += e * e; } d2[k] = s; }
    return d2;
  }
  function rbfSum(d2, alpha, inv2l2) { let s = 0; for (let k = 0; k < alpha.length; k++) s += alpha[k] * Math.exp(-d2[k] * inv2l2); return s; }
  // MLP forward: z -> tanh(W1 z + b1) -> tanh(W2 h + b2) -> W3 h + b3 (standardised outputs)
  function mlpForward(n, z, h1, h2, out) {
    const [d0, d1, d2, d3] = n.sizes;
    for (let j = 0; j < d1; j++) { let s = n.b1[j]; const o = j * d0; for (let i = 0; i < d0; i++) s += n.W1[o + i] * z[i]; h1[j] = Math.tanh(s); }
    for (let j = 0; j < d2; j++) { let s = n.b2[j]; const o = j * d1; for (let i = 0; i < d1; i++) s += n.W2[o + i] * h1[i]; h2[j] = Math.tanh(s); }
    for (let j = 0; j < d3; j++) { let s = n.b3[j]; const o = j * d2; for (let i = 0; i < d2; i++) s += n.W3[o + i] * h2[i]; out[j] = s; }
    return out;
  }

  // ---- box check (raw DOE space + the fields the DOE held fixed)
  const BOX_TOL = 1e-9;
  function outOfBox(P, pc, x) {
    let out = null;
    for (let i = 0; i < NR; i++) {
      const v = x[i];
      if (!(v >= P.lo[i] - BOX_TOL * (1 + Math.abs(P.lo[i])) && v <= P.hi[i] + BOX_TOL * (1 + Math.abs(P.hi[i])))) (out = out || []).push({ field: F.RAW_NAMES[i], value: v, lo: P.lo[i], hi: P.hi[i] });
    }
    if (P.stall_ok === false && F.stalled(pc)) (out = out || []).push({ field: "aero.floor_stalled", value: true, lo: false, hi: false });
    for (const fx of P.fixed) {
      const def = F.FIXED.find(f => f.name === fx.name), v = def ? def.get(pc) : NaN;
      if (!(Math.abs(v - fx.value) <= fx.rel_tol * Math.abs(fx.value))) (out = out || []).push({ field: fx.name, value: v, lo: fx.value * (1 - fx.rel_tol), hi: fx.value * (1 + fx.rel_tol) });
    }
    return out;
  }
  function inBox(pc, circuit, sim) {
    const P = load(sim, circuit), x = F.rawVector(pc, P.x), o = outOfBox(P, pc, x);
    return { inside: !o, out_of_box: o || [] };
  }
  // distance from the training centre (the centre car): RMS over raw fields of |x − c| / (box half-width on that side). 0 at the
  // centre; a uniform draw over the whole box averages ≈ 0.58; the box corners are at 1.
  function boxDistance(P, x) {
    let d = 0;
    for (let i = 0; i < NR; i++) { const w = x[i] >= P.centre[i] ? P.hi[i] - P.centre[i] : P.centre[i] - P.lo[i]; const r = w > 0 ? Math.abs(x[i] - P.centre[i]) / w : 0; d += r * r; }
    return Math.sqrt(d / NR);
  }

  function standardise(P, pc) {
    F.features(pc, P.f);
    for (let i = 0; i < NF; i++) P.z[i] = (P.f[i] - P.fmean[i]) / P.fstd[i];
    return P.z;
  }
  // evaluate one target on the current P.z (P.q / P.mo already filled when needed)
  function evalTarget(P, t, force) {
    if (force === "quadratic" || t.model === "quadratic") return dot(t.coef, P.q);
    if (t.model === "rbf") return dot(t.coef, P.q) + t.scale * rbfSum(P.d2, t.alpha, t.inv2l2);
    if (t.model === "mlp") return P.mo[t.out] * P.mlp.ys[t.out] + P.mlp.ym[t.out];
    throw new Error("surrogate: unknown model class " + t.model);
  }
  function evalAll(P, pc, force) {
    const z = standardise(P, pc), q = force === "quadratic";
    quadBasis(z, P.q);
    if (P.rbfC && !q) sqDist(z, P.rbfC, P.rbfM, P.d2);
    if (P.needMlp && !q) mlpForward(P.mlp, z, P.h1, P.h2, P.mo);
    const y = {};
    for (const name of P.targets) y[name] = evalTarget(P, P.t[name], force);
    return y;
  }

  // fast path: lap only. model = "quadratic" forces the quadratic response surface (every target stores one; < 5 µs a call)
  function predictLap(pc, circuit, sim, model) {
    const P = load(sim, circuit), x = F.rawVector(pc, P.x);
    if (outOfBox(P, pc, x)) return NaN;
    const z = standardise(P, pc), t = P.t.lap_s, kind = model === "quadratic" ? "quadratic" : t.model;
    if (kind !== "mlp") quadBasis(z, P.q);
    if (kind === "rbf") sqDist(z, P.rbfC, P.rbfM, P.d2);
    if (kind === "mlp") mlpForward(P.mlp, z, P.h1, P.h2, P.mo);
    return evalTarget(P, t, model);
  }

  // targets -> the sim contract's shape (sectors as an array, apex speeds as an object)
  function shape(y) {
    const out = { lap_s: y.lap_s };
    if (y.s1_s != null) out.sectors_s = [y.s1_s, y.s2_s, y.s3_s];
    for (const k of ["speed_trap_kmh", "vmin_kmh", "vmax_kmh"]) if (y[k] != null) out[k] = y[k];
    for (const k of Object.keys(y)) {
      if (/^(lap_s|s[123]_s|speed_trap_kmh|vmin_kmh|vmax_kmh)$/.test(k)) continue;
      if (k.startsWith("apex.")) (out.apex_kmh = out.apex_kmh || {})[k.slice(5)] = y[k];
      else if (k.startsWith("speeds.")) (out.speeds_kmh = out.speeds_kmh || {})[k.slice(7)] = y[k];
      else out[k] = y[k];
    }
    return out;
  }

  // predict(pc, circuit, opts) -> { ok, ...targets, extrapolating, out_of_box, distance, label }
  // opts: { sim, allowExtrapolation, model: "quadratic" (force the quadratic surface for every target) }
  function predict(pc, circuit, opts) {
    opts = opts || {};
    const P = load(opts.sim, circuit), x = F.rawVector(pc, P.x), oob = outOfBox(P, pc, x);
    const base = { ok: true, sim: P.sim, circuit: P.circuit, extrapolating: !!oob, out_of_box: oob || [], distance: +boxDistance(P, x).toFixed(4), label: P.label };
    if (oob && !opts.allowExtrapolation) {
      const nul = {}; for (const k of P.targets) nul[k] = null;
      return Object.assign(shape(nul), base, { ok: false, label: P.label + " · refused: outside the training box (" + oob.map(o => o.field).join(", ") + ")" });
    }
    if (opts.model === "quadratic") base.label = P.label.replace(/RMSE [^ ]+ ms/, "quadratic RMSE " + (P.quad_lap_rmse_ms == null ? "?" : P.quad_lap_rmse_ms.toFixed(1)) + " ms");
    return Object.assign(shape(evalAll(P, pc, opts.model)), base, oob ? { label: P.label + " · EXTRAPOLATING (" + oob.map(o => o.field).join(", ") + ")" } : {});
  }

  // ---- uncertainty propagation: pcStd mirrors the PhysicalCar shape with a standard deviation on any numeric leaf, e.g.
  // { mass_kg: 3, aero: { corner: { CLA_front_m2: 0.08, CLA_rear_m2: 0.1, CDA_m2: 0.03 } }, tyres: { mu_y: 0.04 } }.
  // Leaves are sampled independently (normal), seeded. Samples outside the training box are predicted anyway and counted.
  function gaussFrom(rng) { let spare = null; return () => { if (spare != null) { const s = spare; spare = null; return s; } const u = Math.max(rng(), 1e-12), v = rng(), r = Math.sqrt(-2 * Math.log(u)); spare = r * Math.sin(2 * Math.PI * v); return r * Math.cos(2 * Math.PI * v); }; }
  function xorshift(seed) {   // the concept seeded rng (design.seededRng), inlined so this file has no other dependency
    let x = (seed >>> 0) + 0x9e3779b9; x = Math.imul(x ^ (x >>> 16), 0x85ebca6b) >>> 0; x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35) >>> 0; x = (x ^ (x >>> 16)) >>> 0;
    let s = (x >>> 0) || 1;
    const rng = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
    for (let i = 0; i < 16; i++) rng();
    return rng;
  }
  function leaves(std, pathArr, out) {
    for (const k of Object.keys(std || {})) {
      const v = std[k], p = pathArr.concat(k);
      if (typeof v === "number") { if (v > 0) out.push({ path: p, std: v }); } else if (v && typeof v === "object") leaves(v, p, out);
    }
    return out;
  }
  function predictWithUncertainty(pcMean, pcStd, n, opts) {
    opts = opts || {}; n = n || 2000;
    const P = load(opts.sim, opts.circuit), rng = xorshift(opts.seed == null ? 1 : opts.seed), gauss = gaussFrom(rng);
    const L = leaves(pcStd, [], []), pc = JSON.parse(JSON.stringify(pcMean)), slots = [];
    for (const l of L) {
      let o = pc; for (let i = 0; i < l.path.length - 1; i++) o = o && o[l.path[i]];
      const k = l.path[l.path.length - 1];
      if (!o || typeof o[k] !== "number") throw new Error("surrogate: pcStd." + l.path.join(".") + " has no numeric field in the PhysicalCar");
      slots.push({ o, k, mean: o[k], std: l.std });
    }
    const stallSampled = slots.some(x => x.k === "stall_margin_mm" && x.o === pc.aero);
    const samples = {}; for (const t of P.targets) samples[t] = new Float64Array(n);
    let outside = 0;
    for (let s = 0; s < n; s++) {
      for (const sl of slots) sl.o[sl.k] = sl.mean + sl.std * gauss();
      if (stallSampled) pc.aero.floor_stalled = pc.aero.stall_margin_mm < 0;
      if (outOfBox(P, pc, F.rawVector(pc, P.x))) outside++;
      const y = evalAll(P, pc);
      for (const t of P.targets) samples[t][s] = y[t];
    }
    const stats = {};
    for (const t of P.targets) {
      const a = samples[t]; let m = 0; for (let i = 0; i < n; i++) m += a[i]; m /= n;
      let v = 0; for (let i = 0; i < n; i++) v += (a[i] - m) * (a[i] - m); v /= Math.max(1, n - 1);
      const sorted = Float64Array.from(a).sort(), q = p => sorted[Math.min(n - 1, Math.max(0, Math.round(p * (n - 1))))];
      const rm = P.json.report && P.json.report.chosen && P.json.report.chosen[t] ? P.json.report.chosen[t].rmse : 0;
      // std_total adds the surrogate's own held-out RMSE in quadrature: parameter spread + model error
      stats[t] = { mean: m, std: Math.sqrt(v), p05: q(0.05), p95: q(0.95), surrogate_rmse: rm, std_total: Math.sqrt(v + rm * rm) };
    }
    return { n, circuit: P.circuit, sim: P.sim, inputs: L.map(l => ({ field: l.path.join("."), std: l.std })), n_outside_box: outside, frac_outside_box: outside / n, stats, lap_s: stats.lap_s, label: P.label + " · Monte Carlo n=" + n + " (independent normal inputs)" };
  }

  // ---- relativeCar(pc, ref, anchor): carry a car's DIFFERENCE from a reference car onto an anchor car. Ratios for levels (ClA, CdA,
  // power, energy, μ, load sensitivity, efficiency, Straight Mode ratios), offsets for geometry and balances (mass, fuel, wheelbase,
  // CoG, weight distribution, aero balance, ride height and sensitivity, stall margin). Use: a concept design's PhysicalCar
  // (concept/physical.js scale) relative to the baseline concept car, carried onto a sim's own calibrated car (e.g. the physics
  // sim's Red Bull car), the way sim v0 reads every design relative to the baseline. Every other field comes from the anchor.
  const RATIO = new Set(["cla_corner_m2", "cda_corner_m2", "sm_cla_ratio", "sm_cda_ratio", "ice_kw", "mguk_kw", "es_deploy_mj", "es_harvest_mj", "mu_x", "mu_y", "load_sens", "drivetrain_eff"]);
  function relativeCar(pc, ref, anchor) {
    const x = F.rawVector(pc), r = F.rawVector(ref), a = F.rawVector(anchor), out = new Float64Array(x.length);
    for (let i = 0; i < x.length; i++) out[i] = RATIO.has(F.RAW_NAMES[i]) ? (r[i] !== 0 ? a[i] * x[i] / r[i] : a[i]) : a[i] + (x[i] - r[i]);
    const car = F.fromRaw(out, anchor, pc.id);
    car.label = "relative car: " + (pc.id || "design") + " − " + (ref.id || "reference") + " carried onto " + (anchor.id || "anchor");
    return car;
  }

  // ---- sim adapter for concept/bench.js: bench(design, { sim: surrogate.asSim("silverstone", { sim: "v0" }) }). The trackId bench
  // passes picks the model. Outside the box it calls opts.fallback (e.g. bench.simV0) when given, otherwise throws: it never
  // extrapolates silently. opts.relativeTo (a reference PhysicalCar, e.g. physical(design.baseline())) carries each car relative to
  // it onto the model's centre car first (relativeCar): how a concept design reaches the physics-sim surrogate.
  function asSim(circuit, opts) {
    if (circuit && typeof circuit === "object") { opts = circuit; circuit = null; }
    opts = opts || {};
    const sim = opts.sim || defaultSim;
    if (circuit) load(sim, circuit);   // fail early if the model is missing
    const r3 = v => Math.round(v * 1000) / 1000, r1 = v => Math.round(v * 10) / 10;
    function surrogateSim(pc, trackId, conditions) {
      trackId = trackId || circuit || "silverstone";
      if (conditions && (conditions.wet || conditions.wind_ms)) {
        if (opts.fallback) return opts.fallback(pc, trackId, conditions);
        throw new Error("surrogate sim: trained dry, still air only");
      }
      if (opts.relativeTo) pc = relativeCar(pc, opts.relativeTo, load(sim, trackId).json.centre_car);
      const p = predict(pc, trackId, { sim });
      if (!p.ok) {
        if (opts.fallback) { const r = opts.fallback(pc, trackId, conditions); return Object.assign({}, r, { surrogate: { fallback: true, out_of_box: p.out_of_box } }); }
        throw new Error("surrogate sim: " + p.label);
      }
      return {
        lap_s: r3(p.lap_s), sectors_s: (p.sectors_s || []).map(r3), vmax_kmh: r1(p.vmax_kmh != null ? p.vmax_kmh : p.speed_trap_kmh), speed_trap_kmh: r1(p.speed_trap_kmh), vmin_kmh: r1(p.vmin_kmh),
        energy: { deployed_mj: p.deployed_mj != null ? r3(p.deployed_mj) : 0, harvested_mj: p.harvested_mj != null ? r3(p.harvested_mj) : 0 },
        label: p.label, surrogate: { sim, distance: p.distance, apex_kmh: p.apex_kmh || null, speeds_kmh: p.speeds_kmh || null },
      };
    }
    return surrogateSim;
  }

  // ---- µs per call (median of `reps` batches of `calls`)
  function timing(circuit, sim, calls, reps) {
    calls = calls || 20000; reps = reps || 5;
    const P = load(sim, circuit), pc = JSON.parse(JSON.stringify(P.json.centre_car));
    const run = fn => { const t = []; for (let r = 0; r < reps; r++) { const t0 = process.hrtime.bigint(); let acc = 0; for (let i = 0; i < calls; i++) { pc.mass_kg = 770 + (i & 7) * 0.5; acc += fn(); } const dt = Number(process.hrtime.bigint() - t0) / 1e3 / calls; if (!isFinite(acc)) throw new Error("timing: non-finite"); t.push(dt); } t.sort((a, b) => a - b); return t[reps >> 1]; };
    for (let i = 0; i < 2000; i++) { predictLap(pc, circuit, sim); predict(pc, circuit, { sim }); }   // warm-up
    for (let i = 0; i < 2000; i++) predictLap(pc, circuit, sim, "quadratic");
    const out = { lap_only_us: run(() => predictLap(pc, circuit, sim)), lap_quadratic_us: run(() => predictLap(pc, circuit, sim, "quadratic")), full_us: run(() => predict(pc, circuit, { sim }).lap_s), full_quadratic_us: run(() => predict(pc, circuit, { sim, model: "quadratic" }).lap_s), models: {} };
    for (const t of P.targets) out.models[t] = P.t[t].model;
    return out;
  }

  const api = { FORMAT, NQ, relativeCar, load, register, available, setDefaultSim, predict, predictLap, predictWithUncertainty, asSim, inBox, timing, quadBasis, sqDist, rbfSum, mlpForward, dot, boxDistance: (pc, circuit, sim) => { const P = load(sim, circuit); return boxDistance(P, F.rawVector(pc, P.x)); }, xorshift, gaussFrom };
  C.surrogate = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
