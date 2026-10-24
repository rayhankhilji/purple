// PURPLE CONCEPT DESIGNER - the compact scenario the designer LLM reads (the user message of the designer's Mubit task).
// Same discipline as the research agent's Scenario (ARCHITECTURE §4.5, G-MUBIT-04): everything variable lives here, numbers are
// rounded, the serialised JSON stays ≤ 1,600 chars ≈ 400 tokens (the project's chars/4 estimate, lab/schema.js approxTokens)
// in the worst case. fit() enforces it by dropping the oldest refused entries, then the oldest tested rows, then near-limit lines.
// Scenario = {
//   best:    { lap_s, gap_s (to the real 2026 pole; negative = ahead), kg, front (front weight share), params: { <part>: { <param>: n } } },
//   tested:  [{ change: "part.param from->to; ...", d_lap_s (null if illegal), ds?: [S1, S2, S3 deltas, s], kept, illegal?: [article],
//              by?: "fallback" (the change came from the seeded fallback, not from the designer),
//              gain?/loss?: ["segment -0.012"] (last row only: where on the lap the previous change gained / lost most) }]
//            (last 3 lineage rows, oldest first; the LAST row is the measured result of the previous proposal, concept/designer/loop.js)
//            d_lap_s and ds come from row.measured (the simulated Silverstone lap and sectors, after - before) when the loop wrote it,
//            else from -delta_score (the score is monotonic in the lap)
//   refused: [{ change, why }]   (≤ 1: the designer's own last proposal refused before the bench: duplicate / illegal <articles>)
//   near:    ["part.param value (max|min limit source)"]   (≤ 6 parameters whose legal headroom is ≤ 10 % of their domain;
//            regulation limits first, then model-domain edges)
// }
// Dual browser / Node: window.EI.concept.designerScenario and module.exports.
(function () {
  const root = typeof window !== "undefined" ? window : globalThis;
  const EI = (root.EI = root.EI || {}); const C = (EI.concept = EI.concept || {});
  const req = (name, file) => C[name] || (typeof require === "function" ? require(file) : null);
  const parts = req("parts", "../parts.js"), regs = req("regs", "../regs.js");

  const LIMITS = { tested: 3, refused: 1, near: 9, articles: 3, near_frac: 0.10, chars: 1800, moves: 2 };   // tested ≤ 3 like the research agent's history (G-MUBIT-04); 1,800 chars ≈ 450 tokens (LOOP.md: measured sectors + segments; 9 near lines since live run 2 showed combined floor-stall refusals)
  const approxTokens = s => Math.ceil(String(s).length / 4);
  const short = article => String(article).split(",")[0].trim();   // "C3.10.1(a), App. C2 §22.1" -> "C3.10.1(a)"
  // a violated rule as one space-free token: the FIA article ("C3.10.1(a)") or, for the model's own packaging checks whose "article"
  // is a phrase ("concept floor model v0"), the rule id ("PKG-FLOOR-STALL")
  const art = id => { const r = regs.BY_ID[id]; if (!r) return String(id); const a = short(r.article); return /^C\d/.test(a) ? a : r.id; };
  const decimals = step => { const s = String(step); return s.includes(".") ? s.split(".")[1].length : 0; };
  const fmt = (spec, v) => +(+v).toFixed(decimals(spec.step));
  const r3 = v => (typeof v === "number" && isFinite(v) ? +v.toFixed(3) : null);

  // regulation bounds per shape parameter (from concept/regs.js; the effective legal range is this ∩ the model domain).
  // Dynamic bounds (the packaging minimum wheelbase) are computed from the design. Ballast position is limited by the axle-load
  // split (C4.2), which has no per-parameter bound, so it is not listed.
  function regBounds(params) {
    const B = regs.BY_ID, g = parts.geometry(params);
    const plankMin = parts.PLANK.free_mm - B["REG-C-PLANK"].value / parts.PLANK.wear_per_mm;
    const fwZ = regs.fwProfilesChordLimit(params.front_wing);   // FIA checklist: the front wing's X+Z envelope caps the chord for this span/setting/volumes
    return {
      "layout.wheelbase_mm": { max: [B["REG-C-WB"].value, art("REG-C-WB")], min: [g.wheelbase_min_mm, "PKG-WB"] },
      "survival_cell.front_axle_offset_mm": { min: [B["REG-C-FRONT-AXLE"].min, art("REG-C-FRONT-AXLE")], max: [B["REG-C-FRONT-AXLE"].max, art("REG-C-FRONT-AXLE")] },
      "survival_cell.cockpit_len_mm": { min: [B["REG-C-COCKPIT"].min, art("REG-C-COCKPIT")], max: [B["REG-C-COCKPIT"].max, art("REG-C-COCKPIT")] },
      "survival_cell.bulkhead_gap_mm": { min: [B["REG-C-BULKHEAD"].value, art("REG-C-BULKHEAD")] },
      "front_wing.span_mm": { max: [B["REG-C-FW-SPAN"].value, art("REG-C-FW-SPAN")] },
      "front_wing.chord_mm": { max: fwZ < B["REG-C-FW-CHORD"].value ? [Math.floor(fwZ), art("REG-C-FW-PROFILES-Z")] : [B["REG-C-FW-CHORD"].value, art("REG-C-FW-CHORD")] },
      "front_wing.elements": { min: [1, art("REG-C-ELEMENTS-MIN")], max: [B["REG-C-FW-ELEMENTS"].value, art("REG-C-FW-ELEMENTS")] },
      "rear_wing.span_mm": { max: [B["REG-C-RW-SPAN"].value, art("REG-C-RW-SPAN")] },
      "rear_wing.chord_mm": { max: [B["REG-C-RW-CHORD"].value, art("REG-C-RW-CHORD")] },
      "rear_wing.elements": { min: [2, "C3.11.7(b)"], max: [B["REG-C-RW-ELEMENTS"].value, art("REG-C-RW-ELEMENTS")] },
      "rear_wing.endplate_top_mm": { max: [B["REG-C-RW-ENDPLATE"].value, art("REG-C-RW-ENDPLATE")] },
      "floor.width_mm": { max: [2 * B["REG-C-WIDTH"].value, art("REG-C-WIDTH")] },
      "floor.ride_height_mm": { min: [plankMin, art("REG-C-PLANK")] },
    };
  }
  // effective legal range of every parameter for this design: [{ key, value, lo, hi, lo_src, hi_src, headroom_frac, side }]
  // the last legal value between v (legal) and bound, stepping by the parameter's step, or null if bound itself is legal
  function legalEdge(d, s, v, bound) {
    const viol = x => { const c = { params: Object.assign({}, d.params, { [s.part]: Object.assign({}, d.params[s.part], { [s.param]: x }) }) }; return regs.check(Object.assign({}, d, c)); };
    if (bound === v) return null;
    const atBound = viol(bound); if (!atBound.length) return null;
    const dir = bound > v ? 1 : -1, n = Math.round(Math.abs(bound - v) / s.step);
    let ok = 0, bad = n, why = atBound;
    while (bad - ok > 1) { const m = (ok + bad) >> 1, w = viol(v + dir * m * s.step); if (w.length) { bad = m; why = w; } else ok = m; }
    return { value: v + dir * ok * s.step, src: art(why[0].id) };
  }
  function ranges(d) {
    const rb = regBounds(d.params), out = [], legalNow = regs.check(d).length === 0;
    for (const s of parts.PARAMS) {
      const key = s.part + "." + s.param, v = d.params[s.part][s.param], b = rb[key] || {};
      let lo = s.min, lo_src = "domain", hi = s.max, hi_src = "domain";
      if (b.min && b.min[0] > lo) { lo = b.min[0]; lo_src = b.min[1]; }
      if (b.max && b.max[0] < hi) { hi = b.max[0]; hi_src = b.max[1]; }
      // combined limits (e.g. the front wing's X+Z envelope ties its setting to its chord; ride height to floor stall): the furthest
      // legal value of this parameter with every other parameter held, found by bisection on regs.check
      if (legalNow) {
        const h = legalEdge(d, s, v, hi); if (h) { hi = h.value; hi_src = h.src; }
        const l = legalEdge(d, s, v, lo); if (l) { lo = l.value; lo_src = l.src; }
      }
      const up = hi - v, down = v - lo, w = s.max - s.min;
      const side = up <= down ? "max" : "min";
      out.push({ key, value: v, lo: fmt(s, lo), hi: fmt(s, hi), lo_src, hi_src, side, headroom_frac: +(Math.min(up, down) / w).toFixed(4) });
    }
    return out;
  }
  // parameters near (or past) a limit, regulation limits first, then model-domain edges, tightest first within each:
  // "front_wing.span_mm 1350 (max 1350 C3.10.1(a))"
  function nearLimits(d, max) {
    const dom = r => ((r.side === "max" ? r.hi_src : r.lo_src) === "domain" ? 1 : 0);
    return ranges(d).filter(r => r.headroom_frac <= LIMITS.near_frac)
      .sort((a, b) => dom(a) - dom(b) || a.headroom_frac - b.headroom_frac || (a.key < b.key ? -1 : 1))
      .slice(0, max == null ? LIMITS.near : max)
      .map(r => r.key + " " + r.value + " (" + r.side + " " + (r.side === "max" ? r.hi + " " + r.hi_src : r.lo + " " + r.lo_src) + ")");
  }

  function compactParams(d) {
    const out = {};
    for (const s of parts.PARAMS) { (out[s.part] = out[s.part] || {})[s.param] = fmt(s, d.params[s.part][s.param]); }
    return out;
  }
  // "rear_wing.aoa_deg 20->22; floor.width_mm 1800->1850"
  function describeChanges(changes) {
    return (changes || []).map(c => { const s = parts.PARAMS.find(p => p.part === c.part && p.param === c.param) || { step: 0.01 }; return c.part + "." + c.param + " " + fmt(s, c.from) + "->" + fmt(s, c.to); }).join("; ");
  }
  // one tested row from a concept/optimize.js lineage row (score = pole - lap, so lap delta = -delta_score)
  function testedRow(row) {
    const m = row.measured, legal = row.legal && (m ? m.d_lap_s != null : row.delta_score != null);
    const t = { change: describeChanges(row.changes) || "none", d_lap_s: legal ? r3(m ? m.d_lap_s : -row.delta_score) : null };
    if (legal && m && Array.isArray(m.d_sectors_s)) t.ds = m.d_sectors_s.map(r3);
    t.kept = !!row.kept;
    if (row.proposer === "fallback") t.by = "fallback";
    if (!row.legal) {
      const ids = []; for (const c of row.candidates || []) for (const v of c.violations || []) ids.push(art(v));
      if (ids.length) t.illegal = capArticles(Array.from(new Set(ids)));
    }
    return t;
  }
  // at most LIMITS.articles articles per entry, then "+N" (an illegal car usually breaks one or two rules; the cap bounds the worst case)
  function capArticles(list) { return list.length <= LIMITS.articles ? list : list.slice(0, LIMITS.articles).concat("+" + (list.length - LIMITS.articles)); }
  // "illegal C2.3.1 C3.10.1(a) ..." -> the same cap
  function capWhy(why) { const w = String(why || "").split(" "); return w[0] === "illegal" ? ["illegal"].concat(capArticles(Array.from(new Set(w.slice(1))))).join(" ") : String(why || "").slice(0, 40); }

  // build(o): o = { design (current best), summary (optimize.summary of its bench result), history (lineage rows), refused, limits }
  function build(o) {
    const L = Object.assign({}, LIMITS, o.limits || {}), s = o.summary || {};
    const sc = {
      best: { lap_s: r3(s.lap_s), gap_s: r3(s.gap_to_pole_s), kg: s.mass_kg != null ? +(+s.mass_kg).toFixed(1) : null, front: s.front_share != null ? +(+s.front_share).toFixed(3) : null, params: compactParams(o.design) },
      tested: (o.history || []).slice(-L.tested).map(testedRow),
      refused: (o.refused || []).slice(-L.refused).map(r => ({ change: r.change, why: capWhy(r.why) })),
      near: nearLimits(o.design, L.near),
    };
    // where the previous change gained / lost time on the lap (the loop's measured segments), on the last tested row only
    const last = (o.history || [])[(o.history || []).length - 1], lt = sc.tested[sc.tested.length - 1];
    if (last && lt && last.measured && last.measured.moves) {
      if (last.measured.moves.gain.length) lt.gain = last.measured.moves.gain.slice(0, L.moves);
      if (last.measured.moves.loss.length) lt.loss = last.measured.moves.loss.slice(0, L.moves);
    }
    return sc;
  }
  const serialize = sc => JSON.stringify(sc);
  // fit(o) -> { scenario, text, chars, tokens, dropped }: build, then trim until ≤ LIMITS.chars, least useful first: oldest tested
  // rows down to one, near-limit lines down to three, the last row's segment gains / losses, the refused entry, the last tested row,
  // the remaining near-limit lines.
  // The current best car is never trimmed (the model needs every current value to propose a `to`).
  function fit(o) {
    const L = Object.assign({}, LIMITS, o.limits || {});
    const sc = build(o); let text = serialize(sc), dropped = 0;
    const lastRow = () => sc.tested[sc.tested.length - 1] || {};
    while (text.length > L.chars) {
      if (sc.tested.length > 1) sc.tested.shift(); else if (sc.near.length > 3) sc.near.pop();
      else if (lastRow().loss || lastRow().gain) { const t = lastRow(); if (t.loss && t.loss.length > 1) t.loss.pop(); else if (t.gain && t.gain.length > 1) t.gain.pop(); else if (t.loss) delete t.loss; else delete t.gain; }
      else if (sc.refused.length) sc.refused.shift();
      else if (sc.tested.length) sc.tested.shift(); else if (sc.near.length) sc.near.pop(); else break;
      dropped++; text = serialize(sc);
    }
    return { scenario: sc, text, chars: text.length, tokens: approxTokens(text), dropped };
  }

  const api = { LIMITS, approxTokens, regBounds, ranges, nearLimits, compactParams, describeChanges, testedRow, build, serialize, fit, shortArticle: short, articleOf: art };
  C.designerScenario = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
