# Live Model GP on the deployed site (2026-10-25, about 05:30 GMT)

Five engine runs started at once against https://purple-wine.vercel.app/api/concept/engine/run, one per entrant of
`concept/gp/entrants.json`, each `{ mode: "engineer", llm: "live", model, memory: true, ideas: 5, rounds: 20, team: "redbull", seed: 21,
variants: 600, confirm_k: 8, explore: 2 }` (100 generations each), untrained (x-middleware-record: metadata). Script: `livetest.js`;
raw output with every request id: `output.txt`.

| Car | Model served | Generations | Best lap (physics lap sim · model prediction) | Wall time |
|---|---|---|---|---|
| Claude Opus | claude-opus-5-5 | 100/100 | 87.593 s | 186 s |
| No AI (control) | none | 100 engine steps | 87.620 s | 63 s |
| Claude Sonnet | claude-sonnet-5-5 | 99/100 (1 fell back to a random step) | 87.627 s | 180 s |
| ChatGPT | gpt-6-luna | 95/95, stopped at the time limit after 19 of 20 rounds | 87.664 s | 253 s |
| Claude Haiku | claude-haiku-4-5-20251001 | 100/100 | 87.763 s | 116 s |

Real pole: Antonelli, 88.111 s (OpenF1 2026). 0 call errors. One run per model: the order changes from run to run.
