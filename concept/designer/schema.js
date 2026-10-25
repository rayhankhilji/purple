// PURPLE CONCEPT DESIGNER - strict validator for the designer LLM's output (same discipline as lab/schema.js validatePlanOutput).
// DesignerOutput = {
//   changes:    [{ part, param, to }]   1-3 items, distinct parameters that exist in concept/parts.js PARAMS; `to` a finite number.
//                                       Out-of-domain values are clamped to the model domain and quantised to the step (`clamped: true`).
//   hypothesis: string                  ≤ 160 chars (longer is trimmed and listed in `trimmed`, as lab/schema.js decided 2026-10-23)
//   expected:   { lap_delta_s: -1|0|1, sector: 1|2|3 }   the sign the model expects for the lap delta (negative = faster) and the
//                                       sector it expects to move most. A finite number for lap_delta_s is reduced to its sign
//                                       (listed in `normalised`). Recorded for the lineage, never used to decide anything.
// }
// Strict JSON: prose before or after the object is a rejection; unknown keys are a rejection (so a model-made "verdict" or "kept"
// can never sneak in). One tolerance: a single ```json fence around the object is stripped (Haiku adds one; HANDOVER §5).
// The "changes only" task (concept/designer/prompt-compact.js) is read by validateCompact: { changes: [exactly one change] } and
// nothing else (no hypothesis / expected needed); the "action-choosing" task (concept/designer/prompt-action.js) by validateAction:
// one action code from the call's menu (ctx.menu); validatorFor(task) picks the validator of a task module.
// Legality is NOT checked here (concept/regs.js does that on the applied design). Every rejection names the field.
// Dual browser / Node: window.EI.concept.designerSchema and module.exports.
(function () {
  const root = typeof window !== "undefined" ? window : globalThis;
  const EI = (root.EI = root.EI || {}); const C = (EI.concept = EI.concept || {});
  const parts = C.parts || (typeof require === "function" ? require("../parts.js") : null);

  const KEYS = ["changes", "hypothesis", "expected"], CHANGE_KEYS = ["part", "param", "to"], EXPECTED_KEYS = ["lap_delta_s", "sector"];
  const LIMITS = { changes_min: 1, changes_max: 3, hypothesis: 160 };
  const fail = (field, message) => ({ ok: false, field, message, error: field + ": " + message });
  const isObj = o => !!o && typeof o === "object" && !Array.isArray(o);
  const spec = (part, param) => parts.PARAMS.find(s => s.part === part && s.param === param) || null;
  const quant = (s, v) => { const q = Math.round((v - s.min) / s.step) * s.step + s.min; return +Math.min(s.max, Math.max(s.min, q)).toFixed(6); };

  // the raw text -> object step: one optional ```json fence, then the text must be exactly one JSON object
  function parse(input) {
    if (typeof input !== "string") return isObj(input) ? { ok: true, value: input } : fail("json", "must be an object");
    let s = input.trim();
    const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(s); if (fence) s = fence[1].trim();
    if (!s.startsWith("{")) return fail("json", "output must start with '{' (prose before JSON)");
    if (!s.endsWith("}")) return fail("json", "output must end with '}' (prose after JSON)");
    let obj; try { obj = JSON.parse(s); } catch (e) { return fail("json", "not valid JSON: " + e.message); }
    return isObj(obj) ? { ok: true, value: obj } : fail("json", "must be an object");
  }

  // the changes array -> { ok, changes: [{ part, param, to, clamped }], clamped: [keys] } | fail (shared by validate and validateCompact)
  function changeList(ch, min, max) {
    if (!Array.isArray(ch)) return fail("changes", "must be an array");
    if (ch.length < min || ch.length > max) return fail("changes", "must hold " + (min === max ? "exactly " + min + " change" + (min === 1 ? "" : "s") : min + "-" + max + " changes") + " (has " + ch.length + ")");
    const changes = [], clamped = [], seen = new Set();
    for (let i = 0; i < ch.length; i++) {
      const c = ch[i], f = "changes[" + i + "]";
      if (!isObj(c)) return fail(f, "must be an object");
      for (const k of CHANGE_KEYS) if (!(k in c)) return fail(f + "." + k, "missing");
      for (const k of Object.keys(c)) if (!CHANGE_KEYS.includes(k)) return fail(f + "." + k, "unexpected key");
      if (typeof c.part !== "string" || typeof c.param !== "string") return fail(f, "part and param must be strings");
      const s = spec(c.part, c.param); if (!s) return fail(f, "unknown parameter " + c.part + "." + c.param);
      const key = c.part + "." + c.param; if (seen.has(key)) return fail(f, "parameter " + key + " appears twice"); seen.add(key);
      if (typeof c.to !== "number" || !isFinite(c.to)) return fail(f + ".to", "must be a finite number");
      const to = quant(s, c.to), cl = Math.abs(to - c.to) > s.step / 2 + 1e-9;
      if (cl) clamped.push(key);
      changes.push({ part: c.part, param: c.param, to, clamped: cl });
    }
    return { ok: true, changes, clamped };
  }

  // validate(input) -> { ok: true, value: { changes: [{ part, param, to, clamped }], hypothesis, expected }, clamped?, trimmed?, normalised? }
  //                  | { ok: false, field, message, error }
  function validate(input) {
    const p = parse(input); if (!p.ok) return p;
    const obj = p.value;
    for (const k of KEYS) if (!(k in obj)) return fail(k, "missing");
    for (const k of Object.keys(obj)) if (!KEYS.includes(k)) return fail(k, "unexpected key");
    const cl0 = changeList(obj.changes, LIMITS.changes_min, LIMITS.changes_max); if (!cl0.ok) return cl0;
    const { changes, clamped } = cl0;
    if (typeof obj.hypothesis !== "string") return fail("hypothesis", "must be a string");
    const e = obj.expected;
    if (!isObj(e)) return fail("expected", "must be an object");
    for (const k of EXPECTED_KEYS) if (!(k in e)) return fail("expected." + k, "missing");
    for (const k of Object.keys(e)) if (!EXPECTED_KEYS.includes(k)) return fail("expected." + k, "unexpected key");
    const normalised = [];
    let sign = e.lap_delta_s;
    if (typeof sign !== "number" || !isFinite(sign)) return fail("expected.lap_delta_s", "must be -1, 0 or 1");
    if (![-1, 0, 1].includes(sign)) { sign = Math.sign(sign); normalised.push("expected.lap_delta_s"); }
    if (![1, 2, 3].includes(e.sector)) return fail("expected.sector", "must be 1, 2 or 3");
    const trimmed = [];
    let hyp = obj.hypothesis.trim();
    if (hyp.length > LIMITS.hypothesis) { hyp = hyp.slice(0, LIMITS.hypothesis - 1).trimEnd() + "…"; trimmed.push("hypothesis"); }
    const out = { ok: true, value: { changes, hypothesis: hyp, expected: { lap_delta_s: sign, sector: e.sector } } };
    if (clamped.length) out.clamped = clamped;
    if (trimmed.length) out.trimmed = trimmed;
    if (normalised.length) out.normalised = normalised;
    return out;
  }

  // the "changes only" task (concept/designer/prompt-compact.js, OUTPUT "compact"): exactly { changes: [ ONE { part, param, to } ] }.
  // No hypothesis / expected (their absence is not a failure); any other key, prose or a second change is a rejection, so only
  // answers in the task's own format can become training examples. Same JSON / fence / quantisation rules as validate.
  // -> { ok: true, value: { changes: [{ part, param, to, clamped }], hypothesis: null, expected: null }, clamped? } | fail
  const COMPACT_KEYS = ["changes"], COMPACT_LIMITS = { changes_min: 1, changes_max: 1 };
  function validateCompact(input) {
    const p = parse(input); if (!p.ok) return p;
    const obj = p.value;
    for (const k of COMPACT_KEYS) if (!(k in obj)) return fail(k, "missing");
    for (const k of Object.keys(obj)) if (!COMPACT_KEYS.includes(k)) return fail(k, "unexpected key (the compact task answers changes only)");
    const cl0 = changeList(obj.changes, COMPACT_LIMITS.changes_min, COMPACT_LIMITS.changes_max); if (!cl0.ok) return cl0;
    const out = { ok: true, value: { changes: cl0.changes, hypothesis: null, expected: null } };
    if (cl0.clamped.length) out.clamped = cl0.clamped;
    return out;
  }
  // the "action-choosing" task (concept/designer/prompt-action.js, OUTPUT "action"): the answer is exactly ONE action code ("A07"),
  // optionally surrounded by whitespace; nothing else (no JSON, no prose, no fences, no second code). ctx.menu is the call's own menu
  // (concept/designer/actions.js menu(head): [{ code, part, param, from, to }], the actions legal from that head car). A code that is
  // not in the catalogue, or not on this call's menu (illegal or out of range at this head), is a rejection: the engine falls back to
  // its own labelled step and the answer is never trained.
  // -> { ok: true, value: { changes: [{ part, param, to, clamped: false }], hypothesis: null, expected: null, action: code } } | fail
  const ACTION_RE = /^A\d{2}$/;
  function validateAction(input, ctx) {
    if (typeof input !== "string") return fail("action", "must be a string holding one action code");
    const s = input.trim();
    if (!ACTION_RE.test(s)) return fail("action", "must be exactly one action code like A07 (got " + JSON.stringify(s.slice(0, 40)) + ")");
    const menu = ctx && ctx.menu;
    if (!Array.isArray(menu)) return fail("action", "no action menu for this call");
    const cat = (ctx && ctx.catalogue) || (C.designerActions && C.designerActions.BY_CODE) || (typeof require === "function" ? require("./actions.js").BY_CODE : null);
    if (cat && !cat.has(s)) return fail("action", "unknown action code " + s);
    const m = menu.find(x => x.code === s);
    if (!m) return fail("action", "action " + s + " is not on this car's menu (illegal or out of range from the current best car)");
    return { ok: true, value: { changes: [{ part: m.part, param: m.param, to: m.to, clamped: false }], hypothesis: null, expected: null, action: s } };
  }
  // the validator of a designer task module: OUTPUT "compact" -> validateCompact; "action" -> validateAction (needs ctx.menu);
  // anything else (v1, no OUTPUT) -> validate
  const validatorFor = task => (task && task.OUTPUT === "compact" ? validateCompact : task && task.OUTPUT === "action" ? validateAction : validate);

  const api = { KEYS, CHANGE_KEYS, EXPECTED_KEYS, LIMITS, COMPACT_KEYS, COMPACT_LIMITS, ACTION_RE, parse, validate, validateCompact, validateAction, validatorFor };
  C.designerSchema = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
