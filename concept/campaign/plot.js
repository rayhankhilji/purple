// PURPLE CONCEPT CAMPAIGN - convergence plot (static SVG for docs/concept/CAMPAIGN.md): best legal lap so far (physics lap sim)
// against physics laps run, one thin line per seed, coloured by baseline (the entity), the refinement as a final marker, and the
// real 2026 pole (ANT 88.111 s) and HAD (88.746 s) as reference lines. Native <title> tooltips on every line and marker. Light and
// dark styles inside the SVG (prefers-color-scheme). One y axis (lap seconds).
"use strict";
const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function convergenceSvg(res) {
  const W = 760, H = 420, M = { l: 64, r: 150, t: 46, b: 48 }, pw = W - M.l - M.r, ph = H - M.t - M.b;
  const keys = Object.keys(res.results), SLOT = { redbull: 1, generic: 2 };
  const name = k => (k === "generic" ? "Generic 2026 baseline" : "Red Bull RB22 baseline");
  let xmax = 1, ymin = Infinity, ymax = -Infinity;
  for (const k of keys) {
    const r = res.results[k], seedMax = Math.max(...r.trace.map(t => t.points[t.points.length - 1].evals));
    xmax = Math.max(xmax, seedMax);
    for (const t of r.trace) for (const p of t.points) { ymin = Math.min(ymin, p.best_s); ymax = Math.max(ymax, p.best_s); }
    ymin = Math.min(ymin, r.best.lap_s);
  }
  ymin = Math.min(ymin, res.results[keys[0]].real.pole.s); ymax = Math.max(ymax, res.results[keys[0]].real.had.s);
  const pad = (ymax - ymin) * 0.08 || 0.1; ymin -= pad; ymax += pad;
  const X = e => M.l + (e / xmax) * pw, Y = s => M.t + ((ymax - s) / (ymax - ymin)) * ph;   // usual orientation: faster laps lower on the page
  const out = [];
  out.push('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + " " + H + '" width="' + W + '" height="' + H + '" role="img" aria-labelledby="t d" font-family="system-ui, -apple-system, Segoe UI, sans-serif">');
  out.push("<title id=\"t\">Campaign convergence: best legal Silverstone lap (physics lap sim) vs physics laps run</title>");
  out.push("<desc id=\"d\">" + esc(keys.map(k => name(k) + ": final " + res.results[k].best.lap_s.toFixed(3) + " s").join("; ") + ". Real 2026 pole 88.111 s, HAD 88.746 s.") + "</desc>");
  out.push("<style>.bg{fill:#fcfcfb}.ink{fill:#0b0b0b}.ink2{fill:#52514e}.grid{stroke:#e4e3df;stroke-width:1}.axis{stroke:#9b9a95;stroke-width:1}.ref{stroke:#52514e;stroke-width:1.5;stroke-dasharray:5 4}.s1{stroke:#2a78d6}.s2{stroke:#eb6834}.f1{fill:#2a78d6}.f2{fill:#eb6834}.ring{stroke:#fcfcfb;stroke-width:2}" +
    "@media (prefers-color-scheme: dark){.bg{fill:#1a1a19}.ink{fill:#f0efec}.ink2{fill:#c3c2b7}.grid{stroke:#33332f}.axis{stroke:#6b6a64}.ref{stroke:#c3c2b7}.s1{stroke:#3987e5}.s2{stroke:#d95926}.f1{fill:#3987e5}.f2{fill:#d95926}.ring{stroke:#1a1a19}}</style>");
  out.push('<rect class="bg" x="0" y="0" width="' + W + '" height="' + H + '"/>');
  out.push('<text class="ink" x="' + M.l + '" y="20" font-size="14" font-weight="600">Best legal lap so far, Silverstone (physics lap sim, 2026 British GP Q conditions)</text>');
  out.push('<text class="ink2" x="' + M.l + '" y="36" font-size="11">Lower is faster. One line per seed; dot = after refinement (volumes, materials, coordinate search).</text>');
  // y grid every 0.1 s (labels every 0.2 s)
  const t0 = Math.ceil(ymin * 10) / 10;
  for (let s = t0; s <= ymax + 1e-9; s = Math.round((s + 0.1) * 10) / 10) {
    out.push('<line class="grid" x1="' + M.l + '" x2="' + (M.l + pw) + '" y1="' + Y(s).toFixed(1) + '" y2="' + Y(s).toFixed(1) + '"/>');
    if (Math.round(s * 10) % 2 === 0) out.push('<text class="ink2" x="' + (M.l - 8) + '" y="' + (Y(s) + 4).toFixed(1) + '" font-size="11" text-anchor="end">' + s.toFixed(1) + "</text>");
  }
  const xstep = xmax > 6000 ? 2000 : xmax > 2500 ? 1000 : xmax > 800 ? 250 : 50;
  for (let e = 0; e <= xmax; e += xstep) out.push('<text class="ink2" x="' + X(e).toFixed(1) + '" y="' + (M.t + ph + 16) + '" font-size="11" text-anchor="middle">' + e + "</text>");
  out.push('<line class="axis" x1="' + M.l + '" x2="' + (M.l + pw) + '" y1="' + (M.t + ph) + '" y2="' + (M.t + ph) + '"/>');
  out.push('<text class="ink2" x="' + (M.l + pw / 2) + '" y="' + (H - 10) + '" font-size="11" text-anchor="middle">physics laps run (per seed)</text>');
  out.push('<text class="ink2" transform="translate(16 ' + (M.t + ph / 2) + ') rotate(-90)" font-size="11" text-anchor="middle">lap (s)</text>');
  // reference lines
  const real = res.results[keys[0]].real;
  for (const [lab, s] of [["pole " + real.pole.code + " " + real.pole.s.toFixed(3), real.pole.s], ["HAD " + real.had.s.toFixed(3), real.had.s]]) {
    out.push('<line class="ref" x1="' + M.l + '" x2="' + (M.l + pw) + '" y1="' + Y(s).toFixed(1) + '" y2="' + Y(s).toFixed(1) + '"><title>' + esc("real 2026 qualifying, " + lab + " s") + "</title></line>");
    out.push('<text class="ink2" x="' + (M.l + pw + 6) + '" y="' + (Y(s) + 4).toFixed(1) + '" font-size="11">real ' + esc(lab) + "</text>");
  }
  // series
  keys.forEach(k => {
    const r = res.results[k], c = SLOT[k] || 1;
    for (const t of r.trace) {
      const pts = []; let last = null;
      for (const p of t.points) { if (last != null) pts.push(X(p.evals).toFixed(1) + "," + Y(last).toFixed(1)); pts.push(X(p.evals).toFixed(1) + "," + Y(p.best_s).toFixed(1)); last = p.best_s; }
      out.push('<polyline class="s' + c + '" fill="none" stroke-width="2" stroke-linejoin="round" stroke-opacity="0.85" points="' + pts.join(" ") + '"><title>' + esc(name(k) + ", seed " + t.seed + ": " + t.points[t.points.length - 1].best_s.toFixed(3) + " s after " + t.points[t.points.length - 1].evals + " laps") + "</title></polyline>");
    }
    const xe = Math.max(...r.trace.map(t => t.points[t.points.length - 1].evals));
    out.push('<circle class="f' + c + ' ring" cx="' + X(xe).toFixed(1) + '" cy="' + Y(r.best.lap_s).toFixed(1) + '" r="5"><title>' + esc(name(k) + " after refinement: " + r.best.lap_s.toFixed(3) + " s (physics lap sim)") + "</title></circle>");
    out.push('<text class="ink" x="' + (M.l + pw + 6) + '" y="' + (Y(r.best.lap_s) + 4).toFixed(1) + '" font-size="11">' + esc((k === "generic" ? "generic " : "RB22 ") + r.best.lap_s.toFixed(3)) + "</text>");
  });
  // legend
  keys.forEach((k, i) => {
    const c = SLOT[k] || 1, y = M.t + 8 + i * 18, x = M.l + pw - 230;
    out.push('<line class="s' + c + '" stroke-width="2" x1="' + x + '" x2="' + (x + 22) + '" y1="' + y + '" y2="' + y + '"/><text class="ink" x="' + (x + 28) + '" y="' + (y + 4) + '" font-size="11">' + esc(name(k) + " (" + res.results[k].trace.length + " seeds)") + "</text>");
  });
  out.push("</svg>");
  return out.join("\n") + "\n";
}

module.exports = { convergenceSvg };
