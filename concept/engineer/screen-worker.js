// PURPLE ENGINE v2 - worker thread of the screen (concept/engineer/screen.js): one chunk of subspace variants per message.
"use strict";
const { parentPort } = require("worker_threads");
const { screenChunk } = require("./screen.js");
parentPort.on("message", m => {
  try { parentPort.postMessage({ id: m.id, result: screenChunk(m.job) }); }
  catch (e) { parentPort.postMessage({ id: m.id, error: String((e && e.stack) || e) }); }
});
