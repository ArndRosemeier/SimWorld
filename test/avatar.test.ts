import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Physics } from '../src/physics/physics';
import { rampBox, wallBoxes } from '../src/physics/solids';
import { Avatar } from '../src/game/avatar';

/** Flat ground at y = 0 with a 0.15 m kerb from x = 4 on, 40 m square. */
const n = 41, h = new Float32Array(n * n);
for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) h[j * n + i] = -20 + i >= 4 ? 0.15 : 0;

test('the body walks, steps up a kerb, and stops at a building wall', async () => {
  const phys = await Physics.create({ x0: -20, z0: -20, step: 1, n, h });
  // A 6 m square house beyond the kerb: x 8…14, z −3…3.
  phys.setSolids('b:1', wallBoxes([8, -3, 14, -3, 14, 3, 8, 3], -1, 8));
  const av = new Avatar(phys, 0, 0, 0, 0);
  phys.world.step();
  for (let i = 0; i < 30; i++) { av.step(1 / 30, 0, 0, false); phys.world.step(); }
  assert.ok(Math.abs(av.y) < 0.05, `stands on the ground (${av.y})`);
  // Walk along +x for 8 s: up the kerb, then into the wall.
  for (let i = 0; i < 240; i++) { av.step(1 / 30, 1, 0, false); phys.world.step(); }
  assert.ok(av.x > 6 && av.x < 8 - 0.2 - 0.25, `stopped at the wall (x ${av.x.toFixed(2)})`);
  assert.ok(Math.abs(av.y - 0.15) < 0.06, `up on the kerb (${av.y.toFixed(2)})`);
  assert.ok(Math.abs(av.yaw + Math.PI / 2) < 0.1, 'facing where it walked');
  // Along the wall it slides on.
  const z0 = av.z;
  for (let i = 0; i < 60; i++) { av.step(1 / 30, 0.7, 0.7, false); phys.world.step(); }
  assert.ok(av.z > z0 + 1, 'slides along the wall');
  av.dispose();
});

test('inside: the body walks up a flight of stairs onto the floor above, and finds room to stand', async () => {
  const phys = await Physics.create({ x0: -20, z0: -20, step: 1, n, h: new Float32Array(n * n) });
  // An upper floor at 2.8 m over x −2…6 with the stairwell open over x 0…4, z −1…1; the stairs climb along +x.
  phys.setSolids('b:2', [rampBox({ x0: 0, y0: 0, z0: 0, x1: 4, y1: 2.8, z1: 0, width: 1.2 })], [], [
    { y: 2.8, outer: [-2, -6, 6, -6, 6, 6, -2, 6], holes: [[0, -1, 4, -1, 4, 1, 0, 1]] },
  ]);
  assert.ok(phys.roomAt(-1, 0, 0, 0.3, 1.8), 'room at the foot of the stairs');
  assert.ok(!phys.roomAt(-1, 0, 3, 0.3, 3.5), 'no room for something taller than the ceiling');
  const av = new Avatar(phys, -1, 0, 0, 0);
  phys.world.step();
  for (let i = 0; i < 360 && av.x < 5; i++) { av.step(1 / 30, 1, 0, false); phys.world.step(); }
  assert.ok(av.x > 4.2 && Math.abs(av.y - 2.8) < 0.1, `up on the floor above (${av.x.toFixed(2)}, ${av.y.toFixed(2)})`);
  av.dispose();
});
