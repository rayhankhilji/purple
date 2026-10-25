// PURPLE CONCEPT LAB - the EXAM view (concept/exam/, server/exam-route.js). 30 held-out car situations; three columns graded the same
// way on the physics lap sim: A. no AI (results-none.json), B. regular Claude through Mubit, untrained (results-base.json), C. the
// Mubit-trained adapter, whose replies the owner pastes from the Mubit console (Try models; the adapter cannot be called from code).
// The page: copy a question (the exact user message the engine sends to the frozen designer task) -> paste it in Try models -> paste
// the adapter's reply here -> Grade (POST /api/concept/exam/grade: concept/exam/grade.js on the server, no Mubit call) -> the row
// shows the adapter beside no AI and regular Claude for the same question, and the scoreboard compares all three on the same k
// questions. Graded replies persist in this browser (localStorage) and, on a local server, in concept/exam/answers-adapter.json;
// "Export answers" downloads that same file (the public site is read-only). Scores are n/N, never percentages (G-HON-06).
// Model comparison (the R&D lab's Haiku / Sonnet / Opus question): one column per model in concept/exam/models.json (the one list)
// that has a live, untrained results file (concept/exam/results-base-<slug>[-corrections].json, written by run.js --model), plus
// No AI. The numbers are read from those files as they are; a model without a file says "not run yet", failed calls are shown as
// failed calls (never as a model's score).
(function () {
  const EI = (window.EI = window.EI || {});
  const qs = new URLSearchParams(location.search);
  const API = (qs.get("api") || "http://127.0.0.1:8787").replace(/\/$/, "");
  const DATA = "../exam/";
  const LS_KEY = "purple.exam.v1";
  const $ = (s, r) => (r || document).querySelector(s);
  const isNum = v => typeof v === "number" && Number.isFinite(v);
  const MINUS = "−";
  const f3 = v => (isNum(v) ? v.toFixed(3) : "—");
  const f4 = v => (isNum(v) ? (Math.abs(v) < 5e-5 ? "0.0000" : v.toFixed(4)) : "—");
  const SIM = "physics lap sim · Silverstone · model prediction";
  function el(tag, attrs, ...kids) {
    const n = document.createElement(tag);
    if (attrs) for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === "class") n.className = v; else if (k === "text") n.textContent = v;
      else if (k.startsWith("on")) n.addEventListener(k.slice(2), v); else n.setAttribute(k, v === true ? "" : v);
    }
    for (const k of kids.flat(Infinity)) if (k != null && k !== false) n.append(k.nodeType ? k : String(k));
    return n;
  }

  const COLS = [
    { key: "none", name: "No AI", sub: "a random legal change" },
    { key: "base", name: "Regular Claude", sub: "through Mubit, untrained" },
    { key: "adapter", name: "Mubit-trained adapter", sub: "pasted from Try models" },
  ];
  const S = { qs: [], byId: new Map(), none: new Map(), base: new Map(), adapter: {}, provider: {}, drafts: { adapter: {}, provider: {} }, api: null, apiWhy: "", busy: new Set(), err: {}, loaded: false, shown: false };

  // ---------------------------------------------------------------- storage (browser; the server keeps its own file locally)
  function lsRead() { try { const j = JSON.parse(localStorage.getItem(LS_KEY) || "null"); return j && typeof j === "object" ? j : null; } catch (e) { return null; } }
  function lsWrite() { try { localStorage.setItem(LS_KEY, JSON.stringify({ v: 1, adapter: S.adapter, provider: S.provider, drafts: S.drafts })); } catch (e) { /* private window / blocked storage: the page still works */ } }
  const validEntry = e => e && typeof e === "object" && typeof e.text === "string" && e.grade && typeof e.grade === "object";
  function merge(col, src) {
    if (!src || typeof src !== "object") return;
    for (const [id, e] of Object.entries(src)) {
      if (!S.byId.has(id) || !validEntry(e)) continue;
      const cur = S[col][id];
      if (!cur || String(e.graded_at || "") > String(cur.graded_at || "")) S[col][id] = { text: e.text, grade: e.grade, graded_at: e.graded_at || null };
    }
  }

  // ---------------------------------------------------------------- data
  async function getJson(url) { const r = await fetch(url, { cache: "no-store" }); if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); }
  async function optJson(url) { try { return await getJson(url); } catch (e) { return null; } }   // a missing file on Vercel answers HTML: not JSON -> null
  async function load() {
    const [qd, none, base] = await Promise.all([getJson(DATA + "questions.json"), getJson(DATA + "results-none.json"), getJson(DATA + "results-base.json")]);
    S.qs = qd.questions; S.label = qd.label; for (const q of S.qs) S.byId.set(q.id, q);
    for (const r of none.rows) S.none.set(r.id, r);
    for (const r of base.rows) S.base.set(r.id, r);
    S.baseMeta = base.meta || {};
    const ls = lsRead();
    if (ls) { merge("adapter", ls.adapter); merge("provider", ls.provider); if (ls.drafts) for (const c of ["adapter", "provider"]) if (ls.drafts[c] && typeof ls.drafts[c] === "object") for (const [id, t] of Object.entries(ls.drafts[c])) if (S.byId.has(id) && typeof t === "string") S.drafts[c][id] = t; }
    S.loaded = true;
  }
  async function probeApi() {
    try {
      const r = await fetch(API + "/api/concept/exam/info", { cache: "no-store" });
      const j = await r.json();
      if (!j || !j.ok) throw new Error((j && j.error && j.error.message) || "HTTP " + r.status);
      S.api = j.data; S.deploy = j.deploy || null; S.apiWhy = "";
      const a = await fetch(API + "/api/concept/exam/answers", { cache: "no-store" }).then(x => x.json()).catch(() => null);
      if (a && a.ok) { merge("adapter", a.data.adapter); merge("provider", a.data.provider); }
    } catch (e) {
      S.api = null; S.apiWhy = "the grader API is not reachable at " + (API || location.origin) + " (" + (e.message || e) + ")";
      // no API: still show the answers the integrator committed (the API serves them otherwise)
      const [fa, fp] = await Promise.all([optJson(DATA + "answers-adapter.json"), optJson(DATA + "answers-provider.json")]);
      merge("adapter", fa); merge("provider", fp);
    }
  }

  // ---------------------------------------------------------------- scoring (n/N; the same subset for every column)
  function score(rows) {
    const N = rows.length, n = f => rows.filter(f).length, mean = f => (N ? rows.reduce((s, r) => s + (f(r) || 0), 0) / N : null);
    return { N, direct: n(r => r.direct && r.direct.kept), dgain: mean(r => r.direct && r.direct.gain_s), engine: n(r => r.engine && r.engine.kept), egain: mean(r => r.engine && r.engine.gain_s), legal: n(r => r.legal) };
  }
  const gradedIds = () => S.qs.map(q => q.id).filter(id => S.adapter[id]);

  // ---------------------------------------------------------------- frame
  const root = el("section", { class: "exam", id: "exam", "aria-label": "designer exam" });
  function frame() {
    const head = el("div", { class: "ex-head" },
      el("div", { class: "ex-title" }, el("span", { class: "label ex-kicker", text: "Exam · the designer task" }),
        el("h1", { class: "ex-h1", text: "30 car situations the engineer has never seen. Each answer is tested on the physics lap sim (Silverstone, model prediction)." })),
      el("div", { class: "ex-status src", id: "exStatus" }));
    const howto = el("details", { class: "panel ex-howto", id: "exHowto", open: true },
      el("summary", null, el("span", { class: "label", text: "How to get the adapter's answers" })),
      el("ol", { class: "ex-steps" },
        el("li", null, "Open the ", el("b", null, "Mubit console"), " → ", el("b", null, "Tasks"), " → the ", el("b", null, "designer task"), " (its instructions start “You are the concept designer of a 2026”)."),
        el("li", null, el("b", null, "Adapters"), " → the version marked ", el("b", null, "Passed"), " → ", el("b", null, "Compare with your provider"), " → ", el("b", null, "Try models"), "."),
        el("li", null, "Here, press ", el("b", null, "Copy question"), ". There, paste it as the message (nothing else, do not edit it) and press ", el("b", null, "Send to both"), "."),
        el("li", null, "Copy the adapter's whole reply (a ```json fence is fine), paste it here under ", el("b", null, "Paste the adapter's reply"), " and press ", el("b", null, "Grade"), ". The provider's reply can go in the second box.")),
      el("p", { class: "ex-note" }, "Try models has a ", el("b", null, "daily limit"), " (it resets at 00:00 UTC). Start with ", el("b", null, "q01–q09"), ": 3 early, 3 mid and 3 late situations. Try models calls do not train the task, and grading here makes no Mubit call."));
    const board = el("section", { class: "panel ex-board", id: "exBoard", "aria-label": "scoreboard" });
    const models = el("section", { class: "panel ex-models", id: "exModels", "aria-label": "model comparison" }, el("div", { class: "ph" }, el("span", { class: "label", text: "Model comparison" }), el("span", { class: "src", text: "loading…" })));
    const tools = el("div", { class: "ex-tools" },
      el("button", { type: "button", class: "btn primary", id: "exExport", onclick: () => exportAnswers("adapter") }, "Export answers"),
      el("button", { type: "button", class: "btn", id: "exExportP", onclick: () => exportAnswers("provider"), hidden: true }, "Export Claude (Try models)"),
      el("span", { class: "src", id: "exSaveNote" }));
    const list = el("div", { class: "ex-list", id: "exList" });
    root.append(head, el("div", { class: "ex-grid" }, el("aside", { class: "ex-side" }, howto, board, models, tools), el("section", { class: "ex-qs", "aria-label": "questions" }, el("div", { class: "ex-qhead" }, el("span", { class: "label", text: "Questions" }), el("span", { class: "src", id: "exListMeta" })), list)));
  }

  // ---------------------------------------------------------------- scoreboard
  function renderBoard() {
    const ids = gradedIds(), k = ids.length, all = S.qs.map(q => q.id);
    const subset = k ? ids : all;
    const rowsOf = m => subset.map(id => m.get(id)).filter(Boolean);
    const sc = { none: score(rowsOf(S.none)), base: score(rowsOf(S.base)), adapter: k ? score(ids.map(id => S.adapter[id].grade)) : null };
    const N = subset.length;
    const phases = { early: 0, mid: 0, late: 0 }; for (const id of subset) phases[S.byId.get(id).phase]++;
    const METRICS = [
      { key: "direct", name: "Kept as proposed", fmt: s => s.direct + "/" + s.N, lead: true, best: s => s.direct, title: "the reply's own change, tested on the sim, is legal and faster than the car it started from" },
      { key: "dgain", name: "Mean gain, as proposed", fmt: s => f4(s.dgain) + " s", best: s => s.dgain, title: "lap time gained per question (0 when not kept), averaged over the questions" },
      { key: "engine", name: "Kept with engine", fmt: s => s.engine + "/" + s.N, best: s => s.engine, title: "the engine's normal treatment of the reply: 3,000 variants around it screened, the best 24 tested on the sim" },
      { key: "egain", name: "Mean gain, with engine", fmt: s => f4(s.egain) + " s", best: s => s.egain },
      { key: "legal", name: "Legal as proposed", fmt: s => s.legal + "/" + s.N, best: s => s.legal, title: "the reply's change passes the 2026 technical rules (FIA Section C) without any repair" },
    ];
    const thead = el("tr", null, el("th", { scope: "col", class: "m" }, el("span", { class: "label", text: k ? "On the same " + k + " question" + (k === 1 ? "" : "s") : "All 30 questions" })),
      COLS.map(c => el("th", { scope: "col", class: "c-" + c.key }, el("span", { class: "cn", text: c.name }), el("span", { class: "cs", text: c.sub }))));
    const body = METRICS.map(m => {
      const vals = COLS.map(c => (sc[c.key] ? m.best(sc[c.key]) : null)), top = Math.max(...vals.filter(isNum));
      return el("tr", { class: m.lead ? "lead" : null },
        el("th", { scope: "row", class: "m", title: m.title || null }, m.name),
        COLS.map((c, i) => el("td", { class: "c-" + c.key + (sc[c.key] && isNum(vals[i]) && vals[i] === top && top > 0 ? " best" : "") }, sc[c.key] ? m.fmt(sc[c.key]) : el("span", { class: "muted", text: "—" }))));
    });
    const caption = k
      ? "Compared on the same " + k + " question" + (k === 1 ? "" : "s") + " (" + phases.early + " early · " + phases.mid + " mid · " + phases.late + " late): " + compactIds(ids) + ". " + (30 - k) + " still to grade."
      : "No adapter answers graded yet: paste the first replies below. No AI and regular Claude are shown on all 30.";
    const prov = gradedProvider();
    $("#exBoard").replaceChildren(...[
      el("div", { class: "ph" }, el("span", { class: "label", text: "Scoreboard" }), el("span", { class: "src", text: SIM })),
      el("div", { class: "ex-tablewrap" }, el("table", { class: "ex-table" }, el("thead", null, thead), el("tbody", null, body))),
      el("p", { class: "ex-cap src" }, caption),
      prov.length ? el("p", { class: "ex-cap src" }, "Claude (Try models), the console's side-by-side reply: kept as proposed " + score(prov.map(id => S.provider[id].grade)).direct + "/" + prov.length + " on " + compactIds(prov) + ".") : null,
      el("p", { class: "ex-cap src" }, "Kept = legal and faster on the sim than the car the question starts from. As proposed: the reply's own change (an illegal change is first moved to the nearest legal car, as the engine does). With engine: what the engine makes of the reply in one decision. Scores are counts, n/N."),
    ].filter(Boolean));
    $("#exExportP").hidden = !prov.length;
    const st = $("#exStatus");
    st.replaceChildren(el("span", { class: "badge " + (k ? "purple" : "") , text: k + "/30 graded" }), " ",
      S.api ? el("span", null, el("span", { class: "dot ok" }), "grader ready" + (S.api.writable ? " · saves on this server to " + S.api.saves :" · this site cannot store answers: they stay in this browser, use Export")) : el("span", { class: "warn" }, el("span", { class: "dot bad" }), S.apiWhy || "checking the grader…"));
    $("#exSaveNote").textContent = S.api && S.api.writable ? "Saved on this server and in this browser." : "Kept in this browser. Export downloads answers-adapter.json for the repo.";
  }
  // ---------------------------------------------------------------- model comparison (concept/exam/models.json + results files)
  // A results file counts for a model only if it is a live (not mock), untrained base-column run of exactly that model id on the
  // chosen question set. Haiku 4.5's earlier run (results-base.json, before --model existed) stands in for its column until a
  // results-base-claude-haiku-4-5.json exists, and says so.
  const MC = { variant: "plain", data: {} };
  // question sets: plain · + corrections · + corrections + shared memory (concept/engineer/memory.js "precedents" block); "all" shows
  // each column's "kept as proposed" on the three sets side by side
  const VARIANTS = [{ key: "plain", name: "The engine's message" }, { key: "corrections", name: "+ physics corrections block" }, { key: "memory", name: "with shared memory" }, { key: "all", name: "All three side by side" }];
  const SETS = VARIANTS.filter(v => v.key !== "all");
  const sfxOf = variant => (variant === "plain" ? "" : "-" + variant);
  function median(a) { if (!a.length) return null; const b = a.slice().sort((x, y) => x - y), m = b.length >> 1; return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2; }
  function modelStats(doc, isModel) {
    const rows = Array.isArray(doc && doc.rows) ? doc.rows : [], N = rows.length;
    const n = f => rows.filter(f).length, sum = f => rows.reduce((s, r) => s + (isNum(f(r)) ? f(r) : 0), 0);
    const st = { N, direct: n(r => r.direct && r.direct.kept), legal: n(r => r.legal), dgain: N ? sum(r => r.direct && r.direct.gain_s) / N : null, engine: n(r => r.engine && r.engine.kept) };
    if (!isModel) return st;
    const ok = rows.filter(r => !r.error && isNum(r.latency_ms));
    const lat = ok.map(r => r.latency_ms), out = ok.map(r => r.output_tokens).filter(isNum);
    const codes = {}; for (const r of rows) if (r.error) codes[r.error] = (codes[r.error] || 0) + 1;
    return Object.assign(st, { answered: ok.length, errors: N - ok.length, codes, latMedS: lat.length ? median(lat) / 1000 : null, outMean: out.length ? out.reduce((s, v) => s + v, 0) / out.length : null, cut: n(r => r.stop_reason === "max_tokens"), returned: Array.from(new Set(ok.map(r => r.model).filter(Boolean))) });
  }
  const variantOf = doc => (doc && doc.questions_variant) || "plain";
  function usableModel(doc, m, variant) {
    if (!doc || doc.kind !== "purple-designer-exam-results" || doc.column !== "base" || !Array.isArray(doc.rows) || !doc.rows.length) return "not a base-column results file";
    const meta = doc.meta || {};
    if (meta.mock !== false) return "a mock run (the scripted mock, not a model)";
    if (meta.trained !== false) return "not marked untrained";
    if (meta.model !== m.id) return "a run of " + (meta.model || "an unknown model") + ", not " + m.id;
    if (variantOf(doc) !== variant) return "another question set";
    return null;
  }
  async function loadModelCols(variant, getJ) {
    getJ = getJ || optJson;
    const sfx = sfxOf(variant);
    const list = await getJ(DATA + "models.json");
    if (!list || !Array.isArray(list.models)) throw new Error(DATA + "models.json missing or unreadable");
    const cols = await Promise.all(list.models.map(async m => {
      const file = "results-base-" + m.slug + sfx + ".json";
      const doc = await getJ(DATA + file);
      const why = doc ? usableModel(doc, m, variant) : "no file";
      if (!why) return { kind: "model", m, file, doc, st: modelStats(doc, true) };
      if (m.legacy_file) {
        const lf = m.legacy_file + sfx + ".json", ld = await getJ(DATA + lf);
        if (ld && !usableModel(ld, m, variant)) return { kind: "model", m, file: lf, doc: ld, earlier: true, st: modelStats(ld, true) };
      }
      return { kind: "model", m, file, doc: null, why: doc ? "ignored " + file + ": " + why : null };
    }));
    const nf = "results-none" + sfx + ".json", nd = await getJ(DATA + nf);
    const noneOk = !!(nd && nd.kind === "purple-designer-exam-results" && nd.column === "none" && Array.isArray(nd.rows) && variantOf(nd) === variant);
    cols.push({ kind: "none", m: { name: "No AI", id: "a random legal change" }, file: nf, doc: noneOk ? nd : null, st: noneOk ? modelStats(nd, false) : null });
    // "Memory only (no model)": the top precedent of the shared memory applied as listed (run.js --column memory); memory set only
    if (variant === "memory") {
      const mf = "results-memory-only.json", md = await getJ(DATA + mf);
      const ok = !!(md && md.kind === "purple-designer-exam-results" && md.column === "memory" && Array.isArray(md.rows) && variantOf(md) === "memory");
      cols.push({ kind: "memonly", m: { name: "Memory only (no model)", id: "the top precedent, applied as listed" }, file: mf, doc: ok ? md : null, st: ok ? modelStats(md, false) : null });
    }
    return { variant, models: list.models, cols };
  }
  function buildModels(data) {
    const cols = data.cols, shown = cols.filter(c => c.doc);
    const ran = c => c.kind === "none" || c.kind === "memonly" || c.st.answered > 0;
    const noCall = c => c.kind === "none" || c.kind === "memonly";
    const nN = (k, c) => c.st[k] + "/" + c.st.N;
    const METRICS = [
      { name: "Kept as proposed", lead: true, fmt: c => nN("direct", c), title: "the reply's own change, tested on the sim, is legal and faster than the car it started from" },
      { name: "Legal as proposed", fmt: c => nN("legal", c), title: "the reply's change passes the 2026 technical rules (FIA Section C) without any repair" },
      { name: "Mean gain as proposed (s)", fmt: c => f4(c.st.dgain), title: "lap time gained per question (0 when not kept), averaged over the questions" },
      { name: "Kept with engine", fmt: c => nN("engine", c), title: "the engine's normal treatment of the reply: 3,000 variants around it screened, the best 24 tested on the sim" },
      { name: "Median latency (s)", fmt: c => (noCall(c) ? "—" : isNum(c.st.latMedS) ? c.st.latMedS.toFixed(2) : "—"), title: "one call through Mubit, timed by the caller; median over the calls that answered" },
      { name: "Mean output tokens", fmt: c => (noCall(c) ? "—" : isNum(c.st.outMean) ? String(Math.round(c.st.outMean)) : "—"), title: "output tokens as reported by the provider (includes any thinking), mean over the calls that answered" },
    ];
    const thead = el("tr", null, el("th", { scope: "col", class: "m" }, el("span", { class: "label", text: "Per model" })),
      cols.map(c => el("th", { scope: "col", class: "mc-" + c.kind }, el("span", { class: "cn", text: c.m.name }), el("span", { class: "cs", text: c.m.id }))));
    const body = METRICS.map(mt => el("tr", { class: mt.lead ? "lead" : null },
      el("th", { scope: "row", class: "m", title: mt.title || null }, mt.name),
      cols.map(c => (!c.doc ? el("td", { class: "muted nr" }, "not run yet") : !ran(c) ? el("td", { class: "warn nr" }, "calls failed") : el("td", { class: "mc-" + c.kind }, mt.fmt(c))))));
    // where each column comes from, and anything that is not a clean answer (failed calls, replies cut at max_tokens)
    const notes = [];
    for (const c of cols) {
      if (!c.doc) { notes.push(c.m.name + ": not run yet (" + c.file + ")" + (c.why ? "; " + c.why : "") + "."); continue; }
      if (c.kind === "none") { notes.push("No AI: " + c.file + " (a seeded random legal change per question; no model call)."); continue; }
      if (c.kind === "memonly") { notes.push("Memory only (no model): " + c.file + " (each question answered with the first line of its precedents block, applied exactly as listed; no model call). A fair extra baseline: the same memory every model sees."); continue; }
      const meta = c.doc.meta || {}, st = c.st, bits = [c.file + (c.earlier ? " (the earlier Haiku run, before the comparison)" : "")];
      bits.push(st.N + " calls" + (isNum(meta.concurrency) ? ", " + meta.concurrency + " in flight" : c.earlier ? ", 2 in flight" : ""));
      bits.push(meta.temperature === null ? "temperature not sent (default sampling)" : "temperature " + meta.temperature);
      if (st.returned.length && st.returned.some(x => x !== c.m.id)) bits.push("model as returned: " + st.returned.join(", "));
      if (st.errors) bits.push(st.errors + "/" + st.N + " calls failed (" + Object.entries(st.codes).map(([k, v]) => k + (v > 1 ? " ×" + v : "")).join(", ") + "), graded as not kept");
      if (st.cut) bits.push(st.cut + "/" + st.N + " replies cut at max_tokens (" + (meta.max_tokens || 250) + ")");
      notes.push(c.m.name + ": " + bits.join(" · ") + ".");
    }
    const Ns = Array.from(new Set(shown.map(c => c.st.N)));
    const sha = Array.from(new Set(shown.map(c => c.doc.questions_sha256).filter(Boolean)));
    const noTemp = data.models.filter(m => m.temperature === null).map(m => m.name), withTemp = data.models.filter(m => m.temperature !== null).map(m => m.name);
    const sw = switcher(data.variant);
    return el("div", { class: "mc-body" },
      el("div", { class: "ph" }, el("span", { class: "label", text: "Model comparison" }), el("span", { class: "src", text: SIM })),
      el("p", { class: "ex-cap mc-lede" }, "Same " + (Ns.length === 1 ? Ns[0] : 30) + " car situations, same prompt, same physics; only the model changes."),
      sw,
      el("div", { class: "ex-tablewrap" }, el("table", { class: "ex-table mc-table" }, el("thead", null, thead), el("tbody", null, body))),
      noTemp.length ? el("p", { class: "ex-cap src" }, noTemp.join(" and ") + " run at " + (noTemp.length > 1 ? "their" : "its") + " default sampling: " + (noTemp.length > 1 ? "these models do" : "this model does") + " not accept a temperature setting" + (withTemp.length ? " (" + withTemp.join(", ") + ": temperature 0, as frozen)" : "") + ". They also think before answering, so they get up to 4,000 output tokens; Haiku keeps the frozen 250.") : null,
      Ns.length > 1 || sha.length > 1 ? el("p", { class: "ex-cap warn" }, "The columns are not on the same questions (N = " + Ns.join(", ") + "): compare with care.") : null,
      el("ul", { class: "ex-cap src mc-notes" }, notes.map(t => el("li", null, t))),
      data.variant === "memory" ? el("p", { class: "ex-cap src" }, MEMORY_NOTE) : null,
      el("p", { class: "ex-cap src" }, "All model calls go through Mubit, untrained (they never become training examples). Kept = legal and faster on the sim than the car the question starts from; an illegal change is first moved to the nearest legal car, as the engine does. Latency is one call, timed by the caller. Scores are counts, n/N."));
  }
  const MEMORY_NOTE = "Shared memory: the same for every model. Each question's message also lists up to 6 precedents from the physics-approved harvest decisions (the change as proposed was legal and faster on the sim on a similar car; nothing from this exam's runs or cars is in the index), changes already tried in that run left out. User message only; the frozen task is unchanged.";
  function switcher(cur) { return el("div", { class: "mc-sw", role: "group", "aria-label": "question set" }, VARIANTS.map(v => el("button", { type: "button", class: "btn sm" + (v.key === cur ? " on" : ""), "aria-pressed": v.key === cur ? "true" : "false", onclick: () => setVariant(v.key) }, v.name))); }
  // the three question sets side by side: one row per column (models, No AI, Memory only), "kept as proposed" n/N on each set
  function buildAll(all) {
    const rows = [], seen = new Map();
    for (const set of SETS) for (const c of all[set.key].cols) { const k = c.kind + ":" + (c.m.id || c.m.name); if (!seen.has(k)) { seen.set(k, rows.length); rows.push({ c, cells: {} }); } rows[seen.get(k)].cells[set.key] = c; }
    const cell = c => (!c ? el("td", { class: "muted nr" }, "—") : !c.doc ? el("td", { class: "muted nr" }, "not run yet") : c.st.answered === 0 && c.kind === "model" ? el("td", { class: "warn nr" }, "calls failed") : el("td", { class: "mc-" + c.kind }, c.st.direct + "/" + c.st.N));
    return el("div", { class: "mc-body" },
      el("div", { class: "ph" }, el("span", { class: "label", text: "Model comparison" }), el("span", { class: "src", text: SIM })),
      el("p", { class: "ex-cap mc-lede" }, "Kept as proposed on each question set: the same 30 car situations, the same prompt and physics; only the message's extra blocks change."),
      switcher("all"),
      el("div", { class: "ex-tablewrap" }, el("table", { class: "ex-table mc-table" },
        el("thead", null, el("tr", null, el("th", { scope: "col", class: "m" }, el("span", { class: "label", text: "Kept as proposed" })), SETS.map(s => el("th", { scope: "col" }, el("span", { class: "cn", text: s.key === "plain" ? "plain" : s.key === "corrections" ? "+ corrections" : "+ corrections + memory" }))))),
        el("tbody", null, rows.map(r => el("tr", null, el("th", { scope: "row", class: "m" }, r.c.m.name), SETS.map(s => cell(r.cells[s.key]))))))),
      el("p", { class: "ex-cap src" }, MEMORY_NOTE),
      el("p", { class: "ex-cap src" }, "Kept = legal and faster on the sim than the car the question starts from. Scores are counts, n/N; whatever a model scored is what shows."));
  }
  async function setVariant(v) {
    MC.variant = v;
    try {
      if (v === "all") { for (const s of SETS) if (!MC.data[s.key]) MC.data[s.key] = await loadModelCols(s.key); }
      else if (!MC.data[v]) MC.data[v] = await loadModelCols(v);
      renderModels();
    }
    catch (e) { const box = $("#exModels"); if (box) box.replaceChildren(el("div", { class: "ph" }, el("span", { class: "label", text: "Model comparison" })), el("p", { class: "ex-cap warn" }, "could not load the model comparison: " + (e.message || e))); }
  }
  function renderModels() {
    const box = $("#exModels"); if (!box) return;
    if (MC.variant === "all") { if (SETS.every(s => MC.data[s.key])) box.replaceChildren(buildAll(MC.data)); return; }
    const d = MC.data[MC.variant]; if (d) box.replaceChildren(buildModels(d));
  }
  const gradedProvider = () => S.qs.map(q => q.id).filter(id => S.provider[id]);
  function compactIds(ids) {
    const ns = ids.map(id => +id.slice(1)).sort((a, b) => a - b), out = [];
    for (let i = 0; i < ns.length; i++) { let j = i; while (j + 1 < ns.length && ns[j + 1] === ns[j] + 1) j++; const a = "q" + String(ns[i]).padStart(2, "0"), b = "q" + String(ns[j]).padStart(2, "0"); out.push(j > i ? a + "–" + b : a); i = j; }
    return out.join(", ");
  }

  // ---------------------------------------------------------------- questions
  function card(q) {
    const id = q.id, d = q.context && q.context.d_baseline_s;
    const ta = (col, label, ph) => {
      const t = el("textarea", { class: "ex-ta", id: "exTa-" + col + "-" + id, rows: col === "adapter" ? 4 : 3, spellcheck: "false", placeholder: ph, "aria-label": label + " · " + id });
      t.value = S.drafts[col][id] != null ? S.drafts[col][id] : S[col][id] ? S[col][id].text : "";
      t.addEventListener("input", () => { S.drafts[col][id] = t.value; saveDraftSoon(); renderState(id); });
      return el("div", { class: "ex-in ex-in-" + col },
        el("label", { class: "label", for: "exTa-" + col + "-" + id, text: label }), t,
        el("div", { class: "ex-act" }, el("button", { type: "button", class: "btn " + (col === "adapter" ? "primary" : ""), id: "exGrade-" + col + "-" + id, onclick: () => grade(id, col) }, "Grade"), el("span", { class: "src ex-msg", id: "exMsg-" + col + "-" + id })));
    };
    const prov = el("details", { class: "ex-prov", id: "exProv-" + id, open: !!(S.provider[id] || S.drafts.provider[id]) || null },
      el("summary", { class: "src" }, "Claude (Try models) reply, optional"), ta("provider", "Claude (Try models)", "the provider's side-by-side reply"));
    return el("article", { class: "panel ex-q", id: "exQ-" + id, "data-id": id },
      el("div", { class: "ex-qtop" },
        el("span", { class: "ex-id", text: id }), el("span", { class: "badge sm ph-" + q.phase, text: q.phase }),
        el("span", { class: "src ex-headcar", text: "starts from a car at " + f3(q.head.lap_s) + " s" + (isNum(d) ? " (" + (d < 0 ? MINUS : "+") + Math.abs(d).toFixed(3) + " s vs the RB22)" : "") }),
        el("span", { class: "spacer" }),
        el("span", { class: "ex-state", id: "exState-" + id }),
        el("button", { type: "button", class: "btn", id: "exCopy-" + id, onclick: () => copyQ(id) }, "Copy question")),
      el("details", { class: "ex-msgd" }, el("summary", { class: "src" }, "show the message (" + q.text.length.toLocaleString("en-GB") + " characters, one line)"), el("pre", { class: "ex-pre", text: q.text })),
      ta("adapter", "Paste the adapter's reply", "the Mubit-trained adapter's reply from Try models, exactly as shown"),
      prov,
      el("div", { class: "ex-res", id: "exRes-" + id }));
  }
  function renderList() {
    $("#exList").replaceChildren(...S.qs.map(card));
    for (const q of S.qs) { renderState(q.id); renderResult(q.id); }
    $("#exListMeta").textContent = "ids interleave early / mid / late, so any first n are balanced";
  }
  function renderState(id) {
    const s = $("#exState-" + id); if (!s) return;
    const g = S.adapter[id], ta = $("#exTa-adapter-" + id);
    const edited = g && ta && ta.value.trim() !== g.text.trim();
    s.replaceChildren(g ? el("span", { class: "badge sm " + (edited ? "amber" : "green"), text: edited ? "edited: grade again" : "graded" }) : el("span", { class: "badge sm", text: "to do" }));
    for (const col of ["adapter", "provider"]) { const b = $("#exGrade-" + col + "-" + id); if (b) b.disabled = S.busy.has(col + id) || !S.api; }
  }
  // one cell: "kept · 0.029 s faster" | "not kept · 0.012 s slower" | "unreadable reply"
  function cell(g, which) {
    if (!g) return el("td", { class: "muted" }, "—");
    if (!g.parsed) return el("td", { class: "warn" }, "unreadable reply");
    if (which === "legal") return el("td", { class: g.legal ? "ok" : "warn", title: g.articles && g.articles.length ? "breaks " + g.articles.join(", ") : null }, g.legal ? "yes" : "no" + (g.articles && g.articles.length ? " · " + g.articles[0] : ""));
    const c = g[which] || {};
    if (c.kept) return el("td", { class: "ok" }, el("b", null, "kept"), " · " + f3(c.gain_s) + " s faster");
    const why = c.from === "no change" ? "no change" : c.from === "none legal" ? "no legal car" : isNum(c.d_lap_s) ? (c.d_lap_s > 0 ? f3(c.d_lap_s) + " s slower" : "no faster") : "";
    return el("td", { class: "no" }, "not kept" + (why ? " · " + why : ""));
  }
  function renderResult(id) {
    const box = $("#exRes-" + id); if (!box) return;
    const a = S.adapter[id], p = S.provider[id];
    const who = [["No AI", S.none.get(id), "none"], ["Regular Claude", S.base.get(id), "base"], ["Adapter", a && a.grade, "adapter"]];
    if (p) who.push(["Claude (Try models)", p.grade, "provider"]);
    const t = el("table", { class: "ex-mini" },
      el("thead", null, el("tr", null, el("th", { scope: "col" }, ""), el("th", { scope: "col" }, "As proposed"), el("th", { scope: "col" }, "With engine"), el("th", { scope: "col" }, "Legal as proposed"))),
      el("tbody", null, who.map(([name, g, k]) => el("tr", { class: "w-" + k + (k === "adapter" && !g ? " pending" : "") }, el("th", { scope: "row" }, name), k === "adapter" && !g ? el("td", { colspan: "3", class: "muted" }, "paste the adapter's reply and press Grade") : [cell(g, "direct"), cell(g, "engine"), cell(g, "legal")]))));
    const hyp = a && a.grade && a.grade.proposal ? el("div", { class: "src ex-prop" }, "Adapter's change: " + a.grade.proposal.map(c => c.part + "." + c.param + " " + c.from + " → " + c.to).join(" · ")) : null;
    box.replaceChildren(...[t, hyp].filter(Boolean));
  }

  // ---------------------------------------------------------------- actions
  let draftTimer = null;
  function saveDraftSoon() { clearTimeout(draftTimer); draftTimer = setTimeout(lsWrite, 400); }
  async function copyQ(id) {
    const q = S.byId.get(id), b = $("#exCopy-" + id);
    let ok = false;
    try { await navigator.clipboard.writeText(q.text); ok = true; } catch (e) {
      const t = el("textarea", { style: "position:fixed;left:-9999px;top:0", readonly: true }); t.value = q.text; document.body.append(t); t.select();
      try { ok = document.execCommand("copy"); } catch (e2) { ok = false; } t.remove();
    }
    if (b) { b.textContent = ok ? "Copied" : "Copy failed: open “show the message”"; b.classList.toggle("done", ok); setTimeout(() => { b.textContent = "Copy question"; b.classList.remove("done"); }, 1800); }
    if (!ok) { const d = $("#exQ-" + id + " .ex-msgd"); if (d) d.open = true; }
  }
  async function grade(id, col) {
    const ta = $("#exTa-" + col + "-" + id), msg = $("#exMsg-" + col + "-" + id), text = ta ? ta.value : "";
    if (!text.trim()) { msg.textContent = "paste the reply first"; msg.className = "src ex-msg warn"; return; }
    S.busy.add(col + id); renderState(id);
    msg.textContent = "grading on the physics sim (a few seconds)…"; msg.className = "src ex-msg";
    try {
      const r = await fetch(API + "/api/concept/exam/grade", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, text, column: col }) });
      const j = await r.json().catch(() => null);
      if (!j || !j.ok) throw new Error(j && j.error ? j.error.code + ": " + j.error.message : "HTTP " + r.status);
      const g = j.data, keep = {};
      for (const k of ["id", "phase", "parsed", "legal", "direct", "engine", "proposal", "head_lap_s", "articles", "parse_error", "no_change", "clamped", "ms"]) if (g[k] !== undefined) keep[k] = g[k];
      S[col][id] = { text, grade: keep, graded_at: g.graded_at || new Date().toISOString() };
      delete S.drafts[col][id]; lsWrite();
      msg.textContent = "graded in " + (isNum(g.ms) ? (g.ms / 1000).toFixed(1) + " s" : "—") + (g.parsed ? "" : ": the reply is not a readable proposal (never kept)") + (g.saved ? " · saved to " + g.saved : " · kept in this browser");
      msg.className = "src ex-msg " + (g.parsed ? "" : "warn");
      renderResult(id); renderBoard();
    } catch (e) {
      msg.textContent = "could not grade (POST " + (API || "") + "/api/concept/exam/grade): " + (e.message || e); msg.className = "src ex-msg bad";
    } finally { S.busy.delete(col + id); renderState(id); }
  }
  function exportAnswers(col) {
    const out = { _about: col === "adapter"
      ? "PURPLE designer exam, column C: the Mubit-trained adapter's replies, pasted from the Mubit console (Try models) into the concept lab's Exam view. Commit as concept/exam/answers-adapter.json; grade from the CLI: node concept/exam/run.js --column adapter --answers concept/exam/answers-adapter.json --n 30"
      : "PURPLE designer exam: the provider's side-by-side replies from the Mubit console (Try models). Commit as concept/exam/answers-provider.json; CLI: node concept/exam/run.js --column adapter --answers concept/exam/answers-provider.json --label console-provider --n 30" };
    for (const q of S.qs) if (S[col][q.id]) out[q.id] = S[col][q.id];
    const blob = new Blob([JSON.stringify(out, null, 1) + "\n"], { type: "application/json" });
    const a = el("a", { href: URL.createObjectURL(blob), download: "answers-" + col + ".json" }); document.body.append(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  // ---------------------------------------------------------------- view switch (a third view next to the engineer and "no AI")
  function show(on) {
    S.shown = on;
    document.body.classList.toggle("exam-on", on);
    const ex = $("#btnViewExam"), a = $("#btnViewEng"), b = $("#btnViewNoAI"), m = $("#btnViewMubit");
    if (ex) { ex.classList.toggle("on", on); ex.setAttribute("aria-pressed", on ? "true" : "false"); }
    if (on) {
      for (const x of [a, b, m]) if (x) { x.classList.remove("on"); x.setAttribute("aria-pressed", "false"); }
      if (EI.engineerPanel && EI.engineerPanel.pause) try { EI.engineerPanel.pause(); } catch (e) { /* not booted */ }
    }
    try { const u = new URL(location.href); if (on) u.searchParams.set("view", "exam"); else if (u.searchParams.get("view") === "exam") u.searchParams.delete("view"); history.replaceState(null, "", u); } catch (e) { /* file:// */ }
    if (!on) window.dispatchEvent(new Event("resize"));
  }
  async function boot() {
    const main = $("#clab"); if (!main) return;
    frame();
    main.parentNode.insertBefore(root, main);
    const ex = $("#btnViewExam");
    if (ex) ex.addEventListener("click", () => show(true));
    for (const id of ["#btnViewEng", "#btnViewNoAI", "#btnViewMubit"]) { const b = $(id); if (b) b.addEventListener("click", () => { if (S.shown) show(false); }); }
    if (qs.get("view") === "exam") show(true);
    setVariant("plain");   // independent of the questions: a missing results file never blocks the rest of the view
    try { await load(); } catch (e) { $("#exList").replaceChildren(el("div", { class: "empty warn" }, "could not load the exam files (" + DATA + "questions.json, results-*.json): " + (e.message || e))); return; }
    renderList(); renderBoard();
    await probeApi();
    for (const q of S.qs) {
      // answers the server had (or the committed files): fill the boxes nobody has typed in yet
      for (const col of ["adapter", "provider"]) { const t = $("#exTa-" + col + "-" + q.id); if (t && !t.value && S[col][q.id] && S.drafts[col][q.id] == null) t.value = S[col][q.id].text; }
      const pd = $("#exProv-" + q.id); if (pd && S.provider[q.id]) pd.open = true;
      renderState(q.id); renderResult(q.id);
    }
    renderBoard();
  }
  EI.examPanel = { show, state: () => ({ loaded: S.loaded, graded: gradedIds(), provider: gradedProvider(), api: !!S.api, writable: !!(S.api && S.api.writable) }), grade, score, models: { load: loadModelCols, stats: modelStats, build: buildModels, setVariant } };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();
