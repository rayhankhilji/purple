// PURPLE CONCEPT CAMPAIGN - a plain (μ/μ_w, λ)-CMA-ES (Hansen, "The CMA Evolution Strategy: A Tutorial", 2016), seeded and
// deterministic: the same rng stream gives the same samples, and tell() depends only on the vectors and fitness values it is
// given. Minimisation. ask(n) may draw more than λ samples (surrogate pre-screening draws k·λ and tells the λ that were run on
// the physics sim: "pre-selection", the update then uses those λ ranked by their physics fitness).
// No dependencies; the eigendecomposition is cyclic Jacobi (n ≈ 23 here, so it runs every generation).
"use strict";

function gauss(rng) { const u = Math.max(rng(), 1e-12), v = rng(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }

// symmetric eigendecomposition (cyclic Jacobi): returns { values, vectors } with vectors[i][k] = component i of eigenvector k
function eigSym(A) {
  const n = A.length, a = A.map(r => r.slice()), V = [];
  for (let i = 0; i < n; i++) { V.push(new Array(n).fill(0)); V[i][i] = 1; }
  for (let sweep = 0; sweep < 60; sweep++) {
    let off = 0; for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) off += a[p][q] * a[p][q];
    if (off < 1e-30) break;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) {
      if (Math.abs(a[p][q]) < 1e-300) continue;
      const th = (a[q][q] - a[p][p]) / (2 * a[p][q]), t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1)), c = 1 / Math.sqrt(t * t + 1), s = t * c;
      for (let k = 0; k < n; k++) { const akp = a[k][p], akq = a[k][q]; a[k][p] = c * akp - s * akq; a[k][q] = s * akp + c * akq; }
      for (let k = 0; k < n; k++) { const apk = a[p][k], aqk = a[q][k]; a[p][k] = c * apk - s * aqk; a[q][k] = s * apk + c * aqk; }
      for (let k = 0; k < n; k++) { const vkp = V[k][p], vkq = V[k][q]; V[k][p] = c * vkp - s * vkq; V[k][q] = s * vkp + c * vkq; }
    }
  }
  return { values: a.map((r, i) => r[i]), vectors: V };
}

// CMA({ x0, sigma0, lambda, rng }) -> { ask(n?), tell(xs, fs), state() }
function CMA(o) {
  const n = o.x0.length, rng = o.rng, lambda = o.lambda || 4 + Math.floor(3 * Math.log(n));
  const mu = Math.floor(lambda / 2);
  let w = []; for (let i = 0; i < mu; i++) w.push(Math.log(mu + 0.5) - Math.log(i + 1));
  const ws = w.reduce((s, v) => s + v, 0); w = w.map(v => v / ws);
  const mueff = 1 / w.reduce((s, v) => s + v * v, 0);
  const cc = (4 + mueff / n) / (n + 4 + 2 * mueff / n), cs = (mueff + 2) / (n + mueff + 5);
  const c1 = 2 / ((n + 1.3) * (n + 1.3) + mueff), cmu = Math.min(1 - c1, 2 * (mueff - 2 + 1 / mueff) / ((n + 2) * (n + 2) + mueff));
  const damps = 1 + 2 * Math.max(0, Math.sqrt((mueff - 1) / (n + 1)) - 1) + cs, chiN = Math.sqrt(n) * (1 - 1 / (4 * n) + 1 / (21 * n * n));
  let m = o.x0.slice(), sigma = o.sigma0, pc = new Array(n).fill(0), ps = new Array(n).fill(0), gen = 0;
  let C = []; for (let i = 0; i < n; i++) { C.push(new Array(n).fill(0)); C[i][i] = 1; }
  let B = C.map(r => r.slice()), D = new Array(n).fill(1);
  function decompose() {
    const e = eigSym(C); B = e.vectors; D = e.values.map(v => Math.sqrt(Math.max(v, 1e-20)));
  }
  // sample: y = B·D·z, x = m + σ·y
  function ask(count) {
    const out = [];
    for (let k = 0; k < (count || lambda); k++) {
      const z = []; for (let i = 0; i < n; i++) z.push(gauss(rng));
      const x = new Array(n);
      for (let i = 0; i < n; i++) { let s = 0; for (let j = 0; j < n; j++) s += B[i][j] * D[j] * z[j]; x[i] = m[i] + sigma * s; }
      out.push(x);
    }
    return out;
  }
  // tell(xs, fs): the evaluated vectors and their fitness (lower is better); the μ best update the distribution
  function tell(xs, fs) {
    gen++;
    const idx = xs.map((_, i) => i).sort((a, b) => fs[a] - fs[b] || a - b), k = Math.min(mu, idx.length), wk = w.slice(0, k), wsum = wk.reduce((s, v) => s + v, 0);
    const old = m.slice(); m = new Array(n).fill(0);
    for (let r = 0; r < k; r++) { const x = xs[idx[r]]; for (let i = 0; i < n; i++) m[i] += (wk[r] / wsum) * x[i]; }
    const y = m.map((v, i) => (v - old[i]) / sigma);
    // C^{-1/2} y = B D^{-1} B^T y
    const bt = new Array(n).fill(0); for (let j = 0; j < n; j++) { let s = 0; for (let i = 0; i < n; i++) s += B[i][j] * y[i]; bt[j] = s / D[j]; }
    const cinv = new Array(n).fill(0); for (let i = 0; i < n; i++) { let s = 0; for (let j = 0; j < n; j++) s += B[i][j] * bt[j]; cinv[i] = s; }
    for (let i = 0; i < n; i++) ps[i] = (1 - cs) * ps[i] + Math.sqrt(cs * (2 - cs) * mueff) * cinv[i];
    const psn = Math.sqrt(ps.reduce((s, v) => s + v * v, 0)), hsig = psn / Math.sqrt(1 - Math.pow(1 - cs, 2 * gen)) / chiN < 1.4 + 2 / (n + 1) ? 1 : 0;
    for (let i = 0; i < n; i++) pc[i] = (1 - cc) * pc[i] + hsig * Math.sqrt(cc * (2 - cc) * mueff) * y[i];
    const ys = []; for (let r = 0; r < k; r++) ys.push(xs[idx[r]].map((v, i) => (v - old[i]) / sigma));
    for (let i = 0; i < n; i++) for (let j = 0; j <= i; j++) {
      let rank = 0; for (let r = 0; r < k; r++) rank += (wk[r] / wsum) * ys[r][i] * ys[r][j];
      const v = (1 - c1 - cmu) * C[i][j] + c1 * (pc[i] * pc[j] + (1 - hsig) * cc * (2 - cc) * C[i][j]) + cmu * rank;
      C[i][j] = v; C[j][i] = v;
    }
    sigma *= Math.exp((cs / damps) * (psn / chiN - 1));
    sigma = Math.min(sigma, 1);   // the box is [0, 1]^n
    decompose();
  }
  function state() { return { gen, sigma, mean: m.slice(), axis_ratio: Math.max(...D) / Math.min(...D), max_std: sigma * Math.max(...D) }; }
  return { n, lambda, mu, ask, tell, state };
}

module.exports = { CMA, eigSym, gauss };
