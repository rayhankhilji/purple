# Coupling: how each part change reaches the simulated car

Version: coupling v1 · 2026-10-24 · branch `claude/parts-physics` · label on every number below:
**"concept · design deltas (part-mass, concept aero map v1 and materials v1 estimates) on the physics sim's estimated car"**

This page answers one question for every design input: does it change the car that the physics lap sim drives round
Silverstone, by the right mechanism, in the right direction, at a believable size? The chain is

```
design.params ─▶ parts.massSheet ─▶ mass, CoG (x, z), axle split, Izz, unsprung ─┐
              └▶ aeromap.evaluate ─▶ df / cd (corner, straight), balance, stall,  ├─▶ physical() ─▶ PhysicalCar ─▶ sim.simulateLap
                                     cooling, material flex                       ┘
```

`physical()` maps the design onto the anchor car (the sim's estimated car, or the RB22) as **anchor + (design − baseline design)**,
so `physical(baseline)` is the anchor exactly. The sim (`concept/sim/lapsim.js`, not changed here) reads `mass_kg`, `fuel_kg`,
`cog_height_m`, `weight_dist_front`, the track widths, `aero.corner` / `aero.straight` (CLA per axle, CDA), `aero.floor_stalled`,
`pu`, `tyres`, `brakes`, `drivetrain_eff` and `gearing`. It does not read `wheelbase_m`, the ride height or the new fields listed in
§5. Tests: `test/concept-coupling.test.js`.

## 1. Baseline lap: before and after

| Car | Before (head `claude/happy-darwin-eoivl5`) | After (this branch) |
|---|---|---|
| `physical(design.baseline())` (generic anchor) | 88.312 s | 88.312 s |
| `physical(design.baseline({ team: "redbull" }))` (RB22 anchor) | 88.749 s | 88.749 s |

Both baselines still map exactly onto their anchors (mass, CoG, weight split, CLA and CDA in both modes: tested). The surrogate's
fingerprints are untouched: `simV0(physical(baseline))` and the sim's own RB22 car are unchanged.

## 2. Per-parameter coupling (23 shape parameters)

Measured on the physics sim, RB22 anchor, one change at a time from the baseline: the parameter moved by −10 % / +10 % of its
baseline value (one step for counts; ballast position with 10 kg of extra ballast so there is ballast to move). "Before" is the
same measurement on the integration head. † = the changed car is illegal (it would get no lap on the bench; the sim still laps it,
which is what this audit needs). Field arrows are for the + change: m mass, wdf front weight share, h CoG height, cla corner CLA,
bal corner aero balance (front share of CLA), cda corner CDA, cdaS straight-mode CDA.

| Parameter | Base ± step | PhysicalCar fields moved (+) | Mechanism | Expected effect | Δlap −/+ after (s) | Δlap −/+ before (s) | Generic anchor after | Status |
|---|---|---|---|---|---|---|---|---|
| layout.wheelbase_mm | 3400 ± 340 | m↑ wdf↑ h↓ cla↑ bal↓ cda↑ cdaS↑ | floor planform ∝ (WB − 300); spacer mass; parts move with XR; **lever rule**: wings' axle split ∝ their lever arms over WB | longer: more floor load and drag, more mass; balance shifts rearwards | +0.606† / +0.469† | +0.473† / +0.379† | +0.603† / +0.463† | fixed (lever-rule balance added). The baseline sits on the packaging minimum (PKG-WB) and the C2.3.3 maximum, so both directions are illegal; WB 3350: −0.063† |
| survival_cell.front_axle_offset_mm | 75 ± 7.5 | wdf↑ h↑ | the tub, driver, PU and everything tied to XC/XPU move forward relative to the front axle | more front weight: slower on this front-limited car | −0.022 / +0.038 | −0.023 / +0.038 | −0.020 / +0.041 | OK (now smooth: see §4.1) |
| survival_cell.cockpit_len_mm | 1930 ± 193 | m↑ wdf↓ h↑ | XC and XPU move rearward (driver, ES, PU), tub mass ∝ length, the spacer shrinks | less front weight: faster until C4.2 / PKG-WB bind | +0.652† / +0.075† | +0.653† / +0.072† | +0.635† / +0.069† | OK; legal steps: 1900 +0.110, 1960 −0.114† |
| survival_cell.bulkhead_gap_mm | 380 ± 38 | wdf↓ h↑ | PU moves rearward relative to the cockpit | less front weight | +0.060† / −0.074† | +0.059† / −0.074† | +0.057† / −0.064† | OK; 400: −0.031 (legal) |
| front_wing.span_mm | 1300 ± 130 | m↑ wdf↑ h↓ cla↑ bal↑ cda↑ cdaS↑ | planform; induced drag ∝ 1/span²; mass at XF −860; lever share 1 + 860/WB | more front load and balance | +0.544 / −0.072† | +0.431 / −0.177† | +0.536 / −0.065† | fixed (lever rule makes the front wing 1.25× as potent on balance); 1350: −0.175 (legal) |
| front_wing.chord_mm | 580 ± 58 | m↑ wdf↑ h↓ cla↑ bal↑ cda↑ cdaS↑ | planform; **ground effect ∝ (c/h)^0.25** | more front load | +0.689 / +0.023† | +0.411 / −0.128† | +0.683 / +0.018† | fixed; +10 % now overshoots the axle balance (rear-limited), +10 mm: −0.107† (envelope) |
| front_wing.aoa_deg | 25 ± 2.5 | cla↑ bal↑ cda↑ cdaS↑ | lift linear in setting with stall; profile + induced drag | more front load and drag | +0.523 / −0.030 | +0.407 / −0.134 | +0.507 / −0.027 | fixed (lever rule); the lab slopes are unchanged at the baseline (tested) |
| front_wing.elements | 3 ± 1 | m↑ wdf↑ h↓ cla↑ bal↑ cda↑ cdaS↑ | +6 % load, +10 % profile drag, later stall per volume; flap share (n−1)/n | more load | +0.249 / −0.050† | +0.185 / −0.115† | +0.234 / −0.047† | fixed (lever rule) |
| front_wing.sm_delta_deg | 4 ± 0.5 | cdaS↓ | Straight Mode flap: `Q_anchor·q_sm − E·φ`, φ = min(1, angle / 4°) | more flap: less straight-mode drag | +0.032 / −0.005 | +0.032 / −0.005 | +0.034 / −0.006 | **weak by convention**: past the reference angle only the concept map's own flap relief counts (E is capped), so the slope drops 6× at 4°. Not changed: needs a decision (§6) |
| rear_wing.span_mm | 1100 ± 110 | m↑ wdf↓ h↑ cla↑ bal↓ cda↑ cdaS↑ | planform; induced drag; flap share × min(1, 535 / half-span) (C3.11.6(a)(ii)); lever share −400/WB | more rear load, balance rearwards | +0.189 / +0.073† | +0.126 / +0.017† | +0.195 / +0.075† | OK: both directions slower because the RB22 anchor sits at the sim's axle-balance kink (§6); 1150: +0.033 |
| rear_wing.chord_mm | 420 ± 42 | m↑ wdf↓ h↑ cla↑ bal↓ cda↑ cdaS↑ | planform, setting-dependent profile drag | more rear load and drag | +0.119 / +0.123 | +0.055 / +0.081 | +0.116 / +0.117 | OK (kink, §6) |
| rear_wing.aoa_deg | 20 ± 2 | cla↑ bal↓ cda↑ cdaS↑ | as the front wing; rear wing unloads the front axle by 400/WB of its load | more rear load and drag | +0.318 / +0.178 | +0.237 / +0.100 | +0.305 / +0.170 | OK (kink, §6) |
| rear_wing.elements | 2 ± 1 | m↑ wdf↓ h↑ cla↑ bal↓ cda↑ cdaS↓ | as the front wing; 1 volume = no flap (C3.11.6(a)(i)) | 1 volume: no Straight Mode, much slower | +1.813† / +0.104 | +1.830† / +0.073 | +1.825† / +0.100 | OK |
| rear_wing.endplate_top_mm | 860 ± 86 | m↑ wdf↓ h↑ cda↓ cdaS↓ | **Hoerner endplate gain** e = 1 + 1.9·h/b on induced drag (h above Z 725); endplate mass ∝ height, high up | taller: less induced drag, more and higher mass | +0.029 / +0.004† | +0.048 / −0.032† | +0.033 / −0.023† | fixed (span coupling; slope at the baseline now 0.0014/mm instead of a flat 0.002/mm); 880: −0.005 (legal) |
| rear_wing.sm_delta_deg | 15 ± 1.5 | cdaS↓ | as the front flap, reference 15° | more flap: less straight-mode drag | +0.149 / −0.011 | +0.149 / −0.011 | +0.150 / −0.012 | **weak by convention** (as the front flap): 7.5° costs +0.839 s, 25° gains only −0.054 s |
| floor.width_mm | 1450 ± 145 | m↑ wdf↓ h↓ cla↑ bal↓ cda↑ cdaS↑ | floor planform × ground effect; floor mass ∝ planform | more floor load | +0.280 / −0.236† | +0.335 / −0.285† | +0.273 / −0.225† | OK (β: the floor's share of the ride-height slope is now 92 %, §3.2); 1540: −0.143 (legal) |
| floor.throat_mm (v2 units: × 0.6, see below) | 60 ± 6 (v1: 100 ± 10) | cla↓ bal↑ cda↓ cdaS↓ | ground effect ∝ ((35 + c₀)/(rh + 0.5278·throat))^β (v1: 0.3167·throat) | higher throat: less suction | −0.142† / +0.124 | −0.181† / +0.158 | −0.139† / +0.119 | OK; 97: −0.045 (legal) |
| floor.ride_height_mm | 35 ± 3.5 | h↑ cla↓ bal↑ cda↓ cdaS↓ | floor ground effect; **front wing ground effect**; sprung mass rises; plank wear below 32 mm; stall margin | higher: less load, higher CoG | −0.243† / +0.214 | −0.246† / +0.212 | −0.245† / +0.224 | fixed (front wing now feels the ground; the total slope is still the lab's −0.006 /mm); 34: −0.066 (legal) |
| diffuser.expansion_deg | 14 ± 1.4 | wdf↓ h↑ cla↑ bal↓ cda↑ cdaS↑ | D = 1 + q(2pe − e²), **peak p falls 0.1°/mm of lost gap**; **stall onset +0.5 mm/°**; drag +2 %/° of floor drag | more expansion: more load up to the (gap-dependent) peak | +0.150 / −0.097 | +0.176 / −0.115 | +0.157 / −0.106 | fixed (gap coupling) |
| sidepods.inlet_cm2 | 650 ± 65 | m↑ wdf↓ h↑ cda↑ cdaS↑ | cooling capacity (PKG-COOLING, derate), cooling drag ∝ inlet, radiator mass ∝ inlet^0.8 | bigger: more drag and mass | −0.090 / +0.217 | −0.087 / +0.201 | −0.095 / +0.209 | OK (asymmetric because a lighter car is topped up with ballast) |
| sidepods.undercut_mm | 100 ± 10 | wdf↑ h↓ cla↑ bal↓ cda↓ cdaS↓ | floor-edge feed +0.02 %/mm, body drag −0.05 %/mm, radiator volume lost past 140 mm | deeper: less drag, a little more floor load | +0.022 / −0.029 | +0.021 / −0.023 | +0.019 / −0.020 | OK |
| ballast.x_frac | 0.05 ± 0.01 (10 kg extra) | wdf↓ | ballast at x_frac·WB, Z 30 | rearwards: less front weight | +0.004 / −0.003 | +0.003 / −0.002 | +0.001 / −0.004 | OK. At the baseline (0.2 kg of ballast) it moves nothing measurable: physically right, there is nothing to move; materials that free mass make it matter (§4) |
| ballast.extra_kg | 0 + 0.5 | m↑ wdf↑ h↓ | mass above the minimum | heavier: slower (≈ 0.034 s/kg here) | — / +0.017 | — / +0.019 | — / +0.016 | OK |

Summary: **23 / 23 parameters reach the sim**. 9 were changed by this branch (wheelbase, the four front-wing shape parameters,
endplate, ride height, diffuser and, through the unrounded mass sheet, every mass-only parameter's smoothness); 12 were already
right and stay as they were; **2 are weak by convention** (the two Straight Mode flap angles past their reference, §6). No
parameter reached the sim with the wrong sign. The rear-wing rows are slower in both directions because the RB22 anchor sits on
the sim's axle-balance kink; that is the sim's behaviour, flagged in §6, not a sign error.

## 3. Interaction terms (combined ≠ sum)

Each term is in the model on purpose, with its source or "estimate". The numbers are from `test/concept-coupling.test.js`
(and the RB22 anchor): A and B one at a time, AB together, int = AB − A − B.

| Interaction | Model | Source / status | Example (int) |
|---|---|---|---|
| Front vs rear wing × weight distribution | the sim limits cornering by the weaker axle: `min(ay_front, ay_rear)` with axle loads from CLA per axle and `weight_dist_front`; the design sets both | sim (SIM.md §3) | front wing +2° (−0.074 s) and rear wing +2° (+0.178 s) together: −0.188 s, int −0.29 s |
| Wheelbase × aero balance (lever rule) | front share of each component = (WB − x_cop)/WB: front wing (XF −860) 1 + 860/WB, rear wing (XR +400) −400/WB, floor 0.3213 and body 0.3125 fixed fractions | lever rule (statics); CoP positions from the RV-FW/RW-PROFILES X ranges (App. C2 §22, §30); floor/body fractions estimates set to keep 43.5 % | balance shift of a +2° front wing: +0.0170 at WB 3100 vs +0.0160 at 3400 |
| Wheelbase × mass distribution × ballast position (CoG) | every part has an x tied to XF, XA, XC, XPU or XR; ballast at x_frac·WB; wdf = x_cog/WB; the gearbox spacer fills WB − packaging minimum | mass sheet (MASS.md) | wdf shift of ballast 0.05 → 0.9: −0.0002 with 0.2 kg, −0.0111 with 10.2 kg (int −0.0109) |
| Floor width × throat × ride height × diffuser expansion | df_floor = planform × G^β × S(stall) × D(e, gap) × U; G = (35 + c₀)/(rh + 0.5278·throat), c₀ = 31.67 mm; stall onset 58 + 0.5·(e − 14) mm at the dynamic gap; D peaks at 18° + 0.1·(gap − gap₀) | ground-effect form (lab calibration); diffuser–gap coupling direction from Senior & Zhang 2001 (Exp. Fluids 31) and Ruhrmann & Zhang 2003 (J. Fluids Eng. 125); 0.1°/mm, 0.5 mm/° estimates; β = 0.920 from the lab slope | throat −10 × ride height −3: int −0.0026 df; width +90 × ride height −3: +0.0011; diffuser +3° × ride height −3: −0.0023; stall onset +1.5 mm at 17° |
| Ride height × front wing (ground effect) × balance | front wing load × ((h₀/c₀)/(h/c))^0.25, h = rh + 10 + 85 mm | trend of Zerihan & Zhang 2000 (J. Aircraft 37(6)); exponent and the 85 mm (mean Z of the RV-FW-PROFILES lower edge, App. C2 §22.1) are estimates | ride height +10 mm: front wing load × 0.982; with front chord +60: balance int +0.0009 |
| Ride height × plank | plank wear 0.25 mm per mm below 32 mm (REG-C-PLANK); sprung mass (only) rises with ride height; floor stall at the dynamic height | concept plank model (CONCEPT.md); C3.6.1 | 28 mm: 1 mm of wear; +10 mm: CoG +8.6 mm (unsprung stays) |
| Sidepod inlet × undercut × cooling × drag | capacity = inlet/650 × (1 − (undercut − 140)/300); PU derate below 1.05 × need; cooling drag ∝ inlet; radiator mass ∝ inlet^0.8 | concept thermal model (estimates) | inlet 590 alone and undercut 160 alone: no derate (−0.090 s, −0.131 s); together: ICE −72.6 kW (int −53 kW), lap +0.417 s |
| Rear wing span × endplate × Straight Mode flap | induced drag ∝ (cl·S)²·(b₀/b)² / e, e = 1 + 1.9·h/b (Hoerner form); flap share × min(1, 535/half-span) | Hoerner & Borst, Fluid-Dynamic Lift (form; k 1.9); C3.11.6(a)(ii) (Y 535); z_ref 725 from App. C2 §30.1 | endplate 860 → 880 saves more drag on a 1000 mm wing than on a 1150 mm one |
| Material × mass × ballast × CoG × axle split | a lighter part frees ballast (the car stays at the C4.1 minimum), the ballast is low (Z 30) and placed by x_frac | concept materials v1 (MATERIALS.md) | T1100G wings, floor and bodywork: −3.6 kg of parts → +3.6 kg of ballast, CoG −1.3 mm; with the ballast at the front (x_frac 0.05) the axle split moves forward and the lap is +0.033 s; at x_frac 0.7: −0.039 s, legal |
| Material stiffness × aero | wing wash-out: effective setting + 0.5°·(1 − 1/S); floor flex: dynamic compression + 1 mm·(1/S − 1) | estimates (MATERIALS.md §3) | glass-fibre rear wing (S 0.48): −0.54°, rear-wing load −3.6 %; glass floor: stall margin −0.66 mm |

## 4. What was broken and is fixed

1. **Mass staircase.** `physical()` took its deltas from the rounded mass sheet: front share to 1e-4, CoG height to 1 mm. On this
   sim 1e-4 of front share is ≈ 0.002 s and 1 mm of CoG ≈ 0.015 s, so a 1-4 mm packaging move did nothing and the next millimetre
   jumped (cockpit 1927 → 1928 mm: 88.758 → 88.749 s, nothing in between). `parts.massSheet()` now also returns `exact` (unrounded)
   values and `physical()` uses them; the displayed CoG is rounded to 0.01 mm.
2. **Fixed axle shares.** The front wing put 100 % of its load on the front axle and the rear wing 0 %, whatever the wheelbase.
   With the wings ahead of / behind the axles the lever rule gives 125.3 % and −11.8 % at WB 3400, and the split now follows WB.
3. **Ride height only moved the floor.** The front wing now feels the ground, so ride height moves the balance as well as the
   level; the floor's share of the slope was reduced (β) so the total stays at the lab's −0.006/mm.
4. **Diffuser independent of the floor gap.** Its best angle and its stall onset now depend on the gap.
5. **Endplate independent of span.** Now the Hoerner form.
6. **No materials.** Every part either takes an optional `params.material` or says which regulation fixes its material
   (`materials.FIXED`); a material named on such a part is an error in `design.validate` and in `parts.massSheet`, never ignored.

## 5. PhysicalCar fields added (contract for the sim helper)

All additive; the current sim ignores them and every existing field keeps its meaning. The bench's physics cache key
(`concept/bench.js simKey`) holds only the fields the sim reads today: **if the sim starts reading any field below, add it to
`simKey`**, or two designs that differ only there will share a cached lap.

| Field | Unit | Meaning | Anchored? |
|---|---|---|---|
| `yaw_inertia_kgm2` | kg·m² | Izz about the CoG from the part point masses (no part's own inertia: a lower bound) | no (absolute, mass sheet) |
| `cog_x_m` | m | CoG behind the front axle (the axle split the sim reads is `weight_dist_front`) | no |
| `unsprung_kg: { front, rear }` | kg | wheels + brakes + 40 % of each suspension group (estimate) | no |
| `sprung_cog_height_m` | m | sprung-mass CoG above the ground, in the same anchored frame as `cog_height_m` | yes (anchor + change) |
| `aero.balance_corner` | — | front share of corner CLA (= CLA_front / total) | yes |
| `aero.front_wing_ground_effect` | — | the front wing's ground-effect factor (1 at the baseline ride height and chord) | — |
| `aero.material_flex` | deg, mm | material wash-out of each wing and extra floor flex (0 for baseline materials) | — |
| `materials` | — | non-baseline materials: `{ part: { material, base, mass_factor, stiffness_ratio, strength_ratio, bound } }` | — |

Already there and still unread by the sim: `wheelbase_m` (longitudinal load transfer needs it with `cog_height_m`),
`aero.ride_height_mm`, `aero.ride_sens_per_mm`, `aero.stall_margin_mm`.

## 6. Open points (not changed here)

- **Straight Mode flap past the reference angle** (front 4°, rear 15°): `φ = min(1, angle/reference)` caps the anchor's
  unexplained Straight Mode relief at the reference, so opening further gains only the concept map's own flap relief (6-13× less
  per degree than closing costs). A smooth, saturating φ would need to know where in its range the real car's flap sat; this is a
  calibration decision, so it is documented, tested as monotonic, and left as is.
- **The sim's axle-balance kink.** The sim takes the weaker axle's lateral limit with no setup trim, so a ±0.01 change in aero
  balance or weight split is worth 0.14-0.24 s and the RB22 anchor (aero balance 0.439, weight 0.45) sits close to the kink: most
  rear-wing changes are slower in both directions. That is consistent physics for an untrimmed car, but stronger than a team that
  re-balances with springs and bars would see. For the sim helper.
- **Floor stall counted twice.** The aero map already rolls the floor load off below the stall onset; the sim also halves every
  CLA when `aero.floor_stalled` is true. Only stalled (illegal, PKG-FLOOR-STALL) designs are affected.
- **Rear mass helps this car.** Because the anchor is front-limited at 0.45 (C4.2 allows 0.44), mass added behind the CoG (a
  heavier rear impact structure, for example) can be lap-neutral or slightly faster. Consistent with the sim, not a bug.
- **Browser:** pages that load `concept/parts.js` (concept/lab, concept/view, concept/tools/film.js) should load
  `concept/materials.js` before it; without it a design that names a material throws (clear message) and others work as before.
  `concept/view/view3d.js` interpolates every key in `params[part]`; a string `material` would need skipping there.

## FIA pass and sim v3 (2026-10-24)

- **Floor throat re-parameterised (C3.5.1(a)).** `floor.throat_mm` is the venturi roof's height above Z=0, which the RV-FLOOR-BODY
  roof caps at Z=75 between XF=1775 and XR=−600. The v1 domain 80–130 mm "above Z=0" lay entirely above that roof. v2: domain
  40–75 mm, base 60, `aeromap.js FLOOR.throat_k` = 0.3167 / 0.6, so c = throat_k · throat (and every aero number) is unchanged
  for a v1 design moved to throat × 0.6 (100 → 60, 80 → 48, 90 → 54, 105 → 63). `design.migrate(d)` does that mapping for designs
  written in v1 units (any throat above 75 mm); v1 values above 125 mm map past the roof and are clamped to 75 mm (a real change:
  that floor was never legal). `REG-C-FLOOR-ROOF` is now checked (`kind: "max"`). The sensitivity rows above keep their v1-unit
  numbers; the effect per v2 step of 6 mm equals the v1 step of 10 mm.
- **Track widths (C10.10.1).** The anchor cars (concept/sim) use 1.540 / 1.470 m, the widest legal; `physical.js` REF_V0 the
  same; the mass sheet places the wheel centres at |y| 770 / 735 mm (was 790 / 760) and every part row now carries `y_mm`, so
  `REG-C-SUSP-WIDTH` checks them. The mass sheet's yaw inertia drops by the wheels' lateral move (≈ −3 kg·m² of ~1060).
- **The anchor moved (sim v3, docs/concept/SIM.md §0).** physical(baseline) still maps exactly onto the anchor car, which now
  laps 88.107 s (generic; v2 88.115) and 88.763 s (RB22; v2 88.752). The anchor's CLA (5.32 m²), CdA (1.18 / 0.95 m²), tyres
  (power-law load sensitivity, slip angle 0.098 rad) changed, so absolute lap deltas per design change are on the v3 scale;
  directions are unchanged (the sensitivity test passes as before). `PhysicalCar.tyres.slip_angle_rad` (new) is copied from
  the anchor.

