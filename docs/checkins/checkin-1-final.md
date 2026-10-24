# `/checkin` #1 — final text (2026-10-24 ~10:50 BST), paste into /checkin before 12:00 BST

---
**PURPLE — check-in #1** · repo: https://github.com/rayhankhilji/purple

**What it is:** an AI race engineer that redesigns the 2026 Red Bull RB22 to beat the real 2026 Silverstone qualifying lap. The car must stay legal under the FIA 2026 Technical Regulations (Section C, Issue 19) and keep Red Bull's own power unit (Red Bull Ford DM01, locked). Every candidate is scored by a physics lap simulator of Silverstone, checked against real 2026 qualifying telemetry (OpenF1).

**Headline number (model prediction):** best legal RB22-based car **87.235 s ± 0.154 s** (95 % band 86.93–87.54 s) vs the real pole 88.111 s (Antonelli) and Hadjar's RB22 88.746 s, i.e. −0.88 s to pole, P1 across the band. Biggest gains: Brooklands −0.22 s, Luffield −0.20 s, Village −0.16 s. Same engine; passes every FIA legality check.

**How it uses Mubit (live now):**
1. *Concept designer task* (claude-haiku-4-5 via Mubit, frozen prompt v1): a closed loop. Each call carries the last changes tried and their measured simulator results (lap, sector and per-corner deltas, FIA verdict); Mubit proposes the next change; the simulator measures it; the result goes into the next call. One Mubit session per run, every result tied to its request id. **272 trained designer calls so far** (300-call run in progress) plus untrained test calls; 191 of the model's proposals were legal and measured, 35 of them kept on the numbers.
2. *Research engineer task* (first Mubit task): 99 trained requests with a human pit-wall rule in v2's inputs; exam: provider 20/20 verdicts, 10/20 next experiments.

**Working now:** physics lap sim (wind per segment, load transfer, 2026 energy and power-reduction rules); 94-row FIA checklist enforced on every candidate (incl. materials and the engine lock); materials model; detailed 3D car built to the design's true dimensions; replay of the car's lap on our game's 3D Silverstone against the real pole lap; an engine dashboard (speed run, autonomous Mubit mode, manual garage).

**Left:** first designer adapter + Try-models comparison (provider vs adapter, n/N); public deploy; deck and video.

Built on Equation I, our pre-existing browser F1 game. Everything under `lab/`, `server/`, `concept/` and `test/` is new this weekend; we'll confirm the rule with an organiser in person.
---
