/**
 * Test helpers for the drawn ground (src/build/drawnGround.ts): the height of the built ground meshes themselves
 * (the highest upward face over a point), and the wheel contacts of vehicles stood by `settle`, so tests can compare
 * what the traffic and the people stand on with what is drawn.
 */
import type { MeshData } from '../src/build/meshBuilder';
import { TRACK, WHEELBASE, type Stance } from '../src/build/drawnGround';

/** The top of the meshes' upward faces (walls and kerb sides left out) over (x, z), NaN where there is none. */
export function meshHeights(meshes: readonly MeshData[]): (x: number, z: number) => number {
  const G = 8, grid = new Map<number, number[]>(), tris: number[] = [];
  for (const m of meshes) {
    const p = m.attrs.position.array, o = m.origin, I = m.index!;
    for (let k = 0; k < I.length; k += 3) {
      const v = [I[k], I[k + 1], I[k + 2]].flatMap((i) => [p[i * 3] + o[0], p[i * 3 + 1] + o[1], p[i * 3 + 2] + o[2]]);
      const ux = v[3] - v[0], uy = v[4] - v[1], uz = v[5] - v[2], wx = v[6] - v[0], wy = v[7] - v[1], wz = v[8] - v[2];
      const ny = uz * wx - ux * wz, l = Math.hypot(uy * wz - uz * wy, ny, ux * wy - uy * wx);
      if (!l || Math.abs(ny / l) < 0.5) continue;
      const id = tris.length;
      tris.push(...v);
      for (let i = Math.floor(Math.min(v[0], v[3], v[6]) / G); i <= Math.floor(Math.max(v[0], v[3], v[6]) / G); i++) {
        for (let j = Math.floor(Math.min(v[2], v[5], v[8]) / G); j <= Math.floor(Math.max(v[2], v[5], v[8]) / G); j++) {
          const key = i * 65536 + j;
          let a = grid.get(key);
          if (!a) grid.set(key, (a = []));
          a.push(id);
        }
      }
    }
  }
  return (x, z) => {
    let best = NaN;
    for (const id of grid.get(Math.floor(x / G) * 65536 + Math.floor(z / G)) ?? []) {
      const ax = tris[id], ay = tris[id + 1], az = tris[id + 2], bx = tris[id + 3], by = tris[id + 4], bz = tris[id + 5], cx = tris[id + 6], cy = tris[id + 7], cz = tris[id + 8];
      const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
      if (!d) continue;
      const l1 = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / d, l2 = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / d, l3 = 1 - l1 - l2;
      if (l1 < -1e-7 || l2 < -1e-7 || l3 < -1e-7) continue;
      const y = l1 * ay + l2 * by + l3 * cy;
      if (!(y <= best)) best = y;
    }
    return best;
  };
}

/** Is (x, z) on a step of the drawn ground (a kerb, a lip's edge): the meshes differ by more than 4 cm 10 cm round it? */
export function onStep(mesh: (x: number, z: number) => number, x: number, z: number): boolean {
  const m = mesh(x, z);
  return [[0.1, 0], [-0.1, 0], [0, 0.1], [0, -0.1]].some(([dx, dz]) => !(Math.abs(mesh(x + dx, z + dz) - m) < 0.04));
}

/**
 * The four wheel contacts of a vehicle (length × width m) standing at (x, z) facing yaw as `settle` stood it: where
 * each touches (x, z) and the height the tilted body puts it at.
 */
export function wheelContacts(x: number, z: number, yaw: number, length: number, width: number, st: Stance): [number, number, number][] {
  const fx = -Math.sin(yaw), fz = -Math.cos(yaw), rx = -fz, rz = fx, hb = length * WHEELBASE, ht = width * TRACK;
  const out: [number, number, number][] = [];
  for (const a of [hb, -hb]) for (const r of [ht, -ht]) {
    out.push([x + fx * a + rx * r, st.y + Math.sin(st.pitch) * a + Math.sin(st.roll) * r * Math.cos(st.pitch), z + fz * a + rz * r]);
  }
  return out;
}
