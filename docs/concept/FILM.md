# PURPLE · concept evolution film

A 20 s, 1920x1080, 30 fps clip for the demo video: the concept car changing shape generation by generation as the optimiser reshapes
it. Made by `concept/tools/film.js`; media in `docs/deck/film/`. Branch `claude/concept-film`.

## Re-render (one command)

```
node concept/tools/film.js                                  # optimise (seed 1, 200 gens, sim v0) -> frames -> mp4 + webm + posters
node concept/tools/film.js --sim ./concept/sim/index.js     # same film with the physics simulator's lap times (and its label on screen)
node concept/tools/film.js --lineage /tmp/run --shots 0,300,599   # replay a `node concept/cli.js --out /tmp/run` run; just look at frames
```

Needs Node 22, `playwright` (global or in `node_modules`; the script installs nothing and uses the Chromium already on the machine) and
`ffmpeg` on PATH (or `--ffmpeg PATH`). It starts `server/static.js` on `--port` (8892) as its own child and kills that PID at the end;
it never touches `data/` and makes no network or Mubit call. Rendering is deterministic (the page's `requestAnimationFrame` is
stubbed and the script drives camera, morph and overlay per frame), so the same lineage gives the same film. About 1 s per frame under
SwiftShader (about 10 min for 600 frames), plus about 2 min to encode. `node concept/tools/film.js --help` lists every option
(`--seconds`, `--fps`, `--formats`, `--crf`, `--poster-view`, `--frames N` for a quick test).

## What is on screen

- The real concept view (`EI.conceptView`, `concept/view/view3d.js`): a slow orbit from a front three-quarter to a rear three-quarter,
  the baseline outline on (purple), the parts changed in the current generation tinted amber (`setHighlight`).
- Every KEPT generation of the run (50 for seed 1) is replayed onto the baseline with `design.applyChanges` (what
  `concept/view/index.html` does with a lineage file) and the parameters are interpolated between consecutive kept designs for smooth
  motion (`setDesign(..., { animate: false })` once per frame). Early steps are slower so the first changes can be read; later ones
  fast-forward. 1.4 s holds on the baseline at the start, 3.2 s on the best design at the end.
- A lower-third drawn in the stage page: generation n / 200 (kept generations only; the counter ends at 200 / 200), lap time (s) and
  delta vs the baseline, parts changed k of 23, the last change in plain words (for a multi-parameter generation: the largest move
  large, the others under it). "Parts" are the 23 shape parameters of `concept/parts.js`, the unit the optimiser changes.
- The honesty lines, always on screen: `concept geometry from the design parameters · schematic, not a CAD model` and
  `lap times: <sim label>`. The sim label is the sim's own `label` (for sim v0: the bench's `V0_LABEL`, "concept · reduced-order lap
  model · calibrated to 2026 pole laps · concept aero map v0 · sim v0 (game lap model, relative to the baseline concept car)"). The script
  refuses to render if any on-screen text contains CFD, wind tunnel, validated or aerodynamically tested.

## Swapping the simulator

`--sim MODULE` takes a module exporting `sim(physicalCar, trackId, conditions)` (a function, `{ sim }` or `{ default }`; the CONCEPT.md
sim contract, the result carrying `lap_s` and `label`). It is handed to `optimize({ bench: { sim } })`, so the optimiser re-runs with
that sim and the film shows the new lap times, the new baseline lap and the new label. With `--lineage DIR` the label comes from
`DIR/best.json` (`baseline_result.circuits.<circuit>.label`), so a lineage made with the physics sim films correctly without `--sim`.

## Files

| File | What |
|---|---|
| `docs/deck/film/concept-evolution.mp4` | H.264, 1920x1080, 30 fps, 20 s, about 4 MB |
| `docs/deck/film/concept-evolution.webm` | VP9, same, about 4.4 MB |
| `docs/deck/film/concept-evolution-poster.png` | the clip's last frame (best design with the lower-third) |
| `docs/deck/film/concept-baseline-vs-best.png` | side-by-side, same camera and scale: baseline vs best (baseline outline and changed parts marked), lap times, parts changed |

## Reading the numbers (seed 1, sim v0, 2026-10-24)

Baseline 88.111 s to 86.886 s (-1.225 s), 20 of 23 parameters changed, best design found at generation 159, 50 of 200 generations kept.
Per CONCEPT.md section 2 and 8: sim v0 is a stand-in that scales the game's lap model so the baseline equals the real 2026 pole by
construction; the numbers rank changes, they do not place a 2026 car on the grid. Say so when the clip is cut into the video. Several
kept steps are tiny (a flap moving 0.5 degrees) and are not visible in the shape; the lap-time counter and the change text carry them.
