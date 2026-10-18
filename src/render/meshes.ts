/**
 * Mesh data (typed arrays from the build layer, usually made in a worker) into a three.js mesh of a
 * material kind. The one way: the attributes must be the kind's (docs/SHADERS.md), so it is
 * checked here, once.
 */
import { BufferAttribute, BufferGeometry, InstancedBufferAttribute, InstancedBufferGeometry, Mesh, Sphere } from 'three/webgpu';
import type { MeshData } from '../build/meshBuilder';
import type { MaterialKind } from './materials';

/** A static mesh (no per-frame matrix update) of `kind`, placed at the data's origin. */
export function meshFromData(d: MeshData, kind: MaterialKind): Mesh {
  const m = new Mesh(geometryOf(d, kind), kind.make());
  m.position.set(d.origin[0], d.origin[1], d.origin[2]);
  m.updateMatrix();
  m.matrixAutoUpdate = false;
  return wear(m, kind);
}

/**
 * `count` copies of the mesh data (a model at its own origin) drawn by geometry instancing: a
 * plain mesh whose InstancedBufferGeometry carries the kind's per-instance attributes
 * (`kind.instanced`, zeroed; the kind's look places each copy from them). Not an InstancedMesh:
 * three keys an InstancedMesh's shader by the object (one build per mesh), a plain mesh's by its
 * attributes, so every mesh of the kind shares the kind's one shader. Room for `capacity`; the
 * caller fills the attributes, sets `geometry.instanceCount` (up to the capacity) and the
 * bounding sphere for culling.
 */
export function instancedFromData(d: MeshData, kind: MaterialKind, count: number, capacity = count): Mesh {
  if (!kind.instanced) throw new Error(`kind "${kind.name}" is not drawn instanced`);
  const cap = Math.max(1, count, capacity);
  const src = geometryOf(d, kind), g = new InstancedBufferGeometry();
  for (const [name, a] of Object.entries(src.attributes)) g.setAttribute(name, a);
  g.setIndex(src.index);
  for (const a of kind.instanced) g.setAttribute(a.name, new InstancedBufferAttribute(new Float32Array(cap * a.size), a.size));
  g.instanceCount = count;
  g.boundingSphere = src.boundingSphere;
  return wear(new Mesh(g, kind.make()), kind);
}

/**
 * Show these instances (`picked`, indices into the source arrays) in geometry-instanced meshes
 * of one kind that share their instance attributes (`instancedFromData`; `meshes[0]` owns them):
 * each attribute named in `src` (per instance, the kind's sizes) copied in order, the count set,
 * uploaded, and a bounding sphere round the instances (their iPose places, `radius` m times the
 * largest iSize) for culling. The one way to repack an instanced mesh when what it shows changes.
 */
export function showInstances(meshes: readonly Mesh[], src: Readonly<Record<string, Float32Array>>, picked: ArrayLike<number>, radius: number): void {
  const g0 = meshes[0].geometry as InstancedBufferGeometry, n = picked.length;
  for (const [name, from] of Object.entries(src)) {
    const a = g0.getAttribute(name) as InstancedBufferAttribute, to = a.array as Float32Array, k = a.itemSize;
    for (let j = 0; j < n; j++) for (let c = 0, f = picked[j] * k; c < k; c++) to[j * k + c] = from[f + c];
    a.needsUpdate = true;
  }
  const pose = src.iPose, size = src.iSize;
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity, s = 0;
  for (let j = 0; j < n; j++) {
    const i = picked[j];
    x0 = Math.min(x0, pose[i * 4]); x1 = Math.max(x1, pose[i * 4]);
    y0 = Math.min(y0, pose[i * 4 + 1]); y1 = Math.max(y1, pose[i * 4 + 1]);
    z0 = Math.min(z0, pose[i * 4 + 2]); z1 = Math.max(z1, pose[i * 4 + 2]);
    s = Math.max(s, size[i * 2], size[i * 2 + 1]);
  }
  for (const m of meshes) {
    const g = m.geometry as InstancedBufferGeometry, sp = (g.boundingSphere ??= new Sphere());
    g.instanceCount = n;
    if (!n) { sp.center.set(0, -1e6, 0); sp.radius = 0; continue; }
    sp.center.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    sp.radius = Math.hypot(x1 - x0, y1 - y0, z1 - z0) / 2 + radius * s;
  }
}

/**
 * Which instances (iPose places, 4 floats each) are within `near` of `cam` (3D, and `nearOk`), and
 * which of the rest within `far`: the split of a near / far pair of instanced meshes, for
 * `showInstances`.
 */
export function splitByDistance(pose: Float32Array, n: number, cam: { x: number; y: number; z: number }, near: number, far = Infinity, nearOk: (i: number) => boolean = () => true): [number[], number[]] {
  const a: number[] = [], b: number[] = [], n2 = near * near, f2 = far * far;
  for (let i = 0; i < n; i++) {
    const dx = pose[i * 4] - cam.x, dy = pose[i * 4 + 1] - cam.y, dz = pose[i * 4 + 2] - cam.z, d2 = dx * dx + dy * dy + dz * dz;
    if (d2 < n2 && nearOk(i)) a.push(i);
    else if (d2 < f2) b.push(i);
  }
  return [a, b];
}

/** The geometry of mesh data whose attributes must be the kind's (checked). */
function geometryOf(d: MeshData, kind: MaterialKind): BufferGeometry {
  const want = ['position', 'normal', ...kind.attributes.map((a) => a.name)].sort().join(',');
  const have = Object.keys(d.attrs).sort().join(',');
  if (want !== have) throw new Error(`mesh for kind "${kind.name}" has attributes ${have}, the kind wants ${want}`);
  const g = new BufferGeometry();
  for (const [name, a] of Object.entries(d.attrs)) g.setAttribute(name, new BufferAttribute(a.array, a.size, a.normalized));
  g.setIndex(new BufferAttribute(d.index, 1));
  g.computeBoundingSphere();
  return g;
}

/** Put `mesh` on `kind`: its material, and the kind's shadow flags (never set per mesh). */
export function wear<T extends Mesh>(mesh: T, kind: MaterialKind): T {
  mesh.material = kind.make();
  mesh.castShadow = kind.shadow.cast;
  mesh.receiveShadow = kind.shadow.receive;
  return mesh;
}
