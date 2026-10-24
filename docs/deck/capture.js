#!/usr/bin/env node
// PURPLE deck: capture the lab figures slides.md references into docs/deck/shots/ (P3.T5).
//
//   node docs/deck/capture.js --static http://127.0.0.1:8788 --api http://127.0.0.1:8787 --out docs/deck/shots
//
// Run it against a server in MOCK mode whose PURPLE_DATA_DIR is a COPY of the real ledger (never data/ itself):
//   cp -r docs/ledger-snapshot/<latest>/ <scratch>/data      (or a copy of data/)
//   MUBIT_MOCK=1 PURPLE_PORT=8787 PURPLE_DATA_DIR=<scratch>/data node server/index.js
//   PURPLE_STATIC_PORT=8788 node server/static.js
//
// What it does, and what it never does:
// - Opens <static>/lab/?api=<api> at 1440x900, waits for the ledger, and SELECTS an existing ledger row by clicking it
//   (default: the demo experiment 01M5NHXH4RSEQ50VM955FK20B7). Selecting a row is client-side only: no request is sent.
// - Never presses Run / Run next / Run random / Race it / Promote / Overrule. A network guard aborts every write route
//   (/api/plan, /api/collect, /api/exam/run, /api/overrule, /api/promote, /api/race/result, /api/status, /api/rules/*)
//   except the two the TD-01 shot needs, below. So no Mubit call can leave this script, mock or not.
// - TD-01 shot (lab-design-td01.png): only if GET /api/health says mock:true (or --allow-td01-on-real). It turns TD-01 on via
//   POST /api/state, then calls the page hook EI.lab.run with a 25° rear-wing candidate. The server refuses an illegal candidate
//   with 422 ILLEGAL_SETUP BEFORE any Mubit call and appends one `illegal` row to calls.jsonl in the data dir you gave it
//   (the copy). The guard lets exactly that one /api/plan through only while TD-01 is confirmed on and the candidate is > 20°.
//   TD-01 is then restored to its previous value. --skip-td01 skips the shot.
//
// Shots (all PNG): lab-full.png (whole 1440x900 page, reference), lab-stage-rail.png (#rail), lab-race-card.png (#card-race),
// lab-evaluate-card.png (#card-evaluate), ledger-row.png (#ledger with the selected row), lab-widget.png (#widget),
// lab-design-td01.png (#card-design in the TD-01 error state). Console shots (console-tasks.png, console-adapters.png,
// try-models-side-by-side.png) are human screenshots from the Mubit console; this script cannot take them.
//
// Options: --exp <ledger id> (default the demo row), --browser-path <chrome> (or CHROME_PATH), --headed, --skip-td01,
// --allow-td01-on-real, --only <name,name> (shot base names, e.g. --only lab-race-card,ledger-row), --wait <ms> extra settle time.
"use strict";
const fs = require("fs"), path = require("path"), { execSync } = require("child_process");

const DEMO_EXP = "01M5NHXH4RSEQ50VM955FK20B7";
const TD01_CANDIDATE = { front_wing_deg: 25, rear_wing_deg: 25, ride_height_mm: 35, brake_bias_pct: 57, ers_deploy: 0.5 };
const WRITE_ROUTES = /\/api\/(plan|collect|exam\/run|overrule|promote|race\/result|status|rules\/[^/?]+|state)(\?|$)/;

function args(argv) {
  const o = { static: "http://127.0.0.1:8788", api: "http://127.0.0.1:8787", out: path.join(__dirname, "shots"), exp: DEMO_EXP, wait: 600 };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i], next = () => { const v = argv[++i]; if (v == null) die("missing value for " + a); return v; };
    if (a === "--static") o.static = next(); else if (a === "--api") o.api = next(); else if (a === "--out") o.out = next();
    else if (a === "--exp") o.exp = next(); else if (a === "--browser-path") o.browserPath = next(); else if (a === "--wait") o.wait = +next();
    else if (a === "--only") o.only = new Set(next().split(",").map(s => s.trim().replace(/\.png$/, "")));
    else if (a === "--headed") o.headed = true; else if (a === "--skip-td01") o.skipTd01 = true; else if (a === "--allow-td01-on-real") o.allowTd01Real = true;
    else if (a === "-h" || a === "--help") { console.log(fs.readFileSync(__filename, "utf8").split("\n").slice(1, 30).join("\n")); process.exit(0); }
    else die("unknown argument " + a);
  }
  o.static = o.static.replace(/\/$/, ""); o.api = o.api.replace(/\/$/, "");
  o.browserPath = o.browserPath || process.env.CHROME_PATH || undefined;
  return o;
}
function die(msg) { console.error("capture: " + msg); process.exit(2); }
function loadPlaywright() {
  try { return require("playwright"); } catch (e) { /* not a repo dependency on purpose (package.json untouched) */ }
  try { return require(path.join(execSync("npm root -g").toString().trim(), "playwright")); }
  catch (e) { die("playwright not found: install it globally (npm i -g playwright@1.63.0) or run with NODE_PATH=$(npm root -g)"); }
}
async function getJson(url) {
  const r = await fetch(url); const j = await r.json().catch(() => null);
  if (!r.ok || !j || j.ok === false) throw new Error("GET " + url + " -> HTTP " + r.status + " " + JSON.stringify(j && j.error));
  return j.data !== undefined ? j.data : j;
}

(async () => {
  const o = args(process.argv);
  // refuse the real data dir by name; the server does not report its dir, so this is the caller's job, stated loudly
  const health = await getJson(o.api + "/api/health").catch(e => die("API not reachable at " + o.api + ": " + e.message));
  console.log(`capture: API ${o.api} mock=${!!health.mock} model=${health.model}`);
  if (!health.mock) console.warn("capture: WARNING the API is NOT in mock mode. Row selection is read-only and every write route is blocked, so no Mubit call can be made; the TD-01 shot is skipped unless --allow-td01-on-real.");
  const ledger = await getJson(o.api + "/api/ledger?limit=500");
  const x = ledger.find(r => r.id === o.exp);
  if (!x) die(`experiment ${o.exp} is not in this ledger (${ledger.length} rows). Point the API at a copy of the real ledger.`);
  const pos = ledger.findIndex(r => r.id === o.exp);
  console.log(`capture: ${o.exp} is row ${pos + 1} of ${ledger.length} (newest first), status ${x.status}${x.measured ? ", raced" : ""}`);
  const want = name => !o.only || o.only.has(name);
  fs.mkdirSync(o.out, { recursive: true });

  const { chromium } = loadPlaywright();
  const browser = await chromium.launch({ headless: !o.headed, executablePath: o.browserPath, args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader"] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, colorScheme: "dark" });
  page.on("pageerror", e => console.warn("capture: page error: " + e.message));

  // network guard: block every write except the TD-01 pair, which is opened only inside the TD-01 step
  let td01Open = false; const passed = [];
  await page.route(WRITE_ROUTES, async route => {
    const req = route.request();
    if (req.method() === "GET" || req.method() === "OPTIONS") return route.continue();
    const u = req.url(), body = (() => { try { return req.postDataJSON(); } catch (e) { return null; } })();
    if (td01Open && /\/api\/state(\?|$)/.test(u) && body && Object.keys(body).length === 1 && typeof body.td01 === "boolean") { passed.push("POST /api/state td01=" + body.td01); return route.continue(); }
    if (td01Open && /\/api\/plan(\?|$)/.test(u) && body && body.scenario_overrides && body.scenario_overrides.candidate && body.scenario_overrides.candidate.rear_wing_deg > 20 && !body.random) { passed.push("POST /api/plan (illegal under TD-01)"); return route.continue(); }
    console.warn("capture: blocked " + req.method() + " " + u);
    return route.abort("blockedbyclient");
  });
  // the page asks for the newest 50; widen it so an older row can still be selected (read-only, same data)
  if (pos >= 50) await page.route(/\/api\/ledger\?limit=50$/, route => route.continue({ url: route.request().url().replace(/limit=50$/, "limit=500") }));

  await page.goto(`${o.static}/lab/?api=${encodeURIComponent(o.api)}`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.EI && EI.lab && EI.lab.state && EI.lab.state.ledger && EI.lab.state.ledger.length > 0, null, { timeout: 20000 });
  const sel = `#ledgerWrap tr[title="${o.exp}"]`;
  await page.waitForSelector(sel, { timeout: 10000 });
  await page.click(sel);   // select(x): client-side only
  await page.waitForFunction(id => EI.lab.state.current && EI.lab.state.current.id === id, o.exp);
  await page.evaluate(s => { const r = document.querySelector(s); if (r) r.scrollIntoView({ block: "center" }); }, sel);
  await page.mouse.move(5, 895);   // no hover styles on the shots
  await page.waitForTimeout(o.wait);

  const shots = [];
  async function shoot(name, selector) {
    if (!want(name)) return;
    const file = path.join(o.out, name + ".png");
    if (!selector) await page.screenshot({ path: file });
    else { const h = await page.$(selector); if (!h) { console.warn(`capture: ${selector} not on the page, ${name} skipped`); return; } await h.screenshot({ path: file }); }
    shots.push(file); console.log("capture: wrote " + path.relative(process.cwd(), file));
  }
  await shoot("lab-full");
  await shoot("lab-stage-rail", "#rail");
  await shoot("lab-evaluate-card", "#card-evaluate");
  await shoot("lab-race-card", "#card-race");
  await shoot("ledger-row", "#ledger");
  await shoot("lab-widget", "#widget");

  if (want("lab-design-td01") && !o.skipTd01) {
    if (!health.mock && !o.allowTd01Real) console.warn("capture: lab-design-td01 skipped (API not in mock mode; pass --allow-td01-on-real to take it: the server refuses the 25° candidate before Mubit)");
    else {
      const before = (await getJson(o.api + "/api/state")).td01;
      td01Open = true;
      try {
        await page.evaluate(() => EI.lab.setState({ td01: true }));
        const st = await getJson(o.api + "/api/state");
        if (!st.td01) throw new Error("TD-01 did not turn on; not sending the 25° candidate");
        await page.evaluate(c => EI.lab.run({ candidate: c }), TD01_CANDIDATE);
        await page.waitForFunction(() => EI.lab.state.err && EI.lab.state.err.design && EI.lab.state.err.design.code === "ILLEGAL_SETUP", null, { timeout: 10000 });
        await page.mouse.move(5, 895); await page.waitForTimeout(o.wait);
        await shoot("lab-design-td01", "#card-design");
        await shoot("lab-full-td01");
      } catch (e) { console.warn("capture: TD-01 shot failed: " + e.message); }
      finally {
        if (!before) await page.evaluate(() => EI.lab.setState({ td01: false })).catch(() => {});
        td01Open = false;
      }
    }
  }
  if (passed.length) console.log("capture: writes let through: " + passed.join(" · "));
  await browser.close();
  console.log(`capture: ${shots.length} shot(s) in ${o.out}`);
})().catch(e => { console.error("capture: " + (e && e.stack || e)); process.exit(1); });
