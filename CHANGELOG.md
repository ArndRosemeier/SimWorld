# Changelog

## v0.005 — NPCs can lie to you

- When a character tells you something they know is false, it becomes a rumour that traces back to them and can travel through town.
- When they only guess out loud, they remember having said it, but it never turns into "news".

## v0.004 — The town comes alive (headless)

- Every inhabitant now lives a day: they sleep, wash, eat with their household, go to work or school, shop, visit friends, go to the pub, church on Sunday, and walk the dog.
- A town of about 2,000 people is generated from its buildings: households, families across the town, every job a real position at a real place, pets, farm animals and a few foxes, deer, hedgehogs and owls.
- News spreads only when people meet, fastest at the pub, the café and the bakery; stories change a little with each retelling, and people forget what does not concern them.
- Conversations with the language model can change how a person feels and what they plan to do, but only a little per turn and only within their character.

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

