import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planTown } from '../src/plan/town';
import { buildGround, GROUND_LAYER_COUNT } from '../src/build/ground';
import { buildTerrainTile, buildWaterTile, terrainTiles, terrainSkirt, waterSources, TERRAIN_DROP } from '../src/build/terrainMesh';
import { buildCountryRoads } from '../src/build/rural';
import type { MeshBuilder, MeshData } from '../src/build/meshBuilder';
import type { Terrain } from '../src/world/terrain';
import { CURB_H } from '../src/world/ground';

// One small town shared by the file (planning it is the expensive part).
const town = planTown({ seed: 1, size: 0 });
const { terrain, cells, rural, macro, land } = town;

/** The meshes under test: two cells' ground, the whole countryside, a terrain tile in town, a river tile. */
function buildAll(): Record<string, MeshData> {
  const out: Record<string, MeshData> = {};
  for (const c of cells.slice(0, 2)) {
    const o: [number, number, number] = [Math.round((c.bounds[0] + c.bounds[2]) / 2), 0, Math.round((c.bounds[1] + c.bounds[3]) / 2)];
    out[`cell ${c.id}`] = buildGround(c, terrain, o).build();
  }
  out.country = (buildCountryRoads(rural, macro.rail, terrain) as MeshBuilder).build();
  const tile = terrainTiles(terrain).find((t) => t.x0 <= 0 && t.z0 <= 0 && t.x0 + t.size > 0 && t.z0 + t.size > 0)!;
  assert.equal(tile.size, 256, 'the finest tiles sit at the town centre');
  out.terrain = buildTerrainTile(terrain, tile.x0, tile.z0, tile.size, tile.res, terrainSkirt(tile.size), land).build();
  const ch = waterSources(terrain).chunks[0];
  const cx = Math.floor((ch.bounds[0] + ch.bounds[2]) / 2 / 512) * 512, cz = Math.floor((ch.bounds[1] + ch.bounds[3]) / 2 / 512) * 512;
  out.water = (buildWaterTile(terrain, cx, cz, 512, waterSources(terrain)) as MeshBuilder).build();
  return out;
}

const meshes = buildAll();

/** World position of vertex i. */
const at = (m: MeshData, i: number): [number, number, number] => {
  const p = m.attrs.position.array;
  return [p[i * 3] + m.origin[0], p[i * 3 + 1] + m.origin[1], p[i * 3 + 2] + m.origin[2]];
};

/** Height above the terrain of every 7th vertex [min, max], over those `keep` selects. */
function lift(m: MeshData, T: Terrain, keep: (i: number) => boolean = () => true): [number, number] {
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < m.attrs.position.array.length / 3; i += 7) {
    if (!keep(i)) continue;
    const [x, y, z] = at(m, i);
    const d = y - T.height(x, z);
    lo = Math.min(lo, d); hi = Math.max(hi, d);
  }
  return [lo, hi];
}

test('ground, country, terrain and water meshes are well formed', () => {
  for (const [name, m] of Object.entries(meshes)) {
    const nv = m.attrs.position.array.length / 3;
    assert.ok(nv >= 3 && m.index.length >= 3, `${name}: non-empty`);
    for (const k in m.attrs) {
      const a = m.attrs[k];
      assert.equal(a.array.length, nv * a.size, `${name}.${k}: one value per vertex`);
      for (let i = 0; i < a.array.length; i++) if (!Number.isFinite(a.array[i])) assert.fail(`${name}.${k}[${i}] is ${a.array[i]}`);
    }
    let maxI = 0;
    for (let i = 0; i < m.index.length; i++) if (m.index[i] > maxI) maxI = m.index[i];
    assert.ok(maxI < nv, `${name}: indices in range`);
    const L = m.attrs.aLayer?.array;
    if (L) for (let i = 0; i < L.length; i++) if (!(Number.isInteger(L[i]) && L[i] >= 0 && L[i] < GROUND_LAYER_COUNT)) assert.fail(`${name}: layer ${L[i]}`);
  }
  assert.ok(meshes.terrain.attrs.aLand && meshes.terrain.attrs.aLand.size === 4, 'terrain carries aLand');
});

test('the ground sits on the terrain', () => {
  // Draped town surfaces (normal straight up): road level to curb height plus the paint lift.
  for (const c of cells.slice(0, 2)) {
    const m = meshes[`cell ${c.id}`], N = m.attrs.normal.array;
    const [lo, hi] = lift(m, terrain, (i) => N[i * 3 + 1] === 1);
    assert.ok(lo > -1e-3 && hi < CURB_H + 0.03, `cell ${c.id}: draped ${lo.toFixed(3)}…${hi.toFixed(3)}`);
  }
  // Country roads and the railway: never buried (bridge decks reach 1.2 m down at the abutments), only bridges stand high.
  const [lo, hi] = lift(meshes.country, terrain);
  assert.ok(lo > -1.5, `country: lowest ${lo.toFixed(2)} m`);
  assert.ok(hi < 20, `country: highest ${hi.toFixed(2)} m`);
  // The terrain grid is the terrain, dropped.
  const t = meshes.terrain, n = 33 * 33;
  const [tlo, thi] = lift(t, terrain, (i) => i < n);
  assert.ok(Math.abs(tlo + TERRAIN_DROP) < 1e-3 && Math.abs(thi + TERRAIN_DROP) < 1e-3, 'terrain grid at height - TERRAIN_DROP');
  // Water lies at the river's level, below the banks.
  const [, whi] = lift(meshes.water, terrain);
  assert.ok(whi < 5, `water: ${whi.toFixed(2)} m above the ground at most`);
});

test('building is deterministic', () => {
  const again = buildAll();
  for (const k of ['country', 'water', `cell ${cells[0].id}`]) {
    assert.deepEqual(again[k].attrs.position.array, meshes[k].attrs.position.array, k);
    assert.deepEqual(again[k].index, meshes[k].index, k);
  }
});
