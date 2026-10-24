// PURPLE concept race page (docs/concept/RACE.md). Reads the URL contract (?design=<base64url JSON>&ref=redbull ...), runs the physics
// lap sim for the concept car and the reference baseline here (concept/race/payload.js), loads the real 2026 pole lap (OpenF1), and
// hands the lot to the game in the iframe (index.html?concept=1, js/conceptrace.js), which replays it on the game's 3D Silverstone.
// "Qualifying lap" (?mode=quali, the demo's default): every car's best 2026 qualifying lap (OpenF1) + PURPLE and the RB22 baseline
// (physics lap sim) on ONE clock from the same line, ghost laps, with a live timing tower beside the view (payload.qualiPayload).
// "Game race" / "2026 grid" load the game's own ?lab=1 broadcast race instead (game AI + game lap model: cinematic).
// Messages are same-origin only and must come from the iframe (ARCHITECTURE §10). State for tests: window.__conceptRace.
(function () {
  const RP = window.EI && EI.concept && EI.concept.race, $ = (id) => document.getElementById(id);
  const S = { q: null, mode: "replay", built: null, payload: null, quali: null, qualiP: null, started: null, finish: null, state: null, cine: null, errors: [] };
  window.__conceptRace = S;
  const COL = { concept: "var(--purple)", ref: "var(--rb)", pole: "var(--merc)" };
  const esc = (x) => String(x == null ? "" : x).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const f3 = (x) => (x == null || !isFinite(x) ? "—" : (+x).toFixed(3));
  const sg = (x, dp) => (x == null || !isFinite(x) ? "—" : (x < 0 ? "−" : "+") + Math.abs(x).toFixed(dp == null ? 3 : dp));
  const kv = (rows) => rows.map(([k, v, cls]) => '<span class="k">' + esc(k) + '</span><span class="v ' + (cls || "") + '">' + v + "</span>").join("");

  function banner(lines) {
    if (!lines || !lines.length) return; S.errors = S.errors.concat(lines);
    const b = $("banner"); b.hidden = false; b.innerHTML = "<b>Concept race</b> · " + S.errors.map(esc).join(" · ");
  }
  const game = () => $("game");
  const send = (msg) => { const w = game().contentWindow; if (w) w.postMessage(msg, location.origin); };

  async function init() {
    if (!RP) { banner(["concept/race/payload.js did not load"]); return; }
    S.q = RP.parseQuery(location.search); S.mode = S.q.mode;
    if (S.q.errors.length) banner(S.q.errors);
    const rs = $("rate"); if (![...rs.options].some((o) => +o.value === S.q.rate)) { const o = document.createElement("option"); o.value = String(S.q.rate); o.textContent = S.q.rate + "×"; rs.appendChild(o); }
    rs.value = [...rs.options].find((o) => +o.value === S.q.rate).value;
    let tel = null;
    try { const r = await fetch("../data/telemetry/silverstone-2026-q-ant.json"); if (r.ok) tel = await r.json(); } catch (e) { /* offline file: no pole ghost */ }
    if (!tel) banner(["the real 2026 pole lap (concept/data/telemetry/silverstone-2026-q-ant.json) did not load: no pole ghost"]);
    await new Promise((res) => requestAnimationFrame(() => setTimeout(res, 0)));   // paint the frame before the first (≈1 s) track build
    let built;
    try { built = RP.buildPayload({ design: S.q.design, ref: S.q.ref, conditions: S.q.conditions, telemetry: tel }); } catch (e) { built = { ok: false, errors: ["the physics lap sim failed: " + e.message] }; console.error(e); }
    S.built = built;
    if (!built.payload) { banner(built.errors || ["no payload"]); $("stageWait").textContent = "No lap to show: " + (built.errors || []).join(" · "); return; }
    if (built.errors && built.errors.length) banner(built.errors);
    S.payload = built.payload;
    if (S.mode === "quali") await buildQuali();
    $("sub").textContent = "concept race · " + (built.design.id || "design") + (built.design.label ? " · " + built.design.label : "") + " · on the game's 3D Silverstone";
    renderLap(); renderCar(); renderCheck();
    setMode(S.mode, true);
  }

  // ---------------------------------------------------------------- modes
  function setMode(m, first) {
    S.mode = m; S.started = null; S.finish = null; S.state = null; S.cine = null;
    for (const t of document.querySelectorAll(".tab")) t.setAttribute("aria-selected", String(t.dataset.mode === m));
    const kin = m === "replay" || m === "quali";   // kinematic replays in the game view (js/conceptrace.js)
    $("ctl").style.visibility = kin ? "" : "hidden";
    $("cinePanel").hidden = kin;
    $("checkPanel").hidden = m !== "replay"; $("mapPanel").hidden = !kin;
    $("towerPanel").hidden = m !== "quali"; $("lapPanel").hidden = m === "quali";
    const ft = $("honest"); if (!ft.dataset.base) ft.dataset.base = ft.textContent;
    ft.textContent = m === "quali" && S.qualiP ? S.qualiP.foot : ft.dataset.base;
    const C = S.built && S.built.cinematic;
    let src;
    if (m === "quali" && !S.qualiP) { banner(["qualifying lap: " + ((S.quali && S.quali.errors.join(" · ")) || "no data")]); return; }
    if (kin) {
      src = "../../index.html?concept=1&track=silverstone&rate=" + encodeURIComponent($("rate").value);
      if (m === "replay") { $("stageTitle").textContent = "Physics replay · Silverstone"; $("stageLabel").textContent = S.payload.label; }
      else { $("stageTitle").textContent = "Qualifying lap · Silverstone · every car's best lap, one clock"; $("stageLabel").textContent = S.qualiP.ghost_line; renderTower(null); }
    } else {
      if (!C || !C.ok) { banner([(C && C.error) || "no cinematic link"]); return; }
      src = m === "grid" ? C.grid : C.race;
      $("stageTitle").textContent = m === "grid" ? "Game race · the concept aero on HAD's RB22 in the 2026 field" : "Game race · concept (candidate) vs baseline";
      $("stageLabel").textContent = C.label;
      $("cine").innerHTML = kv([["multipliers df / cd / a0 / b0", Object.values(C.multipliers).map((x) => (+x).toFixed(3)).join(" / ")], ["clamped to the game's band", C.clamped ? "yes" : "no"]]);
      $("cineNote").textContent = C.note + ". Game seconds come from the game's lap model (its limit car laps " + ((EI.LIMIT_LAP && EI.LIMIT_LAP.silverstone) || "80.8") + " s at Silverstone): not comparable with the physics sim's seconds.";
    }
    $("stageWait").hidden = false; $("stageWait").textContent = kin ? "Building Silverstone…" : "Building Silverstone · the game's AI drives this one…";
    $("prog").style.width = "0";
    game().src = src;
    if (!first) { const u = new URL(location.href); u.searchParams.set("mode", m); history.replaceState(null, "", u.toString()); }
  }

  // ---------------------------------------------------------------- qualifying lap: the data (every driver's OpenF1 lap, fetched once)
  async function buildQuali() {
    if (S.quali) return S.quali;
    const rp = EI.RACEPACE && EI.RACEPACE.silverstone;
    if (!rp || !rp.q) { S.quali = { ok: false, errors: ["js/data/racepace2026.js not loaded"] }; return S.quali; }
    const tel = {}; let idx = null;
    await Promise.all(Object.keys(rp.q).map(async (c) => { try { const r = await fetch("../../" + RP.qualiFile(c)); if (r.ok) tel[c] = await r.json(); } catch (e) { /* that driver drives the pole profile, time-scaled */ } }));
    try { const r = await fetch("../data/telemetry/silverstone-2026-q-index.json"); if (r.ok) idx = await r.json(); } catch (e) { /* no deleted-lap note */ }
    try { S.quali = RP.qualiPayload(S.payload, { lap_s: S.q.lap_s, racepace: rp, season: EI.SEASON, telemetry: tel, deleted: idx && idx.deleted_lap_times }); }
    catch (e) { S.quali = { ok: false, errors: ["qualifying lap: " + e.message] }; console.error(e); }
    S.qualiP = S.quali.payload || null;
    if (S.quali.errors && S.quali.errors.length) banner(S.quali.errors);
    if (S.qualiP) S.qualiP.tables = S.qualiP.cars.map((c) => ({ s: c.s, t: c.t }));
    return S.quali;
  }
  // the tower: on track by distance covered while the lap runs (gap = time the car ahead on the road needed to reach this car's
  // distance), then by the finish measured on the replay clock (ties: as the demo leaderboard). RB22 carries no position (as there).
  function renderTower(st) {
    const P = S.qualiP; if (!P) return;
    const t = st ? st.t : -1, n = P.cars.length, fin = (st && st.fin) || [], dist = (st && st.d) || [];
    const rows = P.cars.map((c, i) => ({ c, i, f: fin[i] == null ? null : fin[i], d: dist[i] == null ? -1 : dist[i] }));
    rows.sort((a, b) => (a.f != null) !== (b.f != null) ? (a.f != null ? -1 : 1) : a.f != null ? (Math.round(a.f * 1e6) - Math.round(b.f * 1e6)) || a.c.rank - b.c.rank : b.d - a.d || a.c.rank - b.c.rank);
    const firstFin = rows.find((r) => r.f != null), leadRun = rows.find((r) => r.f == null);
    let pos = 0, h = "";
    for (const r of rows) {
      const c = r.c, me = c.id === "concept", tag = c.kind === "real" ? '<i class="tg real">OpenF1</i>' : '<i class="tg sim">sim</i>';
      const p = c.kind === "base" ? "" : String(++pos);
      let v, g;
      if (r.f != null) { v = f3(r.f); g = r === firstFin ? "fastest" : sg(r.f - firstFin.f); }
      else if (!st || t < 0) { v = "—"; g = "on the line"; }
      else { const into = Math.max(0, Math.min(r.d, c.L)); v = Math.round(into) + " m"; g = r === leadRun ? "leads" : sg(t - RP.tAtS(P.tables[leadRun.i], Math.max(1e-6, into)), 2); }
      h += '<div class="r' + (me ? " me" : "") + (r.f != null ? " fin" : "") + (r === firstFin ? " best" : "") + '" role="row" title="' + esc(c.name + " · " + c.source + (c.scale_note ? " · " + c.scale_note : "") + " · lap " + c.lap_s.toFixed(3) + " s") + '">' +
        '<span class="p">' + p + '</span><span class="sw2" style="background:' + esc(c.color) + '"></span><span class="cd">' + esc(c.short) + '</span><span class="nm">' + esc(c.name) + '</span><span>' + tag + (c.time_scaled ? ' <i class="tg ts">time-scaled</i>' : "") + '</span><span class="v">' + v + '</span><span class="g ' + (r.f != null && r === firstFin ? "pu" : "muted") + '">' + g + "</span></div>";
    }
    $("tower").innerHTML = h;
    const done = fin.filter((x) => x != null).length;
    $("towerSrc").textContent = !st || t < 0 ? "one clock · from the same line" : done < n ? "clock " + f3(Math.max(0, t)) + " s · " + done + " / " + n + " finished" : "all " + n + " laps complete";
    const slow = Math.max.apply(null, P.cars.map((c) => c.lap_s)); $("qprog").style.width = Math.max(0, Math.min(100, (100 * Math.max(0, t)) / slow)) + "%";
    if (!S.finish || S.finish.mode !== "quali") $("towerNote").textContent = P.ghost_line + ". Distances: each lap's own distance scaled onto one line (" + Math.round(P.line.L) + " m), finish = where the car's own clock reaches its lap time." + (S.quali.notes.length ? " Time-scaled: " + S.quali.notes.join("; ") + "." : "");
  }
  function renderQualiCheck(d) {
    const P = S.qualiP, got = d.cars.slice().sort((a, b) => (Math.round(a.replay_finish_s * 1e3) - Math.round(b.replay_finish_s * 1e3)) || ((P.cars.find((c) => c.id === a.id) || {}).rank - (P.cars.find((c) => c.id === b.id) || {}).rank)).map((c) => c.code);
    const want = P.order.map((o) => o.code), same = got.join(" ") === want.join(" ");
    const worst = Math.max.apply(null, d.cars.map((c) => Math.abs(c.diff_s)));
    const me = d.cars.find((c) => c.id === "concept");
    S.qualiCheck = { same, got, want, worst, purple: me && me.replay_finish_s };
    $("towerNote").innerHTML = '<span class="' + (same ? "gr" : "rd") + '">' + (same ? "✓ finish order = the demo leaderboard (" + want.length + " / " + want.length + ")" : "✗ finish order differs from the leaderboard: " + esc(got.join(" "))) + "</span> · largest |finish − lap| " + f3(worst) + " s · PURPLE " + f3(me && me.replay_finish_s) + " s" + (S.q.lap_s != null ? " (engine " + f3(S.q.lap_s) + " s)" : "") + ". " + esc(P.ghost_line) + "." + (S.quali.notes.length ? " Time-scaled: " + esc(S.quali.notes.join("; ")) + "." : "");
  }

  // ---------------------------------------------------------------- panels
  function renderLap() {
    const cars = S.payload.cars, best = [0, 1, 2].map((j) => Math.min.apply(null, cars.map((c) => c.sectors_s[j]))), bestLap = Math.min.apply(null, cars.map((c) => c.lap_s));
    const me = cars[0];
    let h = "<tr><th>car</th><th>lap</th><th>S1</th><th>S2</th><th>S3</th><th>Δ</th></tr>";
    for (const c of cars) {
      h += '<tr><td class="nm"><span class="sw" style="background:' + (COL[c.id] || "#888") + '"></span>' + esc(c.short) + '</td><td class="' + (c.lap_s <= bestLap ? "best" : "") + '">' + f3(c.lap_s) + "</td>" +
        c.sectors_s.map((x, j) => '<td class="' + (x <= best[j] + 1e-9 ? "best" : "") + '">' + f3(x) + "</td>").join("") +
        '<td class="' + (c === me ? "muted" : me.lap_s - c.lap_s < 0 ? "pu" : "rd") + '">' + (c === me ? "—" : sg(me.lap_s - c.lap_s)) + "</td></tr>" +
        '<tr class="srcrow"><td colspan="6">' + esc(c.name) + " · " + esc(c.source) + (c.speed_trap_kmh ? " · trap " + Math.round(c.speed_trap_kmh) + " km/h" : "") + "</td></tr>";
    }
    $("lapTable").innerHTML = h;
    $("lapSrc").textContent = "physics-sim seconds"; $("lapSrc").title = S.payload.conditions_label;
  }
  function renderCar() {
    const b = S.built.bench, pc = b.physical, d = S.built.design, A = pc.aero, me = S.payload.cars[0], rf = S.payload.cars[1];
    $("carSrc").textContent = (d.team || "generic") + " baseline frame";
    $("carKv").innerHTML = kv([
      ["design", esc(d.id || "—")],
      ["legal (concept/regs.js)", b.legal ? "yes" : "no", b.legal ? "gr" : "rd"],
      ["mass, mass sheet (kg)", (+b.mass.total_kg).toFixed(1)],
      ["CLA corner / straight (m²)", (A.corner.CLA_front_m2 + A.corner.CLA_rear_m2).toFixed(3) + " / " + (A.straight.CLA_front_m2 + A.straight.CLA_rear_m2).toFixed(3)],
      ["CDA corner / straight (m²)", (+A.corner.CDA_m2).toFixed(3) + " / " + (+A.straight.CDA_m2).toFixed(3)],
      ["speed trap (km/h, sim)", Math.round(me.speed_trap_kmh) + " · " + sg(me.speed_trap_kmh - rf.speed_trap_kmh, 1) + " vs " + esc(rf.short)],
      ["energy deployed / harvested (MJ)", me.energy.deployed_mj + " / " + me.energy.harvested_mj],
      ["lap vs " + rf.short + " (sim)", sg(me.lap_s - rf.lap_s), me.lap_s - rf.lap_s < 0 ? "pu" : "rd"],
    ]);
    $("carNote").textContent = S.payload.car_note + " " + S.payload.ers_note + ". Numbers: " + (pc.label || "PhysicalCar") + ".";
  }
  function renderCheck() {
    const rows = [];
    for (const c of S.payload.cars) {
      const f = S.finish && S.finish.cars.find((x) => x.id === c.id);
      rows.push([c.short + " · lap / replay finish", f3(c.lap_s) + " / " + (f ? f3(f.replay_finish_s) + " (" + sg(f.diff_s) + ")" : "…"), f && Math.abs(f.diff_s) <= 0.05 ? "gr" : f ? "rd" : "muted"]);
    }
    $("check").innerHTML = kv(rows);
    const me = S.payload.cars[0], pole = S.payload.cars.find((c) => c.id === "pole");
    $("checkNote").textContent = "Clock = sim seconds × playback rate. Sample times: " + me.time_method.kind + "; check ∫ds/v over the trace = " + f3(me.time_method.integrated_lap_s) + " s (" + sg(me.time_method.integrated_lap_s - me.lap_s) + ")." +
      (pole ? " Pole: OpenF1 clock ends at " + f3(pole.t[pole.t.length - 1]) + " s, official " + f3(pole.lap_s) + " s." : "");
  }
  function renderMapping(m) {
    $("mapping").innerHTML = kv([
      ["drawn car vs sim line, RMS / max", m.position_rms_m + " / " + m.position_max_m + " m"],
      ["samples pulled onto asphalt", Math.round(m.clamped_share * 100) + " % (|lat| ≤ " + m.clamp_limit_m + " m)"],
      ["sim line off centreline, RMS / max", m.lateral_offset_rms_m + " / " + m.lateral_offset_max_m + " m"],
      ["s vs linear scale, RMS / max", m.distance_nonlinearity_rms_m + " / " + m.distance_nonlinearity_max_m + " m"],
      ["sim line / game centreline", m.sim_line_length_m + " / " + m.game_centreline_length_m + " m (×" + m.scale + ")"],
      ["control line → painted line", m.control_to_start_line_m + " m (game s " + m.control_line_game_s + " → " + m.game_start_line_s + ")"],
    ]);
    $("mapNote").textContent = "Each sample of the sim's racing line is projected onto the game's centreline (both in the OSM frame of js/data/silverstone.js); the sim's distance and time are kept, the game's s is only where the car is drawn. " + S.payload.line.source + ". Laps are timed at the sim's control line, not the game's painted start line.";
  }
  function renderCine(d) {
    const rows = [];
    if (d.type === "purple:result") for (const c of d.cars || []) rows.push([c.role + " · best lap (game s)", f3(c.lap) + (c.vmax_kmh ? " · " + Math.round(c.vmax_kmh) + " km/h" : "")]);
    else rows.push(["position (game race)", d.position != null ? "P" + d.position + " / " + d.field : "—"], [(d.driver ? d.driver.code : "car") + " · best lap (game s)", f3(d.best_lap)]);
    $("cine").innerHTML = kv(rows.concat([["label", esc(d.label || S.built.cinematic.label)]]));
  }

  // ---------------------------------------------------------------- messages from the game view
  window.addEventListener("message", (e) => {
    if (e.origin !== location.origin || e.source !== game().contentWindow || !e.data || typeof e.data !== "object") return;
    const d = e.data;
    if (d.type === "purple:concept-ready" && S.mode === "replay" && S.payload) send({ type: "purple:concept-race", payload: S.payload });
    else if (d.type === "purple:concept-ready" && S.mode === "quali" && S.qualiP) { const { tables, ...pl } = S.qualiP; send({ type: "purple:concept-race", payload: pl }); }
    else if (d.type === "purple:concept-started") { S.started = d; $("stageWait").hidden = true; renderMapping(d.mapping); send({ type: "purple:concept-cmd", cmd: "cam", value: $("cam").value }); }
    else if (d.type === "purple:concept-state" && S.mode === "quali") { S.state = d; renderTower(d); $("btnPause").textContent = d.paused ? "Resume" : "Pause"; }
    else if (d.type === "purple:concept-finish" && S.mode === "quali") { S.finish = d; renderQualiCheck(d); }
    else if (d.type === "purple:concept-state") { S.state = d; const lap = S.payload.cars[0].lap_s; $("prog").style.width = Math.max(0, Math.min(100, (100 * d.t) / lap)) + "%"; $("btnPause").textContent = d.paused ? "Resume" : "Pause"; }
    else if (d.type === "purple:concept-finish") { S.finish = d; renderCheck(); }
    else if (d.type === "purple:result" || d.type === "purple:grid") { S.cine = d; renderCine(d); }
  });
  // the cinematic modes have no ready message: hide the note once the game frame has loaded and drawn a moment
  game().addEventListener("load", () => { if (S.mode !== "replay" && S.mode !== "quali") setTimeout(() => { $("stageWait").hidden = true; }, 1500); });

  for (const t of document.querySelectorAll(".tab")) t.addEventListener("click", async () => { if (!S.payload || t.dataset.mode === S.mode) return; if (t.dataset.mode === "quali") await buildQuali(); setMode(t.dataset.mode); });
  $("btnReplay").addEventListener("click", () => { S.finish = null; if (S.mode === "quali") renderTower(null); else renderCheck(); send({ type: "purple:concept-cmd", cmd: "restart" }); });
  $("btnPause").addEventListener("click", () => send({ type: "purple:concept-cmd", cmd: "pause" }));
  $("rate").addEventListener("change", () => send({ type: "purple:concept-cmd", cmd: "rate", value: +$("rate").value }));
  $("cam").addEventListener("change", () => send({ type: "purple:concept-cmd", cmd: "cam", value: $("cam").value }));
  init();
})();
