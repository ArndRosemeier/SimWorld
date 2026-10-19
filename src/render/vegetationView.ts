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
import { Group, Vector3, type Camera, type InstancedBufferAttribute, type InstancedBufferGeometry, type Mesh } from 'three/webgpu';
import { FOREST_DETAIL, FOREST_STRIDE } from '../build/forest';
import { VEG_MODELS, type TreeModelData } from '../build/vegetation';
import type { WorkerPool } from '../workers/pool';
import type { FromTown, ToTown, TownSummary } from '../workers/townProtocol';
import { TOWN_SHADOW } from './lights';
import { BARK, LEAVES, TREE_FAR } from './materials';
import { instancedFromData, sameSet, showInstances } from './meshes';
import type { Stage } from './stage';

/**
 * Trees nearer the camera than TREE_WHOLE (3D, m) are drawn whole, out to TREE_NEAR as the lighter middle-distance
 * tree (`midWood`, `midLeaves`: a quarter of the triangles), farther as the canopy hull; shrubs likewise.
 */
const TREE_WHOLE = 45, TREE_NEAR = 150, SHRUB_WHOLE = 25, SHRUB_NEAR = 70;
/** The camera moves this far (m) before the near / far split is redone. */
const RESPLIT = 8;
/** Real countryside trees reach this far beyond the town's radius (m), canopy clumps out to FAR_R from the centre. */
const DETAIL_R = 900, FAR_R = 3600;
/** Size of the clump tiles (m). */
const FAR_TILE = 1024;
/** Beyond the corners of the town's shadow square, by this much (m, for a low sun's long shadows), far hulls cast none. */
const SHADOW_MARGIN = 60;
/** Farther from the camera than this (m), trees are the coarse distant hull. */
const DISTANT_R = 450;

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

/** One model's instances: the poses of all, the near ones copied into the full tree, the rest into the far hull. */
interface ModelBatch {
  model: number;
  /** iPose (x, y, z, yaw) and iSize (across, up) per instance, src/build/vegetation.ts INSTANCE_SPECS. */
  pose: Float32Array;
  size: Float32Array;
  /** Never drawn whole (a clump standing for a patch of forest). */
  farOnly: Uint8Array;
  n: number;
  /** Wood and leaves share their instance attributes (the whole tree's, the middle distance's). */
  whole: Mesh[];
  mid: Mesh[];
  far: Mesh;
  /** Far hulls outside the sun's shadow (`shades`): the same, left out of the shadow pass. */
  farOut: Mesh;
  shades: Uint8Array;
  /** Beyond DISTANT_R: the coarse hull, casting no shadow. */
  distant: Mesh;
  /** Model radius (m, at scale 1) for the bounding spheres. */
  radius: number;
  /** Indices drawn whole and as the middle-distance tree now (signature of the last split). */
  nearSet: number[];
  midSet: number[];
}

/** Group the records (FOREST_STRIDE) by model. */
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

const attr = (m: Mesh, name: string) => (m.geometry as InstancedBufferGeometry).getAttribute(name) as InstancedBufferAttribute;

class Batches {
  readonly root = new Group();
  readonly batches: ModelBatch[] = [];
  count = 0;
  private last = new Vector3(Infinity, 0, 0);

  /** `shades(x, z)`: whether a far hull there can cast a shadow the sun's shadow map holds. */
  constructor(recs: Float32Array[], models: (i: number) => TreeModelData, shades: (x: number, z: number) => boolean) {
    this.root.name = 'vegetation';
    for (const [model, parts] of group(recs)) {
      const n = parts.reduce((a, p) => a + p.idx.length, 0);
      const pose = new Float32Array(n * 4), size = new Float32Array(n * 2), farOnly = new Uint8Array(n), shade = new Uint8Array(n);
      let k = 0;
      for (const { idx, recs: R } of parts) for (const o of idx) {
        const sc = R[o + 3], spread = R[o + 6];
        pose.set([R[o], R[o + 1], R[o + 2], R[o + 4]], k * 4);
        // A clump stands for a patch: wider, a little taller.
        size[k * 2] = sc * spread; size[k * 2 + 1] = sc * (1 + (spread - 1) * 0.25);
        farOnly[k] = spread > 1 ? 1 : 0;
        shade[k] = shades(R[o], R[o + 2]) ? 1 : 0;
        k++;
      }
      const data = models(model);
      const tree = (wood: typeof data.wood, leaves: typeof data.leaves): Mesh[] => {
        const ms: Mesh[] = [];
        if (!farOnly.some((f) => !f)) return ms;
        if (wood.index.length) ms.push(instancedFromData(wood, BARK, 0, n));
        if (leaves.index.length) ms.push(instancedFromData(leaves, LEAVES, 0, n));
        // A tree's meshes share one set of instance attributes.
        for (const m of ms.slice(1)) for (const a of ['iPose', 'iSize']) m.geometry.setAttribute(a, attr(ms[0], a));
        return ms;
      };
      const whole = tree(data.wood, data.leaves), mid = tree(data.midWood, data.midLeaves);
      const far = instancedFromData(data.far, TREE_FAR, 0, n), farOut = instancedFromData(data.far, TREE_FAR, 0, n);
      const distant = instancedFromData(data.distant, TREE_FAR, 0, n);
      farOut.castShadow = distant.castShadow = false;
      for (const m of [...whole, ...mid, far, farOut, distant]) this.root.add(m);
      const radius = Math.max(data.crownRadius, data.height);
      this.batches.push({ model, pose, size, farOnly, n, whole, mid, far, farOut, shades: shade, distant, radius, nearSet: [-1], midSet: [-1] });
      this.count += n;
    }
  }

  /** Re-split when the camera has moved; returns the instances drawn whole (-1: not redone). */
  split(cam: Vector3, force = false): number {
    if (!force && cam.distanceToSquared(this.last) < RESPLIT * RESPLIT) return -1;
    this.last.copy(cam);
    let near = 0;
    for (const b of this.batches) {
      const shrub = b.model >= FIRST_SHRUB, w = b.whole.length ? (shrub ? SHRUB_WHOLE : TREE_WHOLE) : 0, r = b.whole.length ? (shrub ? SHRUB_NEAR : TREE_NEAR) : 0;
      const set: number[] = [], mid: number[] = [], far: number[] = [], farOut: number[] = [], distant: number[] = [];
      for (let i = 0; i < b.n; i++) {
        const dx = b.pose[i * 4] - cam.x, dy = b.pose[i * 4 + 1] - cam.y, dz = b.pose[i * 4 + 2] - cam.z, d2 = dx * dx + dy * dy + dz * dz;
        (d2 >= DISTANT_R * DISTANT_R ? distant : b.farOnly[i] || d2 >= r * r ? (b.shades[i] ? far : farOut) : d2 < w * w ? set : mid).push(i);
      }
      near += set.length + mid.length;
      if (sameSet(set, b.nearSet) && sameSet(mid, b.midSet)) continue;
      const src = { iPose: b.pose, iSize: b.size };
      if (b.whole.length && !sameSet(set, b.nearSet)) showInstances(b.whole, src, set, b.radius);
      if (b.mid.length && !sameSet(mid, b.midSet)) showInstances(b.mid, src, mid, b.radius);
      b.nearSet = set; b.midSet = mid;
      showInstances([b.far], src, far, b.radius);
      showInstances([b.farOut], src, farOut, b.radius);
      showInstances([b.distant], src, distant, b.radius);
    }
    return near;
  }

  meshes(): Mesh[] {
    return this.batches.flatMap((b) => [...b.whole, ...b.mid, b.far, b.farOut, b.distant]);
  }
}

/** Compile `b`'s meshes (the Stage draws an empty one with one instance meanwhile), then put them under `parent`. */
async function placeBatches(stage: Stage, parent: Group, b: Batches): Promise<void> {
  await stage.prepare(b.root);
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
  // The sun's shadow never reaches past the drone's square round the town (a circle through its corners, and a margin).
  const reach = town.radius * TOWN_SHADOW * Math.SQRT2 + SHADOW_MARGIN;
  const shades = (x: number, z: number) => Math.hypot(x - town.x, z - town.z) < reach;
  const placeRecords = async (recs: Float32Array[]) => {
    const used = [...new Set(recs.flatMap((R) => { const s: number[] = []; for (let o = 5; o < R.length; o += FOREST_STRIDE) s.push(R[o]); return s; }))];
    const data = new Map<number, TreeModelData>();
    await Promise.all(used.map(async (i) => { data.set(i, await model(i)); }));
    return new Batches(recs, (i) => data.get(i)!, shades);
  };

  // The town's own trees first.
  const townRecs = (await pool.run<Extract<FromTown, { type: 'trees' }>>({ type: 'trees' }, priority)).recs;
  const inTown = await placeRecords([townRecs]);
  let near = inTown.split(cam, true);
  await placeBatches(stage, parent, inTown);

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
  const country = await placeRecords(await Promise.all(jobs));
  near += country.split(cam, true);
  await placeBatches(stage, parent, country);

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
