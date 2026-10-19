import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { MeshData } from '../src/build/meshBuilder';
import { bikeSaddle } from '../src/build/bicycle';
import { VEHICLE_KINDS, VEHICLE_SPECS, buildVehicle, paintColor, standingVehicle, vehicleModel, WHEEL_PART } from '../src/build/vehicles';

function assertSound(d: MeshData, what: string): void {
  const P = d.attrs.position.array, N = d.attrs.normal.array, A = d.attrs.aPart.array, I = d.index, nv = P.length / 3;
  assert.ok(nv > 0 && I.length > 0 && I.length % 3 === 0, what);
  assert.deepEqual(Object.keys(d.attrs).sort(), ['position', 'normal', ...VEHICLE_SPECS.map((s) => s.name)].sort(), what);
  for (let i = 0; i < P.length; i++) if (!Number.isFinite(P[i])) assert.fail(`${what}: position ${i}`);
  for (let i = 0; i < N.length; i += 3) if (!(Math.abs(Math.hypot(N[i], N[i + 1], N[i + 2]) - 1) < 1e-3)) assert.fail(`${what}: normal ${i / 3}`);
  for (let i = 0; i < A.length; i++) if (!(Number.isInteger(A[i]) && A[i] >= 0 && A[i] % WHEEL_PART <= 16 && A[i] < 2 * WHEEL_PART)) assert.fail(`${what}: part ${A[i]}`);
  for (let i = 0; i < I.length; i++) if (I[i] >= nv) assert.fail(`${what}: index ${I[i]} of ${nv}`);
}

// (Two halves: about 35 ms a model.)
for (const half of [0, 1]) test(`every vehicle kind builds a sound body and wheel of plausible size (${half ? 'second' : 'first'} half)`, () => {
  for (const kind of VEHICLE_KINDS.filter((k, i) => k !== 'bicycle' && (i < VEHICLE_KINDS.length / 2 ? 0 : 1) === half)) {
    const m = vehicleModel(kind, 0);
    assertSound(m.body, `${kind} body`);
    assertSound(m.wheel, `${kind} wheel`);
    const big = kind === 'bus' || kind === 'truck' || kind === 'firetruck' || kind === 'flatbed';
    assert.ok(m.length > (big ? 6 : 3.8) && m.length < (big ? 13 : 7.5), `${kind}: length ${m.length}`);
    assert.ok(m.width > 1.6 && m.width < 2.7 && m.height > 1.1 && m.height < 3.8, `${kind}: ${m.width} × ${m.height}`);
    assert.ok(m.wheels.length >= 4 && m.wheels.every(([, y]) => Math.abs(y - m.wheelRadius) < 1e-9), kind);
  }
});

test('a standing vehicle has its wheels on the road, under the body; models and paint are deterministic', () => {
  const s = standingVehicle('sedan', 2), m = vehicleModel('sedan', 2);
  assertSound(s, 'standing sedan');
  assert.ok(s.attrs.position.array.length > m.body.attrs.position.array.length);
  assert.ok(Math.abs(s.bounds[1]) < 0.02, `lowest point ${s.bounds[1]}`);
  const a = buildVehicle('hatch', 1), b = buildVehicle('hatch', 1);
  assert.deepEqual(a.body.attrs.position.array, b.body.attrs.position.array);
  for (const kind of ['sedan', 'taxi', 'bus', 'delivery'] as const) for (let seed = 0; seed < 40; seed++) {
    const c = paintColor(kind, seed);
    assert.deepEqual(c, paintColor(kind, seed));
    assert.ok(c.every((x) => x >= 0 && x <= 1), `${kind} ${seed}: ${c}`);
  }
});

test('a bicycle: sound, bike-sized, on the road, its saddle where the rider sits', () => {
  for (let v = 0; v < 4; v++) {
    const b = standingVehicle('bicycle', v), [x0, y0, z0, x1, y1, z1] = b.bounds;
    assertSound(b, `bicycle ${v}`);
    const k = v === 2 ? 0.78 : 1;
    assert.ok(Math.abs(y0) < 0.01 && z1 - z0 > 1.5 * k && z1 - z0 < 1.95 && x1 - x0 < 0.7 && y1 < 1.25 * k, `bicycle ${v}: ${b.bounds.map((n) => n.toFixed(2))}`);
    const s = bikeSaddle(v);
    assert.ok(s.y > 0.6 && s.y < y1 && s.y > y1 - 0.4, `saddle ${s.y} under the bars' top ${y1}`);
  }
});
