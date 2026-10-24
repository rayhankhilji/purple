// PURPLE CONCEPT - copy concept/data/materials-2026.json into concept/materials.js (the browser has no require). Run after editing
// the JSON: node concept/tools/embed-materials.js. test/concept-coupling.test.js fails if the two differ.
const fs = require("fs"), path = require("path");
const ROOT = path.join(__dirname, "..");
const json = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "materials-2026.json"), "utf8"));
const file = path.join(ROOT, "materials.js"), src = fs.readFileSync(file, "utf8");
const re = /\/\*BEGIN materials-2026\.json\*\/[\s\S]*?\/\*END materials-2026\.json\*\//;
if (!re.test(src)) throw new Error("embed-materials: markers not found in concept/materials.js");
const out = src.replace(re, () => "/*BEGIN materials-2026.json*/" + JSON.stringify(json) + "/*END materials-2026.json*/");
fs.writeFileSync(file, out);
console.log("embedded " + json.materials.length + " materials into concept/materials.js");
