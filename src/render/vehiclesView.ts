/**
 * The town's vehicles on the stage: the moving traffic and the household cars standing in the
 * kerbside bays, as the sim worker's traffic reports them (src/traffic/feed.ts, via
 * `SimClient.traffic` and `.parked`). Each vehicle model (kind and variant) is one pair of
 * geometry-instanced meshes of the `VEHICLE` kind, the detailed model near the camera and its far
 * stand-in beyond, as the street props' parked cars are drawn (src/render/propsView.ts; the models
 * come from the town workers' `propModel`). Every frame each moving vehicle is placed between its
 * recorded poses at the game clock, with its lights (iState); parked cars stand unlit.
 *
 * New in SimWorld. Scale drew its cars as one InstancedMesh per model the same way.
 */
import { Group, InstancedBufferAttribute, Vector3, type Camera, type Mesh } from 'three/webgpu';
import { VEHICLE_KINDS } from '../build/vehicles';
import { CAR_STRIDE, PARKED_STRIDE, POSE_STRIDE, STATE_STRIDE, vehiclePose, type TrafficMsg } from '../traffic/feed';
import type { WorkerPool } from '../workers/pool';
import type { FromTown, ToTown } from '../workers/townProtocol';
import { VEHICLE } from './materials';
import { instancedFromData, radiusOf, showInstances, splitByDistance } from './meshes';
import type { Stage } from './stage';

/** Detailed vehicles up to this far from the camera (m, 3D), their stand-ins beyond, up to FAR (the props' ranges). */
const NEAR = 140;
const FAR = 1100;
/** Room for this many instances per model at first (it doubles when full). */
const ROOM = 32;

/** One model's meshes and this frame's instances. */
interface Model {
  near: Mesh;
  far: Mesh;
  radius: number;
  farRadius: number;
  room: number;
  n: number;
  src: { iPose: Float32Array; iSize: Float32Array; iPaint: Float32Array; iState: Float32Array; iTilt: Float32Array };
}

export class VehiclesView {
  readonly root = new Group();
  /** Vehicles drawn last frame: moving, parked. */
  readonly counts = { moving: 0, parked: 0 };
  private readonly models = new Map<string, Model | null>();
  private readonly cam = new Vector3();
  private readonly p = new Float32Array(POSE_STRIDE);

  /** `priority`: of the model builds in the town workers (after the town's own pieces). */
  constructor(private readonly stage: Stage, private readonly pool: WorkerPool<ToTown, FromTown>, private readonly priority = 70) {
    this.root.name = 'vehicles';
    stage.scene.add(this.root);
  }

  /** Once a frame: every vehicle where it is at game clock `clock`. */
  show(camera: Camera, clock: number, moving: TrafficMsg | null, parked: { poses: Float32Array; cars: Int32Array } | null): void {
    for (const m of this.models.values()) if (m) m.n = 0;
    const p = this.p;
    let nm = 0, np = 0;
    if (moving) {
      const n = moving.cars.length / CAR_STRIDE;
      for (let i = 0; i < n; i++) {
        vehiclePose(moving, i, clock, p);
        if (this.addInstance(moving.cars, i, p, moving.paint, i * 3, moving.state, i * STATE_STRIDE)) nm++;
      }
    }
    if (parked) {
      const n = parked.cars.length / CAR_STRIDE, P = parked.poses;
      for (let i = 0, o = 0; i < n; i++, o += PARKED_STRIDE) if (this.addInstance(parked.cars, i, P.subarray(o, o + POSE_STRIDE), P, o + POSE_STRIDE, null, 0)) np++;
    }
    this.counts.moving = nm;
    this.counts.parked = np;
    camera.getWorldPosition(this.cam);
    for (const m of this.models.values()) {
      if (!m) continue;
      const [near, far] = splitByDistance(m.src.iPose, m.n, this.cam, NEAR, FAR);
      showInstances([m.near], m.src, near, m.radius);
      showInstances([m.far], m.src, far, m.farRadius);
    }
  }

  /**
   * Add car `i` of `cars` at `pose` (POSE_STRIDE: x, y, z, yaw, pitch, roll), its paint from `paint` at `po`, its lights from `state` at `so`
   * (none: parked) to its model's instances; false while the model loads.
   */
  private addInstance(cars: Int32Array, i: number, pose: Float32Array, paint: Float32Array, po: number, state: Float32Array | null, so: number): boolean {
    const m = this.model(`v:${VEHICLE_KINDS[cars[i * CAR_STRIDE + 1]]}:${cars[i * CAR_STRIDE + 2]}`);
    if (!m) return false;
    if (m.n === m.room) this.grow(m);
    const j = m.n++;
    m.src.iPose.set(pose.subarray(0, 4), j * 4);
    m.src.iTilt.set(pose.subarray(4, 6), j * 2);
    m.src.iSize[j * 2] = m.src.iSize[j * 2 + 1] = 1;
    m.src.iPaint.set(paint.subarray(po, po + 3), j * 3);
    if (state) m.src.iState.set(state.subarray(so, so + STATE_STRIDE), j * 4);
    else m.src.iState.fill(0, j * 4, j * 4 + 4);
    return true;
  }

  /** A model's meshes, or null while the town workers build it (asked for the first time it is needed). */
  private model(key: string): Model | null {
    const have = this.models.get(key);
    if (have !== undefined) return have;
    this.models.set(key, null);
    void this.pool.run({ type: 'propModel', model: key }, this.priority).then(async (r) => {
      if (r.type !== 'propModel' || !r.far) throw new Error(`town worker: propModel ${key} answered ${r.type}`);
      const near = instancedFromData(r.mesh, VEHICLE, 0, ROOM), far = instancedFromData(r.far, VEHICLE, 0, ROOM);
      near.name = key;
      far.name = `${key} far`;
      const g = new Group();
      g.add(near, far);
      // (The kind's shader comes from the warm-up: this only checks, and builds nothing.)
      await this.stage.prepare(g);
      this.root.add(g);
      this.models.set(key, { near, far, radius: radiusOf(near), farRadius: radiusOf(far), room: ROOM, n: 0, src: room(ROOM) });
    }).catch((e) => console.error('vehicle model', key, e));
    return null;
  }

  /** Double a model's room: its instance arrays and its meshes' attributes. */
  private grow(m: Model): void {
    const old = m.src;
    m.room *= 2;
    m.src = room(m.room);
    for (const k of Object.keys(old) as (keyof Model['src'])[]) m.src[k].set(old[k]);
    for (const mesh of [m.near, m.far]) {
      const g = mesh.geometry;
      for (const a of VEHICLE.instanced!) g.setAttribute(a.name, new InstancedBufferAttribute(new Float32Array(m.room * a.size), a.size));
    }
  }
}

/** Instance arrays with room for `n`. */
const room = (n: number): Model['src'] => ({ iPose: new Float32Array(n * 4), iSize: new Float32Array(n * 2), iPaint: new Float32Array(n * 3), iState: new Float32Array(n * 4), iTilt: new Float32Array(n * 2) });
