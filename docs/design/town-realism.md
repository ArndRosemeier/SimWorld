# What makes SimWorld's town feel real

The realism checklist, agreed with Arnd on 18 Oct 2026 (thread "Realistic town brainstorm"), grounded in `main` at v0.017
and a read of Scale. The decisions it led to are D20–D26 in [simworld-plan.md](simworld-plan.md), and the build tracks,
their owners and the seams they share are in its section R8. This repo copy is canonical; tracks update an item's status
here in the PR that builds it.

**Status:** `E` exists in SimWorld · `IP` in progress in a thread now · `S` portable from Scale (file named) · `N` new work.
**Priority for perceived realism:** `P1` you notice its absence within a minute · `P2` you notice within an hour of play ·
`P3` depth that rewards long play.

**The one idea behind the list:** every visible detail should be *caused* by something in the sim where it can be. A
parked car stands outside because its household is home; a light is on because someone is awake in that room; the bakery
queue is long because it is Saturday morning; the shop is empty because it went bust last month. Detail that is only
decoration is fine for wear and clutter, but anything that changes over time should read from L0.

---

## 1. The physical town

### 1.1 Streets and the ground

| Item | Status | Prio | Notes |
|---|---|---|---|
| Street hierarchy (arterial, avenue, street, lane), widths, sidewalks, curbs | E | P1 | `RoadClass`, `buildGround`. Arterials look too wide for a 1,500-person town (screenshot); tune widths per town size. |
| Centre lines, lane dashes, zebra crossings | E | P1 | `PaintWhite`/`PaintYellow` layers. Crossings are data: `crossingsOf(plan)` (`src/plan/crossings.ts`), for people crossing the street. |
| Stop lines, turn arrows, "SLOW / SCHOOL" text, bus-stop boxes, parking bays painted, disabled bays, bike lanes, yellow no-parking edges | N | P2 | Ground decals on the same ground kind (a decal atlas layer, no new shader). |
| Curb ramps at crossings, dropped curbs at driveways | N | P2 | Geometry in `buildGround`. |
| Driveways from street to garage/carport | N | P1 | Biggest gap in suburbs: every house sits on unbroken lawn. Plan + ground. |
| Front paths from sidewalk to the front door | N | P1 | The door is known (facade), the path is not. |
| Back alleys / service lanes behind the main street (bins, deliveries) | N | P3 | Where deliveries and bins go. |
| Parking lots (supermarket, station, church, sports ground, school) with painted bays | partly E | P1 | `cell.ts` has asphalt yards; needs bays, lamps, trolley shelters, cars by occupancy. |
| Petrol station with forecourt, canopy, pumps | E | P2 | A landmark site (`petrol`) on an arterial towards the edge: forecourt, canopy on posts, pump islands, kiosk, price sign. Place kind `petrol`. |
| Road surface variety and wear: patches, cracks, tar lines, manholes, drains, puddle spots | S/N | P2 | Scale texgen ground layers have some; manholes are a Scale prop. Wear mask in the ground shader. |
| Gutters, storm drains, leaves collecting in gutters (autumn) | N | P3 | Ties to seasons. |
| Speed bumps near school and in residential streets | N | P3 | |
| Roundabout or a mini-roundabout | N | P3 | Planner option at one arterial junction. |
| Unpaved farm tracks, gravel parking, worn paths across lawns ("desire lines") | partly E | P3 | `Dirt`, `Gravel` layers exist; desire lines could come from where L0 actually walks. |

### 1.2 Lots, gardens and boundaries

| Item | Status | Prio | Notes |
|---|---|---|---|
| Lot boundaries visible: fences, hedges, low walls, gates | partly E | P1 | `PT.Hedge` exists in the planner; fences/walls/gates are new. Style by district and household (wealth, age, care). |
| Front gardens: flower beds, shrubs, gravel, a bench, garden gnome, bird bath | N | P1 | Variety per household; neglected gardens for the elderly-alone or the depressed. |
| Back gardens: lawn, patio, washing line, shed, trampoline, swing set, paddling pool (summer), BBQ, compost bin, vegetable patch, greenhouse | N | P2 | Seen from upper floors and back lanes. Household composition decides (kids → trampoline). |
| Garages and carports per house | N | P1 | Household `car: boolean` exists; the house needs where it goes. |
| Bins at each house (out on collection day!) | N | P1 | A strong "lived in" cue that is driven by the weekly rhythm. |
| Mailboxes / letter slots, house numbers, doorbells, door mats, outdoor lamps by the door | N | P2 | House numbers need the address model (`placeGraph` has addresses). |
| Allotment gardens at the edge of town | N | P3 | A classic social hub for retirees. |
| Lawn variation: mowed stripes, dry patches in summer, uneven colour | N | P2 | Ground shader variation; today every lawn is one flat green. |

### 1.3 Street furniture and clutter

| Item | Status | Prio | Notes |
|---|---|---|---|
| Street trees, park trees, shrubs, forests | IP | P1 | Town planner port, from Scale `props/vegetation.ts`, `build/forest.ts` (10 species, seasonal autumn uniform). |
| Lamps, benches, bins, hydrants, bollards, planters, bus stops, kiosk, fountain, statue, mailbox, bike racks, phone booth, EV chargers, playground, café terraces | IP | P1 | Town planner port, from Scale `props/furniture.ts` (33 kinds, one material). Drop `metroEntrance`. |
| Traffic signs (stop, give way, speed limit, no parking, one-way, school, pedestrian crossing, dead end, town entrance sign with the town's name) | partly S | P1 | Scale has `stopSign` only. Sign faces as an atlas on the furniture kind. Town entrance sign is a cheap, strong identity cue. |
| Street name signs at every junction | N | P1 | Names exist (`streetName`). Needed for the player to navigate and for NPC directions ("on Mill Lane"). |
| Utility poles and overhead wires in suburbs and the countryside, transformer boxes, street cabinets, a substation | N | P2 | Instanced poles plus wire curves; wires are what make a suburb look inhabited. |
| Recycling / glass containers, clothing donation box | N | P3 | |
| Notice boards (town hall, church, supermarket) with posters for real events | N | P2 | Also a broadcast channel in the knowledge model (§2.2 of the plan). |
| Posters, flyers on lamp posts (lost cat, yard sale, band night) | N | P3 | Generated from real sim events (a pet actually went missing). |
| Flags (town hall, school), bunting for festivals | partly E | P3 | Flagpoles exist on landmarks. |
| Litter, cigarette ends near the pub, fallen leaves, chewing gum spots | N | P3 | Decals; amount follows foot traffic and street cleaning. |
| Graffiti and tags (rare, low-crime town) | S | P3 | Scale `factions/Graffiti.ts`; the vandalism life event should leave one. |
| Construction site: fence, skip, scaffold, portable toilet | S | P3 | Scale `props/construction.ts`. Used when a building is renovated or built (economy). |

### 1.4 Buildings

| Item | Status | Prio | Notes |
|---|---|---|---|
| Textured facades, windows with rooms behind, doors, shop fronts | E | P1 | PR #17. |
| Interiors you can enter | IP | P1 | Interior designer port. |
| Shop signs with the business's real name, opening hours on the door, "Open/Closed" sign | N | P1 | Names exist (`shopName`); the sign today is a coloured band. Text atlas generated at load. |
| Window life: curtains, blinds half drawn, plants, cat in the window, TV flicker at night, Christmas lights in December | N | P2 | Per-window variation in the facade shader driven by a per-dwelling attribute (who lives there, are they home, awake). |
| Lights on per room from L0 occupancy (awake, home) | N | P1 | `LIGHT.night`/`litFrac` exist as uniforms; needs a per-dwelling state texture fed from the sim. This is the night town. |
| Satellite dishes, solar panels, chimneys with smoke in winter, gutters, downpipes, AC units, house extensions | partly E | P2 | Chimneys exist; smoke ties to season/heating. |
| Wear and weathering: dirt streaks under sills, moss on north roofs, peeling paint on run-down houses | N | P2 | Facade shader: a per-building "upkeep" attribute from the owner's money and age. |
| Building age and style mixing: old town core, 60s blocks, new-build estate at the edge | partly E | P2 | Districts exist; a "new estate still being built" is a nice touch tied to the economy. |
| For-sale / to-let signs on vacant homes and shops | N | P2 | `vacantHomes` exists; vacant shops (`vacant` amenity) too. Cheap and very readable. |
| Shop window displays per trade (bread, cakes, meat, clothes, pharmacy cross) | N | P2 | Fits the facade's "rooms behind glass" idea. |

### 1.5 Institutions and businesses (what a 1,000–2,000 town has)

Present today as amenities or place kinds: police, pharmacy, post, bank, library, bakery, butcher, hairdresser, garage,
pub, café, restaurant, pizzeria, ice cream, bar, corner shop, generic shop, office, workshop, factory, town hall,
church, school, kindergarten, doctor, dentist, vet, fire station, station, supermarket, sports ground, park, square,
cemetery, farms.

Missing for a believable town of this size (N unless noted, P2 unless noted):
- ~~**Petrol station**~~ (E: a landmark site on an arterial at the edge), ~~**supermarket on the edge with a car park**~~ (E: the supermarket site, car park in front, towards the edge).
- ~~**Care home / retirement home**~~ (E: a landmark site on a residential edge, two or three storeys, about 2.5 rooms
  per 100 inhabitants as the place's `homes`; residents move in through the economy).
- Hardware/DIY store, clothes shop, florist, newsagent/tobacconist, charity shop, takeaway (kebab, Chinese, chips),
  hotel or B&B, estate agent, insurance/tax adviser, driving school, physiotherapist, beauty salon/nails, gym,
  funeral home, car dealer, builder's merchant, agricultural supplier.
- **Secondary school** (often in the bigger nearby town; decide: lore or here). Kids taking the bus out every morning
  is itself a nice rhythm.
- Clubs and associations as institutions without a building of their own: sports club, choir, volunteer fire brigade,
  shooting/rifle club or similar, allotment society, church groups, youth club, book club. These are *the* social fabric
  of a small town (§4).
- Recycling yard, water tower, sewage works, small business park, grain silo, a closed-down factory (history).
- Playgrounds, a skate park, a swimming pool (open-air, summer only; "closing the pool" is the plan's example politics
  issue), tennis courts, a football pitch with floodlights.

### 1.6 Terrain, water and nature

| Item | Status | Prio | Notes |
|---|---|---|---|
| Terrain, river, lakes, coast, fields, forest land use | E | P1 | |
| Bridges over the river | E | P1 | |
| Riverbank detail: reeds, a footpath, benches, a weir, ducks | N | P2 | |
| Field crops that change with the season (ploughed, green, golden, stubble) | N | P2 | Field patchwork exists (`setParcels`); add a season phase per parcel. |
| Hedgerows and tree lines along field edges and country roads | N | P2 | |
| Grass verges, wildflowers, nettles, rough ground on vacant lots | N | P3 | |

---

## 2. Light, weather and seasons

| Item | Status | Prio | Notes |
|---|---|---|---|
| Day/night cycle: sky, sun, moon, stars, clouds | S | P1 | Scale `render/SkySystem.ts` (+ TSL twin `render/webgpu/sky.ts`). LIGHT uniforms are stuck at day values now. |
| Street lamps on at dusk, a pool of real lights near the camera | S | P1 | Scale `render/lightPool.ts`, PropRenderer's nearest-lamps logic. Our `lights.ts` reserves "a pool for lamps, planned". |
| Weather: clear, fair, cloudy, overcast, drizzle, rain, storm, fog as a seeded Markov chain | S | P1 | Scale `world/weather.ts` (pure; belongs in the sim layer so NPCs react) + `render/Weather.ts` (wet streets, rain, umbrellas, people sheltering, terraces emptying). |
| Wet roads and reflections, puddles that linger after rain | S | P2 | `LIGHT.wet` exists in the facade; ground needs it too. |
| Snow, frost, ice, snow ploughs, gritting | N | P2 | Not in Scale. Depends on the climate decision (Q2). |
| Seasons: foliage colour and leaf fall, bare trees in winter, blossom in spring | S/N | P1 | Scale vegetation has `uSeason` autumn tint; bare winter trees and blossom are new. |
| Season changes behaviour: clothing, terraces only in warm weather, ice cream shop closed in winter, gardening in spring, heating smoke, earlier dusk | N | P1 | The sim must read the date and weather (see §3). |
| Wind: trees sway, flags, litter blowing | S | P3 | Vegetation wind exists in Scale. |
| Calendar: real date or seeded start date, sunrise/sunset by date and latitude | N | P1 | Depends on Q2. |

---

## 3. Daily, weekly and yearly rhythms

The sim has opening hours, staff shifts, schools, habits and a weekday (`weekdayOf`). What a real town adds:

| Item | Status | Prio | Notes |
|---|---|---|---|
| Opening hours per weekday (Sunday closed or short, half-day Wednesday, late opening Thursday) | partly E | P1 | `defaultHours` per kind; vary per business and per weekday. |
| Morning rush: school run, commuters leaving by car and train, bakery queue, delivery vans | partly E | P1 | Schedules exist; visible only once L2 people and traffic exist. |
| Lunch hour, after-school (kids in the park, sports club training), after-work (supermarket, pub), evening (dog walks, the pub, lights going off one by one) | partly E | P1 | |
| Commuters to the big city / nearby town (region lore): they leave by train or car and come back, unseen in between | N | P1 | A real share of a small town's workers work elsewhere; today every job is in town. |
| Weekly: market day on the square, bin day per street, church on Sunday, football match Saturday, choir Tuesday, council meeting monthly, newspaper day | N | P1 | A weekly calendar of recurring events tied to institutions and clubs. |
| Chores and errands: grocery shop 1–3× a week, bank, post, hairdresser every 6 weeks, doctor visits when ill, car to the garage, mowing the lawn on Saturday, washing the car | partly E | P2 | Needs/services exist; frequencies and visible chores are new. |
| School terms and holidays (summer holiday empties the school, families go away on holiday: houses dark, post piling up) | N | P1 | Families "away on holiday" is cheap realism and great gossip. |
| Public holidays and festive seasons: Christmas (lights, tree on the square, shops closed), New Year fireworks, Easter, Halloween?, a national day? | N | P2 | Placeless western: needs Arnd's pick (Q5). |
| Town events: summer festival / fair, Christmas market, flea market, open-air cinema, school play, sports day, carnival, harvest festival, a wedding at the church, a funeral procession | N | P2 | Scale `game/concert`, `game/soccer` show how to stage a crowd event; the sim's life events already produce weddings and deaths, they just need the ceremony. |
| Life course rhythms: first day at school, exams, graduation, retirement party, birthdays (a party at home, balloons on the gate) | partly E | P2 | Life events exist (`birthday`, `schoolStart`, `retired`); the visible celebration is new. |

---

## 4. Social fabric

| Item | Status | Prio | Notes |
|---|---|---|---|
| Households, kin, friendships, romance, feuds, history, gossip and rumour variants | E | P1 | Society sim + knowledge. |
| Neighbours as a relationship class: lend a ladder, complain about the hedge, watch the house during holidays | N | P2 | Encounters at the garden fence; a strong small-town flavour. |
| Clubs and associations with members, meetings, office holders, annual events | N | P1 | The structure that makes "everybody knows everybody". Membership is the main way adults meet outside work. |
| Local politics: mayor, council, an election cycle, one or two live issues (the pool, a bypass, a new estate), letters to the paper | N | P2 | Plan R7 names it; nothing built yet. |
| Reputation per person ("the Millers' boy", "she never pays on time") | partly E | P2 | Beliefs carry it; an explicit public-opinion summary per person would help the prompt and the chatter. |
| Local newspaper (weekly) and its stories from real events, notice boards, church newsletter | N | P2 | Plan §2.2 broadcast; Scale `game/news/headlines.ts` turns events into headlines and street talk. |
| Phones: calls and messages that spread news without meeting | N | ? | Plan lists this as "later, optional". In a modern town people use phones constantly (Q4). |
| Religion: one or two congregations, attendance by `faith` value, baptisms, weddings, funerals | partly E | P3 | Church and `faith` exist. |
| Newcomers, people moving away, students leaving for the city, people returning | E | P2 | Life events and region destinations. |

---

## 5. Life on the streets (what you see moving)

| Item | Status | Prio | Notes |
|---|---|---|---|
| People walking on sidewalks, crossing at crossings, entering doors (the L0→L2 promotion) | S | P1 | Plan step 4. Scale `sim/Pedestrians.ts`, `CrowdRenderer.ts`, `CrowdBaker.ts` (VAT crowds), humans from `@futuremagic/humanoid`. The single biggest missing piece: the town has 1,500 people and you see none. |
| Visible activities: sitting on benches, chatting in pairs, waiting at the bus stop, smoking outside the pub, kids playing ball, someone jogging, gardening, washing a car, carrying shopping bags, pushing a pram, using a walking frame | N | P1 | Each L0 activity needs an L2 pose/animation and a prop. |
| Clothing by weather, season, age, job (uniforms: police, postal worker, nurse, chef whites) | S/N | P1 | Scale `humanoid/client/wardrobe.ts`, umbrellas in `Weather.ts`. Work uniforms are new. |
| Café and pub terraces with people | S | P2 | Scale `sim/Terraces.ts`. |
| Moving traffic with signals, right of way, IDM following | IP/S | P1 | Town planner port plans it next (Scale `sim/Traffic.ts`, `RoadNet.ts`, `VehicleRenderer.ts`). |
| Traffic *from the sim*: the cars on the road are the households' real trips (commute, school run, shopping), not random | N | P1 | Scale spawns from citizens' trips plus through traffic; we must spawn from L0 `go()` with `car`. |
| Parked cars that belong to households and move when they drive away; empty driveways while at work | N | P1 | Parked cars are in progress as decoration; tying them to L0 is new. |
| Buses on a timetable through town to the station and the nearby town; the school bus | N | P2 | Bus stops exist; a line with stops and a timetable is new. Scale has bus models and `bus_airbrake` sound. |
| Trains stopping at the station on a timetable, commuters getting on and off | N | P2 | The railway and station exist. |
| Service vehicles on real rounds: bin lorry on bin day, post van and postal worker on foot, delivery vans to shops at dawn, milk/bread delivery, tractor on the country road, street sweeper, school bus | N | P2 | Each is a job holder in the sim doing their route. |
| Emergency vehicles for real events: ambulance for an illness/death at home, police car for a burglary, fire engine for a fire | S | P2 | Models exist in Scale (`ambulance`, `firetruck`, `police`). The trigger must be a sim event. |
| Cyclists, e-scooters, kids on bikes, mobility scooters | N | P2 | No bicycle model in Scale. |
| Pets on screen: dogs walked on leads, cats on walls and windowsills, the dog that barks at the postman | N | P1 | Sim has pets with owners and follow-along; models from AssetGenerator's quadruped generator (plan R3). |
| Livestock on farms, horses in paddocks | N | P2 | Sim has livestock. |
| Wildlife: birds (pigeons, sparrows, gulls by the water, ducks on the river), foxes at night, deer at the forest edge, hedgehogs | S/N | P2 | Scale `fauna/Birds.ts` (ambient flocks). Named wildlife from the sim is new on screen. |

---

## 6. Economy

The sim has `money` per person and a `Job` per position, nothing else. A real town's money question is where most
"why" comes from (why the shop closed, why they moved, why they argue).

| Item | Status | Prio | Notes |
|---|---|---|---|
| Wages per job, pensions, child benefit, unemployment support | N | P2 | Income per household per month. |
| Rent or mortgage per dwelling, bills, groceries, car costs | N | P2 | Outgoings; a household under pressure behaves differently (stress, arguments, second job, moving). |
| Prices in shops and the pub (a pint, a loaf), paid by the player too | N | P2 | Player buys things; NPCs mention prices. |
| Businesses with owners, customers, revenue, costs: a shop that loses customers closes, a vacant unit gets a new business | N | P2 | Closures and openings are top-tier town gossip and visible change (signs, to-let boards). |
| Housing market: houses for sale, prices by district, new estate | N | P3 | |
| Wealth visible: car age and model, garden care, house upkeep, clothes | N | P2 | Drives the per-household visual attributes above. |

Depth here is a real fork (Q3).

---

## 7. Sound

| Item | Status | Prio | Notes |
|---|---|---|---|
| Ambient beds: town day/night, park, river, sea, rain light/heavy, wind, interior, crowd | S | P2 | Scale `audio/Audio.ts` (ambience mixer, spatial one-shots) and its sound files (`amb_city_day`, `amb_park`, `amb_river`, `amb_rain_*`, …). |
| Spatial one-shots: car pass-by, idle, horn, bus brakes, doors, footsteps on concrete/grass, terrace clatter, birds | S | P2 | Same; ~40 of Scale's 172 sounds fit SimWorld. |
| New: church bells on the hour and Sunday, school bell, dog barks, kids playing, lawnmower Saturday, train horn, rooster on farms | N | P2 | Short clips; each one is driven by the rhythm in §3. |
| No speech audio (no TTS, decided) | — | — | |

---

## 8. Small things that sell it

- Clocks that show the real game time (church clock, station clock, town hall).
- The station board shows the next trains; the bus stop shows the timetable.
- Shop opening-hours sign matches the sim's hours; "back in 10 minutes" when the only staff member is out.
- Lights going off in sequence after 11 pm; a few insomniacs and the night-shift nurse leaving at 5:30.
- Smoke from chimneys in winter; frost on parked car windscreens on cold mornings.
- Post in the letterbox piling up when someone is on holiday or has died unnoticed (a grim but real story).
- A car with its bonnet up outside the garage; the pub's chalkboard with tonight's quiz.
- A "Welcome to <town>, twinned with <village>" sign at each entrance.
- Map: an in-game town map and minimap with street names (Scale `ui/map/GameMap.ts`, `MapTiles.ts`).

---

## 9. Questions for Arnd

**Answered 18 Oct 2026:** Arnd agreed with the whole list, so every recommendation below is the decision: right-hand
traffic, km/h signs and the yellow centre line; the real calendar in a temperate climate with snowy winters; a real but
simple economy; phones, mostly between close ties; Christmas, New Year, Easter, Halloween, a summer festival and a
Christmas market, with no national holidays; and the secondary school in the nearby town, reached by school bus. The
coordinator dispatched the tracks: A to Town planner port, E to Society simulation, and new threads for B, C, D, F and
G. H waits for E.

| # | Question | Recommendation (agreed) |
|---|---|---|
| Q1 | Road conventions: drive on the right, metric signs (km/h), keep the yellow centre line we have now? | Yes. It needs one consistent set even in a placeless town. |
| Q2 | Calendar and climate: the game date follows the real calendar (it is autumn now), in a temperate climate with real winters and snow? | Yes to both. Seasons are one of the strongest realism cues and the date is free. |
| Q3 | Economy depth: real wages, rent, prices, and businesses that can close and reopen, or money only as flavour? | Real but simple: monthly household budgets and business revenue from actual customers. |
| Q4 | Phones: people call and message each other, so news spreads without meeting? | Yes, mostly between close ties and slower than face to face, so gossip hubs still matter. |
| Q5 | Holidays: Christmas, New Year, Easter, Halloween, plus the town's own summer festival and Christmas market? | Yes, no national holidays (they would place the town). |
| Q6 | Secondary school: in town, or in the bigger nearby town with a school bus every morning? | In the nearby town (lore), with the school bus as a daily rhythm. |

---

## 10. Build tracks

Agreed and dispatched on 18 Oct 2026. The tracks, the threads that own them and the seams they share are in
[simworld-plan.md, R8](simworld-plan.md#r8-town-realism-d20d26).

| Track | What |
|---|---|
| **A. Street dressing** | Trees, furniture, parked cars, driveways, front paths, fences/walls/gates, gardens, bins, garages, parking lots with bays, petrol station, traffic and street-name signs, town entrance signs, utility poles and wires, road decals, for-sale signs, shop signs with names and hours, wear. |
| **B. Sky, weather and seasons** | Calendar and sun by date, sky, weather (pure part in the sim so NPCs react), wet ground, lamp light pool, seasons (foliage, bare trees, crops, snow), lit windows from L0 occupancy, chimney smoke. |
| **C. People and animals on the street** | The sim worker and the L0→L2 promotion: humanoids, crowds, sidewalk walking, doors, visible activities and props, clothing by weather and job, terraces; pets, livestock and birds on screen. |
| **D. Traffic and transport** | Moving traffic from L0 trips, household cars at home, buses and the school bus on a timetable, trains, service rounds, emergency vehicles on real events, cyclists. |
| **E. Town calendar and rhythms** | Per-weekday hours, commuters to the region, weekly events, school terms and holidays, families away, public holidays, town events and ceremonies, phones. |
| **F. Institutions, clubs and economy** | Missing institutions, clubs with members and meetings, local politics, wages, rent, prices, businesses opening and closing. |
| **G. Ambient audio** | Scale's audio engine and fitting sounds, new clips, ambience driven by place, time and weather. |
| **H. Town media** | Weekly paper, notice boards, posters and flyers from real events, the map with street names, clocks and timetables. After E. |

Order by perceived realism: A and B now (the static town looks lived-in, day and night), C and D next (the town moves),
E and F alongside (the movement means something), G and H after.
