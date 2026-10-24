// PURPLE CONCEPT DESIGNER - where on the lap a change gained or lost time: the physics lap sim's own time-at-distance (read-only
// public API, concept/sim/index.js simulateLap(car, "silverstone", conditions, { debug: true }).debug.tAt) cut into named corner
// complexes and the straights between them. The corner windows are the sim's own (cornerTable: the telemetry corner markers
// T1-T18); overlapping windows merge into one complex (Maggotts-Becketts-Chapel, Vale-Club), gaps under GAP_M metres are folded into
// the corner before them, every other gap is a straight. The segments partition the lap from the control line, so their times
// sum to the sim's lap (each is rounded to 1 ms, so the sum can differ from the lap by a few ms).
// segmentTimes(design, opts) -> { lap_s, segments: [{ name, kind: "corner"|"straight", t_s }] }  (cached per design)
// segmentDelta(before, after) -> [{ name, kind, d_s }]   (after - before; negative = faster), lap order
// Same car the bench simulates: concept/physical.js physical(design, opts) with the bench's energy guard (concept/bench.js guardEnergy).
// Silverstone + the physics sim only (null otherwise). Label: the physics lap sim's (concept/sim LABEL).
// Dual browser / Node: window.EI.concept.designerSegments and module.exports.
(function () {
  const root = typeof window !== "undefined" ? window : globalThis;
  const EI = (root.EI = root.EI || {}); const C = (EI.concept = EI.concept || {});
  const req = (name, file) => C[name] || (typeof require === "function" ? require(file) : null);
  const bench = req("bench", "../bench.js"), phys = req("physical", "../physical.js");

  const GAP_M = 40, CIRCUIT = "silverstone";
  const STRAIGHT_AFTER = { Aintree: "Wellington Str", "Maggotts-Becketts-Chapel": "Hangar Str" }, WRAP_NAME = "Hamilton Str";
  const r3 = v => Math.round(v * 1000) / 1000;
  const shortName = n => String(n).replace(/\s*\(T[\d-]+\)\s*$/, "").replace(/^The /, "");

  function sim() { const s = bench.physicsSim && bench.physicsSim(); return s && typeof s.simulateLap === "function" && typeof s.cornerTable === "function" ? s : null; }

  let layoutCache = null;
  // the lap's segments in the sim's distance frame: [{ name, kind, s0, s1 }] covering [0, L) (the wrap straight is two pieces)
  function layout() {
    if (layoutCache) return layoutCache;
    const S = sim(); if (!S) return null;
    const tr = S.buildTrack(CIRCUIT), L = tr.L || tr.n * tr.ds;
    const wins = S.cornerTable().map(r => ({ names: [shortName(r.name)], s0: r.s0, s1: r.s1 })).sort((a, b) => a.s0 - b.s0);
    const merged = [];
    for (const w of wins) {
      const last = merged[merged.length - 1];
      if (last && w.s0 <= last.s1) { last.s1 = Math.max(last.s1, w.s1); for (const n of w.names) if (!last.names.includes(n)) last.names.push(n); }
      else merged.push({ names: w.names.slice(), s0: w.s0, s1: w.s1 });
    }
    const corners = merged.map(m => ({ name: m.names.join("-"), first: m.names[0], last: m.names[m.names.length - 1], kind: "corner", s0: m.s0, s1: m.s1 }));
    const segs = [];
    for (let i = 0; i < corners.length; i++) {
      const c = corners[i], next = corners[i + 1];
      segs.push({ name: c.name, kind: c.kind, s0: c.s0, s1: c.s1 });
      if (!next) break;
      if (next.s0 - c.s1 < GAP_M) segs[segs.length - 1].s1 = next.s0;
      else segs.push({ name: STRAIGHT_AFTER[c.name] || c.last + "-" + next.first, kind: "straight", s0: c.s1, s1: next.s0 });
    }
    // the straight through the control line: last corner -> L and 0 -> first corner
    segs.push({ name: WRAP_NAME, kind: "straight", s0: corners[corners.length - 1].s1, s1: corners[0].s0 + L, wrap: true });
    return (layoutCache = { L, segs, tr });
  }

  const cache = new Map();
  function keyOf(d) { return JSON.stringify([d.params, d.overrides || null, d.team || null]); }
  // segmentTimes(design, opts) -> { lap_s, segments } | null (no physics sim loaded)
  function segmentTimes(d, opts) {
    const lay = layout(); if (!lay) return null;
    const k = keyOf(d), hit = cache.get(k); if (hit) return hit;
    const o = Object.assign({ circuit: CIRCUIT }, opts || {});
    const pc = bench.guardEnergy(phys.physical(d, o));
    const r = sim().simulateLap(pc, CIRCUIT, o.conditions || undefined, { debug: true });
    const t = r.debug.tAt, idx = s => r.debug.track.idxAtS(((s % lay.L) + lay.L) % lay.L), lap = r.lap_s;
    const span = (a, b) => { let x = t[idx(b)] - t[idx(a)]; while (x < 0) x += lap; return x; };
    const out = { lap_s: lap, segments: lay.segs.map(s => ({ name: s.name, kind: s.kind, t_s: r3(span(s.s0, s.s1)) })) };
    cache.set(k, out); if (cache.size > 2000) cache.delete(cache.keys().next().value);
    return out;
  }
  // after - before per segment (negative = faster), in lap order
  function segmentDelta(before, after) {
    if (!before || !after) return null;
    return after.segments.map((s, i) => ({ name: s.name, kind: s.kind, d_s: r3(s.t_s - before.segments[i].t_s) }));
  }
  // the n biggest gains (most negative) and losses (most positive) with |d| >= min: { gain: ["Stowe -0.012"], loss: [...] }
  function topMoves(delta, n, min) {
    if (!delta) return null;
    n = n == null ? 2 : n; min = min == null ? 0.001 : min;
    const f = x => x.name + " " + (x.d_s > 0 ? "+" : "") + x.d_s.toFixed(3);
    const gain = delta.filter(x => x.d_s <= -min).sort((a, b) => a.d_s - b.d_s).slice(0, n).map(f);
    const loss = delta.filter(x => x.d_s >= min).sort((a, b) => b.d_s - a.d_s).slice(0, n).map(f);
    return { gain, loss };
  }

  const api = { GAP_M, layout, segmentTimes, segmentDelta, topMoves, clearCache: () => cache.clear() };
  C.designerSegments = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
