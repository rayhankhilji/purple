// PURPLE - npm run fixtures: regenerate test/fixtures/baseline.<circuit>.json (TESTING_GUIDE §7). Needs a TASK_LOG decision line.
const fs = require("fs"), path = require("path");
const headless = require("../game-headless.js");
const EI = headless.load(); const dir = path.join(headless.ROOT, "test", "fixtures"); fs.mkdirSync(dir, { recursive: true });
for (const circuit of ["silverstone", "monza"]) {
  const ev = EI.evaluator.evaluate(circuit, EI.aero.BASELINE, { circuit, wet: false, wind_ms: 0, wind_from_deg: 0 });
  const file = path.join(dir, `baseline.${circuit}.json`); fs.writeFileSync(file, JSON.stringify(ev, null, 2) + "\n");
  console.log(`${circuit}: lap ${ev.lap} sectors ${ev.sectors.join(" / ")} vmax ${ev.vmax_kmh} vmin ${ev.vmin_kmh} grip ${ev.grip_scale} -> ${path.relative(headless.ROOT, file)}`);
}
