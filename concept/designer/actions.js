// PURPLE CONCEPT DESIGNER - the ACTION MENU of the action-choosing designer task (concept/designer/prompt-action.js, "action-1").
// The answer of that task is ONE code from a fixed catalogue, so Mubit's small adapter learns a classification over a stable set of
// choices instead of free text or continuous numbers.
//   CATALOGUE: every parameter of concept/parts.js PARAMS (shape parameters and concept families), one step UP and one step DOWN,
//   sorted by parameter key ("part.param") then direction (+ before -). code = "A" + the 1-based index in that order, two digits
//   (A01 ... A72). The code of an action never depends on the car: the same action has the same code in every state.
//   One step = the parameter's catalogue step times round(STEP_FRACTION × the FIA-tightened box width / step), at least one step
//   (floor.width_mm: box 1200-1540 -> 5 % = 17 -> 2 steps = 20 mm); integer counts and concept families move by one (next / previous
//   code). The step is fixed per action (it never depends on the car either).
//   menu(head, { legal }): the actions that are legal from this head car, in catalogue order: the new value inside the FIA-tightened
//   box of concept/campaign/space.js and, when `legal(design)` is given (the engine passes its full FIA / PU / materials check), the
//   whole car legal after the step. Illegal actions are skipped; the codes of the rest do not move.
//   attach(sc, head, opts): the scenario of concept/engineer/scenario.js fit() plus the menu as text after the scenario JSON (the user
//   message of the action task). strip(text): the scenario JSON again (mock proposers read it).
// The code table is pinned by test/concept-designer-action.test.js (a new parameter in parts.js would shift codes: that test fails).
"use strict";
const parts = require("../parts.js"), space = require("../campaign/space.js"), design = require("../design.js");

const STEP_FRACTION = 0.05;
const MENU_HEADER = "ACTION MENU (code parameter step -> new value):";
const keyOf = s => s.part + "." + s.param;
const r6 = v => +(+v).toFixed(6);
const decimals = step => { const s = String(step); const i = s.indexOf("."); return i < 0 ? 0 : s.length - i - 1; };
const fmt = (step, v) => String(+(+v).toFixed(decimals(step)));
const pad = n => (n < 10 ? "0" : "") + n;

const BOX = new Map(space.VARS.map(v => [v.key, v]));
function stepOf(s) {
  if (s.int || s.concept) return s.step;
  const b = BOX.get(keyOf(s)) || { lo: s.min, hi: s.max };
  return r6(Math.max(1, Math.round(STEP_FRACTION * (b.hi - b.lo) / s.step)) * s.step);
}
const CATALOGUE = (() => {
  const specs = parts.PARAMS.slice().sort((a, b) => (keyOf(a) < keyOf(b) ? -1 : keyOf(a) > keyOf(b) ? 1 : 0));
  const out = [];
  for (const s of specs) for (const dir of [1, -1]) {
    const step = stepOf(s), b = BOX.get(keyOf(s)) || { lo: s.min, hi: s.max };
    out.push({ code: "A" + pad(out.length + 1), key: keyOf(s), part: s.part, param: s.param, dir, delta: r6(dir * step), step: s.step, lo: b.lo, hi: b.hi, concept: !!s.concept });
  }
  return Object.freeze(out.map(Object.freeze));
})();
const BY_CODE = new Map(CATALOGUE.map(a => [a.code, a]));
const CODE_RE = /^A\d{2}$/;

// the line of one action: "A31 floor.width_mm +20 -> 1470" (a concept family adds the new code's name: "+1 -> 1 zeropod")
function lineOf(a, to) {
  const fam = a.concept && parts.CONCEPTS[a.key], id = fam && fam.codes[Math.round(to)] ? " " + fam.codes[Math.round(to)].id : "";
  return a.code + " " + a.key + " " + (a.delta > 0 ? "+" : "-") + fmt(a.step, Math.abs(a.delta)) + " -> " + fmt(a.step, to) + id;
}
// menu(head, { legal? }) -> [{ code, part, param, from, to, line }] in catalogue order (only the legal actions)
function menu(head, opts) {
  const legal = opts && opts.legal, out = [];
  for (const a of CATALOGUE) {
    const from = head.params[a.part] && head.params[a.part][a.param];
    if (typeof from !== "number" || !isFinite(from)) continue;
    const to = r6(from + a.delta);
    if (to < a.lo - 1e-9 || to > a.hi + 1e-9) continue;
    if (legal) {
      let d = null; try { const r = design.applyChanges(head, [{ part: a.part, param: a.param, to }]); d = r.changes.length ? r.design : null; } catch (e) { d = null; }
      if (!d || !legal(d)) continue;
    }
    out.push({ code: a.code, part: a.part, param: a.param, from, to, line: lineOf(a, to) });
  }
  return out;
}
const menuText = m => [MENU_HEADER].concat(m.map(x => x.line)).join("\n");
// the scenario (concept/engineer/scenario.js fit() result) -> the same object with the menu and the action task's user message
function attach(sc, head, opts) {
  const m = menu(head, opts), text = sc.text + "\n" + menuText(m);
  return Object.assign({}, sc, { menu: m, text, chars: text.length, tokens: Math.ceil(text.length / 4), scenario_chars: sc.chars, menu_chars: text.length - sc.text.length });
}
// the user message of the action task -> the scenario JSON text before the menu (unchanged text for any other task)
function strip(text) { const s = String(text), i = s.indexOf("\n" + MENU_HEADER); return i < 0 ? s : s.slice(0, i); }
// the menu lines of a user message -> [{ code, key, to }] (mock proposers and tests read the menu back from the text)
function readMenu(text) {
  const s = String(text), i = s.indexOf("\n" + MENU_HEADER); if (i < 0) return [];
  return s.slice(i + MENU_HEADER.length + 2).split("\n").map(l => /^(A\d{2}) (\S+) [+-][\d.]+ -> (-?[\d.]+)/.exec(l)).filter(Boolean).map(m => ({ code: m[1], key: m[2], to: +m[3] }));
}

module.exports = { STEP_FRACTION, MENU_HEADER, CATALOGUE, BY_CODE, CODE_RE, stepOf, lineOf, menu, menuText, attach, strip, readMenu };
