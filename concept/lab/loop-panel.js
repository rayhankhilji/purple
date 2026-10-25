// PURPLE CONCEPT LAB - the Mubit loop panel (docs/concept/LOOP.md). A drawer over the concept lab that starts a closed-loop run on
// the API (POST /api/concept/loop on 127.0.0.1:8787, or ?api=) and follows its SSE stream. Per iteration it shows what was sent to
// Mubit (the previous changes and their measured results, plus the exact request), the proposal that came back, the simulated
// Silverstone lap and sector deltas with the segments that gained / lost, the legality verdict and the x-middleware-request-id,
// and which later request carried this result back. The verdict is the simulator's number comparison, never the model's.
// The browser never calls Mubit (no CORS there; the key stays on the server). Opens with the header button or ?loop=1.
// Every number carries its source label (G-HON-01). Dark only, tokens from lab/lab.css (docs/DESIGN_SYSTEM.md).
(function () {
  const qs = new URLSearchParams(location.search);
  const API = (qs.get("api") || "http://127.0.0.1:8787").replace(/\/$/, "");
  const $ = (s, root) => (root || document).querySelector(s);
  const MINUS = "−", isNum = v => typeof v === "number" && Number.isFinite(v);
  const fmtD = d => (isNum(d) ? (d < -1e-12 ? MINUS : "+") + Math.abs(d).toFixed(3) : "—");
  const dcls = d => (!isNum(d) || Math.abs(d) <= 0.0005 ? "flat" : d < 0 ? "faster" : "slower");
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
  const delta = (d, suffix) => el("span", { class: "delta " + dcls(d) }, fmtD(d) + (suffix || ""));
  const arrowChange = s => String(s || "").replace(/->/g, " → ").replace(/; /g, " · ");

  const S = { open: false, run: null, es: null, cards: new Map(), health: null, starting: false };

  // ---- the drawer
  const btn = el("button", { type: "button", class: "btn mubit-btn", id: "btnLoop", title: "the closed learning loop with Mubit: proposals in, simulated results back", onclick: () => toggle() }, "Mubit loop");
  const drawer = el("aside", { class: "loopd", id: "loopDrawer", "aria-label": "Mubit loop", hidden: true });
  const iters = el("input", { type: "number", id: "loopIters", min: "1", max: "30", step: "1", value: "10" });
  const seed = el("input", { type: "number", id: "loopSeed", min: "0", max: "999999", step: "1", value: "1" });
  const mode = el("select", { id: "loopMode" }, el("option", { value: "mock", selected: true }, "mock (no network)"), el("option", { value: "live" }, "live (untrained)"));
  const pace = el("select", { id: "loopPace", title: "wait before each call, so the stream is readable" }, el("option", { value: "0" }, "max"), el("option", { value: "400", selected: true }, "0.4 s"), el("option", { value: "1200" }, "1.2 s"));
  const start = el("button", { type: "button", class: "btn primary", id: "loopStart", onclick: () => startRun() }, "Start loop");
  const status = el("div", { class: "loop-status src", id: "loopStatus" }, "API " + API.replace(/^https?:\/\//, ""));
  const summary = el("div", { class: "loop-summary", id: "loopSummary" });
  const list = el("div", { class: "loop-list", id: "loopList", "aria-live": "polite" },
    el("div", { class: "empty" }, "Start a loop: each iteration sends the current car and the measured results of the previous changes to Mubit (one session per run), gets the next proposal, measures it on the physics lap sim at Silverstone and feeds the result into the next request."));
  drawer.append(
    el("div", { class: "ph" }, el("span", { class: "label" }, "Mubit loop · proposals in, simulated results back"), el("button", { type: "button", class: "btn icon", title: "close", "aria-label": "close", onclick: () => toggle(false) }, "×")),
    el("form", { class: "ctl loop-ctl", onsubmit: e => { e.preventDefault(); startRun(); } },
      el("label", { class: "f" }, "iterations ", iters), el("label", { class: "f" }, "seed ", seed), el("label", { class: "f" }, "mode ", mode), el("label", { class: "f" }, "pace ", pace), start),
    status, summary, list,
    el("div", { class: "pf src" }, "Lap and sector deltas: physics lap sim · Silverstone · after − before, negative is faster. Kept = legal and the weekend score improves (computed from the simulator's numbers; the model's output has no verdict field). Proposals in mock mode come from a scripted stand-in, not a model."));

  function toggle(on) {
    S.open = on == null ? !S.open : !!on;
    drawer.hidden = !S.open; btn.classList.toggle("on", S.open);
    if (S.open) health();
  }
  // Escape closes the drawer (as the Engine drawer does)
  document.addEventListener("keydown", e => { if (e.key === "Escape" && S.open) toggle(false); });
  async function api(path, init) {
    const res = await fetch(API + path, init); const j = await res.json().catch(() => null);
    if (!j || !j.ok) throw new Error((j && j.error && j.error.message) || ("HTTP " + res.status));
    return j.data;
  }
  async function health() {
    try {
      const h = await api("/api/health"); S.health = h;
      const liveOpt = mode.querySelector("option[value=live]"); liveOpt.disabled = !!h.mock; if (h.mock && mode.value === "live") mode.value = "mock";
      setStatus(el("span", { class: "dot ok" }), " API " + API.replace(/^https?:\/\//, "") + (h.mock ? " · server in MUBIT_MOCK (live off)" : " · live available (untrained calls)"));
    } catch (e) { setStatus(el("span", { class: "dot bad" }), " cannot reach the API at " + API + " (start it with npm run dev)"); }
  }
  function setStatus(...kids) { status.replaceChildren(...kids); }

  async function startRun() {
    if (S.starting || (S.run && S.run.status === "running")) return;
    S.starting = true; start.disabled = true;
    try {
      const body = { iterations: Math.max(1, Math.min(30, parseInt(iters.value, 10) || 10)), seed: parseInt(seed.value, 10) || 0, mode: mode.value, pace_ms: parseInt(pace.value, 10) || 0 };
      const run = await api("/api/concept/loop", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      S.run = Object.assign({ status: "running" }, run); S.cards.clear(); list.replaceChildren(); summary.replaceChildren();
      setStatus(el("span", { class: "badge sm mubit" }, run.mode === "mock" ? "mock · nothing sent" : run.trained ? "TRAINED" : "untrained"), " session (metadata.user_id) ", el("code", { class: "rid" }, run.session_id), " · " + run.iterations + " iterations · seed " + run.seed);
      follow(run);
    } catch (e) { setStatus(el("span", { class: "warn" }, "could not start: " + e.message)); start.disabled = false; }
    finally { S.starting = false; }
  }
  function follow(run) {
    if (S.es) S.es.close();
    const es = new EventSource(API + run.stream); S.es = es;
    const on = (type, fn) => es.addEventListener(type, m => { try { fn(JSON.parse(m.data)); } catch (e) { console.warn("loop event " + type, e); } });
    on("start", ev => { S.base = ev.baseline; renderSummary(ev, null); });
    on("request", ev => card(ev.iteration).request(ev));
    on("response", ev => card(ev.iteration).response(ev));
    on("proposal", ev => card(ev.iteration).proposal(ev));
    on("result", ev => { card(ev.iteration).result(ev.row); renderSummary(null, ev); });
    on("link", ev => card(ev.iteration).link(ev.fed_to));
    on("done", ev => { S.run.status = "done"; renderDone(ev.summary); });
    on("error", ev => { if (ev && ev.error) { S.run.status = "error"; list.append(el("div", { class: "empty warn" }, "run failed: " + ev.error)); } });
    on("end", () => { es.close(); start.disabled = false; });
    es.onerror = () => { if (S.run && S.run.status === "running") setStatus(el("span", { class: "warn" }, "stream interrupted (API down?)")); es.close(); start.disabled = false; };
  }

  // ---- one card per iteration
  function card(k) {
    if (S.cards.has(k)) return S.cards.get(k);
    const head = el("div", { class: "lc-head" }, el("span", { class: "lc-k" }, "#" + k), el("code", { class: "rid", title: "x-middleware-request-id of this iteration's call" }, "…"), el("span", { class: "lc-badges" }));
    const sent = el("div", { class: "lc-sec lc-sent" }, el("div", { class: "label tight", title: "the user message of this iteration's call: the previous changes and their measured results" }, S.run && S.run.mode === "mock" ? "To Mubit · mock: built, not sent" : "Sent to Mubit"));
    const prop = el("div", { class: "lc-sec lc-prop" }, el("div", { class: "label tight" }, S.run && S.run.mode === "mock" ? "Proposal back · scripted mock" : "Proposal back"));
    const meas = el("div", { class: "lc-sec lc-meas" }, el("div", { class: "label tight" }, "Simulated · Silverstone"));
    const foot = el("div", { class: "lc-foot src" });
    const root = el("article", { class: "lcard", id: "lc-" + k }, head, el("div", { class: "lc-grid" }, sent, prop, meas), foot);
    list.append(root); root.scrollIntoView({ block: "nearest" });
    const c = {
      request(ev) {
        const sc = ev.scenario || {}, tested = sc.tested || [];
        const rows = tested.length ? tested.map((t, i) => el("div", { class: "lc-t" + (i === tested.length - 1 ? " last" : "") },
          el("span", { class: "chg" }, arrowChange(t.change)), " ",
          t.d_lap_s == null ? el("span", { class: "badge sm red" }, "illegal " + (t.illegal || []).join(" ")) : delta(t.d_lap_s, " s"),
          t.ds ? el("span", { class: "src" }, " · sectors " + t.ds.map(fmtD).join(" ")) : null,
          " ", el("span", { class: "src" }, t.kept ? "kept" : "not kept"), t.by ? el("span", { class: "src" }, " · fallback") : null,
          t.gain || t.loss ? el("div", { class: "src seg" }, [].concat((t.gain || []).map(g => "gained " + g), (t.loss || []).map(l => "lost " + l)).join(" · ")) : null))
          : [el("div", { class: "src" }, "first call: the starting car only, no results yet")];
        const refused = (sc.refused || []).map(r => el("div", { class: "src" }, "refused earlier: " + arrowChange(r.change) + " (" + r.why + ")"));
        const req = ev.request;
        const exact = req ? el("details", { class: "lc-exact" }, el("summary", { class: "src" }, "exact request (" + ev.scenario_chars + " chars ≈ " + ev.scenario_tokens + " tokens)" + (req.headers["x-middleware-record"] ? " · x-middleware-record: " + req.headers["x-middleware-record"] : " · TRAINED")),
          el("pre", null, req.method + " " + req.url + "\n" + Object.entries(req.headers).map(([h, v]) => h + ": " + v).join("\n") + "\n\n" + JSON.stringify(Object.assign({}, JSON.parse(req.body), { system: "(designer system prompt, " + JSON.parse(req.body).system.length + " chars)", messages: [{ role: "user", content: sc }] }), null, 1))) : null;
        sent.append(el("div", { class: "lc-body" }, el("div", { class: "src" }, "session " + ev.session_id + (tested.length ? " · last " + tested.length + " tested changes and their measured results:" : "")), rows, refused, exact));
      },
      response(ev) {
        head.children[1].textContent = ev.mubit_request_id || (ev.ok ? "no request id" : "error");
        if (!ev.ok) prop.append(el("div", { class: "warn" }, "call failed: " + ev.error));
      },
      proposal(ev) {
        const b = head.children[2];
        b.append(el("span", { class: "badge sm " + (ev.proposer === "llm" ? "mubit" : "amber"), title: ev.proposer === "llm" ? "the proposal came back from the call" : "the answer was refused; a seeded fallback step was measured instead" }, ev.proposer === "llm" ? "proposal" : "fallback"));
        if (ev.proposer === "llm") {
          prop.append(el("div", { class: "lc-body" }, el("div", { class: "chg" }, (ev.changes || []).map(x => el("div", null, x.part + "." + x.param + " " + x.from + " → " + x.to))),
            ev.hypothesis ? el("div", { class: "lc-hyp" }, "“" + ev.hypothesis + "”") : null,
            ev.expected ? el("div", { class: "src" }, "expects lap " + (ev.expected.lap_delta_s < 0 ? "faster" : ev.expected.lap_delta_s > 0 ? "slower" : "unchanged") + ", mostly in S" + ev.expected.sector + " (recorded, never used to decide)") : null));
        } else {
          prop.append(el("div", { class: "warn" }, "refused: " + ev.reason + (ev.refused ? " · " + arrowChange(ev.refused.change) + " (" + ev.refused.why + ")" : ev.detail ? " · " + ev.detail : "")),
            el("div", { class: "src" }, "measured instead (seeded fallback): " + arrowChange(ev.change)));
        }
      },
      result(row) {
        const m = row.measured || {}, b = head.children[2];
        b.append(el("span", { class: "badge sm " + (row.kept ? "green" : row.legal ? "" : "red") }, row.kept ? "kept" : row.legal ? "rejected" : "illegal"));
        if (m.d_lap_s != null) {
          meas.append(el("div", { class: "lc-body" }, el("div", null, "lap " + m.lap_before.toFixed(3) + " → " + m.lap_after.toFixed(3) + " s ", delta(m.d_lap_s, " s")),
            el("div", { class: "secs" }, (m.d_sectors_s || []).map((d, i) => el("span", null, "S" + (i + 1) + " ", delta(d)))),
            m.moves ? el("div", { class: "src seg" }, (m.moves.gain.length ? "gained " + m.moves.gain.join(", ") : "") + (m.moves.gain.length && m.moves.loss.length ? " · " : "") + (m.moves.loss.length ? "lost " + m.moves.loss.join(", ") : "")) : null));
        } else meas.append(el("div", { class: "warn" }, "no lap: an illegal car is not simulated"));
        const lg = m.legality || {};
        meas.append(el("div", { class: lg.legal ? "ok" : "warn" }, lg.legal ? "legal (FIA 2026 technical regulations, concept/regs.js)" : "illegal: " + (lg.articles || []).join(" ")));
        foot.replaceChildren((row.kept ? "kept: " : "not kept: ") + (row.legal ? "weekend score " + (isNum(row.score_before) ? row.score_before.toFixed(3) : "—") + " → " + (isNum(row.score_after) ? row.score_after.toFixed(3) : "—") : "illegal") + " · " + (m.label || ""));
        root.classList.add(row.kept ? "is-kept" : "is-rejected");
      },
      link(fed) { foot.append(el("div", { class: "fed" }, "→ this result went to Mubit in #" + fed.iteration + "'s request ", el("code", { class: "rid" }, fed.mubit_request_id || "—"))); },
    };
    S.cards.set(k, c); return c;
  }
  function renderSummary(startEv, resEv) {
    const base = S.base; if (!base) return;
    const best = resEv ? resEv.best : { lap_s: base.lap_s, gap_to_pole_s: base.gap_to_pole_s };
    summary.replaceChildren(el("div", null, el("span", { class: "label tight" }, "Silverstone lap "), base.lap_s.toFixed(3) + " → ", el("b", null, best.lap_s.toFixed(3) + " s"), " ", delta(best.lap_s - base.lap_s, " s"),
      el("span", { class: "src" }, " · gap to the real 2026 pole " + fmtD(best.gap_to_pole_s) + " s")));
  }
  function renderDone(s) {
    if (!s) return;
    summary.append(el("div", { class: "src" }, "done: " + s.iterations + " iterations · kept " + s.kept + " (" + Object.entries(s.kept_by_proposer || {}).map(([k, v]) => k + " " + v).join(", ") + ") · one session " + s.session_id + " · " + s.label));
  }

  function mount() {
    const top = document.querySelector("header.top"), back = top && top.querySelector(".back, .hbreak");   // end of the first header row
    if (top) top.insertBefore(btn, back || null);
    document.body.append(drawer);
    if (qs.get("loop") === "1") toggle(true);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount); else mount();
  window.EI = window.EI || {}; window.EI.conceptLoopPanel = { toggle, start: startRun, state: S, API };
})();
