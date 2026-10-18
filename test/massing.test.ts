import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planTown } from '../src/plan/town';
import { MeshBuilder, type MeshData } from '../src/build/meshBuilder';
import { MASSING_SPECS, buildBuildings, buildLandmark, buildingBase, buildingHeight } from '../src/build/massing';

// One small town shared by the file (planning it is the expensive part).
const town = planTown({ seed: 1, size: 0 });
const { terrain } = town;
const buildings = town.cells.flatMap((c) => c.buildings);
const farmBuildings = town.rural.farms.flatMap((f) => town.rural.layout(f.id).buildings);

function massTown(): MeshData {
  const mb = new MeshBuilder([...MASSING_SPECS]);
  for (const c of town.cells) buildBuildings(mb, c.buildings, terrain);
  for (const lm of town.macro.landmarks) buildLandmark(mb, lm, terrain);
  buildBuildings(mb, farmBuildings, terrain);
  return mb.build();
}

test('the town massing is a sound mesh: indices in range, finite positions, unit normals facing the winding, deterministic', () => {
  const d = massTown();
  const P = d.attrs.position.array, N = d.attrs.normal.array, C = d.attrs.color.array, I = d.index;
  const nv = P.length / 3;
  assert.ok(nv > 10000 && I.length > 0, `${nv} vertices`);
  assert.equal(C.length, nv * 3);
  for (let i = 0; i < P.length; i++) if (!Number.isFinite(P[i])) assert.fail(`position ${i} is ${P[i]}`);
  for (let i = 0; i < N.length; i += 3) if (!(Math.abs(Math.hypot(N[i], N[i + 1], N[i + 2]) - 1) < 1e-4)) assert.fail(`normal of vertex ${i / 3}`);
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
    if (I[t] >= nv || I[t + 1] >= nv || I[t + 2] >= nv) assert.fail(`triangle ${t / 3} is out of range`);
    // Front faces (counter-clockwise) face the way the vertex normals point: outwards.
    const ex = P[b] - P[a], ey = P[b + 1] - P[a + 1], ez = P[b + 2] - P[a + 2];
    const fx = P[c] - P[a], fy = P[c + 1] - P[a + 1], fz = P[c + 2] - P[a + 2];
    const gx = ey * fz - ez * fy, gy = ez * fx - ex * fz, gz = ex * fy - ey * fx;
    const dot = gx * (N[a] + N[b] + N[c]) + gy * (N[a + 1] + N[b + 1] + N[c + 1]) + gz * (N[a + 2] + N[b + 2] + N[c + 2]);
    if (dot < -1e-6) assert.fail(`triangle ${t / 3} is wound against its normals`);
  }
  // Every landmark is drawn.
  for (const lm of town.macro.landmarks) {
    const mb = new MeshBuilder([...MASSING_SPECS]);
    buildLandmark(mb, lm, terrain);
    assert.ok(mb.vcount > 20, `${lm.kind} has ${mb.vcount} vertices`);
  }
  const e = massTown();
  assert.deepEqual(e.attrs.position.array, P);
  assert.deepEqual(e.attrs.color.array, C);
  assert.deepEqual(e.index, I);
});

test('each building stands on its plinth and reaches its wall top, flat roofs with their parapet', () => {
  for (const b of [...buildings, ...farmBuildings]) {
    const mb = new MeshBuilder([...MASSING_SPECS]);
    buildBuildings(mb, [b], terrain);
    const [, y0, , , y1] = mb.build().bounds;
    const { base, low } = buildingBase(b, terrain);
    const top = base + buildingHeight(b);
    assert.ok(Math.abs(y0 - (base - low > 0.25 ? low : base)) < 1e-3, `building ${b.id} (${b.style}) starts at ${y0}, base ${base}, low ${low}`);
    assert.ok(y1 >= top - 1e-3 && y1 < top + 16, `building ${b.id} (${b.style}, ${b.roof}) ends at ${y1}, wall top ${top}`);
    if (b.roof === 'flat' && b.style !== 'house') assert.ok(y1 >= top + 0.9 - 1e-3, `building ${b.id} (${b.style}) has no parapet`);
  }
});
