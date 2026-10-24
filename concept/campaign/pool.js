// PURPLE CONCEPT CAMPAIGN - parallel physics laps. evaluate(designs, benchOpts) runs concept/bench.js bench() (FIA 2026 legality +
// PU / material guards + PhysicalCar + the physics lap sim) on each design, in worker threads, and returns compact results IN
// INPUT ORDER. Every result is a pure function of (design, benchOpts), so which worker ran it never matters: the campaign is
// deterministic per seed for any worker count (test/concept-campaign.test.js runs 0 and 2 workers and compares).
// workers = 0 runs in this thread (tests, small batches).
// Engine dashboard hooks (server/campaign-route.js): pool.laps counts laps started, pool.done counts laps finished and pool.ms_sum
// their summed bench() time inside the workers; onLap(ms) (optional) is called once per finished lap. Timings never enter a result.
"use strict";
const path = require("path");
const { performance } = require("perf_hooks");

// the compact record the campaign keeps for every physics lap
function compact(r) {
  const c = r.legal && r.circuits && r.circuits.silverstone;
  return {
    legal: !!r.legal,
    violations: (r.violations || []).map(v => ({ id: v.id, article: v.article, value: v.value, limit: v.limit })).concat((r.errors || []).map(e => ({ id: "DOMAIN", article: "design domain", value: e, limit: null }))),
    lap_s: c ? c.lap_s : null, sectors_s: c ? c.sectors_s : null, speed_trap_kmh: c ? c.speed_trap_kmh : null, vmin_kmh: c ? c.vmin_kmh : null, vmax_kmh: c ? c.vmax_kmh : null,
    energy: c ? c.energy : null, sim: r.sim || null, sim_label: c ? c.label : null,
    mass_kg: r.mass ? r.mass.total_kg : null, front_share: r.mass ? r.mass.front_share : null,
    pu: r.physical ? r.physical.pu : null,
  };
}
function evalOne(bench, d, benchOpts) { return compact(bench.bench(d, benchOpts)); }

class Pool {
  constructor(n) {
    this.n = Math.max(0, n | 0); this.workers = []; this.queue = []; this.pending = new Map(); this.seq = 0; this.laps = 0; this.done = 0; this.ms_sum = 0; this.onLap = null;
    if (this.n > 0) {
      const { Worker } = require("worker_threads");
      for (let i = 0; i < this.n; i++) {
        const w = new Worker(path.join(__dirname, "worker.js"));
        w.busy = false;
        w.on("message", m => { const p = this.pending.get(m.id); this.pending.delete(m.id); w.busy = false; if (m.error) p.reject(new Error(m.error)); else { this.timed(m.ms); p.resolve(m.result); } this.pump(); });
        w.on("error", e => { for (const p of this.pending.values()) p.reject(e); this.pending.clear(); });
        this.workers.push(w);
      }
    } else this.bench = require("../bench.js");
  }
  pump() {
    for (const w of this.workers) {
      if (w.busy || !this.queue.length) continue;
      const job = this.queue.shift(); w.busy = true; this.pending.set(job.id, job); w.postMessage({ id: job.id, design: job.design, benchOpts: job.benchOpts });
    }
  }
  timed(ms) { this.done++; if (typeof ms === "number") { this.ms_sum += ms; if (this.onLap) this.onLap(ms); } }
  run(d, benchOpts) {
    this.laps++;
    if (!this.n) { const t0 = performance.now(), r = evalOne(this.bench, d, benchOpts); this.timed(performance.now() - t0); return Promise.resolve(r); }
    return new Promise((resolve, reject) => { this.queue.push({ id: ++this.seq, design: d, benchOpts, resolve, reject }); this.pump(); });
  }
  // evaluate(designs, benchOpts) -> Promise<compact[]> in input order
  evaluate(designs, benchOpts) { return Promise.all(designs.map(d => this.run(d, benchOpts))); }
  async close() { await Promise.all(this.workers.map(w => w.terminate())); this.workers = []; }
}

module.exports = { Pool, compact, evalOne };
