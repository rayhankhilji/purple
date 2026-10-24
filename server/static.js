// PURPLE - static file server for the game + lab/ on 127.0.0.1:8788. No caching, so edits show on reload.
// Audit hardening: only an allowlist of roots is served (never server/, data/, node_modules/, dotfiles); the resolved path must stay
// inside the repo root (real path + separator); a malformed percent-escape is a 400, not a crash.
const http = require("http"), fs = require("fs"), path = require("path");
const ROOT = fs.realpathSync(path.join(__dirname, "..")), PORT = parseInt(process.env.PURPLE_STATIC_PORT || "8788", 10);
const ALLOW_FILES = new Set(["index.html"]), ALLOW_DIRS = new Set(["lab", "js", "css", "vendor", "assets", "docs"]);   // what index.html and lab/ load
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".svg": "image/svg+xml", ".webp": "image/webp", ".glb": "model/gltf-binary", ".gltf": "model/gltf+json", ".woff2": "font/woff2", ".woff": "font/woff", ".ttf": "font/ttf", ".mp3": "audio/mpeg", ".ogg": "audio/ogg", ".wav": "audio/wav", ".ico": "image/x-icon", ".txt": "text/plain; charset=utf-8", ".md": "text/markdown; charset=utf-8", ".bin": "application/octet-stream", ".hdr": "application/octet-stream" };
const deny = (res, code, text) => { res.writeHead(code, { "Content-Type": "text/plain; charset=utf-8" }); res.end(text); };
// url path -> { file, redirect } | { status, text }
function resolve(url) {
  let p; try { p = decodeURIComponent((url || "/").split("?")[0]); } catch (e) { return { status: 400, text: "bad percent-encoding" }; }
  if (p.includes("\0")) return { status: 400, text: "bad path" };
  if (p.endsWith("/")) p += "index.html";
  const parts = p.split("/").filter(Boolean);
  if (parts.some(seg => seg.startsWith(".") || seg === "..")) return { status: 403, text: "forbidden" };   // dotfiles and traversal segments, before any fs access
  const allowed = parts.length >= 1 && (ALLOW_DIRS.has(parts[0]) || (parts.length === 1 && ALLOW_FILES.has(parts[0])));   // "/lab" alone resolves to the dir and redirects to "/lab/"
  if (!allowed) return { status: 403, text: "forbidden" };
  const file = path.resolve(ROOT, ...parts);
  if (!file.startsWith(ROOT + path.sep)) return { status: 403, text: "forbidden" };
  return { file, dirRedirect: p + "/" };
}
function serve(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") return deny(res, 405, "method not allowed");
  const r = resolve(req.url); if (r.status) return deny(res, r.status, r.text);
  fs.realpath(r.file, (err, real) => {   // a symlink out of the repo (or a dotfile behind one) is refused on its real path
    if (err) return deny(res, 404, "not found");
    if (!real.startsWith(ROOT + path.sep)) return deny(res, 403, "forbidden");
    fs.stat(real, (err2, st) => {
      if (err2) return deny(res, 404, "not found");
      if (st.isDirectory()) { res.writeHead(302, { Location: (req.url || "/").split("?")[0] + "/" }); return res.end(); }
      if (!st.isFile()) return deny(res, 404, "not found");
      res.writeHead(200, { "Content-Type": MIME[path.extname(real).toLowerCase()] || "application/octet-stream", "Cache-Control": "no-store", "Content-Length": st.size });
      if (req.method === "HEAD") return res.end();
      fs.createReadStream(real).pipe(res);
    });
  });
}
module.exports = { resolve, serve, ROOT, ALLOW_DIRS, ALLOW_FILES };
if (require.main === module) http.createServer(serve).listen(PORT, "127.0.0.1", () => console.log(`PURPLE static http://127.0.0.1:${PORT}/lab/`));
