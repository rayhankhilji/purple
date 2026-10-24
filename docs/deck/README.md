# PURPLE deck (P3.T5) — sources and export

`slides.md` is the deck: 8 slides, no cover, [Marp](https://marp.app) markdown, styled with the DESIGN_SYSTEM tokens (black, mono numbers, one purple accent). `shots/` holds the screenshots the slides reference. `capture.js` takes the lab screenshots. `shot-list.md` is the video shot list (P3.T4). `purple-deck-draft.pdf` is a draft export (amber FILL boxes, missing screenshots); the submission PDF is `purple-deck.pdf`.

Submission needs a **PDF** via `/submit` by Sat 23:59 London.

## Numbers to fill from the console

Every value we do not have yet is an amber **`FILL <name>`** box in the slides (and **FILL <name>** in bold in `shot-list.md`). None of them may be guessed: "≈ 80 kept" is an expectation, not a number. Read each one, replace the whole `<span class="fill">FILL …</span>` with the value, or cut the cell/clause if it does not exist by export time.

| Placeholder | Appears in | Read it from | Format |
|---|---|---|---|
| `FILL kept-after-v2` | slides.md slide 2; shot-list shots 2, 10; demo-script 0:00 widget, 1:35 "Numbers owed" | Mubit console → Tasks → *Research engineer of F1* → kept examples | integer (43 before v2) |
| `FILL v1-result` | slides.md slide 2; shot-list shot 10; demo-script 1:35 | console → Adapters → History, v1 row: test result | the console's own words: `Passed`, `Below target`, `Malformed tool calls`, `Prompt only`, `Not tested` |
| `FILL v2-result` | slides.md slide 2; shot-list shot 10; demo-script 1:35 | same, v2 row (status if still training: "training") | as above |
| `FILL v1-next` | slides.md slide 5 table; shot-list shot 11; demo-script 2:10 | `docs/try-models/sheet.md` filled from Try models, then `npm run exam:score` → `next-step n/8` for v1 | **n/8**, never % |
| `FILL v1-verdict` | same | same → `verdict n/8` for v1 | **n/8** |
| `FILL v2-next` | same | same, v2 rows (needs a `Passed` v2) | **n/8** |
| `FILL v2-verdict` | same | same | **n/8** |
| the four `/7` boxes next to v1/v2 next and verdict | slides.md slide 5 table; demo-script 2:10; README [PENDING] | same scoring **without exam-rw8** (the demo experiment, in v2's recorded data, so not held out for v2): score the 7 other sheet items | **n/7** |

Before exporting the submission PDF this must print nothing:

```bash
grep -n "FILL" docs/deck/slides.md
```

Known values (do not re-read): 99 trained calls (57 Friday, 1 demo, 41 Saturday v2) and 61 untrained (1 smoke, 60 exam) from `data/calls.jsonl`; 43 kept at 23:58 (console); provider exam 20/20 verdicts, 10/20 next step; Try-models sheet provider 8/8 verdicts, 2/8 next step (exam-rw8, exam-12); demo race +0.436 predicted / +0.518 measured, 19 %, seed 42.

## Export (Marp CLI, pinned)

From the repo root. Marp is not a repo dependency; `npx` fetches the pinned version (about 30 s the first time). It needs a Chrome/Chromium: in the cloud container that is Playwright's Chromium.

```bash
CHROME_PATH=/opt/pw-browsers/chromium-1243/chrome-linux64/chrome npx -y @marp-team/marp-cli@4.5.1 docs/deck/slides.md --pdf --allow-local-files -o docs/deck/purple-deck.pdf
```

- Verified 2026-10-24 in the cloud container: 8 pages, 960×540 pt. (`/opt/pw-browsers/chromium` is a symlink to the same binary.) On a Mac: `CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"`; on a laptop with Chrome installed, omit `CHROME_PATH`.
- `--allow-local-files` lets Marp embed `shots/*.png`. A missing shot prints "Some of the local files are missing" and the export still succeeds (that is the draft).
- If the command sits silent for more than a minute, kill it and run it again with output redirected to a file (`> /tmp/marp.log 2>&1`); one run in the container hung with its output piped and the identical re-run finished in seconds.
- Do not add `--pdf-notes`: the judges' copy has no speaker notes.
- Draft: same command with `-o docs/deck/purple-deck-draft.pdf`.
- Check: `pdfinfo docs/deck/purple-deck.pdf | grep Pages` → 8; `pdftoppm -r 80 -png docs/deck/purple-deck.pdf /tmp/pg` and look at every page: no FILL boxes, source label at the foot of slides 2–6 and 8, nothing overlapping the label.

Preview while editing: `npx -y @marp-team/marp-cli@4.5.1 -s docs/deck/`.

## Screenshots

PNG, exactly these names, into `docs/deck/shots/`. The slide crops them to the right third, so element shots read better than full pages.

| File | Slide | What | How |
|---|---|---|---|
| `lab-stage-rail.png` | 1 | the four stage cards for the demo experiment: DESIGN reject, EVALUATE +0.436, RACE +0.518 / 19 %, LEARN R-01 | `capture.js` |
| `console-tasks.png` | 2 | task "Research engineer of F1", requests, kept examples (after v2), status | human: Mubit console → Tasks |
| `lab-race-card.png` | 4 | RACE card: measured +0.518, predicted +0.436, agreement 19 %, sector Δ | `capture.js` |
| `try-models-side-by-side.png` | 5 | Side by side, provider and adapter answers on `exam-rw8`, version label in frame | human: console → Try models (`docs/try-models/README.md`) |
| `lab-design-td01.png` | 6 | DESIGN card error: ILLEGAL_SETUP, badge TD-01, "Technical directive TD-01: rear wing capped at 20°" | `capture.js` (mock mode only) |
| `ledger-row.png` | 8 | ledger with the demo row `rear_wing_deg +8` highlighted: +0.436 / +0.518 / 19 % / R-01 / OVERRULED | `capture.js` |
| `console-adapters.png` | (video shot 10; not on a slide) | v1 and v2 rows with test results | human: console → Adapters → History |

`capture.js` also writes `lab-full.png`, `lab-full-td01.png`, `lab-evaluate-card.png` and `lab-widget.png` (spares; `lab-widget.png` can stand in on slide 2 if no console screenshot exists, but it shows 43 kept until the widget's ✎ form is updated with the console value).

### capture.js

Playwright, 1440×900 at 2× scale, selects an EXISTING ledger row (default the demo experiment `01M5NHXH4RSEQ50VM955FK20B7`) by clicking it; it never presses Run, Race it, Promote or Overrule, and a network guard aborts every write route. The only writes it lets through are for the TD-01 shot, and only when `/api/health` says `mock: true`: `POST /api/state {td01:true}`, one `POST /api/plan` with a 25° rear wing (the server refuses it with 422 before any Mubit call and appends one `illegal` row to `calls.jsonl` in the data dir), then TD-01 back to its previous value.

Run it against a **copy** of the real ledger in mock mode (never `data/` or `data-mock/` themselves):

```bash
mkdir -p /tmp/deck-data && cp data/{ledger.jsonl,calls.jsonl,rules.json,state.json,status.json,exam.json} /tmp/deck-data/   # or from docs/ledger-snapshot/<latest>/
MUBIT_MOCK=1 PURPLE_PORT=8821 PURPLE_DATA_DIR=/tmp/deck-data node server/index.js &
PURPLE_STATIC_PORT=8822 node server/static.js &
CHROME_PATH=/opt/pw-browsers/chromium-1243/chrome-linux64/chrome node docs/deck/capture.js --static http://127.0.0.1:8822 --api http://127.0.0.1:8821 --out docs/deck/shots
```

Options: `--exp <ledger id>`, `--only lab-race-card,ledger-row`, `--skip-td01`, `--browser-path <chrome>`, `--headed`, `--wait <ms>`. Playwright is not a repo dependency: the script uses a local `playwright` if there is one, else the global install (`npm i -g playwright@1.63.0`). Update the widget values (kept examples, adapter, test result) through the widget's ✎ form in the copy before capturing if `lab-full.png` or `lab-widget.png` is going to be used.

## Fallback — Google Slides (20 minutes)

1. New presentation, theme "Simple Dark"; background `#0a0a0c`, title colour `#e8e8ec`, accent `#b26cff`.
2. One slide per `#` heading in `slides.md`: title, small grey subtitle, bullets; the screenshot from the slide's `![shot …](shots/…)` line on the right third.
3. Speaker notes from each `<!-- Speaker notes -->` block.
4. The `<span class="src">` line as 12 pt grey text at the bottom of slides 2–6 and 8 (G-HON-01).
5. File → Download → PDF.

## Honesty check before export (EVAL_GUARDRAILS §5)

- G-HON-01: every number carries its source: the `.src` foot line on slides 2–6 and 8; slide 7 names "measured in race, seed 42" in the sentence.
- G-HON-02: `grep -niE "cfd|wind tunnel|validated|aerodynamically tested" docs/deck/slides.md` prints nothing.
- G-HON-03: corrections are "rule-conditioned learning" (slides 5, 7); v2 is described by its examples, not by a result we do not have.
- G-HON-04: slide 2 discloses Equation I as pre-existing.
- G-HON-05: the grid race is "cinematic · mixes car and driver" (slides 7, 8).
- G-HON-06: exam scores are n/20 and n/8, never % (`grep -nE "[0-9]+ ?%" docs/deck/slides.md` shows only 94 % of candidates, 19 % agreement and the 25 % target, none of them exam scores).
- `grep -n "FILL" docs/deck/slides.md` prints nothing.
