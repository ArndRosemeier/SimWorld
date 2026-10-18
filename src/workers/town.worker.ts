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
import { facadeSpecs, buildBuildings, buildLandmark, buildingBase, buildingTiers } from '../build/massing';
import { INTERIOR_SPECS, buildCutaway } from '../build/interior';
import { planInterior, storeyFacade } from '../interior/building';
import { polyBounds } from '../geom/geom2';
import { planTown, type Town } from '../plan/town';
import { parcelParams } from '../world/landuse';
import type { FromTown, ToTown } from './townProtocol';

let town: Town | null = null;
let water: WaterSources | null = null;

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
      buildBuildings(mb, plan.buildings, terrain);
      return { type: 'cell', ground: out(ground), buildings: out(mb), ms: ms() };
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
      for (const f of rural.farms) buildBuildings(mb, rural.layout(f.id).buildings, terrain);
      return { type: 'country', ground: out(buildCountryRoads(rural, macro.rail, terrain)), buildings: out(mb), ms: ms() };
    }
    case 'bridges': {
      const b = buildBridges(macro.bridges, terrain, macro.edges);
      return { type: 'bridges', ground: out(b.deck), buildings: out(b.structure), ms: ms() };
    }
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
  }
}

function meshesOf(r: FromTown): MeshData[] {
  switch (r.type) {
    case 'cell': case 'country': case 'bridges': return [r.ground, r.buildings].filter((x): x is MeshData => !!x);
    case 'terrain': return [r.mesh];
    case 'water': case 'landmark': case 'interior': return r.mesh ? [r.mesh] : [];
    default: return [];
  }
}

self.onmessage = (ev: MessageEvent<ToTown & { job?: number }>) => {
  const job = ev.data.job;
  try {
    const r = handle(ev.data);
    (self as unknown as Worker).postMessage({ ...r, job }, meshesOf(r).flatMap(meshTransferables));
  } catch (err) {
    (self as unknown as Worker).postMessage({ type: 'error', job, message: err instanceof Error ? `${err.message}\n${err.stack}` : String(err) });
  }
};
