/**
 * The people on screen (plan §1.1, L2): every inhabitant out of doors near the camera drawn as their own
 * human, built from their own look (src/street/looks.ts) and dressed in today's clothes, walking or standing
 * as the street layer says. The nearest get a full human each; humans are built a few at a time (the body in
 * a worker, the rest spread over frames) and compiled with the Stage before they show, and kept a while for
 * people who come back into view.
 *
 * New in SimWorld, after Scale's crowd renderer (src/sim/CrowdRenderer.ts: full rigs up close) and
 * Dunfinity's human pool (src/render/creatures/humanPool.ts).
 */
import { Group, type Material, type Mesh, type Object3D } from 'three/webgpu';
import type { EquipmentVisuals, HumanoidAppearance } from '@futuremagic/humanoid';
import { Humanoid, clipLibraryReady, type AnimState } from '@futuremagic/humanoid/three';
import type { Stage } from '../stage';
import { Bodies } from './bodies';
import { WARDROBE } from './wardrobe';

/** What the view needs of someone on screen, this frame. */
export interface Figure {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Velocity, m/s (real seconds). */
  readonly vx: number;
  readonly vz: number;
  /** Where they face when standing still (yaw, radians; 0 looks to -z), e.g. toward someone they talk to. */
  readonly face?: number;
  /** Sitting or lying down (else standing or walking). */
  readonly rest?: Rest;
  /** There but not drawn (the camera is inside their head: the player's own person in a tight room). */
  readonly hidden?: boolean;
  /** Their body (changes only with their age) and today's clothes, made on demand. */
  look(): Look;
}

/**
 * Sitting on a seat, lying on a bed or riding a bicycle: `seat` is the seat's, mattress's or saddle's height (m)
 * above the figure's y (the floor, the road). A sitter stands SEAT_REACH (@futuremagic/humanoid) in front of the seat's middle, facing `face`: they
 * sit down there and get up there. A sleeper's (x, z) is on the mattress under the hips, `face` from head to feet.
 * A rider's (x, z) is under the saddle, and they face the way they ride: hands on the bars, feet on the pedals,
 * which turn with the distance ridden (RIDE in @futuremagic/humanoid has where a bicycle drawn to match puts them).
 * Sitting down, lying down and getting up play when `rest` comes and goes; keep them in place meanwhile.
 */
export interface Rest {
  kind: 'sit' | 'lie' | 'ride';
  seat: number;
}

export interface Look {
  /** Names the body: a new key builds a new body. */
  bodyKey: string;
  app: HumanoidAppearance;
  /** Names the outfit: a new key dresses them again. */
  outfitKey: string;
  outfit: EquipmentVisuals;
}

/**
 * Whether a part casts a sun shadow. Cut-out parts (hair cards, lashes: a shadow mask of their own) would
 * build a shadow shader for every human that comes near; the head's shadow covers theirs.
 */
function casts(m: Mesh): boolean {
  const mat = m.material as Material & { maskShadowNode?: unknown; maskNode?: unknown; castShadowNode?: unknown; colorNode?: unknown; map?: unknown };
  return !mat.maskShadowNode && !mat.maskNode && !mat.castShadowNode && !mat.colorNode && !mat.map;
}

/** Full humans at most, and how far off (m). */
const MAX_HUMANS = 24;
const HUMAN_RANGE = 120;
/** Closer than this a human has its detailed body and casts a shadow (m). */
const NEAR = 30;
/** Humans built and not shown, kept for people who come back. */
const SPARE = 16;
/** Bodies asked of the workers at once. */
const BUILDING = 3;
/** How fast people turn (rad/s). */
const TURN = 7;

interface Slot {
  id: number;
  bodyKey: string;
  outfitKey: string;
  human: Humanoid | null;
  /** Still being built or compiled. */
  ready: boolean;
  seen: number;
  yaw: number;
  near: boolean;
}

export class PeopleView {
  readonly root = new Group();
  private readonly slots = new Map<number, Slot>();
  private building = 0;
  private frame = 0;

  private constructor(private readonly stage: Stage, private readonly bodies: Bodies) {
    this.root.name = 'people';
  }

  /**
   * Load the human assets and start the body workers; `samples` (two or three looks) are built at once and
   * returned for the Stage's warm-up (`stage.warmUp(view.warm)`), so their shaders are compiled with the rest.
   */
  static async create(stage: Stage, samples: Look[], workers: number): Promise<{ view: PeopleView; warm: Object3D[] }> {
    const [bodies] = await Promise.all([Bodies.launch(workers), clipLibraryReady()]);
    const view = new PeopleView(stage, bodies);
    for (const [i, s] of samples.entries()) {
      const h = new Humanoid(await bodies.geometry(`warm${i}`, s.app, 0), s.app, { wardrobe: WARDROBE, expressions: false });
      h.dress(s.outfit);
      h.char.lods.forEach((g) => (g.visible = true));
      view.samples.push(h);
    }
    return { view, warm: view.samples.map((h) => h.object) };
  }

  /** The humans built for the warm-up (`create`); gone once it is over (`warmedUp`). */
  private readonly samples: Humanoid[] = [];

  /**
   * The warm-up is over. Its sample humans are kept (out of the scene, never drawn): three forgets a shader
   * build once nothing uses it any more, and every human that comes near after would build its shadow anew.
   */
  warmedUp(): void {
    for (const h of this.samples) h.object.removeFromParent();
  }

  /** Humans on screen now, and built in all. */
  get counts(): { shown: number; built: number; building: number } {
    let shown = 0, built = 0;
    for (const s of this.slots.values()) { if (s.human) built++; if (s.human?.object.visible) shown++; }
    return { shown, built, building: this.building };
  }

  /** Draw `figures` around the camera at (cx, cz). `time`: seconds, for the animator. */
  draw(figures: Iterable<Figure>, cx: number, cz: number, dt: number, time: number): void {
    this.frame++;
    const near: { f: Figure; d: number }[] = [];
    for (const f of figures) {
      const d = Math.hypot(f.x - cx, f.z - cz);
      if (d < HUMAN_RANGE) near.push({ f, d });
    }
    near.sort((a, b) => a.d - b.d);
    const chosen = near.slice(0, MAX_HUMANS);
    const ids = new Set(chosen.map((c) => c.f.id));
    for (const s of this.slots.values()) if (s.human && !ids.has(s.id)) s.human.object.visible = false;
    for (const { f, d } of chosen) {
      let s = this.slots.get(f.id);
      if (!s || !s.human) {
        if (!s) this.slots.set(f.id, (s = { id: f.id, bodyKey: '', outfitKey: '', human: null, ready: false, seen: 0, yaw: 0, near: false }));
        s.seen = this.frame;
        if (!s.bodyKey && this.building < BUILDING) this.buildHuman(s, f.look(), d);
        continue;
      }
      s.seen = this.frame;
      if (!s.ready) continue;
      if (f.hidden) { s.human.object.visible = false; continue; }
      const look = f.look();
      if (look.bodyKey !== s.bodyKey) { this.drop(s); this.slots.delete(s.id); continue; }
      if (look.outfitKey !== s.outfitKey) { s.outfitKey = look.outfitKey; s.human.dress(look.outfit); }
      this.posture(s, f, d, dt, time);
    }
    this.dropUnseen();
  }

  private posture(s: Slot, f: Figure, d: number, dt: number, time: number): void {
    const h = s.human!;
    // Coming into view: already in their pose and turned their way (no sitting down again, no turning round).
    const first = !h.object.visible;
    if (first) h.animator.snapPose();
    h.object.visible = true;
    const speed = Math.hypot(f.vx, f.vz);
    const want = speed > 0.15 ? Math.atan2(-f.vx, -f.vz) : f.face;
    // Turning takes a moment (a walker who stops at a bench turns round to sit).
    if (want !== undefined && first) s.yaw = want;
    else if (want !== undefined) {
      const d = Math.atan2(Math.sin(want - s.yaw), Math.cos(want - s.yaw));
      s.yaw += Math.abs(d) < TURN * dt ? d : Math.sign(d) * TURN * dt;
    }
    const near = d < NEAR;
    if (near !== s.near) {
      s.near = near;
      h.char.setLod(near ? 0 : 1);
      h.object.traverse((o) => { if ((o as Mesh).isMesh) o.castShadow = near && casts(o as Mesh); });
    }
    const r = f.rest;
    const anim: AnimState = r ? { move: r.kind === 'lie' ? 'sleep' : r.kind, seat: r.seat } : { move: speed > 2.6 ? 'run' : speed > 0.15 ? 'walk' : 'idle' };
    h.update({ pos: [f.x, f.y, f.z], vel: [f.vx, 0, f.vz], yaw: s.yaw, anim }, dt, time, null);
  }

  /** Build a human for slot `s`: the body in a worker, then the human and its clothes, then its shaders. */
  private buildHuman(s: Slot, look: Look, d: number): void {
    s.bodyKey = look.bodyKey;
    s.outfitKey = look.outfitKey;
    this.building++;
    this.bodies.geometry(look.bodyKey, look.app, d)
      .then(async (geo) => {
        const h = new Humanoid(geo, look.app, { wardrobe: WARDROBE, expressions: false });
        h.dress(look.outfit);
        h.object.visible = false;
        h.char.setLod(1);
        h.object.traverse((o) => { if ((o as Mesh).isMesh) o.castShadow = false; });
        s.human = h;
        // Every part's shaders, both detail levels, before it is drawn (cache hits after the warm-up).
        await this.compileHuman(h);
        this.root.add(h.object);
        s.ready = true;
      })
      .catch((e) => { console.error('a human could not be built', e); this.slots.delete(s.id); })
      .finally(() => { this.building--; });
  }

  /**
   * Compile `h` (not in the scene yet): both detail levels, and the shadow of each kind of part that casts
   * one up close the Stage has not seen yet (the Stage keeps track of the kinds).
   */
  private async compileHuman(h: Humanoid): Promise<void> {
    const shown = h.char.lods.map((g) => g.visible);
    h.char.lods.forEach((g) => (g.visible = true));
    h.object.visible = true;
    // Up close: the near detail level and what is held or worn on the bones (hats), not the far levels.
    const far = new Set<Object3D>(h.char.lods.slice(1));
    const walk = (o: Object3D): void => {
      if (far.has(o)) return;
      if ((o as Mesh).isMesh) o.castShadow = casts(o as Mesh);
      for (const c of o.children) walk(c);
    };
    walk(h.object);
    try { await this.stage.prepare(h.object); } finally {
      h.char.lods.forEach((g, i) => (g.visible = shown[i]));
      h.object.visible = false;
      h.object.traverse((o) => { o.castShadow = false; });
    }
  }

  private drop(s: Slot): void {
    s.human?.dispose();
    s.human = null;
  }

  /** Keep at most SPARE humans nobody is drawing; the ones unseen longest go first. */
  private dropUnseen(): void {
    const idle = [...this.slots.values()].filter((s) => s.ready && s.seen !== this.frame).sort((a, b) => a.seen - b.seen);
    for (const s of idle.slice(0, Math.max(0, idle.length - SPARE))) { this.drop(s); this.slots.delete(s.id); }
    // A slot waiting for a build slot that nobody needs any more.
    for (const s of this.slots.values()) if (!s.human && !s.bodyKey && s.seen !== this.frame) this.slots.delete(s.id);
  }
}
