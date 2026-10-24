# `/checkin` #2 (DRAFT, numbers as of 2026-10-24 09:53 UTC) — refresh, fill the amber boxes, paste into Discord #max, then run /checkin, by 18:00 BST

Before pasting: re-run the counts (`docs/concept/loop-runs/*`; method in the integrator notes), replace every **FILL** or cut its
clause, and check the result line against `docs/concept/CAMPAIGN.md` §4.0 (re-runs change it).

---
**PURPLE — check-in #2** · repo: https://github.com/rayhankhilji/purple · live: **FILL deployed URL**

**What it is:** an AI race engineer for the 2026 F1 rules. It takes the Red Bull RB22, keeps its Red Bull Ford DM01 power unit, and redesigns the car part by part inside the FIA 2026 technical regulations (Section C Issue 19, a 94-row checklist enforced on every candidate) to beat the real 2026 Silverstone qualifying lap. Every candidate is measured on a physics lap sim of Silverstone in the 2026 British GP qualifying conditions.

**Fresh code (your check-in #1 note):** Equation I, our browser F1 game, is pre-existing (one import commit, `a711399`, Fri 21:54 UTC) and we do not claim it. Everything else was written this weekend: `concept/`, `server/`, `lab/`, `test/` (326 tests), `docs/`, plus opt-in hooks in 7 game files (+633 / −48 lines): `?lab=1`, `?concept=1`, aero inputs. Without the flags the game is unchanged.

**Mubit is the loop (your note: make it the centre):**
- Designer task: Claude Haiku 4.5 through Mubit, frozen prompt. Each call receives the current best car + the last 3 changes tried with their **measured** lap, sector and per-corner deltas, kept or not, FIA articles broken. Mubit proposes 1–3 changes; the sim measures; the sim (not the model) decides kept = legal and faster; that result is in the next call's input. One Mubit session per run; every lineage row stores its request id and the id of the later call that carried its result.
- Mubit has no outcome API, so the result travels in the next call's input; on trained calls Mubit stores that history with the next proposal.
- So far: **331 trained designer calls in 16 sessions** (331 unique request ids), 13 untrained. Big run (12 sessions × 25 iterations): 271 calls, 199 proposals used, 66 kept (39 proposed by the model). Plus 99 trained calls on our first task (the research lab). Budget 430 / 2,500.
- Console: designer task kept examples **FILL**, adapter **FILL**, Try models on the same scenarios: provider **FILL n/N** vs adapter **FILL n/N**.

**Numbers (model prediction ± band, physics lap sim · Silverstone · 2026 British GP qualifying conditions; real laps from OpenF1 / formula1.com):** best legal RB22 / DM01 car **87.235 ± 0.154 s** (95 % 86.933–87.537) vs real pole 88.111 (**−0.876**) and HAD's real RB22 88.746 (−1.511): P1 across the band. With our aero estimates' gains halved: 87.893. Time comes from Stowe −0.26, Brooklands −0.22, Becketts −0.21, Luffield −0.20 s. The Mubit loop alone reaches 88.292 (best of 16 runs); the CMA-ES speed run finds the rest.

**Honest limits:** the sim misses its own accuracy target (held-out speed RMS 10.1 km/h vs < 7); the band does not cover the aero map's coefficients; part masses are estimates.

**Left:** read the console (kept, adapter, Try models), deploy, record the 3-minute video, final deck.
---
