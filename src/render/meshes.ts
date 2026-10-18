/**
 * Mesh data (typed arrays from the build layer, usually made in a worker) into a three.js mesh of a
 * material kind. The one way: the attributes must be the kind's (docs/SHADERS.md), so it is
 * checked here, once.
 */
import { BatchedMesh, BufferAttribute, BufferGeometry, InstancedBufferAttribute, InstancedMesh, Mesh } from 'three/webgpu';
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
 * Room for at least this many instances in every instanced mesh: three keeps fewer instance
 * matrices in a uniform buffer whose length is part of the shader (a shader per batch size, and
 * the warm-up's one-instance stand-in would match none); this many always go in a vertex
 * attribute (64 KB is the usual uniform block limit), one shader for every batch.
 */
export const MIN_INSTANCES = 2048;

/**
 * `count` copies of the mesh data (a model at its own origin), with the kind's per-instance
 * attributes (`kind.instanced`, zeroed): the caller sets the matrices and attributes, then
 * `computeBoundingSphere()` for culling. Room for `capacity` (at least MIN_INSTANCES): raise
 * `count` up to it later without a new mesh.
 */
export function instancedFromData(d: MeshData, kind: MaterialKind, count: number, capacity = count): InstancedMesh {
  if (!kind.instanced) throw new Error(`kind "${kind.name}" is not drawn instanced`);
  const cap = Math.max(count, capacity, MIN_INSTANCES);
  const g = geometryOf(d, kind);
  for (const a of kind.instanced) g.setAttribute(a.name, new InstancedBufferAttribute(new Float32Array(cap * a.size), a.size));
  const m = wear(new InstancedMesh(g, kind.make(), cap), kind);
  m.count = count;
  return m;
}

/**
 * Many models of a `batched` kind in one BatchedMesh (one shader for all of them: three keys an
 * instanced or batched mesh's shader by the object, so a mesh per model would build one each):
 * `geometries[i]` is model i's id for `addInstance`. Room for `maxInstances`; the caller adds the
 * instances, their matrices and `setColorAt` (the kind's per-instance values, `batchColor` in TSL).
 */
export function batchedFromData(models: readonly MeshData[], kind: MaterialKind, maxInstances: number): { mesh: BatchedMesh; geometries: number[] } {
  if (!kind.batched) throw new Error(`kind "${kind.name}" is not drawn batched`);
  const gs = models.map((d) => geometryOf(d, kind));
  const verts = gs.reduce((n, g) => n + g.getAttribute('position').count, 0), idx = gs.reduce((n, g) => n + g.getIndex()!.count, 0);
  const mesh = wear(new BatchedMesh(Math.max(1, maxInstances), Math.max(3, verts), Math.max(3, idx), kind.make()), kind);
  const geometries = gs.map((g) => { const id = mesh.addGeometry(g); g.dispose(); return id; });
  return { mesh, geometries };
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
