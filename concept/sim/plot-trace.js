#!/usr/bin/env node
// PURPLE concept - writes an SVG overlay of the sim's speed trace against a real 2026 British GP qualifying lap.
// Usage: node concept/sim/plot-trace.js [telemetry-dir] [driver-code ...]   -> docs/concept/sim-trace-<code>.svg
// The pole lap (ANT) is the lap the baseline parameters were estimated on; every other driver is a held-out lap.
"use strict";
const fs = require("fs"), path = require("path");
const sim = require("./index.js");

const args = process.argv.slice(2);
const dir = args[0] && !/^[A-Z]{3}$/.test(args[0]) ? args.shift() : path.join(__dirname, "..", "data", "telemetry");
const codes = args.length ? args : ["ANT", "HAD"];
const fit = sim.fitted(), tr = sim.buildTrack("silverstone");
const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");

for (const code of codes) {
  const team = fit.teams.find(t => t.driver === code);
  const lap = JSON.parse(fs.readFileSync(path.join(dir, "silverstone-2026-q-" + code.toLowerCase() + ".json"), "utf8"));
  const ch = lap.channels, L = ch.distance_m[ch.distance_m.length - 1];
  const car = team ? sim.teamCar(team.team) : sim.baselineCar();
  const r = sim.simulateLap(car, "silverstone", undefined, { trace: true });
  const simAt = d => r.trace.v_kmh[Math.min(r.trace.v_kmh.length - 1, Math.round(((d / L) * tr.L) / tr.ds))];
  let e2 = 0; ch.distance_m.forEach((d, k) => { e2 += (simAt(d) - ch.speed_kmh[k]) ** 2; });
  const rms = Math.sqrt(e2 / ch.distance_m.length);
  const W = 1100, H = 440, m = { l: 56, r: 24, t: 76, b: 56 }, pw = W - m.l - m.r, ph = H - m.t - m.b;
  const X = d => m.l + (d / L) * pw, Y = v => m.t + ph - ((v - 50) / 300) * ph;
  const pathOf = (ds, vs) => ds.map((d, k) => (k ? "L" : "M") + X(d).toFixed(1) + " " + Y(vs[k]).toFixed(1)).join(" ");
  const real = pathOf(ch.distance_m, ch.speed_kmh), simP = pathOf(ch.distance_m, ch.distance_m.map(simAt));
  const grid = [100, 150, 200, 250, 300, 350].map(v => `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(v)}" y2="${Y(v)}" class="grid"/><text x="${m.l - 8}" y="${Y(v) + 4}" class="tick" text-anchor="end">${v}</text>`).join("");
  const xt = [0, 1000, 2000, 3000, 4000, 5000].map(d => `<text x="${X(d)}" y="${H - m.b + 18}" class="tick" text-anchor="middle">${d}</text>`).join("");
  const corners = (tr.corners || []).map(k => `<text x="${X((k.d / tr.L) * L)}" y="${m.t - 6}" class="corner" text-anchor="middle">T${k.n}</text>`).join("");
  const sectors = tr.timing.sectors.map(s => `<line x1="${X((s / tr.L) * L)}" x2="${X((s / tr.L) * L)}" y1="${m.t}" y2="${m.t + ph}" class="sector"/>`).join("");
  const role = code === fit.reference_driver ? "fit lap (baseline parameters estimated on this trace)" : "HELD-OUT lap (only its lap time and trap entered the team fit)";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Speed trace, sim against ${esc(code)} real lap">
<style>
  .bg{fill:#fcfcfb} .grid{stroke:#e4e3df;stroke-width:1} .sector{stroke:#c3c2b7;stroke-width:1;stroke-dasharray:4 4}
  .tick{font:12px system-ui,sans-serif;fill:#52514e} .corner{font:11px system-ui,sans-serif;fill:#52514e}
  .title{font:600 15px system-ui,sans-serif;fill:#0b0b0b} .sub{font:12px system-ui,sans-serif;fill:#52514e}
  .real{fill:none;stroke:#2a78d6;stroke-width:2} .sim{fill:none;stroke:#eb6834;stroke-width:2} .lab{font:600 12px system-ui,sans-serif;fill:#0b0b0b}
  @media (prefers-color-scheme: dark){ .bg{fill:#1a1a19} .grid{stroke:#33332f} .sector{stroke:#55544f} .tick,.corner,.sub{fill:#c3c2b7} .title,.lab{fill:#f0efec} .real{stroke:#3987e5} .sim{stroke:#d95926} }
</style>
<rect class="bg" width="${W}" height="${H}"/>
<text x="${m.l}" y="22" class="title">Silverstone qualifying, speed (km/h): ${esc(lap.driver.code)} (${esc(lap.driver.team || "")}) real vs ${esc(car.id)} sim</text>
<text x="${m.l}" y="40" class="sub">${esc(role)} · real ${lap.lap.lap_time_s.toFixed(3)} s · sim ${r.lap_s.toFixed(3)} s · speed RMS ${rms.toFixed(1)} km/h</text>
<text x="${m.l}" y="56" class="sub">${esc(sim.LABEL)}</text>
${grid}${xt}${sectors}${corners}
<path d="${real}" class="real"/><path d="${simP}" class="sim"/>
<line x1="${W - 250}" x2="${W - 226}" y1="${H - 16}" y2="${H - 16}" class="real"/><text x="${W - 220}" y="${H - 12}" class="lab">real (OpenF1)</text>
<line x1="${W - 120}" x2="${W - 96}" y1="${H - 16}" y2="${H - 16}" class="sim"/><text x="${W - 90}" y="${H - 12}" class="lab">sim</text>
<text x="${m.l}" y="${H - 12}" class="sub">distance from the control line (m) · km/h · dashed = sector lines · telemetry: OpenF1 (non-commercial research use)</text>
</svg>
`;
  const out = path.join(__dirname, "..", "..", "docs", "concept", "sim-trace-" + code.toLowerCase() + ".svg");
  fs.writeFileSync(out, svg);
  console.log("wrote", path.relative(process.cwd(), out), "rms", rms.toFixed(2), "sim", r.lap_s, "real", lap.lap.lap_time_s);
}
