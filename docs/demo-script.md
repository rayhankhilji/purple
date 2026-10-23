# PURPLE — 3-minute demo script (video and live)

0:00 — "Can a model learn from feedback and get better with each attempt? This is PURPLE: an F1 engineering lab that chases purple sectors. It's built on Equation I, a game we made before this weekend; the lab is new." Baseline car in 3D, Silverstone, objective: lap time. Mubit widget visible top-right.
0:25 — Press Run. DESIGN: the agent proposes rear wing +8°. The wing moves. Trace stream shows the Mubit call and its request ID.
0:45 — EVALUATE: +0.19 s on the full lap: Maggotts–Becketts purple, Hangar Straight red. "Reduced-order model, calibrated to 2026 pole laps."
1:05 — RACE: split cockpits, identical drivers, same seed. The candidate is quicker through Becketts, loses it on the Hangar Straight. Measured +0.23 s. Agreement shown.
1:30 — LEARN: the agent still says "retest with more wing". Overrule: "Weigh straight-line drag against corner gain; judge on full-lap delta." The rule appears in the next scenario; widget shows kept examples climbing; console shows v2.
2:05 — Try models: same unseen scenario to provider / v1 / v2. v2: reject. v1: promote. Exam: v1 4/8, v2 7/8.
2:35 — Technical directive: rear wing capped at 20°. Next proposal is flagged illegal; the task keeps collecting. "When the rules change, the model keeps up."
2:50 — "The pit wall's decision model is now ours — an open model, trained from our corrections, at a fraction of the cost. PURPLE."
