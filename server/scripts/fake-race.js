// PURPLE - node server/scripts/fake-race.js [--id <experiment id>] [--seed 7] [--factor 1.2] [--noise 0.02] [--port 8787]
// Posts a plausible F-04 race result for the newest ledger row (or --id) to a RUNNING server, so the UI lane can test the RACE card,
// the SSE `race` event and `agreement_pct` without the game. Measured Δ = predicted Δ × factor ± seeded noise. No Mubit call is made.
// Needs a planned experiment first: `MUBIT_MOCK=1 npm run dev` then `curl -X POST localhost:8787/api/plan` (or press Run in the lab page).
const args = process.argv.slice(2); const arg = (k, d) => { const i = args.indexOf("--" + k); return i >= 0 ? args[i + 1] : d; };
const port = parseInt(arg("port", process.env.PURPLE_PORT || "8787"), 10), base = "http://127.0.0.1:" + port;
const seed = parseInt(arg("seed", "7"), 10), factor = parseFloat(arg("factor", "1.2")), noise = parseFloat(arg("noise", "0.02"));
// mulberry32: tiny seeded PRNG so a given --seed always posts the same numbers
const rng = (s => () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; })(seed);
const jitter = amp => (rng() * 2 - 1) * amp;
const r3 = v => +v.toFixed(3), r1 = v => +v.toFixed(1);
async function api(path, init) { const res = await fetch(base + path, init); const body = await res.json(); if (!body.ok) throw new Error(path + " -> " + res.status + " " + body.error.code + ": " + body.error.message); return body.data; }
(async () => {
  const id = arg("id");
  const x = id ? await api("/api/experiments/" + id) : (await api("/api/ledger?limit=1"))[0];
  if (!x) { console.error("fake-race: the ledger is empty. Run one experiment first (MUBIT_MOCK=1 npm run dev; POST /api/plan)."); process.exit(2); }
  const ev = x.evaluation, be = ev && ev.baseline;
  if (!ev || !be) { console.error("fake-race: experiment " + x.id + " has no evaluation"); process.exit(2); }
  // the game laps a touch differently from the lap model: a seeded offset on the baseline, then the candidate follows the prediction × factor
  const offset = jitter(0.15), dLap = ev.delta_lap * factor + jitter(noise);
  const baseline = { role: "baseline", lap: r3(be.lap + offset), sectors: be.sectors.map(s => r3(s + offset / 3)), vmax_kmh: r1(be.vmax_kmh + jitter(1)), vmin_becketts_kmh: r1(be.vmin_kmh + jitter(1)) };
  const candidate = { role: "candidate", lap: r3(baseline.lap + dLap), sectors: baseline.sectors.map((s, i) => r3(s + ev.delta_sectors[i] * factor + jitter(noise / 3))), vmax_kmh: r1(ev.vmax_kmh + jitter(1)), vmin_becketts_kmh: r1(ev.vmin_kmh + jitter(1)) };
  const payload = { experiment_id: x.id, seed, cars: [baseline, candidate] };
  const row = await api("/api/race/result", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
  const m = row.measured;
  console.log(`fake-race ${row.id} seed ${seed}: predicted Δ ${m.predicted_delta} s, measured Δ ${m.measured_delta} s, agreement_pct ${m.agreement_pct}, status ${row.status}`);
  console.log(`baseline ${baseline.lap} [${baseline.sectors.join(", ")}] vmax ${baseline.vmax_kmh} vmin ${baseline.vmin_becketts_kmh} | candidate ${candidate.lap} [${candidate.sectors.join(", ")}] vmax ${candidate.vmax_kmh} vmin ${candidate.vmin_becketts_kmh}`);
})().catch(e => { console.error("fake-race FAILED: " + e.message + (/ECONNREFUSED|fetch failed/.test(e.message) ? " (is the server running on " + base + "?)" : "")); process.exit(1); });
