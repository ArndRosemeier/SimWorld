# Changelog

## v0.003 — The language layer

- The game can now talk to language models through OpenRouter with the player's own key: NPC replies stream in, and a second, cheap model reads each reply to work out what it changed in the NPC's mind (feelings, beliefs, promises they made, what they will remember).
- Several models can be configured, each tagged with what it is good at; every kind of request picks the best fitting model and falls back to the next one when a model is busy or fails.
- Every call's tokens and cost are recorded, per kind of request, per model, per NPC and per session, ready for the usage display.

## v0.002 — Merge rule

- Pull requests merge to main by themselves once CI is green, so nobody has to use Git by hand.

## v0.001 — Foundation

- The project skeleton: three.js on WebGL 2, the shared packages from AssetGenerator, the plan in docs/design.
- The shader policy is live from the first commit: every shader compiles during warm-up or one at a time later, at least 200 ms after the previous one finished, and the HUD shows any breach.
- Code guards and the Toolbox duplicate finders run with every test.

