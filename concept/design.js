// PURPLE CONCEPT - a Design: the baseline 2026-style concept car plus per-part shape parameters. validate / clone / mutate / diff /
// describe, and facts() (geometry + mass sheet + legality inputs) for concept/regs.js. Pure, deterministic, no game needed.
// Design = { id, label, params: { <part id>: { <param>: number } }, overrides?: { <part id>: { mass_kg?, x_mm?, z_mm? } }, parent? }
// Dual browser / Node: window.EI.concept.design and module.exports.
(function () {
  const root = typeof window !== "undefined" ? window : globalThis;
  const EI = (root.EI = root.EI || {}); const C = (EI.concept = EI.concept || {});
  const req = (name, file) => C[name] || (typeof require === "function" ? require(file) : null);
  const parts = req("parts", "./parts.js"), aeromap = req("aeromap", "./aeromap.js");

  // the seeded rng: the same algorithm as server/scenarios.js seededRng (murmur3 finaliser on the seed, the game's xorshift32
  // U.rng, 16 warm-up draws), re-implemented here so the concept runs in the browser without the server module. test/concept.test.js
  // proves the two streams are identical.
  function seededRng(seed) {
    let x = (seed >>> 0) + 0x9e3779b9; x = Math.imul(x ^ (x >>> 16), 0x85ebca6b) >>> 0; x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35) >>> 0; x = (x ^ (x >>> 16)) >>> 0;
    let s = (x >>> 0) || 1;
    const rng = function () { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
    for (let i = 0; i < 16; i++) rng();
    return rng;
  }
  function gauss(rng) { const u = Math.max(rng(), 1e-12), v = rng(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }

  const spec = (part, param) => { const p = parts.BY_ID[part]; return p && p.params[param] ? Object.assign({ part, param }, p.params[param]) : null; };
  const quant = (s, v) => { const q = Math.round((v - s.min) / s.step) * s.step + s.min; return +Math.min(s.max, Math.max(s.min, q)).toFixed(6); };

  function baseline() {
    const params = {};
    for (const p of parts.CATALOGUE) { params[p.id] = {}; for (const k of Object.keys(p.params)) params[p.id][k] = p.params[k].base; }
    return { id: "baseline", label: "Baseline 2026-style concept car", params };
  }
  function clone(d) { return JSON.parse(JSON.stringify(d)); }

  // domain validation (types and model bounds; NOT legality, which is concept/regs.js). Returns { ok, errors: [string] }.
  function validate(d) {
    const errors = [];
    if (!d || typeof d !== "object" || !d.params) return { ok: false, errors: ["design: missing params"] };
    for (const s of parts.PARAMS) {
      const v = d.params[s.part] && d.params[s.part][s.param];
      if (typeof v !== "number" || !isFinite(v)) { errors.push(s.part + "." + s.param + ": not a number"); continue; }
      if (v < s.min - 1e-9 || v > s.max + 1e-9) errors.push(s.part + "." + s.param + ": " + v + " outside the model domain " + s.min + "-" + s.max);
      if (s.int && Math.round(v) !== v) errors.push(s.part + "." + s.param + ": must be an integer");
    }
    for (const part of Object.keys(d.params)) if (!parts.BY_ID[part]) errors.push("unknown part " + part);
    return { ok: errors.length === 0, errors };
  }

  // changes: [{ part, param, to }] -> new design (values clamped to the domain and quantised; `clamped` marks a clipped value)
  function applyChanges(d, changes, meta) {
    const out = clone(d), applied = [];
    for (const c of changes || []) {
      const s = spec(c.part, c.param); if (!s) throw new Error("concept: unknown parameter " + c.part + "." + c.param);
      const from = out.params[c.part][c.param], to = quant(s, +c.to);
      if (to === from) continue;
      out.params[c.part][c.param] = to;
      applied.push({ part: c.part, param: c.param, from, to, clamped: Math.abs(to - +c.to) > s.step / 2 + 1e-9 });
    }
    Object.assign(out, meta || {});
    return { design: out, changes: applied };
  }

  // mutate: 1-3 parameters (or opts.keys), a gaussian step of `step` × the parameter's domain width, quantised; never a no-op.
  function mutate(d, rng, step, opts) {
    opts = opts || {}; step = step == null ? 0.1 : step;
    const pool = parts.PARAMS.filter(s => !(opts.locked || []).includes(s.part + "." + s.param));
    const n = opts.n || 1 + Math.floor(rng() * 3), picked = [];
    for (let i = 0; i < n && pool.length; i++) picked.push(pool.splice(Math.floor(rng() * pool.length) % pool.length, 1)[0]);
    const changes = picked.map(s => {
      const cur = d.params[s.part][s.param], width = s.max - s.min;
      let to = quant(s, cur + gauss(rng) * step * width);
      if (to === cur) to = quant(s, cur + (rng() < 0.5 ? -s.step : s.step) * (s.int ? 1 : Math.max(1, Math.round(step * width / s.step))));
      if (to === cur) to = quant(s, cur === s.max ? cur - s.step : cur + s.step);
      return { part: s.part, param: s.param, to };
    });
    return applyChanges(d, changes);
  }

  // diff(a, b): every parameter that differs, b relative to a
  function diff(a, b) {
    const out = [];
    for (const s of parts.PARAMS) {
      const x = a.params[s.part][s.param], y = b.params[s.part][s.param];
      if (Math.abs(x - y) > 1e-9) out.push({ part: s.part, param: s.param, from: x, to: y, delta: +(y - x).toFixed(4), unit: s.unit, domain_frac: +((y - x) / (s.max - s.min)).toFixed(4) });
    }
    return out;
  }
  const fmt = (v, u) => (Math.round(v * 100) / 100) + (u ? (u === "°" ? "°" : " " + u) : "");
  function describeChange(c) { const s = spec(c.part, c.param); return parts.BY_ID[c.part].name.split(" (")[0] + " · " + s.label + " " + fmt(c.from, s.unit) + " → " + fmt(c.to, s.unit); }
  // describe(design): short human lines per part with parameters, plus the headline numbers
  function describe(d) {
    const f = facts(d), lines = [];
    for (const p of parts.CATALOGUE) { const ks = Object.keys(p.params); if (!ks.length) continue; lines.push(p.name.split(" (")[0] + ": " + ks.map(k => p.params[k].label.toLowerCase() + " " + fmt(d.params[p.id][k], p.params[k].unit)).join(", ")); }
    lines.push("Mass " + f.mass.total_kg + " kg (parts " + f.mass.parts_kg + ", ballast " + f.mass.ballast_kg + "), front " + (f.mass.front_share * 100).toFixed(1) + " %, CoG height " + f.mass.cog_z_mm + " mm, Izz " + f.mass.izz_kgm2 + " kg·m²");
    lines.push("Aero (" + aeromap.VERSION + "): downforce ×" + f.aero.df.toFixed(3) + ", drag ×" + f.aero.cd.toFixed(3) + " (straight mode ×" + f.aero.cd_sm.toFixed(3) + "), balance " + (f.aero.balance * 100).toFixed(1) + " % front");
    return lines;
  }

  // facts: everything concept/regs.js checks and concept/physical.js needs, from the design alone
  function facts(d, opts) {
    const p = d.params, g = parts.geometry(p);
    return {
      geometry: g, front_wing: p.front_wing, rear_wing: p.rear_wing, floor: p.floor,
      plank_wear_mm: +parts.plankWear(p.floor.ride_height_mm).toFixed(3),
      mass: parts.massSheet(p, { session: opts && opts.session, overrides: d.overrides }),
      aero: aeromap.evaluate(p),
    };
  }

  const api = { seededRng, gauss, spec, baseline, clone, validate, applyChanges, mutate, diff, describe, describeChange, facts };
  C.design = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
