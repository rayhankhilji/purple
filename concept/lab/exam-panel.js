// PURPLE CONCEPT LAB - the EXAM view (concept/exam/, server/exam-route.js). 30 held-out car situations; three columns graded the same
// way on the physics lap sim: A. no AI (results-none.json), B. regular Claude through Mubit, untrained (results-base.json), C. the
// Mubit-trained adapter, whose replies the owner pastes from the Mubit console (Try models; the adapter cannot be called from code).
// The page: copy a question (the exact user message the engine sends to the frozen designer task) -> paste it in Try models -> paste
// the adapter's reply here -> Grade (POST /api/concept/exam/grade: concept/exam/grade.js on the server, no Mubit call) -> the row
// shows the adapter beside no AI and regular Claude for the same question, and the scoreboard compares all three on the same k
// questions. Graded replies persist in this browser (localStorage) and, on a local server, in concept/exam/answers-adapter.json;
// "Export answers" downloads that same file (the public site is read-only). Scores are n/N, never percentages (G-HON-06).
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
    const tools = el("div", { class: "ex-tools" },
      el("button", { type: "button", class: "btn primary", id: "exExport", onclick: () => exportAnswers("adapter") }, "Export answers"),
      el("button", { type: "button", class: "btn", id: "exExportP", onclick: () => exportAnswers("provider"), hidden: true }, "Export Claude (Try models)"),
      el("span", { class: "src", id: "exSaveNote" }));
    const list = el("div", { class: "ex-list", id: "exList" });
    root.append(head, el("div", { class: "ex-grid" }, el("aside", { class: "ex-side" }, howto, board, tools), el("section", { class: "ex-qs", "aria-label": "questions" }, el("div", { class: "ex-qhead" }, el("span", { class: "label", text: "Questions" }), el("span", { class: "src", id: "exListMeta" })), list)));
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
    const ex = $("#btnViewExam"), a = $("#btnViewEng"), b = $("#btnViewNoAI");
    if (ex) { ex.classList.toggle("on", on); ex.setAttribute("aria-pressed", on ? "true" : "false"); }
    if (on) {
      for (const x of [a, b]) if (x) { x.classList.remove("on"); x.setAttribute("aria-pressed", "false"); }
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
    for (const id of ["#btnViewEng", "#btnViewNoAI"]) { const b = $(id); if (b) b.addEventListener("click", () => { if (S.shown) show(false); }); }
    if (qs.get("view") === "exam") show(true);
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
  EI.examPanel = { show, state: () => ({ loaded: S.loaded, graded: gradedIds(), provider: gradedProvider(), api: !!S.api, writable: !!(S.api && S.api.writable) }), grade, score };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();
