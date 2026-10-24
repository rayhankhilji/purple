# PURPLE: 3-minute video script

Version 2 · 24 October 2026 · for the `/submit` video (MP4 or MOV, 3:00 at most). Record from https://purple-wine.vercel.app in Chrome,
full screen, 1920×1080, zoom 100%. Keep the Mubit console logged in on a second tab (Tasks → Concept designer of 2026).

Rules for every word on screen and in the voice-over: never say CFD, wind tunnel or validated; our lap times are a model prediction
from our physics simulator; real lap times come from OpenF1; scores are n/N; say that the Silverstone replay runs inside our older game.

## Running order

| Time | Screen | Say |
|---|---|---|
| 0:00 | Homepage, replay paused on the first decision | "A Formula 1 team only gets a limited number of expensive tests. Deciding what to test next is the job. PURPLE is an AI engineer for that job." |
| 0:15 | Press play at 4×. The car changes shape, PRPL climbs the board | "Claude suggests each change through Mubit. Our rules check and physics simulator test it on a lap of Silverstone. The car only keeps what is legal and faster." |
| 0:40 | Point at a green and a red card in the Mubit feed | "Every card is one Mubit call. Red means physics said no, and that verdict goes straight back into Claude's next call. Green means physics said yes." |
| 0:55 | Press Go live (12 decisions). Wait for a card to show "Mubit training example" | "This is live. When physics approves an idea, we send it to Mubit as a training example. Rejected ideas never are. That is a correction turning into a model update." |
| 1:35 | Open the side-by-side page | "Same simulator, same lap, same number of tests. PURPLE gets past the real pole in less than half the tests a standard optimiser needs." |
| 2:00 | Mubit console: the task, its examples and the adapter versions | "Mubit trained a first model on our early calls. It failed Mubit's own test, 5 out of 19, so Mubit kept Claude answering. Now it is learning only from the 751 ideas physics approved." |
| 2:25 | Watch the lap on Silverstone: every 2026 car's real qualifying lap and ours, on one clock | "Here is the best car against every real 2026 qualifying lap. Our model predicts 87.7 seconds against a real pole of 88.1." |
| 2:45 | Close card: purple-wine.vercel.app | "An F1 engineer that learns from physics, through Mubit. The Silverstone replay runs in our older game; everything else was built this weekend." |

## If something goes wrong

- Go live does not start: keep recording the replay at 4× and say "this is a recorded live run; every card was a real Mubit call".
- The race page is slow to load: skip it and end on the leaderboard with PRPL in first place.
- Fill in v2's result if Mubit has trained it before you record (the deck's Mubit slide has the same gap).
