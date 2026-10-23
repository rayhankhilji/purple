// PURPLE - validators for the data shapes the agent sees (F-03): Setup in, PlanOutput out, plus the compact Scenario serialiser.
// ARCHITECTURE §4.1, §4.5, §4.6. Dual browser / Node. Every rejection names the field.
(function () {
  const root = typeof window !== "undefined" ? window : globalThis;
  const aero = (root.EI && root.EI.aero) || (typeof require === "function" ? require("./aero.js") : null);
  const KEYS = aero.KEYS, RANGES = aero.RANGES;
  const VERDICTS = ["promote", "reject", "retest"], DIRECTIONS = ["increase", "decrease"];
  const PLAN_KEYS = ["verdict", "next_parameter", "direction", "magnitude", "expected_sector_effect", "hypothesis", "reject_if"];
  const LIMITS = { hypothesis: 160, reject_if: 80, scenario_chars: 1400 };   // 1,400 chars ≈ 350 tokens (G-MUBIT-04)
  const fail = (field, message) => ({ ok: false, field, message, error: field + ": " + message });

  // shape + type check of a Setup. Range legality is aero.violations (REG-* IDs); this is BAD_INPUT territory.
  function validateSetup(setup) {
    if (!setup || typeof setup !== "object" || Array.isArray(setup)) return fail("setup", "must be an object");
    for (const k of KEYS) {
      const v = setup[k];
      if (typeof v !== "number" || !isFinite(v)) return fail(k, "must be a finite number");
    }
    for (const k of Object.keys(setup)) if (!KEYS.includes(k)) return fail(k, "unknown setup key");
    return { ok: true, value: Object.fromEntries(KEYS.map(k => [k, setup[k]])) };
  }

  // a magnitude is in whole units for wings / ride height / brake bias, in 0.1 steps for ers_deploy, and never wider than the range
  function magnitudeOk(param, m) {
    const r = RANGES[param]; if (!r) return false;
    if (typeof m !== "number" || !isFinite(m) || m <= 0) return false;
    if (m > r.max - r.min + 1e-9) return false;
    const q = m / r.step; return Math.abs(q - Math.round(q)) < 1e-6;
  }

  // PlanOutput: accepts the raw model text or an object. Strict JSON: prose before or after the object is a rejection.
  // One tolerance: a single ```json fence around the object is stripped (it is not prose).
  function validatePlanOutput(input) {
    let obj = input;
    if (typeof input === "string") {
      let s = input.trim();
      const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(s); if (fence) s = fence[1].trim();
      if (!s.startsWith("{")) return fail("json", "output must start with '{' (prose before JSON)");
      try { obj = JSON.parse(s); } catch (e) { return fail("json", "not valid JSON: " + e.message); }
    }
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) return fail("json", "must be an object");
    for (const k of PLAN_KEYS) if (!(k in obj)) return fail(k, "missing");
    for (const k of Object.keys(obj)) if (!PLAN_KEYS.includes(k)) return fail(k, "unexpected key");
    if (!VERDICTS.includes(obj.verdict)) return fail("verdict", "must be one of " + VERDICTS.join("|"));
    if (!KEYS.includes(obj.next_parameter)) return fail("next_parameter", "must be one of " + KEYS.join("|"));
    if (!DIRECTIONS.includes(obj.direction)) return fail("direction", "must be increase|decrease");
    if (!magnitudeOk(obj.next_parameter, obj.magnitude)) return fail("magnitude", "must be > 0, within the parameter's range, in its step (" + RANGES[obj.next_parameter].step + ")");
    const e = obj.expected_sector_effect;
    if (!Array.isArray(e) || e.length !== 3 || !e.every(x => typeof x === "number" && isFinite(x))) return fail("expected_sector_effect", "must be 3 finite numbers");
    if (typeof obj.hypothesis !== "string" || obj.hypothesis.length > LIMITS.hypothesis) return fail("hypothesis", "string, max " + LIMITS.hypothesis + " chars");
    if (typeof obj.reject_if !== "string" || obj.reject_if.length > LIMITS.reject_if) return fail("reject_if", "string, max " + LIMITS.reject_if + " chars");
    return { ok: true, value: { verdict: obj.verdict, next_parameter: obj.next_parameter, direction: obj.direction, magnitude: obj.magnitude, expected_sector_effect: e.map(x => +x.toFixed(3)), hypothesis: obj.hypothesis, reject_if: obj.reject_if } };
  }

  // apply a plan to a setup: the next candidate (clamped to the legal range so the generator never proposes the impossible)
  function applyPlan(setup, plan) {
    const r = RANGES[plan.next_parameter], sign = plan.direction === "increase" ? 1 : -1;
    const next = Object.assign({}, setup);
    const raw = setup[plan.next_parameter] + sign * plan.magnitude;
    const q = Math.round(raw / r.step) * r.step;
    next[plan.next_parameter] = +Math.min(r.max, Math.max(r.min, q)).toFixed(r.step < 1 ? 1 : 0);
    return next;
  }

  // the compact Scenario the agent reads (ARCHITECTURE §4.5). Numbers rounded so the token count stays under 350.
  const r3 = v => (typeof v === "number" ? +v.toFixed(3) : v), r0 = v => (typeof v === "number" ? Math.round(v) : v);
  function compactSetup(s) { return Object.fromEntries(KEYS.map(k => [k, k === "ers_deploy" ? +s[k].toFixed(1) : r0(s[k])])); }
  function buildScenario(o) {
    const cond = { wet: !!o.conditions.wet, wind_ms: r0(o.conditions.wind_ms || 0) };
    if (cond.wind_ms) cond.wind_from_deg = r0(o.conditions.wind_from_deg || 0);
    const sc = {
      objective: o.objective || "min lap",
      circuit: o.circuit,
      conditions: cond,
      baseline: Object.assign(compactSetup(o.baseline), { lap: r3(o.baselineEval.lap), sectors: o.baselineEval.sectors.map(r3), vmax_kmh: r0(o.baselineEval.vmax_kmh) }),
      candidate: compactSetup(o.candidate),
      result: { delta_lap: r3(o.evaluation.delta_lap), delta_sectors: o.evaluation.delta_sectors.map(r3), vmax_kmh: r0(o.evaluation.vmax_kmh), vmin_kmh: r0(o.evaluation.vmin_kmh), legal: !!o.evaluation.legal },
      rules: (o.rules || []).slice(0, 5).map(x => (typeof x === "string" ? x : x.text)),
      history: (o.history || []).slice(-3).map(h => ({ change: h.change, delta_lap: r3(h.delta_lap) })),
    };
    return sc;
  }
  function serializeScenario(sc) { return JSON.stringify(sc); }
  const approxTokens = s => Math.ceil(s.length / 4);
  // one-line change summary for the history: "rear_wing_deg +4" (joins when two parameters moved)
  function describeChange(baseline, candidate) {
    const parts = [];
    for (const k of KEYS) { const d = candidate[k] - baseline[k]; if (Math.abs(d) > 1e-9) parts.push(k + " " + (d > 0 ? "+" : "") + (k === "ers_deploy" ? d.toFixed(1) : Math.round(d))); }
    return parts.join(", ") || "no change";
  }

  const api = { KEYS, PLAN_KEYS, VERDICTS, DIRECTIONS, LIMITS, validateSetup, validatePlanOutput, magnitudeOk, applyPlan, buildScenario, serializeScenario, approxTokens, describeChange, compactSetup };
  root.EI = root.EI || {}; root.EI.schema = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
