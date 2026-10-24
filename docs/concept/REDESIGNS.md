# PURPLE CONCEPT - Redesigns: discrete concept families (redesigns v1)

The concept car can change **shape and style on purpose**, not only by slider tweaks: eight parts carry a discrete *concept family*
parameter (an integer code). Each code changes, consistently, the part's mass and CoG, its aero (downforce per axle, drag, balance,
ride-height sensitivity, straight-mode effect), cooling capacity, and where relevant its legality. Every number in this file is a
**model assumption or a sourced estimate, labelled as such**; no flow is solved anywhere and nothing here is measured on a car. Lap times that come out
of it are "reduced-order lap model · calibrated to 2026 pole laps · aero map v1" predictions with their ± band.

## 1. Contract (shared with the 3D-view helper and the autonomous-engine helper; do not rename)

Every concept family is an ordinary **integer design parameter** of `concept/parts.js` (`{ int: true, step: 1, min: 0, max: N−1 }`),
so it is in `parts.PARAMS`, in `design.baseline()`, in `design.validate/applyChanges/mutate/diff`, in the campaign's search vector
(`concept/campaign/space.js`: CMA-ES searches it as a coordinate, quantised to the integer by `design.applyChanges`) and in the engine's
garage. Set one with `design.applyChanges(d, [{ part: "sidepods", param: "concept", to: 1 }])`. A design saved before redesigns v1
carries none of them: `design` migration fills the baseline code (same rule as more-factors v1), and `parts.val(params, part, key)`
returns the baseline when a code is absent.

| key (`part.param`) | codes (integer) | RB22 / baseline | where it lives |
|---|---|---|---|
| `sidepods.concept` | 0 `downwash` (current) · 1 `zeropod` (minimal inlets, narrow) · 2 `ramp` (deep undercut + top ramp) | 0 | existing part `sidepods` |
| `nose.concept` | 0 `long_low` long low nose (current) · 1 `short_high` short high nose | 0 | existing part `nose` |
| `front_wing.endplate` | 0 `open_outwash` open endplate, outwash (current, assumption) · 1 `closed_inwash` closed endplate, inwash | 0 | existing part `front_wing` |
| `rear_wing.style` | 0 `low_drag` low-drag spoon · 1 `medium` (current) · 2 `high_df` high-downforce | 1 | existing part `rear_wing` |
| `floor.edge` | 0 `simple` simple edge (current) · 1 `scrolled` multi-fence scrolled edge | 0 | existing part `floor` |
| `cooling.layout` | 0 `standard` (current) · 1 `airbox_gills` large airbox + gills · 2 `compact` compact, louvred engine cover | 0 | existing part `cooling` (systems group: radiators, intercooler, ERS cooling; it already has a mass row) |
| `engine_cover.style` | 0 `high_fin` high shark fin (current) · 1 `low_narrow` low narrow cover | 0 | existing part `engine_cover` |
| `suspension.front` | 0 `pushrod` (RB22 current) · 1 `pullrod` | 0 | **new parameter-only part `suspension`** (no mass row of its own, like `layout` and `setup`); its effect moves the `front_suspension` mass row (mass, CoG height) and the front aero (see §3) |

Mapping notes: all eight keys are exactly the names above. Only `suspension` is a new part id; the physical front suspension stays the
`front_suspension` mass row. The cooling family sits on the existing `cooling` part (it already carries the heat-exchanger mass, scaled
by `sidepods.inlet_cm2`); the continuous `sidepods.inlet_cm2` / `sidepods.undercut_mm` still exist and keep their meaning under every
concept (the concept changes the *shape template* and the coefficients, the continuous parameters size it).

Code-level API (`concept/parts.js`, dual browser / Node):
- `parts.CONCEPTS`: `{ "sidepods.concept": { part, param, codes: [{ code: 0, id: "downwash", label: "Downwash sidepods" }, …], base } , … }`
  (the ids and labels above; the view and the engine should read labels from here, not hard-code them).
- `parts.concept(params, "sidepods.concept")` → the code id string (`"downwash"`), baseline when absent.
- `parts.CONCEPT_KEYS`: the eight keys in this order (also the order of the last eight entries of `parts.PARAMS` and of the campaign
  vector `space.VARS`).
- `aeromap.evaluate(p).concepts` → `{ ids: { sidepods, nose, fw_endplate, rw_style, floor_edge, cooling, cover, fsusp }, df: {…}, cd:
  {…}, flap, undercut_gain, stall_mm, ge_beta, fw_ge_n, floor_front, cool, cool_free_dmm, rw_stall_deg, window_fwd, yaw_sens, heave }`:
  the combined multipliers / shifts the concepts applied (identity at the baseline codes), for the engine's explanations.
- `physical.physical(d).concepts` (the ids) and `.stability` (`{ balance_shift, window, excess, grip_factor }`, §4).
- `design.describeChange` / `design.describe` print a concept as `downwash (0) → ramp (2)`; `design.diff` carries integer codes.
- Packaging rules (`regs.CONCEPT_RULES`, `regs.CONCEPT_LIMITS`): `PKG-ZEROPOD-INLET`, `PKG-RAMP-UNDERCUT`, `PKG-AIRBOX-COVER` (§3).
  `concept/campaign/run.js` `conceptSwitches(d)` lists every legal single-family switch with its partner changes (useful to the engine).

For the 3D view (what each code should *look like*; dimensions are the view's to choose inside the FIA volumes, these are the intent):
- `sidepods.concept` 0 downwash: high shoulder at the inlet, top surface falling steeply to the floor towards the rear (RB / RB22 style);
  1 zeropod: almost no sidepod volume, the body narrows to near the survival cell, small vertical inlets (Mercedes W13 style); 2 ramp:
  deep undercut under a wide, flat-topped pod whose top surface forms an inboard ramp / "waterslide" gully running to the rear
  (Ferrari SF-23 / Aston style). Inlet area still = `sidepods.inlet_cm2`, undercut depth still = `sidepods.undercut_mm`.
- `nose.concept` 0: nose tip low, joining the front-wing main plane (current); 1: short, high nose, tip ending well behind the first
  element, front wing hung on pylons, more air under the nose.
- `front_wing.endplate` 0: open endplate turning out (outwash, flared trailing edge); 1: closed, tall endplate joined to the flap tips and
  curled inboard (inwash).
- `rear_wing.style` 0: shallow "spoon" main plane, low flap, cut-down chord at the tips; 1: current; 2: steep, deep flap, larger
  endplate cut-outs closed.
- `floor.edge` 0: plain floor edge; 1: scrolled edge with several fences / edge wings along the floor edge ahead of the rear tyre.
- `cooling.layout` 0: current; 1: large airbox inlet (bigger roll-hoop intake) plus gill louvres on the pod tops; 2: compact: louvred
  engine cover (rows of louvres on the cover's top), small exit.
- `engine_cover.style` 0: high shark fin to the rear wing; 1: low, narrow cover, no fin.
- `suspension.front` 0: pushrod (rod from the lower wishbone up to a rocker high on the chassis); 1: pullrod (rod from the upper
  wishbone down to a rocker low on the chassis).

For the autonomous engine: concepts are discrete, so they are best explored as **whole-concept proposals** (switch one family, then let the
local search re-tune the continuous parameters around it: a concept change usually needs its partners, e.g. zeropod needs compact
cooling or a larger inlet, a high-downforce rear wing needs more front wing). The physics lap sim, the legality check and the cooling
guard decide; nothing is kept on the model's word.

## 2. Effects per concept

Code: `concept/parts.js` `REDESIGN_MASS` (mass and positions), `concept/aeromap.js` `REDESIGN`, `COOL_PACK`, `CONCEPT_COMBOS`
(aero, cooling, interactions), `concept/physical.js` (balance window, yaw sensitivity), `concept/regs.js` `CONCEPT_RULES`.
**Every magnitude below is an ASSUMPTION of this concept model** (an engineering estimate; no team publishes per-concept masses or
coefficients). The *directions* follow public technical analysis of the 2022-2026 concepts these codes are named after (downwash
vs zeropod vs ramp sidepods, short vs long noses, outwash vs inwash endplates, spoon vs high-downforce rear wings, scrolled floor
edges, louvred vs gilled cooling, low engine covers, push vs pull rods); the *sizes* were chosen as a few per cent of the component
they act on, so that no concept dominates on its own and each needs its partners. Aero multipliers act on the component's share of
the baseline car's downforce / drag (aeromap `DF_SHARE`: front wing 25 %, rear wing 27 %, floor 40 %, body 8 %; `CD_SHARE`: wheels
34 %, body 28 %, cooling 7 %, front wing 8 %, rear wing 12 %, floor 7 %, misc 4 %).

| Family · code | Mass and CoG (`REDESIGN_MASS`) | Aero (`REDESIGN`) | Cooling | Ride height / platform | Rules |
|---|---|---|---|---|---|
| `sidepods.concept` 1 zeropod | pod bodywork × 0.55 (−3.9 kg at 650 cm²); radiators upright in the narrow pod (cooling row +60 mm, \|y\| 500 → 330) unless the layout moves them | body drag × 0.93, floor load × 0.975, undercut slopes × 0.5 | pod packaging × 0.78 (standard) / 0.92 (airbox + gills) / 1.0 (compact) | floor stall onset +1.0 mm (porpoising-prone) | `PKG-ZEROPOD-INLET` ≤ 760 cm²; standard layout fails `PKG-COOLING` |
| `sidepods.concept` 2 ramp | pod bodywork × 1.15, +40 mm (wide flat top) | floor × 1.02, rear wing × 1.012, body drag × 1.03, undercut slopes × 1.3 | undercut eats radiator volume from 110 mm (was 140); packaging × 0.94 / 0.98 / 1.0 | stall onset −0.5 mm (sealed edge) | `PKG-RAMP-UNDERCUT` ≥ 120 mm; C3.8.1 volume (info) |
| `nose.concept` 1 short_high | nose +1.2 kg (shorter crush structure, same frontal-test energy), +100 mm | front wing × 0.98, floor × 1.015, body drag × 0.995 | — | front-wing ground-effect exponent × 0.85 | `REG-C-NOSE-IMPACT` (info: impact test not modelled), `REG-C-FW-ENDPLATE-VOLUMES` (pylons, info) |
| `front_wing.endplate` 1 closed_inwash | front wing +0.4 kg | front wing load × 1.02, its drag × 0.95; wheels drag × 1.03 (tyre wake no longer pushed out); floor × 0.985 | — | front-wing ground-effect exponent × 1.2 (sealed tip) | `REG-C-FW-ENDPLATE-VOLUMES` (info) |
| `rear_wing.style` 0 low_drag | −0.5 kg | rear wing load × 0.86, drag × 0.84, flap relief × 0.8 | — | — | — |
| `rear_wing.style` 2 high_df | +0.7 kg (high) | rear wing load × 1.12, drag × 1.17, flap relief × 1.1, stalls 3° sooner | — | — | — |
| `floor.edge` 1 scrolled | floor +1.2 kg (low) | floor load × 1.035, floor drag × 1.06, floor's front share −0.02 (fences ahead of the rear tyre) | — | stall onset −0.8 mm; ground-effect exponent × 1.10 (peakier, more ride-height sensitive) | — |
| `cooling.layout` 1 airbox_gills | cooling +2.8 kg (+60 mm), cover +0.6 kg | cooling drag × 1.10, body × 1.015, rear wing × 0.99 | capacity × 1.12 | — | `PKG-AIRBOX-COVER` (needs the high-fin cover); `REG-C-EC-APERTURES` (info) |
| `cooling.layout` 2 compact | cooling +1.2 kg, +100 mm, 150 mm rearwards (under the cover) | cooling drag × 0.92, body × 0.99, rear wing × 0.985 (hot louvre outflow) | capacity × 0.90 (cores next to the hot engine, louvres exit into its bay); no pod packaging loss | — | `REG-C-EC-APERTURES` (info) |
| `engine_cover.style` 1 low_narrow | cover −1.0 kg, −80 mm | body drag × 0.975, rear wing × 1.015 | capacity × 0.96 (tighter bay); × 0.95 more with the compact layout | aero-balance window −0.004 on the forward side; crosswind yaw sensitivity 0.003 per degree (sim `aero.yaw_sens`) | `PKG-AIRBOX-COVER` |
| `suspension.front` 1 pullrod | front suspension +0.4 kg, −35 mm (rockers, dampers low) | floor × 1.006, body drag × 1.004 | — | platform stiffness × 1.05 (rods in tension) | `REG-C-SUSP-ACTUATION` (info: both permitted) |

Materials per major part were already present (`concept/materials.js`, 13 parts with C15-checked options, MATERIALS.md); the concept
families change part masses through the same mass sheet, so a material swap on a concept part scales the concept's mass too.

## 3. Rules, partners and the trade-off matrix

Three packaging rules say what each concept physically is (labelled concept-model rules, `verified: false`, not FIA text):
`PKG-ZEROPOD-INLET` (a zeropod's narrow frontal section carries at most 760 cm² of inlet), `PKG-RAMP-UNDERCUT` (a ramp pod is defined by
an undercut ≥ 120 mm), `PKG-AIRBOX-COVER` (the extra roll-hoop radiator of the airbox + gills layout needs the full-height cover).
The Section C articles each concept touches are recorded as info rows (`REG-C-SIDEPOD-VOLUME` C3.8.1, `REG-C-EC-APERTURES` C3.8.2 and
C3.16.10-12, `REG-C-FW-ENDPLATE-VOLUMES` C3.10.2-C3.10.9, `REG-C-NOSE-IMPACT`, `REG-C-SUSP-ACTUATION` C10.2): the concept view draws
the shapes inside those volumes; their geometry is not checked here. Every existing rule still applies to every concept (cooling,
floor stall, front-wing envelopes, mass and axle split, PU lock).

Trade-off matrix (what a concept needs, what it fights; "→" = the partner the campaign or the engine has to find):

| Concept | Gains | Pays | Needs / fights |
|---|---|---|---|
| zeropod | body drag, pod mass | floor load, stall margin, cooling packaging, CoG height of the cores | → compact cooling (or airbox + gills with the fin) and a larger inlet (≤ 760 cm²); a scrolled edge gives back half its floor loss |
| ramp | floor and rear-wing load | body drag, mass, radiator volume (undercut costs cooling 30 mm sooner) | → a larger inlet; balance moves rearwards → more front wing |
| short high nose | floor load | front wing load, nose mass, front ride-height authority | balance rearwards → more front wing (2 volumes at a higher setting fit the front-wing Z envelope) |
| closed inwash endplate | front wing efficiency | wheels drag, floor load | balance forwards; small net |
| low-drag rear wing | drag | rear load, balance | balance forwards, outside the window alone → less front wing or a rearward floor (scrolled edge) |
| high-df rear wing | rear load | drag, early stall | balance rearwards, outside the window alone → the front wing must follow |
| scrolled floor edge | floor load, stall onset | floor drag, mass, ride-height sensitivity, balance rearwards | → front wing; pairs with a zeropod |
| airbox + gills | cooling capacity | drag, mass, CoG height | lets the inlet shrink; fights the low cover |
| compact louvred | cooling drag, pod packaging | capacity (× 0.90), rear-wing load, CoG height | the zeropod's partner; on a downwash pod it only costs a bigger inlet |
| low narrow cover | body drag, rear-wing load, CoG | cooling capacity, balance window, crosswind yaw | → a larger inlet; no airbox |
| pullrod | platform stiffness, CoG | mass, body drag | small either way |

## 4. Difficulty v1: why the optimiser beat pole so easily, and the costs added

Before this pass the campaign (CAMPAIGN.md §4.0) took the RB22 from 88.763 s to 87.235 ± 0.154 s (−0.876 s to the 88.111 s pole);
re-run on the more-factors sim with the same settings for the RB22 alone it found 87.288 ± 0.167 s. Its time came from places a real
team cannot take for free:

1. **Range edges.** Front-wing span 1350, rear-wing span 1150, floor body width 1540, rear endplate 880 mm: every one at its FIA limit,
   each worth load at the same rate as the first millimetre. Real tips and floor edges at the limit work in the tyres' wakes.
   **Cost:** past 1300 / 1100 / 1450 / 860 mm the load-carrying planform (and the endplate's aspect-ratio gain) counts at half rate;
   the drag of the real area is kept (aeromap `EDGE`, assumption).
2. **Straight-mode flaps.** 29.5° of rear flap (and 10.5° front) bought 0.38 s through the map's linear flap relief. Past its
   reference opening (front 4°, rear 15°) the flap's slot flow separates. **Cost:** each further degree sheds half as much loading
   (`EDGE.sm_ref_deg`, assumption). The rear flap is still opened to the 30° domain bound because Section C sets no Straight Mode
   envelope for it (C3.11.6(g)(ii)).
3. **Cooling.** The optimiser cut the inlet from 650 to 590 cm² because the PU only needed 0.85 × 1.05 of the baseline's capacity on
   one qualifying lap. **Cost (parc fermé):** the car that qualifies races with the same bodywork, so the cooling is sized for the
   race: need 0.95 (assumption: ≈ 12 % more heat rejection for sustained race power and traffic), required 0.9975; the baseline is a
   car sized to it and every concept that loses capacity has to buy it back with inlet area (drag, mass).
4. **Balance window.** The quasi-steady point-mass sim drives any aero balance to both axles' limits; a real driver cannot use a car
   whose high-speed balance has moved far from its set-up. **Cost:** the driver's aero-balance window (`physical.BALANCE_WINDOW`):
   inside 1.5 points rearwards / 1.2 points forwards of the team baseline's corner balance nothing changes; outside, both tyre μ
   lose 20 × excess² (2 points out ≈ 0.8 % of grip; assumption, not fitted). The forward side narrows by 0.004 without a shark fin.
5. **Tyre and brake temperature** were considered and not added: a single qualifying lap on a prepared tyre has no thermal state the
   point-mass sim could carry honestly, and FACTORS.md §5 already rejected a brake-duct model for the same reason.

The campaign itself gained a stage: after the wing-volume combinations, every single-family concept switch (with its partner
changes and an inlet that covers the cooling) gets a short CMA-ES around it, kept only on a faster physics lap.

**Before / after** (physics lap sim, Silverstone, 2026 British GP qualifying conditions; reduced-order lap model · calibrated to 2026
pole laps · aero map v1; every lap a fresh physics sim lap; ± is the campaign's 1σ transfer band, CAMPAIGN.md §2):

(pending the full campaign run; see §5)

## 5. Single switches, measured

RB22 anchor (generic in brackets), one family switched from the baseline, inlet raised to the smallest that cools the car where the
switch needs it (the campaign's `coolingRepair`), default "regulated" energy plan. Δ in % against the baseline; balance in points of
front share. A positive Δlap on its own is expected for most concepts: each one needs its partners (§3).

| Switch | Δlap s RB22 (generic) | Inlet cm² | Δdf % | Δcd % | Δbalance pts | Cooling capacity | Δparts kg | ΔCoG mm |
|---|---|---|---|---|---|---|---|---|
| zeropod + compact cooling | −0.102 (−0.119) | 730 | −1.41 | −1.35 | +0.34 | 1.011 | +1.42 | +5.6 |
| zeropod + airbox + gills | −0.015 (−0.018) | 650 | −1.27 | −0.87 | +0.27 | 1.030 | −0.47 | +3.1 |
| zeropod + standard cooling | illegal (PKG-COOLING at the 760 cm² cap) | 760 | −1.00 | +0.11 | +0.11 | 0.912 | +1.73 | +3.3 |
| ramp (undercut 120) | +0.257 (+0.258) | 720 | +1.34 | +1.83 | −0.29 | 1.007 | +4.83 | +0.8 |
| short high nose | +0.094 (+0.082) | 650 | +0.10 | −0.14 | −0.48 | 1.000 | +1.20 | +1.2 |
| closed inwash endplate | +0.039 (+0.052) | 650 | −0.10 | +0.62 | +0.48 | 1.000 | +0.40 | 0.0 |
| low-drag rear wing | +0.040 (+0.340) | 650 | −3.78 | −1.92 | +2.17 | 1.000 | −0.50 | −0.5 |
| high-df rear wing | +0.163 (+0.151) | 650 | +3.24 | +2.04 | −1.73 | 1.000 | +0.70 | +0.5 |
| scrolled floor edge | +0.088 (+0.096) | 650 | +1.40 | +0.42 | −0.97 | 1.000 | +1.20 | −0.3 |
| airbox + gills | +0.203 (+0.202) | 650 | −0.27 | +1.12 | +0.15 | 1.120 | +3.40 | +3.8 |
| compact louvred | +0.140 (+0.132) | 730 | −0.40 | +0.63 | +0.22 | 1.011 | +5.43 | +6.1 |
| low narrow cover | −0.011 (−0.011) | 680 | +0.41 | −0.12 | −0.22 | 1.004 | +0.60 | −1.2 |
| pullrod | +0.005 (+0.007) | 650 | +0.24 | +0.11 | −0.03 | 1.000 | +0.40 | −1.3 |
| high-df rear wing + scrolled edge | +0.331 (+0.304) | 650 | +4.64 | +2.46 | −2.65 (outside the window) | 1.000 | +1.90 | +0.1 |
| … + front wing 2 volumes at 32°, 575 mm | −0.486 | 650 | | | back inside | | | |

The last two rows are the "front wing must follow" interaction: the rearward pair alone is 0.33 s slower; with the front wing
re-set (2 volumes fit a 32° setting in the front-wing Z envelope at 575 mm) the same pair is 0.49 s faster than the baseline.

## 6. Limits (read before quoting a number)

- Every concept coefficient is an assumption of a reduced-order map: directions from public analysis, sizes chosen, nothing fitted
  or measured. A ranking between concepts is a property of this model, not a statement about real cars.
- The concepts change coefficients of the existing component model; no flow is solved, the 3D shapes are drawn by the view from the
  same codes and do not feed back into the numbers.
- The packaging rules are concept definitions, not FIA text; the Section C rows are recorded, not geometrically checked.
- The balance window, parc fermé race need and range-edge rates are difficulty assumptions; §4 states each one so it can be argued
  with. Lap times are "model prediction ± band", never a measured or certified number.
