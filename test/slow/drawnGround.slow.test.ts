/**
 * The drawn ground over three whole towns (slow tier, by hand only: about a minute). Every cell's ground, the
 * countryside, the bridges and the terrain tiles are built, and the drawn ground (src/build/drawnGround.ts) is held
 * against them: on a grid of points, and under every wheel of a car and a bus along every lane of every road and of a
 * car in every parking spot (`settle`). Ratchets over the three towns; prints the worst places. CI checks two cells
 * and the countryside of one town (test/ground.test.ts).
 *
 *   npm run test:slow -- test/slow/drawnGround.slow.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planTown } from '../../src/plan/town';
import { buildGround } from '../../src/build/ground';
import { buildCountryRoads } from '../../src/build/rural';
import { buildBridges } from '../../src/build/bridges';
import { buildTerrainTile, terrainSkirt, terrainTiles } from '../../src/build/terrainMesh';
import { drawnGround, settle } from '../../src/build/drawnGround';
import type { MeshData } from '../../src/build/meshBuilder';
import { RoadNet } from '../../src/traffic/roadNet';
import { Parking } from '../../src/traffic/parking';
import { DIMS } from '../../src/traffic/traffic';
import { meshHeights, onStep, wheelContacts } from '../groundCheck';

/** How far below / above the meshes the drawn ground may say (m): paint lies 4 cm over the carriageway. */
const BELOW = 0.05, ABOVE = 0.03;
/** Off what is drawn, over seeds 1-3, when this was written: grid points (bridge parapets, overhanging paint), wheels. */
const POINTS = 5, WHEELS = 0;
/** Within this far of the town centre (m). */
const R = 1500;

test('the drawn ground of three towns is what their meshes draw, under feet and wheels', () => {
  let np = 0, nw = 0;
  const badP: string[] = [], badW: string[] = [];
  for (const seed of [1, 2, 3]) {
    const town = planTown({ seed, size: 0 });
    const { terrain, cells, rural, macro, land } = town;
    const meshes: MeshData[] = cells.map((c) => buildGround(c, terrain, [Math.round((c.bounds[0] + c.bounds[2]) / 2), 0, Math.round((c.bounds[1] + c.bounds[3]) / 2)]).build());
    meshes.push(buildCountryRoads(rural, macro.rail, terrain)!.build());
    const deck = buildBridges(macro.bridges, terrain, macro.edges).deck;
    if (deck) meshes.push(deck.build());
    for (const t of terrainTiles(terrain)) {
      if (Math.abs(t.x0 + t.size / 2) < R + t.size && Math.abs(t.z0 + t.size / 2) < R + t.size) meshes.push(buildTerrainTile(terrain, t.x0, t.z0, t.size, t.res, terrainSkirt(t.size), land).build());
    }
    const mesh = meshHeights(meshes), g = drawnGround(town);
    for (let x = -R; x < R; x += 7.3) for (let z = -R; z < R; z += 7.3) {
      const m = mesh(x, z);
      if (m !== m || terrain.isWater(x, z, 0) || onStep(mesh, x, z)) continue;
      np++;
      const d = g.heightAt(x, z) - m;
      if (!(d >= -BELOW && d <= ABOVE)) badP.push(`seed ${seed} (${x.toFixed(1)}, ${z.toFixed(1)}) ${d.toFixed(3)} m`);
    }
    const net = new RoadNet(town), park = new Parking(net, cells.flatMap((c) => c.parking));
    const st = { y: 0, pitch: 0, roll: 0, twist: 0 }, tmp = { x: 0, z: 0, dx: 0, dz: 0 };
    const check = (x: number, z: number, yaw: number, [L, W]: [number, number], what: string) => {
      if (Math.hypot(x, z) > R) return;
      settle((px, pz) => net.groundAt(px, pz), x, z, yaw, L, W, st);
      for (const [wx, wy, wz] of wheelContacts(x, z, yaw, L, W, st)) {
        const m = mesh(wx, wz);
        if (m !== m || onStep(mesh, wx, wz)) continue;
        nw++;
        if (!(wy - m >= -BELOW && wy - m <= ABOVE)) badW.push(`seed ${seed} ${what} wheel at (${wx.toFixed(1)}, ${wz.toFixed(1)}) ${(wy - m).toFixed(3)} m`);
      }
    };
    for (const e of net.edges) for (const fwd of [true, false]) for (let lane = 0; lane < e.lanes; lane++) {
      const off = net.laneOffset(e, fwd, lane);
      for (let s = 1; s < e.len - 1; s += 5) {
        net.lanePoint(e, s, off, tmp);
        const yaw = Math.atan2(fwd ? -tmp.dx : tmp.dx, fwd ? -tmp.dz : tmp.dz);
        check(tmp.x, tmp.z, yaw, DIMS.sedan, 'car');
        check(tmp.x, tmp.z, yaw, DIMS.bus, 'bus');
      }
    }
    for (const s of park.spots) check(s.x, s.z, s.yaw, DIMS.sedan, s.drive ? 'driveway car' : 'parked car');
  }
  const worst = (l: string[]) => l.sort((a, b) => Math.abs(parseFloat(b.split(') ')[1])) - Math.abs(parseFloat(a.split(') ')[1]))).slice(0, 12).join('\n  ');
  console.log(`grid: ${badP.length} of ${np} points off\n  ${worst(badP)}\nwheels: ${badW.length} of ${nw} off\n  ${worst(badW)}`);
  assert.ok(np > 300000 && nw > 150000, `${np} points, ${nw} wheels`);
  assert.ok(badP.length <= POINTS, `${badP.length} grid points off what is drawn (ratchet ${POINTS})`);
  assert.ok(badW.length <= WHEELS, `${badW.length} wheels off the road (ratchet ${WHEELS})`);
});
