# Lane DEMO

Status: in_progress P3.T4 + P3.T5 (script done; deck and shot list on stacked branches). Owner: agent G (Claude, session `session_01UAY6ykh3dQkf9GfJoZ9BTy`). Branches: `claude/demo-p3-script` (script) → `claude/demo-p3-deck` (deck, stacked) → `claude/demo-p3-shots` (shot list, stacked). Merge in that order; each later diff shrinks after the previous merge.

Owns: see `docs/agents/PARALLEL_PLAN.md` §1. Update this file at the end of every session (dated section on top; keep older ones).

### 2026-10-24 02:10 London — agent G (DEMO) — P3.T4 demo script, P3.T5 deck sources, P3.T4 shot list
- Status: **P3.T4 script done** (`claude/demo-p3-script`); **P3.T5 deck sources done** (`claude/demo-p3-deck`, stacked); **P3.T4 shot list done** (`claude/demo-p3-shots`, stacked). No code, no Mubit calls, `lab/prompt.js` untouched. Video recording (P3.T4 proper) and `/submit` (P3.T6) are Tanuj's.
- Files changed: `docs/demo-script.md` (rewritten, v2.0), `docs/deck/slides.md` (8 slides, Marp), `docs/deck/README.md` (export routes), `docs/deck/shot-list.md` (15 shots, 3:00), `docs/deck/shots/.gitkeep` (screenshots go here), this file. `docs/checkins/checkin-1.md` left as is (every fact in it checks out against TASK_LOG).
- Verify step run + output:
  - `npm ci && npm test` on the integration branch before starting → `# tests 65 / # pass 65 / # fail 0`.
  - `grep -niE "cfd|wind tunnel|validated|aerodynamically tested" docs/demo-script.md docs/deck/slides.md` → only the G-HON-02 checklist lines that quote the rule itself; no use in content.
  - Spoken text of the script: 465 words (about 2:55 at a normal pace); shot list sums to 180 s (awk over the duration column).
  - Deck export tested in the cloud container with `CHROME_PATH=<chromium> npx -y @marp-team/marp-cli@latest docs/deck/slides.md --pdf --allow-local-files -o purple-deck.pdf` → 8-page PDF, dark theme renders, tables legible (checked slides 4 and 5 as PNG). Screenshots are missing on purpose (Marp warns and continues).
  - Speaker notes: 42–57 words per slide (all ≤ 60).
- What changed in the story (for the integrator and Tanuj):
  1. The old 0:45 line "Maggotts–Becketts purple, Hangar Straight red" is gone: all three measured sectors were slower for rear wing +8° (24.683 / 25.771 / 30.268 → 24.927 / 25.950 / 30.377). The script now says "faster through Becketts, slower in every sector".
  2. The old 1:30 beat ("the agent still says retest with more wing") is gone: on the demo experiment the agent said reject / rear_wing_deg decrease 4, which is correct. The LEARN beat is now about the **next experiment**: 39/43 front-wing proposals live, exam verdicts 20/20 vs next step 10/20. The engineer keeps the verdict and writes the rule; v2 is rule-conditioned learning (G-HON-03).
  3. Try models is scored as next step n/8 and verdict n/8 (G-HON-06); the 8 hardest exam items by `meta.margin` are exam-13, -11, -12, -15, -07, -10, -02, -16 (computed from `data/exam.json`; EVAL to confirm for P3.T1). Note 7 of those 8 have truth next step = ride_height_mm decrease.
  4. TD-01 beat says what the server does: an illegal candidate is refused before any Mubit call (`illegal` trace line, no `mreq_`), then the next legal Run spends a call and the count continues.
  5. The close no longer claims "open model" or "a fraction of the cost" (neither is measured).
- **Numbers owed** (square-bracket placeholders in the script and slides; cut the line rather than invent):

  | Number | Where it appears | Who produces it | When |
  |---|---|---|---|
  | Adapter **v1 result** (Adapters tab line) | slide 2, script 1:35, checkin-1 | Tanuj (console → Adapters screenshot) → `POST /api/status` | P1.T4, before the 12:00 check-in |
  | Adapter **v2 status / result** | slide 2 notes, script 1:35, shot 10 | Integrator runs `npm run collect -- --n 40 --with-rules --promote-bias 0.3` after P2.T4; Tanuj reads the Adapters tab | Saturday budget, by 20:00 |
  | **Exam v1 / v2 / provider next-step n/8 and verdict n/8** on the 8 hardest items | slide 5 table, script 2:10, shot 11 | EVAL picks the 8 (list above), Tanuj runs Try models (P3.T1), integrator enters `exam.v1`, `exam.v2` via `POST /api/status` | P3.T1, after v2 |
  | **Grid-race footage** (F-10, "cinematic — mixes car and driver") | script 2:50, shot 15, slide 8 bullet | GAME lane P3.T3, URL published in GAME.md; Tanuj records | P3, else fallback to the RACE card |
  | **Console screenshots** `console-tasks.png`, `console-adapters.png`, `try-models-side-by-side.png` | slides 2, 5 | Tanuj | before export |
  | **Lab screenshots** `lab-stage-rail.png`, `lab-race-card.png`, `lab-design-td01.png`, `ledger-row.png` | slides 1, 4, 6, 8 | UI lane P2.T1/P2.T6 must land; Tanuj captures | before export |
- Decisions proposed (for the integrator to log in TASK_LOG):
  1. D-D1 The demo correction (P2.T4) keeps the agent's verdict (reject) and supplies the rule as the reason; the overrule is about the next experiment, not the verdict. `/api/overrule` accepts this (verdict is any of the three).
  2. D-D2 Deck export route is Marp CLI with the repo's own `docs/deck/slides.md`; Google Slides is the fallback. PDF is `docs/deck/purple-deck.pdf` (not committed until the numbers are in).
  3. D-D3 Deck is exactly 8 pages, no cover; slide 1 carries the name so the Equation I disclosure stays on slide 2 (G-HON-04).
- Blockers / questions for Tanuj (batched, none blocking the docs):
  1. Does Chrome (or Edge) exist on the recording laptop? Marp needs one; otherwise use Route B in `docs/deck/README.md`.
  2. For shot 5–8 (the race): re-run `Race it` on the laptop GPU (real time, about 4 min for 3 laps) or cut to the race already in the ledger? The script supports both.
  3. Confirm D-D1 before P2.T4: the overrule reason is exactly "Weigh straight-line drag against corner gain; judge on full-lap delta." with verdict reject.
  4. Rotate the Mubit key after the hackathon (reminder from HANDOVER; the trace stream will show request ids on video, which is fine, the key never appears).
- Next three actions:
  1. Integrator merges the three stacked PRs in order (script → deck → shots).
  2. DEMO: when v1/v2/exam numbers land, replace the placeholders in `slides.md` and `demo-script.md`, re-run the G-HON grep, export the PDF, and add `docs/deck/purple-deck.pdf`.
  3. DEMO: P3.T6 freeze `data/` into `docs/ledger-snapshot/` after `/submit` (ledger.jsonl, calls.jsonl, rules.json, status.json, exam.json) with a README naming the submission commit.

## Template for a session entry

### YYYY-MM-DD HH:MM London — <agent/session> — <task id>
- Status: in_progress | done | blocked: <what, who>
- Files changed:
- Verify step run + output:
- Decisions proposed (for the integrator to log in TASK_LOG):
- Blockers / questions for Tanuj:
- Next three actions:
