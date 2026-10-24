// PURPLE CONCEPT CAMPAIGN (docs/concept/CAMPAIGN.md): a short campaign is deterministic per seed for any worker count, every
// kept candidate and the best car are FIA-legal with the homologated PU and permitted materials, and every final number is a
// physics lap sim lap (a deliberately wrong surrogate cannot change it).
const test = require("node:test");
const assert = require("node:assert/strict");
const run = require("../concept/campaign/run.js"), space = require("../concept/campaign/space.js"), { CMA, eigSym } = require("../concept/campaign/cmaes.js");
const U = require("../concept/campaign/uncertainty.js"), plot = require("../concept/campaign/plot.js");
const bench = require("../concept/bench.js"), design = require("../concept/design.js"), regs = require("../concept/regs.js"), phys = require("../concept/physical.js"), sim = require("../concept/sim/index.js");

const SHORT = { seeds: [3], evals: 40, lambda: 8, prescreen: 3, patience: 4, refine_evals: 60, combo_evals: 0, baselines: ["redbull"], no_sensitivity: true };
let cache = {};
async function campaign(extra) { const k = JSON.stringify(extra); if (!cache[k]) cache[k] = await run.runCampaign(Object.assign({}, SHORT, extra)); return cache[k]; }
const strip = r => JSON.parse(JSON.stringify(r, (k, v) => (k === "runtime_s" || k === "machine" || k === "opts" ? undefined : v)));

test("space: the box is the catalogue domain tightened by the single-number FIA limits; encode/decode round-trips the baseline", () => {
  const v = k => space.VARS.find(x => x.key === k);
  assert.equal(space.N, 23);
  assert.equal(v("floor.width_mm").hi, regs.BY_ID["REG-C-FLOOR-WIDTH"].value);
  assert.equal(v("layout.wheelbase_mm").hi, 3400); assert.deepEqual([v("survival_cell.cockpit_len_mm").lo, v("survival_cell.cockpit_len_mm").hi], [1830, 2030]);
  assert.equal(v("rear_wing.chord_mm").hi, 465); assert.equal(v("front_wing.elements").hi, 3);
  for (const b of [design.baseline("redbull"), design.baseline()]) assert.deepEqual(space.decode(space.encode(b), b).params, b.params);
  assert.ok(space.penalty([{ id: "X", value: 1600, limit: 1540 }]) > space.ILLEGAL);
});

test("CMA-ES: seeded and deterministic, and it minimises a rotated ellipsoid", () => {
  const e = eigSym([[2, 1], [1, 2]]); assert.ok(Math.abs(Math.max(...e.values) - 3) < 1e-9 && Math.abs(Math.min(...e.values) - 1) < 1e-9);
  const f = x => x.reduce((s, v, i) => s + Math.pow(10, i / 2) * Math.pow(v - 0.3 + 0.1 * (x[(i + 1) % x.length] - 0.3), 2), 0);
  const go = () => { const c = CMA({ x0: [0.8, 0.8, 0.8, 0.8, 0.8], sigma0: 0.3, lambda: 10, rng: design.seededRng(5) }); let b = Infinity; for (let g = 0; g < 150; g++) { const xs = c.ask(), fs = xs.map(f); c.tell(xs, fs); b = Math.min(b, ...fs); } return b; };
  const a = go(); assert.equal(a, go()); assert.ok(a < 1e-6, "converged: " + a);
});

test("uncertainty: built from the sim's held-out sector errors and fit residuals; verdicts are inside / outside the 95 % band", () => {
  const tr = U.transferError("redbull"); assert.ok(tr.k > 0.05 && tr.k < 0.6 && tr.n === 27);
  const bias = U.sectorBias(); assert.ok(bias.mean_s[1] > 0.4 && bias.mean_s[0] < 0 && bias.mean_s[2] < 0);
  const b = U.band({ lap_s: 87.9, sectors_s: [27.9, 36.2, 23.8] }, { lap_s: 88.749, sectors_s: [28.158, 36.522, 24.07] }, "redbull");
  assert.ok(b.sigma_s > U.NOISE_S && b.band95_s[0] < 87.9 && b.band95_s[1] > 87.9);
  const A = U.anchorRecord("redbull");
  assert.equal(b.components.surrogate_s, 0); assert.equal(b.anchor.residual_s, +(A.lap_sim_s - A.lap_real_s).toFixed(3)); assert.equal(A.lap_real_s, 88.746);
  assert.equal(U.verdict({ lap_s: 87, band95_s: [86.8, 87.2] }, 88.111).inside, false);
  assert.equal(U.verdict({ lap_s: 88, band95_s: [87.8, 88.2] }, 88.111).inside, true);
  assert.equal(U.anchorRecord(null).driver, "ANT");
});

test("campaign: deterministic per seed, for 0 and 2 worker threads", async () => {
  const a = await campaign({ workers: 0 }), b = await campaign({ workers: 2 });
  const ra = a.results.redbull, rb = b.results.redbull;
  assert.deepEqual(ra.best.design.params, rb.best.design.params);
  assert.deepEqual(strip(ra.trace), strip(rb.trace));
  assert.deepEqual(strip(ra), strip(rb));
  assert.ok(ra.best.lap_s < ra.baseline.lap_s, "the short campaign improves on the baseline");
  assert.ok(ra.seeds[0].surrogate_screened >= ra.seeds[0].physics_laps * 2);
});

test("campaign: every kept candidate and the best car are legal (FIA rules + PU + materials), and the PU is the DM01, unchanged", async () => {
  const r = (await campaign({ workers: 0 })).results.redbull;
  assert.ok(r.kept.length >= 1);
  for (const k of r.kept) {
    const d = Object.assign(design.baseline("redbull"), { params: k.design.params });
    const f = design.facts(d);
    assert.deepEqual(regs.check(d), [], "kept " + k.seed + "/" + k.evals);
    assert.deepEqual(bench.checkPU(phys.physical(d), d, f.mass), []); assert.deepEqual(bench.checkMaterials(d), []);
  }
  assert.equal(r.legality.filter(x => x.status === "FAIL").length, 0);
  for (const rule of regs.RULES.concat(regs.MODEL_RULES)) assert.ok(r.legality.some(x => x.id === rule.id && x.article === rule.article), rule.id);
  assert.ok(r.legality.some(x => x.id === "PU-HOMOLOGATED" && x.status === "pass"));
  assert.equal(r.pu.name, "Red Bull Ford DM01"); assert.equal(r.pu.identical, true); assert.equal(r.pu.guard_violations, 0);
  for (const x of r.pu.fields) assert.equal(x.same, true, x.field);
  assert.deepEqual(r.energy_check, []);
});

test("campaign: final numbers are physics lap sim laps, never the surrogate's (a wrong surrogate only changes the search)", async () => {
  const good = (await campaign({ workers: 0 })).results.redbull;
  const wrong = (await campaign({ workers: 0, surrogate: () => 50 })).results.redbull;
  for (const r of [good, wrong]) {
    const d = Object.assign(design.baseline("redbull"), { params: r.best.design.params });
    const lap = sim.simulateLap(bench.guardEnergy(phys.physical(d)), "silverstone", r.conditions);
    assert.equal(r.best.lap_s, lap.lap_s); assert.deepEqual(r.best.sectors_s, lap.sectors_s); assert.equal(r.best.direct_sim_lap_s, lap.lap_s);
    assert.equal(r.sim_label, sim.LABEL); assert.match(r.best.source, /physics lap sim/);
    assert.equal(r.best.delta_to_pole_s, +(lap.lap_s - 88.111).toFixed(3)); assert.equal(r.best.delta_to_had_s, +(lap.lap_s - 88.746).toFixed(3));
    assert.equal(r.baseline.lap_s, sim.simulateLap(bench.guardEnergy(phys.physical(design.baseline("redbull"))), "silverstone", r.conditions).lap_s);
  }
  assert.ok(Math.abs(wrong.best.lap_s - 50) > 30);
  const md = run.summaryMarkdown(await campaign({ workers: 0 }));
  assert.match(md, /physics lap sim/); assert.doesNotMatch(md, /\b(CFD|wind tunnel|validated)\b/i);
  const svg = plot.convergenceSvg(await campaign({ workers: 0 }));
  assert.match(svg, /^<svg/); assert.match(svg, /88\.111/);
});

test("campaign CLI: options parsed and validated; never writes into data/", () => {
  const a = run.parseArgs(["--seeds", "1,2", "--evals", "100", "--baselines", "generic,redbull", "--strategy", "threshold"]);
  assert.deepEqual(a.seeds, [1, 2]); assert.equal(a.evals, 100); assert.deepEqual(a.baselines, ["generic", "redbull"]);
  assert.throws(() => run.parseArgs(["--baselines", "ferrari"]), /baselines/);
  assert.throws(() => run.parseArgs(["--strategy", "boost"]), /strategy/);
  assert.throws(() => require("../concept/cli.js").assertSafeOut(require("path").join(__dirname, "..", "data", "x")), /refusing/);
});
