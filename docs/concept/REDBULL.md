# Red Bull RB22 + Red Bull Ford DM01: public technical dossier

Baseline team for the PURPLE Silverstone lap simulator. Researched 2026-10-24 (every source accessed that day); season context runs through 2026-10-18 (17 rounds). Data, sources, articles and quotes: `concept/data/redbull-2026.json`. Regulation text: FIA 2026 Section C [Technical] **Issue 19** (25 June 2026, in force at Silverstone). Every article cited below was also checked word for word in Issue 21 (19 Oct 2026); only C5.2.8 iii and C5.2.10 ii differ (see `DATA.md`).

Kinds: **regulation** (read in the FIA PDF), **official** (FIA, F1, Red Bull, Ford), **reported** (press), **measured** (OpenF1 timing/telemetry in this repo), **derived** (arithmetic, method stated), **unknown** (not public).

## 1. Power unit: Red Bull Ford DM01

**Fixed by regulation.** 1600 cc V6 at 90°, bore 80 mm, 4 valves per cylinder (C5.1.2-4, C5.4.1). Geometric compression ratio of 16.0 or less, checked hot (130 °C) as well as cold from 1 June 2026 (C5.4.3). Single turbo, 150,000 rpm or less, with no energy taken off the shaft (C5.3.1, C5.3.6). Intake pressure below 4.8 bar abs (C5.3.2). **No MGU-H**: only the engine and the ERS-K may propel the car or recharge (C5.2.1). The term "MGU-H" appears nowhere in the text. Fuel energy flow is capped at 3000 MJ/h, which is 833 kW of fuel power (C5.2.3). Below 10,500 rpm the cap is EF = 0.27·N + 165 (C5.2.4). MGU-K: 350 kW DC (C5.2.7) and 500 Nm (C5.2.11). Deployment tapers with speed: P = 1800 − 5v, so full power is available to 290 km/h and nothing from 345 km/h. With Overtake the taper is 7100 − 20v (C5.2.8). The ECU converts electrical to mechanical power at a fixed 0.97 (C5.2.21). Energy store: 4 MJ state-of-charge window (C5.2.9). Recharge is capped at 8.5 MJ/lap (C5.2.10); at Silverstone the cap was **6.5 MJ in qualifying** and 8.0 MJ in the race (FIA Doc 7). Minimum masses: PU 185 kg, ICE 130-134 kg, MGU-K 16-20 kg, ES enclosure 35 kg, turbo 12 kg (C5.5, C5.18.7, C5.17.9, C5.3.4).

**Rev limit: the regulations set none.** Section C has no maximum crankshaft speed. C5.14 only requires every high rev limit to sit inside a 750 rpm band. The 15,000 rpm in C9.8.2 is a launch-gear test speed. Fuel sets the practical ceiling: the C5.2.4 curve reaches 3000 MJ/h at exactly 10,500 rpm, so extra revs earn no extra fuel. Motor Sport Magazine and Wikipedia's RB22 infobox both print "15,000 rpm", but that wording is not in Issue 19 or 21. **Measured:** Hadjar peaked at 12,320 rpm on his Q3 lap. Full-throttle rpm in 6th to 8th gear spans about 9,000 to 12,200.

**Official statements.** The power unit was launched as DM01 on 15 Jan 2026. Ford's stated role (3 Feb 2023) is "battery cell and electric motor technology as well as power unit control software and analytics". Ford's chief engineer says Ford supplies 12 components, including MGU-K and turbo parts, and writes the battery charge-cycle software (auto motor und sport, Jan 2026). A sixth-generation unit was running race simulations on the dyno at launch. No dated first fire-up was found in any official release. **The cell supplier is not public.** Red Bull, Ford and RBPT have published **no power, torque or efficiency figures**.

**Official FIA ranking (ADUO, ICE only).** In period 1 (to Canada), Mercedes was 2-4% below the best ICE, and Audi, Ferrari and Honda were more than 4% below it (FIA, 26 Aug 2026). The FIA does not name the benchmark. Sky Sports and Auto Action report that it is **Red Bull Ford**, which therefore received no upgrades. The index is built from engine speed, shaft torque and MGU-K power, and formula1.com says it is "not representative of full power unit performance". Mekies: Mercedes has "the most powerful power unit" overall.

**Reported.** The generic 2026 ICE figure is about **400 kW (536 hp)** (Motor Sport Magazine). redbull.com gives about 745 kW total. Wolff called Red Bull the deployment "benchmark" on day 1 of the Bahrain test, and Wache disputed it. Reliability problems:
- HAD power unit failure in Australia.
- VER engine death at the Monaco start.
- VER ICE fault in Baku: "too fragile at times".
- HAD powertrain failure in Singapore Q1.
- At Silverstone, VER said the engine was "not responding normal".

**Not public:** DM01 ICE kW, torque curve, power curve, efficiency/BSFC map, deployment and harvest maps, and ES chemistry.

## 2. Gearbox and driveline

**8 forward gears** (C9.6.1), no CVT. Teams nominate the ratios to the FIA at or before the first event. **In 2026 only**, one change of the ratio pairs and final drive is allowed, with one revert (C9.6.2). Ratio pairs must be steel, at least 12 mm wide and 600 g (C9.6.3-4). Shifts may take at most 200 ms up and 300 ms down (C9.8.4). Driveline plus gear-change parts must weigh at least 22 kg (C9.5.2). Red Bull's spec sheet: "Red Bull Technology designed and built 8 speed transmission". **Ratios are not public.** Measured on HAD's Q lap, rpm per km/h in gears 4 to 8 is 61.2 / 53.1 / 45.8 / 40.0 / 35.7. That gives about 336 km/h at 12,000 rpm in 8th. The lap used gears 2 to 8.

## 3. Chassis RB22

- **Mass:** reported at +9 to 10 kg over 768 kg in April (RacingNews365), then about +6 to 7 kg in June (The Race, inferred from about 0.2 s/lap). Weight came off at Miami, with more due in Austria. The exact mass is unknown.
- **Concept:** low drag, strong in low-speed corners and traction, weaker in medium and high-speed corners, with aero degradation flagged at Monza (The Race, Oct 2026).
- **Suspension:** pushrod front and rear (Gary Anderson; GPFans). Wikipedia lists pull-rod front, which conflicts.
- **Bodywork:** small but not "zero" sidepods, heavily slotted bargeboards, small floor louvres, and a cut-out in the diffuser side.
- **Active aero:** from Miami, a rotating upper rear flap that goes "up and over from the rear", with a central actuator. Rotation is reported at about 160-180°, which is unconfirmed. Twice the wing failed to return to Corner Mode: VER's qualifying crash in Austria and his race crash at Stowe at Silverstone. Both drivers reverted to an older wing for Spa.
- **Upgrade path:** Miami (wing, sidepods, floor, mass) → Austria (sidepod inlet, floor, rear suspension fairings) → **Silverstone: rear wheel bodywork winglets, cascade elements changed** (FIA Doc 13) → Baku.

## 4. Silverstone 2026 (round 9, sprint weekend)

| | VER #3 | HAD #6 |
|---|---|---|
| Sprint Quali / Sprint | P3 88.697 / P6 (3 pts) | P8 88.835 / P9 |
| Qualifying | P7 88.893 (+0.782) | **P5 88.746 (+0.635)** |
| Q speed trap (FIA) | 304.3 km/h | 305.8 km/h (pole ANT 302.6) |
| Race | DNF, 46 laps, rear wing stayed open into Stowe, SC lap 48 | **P5, 10 pts** |
| Stints (OpenF1) | M 1-17, H 18-38, M 39-46 | M 1-19, H 20-38, M 39-47 (front wing change), S 48-52 |
| Race fastest lap / trap | 92.101 / 330.8 | 92.268 / 331.7 |

All values match `grid-2026.json` and `season2026.js`. **Measured, HAD against pole (ANT):**
- Sectors +0.094 / +0.310 / +0.231 s.
- The losses are in fast corners: Becketts minimum 229 vs 245 km/h, Stowe 225 vs 236.
- Slow corners and top speed are level: 316.0 vs 316.9 km/h.

**Reported:** VER said the car had "no balance" and was "slow on the straights", and that the battery ran out late in the lap. Mekies called it "a step backwards" from Austria. Red Bull carried two new medium sets into the race. **Wing level and ride heights were not reported.**

## 5. Season to 18 Oct 2026

After round 17, Red Bull is **4th in the constructors' standings with 332 points**: Mercedes 578, Ferrari 444, McLaren 339. VER is 4th on 221, HAD 8th on 97. Lawson drove the second car in rounds 12-14. VER won from pole in rounds 16 (Bahrain GP, held at Sepang) and 17 (Singapore). The trend is rising: from about 1 s off early in the year, the car-only qualifying gap fell from a season average of 0.5% to 0.15% over the last five rounds (repo model).

## What the simulator can take

| Exact (regulation) | Measured (telemetry-derivable) | Reported (estimate, range) | Unknown |
|---|---|---|---|
| 1.6 L V6 90°, CR ≤ 16.0, no MGU-H (C5.1, C5.4.3, C5.2.1) | Peak about 12,300 rpm; rpm per km/h for gears 4-8 (HAD Q lap) | ICE about **400 kW** generic; sim envelope 375-420 kW (*derived*: 833 kW × η 0.45-0.50) | DM01 ICE kW |
| Fuel 3000 MJ/h; 0.27N+165 below 10,500 rpm (C5.2.3-4) | Q trap 305.8 km/h, race trap 331.7 km/h | DM01 ICE best per FIA ADUO; Mercedes −2 to 4%, others below −4% | Torque and power curves |
| MGU-K 350 kW, taper 1800−5v, 500 Nm, ×0.97 (C5.2.7-8, .11, .21) | Corner minima and braking points (±20 m) | Total about 745-750 kW | Efficiency / BSFC map |
| ES window 4 MJ; Q recharge 6.5 MJ/lap at Silverstone (C5.2.9-10, Doc 7) | Full throttle 72% of distance; speed fade on straights | Car +6 to 10 kg over 768 kg | Deployment and harvest maps |
| 8 gears; shifts ≤ 200/300 ms (C9.6.1, C9.8.4) | Sector times, stints, compounds | Low drag, strong low speed, weaker high speed | Gear ratios, final drive, tyre radius |
| Min mass 726 kg + NTM in Q; axle split ≥ 0.44 / 0.54 (C4.1-2) | | Pushrod front and rear | CdA and ClA per mode; aero balance |
| Active aero: 2 positions, ≤ 400 ms, fails to Corner Mode (C3.10.10, C3.11.6) | | Rear flap about 160-180° | Exact mass, CoG, ride heights, Silverstone wing level |
| No crank rev cap (C5.14 band only) | | | ES cell supplier and chemistry |
