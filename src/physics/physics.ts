/**
 * The one physics world (Rapier, as in Scale: src/physics/Physics.ts there). For now it holds what the player's
 * body walks against: the ground as one heightfield (the sim worker's grid of the drawn ground, the same heights the
 * people of the town walk on), and static solids in named sets (a building's walls, the props of a stretch of
 * street, a house's interior) that come and go as the player moves. `Physics.create()` loads the WASM; nothing
 * else in the game imports Rapier (guarded).
 */
import RAPIER from '@dimforge/rapier3d-compat';
import earcut from 'earcut';
import type { HeightGrid } from '../workers/simProtocol';

export type Rapier = typeof RAPIER;
export type Collider = RAPIER.Collider;
export type CharacterController = RAPIER.KinematicCharacterController;

import { deckBoxes, EDGES, type SolidBox, type SolidFloor, type SolidPost } from './solids';

export class Physics {
  private readonly sets = new Map<string, RAPIER.Collider[]>();

  private constructor(readonly R: Rapier, readonly world: RAPIER.World) {}

  /** Load Rapier and make the world with `ground` as its floor. */
  static async create(ground: HeightGrid): Promise<Physics> {
    await RAPIER.init();
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    const p = new Physics(RAPIER, world);
    p.setGround(ground);
    return p;
  }

  /** The ground the world has now (src/physics/solids.ts `heightOnGrid` gives its heights). */
  ground!: HeightGrid;
  /** Its colliders: the heightfield, then the decks (they are not in the grid). */
  private groundCols: RAPIER.Collider[] = [];

  /** Make `g` the ground (in place of the one before): the body walks wherever it reaches (src/game/standing.ts keeps one round it). */
  setGround(g: HeightGrid): void {
    if (g === this.ground) return;
    for (const c of this.groundCols) this.world.removeCollider(c, false);
    this.ground = g;
    // Rapier's heightfield: column-major, rows along z, columns along x, centred on its collider.
    const n = g.n, h = new Float32Array(n * n);
    for (let iz = 0; iz < n; iz++) for (let ix = 0; ix < n; ix++) h[ix * n + iz] = g.h[iz * n + ix];
    const size = (n - 1) * g.step;
    const d = this.R.ColliderDesc.heightfield(n - 1, n - 1, h, { x: size, y: 1, z: size }).setTranslation(g.x0 + size / 2, 0, g.z0 + size / 2);
    this.groundCols = [this.world.createCollider(d), ...deckBoxes(g).map((b) => this.world.createCollider(this.boxDesc(b)))];
    this.world.step();
  }

  private boxDesc(b: SolidBox): RAPIER.ColliderDesc {
    // Turn about y, then tilt about the box's own x: q = q_yaw · q_pitch.
    const sy = Math.sin(b.yaw / 2), cy = Math.cos(b.yaw / 2), p = -(b.pitch ?? 0) / 2, sp = Math.sin(p), cp = Math.cos(p);
    return this.R.ColliderDesc.cuboid(b.hx, b.hy, b.hz).setTranslation(b.x, b.y, b.z).setRotation({ x: cy * sp, y: sy * cp, z: -sy * sp, w: cy * cp });
  }

  /** Put the set `key` in place (replacing what it held). */
  setSolids(key: string, boxes: readonly SolidBox[], posts: readonly SolidPost[] = [], floors: readonly SolidFloor[] = []): void {
    this.dropSolids(key);
    const R = this.R, out: RAPIER.Collider[] = [];
    for (const b of boxes) out.push(this.world.createCollider(this.boxDesc(b)));
    for (const f of floors) {
      const flat = [...f.outer, ...f.holes.flat()], holes: number[] = [];
      let at = f.outer.length / 2;
      for (const h of f.holes) { holes.push(at); at += h.length / 2; }
      const tri = earcut(flat, holes, 2);
      if (!tri.length) continue;
      const v = new Float32Array((flat.length / 2) * 3);
      for (let i = 0; i < flat.length / 2; i++) { v[i * 3] = flat[i * 2]; v[i * 3 + 1] = f.y; v[i * 3 + 2] = flat[i * 2 + 1]; }
      out.push(this.world.createCollider(R.ColliderDesc.trimesh(v, new Uint32Array(tri))));
    }
    for (const p of posts) out.push(this.world.createCollider(R.ColliderDesc.cylinder(p.h / 2, p.r).setTranslation(p.x, p.y + p.h / 2, p.z)));
    this.sets.set(key, out);
    // The queries (`roomAt`, `clear`) see the world as of its last step: step it, so they see these at once.
    this.world.step();
  }

  hasSolids(key: string): boolean { return this.sets.has(key); }

  /** Remove the set `key`. */
  dropSolids(key: string): void {
    const old = this.sets.get(key);
    if (!old) return;
    for (const c of old) this.world.removeCollider(c, false);
    this.sets.delete(key);
  }

  /**
   * Every box, post and body within `r` of (x, z) as line segments (x0, y0, z0, x1, y1, z1 each): a box's 12 edges, an
   * upright cylinder or capsule as two rings of 8 and 4 uprights; the ground and the floors are left out. For the
   * debug menu's Show colliders (src/game/debugView.ts).
   */
  outlines(x: number, z: number, r: number): number[] {
    const out: number[] = [], T = this.R.ShapeType;
    this.world.forEachCollider((c) => {
      const t = c.translation();
      if (Math.hypot(t.x - x, t.z - z) > r) return;
      const q = c.rotation(), sh = c.shape;
      // A local point turned by the collider's rotation and moved to it.
      const turned = (lx: number, ly: number, lz: number): [number, number, number] => {
        const ix = q.w * lx + q.y * lz - q.z * ly, iy = q.w * ly + q.z * lx - q.x * lz, iz = q.w * lz + q.x * ly - q.y * lx, iw = -q.x * lx - q.y * ly - q.z * lz;
        return [t.x + ix * q.w + iw * -q.x + iy * -q.z - iz * -q.y, t.y + iy * q.w + iw * -q.y + iz * -q.x - ix * -q.z, t.z + iz * q.w + iw * -q.z + ix * -q.y - iy * -q.x];
      };
      const seg = (a: [number, number, number], b: [number, number, number]) => out.push(...a, ...b);
      if (sh.type === T.Cuboid) {
        const h = (sh as RAPIER.Cuboid).halfExtents;
        const p = (i: number) => turned(i & 1 ? h.x : -h.x, i & 2 ? h.y : -h.y, i & 4 ? h.z : -h.z);
        for (const [a, b] of EDGES) seg(p(a), p(b));
      } else if (sh.type === T.Cylinder || sh.type === T.Capsule) {
        const { halfHeight: hh, radius: rr } = sh as RAPIER.Cylinder;
        const ring = (k: number, y: number) => turned(Math.cos((k * Math.PI) / 4) * rr, y, Math.sin((k * Math.PI) / 4) * rr);
        const top = sh.type === T.Capsule ? hh + rr : hh;
        for (let k = 0; k < 8; k++) {
          seg(ring(k, -top), ring(k + 1, -top));
          seg(ring(k, top), ring(k + 1, top));
          if (k % 2 === 0) seg(ring(k, -top), ring(k, top));
        }
      }
    });
    return out;
  }

  /** The keys of the sets in place. */
  keys(): IterableIterator<string> { return this.sets.keys(); }

  /** How far (x, y, z) is from the nearest solid but `skip` (0 inside one). */
  roomAround(x: number, y: number, z: number, skip?: RAPIER.Collider): number {
    const p = this.world.projectPoint({ x, y, z }, true, undefined, undefined, skip);
    return p ? (p.isInside ? 0 : Math.hypot(p.point.x - x, p.point.y - y, p.point.z - z)) : Infinity;
  }

  /**
   * Is there room for a person standing at feet (x, y, z) (a capsule of `radius`, `height` tall, clear of every
   * solid but `skip`)?
   */
  roomAt(x: number, y: number, z: number, radius: number, height: number, skip?: RAPIER.Collider): boolean {
    const half = height / 2 - radius;
    return !this.world.intersectionWithShape({ x, y: y + height / 2 + 0.03, z }, { x: 0, y: 0, z: 0, w: 1 }, new this.R.Capsule(half, radius), undefined, undefined, skip);
  }

  /**
   * How far (m) a ray from (x, y, z) along the unit direction (dx, dy, dz) gets before it meets a solid, up to
   * `max` (`skip`: a collider to see through, e.g. the player's own body). With `radius`, how far a ball that big
   * gets (a camera that must not touch a wall).
   */
  clear(x: number, y: number, z: number, dx: number, dy: number, dz: number, max: number, skip?: RAPIER.Collider, radius = 0): number {
    if (radius > 0) {
      const hit = this.world.castShape({ x, y, z }, { x: 0, y: 0, z: 0, w: 1 }, { x: dx, y: dy, z: dz }, new this.R.Ball(radius), 0, max, true, undefined, undefined, skip);
      return hit ? hit.time_of_impact : max;
    }
    const hit = this.world.castRay(new this.R.Ray({ x, y, z }, { x: dx, y: dy, z: dz }), max, true, undefined, undefined, skip);
    return hit ? hit.timeOfImpact : max;
  }
}
