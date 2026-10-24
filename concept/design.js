// PURPLE CONCEPT - a Design: the baseline 2026-style concept car plus per-part shape parameters. validate / clone / mutate / diff /
// describe, and facts() (geometry + mass sheet + legality inputs) for concept/regs.js. Pure, deterministic, no game needed.
// Design = { id, label, params: { <part id>: { <param>: number, material?: "<material id>" } }, overrides?: { <part id>: { mass_kg?, x_mm?, z_mm? } }, parent? }
// params.<part>.material (optional; concept/materials.js, docs/concept/MATERIALS.md): absent = the part's baseline material.
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

  // own-property lookups only: "toString", "constructor", "__proto__" and friends are never parts or parameters (the proposer may
  // be an LLM; its strings are data)
  const own = (o, k) => o != null && typeof k === "string" && Object.prototype.hasOwnProperty.call(o, k);
  const spec = (part, param) => { const p = own(parts.BY_ID, part) ? parts.BY_ID[part] : null; return p && own(p.params, param) ? Object.assign({ part, param }, p.params[param]) : null; };
  const quant = (s, v) => { const q = Math.round((v - s.min) / s.step) * s.step + s.min; return +Math.min(s.max, Math.max(s.min, q)).toFixed(6); };
  // materials (concept/materials.js): params.<part>.material is an optional material id; absent = the part's baseline material
  let matsReq = null;
  if (!C.materials && typeof require === "function") { try { matsReq = require("./materials.js"); } catch (e) { matsReq = null; } }
  const mats = () => C.materials || matsReq;
  function materialProblem(part, id) {
    const M = mats();
    if (typeof id !== "string") return part + ".material: must be a material id string";
    if (!M) return part + ".material: concept/materials.js is not loaded";
    return M.problem(part, id);
  }
  const materialOf = (d, part) => { const M = mats(); return M ? M.materialOf(d.params, part) : null; };

  // the baselines. Every 2026 car runs active aero (C3.10.10, C3.11.6), so the baseline carries a REFERENCE straight-mode flap
  // setting (front 4°, rear 15°): the setting concept/physical.js maps onto the lap sim's estimated Straight Mode coefficients.
  // Front 4° is the largest whole degree whose straight-mode X extent still fits RV-FW-PROFILES at the 580 mm chord
  // (REG-C-FW-SM-ENVELOPE); rear 15° is mid-domain, so the optimiser can open the flap further or close it. Every other parameter is
  // the catalogue base (concept/parts.js). TEAMS: a team baseline has the same concept shape (no team geometry is public) and is
  // anchored by concept/physical.js on that team's inferred car in the lap sim (concept/sim baselineCar(team)); `livery` is the
  // viewer's livery id. design.baseline() = the generic 2026 car; design.baseline({ team: "redbull" }) (or "redbull") = the RB22.
  const REF_STRAIGHT_MODE = Object.freeze({ front_wing: 4, rear_wing: 15 });
  const TEAMS = {
    redbull: { id: "baseline-redbull", label: "Red Bull Racing RB22 · Red Bull Ford DM01 (concept shape on the inferred RB22 car)", team: "redbull", livery: "redbull-rb22", chassis: "RB22", pu: "Red Bull Ford DM01", driver: "HAD", team_name: "Red Bull Racing" },
  };
  function baseline(opts) {
    const team = typeof opts === "string" ? opts : opts && opts.team;
    if (team && team !== "generic" && !own(TEAMS, team)) throw new Error("concept: no baseline for team " + String(team) + " (known: generic, " + Object.keys(TEAMS).join(", ") + ")");
    const params = {};
    for (const p of parts.CATALOGUE) { params[p.id] = {}; for (const k of Object.keys(p.params)) params[p.id][k] = p.params[k].base; }
    for (const w of Object.keys(REF_STRAIGHT_MODE)) params[w].sm_delta_deg = REF_STRAIGHT_MODE[w];
    if (team && team !== "generic") return Object.assign({ params }, JSON.parse(JSON.stringify(TEAMS[team])));
    return { id: "baseline", label: "Baseline 2026-style concept car", params };
  }
  function clone(d) { return JSON.parse(JSON.stringify(d)); }

  // domain validation (types and model bounds; NOT legality, which is concept/regs.js). Returns { ok, errors: [string] }.
  function validate(d) {
    const errors = [];
    if (!d || typeof d !== "object" || !d.params || typeof d.params !== "object") return { ok: false, errors: ["design: missing params"] };
    for (const s of parts.PARAMS) {
      const v = own(d.params, s.part) && own(d.params[s.part], s.param) ? d.params[s.part][s.param] : undefined;
      if (typeof v !== "number" || !isFinite(v)) { errors.push(s.part + "." + s.param + ": not a number"); continue; }
      if (v < s.min - 1e-9 || v > s.max + 1e-9) errors.push(s.part + "." + s.param + ": " + v + " outside the model domain " + s.min + "-" + s.max);
      if (s.int && Math.round(v) !== v) errors.push(s.part + "." + s.param + ": must be an integer");
    }
    // every key present must be a known part / parameter with a finite value (NaN or a stray inherited name never validates)
    for (const part of Object.getOwnPropertyNames(d.params)) {
      if (!own(parts.BY_ID, part)) { errors.push("unknown part " + part); continue; }
      const ps = d.params[part];
      if (!ps || typeof ps !== "object") { errors.push(part + ": not an object"); continue; }
      for (const k of Object.getOwnPropertyNames(ps)) {
        if (k === "material") { const why = materialProblem(part, ps[k]); if (why) errors.push(why); continue; }
        if (!own(parts.BY_ID[part].params, k)) errors.push("unknown parameter " + part + "." + k);
        else if (typeof ps[k] !== "number" || !isFinite(ps[k])) { const e = part + "." + k + ": not a number"; if (!errors.includes(e)) errors.push(e); }
      }
    }
    return { ok: errors.length === 0, errors };
  }

  // changes: [{ part, param, to }] -> new design (values clamped to the domain and quantised; `clamped` marks a clipped value)
  function applyChanges(d, changes, meta) {
    const out = clone(d), applied = [];
    if (changes != null && !Array.isArray(changes)) throw new Error("concept: changes must be an array");
    for (const c of changes || []) {
      if (!c || typeof c !== "object") throw new Error("concept: a change must be an object { part, param, to }");
      if (c.param === "material" && typeof c.part === "string") {   // a material swap: { part, param: "material", to: "<id>" }
        const why = materialProblem(c.part, c.to); if (why) throw new Error("concept: " + why);
        const from = materialOf(out, c.part); if (c.to === from) continue;
        if (!own(out.params, c.part)) out.params[c.part] = {};
        if (c.to === mats().baseOf(c.part)) delete out.params[c.part].material; else out.params[c.part].material = c.to;
        applied.push({ part: c.part, param: "material", from, to: c.to, clamped: false });
        continue;
      }
      const s = spec(c.part, c.param); if (!s) throw new Error("concept: unknown parameter " + String(c.part) + "." + String(c.param));
      const num = typeof c.to === "number" ? c.to : typeof c.to === "string" && c.to.trim() !== "" ? Number(c.to) : NaN;
      if (!Number.isFinite(num)) throw new Error("concept: non-finite value for " + c.part + "." + c.param + ": " + String(c.to));
      if (!own(out.params, c.part)) out.params[c.part] = {};
      const from = out.params[c.part][c.param], to = quant(s, num);
      if (to === from) continue;
      out.params[c.part][c.param] = to;
      applied.push({ part: c.part, param: c.param, from, to, clamped: Math.abs(to - num) > s.step / 2 + 1e-9 });
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
    // opts.materials (off by default, so seeded lineages are unchanged): with probability opts.material_p (0.15) one change is a
    // material swap on a random material-able part, to a random material of an allowed form
    const M = mats();
    if (opts.materials && M && rng() < (opts.material_p == null ? 0.15 : opts.material_p)) {
      const ps = parts.MATERIAL_PARTS.filter(id => !(opts.locked || []).includes(id + ".material"));
      if (ps.length) {
        const part = ps[Math.floor(rng() * ps.length) % ps.length], cur = M.materialOf(d.params, part);
        // only materials the regulations allow on this part (concept/regs.js materialViolations: C15 status, component articles)
        const R = C.regs || (typeof require === "function" ? require("./regs.js") : null);
        const pool = M.MATERIALS.filter(m => m.id !== cur && !M.problem(part, m.id) && (!R || !R.materialViolations(part, m.id).length));
        if (pool.length) { picked.pop(); const extra = applyChanges(d, [{ part, param: "material", to: pool[Math.floor(rng() * pool.length) % pool.length].id }]); return picked.length ? (r => ({ design: r.design, changes: extra.changes.concat(r.changes) }))(applyChanges(extra.design, numeric(picked))) : extra; }
      }
    }
    return applyChanges(d, numeric(picked));
    function numeric(list) { return list.map(s => {
      const cur = d.params[s.part][s.param], width = s.max - s.min;
      let to = quant(s, cur + gauss(rng) * step * width);
      if (to === cur) to = quant(s, cur + (rng() < 0.5 ? -s.step : s.step) * (s.int ? 1 : Math.max(1, Math.round(step * width / s.step))));
      if (to === cur) to = quant(s, cur === s.max ? cur - s.step : cur + s.step);
      return { part: s.part, param: s.param, to };
    }); }
  }

  // migrate(d): a design written with the v1 floor parameterisation (floor.throat_mm 80-130 "above Z=0", which lay above the
  // C3.5.1(a) RV-FLOOR-BODY roof at Z=75) mapped onto v2 (concept/aeromap.js FLOOR: throat_v2 = 0.6 × throat_v1, the aero map's
  // c = throat_k · throat unchanged). Values above the v2 domain (v1 > 125 mm) are clamped to the 75 mm roof, a real change: those
  // v1 designs had a floor the regulations do not allow. A throat already inside the v2 domain (≤ 75) is left alone (v1 started at 80).
  const THROAT_V1_TO_V2 = 0.6;
  function migrate(d) {
    const out = clone(d), fl = out.params && out.params.floor;
    if (fl && typeof fl.throat_mm === "number" && fl.throat_mm > parts.BY_ID.floor.params.throat_mm.max) {
      const s = spec("floor", "throat_mm"), was = fl.throat_mm;
      fl.throat_mm = quant(s, was * THROAT_V1_TO_V2);
      out.migrated = (out.migrated || []).concat([{ part: "floor", param: "throat_mm", from: was, to: fl.throat_mm, rule: "v1 → v2 × " + THROAT_V1_TO_V2 + (was * THROAT_V1_TO_V2 > s.max ? ", clamped to the C3.5.1(a) roof" : "") }]);
    }
    // more-factors v1: a design saved before the gearbox / set-up parameters existed meant the baseline set-up; fill them in
    if (out.params && typeof out.params === "object") for (const s of parts.PARAMS) {
      if (!own(out.params, s.part)) out.params[s.part] = {};
      if (typeof out.params[s.part][s.param] !== "number") { out.params[s.part][s.param] = s.base; out.migrated = (out.migrated || []).concat([{ part: s.part, param: s.param, from: null, to: s.base, rule: "more-factors v1: absent = the baseline value" }]); }
    }
    return out;
  }
  // diff(a, b): every parameter that differs, b relative to a (material swaps carry delta null)
  function diff(a, b) {
    const out = [];
    for (const s of parts.PARAMS) {
      const x = a.params[s.part][s.param], y = b.params[s.part][s.param];
      if (Math.abs(x - y) > 1e-9) out.push({ part: s.part, param: s.param, from: x, to: y, delta: +(y - x).toFixed(4), unit: s.unit, domain_frac: +((y - x) / (s.max - s.min)).toFixed(4) });
    }
    if (mats()) for (const id of parts.MATERIAL_PARTS) { const x = materialOf(a, id), y = materialOf(b, id); if (x !== y) out.push({ part: id, param: "material", from: x, to: y, delta: null, unit: "", domain_frac: null }); }
    return out;
  }
  const fmt = (v, u) => (Math.round(v * 100) / 100) + (u ? (u === "°" ? "°" : " " + u) : "");
  const matName = id => { const m = mats() && mats().get(id); return m ? m.name : String(id); };
  function describeChange(c) {
    const part = parts.BY_ID[c.part].name.split(" (")[0];
    if (c.param === "material") return part + " · material " + matName(c.from) + " → " + matName(c.to);
    const s = spec(c.part, c.param); return part + " · " + s.label + " " + fmt(c.from, s.unit) + " → " + fmt(c.to, s.unit);
  }
  // describe(design): short human lines per part with parameters, plus the headline numbers
  function describe(d) {
    const f = facts(d), lines = [];
    for (const p of parts.CATALOGUE) { const ks = Object.keys(p.params); if (!ks.length) continue; lines.push(p.name.split(" (")[0] + ": " + ks.map(k => p.params[k].label.toLowerCase() + " " + fmt(d.params[p.id][k], p.params[k].unit)).join(", ")); }
    const ms = f.mass.materials || {}; for (const id of Object.keys(ms)) lines.push(parts.BY_ID[id].name.split(" (")[0] + ": material " + matName(ms[id].material) + " (mass ×" + ms[id].mass_factor.toFixed(3) + " of its material share, stiffness ×" + ms[id].stiffness_ratio.toFixed(2) + ")");
    lines.push("Mass " + f.mass.total_kg + " kg (parts " + f.mass.parts_kg + ", ballast " + f.mass.ballast_kg + "), front " + (f.mass.front_share * 100).toFixed(1) + " %, CoG height " + f.mass.cog_height_mm + " mm above the ground, Izz " + f.mass.izz_kgm2 + " kg·m²");
    lines.push("Aero (" + aeromap.VERSION + "): downforce ×" + f.aero.df.toFixed(3) + ", drag ×" + f.aero.cd.toFixed(3) + " (straight mode ×" + f.aero.cd_sm.toFixed(3) + "), balance " + (f.aero.balance * 100).toFixed(1) + " % front");
    return lines;
  }

  // facts: everything concept/regs.js checks and concept/physical.js needs, from the design alone
  function facts(d, opts) {
    const p = d.params, g = parts.geometry(p);
    return {
      geometry: g, front_wing: p.front_wing, rear_wing: p.rear_wing, floor: p.floor, params: p,
      plank_wear_mm: +parts.plankWear(p.floor.ride_height_mm).toFixed(3),
      mass: parts.massSheet(p, { session: opts && opts.session, overrides: d.overrides }),
      aero: aeromap.evaluate(p),
      gearing: parts.gearSet(p),   // more-factors v1: the eight ratios the design declares (C9.6, concept/regs.js SETUP_RULES)
    };
  }

  const api = { seededRng, gauss, own, spec, THROAT_V1_TO_V2, migrate, baseline, REF_STRAIGHT_MODE, TEAMS, clone, validate, applyChanges, mutate, diff, describe, describeChange, facts };
  C.design = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
