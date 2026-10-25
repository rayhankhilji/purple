# PURPLE: 2-minute video script

Version 4 · 25 October 2026 · for the `/submit` video (MP4 or MOV, 2:00 at most). Record from https://purple-wine.vercel.app in Chrome,
full screen, 1920×1080, zoom 100%. Keep the Mubit console logged in on a second tab (Tasks → Concept designer of 2026).

Rules for every word on screen and in the voice-over: never say CFD, wind tunnel or validated; our lap times are a model prediction
from our physics simulator ("physics lap sim · model prediction"); real lap times come from OpenF1; scores are n/N; say that the
Silverstone replay runs inside our older game. Never say or imply that Mubit's trained model answered anything: it has not yet.

The site follows the same four steps as this script: 1 Mubit engineer, 2 Which AI is best?, 3 vs no AI, 4 Race & drive.

One design problem carries the first minute: decision 1 of the homepage replay (the recorded live run, seed 12, with corrections).
The highlight is the exam: the base model against the same model with our harness, on the same 30 held-out problems.

## Running order (about 265 spoken words, about 135 a minute)

| Time | Screen | Say |
|---|---|---|
| 0:00 | Homepage (step 1), replay paused on decision 1 | "Race engineers get a fixed number of tests a season. PURPLE chooses what to test next, through Mubit, and physics has the last word." |
| 0:10 | Open card 1: the idea, its reason, its Mubit request ID | "One problem: the Red Bull RB22 at Silverstone. Mubit suggests the biggest legal rear wing and more diffuser, for high-speed stability." |
| 0:20 | Press Play. Card 1 runs: rules check, screen, physics laps, kept | "The FIA rules pass it, but our physics lap sim says it is 0.156 seconds slower. So the engine tries 3,000 versions of the idea, runs the best 31, and keeps one 0.227 seconds faster. A better, legal car. The next call starts there." |
| 0:40 | Point at a red card's "correction: back to Claude" chip, then a green card's "→ Mubit training example" chip | "When physics says no, the verdict goes back into the next call. That cut illegal ideas from 64 per run to at most 8. When physics says yes, the call becomes a Mubit training example." |
| 0:55 | Exam view (button Exam): the table, Haiku row highlighted | "The highlight: the same model, with and without our harness, on 30 held-out problems, tested on physics. Haiku alone: 9 out of 30 legal and faster. With corrections: 10. Add a shared memory of approved decisions: 23. Opus: 16 to 23. Sonnet: 19 to 22. Random changes: 3." |
| 1:17 | Mubit console: the designer task, its examples, the model versions | "Mubit's trained model isn't here yet. Its first try scored 5 out of 19. We've since sent over 27,000 approved examples; when Mubit trains on them, this same exam runs on it in one command." |
| 1:30 | Step 2, Which AI is best? Model GP: the model switcher or the replay, then the podium | "Every call goes through Mubit, so any model can take the seat: Haiku, Sonnet, Opus and ChatGPT race through the same harness. Two beat the no-AI control, two didn't." |
| 1:40 | Step 3, vs no AI, for two seconds | "Cheap tests favour brute force too; we report it." |
| 1:44 | Step 4, Race & drive: press Drive it | "Then drive the best car: 87.7 seconds in our physics sim, against a real pole of 88.1." |
| 1:52 | Close card: purple-wine.vercel.app | "PURPLE: physics decides what Mubit learns. The track runs in our older game; the rest was built this weekend." |
| 2:00 | End | |

## Numbers on screen (sources)

- Decision 1: `concept/demo/replays/trained-corrections-seed12.json` (as written +0.156 s; 2,985 versions screened; 31 physics laps; kept −0.227 s).
- Illegal ideas per run 64 → 3–8: `docs/concept/TESTS_TO_POLE.md` §9.
- Exam: `concept/exam/results-*.json` (Haiku 9/30 → 10/30 → 23/30; Opus 16 → 22 → 23; Sonnet 19 → 19 → 22; no AI 3/30).
- Mubit: 5/19 from the Mubit console; 27,169 physics-approved trained calls in `docs/concept/loop-runs/trained-*harvest*/`.
- Model GP: `concept/gp/data/summary.json` (GPT-6 Luna and Sonnet 5.5 beat the no-AI control; Opus 5.5 and Haiku 4.5 did not).
- Best car 87.698 ± 0.122 s (seed 11); real pole 88.111 s (Antonelli, OpenF1).

## If something goes wrong

- The replay is slow to start: press Skip to end, then open card 1 from the feed.
- The model switcher is not live yet: show the recorded Model GP replay and podium, and keep the same line.
- The race page is slow to load: skip it and end on the Model GP podium.
- If Mubit has trained a new model before you record, run `node concept/exam/adapter-exam.js`, show its score on the exam as n/30 at 1:17, and say which task the adapter is for.
