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

  // validate(input) -> { ok: true, value: { changes: [{ part, param, to, clamped }], hypothesis, expected }, clamped?, trimmed?, normalised? }
  //                  | { ok: false, field, message, error }
  function validate(input) {
    const p = parse(input); if (!p.ok) return p;
    const obj = p.value;
    for (const k of KEYS) if (!(k in obj)) return fail(k, "missing");
    for (const k of Object.keys(obj)) if (!KEYS.includes(k)) return fail(k, "unexpected key");
    const ch = obj.changes;
    if (!Array.isArray(ch)) return fail("changes", "must be an array");
    if (ch.length < LIMITS.changes_min || ch.length > LIMITS.changes_max) return fail("changes", "must hold 1-3 changes (has " + ch.length + ")");
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

  const api = { KEYS, CHANGE_KEYS, EXPECTED_KEYS, LIMITS, parse, validate };
  C.designerSchema = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
