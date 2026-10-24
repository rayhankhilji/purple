# Lane CAR3D

Status: P2.T2 merged (PR #12); P3.T2 hero polish part 1 in PR (aspect-adaptive hero), part 2 waits for the UI lane's panel. Owner: agent F (session `session_01DoxHh5Ynx2BDWZsPvLCyDR`). Branch: `claude/car3d-p3-hero`.

Owns: see `docs/agents/PARALLEL_PLAN.md` §1. Update this file at the end of every session (dated section on top; keep older ones).

## The `EI.labCar3D` contract (stable; UI lane builds against this)

Load order in `lab/index.html`: the game's scripts in `index.html` order (at least `vendor/three.min.js`, `js/util.js`, `js/data/season2026.js`, `js/ads.js`, `js/teams.js`, `js/liveries.js`, `js/liveries/*.js`, `js/carmodel.js`, `js/carglb.js`), then `<script src="car3d.js"></script>`. Two things the page must do, both seen in `lab/car3d-test.html`:
- `js/ads.js` resolves brand artwork relative to the page; from `lab/` set `EI.Ads.BRAND_DIR = '../assets/brand/'; EI.Ads.PARTNER_DIR = EI.Ads.BRAND_DIR + 'partners/'` right after the script tag, and call `mount` after `EI.Ads.ready()` resolves (otherwise the livery paints without the logos; no error either way).
- The container needs a CSS height (the canvas fills it; a `ResizeObserver` follows the container).

```js
EI.labCar3D.mount(document.getElementById('car3d'), opts?)   // opts (all optional): { team: 'lumi', num: 7, driver: null, setup: null, baseline: null, ghost: true, orbit: true, pixelRatioCap: 2, background: 0x0a0a0c, ghostColor: 0xb26cff }
EI.labCar3D.setSetup(candidate, { animate: true }?)        // -> { ms, total }: ms is EI.rebuildWings' own time; swaps the wing geometry in place + body y for ride height; animate !== false eases the camera to the hero (600 ms; instant under prefers-reduced-motion)
EI.labCar3D.setBaseline(baseline | null)                   // ghost (thin purple edge lines) of the baseline front elements + rear main plane; shown only while the current setup differs on front_wing_deg / rear_wing_deg / ride_height_mm
EI.labCar3D.hero()                                         // 600 ms ease to the three-quarter rear view with the rear wing in frame
EI.labCar3D.dispose()                                      // stops the rAF loop, frees GL resources, empties the container
// also: EI.labCar3D.view() (internals for tests), .rearAoa() (rad, current rear main plane), .lastMs(), .reducedMotion()
```
`setup` is the ARCHITECTURE §4.1 object; missing fields mean the baseline (25 / 20 / 35). The container receives a `car3d:setup` CustomEvent (`detail: { ms, total, setup }`) on every `setSetup`. Idle motion is a slow sway (±0.22 rad over 26 s) about the hero azimuth, so the rear wing never leaves frame; `prefers-reduced-motion` turns it off and makes `hero()` instant. The view renders only while the camera moves or something changed. The shadow map is rendered once per `setSetup`, not per frame.

Game side (`js/carmodel.js`, opt-in): `EI.CarModel.build(car, setup?)`, `EI.CarModel.wingGeometry(setup?, elementsOnly?)`, `EI.CarModel.rebuildWings(modelOrGroup, setup)` (returns ms), `EI.CarModel.SETUP_BASE / SETUP_K`; aliases `EI.carModel(opts, setup)` and `EI.rebuildWings(target, setup)` as ARCHITECTURE §9 names them. `build()` now also returns `wingMesh`, `bodyY0`, `setup`, and the group carries `userData.carModel`. With no setup every geometry is byte-identical to before (hash check below).

### 2026-10-24 01:05 London — agent F (Claude, session `session_01DoxHh5Ynx2BDWZsPvLCyDR`) — P3.T2 (hero shot, part 1)
- Status: in_progress; this part in PR from `claude/car3d-p3-hero`. Part 2 (final framing against the real lab panel) waits for the UI lane (`lab/index.html` does not exist yet; UI.md unclaimed at 01:00).
- Files changed: `lab/car3d.js` only (+ screenshots `car3d-screens/hero-rw8-{wide,square,tall}.png`, this file). Contract unchanged.
- What changed: the hero distance now fits the frame. `HERO.radius` 7.4 holds for frames at least 1.5:1 wide; narrower frames pull the camera back by `refAspect / aspect` so the car's full length stays in view (`fitRadius`). `hero()`, the reduced-motion jump, mount and resize all use it; the hero target moved back to x = −0.45 and azim 0.68 so the rear wing sits nearer the centre.
- Verify (Playwright, SwiftShader, rear wing 28° with the baseline ghost): wide 1280×800 → aspect 1.97, radius 7.4; square 640×720 → 1.25, radius 8.9; tall 420×760 → 0.89, radius 12.5. 0 console errors in all three; car fully in frame in each (screenshots). `npm test` 71 pass, 0 fail.
- Decisions proposed: none new (D-C1..D-C4 stand).
- Blockers / questions for Tanuj: none. Dependency: UI lane's `#car3d` panel size and aspect for the final hero framing; also please confirm in the lab page that `EI.Ads.BRAND_DIR` is set from `lab/` (see the contract section).
- Next three actions:
  1. When `lab/index.html` lands: open it, check the hero at the real panel size, adjust `HERO` once, screenshot for DESIGN_SYSTEM §8.
  2. Optional 200 ms ride-height translate ease (geometry swap stays instant).
  3. Hand the test page to QA for a GPU timing (`setSetup` ms on the demo laptop).

### 2026-10-24 00:45 London — agent F (Claude, session `session_01DoxHh5Ynx2BDWZsPvLCyDR`) — P2.T2 (F-07)
- Status: done; PR into `claude/amazing-planck-804i13` from `claude/car3d-p2-wings`.
- Files changed: `js/carmodel.js` (wing section moved into `wingGeometry(setup)`; `setupDeltas`, `rebuildWings`, optional `setup` on `build`; new exports), new `lab/car3d.js`, new `lab/car3d-test.html`, `docs/agents/lanes/car3d-screens/*.png`, this file.
- Setup → geometry (ARCHITECTURE §9): rear main plane `aoa = 0.16 + 0.012·(rear_wing_deg − 20)` rad; the four front elements `aoa *= 1 + 0.03·(front_wing_deg − 25)`; `body.position.y = (ride_height_mm − 35) / 1000` (wheels stay on the road). The DRS flap, beam wing, swan necks and endplates do not move.
- Verify step run + output (Playwright, headless Chromium with ANGLE/SwiftShader, `npm run static` on :8788; script kept in the session scratchpad, not in the repo):
  - **T-F07-AC1**: `setSetup({ rear_wing_deg: 30 })` → rear main plane 9.2° → 16.0°; `rebuildWings` 10.4 ms, `setSetup` end to end 10.8 ms (first call); 10 alternating calls 3.8–23.7 ms, all < 200 ms (software GL; a real GPU is faster). The test page prints the same numbers in its log, green when < 200 ms.
  - Ride height 28 mm → `body.position.y = −0.007`; baseline → 0. Ghost hidden at mount and at baseline, shown at rear wing 30.
  - **Default rendering unchanged**: a hash over every mesh's world matrix + position/normal/uv/index arrays of `EI.CarModel.build(car)` with no setup (Mercedes, Ferrari, Lumi): old `3699814338` (184,546 values, 6 children) = new `3699814338`. Identical.
  - Game `index.html` through the static server: 0 console errors, menu visible after load.
  - `prefers-reduced-motion: reduce`: no idle sway (camera position identical 1.5 s apart), `hero()` instant.
  - Resize: viewport 1280×800 → 700×900, canvas followed the container (700×538).
  - `npm test`: 58 pass, 0 fail.
  - Screenshots (1280×800, hero angle): `car3d-screens/hero-baseline.png`, `car3d-screens/hero-rw8.png` (rear wing 28°, ghost of the baseline visible), `car3d-screens/hero-rw30-ac1.png`, `car3d-screens/hero-rh28.png`.
- Decisions proposed (for the integrator to log in TASK_LOG):
  - D-C1 `EI.carModel(opts, setup)` and `EI.rebuildWings(target, setup)` exist as ARCHITECTURE §9 names them, but the canonical entry stays `EI.CarModel.build(car, setup?)` (what `js/car.js` calls); `rebuildWings` accepts the model object or its group and returns the elapsed ms.
  - D-C2 The lab livery is Lumi Racing (the works team already in the game, cream / plum) with #7; the UI may pass `{ team }` to `mount` to change it.
  - D-C3 The ghost of the baseline draws only the parts the setup moves (front elements + rear main plane), as `--purple` edge lines with depth test off, visible only while the setup differs from the baseline.
  - D-C4 three r128 takes material colours as linear: design tokens go through `convertSRGBToLinear()` in `lab/car3d.js` (the background is cleared raw and stays `--bg`). Worth a line in DESIGN_SYSTEM for anyone else drawing in THREE.
- Blockers / questions for Tanuj: none. For the UI lane: the two page-side notes above (`EI.Ads.BRAND_DIR` from `lab/`, container height) and that `lab/index.html` must not load `js/main.js` (it boots the whole game on `DOMContentLoaded`).
- Next three actions:
  1. P3.T2 hero shot: tighten the frame (camera closer / lower, rear wing larger) once the UI lane's container size is known; check it at the lab panel's real aspect; a one-off `hero()` on first candidate select is already in `setSetup`.
  2. Optional: animate the ride-height translate over ~200 ms (geometry swap stays instant per DESIGN_SYSTEM §5).
  3. QA lane: run `lab/car3d-test.html` on the demo laptop's GPU and record the real `setSetup` ms in QA.md.

## Template for a session entry

### YYYY-MM-DD HH:MM London — <agent/session> — <task id>
- Status: in_progress | done | blocked: <what, who>
- Files changed:
- Verify step run + output:
- Decisions proposed (for the integrator to log in TASK_LOG):
- Blockers / questions for Tanuj:
- Next three actions:
