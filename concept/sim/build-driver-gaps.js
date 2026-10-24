#!/usr/bin/env node
// PURPLE concept - writes concept/data/driver-gaps-2026.json: every driver's best valid 2026 qualifying lap at the five sim circuits
// and the gap to his teammate (real data: concept/data/telemetry/*/<circuit>-2026-q-index.json and the lap files; OpenF1, checked
// against the official classification in each folder's README; Silverstone lap times from js/data/racepace2026.js, the official
// times, where the telemetry file differs). Deterministic, no network. Usage: node concept/sim/build-driver-gaps.js
"use strict";
const fs = require("fs"), path = require("path");
const MT = require("./multitrack.js"), T = require("./track.js");
const ROOT = path.join(__dirname, "..", "data"), OUT = path.join(ROOT, "driver-gaps-2026.json");
const rp = T.loadGameData("racepace2026").RACEPACE;
const EVENT = { silverstone: "British Grand Prix", monza: "Italian Grand Prix", monaco: "Monaco Grand Prix", spa: "Belgian Grand Prix", hungaroring: "Hungarian Grand Prix" };
const r3 = v => Math.round(v * 1000) / 1000;
const circuits = {};
for (const id of MT.CIRCUITS) {
  const idx = MT.readIndex(id), dir = path.join(ROOT, "telemetry", id === "silverstone" ? "" : id), fails = MT.auditFails(id);
  const trap = idx.max_speed_trap_kmh_session || {};
  const drivers = {};
  for (const l of idx.telemetry_laps) {
    const f = JSON.parse(fs.readFileSync(path.join(dir, l.file), "utf8")).lap;
    let lap = l.lap_time_s, note = null;
    if (id === "silverstone" && rp.silverstone.q[l.code] != null && Math.abs(rp.silverstone.q[l.code] - lap) > 0.0005) { note = "official " + rp.silverstone.q[l.code] + " s used; the telemetry file's lap reads " + lap + " s (audit C1)"; lap = rp.silverstone.q[l.code]; }
    drivers[l.code] = { team: l.team, team_id: MT.TEAM_ID[l.team], lap_s: lap, lap_number: f.lap_number, sector_s: f.sector_s, trap_session_max_kmh: trap[l.code] != null ? trap[l.code] : null, audit: fails[l.code] ? fails[l.code].overall : null };
    if (note) drivers[l.code].note = note;
  }
  const codes = Object.keys(drivers).sort((a, b) => drivers[a].lap_s - drivers[b].lap_s || (a < b ? -1 : 1)), pole = codes[0];
  for (const c of codes) drivers[c].gap_to_pole_s = r3(drivers[c].lap_s - drivers[pole].lap_s);
  const teams = {};
  for (const c of codes) { const t = drivers[c].team_id; (teams[t] = teams[t] || { drivers: [] }).drivers.push({ code: c, lap_s: drivers[c].lap_s }); }
  for (const t of Object.values(teams)) {
    if (t.drivers.length === 2) { t.faster = t.drivers[0].code; t.gap_s = r3(t.drivers[1].lap_s - t.drivers[0].lap_s); for (const d of t.drivers) drivers[d.code].gap_to_teammate_s = r3(d.lap_s - t.drivers.find(x => x.code !== d.code).lap_s); }
  }
  const sorted = {}; for (const c of codes) sorted[c] = drivers[c];
  const our = MT.ourDriver(id), rb = teams.redbull;
  circuits[id] = {
    event: "2026 " + EVENT[id] + " qualifying", session_key: idx.session_key, pole: { driver: pole, lap_s: drivers[pole].lap_s },
    drivers: sorted, teams,
    redbull: { drivers: rb.drivers.map(d => d.code), our_driver: our, our_lap_s: drivers[our].lap_s, VER_lap_s: drivers.VER ? drivers.VER.lap_s : null, VER_minus_our_s: drivers.VER ? r3(drivers.VER.lap_s - drivers[our].lap_s) : null, note: id === "monza" ? "OpenF1 (and the formula1.com classification) list LAW at Red Bull Racing and TSU at Racing Bulls for this session, no HAD: LAW is the Red Bull driver the RB22 stands for here" : null },
  };
}
// per driver, across circuits: gap to the teammate of that weekend (who it was is listed)
const byDriver = {};
for (const id of MT.CIRCUITS) for (const [c, d] of Object.entries(circuits[id].drivers)) {
  const mate = circuits[id].teams[d.team_id].drivers.find(x => x.code !== c);
  (byDriver[c] = byDriver[c] || { circuits: {} }).circuits[id] = { team_id: d.team_id, lap_s: d.lap_s, teammate: mate ? mate.code : null, gap_to_teammate_s: d.gap_to_teammate_s != null ? d.gap_to_teammate_s : null, gap_to_pole_s: d.gap_to_pole_s };
}
for (const v of Object.values(byDriver)) { const g = Object.values(v.circuits).map(x => x.gap_to_teammate_s).filter(x => x != null); v.mean_gap_to_teammate_s = g.length ? r3(g.reduce((p, x) => p + x, 0) / g.length) : null; const q = g.slice().sort((a, b) => a - b), h = q.length >> 1; v.median_gap_to_teammate_s = q.length ? r3(q.length % 2 ? q[h] : 0.5 * (q[h - 1] + q[h])) : null; v.n = g.length; }
const sortedBy = {}; for (const k of Object.keys(byDriver).sort()) sortedBy[k] = byDriver[k];
const DATA = {
  schema: "purple.driver-gaps/1",
  what: "Every driver's best valid qualifying lap at the five sim circuits of the 2026 season (silverstone, monza, monaco, spa, hungaroring) and his gap to the teammate of that weekend. Real data, nothing simulated.",
  sources: ["OpenF1 (api.openf1.org/v1) via concept/data/telemetry/<circuit>/<circuit>-2026-q-index.json and the lap files (best valid lap: lap times deleted by race control and pit-out laps excluded); each folder's README cross-checks all 22 times against the formula1.com classification", "Silverstone lap times: js/data/racepace2026.js (official); PER's telemetry file differs by 0.489 s (audit C1), the official time is used", "Audit status per lap: concept/data/telemetry/audit/telemetry_audit.csv (a FAIL concerns a telemetry channel, never the lap time here)"],
  attribution: "Telemetry from OpenF1 (openf1.org), an independent community project not associated with Formula 1, the FIA or FOM; timing data belongs to Formula 1. Non-commercial research use.",
  our_driver: {
    default: "HAD", by_circuit: { monza: "LAW" },
    definition: "Owner decision: the season's 'our driver' is the Red Bull driver the RB22 is calibrated on (HAD, whose 2026 British GP lap the Red Bull car was fitted to; at every circuit the Red Bull car's set-up is fitted to that driver's lap). At Monza OpenF1 has LAW in the Red Bull and no HAD, so LAW stands in there. Default: NO driver-gap adjustment, i.e. our lap = the sim lap of our RB22 (concept/sim simulateLap of the design's car with the Red Bull set-up at that circuit).",
    optional_adjustment: "'Our car driven like driver X' at circuit C = sim lap of our RB22 at C + (X's real best lap at C - our driver's real best lap at C), i.e. circuits[C].drivers[X].lap_s - circuits[C].redbull.our_lap_s. For X = VER that is circuits[C].redbull.VER_minus_our_s (negative = VER was faster). It folds car differences in when X drove another car; use it only for Red Bull drivers (VER, HAD, LAW) or as a what-if.",
  },
  circuits, by_driver: sortedBy,
};
fs.writeFileSync(OUT, JSON.stringify(DATA, null, 1) + "\n");
console.log("wrote concept/data/driver-gaps-2026.json");
for (const id of MT.CIRCUITS) { const r = circuits[id].redbull; console.log(id.padEnd(12), "pole", circuits[id].pole.driver, circuits[id].pole.lap_s, "RB", r.drivers.join("/"), "our", r.our_driver, r.our_lap_s, "VER", r.VER_lap_s, "VER-our", r.VER_minus_our_s); }
