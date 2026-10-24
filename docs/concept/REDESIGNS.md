# PURPLE CONCEPT - Redesigns: discrete concept families (redesigns v1)

The concept car can change **shape and style on purpose**, not only by slider tweaks: eight parts carry a discrete *concept family*
parameter (an integer code). Each code changes, consistently, the part's mass and CoG, its aero (downforce per axle, drag, balance,
ride-height sensitivity, straight-mode effect), cooling capacity, and where relevant its legality. Every number in this file is a
**model assumption or a sourced estimate, labelled as such**; nothing here is CFD, wind-tunnel or track data. Lap times that come out
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
- `aeromap.evaluate(p).concepts` → per family `{ code, id, df, cd, front, cool, … }`: the aero deltas the concept applied (for the
  engine's explanations and the dashboard).
- `design.describe` / `design.diff` treat a concept change like any parameter change (`from`/`to` are integer codes).

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

(filled in below by redesigns v1; every magnitude carries its source or the label "assumption")
