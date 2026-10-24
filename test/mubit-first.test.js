// The Mubit-first view of the concept lab (concept/lab/mubit-first.js): the default view of the lab and of the site root.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs"), path = require("path");
const ROOT = path.join(__dirname, "..");
const read = f => fs.readFileSync(path.join(ROOT, f), "utf8");

test("mubit-first: the lab loads it after the layout, Mubit is the default view, the other views stay", () => {
  const html = read("concept/lab/index.html");
  const at = f => html.indexOf('src="' + f + '"');
  assert.ok(at("concept-lab.js") > 0 && at("mubit-first.js") > at("concept-lab.js"), "mubit-first.js after concept-lab.js");
  assert.ok(at("engineer-panel.js") < at("mubit-first.js") && at("exam-panel.js") > 0, "the design tree and the exam stay");
  assert.ok(at("../sim/team-overrides.js") > 0 && at("../sim/team-overrides.js") < at("../sim/fit.js"), "the RB22 anchor overrides load before fit.js (browser lap = engine lap)");
  assert.match(html, /<body class="clab-page mubit-on">/);
  for (const id of ["btnViewMubit", "btnViewNoAI", "btnViewEng", "btnViewExam", "muStrip", "muCtl", "feedLabel", "chartLabel"]) assert.match(html, new RegExp('id="' + id + '"'), id);
  assert.match(html, /href="mubit-first\.css"/);
  assert.match(html, /id="raceLink" href="\.\.\/race\/\?mode=quali"/, "watch on Silverstone opens the Qualifying lap mode");
});

test("mubit-first: the browser never calls Mubit; Go live is the demo's record_good engine run with 12 / 40 / 120 calls", () => {
  const js = read("concept/lab/mubit-first.js"), lab = read("concept/lab/concept-lab.js");
  for (const [f, s] of [["mubit-first.js", js], ["concept-lab.js", lab]]) assert.doesNotMatch(s, /api\.mubit\.ai|api\.anthropic\.com|@anthropic-ai\/sdk/, f);
  assert.match(js, /\/api\/concept\/engine\/run/);
  assert.match(js, /llm: "live", record_good: true, confirm: "trained", confirm_text: "TRAIN " \+ n, max_calls: n/);
  assert.match(js, /const LIVE_CHOICES = \[12, 40, 120\];/);
  assert.match(js, /liveN: 12/, "12 calls by default");
  assert.match(js, /engine_open/, "no passcode needed when the site opens the engine");
  assert.match(lab, /mode: "quali", lap_s: lapOf\(S\.bestResult\)/, "watch on Silverstone: Qualifying lap with the car and lap on screen");
});

test("mubit-first: the Mubit numbers match their sources (harvest count, model status), scores as n/N", () => {
  const js = read("concept/lab/mubit-first.js");
  const good = read("docs/concept/loop-runs/trained-harvest/good.jsonl").split("\n").filter(l => l.trim()).length;
  const m = /harvest: \{ examples: (\d+), decisions: (\d+)/.exec(js);
  assert.ok(m, "MUBIT.harvest");
  assert.equal(+m[1], good, "751 physics-approved examples = good.jsonl rows");
  assert.match(read("docs/concept/loop-runs/trained-harvest/README.md"), new RegExp(Number(m[2]).toLocaleString("en-GB") + " Claude decisions, " + m[1] + " physics-approved"));
  assert.match(js, /98 examples · Mubit test 5\/19, not passed/);
  assert.match(js, /model_source: "Mubit console, 24 Oct"/);
  const banned = new RegExp(["\\bC" + "FD\\b", "wind" + " tunnel", "valid" + "ated"].join("|"), "i");
  for (const f of ["concept/lab/mubit-first.js", "concept/lab/mubit-first.css", "concept/lab/index.html", "concept/lab/concept-lab.js"]) assert.equal(banned.exec(read(f)), null, f);
});

test("mubit-first: the default replay is the newest recorded live trained-corrections run", () => {
  const runs = [];
  for (const dir of ["concept/demo/replays", "concept/lab/replays"]) for (const r of JSON.parse(read(dir + "/index.json")).runs) if (r.kind === "engineer-v2") runs.push(Object.assign({ dir }, r));
  runs.sort((a, b) => String(b.recorded_at).localeCompare(String(a.recorded_at)));
  const pick = runs.find(r => /corrections/.test(r.name));
  assert.ok(pick, "a corrections run is bundled");
  const R = JSON.parse(read(pick.dir + "/" + pick.file));
  assert.equal(R.format, "purple-replay/1");
  assert.ok(R.decisions.length > 0 && R.decisions.every(d => /^mreq_[0-9a-f]{20,}$/.test(d.mubit_request_id)), "every decision is a real Mubit call");
  // the fields the Mubit feed card and the timing line read
  for (const d of R.decisions) for (const k of ["decision", "hypothesis", "proposal_change", "as_proposed", "latency_ms", "screen", "physics_laps", "physics_ms", "kept", "peak_after"]) assert.ok(k in d, "decision " + d.decision + " has " + k);
});

test("mubit-first: the site root opens the lab in this view; the demo page stays reachable", () => {
  const v = JSON.parse(read("vercel.json"));
  const root = v.redirects.find(r => r.source === "/");
  assert.equal(root.destination, "/concept/lab/?api=/");
  assert.ok(v.redirects.some(r => r.source === "/concept/demo/" && r.destination === "/concept/demo/?api=/"), "/concept/demo/ keeps its redirect");
  assert.match(read("docs/DEPLOY.md"), /`\/` → `\/concept\/lab\/\?api=\/`/);
});
