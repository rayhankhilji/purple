// PURPLE TESTS TO POLE - a cheap STAND-IN for the failure measured in the recorded steered runs (docs/concept/TESTS_TO_POLE.md §5):
// it is NOT a model and its numbers say nothing about Claude. It only shows whether the physics-corrections block
// (concept/engineer/scenario.js) carries what a reader needs to break that failure, reading nothing but the scenario text.
//   - fixation: 80 % of decisions name rear_wing.aoa_deg (± 0.5 or 1°), the rest one of a few favourites (brake bias, roll split,
//     front-wing angle); half the time it also lowers sidepods.inlet_cm2 by 10 cm² (the recorded runs' most common illegal move,
//     PKG-COOLING), like the recorded runs (96 / 93 of 120 decisions named the rear-wing angle, 64 of 120 were illegal as proposed);
//   - when the scenario has a `corrections` block: a favourite listed in rejected_repeatedly is dropped for a part from never_tried
//     (or the least-tried part) and one of its parameters (from best.params) moved inside its legal_range; the sidepod inlet is not
//     lowered below the bottom of its legal_range. Without the block it cannot do either, so it keeps the fixation.
// Deterministic for (seed, scenario texts). Answers are schema-conforming JSON; no network, no Mubit, no request id.
"use strict";
const path = require("path");
const HERE = path.join(__dirname, "..", "..");
const design = require(path.join(HERE, "concept", "design.js"));

const FIX = "rear_wing.aoa_deg", FAVS = ["setup.brake_bias", "setup.roll_front", "front_wing.aoa_deg"], ILLEGAL = "sidepods.inlet_cm2";
const STEP = { "rear_wing.aoa_deg": [0.5, 1], "setup.brake_bias": [0.25, 1], "setup.roll_front": [0.5, 2], "front_wing.aoa_deg": [0.5, 1] };
const r3 = v => Math.round(v * 1000) / 1000;

function fixationLlm(seed) {
  const rng = design.seededRng(((seed | 0) * 2654435761 + 97) >>> 0);
  const pick = a => a[Math.floor(rng() * a.length)];
  const sign = () => (rng() < 0.5 ? -1 : 1);
  return async function llm(text, meta) {
    const sc = JSON.parse(text), P = sc.best.params, C = sc.corrections || null;
    const cur = key => { const [p, k] = key.split("."); return P[p] && P[p][k]; };
    const range = key => { if (!C || !C.legal_range) return null; const [p, k] = key.split("."); const s = C.legal_range[p] && C.legal_range[p][k]; if (!s) return null; const m = /^(-?[\d.]+)-(-?[\d.]+)$/.exec(s); return m ? [+m[1], +m[2]] : null; };
    const rejected = new Set(C ? (C.rejected_repeatedly || []).map(l => l.split(" ")[0]) : []);
    const fav = rng() < 0.8 ? FIX : pick(FAVS);
    const changes = [];
    let hyp;
    if (C && rejected.has(fav)) {
      // the block says this favourite keeps failing: an untried (or least-tried) part, one of its parameters, inside its legal range
      const tried = C.tried_by_part || {};
      const part = (C.never_tried && C.never_tried.length) ? pick(C.never_tried) : Object.keys(tried).sort((a, b) => tried[a][0] - tried[b][0] || (a < b ? -1 : 1))[0];
      const all = Object.keys(P[part] || {}).map(k => part + "." + k), open = all.filter(k => { const r = range(k); return !r || r[1] > r[0]; });
      const keys = open.length ? open : all;   // a parameter whose legal range is one value cannot move
      const key = pick(keys), v = cur(key), r = range(key);
      let to;
      if (r && r[1] - r[0] <= 4) to = v + 1 <= r[1] ? v + 1 : v - 1;   // a narrow range: an integer code or count, one level
      else if (r && r[1] > r[0]) { const w = r[1] - r[0]; to = v + sign() * w * (0.05 + 0.1 * rng()); to = Math.min(r[1], Math.max(r[0], to)); if (Math.abs(to - v) < 1e-9) to = v + (v - r[0] < r[1] - v ? 1 : -1) * w * 0.1; }
      else if (r) to = r[0];
      else if (Number.isInteger(v) && v <= 4) to = v === 0 ? 1 : v - 1;   // no legal_range line: an unconstrained code / count, one level
      else to = v === 0 ? 1 : v * (1 + sign() * (0.03 + 0.05 * rng()));
      changes.push({ part, param: key.split(".")[1], to: r3(to) });
      hyp = "fixation mock: " + fav + " listed as rejected repeatedly; moved " + key + " (part " + part + ")";
    } else {
      const [a, b] = STEP[fav], v = cur(fav), r = range(fav), d = sign() * (rng() < 0.5 ? a : b);
      let to = v + d;
      if (r && (to < r[0] || to > r[1])) to = v - d;   // the block gives its legal range: the other way
      changes.push({ part: fav.split(".")[0], param: fav.split(".")[1], to: r3(to) });
      hyp = "fixation mock: " + fav;
    }
    if (rng() < 0.5) {
      const v = cur(ILLEGAL), r = range(ILLEGAL);
      let to = v - 10;
      if (r && to < r[0]) to = null;   // the block gives the legal range: never below it
      if (to != null && !changes.some(c => c.part === "sidepods" && c.param === "inlet_cm2")) changes.push({ part: "sidepods", param: "inlet_cm2", to });
    }
    return { text: JSON.stringify({ changes, hypothesis: hyp.slice(0, 160), expected: { lap_delta_s: -1, sector: 1 + Math.floor(rng() * 3) } }), mubit_request_id: null, model: "mock-fixation", mock: true };
  };
}

module.exports = { fixationLlm, FIX, FAVS, ILLEGAL };
