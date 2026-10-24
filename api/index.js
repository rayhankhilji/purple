// PURPLE - the one Vercel function: vercel.json rewrites every /api/* request here; server/vercel.js wraps server/app.js
// (passcode gate for live Mubit calls, rate limits, /tmp storage seeded from docs/ledger-snapshot/, run hosting). docs/DEPLOY.md.
module.exports = require("../server/vercel.js").listener();
