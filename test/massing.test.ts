import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planTown } from '../src/plan/town';
import { MeshBuilder, type MeshData } from '../src/build/meshBuilder';
import { facadeSpecs, buildBuildings, buildLandmark, buildingBase, buildingHeight, FF } from '../src/build/massing';

// One small town shared by the file (planning it is the expensive part).
const town = planTown({ seed: 1, size: 0 });
const { terrain } = town;
const buildings = town.cells.flatMap((c) => c.buildings);
const farmBuildings = town.rural.farms.flatMap((f) => town.rural.layout(f.id).buildings);

function shellTown(): MeshData {
  const mb = new MeshBuilder(facadeSpecs());
  for (const c of town.cells) buildBuildings(mb, c.buildings, terrain);
  for (const lm of town.macro.landmarks) buildLandmark(mb, lm, terrain);
  buildBuildings(mb, farmBuildings, terrain);
  return mb.build();
}

test('the town shells are a sound facade mesh: indices in range, unit normals facing the winding, valid facade attributes, deterministic', () => {
  const d = shellTown();
  const P = d.attrs.position.array, N = d.attrs.normal.array, I = d.index;
  const UV = d.attrs.uv.array, LY = d.attrs.aLayer.array, FA = d.attrs.aFacade.array, SD = d.attrs.aSeed.array, TI = d.attrs.aTint.array;
  const nv = P.length / 3;
  assert.ok(nv > 10000 && I.length > 0, `${nv} vertices`);
  assert.deepEqual([UV.length, LY.length, FA.length, SD.length, TI.length], [nv * 2, nv, nv * 4, nv, nv * 3]);
  assert.ok(!('aElem' in d.attrs) && !('color' in d.attrs));
  for (let i = 0; i < P.length; i++) if (!Number.isFinite(P[i])) assert.fail(`position ${i} is ${P[i]}`);
  for (let i = 0; i < UV.length; i++) if (!Number.isFinite(UV[i])) assert.fail(`uv ${i} is ${UV[i]}`);
  for (let i = 0; i < N.length; i += 3) if (!(Math.abs(Math.hypot(N[i], N[i + 1], N[i + 2]) - 1) < 1e-4)) assert.fail(`normal of vertex ${i / 3}`);
  for (let i = 0; i < nv; i++) {
    const l = LY[i], f = FA[i * 4 + 3];
    if (!Number.isInteger(l) || l < 0 || l >= 24) assert.fail(`vertex ${i}: layer ${l}`);
    if (!Number.isInteger(f) || f < 0 || f >= 32768) assert.fail(`vertex ${i}: flags ${f}`);
    if (!(FA[i * 4] > 0 && FA[i * 4 + 1] > 0 && FA[i * 4 + 2] > 0)) assert.fail(`vertex ${i}: facade ${FA.slice(i * 4, i * 4 + 4)}`);
    if (!(SD[i] >= 0 && SD[i] < 1)) assert.fail(`vertex ${i}: seed ${SD[i]}`);
  }
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
    const mb = new MeshBuilder(facadeSpecs());
    buildLandmark(mb, lm, terrain);
    assert.ok(mb.vcount > 20, `${lm.kind} has ${mb.vcount} vertices`);
  }
  const e = shellTown();
  const same = (a: ArrayBufferView, b: ArrayBufferView) => Buffer.from(a.buffer, a.byteOffset, a.byteLength).equals(Buffer.from(b.buffer, b.byteOffset, b.byteLength));
  for (const k of ['position', 'uv', 'aLayer', 'aTint', 'aFacade', 'aSeed']) assert.ok(same(e.attrs[k].array, d.attrs[k].array), `${k} differs`);
  assert.ok(same(e.index, I), 'index differs');
});

test('each building: plinth to wall top, windowed walls with storey uvs, a front door, roofs flagged as roofs', () => {
  for (const b of [...buildings, ...farmBuildings]) {
    const mb = new MeshBuilder(facadeSpecs());
    buildBuildings(mb, [b], terrain);
    const d = mb.build();
    const [, y0, , , y1] = d.bounds;
    const { base, low } = buildingBase(b, terrain);
    const top = base + buildingHeight(b);
    const name = `building ${b.id} (${b.style}, ${b.roof})`;
    assert.ok(Math.abs(y0 - (base - low > 0.25 ? low : base)) < 1e-3, `${name} starts at ${y0}, base ${base}, low ${low}`);
    assert.ok(y1 >= top - 1e-3 && y1 < top + 16, `${name} ends at ${y1}, wall top ${top}`);
    if (b.roof === 'flat' && b.style !== 'house') assert.ok(y1 >= top + 0.9 - 1e-3, `${name} has no parapet`);

    const P = d.attrs.position.array, N = d.attrs.normal.array, UV = d.attrs.uv.array, LY = d.attrs.aLayer.array, FA = d.attrs.aFacade.array;
    let windows = 0, roof = 0, front = 0, shop = 0;
    for (let i = 0; i < LY.length; i++) {
      const f = FA[i * 4 + 3];
      const wall = Math.abs(N[i * 3 + 1]) < 1e-6;
      if (f & FF.Roof) {
        if (LY[i] < 16) assert.fail(`${name}: roof flag on wall layer ${LY[i]}`);
        if (N[i * 3 + 1] > 0) roof++;
      }
      if (f & FF.Front) front++;
      if (f & FF.Shop) shop++;
      if (f & FF.Windows && !(f & FF.Roof) && wall && LY[i] === b.wall) {
        windows++;
        // Walls: v is the height above the ground floor level (the shader counts storeys from it).
        if (Math.abs(UV[i * 2 + 1] - (P[i * 3 + 1] - base)) > 1e-3) assert.fail(`${name}: wall v ${UV[i * 2 + 1]} at height ${P[i * 3 + 1] - base}`);
        if (FA[i * 4 + 1] !== Math.fround(b.floorH) || FA[i * 4 + 2] !== Math.fround(b.groundH)) assert.fail(`${name}: storey heights ${FA.slice(i * 4, i * 4 + 3)}`);
      }
    }
    if (b.style !== 'garage') assert.ok(windows > 0, `${name} has no windowed walls`);
    assert.ok(roof > 0, `${name} has no roof surface`);
    assert.ok(front > 0, `${name} has no front`);
    assert.equal(shop > 0, b.shopfront, `${name}: shop front`);
  }
});
