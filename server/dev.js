// PURPLE - npm run dev: the API server (:8787) and the static site (:8788) together.
const { spawn } = require("child_process"), path = require("path");
const kids = ["index.js", "static.js"].map(f => spawn(process.execPath, [path.join(__dirname, f)], { stdio: "inherit", env: process.env }));
const stop = () => { for (const k of kids) k.kill(); process.exit(0); };
process.on("SIGINT", stop); process.on("SIGTERM", stop);
kids[0].on("exit", code => { if (code) { console.error("server exited " + code); stop(); } });
