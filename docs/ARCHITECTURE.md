# Architecture and seam index

**Read this before writing any helper.** Each row is a question someone will ask while coding, and the one place that answers it. If your question is here, use that function. If it is not, search first (`rg`), then add the row in the same PR as the new seam. If a second way to answer a listed question seems needed, stop and say so in the PR instead of writing it.

Rows marked *planned* name the seam we will build; do not invent a different one when the time comes. The design behind them is [design/simworld-plan.md](design/simworld-plan.md).

## Layers

| Folder | What | May import |
|---|---|---|
| `src/sim` | The society: actors, places, schedules, needs, encounters, knowledge, minds, intentions, life events. Pure data, runs in a worker and in headless tests. **The single source of truth for every inhabitant.** | core only (guarded) |
| `src/geom` | 2D polygon geometry and polygon booleans (ported from Scale's core). Pure. | core only (guarded) |
| `src/plan`, `src/world` | The town planner and terrain (ported from Scale). Pure data. | core; from `src/sim` only `import type` (the place graph contract) and the per-kind defaults in `src/sim/placeKinds.ts` |
| `src/build` | Mesh data from the plan: terrain tiles, water, the town's ground, building shells with facade attributes, landmarks, country roads, the procedural material textures (ported from Scale). Typed arrays, runs in workers. | core, `src/geom`, `src/plan`, `src/world` (no three.js, guarded) |
| `src/workers` | The worker pool and the workers (town workers, texture workers; the sim worker, planned). | everything pure |
| `src/talk` | The procedural text engine (background chatter, fallback answers). Pure. | core, `src/sim` types |
| `src/llm` | OpenRouter, the model roster, task routing, usage ledger, prompt building, response contracts. No state of its own about NPCs. | core, `src/sim` types |
| `src/render` | three.js: renderer, Stage, materials, lights, meshes, views. | everything pure |
| `src/app` | DOM UI: loading/selector, chat panel, HUD, settings. | everything |
| `src/game` | Glue: the main loop, input, wiring the sim worker to the views. | everything |

## Seam index

### Numbers and randomness

| Question | The one way | Where |
|---|---|---|
| I need a random number | `new Rng(deriveSeed(seed, 'path', ...))`. Never `Math.random` (guarded). | `@futuremagic/core` rng.ts |
| A stable hash of ints, floats or a string | `hash2i`, `hash3i`, `hash2f`, `hash3f`, `hashString`, `hashCombine` | `@futuremagic/core` rng.ts |
| Smooth noise, fbm, Voronoi | `Noise`, `cellular2`, `cellular3`, `cellBorder` | `@futuremagic/core` noise.ts |
| clamp, lerp, remap, smoothstep, angles, damping, small vectors, colours | `clamp`, `lerp`, ... `Vec3`, `hsl2rgb`, ... | `@futuremagic/core` math.ts |
| A priority queue (A*, event queues) | `MinHeap` | `@futuremagic/core` heap.ts |

### Rendering

| Question | The one way | Where |
|---|---|---|
| Make the renderer | `createRenderer` (WebGL 2 backend of WebGPURenderer; guarded) | `src/render/renderer.ts` |
| I need a material | Add or reuse a *kind* (`VERTEX_COLOR_SOLID`, `TERRAIN`, `GROUND`, `WATER`, `FACADE`; `kind.make()`). Textured kinds need `useTextures({ facade })` before the warm-up. Never `new ...Material` elsewhere (guarded). | `src/render/materials.ts` |
| A kind's look as a TSL node graph (terrain land use, ground layers, water) | `terrainLook`, `groundLook`, `waterLook` (applied by the kind in materials.ts); the seed's field patchwork `setParcels(parcelParams(seed))`; noise from `h_noise2`/`h_fbm2` (`@futuremagic/humanoid/three/nodes/peopleNoise`) | `src/render/tsl/ground.ts` |
| A building's look: textured walls and roofs, procedural windows, doors, shop fronts, rooms behind the glass | `facadeLook(mat, arrays)` (the `FACADE` kind) reading `facadeSpecs()` | `src/render/tsl/facade.ts` |
| A tree's look: bark, leaf cards, far canopy hulls, the wind, geometry-instanced placement | `barkLook`, `leafLook`, `farLook` (the `BARK`, `LEAVES`, `TREE_FAR` kinds); wind strength `VEG.wind`; autumn from `SEASON.leaf` | `src/render/tsl/vegetation.ts` |
| Street furniture and vehicles' look (material ids per vertex, paint per instance, lamps and signals glowing with `LIGHT.night`) | `furnitureLook(mat, atlas)`, `vehicleLook(mat)` (the instanced `FURNITURE`, `VEHICLE` kinds, placed by `poseByInstance`) | `src/render/tsl/furniture.ts`, `src/render/tsl/vehicles.ts` |
| The text atlas texture (all lettering and signage pictures) | `textAtlas(runs = TEXT_RUNS)`: drawn once at load in the layout of `src/build/textAtlasLayout.ts` | `src/render/textAtlas.ts` |
| Shared TSL pieces: hashes, normal maps without tangents, the scene's light state | `h11`, `h21`, `perturbNormalUV`, `LIGHT` (night, dayLight, litFrac, shopLit, eatLit, wet; the day cycle sets them), `SEASON` (leaf, bare, blossom; the season clock sets them); a geometry-instanced copy's place `posed(p)`, `poseByInstance(mat)` | `src/render/tsl/common.ts` |
| The facade (and ground) texture arrays for the shaders | `loadTextures(pool, family, onProgress?, size?)` → `MaterialArrays` | `src/render/textures.ts` |
| The vegetation's bark and leaf atlases for the shaders | `loadVegetationTextures(pool, priority)` → `VegetationTextures` (for `useTextures({ vegetation })`) | `src/render/textures.ts` |
| I need a light | The fixed set from `makeLights` (a pool for lamps, planned). Never `new ...Light` elsewhere (guarded). | `src/render/lights.ts` |
| Put something into the visible scene | `stage.add(obj)`: compiles first, then adds | `src/render/stage.ts` |
| Compile something added to your own group later | `stage.prepare(obj)` | `src/render/stage.ts` |
| Compile while something already plays on screen | `stage.warmLater(objs)` | `src/render/stage.ts` |
| Turn mesh data into a mesh of a kind | `meshFromData(data: MeshData, kind)` (checks the attributes are the kind's), `wear(mesh, kind)` | `src/render/meshes.ts` |
| Many copies of one model, one shader per kind | `instancedFromData(data, kind, count, capacity)`: a plain Mesh with an InstancedBufferGeometry carrying the kind's `instanced` attributes (not an InstancedMesh: three builds one shader per InstancedMesh) | `src/render/meshes.ts` |
| Change which instances a geometry-instanced mesh shows (distance split, LOD) | `showInstances(meshes, src, picked, radius)`: copies the picked instances' attributes, sets the count, uploads, fits the bounding sphere | `src/render/meshes.ts` |
| Point the sun's shadow at what the camera sees | `fitSunShadow(lights, x, y, z, r)` | `src/render/lights.ts` |
| Show the whole town (from above) | `showTown(stage, pool, summary)`: every piece from the town workers onto the stage, centre first | `src/render/townView.ts` |
| Show the trees and shrubs (town and countryside), near / far split by the camera | `showVegetation(stage, pool, parent, summary, priority)` → `VegetationShown` (`update(camera)` once a frame) | `src/render/vegetationView.ts` |
| Show the street props (furniture, parked cars), by distance from the camera; where the street lamps' heads are | `showProps(stage, pool, parent, priority)` → `PropsShown` (`update(camera)` once a frame; `lamps`: `lampsOf` floats) | `src/render/propsView.ts` |
| Did something compile on the render path? Is a shader over budget? | `shaders.report()` in the console; `stage.hudLine()` | `src/render/shaders/monitor.ts` |
| A human: body, skeleton, materials, clothes, animation | `Humanoid` | `@futuremagic/humanoid/three` |
| A human's look from a seed | `randomAppearance(race, seed, opts)` | `@futuremagic/humanoid` |

### The town (`src/plan`, `src/world`, `src/geom`)

| Question | The one way | Where |
|---|---|---|
| Plan the whole town from the settings | `planTown({ seed, size })`: terrain, land use, macro plan, every cell, the countryside, households, ground-floor uses | `src/plan/town.ts` |
| How big is the town, how many households? | `townRadius(size)` (`src/world/settings.ts`), `dwellingTarget(size)`, `PEOPLE_PER_HOME`; `town.dwellings` | `src/plan/town.ts` |
| How many households live in a building? | `dwellingsOf(b)` | `src/plan/building.ts` |
| Ground height, water, rivers, lakes, the coast | `Terrain` (`height`, `isWater`, `water`, `lakeAt`, `coastDistance`) | `src/world/terrain.ts` |
| Where does a road or the railway bridge a river? | `riverSpans(terrain, pts, margin)` | `src/world/terrain.ts` |
| Forest, fields, meadow at a point | `LandUse.sample`; the town's outline `LandUse.edge` | `src/world/landuse.ts` |
| Arterials, cells, districts, sites, the railway | `buildMacroPlan(terrain)` → `MacroPlan` | `src/plan/macro.ts` |
| Streets, lots, buildings, props of one cell | `planCell(macro, cell, terrain)` (eatery terraces: `placeEateries`, after the uses are decided) | `src/plan/cell.ts`, `src/plan/terrace.ts` |
| Where are the town hall, church, school, …, station? | `macro.landmarks` (`Landmark`: kind, site frame, `cell` -1 outside the town with its `road`); `siteToWorld`, `inSite` | `src/plan/landmarks.ts` |
| The parts (massing) of a public building | `landmarkParts(lm, terrain)` on the `Kit` | `src/plan/landmarkParts.ts`, `src/plan/civicParts.ts`, `src/plan/kit.ts` |
| The railway and the station spot | `planRail(plan, terrain)` → `macro.rail` (`Railway`) | `src/plan/rail.ts` |
| Farms, country roads, level crossings | `RuralPlan` (`farms`, `roads`, `crossings`, `layout(farm)`, `roadEdge`) | `src/world/rural.ts` |
| Which ground-floor uses does a town have, which sim place kind is each? | `AmenityKind`, `amenityCounts(pop, warm)`, `PLACE_KIND_OF`, `EATERY_OF`, `AMENITY_LABEL` (hours, staff and capacity are the sim's `placeKinds`) | `src/plan/amenities.ts` |
| What is this shop front / workplace? | `b.amenity` (set by `planTown`), `b.eatery` for the terrace kind | `src/plan/town.ts`, `src/plan/eatery.ts` |
| The country around the town (big city, larger town, villages, river, roads), as lore | `regionOf(town)` → `Region` (sim contract in `src/sim/region.ts`); `planRegion(hints)` without planning a town | `src/plan/region.ts` |
| The town as the sim sees it (places, addresses, road network) | `placeGraphOf(town)` → `PlaceGraph`; `buildingRef(place.building)` back to the cell building, site or farm | `src/plan/placeGraph.ts` |
| Build mesh data (any kind) | `MeshBuilder(specs)` → `build(): MeshData`; the specs are the material kind's `attributes` | `src/build/meshBuilder.ts` |
| A procedural material texture layer (facade, roof, ground; tileable RGBA8 albedo+roughness, normal+height+AO) | `generateFacadeLayer(i, size)`, `generateGroundLayer(i, size)`, `FACADE_TILE_METERS`, `GROUND_TILE_METERS`, `TEX_SIZE`; building blocks `TNoise`, `worley`, `Tex`, `Layout`, `brickWall`, `stoneBlocks` | `src/build/texgen/` |
| Terrain tiles and water of the world | `terrainTiles(terrain)`, `buildTerrainTile(…, land)`; `waterSources(terrain)`, `buildWaterTile` | `src/build/terrainMesh.ts` |
| The town's ground (streets, sidewalks, plazas, lawns, markings) | `buildGround(plan, terrain, origin)`; drape any shape: `drapeShape`, `ringWall`; the one ground format `groundSpecs()`, `GroundLayer` | `src/build/ground.ts` |
| Country roads, farmyards, the railway, level crossings, their bridges | `buildCountryRoads(rural, rail, terrain, tile?)` | `src/build/rural.ts` |
| A tree or shrub model (wood, leaf cards, far hull) | `buildVegModel(i)` over `VEG_MODELS` (`vegModelIndex(species, variant)`); attribute specs `BARK_SPECS`, `LEAF_SPECS`, `FAR_SPECS`, per instance `INSTANCE_SPECS` | `src/build/vegetation.ts` |
| Where trees stand: the town's props, countryside forests, hedgerows, orchards | `townTrees(cells, terrain)`, `new ForestGen(land, macro).tile(x0, z0, size)`; records of `FOREST_STRIDE` floats | `src/build/forest.ts` |
| The bark and leaf atlases (RGBA8, pure) | `barkStrip(s)` + `packBark`, `leafAtlas()` | `src/build/vegetationTex.ts` |
| Draw 2D shapes into RGBA without a canvas (paths, fills, strokes, clips, gradients) | `Paint2D` | `src/build/paint2d.ts` |
| Solids laid out like three's geometries (box, cylinder, lathe, sphere, torus, icosphere, plane, tube on a Catmull-Rom curve) and the 4×4 transforms that place them, pure | `box`, `cylinder`, `lathe`, …, `M(…)`, `xform` | `src/build/prims.ts` |
| A street furniture model (lamps, signals, benches, kiosks, café terraces, graves, …) | `furnitureModel(kind, variant)` over `FURNITURE_KINDS` (`FURNITURE_SPECS`; lamp heads in `.lights`) | `src/build/furniture.ts` |
| A vehicle model; a car's paint | `vehicleModel(kind, variant)` (body, wheel, size; `VEHICLE_SPECS`), parked: `standingVehicle`, far off: `farVehicle(min, max)`; `paintColor(kind, seed)` | `src/build/vehicles.ts` |
| The town's street props as instance lists (furniture, parked cars from the plan's `ParkedCar` slots, signals at junctions); the street lamps' heads | `propInstances(cells, terrain)` → `PropGroup[]` (`PROP_STRIDE`), `propModel(key)`, a car's far stand-in `propFar(key)`; `lampsOf(groups)` (`LAMP_STRIDE`: x, y, z, kind) | `src/build/streetProps.ts` |
| Where a picture or a run of lettering sits in the text atlas | `pictureRect(cell)`; lettering: append a run to `TEXT_RUNS`, bake `textRects(TEXT_RUNS)[i]` | `src/build/textAtlasLayout.ts` |
| Buildings and public buildings as shells for the facade shader (walls, roofs; layer, tint, bay, storeys, flags `FF`) | `buildBuildings(mb, buildings, terrain)`, `buildLandmark(mb, lm, terrain)`, `facadeSpecs()`, `paint(mb, layer, tint, flags?, bay?, fh?, gh?)`; a building's floor level and plinth bottom `buildingBase(b, terrain)`, its tiers `buildingTiers(b)` | `src/build/massing.ts` |
| 2D polygons: area, centroid, point in polygon, closest point on a polyline, resample | `src/geom/geom2.ts` | `src/geom/geom2.ts` |
| Polygon union, difference, intersection, offset | `src/geom/clip.ts` (clipper) | `src/geom/clip.ts` |

### The app (`src/app`)

| Question | The one way | Where |
|---|---|---|
| Which version is this build, what changed? | `VERSION` and `whatsNewButton()` / `openWhatsNew()` (read CHANGELOG.md at build time via `parseChangelog`); versions are given only by the changelog fold after each merge (`changes/README.md`) | `src/app/whatsNew.ts`, `src/app/changelog.ts`, `tools/changelog.mjs` |

### Workers and persistence

| Question | The one way | Where |
|---|---|---|
| Run work off the main thread | `new WorkerPool<In, Out>(url, size)` with the worker imported as `…worker.ts?worker&url` (guarded: `new Worker` only there); `start(init)`, `run(msg, priority)` | `src/workers/pool.ts` |
| Plan the town and build its mesh data off the main thread | the town workers (`ToTown` / `FromTown`, `TownSummary`) | `src/workers/town.worker.ts`, `src/workers/townProtocol.ts` |
| Generate the material texture layers off the main thread | the texture workers (`ToTex` / `FromTex`) | `src/workers/tex.worker.ts`, `src/workers/texProtocol.ts` |
| Run the society simulation | the sim worker, talked to through `SimClient` | `src/workers/sim.worker.ts`, `src/game/SimClient.ts` *planned* |
| Save or load anything | `src/persist` (guarded: `localStorage` only there) | `src/persist/` *planned* |

### The society (`src/sim`)

| Question | The one way | Where |
|---|---|---|
| What is an actor, what does every actor have? | the actor contract: `ActorId`, the base component tables every actor has (`world.actors.cols`) | `src/sim/actors.ts` |
| What does a person / an animal add? | the Person and Animal component tables (`world.people`, `world.animals`); households and jobs | `src/sim/people.ts`, `src/sim/animals.ts` |
| Which species exist, which needs do they have, when are they awake? | `SPECIES`, `NEEDS` | `src/sim/species.ts` |
| A new struct-of-arrays table | `Columns` (typed columns that grow), `DerivedTable` for per-actor-type tables | `src/sim/table.ts` |
| Where can actors be? | `PlaceGraph` (places with kind, capacity, opening hours, staff slots; road nodes and edges). The planner produces one with `placeGraphOf(town)` (`src/plan/placeGraph.ts`); tests make one with `testTown(seed, size)` | `src/sim/places.ts`, `src/sim/testTown.ts` |
| What does a place kind offer, when is it open, who works there? | `KINDS` (services, gossip rate, capacity), `defaultHours(kind)`, `defaultStaff(kind, scale)`, the one source: the planner (`placeGraphOf`) and `testTown` both use it, and it stays pure data (anything stateful moves it to a neutral module, never widens the plan→sim allow list); `isOpen(world, place, clock)` | `src/sim/placeKinds.ts`, `src/sim/schedule.ts` |
| How long does it take to get between places? Which one is nearest? | `world.travel.minutes(a, b, car)`, `world.travel.nearest(from, candidates)` | `src/sim/travel.ts` |
| Game time: day, weekday, minute of day | `dayOf`, `weekdayOf`, `minuteOfDay`, `onDay`, `atMinute` | `src/sim/time.ts` |
| Make a world with its population | `createWorld(graph, seed)` (households, kin, jobs from staff slots, schools, habits, pets, livestock, wildlife, relationships) | `src/sim/synth.ts` |
| Add one person, animal or household; (re)settle school, routine and habits | `newPerson`, `newAnimal`, `adoptPet`, `addHousehold`, `settle` (used by synthesis and life events) | `src/sim/synth.ts` |
| Common questions about an actor: living person? traits, values, household, job, car, commute; places of a kind or service | `isPerson`, `traitOf`, `valueOf`, `householdOf`, `jobOf`, `hasCar`, `commute`, `placesOf`, `placesWith`, `ageOf`, `nameOf` | `src/sim/world.ts` |
| Advance the world | `tick(world, minutes)` (live); `chronicle(world, days)` (time skip: whole days, life events, sampled conversations); `history(world, years)` or `createWorld(graph, seed, { history })` (the town's past before play); `passDays(world, days)` is the slow part both share | `src/sim/world.ts`, `src/sim/chronicle.ts` |
| What happened to this person while time was skipped? | `digest(world, id, since)`: their memories and the news they heard, nothing they don't know | `src/sim/chronicle.ts` |
| A random number inside the sim | `tickRng(world, ...purpose)`: derived from (seed, clock, purpose), so saves need no generator state | `src/sim/world.ts` |
| Births, deaths, illness, romance, jobs, moving, pets, crime | `lifeDay(world, days)` (daily in `tick`; coarse steps in the chronicle); `world.life.events` is the record; `leaveTown` for anyone dying or moving away; `partnerOf`, `vacantHomes`, `moveInto` | `src/sim/life.ts` |
| Move an actor or change what they do | `go(world, id, place, activity, until)` (travel, followers); decisions come from `decideAll` | `src/sim/schedule.ts` |
| Who meets whom right now? | `encounters(world)` (last tick's conversations, with what was told); `presentAt(world, place)`; one conversation, live or in the chronicle: `encounter(world, place, a, b, hub, rng)` | `src/sim/encounters.ts` |
| What does this person believe, and from whom? | `beliefsOf(world, id)`; facts are created with `addFact` and spread with `witness` / `tell` / `broadcast`; `reach` for rumour metrics | `src/sim/knowledge.ts` |
| What does this person just know (region lore, where someone grew up), without it being news? | standing knowledge: `addStanding(world, fact, { share, minAge, holders })`, `knowsStanding`, `standingOf(world, id)` (source `SOURCE_COMMON`, never fades, never gossiped). Region lore and people's ties to it come from `createWorld(graph, seed, { region })` via `settleRegion` → `world.region`; a real place to move to: `regionDestination(world, rng, service?)` | `src/sim/knowledge.ts`, `src/sim/region.ts` |
| What does this person remember? Which memories matter for this conversation? | `remember`, `memoriesOf`, `recall(world, id, query)` | `src/sim/memory.ts` |
| How do two actors feel about each other? | `relation(world, a, b)`; `bond`, `meet` to change it | `src/sim/relations.ts` |
| What is this person about to do, and why? | the intention stack: `intentionsOf`, `intend`; carried out by `performIntention` | `src/sim/intentions.ts`, `src/sim/actions.ts` |
| What may an LLM propose for an NPC? | `Proposal`, `ProposalChange`, `AppliedChange` (contract with `src/llm`) | `src/sim/mind/proposal.ts` |
| Apply what an LLM proposed for an NPC (clamped, gated by personality, logged) | `applyProposal(world, id, proposal)`: the only way LLM output changes state | `src/sim/mind/apply.ts` |

### Language

| Question | The one way | Where |
|---|---|---|
| Call a language model for anything | `createLlm(cfg).run(task, input)`: routes the task to roster models best first, streams, parses, falls back on retryable errors, records usage. Tasks: `npc.speech`, `npc.appraisal`, `memory.summary`, `npc.reflection`, `skip.digest` | `src/llm/llm.ts`, `src/llm/tasks.ts` |
| Talk to openrouter.ai | `openRouterTransport({ apiKey })` (guarded: `openrouter.ai` only in `src/llm`); the public model list via `fetchCatalog()` | `src/llm/openrouter.ts` |
| Which models does the player have, what can they do? | the roster: `DEFAULT_ROSTER`, `rosterFromCatalog`, capability tags (`fast`, `cheap`, `structured`, `writing`, `reasoning`, `long_context`) | `src/llm/roster.ts` |
| Which model runs a task? | `route(roster, task.routing, pins)` (the settings screen shows `llm.plan(task)`) | `src/llm/router.ts` |
| How much has the LLM cost so far? | the usage ledger: `UsageLedger` (`total()`, `by('task' \| 'model' \| 'npc' \| 'session')`, `onRecord`) | `src/llm/usage.ts` |
| What does an NPC's prompt contain? | `NpcPromptInput` (card, state, scene, people, places, beliefs, recalled memories, turns: only what that NPC believes) → `speechMessages`; people and places as refs via `RefTable` | `src/llm/prompt.ts` |
| Turn an NPC reply into state changes | the `npc.appraisal` task: `APPRAISAL_SCHEMA` → `parseAppraisal` → `Proposal` for `applyProposal` | `src/llm/appraisal.ts` |
| Test anything that calls an LLM | `replayTransport(recordings)` (never the network); real recordings from `test/slow/openrouter.slow.test.ts` with `LLM_RECORD=1` | `src/llm/recorded.ts` |
| Background chatter, a fallback answer, any generated sentence | the procedural text engine | `src/talk/` |
