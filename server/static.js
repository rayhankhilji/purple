// PURPLE - static file server for the repo root (the game + lab/) on 127.0.0.1:8788. No caching, so edits show on reload.
const http = require("http"), fs = require("fs"), path = require("path");
const ROOT = path.join(__dirname, ".."), PORT = parseInt(process.env.PURPLE_STATIC_PORT || "8788", 10);
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".svg": "image/svg+xml", ".webp": "image/webp", ".glb": "model/gltf-binary", ".gltf": "model/gltf+json", ".woff2": "font/woff2", ".woff": "font/woff", ".ttf": "font/ttf", ".mp3": "audio/mpeg", ".ogg": "audio/ogg", ".wav": "audio/wav", ".ico": "image/x-icon", ".txt": "text/plain; charset=utf-8", ".md": "text/markdown; charset=utf-8", ".bin": "application/octet-stream", ".hdr": "application/octet-stream" };
http.createServer((req, res) => {
  let p = decodeURIComponent((req.url || "/").split("?")[0]);
  if (p.endsWith("/")) p += "index.html";
  const file = path.normalize(path.join(ROOT, p));
  if (!file.startsWith(ROOT) || file.includes(path.sep + "server" + path.sep + ".env")) { res.writeHead(403); return res.end(); }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { if (!err && st.isDirectory()) { res.writeHead(302, { Location: p + "/" }); return res.end(); } res.writeHead(404); return res.end("not found"); }
    res.writeHead(200, { "Content-Type": MIME[path.extname(file).toLowerCase()] || "application/octet-stream", "Cache-Control": "no-store", "Content-Length": st.size });
    fs.createReadStream(file).pipe(res);
  });
}).listen(PORT, "127.0.0.1", () => console.log(`PURPLE static http://127.0.0.1:${PORT}/lab/`));
