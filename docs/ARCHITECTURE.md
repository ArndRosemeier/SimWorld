# Architecture and seam index

**Read this before writing any helper.** Each row is a question someone will ask while coding, and the one place that answers it. If your question is here, use that function. If it is not, search first (`rg`), then add the row in the same PR as the new seam. If a second way to answer a listed question seems needed, stop and say so in the PR instead of writing it.

Rows marked *planned* name the seam we will build; do not invent a different one when the time comes. The design behind them is [design/simworld-plan.md](design/simworld-plan.md).

## Layers

| Folder | What | May import |
|---|---|---|
| `src/sim` | The society: actors, places, schedules, needs, encounters, knowledge, minds, intentions, life events. Pure data, runs in a worker and in headless tests. **The single source of truth for every inhabitant.** | core only (guarded) |
| `src/geom` | 2D polygon geometry and polygon booleans (ported from Scale's core). Pure. | core only (guarded) |
| `src/plan`, `src/world` | The town planner and terrain (ported from Scale). Pure data. | core; from `src/sim` only `import type` (the place graph contract) and the per-kind defaults in `src/sim/placeKinds.ts` |
| `src/interior` | Building interiors (ported from Scale's interior designer): storeys cut into rooms by a theme, doors, stairs and lifts, furniture, and the spots where people sleep, sit and work. Pure data from the building. | core, `src/geom`, `src/plan`, `src/build/massing` (tiers); from `src/sim` only types and `src/sim/placeKinds.ts` (guarded) |
| `src/build` | Mesh data from the plan: terrain tiles, water, the town's ground, building shells with facade attributes, landmarks, country roads, the procedural material textures (ported from Scale). Typed arrays, runs in workers. | core, `src/geom`, `src/plan`, `src/world` (no three.js, guarded) |
| `src/workers` | The worker pool and the workers (town workers, texture workers, body workers, the sim worker). | everything pure |
| `src/street` | The street layer (L1): where each inhabitant out of doors walks (tracks along the sidewalks of their real route, strolls at parks and squares) and how they look (body, today's clothes). Pure, runs in the sim worker and in headless tests. | core, `src/geom`, `src/plan`, `src/world`, `src/build`, `src/sim` (no three.js, guarded) |
| `src/traffic` | The town's traffic: the road network for cars, the cars driving and parking, the car trips out of the sim. Pure, runs on the main thread for the visible town and in headless tests. | core, `src/plan`, `src/world`, `src/build`, `src/sim` (reads the world, never writes it) |
| `src/talk` | The procedural text engine (background chatter, fallback answers). Pure. | core, `src/sim` types |
| `src/llm` | OpenRouter, the model roster, task routing, usage ledger, prompt building, response contracts. No state of its own about NPCs. | core, `src/sim` types |
| `src/audio` | Sound: the sound map (made in a town worker), the soundscape (pure: what plays when and where), the music choice, and the Web Audio engine that plays them (no three.js). | core, `src/sim` (time, calendar, weather), `src/plan`, `src/world`, `src/geom`, `src/persist` |
| `src/persist` | Preferences and saves of the world: the one place that touches `localStorage` and IndexedDB (guarded). | nothing of ours |
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
| I need a material | Add or reuse a *kind* (`VERTEX_COLOR_SOLID`, `TERRAIN`, `GROUND`, `WATER`, `FACADE`, `INTERIOR`; `kind.make()`). Textured kinds need `useTextures({ facade, interior })` before the warm-up. Never `new ...Material` elsewhere (guarded). | `src/render/materials.ts` |
| A kind's look as a TSL node graph (terrain land use, ground layers, water) | `terrainLook`, `groundLook`, `waterLook` (applied by the kind in materials.ts); the seed's field patchwork `setParcels(parcelParams(seed))`; noise from `h_noise2`/`h_fbm2` (`@futuremagic/humanoid/three/nodes/peopleNoise`) | `src/render/tsl/ground.ts` |
| A room's look: textured floors, walls and furniture tinted per vertex, lamps that glow | `interiorLook(mat, arrays)` (the `INTERIOR` kind); `INTERIOR_LIGHT.lamps` (0 … 1) dims every lamp | `src/render/tsl/interior.ts` |
| A building's look: textured walls and roofs, procedural windows, doors, shop fronts, rooms behind the glass | `facadeLook(mat, arrays)` (the `FACADE` kind) reading `facadeSpecs()` | `src/render/tsl/facade.ts` |
| A tree's look: bark, leaf cards, far canopy hulls, the wind, geometry-instanced placement | `barkLook`, `leafLook`, `farLook` (the `BARK`, `LEAVES`, `TREE_FAR` kinds); wind strength `VEG.wind`; autumn from `SEASON.leaf` | `src/render/tsl/vegetation.ts` |
| Street furniture and vehicles' look (material ids per vertex, paint per instance, lamps and signals glowing with `LIGHT.night`) | `furnitureLook(mat, atlas)`, `vehicleLook(mat)` (the instanced `FURNITURE`, `VEHICLE` kinds, placed by `poseByInstance`) | `src/render/tsl/furniture.ts`, `src/render/tsl/vehicles.ts` |
| Shared TSL pieces: hashes, normal maps without tangents, the scene's light state | `h11`, `h21`, `perturbNormalUV`, `LIGHT` (night, dayLight, litFrac, shopLit, eatLit, wet, snow), `SNOW_ALBEDO`, `SLUSH_ALBEDO`, `SEASON` (leaf, bare, blossom). Ground, terrain and facades read `wet` (dark glossy streets, puddles) and `snow` (cover on the flat, roofs and ledges, slush on roads). Written only by the sky view (`DaySky`, `src/render/sky.ts`), which reads the sim's date and weather; a geometry-instanced copy's place `posed(p)`, `poseByInstance(mat)` | `src/render/tsl/common.ts` |
| The sky, the sun and moon light, the haze, lightning: everything that follows the time of day and the weather on screen | `new DaySky(renderer, scene, lights, seed)`; `stage.add(sky.dome)`; each frame `sky.update(dt, world, clock, weather, camera)`; lightning flashes the weather's strikes (`strikesIn`, the ones the thunder plays). Its look is the `SKY_DOME` kind (`skyLook`, uniforms `SKY`, `clearSkyColor` for the haze) | `src/render/sky.ts`, `src/render/tsl/sky.ts` |
| Rain and snow falling round the camera | `new Precipitation(seed)`; `stage.add(p.mesh)`; each frame `p.fall(dt, camera, weather, weather.windDir, sky.day, sky.flash, under?)`. Its look is the `RAIN_SNOW` kind (`precipLook`, uniforms `PRECIP`) | `src/render/precip.ts`, `src/render/tsl/precip.ts` |
| The facade, ground and interior texture arrays for the shaders | `loadTextures(pool, family, onProgress?, size?)` → `MaterialArrays` | `src/render/textures.ts` |
| The vegetation's bark and leaf atlases for the shaders | `loadVegetationTextures(pool, priority)` → `VegetationTextures` (for `useTextures({ vegetation })`) | `src/render/textures.ts` |
| I need a light | The fixed set from `makeLights` (and `LAMP_POOL` point lights put on the street lamps nearest the camera each frame by `placeLamps(lights, view.props.lamps, x, z, sky.night)`). Never `new ...Light` elsewhere (guarded). | `src/render/lights.ts` |
| Put something into the visible scene | `stage.add(obj)`: compiles first, then adds | `src/render/stage.ts` |
| Compile something added to your own group later | `stage.prepare(obj)` | `src/render/stage.ts` |
| Compile while something already plays on screen | `stage.warmLater(objs)` | `src/render/stage.ts` |
| Turn mesh data into a mesh of a kind | `meshFromData(data: MeshData, kind)` (checks the attributes are the kind's), `wear(mesh, kind)` | `src/render/meshes.ts` |
| Many copies of one model, one shader per kind | `instancedFromData(data, kind, count, capacity)`: a plain Mesh with an InstancedBufferGeometry carrying the kind's `instanced` attributes (not an InstancedMesh: three builds one shader per InstancedMesh) | `src/render/meshes.ts` |
| Change which instances a geometry-instanced mesh shows (distance split, LOD) | `showInstances(meshes, src, picked, radius)`: copies the picked instances' attributes, sets the count, uploads, fits the bounding sphere | `src/render/meshes.ts` |
| Point the sun's shadow at what the camera sees; turn the light to the sun or moon | `fitSunShadow(lights, x, y, z, r)`; `aimSun(lights, dir)` (the day cycle) | `src/render/lights.ts` |
| Lettering in the world: shop names and hours, street-name and traffic signs, the town entrance sign, notice boards, clocks, timetables; signage pictures | one text atlas generated at load, `textAtlas(runs = TEXT_RUNS)` (layout in `src/build/textAtlasLayout.ts`), sampled by the kinds that show text | `src/render/textAtlas.ts` |
| Show the whole town (from above) | `showTown(stage, pool, summary)`: every piece from the town workers onto the stage, centre first | `src/render/townView.ts` |
| Show the trees and shrubs (town and countryside), near / far split by the camera | `showVegetation(stage, pool, parent, summary, priority)` → `VegetationShown` (`update(camera)` once a frame) | `src/render/vegetationView.ts` |
| Show the street props (furniture, parked cars), by distance from the camera; where the street lamps' heads are | `showProps(stage, pool, parent, priority)` → `PropsShown` (`update(camera)` once a frame; `lamps`: `lampsOf` floats) | `src/render/propsView.ts` |
| Did something compile on the render path? Is a shader over budget? | `shaders.report()` in the console; `stage.hudLine()` | `src/render/shaders/monitor.ts` |
| A human: body, skeleton, materials, clothes, animation | `Humanoid` | `@futuremagic/humanoid/three` |
| A human's look from a seed | `randomAppearance(race, seed, opts)` | `@futuremagic/humanoid` |
| An inhabitant's body and face (ageing with them, the family's colouring), today's clothes (by age, job, the weather they dressed for) | `appearanceOf(seed, info, clock)`, `bodyKey`, `outfitOf(seed, info, clock, cold, wet)`, `coldOf(tempC)` | `src/street/looks.ts` |
| Build a human's body off the main thread | `Bodies.launch(workers)`, `bodies.geometry(key, appearance, priority)` (the body workers; kept for a while) | `src/render/people/bodies.ts`, `src/workers/body.worker.ts` |
| The clothes people wear (shells and rigid parts for the humanoid wardrobe) | `WARDROBE` | `src/render/people/wardrobe.ts` |
| Draw the inhabitants out of doors near the camera | `PeopleView.create(stage, samples, workers)` (its samples go into the warm-up), `view.draw(figures, cx, cz, dt, time)`: a human each, built a few at a time, compiled before they show, shadows only up close | `src/render/people/peopleView.ts` |
| Walk the camera down on the street, follow someone | `CameraControl` (drone, street, follow) | `src/game/camera.ts` |

### The town (`src/plan`, `src/world`, `src/geom`)

| Question | The one way | Where |
|---|---|---|
| Plan the whole town from the settings | `planTown({ seed, size })`: terrain, land use, macro plan, every cell, the countryside, households, ground-floor uses | `src/plan/town.ts` |
| How big is the town, how many households? | `townRadius(size)` (`src/world/settings.ts`), `dwellingTarget(size)`, `PEOPLE_PER_HOME`; `town.dwellings` | `src/plan/town.ts` |
| How many households live in a building? | `dwellingsOf(b)` (a block too small for a flat beside its stairs, under `MIN_FLAT_FLOOR`, is one home) | `src/plan/building.ts` |
| Can a footprint carry more than one storey? | `isSliver(poly)` (under `MIN_FLAT_FLOOR`, under 4.5 m across, or a small wedge: the cell planner builds one storey there, a kiosk, a bungalow, a shed); `asLockUp(b)` turns a building into a single-storey lock-up garage | `src/plan/building.ts` |
| Where is a building's street door? | `streetDoor(b)` (edge, span, centre): the one door the facade, the terraces and the interior agree on | `src/plan/building.ts` |
| Where do the people living over a shop go in? | `flatsDoor(b)` (null when none) and `flatsDoorBay(b, bays)`: their own door in bay 0 or 1 of the front; the facade (`FF.FlatsDoor`), the interior (its hall to the stairs) and the place graph (`frontDoor(b, flatsDoor(b))`) agree on it | `src/plan/building.ts` |
| Ground height, water, rivers, lakes, the coast | `Terrain` (`height`, `isWater`, `water`, `lakeAt`, `coastDistance`) | `src/world/terrain.ts` |
| Where does a road or the railway bridge a river? | `riverSpans(terrain, pts, margin)` | `src/world/terrain.ts` |
| Forest, fields, meadow at a point | `LandUse.sample`; the town's outline `LandUse.edge` | `src/world/landuse.ts` |
| Arterials, cells, districts, sites, the railway | `buildMacroPlan(terrain)` → `MacroPlan` | `src/plan/macro.ts` |
| Streets, lots, buildings, props of one cell | `planCell(macro, cell, terrain)` (eatery terraces: `placeEateries`, after the uses are decided); kerbside parking bays `plan.parking` (`ParkingBay`: clear of cross streets by `SETBACK`, of crossings, all on the carriageway; `car` where a parked car stands) | `src/plan/cell.ts`, `src/plan/terrace.ts` |
| What stands in the way on foot (or of a car): footprints of a cell's solid props (trees' trunks, furniture, terraces, parked cars, graves) | `obstaclesOf(plan)` → `OBSTACLE_STRIDE` floats (x, z, yaw, hx, hz: an oriented box); `inObstacle(obs, k, x, z, pad)` | `src/plan/obstacles.ts` |
| Where are the town hall, church, school, …, station, the supermarket (car park in front), the care home, the petrol station? | `macro.landmarks` (`Landmark`: kind, site frame, `cell` -1 outside the town with its `road`); `siteToWorld`, `inSite`; the care home's rooms `careHomeRooms(lm)` (its place's `homes`, at most `CARE_ROOMS_PER_PERSON` of the town, `src/sim/placeKinds.ts`) | `src/plan/landmarks.ts` |
| The parts (massing) of a public building | `landmarkParts(lm, terrain)` on the `Kit` | `src/plan/landmarkParts.ts`, `src/plan/civicParts.ts`, `src/plan/kit.ts` |
| The railway and the station spot | `planRail(plan, terrain)` → `macro.rail` (`Railway`) | `src/plan/rail.ts` |
| Farms, country roads, level crossings | `RuralPlan` (`farms`, `roads`, `crossings`, `layout(farm)`, `roadEdge`) | `src/world/rural.ts` |
| Which ground-floor uses does a town have, which sim place kind is each? | `AmenityKind`, `amenityCounts(pop, warm)`, `PLACE_KIND_OF`, `EATERY_OF`, `AMENITY_LABEL` (hours, staff and capacity are the sim's `placeKinds`) | `src/plan/amenities.ts` |
| How many general shops, offices, workshops and empty units are behind the shop fronts? | `frontQuotas(pop)` (a shop per 85 inhabitants, an office front per 110, a workshop per 350) and `VACANT_SHARE`; the planner turns the fronts beyond them into ground-floor homes, small offices or lock-ups before it counts the households | `src/plan/town.ts` |
| What is this shop front / workplace? | `b.amenity` (set by `planTown`), `b.eatery` for the terrace kind | `src/plan/town.ts`, `src/plan/eatery.ts` |
| The country around the town (big city, larger town, villages, river, roads), as lore | `regionOf(town)` → `Region` (sim contract in `src/sim/region.ts`); `planRegion(hints)` without planning a town | `src/plan/region.ts` |
| The town's roads as one network of lines (arterials, streets, footpaths, country roads, tracks) cut at their junctions, with street names | `townRoads(town)` → `TownRoads` (`lines`, `nodes`, `streets`, `nearest`); a line's points by arc length with `alongLine`, `slicePolyline` (`src/geom/geom2.ts`). The place graph and the traffic network are both built from it | `src/plan/roads.ts` |
| The town as the sim sees it (places, addresses, road network) | `placeGraphOf(town)` → `PlaceGraph`; `buildingRef(place.building)` back to the cell building, site or farm. Each `RoadEdge` carries its centreline (`pts`, when bent) and where people walk beside it (`side`: mid-sidewalk, a country road's verge) | `src/plan/placeGraph.ts` |
| Build mesh data (any kind) | `MeshBuilder(specs)` → `build(): MeshData`; the specs are the material kind's `attributes` | `src/build/meshBuilder.ts` |
| A procedural material texture layer (facade, roof, ground, interior floors and walls; tileable RGBA8 albedo+roughness, normal+height+AO) | `generateFacadeLayer(i, size)`, `generateGroundLayer(i, size)`, `generateInteriorLayer(i, size)` (`InteriorMat`), `FACADE_TILE_METERS`, `GROUND_TILE_METERS`, `INTERIOR_TILE_METERS`, `TEX_SIZE`; building blocks `TNoise`, `worley`, `Tex`, `Layout`, `brickWall`, `stoneBlocks` | `src/build/texgen/` |
| Terrain tiles and water of the world; how high the drawn terrain is (coarse far out) | `terrainTiles(terrain)`, `buildTerrainTile(…, land)`, `terrainMeshHeight(terrain, x, z)`; `waterSources(terrain)`, `buildWaterTile` | `src/build/terrainMesh.ts` |
| Where are the zebra crossings? | `crossingsOf(plan)` → `Crossing[]` (x, z on the centreline, `heading` along the street away from the junction, carriageway `width`, `street`, `end`), `crossingSetback(width)`; which streets a cell marks and which of their ends meet a junction: `markedEnds(plan, st)`. The ground paints them, people on the street cross there | `src/plan/crossings.ts` |
| The town's ground (streets, sidewalks, plazas, lawns, markings) | `buildGround(plan, terrain, origin)` (zebra crossings from `crossingsOf`; the draped surfaces, which never overlap: `groundSurfaces(plan)`); drape any shape: `drapeShape`, `ringWall`; the one ground format `groundSpecs()`, `GroundLayer` | `src/build/ground.ts` |
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
| What is inside a building: rooms, homes, furniture, stairs; where its people sleep, sit and work | `planInterior(b, place?)` → `Interior` (`storeys: FloorPlan[]`, `units` with `sleeps`, `spots: Spot[]`); `place` (the sim's staff and capacity) sizes a workplace; outlines `storeyPoly`, `storeyFacade`; `workOf(b)`; `peakStaff(slots)` | `src/interior/building.ts` |
| Cut a storey into rooms, walls and doors by a program | `splitStorey(storey, program, rng)` (`Program`: reservations, rooms, corridors, flats `units`, `musts`, `rank`) | `src/interior/fill/split.ts` |
| Furnish a room | `new Filler(roomArea(...), rng, cell, accept).fill(items)` (`Item`: wall or free pieces, kids, clearances, score, `or` fallbacks); what a room holds: `homeItems`, `workItems` | `src/interior/fill/place.ts`, `src/interior/fill/home.ts`, `src/interior/fill/work.ts` |
| Stairs and lifts through a building | `planCores(b, groundPoly, maxH, door, flatsDoor?)` → stair core, lift shaft and, for homes over a shop, `entry` (the hall from their door to the stairs, closed to the shop); `stairHall`; `stairsOf` (flights, landings, the hole above) | `src/interior/cores.ts` |
| Interior meshes: a storey, or the cutaway of one | `buildStorey(mb, plan, opts)`, `buildCutaway(mb, interior, floor, base, facades)` with `INTERIOR_SPECS` (the `INTERIOR` kind: uv in metres, `aLayer` an `InteriorMat` or `LAMP`, `aTint`) | `src/build/interior.ts` |
| Look at interiors without the game | `?inside=<cell>/<building>&floor=<n>` in the browser; floor plans as SVG: `npx tsx tools/interior/plans.ts` | `src/main.ts`, `tools/interior/plans.ts` |
| 2D polygons: area, centroid, point in polygon, closest point on a polyline, resample | `src/geom/geom2.ts` | `src/geom/geom2.ts` |
| Polylines by arc length: a point at s, a stretch from s0 to s1, the line moved sideways | `polylineCum(pts)` then `alongLine({ pts, cum }, s)`, `slicePolyline({ pts, cum }, s0, s1)`; `offsetPolyline(pts, d)` (mitred) | `src/geom/geom2.ts` |
| Polygon union, difference, intersection, offset | `src/geom/clip.ts` (clipper) | `src/geom/clip.ts` |

### Traffic (`src/traffic`)

| Question | The one way | Where |
|---|---|---|
| The roads cars use: edges, lanes, speed limit (km/h), junction rules (lights, give way), surface height (bridge decks), routes | `new RoadNet(town)`: `edges` (`kmh`, `rule`, `park`), `nodes` (`signal`, `exit`), `carRoute`, `laneOffset` (right-hand, lane 0 at the kerb), `lanePoint`, `heightAt`, `nearestEdge`, `ruleAt`, `rank`; the limits `LIMITS` | `src/traffic/roadNet.ts` |
| Height of a country road or a bridged main road where cars drive on it | `countryRoadSurface(road, terrain)`, `bridgeDeckSurface(bridge, terrain)` (RoadNet samples them per edge) | `src/build/rural.ts`, `src/build/bridges.ts` |
| Where do parked cars stand? Is there a free bay near here? | `Parking`: kerbside bays and farm yards (`spots`), `parkNear`, `nearestFree`, `reserve`/`arrive`/`release`, `spotOf`, `restAt`, `occupied()`; no bay near: off the street (not drawn) | `src/traffic/parking.ts` |
| Make a car drive somewhere, park, leave the map; may a person cross here? | `Traffic`: `depart(car, goal)` (a parked car), `enter(car, exit, goal)` (from the region), `place(car, edge, fwd, s, goal)` (scripted: buses, rounds); `update(dt)`; `vehicles`, `onPark`, `onGone`; `obstacles` (people on the road), `safeToCross(x, z)`; `weatherK`, `daylight` | `src/traffic/traffic.ts` |
| Which inhabitants set off by car just now? Where does a household's car stand at load? | `carTripsSince(world, clock)` → `CarTrip[]` (the drivers of `world.trips`, companions ride along; `fromRegion`/`toRegion` name the region town when an end is off the map); `carPlace(world, household)` (-1: the car is out of town); `regionOfPlace(world, place)` | `src/traffic/trips.ts` |
| The town's traffic from the sim (household cars, through traffic) | `TownTraffic(town, places, seed)`: `placeCars`, `trips(trips, clock)` once per game minute, `update(dt)` per frame; a household's car model `householdCar(seed, household)` | `src/traffic/townTraffic.ts` |
| Rounds: vehicles that come in from the region, stop at places and leave (buses, bin lorry, post van, deliveries) | `Round` + `roundGoal(round, …)` (a chain of `Traffic` `halt` goals, then an exit); `ServiceRounds(world, net).due(since, clock)` (bin day from `agendaOn`, post, shop deliveries, parcels); the exit towards a region town `exitTowardRegion(world, net, town)` (on `RoadNet.exitToward(bearing)`); all driven by `TownTraffic.rounds(world, since, clock)` once per game minute | `src/traffic/rounds.ts` |
| Buses on the road as the timetable says (in from the region, a lay-by at every town stop until departure, out again) | `Buses(world, net).due(since, clock)` → `Round[]` | `src/traffic/buses.ts` |
| Draw the cars | the vehicle view *planned* (instanced `VEHICLE` kind, per-instance lights) | `src/render/vehiclesView.ts` *planned* |

### The app (`src/app`)

| Question | The one way | Where |
|---|---|---|
| Which version is this build, what changed? | `VERSION` and `whatsNewButton()` / `openWhatsNew()` (read CHANGELOG.md at build time via `parseChangelog`); versions are given only by the changelog fold after each merge (`changes/README.md`) | `src/app/whatsNew.ts`, `src/app/changelog.ts`, `tools/changelog.mjs` |
| Open a modal panel over the game (What's new, the paper): backdrop, Escape and click-outside to close | `openDialog(prefix, label, closeButton)` → the panel to fill; small elements with `el(tag, cls, text)` | `src/app/dom.ts` |
| Read the town's weekly paper in play | `paperButton(() => sim.view)`: the newest edition and the board notices from `SimView.media` (`mediaView`, src/sim/media.ts) | `src/app/paperPanel.ts` |
| Show the town map (roads by class with street names, buildings, parks, water and woods, railway, landmarks, where you are) | `townMapOf(town)` → `TownMap` in a town worker (`{ type: 'map' }`), drawn by `mapButton(fetch, me)` | `src/plan/townMap.ts`, `src/app/mapPanel.ts` |

### The street (`src/street`)

| Question | The one way | Where |
|---|---|---|
| Where does an inhabitant out of doors walk, from now on? | `trackOf(world, map, id, clock)` → `Track` (keys `(t, x, y, z)`, `hideAfter` the door they go in by, `validUntil`): a pure function of the sim, remade when `signature(world, id)` changes; `sample(keys, t)` places them. Foot trips walk door to door on the sidewalks of `travel.roadPath`; stays at parks, squares and streets stroll between spots; companions walk beside | `src/street/tracks.ts` |
| Where people can stand: the sidewalk height, bridge decks, an edge's walking line, a park's outline and spots in it | `StreetMap(town, world.graph)`: `groundY`, `edge`, `centreline`, `walkLine`, `area`, `spot`; `OUTDOOR` (the place kinds seen while staying) | `src/street/streetMap.ts` |
| The deck height of the bridges at a point | `bridgeDecksAt(bridges, terrain)`; along a road by arc length `bridgeDeckSurface` | `src/build/bridges.ts` |

### Sound (`src/audio`)

| Question | The one way | Where |
|---|---|---|
| Play a sound (a car passing, a train horn, a door, a dog) | `townAudio.play(id, x, y, z, gain?, pitch?, refDist?)`; ids and their files, gains and mix categories in `public/sounds/manifest.json`. Never a second `AudioContext` (guarded). | `src/audio/townAudio.ts` |
| The Web Audio engine: one-shots, positioned loops, ambience beds, the ambience low-pass, music streams, volume, mute and the mix | `AudioEngine` (`play`, `loop`, `setAmbience`, `setMuffle`, `streamMusic`, `setVolume`, `setMuted`, `setMix`; `SOUND_CATEGORIES`) | `src/audio/engine.ts` |
| What does the town sound like here (built-up, busy, green, water, sea, country; ground height) and where do sounds come from (bell towers, schools, farms, gardens)? | `soundMapOf(town)` in a town worker (`{ type: 'sound' }`), `soundAt(map, x, z)`, `groundAt` | `src/audio/soundMap.ts` |
| Which beds play how loud, which bells, school bells, dogs, mowers, roosters sound now? | `Soundscape` (`ambience`, `shots`, `loops`) from the sound map, the game clock and the weather (`SoundEnv`); the rhythms' times `BELL_HOURS`, `SUNDAY_PEAL`, `SCHOOL_BELLS`, `SCHOOLYARD` | `src/audio/soundscape.ts` |
| What time, date, sun, weather and calendar day does the sound hear? | `soundEnvOf(world, clock)` → `SoundEnv` (night from `sunPosition`, rain and wind from `weatherAt`, `schoolDay`, `feast`); the world is the screen's (`screenWorld`, src/game/SimClient.ts), the one the sky reads; on the start screen `soundEnvOf(world, world.clock, soundOverrides(q))`, in play `soundEnvFromSim(world, sim.view, sim.clock, overrides)` takes the sim's weather and today's agenda (`occasions`: the bells for services, weddings and funerals, the crowd at markets and matches) | `src/audio/env.ts` |
| Where and when does lightning strike? | `strikesIn(townSeed, minute, lightning)`: the sky flashes them (`DaySky`), the soundscape plays their thunder | `src/sim/weather.ts` |
| Which music piece plays, and when | `MusicPlayer`; the choice `nextPiece` / `moodOf`; the pieces in `public/music/tracks.json` (docs/MUSIC.md) | `src/audio/music.ts` |
| Make or replace a sound clip or a music piece | sounds: `tools/sounds/studio.mjs` (Seed Audio takes, blind listening), `tools/sounds/build.mjs` (cuts), docs/SOUNDS.md; music: `tools/music/lyria.mjs`, docs/MUSIC.md | `tools/sounds/`, `tools/music/` |

### Workers and persistence

| Question | The one way | Where |
|---|---|---|
| Run work off the main thread | `new WorkerPool<In, Out>(url, size)` with the worker imported as `…worker.ts?worker&url` (guarded: `new Worker` only there); `start(init)`, `run(msg, priority)` | `src/workers/pool.ts` |
| Plan the town and build its mesh data off the main thread | the town workers (`ToTown` / `FromTown`, `TownSummary`) | `src/workers/town.worker.ts`, `src/workers/townProtocol.ts` |
| Generate the material texture layers off the main thread | the texture workers (`ToTex` / `FromTex`) | `src/workers/tex.worker.ts`, `src/workers/texProtocol.ts` |
| Answer the worker pool's messages inside a worker | `serve(handle, transfer)` | `src/workers/serve.ts` |
| Run the society simulation; the game clock | the sim worker, talked to through `SimClient`: `SimClient.boot(settings, start, startDay, clock, rate, { resume })` with `playStart(time, date?)` (today's date and time, or `?date=`/`?time=`: the one place the wall clock enters play), `sim.clock`, `sim.poll(x, z)` each frame, `sim.view`, `sim.walkers`; the time skip `sim.skip(days)` (the worker runs `chronicle`, then the morning up to the same time of day); saves `sim.saveNow()` and `sim.keepSaved()` (on tab hide and every 5 minutes), one per town, played on with `resume` | `src/workers/sim.worker.ts`, `src/game/SimClient.ts` |
| The world the sky and the sound read (the calendar's and the weather's inputs) | `screenWorld(seed, play)` → `ScreenWorld` (seed, epoch, latitude, clock, region), put on the running sim each frame with `followSim(world, sim)`; the sky takes the weather from `sim.view.weather` | `src/game/SimClient.ts` |
| Who is out of doors near the camera, and where exactly are they? | `sim.walkers` (tracks from the worker, changes only), placed each frame with `sim.where(walker, clock)`; the people view gets them as figures from `Street` | `src/game/SimClient.ts`, `src/game/street.ts` |
| What does a view need from the sim? Where people and pets are and what they do, lit dwellings, cars at home, trips, each dwelling's look (wealth, upkeep, kids, pets, car) | `SimView`: `viewOf(world)` as transferable typed arrays, sent by the sim worker. Every view (people, traffic, windows, gardens) reads it; no view keeps a second channel to the sim, and the planner and build get the per-dwelling look as data, never by deriving it from the plan. So far: date, weather (now and at 07:00), per actor place, destination and activity, the trips as columns with the household (`tripRow`), today's agenda at its places (`occasions`: kind, start, end, x, z), the town's media (`media`: the newest paper edition and the notices with the places they are up at; plain objects, copied rather than transferred) | `src/sim/view.ts` |
| Save or load anything | `src/persist` (guarded: `localStorage` and `indexedDB` only there); the player's small preferences: `readPref`, `writePref`, `readNumPref`, `readJsonPref`; saves of the world in IndexedDB, gzipped: `storeSave(key, bytes, clock)`, `readSave(key)`, `dropSave(key)` (the game saves through `SimClient`) | `src/persist/prefs.ts`, `src/persist/saves.ts` |

### The society (`src/sim`)

| Question | The one way | Where |
|---|---|---|
| What is an actor, what does every actor have? | the actor contract: `ActorId`, the base component tables every actor has (`world.actors.cols`) | `src/sim/actors.ts` |
| What does a person / an animal add? | the Person and Animal component tables (`world.people`, `world.animals`); households and jobs | `src/sim/people.ts`, `src/sim/animals.ts` |
| Which species exist, which needs do they have, when are they awake? | `SPECIES`, `NEEDS` | `src/sim/species.ts` |
| A new struct-of-arrays table | `Columns` (typed columns that grow), `DerivedTable` for per-actor-type tables | `src/sim/table.ts` |
| Where can actors be? | `PlaceGraph` (places with kind, capacity, opening hours, staff slots; road nodes and edges). The planner produces one with `placeGraphOf(town)` (`src/plan/placeGraph.ts`); tests make one with `testTown(seed, size)` | `src/sim/places.ts`, `src/sim/testTown.ts` |
| What does a place kind offer, when is it open, who works there? | `KINDS` (services, gossip rate, capacity), `defaultHours(kind)`, `defaultStaff(kind, scale)`, the one source: the planner (`placeGraphOf`) and `testTown` both use it, and it stays pure data (anything stateful moves it to a neutral module, never widens the plan→sim allow list); `isOpen(world, place, clock)`; `popcount(mask)` counts the days in a `DayMask` | `src/sim/placeKinds.ts`, `src/sim/schedule.ts`, `src/sim/places.ts` |
| When does this particular business open (half-day Wednesday, late Thursday, closed Mondays, its own quarter hour)? | `withLocalHours(graph, seed)` in `createWorld`: each place's own copy of its kind's `defaultHours`, seeded per place; read the hours from `world.graph`, never from the planner's graph or `defaultHours` | `src/sim/hours.ts` |
| How long does it take to get between places? Which one is nearest? Which roads does the walk take? | `world.travel.minutes(a, b, car)`, `world.travel.nearest(from, candidates)`, `world.travel.roadPath(a, b)` (the road nodes in order) | `src/sim/travel.ts` |
| Who is travelling right now, and how (foot, car, bike, bus, train)? | `world.trips`: one `Trip` per traveller under way (mode, from, to, depart, arrive, `run` for a bus or train ride; `leader` for companions riding or walking along, so a family is one car), pushed by `go`, dropped on arrival; one actor's: `tripOf(world, id)`; the mode rule is `world.travel.mode(a, b, car, walkUpTo)` with the traveller's own `walkLimit(world, id, place, activity)` (habit, the big shop, weather, dark, age, small children; schedule.ts). Traffic is spawned from it, the street layer walks the foot trips | `src/sim/travel.ts`, `src/sim/schedule.ts` |
| Where do commuters work, where do the older children go to school? Who is out of town? | places of kind `'away'` (the city, the next town, its secondary school, and `holiday`, where families go away): appended to the planner's graph by `createWorld` (`withOffsite`, the planner's own graph is left as it is), entrance at the town's `gateway` node and `beyond` metres further; `world.offsite` (`work`, `secondary`). Anyone whose place is an `'away'` place is out of town: not drawn, met by nobody. Without a car they ride the timetable: `awayRide(world, from, to, clock)` (via transit's `nextRide`; the trip carries the `run`), else they get a lift | `src/sim/offsite.ts`, `src/sim/travel.ts` |
| Bus and train lines, stops, timetables, the school bus | `src/sim/transit.ts` (pure, so people ride the bus in the sim) | `transitOf(world)` (stops, lines, runs; built once per world from the place graph, the region and its railway), `runsOnDay`, `departures(world, stop, clock)`, `nextRide(world, from, to, clock)`, `runsAt(world, clock)` |
| Game time: day, weekday, minute of day | `dayOf`, `weekdayOf`, `minuteOfDay`, `onDay`, `atMinute` | `src/sim/time.ts` |
| What date is it, which season, when does the sun rise and set? Is it a holiday, a school day? | `dateOf(world, clock)`, `monthKey` (a running month number for monthly books), `seasonOf`, `warmth`, `sunAt(world, clock)`, `holidayOn`, `termOn`, `schoolDay`. Game day 0 is a Monday; `world.epoch` maps it to a real date, which comes in through `createWorld(graph, seed, { start })`; the pure layers never read the wall clock (guarded). `runsLike(world, clock)` is the weekday a day runs like (public holidays run like Sundays): opening hours (`isOpen`) and shifts (`worksOn`, `src/sim/schedule.ts`) read the week only through it | `src/sim/calendar.ts` |
| What is the weather (sky, temperature, rain or snow, wind, wet streets, lying snow, ice, frost)? Is it nice out, cold, wet, foul? How do people say it? | `weatherAt(world, clock?)` → `Weather`: a seeded chain by season, a pure function of (seed, civil date and minute: the same day has the same weather whatever day the town started), cached per minute, the same for the live tick, the chronicle and the screen; `windDir` (radians), `strikesIn`, `isWetOut`, `isCold`, `isHot`, `isNiceOut`, `isFoul`, `describeWeather`; without a world (the screen before the sim runs) `new WeatherModel(seed, epoch).weather(clock)` | `src/sim/weather.ts` |
| Where do the sun and the moon stand (direction, height), what phase is the moon? | `sunPosition(world, clock)`, `moonPosition`, `moonPhase`, `moonLit`, `yearPhase` (consistent with `sunAt`'s sunrise and sunset); world axes east +x, north -z | `src/sim/calendar.ts` |
| What is on in town today: market, bin day per street, services, matches, club meetings, the council, the festival, weddings and funerals? | `agendaOn(world, day)` → `Occasion[]` (place, start, end, pull, appeal, guests, activity, about); clubs and institutions add their meetings with `addRecurring(world, r)` (weekdays read through `runsLike`, `nth` weekday of the month, `months`), one-off occasions with `addOccasion` / `cancelOccasion`; there is no second calendar. The schedule offers what is on in free time (`drawingOn`); guests of a ceremony get an `attend` intention the night before. Weddings (after an `engage`ment) and funerals are planned and held by `src/sim/life.ts` | `src/sim/agenda.ts` |
| Make a world with its population | `createWorld(graph, seed)` (households, kin, jobs from staff slots, schools, habits, pets, livestock, wildlife, relationships) | `src/sim/synth.ts` |
| Add one person, animal or household; (re)settle school, routine and habits | `newPerson`, `newAnimal`, `adoptPet`, `addHousehold`, `settle` (used by synthesis and life events) | `src/sim/synth.ts` |
| Common questions about an actor: living person? traits, values, household, job, car, commute; places of a kind or service | `isPerson`, `traitOf`, `valueOf`, `householdOf`, `jobOf`, `hasCar`, `commute`, `placesOf`, `placesWith`, `ageOf`, `nameOf` | `src/sim/world.ts` |
| Advance the world | `tick(world, minutes)` (live); `chronicle(world, days)` (time skip: whole days, life events, sampled conversations); `history(world, years)` or `createWorld(graph, seed, { history })` (the town's past before play); `passDays(world, days)` is the slow part both share | `src/sim/world.ts`, `src/sim/chronicle.ts` |
| Save and load the world | `saveWorld(world)` → one `Uint8Array` (a JSON tree plus the typed arrays; about 10 MB for 2,000 people with a year of history, so it goes to IndexedDB, not `localStorage`), `loadWorld(planned, bytes)` on the town planned again from its seed; generic over `World`'s fields, so new state needs no save code (a class it cannot restore fails the save test: add it to `CLASSES`). The sim worker calls them, `src/persist` stores the bytes (the worker and `SimClient` belong to the street-people track) | `src/sim/save.ts` |
| What happened to this person while time was skipped? | `digest(world, id, since)`: their memories and the news they heard, nothing they don't know | `src/sim/chronicle.ts` |
| A random number inside the sim | `tickRng(world, ...purpose)`: derived from (seed, clock, purpose), so saves need no generator state | `src/sim/world.ts` |
| Births, deaths, illness, romance, jobs, moving, pets, crime, holidays away (`world.life.away`) | `lifeDay(world, days)` (daily in `tick`; coarse steps in the chronicle); `world.life.events` is the record; `leaveTown` for anyone dying or moving away; `partnerOf`, `vacantHomes`, `moveInto` | `src/sim/life.ts` |
| Money: household budgets (wages, pensions, support, rent or mortgage, bills, spending), business ledgers, prices | `world.economy`; `payOf(job)`, `budgetOf(world, hh)`, `PRICES`, `TRADES` (how each kind earns); `economyDay(world, days)` (in `passDays`); a customer visit in live play: `spend(world, id, place, activity)` (in `arrive`); a free-time trip to a particular shop: `shoppingTrip` | `src/sim/economy.ts` |
| Businesses closing and opening; is this job still there? the care home | `closeBusiness`, `openBusiness`, `ownerOf(world, place)`, `jobOpen(world, job)`, `hireable(world, job)` (vacant, open, not elected: the one filter for hiring), `world.economy.events`; `careHomeRoom`, `moveToCareHome` | `src/sim/economy.ts` |
| Change what a place is (a shop closes into a vacant unit, a unit reopens) | `setPlaceKind(world, place, kind, patch)` (keeps the per-kind lookups right) | `src/sim/world.ts` |
| What the economy looks like on the street: to-let and for-sale boards, new and struggling shops, upkeep and wealth per place | `townLooks(world)` → `TownLooks` (`LOOK_*` flags, `upkeep`, `wealth` per PlaceId); views get it only through `viewOf` (SimView), never by calling it themselves | `src/sim/economy.ts` |
| Who lives on this street (who notices a move, a closure, a new shop)? | `neighboursOf(world, place, not?)` | `src/sim/life.ts` |
| Who are a place's regulars (who count it among their favourite places)? | `regularsOf(world, place)` | `src/sim/economy.ts` |
| Clubs, congregations, the council: members, office holders, meetings, big days | `world.groups` (`Group`: kind, place, `members` with join days, `offices`). `foundGroups` at the start, `groupsDay` monthly from `passDays` (members come and go, AGMs elect office holders, offices that go with a job follow the job, big days are announced a month ahead and their results are news, small clubs fold, missing ones are founded). Meetings go into the agenda with `addRecurring` and the group's `members` array as the guest list, so that array is only changed in place. `groupsOf(world, id)` (groups and office, for views and the NPC card), `groupsOfKind`. The chronicle samples meetings with `clubEvenings` | `src/sim/groups.ts` |
| Local politics: elections, the mayor, council votes, live issues | `world.politics`: `foundPolitics` at the start, `politicsDay` from `passDays` (an issue comes up now and then and is news; the council votes on it at a first-Monday meeting months later, each councillor by stance; every four years on the second Sunday in May the town elects its mayor and council, with a by-election when the mayor leaves office). `stanceOf(world, id, key)` derives a stance (−1..1) from personality, age, children, car and home, never stored; `opinionsOf` for views and the NPC card; `mayorOf`. Seats are the council group's members (`seat` in groups.ts); the mayor is the holder of the town hall's mayor job, which is elected, never hired (`hireable` in economy.ts) | `src/sim/politics.ts` |
| How much does a trait or value formula weigh for someone? | `weighed(world, id, weights, centre?)`: one weighted sum over the Big Five and the four values, used by club appeal and political stances; formulas are data (`Weights`), never ad-hoc trait arithmetic | `src/sim/world.ts` |
| Move an actor or change what they do | `go(world, id, place, activity, until)` (travel, followers); decisions come from `decideAll` | `src/sim/schedule.ts` |
| Who meets whom right now? | `encounters(world)` (last tick's conversations, with what was told); `presentAt(world, place)`; one conversation, live or in the chronicle: `encounter(world, place, a, b, hub, rng)` | `src/sim/encounters.ts` |
| What does this person believe, and from whom? | `beliefsOf(world, id)`; facts are created with `addFact` and spread with `witness` / `tell` / `broadcast` (a broadcast reaches the readers it is given, or a share of the town) (phone calls and messages between close ties: `phoneCalls(world)` hourly in the tick, one call is `call(world, x, y, rng)`, `src/sim/phone.ts`); `reach` for rumour metrics | `src/sim/knowledge.ts` |
| What is in the town's weekly paper, what hangs on the notice boards, lamp posts and shop windows, and who reads it? | `world.media`: `mediaDay(world, days)` from `passDays` prints the paper on `paperDay` (`latestEdition`, `paperName`, `paperReaders`) from the week's life events, business events, public facts and the coming agenda, and pins up notices (`postNotice`, `noticesAt(world, place)`, `boardsOf`, `nearestBoards`); readers learn what they read through `broadcast`. Words are procedural | `src/sim/media.ts` |
| Which pets are missing, and where are they? | `lostAt(world, id)` (-1 when home), `lostPets(world)`; `lostPetsDay` from `passDays` (strays, the search, found or given up), `goMissing(world, pet, salt)` | `src/sim/lostPets.ts` |
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
| Which model runs a task? | `route(roster, task.routing, pins)`; pins are the player's per-task picks, else `DEFAULT_TASK_MODELS` (the settings screen shows `llm.plan(task)`) | `src/llm/router.ts`, `src/llm/roster.ts` |
| How much has the LLM cost so far? | the usage ledger: `UsageLedger` (`total()`, `by('task' \| 'model' \| 'npc' \| 'session')`, `onRecord`) | `src/llm/usage.ts` |
| What does an NPC's prompt contain? | `NpcPromptInput` (card, state, scene, people, places, beliefs, recalled memories, turns: only what that NPC believes) → `speechMessages`; people and places as refs via `RefTable` | `src/llm/prompt.ts` |
| Turn an NPC reply into state changes | the `npc.appraisal` task: `APPRAISAL_SCHEMA` → `parseAppraisal` → `Proposal` for `applyProposal` | `src/llm/appraisal.ts` |
| Test anything that calls an LLM | `replayTransport(recordings)` (never the network); real recordings from `test/slow/openrouter.slow.test.ts` with `LLM_RECORD=1` | `src/llm/recorded.ts` |
| Which models are good at a task? (live, by hand) | `test/slow/llm-models.slow.test.ts` on the scenes in `test/fixtures/llm/scenes.ts`: every candidate, same inputs, scored checks, latency, cost | `test/slow/llm-models.slow.test.ts` |
| Background chatter, a fallback answer, any generated sentence | the procedural text engine | `src/talk/` |

### Sound

| Question | The one way | Where |
|---|---|---|
| Play a sound: ambience bed, spatial one-shot | the audio engine (guarded: `AudioContext` only there) | `src/audio/` *planned* (track G) |
