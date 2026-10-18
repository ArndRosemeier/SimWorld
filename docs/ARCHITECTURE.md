# Architecture and seam index

**Read this before writing any helper.** Each row is a question someone will ask while coding, and the one place that answers it. If your question is here, use that function. If it is not, search first (`rg`), then add the row in the same PR as the new seam. If a second way to answer a listed question seems needed, stop and say so in the PR instead of writing it.

Rows marked *planned* name the seam we will build; do not invent a different one when the time comes. The design behind them is [design/simworld-plan.md](design/simworld-plan.md).

## Layers

| Folder | What | May import |
|---|---|---|
| `src/sim` | The society: actors, places, schedules, needs, encounters, knowledge, minds, intentions, life events. Pure data, runs in a worker and in headless tests. **The single source of truth for every inhabitant.** | core only (guarded) |
| `src/plan`, `src/world` | The town planner and terrain (ported from Scale). Pure data. | core, `src/sim` types for the place graph (`src/plan` may not import `src/sim` code, only `import type`) |
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
| I need a material | Add or reuse a *kind* (`VERTEX_COLOR_SOLID.make()`). Never `new ...Material` elsewhere (guarded). | `src/render/materials.ts` |
| I need a light | The fixed set from `makeLights` (a pool for lamps, planned). Never `new ...Light` elsewhere (guarded). | `src/render/lights.ts` |
| Put something into the visible scene | `stage.add(obj)`: compiles first, then adds | `src/render/stage.ts` |
| Compile something added to your own group later | `stage.prepare(obj)` | `src/render/stage.ts` |
| Compile while something already plays on screen | `stage.warmLater(objs)` | `src/render/stage.ts` |
| Turn plain mesh arrays into a mesh of a kind | `meshFromData(data, kind)`, `wear(mesh, kind)` | `src/render/meshes.ts` |
| Did something compile on the render path? Is a shader over budget? | `shaders.report()` in the console; `stage.hudLine()` | `src/render/shaders/monitor.ts` |
| A human: body, skeleton, materials, clothes, animation | `Humanoid` | `@futuremagic/humanoid/three` |
| A human's look from a seed | `randomAppearance(race, seed, opts)` | `@futuremagic/humanoid` |

### Workers and persistence

| Question | The one way | Where |
|---|---|---|
| Run work off the main thread | the one worker pool (guarded: `new Worker` only there) | `src/workers/pool.ts` *planned* |
| Run the society simulation | the sim worker, talked to through `SimClient` | `src/workers/sim.worker.ts`, `src/game/SimClient.ts` *planned* |
| Save or load anything | `src/persist` (guarded: `localStorage` only there) | `src/persist/` *planned* |

### The society (`src/sim`, all planned)

| Question | The one way | Where |
|---|---|---|
| What is an actor, what does every actor have? | the actor contract: `ActorId`, the base component tables every actor has | `src/sim/actors.ts` |
| What does a person / an animal add? | the Person and Animal component tables; species data | `src/sim/people.ts`, `src/sim/animals.ts` |
| Where can actors be, and how long does it take to get between places? | `PlaceGraph` (places with kind, capacity, opening hours, staff slots; travel times). The planner produces one with `placeGraphOf(plan)`; tests make one with `testTown(seed, size)` | `src/sim/places.ts` |
| Advance the world | `world.tick(minutes)` (live) and `chronicle(world, days)` (time skip and history) | `src/sim/world.ts`, `src/sim/chronicle.ts` |
| Who meets whom right now? | `encounters(world)` (co-presence per place per tick) | `src/sim/encounters.ts` |
| What does this person believe, and from whom? | `beliefsOf(world, id)`; facts are created with `witness` / `tell` | `src/sim/knowledge.ts` |
| What does this person remember? Which memories matter for this conversation? | `memoriesOf`, `recall(world, id, query)` | `src/sim/memory.ts` |
| How do two actors feel about each other? | `relation(world, a, b)` | `src/sim/relations.ts` |
| What is this person about to do, and why? | the intention stack: `intentionsOf`, `intend` | `src/sim/intentions.ts` |
| Apply what an LLM proposed for an NPC (clamped, gated by personality, logged) | `applyProposal(world, id, proposal)`: the only way LLM output changes state. The proposal type is `Proposal` | `src/sim/mind/apply.ts`, `src/sim/mind/proposal.ts` |

### Language

| Question | The one way | Where |
|---|---|---|
| Call a language model for anything | `createLlm(cfg).run(task, input)`: routes the task to roster models best first, streams, parses, falls back on retryable errors, records usage. Tasks: `npc.speech`, `npc.appraisal`, `memory.summary`, `npc.reflection`, `skip.digest` | `src/llm/llm.ts`, `src/llm/tasks.ts` |
| Talk to openrouter.ai | `openRouterTransport({ apiKey })` (guarded: `openrouter.ai` only in `src/llm`); the public model list via `fetchCatalog()` | `src/llm/openrouter.ts` |
| Which models does the player have, what can they do? | the roster: `DEFAULT_ROSTER`, `rosterFromCatalog`, capability tags (`fast`, `cheap`, `structured`, `writing`, `reasoning`, `long_context`) | `src/llm/roster.ts` |
| Which model runs a task? | `route(roster, task.routing, pins)` (the settings screen shows `llm.plan(task)`) | `src/llm/router.ts` |
| How much has the LLM cost so far? | the usage ledger: `UsageLedger` (`total()`, `by('task' \| 'model' \| 'npc' \| 'session')`, `onRecord`) | `src/llm/usage.ts` |
| What does an NPC's prompt contain? | `NpcPromptInput` (card, state, scene, people, places, beliefs, recalled memories, turns: only what that NPC believes) → `speechMessages`; people and places as refs via `RefTable` | `src/llm/prompt.ts` |
| Turn an NPC reply into state changes | the `npc.appraisal` task: `APPRAISAL_SCHEMA` → `parseAppraisal` → `Proposal` for `applyProposal` (the type mirrors the sim's draft until `src/sim/mind/proposal.ts` lands, then is imported) | `src/llm/appraisal.ts` |
| Test anything that calls an LLM | `replayTransport(recordings)` (never the network); real recordings from `test/slow/openrouter.slow.test.ts` with `LLM_RECORD=1` | `src/llm/recorded.ts` |
| Background chatter, a fallback answer, any generated sentence | the procedural text engine | `src/talk/` |
