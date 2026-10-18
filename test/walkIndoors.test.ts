import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planTown } from '../src/plan/town';
import { planInterior } from '../src/interior/building';
import { indoorsOf } from '../src/interior/indoors';
import { Physics } from '../src/physics/physics';
import { rampBox } from '../src/physics/solids';
import { Avatar } from '../src/game/avatar';

const town = planTown({ seed: 1, size: 0 });
const flats = town.cells.flatMap((c) => c.buildings).find((b) => b.style !== 'house' && b.units >= 2 && !b.shopfront && b.floors >= 3 && b.poly.length === 8)!;

test('indoors: the body walks in at the street door and up every flight of stairs to the top floor', async () => {
  const base = 10, ind = indoorsOf(planInterior(flats), base);
  const phys = await Physics.create({ x0: -1000, z0: -1000, step: 2000, n: 2, h: new Float32Array(4).fill(base) });
  phys.setSolids('b', [...ind.colliders, ...ind.ramps.map(rampBox)], [], ind.slabs);
  // In at the door: from 3 m out, straight in.
  const d = ind.doors[0];
  const a = new Avatar(phys, d.x + d.nx * 3, base, d.z + d.nz * 3, 0);
  for (let i = 0; i < 90; i++) { a.step(1 / 30, -d.nx, -d.nz, false); phys.world.step(); }
  assert.ok(Math.hypot(a.x - d.x, a.z - d.z) > 1 && Math.abs(a.y - base) < 0.1, `through the door (${(a.x - d.x).toFixed(2)}, ${(a.z - d.z).toFixed(2)})`);
  a.dispose();
  // Up the stairs: each flight from just below its foot to just past its top (onto the landing), as a person would.
  const r0 = ind.ramps[0], top = ind.ramps[ind.ramps.length - 1];
  const way: [number, number][] = ind.ramps.flatMap((r) => {
    const L = Math.hypot(r.x1 - r.x0, r.z1 - r.z0), ux = (r.x1 - r.x0) / L, uz = (r.z1 - r.z0) / L;
    return [[r.x0 - ux * 0.6, r.z0 - uz * 0.6], [r.x1 + ux * 0.6, r.z1 + uz * 0.6]] as [number, number][];
  });
  const b = new Avatar(phys, way[0][0], r0.y0, way[0][1], 0);
  let w = 0;
  for (let i = 0; i < 4000 && w < way.length; i++) {
    const dx = way[w][0] - b.x, dz = way[w][1] - b.z, l = Math.hypot(dx, dz);
    if (l < 0.25) { w++; continue; }
    b.step(1 / 30, dx / l, dz / l, false); phys.world.step();
  }
  assert.equal(w, way.length, `walked every flight (stuck near ${b.x.toFixed(1)}, ${b.y.toFixed(2)}, ${b.z.toFixed(1)})`);
  assert.ok(Math.abs(b.y - top.y1) < 0.1, `on the top floor (${b.y.toFixed(2)} of ${top.y1.toFixed(2)})`);
  b.dispose();
});
