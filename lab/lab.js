// PURPLE lab — the side panel (F-06), race hand-off (F-04), correction loop (F-05), Mubit widget and ledger.
// Plain JS, one IIFE on window.EI.lab. Talks ONLY to the API on 127.0.0.1:8787 (never to Mubit). Design: docs/DESIGN_SYSTEM.md.
// Every number on screen carries its source label: evaluation.model, measured.label, or "research agent · <model> via Mubit".
(function () {
  const EI = (window.EI = window.EI || {});
  const qs = new URLSearchParams(location.search);
  const API = (qs.get("api") || "http://127.0.0.1:8787").replace(/\/$/, "");
  const LAPS = 3;                                   // F-04.AC1: three laps, no input
  const SHEET_N = 8;                                // G-HON-06: v1 / v2 Try models scores are out of the 8-item sheet unless exam.v1_total says otherwise
  const FLAT = 0.03;                                // DeltaCell: |Δ| ≤ 0.03 s is grey (the prompt's own retest band)
  const TRACE_MAX = 200, BACKFILL = 12;
  const RACE_TIMEOUT_MS = 6 * 60 * 1000;             // EVAL_GUARDRAILS §6: no purple:result within 6 minutes -> "No result received"
  const $ = (s, root) => (root || document).querySelector(s);
  const isNum = v => typeof v === "number" && Number.isFinite(v);
  const reduced = () => window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ---- tiny DOM helper: el(tag, attrs, ...children); attrs.text sets textContent, attrs.onX adds a listener
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

  // ---- formatting (DESIGN_SYSTEM §3): times 3 dp, deltas signed with a real minus sign, speeds integer km/h
  const fmtT = t => (isNum(t) ? t.toFixed(3) : "—");
  const fmtD = d => (isNum(d) ? (d < 0 ? "−" : "+") + Math.abs(d).toFixed(3) : "—");
  const fmtV = v => (isNum(v) ? Math.round(v) + " km/h" : "—");
  const fmtPct = p => (isNum(p) ? p + " %" : p === null ? "n/a" : "—");
  const deltaClass = d => (!isNum(d) || Math.abs(d) <= FLAT ? "flat" : d < 0 ? "faster" : "slower");
  const hhmm = iso => { const d = new Date(iso); return isNaN(d) ? "—" : String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0"); };
  const hhmmss = iso => { const d = iso ? new Date(iso) : new Date(); return hhmm(d) + ":" + String(d.getSeconds()).padStart(2, "0"); };
  const short = (s, n) => (s && s.length > n ? s.slice(0, n) + "…" : s || "—");
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : "c-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10));
  const b64 = obj => btoa(unescape(encodeURIComponent(JSON.stringify(obj))));
  const PARAM = { front_wing_deg: ["front wing", "°"], rear_wing_deg: ["rear wing", "°"], ride_height_mm: ["ride height", " mm"], brake_bias_pct: ["brake bias", " %"], ers_deploy: ["ERS deploy", ""] };
  const pname = k => (PARAM[k] ? PARAM[k][0] : k);
  const punit = k => (PARAM[k] ? PARAM[k][1] : "");
  const fmtSetupV = (k, v) => (k === "ers_deploy" ? (+v).toFixed(1) : String(v));
  // Honesty audit A: the evaluator's 80.800 s is the game's time scale; the real 2026 pole maps onto it linearly (lab/evaluator.js MODEL_LABEL is pinned by tests, so the scale note lives here)
  const GAME_SCALE = { silverstone: "real 2026 pole 88.111 s = 80.800 s (×1.090)", monza: "real 2026 pole 81.786 s = 76.650 s (×1.067)" };
  const GAME_SCALE_SHORT = { silverstone: "real 2026 pole 88.111 s = 80.800 s", monza: "real 2026 pole 81.786 s = 76.650 s" };   // EVALUATE label row: one extra line at 1280×800 (QA B1)
  const gameScale = circuit => "game time scale · " + (GAME_SCALE[circuit] ? GAME_SCALE[circuit] + " · " : "") + "Δ in game seconds";
  const gameScaleShort = circuit => "game time" + (GAME_SCALE_SHORT[circuit] ? " · " + GAME_SCALE_SHORT[circuit] : " seconds");
  const agentLabel = () => "research agent · " + ((S.status && S.status.model) || "claude-haiku-4-5") + " via Mubit";

  // ---- state
  const S = {
    current: null, ledger: [], rules: [], status: null, state: null,
    busy: {}, err: {}, racing: null, showGame: false, grid: null, lastRacePayload: null, active: null, apiOk: null, ledgerTotal: 0,
    rendered: { evalId: null }, traceSeen: new Set(), lastStatusKey: null, car3dMounted: false, car3dSetupKey: null, illegalCandidate: null,
  };

  // ---- API client. Envelope { ok, data } | { ok, error: { code, message, … } } (ARCHITECTURE §5). Throws ApiErr with code + endpoint.
  class ApiErr extends Error { constructor(code, endpoint, message, extra) { super(message); this.code = code; this.endpoint = endpoint; this.extra = extra || {}; } }
  async function api(method, path, body, headers) {
    const endpoint = method + " " + path.split("?")[0];
    const init = { method, headers: Object.assign({}, headers || {}) };
    if (body !== undefined) { init.headers["content-type"] = "application/json"; init.body = JSON.stringify(body); }
    let res, json;
    try { res = await fetch(API + path, init); }
    catch (e) { setApi(false); throw new ApiErr("NETWORK", endpoint, "cannot reach " + API + " (server down, or the API sends no CORS headers for " + location.origin + ")"); }
    try { json = await res.json(); } catch (e) { setApi(true); throw new ApiErr("BAD_RESPONSE", endpoint, "HTTP " + res.status + " without a JSON envelope"); }
    setApi(true);
    if (!json || json.ok !== true) { const er = (json && json.error) || {}; throw new ApiErr(er.code || "HTTP_" + res.status, endpoint, er.message || "request failed", er); }
    return json.data;
  }
  function setApi(ok) {
    if (S.apiOk === ok) return; S.apiOk = ok;
    const n = $("#apiState"); n.replaceChildren(el("span", { class: "dot " + (ok ? "ok" : "bad") }), "API " + API.replace(/^https?:\/\//, ""));
  }

  // ---- error banner (F-06.AC3): names the failed endpoint; dismissable
  function banner(err) {
    const b = $("#banner");
    // QA S6: the banner sits in the 40 px header (in place of the subtitle), so it never moves the layout; the full text is in the title
    const msg = (err.code ? err.code + " · " : "") + (err.message || "");
    b.title = err.endpoint + " · " + msg;
    b.replaceChildren(el("span", { class: "label", text: "error" }), el("code", { text: err.endpoint }), el("span", { class: "msg", text: msg }),
      el("button", { class: "x", type: "button", "aria-label": "dismiss", onclick: clearBanner, text: "dismiss" }));
    b.hidden = false; document.body.classList.add("has-banner");
  }
  function clearBanner() { $("#banner").hidden = true; document.body.classList.remove("has-banner"); }
  function toast(text) { const t = el("div", { class: "toast", role: "status", text }); document.body.appendChild(t); setTimeout(() => t.remove(), 1200); }

  // ---- StageCard { state: empty|loading|error|success, body, src, foot }; a 2 px progress bar under the card while loading.
  // QA B1: the source label (G-HON-01) renders in .srcbar, a fixed row above the buttons, never inside the scrolling body.
  function card(stage, o) {
    const c = $("#card-" + stage);
    c.className = "card is-" + o.state + (S.active === stage ? " is-active" : "");
    $(".state", c).textContent = o.stateLabel || o.state;
    const head = $(".head", c), oldFlag = $(".flag", head);   // optional badge beside the state label (RACE: "still air"), always in view
    if (oldFlag) oldFlag.remove();
    if (o.flag) { o.flag.classList.add("flag"); head.insertBefore(o.flag, $(".state", c)); }
    $(".body", c).replaceChildren(...[o.body].flat(Infinity).filter(Boolean));
    $(".srcbar", c).replaceChildren(...[o.src].flat(Infinity).filter(Boolean).map(s => (typeof s === "string" ? el("div", { class: "src", text: s }) : s)));
    $(".foot", c).replaceChildren(...(o.foot || []).flat(Infinity).filter(Boolean));
    const p = $(".progress", c);
    if (o.state === "loading") { if (!p) c.appendChild(el("div", { class: "progress", "aria-hidden": "true" })); } else if (p) p.remove();
  }
  const errBody = (e, extra) => [el("div", { class: "err", text: e.code + " · " + e.endpoint + (e.extra && e.extra.mubit_code ? " · " + e.extra.mubit_code : "") }), el("p", { text: e.message }), extra];
  const windy = x => !!(x && x.conditions && +x.conditions.wind_ms > 0);
  // G-HON-01: the game has no wind model; a windy experiment races in still air while the evaluator's numbers include the wind
  const windNote = x => (windy(x) ? el("div", { class: "row" }, el("span", { class: "badge amber", text: "still air" }), el("span", { class: "sans muted", text: "raced in still air (the game has no wind); evaluator numbers include the wind, " + x.conditions.wind_ms + " m/s from " + (x.conditions.wind_from_deg || 0) + "°" })) : null);
  const btn = (label, onclick, o) => el("button", Object.assign({ class: "btn" + (o && o.cls ? " " + o.cls : ""), type: "button", onclick, disabled: !!(o && o.disabled), title: o && o.title }, {}), label);
  const delta = (d, cls) => el("span", { class: "delta " + deltaClass(d) + (cls ? " " + cls : ""), text: fmtD(d) });
  const verdictPill = (v, cls) => el("span", { class: "verdict " + v + (cls ? " " + cls : ""), text: v });
  const illegalViolations = () => {
    const e = S.err.design, v = e && e.extra && Array.isArray(e.extra.violations) ? e.extra.violations : null;
    return v || (EI.aero && S.illegalCandidate ? EI.aero.violations(S.illegalCandidate, { td01: !!(S.state && S.state.td01) }) : []);
  };

  // ---- DESIGN: the research agent's plan (verdict, next experiment, hypothesis, reject_if)
  function renderDesign() {
    const x = S.current, e = S.err.design;
    const runBtn = (label, o) => btn(label, () => runPlan(o), { cls: "primary", disabled: !!S.busy.plan });
    const randomBtn = btn("Run random", () => runPlan({ random: true }), { cls: "small", disabled: !!S.busy.plan, title: "random legal candidate instead of the agent's next step" });
    if (S.busy.plan) return card("design", { state: "loading", stateLabel: "asking the agent", body: [el("p", { text: "POST /api/plan · evaluating the candidate, then the research agent decides through Mubit." })], src: agentLabel(), foot: [runBtn("Run")] });
    if (e) {
      const viol = e.extra && Array.isArray(e.extra.violations) ? e.extra.violations : null;
      const extra = viol ? el("div", {}, viol.map(id => el("div", { class: "row" }, el("span", { class: "badge " + (id === "TD-01" ? "td" : "red"), text: id }), el("span", { class: "sans muted", text: EI.aero && EI.aero.describeViolation ? EI.aero.describeViolation(id) : id })))) : null;
      return card("design", { state: "error", body: errBody(e, extra), foot: [btn("Retry", e.retry, { cls: "primary" }), randomBtn] });
    }
    if (!x) return card("design", { state: "empty", body: [el("p", { text: "No plan yet. Run asks the research agent for a verdict on a candidate setup and the single next experiment." })], foot: [runBtn("Run")] });
    const p = x.plan;
    const body = [];
    // line 1: the agent's verdict, then (when it happened) the engineer's overrule or the promotion, on the same line
    const sm = x.overrule ? "sm" : null;   // agent verdict → engineer verdict + rule chip on one line; "promoted" is the state label (and LEARN's, and the ledger status)
    body.push(el("div", { class: "row", title: "experiment " + x.id + " · seed " + x.seed + (x.status === "promoted" ? " · promoted: the candidate is the new baseline" : "") }, p ? verdictPill(p.verdict, sm) : el("span", { class: "verdict reject", text: x.error ? x.error.code : "parse_error" }),
      x.overrule ? [el("span", { class: "sans muted", text: "→" }), verdictPill(x.overrule.verdict, sm), el("span", { class: "chip rule", title: x.overrule.reason, text: x.overrule.rule_id })] : null));
    body.push(el("div", { class: "one sans", title: "candidate · " + (x.change || "no change"), text: "candidate · " + (x.change || "no change") }));
    if (p) {
      const sign = p.direction === "decrease" ? "−" : "+";
      body.push(el("div", { class: "kvl", title: "next: " + pname(p.next_parameter) + " " + p.direction + " by " + fmtSetupV(p.next_parameter, p.magnitude) + punit(p.next_parameter) }, el("span", { class: "k", text: "next" }),
        el("span", { class: "one" }, el("b", { text: pname(p.next_parameter) }), " " + sign + fmtSetupV(p.next_parameter, p.magnitude) + punit(p.next_parameter))));
      body.push(el("div", { class: "kvl", title: "expected sector effect, seconds" }, el("span", { class: "k", text: "expect" }),
        el("span", { class: "xs" }, p.expected_sector_effect.map((d, i) => el("span", {}, el("span", { class: "muted", text: "S" + (i + 1) + " " }), delta(d))))));
      body.push(el("div", { class: "hyp", title: p.hypothesis, text: p.hypothesis }));
      body.push(el("div", { class: "muted one", title: "reject_if: " + p.reject_if, text: "reject if " + p.reject_if }));
    } else if (x.error) body.push(el("p", { class: "one", title: x.error.message, text: x.error.message }));
    card("design", { state: "success", stateLabel: x.status === "promoted" ? "promoted" : x.status === "overruled" ? "overruled" : "success", body, src: agentLabel() + " · " + short(x.mubit_request_id, 10) + " · " + (x.latency_ms || 0) + " ms", foot: [runBtn(x.plan ? "Run next" : "Run"), randomBtn] });
  }

  // ---- EVALUATE: lap, sectors, deltas, vmax/vmin, legality — every number labelled with evaluation.model
  function renderEvaluate() {
    const x = S.current, ev = x && x.evaluation;
    if (S.busy.plan) return card("evaluate", { state: "loading", stateLabel: "evaluating", body: [el("p", { text: "Candidate and baseline under the same conditions." })] });
    // QA S4: an illegal candidate (422 ILLEGAL_SETUP) is never evaluated; say so instead of showing the previous experiment's numbers
    if (S.illegalCandidate) {
      const viol = illegalViolations();
      return card("evaluate", { state: "error", stateLabel: "illegal", body: [
        el("div", { class: "row" }, el("span", { class: "badge red", text: "illegal · " + (viol.join(", ") || "setup") + " · no lap time" })),
        viol.map(id => el("p", { text: EI.aero && EI.aero.describeViolation ? EI.aero.describeViolation(id) : id }))],
        src: "POST /api/plan · 422 ILLEGAL_SETUP · not evaluated, not raced, not sent to the agent" });
    }
    if (!ev || !isNum(ev.lap)) return card("evaluate", { state: "empty", body: [el("p", { text: "Numbers arrive with the first plan: lap, three sectors, top speed and the fast-complex minimum, candidate minus baseline." })], foot: [btn("Run", () => runPlan(), { cls: "primary", disabled: !!S.busy.plan })] });
    const fresh = S.rendered.evalId !== x.id; S.rendered.evalId = x.id;
    const settle = fresh && !reduced() ? "settle" : "";
    const base = ev.baseline || {};
    const circuit = x.circuit || (x.conditions && x.conditions.circuit) || "silverstone";
    const vminName = EI.aero && EI.aero.REF_CORNER && EI.aero.REF_CORNER[circuit] ? EI.aero.REF_CORNER[circuit].name : "fast complex";
    const body = [
      el("div", { class: "row nw" }, delta(ev.delta_lap, "big " + settle), el("span", { class: "label", text: "lap Δ" })),
      el("div", { class: "row nw" }, el("span", { class: "num " + settle, text: fmtT(ev.lap) }), el("span", { class: "muted", text: "vs " + fmtT(base.lap) }),
        el("span", { class: "badge sm " + (ev.legal ? "green" : "red"), text: ev.legal ? "legal" : (ev.violations || []).join(", ") })),
      el("div", { class: "sectors" }, (ev.sectors || []).map((s, i) => {
        const d = ev.delta_sectors ? ev.delta_sectors[i] : null;
        return el("div", { class: "cell" }, el("span", { class: "label", text: "S" + (i + 1) }), el("span", { class: "t num " + settle, text: fmtT(s) }), delta(d, fresh && deltaClass(d) === "faster" && !reduced() ? "flash" : ""));
      })),
      el("div", { class: "one", title: "top speed, candidate vs baseline" }, el("span", { class: "muted", text: "vmax " }), el("span", { class: "num " + settle, text: Math.round(ev.vmax_kmh) }), el("span", { class: "muted", text: " vs " + Math.round(base.vmax_kmh) + " km/h" })),
      el("div", { class: "one", title: "minimum speed through " + vminName + ", candidate vs baseline" }, el("span", { class: "muted", text: "vmin " }), el("span", { class: "num " + settle, text: Math.round(ev.vmin_kmh) }), el("span", { class: "muted", text: " vs " + Math.round(base.vmin_kmh) + " km/h" })),
    ];
    card("evaluate", { state: "success", body, src: (ev.model || "reduced-order lap model") + " · vmin at " + vminName + " · " + gameScaleShort(circuit), foot: [btn("Race it", raceIt, { cls: "primary", disabled: !!S.racing }), btn("Promote", promote, { disabled: !!S.busy.learn || x.status === "promoted" })] });
  }

  // ---- RACE: baseline vs candidate in the game iframe; measured deltas and agreement_pct from POST /api/race/result
  function renderRace() {
    const illegal = !!S.illegalCandidate && !S.racing;   // QA S4: an illegal candidate has nothing to race; the previous result is not its result
    const x = illegal ? null : S.current, e = S.err.race, m = x && x.measured;
    // G-HON-01: a windy experiment races in still air; the badge sits in the card head so it is never scrolled away (the full note is its title; the empty and racing bodies also spell it out)
    const wx = S.racing ? S.current : x;
    const rc = o => card("race", Object.assign({ flag: windy(wx) ? el("span", { class: "badge amber sm", title: "raced in still air (the game has no wind); evaluator numbers include the wind, " + wx.conditions.wind_ms + " m/s from " + (wx.conditions.wind_from_deg || 0) + "°", text: "still air" }) : null }, o));
    if (S.busy.raceResult) return rc({ state: "loading", stateLabel: "posting result", body: [el("p", { text: "POST /api/race/result" })] });
    const back = S.showGame ? btn("Back to 3D view", cancelRace, { cls: "small" }) : null;
    const canRace = !!(x && x.evaluation && isNum(x.evaluation.lap));
    if (e) return rc({ state: "error", body: errBody(e), foot: [e.again ? btn("Race again", raceIt, { cls: "primary" }) : btn("Retry", e.retry, { cls: "primary" }), back || btn("Dismiss", () => { delete S.err.race; renderAll(); }, { cls: "small" })] });
    if (S.racing && S.racing.mode === "grid") return rc({ state: "loading", stateLabel: "grid race", body: [
      el("div", { class: "row nw" }, el("span", { class: "big num", id: "raceClock", text: fmtClock(Date.now() - S.racing.started) }), el("span", { class: "label", text: "elapsed" })),
      el("div", { class: "row" }, el("span", { class: "badge amber", text: "CINEMATIC · mixes car and driver" })),
      el("p", { text: "The candidate car with " + (S.racing.driverName || S.racing.driver) + " on the 2026 grid · " + GRID_LAPS + " laps · seed " + S.racing.seed + ". Not a measurement; nothing is written to the ledger." }), windNote(S.current)], foot: [btn("Cancel", cancelRace, { cls: "small" })] });
    if (S.racing) return rc({ state: "loading", stateLabel: "racing", body: [
      el("div", { class: "row nw" }, el("span", { class: "big num", id: "raceClock", text: fmtClock(Date.now() - S.racing.started) }), el("span", { class: "label", text: "elapsed" })),
      el("p", { text: "Baseline vs candidate · same neutral driver · " + LAPS + " laps · seed " + S.racing.seed + ". About 4½ minutes; no result after " + Math.round(RACE_TIMEOUT_MS / 60000) + " min shows an error." }), windNote(S.current)],
      src: "the game posts purple:result when the chequered flag falls", foot: [btn("Cancel", cancelRace, { cls: "small" })] });
    const g = S.grid && x && S.grid.experiment_id === x.id ? S.grid : null;
    const gridLabel = g ? (g.label || "cinematic — mixes car and driver") + " · " + (g.laps || GRID_LAPS) + " laps · seed " + g.seed + " · not in the ledger · game seconds" : null;
    const gridRow = g ? el("div", { class: "row" }, el("span", { class: "badge amber", text: "CINEMATIC · mixes car and driver" }),
      el("span", {}, el("b", { text: g.position != null ? "P" + g.position : "DNF" }), el("span", { class: "muted", text: g.field ? " of " + g.field : "" })), el("span", { class: "num", text: g.best_lap != null ? fmtT(g.best_lap) : "—" }), el("span", { class: "muted sans", text: g.driver ? g.driver.name + " · " + (g.driver.team || "") : "" })) : null;
    if (!m) return rc({ state: g ? "success" : "empty", stateLabel: g ? "grid raced" : "empty",
      body: [gridRow, el("p", { text: illegal ? "Nothing to race: the candidate is illegal and was never evaluated." : "Race the candidate against the baseline in the game: same neutral driver, same seed, broadcast camera." }), windNote(x)],
      src: gridLabel, foot: [btn("Race it", raceIt, { cls: "primary", disabled: !canRace }), gridControls(x), back] });
    const spd = v => (isNum(v) ? Math.round(v) : "—");
    const body = [
      el("div", { class: "row nw" }, delta(m.measured_delta, "big"), el("span", { class: "label tight", text: "measured Δ" })),
      el("div", { class: "row" }, el("span", { class: "nw", title: "predicted Δ, evaluator" }, el("span", { class: "muted sans", text: "pred Δ " }), delta(m.predicted_delta)),
        el("span", { class: "agr nw " + (isNum(m.agreement_pct) ? (m.agreement_pct <= 25 ? "green" : "amber") : "muted"), text: "agreement " + fmtPct(m.agreement_pct) })),
      el("div", { class: "sectors" }, (m.measured_sector_deltas || []).map((d, i) => el("div", { class: "cell" }, el("span", { class: "label", text: "S" + (i + 1) + " Δ" }), delta(d)))),
      // QA N4: one header row with a blank key, then one line per car (best lap · top speed / minimum through the fast complex)
      el("div", { class: "cars", title: "best lap (game seconds) · top speed / minimum through the fast complex, km/h" },
        el("span"), el("span", { class: "h", text: "lap (game s) · vmax / vmin km/h" }),
        ["baseline", "candidate"].map(role => { const c = m[role] || {}; return [el("span", { class: "k", text: role }), el("span", { class: "one" }, el("span", { class: "num", text: fmtT(c.lap) }), el("span", { class: "muted", text: " · " + spd(c.vmax_kmh) + " / " + spd(c.vmin_becketts_kmh) }))]; })),
      // windy: the "still air" flag in the card head carries the note here (no room for the sentence under the numbers)
      g ? el("div", { class: "grid-res" }, gridRow, el("div", { class: "src", text: gridLabel })) : null,
    ];
    // "Race it" stays on the EVALUATE card next door; the RACE foot keeps one row for the grid race (QA B1)
    rc({ state: "success", body, src: (m.label || "measured in race") + " · agreement = 100·|measured Δ − predicted Δ| / |predicted Δ|", foot: [gridControls(x), S.showGame && !S.racing ? null : back] });
  }
  // P3.T3 UI side (F-10): the candidate car with a real 2026 driver on the full grid; cinematic, never a measurement (G-HON-05)
  const GRID_LAPS = 2;
  function gridControls(x) {
    if (!x || !x.evaluation || !isNum(x.evaluation.lap) || S.racing) return null;
    const drivers = (EI.SEASON && Array.isArray(EI.SEASON.drivers) ? EI.SEASON.drivers : []).filter(d => !d.reserve);
    const sel = drivers.length ? el("select", { "aria-label": "driver for the grid race", class: "small" }, drivers.map(d => el("option", { value: d.code, selected: d.code === (S.gridDriver || "VER"), title: d.name }, d.code))) : el("input", { type: "text", "aria-label": "driver code for the grid race", value: S.gridDriver || "VER", maxlength: "3", size: "4", class: "small" });
    const nameOf = code => { const d = drivers.find(k => k.code === code); return d ? d.name : code; };   // codes only on the card (QA B1: one foot row); the name is the tooltip
    sel.title = "driver for the grid race: " + nameOf(sel.value);
    sel.addEventListener("change", ev => { S.gridDriver = ev.target.value; sel.title = "driver for the grid race: " + nameOf(ev.target.value); });
    return el("span", { class: "row", title: "cinematic: the candidate car with a real 2026 driver profile on the 2026 grid, " + GRID_LAPS + " laps" }, sel, btn("Grid race", () => gridRace(sel.value), { cls: "small" }));
  }
  function gridRace(code) {
    const x = S.current; if (!x || !x.evaluation || !isNum(x.evaluation.lap) || !EI.aero) return;
    const c = x.conditions || {}, circuit = x.circuit || c.circuit || "silverstone"; code = String(code || "VER").toUpperCase(); S.gridDriver = code;
    const d = EI.SEASON && EI.SEASON.drivers ? EI.SEASON.drivers.find(k => k.code === code) : null;
    const q = new URLSearchParams({ lab: "1", mode: "grid", exp: x.id, driver: code, seed: String(x.seed), laps: String(GRID_LAPS), circuit, candidate: b64(x.candidate), mult_candidate: b64(EI.aero.toMultipliers(x.candidate, c)) });
    S.racing = { id: x.id, seed: x.seed, started: Date.now(), mode: "grid", driver: code, driverName: d ? d.name : null }; S.showGame = true; delete S.err.race; S.active = "race"; clearBanner();
    renderAll(); startRaceClock();
    $("#game").src = "../index.html?" + q.toString();
  }

  // ---- LEARN: Promote / Overrule (native form) → pit-wall rule; rules list with toggles
  function renderLearn() {
    const x = S.illegalCandidate ? null : S.current, e = S.err.learn;   // QA S4: nothing to overrule or promote for an illegal candidate
    if (S.busy.learn) return card("learn", { state: "loading", stateLabel: S.busy.learn, body: [el("p", { text: "Writing the correction." })] });
    if (e) return card("learn", { state: "error", body: errBody(e), foot: [btn("Retry", e.retry, { cls: "primary" }), btn("Dismiss", () => { delete S.err.learn; renderAll(); }, { cls: "small" })] });
    const rulesList = S.rules.length ? el("div", { class: "rules" }, S.rules.map(r => el("div", { class: "r" + (r.active ? "" : " off") },
      el("label", { class: "switch", title: (r.active ? "active" : "inactive") + " · created " + hhmm(r.created_at) }, el("input", { type: "checkbox", checked: r.active, "aria-label": "rule " + r.id + " active", onchange: ev => toggleRule(r.id, ev.target.checked) }), el("span", { class: "tk" })),
      el("span", { class: "chip" + (r.active ? " rule" : " off"), text: r.id }), el("span", { class: "txt", title: r.text, text: r.text })))) : null;
    if (!x) return card("learn", { state: S.rules.length ? "success" : "empty", stateLabel: S.rules.length ? S.rules.length + " rule" + (S.rules.length > 1 ? "s" : "") : "empty",
      body: [el("p", { text: "Overrule a decision to add a pit-wall rule; every active rule enters each later task input (rule-conditioned learning)." }), rulesList], foot: [btn("Overrule", null, { disabled: true, title: S.illegalCandidate ? "the candidate is illegal: nothing to overrule" : "run a plan first" })] });
    const sel = el("select", { id: "ovVerdict", name: "verdict", required: true }, ["promote", "reject", "retest"].map(v => el("option", { value: v, selected: x.plan && x.plan.verdict !== v && v === (x.plan.verdict === "reject" ? "promote" : "reject") }, v)));
    const inp = el("input", { id: "ovReason", name: "reason", type: "text", required: true, maxlength: "160", placeholder: "e.g. Weigh straight-line drag against corner gain; judge on full-lap delta." });
    // the buttons live in the card's fixed foot (form="ovForm"), so a long rules list can never push them out of view
    const form = el("form", { class: "ov", id: "ovForm", onsubmit: ev => { ev.preventDefault(); overrule(sel.value, inp.value); } },
      el("label", { for: "ovVerdict", text: "verdict" }), sel, el("label", { for: "ovReason", text: "reason" }), inp);
    const body = [];
    if (x.overrule) body.push(el("div", { class: "row nw", title: x.overrule.reason + " · by " + (x.overrule.by || "engineer") }, el("span", { class: "chip rule", text: x.overrule.rule_id }), el("span", { class: "sans one", text: x.overrule.reason })));
    if (x.status === "promoted") body.push(el("div", { class: "row nw" }, el("span", { class: "badge purple", text: "promoted" }), el("span", { class: "sans muted one", text: "the candidate is the new baseline" })));
    body.push(form, rulesList);
    card("learn", { state: x.status === "overruled" || x.status === "promoted" || S.rules.length ? "success" : "empty", stateLabel: x.status === "overruled" ? "overruled" : x.status === "promoted" ? "promoted" : S.rules.length ? S.rules.length + " rule" + (S.rules.length > 1 ? "s" : "") : "ready", body,
      src: "→ POST /api/overrule · rule = reason, ≤ 160 chars",
      foot: [el("button", { class: "btn primary small", type: "submit", form: "ovForm" }, "Overrule"), btn("Promote", promote, { cls: "small", disabled: x.status === "promoted" })] });
  }

  // ---- main area: 3D car (lab/car3d.js, CAR3D lane) or the game iframe while racing; setup table as the always-on numbers
  function renderMain() {
    const x = S.current, racing = !!S.showGame;   // the game frame stays up after a result until "Back to 3D view"
    const game = $("#game"), car = $("#car3d"), empty = $("#mainEmpty");
    game.hidden = !racing; car.hidden = racing;
    if (!racing && game.getAttribute("src")) game.removeAttribute("src");
    const corner = $("#mainCorner"); corner.classList.toggle("racing", racing);
    // QA S4: an illegal candidate (422) wins over the previous experiment in the badge and the 3D view, as it already does in the setup table
    const ill = S.illegalCandidate, base = (S.state && S.state.baseline) || null;
    const illBadge = () => { const v = illegalViolations(), ch = EI.aero ? EI.aero.KEYS.filter(k => base && Math.abs(ill[k] - base[k]) > 1e-9).map(k => pname(k) + " " + fmtSetupV(k, ill[k]) + punit(k)) : [];
      return el("span", { class: "badge red", text: "illegal candidate · " + (ch.join(", ") || "setup") + " · " + (v.join(", ") || "ILLEGAL_SETUP") }); };
    corner.replaceChildren(...(racing ? (S.racing ? [] : [btn("Back to 3D view", cancelRace, { cls: "small" })]) : [ill ? illBadge() : el("span", { class: "badge", text: x ? "candidate · " + (x.change || "no change") : "baseline" })]));
    const setup = ill || (x ? x.candidate : base);
    const ghost = ill ? base : x ? x.baseline : null;
    if (EI.labCar3D && !racing) {
      try {
        if (!S.car3dMounted) { EI.labCar3D.mount(car); S.car3dMounted = true; }
        const key = JSON.stringify([setup || null, ghost]);
        if (setup && key !== S.car3dSetupKey) { S.car3dSetupKey = key; if (EI.labCar3D.setBaseline) EI.labCar3D.setBaseline(ghost); EI.labCar3D.setSetup(setup); }
      } catch (e) {   // the 3D view is decorative; the numbers below are the product. Say why it is missing rather than hide it.
        S.car3dError = String(e && e.message || e);
        $("#mainEmpty .inner").replaceChildren(el("div", { class: "h", text: "3D car view unavailable" }), el("span", { text: S.car3dError }));
      }
      empty.hidden = S.car3dMounted && !S.car3dError;
    } else empty.hidden = racing;
    // QA N-D: the same words as the in-view label (lab/car3d.js labelText(), which names the display gain); the setup table carries the real values
    const carLabel = EI.labCar3D && typeof EI.labCar3D.labelText === "function" ? EI.labCar3D.labelText() : "wing angles and ride height from the setup · geometry, not a measurement";
    $("#mainSrc").textContent = racing ? "" : S.car3dMounted ? "procedural car · " + carLabel : "aero map v1 · regulation subset ranges";
    $("#setupBox").replaceChildren(racing ? el("span") : setupTable());   // while racing the game's HUD owns the frame
  }
  function setupTable() {
    const aero = EI.aero; if (!aero) return el("span");
    const base = (S.state && S.state.baseline) || aero.BASELINE, x = S.current;
    const cand = S.illegalCandidate || (x && x.candidate) || null, td01 = !!(S.state && S.state.td01);
    const viol = S.illegalCandidate ? aero.violations(S.illegalCandidate, { td01 }) : [];
    const rows = aero.KEYS.map(k => {
      const r = aero.RANGES[k], max = k === "rear_wing_deg" && td01 ? aero.TD01_RW_MAX : r.max;
      const bad = viol.some(v => v === "TD-01" ? k === "rear_wing_deg" : v.startsWith(r.rule + "-") || v === r.rule);
      const changed = cand && Math.abs(cand[k] - base[k]) > 1e-9;
      return el("tr", {}, el("td", { text: pname(k) }), el("td", { class: "num", text: fmtSetupV(k, base[k]) + punit(k) }),
        el("td", { class: "num" + (bad ? " illegal" : changed ? " changed" : ""), text: cand ? fmtSetupV(k, cand[k]) + punit(k) : "—" }),
        el("td", { class: "range" + (k === "rear_wing_deg" && td01 ? " td" : "") }, r.min + "–" + max + punit(k), k === "rear_wing_deg" && td01 ? el("span", { class: "badge td", style: "margin-left:6px", text: "TD-01" }) : null));
    });
    return el("table", { class: "setup-table", "aria-label": "setup: baseline and candidate" }, el("thead", {}, el("tr", {}, el("th", { text: "setup" }), el("th", { text: "baseline" }), el("th", { text: "candidate" }), el("th", { text: "legal range" }))), el("tbody", {}, rows));
  }

  // ---- MubitWidget: GET /api/status; edit form POSTs partial values (the console is the source, this is the copy)
  function renderWidget(editing) {
    const w = $("#widget"), s = S.status || {}, ex = s.exam || {}, total = ex.total || 20, b = s.budget;
    // G-HON-06: v1 / v2 are scored on the Try models sheet (n/8, exam.v1_total from `scenarios.js --score`), not out of the 20-item exam
    const outOf = who => (isNum(ex[who + "_total"]) ? ex[who + "_total"] : who === "v1" || who === "v2" ? SHEET_N : total);
    const examLine = (who, v, p, when) => (isNum(v) || isNum(p) ? el("div", { class: "exam" }, el("b", { text: who }), " " + (isNum(v) ? v + "/" + outOf(who) + " verdicts" : "—") + (isNum(p) ? " · " + p + "/" + outOf(who) + " next-step" : ""), when ? el("span", { class: "src", text: " · " + when }) : null) : null);
    const head = el("div", { class: "head" }, el("span", { class: "label", text: "Mubit · task" }), el("button", { class: "btn icon", type: "button", "aria-label": editing ? "cancel editing" : "edit status (values from the console)", title: "edit values copied from the console", onclick: () => renderWidget(!editing) }, editing ? "✕" : "✎"));
    if (editing) {
      const f = (name, label, value, type) => el("label", {}, label, el("input", { name, type: type || "text", value: value == null ? "" : value, step: type === "number" ? "1" : null }));
      const form = el("form", { onsubmit: ev => { ev.preventDefault(); saveStatus(new FormData(ev.target)); } },
        f("task_name", "task name", s.task_name), f("kept_examples", "kept examples", s.kept_examples, "number"), f("adapter_version", "adapter version", s.adapter_version), f("test_result", "test result", s.test_result),
        f("provider", "provider verdicts", ex.provider, "number"), f("provider_param", "provider next-step", ex.provider_param, "number"),
        f("v1", "v1 verdicts", ex.v1, "number"), f("v1_param", "v1 next-step", ex.v1_param, "number"), f("v1_total", "v1 out of", isNum(ex.v1_total) ? ex.v1_total : SHEET_N, "number"),
        f("v2", "v2 verdicts", ex.v2, "number"), f("v2_param", "v2 next-step", ex.v2_param, "number"), f("v2_total", "v2 out of", isNum(ex.v2_total) ? ex.v2_total : SHEET_N, "number"),
        el("div", { class: "acts" }, el("span", { class: "src", text: "→ POST /api/status · provider out of " + total + " · v1/v2 Try models sheet" }), el("button", { class: "btn primary small", type: "submit" }, "Save")));
      w.replaceChildren(head, form); return;
    }
    w.replaceChildren(...[head,
      el("div", { class: "task", title: s.task_name || "", text: s.task_name || "task name not read from the console yet" }),
      el("div", { class: "facts" },
        el("div", { class: "fact" }, el("div", { class: "label", text: "kept examples" }), el("div", { class: "v num", text: isNum(s.kept_examples) ? s.kept_examples : "—" })),
        el("div", { class: "fact" }, el("div", { class: "label", text: "adapter" }), el("div", { class: "v", text: s.adapter_version || "—" })),
        el("div", { class: "fact" }, el("div", { class: "label", text: "test result" }), el("div", { class: "v sans", text: s.test_result || "—" })),
        el("div", { class: "fact" }, el("div", { class: "label", text: "calls" }), el("div", { class: "v num", text: isNum(s.calls_total) ? s.calls_total + " · " + s.calls_trained + " trained" : "—" }))),
      examLine("provider", ex.provider, ex.provider_param, ex.ran_at ? "server run, untrained, " + hhmm(ex.ran_at) : "server run, untrained") || el("div", { class: "exam muted sans", text: "exam not run yet (20 held-out scenarios, truth from the evaluator)" }),
      examLine("v1", ex.v1, ex.v1_param, "Try models, hand-scored"), examLine("v2", ex.v2, ex.v2_param, "Try models, hand-scored"),
      el("div", { class: "src upd" },
        el("span", { text: (s.last_console_read_at ? "updated from console " + hhmm(s.last_console_read_at) : s.updated_at ? "status written " + hhmm(s.updated_at) + " · console not read yet" : "not yet read from the console") + " · " + (s.model || "") + (s.prompt_version ? " · prompt v" + s.prompt_version : "") + (s.prompt_hash ? " " + String(s.prompt_hash).slice(0, 8) : "") }),
        b ? el("span", { class: "budget", title: "Mubit daily budget: calls today by UTC day; resets " + (b.resets_at ? hhmm(b.resets_at) + " local (" + (b.boundary || "00:00 UTC") + ")" : "00:00 UTC"), text: "budget today (UTC) · trained " + (b.trained_today_utc ?? "—") + " · untrained " + (b.untrained_today_utc ?? "—") + (b.resets_at ? " · resets " + hhmm(b.resets_at) : "") }) : null)].filter(Boolean));
  }
  async function saveStatus(fd) {
    const patch = {}, exam = {}, cur = (S.status && S.status.exam) || {};
    const num = v => (v === "" || v == null ? undefined : Number(v));
    for (const k of ["task_name", "adapter_version", "test_result"]) { const v = fd.get(k); if (v != null && String(v).trim() !== "" && v !== (S.status || {})[k]) patch[k] = String(v).trim(); }
    const ke = num(fd.get("kept_examples")); if (isNum(ke)) patch.kept_examples = ke;
    let examChanged = false;
    for (const k of ["provider", "provider_param", "v1", "v1_param", "v1_total", "v2", "v2_param", "v2_total"]) { const v = num(fd.get(k)); if (isNum(v) && cur[k] !== v) { exam[k] = v; examChanged = true; } }
    // D: a v1/v2 score is out of the Try models sheet (SHEET_N), never the 20-item exam
    for (const m of ["v1", "v2"]) if ((isNum(exam[m]) || isNum(exam[m + "_param"])) && !isNum(exam[m + "_total"]) && !isNum(cur[m + "_total"])) exam[m + "_total"] = SHEET_N;
    if (examChanged) patch.exam = isNum(cur.total) ? exam : Object.assign({ total: 20 }, exam);   // POST /api/status merges one level deep (D-S15)
    try { S.status = await api("POST", "/api/status", patch); clearBanner(); renderWidget(false); }
    catch (e) { banner(e); renderWidget(false); }
  }

  // ---- LedgerTable: GET /api/ledger?limit=50 newest first; overruled rows carry the rule-id chip
  function renderLedger() {
    const wrap = $("#ledgerWrap"), L = S.ledger;
    $("#ledgerMeta").textContent = L.length ? S.ledgerTotal + " experiment" + (S.ledgerTotal === 1 ? "" : "s") + " · newest first" : "";
    // the scale note follows the circuits of the rows on screen (one note per circuit)
    const circuits = [...new Set(L.map(x => x.circuit || (x.conditions && x.conditions.circuit) || "silverstone"))];
    const scaleNote = circuits.length === 1 ? gameScale(circuits[0]) : "game time scale · " + circuits.map(c => c + ": " + (GAME_SCALE[c] || "game seconds")).join(" · ") + " · Δ in game seconds";
    $("#ledgerSrc").textContent = L.length ? "pred Δ: evaluator · reduced-order lap model · calibrated to 2026 pole laps · aero map v1 — meas Δ, agree: measured in race, same seed · " + scaleNote : "";
    if (!L.length) { wrap.replaceChildren(el("div", { class: "empty", text: "No experiments yet — run one" })); return; }
    const total = S.ledgerTotal || L.length;
    const rows = L.map((x, i) => {
      const m = x.measured || {}, v = x.plan ? x.plan.verdict : (x.error ? x.error.code : "parse_error");
      // QA N3: one chip per cell (more rules collapse to "+n", all in the tooltip) so nothing spills into the status column
      const ra = x.rules_applied || [];
      const ruleCell = x.overrule ? el("span", { class: "chip rule", title: x.overrule.reason, text: x.overrule.rule_id }) : (ra.length ? el("span", { class: "chip", title: "rules in the agent's input: " + ra.join(", "), text: ra[0] + (ra.length > 1 ? " +" + (ra.length - 1) : "") }) : el("span", { class: "muted", text: "—" }));
      return el("tr", { class: "row-x" + (S.current && S.current.id === x.id ? " current" : ""), tabindex: "0", title: x.id, onclick: () => select(x), onkeydown: ev => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); select(x); } } },
        el("td", { class: "num muted", text: total - i }), el("td", { class: "change", title: x.change, text: x.change || "—" }),
        el("td", {}, delta(x.evaluation && x.evaluation.delta_lap)), el("td", {}, delta(m.measured_delta)), el("td", { class: "num", text: x.measured ? fmtPct(m.agreement_pct) : "—" }),
        el("td", { class: x.overrule ? "vd2" : null, title: x.overrule ? "agent " + v + " → engineer " + x.overrule.verdict : v }, el("span", { class: "vd " + (x.plan ? v : "err"), text: v }), x.overrule ? el("span", { class: "ovd", text: "→ " + x.overrule.verdict }) : null),
        el("td", {}, ruleCell), el("td", { title: x.status }, el("span", { class: "st " + x.status, text: x.status })));
    });
    const cols = ["c-n", "c-change", "c-d", "c-d", "c-agr", "c-v", "c-rule", "c-st"].map(c => el("col", { class: c }));
    const heads = [["#", "#"], ["change", "change"], ["pred Δ", "predicted Δ, evaluator"], ["meas Δ", "measured Δ, race"], ["agree", "agreement_pct"], ["verdict", "verdict"], ["rule", "rule"], ["status", "status"]];
    wrap.replaceChildren(el("table", {}, el("colgroup", {}, cols), el("thead", {}, el("tr", {}, heads.map(([h, t]) => el("th", { text: h, title: t })))), el("tbody", {}, rows)));
  }
  function select(x) { S.current = x; S.illegalCandidate = null; delete S.err.design; clearBanner(); renderAll(); }   // QA N-C: the old ILLEGAL_SETUP banner goes too

  // ---- TraceStream: one TraceLine per SSE event; the pending line pulses at 1 Hz while /api/plan is in flight
  function trace(t) {
    const lines = $("#traceLines");
    if (t.key) { if (S.traceSeen.has(t.key)) return null; S.traceSeen.add(t.key); }
    const atBottom = lines.scrollHeight - lines.scrollTop - lines.clientHeight < 40;
    const m = el("div", { class: "m" });
    if (t.session) m.append(el("span", { class: "sess", title: t.session, text: short(t.session, 10) }));
    if (t.requestId) m.append(el("span", { class: "mreq", role: "button", tabindex: "0", title: t.requestId + " · click to copy", text: short(t.requestId, 10), onclick: () => copy(t.requestId), onkeydown: ev => { if (ev.key === "Enter") copy(t.requestId); } }));
    if (isNum(t.latencyMs)) m.append(el("span", { class: "lat", text: t.latencyMs + " ms" }));
    if (t.verdict) m.append(el("span", { class: "vd " + (["promote", "reject", "retest"].includes(t.verdict) ? t.verdict : t.error ? "err" : ""), text: t.verdict }));
    if (t.error) m.append(el("span", { class: "vd err", text: t.error }));
    if (t.note) m.append(el("span", { class: "muted sans note", title: t.note, text: t.note }));
    if (t.pending) m.append(el("span", { class: "pulse", "aria-label": "in flight" }));
    const line = el("div", { class: "tl " + t.kind + (t.trained === false ? " untrained" : "") + (t.pending ? " pending" : "") }, el("span", { class: "t", text: hhmmss(t.at) }), el("span", { class: "k", text: t.kind }), m);
    lines.appendChild(line);
    while (lines.children.length > TRACE_MAX) lines.firstChild.remove();
    if (atBottom) lines.scrollTop = lines.scrollHeight;
    return line;
  }
  function copy(text) { (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(() => toast("copied " + text), () => toast(text)); }
  // QA S1: one PLAN line per Mubit call (keyed on the experiment, not its status). An overrule or a promotion is the engineer's act,
  // not a call: each gets its own kind and carries no request id or latency.
  function traceExperiment(x, note) {
    const v = x.plan ? x.plan.verdict : null;
    const line = trace({ kind: "plan", key: "plan:" + x.id, at: x.created_at, session: x.session_id, requestId: x.mubit_request_id, latencyMs: x.latency_ms,
      verdict: v, error: x.plan ? null : (x.error ? (x.error.mubit_code ? x.error.code + " · " + x.error.mubit_code : x.error.code) : x.status), trained: x.trained, note: note || null });
    if (x.overrule) trace({ kind: "overrule", key: "overrule:" + x.id + ":" + x.overrule.rule_id, at: x.overrule.at, session: x.session_id,
      note: "agent " + (v || "—") + " → engineer " + x.overrule.verdict + " · " + x.overrule.rule_id });
    if (x.status === "promoted") trace({ kind: "promote", key: "promote:" + x.id, at: x.promoted_at, session: x.session_id, note: "candidate → new baseline · " + (x.change || "no change") });
    return line;
  }

  // ---- SSE: EventSource on /api/stream; every event refreshes the ledger
  let ledgerTimer = null;
  function connectStream() {
    const meta = $("#traceMeta");
    const es = new EventSource(API + "/api/stream");
    es.onopen = () => { meta.replaceChildren(el("span", { class: "dot ok" }), "live"); setApi(true); };
    es.onerror = () => { meta.replaceChildren(el("span", { class: "dot bad" }), "reconnecting"); };
    const on = (kind, fn) => es.addEventListener(kind, e => { let d; try { d = JSON.parse(e.data); } catch (err) { return; } fn(d); scheduleLedger(); });
    on("plan", d => {
      traceExperiment(d);
      if (!S.current || S.current.id === d.id || (!S.racing && !S.busy.plan && d.created_at >= (S.current.created_at || ""))) S.current = d;
      renderAll();
    });
    on("race", d => {
      const m = d.measured || {};
      trace({ kind: "race", key: "race:" + d.id + ":" + m.at, at: m.at, session: d.session_id, verdict: "Δ " + fmtD(m.measured_delta), note: "predicted " + fmtD(m.predicted_delta) + " · agreement " + fmtPct(m.agreement_pct) + " · seed " + m.seed });
      if (S.racing && S.racing.id === d.id) { stopRaceClock(); S.racing = null; S.busy.raceResult = false; S.active = "race"; }
      if (!S.current || S.current.id === d.id) S.current = d;
      renderAll();
    });
    on("rule", d => { trace({ kind: "rule", key: "rule:" + d.id + ":" + d.active + ":" + Date.now(), session: d.from_experiment ? "exp-" + d.from_experiment : null, verdict: d.id + (d.active ? " active" : " off"), note: d.text }); refreshRules(); });
    on("status", d => {
      S.status = d; renderWidget(false);
      const key = JSON.stringify([d.kept_examples, d.adapter_version, d.test_result, d.exam]);
      if (S.lastStatusKey && key !== S.lastStatusKey) trace({ kind: "status", note: "kept " + (d.kept_examples ?? "—") + " · adapter " + (d.adapter_version || "—") + (d.exam && isNum(d.exam.provider) ? " · exam provider " + d.exam.provider + "/" + (d.exam.total || 20) : ""), trained: false });
      S.lastStatusKey = key;
    });
    on("error", d => trace({ kind: "error", key: "err:" + d.experiment_id, session: d.experiment_id ? "exp-" + d.experiment_id : null, error: d.error && (d.error.mubit_code ? d.error.code + " · " + d.error.mubit_code : d.error.code), note: d.error && d.error.message }));
  }
  function scheduleLedger() { clearTimeout(ledgerTimer); ledgerTimer = setTimeout(refreshLedger, 150); }
  async function refreshLedger() {
    try { const L = await api("GET", "/api/ledger?limit=50"); S.ledger = L; S.ledgerTotal = Math.max(L.length, (S.status && S.status.experiments) || 0); renderLedger(); }
    catch (e) { /* the SSE line already said what happened; the banner belongs to actions */ }
  }
  async function refreshRules() { try { S.rules = await api("GET", "/api/rules"); renderLearn(); } catch (e) { /* same */ } }

  // ---- actions
  async function runPlan(o, clientId) {
    o = o || {};
    if (S.busy.plan) return;
    clientId = clientId || uuid();   // a retry after NETWORK/BAD_RESPONSE reuses the id: the server dedupes x-client-id for 10 s, so a lost response never costs a second trained call
    const body = {}; if (o.random) body.random = true;
    if (o.candidate || o.conditions || o.seed != null || o.circuit) body.scenario_overrides = Object.assign({}, o.candidate ? { candidate: o.candidate } : {}, o.conditions ? { conditions: o.conditions } : {}, o.seed != null ? { seed: o.seed } : {}, o.circuit ? { circuit: o.circuit } : {});
    S.busy.plan = true; delete S.err.design; S.illegalCandidate = null; S.active = "design"; clearBanner(); renderAll();
    const pending = trace({ kind: "plan", pending: true, session: "client " + clientId.slice(0, 8), note: "POST /api/plan" });
    try {
      const x = await api("POST", "/api/plan", body, { "x-client-id": clientId });
      S.current = x; S.active = "evaluate"; traceExperiment(x);
    } catch (e) {
      e.retry = () => runPlan(o, e.code === "NETWORK" || e.code === "BAD_RESPONSE" ? clientId : undefined);
      if (e.code === "ILLEGAL_SETUP") { S.illegalCandidate = e.extra.candidate || null; trace({ kind: "error", session: "client " + clientId.slice(0, 8), error: "ILLEGAL_SETUP", note: (e.extra.violations || []).map(id => EI.aero && EI.aero.describeViolation ? EI.aero.describeViolation(id) : id).join(" · ") || e.message }); }
      else if (e.extra && e.extra.experiment) { S.current = e.extra.experiment; }
      else if (e.code === "NETWORK" || e.code === "BAD_RESPONSE") trace({ kind: "error", session: "client " + clientId.slice(0, 8), error: e.code, note: e.endpoint });
      S.err.design = e; banner(e);
    } finally { S.busy.plan = false; if (pending) pending.remove(); renderAll(); scheduleLedger(); }
  }

  function raceIt() {
    const x = S.current; if (!x || !x.evaluation || !isNum(x.evaluation.lap) || !EI.aero) return;
    const c = x.conditions || {}, circuit = x.circuit || c.circuit || "silverstone";
    const q = new URLSearchParams({ lab: "1", exp: x.id, seed: String(x.seed), laps: String(LAPS), circuit, baseline: b64(x.baseline), candidate: b64(x.candidate),
      mult_baseline: b64(EI.aero.toMultipliers(x.baseline, c)), mult_candidate: b64(EI.aero.toMultipliers(x.candidate, c)) });
    S.racing = { id: x.id, seed: x.seed, started: Date.now(), mode: "race" }; S.showGame = true; delete S.err.race; S.active = "race"; clearBanner();
    renderAll(); startRaceClock();
    $("#game").src = "../index.html?" + q.toString();
  }
  // "Back to 3D view": the only thing that unloads the game. A finished race keeps its chequered-flag card on screen (GAME review, filming).
  function cancelRace() { stopRaceClock(); S.racing = null; S.showGame = false; delete S.err.race; S.busy.raceResult = false; renderAll(); }
  function carsFrom(d) {   // tolerate { baseline: {…}, candidate: {…} } as well as the contract's cars[] (SERVER lane, P1.T3 entry)
    if (Array.isArray(d.cars)) return d.cars;
    if (d.baseline && d.candidate) return ["baseline", "candidate"].map(role => Object.assign({ role }, d[role]));
    return undefined;
  }
  // a car that never completed a lap posts null lap/sectors/speeds; the server would 400 on the field, so say "race incomplete" instead of relaying
  const carIncomplete = k => !k || !isNum(k.lap) || !Array.isArray(k.sectors) || k.sectors.length !== 3 || !k.sectors.every(isNum) || !isNum(k.vmax_kmh) || !isNum(k.vmin_becketts_kmh);
  window.addEventListener("message", ev => {   // ARCHITECTURE §10: same-origin game iframe only (origin AND source), and only the lab messages
    if (ev.origin !== location.origin) return;
    const frame = $("#game"); if (!frame || ev.source !== frame.contentWindow) return;
    const d = ev.data; if (!d || typeof d !== "object" || (d.type !== "purple:result" && d.type !== "purple:grid")) return;
    if (!S.racing) return;   // nothing in flight (cancelled, or an old frame): ignore
    if (d.experiment_id && d.experiment_id !== S.racing.id) { trace({ kind: "error", session: "exp-" + d.experiment_id, error: "STALE_RESULT", note: "result for another experiment ignored; racing " + S.racing.id }); return; }
    if (d.type === "purple:grid") {
      stopRaceClock(); S.grid = Object.assign({ experiment_id: S.racing.id, seed: S.racing.seed }, d); S.racing = null; S.active = "race";
      trace({ kind: "race", key: "grid:" + S.grid.experiment_id + ":" + Date.now(), session: "exp-" + S.grid.experiment_id, verdict: S.grid.position != null ? "P" + S.grid.position : "DNF", note: "grid race · cinematic, mixes car and driver · " + (S.grid.driver ? S.grid.driver.name : "") + (S.grid.best_lap != null ? " · best " + fmtT(S.grid.best_lap) : "") + " · not in the ledger", trained: false });
      renderAll(); return;
    }
    if (S.racing.mode === "grid") return;
    const cars = carsFrom(d);
    const payload = { experiment_id: d.experiment_id || d.exp || (S.racing && S.racing.id), seed: Number.isInteger(d.seed) ? d.seed : Number.isInteger(+d.seed) ? +d.seed : (S.racing ? S.racing.seed : undefined), cars };
    if (d.incomplete === true || !Array.isArray(cars) || cars.length !== 2 || cars.some(carIncomplete)) {
      const who = Array.isArray(cars) && cars.some(carIncomplete) ? cars.filter(carIncomplete).map(k => (k && k.role) || "car").join(", ") : "the race (incomplete)";
      stopRaceClock(); S.racing = null; S.err.race = Object.assign(new ApiErr("RACE_INCOMPLETE", "purple:result (game iframe)", "race incomplete: no completed lap for " + who + "; nothing was posted"), { again: true });
      trace({ kind: "error", session: payload.experiment_id ? "exp-" + payload.experiment_id : null, error: "RACE_INCOMPLETE", note: who }); renderAll(); return;
    }
    stopRaceClock(); postRaceResult(payload);
  });
  // the race clock: elapsed time on the RACE card while the game runs; "No result received" after RACE_TIMEOUT_MS
  let raceTimer = null;
  function startRaceClock() {
    stopRaceClock();
    raceTimer = setInterval(() => {
      if (!S.racing) return stopRaceClock();
      const ms = Date.now() - S.racing.started;
      if (ms >= RACE_TIMEOUT_MS) {
        stopRaceClock(); S.racing = null;
        S.err.race = Object.assign(new ApiErr("NO_RESULT", "purple:result (game iframe)", "No result received within " + Math.round(RACE_TIMEOUT_MS / 60000) + " minutes; the ledger row stays as it was"), { again: true });
        trace({ kind: "error", session: "exp-" + (S.current && S.current.id), error: "NO_RESULT", note: "no purple:result in " + Math.round(RACE_TIMEOUT_MS / 60000) + " min" }); renderAll(); return;
      }
      const n = $("#raceClock"); if (n) n.textContent = fmtClock(ms);
    }, 1000);
  }
  function stopRaceClock() { if (raceTimer) clearInterval(raceTimer); raceTimer = null; }
  const fmtClock = ms => { const t = Math.floor(ms / 1000); return String(Math.floor(t / 60)).padStart(2, "0") + ":" + String(t % 60).padStart(2, "0"); };
  async function postRaceResult(payload) {
    S.lastRacePayload = payload; S.busy.raceResult = true; delete S.err.race; renderAll();
    try { const row = await api("POST", "/api/race/result", payload); S.current = row; S.racing = null; S.active = "race"; clearBanner(); }   // S.showGame stays: the chequered-flag card stays on screen until "Back to 3D view"
    catch (e) { e.retry = () => postRaceResult(payload); S.err.race = e; banner(e); }
    finally { S.busy.raceResult = false; renderAll(); scheduleLedger(); }
  }

  async function promote() {
    const x = S.current; if (!x || S.busy.learn) return;
    S.busy.learn = "promoting"; delete S.err.learn; clearBanner(); renderAll();
    try { const r = await api("POST", "/api/promote", { experiment_id: x.id }); S.state = Object.assign({}, S.state, { baseline: r.baseline }); S.current = Object.assign({}, x, { status: "promoted" }); S.active = "learn"; S.car3dSetupKey = null; }
    catch (e) { e.retry = promote; S.err.learn = e; banner(e); }
    finally { S.busy.learn = false; renderAll(); scheduleLedger(); }
  }
  async function overrule(verdict, reason) {
    const x = S.current; if (!x || S.busy.learn) return;
    S.busy.learn = "overruling"; delete S.err.learn; clearBanner(); renderAll();
    try { const r = await api("POST", "/api/overrule", { experiment_id: x.id, verdict, reason }); S.current = r.experiment || Object.assign({}, x, { status: "overruled", overrule: { verdict, reason, rule_id: r.rule.id, by: "engineer", at: r.rule.created_at } }); S.active = "learn"; await refreshRules(); }
    catch (e) { e.retry = () => overrule(verdict, reason); S.err.learn = e; banner(e); }
    finally { S.busy.learn = false; renderAll(); scheduleLedger(); }
  }
  async function toggleRule(id, active) {
    try { await api("POST", "/api/rules/" + encodeURIComponent(id), { active }); clearBanner(); await refreshRules(); }
    catch (e) { e.retry = () => toggleRule(id, active); S.err.learn = e; banner(e); renderAll(); }
  }

  // ---- ConditionsBar (P2.T6, F-09): wind 0–12 m/s + from-direction, wet, circuit, TD-01 → POST /api/state; GET /api/state on load
  const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  const compass = deg => COMPASS[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
  function syncConditions() {
    const st = S.state || {}, c = st.conditions || {};
    const f = $("#conditions"); if (!f) return;
    $("#windMs").value = c.wind_ms || 0; $("#windMsV").textContent = (c.wind_ms || 0) + " m/s";
    $("#windFrom").value = c.wind_from_deg || 0; $("#windFromV").textContent = (c.wind_from_deg || 0) + "° " + compass(c.wind_from_deg || 0);
    $("#windDial").style.setProperty("--deg", (c.wind_from_deg || 0) + "deg");
    $("#wet").checked = !!c.wet; $("#circuit").value = c.circuit || "silverstone"; $("#td01").checked = !!st.td01;
    $("#windFrom").disabled = !(c.wind_ms > 0);
    $("#condSrc").textContent = "conditions · " + (c.circuit || "silverstone") + (c.wet ? " · wet" : " · dry") + (c.wind_ms ? " · " + c.wind_ms + " m/s from " + (c.wind_from_deg || 0) + "°" : " · no wind") + (st.td01 ? " · TD-01" : "") + " · /api/state";
  }
  async function postState(patch) {
    const f = $("#conditions"); f.classList.add("busy");
    try { S.state = await api("POST", "/api/state", patch); clearBanner(); }
    catch (e) { banner(e); }
    finally { f.classList.remove("busy"); syncConditions(); renderHeader(); renderMain(); }
  }
  function wireConditions() {
    const f = $("#conditions"); if (!f) return;
    f.addEventListener("submit", ev => ev.preventDefault());
    $("#windMs").addEventListener("input", ev => { $("#windMsV").textContent = ev.target.value + " m/s"; $("#windFrom").disabled = !(+ev.target.value > 0); });
    $("#windMs").addEventListener("change", ev => postState({ conditions: { wind_ms: +ev.target.value } }));
    $("#windFrom").addEventListener("input", ev => { $("#windFromV").textContent = ev.target.value + "° " + compass(+ev.target.value); $("#windDial").style.setProperty("--deg", ev.target.value + "deg"); });
    $("#windFrom").addEventListener("change", ev => postState({ conditions: { wind_from_deg: +ev.target.value } }));
    $("#wet").addEventListener("change", ev => postState({ conditions: { wet: ev.target.checked } }));
    $("#circuit").addEventListener("change", ev => postState({ conditions: { circuit: ev.target.value } }));
    $("#td01").addEventListener("change", ev => postState({ td01: ev.target.checked }));
  }

  // ---- header badges from /api/state
  function renderHeader() {
    const st = S.state || {}, c = st.conditions || {};
    $("#tdBadge").hidden = !st.td01;
    $("#circuitBadge").textContent = (c.circuit || "silverstone") + " · min lap" + (c.wet ? " · wet" : "") + (c.wind_ms ? " · wind " + c.wind_ms + " m/s from " + (c.wind_from_deg || 0) + "°" : "");
  }

  function renderAll() { renderHeader(); syncConditions(); renderDesign(); renderEvaluate(); renderRace(); renderLearn(); renderMain(); renderLedger(); }

  // ---- load: empty states first (F-06.AC1), then the stream and the four GETs; the first failure names its endpoint in the banner
  async function init() {
    renderWidget(false); wireConditions(); renderAll();
    connectStream();
    const got = await Promise.allSettled([api("GET", "/api/status"), api("GET", "/api/state"), api("GET", "/api/ledger?limit=50"), api("GET", "/api/rules")]);
    const [status, state, ledger, rules] = got.map(r => (r.status === "fulfilled" ? r.value : null));
    const failed = got.find(r => r.status === "rejected"); if (failed) banner(failed.reason);
    if (status) { S.status = status; S.lastStatusKey = JSON.stringify([status.kept_examples, status.adapter_version, status.test_result, status.exam]); }
    if (state) S.state = state;
    if (ledger) { S.ledger = ledger; S.ledgerTotal = Math.max(ledger.length, (status && status.experiments) || 0); S.current = ledger[0] || null; ledger.slice(0, BACKFILL).reverse().forEach(x => traceExperiment(x)); }
    if (rules) S.rules = rules;
    renderWidget(false); renderAll();
  }
  init();

  EI.lab = { run: runPlan, raceIt, cancelRace, promote, overrule, postRaceResult, setState: postState, refresh: () => Promise.all([refreshLedger(), refreshRules()]), state: S, API };
})();
