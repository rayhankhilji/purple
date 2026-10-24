# PURPLE · CONCEPT CAR module (core engine)

Version 0 · 2026-10-24 · branch `claude/concept-core` · owner Tanuj · label on every number:
**"concept · reduced-order lap model · calibrated to 2026 pole laps · concept aero map v0"**

## 1. What it is

The lab tunes five setup numbers on a fixed car. The concept module lets an optimiser change the **car itself**, part by part:
wing spans, chords, settings and element counts, the 2026 straight-mode flap angles, floor width, venturi throat, ride height,
diffuser, sidepod inlets and undercut, wheelbase and chassis packaging, ballast. Every candidate is checked against a
machine-readable subset of the **FIA 2026 Formula 1 Technical Regulations** (Section C, Issue 17, 28/04/2026), weighed part by
part, turned into SI physical quantities (`PhysicalCar`) and lapped on a **virtual aero bench**. The bench is a reduced-order lap
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
- **v0 places the baseline at the real pole by construction.** The game's limit lap (80.800 s) is anchored to the real 2026 pole,
  so the baseline concept car laps 88.111 s and starts P1. v0 can rank changes; it cannot say where a 2026 car really qualifies.
  The physics sim (concept/sim/, separate agent) will place the baseline absolutely; it plugs in as `sim` with no other change.
- **Straight mode is partly double-counted.** The game's car is calibrated to real 2026 pole laps, which already used straight mode,
  while the concept baseline runs none (so it reproduces 80.800 s exactly). Straight-mode gains are therefore optimistic; read them
  as "relative to a car without active aero".
- **Masses are estimates.** Real per-part masses are not public. Each part states its basis (`concept/parts.js`); the catalogue is
  tuned so the baseline's parts sum to 764.9 kg and 5.1 kg of ballast brings it to the 770 kg qualifying minimum.
- **v0 has no ERS** (the game's mode 1 is full throttle without ERS), no tyre temperature, no load transfer, no dynamic ride height
  or porpoising, dry and still air only. CoG height and yaw inertia are reported but only wheelbase enters the lap (agility term).
- **v0 under-charges mass:** +10 kg costs 0.128 s at Silverstone (≈ 0.013 s/kg) against the common ≈ 0.03 s/kg rule of thumb,
  because the game's traction cap and mechanical grip are mass-independent; only aero per kg, power per kg and tyre load sensitivity
  scale.
- **Straight-mode activation zones are geometric** (racing-line runs with |curvature| < 1/1000 m⁻¹ for ≥ 300 m: 1,336 m at
  Silverstone, 2,794 m at Monza), not the FIA's per-event zones (Sporting Regulations B7.1.1(d), not read here).
- **Domain bounds bind.** Several best-design values sit on a model-domain edge (rear-wing chord 300 mm, throat 80 mm,
  straight-mode flap angles 20° / 30°). Those edges are modelling choices, not physics; widening them moves the answer.

## 3. Files (all new; nothing outside `concept/`, `test/concept*.test.js`, `docs/concept/` was touched)

| File | What | Key exports |
|---|---|---|
| `concept/regs.js` | 2026 rule subset, each with id, article, value, unit, `verified`, source; `check(design)` | `RULES`, `MODEL_RULES`, `minMass(session)`, `check`, `checkFacts`, `describeViolation`, `NOMINAL_TYRE_MASS` |
| `concept/parts.js` | 33-part catalogue (23 shape parameters): shape params with domain bounds, mass estimate + basis, x/z/|y| position | `CATALOGUE`, `PARAMS`, `geometry(params)`, `massSheet(params, opts)` |
| `concept/aeromap.js` | concept aero map v0: shape → relative df/cd in corner and straight mode, balance, cooling | `evaluate(params)`, `rideSensitivity`, `rideOptimum` |
| `concept/design.js` | Design = baseline + params; validate / clone / mutate / diff / describe / facts; seeded rng | `baseline`, `validate`, `mutate(d, rng, step)`, `applyChanges`, `diff`, `describe`, `facts`, `seededRng` |
| `concept/physical.js` | `physical(design, { calibration }) → PhysicalCar` (SI) | `physical`, `REF`, `SOURCES` |
| `concept/bench.js` | bench + sim v0 + weekend score | `bench(design, { circuit, circuits, sim })`, `simV0(pc, trackId)`, `weekend(lap, circuit)` |
| `concept/optimize.js` | the loop, default ES proposer, lineage | `optimize(opts)`, `optimizeAsync(opts)`, `esProposer`, `hypothesize` |
| `concept/cli.js` | command line | `node concept/cli.js --gens 200 --seed 1 --circuits silverstone,monza --out DIR` |
| `test/concept.test.js`, `test/concept-bench.test.js` | 21 tests (§9) | |

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
| front_wing.span_mm / chord_mm / aoa_deg / elements / sm_delta_deg | 1000–1500 / 400–900 / 10–40 / 1–4 / 0–20 | 1300 / 650 / 25 / 3 / 0 | ≤ 1350 / ≤ 775 / — / ≤ 3 (C3.10.1) / needs ≥ 2 volumes (C3.10.10) |
| rear_wing.span_mm / chord_mm / aoa_deg / elements / endplate_top_mm / sm_delta_deg | 900–1300 / 300–600 / 5–35 / 1–4 / 760–960 / 0–30 | 1100 / 420 / 20 / 2 / 860 / 0 | ≤ 1150 / ≤ 465 / — / ≤ 3 (C3.11.1) / ≤ 880 / needs ≥ 2 volumes (C3.11.6) |
| floor.width_mm / throat_mm / ride_height_mm | 1500–2000 / 80–130 / 20–70 | 1800 / 100 / 35 | half-width ≤ 950 (C2.3.1) / — / plank wear ≤ 2 mm (C3.6.1(d)) |
| diffuser.expansion_deg | 8–22 | 14 | — |
| sidepods.inlet_cm2 / undercut_mm | 300–1100 / 0–220 | 650 / 100 | — |
| ballast.x_frac / extra_kg | 0–1 / 0–25 | 0.05 / 0 | axle loads (C4.2) |

Wing `aoa_deg` is in the lab's `front_wing_deg` / `rear_wing_deg` units, so the concept and the lab share a scale.

**PhysicalCar** (SI; the contract the sims consume; every field always present):
`{ id, label, mass_kg, fuel_kg, wheelbase_m, track_front_m, track_rear_m, cog_height_m, weight_dist_front, aero: { corner: { CLA_front_m2, CLA_rear_m2, CDA_m2 }, straight: { … }, ride_height_mm, ride_sens_per_mm }, pu: { ice_kw, mguk_kw, es_deploy_mj_per_lap, es_harvest_mj_per_lap }, tyres: { mu_x, mu_y, load_sens, radius_m, compound }, brakes: { max_decel_g_mech }, drivetrain_eff, calibration, sources }`.
`physical(design, { calibration: { cla_scale, cda_scale, power_scale, mu_scale } })` scales the absolute levels for the physics
sim's calibration; the design and the relative map are untouched. Baseline PhysicalCar:

```json
{ "mass_kg": 770, "fuel_kg": 10, "wheelbase_m": 3.4, "track_front_m": 1.58, "track_rear_m": 1.52, "cog_height_m": 0.327, "weight_dist_front": 0.4483,
  "aero": { "corner": { "CLA_front_m2": 1.653, "CLA_rear_m2": 2.147, "CDA_m2": 1.1 }, "straight": { "CLA_front_m2": 1.653, "CLA_rear_m2": 2.147, "CDA_m2": 1.1 },
            "ride_height_mm": 35, "ride_sens_per_mm": 0.006 },
  "pu": { "ice_kw": 400, "mguk_kw": 350, "es_deploy_mj_per_lap": 8.5, "es_harvest_mj_per_lap": 8.5 },
  "tyres": { "mu_x": 1.75, "mu_y": 1.8, "load_sens": 0.04, "radius_m": 0.353, "compound": "soft" }, "brakes": { "max_decel_g_mech": 1.75 }, "drivetrain_eff": 0.95 }
```

**Sim contract** `sim(physicalCar, trackId, conditions) → { lap_s, sectors_s: [3], vmax_kmh, speed_trap_kmh, vmin_kmh, energy: { deployed_mj, harvested_mj }, label }` (lap in real seconds).

**BenchResult** `bench(design, { circuit = "silverstone", circuits, sim, conditions, calibration, session, mass_weight })` →
`{ id, label, legal, violations: [{ id, article, value, limit, message }], physical, mass: { total_kg, parts_kg, ballast_kg, min_kg, front_share, cog_x_mm, cog_z_mm, izz_kgm2 }, aero: { df, cd, df_sm, cd_sm, balance, floor_stalled, cooling_power_factor }, circuits: { <id>: SimResult }, weekend: { lap_s, pole_s, gap_to_pole_s, grid_position, field_size, score, label }, score }`.
An illegal design gets no lap (`circuits: {}`, `score: null`), as in the lab (F-01.AC2). `score = pole_s − lap_s` (s; higher is
better); `mass_weight` (default 0) can add an explicit penalty per kg above the minimum, off by default because the sim already
charges mass.

**Lineage row** (one per generation; `lineage.jsonl`): `{ gen, id, parent, proposer, changes: [{ part, param, from, to, clamped }], hypothesis, score_before, score_after, delta_score, kept, legal, result: { score, lap_s, gap_to_pole_s, grid_position, mass_kg, ballast_kg, front_share, df, cd, cd_sm, circuits }, outcome, sigma, n_proposed, n_measured, n_illegal, candidates: [{ id, score, legal, violations?, error? }], label }`.
`kept` is a number comparison (`legal && score_after > score_before`), never an opinion. Same seed → byte-identical lineage.

**Proposer contract** (documented at the top of `concept/optimize.js`): `{ name, propose(history, design, ctx) → Proposal | Proposal[] | Promise }`,
`Proposal = { changes: [{ part, param, to }], hypothesis? }`; `ctx = { gen, rng, sigma, lambda, params (domain specs), rules, parent: { id, score, summary }, baseline, objective }`.
Out-of-domain values are clamped and flagged; unknown parameters are recorded as errors; legality is never the proposer's call.
An async proposer runs with `optimizeAsync`. The default is a seeded (1+8) evolution strategy (σ ×1.25 on a kept generation,
×0.9 otherwise, 0.01–0.3 of the domain width).

## 5. The concept aero map v0 (`concept/aeromap.js`): what each coefficient means

| Coefficient | Value | Meaning / where it is a guess |
|---|---|---|
| Downforce shares | front wing 0.25, rear wing 0.27, beam wing 0.03, floor 0.40, body 0.05 | Guess for a 2026-style car (less floor, more wing than 2022–25) |
| Drag shares | wheels 0.34, body 0.25, cooling 0.07, front wing 0.08, rear wing 0.12, beam 0.03, floor 0.07, misc 0.04 | Guess; wheels ≈ ⅓ of an open-wheeler's drag is common folklore |
| Wing lift | linear in setting from zero-lift setting (front 0, rear 5), quadratic stall roll-off from 34 / 28 (+5 per extra volume) over 10 | Zero-lift settings chosen so the baseline slopes equal the lab's +0.010 / +0.018 df per degree |
| Induced share of wing drag | front 0.625, rear 0.6875 | Chosen so the cd slopes equal the lab's +0.004 / +0.011 per degree; induced drag ∝ (S·CL)²/span² |
| Element count | +6 % load, +10 % profile drag, later stall per extra volume; mass +12–15 % | Guess |
| Straight mode | flap incidence − δ·(n−1)/n; only with ≥ 2 volumes (C3.10.10(a), C3.11.6(a)); on activation zones only | Flap share of loading is a guess |
| Floor | ∝ planform (WB − 300) × width; ground effect (35 + c₀)/(rh + c), c = 0.3167·throat; stall below a 58 mm effective gap | c₀ makes d(df)/d(rh) = −0.006 /mm at 35 mm, as in the lab; the stall gap is a guess |
| Diffuser | 1 + 0.03·Δ − 0.00375·Δ² (peak +6 % at 18°) | Guess |
| Undercut | +0.02 %/mm floor load, −0.05 %/mm body drag, radiator volume lost past 140 mm | Guess |
| Cooling | capacity ∝ inlet × undercut efficiency; need 0.85 of baseline; power × (1 − 1.5·shortfall²) | Guess (a smooth stand-in for thermal derating) |
| Aero balance | front share of each component: FW 1.0, floor 0.40, body 0.5, rear wings 0 | Guess; baseline balance 43.5 % front |
| Absolute levels (PhysicalCar) | CLA 3.8 m², CDA 1.1 m² (corner, baseline) | Estimates in line with the public 2026 aims; for the physics sim to calibrate |

**sim v0 mapping** (`concept/bench.js`), PhysicalCar relative to the baseline concept car (which maps to exactly 1.0):
`df = (CLA / CLA_ref) / k` with `k = (mass + fuel) / (mass_ref + fuel_ref)`; `cd = CDA / CDA_ref`; straight-mode drag on the
activation zones; power `p = ice_kw·eff / ref`; `a0 = μy ratio × tyre load sensitivity × balance term (0.3 % per point of
(aero balance − weight distribution) change) × agility (1 − 0.10·(WB/WB_ref − 1)) × the lab's bottoming term below 30 mm`;
`b0 = μx ratio × load sensitivity`. The game's model only takes `{ df, cd, a0, b0 }` and a per-sample headwind array, so mass,
power and straight mode go through that array as an equivalent airspeed offset, solved per sample and iterated to a fixed point
(≤ 8 profile rebuilds, 1 mm/s). Tests prove it: within 2 ms of an exact rescale of the game car for mass/power, and equal to a
whole-lap lower drag when every sample is a zone. With no change the call is byte-for-byte the evaluator's (baseline 80.800 s).
Game seconds become real seconds × (real 2026 pole / game limit lap): 88.111 / 80.8 at Silverstone, 81.786 / 76.65 at Monza.
Cost: ≈ 3 ms per evaluation of the baseline, ≈ 5–10 ms with straight mode at both circuits.

Concept vs lab, same moves, Silverstone / Monza lap delta in real seconds: rear wing +8°: concept +0.750 / +1.119, lab +0.475 /
+0.808 · rear wing −4°: concept +0.119 / −0.143, lab +0.012 / −0.245 · ride height −4 mm: concept −0.099 / −0.054, lab −0.109 /
−0.068. Directions agree everywhere; the concept charges aero-balance shifts harder than the lab's balance term.

## 6. Regulations: verified vs not

Source: FIA, *2026 Formula 1 Regulations – Section C [Technical]*, **Issue 17, 28/04/2026**, downloaded from api.fia.com on
2026-10-24 and read directly. Verified (article read in that issue): C2.3.1 (950 mm half-width), C2.3.3 (wheelbase ≤ 3400 mm),
C2.3.4 (front axle 0–150 mm behind XA=0), C2.3.5 (cockpit 1830–2030 mm), C2.3.6 (≥ 360 mm to the ICE face), C3.6.1(d) (plank
10 mm, 8 mm with wear), C3.10.1(a–b) and App. C2 §22 (front wing ≤ 3 volumes inside RV-FW-PROFILES: Y ≤ 675, XF −1250…−475),
C3.11.1(a–b) and App. C2 §30–31 (rear wing ≤ 3 volumes, Y ≤ 575, XR 165…630, endplate top Z 880), C3.10.10 and C3.11.6 (two-position
straight/corner mode flaps, ≤ 400 ms, flap excludes the forwardmost volume), C4.1 (726 kg + Nominal Tyre Mass in qualifying,
724 kg + NTM otherwise; Car Mass includes driver, excludes fuel), C4.2 (axle shares ≥ 0.44 / 0.54 of the minimum in qualifying),
C4.5.2 (driver + ballast ≥ 82 kg), C5.2.3 (3000 MJ/h), C5.2.7 (ERS-K 350 kW), C5.2.8 (ERS-K taper to 0 at 345 km/h), C5.2.9 (4 MJ
SoC window), C5.2.10 (8.5 MJ recharge per lap), C5.3.4 (turbo ≥ 12 kg), C5.5.1 (ICE ≥ 130/132/134 kg), C5.5.2 (PU ≥ 185 kg), C5.5.3
(PU CoG above Z=200), C5.17.9 (ES ≥ 35 kg), C5.18.7 (MGU-K ≥ 16/18/20 kg), C9.5.2 (driveline ≥ 22 kg), C10.7.2 (rim dimensions).

**Not verified:** the Nominal Tyre Mass (C4.7: published by the tyre supplier, not in Section C): **44 kg is an estimate** (the
widely reported 768 kg headline minus C4.1's 724 kg), so the qualifying minimum 770 kg and the race minimum 768 kg carry that
estimate. Also not in Section C and therefore estimates: ICE ≈ 400 kW, tyre μ and radius, track widths, CLA/CDA, fuel load, every
part mass. The chord limits (775 / 465 mm) are the reference volumes' X extents before their trims: a simplification of the rule.
The activation zones are not the Sporting Regulations' zones. `PKG-WB` is a concept packaging rule, not regulation text.

Note: the coordinator's brief said "mass at the 768 kg minimum". In **qualifying** (the session the weekend score models) C4.1
says 726 kg + NTM = 770 kg with the estimate; 768 kg is the race figure. The module follows the regulation text
(`regs.minMass("qualifying" | "race")`).

## 7. How to run

```bash
npm ci
node --test test/concept.test.js test/concept-bench.test.js         # the module's 21 tests (~4 s)
node concept/cli.js --gens 200 --seed 1 --circuits silverstone,monza --out /tmp/concept-run
node concept/cli.js --gens 2000 --until converged --patience 80 --seed 3 --out /tmp/concept-conv
```
The CLI writes `lineage.jsonl` and `best.json` to `--out` (default `<os tmp>/purple-concept/seed-N`) and refuses any path inside
the repo's `data/` or `data-mock/`. No network, no Mubit, no LLM anywhere in the module. Programmatic:
`require("./concept/optimize.js").optimize({ gens, seed, bench: { circuits: ["silverstone", "monza"] } })`.

## 8. Results from my runs (sim v0, 2026-10-24)

200 generations, (1+8) ES, score = Silverstone weekend score; Monza measured but not scored. Wall time ≈ 9 s per run.

| Seed | Gens (stop) | Kept | Silverstone lap (s) | Δ vs baseline | Monza lap (s) | Δ | Speed trap S/M (km/h) | Mass (kg) | Ballast (kg) | Front share |
|---|---|---|---|---|---|---|---|---|---|---|
| baseline | — | — | 88.111 | — | 81.786 | — | 327.6 / 328.1 | 770 | 5.1 | 0.4483 |
| 1 | 200 (limit) | 50 | **86.886** | **−1.225** | 80.171 | −1.615 | 340.4 / 341.9 | 770 | 10.1 | 0.4483 |
| 2 | 200 (limit) | 66 | 86.922 | −1.189 | 80.184 | −1.602 | 340.7 / 342.4 | 770 | 10.1 | 0.4502 |
| 3 | 283 (converged, patience 80) | 58 | 86.889 | −1.222 | 80.160 | −1.626 | 340.6 / 342.1 | 770 | 10.2 | 0.4445 |

All three seeds land within 0.04 s of each other with the same design themes. Seed 1, gain split by part group (each group applied
alone to the baseline; they do not add exactly): straight-mode flaps −0.368 s (Monza −0.884), floor + diffuser + ride height
−0.362 s, wing geometry −0.253 s, sidepods/cooling −0.227 s, layout + ballast +0.005 s.

**What changed most (seed 1):** both straight-mode flap angles went to their domain maximum (front 20°, rear 30°); the rear wing
became a short-chord (300 mm), full-span (1150 mm, the C3.11.1 limit), higher-setting (22°) wing with 880 mm endplates (the RV
limit); the front wing went to two volumes, full span (1350 mm), 520 mm chord, 29°; the floor went to the 1900 mm width limit, an
80 mm throat, 30 mm ride height (the bottoming threshold, 0.5 mm plank-wear estimate) and 17° of diffuser expansion, sitting just
inside the modelled stall onset; inlets shrank to 570 cm² with a 155 mm undercut. Mass stayed at the 770 kg minimum: the lighter
wings became ballast, which the optimiser moved to keep the C4.2 axle split inside its 44–46 % window. Corner CLA 3.80 → 4.07 m²,
CDA 1.10 → 1.03 m² (0.94 in straight mode). The regulation limits the car ends up pressing against (width, wing spans, endplate
height, axle-load split) are exactly the ones the module enforces, and illegal candidates are measured for legality only.

## 9. Tests (21, in two files; full suite 118 tests, green)

`test/concept.test.js` (8): baseline legal and every rule sourced; **every checkable rule caught** (27 rules, one case each);
mass sums, automatic ballast to the C4.1 minimum, axle loads, heavier parts eat ballast first; every part has a mass basis; design
validate / mutate (400 seeded mutations stay in the domain, quantised) / diff round trip; aero map v0 baseline = 1 and its slopes
match `lab/aero.js` SENS within 3 %; straight mode needs a flap, stall and cooling behave; no banned wording in `concept/` or this
file. `test/concept-bench.test.js` (13): concept rng = `scenarios.seededRng`; PhysicalCar contract and calibration hook; baseline =
the evaluator's lap exactly at both circuits (88.111 s / P1 at Silverstone); the lab's evaluator results, fixtures and `EI.CAR`
unchanged after concept runs; mass/power channel vs an exact rescale (< 2 ms); straight mode vs whole-lap drag (< 2 ms); physics
directions; illegal → no lap; determinism; < 50 ms per evaluation; pluggable sim feeds the weekend score; same seed → same
lineage, `kept` is numeric; 50 generations improve the score and never return an illegal best; sync / async / bad / illegal
proposers and convergence; CLI writes outside `data/` and refuses `data/` and `data-mock/`.

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
