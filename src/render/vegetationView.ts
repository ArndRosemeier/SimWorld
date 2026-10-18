/**
 * The town's trees, shrubs and yews and the countryside's forests, hedgerows and orchards, drawn
 * instanced: per model (src/build/vegetation.ts `VEG_MODELS`) a full tree (wood and leaves)
 * for the instances near the camera and a far canopy hull for the rest. The split follows the
 * camera (`update`, once a frame: a re-split only when it has moved), every batch keeps its
 * room, so nothing new compiles after the first placement.
 *
 * The town workers build the models (`vegModel`) and the tree records (`trees` for the town's
 * props, `forest` per countryside tile; src/build/forest.ts). The countryside: real trees out to
 * `DETAIL_R` beyond the town's outline, canopy clumps (far tiles, each record a patch of forest)
 * out to `FAR_R`; beyond, the terrain's canopy colour carries the forests on.
 *
 * Ported from Scale's src/props/PropRenderer.ts (tree tiers) and src/stream/Countryside.ts
 * (forest tiles), at town size: everything is placed once, nothing streams.
 */
import { Group, Matrix4, Quaternion, Vector3, type Camera, type InstancedMesh } from 'three/webgpu';
import { FOREST_DETAIL, FOREST_STRIDE } from '../build/forest';
import { VEG_MODELS, type TreeModelData } from '../build/vegetation';
import type { WorkerPool } from '../workers/pool';
import type { FromTown, ToTown, TownSummary } from '../workers/townProtocol';
import { BARK, LEAVES, TREE_FAR } from './materials';
import { instancedFromData } from './meshes';
import type { Stage } from './stage';

/** Trees nearer the camera than this (3D, m) are drawn whole; shrubs nearer than SHRUB_NEAR. */
const TREE_NEAR = 150, SHRUB_NEAR = 70;
/** The camera moves this far (m) before the near / far split is redone. */
const RESPLIT = 8;
/** Real countryside trees reach this far beyond the town's radius (m), canopy clumps out to FAR_R from the centre. */
const DETAIL_R = 900, FAR_R = 3600;
/** Size of the clump tiles (m). */
const FAR_TILE = 1024;

const FIRST_SHRUB = VEG_MODELS.findIndex((m) => m.species === 'shrub');

export interface VegetationShown {
  /** Trees and shrubs in the town, trees (and clumps) in the countryside. */
  readonly town: number;
  readonly country: number;
  /** Instances drawn whole at the last split. */
  near: number;
  /** Once a frame: re-split near / far when the camera has moved. */
  update(camera: Camera): void;
}

/** One model's instances: matrices of all, the near ones copied into the full tree, the rest into the far hull. */
interface ModelBatch {
  model: number;
  /** 16 floats per instance (column-major, three's layout). */
  mats: Float32Array;
  x: Float32Array;
  y: Float32Array;
  z: Float32Array;
  /** Never drawn whole (a clump standing for a patch of forest). */
  farOnly: Uint8Array;
  n: number;
  wood: InstancedMesh | null;
  leaves: InstancedMesh | null;
  far: InstancedMesh;
  /** Indices drawn whole now (signature of the last split). */
  nearSet: number[];
}

const _m = new Matrix4(), _q = new Quaternion(), _p = new Vector3(), _s = new Vector3(), _up = new Vector3(0, 1, 0);

/** Group the records (FOREST_STRIDE) by model, with their matrices. */
function group(recs: Float32Array[]): Map<number, { idx: number[]; recs: Float32Array }[]> {
  const out = new Map<number, { idx: number[]; recs: Float32Array }[]>();
  for (const R of recs) {
    const by = new Map<number, number[]>();
    for (let o = 0; o < R.length; o += FOREST_STRIDE) {
      const m = R[o + 5];
      let l = by.get(m);
      if (!l) by.set(m, (l = []));
      l.push(o);
    }
    for (const [m, idx] of by) {
      let l = out.get(m);
      if (!l) out.set(m, (l = []));
      l.push({ idx, recs: R });
    }
  }
  return out;
}

class Batches {
  readonly root = new Group();
  readonly batches: ModelBatch[] = [];
  count = 0;
  private last = new Vector3(Infinity, 0, 0);

  constructor(recs: Float32Array[], models: (i: number) => TreeModelData) {
    this.root.name = 'vegetation';
    for (const [model, parts] of group(recs)) {
      const n = parts.reduce((a, p) => a + p.idx.length, 0);
      const mats = new Float32Array(n * 16), x = new Float32Array(n), y = new Float32Array(n), z = new Float32Array(n), farOnly = new Uint8Array(n);
      let k = 0;
      for (const { idx, recs: R } of parts) for (const o of idx) {
        const sc = R[o + 3], spread = R[o + 6];
        _q.setFromAxisAngle(_up, R[o + 4]);
        // A clump stands for a patch: wider, a little taller.
        _s.set(sc * spread, sc * (1 + (spread - 1) * 0.25), sc * spread);
        _m.compose(_p.set(R[o], R[o + 1], R[o + 2]), _q, _s).toArray(mats, k * 16);
        x[k] = R[o]; y[k] = R[o + 1]; z[k] = R[o + 2]; farOnly[k] = spread > 1 ? 1 : 0;
        k++;
      }
      const data = models(model);
      const anyNear = farOnly.some((f) => !f);
      const wood = anyNear && data.wood.index.length ? instancedFromData(data.wood, BARK, 0, n) : null;
      const leaves = anyNear && data.leaves.index.length ? instancedFromData(data.leaves, LEAVES, 0, n) : null;
      // The whole tree's two meshes share one matrix buffer.
      if (wood && leaves) leaves.instanceMatrix = wood.instanceMatrix;
      const far = instancedFromData(data.far, TREE_FAR, 0, n);
      for (const m of [wood, leaves, far]) if (m) { m.frustumCulled = false; this.root.add(m); }
      this.batches.push({ model, mats, x, y, z, farOnly, n, wood, leaves, far, nearSet: [-1] });
      this.count += n;
    }
  }

  /** Re-split when the camera has moved; returns the instances drawn whole. */
  split(cam: Vector3, force = false): number {
    if (!force && cam.distanceToSquared(this.last) < RESPLIT * RESPLIT) return -1;
    this.last.copy(cam);
    let near = 0;
    for (const b of this.batches) {
      const r = b.model >= FIRST_SHRUB ? SHRUB_NEAR : TREE_NEAR, r2 = r * r;
      const set: number[] = [];
      if (b.wood || b.leaves) {
        for (let i = 0; i < b.n; i++) {
          if (b.farOnly[i]) continue;
          const dx = b.x[i] - cam.x, dy = b.y[i] - cam.y, dz = b.z[i] - cam.z;
          if (dx * dx + dy * dy + dz * dz < r2) set.push(i);
        }
      }
      near += set.length;
      if (set.length === b.nearSet.length && set.every((v, i) => v === b.nearSet[i])) continue;
      b.nearSet = set;
      const whole = (b.wood ?? b.leaves)?.instanceMatrix.array as Float32Array | undefined;
      const farA = b.far.instanceMatrix.array as Float32Array;
      let nn = 0, nf = 0, s = 0;
      for (let i = 0; i < b.n; i++) {
        if (s < set.length && set[s] === i) { whole!.set(b.mats.subarray(i * 16, i * 16 + 16), nn++ * 16); s++; }
        else farA.set(b.mats.subarray(i * 16, i * 16 + 16), nf++ * 16);
      }
      for (const m of [b.wood, b.leaves]) if (m) m.count = nn;
      if (b.wood ?? b.leaves) (b.wood ?? b.leaves)!.instanceMatrix.needsUpdate = true;
      b.far.count = nf;
      b.far.instanceMatrix.needsUpdate = true;
    }
    return near;
  }

  meshes(): InstancedMesh[] {
    return this.batches.flatMap((b) => [b.wood, b.leaves, b.far].filter((m): m is InstancedMesh => !!m));
  }
}

/** Compile `b`'s meshes (each with at least one instance meanwhile), then put them under `parent`. */
async function place(stage: Stage, parent: Group, b: Batches): Promise<void> {
  const meshes = b.meshes(), counts = meshes.map((m) => m.count);
  for (const m of meshes) m.count = Math.max(1, m.count);
  await stage.prepare(b.root);
  meshes.forEach((m, i) => { m.count = counts[i]; });
  parent.add(b.root);
}

/**
 * Build and place the vegetation under `parent`: the town's first, then the countryside's.
 * `priority`: the worker jobs' (after the town's own pieces).
 */
export async function showVegetation(stage: Stage, pool: WorkerPool<ToTown, FromTown>, parent: Group, town: TownSummary, priority: number): Promise<VegetationShown> {
  const cam = stage.camera.position;
  const models = new Map<number, Promise<TreeModelData>>();
  const model = (i: number) => {
    let p = models.get(i);
    if (!p) models.set(i, (p = pool.run<Extract<FromTown, { type: 'vegModel' }>>({ type: 'vegModel', index: i }, priority + 1).then((r) => r.model)));
    return p;
  };
  const load = async (recs: Float32Array[]) => {
    const used = [...new Set(recs.flatMap((R) => { const s: number[] = []; for (let o = 5; o < R.length; o += FOREST_STRIDE) s.push(R[o]); return s; }))];
    const data = new Map<number, TreeModelData>();
    await Promise.all(used.map(async (i) => { data.set(i, await model(i)); }));
    return new Batches(recs, (i) => data.get(i)!);
  };

  // The town's own trees first.
  const townRecs = (await pool.run<Extract<FromTown, { type: 'trees' }>>({ type: 'trees' }, priority)).recs;
  const inTown = await load([townRecs]);
  let near = inTown.split(cam, true);
  await place(stage, parent, inTown);

  // The countryside: detail tiles round the town, clump tiles farther out (each keeps its own ring).
  const rIn = town.radius + DETAIL_R;
  const jobs: Promise<Float32Array>[] = [];
  const tile = (x0: number, z0: number, size: number, keep: (r: number) => boolean) => {
    const d = Math.hypot(x0 + size / 2 - town.x, z0 + size / 2 - town.z);
    jobs.push(pool.run<Extract<FromTown, { type: 'forest' }>>({ type: 'forest', x0, z0, size }, priority + 400 + d).then(({ recs }) => {
      const out: number[] = [];
      for (let o = 0; o < recs.length; o += FOREST_STRIDE) if (keep(Math.hypot(recs[o] - town.x, recs[o + 2] - town.z))) for (let k = 0; k < FOREST_STRIDE; k++) out.push(recs[o + k]);
      return Float32Array.from(out);
    }));
  };
  const D = FOREST_DETAIL, nD = Math.ceil(rIn / D);
  for (let i = -nD; i < nD; i++) for (let j = -nD; j < nD; j++) {
    const x0 = town.x + i * D, z0 = town.z + j * D;
    // the tile's nearest point to the centre inside the ring
    const nx = Math.max(x0, Math.min(town.x, x0 + D)), nz = Math.max(z0, Math.min(town.z, z0 + D));
    if (Math.hypot(nx - town.x, nz - town.z) < rIn) tile(x0, z0, D, (r) => r < rIn);
  }
  const F = FAR_TILE, nF = Math.ceil(FAR_R / F);
  for (let i = -nF; i < nF; i++) for (let j = -nF; j < nF; j++) {
    const x0 = town.x + i * F, z0 = town.z + j * F;
    const nx = Math.max(x0, Math.min(town.x, x0 + F)), nz = Math.max(z0, Math.min(town.z, z0 + F));
    const fx = Math.max(Math.abs(x0 - town.x), Math.abs(x0 + F - town.x)), fz = Math.max(Math.abs(z0 - town.z), Math.abs(z0 + F - town.z));
    if (Math.hypot(nx - town.x, nz - town.z) < FAR_R && Math.hypot(fx, fz) > rIn) tile(x0, z0, F, (r) => r >= rIn && r < FAR_R);
  }
  const country = await load(await Promise.all(jobs));
  near += country.split(cam, true);
  await place(stage, parent, country);

  const shown: VegetationShown = {
    town: inTown.count,
    country: country.count,
    near,
    update(camera: Camera) {
      const a = inTown.split(camera.position), b = country.split(camera.position);
      if (a >= 0 || b >= 0) shown.near = Math.max(0, a) + Math.max(0, b);
    },
  };
  return shown;
}
