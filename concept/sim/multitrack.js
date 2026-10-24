// PURPLE concept - multi-track calibration of the SAME physical cars (docs/concept/SIM.md "Multi-track").
// The 11 team cars (and so the RB22) keep every physical number of their 2026 British GP fit (fit.js / fitted.js: the baseline
// estimate, each team's CLA / CDA scale, each PU maker's ICE scale, the measured gearing, mass and roll split). Per circuit only
// what really changes between circuits is fitted, from that circuit's real 2026 qualifying:
//   - one track grip factor shared by every team (surface and temperature beyond the sim's tyre-temperature estimate), and
//   - each team's wing level (setup.js: rear-wing degrees from its Silverstone level, along the aero map's trade-off curve),
// by MAP (Levenberg-Marquardt) on each team's lap time (sigma 0.10 s) and that driver's session-maximum speed trap (2.5 km/h),
// with priors wing ~ N(0, 6 deg) and log grip ~ N(0, 0.10), wing bounded to setup.WING_RANGE. No per-corner factor, no trace fit.
// Targets: each team's best valid qualifying lap (concept/data/telemetry/<circuit>/<circuit>-2026-q-index.json), except Red Bull,
// which is fitted on the driver the RB22 is calibrated on (HAD; LAW at Monza, where OpenF1 has him in the Red Bull and no HAD).
// Held out: every speed trace (track.compare, concept/track), corner minima, sector times, the i1 / i2 intermediate speed traps,
// the teammates' laps. Laps with an audit FAIL (telemetry/audit/telemetry_audit.csv) are not scored on their speed channel.
// Node only for the fit (it reads the telemetry); teamCarAt / setupFor work in the browser from fitted-tracks.js.
(function () {
  const root = typeof window !== "undefined" ? window : globalThis;
  const EI = (root.EI = root.EI || {});
  const S = EI.conceptSim && EI.conceptSim.simulateLap ? EI.conceptSim : require("./lapsim.js");
  const F = EI.conceptSimFit || require("./fit.js");
  const SU = EI.conceptSimSetup || require("./setup.js");

  const CIRCUITS = ["silverstone", "monza", "monaco", "spa", "hungaroring"];
  const FIT = { sigma: { lap_s: 0.10, trap_kmh: 2.5, wing_deg: 6, log_grip: 0.10, trap_bias_kmh: 15 }, iters: 25, lambda0: 1e-2, fd_wing: 0.5, fd_grip: 0.01 };
  // OpenF1 team names -> season ids (js/data/season2026.js)
  const TEAM_ID = { "Mercedes": "mercedes", "Ferrari": "ferrari", "McLaren": "mclaren", "Red Bull Racing": "redbull", "Racing Bulls": "racingbulls", "Alpine": "alpine", "Haas F1 Team": "haas", "Audi": "audi", "Williams": "williams", "Aston Martin": "astonmartin", "Cadillac": "cadillac" };
  // the driver the RB22 is calibrated on (the season's "our driver", owner decision): HAD, and the Red Bull driver OpenF1 lists
  // where HAD did not drive the Red Bull (Monza: LAW)
  const OUR_DRIVER = { default: "HAD", monza: "LAW" };
  function ourDriver(trackId) { return OUR_DRIVER[trackId] || OUR_DRIVER.default; }

  function telemetryDir(trackId) { const path = require("path"); return path.join(__dirname, "..", "data", "telemetry", trackId === "silverstone" ? "" : trackId); }
  function readIndex(trackId) {
    const fs = require("fs"), path = require("path");
    const f = path.join(telemetryDir(trackId), trackId + "-2026-q-index.json");
    return JSON.parse(fs.readFileSync(f, "utf8"));
  }
  function auditFails(trackId) {
    const fs = require("fs"), path = require("path"), f = path.join(__dirname, "..", "data", "telemetry", "audit", "telemetry_audit.csv");
    const lines = fs.readFileSync(f, "utf8").split("\n").filter(Boolean), head = lines[0].split(","), out = {};
    for (const ln of lines.slice(1)) { const c = ln.split(","), r = {}; head.forEach((h, i) => { r[h] = c[i]; }); if (r.circuit === trackId && r.session === "qualifying") out[r.driver] = { overall: r.overall, C3: r.C3, C4: r.C4 }; }
    return out;
  }
  // per team: the target driver, his best valid lap and his session-maximum trap
  function trackTargets(trackId) {
    const idx = readIndex(trackId), laps = idx.telemetry_laps, trap = idx.max_speed_trap_kmh_session || {};
    const ids = Array.from(new Set(laps.map(l => TEAM_ID[l.team]))).filter(Boolean);
    const se = F.teamTargets("silverstone");   // team order, PU maker, chassis (season2026)
    return se.map(t => {
      const mine = laps.filter(l => TEAM_ID[l.team] === t.team).sort((a, b) => a.lap_time_s - b.lap_time_s);
      if (!mine.length || ids.indexOf(t.team) < 0) return null;
      const pick = t.team === "redbull" ? (mine.find(l => l.code === ourDriver(trackId)) || mine[0]) : mine[0];
      const mate = mine.find(l => l.code !== pick.code) || null;
      return { team: t.team, name: t.name, pu: t.pu, driver: pick.code, q_s: pick.lap_time_s, trap_kmh: trap[pick.code], sector_s: pick.sector_s, file: pick.file, team_best: mine[0].code, teammate: mate ? { driver: mate.code, q_s: mate.lap_time_s, file: mate.file, sector_s: mate.sector_s } : null };
    }).filter(Boolean);
  }

  function solve(A, b) {
    const n = b.length, M = A.map((r, i) => r.concat([b[i]]));
    for (let k = 0; k < n; k++) {
      let p = k; for (let i = k + 1; i < n; i++) if (Math.abs(M[i][k]) > Math.abs(M[p][k])) p = i;
      [M[k], M[p]] = [M[p], M[k]];
      for (let i = k + 1; i < n; i++) { const f = M[i][k] / M[k][k]; for (let j = k; j <= n; j++) M[i][j] -= f * M[k][j]; }
    }
    const x = new Array(n).fill(0);
    for (let i = n - 1; i >= 0; i--) { let s = M[i][n]; for (let j = i + 1; j < n; j++) s -= M[i][j] * x[j]; x[i] = s / M[i][i]; }
    return x;
  }
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  // fitTrack(trackId) -> { grip, teams: [{ team, driver, wing_deg, q_real_s, q_sim_s, residual_lap_s, trap_real_kmh, trap_sim_kmh, residual_trap_kmh, at_bound }] }
  function fitTrack(trackId, opts) {
    opts = opts || {};
    // parameters: [log grip, wing_1..wing_nT, trap bias]. The trap bias is a nuisance shared by every team: the sim's systematic
    // trap error at this circuit (where the 2026 cars spend their energy at the end of a straight is a team policy the energy plan
    // only approximates, SIM.md §3.4); the wings then follow the teams' RELATIVE traps. It does not touch any car.
    const targets = opts.targets || trackTargets(trackId), sg = FIT.sigma, nT = targets.length, nP = nT + 2, iB = nT + 1;
    const base = {}; for (const t of targets) base[t.team] = F.teamCar(t.team);
    const WB = SU.WING_RANGE, lb = [Math.log(0.7)].concat(targets.map(() => WB[0]), [-40]), ub = [Math.log(1.3)].concat(targets.map(() => WB[1]), [40]);
    const sim = (i, x) => S.simulateLap(SU.setupCar(base[targets[i].team], { wing_deg: x[1 + i] }), trackId, undefined, { track_grip: Math.exp(x[0]) });
    const residuals = (x, sims) => {
      const r = [];
      targets.forEach((t, i) => r.push((sims[i].lap_s - t.q_s) / sg.lap_s, (sims[i].speed_trap_kmh - t.trap_kmh - x[iB]) / sg.trap_kmh));
      r.push(x[0] / sg.log_grip); for (let i = 0; i < nT; i++) r.push(x[1 + i] / sg.wing_deg); r.push(x[iB] / sg.trap_bias_kmh);
      return r;
    };
    const cost = r => r.reduce((p, v) => p + v * v, 0);
    let x = new Array(nP).fill(0);
    if (opts.x0) x = opts.x0.slice();
    let sims = targets.map((t, i) => sim(i, x)), r = residuals(x, sims), c = cost(r), lambda = FIT.lambda0, it = 0;
    for (; it < (opts.iters || FIT.iters); it++) {
      const J = r.map(() => new Array(nP).fill(0));
      const xg = x.slice(); xg[0] += FIT.fd_grip;
      targets.forEach((t, i) => {
        const sgp = sim(i, xg);
        J[2 * i][0] = (sgp.lap_s - sims[i].lap_s) / sg.lap_s / FIT.fd_grip; J[2 * i + 1][0] = (sgp.speed_trap_kmh - sims[i].speed_trap_kmh) / sg.trap_kmh / FIT.fd_grip;
        const xw = x.slice(), h = x[1 + i] + FIT.fd_wing > WB[1] ? -FIT.fd_wing : FIT.fd_wing; xw[1 + i] += h;
        const sw = sim(i, xw);
        J[2 * i][1 + i] = (sw.lap_s - sims[i].lap_s) / sg.lap_s / h; J[2 * i + 1][1 + i] = (sw.speed_trap_kmh - sims[i].speed_trap_kmh) / sg.trap_kmh / h;
      });
      targets.forEach((t, i) => { J[2 * i + 1][iB] = -1 / sg.trap_kmh; });
      J[2 * nT][0] = 1 / sg.log_grip; for (let i = 0; i < nT; i++) J[2 * nT + 1 + i][1 + i] = 1 / sg.wing_deg; J[3 * nT + 1][iB] = 1 / sg.trap_bias_kmh;
      const JtJ = Array.from({ length: nP }, () => new Array(nP).fill(0)), Jtr = new Array(nP).fill(0);
      for (let row = 0; row < r.length; row++) for (let a = 0; a < nP; a++) { const ja = J[row][a]; if (!ja) continue; Jtr[a] += ja * r[row]; for (let b = 0; b < nP; b++) JtJ[a][b] += ja * J[row][b]; }
      let accepted = false;
      for (let tries = 0; tries < 6 && !accepted; tries++) {
        const A = JtJ.map((row, a) => row.map((v, b) => (a === b ? v * (1 + lambda) + 1e-9 : v)));
        const d = solve(A, Jtr.map(v => -v)), nx = x.map((v, p) => clamp(v + d[p], lb[p], ub[p]));
        const nsims = targets.map((t, i) => sim(i, nx)), nr = residuals(nx, nsims), nc = cost(nr);
        if (nc < c) { x = nx; sims = nsims; r = nr; accepted = c - nc < 1e-4 ? "converged" : true; c = nc; lambda = Math.max(lambda / 3, 1e-6); }
        else lambda *= 4;
      }
      if (!accepted || accepted === "converged") break;
    }
    // store rounded values and re-simulate with exactly those (a stored car reproduces its stored lap)
    const grip = +Math.exp(x[0]).toFixed(5), wings = targets.map((t, i) => +x[1 + i].toFixed(3)), trapBias = +x[iB].toFixed(2), xr = [Math.log(grip)].concat(wings, [trapBias]);
    sims = targets.map((t, i) => sim(i, xr));
    return {
      circuit: trackId, grip, trap_bias_kmh: trapBias, iterations: it, cost: +c.toFixed(3), settings: FIT,
      teams: targets.map((t, i) => ({
        team: t.team, name: t.name, driver: t.driver, team_best_driver: t.team_best, wing_deg: wings[i],
        q_real_s: t.q_s, q_sim_s: sims[i].lap_s, residual_lap_s: +(sims[i].lap_s - t.q_s).toFixed(3),
        trap_real_kmh: t.trap_kmh, trap_sim_kmh: sims[i].speed_trap_kmh, residual_trap_kmh: +(sims[i].speed_trap_kmh - t.trap_kmh).toFixed(1), residual_trap_rel_kmh: +(sims[i].speed_trap_kmh - t.trap_kmh - trapBias).toFixed(1),
        at_bound: Math.abs(wings[i] - WB[0]) < 1e-6 || Math.abs(wings[i] - WB[1]) < 1e-6,
      })),
    };
  }

  function fittedTracks() { return SU.fittedTracks(); }
  // a team's car at a circuit: its Silverstone-fitted physics with its fitted set-up there (the track grip is applied by simulateLap)
  function teamCarAt(teamId, trackId, fitT) {
    const car = F.teamCar(teamId);
    if (trackId === "silverstone") return car;
    const T = (fitT || fittedTracks() || {}).tracks || {}, row = T[trackId] && T[trackId].teams.find(x => x.team === teamId);
    const c = SU.setupCar(car, { wing_deg: row ? row.wing_deg : 0 });
    c.id = car.id + "@" + trackId; c.label = car.label + "; " + trackId + " set-up: wing " + (row ? row.wing_deg : 0) + " deg (multi-track fit)";
    return c;
  }
  // the lap-time-optimal wing level of a car at a circuit (golden section over setup.WING_RANGE, 18 evaluations: deterministic)
  function optimalWing(car, trackId, conditions, opts) {
    const f = w => S.simulateLap(SU.setupCar(car, { wing_deg: w }), trackId, conditions, opts).lap_s;
    let a = SU.WING_RANGE[0], b = SU.WING_RANGE[1]; const g = (Math.sqrt(5) - 1) / 2;
    let c = b - g * (b - a), d = a + g * (b - a), fc = f(c), fd = f(d);
    for (let k = 0; k < 16; k++) { if (fc < fd) { b = d; d = c; fd = fc; c = b - g * (b - a); fc = f(c); } else { a = c; c = d; fc = fd; d = a + g * (b - a); fd = f(d); } }
    const w = +(fc < fd ? c : d).toFixed(2);
    return { wing_deg: w, lap_s: Math.min(fc, fd) };
  }

  // held-out check of a circuit fit (Node): each fitted team car against (a) its fitted driver's lap and (b) the teammate's lap,
  // scored on what the fit never saw: the speed trace (track.compare on the track model, vs that driver), corner minima, sectors,
  // the intermediate traps i1 / i2. Audit-FAIL laps are not scored on speed.
  function heldOutTrack(fitT, trackId) {
    const fs = require("fs"), path = require("path"), TM = require("../track/track.js"), tr = require("./track.js").buildTrack(trackId);
    const fails = auditFails(trackId), basis = "driver:" + tr.reference.reference.driver, dir = telemetryDir(trackId), rows = [];
    const targets = trackTargets(trackId);
    for (const t of targets) {
      const fr = fitT.teams.find(x => x.team === t.team); if (!fr) continue;
      const car = SU.setupCar(F.teamCar(t.team), { wing_deg: fr.wing_deg }), r = S.simulateLap(car, trackId, undefined, { trace: true, track_grip: fitT.grip });
      const one = (code, file) => {
        const lap = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8")).lap, fail = fails[code] && fails[code].overall === "FAIL";
        const o = { driver: code, lap_real_s: lap.lap_time_s, lap_sim_s: r.lap_s, sector_delta_s: r.sectors_s.map((v, i) => +(v - lap.sector_s[i]).toFixed(3)), i1_delta_kmh: lap.i1_speed_kmh != null ? +(r.speeds_kmh.intermediate_1 - lap.i1_speed_kmh).toFixed(1) : null, i2_delta_kmh: lap.i2_speed_kmh != null ? +(r.speeds_kmh.intermediate_2 - lap.i2_speed_kmh).toFixed(1) : null, audit_fail: !!fail };
        if (!fail) {
          const c = TM.compare({ s_m: r.trace.s_m, v_kmh: r.trace.v_kmh }, trackId, { basis, driver: code });
          Object.assign(o, { rms_kmh: c.vs_driver.rms_kmh, mean_kmh: c.vs_driver.mean_kmh, corner_rms_kmh: c.vs_driver.corner_rms_kmh, corners: c.corners.map(k => ({ id: k.id, name: k.name, delta_kmh: k.delta_driver_kmh })) });
        }
        return o;
      };
      rows.push({ team: t.team, fitted: one(t.driver, t.file), teammate: t.teammate ? one(t.teammate.driver, t.teammate.file) : null });
    }
    const scored = rows.map(r => r.fitted).filter(o => o.rms_kmh != null), all = rows.map(r => r.fitted);
    const mean = a => (a.length ? a.reduce((p, v) => p + v, 0) / a.length : null), rms = a => (a.length ? Math.sqrt(a.reduce((p, v) => p + v * v, 0) / a.length) : null), r2 = v => (v == null ? null : +v.toFixed(2)), r3 = v => (v == null ? null : +v.toFixed(3));
    const iv = all.flatMap(o => [o.i1_delta_kmh, o.i2_delta_kmh]).filter(v => v != null);
    return {
      basis, rows,
      summary: {
        laps_scored: scored.length, excluded_audit_fail: all.filter(o => o.audit_fail).map(o => o.driver),
        speed_rms_kmh: r2(mean(scored.map(o => o.rms_kmh))), speed_rms_range_kmh: scored.length ? [r2(Math.min(...scored.map(o => o.rms_kmh))), r2(Math.max(...scored.map(o => o.rms_kmh)))] : null,
        corner_rms_kmh: r2(mean(scored.map(o => o.corner_rms_kmh))), sector_bias_s: [0, 1, 2].map(k => r3(mean(all.map(o => o.sector_delta_s[k])))),
        intermediate_rms_kmh: r2(rms(iv)), intermediate_bias_kmh: r2(mean(iv)),
        teammate_lap_rms_s: r3(rms(rows.filter(r => r.teammate).map(r => r.teammate.lap_sim_s - r.teammate.lap_real_s))),
      },
    };
  }

  const api = { CIRCUITS, FIT, TEAM_ID, OUR_DRIVER, ourDriver, trackTargets, fitTrack, heldOutTrack, teamCarAt, optimalWing, auditFails, readIndex };
  EI.conceptSimMulti = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
