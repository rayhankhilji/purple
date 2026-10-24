# PURPLE · CONCEPT CAR module (core engine)

Version 0 · 2026-10-24 · branch `claude/concept-core` · owner Tanuj · label on every number:
**"concept · reduced-order lap model · calibrated to 2026 pole laps · concept aero map v0"**

## 0. Physics sim integration (2026-10-24, `claude/concept-integrate`)

The bench now laps every legal design on the **physics lap sim** (`concept/sim/`, docs/concept/SIM.md; label "physics lap sim ·
quasi-steady-state point mass · Silverstone OSM centreline · calibrated to 2026 British GP qualifying"). Sim v0 stays as the
fallback (no sim loaded, other circuits, `sim: "v0"`) and in the fast tests. The optimiser maximises the **weekend score**
(concept/weekend/weekend.js, WEEKEND.md §6) on the physics sim, and the demo baseline is the **Red Bull RB22 / Red Bull Ford DM01**.

**Calibration: how a design becomes a sim car** (`concept/physical.js`). The design layer no longer sets absolute levels. Each
design is mapped onto an **anchor**: the sim's estimated car (`sim.baselineCar()`, the pole-lap estimate) or, for a team
baseline, that team's inferred car (`sim.baselineCar("redbull")`). The team baseline maps onto its anchor exactly, so
`physical(baseline)` laps the sim's baseline time (generic 88.312 s; RB22 88.749 s against HAD's real 88.746 s). Everything else
is the anchor plus relative deltas from the part catalogue and the concept aero map:

| PhysicalCar field | Mapping | Baseline (generic / RB22) |
|---|---|---|
| corner CLA, CDA | anchor × df (cd) relative to the baseline design | 5.643 / 5.439 m², 1.349 / 1.359 m² |
| front share of CLA | anchor share + (balance − baseline balance) | 0.439 |
| Straight Mode CLA, CDA | `Q_anchor,corner × q_sm − E × φ`, E = the anchor's relief the concept map does not explain, φ = flap deployment vs the reference setting (per wing min(1, angle / reference), weighted by each wing's share of the reference relief). No flap = Corner Mode; the reference = the anchor exactly; past the reference only the concept map's own flap relief counts (conservative) | 2.202 / 2.122 m², 0.742 / 0.747 m² |
| mass, CoG height, front weight share | anchor + (mass sheet − baseline mass sheet) | 768 kg, 0.28 m, 0.45 |
| ICE kW | anchor × cooling power factor | 400 / 399.8 kW |
| tyres (μx, μy, load sensitivity), brakes, tracks, η, gearing | the anchor's (no design parameter moves them) | 1.84 / 1.95 / 0.106, 5 g |
| energy | regulation, never design: `es_harvest` 8.5 MJ/lap (C5.2.10 cap; the session limit, 6.5 MJ in Silverstone qualifying, comes through the sim's conditions), `es_deploy` 12.5 = 4 MJ window (C5.2.9) + 8.5, ≥ the 10.5 MJ the sim needs; MGU-K 350 kW | |

The **baseline carries a reference Straight Mode flap** (front 4°, the largest whole degree inside RV-FW-PROFILES at the 580 mm
chord; rear 15°, mid-domain), because every 2026 car runs active aero and the sim's estimate is a car that used it. The baseline's
flap actuators (1.8 kg) come out of its ballast (now 0.2 kg). Sim v0 measures Straight Mode relative to the baseline's own Straight
Mode, so its baseline still laps 88.111 s. Without the sim loaded, `physical()` falls back to the v0 levels (`REF_V0`, label
"PhysicalCar v0"); sim v0 uses ratios only and is unaffected.

**Red Bull baseline.** `design.baseline({ team: "redbull" })` (or `"redbull"`): id `baseline-redbull`, `team`, `livery:
"redbull-rb22"` (the viewer's id), chassis, PU, driver HAD. Same concept shape (no RB22 geometry is public); the identity is its
anchor. In the browser the anchor uses the generic gear ratios (HAD's measured ratios are read from disk in Node only): 88.750 s.
Children of the design keep `team` and `livery`. The concept lab and the CLI default to it; the generic car stays selectable.

**Bench** (`concept/bench.js`). `sim: "auto"` (physics when loaded) | `"physics"` | `"v0"` | a function; `objective: "weekend"`
(default at Silverstone with the weekend module) | `"quali"`. The physics sim runs Silverstone only (other circuits: v0). Results
are cached twice: physics laps by the PhysicalCar's numbers + circuit + conditions, bench results by design + options (both LRU,
6000 entries), so a revisited design or the lab's re-bench of a kept design costs ~0.1 ms. A physics lap is 20-35 ms in Node (the
RB22 car carries gearing), ~22 ms in Chromium. **Exploit guard:** the energy fields are pinned to the regulation values before a
lap (`guardEnergy`): a car declaring 6.0 MJ recharge ran 0.001 s faster in the sim (its φ search), now it runs the same lap.
`weekend_model` on the result carries quali / race position, strategy, fuel slope and the field frame; `score` is the weekend score.
For a team design the weekend replaces that team's fitted driver (our RB22 takes HAD's place).

**Optimiser** (`concept/optimize.js`). Objective text and `opts.team`; `optimizeAsync` measures candidates one at a time and
awaits `opts.yield` once `opts.slice_ms` (12) has passed, so the page never blocks for longer than one lap; the lineage is
identical to `optimize()` (tested).

**Concept lab** (`concept/lab/`). Loads `concept/sim/{track,line-silverstone,lapsim,fitted,fit,index}.js` after
`js/data/silverstone.js` (browser export `window.EI.conceptSim`); header selects for the baseline (Red Bull RB22 default, generic
2026) and the sim (physics default, v0); the leaderboard is the real 2026 qualifying order with our sim'd car and the baseline;
the weekend line under it comes from the bench result. Measured in headless Chromium (120 generations, seed 1, physics, RB22):
the optimiser alone (3D view blocked) runs 86 ms per generation, frames p50 16.7 ms / p95 33 ms / max 50 ms, one long task
(55 ms); with the 3D view the software WebGL renderer of headless Chromium (~180 ms a frame idle) dominates. Screenshots:
`docs/agents/integrator-screens/concept-integrate/`.

**Results, physics sim** (`node concept/cli.js --gens 200 --seed S`, RB22 baseline, weekend objective; real pole ANT 88.111 s):

| Seed | Kept | Best lap | vs real pole | vs RB22 baseline (88.749) | Grid (real Q) | Weekend (Q / race) | Weekend score (baseline −0.667) | Legal |
|---|---|---|---|---|---|---|---|---|
| 1 | 42 | 87.570 | −0.541 | −1.179 | P1 | P1 / P1 | 0.549 | yes |
| 2 | 51 | 87.826 | −0.285 | −0.923 | P1 | P1 / P1 | 0.296 | yes |
| 3 | 39 | 87.652 | −0.459 | −1.097 | P1 | P1 / P1 | 0.470 | yes |

**Campaign: can a legal car with the same engine beat the real laps? (2026-10-24, docs/concept/CAMPAIGN.md, physics lap sim v2,
quali objective).** CMA-ES with restarts, surrogate pre-screening only, every kept candidate and every final number on the physics
sim, PU locked to the homologated DM01 (`bench.checkPU` + regs.js `PKG-PU-FIXED`), every regs.js rule checked:

| Baseline | Baseline lap | Campaign best ± 1σ (95 % band) | Δ pole 88.111 | Δ HAD 88.746 | Grid | Aero-map gains halved |
|---|---|---|---|---|---|---|
| RB22 / Red Bull Ford DM01 (sim v3) | 88.763 | **87.235 ± 0.154** (86.933–87.537) | −0.876 | −1.511 | P1 | 87.893 |
| generic 2026 / 400 kW PU (sim v3) | 88.107 | 86.595 ± 0.189 | −1.516 | −2.151 | P1 | 87.286 |

The band is the sim's own held-out error on lap-time changes, fit residuals and noise; it does not cover the concept aero map's
coefficients (with its gains halved, pole falls inside the band). `REG-C-FLOOR-ROOF` (floor throat) and `REG-C-SUSP-WIDTH` are not
enforced yet; re-run after `claude/sim-v3-fia` (CAMPAIGN.md §3). The table below is the earlier weekend-objective run (sim v1).

Top changes in all three seeds: rear Straight Mode flap opened 15° → 25.5-30° (domain edge), floor body width 1450 → 1540 mm (the
C3.5.1 rule edge), diffuser expansion 14° → 17-17.5°, sidepod undercut 100 → 145-170 mm, rear wing span 1100 → 1150 mm (rule
edge), endplate up to 870-880 mm. Read these as the concept aero map's direction on the sim's car, not as an RB22 upgrade: the map
is a component-share model, every gain sits on a domain or rule edge, and the sim's own residuals are 13 km/h (trace RMS) on
held-out laps.

## 1. What it is

The lab tunes five setup numbers on a fixed car. The concept module lets an optimiser change the **car itself**, part by part:
wing spans, chords, settings and element counts, the 2026 straight-mode flap angles, floor width, venturi throat, ride height,
diffuser, sidepod inlets and undercut, wheelbase and chassis packaging, ballast. Every candidate is checked against a
machine-readable subset of the **FIA 2026 Formula 1 Technical Regulations** (Section C, Issue 19, 25/06/2026, in force at Silverstone), weighed part by
part, turned into SI physical quantities (`PhysicalCar`) and lapped on a **lap-model bench**. The bench is a reduced-order lap
model, not a flow solver: v0 is the game's own calibrated lap model (`js/ai.js` `buildSpeedProfile` through `lab/evaluator.js`,
both called read-only), driven by how this car's physical numbers differ from the baseline concept car. The score is a
**Silverstone weekend score**: margin to the real 2026 pole (88.111 s, `EI.RACEPACE.silverstone`) and the grid slot the lap
would have taken among the real 2026 qualifying laps. Loop after loop, a (1+λ) evolution strategy keeps a change only if the score
improves and the car stays legal; the lineage records every generation.

```
Design ──regs.check──▶ violations (FIA article ids)        ┐
   │ └─parts.massSheet─▶ mass, CoG, axle loads, Izz        ├─▶ physical(design) ─▶ PhysicalCar ─▶ sim(pc, track) ─▶ lap ─▶ weekend score
   └──aeromap.evaluate─▶ df / cd (corner + straight mode)  ┘                                     (v0 = game lap model; concept/sim/ later)
optimize: proposer.propose(history, parent, ctx) ─▶ candidates ─▶ bench ─▶ keep iff legal and score_after > score_before ─▶ lineage row
```

## 2. Honest limits (read before quoting a number)

- **Reduced-order.** No flow is solved. Downforce and drag come from a documented component-share map (§5). The wing and
  ride-height slopes at the baseline match the lab's aero map v1 by construction (tested); everything away from the baseline is the
  map's assumption. Shapes are parameters, not surfaces.
- **Sim v0 places the baseline at the real pole by construction.** The game's limit lap (80.800 s) is anchored to the real 2026
  pole, so under v0 the baseline laps 88.111 s and starts P1. v0 can rank changes; it cannot say where a 2026 car really qualifies.
  The physics sim (§0, the default) places the baseline absolutely: generic 88.312 s (P3), RB22 88.749 s (P5 in qualifying).
- **Straight mode:** the baseline now carries a reference flap (front 4°, rear 15°) that maps onto the sim's estimated Straight
  Mode (§0); gains from opening the flaps further come only from the concept map's own flap model (conservative). Under v0 the
  zones are measured relative to the baseline's Straight Mode.
- **Masses are researched estimates.** Real per-part masses are not public. The catalogue uses "concept part masses v1"
  (`concept/data/parts-mass-2026.json`, `docs/concept/MASS.md`): regulation floors where they exist (ICE group 130.5 kg = ICE +
  Powerbox 118.5 + TC 12, MGU-K 20, ES 35, driver + ballast 82), reported figures where found, engineering estimates reconciled
  to reported 2026 car weights for the rest; every part carries its `kind` and `sources`. The baseline's parts sum to 768.0 kg
  and 2.0 kg of ballast brings it to the 770 kg qualifying minimum (front share 0.4492). The Nominal Tyre Mass (44 kg) is one
  documented estimate (`regs.NOMINAL_TYRE_MASS`); 46 kg would fit team spec sheets better and would add 2 kg of ballast.
- **Model rules that guard against free lunches** (concept assumptions, not regulation text; `regs.MODEL_RULES`): cooling capacity
  ≥ 1.05 × the PU's need (`PKG-COOLING`, with a linear derate below it), and the floor's effective gap at the dynamic ride height
  (static − 5 mm) ≥ 2 mm above the modelled stall onset (`PKG-FLOOR-STALL`). Both margins are guesses; the optimiser presses
  against both (best designs: capacity/need 1.059-1.066, stall margin 2.09-2.17 mm).
- **Straight-mode downforce is charged but costs ≈ 0 in v0.** Inside the activation zones the lap model uses the straight-mode
  downforce as well as the straight-mode drag. The geometric zones end at 87-91 m/s, where the game's braking runs at its brake cap
  (downforce only matters below ≈ 67 m/s), so the charge is real in the model but worth < 1 ms at Silverstone and Monza. The
  physics sim (downforce-limited braking, real deactivation points) has to price it; until then straight-mode gains are optimistic.
- **v0 has no ERS** (the game's mode 1 is full throttle without ERS), no tyre temperature, no load transfer, dry and still air only.
  The dynamic ride height is a fixed 5 mm compression used only for the stall check. CoG height (above the ground: Z-frame CoG +
  10 mm plank + ride height; wheels at the loaded radius above the ground) and yaw inertia are reported but only wheelbase enters
  the lap (agility term).
- **v0 under-charges mass:** +10 kg costs 0.128 s at Silverstone (≈ 0.013 s/kg) against the common ≈ 0.03 s/kg rule of thumb,
  because the game's traction cap and mechanical grip are mass-independent; only aero per kg, power per kg and tyre load sensitivity
  scale.
- **Straight-mode activation zones are geometric** (racing-line runs with |curvature| < 1/1000 m⁻¹ for ≥ 300 m: 1,336 m at
  Silverstone, 2,794 m at Monza), not the FIA's per-event zones (Sporting Regulations B7.1.1(d), not read here).
- **Domain and rule edges bind.** Best designs sit on the floor-body width (1540 mm), both wing spans, the endplate height, the
  rear flap's 30° domain edge, and (seeds 2-3) the front-wing straight-mode envelope. The flap-angle edges and the 5 mm / 2 mm /
  5 % margins are modelling choices, not physics; moving them moves the answer.
- **Wing drag is setting-dependent by assumption.** Profile drag grows with the section loading (kp = 0.5, §5); without it a short,
  steep rear wing was free load. The coefficient is a guess chosen to make the trade-off physical, not fitted.
- **Front-wing chord is a mean X extent.** The limit is the mean X extent of the trimmed RV-FW-PROFILES (≈ 594 mm, depends on span);
  the flaps' straight-mode position uses a simple geometric model (angle = wing setting, rotation about the leading edge).

## 3. Files (all new; nothing outside `concept/`, `test/concept*.test.js`, `docs/concept/` was touched)

| File | What | Key exports |
|---|---|---|
| `concept/regs.js` | 2026 rule subset, each with id, article, value, unit, `verified`, source; `check(design)` | `RULES`, `MODEL_RULES`, `minMass(session)`, `check`, `checkFacts`, `describeViolation`, `NOMINAL_TYRE_MASS` |
| `concept/parts.js` | 33-part catalogue (23 shape parameters): shape params with domain bounds, mass estimate + basis, x/z/|y| position | `CATALOGUE`, `PARAMS`, `geometry(params)`, `massSheet(params, opts)` |
| `concept/aeromap.js` | concept aero map v0: shape → relative df/cd in corner and straight mode, balance, cooling | `evaluate(params)`, `rideSensitivity`, `rideOptimum` |
| `concept/design.js` | Design = baseline + params; validate / clone / mutate / diff / describe / facts; seeded rng | `baseline`, `validate`, `mutate(d, rng, step)`, `applyChanges`, `diff`, `describe`, `facts`, `seededRng` |
| `concept/physical.js` | `physical(design, { calibration }) → PhysicalCar` (SI), anchored on the physics sim's car (§0) | `physical`, `anchor`, `ENERGY`, `REF_V0`, `SOURCES` |
| `concept/bench.js` | bench + physics sim adapter (cached, energy-guarded) + sim v0 + scores | `bench(design, { circuit, circuits, sim, objective })`, `simPhysics`, `simV0(pc, trackId)`, `weekend(lap, circuit)`, `cacheStats` |
| `concept/optimize.js` | the loop, default ES proposer, lineage | `optimize(opts)`, `optimizeAsync(opts)`, `esProposer`, `hypothesize` |
| `concept/cli.js` | command line | `node concept/cli.js --gens 200 --seed 1 --baseline redbull --sim physics --objective weekend --out DIR` |
| `test/concept.test.js`, `test/concept-bench.test.js`, `test/concept-guards.test.js`, `test/concept-integrate.test.js` | concept tests (§9; the physics integration: 10 tests in concept-integrate) | |

Module style matches `lab/aero.js`: each file is an IIFE that attaches to `window.EI.concept.<name>` and to `module.exports`.
Browser load order: the game scripts the evaluator needs (`vendor/three.min.js`, `js/util.js`, `js/data/silverstone.js`,
`js/data/monza.js`, `js/data/racepace2026.js`, `js/track.js`, `js/car.js`, `js/ai.js`), `lab/aero.js`, `lab/evaluator.js`, then
`concept/regs.js`, `parts.js`, `aeromap.js`, `design.js`, `physical.js`, `bench.js`, `optimize.js`. In Node the bench loads the
game through `server/game-headless.js` and reads `js/data/racepace2026.js` in a sandbox (the global `EI` is never touched).

## 4. Data model

**Design** `{ id, label, params: { <part>: { <param>: number } }, overrides?: { <part>: { mass_kg?, x_mm?, z_mm? } }, parent? }`.
`overrides` exist for what-if studies and tests (the optimiser never touches them). Shape parameters (domain · baseline · rule):

| Part · param | Domain | Base | Regulation limit |
|---|---|---|---|
| layout.wheelbase_mm | 3000–3700 | 3400 | ≤ 3400 (C2.3.3); ≥ packaging minimum (PKG-WB) |
| survival_cell.front_axle_offset_mm / cockpit_len_mm / bulkhead_gap_mm | 0–250 / 1750–2100 / 300–600 | 75 / 1930 / 380 | 0–150 (C2.3.4) / 1830–2030 (C2.3.5) / ≥ 360 (C2.3.6) |
| front_wing.span_mm / chord_mm / aoa_deg / elements / sm_delta_deg | 1000–1500 / 400–900 / 10–40 / 1–4 / 0–20 | 1300 / 580 / 25 / 3 / 4 (catalogue 0) | ≤ 1350 / mean chord ≤ trimmed RV-FW-PROFILES mean X extent (≈ 594) / — / ≤ 3 (C3.10.1) / ≥ 2 volumes, straight-mode extent inside RV-FW-PROFILES (C3.10.10(a), (s)(i), (u)) |
| rear_wing.span_mm / chord_mm / aoa_deg / elements / endplate_top_mm / sm_delta_deg | 900–1300 / 300–600 / 5–35 / 1–4 / 760–960 / 0–30 | 1100 / 420 / 20 / 2 / 860 / 15 (catalogue 0) | ≤ 1150 / ≤ 465 / — / ≤ 3 (C3.11.1) / ≤ 880 / needs ≥ 2 volumes (C3.11.6) |
| floor.width_mm (floor body, 2 × max \|Y\|) / throat_mm / ride_height_mm | 1200–1700 / 80–130 / 20–70 | 1450 / 100 / 35 | ≤ 1540 (C3.5.1(a), App. C2 §4.9: Y ≤ 770) / — / plank wear ≤ 2 mm (C3.6.1(d)); stall margin (PKG-FLOOR-STALL) |
| diffuser.expansion_deg | 8–22 | 14 | — |
| sidepods.inlet_cm2 / undercut_mm | 300–1100 / 0–220 | 650 / 100 | cooling capacity ≥ 1.05 × need (PKG-COOLING, model rule) |
| ballast.x_frac / extra_kg | 0–1 / 0–25 | 0.05 / 0 | axle loads (C4.2) |

Wing `aoa_deg` is in the lab's `front_wing_deg` / `rear_wing_deg` units, so the concept and the lab share a scale.

**PhysicalCar** (SI; the contract the sims consume; every field always present):
`{ id, label, session, mass_kg, fuel_kg, wheelbase_m, track_front_m, track_rear_m, cog_height_m, weight_dist_front, aero: { corner: { CLA_front_m2, CLA_rear_m2, CDA_m2 }, straight: { … }, ride_height_mm, ride_sens_per_mm, floor_stalled, stall_margin_mm }, pu: { ice_kw, mguk_kw, es_deploy_mj_per_lap, es_harvest_mj_per_lap }, tyres: { mu_x, mu_y, load_sens, radius_m, compound }, brakes: { max_decel_g_mech }, drivetrain_eff, calibration, sources }`.
Additive since v0: `session` (the C4.1 session the mass was built for; sim v0 builds its reference car for the same session),
`aero.floor_stalled` (bool) and `aero.stall_margin_mm` (effective floor gap at the dynamic ride height minus the stall onset; the
model rule wants ≥ 2). `ride_sens_per_mm` is unchanged (|d ln df / d rh|, ≥ 0). `cog_height_m` is now the height above the ground.
`physical(design, { calibration: { cla_scale, cda_scale, power_scale, mu_scale } })` scales on top of the anchor (what-if
studies); the design and the relative map are untouched. Additive since the integration: `team`, `anchor: { id, label }`,
`pu.es_soc_window_mj`, `gearing` (the anchor's). Baseline PhysicalCar (generic; the mapping is in §0):

```json
{ "session": "qualifying", "team": null, "mass_kg": 768, "fuel_kg": 8, "wheelbase_m": 3.4, "track_front_m": 1.6, "track_rear_m": 1.55, "cog_height_m": 0.28, "weight_dist_front": 0.45,
  "aero": { "corner": { "CLA_front_m2": 2.4775, "CLA_rear_m2": 3.1657, "CDA_m2": 1.3486 }, "straight": { "CLA_front_m2": 1.1011, "CLA_rear_m2": 1.1011, "CDA_m2": 0.7417 },
            "ride_height_mm": 35, "ride_sens_per_mm": 0.006, "floor_stalled": false, "stall_margin_mm": 3.67 },
  "pu": { "ice_kw": 400, "mguk_kw": 350, "es_deploy_mj_per_lap": 12.5, "es_harvest_mj_per_lap": 8.5, "es_soc_window_mj": 4 },
  "tyres": { "mu_x": 1.8412, "mu_y": 1.9495, "load_sens": 0.1062, "radius_m": 0.36, "compound": "soft" }, "brakes": { "max_decel_g_mech": 5 }, "drivetrain_eff": 0.95,
  "gearing": { "rpm_per_kmh": [82.97, 73.16, 64.52, 57.93, 49.38, 44.41, 38.54, 34.4], "shift_rpm": 12172 } }
```

**Sim contract** `sim(physicalCar, trackId, conditions) → { lap_s, sectors_s: [3], vmax_kmh, speed_trap_kmh, vmin_kmh, energy: { deployed_mj, harvested_mj }, label }` (lap in real seconds).

**BenchResult** `bench(design, { circuit = "silverstone", circuits, sim = "auto", objective = "weekend", conditions, calibration, session, mass_weight, cache = true })` →
`{ id, label, legal, violations: [{ id, article, value, limit, message }], physical, mass: { total_kg, parts_kg, ballast_kg, min_kg, front_share, cog_x_mm, cog_z_mm, izz_kgm2 }, aero: { df, cd, df_sm, cd_sm, balance, floor_stalled, stall_margin_mm, cooling_power_factor, cooling_capacity_over_need }, circuits: { <id>: SimResult }, weekend: { lap_s, pole_s, gap_to_pole_s, grid_position, field_size, score, label }, score }`.
Additive: `sim` ("physics" | "v0" | "custom"), `objective`, `weekend_model` (§0), `team`, `sim_label`.
An illegal design gets no lap (`circuits: {}`, `score: null`), as in the lab (F-01.AC2). `score` = the weekend score with
`objective: "weekend"`, else `pole_s − lap_s` (s; higher is better); `weekend.score` is always the pole margin; `mass_weight` (default 0) can add an explicit penalty per kg above the minimum, off by default because the sim already
charges mass.

**Lineage row** (one per generation; `lineage.jsonl`): `{ gen, id, parent, proposer, changes: [{ part, param, from, to, clamped }], hypothesis, score_before, score_after, delta_score, kept, legal, result: { score, lap_s, gap_to_pole_s, grid_position, mass_kg, ballast_kg, front_share, df, cd, cd_sm, circuits }, outcome, sigma, n_proposed, n_measured, n_illegal, candidates: [{ id, score, legal, violations?, error? }], label }`.
`kept` is a number comparison (`legal && score_after > score_before`), never an opinion. Same seed → byte-identical lineage.

**Proposer contract** (documented at the top of `concept/optimize.js`): `{ name, propose(history, design, ctx) → Proposal | Proposal[] | Promise }`,
`Proposal = { changes: [{ part, param, to }], hypothesis? }`; `ctx = { gen, rng, sigma, lambda, params (domain specs), rules, parent: { id, score, summary }, baseline, objective }`.
Out-of-domain values are clamped and flagged; unknown parameters (own properties only: `toString`, `constructor`, `__proto__` are
never parameters) and non-finite values (`NaN`, `Infinity`, `null`, non-numeric strings) are recorded as errors; `validate()`
rejects unknown keys and NaN anywhere in `params`; legality is never the proposer's call.
An async proposer runs with `optimizeAsync`. The default is a seeded (1+8) evolution strategy (σ ×1.25 on a kept generation,
×0.9 otherwise, 0.01–0.3 of the domain width).

## 5. The concept aero map v0 (`concept/aeromap.js`): what each coefficient means

| Coefficient | Value | Meaning / where it is a guess |
|---|---|---|
| Downforce shares | front wing 0.25, rear wing 0.27, floor 0.40, body 0.08 | Guess for a 2026-style car (less floor, more wing than 2022–25). No beam wing in 2026 (C3.11): its former 0.03 sits in the body |
| Drag shares | wheels 0.34, body 0.28, cooling 0.07, front wing 0.08, rear wing 0.12, floor 0.07, misc 0.04 | Guess; wheels ≈ ⅓ of an open-wheeler's drag is common folklore |
| Wing lift | linear in setting from zero-lift setting (front 0, rear 5), quadratic stall roll-off from 34 / 28 (+5 per extra volume) over 10 | Zero-lift settings chosen so the baseline slopes equal the lab's +0.010 / +0.018 df per degree |
| Wing drag | profile (1 − i)·S·(1 + 0.10·Δn)·(1 + kp·(cl² − 1)), kp = 0.5; induced i·(S·cl)²·(span_ref/span)² / endplate; i = 0.25 front, 0.375 rear | kp is a guess (profile drag rises with loading, so a short steep wing pays for its load); i is then chosen so the cd slopes still equal the lab's +0.004 / +0.011 per degree |
| Element count | +6 % load, +10 % profile drag, later stall per extra volume; mass +12–15 % | Guess |
| Straight mode | flap incidence − δ·share; share = (n−1)/n (front), (n−1)/n × min(1, 535 / half-span) (rear: tips outboard of Y=535 do not move, C3.11.6(a)(ii)); only with ≥ 2 volumes; on activation zones only, drag and downforce | Flap share of loading (uniform spanwise) is a guess |
| Floor | ∝ planform (WB − 300) × body width (base 1450); ground effect (35 + c₀)/(rh + c), c = 0.3167·throat; stall below a 58 mm effective gap, judged at the dynamic ride height (static − 5 mm), rule margin 2 mm | c₀ makes d(df)/d(rh) = −0.006 /mm at 35 mm, as in the lab; the stall gap, compression and margin are guesses |
| Diffuser | 1 + 0.03·Δ − 0.00375·Δ² (peak +6 % at 18°) | Guess |
| Undercut | +0.02 %/mm floor load, −0.05 %/mm body drag, radiator volume lost past 140 mm | Guess |
| Cooling | capacity ∝ inlet × undercut efficiency; need 0.85 of baseline; required = need × 1.05 (PKG-COOLING); below it power × (1 − 1.0·s − 1.5·s²), s = shortfall vs required | Guess; the linear term makes the first cm² short cost power |
| Aero balance | front share of each component: FW 1.0, floor 0.40, body 0.3125, rear wing 0 | Guess; baseline balance 43.5 % front |
| Absolute levels (PhysicalCar) | CLA 3.8 m², CDA 1.1 m² (corner, baseline) | Estimates in line with the public 2026 aims; for the physics sim to calibrate |

**sim v0 mapping** (`concept/bench.js`), PhysicalCar relative to the baseline concept car (which maps to exactly 1.0):
`df = (CLA / CLA_ref) / k` with `k = (mass + fuel) / (mass_ref + fuel_ref)`; `cd = CDA / CDA_ref`; straight-mode drag on the
activation zones; power `p = ice_kw·eff / ref`; `a0 = μy ratio × tyre load sensitivity × balance term (0.3 % per point of
(aero balance − weight distribution) change) × agility (1 − 0.10·(WB/WB_ref − 1)) × the lab's bottoming term below 30 mm`;
`b0 = μx ratio × load sensitivity`; the reference car is the baseline in the same session (768 kg outside (Sprint) Qualifying).
The game's model only takes `{ df, cd, a0, b0 }` and a per-sample headwind array, so mass, power and straight-mode drag go through
that array as an equivalent airspeed offset, solved per sample and iterated to a fixed point (≤ 8 profile rebuilds, 1 mm/s);
straight-mode downforce (`df_sm` on zone samples) re-runs the game's braking and acceleration passes after each build. Tests prove it: within 2 ms of an exact rescale of the game car for mass/power, and equal to a
whole-lap lower drag when every sample is a zone. With no change the call is byte-for-byte the evaluator's (baseline 80.800 s).
Game seconds become real seconds × (real 2026 pole / game limit lap): 88.111 / 80.8 at Silverstone, 81.786 / 76.65 at Monza.
Cost: ≈ 3 ms per evaluation of the baseline, ≈ 5–10 ms with straight mode at both circuits.

Concept vs lab, same moves, Silverstone / Monza lap delta in real seconds: rear wing +8°: concept +0.750 / +1.119, lab +0.475 /
+0.808 · rear wing −4°: concept +0.119 / −0.143, lab +0.012 / −0.245 · ride height −4 mm: concept −0.099 / −0.054, lab −0.109 /
−0.068. Directions agree everywhere; the concept charges aero-balance shifts harder than the lab's balance term.

## 6. Regulations: verified vs not

Source: FIA, *2026 Formula 1 Regulations – Section C [Technical]*, **Issue 19, 25/06/2026** (WMSC 23/06/2026), the issue in force
at the British GP (3-5 July 2026), downloaded from fia.com on 2026-10-24 and read directly (`regs.DOC`). Every cited article was
compared word by word with Issue 17 (28/04/2026, the issue v0 cited): **no value used here differs**. Issue 19 adds, in articles
this model records but does not use: C5.2.3 a per-cylinder cap of 550 MJ/h, and C5.2.10 "no Recharge limit applies to laps behind
the safety car in Low Grip conditions" (C5.2.10(i) reads 7 MJ; Issue 17's marked-up text showed 8→7).

| Rule id | Article (Issue 19) | Value | Checked as |
|---|---|---|---|
| REG-C-WIDTH | C2.3.1 | ≤ 950 mm from Y=0 | max of floor body / wing half-widths |
| REG-C-WB, -FRONT-AXLE, -COCKPIT, -BULKHEAD | C2.3.3-C2.3.6 | ≤ 3400; 0-150; 1830-2030; ≥ 360 mm | geometry |
| REG-C-FLOOR-WIDTH | C3.5.1(a), App. C2 §4.9 | floor body ≤ 1540 mm (RV-FLOOR-BODY to Y=770) | floor.width_mm (foot / boards to Y=890 between XF 650-1350 not in the parameter) |
| REG-C-FW-ELEMENTS, -SPAN | C3.10.1(a)-(b), App. C2 §22.1 | ≤ 3 volumes; Y ≤ 675 | |
| REG-C-FW-CHORD | C3.10.1(a), App. C2 §21.1, §22.1-22.4 | trimmed envelope: X extent 500 mm at Y=0, 647.5 at Y=440, 559 at Y=675 | mean chord ≤ mean extent over the span (≈ 594 mm) |
| REG-C-FW-SM-ENVELOPE | C3.10.10(s)(i), (u) | flaps stay inside RV-FW-PROFILES in Straight Mode | straight-mode X extent (geometric flap model) ≤ the same limit |
| REG-C-RW-ELEMENTS, -SPAN, -CHORD, -ENDPLATE | C3.11.1, App. C2 §30-31 | ≤ 3; Y ≤ 575; XR 165-630 (465 mm); Z ≤ 880 | |
| REG-C-FW-FLAP, -RW-FLAP | C3.10.10(a)(i), C3.11.6(a)(i) | flap excludes the forwardmost volume (≥ 2 volumes) | |
| REG-C-RW-FLAP-SPAN (info) | C3.11.6(a)(ii)-(iii) | RW flap excludes volumes outboard of Y=535 | aero map flap share |
| REG-C-AERO-MODES (info) | C3.10.10(n)-(o), (w); C3.11.6(c)-(d), (j) | two positions, ≤ 400 ms, only in Activation Zones | geometric zones |
| REG-C-PLANK | C3.6.1(d) | 10 ± 0.2 mm, 8 mm worn | plank-wear estimate |
| REG-C-MASS-MIN | C4.1 | 726 kg + NTM (Q, SQ); 724 kg + NTM otherwise | per session |
| REG-C-MASS-FRONT / -REAR | C4.2 | ≥ 0.44 / 0.54 × Minimum Mass, **Qualifying and Sprint Qualifying only** | per session |
| REG-C-DRIVER-MASS | C4.5.2 | driver (incl. seat and kit) + ballast ≥ 82 kg | |
| REG-C-PU-MASS | C5.5.2 | ≥ 185 kg | |
| REG-C-ICE-MASS + REG-C-MGUK-MASS | C5.5.1 + C5.18.7, App. C3 Drawing 9 | paired by MGU-K transmission option: (a) 130 + 20, (b) 134 + 16, (c) 132 + 18 kg; ICE group = ICE + TC + Powerbox | jointly, option fixed at (a): 130.5 + 20 |
| REG-C-TC-MASS, -ES-MASS, -PU-COG, -DRIVELINE-MASS | C5.3.4, C5.17.9, C5.5.3, C9.5.2 | ≥ 12 kg; ≥ 35 kg (incl. CU-K, DC-DC); PU CoG above Z=200; ≥ 22 kg | |
| info rules | C5.2.3, C5.2.7, C5.2.8(i), C5.2.9, C5.2.10, C10.7.2 | 3000 MJ/h (550 per cylinder); 350 kW; taper to 0 at 345 km/h; 4 MJ; 8.5 MJ (7 / ≥ 5 MJ); rims | PhysicalCar / not used by v0 |

**Not verified:** the Nominal Tyre Mass (C4.7: published by the tyre supplier, not in Section C): **44 kg is an estimate** (the
widely reported 768 kg headline minus C4.1's 724 kg), so the qualifying minimum 770 kg and the race minimum 768 kg carry that
estimate. Also not in Section C and therefore estimates: ICE ≈ 400 kW, tyre μ and radius, track widths, CLA/CDA, fuel load, every
part mass above its regulation floor. The front-wing chord and straight-mode envelope checks interpret a 3-D reference volume with
one mean chord and a simple flap model; the rear chord limit is the RV's exact X extent. The activation zones are not the Sporting
Regulations' zones. `PKG-WB`, `PKG-COOLING` and `PKG-FLOOR-STALL` are concept model rules, not regulation text.

Note: the coordinator's brief said "mass at the 768 kg minimum". In **qualifying** (the session the weekend score models) C4.1
says 726 kg + NTM = 770 kg with the estimate; 768 kg is the figure for every other session. The module follows the regulation text
(`regs.minMass("qualifying" | "sprint_qualifying" | "race" | "sprint" | "practice")`), and `bench(design, { session })` scores
against a reference car of the same session.

## 7. How to run

```bash
npm ci
node --test test/concept.test.js test/concept-bench.test.js test/concept-guards.test.js   # the module's 32 tests (~6 s)
node concept/cli.js --gens 200 --seed 1 --circuits silverstone,monza --out /tmp/concept-run
node concept/cli.js --gens 300 --seed 7 --circuits silverstone,monza --out /tmp/concept-run7
node concept/cli.js --gens 2000 --until converged --patience 80 --seed 3 --out /tmp/concept-conv
```
The CLI writes `lineage.jsonl` and `best.json` to `--out` (default `<os tmp>/purple-concept/seed-N`) and refuses any path inside
the repo's `data/` or `data-mock/`. No network, no Mubit, no LLM anywhere in the module. Programmatic:
`require("./concept/optimize.js").optimize({ gens, seed, bench: { circuits: ["silverstone", "monza"] } })`.

## 8. Results from my runs (sim v0, 2026-10-24)

200 generations, (1+8) ES, score = Silverstone weekend score; Monza measured but not scored. Wall time ≈ 9 s per run.

**Caveat:** every lap below is a game-model lap scaled linearly to real seconds (× 88.111 / 80.8 at Silverstone, × 81.786 / 76.65 at Monza), so the baseline equals the real 2026 pole by construction. The table ranks changes; it does not say where a 2026 car would qualify.

| Seed | Gens (stop) | Kept | Silverstone lap (s) | Δ vs baseline | Monza lap (s) | Δ | Speed trap S/M (km/h) | Mass (kg) | Ballast (kg) | Front share |
|---|---|---|---|---|---|---|---|---|---|---|
| baseline | — | — | 88.111 | — | 81.786 | — | 327.6 / 328.1 | 770 | 2.0 | 0.4492 |
| 7 | 300 (limit) | 60 | 87.356 | −0.755 | 80.645 | −1.141 | 337.8 / 339.3 | 770 | 2.6 | 0.4555 |
| 1 | 200 (limit) | 43 | 87.487 | −0.624 | 80.988 | −0.798 | 333.7 / 334.7 | 770 | 3.0 | 0.4546 |
| 2 | 200 (limit) | 52 | **87.328** | **−0.783** | 80.569 | −1.217 | 338.8 / 340.4 | 770 | 2.4 | 0.4550 |
| 3 | 200 (limit) | 53 | 87.502 | −0.609 | 81.024 | −0.762 | 333.4 / 334.2 | 770 | 2.9 | 0.4598 |

These are the runs after the core fixes (Issue 19 rules, paired PU masses, floor-body width, trimmed front-wing envelope, setting-
dependent wing drag, cooling and stall margins, researched part masses, one vertical frame). The v0 gains before the fixes
(−1.19 to −1.23 s) partly came from free lunches the reviewer reproduced (a 1900 mm floor, a stalled floor, a 570 cm² inlet with no
power loss, a short steep rear wing); they are gone. Every best design re-checks legal, with the floor outside the stall (dynamic-
height stall margin 2.09-2.17 mm, rule ≥ 2) and the PU cooled with margin (capacity / need 1.059-1.066, rule ≥ 1.05, power factor 1).

Two families: seeds 7 and 2 keep a two-volume rear wing with a straight-mode flap at its 30° domain edge (−0.76 to −0.78 s); seeds 1
and 3 fell into a single-volume rear wing (no rear straight mode, C3.11.6(a)(i)) and stopped about 0.15 s short: a local optimum of
the (1+8) ES, not a different answer.

**What changed (seed 7):** rear straight-mode flap 30° (the domain edge; the tips outboard of Y=535 stay put, so 46.5 % of the
setting moves), front straight-mode flap 12°; front wing two volumes, full span 1350 mm, 555 mm mean chord (straight-mode extent
577 mm inside the 593.5 mm envelope), 26°; rear wing full span 1150 mm, 370 mm chord, 19.5°, 880 mm endplates (the RV limit); floor
body at its 1540 mm limit, throat 95 mm, ride height unchanged at 35 mm, diffuser 16.5°; inlets 620 cm² with a 155 mm undercut; a
shorter cockpit (1850 mm) and the cell moved 40 mm forward. Mass stays at 770 kg with 2.6 kg of ballast, front share 0.4555 inside
the C4.2 window. Corner CLA 3.80 → 3.90 m², CDA 1.10 → 1.06 m² (0.97 in straight mode); straight-mode downforce in the zones
0.74 × corner (charged, worth < 1 ms in v0, §2). The limits the car presses against are the ones the module enforces: width, wing
spans, endplate height, the front-wing envelope (seeds 2-3), the axle split, and the two model margins.

## 9. Tests (32, in three files; full suite 129 tests, green)

`test/concept.test.js` (8): baseline legal and every rule sourced (Issue 19); **every checkable rule caught** (31 rules, one case
each); mass sums, automatic ballast to the C4.1 minimum, axle loads, heavier parts eat ballast first; every part has a mass basis;
design validate / mutate (400 seeded mutations stay in the domain, quantised) / diff round trip; aero map v0 baseline = 1 and its
slopes match `lab/aero.js` SENS within 3 %; straight mode needs a flap, stall and cooling behave; no banned wording in `concept/` or
this file. `test/concept-bench.test.js` (13): concept rng = `scenarios.seededRng`; PhysicalCar contract and calibration hook;
baseline = the evaluator's lap exactly at both circuits (88.111 s / P1 at Silverstone); the lab's evaluator results, fixtures and
`EI.CAR` unchanged after concept runs; mass/power channel vs an exact rescale (< 2 ms); straight mode vs whole-lap drag (< 2 ms);
physics directions (an under-cooled car is illegal and derates); illegal → no lap; determinism; < 50 ms per evaluation; pluggable
sim feeds the weekend score; same seed → same lineage, `kept` is numeric; 50 generations improve the score and never return an
illegal best; sync / async / bad / illegal proposers and convergence; CLI writes outside `data/` and refuses `data/` and `data-mock/`.
`test/concept-guards.test.js` (11, each fails on the pre-fix core): paired ICE-group / MGU-K masses; per-session minimum, axle split
and v0 reference car; inherited names and non-finite values rejected by `applyChanges` / `validate` / the loop; floor-body width;
one vertical frame and CoG height above the ground; `bench` leaves `opts.circuits` alone and the CLI validates `--score`; trimmed
front-wing envelope incl. straight mode; cooling margin rule and linear derate; dynamic-height stall rule and the new PhysicalCar
fields; straight-mode downforce channel and the rear flap's Y=535 limit; setting-dependent wing drag.

## 10. Next

1. **Physics sim (in progress, separate agent, `concept/sim/`).** Implements the sim contract over `PhysicalCar` and calibrates the
   absolute levels (CLA, CDA, μ, power via `physical(design, { calibration })`) against the real 2026 Silverstone pole (88.111 s)
   and speed traps (`js/data/racepace2026.js`). Swap in with `bench(design, { sim })` / `optimize({ bench: { sim } })`. Then the
   weekend score places the baseline absolutely and the grid slot becomes meaningful.
2. **CAR3D: the evolving car in 3D.** Inputs it needs: `design.params` (spans, chords, settings, element counts, endplate height,
   floor width, ride height, wheelbase, sidepod inlet/undercut), `parts.geometry(params)` (XA, XC, XPU, XR, half width, all mm in the
   FIA car frame: x rearward from the front axle, z up from Z=0), the mass sheet `bench(...).mass` / `parts.massSheet(params).parts`
   (`[{ id, group, mass_kg, x_mm, z_mm }]` for a CoG marker and per-part colouring), the straight-mode angles to animate the flaps,
   and `lineage.jsonl` rows to replay generation by generation (`changes`, `kept`, `score_after`). The game's procedural car model
   (`js/carmodel.js`, `lab/car3d.js`) would need opt-in hooks for span/chord/element count (ARCHITECTURE §9 discipline).
3. **UI: a lab page tab.** Score timeline (`lineage[].score_after` where `kept`), the current best vs baseline table (the CLI's
   `table()` shows the fields), violation badges from `violations[].message` (each names its FIA article), the PhysicalCar card with
   its `sources`, and the hypothesis/outcome text per generation. Every number with the label above.
4. **Optional LLM proposer: needs a decision from Tanuj.** The proposer contract is ready (`optimizeAsync` + a Promise-returning
   `propose`). It would have to be a **separate Mubit task**, never the frozen research-agent task (`lab/prompt.js` and its model
   must not change); the bench, not the model, keeps or rejects every change. No LLM call is implemented here.
