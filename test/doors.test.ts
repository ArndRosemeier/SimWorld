import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planTown } from '../src/plan/town';
import { planInterior } from '../src/interior/building';
import { indoorsOf } from '../src/interior/indoors';
import { buildingBase } from '../src/build/massing';
import { leafBox, leafWay, shutDoors, stepDoors, useDoor, type DoorLeaf } from '../src/interior/doors';

const town = planTown({ seed: 1, size: 0 });
const flats = town.cells.flatMap((c) => c.buildings).find((b) => b.floors >= 3 && b.units > 1)!;
const ind = indoorsOf(planInterior(flats), buildingBase(flats, town.terrain).base);

test('doors: a leaf in every street door and the room doorways, closing the gap the walls leave', () => {
  const street = ind.leaves.filter((l) => l.street >= 0), rooms = ind.leaves.filter((l) => l.street < 0);
  assert.ok(street.length >= ind.doors.length, 'every street door has its leaf');
  assert.ok(rooms.length > 5, `room doors (${rooms.length})`);
  for (const l of ind.leaves) {
    // Shut, the leaf spans its doorway: no wall collider covers its middle, its box does.
    const mx = l.x + l.dx * l.w / 2, mz = l.z + l.dz * l.w / 2, y = l.y + 1;
    const inBox = (b: { x: number; y: number; z: number; hx: number; hy: number; hz: number; yaw: number }) => {
      const dx = mx - b.x, dz = mz - b.z, c = Math.cos(b.yaw), s = Math.sin(b.yaw);
      return Math.abs(dx * c - dz * s) < b.hx + 0.02 && Math.abs(dx * s + dz * c) < b.hz && Math.abs(y - b.y) < b.hy;
    };
    assert.ok(!ind.colliders.some(inBox), 'the doorway is open in the walls');
    assert.ok(inBox(leafBox(l)), 'the shut leaf fills it');
    // Open, it has swung a quarter turn to the side it opens to.
    const [ox, oz] = leafWay(l, 1);
    assert.ok(Math.abs(ox * l.dx + oz * l.dz) < 1e-6 && ox * l.nx + oz * l.nz > 0.999);
  }
  // Street doors open inwards.
  for (const l of street) { const d = ind.doors[l.street]; assert.ok(l.nx * d.nx + l.nz * d.nz < -0.99); }
});

test('doors: walking into one opens it, it shuts behind you; a locked street door opens only from inside or with keys', () => {
  const l: DoorLeaf = ind.leaves.find((q) => q.street >= 0)!, leaves = [l], st = shutDoors(leaves);
  const at = (across: number) => ({ x: l.x + l.dx * l.w / 2 + l.nx * across, y: l.y, z: l.z + l.dz * l.w / 2 + l.nz * across });
  const locked = () => true;
  // From outside without keys: stays shut; with keys (someone who lives there): opens.
  for (let i = 0; i < 20; i++) stepDoors(leaves, st, [at(-0.4)], 0.05, locked);
  assert.equal(st[0].a, 0);
  assert.equal(useDoor(leaves, st, at(-0.4), locked), -2, 'E on a locked door from outside');
  stepDoors(leaves, st, [{ ...at(-0.4), keys: true }], 0.05, locked);
  assert.equal(st[0].to, 1);
  for (let i = 0; i < 20; i++) stepDoors(leaves, st, [at(0.5)], 0.05, locked);
  assert.equal(st[0].a, 1, 'open while they are in the doorway');
  // Nobody near: it shuts after a while, and says so (its box comes back).
  let shut = false;
  for (let i = 0; i < 100; i++) shut = stepDoors(leaves, st, [at(5)], 0.05, locked) || shut;
  assert.equal(st[0].a, 0);
  assert.ok(shut);
  // From inside it opens even when locked; E shuts it again and walking into it does not reopen it at once.
  stepDoors(leaves, st, [at(0.4)], 0.05, locked);
  assert.equal(st[0].to, 1);
  assert.equal(useDoor(leaves, st, at(0.4), locked), 0);
  stepDoors(leaves, st, [at(0.4)], 0.05, locked);
  assert.equal(st[0].to, 0);
});
