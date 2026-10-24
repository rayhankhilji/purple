# PURPLE deck (P3.T5) — sources and export

`slides.md` is the deck: 8 slides, [Marp](https://marp.app) markdown, styled with the DESIGN_SYSTEM tokens (black, mono numbers, one purple accent). `shots/` holds the screenshots the slides reference. `shot-list.md` is the video shot list (P3.T4).

Submission needs a **PDF** via `/submit` by Sat 23:59 London.

## Route A — Marp CLI (15 minutes, recommended)

Needs Node (already installed for the repo) and Chrome, Edge or Chromium on the laptop (Marp uses it to print the PDF).

1. Capture the screenshots into `docs/deck/shots/` with **exactly these names** (PNG, 1440×900 browser or the console window; crop nothing, the slide fits them):

   | File | What | Where |
   |---|---|---|
   | `lab-stage-rail.png` | the four stage cards after a Run: DESIGN reject, EVALUATE +0.436 | `npm run dev` → `http://127.0.0.1:8788/lab/`, run the demo candidate (`EI.lab.run({...})`, see demo-script 0:20) |
   | `console-tasks.png` | task "Research engineer of F1", requests and kept examples (expect ≈ 80 after v2), status | Mubit console → Tasks |
   | `console-adapters.png` | v1 and v2 rows with their test results (`Passed` …) | Mubit console → Adapters → History |
   | `lab-race-card.png` | RACE card with +0.518 s, 19 %, label "measured in race, seed 42" | lab page after Race it (or the ledger race already posted) |
   | `try-models-side-by-side.png` | Side by side: provider and adapter answers on `exam-rw8`, version label in frame | Mubit console → Try models (steps: `docs/try-models/README.md`) |
   | `lab-design-td01.png` | DESIGN card error with badge TD-01: "Technical directive TD-01: rear wing capped at 20°" | lab page, TD-01 on, `EI.lab.run` with rear wing 25° (UI lane's `09-td01-violation.png` is a mock-data stand-in) |
   | `ledger-row.png` | ledger with row 01M5NHXH… (rule chip R-01, measured +0.518, agree 19 %) and the Saturday rows below | lab page, ledger table (restore `docs/ledger-snapshot/…/` into `data/` first) |

   A missing file shows as a broken image; the deck still exports. Fill the `[…]` placeholders in `slides.md` (kept count, v1 result, v2 result, the v1/v2 cells of the n/8 table from `npm run exam:score`; the provider cells 1/8 and 8/8 are measured) before exporting. Reference frames already in the repo: `docs/agents/integrator-screens/lab-1440-0315.png` (lab page), `docs/agents/lanes/car3d-screens/hero-rw8.png` (3D car, rear wing 28°), `docs/agents/lanes/ui-screens/*.png` (mock-data card states).

2. From the repo root:

   ```bash
   npx @marp-team/marp-cli@latest docs/deck/slides.md --pdf --allow-local-files -o docs/deck/purple-deck.pdf
   ```

   First run downloads Marp (about 30 s). `--allow-local-files` is what lets it embed `shots/*.png`. Add `--pdf-notes` if you want the speaker notes inside the PDF (they are the `<!-- Speaker notes -->` comments; the judges' copy should not have them).

3. Open `docs/deck/purple-deck.pdf`, check 8 pages, numbers legible, the source label visible at the foot of slides 3, 4 and 6. Upload via `/submit`.

Preview while editing: `npx @marp-team/marp-cli@latest -s docs/deck/` opens a live server, or install the "Marp for VS Code" extension and press the preview icon.

If Marp cannot find a browser: `CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" npx @marp-team/marp-cli@latest …` on macOS.

## Route B — Google Slides (fallback, 20 minutes)

1. New presentation, theme "Simple Dark"; set the background to `#0a0a0c`, title colour `#e8e8ec`, accent `#b26cff`.
2. One slide per `#` heading in `slides.md`: paste the title, the small grey subtitle, the bullets; insert the screenshot named in the slide's `![shot …](shots/…)` line on the right third.
3. Paste each `<!-- Speaker notes -->` block into the slide's notes.
4. Keep the source-label line (the `<span class="src">` text) as 12 pt grey text at the bottom of slides 3, 4 and 6: G-HON-01 requires it.
5. File → Download → PDF.

## Honesty check before export (EVAL_GUARDRAILS §5)

- Every slide with a number carries the source label (slides 3, 4, 6; slide 4 names the seed and the ledger id).
- The words CFD, wind tunnel, validated, aerodynamically tested appear nowhere (`grep -niE "cfd|wind tunnel|validated|aerodynamically tested" docs/deck/slides.md` prints nothing).
- Slide 2 discloses Equation I as pre-existing.
- Exam scores on slide 5 are n/8 and n/20, never %.
- Any remaining `[…]` placeholder means the number does not exist yet; cut the line rather than invent it.
