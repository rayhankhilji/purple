// PURPLE CONCEPT - concept car view v3: dimensional accuracy. Builds the car's meshes (concept/view/car3d.js, the same vertices the
// browser draws) for the baseline and mutated designs and MEASURES them: wheelbase, track, tyre sizes, ride height, wing spans /
// chords / element counts / angles / endplate heights, floor width / throat, diffuser expansion, sidepod inlet area and undercut,
// cell anchors (cockpit, ICE face). Tolerance 2 mm (angles 0.3°, inlet area 0.5 %). Legal designs must stay inside the
// concept/regs.js limits (width, wing envelopes, endplate top, floor width).
"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const parts = require("../concept/parts.js"), design = require("../concept/design.js"), regs = require("../concept/regs.js");
const car3d = require("../concept/view/car3d.js");

const TOL = 2;   // mm
const mmX = (x) => (1750 - x * 1000);                // world x (m) -> FIA X (mm)
const all = (G) => Object.values(G).flatMap(g => g.items);
const byName = (G, re) => all(G).filter(it => re.test(it.name));
function verts(items, fn) { for (const it of items) { const P = it.geo.pos; for (let i = 0; i < P.length; i += 3) fn(P[i], P[i + 1], P[i + 2], it); } }
function bbox(items) { const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity]; verts(items, (x, y, z) => { const v = [x, y, z]; for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a], v[a]); hi[a] = Math.max(hi[a], v[a]); } }); return { lo, hi }; }
// the worst deviation per measured quantity, over every design (reported by the last test)
const DEV = {};
const near = (a, b, tol, msg) => {
  const k = msg.replace(/^\S+ /, ""), d = Math.abs(a - b); if (!DEV[k] || d > DEV[k].d) DEV[k] = { d, tol };
  assert.ok(d <= tol, `${msg}: measured ${(+a).toFixed(3)}, expected ${(+b).toFixed(3)} (±${tol})`);
};
const Zof = (S, y) => y * 1000 - 10 - S.rh;          // world y -> FIA Z (sprung frame)

// designs: baseline (generic and RB22), fixed extremes inside the domain, and seeded mutations
function designs() {
  const out = [["baseline", design.baseline()], ["redbull", design.baseline("redbull")]];
  const B = design.baseline();
  const set = (label, changes) => out.push([label, design.applyChanges(B, changes).design]);
  set("fw-wide-2el", [{ part: "front_wing", param: "span_mm", to: 1340 }, { part: "front_wing", param: "elements", to: 2 }, { part: "front_wing", param: "aoa_deg", to: 34 }, { part: "front_wing", param: "chord_mm", to: 520 }]);
  set("rw-3el-high", [{ part: "rear_wing", param: "elements", to: 3 }, { part: "rear_wing", param: "aoa_deg", to: 12 }, { part: "rear_wing", param: "chord_mm", to: 460 }, { part: "rear_wing", param: "endplate_top_mm", to: 875 }, { part: "rear_wing", param: "span_mm", to: 1150 }]);
  set("short-low", [{ part: "layout", param: "wheelbase_mm", to: 3250 }, { part: "floor", param: "ride_height_mm", to: 28 }, { part: "floor", param: "width_mm", to: 1300 }, { part: "floor", param: "throat_mm", to: 118 }, { part: "diffuser", param: "expansion_deg", to: 18.5 }]);
  set("pods", [{ part: "sidepods", param: "inlet_cm2", to: 900 }, { part: "sidepods", param: "undercut_mm", to: 180 }, { part: "survival_cell", param: "cockpit_len_mm", to: 1990 }, { part: "survival_cell", param: "front_axle_offset_mm", to: 140 }]);
  set("small", [{ part: "sidepods", param: "inlet_cm2", to: 420 }, { part: "sidepods", param: "undercut_mm", to: 20 }, { part: "front_wing", param: "elements", to: 1 }, { part: "rear_wing", param: "elements", to: 1 }, { part: "front_wing", param: "span_mm", to: 1100 }, { part: "rear_wing", param: "span_mm", to: 960 }]);
  // mutants move only the parameters this test measures: the more-factors v1 set-up / gearing values have no geometry, and the
  // redesigns v1 concept families (parts.CONCEPTS) are measured by the view's own concept tests; locking them keeps the seeded
  // mutants identical to the ones this test was written for
  const locked = ["gearbox.top_kmh", "gearbox.step", "setup.roll_front", "setup.heave_n_mm", "setup.brake_bias"].concat(Object.keys(parts.CONCEPTS || {}));
  const rng = design.seededRng(2026); let d = B;
  for (let i = 0; i < 4; i++) { for (let k = 0; k < 6; k++) d = design.mutate(d, rng, 0.15, { locked }).design; out.push(["mutant" + i, design.clone(d)]); }
  return out;
}
const CASES = designs().map(([label, d]) => { const S = car3d.spec(d.params), t0 = Date.now(), G = car3d.buildAll(S, { flap: 0 }); return { label, d, S, G, ms: Date.now() - t0, legal: regs.check(d).length === 0 }; });

test("wheels: wheelbase, track, 2026 tyre diameter and tread width, contact on the ground", () => {
  for (const { label, S, G } of CASES) {
    const f = bbox(byName(G, /^f_tyre_R$/)), r = bbox(byName(G, /^r_tyre_R$/)), fl = bbox(byName(G, /^f_tyre_L$/));
    const xf = mmX((f.lo[0] + f.hi[0]) / 2), xr = mmX((r.lo[0] + r.hi[0]) / 2);
    near(xr - xf, S.XR, TOL, label + " wheelbase");
    near(((f.lo[2] + f.hi[2]) / 2 - (fl.lo[2] + fl.hi[2]) / 2) * 1000, 1580, TOL, label + " front track");
    near((f.hi[0] - f.lo[0]) * 1000, 705, TOL, label + " front tyre OD");
    near((r.hi[0] - r.lo[0]) * 1000, 710, TOL, label + " rear tyre OD");
    near(f.lo[1] * 1000, 0, 0.01, label + " front tyre on the ground");
    // tread: axial extent of the surface within 5 mm of the full radius
    for (const [nm, wh, tread] of [["f_tyre_R", S.wheel.front, 280], ["r_tyre_R", S.wheel.rear, 375]]) {
      const cx = (1750 - wh.X) / 1000, cy = wh.hc / 1000; let zlo = Infinity, zhi = -Infinity;
      verts(byName(G, new RegExp("^" + nm + "$")), (x, y, z) => { if (Math.hypot(x - cx, y - cy) * 1000 >= wh.od / 2 - 5 - 1e-6) { zlo = Math.min(zlo, z); zhi = Math.max(zhi, z); } });
      near((zhi - zlo) * 1000, tread, TOL, label + " " + nm + " tread width");
    }
  }
});

test("ride height and plank: plank bottom at the static ride height, 10 mm thick", () => {
  for (const { label, S, G } of CASES) {
    const b = bbox(byName(G, /^plank$/));
    near(b.lo[1] * 1000, S.rh, TOL, label + " plank bottom above the ground");
    near((b.hi[1] - b.lo[1]) * 1000, 10, TOL, label + " plank thickness");
  }
});

test("survival cell anchors: cockpit opening relative to XC, body sections at XA and XPU, wheelbase-referenced tail", () => {
  for (const { label, S, G } of CASES) {
    const ck = { lo: [Infinity], hi: [-Infinity] }; verts(byName(G, /^cockpit_tub$/), (x, y, z) => { if (Math.abs(z) > 0.005) { ck.lo[0] = Math.min(ck.lo[0], x); ck.hi[0] = Math.max(ck.hi[0], x); } });   // where the opening has width
    near(mmX(ck.hi[0]), S.XC - 905, TOL, label + " cockpit opening front (XC - 905)");
    near(mmX(ck.lo[0]), S.XC - 30, TOL, label + " cockpit opening rear (XC - 30)");
    const body = byName(G, /^body$/), at = (X) => { let w = 0; verts(body, (x, y, z) => { if (Math.abs(mmX(x) - X) < 0.01) w = Math.max(w, Math.abs(z) * 1000); }); return w; };
    near(at(S.XA), car3d.bodyAt(S, S.XA).yw, TOL, label + " body half width at the cell front XA");
    near(at(S.XPU), car3d.bodyAt(S, S.XPU).yw, TOL, label + " body half width at the ICE face XPU");
  }
});

test("front wing: span, element count, local chords (mean = chord), flap and main-plane angles, straight-mode extent", () => {
  for (const { label, d, S, G } of CASES) {
    const fw = d.params.front_wing, n = Math.round(fw.elements), els = byName(G, /^fw_el\d+_(top|bot|te)$/);
    assert.equal(new Set(els.map(i => i.name.match(/^fw_el(\d+)/)[1])).size, n, label + " front wing element count");
    const b = bbox(els); near(b.hi[2] * 1000, fw.span_mm / 2, TOL, label + " front wing half span"); near(-b.lo[2] * 1000, fw.span_mm / 2, TOL, label + " front wing half span (left)");
    // X extent per station (vertices share the station's z), trapezoid mean over the span
    const st = new Map(); verts(els, (x, y, z) => { const k = z.toFixed(6), e = st.get(k) || [Infinity, -Infinity]; e[0] = Math.min(e[0], x); e[1] = Math.max(e[1], x); st.set(k, e); });
    const keys = Array.from(st.keys()).sort((a, b) => Number(a) - Number(b)), ys = keys.map(Number); let area = 0;
    for (let i = 1; i < ys.length; i++) { const a = st.get(keys[i - 1]), c = st.get(keys[i]); area += (ys[i] - ys[i - 1]) * ((a[1] - a[0]) + (c[1] - c[0])) / 2; }
    near(area / (ys[ys.length - 1] - ys[0]) * 1000, fw.chord_mm, TOL, label + " front wing mean chord");
    // angles from the chord lines (upper TE + lower TE midpoint to the LE) at the centre station
    for (let ei = 0; ei < n; ei++) {
      const top = byName(G, new RegExp("^fw_el" + ei + "_top$"))[0], bot = byName(G, new RegExp("^fw_el" + ei + "_bot$"))[0];
      const ang = chordAngle(top, bot);
      near(ang, ei === 0 ? (n >= 2 ? fw.aoa_deg / 5 : fw.aoa_deg / 2) : fw.aoa_deg, 0.3, label + " FW element " + ei + " angle (deg)");
    }
    // legal designs: every element inside RV-FW-PROFILES' X range at its |Y|
    if (regs.check(d).every(v => !/^REG-C-FW/.test(v.id))) for (const k of keys) {
      const y = Number(k), e = st.get(k), ay = Math.min(675, Math.abs(y) * 1000), front = ay <= 100 ? -1250 : -1250 + (225 / 600) * (ay - 100), rear = Math.min(-475, -750 + 0.625 * ay);
      assert.ok(mmX(e[1]) >= front - 1.5 && mmX(e[0]) <= rear + 1.5, label + " FW inside RV-FW-PROFILES at |Y| " + ay.toFixed(0));
    }
  }
  // straight mode: the flap group's rotation lengthens the X extent exactly as concept/regs.js fwStraightExtent says
  for (const { label, d, S } of CASES) {
    const fw = d.params.front_wing; if (!(fw.sm_delta_deg > 0 && fw.elements >= 2)) continue;
    const G1 = car3d.buildGroup("front_wing", S, { flap: 1 }), els = G1.items.filter(i => /^fw_el\d+_(top|bot|te)$/.test(i.name));
    const st = new Map(); verts(els, (x, y, z) => { const k = z.toFixed(6), e = st.get(k) || [Infinity, -Infinity]; e[0] = Math.min(e[0], x); e[1] = Math.max(e[1], x); st.set(k, e); });
    const keys = Array.from(st.keys()).sort((a, b) => Number(a) - Number(b)), ys = keys.map(Number); let area = 0;
    for (let i = 1; i < ys.length; i++) { const a = st.get(keys[i - 1]), c = st.get(keys[i]); area += (ys[i] - ys[i - 1]) * ((a[1] - a[0]) + (c[1] - c[0])) / 2; }
    near(area / (ys[ys.length - 1] - ys[0]) * 1000, regs.fwStraightExtent(fw), TOL, label + " FW straight-mode mean X extent = regs.fwStraightExtent");
  }
});
function chordAngle(top, bot) {
  // ring layout: the top strip runs upper TE -> LE (rs points per station ring), the bottom strip LE -> lower TE (same ring size);
  // the chord line joins the LE to the midpoint of the two TE points; the middle ring is the centre station
  const P = top.geo.pos, Q = bot.geo.pos, n = top.geo.count;
  let rs = 1; while (rs < n && Math.abs(P[rs * 3 + 2] - P[2]) < 1e-9) rs++;   // consecutive vertices of one ring share z
  const r = Math.floor((n / rs) / 2), iTE = r * rs, iLE = r * rs + rs - 1, jTE = r * rs + rs - 1;
  const te = [(P[iTE * 3] + Q[jTE * 3]) / 2, (P[iTE * 3 + 1] + Q[jTE * 3 + 1]) / 2], le = [P[iLE * 3], P[iLE * 3 + 1]];
  return Math.atan2(te[1] - le[1], le[0] - te[0]) * 180 / Math.PI;
}

test("rear wing: span, chord at every station, element count, flap angle, endplate top, RV-RW-PROFILES for legal designs", () => {
  for (const { label, d, S, G } of CASES) {
    const rw = d.params.rear_wing, n = Math.round(rw.elements), els = byName(G, /^rw_el\d+(_tip[LR])?_(top|bot|te)$/);
    assert.equal(new Set(els.map(i => i.name.match(/^rw_el(\d+)/)[1])).size, n, label + " rear wing element count");
    const b = bbox(els); near(b.hi[2] * 1000, rw.span_mm / 2, TOL, label + " rear wing half span");
    const st = new Map(); verts(els, (x, y, z) => { const k = z.toFixed(6), e = st.get(k) || [Infinity, -Infinity]; e[0] = Math.min(e[0], x); e[1] = Math.max(e[1], x); st.set(k, e); });
    let worst = 0; for (const [, e] of st) worst = Math.max(worst, Math.abs((e[1] - e[0]) * 1000 - rw.chord_mm));
    near(worst, 0, TOL, label + " rear wing chord at every station (worst station)");
    near(mmX(b.hi[0]), S.XR + 165, TOL, label + " rear wing leading edge at XR+165");
    for (let ei = 0; ei < n; ei++) { const top = byName(G, new RegExp("^rw_el" + ei + "_top$"))[0], bot = byName(G, new RegExp("^rw_el" + ei + "_bot$"))[0]; near(chordAngle(top, bot), ei === 0 ? (n >= 2 ? rw.aoa_deg / 5 : rw.aoa_deg / 2) : rw.aoa_deg, 0.3, label + " RW element " + ei + " angle"); }
    const ep = bbox(byName(G, /^rw_endplate_R$/)); near(Zof(S, ep.hi[1]), rw.endplate_top_mm, TOL, label + " rear endplate top (Z)");
    if (regs.check(d).every(v => !/^REG-C-RW/.test(v.id))) {
      assert.ok(mmX(b.lo[0]) <= S.XR + 630 + 1 && mmX(b.hi[0]) >= S.XR + 165 - 1, label + " RW inside RV-RW-PROFILES in X");
      assert.ok(b.hi[2] * 1000 <= 575 + 1, label + " RW inside RV-RW-PROFILES in Y");
      assert.ok(Zof(S, b.hi[1]) <= 880 + 1 && Zof(S, ep.hi[1]) <= 880 + 1, label + " RW profiles and endplate under Z 880");
    }
  }
});

test("floor and diffuser: floor body width, venturi throat, diffuser expansion angle", () => {
  for (const { label, d, S, G } of CASES) {
    const fl = d.params.floor, body = byName(G, /^floor_body$/), bb = bbox(body);
    near(bb.hi[2] * 1000, fl.width_mm / 2, TOL, label + " floor body half width");
    near(-bb.lo[2] * 1000, fl.width_mm / 2, TOL, label + " floor body half width (left)");
    let zmin = Infinity, zmax = -Infinity;
    verts(body, (x, y, z) => { const X = mmX(x), Y = Math.abs(z) * 1000; if (X > S.fl.xThroat + 50 && X < S.fl.xKink - 50 && Y > 170 && Y < 420) { const Z = Zof(S, y); zmin = Math.min(zmin, Z); zmax = Math.max(zmax, Z); } });
    near(zmin, fl.throat_mm, TOL, label + " venturi throat (tunnel roof Z)"); near(zmax, fl.throat_mm, TOL, label + " tunnel roof flat at the throat");
    const pts = []; verts(byName(G, /^diffuser_body$/), (x, y, z) => { const X = mmX(x), Y = Math.abs(z) * 1000; if (X > S.fl.xKink + 40 && X < S.fl.xExit - 40 && Y > 170 && Y < 420) pts.push([X, Zof(S, y)]); });
    pts.sort((a, b) => a[0] - b[0]); const a = pts[0], c = pts[pts.length - 1];
    near(Math.atan2(c[1] - a[1], c[0] - a[0]) * 180 / Math.PI, d.params.diffuser.expansion_deg, 0.1, label + " diffuser expansion angle (deg)");
    if (regs.check(d).every(v => v.id !== "REG-C-FLOOR-WIDTH")) assert.ok(bb.hi[2] * 1000 <= 770 + 1, label + " floor body inside RV-FLOOR-BODY (|Y| ≤ 770)");
  }
});

test("sidepods: inlet opening area = inlet_cm2 (both sides), undercut depth", () => {
  for (const { label, d, S, G } of CASES) {
    const sp = d.params.sidepods;
    for (const side of ["R", "L"]) {
      const duct = byName(G, new RegExp("^pod_duct_" + side + "$"))[0], n = duct.meta.inletRing, P = duct.geo.pos;
      let A = 0; for (let i = 0; i < n; i++) { const j = (i + 1) % n; A += P[i * 3 + 2] * P[j * 3 + 1] - P[j * 3 + 2] * P[i * 3 + 1]; }
      const area = Math.abs(A) / 2 * 1e6;   // mm²
      near(area, sp.inlet_cm2 * 100 / 2, sp.inlet_cm2 * 100 / 2 * 0.005, label + " inlet area per side (" + side + ", mm²)");
    }
    // undercut: at XS+300 the shoulder (max |Y|) minus the pod's |Y| at its bottom (Z ≤ bottom + 0.5)
    const X = S.pod.X + 300, pod = byName(G, /^sidepod_R$/); let yo = 0, yb = 0, zb = Infinity;
    verts(pod, (x, y, z) => { if (Math.abs(mmX(x) - X) < 0.01) { yo = Math.max(yo, z * 1000); zb = Math.min(zb, Zof(S, y)); } });
    verts(pod, (x, y, z) => { if (Math.abs(mmX(x) - X) < 0.01 && Zof(S, y) <= zb + 0.5) yb = Math.max(yb, z * 1000); });
    near(yo - yb, sp.undercut_mm, TOL, label + " undercut depth");
  }
});

test("legal designs stay inside the regs.js limits: overall width (wheels excepted), wheelbase", () => {
  for (const { label, S, G, legal } of CASES) {
    if (!legal) continue;
    let w = 0; for (const g of Object.values(G)) if (g.id !== "wheels") verts(g.items, (x, y, z) => { w = Math.max(w, Math.abs(z) * 1000); });
    assert.ok(w <= 950 + 0.5, label + " no part beyond |Y| 950 (C2.3.1), measured " + w.toFixed(1));
    assert.ok(S.XR <= 3400, label + " wheelbase");
  }
  assert.ok(CASES.filter(c => c.legal).length >= 3, "at least three legal designs measured");
});

test("every vertex finite; builds are fast enough in Node (generous bound; browser timings in VIEW.md)", () => {
  for (const { label, G, ms } of CASES) {
    for (const it of all(G)) for (const v of it.geo.pos) assert.ok(Number.isFinite(v), label + " " + it.name + " has a non-finite vertex");
    assert.ok(ms < 3000, label + " full build " + ms + " ms");
  }
});

test("report: worst deviation per measured quantity over " + CASES.length + " designs", (t) => {
  const rows = Object.keys(DEV).sort().map(k => k + ": " + DEV[k].d.toFixed(3) + " (tol " + DEV[k].tol + ")");
  for (const r of rows) t.diagnostic(r);
  assert.ok(rows.length >= 20, "measured " + rows.length + " quantities");
});
