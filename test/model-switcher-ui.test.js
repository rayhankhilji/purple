// The model switcher in the browser (concept/lab/model-switch.js + mubit-first.js) and the race page's providers-only field
// (concept/race/payload.js ?only=cars&real=ANT, race.js "Models + pole" | "Everyone"). No network, no Mubit call.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs"), path = require("path");
const ROOT = path.join(__dirname, "..");
const read = f => fs.readFileSync(path.join(ROOT, f), "utf8");
const MS = require("../concept/lab/model-switch.js");
const RP = require("../concept/race/payload.js");
const design = require("../concept/design.js");

const SCREEN = { variants: 600, confirm_k: 8, explore: 2 };
const body = (llm, model) => MS.runBody({ llm, model, rounds: 10, ideas: 4, screen: SCREEN, seed: 7 });

test("switcher: the models come from the Model GP entrants, with their car names; the built-in list when the file is missing", () => {
  const entrants = JSON.parse(read("concept/gp/entrants.json"));
  const list = MS.fromEntrants(entrants);
  assert.equal(list[0].id, MS.DEFAULT_ID, "the default (Haiku) first");
  assert.deepEqual(list.map(m => m.id).sort(), entrants.entrants.map(e => e.id).sort());
  for (const e of entrants.entrants) {
    const m = list.find(x => x.id === e.id);
    assert.equal(m.car, e.car || e.name, e.id + ": the car field when present, else the name");
    assert.ok(m.code.length <= 4 && m.label.length > 0, e.id);
  }
  assert.equal(MS.find(list, "gpt-6-luna").label, "ChatGPT (GPT-6 Luna)");
  assert.equal(MS.find(list, "no-ai").label, "No AI (control)");
  assert.ok(MS.isNoAi(MS.find(list, "no-ai")) && !MS.isNoAi(MS.find(list, "opus-5-5")));
  for (const bad of [null, {}, { entrants: [] }, { entrants: [{ id: "BAD ID" }] }]) assert.deepEqual(MS.fromEntrants(bad).map(m => m.id), MS.BUILTIN.map(m => m.id));
  assert.deepEqual(MS.BUILTIN.map(m => m.label), ["Claude Haiku 4.5", "Claude Sonnet 5.5", "Claude Opus 5.5", "ChatGPT (GPT-6 Luna)", "No AI (control)"]);
});

test("switcher: Go live with the default keeps record_good; every other model is sent untrained with the shared memory", () => {
  const d = body("live", MS.DEFAULT_ID);
  assert.deepEqual(d, { llm: "live", record_good: "kept", confirm: "trained", confirm_text: "TRAIN 40", seed: 7, mode: "engineer", team: "redbull", ideas: 4, rounds: 10, max_calls: 40, variants: 600, confirm_k: 8, explore: 2 });
  assert.deepEqual(body("live", undefined), d, "no model = the default");
  assert.ok(MS.trains(d));
  for (const id of ["sonnet-5-5", "opus-5-5", "gpt-6-luna", "no-ai"]) {
    const b = body("live", id);
    assert.equal(b.llm, "live"); assert.equal(b.model, id); assert.equal(b.memory, true);
    for (const k of ["record_good", "trained", "confirm", "confirm_text"]) assert.ok(!(k in b), id + " sends no " + k);
    assert.equal(MS.trains(b), false, id + ": untrained");
    assert.equal(b.max_calls, 40);
  }
  const mock = body("mock", "opus-5-5");
  assert.equal(mock.llm, "mock"); assert.equal(mock.model, "opus-5-5"); assert.ok(!("record_good" in mock));
  assert.deepEqual(Object.keys(body("mock", MS.DEFAULT_ID)).sort(), ["confirm_k", "explore", "ideas", "llm", "max_calls", "mode", "rounds", "seed", "team", "variants"]);
});

test("switcher: the lab loads it, the picker sits by Go live, untrained runs say so, the browser never calls Mubit", () => {
  const html = read("concept/lab/index.html"), js = read("concept/lab/mubit-first.js"), ms = read("concept/lab/model-switch.js");
  const at = f => html.indexOf('src="' + f + '"');
  assert.ok(at("model-switch.js") > 0 && at("model-switch.js") < at("mubit-first.js"));
  assert.match(js, /MS\.runBody\(\{ llm, model: S\.runModel\.id,/);
  assert.match(js, /id: "muModel"/); assert.match(js, /disabled: running \? true : null, onchange/, "no switching during a run");
  assert.match(js, /"untrained · not recorded for training"/);
  assert.match(js, /getJson\("\.\.\/gp\/entrants\.json"\)/);
  assert.match(js, /d\.model \|\| \(d\.call && d\.call\.model\)/, "cards name the served model (row.model)");
  for (const s of [js, ms]) assert.doesNotMatch(s, /api\.mubit\.ai|api\.anthropic\.com|api\.openai\.com|@anthropic-ai\/sdk/);
  const banned = new RegExp(["\\bC" + "FD\\b", "wind" + " tunnel", "valid" + "ated", "—"].join("|"), "i");
  const quoted = s => (s.match(/"[^"\n]*"/g) || []).filter(x => /untrained|control|Model|direction/.test(x)).join("\n");
  assert.equal(banned.exec(quoted(js) + quoted(ms)), null, "plain words, no em dash in the switcher's text");
});

// ---------------------------------------------------------------- the race: only=cars&real=ANT
function payloads(search) {
  global.window = global.window || globalThis;
  require("../js/data/racepace2026.js"); require("../js/data/season2026.js");
  const EI = globalThis.EI, rp = EI.RACEPACE.silverstone;
  const q = RP.parseQuery(search);
  assert.deepEqual(q.errors, []);
  const built = RP.buildPayload({ cars: q.cars, ref: "redbull" });
  const tel = {};
  for (const c of Object.keys(rp.q)) { const f = path.join(ROOT, RP.qualiFile(c)); if (fs.existsSync(f) && (c === rp.pole.code || (q.real || []).includes(c))) tel[c] = JSON.parse(fs.readFileSync(f, "utf8")); }
  return { q, rp, qp: RP.qualiPayload(built.payload, { racepace: rp, season: EI.SEASON, telemetry: tel, cars: q.cars, field: q.field, title: q.title, only: q.only, real: q.real }) };
}
const BASE = design.baseline({ team: "redbull" });
const MODEL_CARS = [
  { name: "Claude Opus", code: "OPUS", color: "#9085e9", design: design.applyChanges(BASE, [{ part: "rear_wing", param: "aoa_deg", to: 17 }]).design },
  { name: "ChatGPT", code: "GPT", color: "#d55181", design: design.applyChanges(BASE, [{ part: "rear_wing", param: "aoa_deg", to: 21 }]).design },
  { name: "No AI", code: "NOAI", color: "#8a8a94", design: BASE },
];

test("race: only=cars&real=ANT round-trips; without them nothing changes", () => {
  const u = RP.carsUrl(MODEL_CARS, { only: "cars", real: ["ant"] });
  assert.match(u, /[?&]only=cars(&|$)/); assert.match(u, /[?&]real=ANT(&|$)/);
  const q = RP.parseQuery(u.slice(u.indexOf("?")));
  assert.equal(q.only, "cars"); assert.deepEqual(q.real, ["ANT"]); assert.deepEqual(q.cars.map(c => c.name), ["Claude Opus", "ChatGPT", "No AI"]);
  const q0 = RP.parseQuery(RP.carsUrl(MODEL_CARS).replace(/^[^?]*/, ""));
  assert.equal(q0.only, null); assert.equal(q0.real, null); assert.equal(q0.field, "pole");
  assert.match(RP.parseQuery("?real=AN1,LEC&" + u.slice(u.indexOf("?") + 1).replace(/&?real=ANT/, "")).errors.join(" "), /AN1/);
  // the single-car contract keeps its keys
  const one = RP.url(BASE, { mode: "quali" });
  assert.deepEqual(Object.keys(RP.parseQuery(one.slice(one.indexOf("?")) + "&only=cars&real=ANT")).sort(), ["conditions", "design", "errors", "lap_s", "mode", "rate", "ref"]);
});

test("race: the model cars and Antonelli only; the finish order still matches the lap times", () => {
  const u = RP.carsUrl(MODEL_CARS, { only: "cars", real: ["ANT"] });
  const { qp } = payloads(u.slice(u.indexOf("?")));
  assert.deepEqual(qp.errors, []);
  const P = qp.payload;
  assert.equal(P.only, "cars"); assert.deepEqual(P.real, ["ANT"]);
  assert.deepEqual(P.cars.map(c => c.code).sort(), ["ANT", "GPT", "NOAI", "OPUS"], "no RB22 baseline, no other real driver");
  assert.equal(P.cars.find(c => c.kind === "base"), undefined);
  assert.equal(P.cars.find(c => c.code === "ANT").lap_s, 88.111, "Antonelli's pole");
  assert.deepEqual(P.order.map(o => o.code).sort(), P.cars.map(c => c.code).sort(), "the order has exactly the cars on track");
  assert.ok(P.order.every(o => o.pos != null));
  // what the game view checks: each car reaches the line at its lap time, so the finish order = the order (race.js renderQualiCheck)
  const finish = c => RP.tAtS(c, c.L);
  for (const c of P.cars) assert.ok(Math.abs(finish(c) - c.lap_s) < 0.0015, c.code + " finishes at its lap time");
  const got = P.cars.slice().sort((a, b) => Math.round(finish(a) * 1e3) - Math.round(finish(b) * 1e3) || a.rank - b.rank).map(c => c.code);
  assert.deepEqual(got, P.order.map(o => o.code));
  assert.match(P.label, /the model cars and ANT/);
});

test("race: Everyone = the RB22 ghost and the whole real field; an unknown real code is reported, never invented", () => {
  const all = RP.carsUrl(MODEL_CARS, { field: "all" });
  const { qp, rp } = payloads(all.slice(all.indexOf("?")));
  assert.ok(qp.payload.cars.some(c => c.kind === "base"));
  assert.equal(qp.payload.cars.filter(c => c.kind === "real").length, Object.keys(rp.q).length);
  const odd = RP.carsUrl(MODEL_CARS, { only: "cars", real: ["ANT", "XYZ"] });
  const r = payloads(odd.slice(odd.indexOf("?")));
  assert.match(r.qp.errors.join(" "), /XYZ: no 2026 Silverstone qualifying time/);
  assert.deepEqual(r.qp.payload.cars.filter(c => c.kind === "real").map(c => c.code), ["ANT"]);
});

test("race page: the Models + pole | Everyone toggle flips only / real / field; 3D tags carry the car names", () => {
  const js = read("concept/race/race.js");
  assert.match(js, /"Models \+ pole"/); assert.match(js, /"Everyone"/);
  assert.match(js, /u\.searchParams\.set\("only", "cars"\); u\.searchParams\.set\("real", poleCode \|\| "ANT"\)/);
  assert.match(js, /else u\.searchParams\.set\("field", "all"\)/);
  assert.match(js, /if \(S\.q\.cars\) fieldToggle\(\);/, "the toggle only in multi-car mode");
  assert.match(js, /only: S\.q\.only, real: S\.q\.real/);
  assert.match(js, /payload: gameCars\(pl\)/);
  assert.match(js, /short: c\.name\.slice\(0, 24\)/);
});
