# FIA 2026 legality checklist for the concept car

Every regulation that constrains something the concept optimiser can vary, or a number the scorer relies on, with how
`concept/regs.js` checks it and which test covers it. Built 2026-10-24 (FIA checklist pass).

**Source (primary).** FIA, *2026 Formula 1 Regulations, Section C [Technical]*, **Issue 19**, published 25/06/2026 (WMSC approval
23/06/2026), the issue in force at the British GP (3-5 July 2026):
<https://www.fia.com/system/files/documents/fia_2026_f1_regulations_-_section_c_technical_-_iss_19_-_2026-06-25.pdf>
(fetched 2026-10-24, 257 pages, sha256 `8751d3d47870675336d87e449a1a87d7d51a17ead4f430f280cabded9b52ad0a`, text read with
pdftotext). Every article cited below was read in that file; page numbers are the PDF's `C<n>` footers. **Issue 21** (19/10/2026,
<https://www.fia.com/system/files/documents/fia_2026_f1_regulations_-_section_c_technical_-_iss_21_-_2026-10-19.pdf>, sha256
`698d14b6…dbef2ff`) was compared article by article for everything checked here: identical, except C5.2.10(ii) (qualifying recharge
floor 5 → 4 MJ) and C5.2.8(iii) (adds "during any power limited period"), neither of which the concept checks.
Rows marked **secondary** use a non-FIA source, named in the row.

**Status legend.** **checked**: a check in `regs.js` fails every design that breaks the rule, with a test. **checked (when
assigned)**: the check runs whenever a design assigns the input (materials). **partially**: part of the rule is checked, or the
check rests on a stated concept-model assumption. **not checked**: the concept can vary it but no check exists (reason given).
**fixed**: the concept cannot vary it (a catalogue constant), so there is nothing to check per design. **not applicable**: the rule
governs something the concept does not represent.

**Tests.** `concept.test` = test/concept.test.js "concept regs: check() catches every checkable violation type"; `guards N` =
test/concept-guards.test.js "guard N"; `checklist: …` = test/concept-regs-checklist.test.js (new). The checklist **oracle** test
re-implements every checked numeric limit from the numbers in this file (not from regs.js) and compares verdicts on ~1,500 designs per
run (2 seeds × ~720: random, mutated chains, every parameter at both domain ends, 120 random corners, all-min, all-max, regulation
edges); it fails if a single check drifts by a few mm (tried: +3 mm on the front-wing Z limit, +10 mm on the floor-body width cap).

## Summary

| | rows | checked | checked (when assigned) | partially | not checked | fixed / not applicable |
|---|---|---|---|---|---|---|
| A. Dimensions and layout (C2) | 8 | 6 | | | | 2 |
| B. Front wing and its Straight Mode (C3.10) | 10 | 5 | | 2 | | 3 |
| C. Rear wing and its Straight Mode (C3.11) | 12 | 6 | | 2 | | 4 |
| D. Floor, diffuser, plank (C3.5, C3.6) | 8 | 2 | 2 | 1 | 2 | 1 |
| E. Sidepods, bodywork, cooling (C3.8, C3.16, C7.4) | 4 | 1 | | 1 | 1 | 1 |
| F. Mass and ballast (C4) | 8 | 4 | | 2 | 1 | 1 |
| G. PU masses and CoG (C5.3-C5.5, C5.17-C5.18, C9.5) | 9 | 6 | | 1 | | 2 |
| H. PU energy and ERS (C5.2) | 8 | 4 | | 1 | | 3 |
| I. Wheels, tyres, suspension, brakes (C10, C11) | 7 | | 3 | 1 | | 3 |
| J. Survival cell, crash structures, halo (C12, C13, C15.5) | 4 | | 2 | | | 2 |
| K. Materials (C15, general) | 11 | 6 | 2 | 2 | | 1 |
| L. Concept-model rules (not regulation text) | 5 | 5 | | | | |
| M. Gearing, suspension set-up, brake balance (C9, C10.2-C10.4, C11.1; more-factors v1) | 9 | 2 | | | | 7 |
| **Total** | **103** | **47** | **9** | **13** | **4** | **30** |

Gaps found in this pass and closed in `regs.js` (each with a test): 14 (listed under "Gaps fixed"). Fixes requested in files this
checklist does not own: 7 (listed under "Fixes requested"); two are regulation conflicts, kept visible as `todo` tests.

> **Update 2026-10-24 (integrator, after `claude/sim-v3-fia`):** all 7 requested fixes are applied and both `todo` tests are now
> ordinary passing tests. C3.5.1(a): `floor.throat_mm` is 40–75 mm above Z=0 (new = 0.6 × old; `design.migrate`) and
> `REG-C-FLOOR-ROOF` is enforced (row D moves from "not checked" to "checked"). C10.10.1: tracks 1.540 / 1.470 m everywhere, the mass
> sheet's wheel rows carry `y_mm`, `REG-C-SUSP-WIDTH` runs in the bench (`PHYSICAL_SKIP = []`). C15.5.1(f): the survival cell needs a
> CC-UHS fibre (Ftu > 6250 MPa), so T800S is rejected there and T1100G passes. Materials table corrected (WE43C, KC60 only, CC-UHS is
> woven, tungsten's PU exclusion is C15.6.1(g)); the front wing takes laminates only (PL-ANTISPLINTER endplates); `design.mutate`
> draws only materials legal for the part. The per-section counts above are from the first pass and are not re-tallied.

## A. Dimensions and layout (C2)

| Article | Rule | Touches | Check (regs.js) | Test | Status |
|---|---|---|---|---|---|
| C2.3.1 (C11) | No part except tyres, rims and rim-attached parts more than 950 mm from Y=0 | `floor.width_mm`, `front_wing.span_mm`, `rear_wing.span_mm` (half-width = max of the three / 2) | `REG-C-WIDTH`, checkFacts l.461 | concept.test, oracle | checked |
| C2.3.2 (C11-12) | Nothing below the floor reference volumes except the Plank Assembly | (no parameter: the floor is the lowest body) | — | — | fixed |
| C2.3.3 (C12) | Wheelbase XF=0 → XR=0 ≤ 3400 mm | `layout.wheelbase_mm` | `REG-C-WB`, l.462 | concept.test, oracle | checked |
| C2.3.4 (C12) | XF=0 between XA=0 and XA=150 | `survival_cell.front_axle_offset_mm` | `REG-C-FRONT-AXLE`, l.463 | concept.test, oracle | checked |
| C2.3.5 (C12) | XA=0 → XC=0 between 1830 and 2030 mm | `survival_cell.cockpit_len_mm` | `REG-C-COCKPIT`, l.464 | concept.test, oracle | checked |
| C2.3.6 (C12) | XC=0 → XPU=0 ≥ 360 mm | `survival_cell.bulkhead_gap_mm` | `REG-C-BULKHEAD`, l.465 | concept.test, oracle | checked |
| C2.5 (C12) | Stated values are the limits regardless of decimals | every limit | inclusive comparisons with 1e-9 slack (`over` / `under`, l.457) | checklist: "every regulation edge is inclusive" | checked |
| C3.3.1(a) (C15) | Design to a reference-volume edge only where required or not relied upon | — | — (CAD-process rule; the concept treats limits as inclusive per C2.5) | — | not applicable |

## B. Front wing (C3.10)

| Article | Rule | Touches | Check | Test | Status |
|---|---|---|---|---|---|
| C3.10.1(a), App. C2 §22.1 (C31, C219) | Profiles inside RV-FW-PROFILES, whose section reaches Y=675: span ≤ 1350 mm | `front_wing.span_mm` | `REG-C-FW-SPAN`, l.468 | concept.test, oracle | checked |
| C3.10.1(a), App. C2 §21.1, §22.2-22.4 | RV-FW-PROFILES spans XF −1250 → −475, trimmed by two vertical planes: X extent 500 mm at Y=0, 647.5 at Y=440, 559.4 at Y=675 | `front_wing.chord_mm` × `span_mm` | `REG-C-FW-CHORD`: mean chord ≤ mean trimmed X extent over \|Y\| ≤ span/2 (`fwChordLimit`, l.51; check l.470) | guards 7, concept.test, oracle | checked |
| **C3.10.1(a), App. C2 §22.1** | The same volume in **Z**: section [0,60] [100,60] [675,115] [675,275] [400,300] [0,200], i.e. 140 mm tall at Y=0, 211 mm at Y=400, 160 mm at Y=675 | **combination**: `chord_mm` × `aoa_deg` × `elements` × `span_mm` | **new** `REG-C-FW-PROFILES-Z`: per \|Y\| the chord must fit min(X extent, Z height / ((n−1)/n · tan setting)); mean chord ≤ that minimum's span-mean (`fwProfilesChordLimit` l.91, exact piecewise-linear mean `meanMin` l.81; check l.507). Model: the forwardmost volume flat, the flaps straight at the setting, the same model `REG-C-FW-SM-ENVELOPE` already used. Baseline (1300 × 580 mm, 25°, 3 volumes) limit 580.05 mm: legal; +0.5° needs ≤ 571 mm | checklist: "combinations", oracle | partially (model-dependent geometry) |
| C3.10.1(b), (d) | Up to three non-intersecting volumes; profiles must obscure RS-FW-PROFILES from above, so at least one | `front_wing.elements` (domain 1-4) | `REG-C-FW-ELEMENTS` (≤ 3, l.467); **new** `REG-C-ELEMENTS-MIN` (integer ≥ 1, l.504) | concept.test, checklist: "combinations", oracle | checked |
| C3.10.1(c), (e)-(l) | ≤ 3 sections per Y-plane, trailing-edge visibility and slope, curvature, 5-15 mm slot gaps (k), 30° normal limit | (shape detail, no parameter) | — | — | not applicable |
| C3.10.2-C3.10.9, App. C2 §23-27 | Endplate, footplates, diveplane, pylon, strake volumes (endplate within Y 560-900) | (fixed 2.0 kg endplates in the mass model) | — | — | fixed |
| C3.10.10(a)(i), (b)(i) | FW Primary Flap excludes the forwardmost volume; Secondary Flap only in the rearmost: a straight-mode wing needs ≥ 2 volumes | `elements` × `sm_delta_deg` | `REG-C-FW-FLAP`, l.476 | concept.test, oracle | checked |
| C3.10.10(n)(ii) | Straight Mode = a DECREASE in incidence of a constant magnitude (two fixed positions) | `front_wing.sm_delta_deg` (one value per wing, so constant by construction) | **new** `REG-C-SM-DIRECTION` (≥ 0, l.503); before this pass a negative delta was silently "no straight mode" | checklist: "combinations", oracle | checked |
| C3.10.10(s)(i), (u) | Flaps stay inside RV-FW-PROFILES in every position; physical stops | `chord_mm` × `aoa_deg` × `sm_delta_deg` × `elements` × `span_mm` | `REG-C-FW-SM-ENVELOPE`: straight-mode X extent chord·(1−s) + chord·s·cos(θ−δ)/cos θ ≤ the trimmed envelope (`fwStraightExtent` l.61, check l.471); flattening only lowers Z, so Z is covered by the Corner-Mode row | guards 7, concept.test, oracle | partially (model-dependent geometry) |
| C3.10.10(o), (p), (t)-(w) | ≤ 400 ms between modes; ≤ 2 actuators; failure returns to Corner Mode; deployed only fully inside an Activation Zone (B7.1.1(d), Section B Issue 07) | (no parameter) | info `REG-C-AERO-MODES`; the physics sim applies Straight Mode only inside FIA zones and after the 400 ms switch (concept/sim/lapsim.js l.269-272); sim v0 charges straight-mode downforce on the zones (bench.js) | guards 10 | fixed |

## C. Rear wing (C3.11)

| Article | Rule | Touches | Check | Test | Status |
|---|---|---|---|---|---|
| C3.11.1(a), App. C2 §30.1 (C38, C220) | RV-RW-PROFILES reaches Y=575: span ≤ 1150 mm | `rear_wing.span_mm` | `REG-C-RW-SPAN`, l.473 | concept.test, oracle | checked |
| C3.11.1(a), App. C2 §30.1-30.2 | X from XR=165 to XR=630 at every Y: 465 mm | `rear_wing.chord_mm` | `REG-C-RW-CHORD`, l.474 | concept.test, oracle | checked |
| C3.11.1(a), (d), App. C2 §30.2 | Z from 725 (\|Y\| ≤ 150) rising to 785 at Y=575, top 880: 155 mm tall inboard, 95 mm at the tip; forwardmost section's trailing edge within 10° of X | **combination**: `chord_mm` × `aoa_deg` × `elements` × `span_mm` | `REG-C-RW-PROFILES-Z` computed (`rwProfilesChordLimit` l.97) but **info, not enforced**: the aero map gives the rear setting a 5° zero-lift offset (aeromap.js `WING.rear_wing.a_zl`), so it is not a geometric angle, and the fixed (n−1)/n flap share would rule out most settings above ≈ 25° (e.g. 35°, 2 volumes: 384 mm limit vs the 420 mm baseline chord). Needs a rear-setting geometry from the aero-map owner | checklist: "combinations" | partially |
| C3.11.1(b), C3.11.6(a)(i), C3.11.7(b) | Up to three volumes. 3-5 pairs of Rear Wing Separators MUST be fitted, each joining the forwardmost volume to the RW Flap, and the RW Flap excludes the forwardmost volume: **at least two volumes**, Straight Mode or not | `rear_wing.elements` (domain 1-4) | `REG-C-RW-ELEMENTS` (≤ 3, l.472); **new** `REG-C-ELEMENTS-MIN` (integer ≥ 2, l.504). A one-volume rear wing without Straight Mode was legal before this pass | concept.test, checklist: "combinations", oracle | checked |
| C3.11.1(c), (e)-(g) | Sections per plane, curvature, 20° normal limit, 8-12 mm gaps | (shape detail) | — | — | not applicable |
| C3.11.2(a), App. C2 §31.1 | Endplate Body within RV-RWEP-BODY, top at Z=880 | `rear_wing.endplate_top_mm` | `REG-C-RW-ENDPLATE`, l.475 | concept.test, oracle | checked |
| C3.11.2(c) | Endplate must obscure RS-RWEP from the side (a minimum endplate) | `endplate_top_mm` (lower side) | — RS-RWEP is not defined in the Section C text (CAD only), so no minimum can be checked | — | partially (max side only) |
| C3.11.6(a)(i) | Straight Mode moves the RW Flap, which excludes the forwardmost volume | `elements` × `sm_delta_deg` | `REG-C-RW-FLAP`, l.477 (now implied by the ≥ 2 row) | concept.test, oracle | checked |
| C3.11.6(a)(ii)-(iii) | RW Flap excludes volumes outboard of Y=535, includes all inboard of Y=530 | `rear_wing.span_mm` × `sm_delta_deg` | modelled, not a legality test: aeromap.js `flapShare` (the tips stay in Corner Mode); info `REG-C-RW-FLAP-SPAN` | guards 10 | fixed |
| C3.11.6(c)(ii), (h) | Straight Mode lowers RW Flap incidence by an always-identical amount; only two positions | `rear_wing.sm_delta_deg` | **new** `REG-C-SM-DIRECTION`, l.503 | checklist: "combinations", oracle | checked |
| C3.11.6(g)(ii), (k) | In Straight Mode the flap is exempt from C3.11.1 (it may leave RV-RW-PROFILES), physical stops required | `sm_delta_deg` | — (no envelope applies; the domain cap of 30° is a model bound, not a rule) | — | not applicable |
| C3.4.1, C3.11 | No beam wing: only the bodywork of C3.5-C3.13 is permitted and C3.11 defines none | (no part) | the catalogue has no beam-wing part and the aero map none (concept/parts.js, aeromap.js `DF_SHARE`) | — | fixed |

## D. Floor, diffuser, plank (C3.5, C3.6)

| Article | Rule | Touches | Check | Test | Status |
|---|---|---|---|---|---|
| C3.5.1(a), App. C2 §4.9 (C18, C207) | Floor Body inside RV-FLOOR-BODY, whose plan reaches Y=770 (at XF=1100): floor body ≤ 1540 mm wide | `floor.width_mm` | `REG-C-FLOOR-WIDTH`, l.466 | guards 4, concept.test, oracle | checked |
| **C3.5.1(a), App. C2 §4.5-4.7, §4.11-4.13** | The RV-FLOOR-BODY roof is Z=75 from XF=1775 (XF=1450 for the §4.1 part) to XR=−600 at every Y, rising to 175 at XR−350 and 250 at XR+300: no floor channel can be more than 75 mm above Z=0 in the mid-floor | `floor.throat_mm` ("Venturi throat height above Z=0", domain 80-130, base 100) | info `REG-C-FLOOR-ROOF` (`FLOOR_ROOF_Z` l.118). **Not enforced: the whole domain, the baseline included, lies above the roof under the parameter's own label**; enforcing it would make every design illegal. Fix requested (see below) | checklist: todo "the floor throat parameter fits the RV-FLOOR-BODY roof" | not checked (conflict) |
| C3.5.1(b), App. C2 §2 (RV-DIFF, CAD part FIA-LEG-0137) | Floor Body must obscure RV-DIFF from below; the roof profile allows a 21.8° rise over XR−600 → XR−350 (75 → 175 mm) and 6.6° behind | `diffuser.expansion_deg` (8-22°) | — no article limits an expansion angle; RV-DIFF is CAD-only, and whether a ramp fits depends on its start height (the throat, above) | — | not checked |
| C3.5.2-C3.5.14, App. C2 §5-10 | Foot, sidewall, board, bib, leading-edge device, winglet, fence, corner, stays | (no parameter) | — | — | not applicable |
| C3.6.1(c) (C24) | Plank holes at XF=500, XC−800…XC−600 and XPU+470…XPU+630, the rearmost on or ahead of XR=−500: **XR − XPU ≥ 970 mm** | **combination**: `wheelbase_mm` × `front_axle_offset_mm` × `cockpit_len_mm` × `bulkhead_gap_mm` | **new** `REG-C-PLANK-HOLES`, l.508 (the packaging model's 1140 mm minimum also implies it, but that is an estimate) | checklist: "combinations", oracle | checked |
| C3.6.1(d) | Plank 10 ± 0.2 mm new, ≥ 8 mm worn (2 mm wear) | `floor.ride_height_mm` | `REG-C-PLANK` against the concept wear estimate (0.25 mm per mm below 32 mm static ride height: parts.js `PLANK`, a model assumption), l.478. Section C has no minimum ride height of its own | concept.test, oracle | partially |
| C3.6.2(a) | Plank homogeneous, specific gravity 1.30-1.45 | plank material | `REG-C-MAT-COMPONENT` when a material is assigned to part `plank` (materialViolations l.359); parts.js models the plank inside `floor` at the regulation geometry | checklist: "materials" | checked (when assigned) |
| C3.6.3(d) | Metallic skids Ti6Al4V (AMS4928/4911) or 17-4PH | skid material | `REG-C-MAT-COMPONENT` for part `skids` | checklist: "materials" (grade list) | checked (when assigned) |

## E. Sidepods, bodywork, cooling (C3.8, C3.16, C7.4)

| Article | Rule | Touches | Check | Test | Status |
|---|---|---|---|---|---|
| C3.16.9 (C51) | Sidepod Inlet aperture ≤ 80,000 mm² per side, above Z=275 | `sidepods.inlet_cm2` (both sides, domain 300-1100) | **new** `REG-C-SIDEPOD-INLET` ≤ 1600 cm², l.510 (reads `facts.params`; `check()` attaches it, bench needs design.js to pass it, see fixes) | checklist: "combinations", oracle | checked |
| C3.8.1, App. C2 §16 | Sidepod inside RV-SIDEPOD (XF 900-1300, Y ≤ 715, Z 125-600), > 50 mm from the Floor Board | `sidepods.undercut_mm` | — the undercut depth has no geometry to compare (RV-EC continues behind XF=1300 down to Z=50) | — | not checked |
| C7.4.1(a)-(d) (C91) | Primary heat-exchanger cores and header tanks aluminium alloy, not additive manufactured, tube wall ≥ 0.18 mm | cooling material | `REG-C-MAT-COMPONENT` for part `cooling`; tube geometry not modelled | checklist: "materials" | partially |
| C3.8.2, C3.16.10-12 | Engine cover volume RV-EC, louvre and cockpit apertures | (no parameter) | — | — | not applicable |

The cooling capacity itself is the concept-model rule `PKG-COOLING` (section L).

## F. Mass and ballast (C4)

| Article | Rule | Touches | Check | Test | Status |
|---|---|---|---|---|---|
| C4.1 (C60) | Minimum Mass 726 kg + Nominal Tyre Mass in Qualifying / Sprint Qualifying, 724 kg + NTM otherwise; Car Mass includes the driver, excludes fuel | every part mass, `ballast.extra_kg` (auto ballast tops up to the minimum) | `REG-C-MASS-MIN`, l.479; `minMass(session)` l.197 | guards 2, concept.test, oracle | checked |
| C4.7 (C61) | Nominal Tyre Mass published by the tyre supplier | NTM | 44 kg **estimate** (**secondary**: 768 kg press minimum − 724 kg; RacingNews365 2 Apr 2026, FIA/F1 2024 announcements), `NOMINAL_TYRE_MASS` flagged `verified: false` | concept.test | partially (secondary) |
| C4.2 (C60) | Qualifying and Sprint Qualifying only: front axle ≥ 0.44 × Minimum Mass, rear ≥ 0.54 × | **combination**: `ballast.x_frac` × `extra_kg` × every position (survival cell, wheelbase, PU) | `REG-C-MASS-FRONT` / `-REAR`, l.481-482 | guards 2, concept.test, oracle | checked |
| C4.5.2 (C61) | Reference driver mass + driver ballast ≥ 82 kg | driver (75 kg estimate) + auto driver ballast | `REG-C-DRIVER-MASS`, l.484 | concept.test, oracle | checked |
| C4.3.1-C4.3.2 (C60) | Ballast fixed to the sprung mass; driver ballast within the cockpit-entry-template X range, on the survival cell, density > 7500 kg/m³ | ballast position (`x_frac` 0-1 × WB: always between XF=0 and XR), driver ballast at XC−750 | positions by construction (info `REG-C-BALLAST`); density `REG-C-MAT-DENSITY` when a material is assigned (l.394) | checklist: "materials" | partially |
| C4.3.3 | Ballast ahead of XA=0 must be present in the front impact test | ballast position | never ahead of XF=0 > XA=0 | — | not applicable |
| C4.6 (C61) | Heat Hazard: Minimum Mass + 5 kg | session conditions | info `REG-C-HEAT-HAZARD`: no Heat Hazard in the modelled Silverstone sessions (qualifying air 25.2 °C, lapsim DEFAULT_CONDITIONS) | — | not checked |
| — | Mass-sheet sanity: every part mass finite and ≥ 0, every part inside the car (XF −1300 … XR + 800, ground … Z=1000) | `design.overrides` | **new** model rule `PKG-PART-MASS`, l.516; NaN-safe comparisons everywhere (a NaN override passed every mass rule before) | checklist: "robustness", oracle | checked |

## G. PU masses and CoG (C5.3-C5.5, C5.17-C5.18, C9.5)

| Article | Rule | Touches | Check | Test | Status |
|---|---|---|---|---|---|
| C5.5.1 + C5.18.7 (C71, C79) | ICE PU Mass group (ICE + TC + Powerbox) and MGU-K minima paired by the MGU-K transmission option: 130/20, 134/16, 132/18 kg | `pu_ice`, `pu_turbo`, `pu_mguk` masses (overrides), option fixed "a" | `REG-C-ICE-MASS`, `REG-C-MGUK-MASS`, l.490 | guards 1, concept.test, oracle | checked |
| C5.5.2 | Overall PU ≥ 185 kg | PU masses | `REG-C-PU-MASS`, l.485 | concept.test, oracle | checked |
| C5.3.4 | Turbocharger ≥ 12 kg | `pu_turbo` | `REG-C-TC-MASS`, l.495 | concept.test, oracle | checked |
| C5.17.9 | ES Main Enclosure group ≥ 35 kg | `pu_es` | `REG-C-ES-MASS`, l.496 | concept.test, oracle | checked |
| C5.5.3 | PU (ICE + TC groups) CoG above Z=200 | `pu_ice`, `pu_turbo` z (overrides) | `REG-C-PU-COG`, l.497 | concept.test, oracle | checked |
| C9.5.2 | Driveline + gear change ≥ 22 kg | `gearbox` | `REG-C-DRIVELINE-MASS`, l.498 | concept.test, oracle | checked |
| C9.5.1 | Final drive within XR ±60 mm, 390-450 mm behind the first gear pair | wheelbase vs PU and gearbox length | model rule `PKG-WB` (ICE 620 + gearbox 520 mm, estimates ≥ the 390 mm the article implies) | concept.test, oracle | partially |
| C5.4.5 | Crankshaft axis at Z=90 | PU z positions | parts.js estimates (ICE CoG 140 mm above the axis) | — | fixed |
| C5.5.8 | ICE ballast ≤ 2 kg, density > 7500 kg/m³ | (no ICE ballast in the model) | — | — | not applicable |

## H. PU energy and ERS (C5.2), the figures the lap sims use

| Article | Rule | Touches | Check | Test | Status |
|---|---|---|---|---|---|
| C5.2.7 (C63) | ERS-K DC power ≤ 350 kW | PhysicalCar `pu.mguk_kw` | `checkPU` l.417 (`REG-C-ERS-K`); the physics sim also clamps to `REGS.mguk_max_kw` | checklist: "PU and ERS figures" | checked |
| C5.2.8(i)-(ii) | ERS-K propulsion ≤ 1800 − 5v kW below 340 km/h, 6900 − 20v to 345, 0 above; Overtake 7100 − 20v to 355 | sim deployment | `mgukLimitKw` l.448; lapsim `mgukTaperKw` equal at every 0.5 km/h 0-360 | checklist: "PU and ERS figures" | checked |
| C5.2.8(iii) | 250 kW on FIA-specified race sectors | race model | — (the scored lap is a qualifying lap) | — | not applicable |
| C5.2.9 | ES state-of-charge window ≤ 4 MJ on track | `pu.es_soc_window_mj`, deploy ≤ window + recharge | `checkPU` (`REG-C-ES-SOC`); lapsim `REGS.es_soc_window_mj` | checklist: "PU and ERS figures" | checked |
| C5.2.10 | Recharge ≤ 8.5 MJ/lap (7 at some events, ≥ 5 MJ floor in Q/SQ; Issue 21: 4 MJ). Silverstone qualifying 6.5 MJ (**FIA 2026 British GP Power Unit Information, Doc 7 V02, 02/07/2026**) | `pu.es_harvest_mj_per_lap`, sim `recharge_limit_mj` | `checkPU` (`REG-C-ES-RECHARGE`, with the session limit); lapsim default 6.5 MJ | checklist: "PU and ERS figures" | checked |
| C5.2.3 | Fuel energy flow ≤ 3000 MJ/h (= 833.3 kW of fuel power) | PhysicalCar `pu.ice_kw` (400 kW, reported, estimate) | `checkPU` (`REG-C-FUEL-FLOW`: shaft power ≤ fuel power, a weak bound; efficiency is not in the rules) | checklist: "PU and ERS figures" | partially |
| C5.2.4, C5.2.11, C5.2.12 | Fuel flow below 10,500 rpm; MGU-K torque ≤ 500 Nm; MGU-K from 50 km/h at the start | (no rpm, torque or start model) | — | — | not applicable |
| C5.1 | 1.6 L V6, 90°, 4-stroke | PU | — | — | fixed |

`checkPhysical(pc)` (l.434) runs `checkPU` plus the C10.10.1 track check on any PhysicalCar. The bench does not call it yet (fix
requested); the checklist test runs it on 40 mutated designs and both baselines.

## I. Wheels, tyres, suspension, brakes (C10, C11)

| Article | Rule | Touches | Check | Test | Status |
|---|---|---|---|---|---|
| C10.7.1 (C113) | Wheel rims AZ70 or AZ80 magnesium alloy only | `wheels_front` / `wheels_rear` material | `REG-C-MAT-COMPONENT` (materialViolations) | checklist: "materials" | checked (when assigned) |
| C10.7.2 | Rim 462.5/463 mm diameter, mounting width 315 / 401.3 mm, overall 334 / 420.3 mm ref. | (catalogue wheels) | info `REG-C-RIMS` | — | fixed |
| C10.8.2 | Tyre specification by the supplier | tyre radius 353 mm (estimate) | — | — | fixed |
| C10.10.1, C2.1.3(a) (C117, C10) | Front Wheel Coordinate System origin (inboard rim plane) not outboard of Y=603, rear Y=525; with half the rim overall width that is a wheel centre plane ≤ 770 / 735 mm, track ≤ 1540 / 1470 mm | wheel positions, PhysicalCar tracks | **new** `REG-C-SUSP-WIDTH`: on mass-sheet wheel rows when they carry `y_mm` (l.512) and in `checkPhysical` on `track_front_m` / `track_rear_m`. **Conflict: the PhysicalCar uses 1.60 / 1.55 m tracks (lapsim baselineCar) and the mass sheet 790 / 760 mm wheel \|y\|, all outside the limit** | checklist: "combinations", "checkPhysical bites", todo "track widths fit" | partially (conflict) |
| C15.3.3 | Uprights: wrought 2014 / 2618 / 7075 / 7022 Al, C15.2.1(e) Ti, C15.2.1(h) MMC, C15.2.2 AM Al/Ti | upright material | `REG-C-MAT-COMPONENT` for part ids ending `upright(s)` (none in the catalogue today) | — (code path shared with the tested component checks) | checked (when assigned) |
| C11.2.2, C15.4(b)-(c) | Calipers aluminium (C15.2.1(b)); carbon-carbon and CMC allowed for friction materials | `brakes_*` material | brakes accept C15.2 materials plus carbon-carbon / CMC; the caliper-only aluminium rule cannot be separated from the disc in the one-part model | checklist: "materials" (C/C on brakes) | checked (when assigned) |
| C11.3.2-3 | Discs ≤ 34 mm thick, 325-345 mm front / 260-280 mm rear | (catalogue brakes) | — | — | fixed |

## J. Survival cell, crash structures, halo (C12, C13, C15.5)

| Article | Rule | Touches | Check | Test | Status |
|---|---|---|---|---|---|
| C15.5.3 (C161) | Survival-cell homologated laminates: CC-UHS carbon/epoxy skins, aluminium honeycomb core ≥ 6 mm, intrusion loads 325-440 kN | `survival_cell` material | `REG-C-MAT-COMPONENT` unless a carbon-fibre composite | checklist: "materials" | checked (when assigned) |
| C12.4.2 (C126) | Halo to FIA 8869-2018 from an FIA-designated manufacturer, front fixing at XC−975, Z=660 | `halo` material | `REG-C-MAT-COMPONENT` unless titanium Ti6Al4V (the grade is **secondary**: widely reported, not in Section C) | checklist: "materials" | checked (when assigned) |
| C12.2, App. C2 §13 | RV-CH-FRONT-MIN from XC−2030 to XC−875, trimmed at XA=0 | cockpit length (covered by C2.3.5) | — | — | fixed |
| C13 | Frontal, side, rear impact and roll-structure tests | (catalogue structures, mass estimates) | — | — | not applicable |

## K. Materials (C15, general rules)

The table is `concept/data/materials-2026.json` (merged at c3c55c0; browser copy in `concept/materials.js`): 23 entries
`{ id, name, class, form, density_kg_m3, E_GPa, tensile_MPa, fia: { article, status, note, verified: false }, sources }`, laminates
with `fibre: { name, E_GPa, tensile_MPa, density_kg_m3 }`, Al-Li alloys with `li_wt_pct: [min, max]`, AlBeMet with `be_wt_pct`.
regs.js reads it lazily (`concept/materials.js` MATERIALS, else the JSON), tolerantly (an array, `{ materials }`, `{ items }` or an
object keyed by id), and never trusts `fia.status`: every verdict is recomputed from the Issue 19 text (the test compares the two).
A design names a material as `params.<part>.material` on the 13 `parts.MATERIAL_PARTS`; the mass sheet lists every NAMED material
in `facts.mass.materials`, so the bench checks materials through `checkFacts` with no other wiring (`regs.check` also accepts
`design.materials`). Unnamed parts use the part's baseline material (`materials.baseOf`), all 13 of which pass (tested). C15.1.9
("the whole declared range" inside each limit) is applied to `li_wt_pct` / `be_wt_pct` by taking the range maximum. Without any
table nothing is checked unless a design names a material, which is then illegal (`REG-C-MAT-PERMITTED`, "no materials table
loaded"): an unknown material cannot be shown to be listed (C15.1.1). Optional fields that refine the classification: `grade`,
`uns`, `metallic`, `ag_pct`, `pgm_pct`, `mmc_vol_pct`, `precursor`, `matrix`, `additive`, `shape_memory`, `intermetallic`,
`nanomaterial`, `foil_metallurgy`, `commercially_available`.

| Article | Rule | Check | Test | Status |
|---|---|---|---|---|
| C15.1.4 (C156) | No metallic material with E/ρ > 40 GPa/(g/cm³) (beryllium 155, AlBeMet AM162 93, SupremEX 225XE 39.9: just legal, 40 % SiC/Al ≈ 51) | `REG-C-MAT-SPECIFIC-MODULUS` on every metallic material (l.367) | checklist: "materials" | checked |
| C15.1.1, C15.2 (C156-C159) | Outside the PU only the listed materials (below) | `REG-C-MAT-PERMITTED` (`c152`, l.315) | checklist: "materials", "materials (C15) on the real table" (M60J, Al-Li 2195, C/C on the floor rejected through the bench) | checked |
| C15.1.3 | Commercially available | `commercially_available: false` → `REG-C-MAT-PERMITTED` | — (field flag) | checked (when assigned) |
| C15.1.8 | PU materials FIA-approved | an unidentifiable material on a PU part → `REG-C-MAT-PU` | checklist: "materials" | partially (approval list not public) |
| C15.2.2 | AM metals list; finished part ≥ 60 % of the printed mass | AM grade lists when `additive: true`; the 60 % ratio is not modelled | — | partially |
| C15.2.3 | Matrices (epoxy, cyanate ester, BMI, phenolic, PU, polyester, thermoplastics); fibres: PAN carbon ≤ 550 GPa, ≤ 7100 MPa, ≤ 1.92 g/cm³; aramid, PBO, PE, PP, E/S/Q/BF glass, flax/hemp/linen/cotton/bamboo; cores | fibre grade table (manufacturer datasheets, **secondary**: T300-T1100, IM7/IM10, MR70, M40J-M60J, pitch fibres); a laminate stiffer than 330 GPa without a named fibre implies a fibre above 550 GPa (≤ 60 % fibre volume, assumption) | checklist: "materials" (M60J, pitch, stiff UD, basalt rejected; T800 accepted) | checked |
| C15.3.1-C15.3.2 (C159) | Forbidden: shape-memory (except piezo sensors), AM with beryllium, > 5 % Pt+Ru+Ir+Re+Au, foil metallurgy, intermetallics | `REG-C-MAT-PROHIBITED` (l.381) | checklist: "materials" (nitinol) | checked |
| C15.3.4 | Primary Roll Structure: no particulate-reinforced material | `REG-C-MAT-COMPONENT` for part ids `roll_hoop` / `roll_structure` | — | checked (when assigned) |
| C15.4 (C160) | Exceptions: ceramics for bearings etc., CMC and carbon-carbon for friction, electrical components, seals, fluids, tyres, coatings, paint, adhesives, insulation, regulated parts, FIA single-supply parts, Stellite on or above Z=0 | `electronics`, `fuel_system`, `seat_safety` exempt from C15.2; C/C and CMC accepted on `brakes_*`; Stellite 6/12 accepted | checklist: "materials" | checked |
| C15.6.1 (C162) | Inside the PU: no Mg alloys, MMCs (> 2 % v/v), intermetallics, > 5 % Pt/Ru/Ir/Re, Cu > 2.2 % Be, other alloys > 0.25 % Be, W-base alloys, ceramics/CMC, Al > 1 % Li or > 1 % Ag, nanomaterials, density > 18,400 kg/m³, unlisted composites | `REG-C-MAT-PU` for `pu_ice`, `pu_turbo`, `pu_mguk`, `pu_es`, `pu_electronics` | checklist: "materials" (AZ80, SupremEX, tungsten, Al-Li 2099, C/C rejected; steel, Ti64, CuBe 2 % accepted) | checked |
| C15.7-C15.9 | PU component-specific materials | (PU parts are fixed catalogue items) | — | fixed |

**Permitted materials by part class** (what the check accepts; Issue 19 articles):

| Part ids (concept/parts.js) | Accepted | Articles |
|---|---|---|
| `wheels_front`, `wheels_rear` (rims) | AZ70 or AZ80 magnesium only | C10.7.1 |
| `pu_ice`, `pu_turbo`, `pu_mguk`, `pu_es`, `pu_electronics` | steels, Al (Li ≤ 1 %, Ag ≤ 1 %), Ti, Ni/Co alloys, Cu (Be ≤ 2.2 %), C15.2.3 composites; never Mg, MMC, W, ceramics, Be > 0.25 %, > 18,400 kg/m³ | C15.6.1 (+ C15.1.4) |
| `survival_cell` | carbon-fibre composite (CC-UHS skins on aluminium honeycomb) | C15.5.3, C15.2.3 |
| `front_wing` (assembly incl. endplates) | polymer composite (endplate laminate PL-ANTISPLINTER) and C15.2 | C3.19.1, C15.5.2(b), C15.2 |
| `halo` | the FIA-designated titanium Ti6Al4V part | C12.4.2 (grade secondary) |
| `cooling` | aluminium alloy, not additive manufactured | C7.4.1(a)-(b) |
| `driver_ballast` | C15.2 material with density > 7500 kg/m³ (tungsten, steel, copper) | C4.3.2(d), C15.2 |
| `brakes_front`, `brakes_rear` | carbon-carbon or CMC (friction), C15.2 (calipers aluminium) | C15.4(b)-(c), C11.2.2 |
| `plank` (sub-part id, not in the catalogue) | specific gravity 1.30-1.45 | C3.6.2(a) |
| `skids` (sub-part id) | Ti6Al4V or 17-4PH | C3.6.3(d) |
| `*upright(s)` (sub-part id) | wrought 2014/2618/7075/7022 Al, C15.2.1(e) Ti, SupremEX, AM Al/Ti | C15.3.3 |
| `gear_pairs`, `gears`, `driveshafts` (sub-part ids) | steel | C9.6.4, C9.10 |
| `roll_hoop`, `roll_structure` (sub-part ids) | C15.2 without particulate reinforcement | C15.3.4 |
| `electronics`, `fuel_system`, `seat_safety` | exempt from C15.2 (still C15.1.4) | C15.4(d), (e), (l) |
| every other part (`floor`, `rear_wing`, `diffuser`, `sidepods`, `engine_cover`, `nose`, `rear_impact`, `gearbox` case, suspension, `hydraulics`, `misc`, `ballast`) | C15.2: any iron alloy; Al 1xxx-7xxx wrought / 2xx-7xx cast with < 1 % Li plus 2050/2055/2099; Mg WE43B, WE43C, WE54A, AZ80A; Inconel 625/718, Waspaloy, MP35N, MP159; CP Ti, Grade 9, 5/23, Ti6242, Ti6246, Ti10-2-3, Ti15-3-3-3, Beta C, Ti5553, Ti21S, Ti1100, Ti-6Cr-5Mo-5V-4Al; Cu < 2.5 % Be; any W alloy; SupremEX 225XE/XF; listed AM metals; C15.2.3 composites; cores; polymers | C15.2 (C156-C159) |

**The materials table's `fia` readings, checked against the Issue 19 text** (test "materials (C15) on the real table"): 22 of 23
rows agree with the checklist's verdict on a general part. Corrections requested for `concept/data/materials-2026.json` (owned by
the parts/materials helper; regs.js already applies the Issue 19 reading):

1. `mg_we43` ("Magnesium alloy WE43 (T6)", status permitted, article C15.2.1(c)(i)-(ii)): C15.2.1(c) lists **WE43B (UNS M18432)** and
   **WE43C (UNS M18434)** only, as defined under ASTM B107-13; WE43A (UNS M18430) is not listed, and the row does not say which
   variant it is. Name the variant and UNS number (e.g. "Magnesium alloy WE43C (UNS M18434), T6"); until then regs.js rejects
   `mg_we43` outside the PU (`REG-C-MAT-PERMITTED`, "magnesium grade not in C15.2.1(c)").
2. `afrp_k49` note: "KC60/KC170 aramid cloths are prescribed in PL-HALO and PL-HEADREST": C15.5.2 prescribes **KC60 only** (PL-HALO
   [KC60, CC100, KC60], PL-HEADREST [KC60, KC60]); KC170 is defined in C15.5.1(c) but used by neither.
3. `cfrp_t1100g` note "CC-UHS-eligible": CC-UHS is defined as "Woven carbon cloth, fibre Ftu > 6250MPa, epoxy prepreg" (C15.5.1(f)),
   so the fibre qualifies but only in a woven-cloth form; the row describes a quasi-isotropic laminate. Wording only, no verdict change.
4. `tungsten_ha` article "C15.6.1(g), (l)": (g) (tungsten-base alloys) is what excludes it from the PU; (l) (density > 18,400 kg/m³)
   does not apply at 18,000 kg/m³. Wording only.

Every other row (`cfrp_t700s`, `cfrp_t800s`, `cfrp_m55j`, `cfrp_m60j`, `pbo_zylon`, `gfrp_e`, both cores, `ti64`, `al_7075_t6`,
`al_li_2099`, `al_li_2195`, `mg_az80a`, `steel_17_4ph`, `steel_maraging_300`, `inconel_718`, `mmc_supremex_225xe`,
`albemet_am162`, `carbon_carbon`) cites the right article and status; the specific moduli quoted in the notes reproduce from the
row's E and density.

## L. Concept-model rules (not regulation text; same violation channel, `verified: false`)

| Rule | What | Check | Test | Status |
|---|---|---|---|---|
| `PKG-WB` | Wheelbase fits axle offset + cockpit + bulkhead gap + ICE (620 mm) + gearbox (520 mm), estimates | l.499 | concept.test, oracle | checked |
| `PKG-COOLING` | Cooling capacity ≥ 1.05 × need (aero map v0 assumption) | l.500 | guards 8, oracle | checked |
| `PKG-FLOOR-STALL` | Dynamic floor gap ≥ 2 mm above the modelled stall onset | l.501 | guards 9, oracle | checked |
| `PKG-PART-MASS` | Part masses finite, ≥ 0, inside the car | l.516 | checklist: "robustness", oracle | checked |
| `PKG-PU-FIXED` | **PU lock** (owner brief: the baseline team's PU, unchanged; it is a homologated unit, C5.5.7): every PU part's mass and position relative to XPU=0 / XC=0 (`PU_LOCK`, l.112), the MGU-K transmission option, and on a PhysicalCar (`checkPhysical(pc, { pu_ref })`, l.434) MGU-K power and the energy figures equal to the baseline team's, ICE power not above it (only the cooling derate may lower it) | l.521 | checklist: "PU lock", oracle (PU override samples) | checked |

## M. Gearing, suspension set-up, brake balance (C9, C10.2-C10.4, C11.1; more-factors v1, docs/concept/FACTORS.md)

Rules in `regs.SETUP_RULES` (kept apart from `RULES` / `COMBO_RULES`, so the proposer context and the designer scenario budgets are
unchanged). Quotes matched against the Issue 19 text (C9.6 p. C105, C9.8 p. C106, C9.9 p. C107, C10.2 p. C108, C10.4 p. C111,
C11.1 p. C119).

| Article | Rule | Touches | Check | Test | Status |
|---|---|---|---|---|---|
| C9.6.1 (C105) | 8 forward ratios, no CVT | `gearbox.top_kmh`, `gearbox.step` set all eight (`parts.gearSet`) | info `REG-C-GEARS` | concept-factors "gearing" | fixed (always 8) |
| C9.6.2 (C105) | Ratios (crankshaft to driveshafts) nominated at or before the first Competition; in 2026 the set (pairs and final drive) may be changed once | the season's ratio set | **new** `PKG-GEAR-TOP` (concept rule from this article): 8th gear at the 13 000 rpm limiter (estimate) must reach 333.5 km/h, the RB22's best 2026 trap (Monza race), i.e. `top_kmh ≥ 309` with the ratios measured on all RB laps | concept-factors, oracle | checked (concept model) |
| C9.8.2 (C106) | Every gear fitted must reach ≥ 80 km/h at 15 000 rpm | every ratio ≤ 187.5 rpm per km/h | **new** `REG-C-GEAR-80KMH` on `facts.gearing` (the measured 1st is 118.8; a 290 km/h final drive with a 1.24 step reaches 225) | concept-factors, oracle | checked |
| C9.8.4 (C106) | Up-changes ≤ 200 ms, down-changes ≤ 300 ms | the sim's 30 ms up-shift drive cut | info `REG-C-GEARS` | — | fixed |
| C5.2.4, C5.14 (C64, C77) | Fuel energy flow ≤ 0.27 N + 165 MJ/h below 10 500 rpm; rev limits only within a 750 rpm band (no cap) | engine speed from the gearing | the sim's fuel-flow ramp; 13 000 rpm limiter is an estimate (`MODEL.rev`) | concept-factors "rev limiter" | fixed (PU locked) |
| C9.1.2, C9.9.1 (C102, C107) | No traction control; no torque transfer from a slower to a faster wheel | (differential: not a parameter) | info `REG-C-TORQUE-TRANSFER` | — | not applicable (FACTORS.md §5) |
| C10.2.2, C10.2.4-C10.2.6, C10.4.3 (C108-C111) | Axles independent; no powered device; no adjustment in motion; springs (no fluid medium) and dampers only; no ride-height control | `setup.roll_front`, `setup.heave_n_mm` (passive, fixed for the lap) | info `REG-C-SUSP-PASSIVE` | — | fixed (by construction) |
| C11.1.1, C11.1.4, C11.6 (C119-C120) | One pedal, two master cylinders (bores within 3 mm), one circuit per axle; changes on track only by the driver's direct input; rear BBW ≤ 1.2 × the driver's rear pressure | `setup.brake_bias` | info `REG-C-BRAKE-BALANCE` | concept-factors "brake balance" | fixed (one balance for the lap) |
| C10.8.1 (C115) | Tyres used as supplied by the appointed supplier (minimum pressures and camber limits are the supplier's per-event prescriptions, not Section C text) | (pressures / camber: not parameters) | — | — | fixed |

## N. Concept families (redesigns v1, docs/concept/REDESIGNS.md)

Rules in `regs.CONCEPT_RULES` (kept apart from `RULES` / `COMBO_RULES`, like section M). The three `PKG-` rows are concept
definitions (`verified: false`); the `REG-C-` rows record the Section C articles a concept touches without checking their geometry.

| Article | Rule | Touches | Check | Test | Status |
|---|---|---|---|---|---|
| concept packaging model | A zeropod's inlet ≤ 760 cm² (both sides) | `sidepods.concept` 1 × `sidepods.inlet_cm2` | **new** `PKG-ZEROPOD-INLET` | concept-redesigns, oracle | checked (model rule) |
| concept packaging model | A ramp pod's undercut ≥ 120 mm | `sidepods.concept` 2 × `sidepods.undercut_mm` | **new** `PKG-RAMP-UNDERCUT` | concept-redesigns, oracle | checked (model rule) |
| concept packaging model | Airbox + gills cooling only with the high-fin cover | `cooling.layout` 1 × `engine_cover.style` | **new** `PKG-AIRBOX-COVER` | concept-redesigns, oracle | checked (model rule) |
| C3.8.1, App. C2 §16 | Sidepod inside RV-SIDEPOD | every `sidepods.concept` shape | info `REG-C-SIDEPOD-VOLUME` | — | not checked (shape drawn by the view) |
| C3.8.2, C3.16.10-C3.16.12 | Engine cover inside RV-EC; louvre / cooling apertures only where permitted | `cooling.layout` 1 / 2, `engine_cover.style` | info `REG-C-EC-APERTURES` | — | not checked |
| C3.10.2-C3.10.9, App. C2 §23-27 | Endplate, footplate, diveplane, pylon, strake volumes | `front_wing.endplate`, `nose.concept` 1 (pylons) | info `REG-C-FW-ENDPLATE-VOLUMES` | — | not checked |
| front impact structure test | The nose passes the FIA frontal impact test at any length | `nose.concept` 1 | info `REG-C-NOSE-IMPACT` (+1.2 kg assumption) | — | not modelled |
| C10.2.2, C10.2.4-C10.2.6 | Push or pull rods: both passive, both permitted | `suspension.front` | info `REG-C-SUSP-ACTUATION` | — | fixed |

## Combinations covered

Front-wing span × chord × setting × volume count (X and Z envelope, `REG-C-FW-PROFILES-Z`); the same with the straight-mode delta
(`REG-C-FW-SM-ENVELOPE`); straight-mode delta × volume count on both wings (`-FW-FLAP`, `-RW-FLAP`) and its sign (`-SM-DIRECTION`);
floor width × wing spans (half-width, C2.3.1) and floor width × the floor-body plan (C3.5.1); axle offset × cockpit × bulkhead ×
wheelbase (plank holes, packaging); every part mass and position × auto ballast × `extra_kg` × `x_frac` (C4.1 minimum and the C4.2
axle split in qualifying); driver + driver ballast (C4.5.2); ICE group × MGU-K × transmission option (C5.5.1 + C5.18.7); material ×
part class (C15 and the component articles). Rear-wing chord × setting × volumes in Z is computed but not enforced (section C).

## Gaps fixed in this pass (regs.js, each with a test in test/concept-regs-checklist.test.js)

1. **NaN / non-numeric inputs passed every rule they fed** (`x > max` is false for NaN): e.g. `overrides: { pu_ice: { mass_kg: NaN } }`
   was a legal car. All comparisons are now NaN-safe (`over` / `under`, l.457). Test "robustness".
2. **Negative part masses and parts outside the car** (overrides) were not checked as such (they could buy free ballast or weight
   distribution): `PKG-PART-MASS`.
3. **Front-wing Z envelope** (C3.10.1(a), App. C2 §22.1) was not checked: a 40° setting at 580 mm chord was legal.
   `REG-C-FW-PROFILES-Z`. (Confirmed on the previous regs.js: 40° at 580 mm without Straight Mode, a negative rear straight-mode delta,
   a one-volume rear wing, a zero-volume front wing and a NaN ICE mass all returned no violation.)
4. **Negative straight-mode delta** (more incidence on the straights) was treated as "no straight mode": `REG-C-SM-DIRECTION`.
5. **One-volume rear wing** was legal without Straight Mode, but C3.11.7(b) makes Rear Wing Separators (forwardmost volume ↔ RW Flap)
   mandatory: `REG-C-ELEMENTS-MIN` (rear ≥ 2).
6. **Zero or fractional volume counts** passed (`elements` 0 or 2.5 with `regs.check` alone): `REG-C-ELEMENTS-MIN`.
7. **C3.6.1(c) plank-hole geometry** (XR − XPU ≥ 970) was only implied by an estimated packaging rule: `REG-C-PLANK-HOLES`.
8. **C3.16.9 sidepod inlet area**: `REG-C-SIDEPOD-INLET`.
9. **C10.10.1 suspension width**: `REG-C-SUSP-WIDTH` on the mass sheet (when it exposes wheel `y_mm`) and on PhysicalCar tracks.
10. **C15 materials**: none checked; now `REG-C-MAT-*` (6 rules) against the materials table, tolerant when it is absent.
11. **C5.2 figures handed to the sims** were not checked by regs.js: `checkPU`, `checkPhysical`, `mgukLimitKw`.
12. **`regs.check(design)` ignored the design's own params / materials**: it now attaches them to the facts.
13. **Rear-wing Z envelope** made explicit (`rwProfilesChordLimit`, info) with the reason it is not enforced.
14. **PU changes** (overrides of PU masses or positions, another transmission option, a PhysicalCar PU above the baseline team's)
    were legal as long as the C5 floors held: `PKG-PU-FIXED` and `checkPhysical(pc, { pu_ref })`.

No existing check was weakened (all kept their limits; the comparisons only became stricter on non-finite input).

## Fixes requested in files this checklist does not own

1. **concept/parts.js l.68 + concept/aeromap.js l.58-65, l.128 (floor throat vs C3.5.1(a), App. C2 §4.5/§4.11).** `floor.throat_mm`
   is "Venturi throat height above Z=0", domain 80-130, base 100; RV-FLOOR-BODY's roof is Z=75 between XF=1775 and XR=−600, so every
   value is above the roof. Either redefine it as a height above the ground (throat − 10 mm plank − ride height above Z=0; baseline 55
   mm, legal) and say so in the label, or rescale the domain to ≤ 75 (e.g. 40-75, base 60) and re-fit `FLOOR.throat_k` so
   c = throat_k × throat stays 31.7 mm at the base (throat_k = 31.7 / 60 = 0.528). Then flip `REG-C-FLOOR-ROOF` to `kind: "max"` with a
   check `over(throat above Z=0, 75)` in `checkFacts` and turn the todo test into a normal one.
2. **concept/sim/lapsim.js l.80 (`track_front_m: 1.6, track_rear_m: 1.55`), concept/data/cars-2026-derived.json (1.58 / 1.52),
   concept/physical.js REF_V0 l.38 (1.58 / 1.52) and concept/parts.js l.186-187 (wheel |y| 790 / 760 mm) vs C10.10.1.** The
   Wheel Coordinate System origin (inboard rim plane, C2.1.3(a)) may not lie outboard of Y=603 (front) / Y=525 (rear); with half the
   rim overall width (334 / 420.3 mm, C10.7.2(a)) the widest legal tracks are 1.540 m front and 1.470 m rear, wheel centres at |y| 770
   / 735 mm. Use those (or narrower) values; then add `y_mm` to `massSheet` part rows (parts.js l.220) so `REG-C-SUSP-WIDTH` checks
   them, and the todo test "track widths fit" passes. The tracks are shared by our car and the calibrated field, so the relative score
   moves little, but the scored car is not legal as modelled.
3. **concept/design.js l.169-177 (`facts`).** Add `params: p` to the returned facts so that `bench` (which calls
   `regs.checkFacts(design.facts(d))`) also runs the sidepod-inlet check (C3.16.9); `regs.check` attaches it already. Not binding
   today (the inlet domain tops out at 1100 cm² of the 1600 allowed); materials need nothing (they reach checkFacts through
   `facts.mass.materials`).
4. **concept/bench.js l.252.** Append `regs.checkPhysical(pc, { recharge_limit_mj, pu_ref: <the baseline team's PhysicalCar.pu> })` violations to
   `violations` so a PhysicalCar outside C5.2 / C10.10.1 can never be scored (today the physics sim clamps ERS-K power and recharge
   itself, and the PU lock holds on every mutated design in the test, so nothing slips through today, but the guarantee lives in
   the sim and physical.js, not in the legality check). Exclude `REG-C-SUSP-WIDTH` until fix 2 lands, or every car is illegal.
5. **concept/designer/scenario.js l.37-55 (`regBounds`) and concept/optimize.js l.97 (`ctxOf` rules).** The proposer's bounds and rule
   list come from `regs.RULES` only. Add `regs.COMBO_RULES` (non-info) to the rule list if the scenario budget allows, give
   `front_wing.chord_mm` the bound `min(REG-C-FW-CHORD, regs.fwProfilesChordLimit(params.front_wing))`, and `rear_wing.elements`
   the minimum 2, so the LLM proposer sees the new limits instead of learning them from refusals.
6. **concept/data/materials-2026.json**: the four `fia` corrections listed at the end of section K.
7. **concept/materials.js `PARTS.front_wing.forms`** (`["laminate", "metal"]`): the part includes the endplates, which C3.19.1 requires
   in laminate PL-ANTISPLINTER, so regs.js rejects a metal front wing (`REG-C-MAT-COMPONENT`). Either allow only laminates there or
   split the endplate off as its own (laminate-only) material share.
