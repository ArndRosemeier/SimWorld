/**
 * The railway's moving parts beside the trains: the level crossings' barriers and lamps, and the
 * trains' sounds. The posts come once from the sim worker's traffic (`SimClient.crossingPosts`, see
 * src/traffic/feed.ts `POST_STRIDE`), which crossings are closed with every street update
 * (`TrafficMsg.closed`). When a crossing closes its lamps flash in turn and its bells ring; a few
 * seconds later the arms come down across the road; when it opens they rise and the lamps go out.
 * A train sounds its horn as it nears a crossing, and passes the listener with a rush. The trains
 * themselves are drawn with the vehicles (src/render/vehiclesView.ts).
 *
 * The models are src/build/crossing.ts, for the `VEHICLE` kind: posts and lenses one instanced mesh
 * each; each arm its own (it turns about its pivot). New in SimWorld.
 */
import { Group, Vector3, type Camera, type Mesh } from 'three/webgpu';
import type { TownAudio } from '../audio/townAudio';
import type { LoopHandle } from '../audio/engine';
import { ARM_LENGTH, ARM_PIVOT, LENS_AT, crossingArm, crossingLens, crossingPost } from '../build/crossing';
import { CAR_STRIDE, POSE_STRIDE, POST_STRIDE, vehiclePose, type TrafficMsg } from '../traffic/feed';
import { isTrainKey } from '../traffic/trains';
import { VEHICLE } from './materials';
import { instancedFromData, radiusOf, showInstances } from './meshes';
import type { Stage } from './stage';

/** Seconds from the lamps to the arms moving; seconds the arm takes to come down or go up. */
const ARM_DELAY = 4, ARM_SWING = 5;
/** The lamps' flash (s per lamp). */
const FLASH = 0.5;
/** The posts' white. */
const WHITE = [0.92, 0.92, 0.9];
/** A train sounds its horn this near a crossing (m) as it comes; it passes the listener this near (m), again once it is this far. */
const HORN_AT = 280, PASS_AT = 60, PASS_RESET = 160;

/** One crossing's state on screen. */
interface Crossing {
  /** Since when (s, real time) closed, or null if open; how far the arms are up (1) or down (0). */
  since: number | null;
  up: number;
  x: number;
  y: number;
  z: number;
  bells: LoopHandle | null;
}

export class RailView {
  readonly root = new Group();
  private posts: Float32Array | null = null;
  private crossings: Crossing[] = [];
  private arms: { pivot: Group; crossing: number }[] = [];
  private lens: Mesh | null = null;
  private lensSrc = { iPose: new Float32Array(0), iSize: new Float32Array(0), iPaint: new Float32Array(0), iState: new Float32Array(0) };
  private time = 0;
  private readonly cam = new Vector3();
  private readonly p = new Float32Array(POSE_STRIDE);
  /** Trains (key >> 3) that have sounded their horn for a crossing, and that have passed the listener. */
  private readonly horned = new Set<string>();
  private readonly passed = new Set<number>();

  constructor(private readonly stage: Stage) {
    this.root.name = 'rail';
    stage.scene.add(this.root);
  }

  /** Once a frame (`dt` real seconds): the barriers as the crossings stand now, the trains' sounds. */
  animate(camera: Camera, dt: number, clock: number, posts: Float32Array | null, traffic: TrafficMsg | null, audio: TownAudio): void {
    this.time += dt;
    if (posts && posts !== this.posts) this.build(posts);
    camera.getWorldPosition(this.cam);
    const closed = traffic?.closed;
    for (let c = 0; c < this.crossings.length; c++) {
      const x = this.crossings[c];
      const shut = !!closed?.[c];
      if (shut && x.since === null) x.since = this.time;
      if (!shut) x.since = null;
      const down = x.since !== null && this.time - x.since > ARM_DELAY;
      x.up = Math.min(1, Math.max(0, x.up + ((down ? -1 : 1) * dt) / ARM_SWING));
      if (x.since !== null) {
        x.bells ??= audio.loop('crossing_bells', 8);
        x.bells?.set(x.x, x.y + 2, x.z, 1);
      } else if (x.bells) {
        x.bells.stop();
        x.bells = null;
      }
    }
    for (const a of this.arms) a.pivot.rotation.x = (Math.PI / 2) * this.crossings[a.crossing].up;
    this.flash();
    if (traffic) this.sounds(traffic, clock, audio);
  }

  /** The posts, lenses and arms of the crossings in `posts` (POST_STRIDE each). */
  private build(posts: Float32Array): void {
    this.posts = posts;
    // A new town (a loaded game): the old crossings go.
    for (const c of this.crossings) c.bells?.stop();
    this.crossings = [];
    this.arms = [];
    this.lens = null;
    this.root.clear();
    const n = posts.length / POST_STRIDE;
    const src = { iPose: new Float32Array(n * 4), iSize: new Float32Array(n * 2).fill(1), iPaint: new Float32Array(n * 3), iState: new Float32Array(n * 4) };
    const lens = { iPose: new Float32Array(n * 8), iSize: new Float32Array(n * 4).fill(1), iPaint: new Float32Array(n * 6), iState: new Float32Array(n * 8) };
    const [lx, ly, lz] = LENS_AT;
    for (let i = 0; i < n; i++) {
      const [x, y, z, yaw, arm, c] = posts.subarray(i * POST_STRIDE, (i + 1) * POST_STRIDE);
      src.iPose.set([x, y, z, yaw], i * 4);
      src.iPaint.set(WHITE, i * 3);
      // The lenses: model +X turns to (cos yaw, −sin yaw), +Z to (sin yaw, cos yaw).
      const cs = Math.cos(yaw), sn = Math.sin(yaw);
      for (let s = 0; s < 2; s++) {
        const oz = (s ? 1 : -1) * lz;
        lens.iPose.set([x + lx * cs + oz * sn, y + ly, z - lx * sn + oz * cs, yaw], (i * 2 + s) * 4);
      }
      while (this.crossings.length <= c) this.crossings.push({ since: null, up: 1, x, y, z, bells: null });
      const mesh = instancedFromData(crossingArm(), VEHICLE, 0, 1);
      showInstances([mesh], { iPose: new Float32Array(4), iSize: new Float32Array([1, 1]), iPaint: new Float32Array(WHITE), iState: new Float32Array(4) }, [0], radiusOf(mesh));
      mesh.scale.z = arm / ARM_LENGTH;
      const place = new Group(), pivot = new Group();
      place.position.set(x, y, z);
      place.rotation.y = yaw;
      pivot.position.y = ARM_PIVOT;
      pivot.add(mesh);
      place.add(pivot);
      this.arms.push({ pivot, crossing: c });
      void this.stage.prepare(place).then(() => this.root.add(place));
    }
    const post = instancedFromData(crossingPost(), VEHICLE, 0, Math.max(1, n));
    const lensMesh = instancedFromData(crossingLens(), VEHICLE, 0, Math.max(1, n * 2));
    const all = Array.from({ length: n }, (_, i) => i);
    showInstances([post], src, all, radiusOf(post));
    this.lensSrc = lens;
    void this.stage.prepare(post).then(() => this.root.add(post));
    void this.stage.prepare(lensMesh).then(() => { this.root.add(lensMesh); this.lens = lensMesh; });
  }

  /** The lamps of closed crossings flash in turn (the brake light of each lens). */
  private flash(): void {
    if (!this.lens || !this.posts) return;
    const n = this.posts.length / POST_STRIDE, st = this.lensSrc.iState;
    const odd = Math.floor(this.time / FLASH) % 2;
    for (let i = 0; i < n; i++) {
      const on = this.crossings[this.posts[i * POST_STRIDE + 5]].since !== null;
      for (let s = 0; s < 2; s++) st[(i * 2 + s) * 4 + 1] = on && s === odd ? 1 : 0;
    }
    showInstances([this.lens], this.lensSrc, Array.from({ length: n * 2 }, (_, i) => i), radiusOf(this.lens));
  }

  /** Horns as trains near the crossings, the rush of one passing the listener. */
  private sounds(m: TrafficMsg, clock: number, audio: TownAudio): void {
    const n = m.cars.length / CAR_STRIDE, p = this.p;
    // Each train's nearest car to each crossing and to the listener.
    const near = new Map<number, { cross: number[]; at: number[]; me: number; x: number; y: number; z: number }>();
    for (let i = 0; i < n; i++) {
      const key = m.cars[i * CAR_STRIDE];
      if (!isTrainKey(key)) continue;
      vehiclePose(m, i, clock, p);
      const train = key >> 3;
      let t = near.get(train);
      if (!t) near.set(train, (t = { cross: this.crossings.map(() => Infinity), at: [], me: Infinity, x: p[0], y: p[1], z: p[2] }));
      this.crossings.forEach((c, k) => { t!.cross[k] = Math.min(t!.cross[k], Math.hypot(p[0] - c.x, p[2] - c.z)); });
      const d = Math.hypot(p[0] - this.cam.x, p[1] - this.cam.y, p[2] - this.cam.z);
      if (d < t.me) Object.assign(t, { me: d, x: p[0], y: p[1], z: p[2] });
    }
    for (const [train, t] of near) {
      t.cross.forEach((d, k) => {
        const id = `${train}:${k}`;
        // Once per train and crossing, as it comes within HORN_AT (it is closed by then).
        if (d < HORN_AT && this.crossings[k].since !== null && !this.horned.has(id)) {
          this.horned.add(id);
          audio.play('train_horn', t.x, t.y + 3, t.z, 1, 1, 60);
        }
      });
      if (t.me < PASS_AT && !this.passed.has(train)) {
        this.passed.add(train);
        audio.play('train_pass', t.x, t.y + 1, t.z, 1, 1, 25);
      } else if (t.me > PASS_RESET) this.passed.delete(train);
    }
    // Forget trains that left the line.
    for (const id of this.horned) if (!near.has(Number(id.split(':')[0]))) this.horned.delete(id);
    for (const train of this.passed) if (!near.has(train)) this.passed.delete(train);
  }
}
