# `/checkin` #1 (refreshed 2026-10-24 07:56Z) — paste into Discord #max, then run /checkin, before 12:00 BST

---
**PURPLE — check-in #1** · repo: https://github.com/rayhankhilji/purple

**What it is / who it's for:** an AI race engineer for F1 car development. You give it a 2026 car; it proposes design changes, a physics lap simulator scores each one on Silverstone, and it keeps going until it finds a car that beats the real 2026 qualifying times. The car must stay inside the FIA 2026 technical regulations and keep the same power unit (Red Bull Ford DM01 for our Red Bull RB22 baseline). For engineers and fans who want to see *why* a car is fast.

**How it uses Mubit:**
1. *Research engineer task* (live): claude-haiku-4-5 through Mubit's Anthropic path, frozen prompt. 99 trained requests so far, plus a human pit-wall rule fed into v2's inputs (rule-conditioned learning). Exam on 20 scenarios: provider 20/20 verdicts, 10/20 next experiments, so there is room for an adapter to beat it.
2. *Concept designer task* (second Mubit task, closed loop): every call carries the last changes tried and their simulated lap, sector and per-corner deltas, plus the FIA verdict; the model proposes the next change, the simulator measures it, and that result goes into the next call. One Mubit session per run; every result is tied to its request id. Built and tested end to end on a mock; going live today.

**Working now:** physics lap sim on Silverstone (wind, load transfer, ride-height aero, 2026 energy rules), checked against real 2026 qualifying telemetry from OpenF1; a 94-row FIA 2026 Section C checklist enforced on every candidate (dimensions, active aero, materials, engine lock); a materials model; the concept car in 3D on our game's car model; the 5-knob research lab with races in our game.

**Left:** live Mubit runs of the designer loop and its first adapter; the beat-pole campaign on the final sim; watching the car lap Silverstone in the game against the real pole lap; video and deck.

Built on Equation I, our pre-existing browser F1 game; everything else is new this weekend.
---
