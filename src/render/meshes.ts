/**
 * Mesh data (typed arrays from the build layer, usually made in a worker) into a three.js mesh of a
 * material kind. The one way: the attributes must be the kind's (docs/SHADERS.md), so it is
 * checked here, once.
 */
import { BufferAttribute, BufferGeometry, Mesh } from 'three/webgpu';
import type { MeshData } from '../build/meshBuilder';
import type { MaterialKind } from './materials';

/** A static mesh (no per-frame matrix update) of `kind`, placed at the data's origin. */
export function meshFromData(d: MeshData, kind: MaterialKind): Mesh {
  const want = ['position', 'normal', ...kind.attributes.map((a) => a.name)].sort().join(',');
  const have = Object.keys(d.attrs).sort().join(',');
  if (want !== have) throw new Error(`mesh for kind "${kind.name}" has attributes ${have}, the kind wants ${want}`);
  const g = new BufferGeometry();
  for (const [name, a] of Object.entries(d.attrs)) g.setAttribute(name, new BufferAttribute(a.array, a.size, a.normalized));
  g.setIndex(new BufferAttribute(d.index, 1));
  g.computeBoundingSphere();
  const m = new Mesh(g, kind.make());
  m.position.set(d.origin[0], d.origin[1], d.origin[2]);
  m.updateMatrix();
  m.matrixAutoUpdate = false;
  return wear(m, kind);
}

/** Put `mesh` on `kind`: its material, and the kind's shadow flags (never set per mesh). */
export function wear<T extends Mesh>(mesh: T, kind: MaterialKind): T {
  mesh.material = kind.make();
  mesh.castShadow = kind.shadow.cast;
  mesh.receiveShadow = kind.shadow.receive;
  return mesh;
}
