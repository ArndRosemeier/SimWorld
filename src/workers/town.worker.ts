/**
 * A town worker: plans the town from its settings (every worker the same town, deterministic),
 * then builds mesh data on request (src/workers/townProtocol.ts). Started by the worker pool
 * only. Takes the place of Scale's city worker (src/stream/city.worker.ts) at town size: no
 * streaming, the whole town is built once.
 */
import { MeshBuilder, meshTransferables, type MeshData } from '../build/meshBuilder';
import { buildGround } from '../build/ground';
import { buildTerrainTile, buildWaterTile, terrainSkirt, terrainTiles, waterSources, type WaterSources } from '../build/terrainMesh';
import { buildCountryRoads } from '../build/rural';
import { buildBridges } from '../build/bridges';
import { lampsOf, propFar, propInstances, propModel } from '../build/streetProps';
import { decorInstances } from '../build/decorProps';
import { ForestGen, townTrees } from '../build/forest';
import { buildVegModel } from '../build/vegetation';
import { facadeSpecs, buildBuildings, buildLandmark, buildingBase, buildingTiers, windowOpenings } from '../build/massing';
import { INTERIOR_SPECS, buildCutaway, buildDoorLeaf, buildIndoors } from '../build/interior';
import { indoorsOf } from '../interior/indoors';
import { planInterior, storeyFacade } from '../interior/building';
import { polyBounds } from '../geom/geom2';
import { planTown, type Town } from '../plan/town';
import { parcelParams } from '../world/landuse';
import { soundMapOf, soundMapTransferables } from '../audio/soundMap';
import { townMapOf, townMapTransferables } from '../plan/townMap';
import type { FromTown, ToTown } from './townProtocol';
import { serve } from './serve';
import { signInstances } from '../build/signs';
import { buildingRef, placeGraphOf } from '../plan/placeGraph';
import { landmarkBody } from '../interior/landmark';
import { townRoads } from '../plan/roads';
import { cityName } from '../plan/names';
import { PLACE_KINDS } from '../sim/places';
import type { SignFacts } from '../render/signFacts';

let town: Town | null = null;
let water: WaterSources | null = null;
let forest: ForestGen | null = null;
/** The planner's places (made on first need): a workplace's staff and capacity size its interior. */
let places: ReturnType<typeof placeGraphOf> | null = null;

const out = (mb: MeshBuilder | null): MeshData | null => (mb && !mb.empty ? mb.build() : null);

function handle(m: ToTown): FromTown {
  const t0 = performance.now();
  const ms = () => Math.round(performance.now() - t0);
  if (m.type === 'init') {
    town = planTown(m.settings);
    const { terrain, macro, cells } = town;
    const c = { x: 0, z: 0 }; // the town is planned around the origin
    return {
      type: 'ready', ms: ms(),
      town: {
        x: c.x, z: c.z, radius: terrain.profile.radius, extent: terrain.worldExtent, y: terrain.height(c.x, c.z),
        cells: cells.length, landmarks: macro.landmarks.length, tiles: terrainTiles(terrain), parcels: parcelParams(m.settings.seed), dwellings: town.dwellings,
      },
    };
  }
  if (!town) throw new Error('town worker: not initialised');
  const { terrain, cells, macro, rural, land } = town;
  switch (m.type) {
    case 'cell': {
      const plan = cells[m.cell];
      const [x0, z0, x1, z1] = plan.bounds;
      const ground = buildGround(plan, terrain, [(x0 + x1) / 2, 0, (z0 + z1) / 2]);
      const mb = new MeshBuilder(facadeSpecs());
      mb.setOrigin((x0 + x1) / 2, 0, (z0 + z1) / 2);
      const chimneys: number[] = [];
      buildBuildings(mb, plan.buildings, terrain, chimneys);
      return { type: 'cell', ground: out(ground), buildings: out(mb), chimneys, ms: ms() };
    }
    case 'terrain': {
      const { x0, z0, size, res } = m.tile;
      return { type: 'terrain', mesh: buildTerrainTile(terrain, x0, z0, size, res, terrainSkirt(size), land).build(), ms: ms() };
    }
    case 'water': {
      water ??= waterSources(terrain);
      const { x0, z0, size } = m.tile;
      return { type: 'water', mesh: out(buildWaterTile(terrain, x0, z0, size, water)), ms: ms() };
    }
    case 'landmark': {
      const lm = macro.landmarks[m.index];
      const mb = new MeshBuilder(facadeSpecs());
      mb.setOrigin(lm.x, 0, lm.z);
      buildLandmark(mb, lm, terrain);
      return { type: 'landmark', mesh: out(mb), ms: ms() };
    }
    case 'country': {
      const mb = new MeshBuilder(facadeSpecs());
      const chimneys: number[] = [];
      for (const f of rural.farms) buildBuildings(mb, rural.layout(f.id).buildings, terrain, chimneys);
      return { type: 'country', ground: out(buildCountryRoads(rural, macro.rail, terrain)), buildings: out(mb), chimneys, ms: ms() };
    }
    case 'bridges': {
      const b = buildBridges(macro.bridges, terrain, macro.edges);
      return { type: 'bridges', ground: out(b.deck), buildings: out(b.structure), ms: ms() };
    }
    case 'props': { const groups = propInstances(cells, terrain, { kerbCars: m.kerbCars }); return { type: 'props', groups, lamps: lampsOf(groups), ms: ms() }; }
    case 'decor': {
      // The town gathers on its first square, else in its first park (as the sim's occasions do, src/sim/agenda.ts).
      places ??= placeGraphOf(town);
      const sq = places.places.find((p) => p.kind === 'square') ?? places.places.find((p) => p.kind === 'park') ?? null;
      return { type: 'decor', groups: decorInstances(cells, terrain, sq), ms: ms() };
    }
    case 'propModel': return { type: 'propModel', mesh: propModel(m.model), far: propFar(m.model), ms: ms() };
    case 'trees': return { type: 'trees', recs: townTrees(cells, terrain), ms: ms() };
    case 'forest': return { type: 'forest', recs: (forest ??= new ForestGen(land, macro)).tile(m.x0, m.z0, m.size), ms: ms() };
    case 'vegModel': return { type: 'vegModel', model: buildVegModel(m.index), ms: ms() };
    case 'sound': return { type: 'sound', map: soundMapOf(town), ms: ms() };
    case 'signs': {
      const graph = placeGraphOf(town), roads = townRoads(town);
      const facts: SignFacts = {
        kind: Uint8Array.from(graph.places, (p) => PLACE_KINDS.indexOf(p.kind)), name: graph.places.map((p) => p.name),
        flags: new Uint8Array(graph.places.length), hours: graph.places.map((p) => p.hours),
      };
      return { type: 'signs', signs: signInstances(town, roads, graph.places, cityName(town.settings.seed)), facts, ms: ms() };
    }
    case 'map': return { type: 'map', map: townMapOf(town), ms: ms() };
    case 'interior': {
      const b = cells[m.cell]?.buildings.find((q) => q.id === m.building);
      if (!b) throw new Error(`no building ${m.building} in cell ${m.cell}`);
      const I = planInterior(b);
      const f = Math.max(0, Math.min(I.storeys.length - 1, m.floor));
      const { base } = buildingBase(b, terrain), tiers = buildingTiers(b);
      const [x0, z0, x1, z1] = polyBounds(b.poly), cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
      const mb = new MeshBuilder(INTERIOR_SPECS);
      mb.setOrigin(cx, base, cz);
      buildCutaway(mb, I, f, base, I.storeys.map((_, k) => storeyFacade(b, k, tiers)));
      const homes = I.units.length ? `, ${I.units.length} home${I.units.length > 1 ? 's' : ''}` : '';
      const about = `${b.style} ${b.use}${b.amenity ? ` (${b.amenity})` : ''}, floor ${f} of ${I.storeys.length}${homes}`;
      return { type: 'interior', mesh: out(mb), at: [cx, base + I.storeys[f].y, cz], radius: Math.hypot(x1 - x0, z1 - z0) / 2, floors: I.storeys.length, about, ms: ms() };
    }
    case 'indoors': {
      const ref = buildingRef(m.building);
      places ??= placeGraphOf(town);
      const work = places.places.find((p) => p.building === m.building && !p.homes);
      const use = work ? { staff: work.staff, capacity: work.capacity } : undefined;
      // A town building, or a public building's walk-in body.
      const lm = ref && 'site' in ref ? macro.landmarks.find((l) => l.id === ref.site) : undefined;
      const body = lm ? landmarkBody(lm, terrain, use) : null;
      const b = ref && 'cell' in ref ? cells[ref.cell]?.buildings[ref.index] : body?.b;
      if (!b) throw new Error(`no building to go into (${m.building})`);
      const I = planInterior(b, body ? body.place : use);
      const base = lm ? lm.base : buildingBase(b, terrain).base;
      const ind = indoorsOf(I, base, body ? body.windows : windowOpenings(b));
      const [x0, z0, x1, z1] = polyBounds(b.poly), cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
      const mb = new MeshBuilder(INTERIOR_SPECS);
      mb.setOrigin(cx, base, cz);
      buildIndoors(mb, I, ind);
      const what = lm ? lm.name : `${b.style} ${b.use}${b.amenity ? ` (${b.amenity})` : ''}`;
      const about = `${what}, ${I.storeys.length} floor${I.storeys.length > 1 ? 's' : ''}, ${I.units.length} home${I.units.length === 1 ? '' : 's'}`;
      const leaves = ind.leaves.map((l) => { const lb = new MeshBuilder(INTERIOR_SPECS); buildDoorLeaf(lb, l); return lb.build(); });
      return { type: 'indoors', mesh: out(mb), at: [cx, base, cz], indoors: ind, leaves, about, ms: ms() };
    }
  }
}

function meshesOf(r: FromTown): MeshData[] {
  switch (r.type) {
    case 'cell': case 'country': case 'bridges': return [r.ground, r.buildings].filter((x): x is MeshData => !!x);
    case 'terrain': return [r.mesh];
    case 'water': case 'landmark': case 'interior': return r.mesh ? [r.mesh] : [];
    case 'indoors': return [...(r.mesh ? [r.mesh] : []), ...r.leaves];
    case 'vegModel': return [r.model.wood, r.model.leaves, r.model.far];
    // (propModel: copied, not transferred: the models stay cached in this worker)
    default: return [];
  }
}

serve<ToTown, FromTown>(handle, (r) => (r.type === 'sound' ? soundMapTransferables(r.map) : r.type === 'map' ? townMapTransferables(r.map) : meshesOf(r).flatMap(meshTransferables)));
