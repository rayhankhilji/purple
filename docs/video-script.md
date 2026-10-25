# PURPLE: 2-minute video script

Version 5 · 25 October 2026 · the submission is this video (MP4 or MOV, 2:00 at most). Record from https://purple-wine.vercel.app
in Chrome, full screen, 1920×1080, zoom 100%. Keep the Mubit console logged in on a second tab (Tasks → Concept designer of 2026).

Rules for every word on screen and in the voice-over: never say CFD, wind tunnel or validated; our lap times are a model prediction
from our physics simulator ("physics lap sim · model prediction"); real lap times come from OpenF1; scores are n/N; say that the
Silverstone replay runs inside our older game. Never say or imply that Mubit's trained model answered anything: it has not yet.

The site has four steps: 1 Mubit engineer, 2 Which AI is best?, 3 vs no AI, 4 Race & drive. The video covers steps 1 and 2 and the
race at the end of step 2.

One design problem carries the first 45 seconds: decision 1 of the homepage replay (the recorded live run, seed 12, with corrections).
The highlight is the exam: the base model against the same model with our harness, on the same 30 held-out problems.

## Running order (about 270 spoken words, about 135 a minute)

| Time | Screen | Say |
|---|---|---|
| 0:00 | Homepage (step 1), replay paused on decision 1 | "Race engineers get a fixed number of tests a season. PURPLE chooses what to test next, through Mubit, and physics has the last word." |
| 0:08 | Open card 1: the idea, its reason, its Mubit request ID | "One problem: the Red Bull RB22 at Silverstone. The model suggests the biggest legal rear wing and more diffuser." |
| 0:15 | Press Play. Card 1 runs: rules check, screen, physics laps, kept | "The FIA rules pass it, but our physics lap sim says 0.156 seconds slower. So the engine tries 3,000 versions, runs the best 31, and keeps one 0.227 seconds faster." |
| 0:30 | Point at a "correction: back to Claude" chip, then a "→ Mubit training example" chip | "When physics says no, the verdict goes into the next call: illegal ideas fell from 64 per run to at most 8. When it says yes, the call becomes a Mubit training example." |
| 0:43 | Open the model selector next to Go live: Claude Haiku (default), Claude Sonnet, Claude Opus, ChatGPT, No AI. Pick ChatGPT, press Go live, wait for the first card | "It's not hardcoded to Claude. Every call goes through Mubit, so pick ChatGPT and press Go live: same prompt, same physics." |
| 0:55 | Exam tab: the table, Haiku row highlighted | "The highlight: the same model with and without our harness, on 30 held-out problems. Haiku alone: 9 of 30 legal and faster. With corrections: 10. With a shared memory of approved decisions: 23. Random changes: 3." |
| 1:10 | Mubit console: the designer task, its examples, the model versions | "Mubit's trained model isn't here yet: its first try scored 5 of 19. We've sent 27,169 approved examples; when Mubit trains, the same exam runs on it in one command." |
| 1:22 | Step 2, Which AI is best? Press Run it live, then Start the live race: five lanes start | "Which AI is best? Five live runs at once: Haiku, Sonnet, Opus, ChatGPT and no AI, 100 ideas each, on the same harness." |
| 1:32 | Cut to the final standings (or the recorded race lower on the page) | "The order changes run to run, and no AI is close. The point: Mubit makes the model swappable, and every model is measured the same way." |
| 1:44 | Race them (models only + pole): the 3D qualifying lap | "Then their best cars race Antonelli's real pole lap." |
| 1:52 | Close card: purple-wine.vercel.app | "PURPLE: physics decides what Mubit learns. The track runs in our older game; the rest was built this weekend." |
| 2:00 | End | |

## Numbers on screen (sources)

- Decision 1: `concept/demo/replays/trained-corrections-seed12.json` (as written +0.156 s; 2,985 versions screened; 31 physics laps; kept −0.227 s).
- Illegal ideas per run 64 → 3–8: `docs/concept/TESTS_TO_POLE.md` §9.
- Exam: `concept/exam/results-*.json` (Haiku 9/30 → 10/30 → 23/30; no AI 3/30).
- Mubit: 5/19 from the Mubit console; 27,169 physics-approved trained calls in `docs/concept/loop-runs/trained-*harvest*/`.
- Model selector and live Model GP: the models are `concept/gp/entrants.json`; the server side is `server/campaign-route.js` (`entrantOf`). Only the default Haiku task makes training examples; every other model runs untrained.
- Live race: 100 generations each (5 ideas × 20 rounds), about 4 minutes. Its times change every run; do not read times aloud.
- Recorded Model GP: `concept/gp/data/summary.json`.
- Real pole 88.111 s (Antonelli, OpenF1).

## If something goes wrong

- The replay is slow to start: press Skip to end, then open card 1 from the feed.
- Go live with ChatGPT is slow: cut after the run starts and show the first card later, or keep the selector shot only.
- The live race does not start or is slow: show the recorded race lower on the page and its standings, with the same lines.
- The race page is slow to load: skip it and end on the standings.
- If Mubit has trained a new model before you record, run `node concept/exam/adapter-exam.js`, show its score on the exam as n/30 at 1:10, and say which task the adapter is for.
