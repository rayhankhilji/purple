# PURPLE · concept car 3D view v3

`EI.conceptView` (same API as v1 / v2) on a car that is **built to the design's dimensions**: every part is generated from the
design parameters (`concept/parts.js`, `design.js`) and fixed 2026 dimensions at its true size, position and angle, in the FIA car
frame. Replaces v2 (the game's GLB car deformed to the design, procedural wings on a "schematic angle scale"; owner: "nowhere near as
detailed as a 3D model should be", and a hot-swapped part must show an accurate version of the actual part).

In-view label: **"concept geometry built to the design's dimensions · FIA 2026 frame · not a team CAD model"**. The dimensioned
features (below) are exact; the shapes between them (surface blends, section shapes, detail parts) are drawn, not measured. Nothing
here is a flow result or a tested shape.

## Files

| file | what | runs in |
|---|---|---|
| `concept/view/mesh3d.js` | pure mesh kit: lofts (segmented rings for hard creases, ear-clipped caps, outward orientation), lathes, swept tubes, rounded slabs, cambered airfoils, monotone cubics | Node + browser |
| `concept/view/car3d.js` | the car: `spec(params)` (every dimension, mm) and nine rebuild groups (`body`, `sidepods`, `floor`, `diffuser`, `front_wing`, `rear_wing`, `wheels`, `suspension`, `details`) → plain vertex arrays in the game-car frame | Node + browser |
| `concept/view/parts3d.js` | three.js: PBR materials, livery projection, carbon weave / metal looks, per-group rebuild, straight-mode blend, ghost, highlight, x-ray, hot-swap flash, materials mode | browser |
| `concept/view/view3d.js` | the viewer (`mount`, `buildCar`, `layout`, views, legend, change tags, screenshot) | browser (tables in Node) |
| `concept/view/index.html` | standalone page: sliders for every parameter, a material selector per material-able part, modes, views, lineage replay | browser |

No GLB is loaded any more (no third-party model, no downloaded assets; all textures are drawn procedurally at run time: livery atlas
from `js/liveries.js`, helmet from the driver's design, tyre sidewall lettering).

## Dimensions: what each parameter builds (FIA frame: X rearward from the front axle, Z up from the plank top, mm)

| parameter | geometry (exact) |
|---|---|
| `layout.wheelbase_mm` | rear axle at X = XR; rear wheels, rear suspension, floor step / diffuser kink (XR−525) / exit (XR+300), rear wing (XR+165…), pylons, crash structure |
| `survival_cell.*` | XA = −offset, XC = XA + cockpit, XPU = XC + gap. The body is lofted through stations pinned to XA / XC / XPU / XR (rings exactly at the anchors); cockpit opening XC−905 … XC−30; halo, driver, airbox, mirrors, sidepod inlet (XC−600) placed from XC |
| `front_wing.span_mm` | elements end at \|Y\| = span/2; endplates at span/2 + 6 |
| `front_wing.chord_mm` | local chord c(Y) = chord · env(Y) / mean env over the span, env = the trimmed RV-FW-PROFILES X extent (App. C2 §21-22, `regs.fwEnvelopeX`); LE on the envelope's front plane. The **mean of the built X extents = chord** |
| `front_wing.elements` | number of profile volumes (main plane + flaps, slot gaps 1.2 % c + 4 mm, overlaps 9 %) |
| `front_wing.aoa_deg` | flaps' chord lines at the setting (true degrees); main plane at setting / 5 (one element: setting / 2). The model `regs.fwStraightExtent` uses: main plane = 1/n of the X extent, flaps (n−1)/n |
| `front_wing.sm_delta_deg` | straight mode: the flap group rotates rigidly by −δ about an axis on the flap group's chord line level with the first flap's LE (≤ 20 mm from it; C3.10.10(d)(ii) allows 25) → the built straight-mode extent matches `fwStraightExtent` |
| `rear_wing.span/chord/elements/aoa` | same chain model; LE at XR+165 (RV-RW-PROFILES §30), X extent = chord at every station; main plane's lowest point on the RV bottom plane (Z 725 → 785 outboard), the stack moved down if its top would pass the endplate top |
| `rear_wing.endplate_top_mm` | endplate top Z; endplate per RV-RWEP-BODY (§31): \|Y\| = span/2 + 8 above Z 690, swept in to \|Y\| 360 at Z 420…250, LE XR+160 (raked to XR+375 at Z 250), TE XR+740 (to XR+625) |
| `rear_wing.sm_delta_deg` | flap rotates by −δ about its TE inboard of \|Y\| 530; the tips outboard of 535 are separate fixed pieces (C3.11.6(a)) |
| `floor.width_mm` | floor body max \|Y\| = width/2 at XF 1100, tapering 70 mm to the step at XR−335, then 400 → 365 to the exit (App. C2 §4.9 polygon, scaled) |
| `floor.throat_mm` | venturi tunnel roof Z = throat from max(1500, XC) to the kink; inlet roof 150 mm higher at the leading edge (XF 720) |
| `floor.ride_height_mm` | plank bottom at the ride height above the ground; everything sprung moves with it, wheels stay on the ground |
| `diffuser.expansion_deg` | tunnel roof ramp at the angle from XR−525 (§4.20 diffuser cut start) to XR+300; the keel lifts into it (one open channel), strakes, gurney, outer kick-up |
| `sidepods.inlet_cm2` | inlet opening per side = inlet/2: superellipse n = 4, aspect h/w 0.55, scaled so its **polygon** area is exact; sidepod width follows (shoulder = inlet outer edge + 30) |
| `sidepods.undercut_mm` | horizontal depth from the shoulder to the pod's bottom edge (undercut curve), full depth from the inlet to the ICE face, tapering in the coke bottle; the bottom edge sweeps from the shoulder at the inlet down to the floor 520 mm back |
| `params.<part>.material` | the part's look (below); v2's morph interpolated every key and broke on this string: fixed (strings are taken as is) |

Fixed 2026 dimensions (`car3d.DIM`, each with its source in the code): tyres front 705 mm OD / 280 mm tread, rear 710 / 375
(Pirelli 2026 via Mercedes-AMG F1's tyre guide; "width" drawn as the tread, the sidewall runs out to the rim), 18-inch rims with the
C10.7.2 lip diameter 496 and overall widths 334 / 420.3, no wheel covers (dropped for 2026), 10-spoke rims; static deflection 8 mm
(the contact patch is flattened); track 1580 / 1520 (`parts.js` mass sheet = `physical.js` REF_V0); discs 335 / 270 (C11.3.3
ranges 325-345 / 260-280); plank 10 mm, 300 mm wide, three Ø34 holes at XF 500, XC−700, XPU+550 with titanium skids (C3.6.1);
front-wing endplate per RV-FWEP-BODY (§23: front plane, top plane to Z 375, cut by the Ø925 tyre cylinder about [XF 0, Z 360]),
outer footplate (§24), dive plane (§26), strakes (§27); rear wing pylons per RV-RW-PYLON (§32, \|Y\| 50-110); mirrors ahead of the
sidepod with inner and rear stays (C3.7.5); push-rod suspension front and rear.

### Dimension-accuracy test (`test/concept-view-dims.test.js`)

Builds the meshes in Node (the same vertex arrays the browser uploads) for 11 designs (generic and RB22 baselines, five hand-set
extremes inside the domain, four seeded mutation chains) and measures them. Worst deviation over all designs (tolerance 2 mm,
angles 0.3° / 0.1°, inlet area 0.5 %):

| quantity | worst | | quantity | worst |
|---|---|---|---|---|
| wheelbase (tyre centres) | 0.000 mm | | front wing half span | 0.000 mm |
| front track | 0.000 mm | | front wing mean chord (trapezoid over 65 stations) | 0.976 mm |
| tyre OD front / rear | 0.000 mm | | FW element angles (main, flaps) | 0.000° |
| tread width front / rear | 0.000 mm | | FW straight-mode mean X extent vs `regs.fwStraightExtent` | 0.906 mm |
| plank bottom = ride height, thickness 10 | 0.000 mm | | rear wing half span / LE at XR+165 | 0.000 mm |
| cockpit opening XC−905 / XC−30 | 0.800 mm | | rear wing chord at every station | 0.695 mm |
| body section at XA, at XPU | 0.000 mm | | RW element angles | 0.000° |
| floor body half width | 0.607 mm | | rear endplate top Z | 0.000 mm |
| venturi throat (tunnel roof Z) | 0.000 mm | | inlet area per side (polygon) | 0.003 mm² |
| diffuser expansion angle | 0.000° | | undercut depth | 0.000 mm |

Legal designs (no `regs.check` violation for the rule) are also checked against the regs.js limits: nothing but the wheels beyond
\|Y\| 950 (C2.3.1), every front-wing station inside RV-FW-PROFILES' X range, rear wing inside XR+165…630, \|Y\| ≤ 575, profiles and
endplate under Z 880, floor body \|Y\| ≤ 770. `npm test`: 258 tests, 0 failures.

## Detail inventory

- **Body**: one loft from the nose tip to the crash structure (≈ 200 stations × 74-point sections with a rounder keel under the nose),
  the cockpit opening cut in the same rings (painted outer skin, dark interior), airbox / roll hoop with an open intake and duct,
  T-camera (yellow for the team's second car, as the rules colour it), engine-cover fin, cooling exit, FIA nose camera pods,
  antenna, rain light, exhaust tailpipe (C3.9).
- **Sidepods**: rolled inlet lip around the exact inlet opening, dark duct and radiator face, undercut, coke-bottle taper, six
  raised louvre gills over dark slots.
- **Front wing**: n lofted cambered elements (inverted NACA-type sections, round LE, blunt TE with its own crisp face, slot gaps),
  painted tops / bare-carbon undersides, endplates (rounded 10 mm slabs with the livery's endplate design), outer footplates,
  dive planes, tip vortex generators, under-wing strakes, nose pylons, straight-mode actuator fairing and linkages.
- **Rear wing**: main plane + flap(s), fixed tips outboard of Y 535, swept-in endplates with ERS / lateral light strips, slanted
  pylons, actuator pod; the top surfaces carry the livery's top view (ORACLE).
- **Floor**: bib, floor body with venturi tunnels and upturned edge, four inlet fences per side, wheel-wake control boards on a
  foot plate, floor-edge winglet on a stay, plank with holes and titanium skids. **Diffuser**: ramp, open central channel, strakes,
  outer kick-up, exit gurney.
- **Wheels**: 2026 tyres (lathed profile, shoulders, crowned tread, flattened contact patch) with PIRELLI / P ZERO sidewall lettering
  and the compound stripe, 10-spoke magnesium rims at the C10.7.2 lip diameter, centre-lock nut (12 flats), brake bell, carbon-
  carbon disc, caliper, duct drum and inlet scoop; rear wheel-bodywork winglets and fence.
- **Suspension**: push-rod front and rear, aero-section wishbone legs, push rods, track / toe rods, uprights, rear driveshafts;
  sprung pick-ups move with the ride height, outer joints stay on the uprights.
- **Cockpit**: halo (faired titanium tube, three mounts), driver helmet with the driver's design and a visor, HANS / shoulders,
  headrest pads, steering wheel with display, mirrors (housing, glass, stays).
- **Materials**: livery paint (clear coat + flake, projected from the livery designs' side and top views, composited in sRGB like
  the game's canvas), carbon weave (2×2 twill / plain / spread tow, triplanar, fades below a pixel), metals (titanium, aluminium,
  Al-Li, magnesium, steels, Inconel, tungsten, MMC, AlBeMet), carbon-carbon, rubber, glass, LEDs. Smooth normals inside each piece,
  hard creases between ring segments and plates; rounded slab edges.

≈ 104 k vertices / 180 k triangles for the whole car.

## Materials mode

`setMode('materials')` (button on the standalone page): every part in its material's finish, livery off, with a legend grouping the
parts by material ("(changed)" for a non-baseline material, "(regulation)" for parts whose material is fixed: halo Ti-6Al-4V,
magnesium rims, carbon-carbon brakes). The look comes from `params.<part>.material` or the part's baseline material
(`concept/materials.js` PARTS). In solid mode painted surfaces keep the livery, and the bare surfaces of a part (floor, wing
undersides, suspension, pylons…) show its material, so an aluminium floor reads as aluminium under the car. The looks are visual
approximations (colour, roughness, metalness, weave type), not measured optical data. `parts3d.LOOKS` covers every material id in
`concept/materials.js` (tested).

## RB22 look and concept families (view-rb22, 2026-10-24)

**Look.** The car is laid out from the 2026 RB22 launch photos (`concept/view/livery-rb22.js`, `car3d.CK`): broad blunt nose, high
chassis, upright rounded-square inlets under the mirrors, downwash pods, high engine-cover deck, black halo, black rims with a blue
lip band and fluorescent nuts. Livery: gloss deep "heritage" blue with the darker jacquard pattern (the 2026 car is gloss, not the
2022-25 matte: Red Bull's launch notes and photos; `finish: "matte"` still gives the old look), the large charging bull over the
engine cover with the yellow airbox "sun", Red Bull wordmark, ORACLE on the pods, yellow nose with a red bull, Mobil 1 / Heineken
on the rear endplates, carbon fin with the number. Partner marks come through `EI.Ads` artwork or plain styled text.

**Concept families** (`car3d.CONCEPTS`; ids and baseline codes from docs/concept/REDESIGNS.md §1; a missing, garbage or out-of-range
code reads as the baseline code / is clamped; code-id strings are accepted). Every variant is real geometry; the continuous
parameters keep their exact meaning under every variant (the dimension test runs every variant: inlet area, undercut, wing chords
and angles at the centre, floor width / throat, endplate top, |Y| ≤ 950 for legal designs).

| family | variants (what is built) |
|---|---|
| `sidepods.concept` | 0 downwash: upright inlet (superellipse n 3.4, h/w 1.0), top falling away behind it, tight coke bottle · 1 zeropod: tall slot inlet (h/w 2.3) against the chassis, the pod folds into the body within ~0.5 m of mid-pod · 2 ramp: letterbox inlet (h/w 0.42), wide flat-topped pod staying high to the ICE then ramping down, a 46 mm inboard gully on its top |
| `nose.concept` | 0 long low (tip XF −1215 on the main plane) · 1 short high (tip XF −985, ~110 mm higher, blunter; the FW pylons rake back up to the nose) |
| `front_wing.endplate` | 0 open/outwash: plate cut down to just over the flap tips, rear third flared 70 mm outboard, wide footplate · 1 closed/inwash: full plate to Z 375 leaning 26 mm inboard, a 70 mm inboard curl along its top |
| `rear_wing.style` | 0 spoon: flaps washed out 9° and lifted 70 mm at the tips, endplate cut away below Z 500 and trimmed at the top front, no gurney · 1 medium: flat, 6 mm gurney · 2 high downforce: washed in +6° at the tips, 16 mm gurney, full endplate with three strakes. Centre angle = the setting, X extent = chord everywhere |
| `floor.edge` | 0 plain edge · 1 edge rolled up and inboard into a ~90 mm scroll, four toed-out fences and an edge wing ahead of the rear tyre (never beyond the floor's half width) |
| `cooling.layout` | 0 standard: louvre grille on the cover flank · 1 roll-hoop intake 1.3×, five gills across the pod tops, exit 1.3× · 2 compact: intake 0.78×, nine rows of louvres on the cover top, exit 0.6× |
| `engine_cover.style` | 0 high shark fin from behind the ICE to just ahead of the rear wing · 1 low narrow cover: deck up to 72 mm lower and 14 % narrower behind the ICE, no fin |
| `suspension.front` | 0 pushrod (lower outer end → high inboard rocker) · 1 pullrod (upper outer end → low inboard rocker); the rod's ends move continuously |

**Morph.** `setDesign(..., { animate: true })` morphs every family continuously over the existing 450 ms tween: `mixParams` adds
`params.__cmix[key] = { from, to, t }`, and `car3d.spec` turns it into per-variant weights (`S.cc`, `S.cw`) that blend rows, sizes and
endpoints; features that exist in one variant only grow from / shrink to nothing. Off under reduced motion (instant swap, no flash).
**Highlight.** After a change the white flash now covers only the items whose geometry changed (`car.snapshot()` before, signature
compare after), and the change tags name the variants (`Sidepods · downwash → ramp`, labels from `parts.CONCEPTS` when present).

Numbers (SwiftShader, warm, ghost on): one slider change p50 ≈ 22 ms (p90 50-60 ms); one concept switch p50 ≈ 16-19 ms (p90 ≈ 45-60
ms); a morph frame with one family ≈ 12 ms, with four families at once ≈ 40-80 ms. The baseline ghost's builds are cached by group
key. Renderer geometries stay 178-226 over 24 redesigns with mode switches and return to 157 at the baseline (no leak). Screens:
`docs/agents/integrator-screens/view-rb22/`.

## Hot swap

`setDesign` rebuilds only the groups whose dimensions changed (each group has a key of the spec values it depends on; a material swap
refreshes only that part's looks), morphs from the previous design over 450 ms (the changed groups are rebuilt per frame), then
flashes the rebuilt parts (white additive Fresnel, 0.9 s) and tags each changed part with its changes, e.g.
`Front wing assembly · span 1300 → 1240 mm · wing setting 25° → 33° · profile volumes 3 → 2` or
`Floor · material T800S carbon → aluminium 7075-T6`. Tags follow the part on screen, are drawn into `screenshot()`, and clear on the
next change or `setHighlight([])`. The baseline ghost (purple Fresnel, per-vertex where the topology matches) and the amber highlight
work as in v2. Straight mode is a per-vertex blend between the corner and straight-mode builds of the moving items (no rebuild per
animation frame). `opts.changeTags: false` turns the tags off.

## API compatibility

`mount(el, opts)` → `setDesign, setHighlight, setMode, setView, setAero, screenshot, labelText, stats, dispose, render, state, ready,
el, canvas`, `EI.conceptView.VIEWS`, options `label, legend, orbit, view, design, baseline, mode, parts, livery, driver` (+ `changeTags`)
— unchanged. Additions: mode `'materials'`; views `floor` (from below, lit), `sidepod`, `diffuser`, `cockpit`, `wheel`;
`state().rebuilt / changes`; `setDesign(...)` returns `{ ms, rebuilt }`; `conceptView.changesBetween(a, b)`.

`EI.conceptView.buildCar(design, { livery, driver, baseline, lod, straight })` → a plain `THREE.Group` in the game-car frame (metres,
+x forward, +y up, +z right, ground y = 0, front axle x = +1.75, rear axle x = 1.75 − wheelbase): `.ready`, `.setDesign`, `.setAero`,
`.dispose`; `userData.frontAxleX / rearAxleX / wheelCentreY (0.3445) / wheelCentreYRear (0.347)`. `lod: "lo"` = 2048 px livery atlas
(4096 for "hi"). It no longer needs `js/carglb.js` or the GLB; it loads the livery scripts and the three geometry modules if the
page lacks them. Checked in a bare three.js page: two cars, renderer geometries 0 → 290 → 0 after `dispose()`, 0 console errors.

## Numbers (headless Chromium, SwiftShader, 4 cores, 2026-10-24)

- Full car build (all nine groups, incl. the wings' straight-mode states, uploads and the livery reference coordinates): 61 ms warm
  (body 10.5, front wing 11.3, wheels 10.3, rear wing 9.6, details 8.1, sidepods 6.7, floor 2.4, suspension 0.9, diffuser 0.8);
  first build after mount ≈ 260 ms (cold JIT, measured with other browsers running). Node, same geometry: 87 ms average.
- One part rebuilt: front wing 12-23 ms (with its straight-mode state), rear wing 10-13 ms. A whole `setDesign` over 30 random
  designs (with the baseline ghost's builds, material swaps and mode switches): p50 105 ms, p95 272 ms, max 324 ms.
- GPU memory over those 30 designs with materials, ghost, x-ray / materials mode and flap toggles: geometries 129-284 (150 at start,
  129 at the end), textures 7-8 constant; `dispose()` frees everything. 0 console errors on `/concept/view/` and `/concept/lab/`
  (and in every screenshot run).
- Timings measured with the machine otherwise quiet; with five SwiftShader renderers in parallel the same rebuilds take 3-10× longer.
- SwiftShader renders a frame in ~0.5-1 s, so on-screen animation is choppy there; `screenshot()` evaluates the flash at the current
  time so captures are deterministic.

## Screenshots (`docs/concept/view-v3-shots/`)

Baseline RB22: 01 hero, 02 side, 03 top, 04 front, 05 rear ¾; close-ups 06 front wing, 07 rear wing, 08 diffuser, 09 floor underside,
10 sidepod, 11 wheel / 2026 tyre, 12 cockpit / halo; 13 the 200-generation optimiser best (seed 1, physics sim) over the baseline
ghost with change tags; 18 top baseline vs best; materials mode 14 baseline, 15-16 with swaps (Ti front wing and front suspension,
Al floor, aramid rear wing, E-glass sidepods, PBO engine cover, Al-Li rear suspension), 17 the same swaps in solid mode;
hot swaps (before | after with ghost + tags, and the flash): 20 front wing, 21 rear wing, 22 floor + diffuser, 23 sidepods,
24 survival cell + wheelbase, 25 material swap; 29 corner vs straight mode; 30 x-ray mass; 31 `buildCar` in a bare scene;
32 standalone page; 33 the concept lab. v2 for comparison: `docs/concept/view-v2-shots/`.

## Sources

- FIA, 2026 Formula 1 Regulations, Section C [Technical], Issue 19, 25/06/2026 (the issue `concept/regs.js` cites): C2.3, C3.6.1
  (plank), C3.7.5 (mirrors), C3.9 (tailpipe), C3.10.10 / C3.11.6 (active flaps), C10.7.2 (rims), C11.3.3 (discs); Appendix C2 §4
  (RV-FLOOR-BODY), §16 (RV-SIDEPOD), §21-28 (front wing profiles, endplate, footplates, dive plane, strake), §30-32 (rear wing
  profiles, endplate, pylon). https://www.fia.com/system/files/documents/fia_2026_f1_regulations_-_section_c_technical_-_iss_19_-_2026-06-25.pdf
- 2026 tyre sizes (front 280 × 705, rear 375 × 710, 18-inch): Mercedes-AMG F1, "What are the tyre options for the 2026 British GP",
  https://www.mercedesamgf1.com/news/what-are-the-tyre-options-for-the-2026-british-gp ; F1Technical, "Things to know about the new
  2026 F1 tyres", https://www.f1technical.net/news/28128 ; Motorsport.com, https://www.motorsport.com/f1/news/the-challenges-pirelli-faces-to-meet-f1s-2026-rules-targets/10623997/
- Car-level changes (wheelbase 3400, width 1900, floor 150 mm narrower, front wing 100 mm narrower, no beam wing, no wheel bodywork /
  arches, wheel-wake boards, ERS lights): The Race, "F1 2026's brand-new car rules explained",
  https://www.the-race.com/formula-1/f1-2026-new-car-rules-explained/ ; Formula1.com, "Unpicking the 2026 aerodynamics regulations",
  https://www.formula1.com/en/latest/article/explained-2026-aerodynamic-regulations-fia-x-mode-z-mode-.26c1CtOzCmN3GfLMywrgb2 ;
  Crash.net, https://www.crash.net/f1/news/1050183/1/f1-2026-regulations-changes-aero-chassis-engine
- No wheel covers in 2026, push-rod front and rear: The Race, "Six things Audi shakedown told us about F1 2026 designs",
  https://www.the-race.com/formula-1/six-things-audi-shakedown-told-us-about-f1-2026-designs/ ; PlanetF1, "Push-rod vs pull-rod",
  https://www.planetf1.com/f1-tech/push-rod-vs-pull-rod-how-f1-teams-are-shaping-2026-suspension-strategies
- RB22 facts and livery: `docs/concept/REDBULL.md`, `js/liveries/redbull.js` (rear-wheel winglets: the Silverstone package).

## Known limits

- Shapes between the dimensioned features (body sections, sidepod surfaces, detail parts, positions of halo / mirrors / driver relative
  to XC) are drawn from the 2026 regulations' reference volumes and photos, not measured; the rules' drawings (RV-PLANK, RV-DIFF,
  RV-HALO, the wheel-area volumes) were not available as text and are approximated.
- Where the concept model and the FIA volumes disagree the parameter wins and the view shows it: a 100 mm throat sits above
  RV-FLOOR-BODY's Z 75 roof between XF 1775 and XR−600; at 14° the diffuser exit is ≈ Z 306 (the floor body's own trim is Z 250;
  RV-DIFF is a drawing); flaps at high settings rise above RV-FW-PROFILES' Z limits (regs.js checks the X extent only).
- Tyre "width" is the published tread width; the overall tyre width follows the rims (C10.7.2), so tyres are wider than 280 / 375
  overall. Track widths are the concept's (1580 / 1520), so the rear tyres reach \|Y\| ≈ 977 (C2.3.1 excludes tyres).
- The livery designs are drawn for the game car's proportions; they are projected through the design's anchors (XA, XC, XPU, XR), so
  decals stay on their parts when the cell or wheelbase changes, but a very different sidepod shape can stretch a decal.
- Material looks are visual approximations (no measured BRDFs); carbon weave is procedural.
- Film tool (`concept/tools/film.js`, not this lane): v3 still loads asynchronously (livery scripts and geometry modules, well under a
  second locally), so the two-line `await cv.ready()` fix from the v2 notes still applies.
