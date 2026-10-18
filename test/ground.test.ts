import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planTown } from '../src/plan/town';
import { buildGround, groundSurfaces, GROUND_LAYER_COUNT } from '../src/build/ground';
import { intersection, shapesToPolys, shapeArea } from '../src/geom/clip';
import { buildTerrainTile, buildWaterTile, terrainTiles, terrainSkirt, terrainMeshHeight, waterSources, TERRAIN_DROP } from '../src/build/terrainMesh';
import { buildCountryRoads, countryRoadSurface } from '../src/build/rural';
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

test('no two surfaces of a cell lie on each other (they would fight)', () => {
  let checked = 0;
  for (const c of cells.slice(0, 8)) {
    const S = groundSurfaces(c).filter((g) => g.shapes.length);
    for (let a = 0; a < S.length; a++) for (let b = a + 1; b < S.length; b++) {
      // Rounding in the clip leaves slivers along shared edges (millimetres wide): not a surface.
      for (const s of intersection(shapesToPolys(S[a].shapes), shapesToPolys(S[b].shapes))) {
        let per = 0;
        for (let i = 0; i < s.outer.length; i += 2) per += Math.hypot(s.outer[(i + 2) % s.outer.length] - s.outer[i], s.outer[(i + 3) % s.outer.length] - s.outer[i + 1]);
        const width = (2 * shapeArea(s)) / per;
        assert.ok(width < 0.03, `cell ${c.id}: layers ${S[a].layer} and ${S[b].layer} overlap (${shapeArea(s).toFixed(2)} m², ${width.toFixed(3)} m wide)`);
      }
      checked++;
    }
  }
  assert.ok(checked > 20);
});

test('country roads stand clear above the drawn terrain, also far out on its coarse grid', () => {
  let n = 0, worst = Infinity;
  for (const R of rural.roads) {
    const y = countryRoadSurface(R, terrain);
    let len = 0;
    for (let i = 2; i < R.pts.length; i += 2) len += Math.hypot(R.pts[i] - R.pts[i - 2], R.pts[i + 1] - R.pts[i - 1]);
    for (let s = R.trim + 10; s < len; s += 23) {
      // The point at arc length s (the centreline is a polyline).
      let acc = 0, x = R.pts[0], z = R.pts[1];
      for (let i = 2; i < R.pts.length; i += 2) {
        const l = Math.hypot(R.pts[i] - R.pts[i - 2], R.pts[i + 1] - R.pts[i - 1]);
        if (acc + l >= s) { const t = (s - acc) / l; x = R.pts[i - 2] + (R.pts[i] - R.pts[i - 2]) * t; z = R.pts[i - 1] + (R.pts[i + 1] - R.pts[i - 1]) * t; break; }
        acc += l;
      }
      if (terrain.isWater(x, z, 2)) continue;
      worst = Math.min(worst, y(s) - terrainMeshHeight(terrain, x, z));
      n++;
    }
  }
  assert.ok(n > 200, `${n} points`);
  assert.ok(worst > TERRAIN_DROP, `closest ${worst.toFixed(3)} m above the terrain mesh`);
});
