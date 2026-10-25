// The shared journey nav (concept/nav): one numbered story across the four main pages, the same markup everywhere, the current page marked.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs"), path = require("path");
const ROOT = path.join(__dirname, "..");
const read = f => fs.readFileSync(path.join(ROOT, f), "utf8");
const PAGES = [["concept/lab/index.html", "1"], ["concept/gp/index.html", "2"], ["concept/compare/index.html", "3"], ["concept/race/index.html", "4"]];
const navOf = html => { const m = /<nav class="pnav[^"]*"[\s\S]*?<\/nav>/.exec(html); return m ? m[0] : null; };

test("journey nav: every main page has it once, in its header, with its own step marked current", () => {
  for (const [file, step] of PAGES) {
    const html = read(file), nav = navOf(html);
    assert.ok(nav, file + ": nav");
    assert.equal(html.match(/<nav class="pnav/g).length, 1, file + ": one nav");
    const header = /<header[^>]*class="[^"]*pnav-host[^"]*"[^>]*>([\s\S]*?)<\/header>/.exec(html);
    assert.ok(header && header[1].includes(nav), file + ": the nav sits in the page header");
    assert.match(html, /href="\.\.\/nav\/nav\.css"/, file + ": nav.css");
    assert.match(html, /src="\.\.\/nav\/nav\.js"/, file + ": nav.js");
    const cur = nav.match(/<a [^>]*aria-current="page"[^>]*>/g) || [];
    assert.equal(cur.length, 1, file + ": one current step");
    assert.match(cur[0], new RegExp('data-step="' + step + '"'), file + ": step " + step + " is current");
    assert.doesNotMatch(html.replace(nav, ""), /class="[^"]*\bback\b/, file + ": the old one-off header links are gone");
  }
});

test("journey nav: the same steps, in story order, on every page", () => {
  const norm = nav => nav.replace(/ aria-current="page"/g, "").replace(/class="pnav pnav-row"/, 'class="pnav"');
  const first = norm(navOf(read(PAGES[0][0])));
  for (const [file] of PAGES.slice(1)) assert.equal(norm(navOf(read(file))), first, file + ": same markup as the lab's");
  const hrefs = [...first.matchAll(/href="([^"]+)"/g)].map(m => m[1]);
  assert.deepEqual(hrefs, ["../lab/", "../gp/", "../compare/", "../race/?mode=quali"]);
  const labels = [...first.matchAll(/<span class="pnav-l">([^<]+)<\/span>/g)].map(m => m[1]);
  assert.deepEqual(labels, ["Mubit engineer", "Which AI is best?", "vs no AI", "Race &amp; drive"]);
  assert.match(first, /<span class="pnav-brand">PURPLE<\/span>/, "the wordmark stays at the left");
  for (const w of [/\bCFD\b/i, /wind tunnel/i, /validated/i, /—/]) assert.doesNotMatch(first, w, String(w));
});

test("journey nav: step 4 on the lab is still the car-carrying race link (concept-lab.js rewrites it on click)", () => {
  const html = read("concept/lab/index.html"), lab = read("concept/lab/concept-lab.js");
  assert.match(navOf(html), /id="raceLink" href="\.\.\/race\/\?mode=quali"/);
  assert.match(lab, /\$\("#raceLink"\)\.addEventListener\("click"/);
});

test("lab first load: the recorded run is fetched while the page boots, the 3D car is built after the first card", () => {
  const js = read("concept/lab/mubit-first.js"), lab = read("concept/lab/concept-lab.js");
  assert.match(js, /Promise\.all\(dirs\.map/, "both run indexes at once");
  assert.match(js, /EI\.conceptLabDeferView = true;/);
  assert.match(js, /takeEarly\(meta\.dir \+ meta\.file\)/);
  assert.match(lab, /EI\.conceptLabDeferView && S === MU/);
  assert.match(lab, /mountView: ensureView/);
  assert.match(js, /"loading the run…"/, "the run picker never shows an empty option");
});
