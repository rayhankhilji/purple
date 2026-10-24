// PURPLE concept race page (docs/concept/RACE.md). Reads the URL contract (?design=<base64url JSON>&ref=redbull ...), runs the physics
// lap sim for the concept car and the reference baseline here (concept/race/payload.js), loads the real 2026 pole lap (OpenF1), and
// hands the lot to the game in the iframe (index.html?concept=1, js/conceptrace.js), which replays it on the game's 3D Silverstone.
// "Game race" / "2026 grid" load the game's own ?lab=1 broadcast race instead (game AI + game lap model: cinematic).
// Messages are same-origin only and must come from the iframe (ARCHITECTURE §10). State for tests: window.__conceptRace.
(function () {
  const RP = window.EI && EI.concept && EI.concept.race, $ = (id) => document.getElementById(id);
  const S = { q: null, mode: "replay", built: null, payload: null, started: null, finish: null, state: null, cine: null, errors: [] };
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
    $("sub").textContent = "concept race · " + (built.design.id || "design") + (built.design.label ? " · " + built.design.label : "") + " · on the game's 3D Silverstone";
    renderLap(); renderCar(); renderCheck();
    setMode(S.mode, true);
  }

  // ---------------------------------------------------------------- modes
  function setMode(m, first) {
    S.mode = m; S.started = null; S.finish = null; S.state = null; S.cine = null;
    for (const t of document.querySelectorAll(".tab")) t.setAttribute("aria-selected", String(t.dataset.mode === m));
    $("ctl").style.visibility = m === "replay" ? "" : "hidden";
    $("cinePanel").hidden = m === "replay";
    $("checkPanel").hidden = $("mapPanel").hidden = m !== "replay";
    const C = S.built && S.built.cinematic;
    let src;
    if (m === "replay") {
      src = "../../index.html?concept=1&track=silverstone&rate=" + encodeURIComponent($("rate").value);
      $("stageTitle").textContent = "Physics replay · Silverstone"; $("stageLabel").textContent = S.payload.label;
    } else {
      if (!C || !C.ok) { banner([(C && C.error) || "no cinematic link"]); return; }
      src = m === "grid" ? C.grid : C.race;
      $("stageTitle").textContent = m === "grid" ? "Game race · the concept aero on HAD's RB22 in the 2026 field" : "Game race · concept (candidate) vs baseline";
      $("stageLabel").textContent = C.label;
      $("cine").innerHTML = kv([["multipliers df / cd / a0 / b0", Object.values(C.multipliers).map((x) => (+x).toFixed(3)).join(" / ")], ["clamped to the game's band", C.clamped ? "yes" : "no"]]);
      $("cineNote").textContent = C.note + ". Game seconds come from the game's lap model (its limit car laps " + ((EI.LIMIT_LAP && EI.LIMIT_LAP.silverstone) || "80.8") + " s at Silverstone): not comparable with the physics sim's seconds.";
    }
    $("stageWait").hidden = false; $("stageWait").textContent = m === "replay" ? "Building Silverstone…" : "Building Silverstone · the game's AI drives this one…";
    $("prog").style.width = "0";
    game().src = src;
    if (!first) { const u = new URL(location.href); u.searchParams.set("mode", m); history.replaceState(null, "", u.toString()); }
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
    else if (d.type === "purple:concept-started") { S.started = d; $("stageWait").hidden = true; renderMapping(d.mapping); send({ type: "purple:concept-cmd", cmd: "cam", value: $("cam").value }); }
    else if (d.type === "purple:concept-state") { S.state = d; const lap = S.payload.cars[0].lap_s; $("prog").style.width = Math.max(0, Math.min(100, (100 * d.t) / lap)) + "%"; $("btnPause").textContent = d.paused ? "Resume" : "Pause"; }
    else if (d.type === "purple:concept-finish") { S.finish = d; renderCheck(); }
    else if (d.type === "purple:result" || d.type === "purple:grid") { S.cine = d; renderCine(d); }
  });
  // the cinematic modes have no ready message: hide the note once the game frame has loaded and drawn a moment
  game().addEventListener("load", () => { if (S.mode !== "replay") setTimeout(() => { $("stageWait").hidden = true; }, 1500); });

  for (const t of document.querySelectorAll(".tab")) t.addEventListener("click", () => { if (S.payload && t.dataset.mode !== S.mode) setMode(t.dataset.mode); });
  $("btnReplay").addEventListener("click", () => { S.finish = null; renderCheck(); send({ type: "purple:concept-cmd", cmd: "restart" }); });
  $("btnPause").addEventListener("click", () => send({ type: "purple:concept-cmd", cmd: "pause" }));
  $("rate").addEventListener("change", () => send({ type: "purple:concept-cmd", cmd: "rate", value: +$("rate").value }));
  $("cam").addEventListener("change", () => send({ type: "purple:concept-cmd", cmd: "cam", value: $("cam").value }));
  init();
})();
