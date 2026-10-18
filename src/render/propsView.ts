/**
 * The town's street props on the stage: the town workers list every prop's instances per model
 * and build each model once (src/build/streetProps.ts); here all furniture models go into one
 * BatchedMesh (`FURNITURE` kind) and all vehicle models into another (`VEHICLE`), one shader
 * each, with every instance's matrix and its tint or paint as the batch colour. Ported from
 * Scale's src/props/PropRenderer.ts (its batches and its ranges by size), without the streaming:
 * the whole town is placed at once, and `update` shows what is near enough. Parked cars further
 * than NEAR_CAR are drawn as their far stand-in (`farVehicle`), stretched to the car's size.
 */
import { Box3, Matrix4, Quaternion, Vector3, Vector4, type BatchedMesh, type Camera, type Group } from 'three/webgpu';
import type { MeshData } from '../build/meshBuilder';
import type { WorkerPool } from '../workers/pool';
import type { FromTown, ToTown } from '../workers/townProtocol';
import { FAR_VEHICLE, isVehicleModel, PROP_STRIDE, type PropGroup } from '../build/streetProps';
import { FURNITURE, VEHICLE } from './materials';
import { batchedFromData } from './meshes';
import type { Stage } from './stage';

/** Detailed parked cars up to this far from the camera (m), their stand-ins beyond, up to FAR_CAR. */
const NEAR_CAR = 140;
const FAR_CAR = 1100;
/** Furniture shows up to its size times this far (m), within these bounds (Scale's ranges by size). */
const RANGE_PER_M = 160, MIN_RANGE = 70, MAX_RANGE = 650;
/** The camera moves this far (m) before the ranges are checked again. */
const RECHECK = 6;

export interface PropsShown {
  /** Models placed, and instances (a car counts once). */
  models: number;
  instances: number;
  /** Show what is in range of the camera (call each frame; cheap until the camera has moved RECHECK). */
  update(camera: Camera): void;
}

/** One placed instance: where, how far it shows, and its far stand-in's instance (cars). */
interface Placed { x: number; y: number; z: number; id: number; range: number; far: number; mesh: BatchedMesh; visible: boolean; farVisible: boolean }

/** Ask the town workers for the props and their models, then put them into `root` as two batches. */
export async function showProps(stage: Stage, pool: WorkerPool<ToTown, FromTown>, root: Group, priority = 35): Promise<PropsShown> {
  const r = await pool.run({ type: 'props' }, priority);
  if (r.type !== 'props') throw new Error(`town worker: props answered ${r.type}`);
  const groups = r.groups;
  const keys = [...groups.map((g) => g.model), ...(groups.some((g) => isVehicleModel(g.model)) ? [FAR_VEHICLE] : [])];
  const meshes = new Map<string, MeshData>();
  await Promise.all(keys.map(async (model, i) => {
    const m = await pool.run({ type: 'propModel', model }, priority + 1 + i * 0.01);
    if (m.type !== 'propModel') throw new Error(`town worker: propModel answered ${m.type}`);
    meshes.set(model, m.mesh);
  }));

  const placed: Placed[] = [];
  const furniture = groups.filter((g) => !isVehicleModel(g.model)), vehicles = groups.filter((g) => isVehicleModel(g.model));
  const batches: BatchedMesh[] = [];
  if (furniture.length) batches.push(batch('props: furniture', furniture, meshes, false, placed));
  if (vehicles.length) batches.push(batch('props: vehicles', vehicles, meshes, true, placed));
  // (Each batch builds a shader, and a shadow shader, of its own: three keys them by the object.)
  // (One instance shown while they build, so the shadow warm-up draws something.)
  for (const b of batches) {
    const first = placed.find((p) => p.mesh === b)!;
    b.setVisibleAt(first.id, true);
    await stage.prepare(b, { everyCaster: true });
    b.setVisibleAt(first.id, false);
    root.add(b);
  }

  const last = new Vector3(Infinity, 0, 0), cam = new Vector3();
  return {
    models: groups.length,
    instances: placed.length,
    update(camera) {
      camera.getWorldPosition(cam);
      if (cam.distanceToSquared(last) < RECHECK * RECHECK) return;
      last.copy(cam);
      for (const p of placed) {
        const d = Math.hypot(p.x - cam.x, p.y - cam.y, p.z - cam.z);
        const near = d < p.range, far = !near && p.far >= 0 && d < FAR_CAR;
        if (near !== p.visible) { p.mesh.setVisibleAt(p.id, near); p.visible = near; }
        if (far !== p.farVisible) { p.mesh.setVisibleAt(p.far, far); p.farVisible = far; }
      }
    },
  };
}

const _m = new Matrix4(), _q = new Quaternion(), _p = new Vector3(), _s = new Vector3(), _c = new Vector4(), _b = new Box3(), UP = new Vector3(0, 1, 0);

/** The bounds of a model's mesh data. */
function bounds(d: MeshData): Box3 {
  const P = d.attrs.position.array;
  _b.makeEmpty();
  for (let i = 0; i < P.length; i += 3) _b.expandByPoint(_p.set(P[i], P[i + 1], P[i + 2]));
  return _b.clone();
}

/** One BatchedMesh of these groups' models and instances (all hidden until `update`), recorded in `placed`. */
function batch(name: string, groups: PropGroup[], meshes: Map<string, MeshData>, vehicles: boolean, placed: Placed[]): BatchedMesh {
  const models = groups.map((g) => meshes.get(g.model)!);
  if (vehicles) models.push(meshes.get(FAR_VEHICLE)!);
  const count = groups.reduce((n, g) => n + g.inst.length / PROP_STRIDE, 0);
  const { mesh, geometries } = batchedFromData(models, vehicles ? VEHICLE : FURNITURE, vehicles ? count * 2 : count);
  mesh.name = name;
  const farGeometry = vehicles ? geometries[geometries.length - 1] : -1;
  groups.forEach((g, gi) => {
    const box = bounds(models[gi]), size = box.getSize(new Vector3()), mid = box.getCenter(new Vector3());
    const range = vehicles ? NEAR_CAR : Math.min(MAX_RANGE, Math.max(MIN_RANGE, RANGE_PER_M * Math.max(size.x, size.y, size.z) * 0.5));
    const I = g.inst;
    for (let o = 0; o < I.length; o += PROP_STRIDE) {
      const id = mesh.addInstance(geometries[gi]);
      _q.setFromAxisAngle(UP, I[o + 3]);
      const sc = I[o + 4];
      mesh.setMatrixAt(id, _m.compose(_p.set(I[o], I[o + 1], I[o + 2]), _q, _s.setScalar(sc)));
      mesh.setColorAt(id, _c.set(I[o + 5], I[o + 6], I[o + 7], I[o + 8]));
      mesh.setVisibleAt(id, false);
      let far = -1;
      if (vehicles) {
        // The stand-in: the unit box stretched to the car and centred on its footprint.
        far = mesh.addInstance(farGeometry);
        _p.set(mid.x, 0, mid.z).multiplyScalar(sc).applyQuaternion(_q).add(_s.set(I[o], I[o + 1] + box.min.y * sc, I[o + 2]));
        mesh.setMatrixAt(far, _m.compose(_p, _q, _s.set(size.x * sc, size.y * sc, size.z * sc)));
        mesh.setColorAt(far, _c);
        mesh.setVisibleAt(far, false);
      }
      placed.push({ x: I[o], y: I[o + 1], z: I[o + 2], id, range, far, mesh, visible: false, farVisible: false });
    }
  });
  // Spread over the whole town: culled per instance (BatchedMesh does), never as a whole.
  mesh.frustumCulled = false;
  return mesh;
}
