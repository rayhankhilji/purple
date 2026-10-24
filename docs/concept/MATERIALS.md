# Materials: what the concept car can be built from

Version: concept materials v1 · 2026-10-24 · branch `claude/parts-physics` · label on every number below:
**"concept materials v1 · datasheet / handbook typical values and engineering estimates · not measured on any F1 part"**

Files: `concept/data/materials-2026.json` (the table, with sources), `concept/materials.js` (the same table embedded for the browser,
plus the substitution model; regenerate the embedded copy with `node concept/tools/embed-materials.js`; a test fails if they
differ), `concept/parts.js` (part masses), `concept/aeromap.js` (stiffness → aero). Tests: `test/concept-coupling.test.js`.
How a material reaches the simulated lap: docs/concept/COUPLING.md.

## 1. Using a material

A design part may carry `params.<part>.material = "<id>"`. Absent means the part's baseline material, so every existing design is
unchanged. `design.applyChanges(d, [{ part: "rear_wing", param: "material", to: "cfrp_t1100g" }])` swaps it (setting the baseline
id removes the key); `design.diff`, `describeChange` and `describe` show it; `design.mutate(d, rng, step, { materials: true })`
proposes swaps (off by default, so seeded optimiser lineages are unchanged). `design.validate` rejects an unknown id, a material of
the wrong form for the part (a honeycomb core is not a wing), and any material on a part whose material a regulation fixes or the
model does not represent (§4): **rejected, never silently ignored**. `parts.massSheet` throws on the same cases.

## 2. The substitution model

A part's outer shape is set by its aerodynamic or packaging job, so changing its material re-gauges its walls, not its shape. For a
thin-walled shell or a sandwich skin both bending stiffness (E·t for a fixed section) and strength (σ·t) are linear in the wall
thickness t, so the part is re-sized to keep **both** the baseline part's stiffness (what the FIA deflection tests, C3.18, and the
plank stiffness tests ask for) and its strength (what it was sized to carry):

```
t = clamp( max(E0/E, σ0/σ), g_min, g_max )        wall thickness relative to the baseline material
mass of the material share  ×  (ρ/ρ0) · t         (mass_factor)
S = (E/E0)·t     Σ = (σ/σ0)·t                     stiffness and strength ratios (1 unless a gauge limit binds)
```

`g_min` (minimum ply count, handling, damage tolerance: 0.6) and `g_max` (the wall cannot grow past the room inside the profile or
package: 1.6 for wings, 1.5 for the survival cell, 2.0 elsewhere) are **engineering estimates**. Only a share `frac` of each part's
mass is material-able (estimates in §4); the rest (actuators, fittings, cores, inserts, regulated items) stays.

Single-material quasi-isotropic laminates are a simplification: real lay-ups mix fibre grades and orientations. So the model says,
for example, that an all-M55J wing is heavier than the T800S one (its quasi-isotropic strength is low, so strength sets the gauge),
while a real designer would put high-modulus plies only where stiffness governs. Treat cross-class comparisons as directional.

Where the mass goes: a lighter part frees ballast (the car never goes below the C4.1 minimum: the saving becomes ballast in the
floor at Z 30, so the CoG drops and `ballast.x_frac` now has mass to place); a heavier part eats the ballast first, then takes the
car over the minimum. Mass, CoG and axle split flow into the PhysicalCar through the unrounded mass sheet.

## 3. Stiffness → aero (estimates)

When a gauge limit binds the part is stiffer (S > 1) or softer (S < 1) than the baseline part:

- **Wings:** the baseline wing washes out 0.5° of setting in service at the reference speed (250 km/h; estimate). Another material
  washes out 0.5°/S, so the effective setting is aoa + 0.5·(1 − 1/S): a softer wing sheds load and drag, a stiffer one keeps them.
  Glass-fibre rear wing (S 0.48): −0.54°, rear-wing load −3.6 %.
- **Floor:** the baseline floor edge flexes 1 mm at the reference speed (estimate); another material adds 1·(1/S − 1) mm to the
  dynamic compression, so a softer floor loses stall margin (PKG-FLOOR-STALL), a stiffer one gains it. Glass floor: −0.66 mm.
- Other parts: no aero effect modelled.

## 4. Parts

Material-able parts (`concept/materials.js PARTS`, `parts.MATERIAL_PARTS`):

| Part | Baseline material | frac | Forms | g_min / g_max | In-service flex | What scales |
|---|---|---|---|---|---|---|
| survival_cell | `cfrp_t1100g` | 0.6 | laminate | 0.6 / 1.5 | — | skins of the homologated sandwich laminates (C15.5.3 requires CC-UHS plies and an aluminium honeycomb core); core, inserts and the fuel-cell bay fittings (40 %) stay |
| nose | `cfrp_t1100g` | 0.85 | laminate, metal | 0.6 / 2 | — | front impact structure: sized by the dynamic test (energy absorption, proxied by strength); 15 % fittings |
| rear_impact | `cfrp_t1100g` | 0.85 | laminate, metal | 0.6 / 2 | — | rear impact structure, as the nose |
| front_wing | `cfrp_t800s` | 1 | laminate, metal | 0.6 / 1.6 | 0.5° of setting | profiles and endplates (the straight-mode actuator is separate) |
| rear_wing | `cfrp_t800s` | 1 | laminate, metal | 0.6 / 1.6 | 0.5° of setting | profiles, endplates, pylon and brace (actuator separate) |
| floor | `cfrp_t800s` | 1 | laminate, metal | 0.6 / 2 | 1 mm | floor body (the plank and skids are regulated, C3.6.2-C3.6.3, and stay) |
| diffuser | `cfrp_t800s` | 1 | laminate, metal | 0.6 / 2 | — | diffuser surfaces |
| sidepods | `cfrp_t800s` | 1 | laminate, metal | 0.6 / 2 | — | sidepod bodywork |
| engine_cover | `cfrp_t800s` | 1 | laminate, metal | 0.6 / 2 | — | engine cover, airbox and roll-hoop fairing (the roll structure itself, C15.3.4, is not separated) |
| gearbox | `cfrp_t800s` | 0.3 | laminate, metal | 0.6 / 2 | — | casing and spacer (30 %, estimate); gears, shafts, differential and oil stay |
| front_suspension | `cfrp_t800s` | 0.3 | laminate, metal | 0.6 / 2 | — | wishbones, push/pull and track rods (30 %, estimate); uprights (C15.3.3 restricts them), dampers, rockers, rack and steering wheel stay |
| rear_suspension | `cfrp_t800s` | 0.3 | laminate, metal | 0.6 / 2 | — | wishbones and rods (30 %, estimate); uprights, dampers and rockers stay |
| ballast | `tungsten_ha` | 1 | metal | — | — | free ballast slab, footprint 0.06 m² (estimate): only the density matters; a less dense slab is thicker, so its CoG sits higher |

Parts without a material parameter and why (`materials.FIXED`; a material on them is an error):

| Part | Reason |
|---|---|
| halo | C12.4.2: made to FIA 8869-2018 by an FIA-designated supplier (titanium) |
| wheels_front, wheels_rear | C10.7.1: wheel rims must be AZ70 or AZ80 magnesium alloy; tyres are supplied |
| brakes_front, brakes_rear | C11.2.2: callipers must be aluminium (C15.2.1(b)); discs and pads are friction materials (C15.4(c)) |
| pu_ice, pu_turbo, pu_mguk, pu_es, pu_electronics | C15.6-C15.9: PU materials are listed and approved separately; the C5 mass floors bind |
| driver_ballast | C4.3.2: density > 7500 kg/m³, sealed by the FIA (fixed: tungsten heavy alloy) |
| driver, seat_safety | the driver's reference mass (C4.5.2); harness and safety equipment are standard items (C14) |
| electronics, fuel_system | C15.4(d) electrical components exempt; C15.4(l) the fuel bladder is a regulated material |
| hydraulics, cooling, misc | not modelled |
| layout | no mass of its own |

## 5. The material table

Laminates are quasi-isotropic estimates from the maker's unidirectional composite data at 60 % fibre volume:
E_QI ≈ 3/8·E1 + 5/8·E2, tensile_QI ≈ 0.33 × UD strength, density = 0.6·fibre + 0.4·1220 kg/m³ (estimates; `_meta.laminate_rule`).
Cores: out-of-plane stabilised compressive modulus and strength. Specific modulus E/ρ is given for metals (C15.1.4 caps it at
40 GPa/(g/cm³)).

| id | Name | Form | ρ kg/m³ | E GPa | Tensile MPa | E/ρ (metals) | FIA (Issue 19, as read here) | Typical F1 use | Kind; sources |
|---|---|---|---|---|---|---|---|---|---|
| `cfrp_t700s` | Carbon/epoxy prepreg, standard modulus (T700S class), quasi-isotropic | laminate | 1568 | 55.6 | 944 | — | permitted (C15.2.3(a)(i), (b)(i)) | secondary structure, bodywork, tooling-friendly panels | datasheet UD values + engineering estimate (QI rule); TORAY-T700S, FIA-C-ISS19 |
| `cfrp_t800s` | Carbon/epoxy prepreg, intermediate modulus (T800S class), quasi-isotropic | laminate | 1568 | 66.4 | 1086 | — | permitted (C15.2.3(a)(i), (b)(i)) | concept baseline for wings, floor, bodywork, wishbones, gearbox casing | datasheet UD values + engineering estimate (QI rule); TORAY-T800S, FIA-C-ISS19 |
| `cfrp_t1100g` | Carbon/epoxy prepreg, ultra-high strength (T1100G class, CC-UHS-eligible), quasi-isotropic | laminate | 1562 | 74.7 | 1142 | — | permitted (C15.2.3(b)(i); C15.5.1(f) CC-UHS) | concept baseline for the survival cell skins and impact structures (C15.5.3 requires CC-UHS plies, fibre Ftu > 6250 MPa) | datasheet UD values + engineering estimate (QI rule); TORAY-T1100G, FIA-C-ISS19 |
| `cfrp_m55j` | Carbon/epoxy prepreg, high modulus (M55J class), quasi-isotropic | laminate | 1634 | 130.5 | 667 | — | permitted (C15.2.3(b)(i)) | stiffness-critical parts (wing main planes, floor edges, suspension members) where brittleness is acceptable | datasheet UD values + engineering estimate (QI rule); TORAY-M55J, FIA-C-ISS19 |
| `cfrp_m60j` | Carbon/epoxy prepreg, ultra-high modulus (M60J class), quasi-isotropic | laminate | 1646 | 138.8 | 663 | — | forbidden (C15.2.3(b)(i)) | none on a legal car (space structures) | datasheet UD values + engineering estimate (QI rule); TORAY-M60J, FIA-C-ISS19 |
| `afrp_k49` | Aramid/epoxy (Kevlar 49 class), quasi-isotropic | laminate | 1352 | 31.9 | 455 | — | permitted (C15.2.3(b)(ii); C15.5) | anti-splinter and prescribed laminates (PL-HALO KC60, PL-HEADREST), wheel tethers, fairings | handbook UD values + engineering estimate (QI rule); DUPONT-KEVLAR, HANDBOOK-COMPOSITES, FIA-C-ISS19 |
| `pbo_zylon` | PBO/epoxy (Zylon HM class), quasi-isotropic | laminate | 1424 | 63 | 825 | — | permitted (C15.2.3(b)(iii)) | survival-cell side anti-intrusion panels, anti-splinter layers | engineering estimate (UD lamina estimated from fibre values; QI rule); TOYOBO-ZYLON, FIA-C-ISS19 |
| `gfrp_e` | E-glass/epoxy, quasi-isotropic | laminate | 2036 | 20 | 356 | — | permitted (C15.2.3(b)(vi)) | radio-transparent covers, insulation carriers, low-cost spares | handbook UD values + engineering estimate (QI rule); HANDBOOK-COMPOSITES, FIA-C-ISS19 |
| `core_al_honeycomb` | Aluminium honeycomb core (5052, 1/8 in cell, 3.1 lb/ft³) | core | 50 | 0.52 | 2.07 | — | permitted (C15.2.3(c)(i); C15.5.3(ii)) | survival cell sandwich core (mandatory in the homologated sandwich laminates, ≥ 6 mm), floor and wing sandwich cores | datasheet typical; HEXCEL-CRIII, FIA-C-ISS19 |
| `core_nomex` | Meta-aramid (Nomex) honeycomb core (1/8 in cell, 3.0 lb/ft³) | core | 48 | 0.14 | 2.24 | — | permitted (C15.2.3(c)(ii)) | wing, bodywork and floor sandwich cores | datasheet typical; HEXCEL-HRH10, FIA-C-ISS19 |
| `ti64` | Titanium alloy Ti-6Al-4V (Grade 5), annealed | metal | 4430 | 113.8 | 950 | 25.7 | permitted (C15.2.1(e)(iii); C15.2.2(d); C15.3.3(ii); C3.6.3(d)(iii)) | uprights, gearbox inserts, fasteners, halo (FIA 8869-2018 supplier part), skids (C3.6.3) | handbook typical; HANDBOOK-METALS, FIA-C-ISS19 |
| `al_7075_t6` | Aluminium alloy 7075-T6 | metal | 2810 | 71.7 | 572 | 25.5 | permitted (C15.2.1(b)(ii); C15.3.3(i); C11.2.2) | uprights (C15.3.3 lists UNS A97075), brackets, brake callipers (aluminium only, C11.2.2) | handbook typical; HANDBOOK-METALS, FIA-C-ISS19 |
| `al_li_2099` | Aluminium-lithium alloy 2099 (T83 extrusion) | metal | 2630 | 78 | 560 | 29.7 | permitted (C15.2.1(b)(v)) | stiff light brackets and housings | handbook typical (estimate where the temper varies); HANDBOOK-METALS, FIA-C-ISS19 |
| `al_li_2195` | Aluminium-lithium alloy 2195 | metal | 2710 | 76 | 590 | 28.0 | not_listed (C15.2.1(b)(ii)-(v); C15.1.9) | none on a legal car (launch-vehicle tanks) | handbook typical; HANDBOOK-METALS, FIA-C-ISS19 |
| `mg_az80a` | Magnesium alloy AZ80A-T5 | metal | 1800 | 45 | 380 | 25.0 | permitted (C15.2.1(c)(iv); C10.7.1; C15.6.1(a)) | wheel rims (C10.7.1: AZ70 or AZ80 only), housings outside the PU | handbook typical; HANDBOOK-METALS, FIA-C-ISS19 |
| `mg_we43` | Magnesium alloy WE43 (T6) | metal | 1840 | 44 | 250 | 23.9 | permitted (C15.2.1(c)(i)-(ii)) | gearbox and ancillary housings outside the PU | handbook typical; HANDBOOK-METALS, FIA-C-ISS19 |
| `steel_17_4ph` | Stainless steel 17-4PH (H900) | metal | 7780 | 196.5 | 1310 | 25.3 | permitted (C15.2.1(a); C15.2.2(e); C3.6.3(d)(iv)) | skids (C3.6.3(d)(iv), ≤ 38 HRC when new), fittings | handbook typical; HANDBOOK-METALS, FIA-C-ISS19 |
| `steel_maraging_300` | Maraging steel 18Ni(300), aged | metal | 8000 | 190 | 2050 | 23.8 | permitted (C15.2.1(a)) | gears, shafts, highly loaded pins; also usable as ballast | handbook typical; HANDBOOK-METALS, FIA-C-ISS19 |
| `inconel_718` | Nickel superalloy Inconel 718 (aged) | metal | 8190 | 200 | 1375 | 24.4 | permitted (C15.2.1(d)(ii); C15.2.2(g)) | exhaust and turbo hardware (PU), high-temperature fasteners | handbook typical; HANDBOOK-METALS, FIA-C-ISS19 |
| `tungsten_ha` | Tungsten heavy alloy (≈ 95 % W, W-Ni-Fe, ASTM B777 class 3) | metal | 18000 | 360 | 758 | 20.0 | permitted (C15.2.1(g); C4.3.2(d); C15.6.1(g), (l)) | ballast (free and driver ballast): the densest practical choice | standard minimum / typical; ASTM-B777, FIA-C-ISS19 |
| `mmc_supremex_225xe` | Particulate-reinforced aluminium MMC (SupremEX 225XE) | metal | 2880 | 115 | 610 | 39.9 | permitted (C15.2.1(h)(i); C15.3.3(iii); C15.3.4) | uprights (C15.3.3(iii)), stiff brackets and housings | maker typical; MATERION-SUPREMEX, FIA-C-ISS19 |
| `albemet_am162` | Aluminium-beryllium alloy (AlBeMet AM162) | metal | 2071 | 193 | 400 | 93.2 | forbidden (C15.1.4; C15.2.1) | none on a legal car (banned in F1 since the early 2000s; aerospace optics) | maker typical (recalled); MATERION-ALBEMET, FIA-C-ISS19 |
| `carbon_carbon` | Carbon-carbon composite (brake / clutch friction grade) | friction | 1800 | 30 | 100 | — | specific_use (C15.4(c)) | brake discs and pads, clutch plates | engineering estimate; FIA-C-ISS19 |

Source records (URL, access date, what was read) are in the JSON `sources`. Several metal values are recalled handbook values
whose pages could not be opened in this session (the JSON says so per source); verify them before quoting.

## 6. Contract for the FIA-checklist helper (concept/regs.js)

- Entries: `{ id, name, class, form, density_kg_m3, E_GPa, tensile_MPa, typical_f1_use, kind, basis, fia: { article, status,
  note, verified: false }, sources: [id] }`; laminates add `fibre: { name, E_GPa, tensile_MPa, density_kg_m3 }` and `ud`; Al-Li
  alloys add `li_wt_pct: [min, max]`; AlBeMet adds `be_wt_pct`.
- A design part may carry `params.<part>.material = "<id>"` (absent = `materials.baseOf(part)`). Read it with
  `materials.materialOf(design.params, part)`; `materials.MATERIALS` / `materials.get(id)` give the entry; `parts.MATERIAL_PARTS`
  lists the parts that can carry one.
- What this module does **not** do: decide legality. `fia.status` is this module's reading of Article C15 (Issue 19) and the
  part-specific articles, `verified: false` everywhere. The checks a legality rule would need, as read here:
  C15.2.3(b)(i) carbon fibre nominal modulus ≤ 550 GPa, strength ≤ 7100 MPa, density ≤ 1.92 g/cm³ (use `fibre`);
  C15.1.4 metallic E/ρ ≤ 40 GPa/(g/cm³); C15.2.1(b)(ii) wrought Al with < 1 % Li unless named (2050, 2055, 2099), with C15.1.9's
  "whole declared range" reading; C15.3.3 upright materials; C15.3.4 no particulate reinforcement in the Primary Roll Structure;
  C15.5.3 the survival-cell sandwich laminates need CC-UHS plies (fibre Ftu > 6250 MPa) and an aluminium honeycomb core ≥ 6 mm;
  C10.7.1 rims AZ70/AZ80; C11.2.2 aluminium callipers; C4.3.2(d) driver ballast > 7500 kg/m³; C15.4 exceptions (friction
  materials, electrical parts, fluids, paint, regulated items).

## 7. What each swap does on the RB22 anchor (physics sim)

One part changed at a time from `design.baseline({ team: "redbull" })` (ballast rows: with 15 kg of extra ballast so the slab
exists). Δ parts = mass-sheet parts mass; Δ ballast = automatic ballast; Δ CoG and Δ lap on the PhysicalCar / physics sim.

Reading guide: every metal and every lower-grade laminate is heavier at equal stiffness and strength (the baseline carbon grades
are already the light choice); only the ultra-high-strength T1100G grade saves mass on parts sized in T800S (≈ 5 % of the
material share). A saved kilogram becomes ballast at the front of the car (x_frac 0.05), which on this front-limited anchor
moves the axle split the wrong way, so a single lighter part is about lap-neutral (+0.004 to +0.016 s) until the ballast is moved
rearwards (all the light swaps together with the ballast at x_frac 0.7: −0.039 s, COUPLING.md §3). Mass placed behind the CoG
(rear impact structure) can even be lap-neutral for the same reason (COUPLING.md §6).

| Part | Material | mass factor | S (stiffness) | Σ (strength) | gauge | Δ parts kg | Δ ballast kg | Δ CoG mm | Δ lap s (RB22) |
|---|---|---|---|---|---|---|---|---|---|
| survival_cell | cfrp_t700s | 1.349 | 1.00 | 1.11 | — | 15.00 | -0.20 | 1.00 | 0.407 |
| survival_cell | cfrp_t800s | 1.129 | 1.00 | 1.07 | — | 5.56 | -0.20 | 0.42 | 0.144 |
| survival_cell | cfrp_m55j | 1.569 | 2.62 | 0.88 | max_gauge | 24.48 | -0.20 | 1.57 | 0.661 |
| survival_cell | afrp_k49 | 1.298 | 0.64 | 0.60 | max_gauge | 12.83 | -0.20 | 0.87 | 0.346 |
| survival_cell | gfrp_e | 1.955 | 0.40 | 0.47 | max_gauge | 41.09 | -0.20 | 2.55 | 1.102 |
| nose | cfrp_t800s | 1.129 | 1.00 | 1.07 | — | 0.79 | -0.20 | 0.08 | 0.020 |
| nose | cfrp_m55j | 1.791 | 2.99 | 1.00 | — | 4.84 | -0.20 | 0.18 | 0.192 |
| nose | al_7075_t6 | 3.592 | 1.92 | 1.00 | — | 15.86 | -0.20 | 0.45 | 0.661 |
| nose | ti64 | 3.409 | 1.83 | 1.00 | — | 14.74 | -0.20 | 0.42 | 0.608 |
| rear_impact | cfrp_t800s | 1.129 | 1.00 | 1.07 | — | 0.63 | -0.20 | 0.04 | -0.006 |
| rear_impact | al_7075_t6 | 3.592 | 1.92 | 1.00 | — | 12.56 | -0.20 | -0.43 | 0.081 |
| front_wing | cfrp_t700s | 1.194 | 1.00 | 1.04 | — | 1.94 | -0.20 | -0.24 | 0.073 |
| front_wing | cfrp_t1100g | 0.947 | 1.07 | 1.00 | — | -0.53 | 0.53 | -0.09 | -0.013 |
| front_wing | cfrp_m55j | 1.667 | 3.14 | 0.98 | max_gauge | 6.67 | -0.20 | -0.98 | 0.208 |
| front_wing | gfrp_e | 2.078 | 0.48 | 0.52 | max_gauge | 10.78 | -0.20 | -1.61 | 0.558 |
| front_wing | al_7075_t6 | 2.867 | 1.73 | 0.84 | max_gauge | 18.67 | -0.20 | -2.80 | 0.724 |
| front_wing | ti64 | 3.230 | 1.96 | 1.00 | — | 22.30 | -0.20 | -3.34 | 0.855 |
| rear_wing | cfrp_t1100g | 0.947 | 1.07 | 1.00 | — | -0.61 | 0.61 | -0.59 | 0.016 |
| rear_wing | cfrp_m55j | 1.667 | 3.14 | 0.98 | max_gauge | 7.67 | -0.20 | 4.99 | 0.114 |
| rear_wing | gfrp_e | 2.078 | 0.48 | 0.52 | max_gauge | 12.39 | -0.20 | 7.97 | 0.344 |
| rear_wing | al_7075_t6 | 2.867 | 1.73 | 0.84 | max_gauge | 21.47 | -0.20 | 13.61 | 0.491 |
| floor | cfrp_t700s | 1.194 | 1.00 | 1.04 | — | 4.74 | -0.20 | -1.41 | 0.070 |
| floor | cfrp_t1100g | 0.947 | 1.07 | 1.00 | — | -1.29 | 1.29 | -0.02 | 0.013 |
| floor | gfrp_e | 2.597 | 0.60 | 0.66 | max_gauge | 38.97 | -0.20 | -11.55 | 0.562 |
| floor | al_7075_t6 | 3.402 | 2.05 | 1.00 | — | 58.62 | -0.20 | -16.99 | 0.858 |
| diffuser | cfrp_t1100g | 0.947 | 1.07 | 1.00 | — | -0.26 | 0.26 | -0.03 | 0.006 |
| sidepods | cfrp_t1100g | 0.947 | 1.07 | 1.00 | — | -0.45 | 0.45 | -0.21 | 0.004 |
| sidepods | al_7075_t6 | 3.402 | 2.05 | 1.00 | — | 20.66 | -0.20 | 2.65 | 0.391 |
| engine_cover | cfrp_t1100g | 0.947 | 1.07 | 1.00 | — | -0.45 | 0.45 | -0.37 | 0.005 |
| gearbox | cfrp_t1100g | 0.947 | 1.07 | 1.00 | — | -0.78 | 0.78 | -0.24 | 0.011 |
| gearbox | mg_az80a | 2.296 | 1.36 | 0.70 | max_gauge | 19.28 | -0.20 | -0.20 | 0.216 |
| gearbox | ti64 | 3.230 | 1.96 | 1.00 | — | 33.18 | -0.20 | -0.39 | 0.562 |
| front_suspension | cfrp_t1100g | 0.947 | 1.07 | 1.00 | — | -0.49 | 0.49 | -0.16 | -0.003 |
| front_suspension | ti64 | 3.230 | 1.96 | 1.00 | — | 20.54 | -0.20 | 0.04 | 0.728 |
| rear_suspension | cfrp_t1100g | 0.947 | 1.07 | 1.00 | — | -0.43 | 0.43 | -0.15 | 0.010 |
| rear_suspension | ti64 | 3.230 | 1.96 | 1.00 | — | 18.19 | -0.20 | 0.50 | 0.219 |
| ballast (15 kg) | steel_maraging_300 | 1 | — | — | — | 0 | 0 | 0.17 | 0.003 |
| ballast (15 kg) | ti64 | 1 | — | — | — | 0 | 0 | 0.42 | 0.006 |
| ballast (15 kg) | al_7075_t6 | 1 | — | — | — | 0 | 0 | 0.74 | 0.011 |

The full grid (every part × ten candidate materials) is reproducible with the materials API; the rows above are a representative
subset.
