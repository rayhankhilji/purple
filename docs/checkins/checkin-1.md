# `/checkin` #1 — paste into Discord #max before Sat 12:00 London (owner: Tanuj)

Fill the bracket from the console (Adapters tab) just before posting. If you cannot open the console, use the fallback wording in the bracket's note. Everything else is current as of 02:55Z (refreshed by the integrator).

---
**PURPLE — check-in #1** (team repo: https://github.com/rayhankhilji/purple)

**Mubit task:** "Research engineer of F1" (claude-haiku-4-5 via the Anthropic path, frozen prompt v1). **99 trained requests** (v1: 57, 43 kept at 23:58 London; v2: 41 with the engineer's rule in the input). Adapters: [v1 / v2 status and test result from the Adapters tab].

> Fallback if the console is not at hand: "Adapter v1 was training at our last console read (23:58); v2 examples are in." Do not guess a result.

**What the task is:** an F1 setup research agent. Input = one experiment (baseline setup + lap, candidate setup, the evaluator's measured lap and sector deltas, active pit-wall rules, last 3 experiments). Output = strict JSON: verdict (promote / reject / retest) + the single next experiment (parameter, direction, magnitude, expected sector effect, hypothesis). Evaluator = the game's own reduced-order lap model, calibrated to 2026 pole laps (deterministic, so every decision has a ground truth).

**Evaluator vs race:** candidate with +8° rear wing at Silverstone, predicted +0.436 s, measured in the game +0.518 s (two identical neutral bots, same seed) → agreement 19 % (target ≤ 25 %). Becketts minimum speed up 9.8 km/h, Hangar top speed down 9.4 km/h, as predicted.

**Exam (20 held-out scenarios, untrained calls):** provider gets 20/20 verdicts but only 10/20 next-experiment choices (on the 8 hardest, 2/8; on all 6 misses there the right move was ride height). That is the part the human correction targets: the engineer's rule "Weigh straight-line drag against corner gain; judge on full-lap delta." entered the task input, and v2's 40 examples (promote-biased, all five parameters) were collected with it.

**Built since:** the lab page (four stage cards, live trace of Mubit calls, ledger, conditions + technical-directive toggle, overrule and promote), a 3D view of the car whose wings follow the setup, and a cinematic grid race. **Next:** Try-models comparison provider / v1 / v2 on the 8 hardest exam scenarios (scored n/8), video + deck, submit by 23:59.

Built on Equation I (our pre-existing browser F1 game); the lab, evaluator wrapper and Mubit agent are new tonight.
---
