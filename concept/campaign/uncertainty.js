// PURPLE CONCEPT CAMPAIGN - the uncertainty band on a campaign lap, built only from the physics lap sim's OWN measured errors
// (docs/concept/SIM.md §6, concept/sim/fitted.js): nothing here is a new estimate.
//
//   (a) transfer error of a lap-time CHANGE. The sim's sector times are held out on 10 team laps (only lap time and trap entered
//       the fit). For every held-out team t and sector i, the sim's predicted difference to the anchor team A,
//       Δsim = sim_t,i − sim_A,i, is compared with the real one, Δreal = real_t,i − real_A,i. k = √(Σ(Δsim − Δreal)² / ΣΔsim²) is
//       the sim's relative error on a sector-time difference between two cars. A design that changes sector i by g_i (sim) carries
//       σ_i = k·|g_i|; the three sectors are added in quadrature (the lap change itself is never held out, so the sector errors
//       are not forced to cancel).
//   (b) lap-level fit error: the RMS of the 11 team-car lap residuals (fit, not held out).
//   (c) the sim's own numerical noise on nearby designs: ±0.005 s (SIM.md §3, the energy strategy's discrete φ search).
//   (d) surrogate: 0. No final number comes from the surrogate; every one is a physics sim lap (its disagreement is reported).
//   σ = √(a² + b² + c²); the band is ±1.96 σ (≈ 95 % if the errors were normal).
// Known BIAS, reported beside the band (not inside it): the anchor's own fit residual (RB22: sim − real HAD lap; generic: sim −
// real ANT pole lap, the lap that car was estimated on) and the held-out mean sector residuals (−0.21 / +0.66 / −0.47 s: the sim
// is S2-slow and S1/S3-fast on every team's lap; bias-corrected sectors are reported with that correction).
// NOT covered (stated wherever the band is quoted): the concept aero map's relative coefficients (guesses, CONCEPT.md §5), the
// part masses (estimates), and everything the point-mass sim leaves out (SIM.md §7).
"use strict";
const sim = require("../sim/index.js");
const NOISE_S = 0.005;
const Z95 = 1.96;

function fitInfo() {
  const F = sim.fitted(); if (!F || !F.teams) throw new Error("concept campaign: the sim's fit (concept/sim/fitted.js) is not available");
  return F;
}
// the anchor's record in the fit: a team car, or the generic car estimated on the pole lap (calibration.fit_lap)
function anchorRecord(team) {
  const F = fitInfo();
  if (team) {
    const t = F.teams.find(x => x.team === team); if (!t) throw new Error("concept campaign: no fitted team " + team);
    return { id: team, driver: t.driver, lap_real_s: t.q_real_s, lap_sim_s: t.q_sim_s, sectors_real_s: t.heldout.sectors_real_s, sectors_sim_s: t.heldout.sectors_sim_s, basis: "team fit (lap + trap fitted, sectors held out)" };
  }
  const c = F.calibration.fit_lap;
  return { id: "generic", driver: c.driver, lap_real_s: c.lap_real_s, lap_sim_s: c.lap_sim_s, sectors_real_s: c.sectors_real_s, sectors_sim_s: c.sectors_sim_s, basis: "the 4-parameter estimate on the pole lap (" + c.driver + ")" };
}
// k: the sim's relative error on held-out sector differences between cars (see the header), against the given anchor
function transferError(team) {
  const F = fitInfo(), A = anchorRecord(team), ref = F.calibration.fit_lap.driver;
  let se = 0, sd = 0, n = 0; const pairs = [];
  for (const t of F.teams) {
    if (t.team === team || t.driver === ref) continue;   // not the anchor itself; not the estimation lap's driver (not held out)
    for (let i = 0; i < 3; i++) {
      const ds = t.heldout.sectors_sim_s[i] - A.sectors_sim_s[i], dr = t.heldout.sectors_real_s[i] - A.sectors_real_s[i];
      se += (ds - dr) * (ds - dr); sd += ds * ds; n++; pairs.push({ driver: t.driver, sector: i + 1, d_sim: +ds.toFixed(3), d_real: +dr.toFixed(3) });
    }
  }
  return { k: Math.sqrt(se / sd), rms_s: Math.sqrt(se / n), n, pairs };
}
function sectorBias() {
  const F = fitInfo(), ref = F.calibration.fit_lap.driver, rs = F.teams.filter(t => t.driver !== ref).map(t => t.heldout.sector_residuals_s);
  const mean = [0, 1, 2].map(i => rs.reduce((s, r) => s + r[i], 0) / rs.length);
  const sd = [0, 1, 2].map(i => Math.sqrt(rs.reduce((s, r) => s + (r[i] - mean[i]) ** 2, 0) / (rs.length - 1)));
  return { mean_s: mean.map(v => +v.toFixed(3)), sd_s: sd.map(v => +v.toFixed(3)), n: rs.length };
}
function fitResidualRms() { const T = fitInfo().teams; return Math.sqrt(T.reduce((s, t) => s + t.residual_lap_s * t.residual_lap_s, 0) / T.length); }

const r3 = v => Math.round(v * 1000) / 1000;
// band(best, baseline, team): best / baseline = { lap_s, sectors_s } from the physics sim (same conditions)
function band(best, baseline, team, extra) {
  const tr = transferError(team), g = best.sectors_s.map((s, i) => s - baseline.sectors_s[i]);
  const a = tr.k * Math.sqrt(g.reduce((s, v) => s + v * v, 0)), b = fitResidualRms(), c = NOISE_S;
  const sigma = Math.sqrt(a * a + b * b + c * c), A = anchorRecord(team), bias = sectorBias();
  const lo = best.lap_s - Z95 * sigma, hi = best.lap_s + Z95 * sigma;
  return {
    lap_s: best.lap_s, sigma_s: r3(sigma), band95_s: [r3(lo), r3(hi)], z: Z95,
    components: { transfer_s: r3(a), transfer_k: +tr.k.toFixed(3), sector_change_s: g.map(r3), fit_residual_rms_s: r3(b), sim_noise_s: c, surrogate_s: 0 },
    anchor: { id: A.id, driver: A.driver, lap_real_s: A.lap_real_s, lap_sim_s: A.lap_sim_s, residual_s: r3(A.lap_sim_s - A.lap_real_s), basis: A.basis,
      anchor_relative_lap_s: r3(A.lap_real_s + (best.lap_s - baseline.lap_s)), note: "the anchor's real lap plus the sim's change from the anchor car: removes the anchor's own fit residual" },
    sector_bias: Object.assign(bias, { corrected_sectors_s: best.sectors_s.map((s, i) => r3(s - bias.mean_s[i])) }),
    transfer_pairs: tr.n,
    not_covered: "the concept aero map's relative coefficients (guesses), part-mass estimates, and what the point-mass sim leaves out (SIM.md §7)",
    extra: extra || null,
  };
}
// where a lap sits against a target: "outside" when the whole 95 % band is on one side
function verdict(b, target_s) {
  const [lo, hi] = b.band95_s;
  if (hi < target_s) return { target_s, side: "faster", inside: false, text: "faster than " + target_s.toFixed(3) + " s and the whole 95 % band (" + lo.toFixed(3) + "–" + hi.toFixed(3) + " s) is below it: outside the model's uncertainty" };
  if (lo > target_s) return { target_s, side: "slower", inside: false, text: "slower than " + target_s.toFixed(3) + " s and the whole 95 % band (" + lo.toFixed(3) + "–" + hi.toFixed(3) + " s) is above it: outside the model's uncertainty" };
  return { target_s, side: b.lap_s < target_s ? "faster" : "slower", inside: true, text: (b.lap_s < target_s ? "faster" : "slower") + " than " + target_s.toFixed(3) + " s, but " + target_s.toFixed(3) + " s is inside the 95 % band (" + lo.toFixed(3) + "–" + hi.toFixed(3) + " s): not resolved by the model" };
}

module.exports = { band, verdict, transferError, sectorBias, fitResidualRms, anchorRecord, NOISE_S, Z95 };
