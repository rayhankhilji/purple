# PURPLE deck: sources and export

> Status: kept for history. The submission is the video ([../video-script.md](../video-script.md)); the current numbers are in [README.md](../../README.md).

`slides.md` is the deck: **12 slides**, [Marp](https://marp.app) markdown with inline HTML (two-column layouts, the flow diagram,
the per-corner bars), styled with the DESIGN_SYSTEM tokens (black, mono numbers, one purple accent, Mubit orange). Version 2
(2026-10-24): the story leads with the concept lab and the Mubit designer loop; the 5-knob research lab is slide 10, "first proof".
`purple-deck.pdf` is the submission export. `purple-deck-draft.pdf` is the **old v1 (research-lab) draft**, kept for reference
only. `shots/` and `capture.js` belong to the v1 research-lab deck (slide 10 uses none of them now). The video script is
`docs/video-script.md` (`shot-list.md` is the v1 shot list, superseded).

Slides: 1 title + result · 2 what is new this weekend (Equation I disclosure) · 3 the problem · 4 how it works · 5 the Mubit loop,
one real call · 6 Mubit in numbers + console FILL boxes · 7 the physics · 8 the result · 9 garage, 3D car, Silverstone replay ·
10 the 5-knob lab (first Mubit proof) · 11 limits and honesty · 12 what's next.

Figures are referenced in place from `docs/concept/` (no copies): `view-v3-shots/01-hero-baseline-rb22.png`,
`view-v3-shots/13-optimised-vs-baseline-ghost-tags.png`, `race-shots/v3best-1-chase.jpg`, `sim-trace-had.svg`,
`campaign-convergence.svg`.

## Numbers and where they come from

| Slide | Numbers | Source |
|---|---|---|
| 1, 8 | 87.235 ± 0.154 s, 95 % 86.933–87.537, Δ pole −0.876, Δ HAD −1.511, P1; baseline 88.763 (P6); halved aero 87.893; per-corner gains; PU and energy | `docs/concept/CAMPAIGN.md` §4.0 |
| 2 | import commit `a711399`; 7 game files +633 / −48; 365 commits; 29 test files, 326 tests | `git diff --stat a711399 HEAD -- js css index.html`, `git log`, `npm test` (2026-10-24 ~10:00 UTC) |
| 5 | the request (iteration 3 of trained run seed 11, session `loop-01m5pgpkgspft7dtx7dz1gqrre`), request ids, measured result | `docs/concept/loop-runs/trained-seed11/lineage.jsonl` row 3 (`loop.scenario`, `loop.mubit_request_id`, `loop.fed_to`) |
| 6, 11, 12 | runs, calls, trained, LLM used, kept, best laps, 331 ids / 16 sessions / 315 fed, refusals, 48 of 251 | computed from `docs/concept/loop-runs/*/{calls,lineage,summary}` **as of 2026-10-24 09:53 UTC** (the big run's seeds 21–32 were in the main checkout, not yet all committed) |
| 7, 11 | RMS 10.1 km/h, sector bias, CLA 5.32 vs 4.6; 94-row checklist; 23 materials; 11 cars / 9 circuits / 194 laps | SIM.md §0 §4.2 §7, FIA_CHECKLIST.md, MATERIALS.md, IDENTIFY.md |
| 9 | 0.62 m mapping RMS; ≤ 1 mm meshes on 11 designs; 10–23 ms part rebuild; ~200 ms garage | RACE.md, VIEW.md, TASK_LOG (view v3), DASHBOARD.md §5 |
| 10 | 99 trained calls, 43 kept (v1), exam 20/20 · 10/20, sheet 8/8 · 2/8 (7/7 · 1/7), 38 of 39, +0.436 / +0.518 | ledger snapshot `2026-10-24_02-37-26Z-0530-windcap-exam`, TASK_LOG |

## Numbers to fill from the console (amber `FILL` boxes)

None of them may be guessed. Read each one, replace the whole `<span class="fill">FILL …</span>` with the value, or cut the
clause if it does not exist by export time.

| Placeholder | Slide | Read it from | Format |
|---|---|---|---|
| `FILL designer-kept` | 6 | Mubit console → Tasks → the designer task ("You are the concept designer of a 2026 …") → kept examples | integer |
| `FILL designer-adapter` | 6 | console → Adapters → designer task: status and test result | the console's own words (`Passed`, `Below target`, `Training`, `Not tested` …) |
| `FILL n/N` (provider), `FILL n/N` (adapter) | 6 | console → Try models, same designer scenarios to provider and adapter; count proposals that are legal and faster when measured on the physics sim | **n/N**, never % |
| `FILL research-kept` | 10 | console → Tasks → "Research engineer of F1" → kept examples after v2 | integer (43 before v2) |
| `FILL research-adapters` | 10 | console → Adapters → research task, v1 and v2 rows: test result | console's words |
| `FILL n/8 (n/7)` | 10 | `docs/try-models/sheet.md` filled from Try models, `npm run exam:score`: next step v1 · v2, and without exam-rw8 | **n/8 (n/7)** |
| `FILL deployed URL` | 12 | the Vercel deployment | URL |

Before exporting the submission PDF this must print nothing:

```bash
grep -n "FILL" docs/deck/slides.md
```

**Re-count before the final export:** the slide 6 table and slides 11–12 counts are "as of 09:53 UTC"; if more designer runs land,
recompute from `docs/concept/loop-runs/` and update the "as of" stamp in the `.src` lines.

## Export (Marp CLI, pinned)

From the repo root. Marp is not a repo dependency; `npx` fetches the pinned version. It needs a Chrome/Chromium: in the cloud
container that is Playwright's Chromium. **`--html` is required** (the slides use inline HTML for layout).

```bash
CHROME_PATH=/opt/pw-browsers/chromium-1243/chrome-linux64/chrome npx -y @marp-team/marp-cli@4.5.1 docs/deck/slides.md --pdf --html --allow-local-files -o docs/deck/purple-deck.pdf
```

- Verified 2026-10-24 in the cloud container: 12 pages, 960×540 pt. On a Mac: `CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"`; with Chrome installed, omit `CHROME_PATH`.
- `--allow-local-files` lets Marp embed the `../concept/…` figures.
- If the command sits silent for more than a minute, stop it and run it again with output redirected to a file (`> /tmp/marp.log 2>&1`); in the container about one run in three hung and the identical re-run finished in ~30 s.
- `pdftoppm` prints "Bad bounding box in Type 3 glyph" warnings for the SVG figures; harmless.
- Do not add `--pdf-notes`: the judges' copy has no speaker notes.
- Check: `pdfinfo docs/deck/purple-deck.pdf | grep Pages` → 12; `pdftoppm -r 100 -png docs/deck/purple-deck.pdf /tmp/pg` and look at every page: no FILL boxes, a source line at the foot of every slide with numbers, nothing overlapping it.

Preview while editing: `npx -y @marp-team/marp-cli@4.5.1 --html -s docs/deck/`.

## Fallback: Google Slides (20 minutes)

1. New presentation, theme "Simple Dark"; background `#0a0a0c`, text `#e8e8ec`, accent `#b26cff`, Mubit orange `#ff4500`.
2. One slide per `#` heading in `slides.md`: title, small grey subtitle, bullets, the figure named in the slide.
3. Speaker notes from each `<!-- Speaker notes -->` block.
4. The `<span class="src">` line as 11 pt grey text at the bottom of every slide with numbers (G-HON-01).
5. File → Download → PDF.

## Honesty check before export (EVAL_GUARDRAILS §5)

- G-HON-01: every number carries its source (the `.src` foot line on every slide with numbers; physics lap sim · Silverstone · 2026 British GP qualifying conditions; real 2026 qualifying · OpenF1 / formula1.com).
- G-HON-02: `grep -niE "cfd|wind tunnel|validat|aerodynamically tested" docs/deck/slides.md` prints nothing.
- G-HON-03: Mubit's mechanism as it is: the result travels in the next call's input and is stored on trained calls; research lab: "rule-conditioned learning".
- G-HON-04: slide 2 discloses Equation I as pre-existing, with the import commit.
- G-HON-05: game-race modes are "cinematic · game lap model, mixes car and driver" (slide 9); the physics replay is the result.
- G-HON-06: exam / Try-models scores as n/N (`grep -nE "[0-9]+ ?%" docs/deck/slides.md` shows only CSS widths and the 95 % band).
- Limits slide states the sim misses its accuracy target (RMS 10.1 vs < 7 km/h) and that the 87.235 s car is the speed run's, not the Mubit loop's.
