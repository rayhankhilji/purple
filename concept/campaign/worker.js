// PURPLE CONCEPT CAMPAIGN - worker thread: one bench() call per message (concept/campaign/pool.js). Also reports how long the call
// took inside the worker (ms), for the engine dashboard's stage timings; the result itself never carries a timing.
"use strict";
const { parentPort } = require("worker_threads");
const { performance } = require("perf_hooks");
const bench = require("../bench.js");
const { evalOne } = require("./pool.js");
parentPort.on("message", m => {
  const t0 = performance.now();
  try { const result = evalOne(bench, m.design, m.benchOpts); parentPort.postMessage({ id: m.id, result, ms: performance.now() - t0 }); }
  catch (e) { parentPort.postMessage({ id: m.id, error: String((e && e.stack) || e) }); }
});
