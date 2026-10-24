// PURPLE CONCEPT CAMPAIGN - worker thread: one bench() call per message (concept/campaign/pool.js).
"use strict";
const { parentPort } = require("worker_threads");
const bench = require("../bench.js");
const { evalOne } = require("./pool.js");
parentPort.on("message", m => {
  try { parentPort.postMessage({ id: m.id, result: evalOne(bench, m.design, m.benchOpts) }); }
  catch (e) { parentPort.postMessage({ id: m.id, error: String((e && e.stack) || e) }); }
});
