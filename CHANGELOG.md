# Changelog

## v0.037 — Trees in the streets and forests in the country

- Street trees, park trees, yews, bushes and hedges now grow where the town plan puts them: plane, linden, maple, oak, birch, chestnut, ginkgo, pine, cypress and palm, picked by street, park and climate like in Scale.
- The countryside gets its forests, hedgerows and orchards: real trees round the town, canopy clumps farther out.
- Leaves move in the wind and cast shadows; distant trees turn into simple canopies, so the town stays smooth.

## v0.036 — Street lamps, benches and parked cars

- The streets are furnished: lamp posts (modern, classic lanterns in the old town and parks, double lamps on the main roads), benches, bins, hydrants, mailboxes, bollards, planters, kiosks, fountains, statues, playgrounds, bus stops, manhole covers and café terraces with tables, chairs, parasols and awnings.
- Junctions get traffic lights or stop signs; the lights cycle by themselves, and lamps glow at night.
- Parked cars line the kerbs: sedans, hatchbacks, wagons, SUVs, vans, pickups, sports cars and delivery vans, each with its own paint; some bays have an EV charging post.
- Cars far off are drawn as simple shapes, so the town stays smooth.

## v0.035 — Sound: coastal flag follows the weather world shape

- Fixes the typecheck on main where the audio clock still used the old region shape after the weather change.

## v0.034 — Holidays away, and the weather matters

- Families go away in the school holidays, most of them once in the summer, for one or two weeks. Other people take a week or two at any time, more often in summer. While they are away the house stands empty, nobody goes to work or school, and the neighbours know. A burglar might know too. When they come back, they remember where they went.
- Rain and storms keep people indoors. Fewer people go to the park, the square or the market, and more sit in the café, the pub or the library. On a fine day people head outside. The dog still goes out in the rain, but only for a short walk.
- Commuters and people on holiday no longer go hungry while they are out of town.

## v0.033 — The town has sound and music

- Title music on the start screen, then now and then a quiet piece for the time of day, a rainy day or a Sunday morning, with long silences in between (seven pieces).
- The town sounds like where you are: traffic and the shopping street by day, a quiet night, birds in the parks and a dawn chorus, the river, the sea, open country with larks by day and crickets on warm nights; it goes dull and windy when you are high up.
- The church strikes the hours from 7 to 22 and rings a peal before the Sunday service; the school bell rings on school days and the schoolyard fills at break; dogs bark in gardens, lawnmowers run on dry Saturdays in the season, roosters crow at dawn and cows moo on the farms.
- A Sound button above What's new: volume, mute and a level for music, ambience, weather, bells, animals, traffic, people and footsteps (remembered). Sound starts with your first click.

## v0.032 — Commuters drive out of town and back

- People who work in the city or the nearby town now drive off the map on the road that leads there, instead of parking at the edge of town.
- Coming home, their car comes in on that same road and parks near where they are going.
- A car that is away in the city is not standing in town when the game loads.

## v0.031 — Rooms have real floors and walls

- Floors are wood boards, tiles, carpet, stone or marble, laid along the room; walls are painted plaster or wallpaper, bathrooms are tiled.
- Furniture is wood or fabric, stairs are stone, and lamps glow.
- The finishes are made by the texture workers like the facades, and stay within the shader time limit.

## v0.030 — Flats over shops have their own front door

- A building with a shop, café or other workplace downstairs and homes upstairs now has a second street door. It opens into a hall with the stairs, so the people who live there no longer walk through the shop to get home.
- You can see the second door on the facade beside the shop's own door.
- People going home to these flats use that door.

## v0.029 — Buses on the road

- The timetable's buses now drive through town: they come in on the country road from the nearby town, pull into a lay-by at each stop, wait there until their departure time, and leave towards where they are going.
- Traffic overtakes a bus standing at its stop; a second bus for the same stop waits behind the first.
- The school bus now stops only on streets where people live, not out on the farm roads.
- Vehicles can now make a stop on the way (hazards on, then drive on), which the bin lorry and the post van will use.

## v0.028 — Commuters and the secondary school

- About one worker in five now commutes. They drive or take the train to the city or the next town in the morning and come back in the evening. While they are away they are out of town.
- Children go to the town's primary school until they are ten. From eleven they ride the school bus to the secondary school in the next town.
- The city, the next town and the school take their names from the region around the town.

## v0.027 — Money in town: wages, rent, and shops that open and close

- Every household now has a monthly budget: wages from their real jobs, pensions, child benefit and support coming in; rent or mortgage, bills, groceries and the car going out. Money worries show as stress and as couples bickering, and the rare household that falls far behind has to leave.
- Shops, pubs and cafés earn from the people who actually buy there, plus the villages around and passing traffic. One that keeps losing money closes: its staff lose their jobs, its regulars find another local, and the whole town talks about it.
- Empty shop units reopen as what the town is missing, often run by a local with savings and ambition, and the street hears about the new place.
- New kinds of places the town can have: petrol station, hardware store, clothes shop, florist, newsagent, charity shop, takeaway, hotel, estate agent, beauty salon, physiotherapist, gym, funeral home and a care home, where the town's oldest live.

## v0.026 — Chat models picked by live tests

- NPCs now answer in chat with GLM by default (fast, natural, cheap), falling back to Gemini Flash and Mistral Large 4. The big, expensive models are no longer defaults; you can still add any OpenRouter model and choose models per task.
- What a conversation changes in an NPC's mind is read by Claude Haiku, then GPT Luna, then Mistral Large 4. Memories of conversations use GPT Luna first, the time-skip recap Claude Haiku. Defaults follow each vendor's newest model automatically.
- Fixed: models that think before answering sometimes returned nothing, because their thinking used up the reply's room.
- Fixed: people named as "Tom Brandt [P2]" or by name only were dropped from what an NPC remembers, and names could appear doubled ("Tom Tom Brandt").
- The time-skip recap now talks to you as your character ("Tom asked you to the dance") and sticks to what happened.

## v0.025 — Market day, Sunday service, weddings and funerals

- The town has a weekly market on the square, on Thursday or Saturday depending on the town. People come to shop in the morning.
- Each church holds a Sunday service at ten, and the faithful go. Public holidays have one too.
- Every street has its bin day, one weekday each. You can't see it yet; the bins will follow.
- The calendar brings its own occasions: the summer festival weekend on the square, the Christmas market from late November, a full church on Christmas Eve, trick-or-treating children on Halloween, and fireworks on New Year's Eve.
- Couples now get engaged first. The wedding follows a few months later on a Saturday, in the church or the town hall, with a party afterwards. Family and friends take the afternoon off to be there. A break-up or a death calls it off.
- A week or so after someone dies there is a funeral, and the mourners go and remember it.

## v0.024 — Buses, the school bus and trains on a timetable

- The town has a bus line from the station through the centre to the nearby town: hourly on weekdays, every two hours on Saturdays, none on Sundays and public holidays.
- A school bus picks up pupils at three stops round the town on school days and has them at the secondary school in the nearby town before eight, back in the afternoon.
- Trains run hourly from the station to the city, twice an hour in the rush hours, and out into the country the other way unless the town sits at the end of a branch line.
- The simulation can now ask for the next departures from a stop and the soonest ride between two places; nothing rides yet, and the vehicles are not drawn yet.

## v0.023 — The town has weather

- The town has weather of its own, the same for everyone in it: sunny spells, cloud, drizzle, rain, thunderstorms on summer afternoons, morning fog in autumn and winter, and snow in winter that stays on the ground until it thaws.
- Streets stay wet for a while after rain, and wet streets freeze to ice on cold nights.
- Not on screen yet: the sky and the people start reacting to it in the next changes.

## v0.022 — Traffic: the town's cars, driven by its people

- The town has a road network for cars: right-hand lanes, speed limits in km/h (50 on the main roads, 30 in the side streets, 80 out of town), traffic lights where main roads cross, and side roads that give way to the main road.
- Cars come from the inhabitants: when someone sets off by car, their household's car pulls out of its kerbside bay, drives there and parks in a free bay near where they are going. A car out with one person is not there for the rest of the family.
- A few cars from the region pass through on the country roads, more in the rush hours.
- Not on screen yet: the cars are drawn in the next change, on top of the car models.

## v0.021 — Every journey is recorded

- The simulation now keeps a list of everyone who is on their way somewhere: where from, where to, when they left and arrive, and whether they walk or drive. Children and the dog travel with whoever takes them, in the same car.
- Nothing new is visible yet. The traffic and the people on the street will be drawn from this list.

## v0.020 — The town keeps a real calendar

- Game days are real dates now: play starts in the current week, and the season, the length of the day and the holidays follow the real calendar.
- On Christmas Day and New Year's Day almost everything is shut. On Good Friday, Easter, Boxing Day and the other public holidays the town runs like a Sunday. The shops close at two on Christmas Eve and New Year's Eve.
- The school keeps terms: half-terms, Easter, six weeks in summer and two at Christmas. Children stay home during them.
- People go to the park while it is light, so on winter afternoons the park empties early.
- The calendar already knows Halloween, the town's summer festival weekend in July and the Christmas market from late November. The events themselves come next.

## v0.019 — Plan: the agreed town realism and who builds what

- The realism checklist is now part of the design docs, with Arnd's answers recorded: drive on the right, the real calendar with snowy winters, a simple real economy, phones, the holidays, and the school bus to the nearby town.
- The plan names the eight realism tracks, the thread that owns each, and the shared pieces they build on.
- Guards: only the app, game, render, audio, save and worker code may read the wall clock, and sound gets one audio engine.

## v0.018 — Buildings have insides

- Every building now has rooms and furniture: homes get a living room, kitchen, bathroom and bedrooms; shops, cafés, bakeries, offices, garages and the other workplaces get counters, tables, ovens, desks and work benches sized to their staff and guests.
- Houses keep the living rooms downstairs and the bedrooms upstairs; blocks of flats are split into separate homes off a shared stair hall; small flats become studios with a kitchenette.
- Each interior also knows where its people sleep, sit and work, for the simulation to use.
- Look inside a building with `?inside=<cell>/<building>&floor=<n>` (a cutaway of one floor).
- Very narrow town houses on lots too small for flats now count as one home.

## v0.017 — Buildings with windows, doors and shop fronts

- Buildings now have textured walls and roofs: brick, stone, plaster, timber siding, glass, tiles, slate and more, all generated from the seed while the loading screen shows.
- Every wall gets windows by storey, with sills, frames, shutters, blinds and a room behind the glass; front doors, shop fronts with sign bands, cafés, curtain-wall offices and balconies.
- Public buildings and bridge piers use the same look; party walls between terraced houses stay blind.
- Add `?tex=512` to the address for sharper textures (slower to load).

## v0.016 — The town appears

- The game now opens on the whole town from above, built from its seed. You see streets with markings, sidewalks, plazas, parks and every building with its roof. The public buildings, the river, the coast, the countryside's fields and woods, the farms, the country roads and the railway are all there.
- The view fills in from the centre while a slow drone circles the town. `?seed=` and `?size=` pick another town.
- Everything is built off the main thread. The town needs only a handful of shaders, all compiled behind the loading screen.

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

