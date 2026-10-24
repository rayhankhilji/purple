// PURPLE ENGINE v2 - the SCREEN: thousands of subspace variants through the FIA checks and the µs surrogate (docs/concept/ENGINE_V2.md §4).
// screenChunk({ head, sub, seed, i0, i1, keep, explore }) generates variants i0..i1-1 of the subspace (subspace.variant, a pure
// function of (sub, seed, i)), and for each distinct car: FIA legality (concept/regs.js checkFacts) + the homologated-PU and
// material guards (concept/bench.js), then the physics surrogate's lap (concept/surrogate, physics-silverstone model). A car outside
// the surrogate's training box gets NO surrogate lap (the surrogate refuses to extrapolate); it is counted as `oob` and up to
// `explore` of them (plus every top-K slot the surrogate could not fill) are passed on UNRANKED, so the physics sim (not the
// surrogate) looks at them.
// Returns { generated, distinct, legal, illegal, oob, keys: [hash], top: [{ i, lap, changes }] (the `keep` fastest by surrogate,
// ties by index), explore: [{ i, changes }], violations: { id: n } }.
// A surrogate number is a RANKING only: it is never reported as a lap. Every reported lap is a physics-sim lap (concept/bench.js).
// ScreenPool(workers) runs chunks of a fixed size on worker threads; chunk boundaries never depend on the worker count, and the
// merge is by (surrogate lap, index), so the screened set and the top-K are identical for any number of workers.
"use strict";
const path = require("path");
const design = require("../design.js"), regs = require("../regs.js"), bench = require("../bench.js"), phys = require("../physical.js");
const subspace = require("./subspace.js");

const CHUNK = 250, CIRCUIT = "silverstone";
let S = null;
const surrogate = () => S || (S = require("../surrogate/surrogate.js"));
// canonical key of a variant: its sorted change list (variants share the head)
const keyOfChanges = ch => ch.map(c => c.part + "." + c.param + "=" + c.to).sort().join(";");

function screenChunk(o) {
  const out = { i0: o.i0, i1: o.i1, generated: 0, distinct: 0, legal: 0, illegal: 0, oob: 0, keys: [], top: [], explore: [], along: [], violations: {} };
  const seen = new Set(), keep = o.keep == null ? 32 : o.keep, explore = o.explore == null ? 2 : o.explore;
  // the proposal's DIRECTION: every proposed parameter moved the way the proposal moved it ("along" = a legal repair of the proposal)
  const dirs = o.sub.axes.filter(a => a.role === "proposed" && a.target != null && Math.abs(a.target - a.head) > 1e-9).map(a => ({ key: a.part + "." + a.param, sign: Math.sign(a.target - a.head) }));
  const along = ch => dirs.length > 0 && dirs.every(d => ch.some(c => c.part + "." + c.param === d.key && Math.sign(c.to - o.head.params[c.part][c.param]) === d.sign));
  const Sg = surrogate();
  for (let i = o.i0; i < o.i1; i++) {
    const changes = subspace.variant(o.sub, o.seed, i); out.generated++;
    const k = keyOfChanges(changes); if (seen.has(k)) continue; seen.add(k); out.distinct++; out.keys.push(k);
    let d; try { d = design.applyChanges(o.head, changes).design; } catch (e) { out.illegal++; out.violations.DOMAIN = (out.violations.DOMAIN || 0) + 1; continue; }
    const f = design.facts(d), v = regs.checkFacts(f), pc = phys.physical(d);
    for (const x of bench.checkPU(pc, d, f.mass)) v.push(x);
    for (const x of bench.checkMaterials(d)) v.push(x);
    if (v.length) { out.illegal++; for (const x of v) out.violations[x.id] = (out.violations[x.id] || 0) + 1; continue; }
    out.legal++;
    const lap = Sg.predictLap(bench.guardEnergy(pc), CIRCUIT, "physics");
    if (!isFinite(lap)) { out.oob++; if (out.explore.length < explore + keep) out.explore.push({ i, changes }); continue; }
    insertTop(out.top, { i, lap, changes }, keep);
    if (along(changes)) insertTop(out.along, { i, lap, changes }, 3);
  }
  return out;
}
function insertTop(top, x, keep) {
  let j = top.length; while (j > 0 && (top[j - 1].lap > x.lap || (top[j - 1].lap === x.lap && top[j - 1].i > x.i))) j--;
  if (j >= keep) return; top.splice(j, 0, x); if (top.length > keep) top.pop();
}
// merge chunk results: totals, global distinct count, global top-K (deduplicated by change key) and the first `explore` unranked
function merge(results, keep, explore) {
  const tot = { generated: 0, distinct: 0, legal: 0, illegal: 0, oob: 0, violations: {} }, keys = new Set(), top = [], ex = [], al = [];
  const ordered = results.slice().sort((a, b) => a.i0 - b.i0);
  for (const r of ordered) {
    tot.generated += r.generated; tot.legal += r.legal; tot.illegal += r.illegal; tot.oob += r.oob;
    for (const k of r.keys) keys.add(k);
    for (const [id, n] of Object.entries(r.violations)) tot.violations[id] = (tot.violations[id] || 0) + n;
    for (const x of r.top) top.push(x);
    for (const x of r.explore) ex.push(x);
    for (const x of r.along || []) al.push(x);
  }
  al.sort((a, b) => a.lap - b.lap || a.i - b.i);
  tot.distinct = keys.size;
  top.sort((a, b) => a.lap - b.lap || a.i - b.i);
  const used = new Set(), best = [];
  for (const x of top) { const k = keyOfChanges(x.changes); if (used.has(k)) continue; used.add(k); best.push(x); if (best.length >= keep) break; }
  ex.sort((a, b) => a.i - b.i);
  // unranked slots: `explore` always, plus every top-K slot the surrogate could not fill (the car left its training box): those
  // slots go to legal variants it refused to rank, in index order (the physics sim measures them; nothing is extrapolated)
  const nEx = explore + Math.max(0, keep - best.length);
  const exp = []; for (const x of ex) { const k = keyOfChanges(x.changes); if (used.has(k)) continue; used.add(k); exp.push(x); if (exp.length >= nEx) break; }
  return Object.assign(tot, { top: best, explore: exp, along: al.slice(0, 3) });
}

class ScreenPool {
  constructor(n) {
    this.n = Math.max(0, n | 0); this.workers = []; this.queue = []; this.pending = new Map(); this.seq = 0; this.screened = 0;
    if (this.n > 0) {
      const { Worker } = require("worker_threads");
      for (let i = 0; i < this.n; i++) {
        const w = new Worker(path.join(__dirname, "screen-worker.js")); w.busy = false;
        w.on("message", m => { const p = this.pending.get(m.id); this.pending.delete(m.id); w.busy = false; if (m.error) p.reject(new Error(m.error)); else p.resolve(m.result); this.pump(); });
        w.on("error", e => { for (const p of this.pending.values()) p.reject(e); this.pending.clear(); });
        this.workers.push(w);
      }
    }
  }
  pump() {
    for (const w of this.workers) { if (w.busy || !this.queue.length) continue; const job = this.queue.shift(); w.busy = true; this.pending.set(job.id, job); w.postMessage({ id: job.id, job: job.job }); }
  }
  run(job) {
    if (!this.n) return new Promise((res, rej) => setImmediate(() => { try { res(screenChunk(job)); } catch (e) { rej(e); } }));
    return new Promise((resolve, reject) => { this.queue.push({ id: ++this.seq, job, resolve, reject }); this.pump(); });
  }
  // screen(head, sub, seed, n, { keep, explore, stop, onChunk }) -> merged result + { ms }
  async screen(head, sub, seed, n, o) {
    o = o || {}; const keep = o.keep == null ? 32 : o.keep, explore = o.explore == null ? 4 : o.explore;
    const t0 = Date.now(), jobs = [];
    for (let i0 = 0; i0 < n; i0 += CHUNK) jobs.push({ head, sub, seed, i0, i1: Math.min(n, i0 + CHUNK), keep, explore });
    let done = 0;
    const results = await Promise.all(jobs.map(j => (o.stop && o.stop() ? Promise.resolve(null) : this.run(j)).then(r => { if (r) { done += r.generated; this.screened += r.distinct; if (o.onChunk) o.onChunk({ done, n }); } return r; })));
    const m = merge(results.filter(Boolean), keep, explore);
    m.ms = Date.now() - t0; m.chunks = jobs.length; m.workers = this.n;
    return m;
  }
  async close() { await Promise.all(this.workers.map(w => w.terminate())); this.workers = []; }
}

module.exports = { CHUNK, screenChunk, merge, ScreenPool, keyOfChanges };
