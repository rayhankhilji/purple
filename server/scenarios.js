// PURPLE - scenario generator for example collection and the exam (F-03, F-08; ARCHITECTURE §4.5, §4.10, §6 step 1).
// Random legal perturbations of 1-2 setup parameters around the baseline; mixed conditions. Everything takes the seeded rng.
// Exam truth and the opt-in promote bias come from the evaluator (lab/evaluator.js); the LLM never sees any of this code.
const aero = require("../lab/aero.js");
const schema = require("../lab/schema.js");
// step menus per parameter (whole units; ers in tenths): big enough to move the lap, small enough to stay in the legal range
const STEPS = { front_wing_deg: [2, 3, 4, 5, 6, 8], rear_wing_deg: [2, 3, 4, 5, 6, 8], ride_height_mm: [2, 3, 4, 5, 6, 8], brake_bias_pct: [1, 2, 3], ers_deploy: [0.1, 0.2, 0.3] };
// 70 % dry/no wind, 20 % wind 4-10 m/s, 10 % wet (ROADMAP P0.T6). promote_bias (P2, EVAL decision): share of candidates drawn from
// the menu moves the evaluator says beat the baseline by more than the promote threshold; 0 = the v1 generator exactly (same seeds).
const MIX = { two_params: 0.4, dry: 0.70, wind: 0.20, wind_ms: [4, 10], promote_bias: 0 };
// verdict thresholds (ARCHITECTURE §4.10, same numbers the frozen prompt states): the evaluator's delta_lap in seconds
const VERDICT = { promote_below: -0.03, reject_above: 0.03 };
// rng burn-in draws before a biased/warm perturb (see perturb); 8 is generous, 1 is already enough for the first-output problem
const RNG_WARM = 8;
// the exam (F-08): 20 items, verdict quotas, curated conditions, the held-out demo case, and the input size cap (G-MUBIT-04)
const EXAM = { n: 20, quota: { promote: 4, retest: 4, reject: 8 }, wind: 3, wet: 2, monza: 2, wind_ms: [10, 8, 6], min_margin: 0.003, max_chars: schema.LIMITS.scenario_chars };
const pick = (rng, arr) => arr[Math.floor(rng() * arr.length) % arr.length];
const quant = (k, v) => { const r = aero.RANGES[k]; return +(Math.round(v / r.step) * r.step).toFixed(r.step < 1 ? 1 : 0); };
const dry = circuit => ({ circuit, wet: false, wind_ms: 0, wind_from_deg: 0 });
const verdictOf = d => (d < VERDICT.promote_below ? "promote" : d > VERDICT.reject_above ? "reject" : "retest");
const sameSetup = (a, b) => aero.KEYS.every(k => Math.abs(a[k] - b[k]) < 1e-9);
// the evaluator: passed in, or the one the headless loader attached to the global EI (server/app.js path)
const evaluatorOf = opts => (opts && opts.evaluator) || (globalThis.EI && globalThis.EI.evaluator) || null;

// one candidate: 1 or 2 parameters moved, clamped to the regulation range, never equal to the baseline, legal under td01.
// opts: { td01, promote_bias?, evaluator?, circuit? }. With promote_bias > 0 that share of draws comes from the "promote" class
// of menu moves (measured dry, this circuit); the rng is only consumed for the bias when it is on, so bias 0 reproduces v1 seeds.
function perturb(baseline, rng, opts) {
  opts = opts || {};
  const bias = opts.promote_bias != null ? opts.promote_bias : MIX.promote_bias;
  // warm-up (measured 2026-10-24, EVAL): the game's xorshift32 returns ≈ 0.12 as its FIRST output for every seed in the collection's
  // range (seed0·1000+i), so the first pick() always lands on index 0 (front_wing_deg) and a bias coin would always land. One
  // burn-in draw already makes the next output uniform across consecutive seeds; we burn RNG_WARM. Off at bias 0 so v1 seeds
  // reproduce byte-for-byte (opts.warm overrides either way).
  const warm = opts.warm != null ? !!opts.warm : bias > 0;
  if (warm) for (let i = 0; i < RNG_WARM; i++) rng();
  if (bias > 0) {
    const ev = evaluatorOf(opts); if (!ev) throw new Error("scenarios.perturb: promote_bias needs an evaluator (load server/game-headless.js or pass opts.evaluator)");
    if (rng() < bias) {
      const fast = movesByVerdict(ev, baseline, dry(opts.circuit || "silverstone"), { td01: !!opts.td01 }).promote;
      if (fast.length) return Object.assign({}, pick(rng, fast).candidate);
    }
  }
  for (let tries = 0; tries < 50; tries++) {
    const keys = aero.KEYS.slice(), chosen = [pick(rng, keys)];
    if (rng() < MIX.two_params) { const rest = keys.filter(k => k !== chosen[0]); chosen.push(pick(rng, rest)); }
    const c = Object.assign({}, baseline);
    for (const k of chosen) { const r = aero.RANGES[k], sign = rng() < 0.5 ? -1 : 1; c[k] = quant(k, Math.min(r.max, Math.max(r.min, baseline[k] + sign * pick(rng, STEPS[k])))); }
    if (aero.KEYS.every(k => c[k] === baseline[k])) continue;
    if (aero.violations(c, opts).length) continue;
    return c;
  }
  throw new Error("scenarios.perturb: no legal candidate found");
}
function conditions(rng, circuit) {
  const u = rng();
  if (u < MIX.dry) return dry(circuit);
  if (u < MIX.dry + MIX.wind) return { circuit, wet: false, wind_ms: Math.round(MIX.wind_ms[0] + rng() * (MIX.wind_ms[1] - MIX.wind_ms[0])), wind_from_deg: Math.round(rng() * 36) * 10 % 360 };
  return { circuit, wet: true, wind_ms: 0, wind_from_deg: 0 };
}
function generate(rng, opts) {
  const circuit = opts.circuit || "silverstone", baseline = opts.baseline || aero.BASELINE;
  return { candidate: perturb(baseline, rng, { td01: !!opts.td01, promote_bias: opts.promote_bias, evaluator: opts.evaluator, circuit, warm: opts.warm }), conditions: conditions(rng, circuit) };
}

// ---- the move menu, classified by the evaluator. Every legal single and double move from STEPS (both signs), evaluated against the
// baseline under `conditions`; returned as { promote, retest, reject } lists of { change, candidate, delta_lap } sorted fastest
// first. Cached per (circuit, baseline, conditions, td01): ~700 evaluations, well under a second.
const menuCache = new Map();
function menuMoves(baseline, opts) {
  const keys = aero.KEYS, out = [], seen = new Set();
  const add = c => { if (sameSetup(c, baseline) || aero.violations(c, opts).length) return; const key = aero.KEYS.map(k => c[k]).join("/"); if (seen.has(key)) return; seen.add(key); out.push(c); };
  for (const k of keys) for (const st of STEPS[k]) for (const sg of [-1, 1]) add(Object.assign({}, baseline, { [k]: quant(k, baseline[k] + sg * st) }));
  for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) for (const s1 of STEPS[keys[i]]) for (const g1 of [-1, 1]) for (const s2 of STEPS[keys[j]]) for (const g2 of [-1, 1])
    add(Object.assign({}, baseline, { [keys[i]]: quant(keys[i], baseline[keys[i]] + g1 * s1), [keys[j]]: quant(keys[j], baseline[keys[j]] + g2 * s2) }));
  return out;
}
function movesByVerdict(evaluator, baseline, cond, opts) {
  opts = opts || {}; cond = cond || dry("silverstone"); const circuit = cond.circuit || "silverstone";
  const key = JSON.stringify([circuit, baseline, cond, !!opts.td01]);
  if (menuCache.has(key)) return menuCache.get(key);
  const base = evaluator.evaluateOne(circuit, baseline, cond, opts); if (!base.legal) throw new Error("scenarios.movesByVerdict: baseline illegal (" + base.violations.join(", ") + ")");
  const rows = menuMoves(baseline, opts).map(c => { const e = evaluator.evaluateOne(circuit, c, cond, opts); return { change: schema.describeChange(baseline, c), candidate: c, delta_lap: +(e.lap - base.lap).toFixed(3) }; });
  rows.sort((a, b) => a.delta_lap - b.delta_lap || (a.change < b.change ? -1 : a.change > b.change ? 1 : 0));
  const res = { promote: rows.filter(r => verdictOf(r.delta_lap) === "promote"), retest: rows.filter(r => verdictOf(r.delta_lap) === "retest"), reject: rows.filter(r => verdictOf(r.delta_lap) === "reject"), all: rows };
  if (menuCache.size > 32) menuCache.clear();
  menuCache.set(key, res); return res;
}

// ---- exam truth (ARCHITECTURE §4.10). verdict from the candidate's delta_lap; next_parameter/direction = the single ±1-step change
// (one parameter, one RANGES step) from the CANDIDATE with the best evaluator lap under the same conditions. Ties resolve to the first
// in KEYS order, "increase" before "decrease" (deterministic); `margin` is best-vs-second-best so callers can skip coin-flip items.
function truthFor(evaluator, circuit, candidate, cond, opts) {
  opts = opts || {}; const baseline = opts.baseline || aero.BASELINE;
  const ev = evaluator.evaluate(circuit, candidate, cond, { baseline, td01: !!opts.td01 });
  if (!ev.legal) return null;
  const steps = [];
  for (const k of aero.KEYS) for (const direction of ["increase", "decrease"]) {
    const r = aero.RANGES[k], c = Object.assign({}, candidate, { [k]: quant(k, candidate[k] + (direction === "increase" ? 1 : -1) * r.step) });
    if (c[k] < r.min - 1e-9 || c[k] > r.max + 1e-9 || aero.violations(c, { td01: !!opts.td01 }).length) continue;
    const e = evaluator.evaluateOne(circuit, c, cond, { td01: !!opts.td01 });
    steps.push({ next_parameter: k, direction, lap: e.lap });
  }
  if (!steps.length) return null;
  let best = steps[0], second = null;
  for (const s of steps.slice(1)) { if (s.lap < best.lap) { second = best; best = s; } else if (!second || s.lap < second.lap) second = s; }
  return {
    verdict: verdictOf(ev.delta_lap), next_parameter: best.next_parameter, direction: best.direction,
    delta_lap: ev.delta_lap, best_step_delta: +(best.lap - ev.lap).toFixed(3), margin: second ? +(second.lap - best.lap).toFixed(3) : null, evaluation: ev,
  };
}

// ---- buildExam(rng, evaluator, opts) -> 20 ExamScenario items { id, scenario, truth: { verdict, next_parameter, direction }, meta }.
// `scenario` is exactly schema.buildScenario's compact shape (rules [], history []), so it serialises like a live plan input.
// Fixed cases first: the held-out demo "Silverstone, rear wing +8°" (exam-rw8), 3 wind cases on the Hangar Straight (head, tail,
// cross), 2 wet, 2 Monza (the fast-refresh premise both ways); then rng-drawn Silverstone dry fillers from the verdict class still
// under quota, each with an unambiguous truth (margin ≥ EXAM.min_margin). Deterministic for a given rng seed and aero map.
function buildExam(rng, evaluator, opts) {
  opts = opts || {}; const circuit = opts.circuit || "silverstone", baseline = opts.baseline || aero.BASELINE, td01 = !!opts.td01, n = opts.n || EXAM.n;
  const quota = Object.assign({}, EXAM.quota, opts.quota || {});
  const items = [], used = new Set();
  const keyOf = (c, cond) => JSON.stringify([cond.circuit, cond.wet, cond.wind_ms, cond.wind_from_deg, aero.KEYS.map(k => c[k])]);
  const push = (id, candidate, cond, tag) => {
    const t = truthFor(evaluator, cond.circuit, candidate, cond, { baseline, td01 }); if (!t) return false;
    const k = keyOf(candidate, cond); if (used.has(k)) return false; used.add(k);
    const scenario = schema.buildScenario({ circuit: cond.circuit, conditions: cond, baseline, baselineEval: t.evaluation.baseline, candidate, evaluation: t.evaluation, rules: [], history: [] });
    items.push({ id, scenario, truth: { verdict: t.verdict, next_parameter: t.next_parameter, direction: t.direction }, meta: { tag, change: schema.describeChange(baseline, candidate), delta_lap: t.delta_lap, best_step_delta: t.best_step_delta, margin: t.margin, chars: schema.serializeScenario(scenario).length } });
    return true;
  };
  // the wind cases blow along the reference straight: compass bearing of the track heading at its middle (same construction as T-F02-AC3)
  const track = evaluator.trackFor(circuit), str = aero.REF_STRAIGHT[circuit], iStr = Math.round(((str.s0 + str.s1) / 2) / track.ds);
  const alongStraight = Math.round(aero.bearingOfHeading(track.heading[iStr]));
  const windFrom = [alongStraight, (alongStraight + 180) % 360, (alongStraight + 90) % 360];
  const classes = movesByVerdict(evaluator, baseline, dry(circuit), { td01 });
  const draw = (cls, cond) => { for (let tries = 0; tries < 200; tries++) { const c = pick(rng, cls).candidate; const t = truthFor(evaluator, cond.circuit, c, cond, { baseline, td01 }); if (t && t.margin != null && t.margin >= EXAM.min_margin && !used.has(keyOf(c, cond))) return c; } return null; };
  // 1. the held-out demo case
  push("exam-rw8", Object.assign({}, baseline, { rear_wing_deg: baseline.rear_wing_deg + 8 }), dry(circuit), "demo: rear wing +8°");
  // 2. wind: head / tail / cross on the reference straight, candidates from the whole menu
  for (let i = 0; i < EXAM.wind; i++) { const cond = { circuit, wet: false, wind_ms: EXAM.wind_ms[i], wind_from_deg: windFrom[i] }; const c = draw(classes.all, cond); if (c) push("exam-" + String(items.length + 1).padStart(2, "0"), c, cond, ["headwind", "tailwind", "crosswind"][i] + " " + EXAM.wind_ms[i] + " m/s on " + str.name); }
  // 3. wet
  for (let i = 0; i < EXAM.wet; i++) { const cond = { circuit, wet: true, wind_ms: 0, wind_from_deg: 0 }; const c = draw(classes.all, cond); if (c) push("exam-" + String(items.length + 1).padStart(2, "0"), c, cond, "wet"); }
  // 4. Monza: the fast-refresh premise both ways (lower wing pays at Monza, the +8° demo wing costs even more)
  if (EXAM.monza && evaluator.trackFor("monza")) {
    push("exam-" + String(items.length + 1).padStart(2, "0"), Object.assign({}, baseline, { rear_wing_deg: baseline.rear_wing_deg - 4 }), dry("monza"), "monza: rear wing −4°");
    push("exam-" + String(items.length + 1).padStart(2, "0"), Object.assign({}, baseline, { rear_wing_deg: baseline.rear_wing_deg + 8 }), dry("monza"), "monza: rear wing +8°");
  }
  // 5. fillers: the verdict class furthest below its quota first; then any class, dry Silverstone
  const count = v => items.filter(x => x.truth.verdict === v).length;
  while (items.length < n) {
    const short = Object.keys(quota).filter(v => count(v) < quota[v]).sort((a, b) => (count(b) - quota[b]) - (count(a) - quota[a]));
    const cls = short.length ? classes[short[0]] : classes.all;
    const c = draw(cls.length ? cls : classes.all, dry(circuit)); if (!c) throw new Error("scenarios.buildExam: cannot fill the exam (class " + (short[0] || "all") + " exhausted)");
    push("exam-" + String(items.length + 1).padStart(2, "0"), c, dry(circuit), "filler");
  }
  for (const v of Object.keys(quota)) if (count(v) < quota[v]) throw new Error("scenarios.buildExam: quota not met for " + v + " (" + count(v) + " < " + quota[v] + ")");
  for (const it of items) if (it.meta.chars > EXAM.max_chars) throw new Error("scenarios.buildExam: " + it.id + " serialises to " + it.meta.chars + " chars (> " + EXAM.max_chars + ")");
  return items;
}
// summary for the CLI and the lane file
function examSummary(items) {
  const by = v => items.filter(x => x.truth.verdict === v).length;
  return { n: items.length, promote: by("promote"), retest: by("retest"), reject: by("reject"), wind: items.filter(x => x.scenario.conditions.wind_ms).length, wet: items.filter(x => x.scenario.conditions.wet).length, monza: items.filter(x => x.scenario.circuit === "monza").length, max_chars: Math.max(...items.map(x => x.meta.chars)) };
}

// ---- P3.T1 prep: the exam's hardest items for Try models (scored by hand, 8-10 scenarios). Hardness = distance of delta_lap from the
// nearest verdict threshold (an item near ±0.03 is where a model's verdict can tip), ties by the next-move margin; exam-rw8 is always
// in (it is the demo premise). Returns k items, hardest first.
function hardestItems(items, k) {
  k = k || 8; const demo = items.find(x => x.id === "exam-rw8");
  const dist = it => Math.min(Math.abs(it.meta.delta_lap - VERDICT.promote_below), Math.abs(it.meta.delta_lap - VERDICT.reject_above));
  const rest = items.filter(x => x !== demo).slice().sort((a, b) => dist(a) - dist(b) || (a.meta.margin || 0) - (b.meta.margin || 0) || (a.id < b.id ? -1 : 1));
  return (demo ? [demo] : []).concat(rest).slice(0, k);
}
// the Try-models sheet (Markdown): per scenario the exact user message to paste, the truth, and blank answer columns
function trySheet(items, opts) {
  opts = opts || {}; const hard = hardestItems(items, opts.k || 8), cols = opts.columns || ["provider", "v1", "v2"];
  const L = [];
  L.push("# PURPLE — Try models sheet (P3.T1, F-05.AC3 / F-08)", "", "Generated by `node server/scenarios.js --try-sheet` from `data/exam.json` (seed " + (opts.seed != null ? opts.seed : "2026") + ", " + (opts.model || "aero map v1") + "). The " + hard.length + " hardest exam scenarios: `exam-rw8` (the demo premise) plus the items whose `delta_lap` sits closest to the ±0.03 verdict thresholds. Paste the **user message** verbatim into the console's Try models with the task's system prompt (`lab/prompt.js`, frozen); the answer is JSON; record `verdict / next_parameter direction` per model in the table. A hit = verdict matches the truth; a parameter hit = parameter and direction match.", "", "Do not type these into the live lab: Try models calls are the console's own and must not train the task (the server's exam uses `x-middleware-record: metadata`).", "", "## Score card", "", "| # | id | truth verdict | truth next move | " + cols.join(" | ") + " |", "|---|---|---|---|" + cols.map(() => "---").join("|") + "|");
  hard.forEach((it, i) => L.push("| " + (i + 1) + " | `" + it.id + "` | **" + it.truth.verdict + "** | " + it.truth.next_parameter + " " + it.truth.direction + " | " + cols.map(() => " ").join(" | ") + " |"));
  L.push("", "Totals: " + cols.map(c => c + " __/" + hard.length).join(" · ") + " (verdict) · " + cols.map(c => c + " __/" + hard.length).join(" · ") + " (next move). Enter the verdict totals as `exam.v1` / `exam.v2` via `POST /api/status` (the provider score comes from `npm run exam`, 20 items).", "", "## Scenarios", "");
  hard.forEach((it, i) => {
    const sc = it.scenario, c = sc.conditions, condTxt = (sc.circuit === "monza" ? "Monza" : "Silverstone") + (c.wet ? ", wet" : ", dry") + (c.wind_ms ? ", wind " + c.wind_ms + " m/s from " + c.wind_from_deg + "°" : ", no wind");
    L.push("### " + (i + 1) + ". `" + it.id + "` — " + it.meta.tag + " (" + condTxt + ")", "", "Change vs baseline: **" + it.meta.change + "** → evaluator Δ lap **" + (it.meta.delta_lap >= 0 ? "+" : "") + it.meta.delta_lap.toFixed(3) + " s** (" + (Math.min(Math.abs(it.meta.delta_lap - VERDICT.promote_below), Math.abs(it.meta.delta_lap - VERDICT.reject_above))).toFixed(3) + " s from a threshold). Truth: **" + it.truth.verdict + "**, next **" + it.truth.next_parameter + " " + it.truth.direction + "** (best ±1 step is " + it.meta.best_step_delta.toFixed(3) + " s, margin over the runner-up " + (it.meta.margin == null ? "n/a" : it.meta.margin.toFixed(3)) + " s). User message (" + it.meta.chars + " chars):", "", "```json", schema.serializeScenario(sc), "```", "", "| model | verdict | next_parameter | direction | verdict hit | param hit | notes |", "|---|---|---|---|---|---|---|");
    for (const col of cols) L.push("| " + col + " |  |  |  |  |  |  |");
    L.push("");
  });
  return L.join("\n");
}
// ---- scoring a hand-filled Try-models sheet (P3.T1). Reads the Markdown trySheet() wrote after Tanuj typed the answers in: for each
// scenario section ("### n. `exam-id`") the per-model table rows "| provider | verdict | next_parameter | direction | ...", and as a
// fallback the score-card cells ("reject, rear_wing_deg decrease" in one cell). Cells may hold "promote|reject|retest" and
// "param direction" in any order, with or without punctuation; "-", "—" or blank = not answered. Truth comes from data/exam.json
// (passed in), never from the sheet, so an edited sheet cannot score itself.
const SHEET_MODELS = ["provider", "v1", "v2"];
function parseAnswerCells(cells) {
  const txt = cells.join(" ").toLowerCase().replace(/[*`_]/g, m => (m === "_" ? "_" : " "));
  const verdict = (txt.match(/\b(promote|reject|retest)\b/) || [])[1] || null;
  const param = (txt.match(/\b(front_wing_deg|rear_wing_deg|ride_height_mm|brake_bias_pct|ers_deploy)\b/) || [])[1] || null;
  const dir = (txt.match(/\b(increase|decrease)\b/) || [])[1] || null;
  return verdict || param || dir ? { verdict, next_parameter: param, direction: dir } : null;
}
function parseSheet(md) {
  const answers = {};   // id -> model -> { verdict, next_parameter, direction }
  const lines = md.split(/\r?\n/); let current = null, cardCols = null;
  for (const line of lines) {
    const h = /^###\s+\d+\.\s+`(exam-[\w-]+)`/.exec(line); if (h) { current = h[1]; answers[current] = answers[current] || {}; continue; }
    if (/^##\s/.test(line)) { current = null; }
    if (!line.startsWith("|")) continue;
    const cells = line.split("|").slice(1, -1).map(c => c.trim());
    if (!cells.length || /^-+$/.test(cells[0])) continue;
    if (current) { const m = cells[0].toLowerCase(); if (SHEET_MODELS.includes(m)) { const a = parseAnswerCells(cells.slice(1, 4)); if (a) answers[current][m] = a; } continue; }
    // score card: header row names the model columns; data rows carry the id in a backticked cell
    if (cells[0] === "#" ) { cardCols = cells.map(c => c.toLowerCase()); continue; }
    if (cardCols) { const idc = cells.find(c => /^`exam-/.test(c)); if (!idc) continue; const id = idc.replace(/`/g, ""); for (const m of SHEET_MODELS) { const ci = cardCols.indexOf(m); if (ci < 0 || !cells[ci]) continue; const a = parseAnswerCells([cells[ci]]); if (a && !(answers[id] && answers[id][m])) { answers[id] = answers[id] || {}; answers[id][m] = a; } } }
  }
  return answers;
}
function scoreSheet(md, examItems) {
  const answers = parseSheet(md), truth = Object.fromEntries(examItems.map(it => [it.id, it.truth]));
  const ids = Object.keys(answers).filter(id => truth[id]), per = {}, missing = Object.keys(answers).filter(id => !truth[id]);
  for (const m of SHEET_MODELS) {
    const rows = ids.map(id => { const a = answers[id][m] || null, t = truth[id]; return { id, truth: t, answer: a, verdict_ok: !!a && a.verdict === t.verdict, param_ok: !!a && a.next_parameter === t.next_parameter && a.direction === t.direction }; });
    per[m] = { answered: rows.filter(r => r.answer).length, total: ids.length, verdict: rows.filter(r => r.verdict_ok).length, param: rows.filter(r => r.param_ok).length, rows };
  }
  // the status patch: POST /api/status is a shallow merge, so the whole exam object is sent (merged over the current one by the caller)
  const status = { exam: {} }; const put = (k, v) => { status.exam[k] = v; };
  for (const m of ["v1", "v2"]) if (per[m].answered) { put(m, per[m].verdict); put(m + "_param", per[m].param); put(m + "_total", per[m].total); }
  if (per.provider.answered) { put("provider_sheet", per.provider.verdict); put("provider_sheet_param", per.provider.param); }
  return { per, status, unknown_ids: missing, n: ids.length };
}

// ---- the v2 dry run: what the collection would send, scored by the evaluator's truth rule only (no Mubit). Mirrors app.js collect():
// seeds seed0*1000+i, generate(rng, { circuit, baseline, td01, promote_bias }); candidates are always legal, so no retry path here.
function dryRun(evaluator, opts) {
  opts = opts || {}; const n = opts.n || 40, seed0 = opts.seed != null ? opts.seed : 2, circuit = opts.circuit || "silverstone", baseline = opts.baseline || aero.BASELINE, bias = opts.promote_bias != null ? opts.promote_bias : MIX.promote_bias;
  const rows = [];
  for (let i = 0; i < n; i++) {
    const seed = seed0 * 1000 + i, rng = opts.rng(seed), g = generate(rng, { circuit, baseline, td01: !!opts.td01, promote_bias: bias, evaluator });
    const t = truthFor(evaluator, g.conditions.circuit, g.candidate, g.conditions, { baseline, td01: !!opts.td01 });
    rows.push({ seed, change: schema.describeChange(baseline, g.candidate), conditions: g.conditions, delta_lap: t.delta_lap, verdict: t.verdict, next: t.next_parameter + " " + t.direction, chars: schema.serializeScenario(schema.buildScenario({ circuit: g.conditions.circuit, conditions: g.conditions, baseline, baselineEval: t.evaluation.baseline, candidate: g.candidate, evaluation: t.evaluation, rules: opts.rules || [], history: [] })).length });
  }
  const by = v => rows.filter(r => r.verdict === v).length;
  return { rows, summary: { n, seed: seed0, promote_bias: bias, promote: by("promote"), retest: by("retest"), reject: by("reject"), dry: rows.filter(r => !r.conditions.wet && !r.conditions.wind_ms).length, wind: rows.filter(r => r.conditions.wind_ms).length, wet: rows.filter(r => r.conditions.wet).length, min_delta: Math.min(...rows.map(r => r.delta_lap)), max_delta: Math.max(...rows.map(r => r.delta_lap)), max_chars: Math.max(...rows.map(r => r.chars)) } };
}

module.exports = { STEPS, MIX, VERDICT, EXAM, RNG_WARM, perturb, conditions, generate, menuMoves, movesByVerdict, truthFor, buildExam, examSummary, verdictOf, hardestItems, trySheet, dryRun, SHEET_MODELS, parseSheet, scoreSheet };

// ---- CLI: node server/scenarios.js --build-exam data/exam.json [--seed 2026] [--circuit silverstone]
//           node server/scenarios.js --faster-moves [--circuit silverstone]        (the table behind MIX.promote_bias)
if (require.main === module) {
  const args = process.argv.slice(2), arg = (k, d) => { const i = args.indexOf("--" + k); return i >= 0 ? args[i + 1] : d; };
  const fs = require("fs"), path = require("path");
  const EI = require("./game-headless.js").load();
  const circuit = arg("circuit", "silverstone");
  if (args.includes("--try-sheet")) {
    // node server/scenarios.js --try-sheet docs/try-models/sheet.md [--exam data/exam.json] [--k 8]
    const out = arg("try-sheet", null), examFile = arg("exam", path.join(__dirname, "..", "data", "exam.json")); if (!out) { console.error("usage: --try-sheet <out.md> [--exam data/exam.json] [--k 8]"); process.exit(1); }
    const items = JSON.parse(fs.readFileSync(examFile, "utf8")), md = trySheet(items, { k: parseInt(arg("k", "8"), 10), seed: arg("seed", "2026"), model: EI.evaluator.MODEL_LABEL });
    fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, md + "\n");
    console.log(`try-sheet: ${hardestItems(items, parseInt(arg("k", "8"), 10)).map(x => x.id).join(", ")} -> ${out}`);
  } else if (args.includes("--score")) {
    // node server/scenarios.js --score docs/try-models/sheet.md [--exam data/exam.json] [--status data/status.json] : hand-entered answers -> n/8 + status JSON
    const sheet = arg("score", null), examFile = arg("exam", path.join(__dirname, "..", "data", "exam.json")), statusFile = arg("status", path.join(process.env.PURPLE_DATA_DIR || path.join(__dirname, "..", "data"), "status.json"));
    if (!sheet) { console.error("usage: --score <sheet.md> [--exam data/exam.json] [--status data/status.json]"); process.exit(1); }
    const r = scoreSheet(fs.readFileSync(sheet, "utf8"), JSON.parse(fs.readFileSync(examFile, "utf8")));
    for (const m of SHEET_MODELS) { const p = r.per[m]; console.log(`${m.padEnd(9)} verdict ${p.verdict}/${p.total}  next-step ${p.param}/${p.total}  (${p.answered} answered)`); for (const x of p.rows) if (x.answer) console.log(`  ${x.id.padEnd(9)} ${x.verdict_ok ? "✓" : "✗"} ${(x.answer.verdict || "-").padEnd(7)} ${x.param_ok ? "✓" : "✗"} ${x.answer.next_parameter || "-"} ${x.answer.direction || ""}   truth ${x.truth.verdict} / ${x.truth.next_parameter} ${x.truth.direction}`); }
    if (r.unknown_ids.length) console.log("ignored ids not in the exam: " + r.unknown_ids.join(", "));
    let current = {}; try { current = JSON.parse(fs.readFileSync(statusFile, "utf8")).exam || {}; } catch (e) { /* no status yet */ }
    const patch = { exam: Object.assign({}, current, r.status.exam) };
    console.log("\nPOST /api/status body (merged over " + statusFile + "; the route replaces the exam object as a whole):");
    console.log(JSON.stringify(patch));
    console.log(`curl -s -X POST localhost:8787/api/status -H 'content-type: application/json' -d '${JSON.stringify(patch)}'`);
  } else if (args.includes("--dry-run")) {
    // node server/scenarios.js --dry-run --n 40 --seed 2 --promote-bias 0.3 [--circuit silverstone] : the collection, scored by the evaluator only
    const r = dryRun(EI.evaluator, { n: parseInt(arg("n", "40"), 10), seed: parseInt(arg("seed", "2"), 10), circuit, promote_bias: parseFloat(arg("promote-bias", String(MIX.promote_bias))), rng: EI.U.rng });
    const S = r.summary; console.log(`dry-run (no Mubit): n=${S.n} seed=${S.seed} promote_bias=${S.promote_bias} circuit=${circuit} -> promote ${S.promote} / retest ${S.retest} / reject ${S.reject}; dry ${S.dry}, wind ${S.wind}, wet ${S.wet}; delta ${S.min_delta} .. ${S.max_delta}; longest ${S.max_chars} chars`);
    for (const x of r.rows) console.log(`  ${x.seed} ${x.verdict.padEnd(7)} Δ${x.delta_lap >= 0 ? "+" : ""}${x.delta_lap.toFixed(3)}  ${x.next.padEnd(24)} ${x.conditions.wet ? "wet " : x.conditions.wind_ms ? "wind " + x.conditions.wind_ms + "@" + x.conditions.wind_from_deg + " " : "dry "} ${x.change}`);
  } else if (args.includes("--faster-moves")) {
    const m = movesByVerdict(EI.evaluator, aero.BASELINE, dry(circuit));
    console.log(`${circuit}: ${m.all.length} menu moves, ${m.promote.length} promote (< ${VERDICT.promote_below} s), ${m.retest.length} retest, ${m.reject.length} reject`);
    for (const r of m.promote) console.log(`${r.delta_lap.toFixed(3)}  ${r.change}`);
  } else {
    const out = arg("build-exam", null); if (!out) { console.error("usage: node server/scenarios.js --build-exam data/exam.json [--seed 2026] | --faster-moves"); process.exit(1); }
    const seed = parseInt(arg("seed", "2026"), 10);
    const items = buildExam(EI.U.rng(seed), EI.evaluator, { circuit });
    fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, JSON.stringify(items, null, 2) + "\n");
    const s = examSummary(items);
    console.log(`exam: ${s.n} items -> ${out} (seed ${seed}, ${EI.evaluator.MODEL_LABEL}); promote ${s.promote} / retest ${s.retest} / reject ${s.reject}; wind ${s.wind}, wet ${s.wet}, monza ${s.monza}; longest ${s.max_chars} chars`);
    for (const it of items) console.log(`  ${it.id.padEnd(9)} ${it.truth.verdict.padEnd(7)} ${(it.truth.next_parameter + " " + it.truth.direction).padEnd(24)} Δ${it.meta.delta_lap >= 0 ? "+" : ""}${it.meta.delta_lap.toFixed(3)}  margin ${it.meta.margin}  ${it.meta.tag}: ${it.meta.change}`);
  }
}
