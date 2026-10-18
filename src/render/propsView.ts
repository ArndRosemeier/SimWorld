/**
 * The town's street props on the stage: the town workers list every prop's instances per model
 * and build each model once (src/build/streetProps.ts); here each model becomes a
 * geometry-instanced mesh (`instancedFromData`, the `FURNITURE` or `VEHICLE` kind: one shader per
 * kind, built in the warm-up) with its instances' iPose / iSize and tint or paint. `update` shows
 * what is near enough, repacking a model's instances when the camera has moved
 * (`showInstances`); parked cars further than NEAR_CAR are drawn as their far stand-in
 * (`propFar`). Ported from Scale's src/props/PropRenderer.ts (its batches and its ranges by size),
 * without the streaming: the whole town is placed at once.
 */
import { Group, Vector3, type Camera, type Mesh } from 'three/webgpu';
import type { WorkerPool } from '../workers/pool';
import type { FromTown, ToTown } from '../workers/townProtocol';
import { isVehicleModel, PROP_STRIDE, type PropGroup } from '../build/streetProps';
import { FURNITURE, VEHICLE } from './materials';
import { instancedFromData, radiusOf, showInstances, splitByDistance } from './meshes';
import type { Stage } from './stage';

/** Detailed parked cars up to this far from the camera (m, 3D), their stand-ins beyond, up to FAR_CAR. */
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
  /** The street lamp heads in world space (src/build/streetProps.ts `lampsOf`: x, y, z, kind per head, LAMP_STRIDE floats), for a pool of lights at night. */
  lamps: Float32Array;
  /** Once a frame: show what is in range of the camera (redone when it has moved RECHECK). */
  update(camera: Camera): void;
}

/** One model's instances (the kind's instance attributes, all of them) and its meshes. */
interface ModelProps {
  src: Record<string, Float32Array>;
  n: number;
  near: Mesh;
  far: Mesh | null;
  /** Shown whole up to this far (m). */
  range: number;
  /** The model's radius round its origin (m, at scale 1), for the bounding spheres. */
  radius: number;
  farRadius: number;
  /** What each mesh shows now (signatures of the last split). */
  nearSet: number[];
  farSet: number[];
}

/** Ask the town workers for the props and their models, then put them into `root`. */
export async function showProps(stage: Stage, pool: WorkerPool<ToTown, FromTown>, root: Group, priority = 35): Promise<PropsShown> {
  // The kerbside bays are the traffic's: its household cars stand there (src/render/vehiclesView.ts), so the plan's kerb cars stay out.
  const r = await pool.run({ type: 'props', kerbCars: false }, priority);
  if (r.type !== 'props') throw new Error(`town worker: props answered ${r.type}`);
  const group = new Group();
  group.name = 'props';
  const models = await Promise.all(r.groups.map(async (g, i) => {
    const m = await pool.run({ type: 'propModel', model: g.model }, priority + 1 + i * 0.01);
    if (m.type !== 'propModel') throw new Error(`town worker: propModel answered ${m.type}`);
    const p = modelProps(g, m.mesh, m.far);
    group.add(p.near);
    if (p.far) group.add(p.far);
    return p;
  }));

  const last = new Vector3(Infinity, 0, 0), cam = new Vector3();
  const reshow = (camera: Camera, force = false) => {
    camera.getWorldPosition(cam);
    if (!force && cam.distanceToSquared(last) < RECHECK * RECHECK) return;
    last.copy(cam);
    for (const p of models) {
      const [near, far] = splitByDistance(p.src.iPose, p.n, cam, p.range, p.far ? FAR_CAR : 0);
      if (!same(near, p.nearSet)) { p.nearSet = near; showInstances([p.near], p.src, near, p.radius); }
      if (p.far && !same(far, p.farSet)) { p.farSet = far; showInstances([p.far], p.src, far, p.farRadius); }
    }
  };
  reshow(stage.camera, true);
  // (The kinds' shaders come from the warm-up: this only checks, and builds nothing.)
  await stage.prepare(group);
  root.add(group);

  return {
    models: r.groups.length,
    instances: models.reduce((n, p) => n + p.n, 0),
    lamps: r.lamps,
    update: (camera) => reshow(camera),
  };
}

const same = (a: readonly number[], b: readonly number[]) => a.length === b.length && a.every((v, i) => v === b[i]);


/** A model's instance attributes from its group (PROP_STRIDE: x, y, z, yaw, scale, c0..c3) and its meshes (empty until split). */
function modelProps(g: PropGroup, data: Parameters<typeof instancedFromData>[0], farData: Parameters<typeof instancedFromData>[0] | null): ModelProps {
  const vehicle = isVehicleModel(g.model), I = g.inst, n = I.length / PROP_STRIDE;
  const pose = new Float32Array(n * 4), size = new Float32Array(n * 2), col = new Float32Array(n * (vehicle ? 3 : 4));
  for (let i = 0, o = 0; i < n; i++, o += PROP_STRIDE) {
    pose.set([I[o], I[o + 1], I[o + 2], I[o + 3]], i * 4);
    size[i * 2] = size[i * 2 + 1] = I[o + 4];
    if (vehicle) col.set([I[o + 5], I[o + 6], I[o + 7]], i * 3);
    else col.set([I[o + 5], I[o + 6], I[o + 7], I[o + 8]], i * 4);
  }
  const kind = vehicle ? VEHICLE : FURNITURE;
  const near = instancedFromData(data, kind, 0, n);
  near.name = g.model;
  const far = vehicle && farData ? instancedFromData(farData, VEHICLE, 0, n) : null;
  if (far) far.name = `${g.model} far`;
  const radius = radiusOf(near);
  const range = vehicle ? NEAR_CAR : Math.min(MAX_RANGE, Math.max(MIN_RANGE, RANGE_PER_M * radius));
  return {
    src: { iPose: pose, iSize: size, [vehicle ? 'iPaint' : 'iTint']: col }, n, near, far, range, radius,
    farRadius: far ? radiusOf(far) : 0, nearSet: [-1], farSet: [-1],
  };
}
