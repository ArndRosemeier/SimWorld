# Changelog

## v0.015 — Moving to and from real places

- People who leave town now go somewhere real in the region: students to the university city, the elderly to a care home in the hospital town, families to a nearby town or village.
- Newcomers arrive from the villages and towns around (or from far away), and their neighbours hear where they came from.

## v0.014 — Plan catches up

- The design plan now records automatic merging, versioning with What's new, the surroundings as lore only, and standing knowledge.

## v0.013 — The country around the town

- Every town now has surroundings its people know about: the nearest big city and how to get there, a larger town nearby with the hospital, four to seven villages with their own character (farms, a lake, vineyards, a harbour, a ruined castle), the river, the hills and woods, the highway, and a few things people like to say about the neighbours.
- It follows the town's own geography: the city lies where the railway leads, nothing sits in the sea, and the river flows on the way it flows through town.
- Not everyone is from town any more: many grew up in a village, the larger town or the city, some have family living out there, some studied at the university in the city. Their household and close family know it too.
- Everyone knows the basics; the details about a village are known by some people, and always by those who grew up there. This knowledge never fades the way gossip does.

## v0.012 — Skipping time, and a town with a past

- Time can be skipped by days or months: life goes on (births, deaths, romances, jobs, moves) and news keeps spreading from person to person, faster for juicy stories.
- After a skip, any inhabitant can tell what happened to them and what they heard, and only what they would know.
- A new town can be given decades of history before play starts, so families, exes, grudges and secrets come from things that happened.
- Old people living alone now move in with their children or into a care home, so family houses free up for newcomers and the town's population stays steady.

## v0.011 — The game on the web

- Every merge is now published on GitHub Pages, so the newest build can be opened in a browser without installing anything.

## v0.010 — Version number and What's new

- The game shows its version (v0.001 at the start, one step of 0.001 per update) in the corner of the start screen, and it stays there in town.
- Clicking it opens What's new: every version with what changed in it, newest first.

## v0.009 — The town comes alive as places

- Every home, shop, workplace, public building, farm, park, square and named street of the planned town is now a place the townsfolk can live, work and meet in, with an address ("14 Mill Lane", "Hazel Offices").
- The roads, lanes and farm tracks form one walkable network, so everyone can get everywhere.
- Opening hours, jobs and capacity come from the same table the society simulation uses, scaled to the town; factory and office jobs fit the town's size.
- Numbered avenues now get the right ending ("21st", not "21th").

## v0.008 — The town lives its life

- Every day people fall ill and recover, fall in love, move in together, marry, split up, have babies and die of old age, at real-world rates.
- Jobs change hands: people get hired, let go, change jobs and retire, and vacancies fill from the people in town.
- Grown-up children move out, families move away, and newcomers take the empty homes; pets are adopted and grow old.
- Crime stays rare: the odd theft, burglary, graffiti or pub fight, with the culprit keeping the secret.
- The town talks about all of it: each event becomes news known first to the people who were there.
- People who are ill stay home in bed and skip work or school.

## v0.007 — The town is planned

- A whole small town is planned from its seed: old town, streets, houses and flats for 1,000 to 2,000 people, with farms in the fields around it.
- Every town has a town hall, a church, a primary school, a kindergarten, a health centre, a fire station, a supermarket, a sports ground and a railway station on the line that passes the town.
- Shop fronts hold the shops and services a town needs: pharmacy, police post, bakery, butcher, post office, bank, library, hairdresser, car repair garage, pub, cafés and restaurants, each with opening hours, staff and room for visitors.
- Country roads leave the town for the edge of the world, over river bridges and across the railway.

## v0.006 — NPC consequences use the simulation's own contract

- What an NPC takes away from a conversation (feelings, news, promises, memories) now reaches the town simulation in exactly the form it checks and applies, including what kind of news it was (job, romance, family, ...) and whether it is a secret.

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

