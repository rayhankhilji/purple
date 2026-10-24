# PURPLE · CONCEPT CAR · researched part masses (2026 F1)

Version 1 · 2026-10-24 · branch `claude/concept-mass` · data: `concept/data/parts-mass-2026.json` · label on every number:
**"concept part masses v1 · researched · regulation floors where they exist, otherwise reported or engineering estimates
reconciled to reported 2026 car weights · not measured"**

Row ids match `concept/parts.js` `CATALOGUE` ids, so the integrator can map rows one to one. This document proposes changes to
`concept/parts.js` and `concept/regs.js`; it does not make them.

## 1. What is public, and what is not

Teams do not publish per-part masses of 2026 cars. What is public:

- **Regulation floors** (FIA 2026 Section C, Issue 20, 05/08/2026; every mass article cited here reads the same in Issue 17,
  the issue `concept/regs.js` cites): the Minimum Mass (C4.1), the driver + driver ballast floor (C4.5.2), the PU mass groups
  (C5.3.4, C5.5.1, C5.5.2, C5.17.9, C5.18.7, App. C3 Drawing 9), the driveline floor (C9.5.2), the plank's geometry and
  material (C3.6), the rim material and dimensions (C10.7), the brake disc sizes (C11.3).
- **Whole-car figures** from teams and the press (official spec sheets: 768-772 kg; reported early-2026 ranking: three teams under
  the limit, one on it, seven 1-26 kg over).
- **A handful of reported component figures**: titanium halo 7 kg, gearbox about 40 kg, front wing about 10 kg, steering wheel
  1.3 kg, 2026 front brake disc 2.0 kg and caliper about 2.0 kg (about 4.5 kg per corner), full paint about 6 kg, driver kit 4-5 kg.

Not found in any public source: the published 2026 **Nominal Tyre Mass** (C4.7), per-tyre masses, rim masses, and any mass for the
survival cell (beyond an undated "as little as 35 kg"), nose, floor, rear wing, suspension, cooling, fuel system, hydraulics or
looms. Those are engineering estimates, stated per component in the JSON.

## 2. Regulation findings that change the current part list

1. **The turbocharger is inside the 130 kg ICE floor.** C5.5.1 sets the ICE "PU Mass group" at ≥ 130 / 132 / 134 kg; Drawing 9
   (App. C3, "for reference") shows that group as **ICE + TC + Powerbox, minimum 130 kg**, with the TC ≥ 12 kg (C5.3.4) inside it.
   `parts.js` carries ICE 131 kg **plus** TC 12 kg, i.e. 12-13 kg too much.
2. **The ICE and MGU-K options are paired.** Option (a) ICE ≥ 130 with MGU-K ≥ 20; (b) 134 with 16; (c) 132 with 18. ICE + MGU-K is
   150 kg in every option, and the PU totals 185 kg (C5.5.2 = Drawing 9's sum: 130 + 20 + 35). `parts.js` pairs ICE 131 (only legal
   under option a) with MGU-K 18 (option c), and `regs.js` checks ICE ≥ 130 (option a) against MGU-K ≥ 16 (option b) independently,
   so it accepts ICE + MGU-K = 146 kg.
3. **PU control electronics are already inside the groups.** App. C4 items 39 (CU-K) and 40 (DC-DC) are in the ESME group (35 kg);
   item 41 (Powerbox) is in the ICE group. Ferrari's spec sheet says the same: "minimum battery pack mass including control
   electronics of 35 kg". What stays outside every group is the tailpipe, intake upstream of the compressor, breather and mounting
   studs (items 72-76).
4. **The seat is part of the driver's 82 kg.** Definition: "Mass of the Driver: the mass of the driver with the seat, and driving
   equipment ... but excluding the safety harness". `parts.js` counts the seat in `seat_safety` on top of the 82 kg.
5. **There is no beam wing in 2026.** C3.11 lists Rear Wing Profiles, Endplate Body, Brace, Pylon, Assembly, Adjuster System and
   Auxiliary Components only. `parts.js` carries a 2.2 kg beam wing (and `aeromap.js` a 3 % downforce share for it).
6. **Nominal Tyre Mass: 44 kg stays an estimate; 46 kg is the alternative.** 44 = the 768 kg headline minus the 724 kg base, both
   from Issue 8 (2024), and RaceFans footnotes the same assumption. Team spec sheets quoting 770 kg (Haas "minimum", Ferrari) and
   McLaren's 772 kg fit 46 kg (minima 770 / 772), but they may be qualifying or actual weights. Pirelli says the 2026 set is
   1.6 kg lighter than 2025's, without giving either value.
7. Minor: `parts.js` places wheel centres at z = 353 (the tyre radius above the ground). In the FIA frame Z=0 is the plank's
   upper surface (C3.6.1(a)), so the ground is at about Z = -45 (10 mm plank + 35 mm ride height) and the axle at about Z = 300.

## 3. Method

Each part is split into components, and each component is tagged with one kind: **regulation** (a floor, with its article),
**official** (team/supplier/Pirelli/F1), **reported** (journalism, quality noted per source) or **engineering estimate** (reasoning
stated). The **bottom-up** sum of those components is **652.3 kg**, which would mean 118 kg of ballast. That cannot describe a 2026
car: reported cars sit at the 768 kg race minimum, from a few kg under to 26 kg over, with no ballast to speak of. The gap is
mass that public part figures never capture (inserts, fixings, local reinforcement, brackets, fluids).

**Reconciliation:** regulation, official and reported components are held fixed (385.8 kg), and so is the regulation-geometry
plank; every engineering-estimate component (266.5 kg) is multiplied by one factor **k = 1.434**, so the parts reach the target of
**768 kg** (a car on the race limit, as McLaren was reported in April 2026). The JSON keeps both values (`bottom_up`, `best`). The
ranges span both, ±15 %, or the regulation band.

## 4. Part by part (kg)

| Part (parts.js id) | parts.js | Bottom-up | **Best (reconciled)** | Range | Kind | Main sources |
|---|---|---|---|---|---|---|
| survival_cell | 70 | 50 | **71.7** | 42.5–82.5 | engineering estimate | f1-dictionary (35 kg bare shell, weak) |
| nose | 8 | 5 | **7.2** | 4.5–8.5 | engineering estimate | — |
| halo | 7.5 | 9 | **9.9** | 7–13.5 | reported | Autosport 7 kg titanium; IMechE "13.5 kg overall" (scope unclear) |
| rear_impact | 6 | 4 | **5.7** | 3.5–6.5 | engineering estimate | — |
| front_wing (no actuator) | 11.5 | 10 | **10** | 8–12 | reported | GPFans, Motorsport ES ("about 10 kg") |
| rear_wing (no actuator) | 10.4 | 8 | **11.5** | 7–13 | engineering estimate | — |
| beam_wing | 2.2 | 0 | **0** | 0 | regulation | C3.11 (no beam wing) |
| floor (incl. plank assembly 7 kg) | 30 | 24 | **31.4** | 20.5–36 | engineering estimate | C3.6, App. C2 §11 |
| diffuser | 4 | 3.5 | **5** | 3–6 | engineering estimate | — |
| sidepods | 7 | 6 | **8.6** | 5–10 | engineering estimate | — |
| engine_cover | 6 | 6 | **8.6** | 5–10 | engineering estimate | — |
| pu_ice (ICE + Powerbox, less TC) | 131 | 118.5 | **118.5** | 118–120.5 | regulation | C5.5.1(a), Drawing 9, C5.5.8 |
| pu_turbo | 12 | 12 | **12** | 12–13 | regulation | C5.3.4 |
| pu_mguk | 18 | 20 | **20** | 20–21 | regulation | C5.18.7(a) |
| pu_es (incl. CU-K, DC-DC) | 36 | 35 | **35** | 35–36 | regulation | C5.17.9, App. C4; Ferrari, McLaren specs |
| pu_electronics → PU items outside the groups | 6 | 4 | **5.7** | 3.5–6.5 | engineering estimate | App. C4 items 72-76 |
| gearbox | 52.3 | 46 | **48.6** | 39–56 | reported | GPFans, Motorsport ES (gearbox ≈ 40 kg); C9.5.2 floor 22 |
| front_suspension (incl. steering, wheel 1.3) | 26 | 21.8 | **30.7** | 18.5–35.5 | engineering estimate | steering wheel: GPFans, Motorsport ES |
| rear_suspension | 24 | 19 | **27.2** | 16–31.5 | engineering estimate | — |
| wheels_front (2 rims + 2 tyres) | 39.8 | 34 | **40.1** | 29–46 | engineering estimate | C10.7; Mercedes tyre sizes; NTM |
| wheels_rear | 46.2 | 40 | **46.9** | 34–54 | engineering estimate | C10.7; Mercedes tyre sizes; NTM |
| brakes_front | 15 | 11 | **11.9** | 9.5–13.5 | reported | The Race, The Drive, Gasgoo |
| brakes_rear | 12 | 8 | **11.5** | 7–13 | engineering estimate | C11.3.3 disc sizes |
| cooling (incl. fluids) | 38 | 28 | **40.2** | 24–46 | engineering estimate | — |
| fuel_system (empty) | 12 | 7 | **10** | 6–11.5 | engineering estimate | C6.1.1 (FT5-1999 bladder) |
| hydraulics | 8 | 7 | **10** | 6–11.5 | engineering estimate | — |
| electronics | 24 | 18 | **25.8** | 15.5–29.5 | engineering estimate | loom length (Cadillac/GM) |
| misc (paint, fasteners, mirrors, lights) | 10 | 8.5 | **12.2** | 7–14 | engineering estimate | RN365 (paint ≈ 6 kg full livery) |
| driver (reference mass incl. seat and kit) | 72 | 75 | **75** | 62–85 | engineering estimate | definition; F1.com (kit 4-5 kg) |
| driver_ballast | 10 | 7 | **7** | 0–20 | regulation | C4.5.2, C4.3.2 |
| seat_safety → harness, headrest, pedals, extinguisher, drink | 10 | 7 | **10** | 6–11.5 | engineering estimate | C14.1 (FIA 8876-2022) |
| ballast | 5.1 | — | by difference | — | regulation | C4.1 |

Components worth knowing: plank from regulation geometry, 570,750 mm² × 10 mm = 5.71 L at specific gravity 1.30-1.45 → 7.4-8.3 kg
solid, 4.8-6.4 kg with the pocketing C3.6.2(c) allows, plus about 1 kg of Ti-6Al-4V or 17-4PH skids. Rim: AZ70/AZ80
magnesium (1.80 g/cm³), C10.7.2 dimensions and a 4 mm mean wall give 5.8 kg front / 6.7 kg rear bare, about 7 / 8 kg with fittings
(about 10 / 11 kg after reconciliation). Tyres: 44 kg split by cross-section (705×280 vs 710×375 mm), front share 0.455 → 10.0 kg
per front tyre and 12.0 kg per rear (10.5 / 12.5 at 46 kg). Straight-mode actuators: +0.8 kg front, +1.0 kg rear when the flap is
used (every real 2026 car uses it).

## 5. Consistency

| | kg |
|---|---|
| Bottom-up parts (incl. driver 75 + driver ballast 7) | 652.3 |
| Reconciled parts | **767.9** |
| Minimum Mass, qualifying / race (NTM 44, estimate) | 770 / 768 |
| **Implied ballast**, qualifying / race (NTM 44) | **2.1 / 0.1** |
| Implied ballast, qualifying / race (NTM 46) | 4.1 / 2.1 |
| Implied ballast from the bottom-up sum (qualifying, NTM 44) | 117.7 |
| parts.js baseline: parts / ballast | 764.9 / 5.1 |

Run through `parts.massSheet` (the reconciled masses as overrides on the baseline design): total 770.0 kg in qualifying, front share
**0.4496** with the parts.js positions and 0.4494 with the positions in the JSON, both inside the C4.2 window (0.44-0.46).
The CoG height drops from 297 to 280 mm when the regulation-anchored positions are used (ICE CoG near the Z=90 crank axis, axles
at Z ≈ 300).

Driver: C4.5.2 is a floor of 82 kg for reference mass + driver ballast. The concept models a 75 kg reference mass (driver
≈ 68 kg + kit 4-5 kg + seat ≈ 2.5 kg) and 7 kg of driver ballast, which must sit in the cockpit-entry-template X range, be fixed
to the survival cell and be denser than 7500 kg/m³ (C4.3.2). A heavier driver needs less; the car total does not change.
Fuel is outside Car Mass. A Heat Hazard adds 5 kg (or 2 kg) to the minimum (C4.6); not modelled.

## 6. Proposed changes for the integrator (not applied)

`concept/parts.js` (baseline values; scaling laws can stay as they are, rescaled to these anchors):

| Part | parts.js | Proposed | Kind | Source |
|---|---|---|---|---|
| pu_ice | 131 | 118.5 (ICE + Powerbox; ICE group with TC = 130.5) | regulation | C5.5.1(a), Drawing 9 |
| pu_mguk | 18 | 20 | regulation | C5.18.7(a) |
| pu_es | 36 | 35 | regulation | C5.17.9 |
| pu_electronics | 6 | 5.7, renamed "PU items outside the mass groups" | estimate | App. C4 items 72-76 |
| beam_wing | 2.2 | 0 (remove; fold the brace into rear_wing) | regulation | C3.11 |
| rear_wing | 10.4 | 11.5 (+1.0 actuator with straight mode) | estimate | — |
| front_wing | 11.5 | 10.0 (+0.8 actuator with straight mode) | reported | GPFans, Motorsport ES |
| halo | 7.5 | 9.9 | reported + estimate | Autosport, IMechE |
| driver | 72 | 75 (reference mass incl. seat and kit) | estimate | definition, F1.com |
| driver_ballast | 10 | 7 (82 - driver, unchanged rule) | regulation | C4.5.2 |
| seat_safety | 10 | 10 (seat out; harness, headrest, pedals, extinguisher, drink in) | estimate | C14.1, C14.5 |
| brakes_front / brakes_rear | 15 / 12 | 11.9 / 11.5 | reported / estimate | The Race, The Drive, Gasgoo; C11.3.3 |
| gearbox | 52.3 | 48.6 | reported + estimate | GPFans, Motorsport ES |
| front_suspension / rear_suspension | 26 / 24 | 30.7 / 27.2 | estimate | — |
| wheels_front / wheels_rear | 2×10 + 0.45 NTM / 2×11 + 0.55 NTM | 2×10.0 + 0.455 NTM / 2×11.4 + 0.545 NTM | estimate | C10.7, tyre sizes |
| floor / diffuser | 30 / 4 | 31.4 / 5 | estimate | C3.6 (plank) |
| sidepods / engine_cover | 7 / 6 | 8.6 / 8.6 | estimate | — |
| cooling / fuel_system / hydraulics | 38 / 12 / 8 | 40.2 / 10 / 10 | estimate | — |
| electronics / misc | 24 / 10 | 25.8 / 12.2 | estimate | — |
| survival_cell / nose / rear_impact | 70 / 8 / 6 | 71.7 / 7.2 / 5.7 | estimate | — |
| wheel z (both axles) | 353 | ≈ 300 (Z=0 is the plank's upper surface) | estimate | C3.6.1(a), tyre OD |
| pu_ice z | 290 | ≈ 230 (crank at Z=90) | regulation + estimate | C5.4.5, C5.5.3 |

`concept/regs.js`: check the ICE group as `ice_kg + tc_kg` (it includes the TC) against the option paired with the MGU-K
(130 & 20, 132 & 18, 134 & 16), not ICE ≥ 130 and MGU-K ≥ 16 independently; record Drawing 9 as the source. `MASS_LABEL` and
the `basis` strings should name this file. `aeromap.js` (outside this brief): the 3 % beam-wing downforce share has no 2026 part.

## 7. Sources (all accessed 2026-10-24)

Regulation: FIA 2026 F1 Regulations Section C, Issue 20 (05/08/2026) https://api.fia.com/system/files/documents/fia_2026_f1_regulations_-_section_c_technical_-_iss_20_-_2026-08-05.pdf ·
Issue 17 (28/04/2026) https://api.fia.com/system/files/documents/fia_2026_f1_regulations_-_section_c_technical_-_iss_17_-_2026-04-28.pdf ·
Issue 8 (24/06/2024) https://www.fia.com/sites/default/files/fia_2026_formula_1_technical_regulations_issue_8_-_2024-06-24.pdf

Official: Pirelli, "F1 2026 Here we go!" https://www.pirelli.com/global/en-ww/race/racingspot/formula-1/new-2026-f1-rules-187730/ ·
Mercedes, tyre sizes (2026-09-30) https://www.mercedesamgf1.com/news/what-are-the-tyre-options-for-the-2026-bahrain-gp-in-malaysia ·
McLaren MCL40 spec (2026-02-11) https://www.mclaren.com/racing/formula-1/2026/what-is-the-technical-specification-of-our-2026-formula-1/ ·
Formula1.com, driver kit (2014-04-04) https://www.formula1.com/en/latest/article/pre-sakhir-analysis-driver-weight-a-hot-topic.2xDeFJwraCk1lG8k1KRofn

Reported: Race Tech spec round-up (2026-02-10) https://www.racetechmag.com/2026/02/f1s-2026-liveries-and-tech-spec-round-up/ ·
PlanetF1, Williams 772.4 kg (2026-02-04) https://www.planetf1.com/news/williams-fw48-f1-2026-car-weight ·
RacingNews365, car weights (2026-04-02) https://racingnews365.com/the-weights-of-every-f1-car-in-2026 ·
GrandPrix.com, Alpine (2026-01-28) https://www.grandprix.com/news/alpine-hits-2026-weight-limit-as-rivals-struggle.html ·
RaceFans, Horner (2025-05-03) https://www.racefans.net/2025/05/03/fias-2026-f1-weight-limit-was-plucked-from-the-air-and-very-hard-to-hit-horner/ ·
The Race, brakes (2025-08-24) https://www.the-race.com/formula-1/f1-2026-extreme-brake-designs-brembo/ ·
The Drive, Brembo (2026-03-06) https://www.thedrive.com/news/how-brembo-redesigned-f1-brakes-for-the-2026-power-unit-revolution ·
Gasgoo, Brembo caliper (2026-03-13) https://autonews.gasgoo.com/articles/market-industry/breaking-through-f1s-new-regulations-brembo-upgrades-core-braking-technology-deepens-presence-in-china-to-start-a-new-journey-2032413309431603200 ·
Autosport, halo (2018-06-02) https://www.autosport.com/f1/news/how-to-build-a-halo-5110815/5110815/ ·
IMechE, halo (2022-03-03) https://imeche.org/news/news-article/formula-one's-lifesaving-halo-presents-unique-manufacturing-challenges ·
GPFans (2024, updated 2026-03-26) https://www.gpfans.com/en/f1-news/1028252/f1-car-weight-explained/ ·
Motorsport.com ES (2026-09-22) https://es.motorsport.com/f1/news/cuanto-pesa-formula1-evolucion-peso-minimo/10857719/ ·
RacingNews365, paint (2024-02-13) https://racingnews365.com/why-f1-teams-are-using-black-carbon-car-liveries ·
formula1-dictionary.net, monocoque https://www.formula1-dictionary.net/f1-monocoque/ ·
Carscoops, Cadillac wiring https://www.carscoops.com/2287761/gm-cadillac-f1-10-miles-wiring/

GPFans, Motorsport ES and formula1-dictionary name no primary source; they are used only where nothing better exists, and are
marked as such in the JSON.
