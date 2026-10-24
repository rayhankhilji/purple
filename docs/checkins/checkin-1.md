# `/checkin` #1 — paste into Discord #max before Sat 12:00 London (owner: Tanuj)

Fill the two brackets from the console (Adapters tab) just before posting. Everything else is current as of 01:20 London.

---
**PURPLE — check-in #1** (team repo: https://github.com/rayhankhilji/purple)

**Mubit task:** "Research engineer of F1" (claude-haiku-4-5 via the Anthropic path, frozen prompt v1). **57 trained requests, 43 kept examples**, status Training v1 at 23:58 London. Adapter v1: [version / test result from the Adapters tab].

**What the task is:** an F1 setup research agent. Input = one experiment (baseline setup + lap, candidate setup, the evaluator's measured lap and sector deltas, active pit-wall rules, last 3 experiments). Output = strict JSON: verdict (promote / reject / retest) + the single next experiment (parameter, direction, magnitude, expected sector effect, hypothesis). Evaluator = the game's own reduced-order lap model, calibrated to 2026 pole laps (deterministic, so every decision has a ground truth).

**Evaluator vs race:** candidate with +8° rear wing at Silverstone, predicted +0.436 s, measured in the game +0.518 s (two identical neutral bots, same seed) → agreement 19 % (target ≤ 25 %). Becketts minimum speed up 9.8 km/h, Hangar top speed down 9.4 km/h, as predicted.

**Exam (20 held-out scenarios, untrained calls):** provider gets 20/20 verdicts but only 10/20 next-experiment choices (on the 8 hardest, 1/8; on every miss the right move was ride height). That is the part the human corrections target: v2 will be collected after the engineer's rule "Weigh straight-line drag against corner gain; judge on full-lap delta." enters the task input.

**Next:** overrule flow + v2 collection on today's budget (40 calls, promote-biased scenarios), side panel + 3D car, Try-models comparison provider / v1 / v2 on the 8 hardest exam scenarios, video + deck, submit by 23:59.

Built on Equation I (our pre-existing browser F1 game); the lab, evaluator wrapper and Mubit agent are new tonight.
---
