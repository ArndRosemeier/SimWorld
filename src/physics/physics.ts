/**
 * The one physics world (Rapier, as in Scale: src/physics/Physics.ts there). For now it holds what the player's
 * body walks against: the ground as one heightfield (the sim worker's sidewalk-level grid, the same heights the
 * people of the town walk on), and static solids in named sets (a building's walls, the props of a stretch of
 * street, a house's interior) that come and go as the player moves. `Physics.create()` loads the WASM; nothing
 * else in the game imports Rapier (guarded).
 */
import RAPIER from '@dimforge/rapier3d-compat';
import type { HeightGrid } from '../workers/simProtocol';

export type Rapier = typeof RAPIER;
export type Collider = RAPIER.Collider;
export type CharacterController = RAPIER.KinematicCharacterController;

import type { SolidBox, SolidPost } from './solids';

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

  private setGround(g: HeightGrid): void {
    // Rapier's heightfield: column-major, rows along z, columns along x, centred on its collider.
    const n = g.n, h = new Float32Array(n * n);
    for (let iz = 0; iz < n; iz++) for (let ix = 0; ix < n; ix++) h[ix * n + iz] = g.h[iz * n + ix];
    const size = (n - 1) * g.step;
    const d = this.R.ColliderDesc.heightfield(n - 1, n - 1, h, { x: size, y: 1, z: size }).setTranslation(g.x0 + size / 2, 0, g.z0 + size / 2);
    this.world.createCollider(d);
  }

  /** Put the set `key` in place (replacing what it held). */
  setSolids(key: string, boxes: readonly SolidBox[], posts: readonly SolidPost[] = []): void {
    this.dropSolids(key);
    const R = this.R, out: RAPIER.Collider[] = [];
    for (const b of boxes) {
      const d = R.ColliderDesc.cuboid(b.hx, b.hy, b.hz).setTranslation(b.x, b.y, b.z).setRotation({ x: 0, y: Math.sin(b.yaw / 2), z: 0, w: Math.cos(b.yaw / 2) });
      out.push(this.world.createCollider(d));
    }
    for (const p of posts) out.push(this.world.createCollider(R.ColliderDesc.cylinder(p.h / 2, p.r).setTranslation(p.x, p.y + p.h / 2, p.z)));
    this.sets.set(key, out);
  }

  hasSolids(key: string): boolean { return this.sets.has(key); }

  /** Remove the set `key`. */
  dropSolids(key: string): void {
    const old = this.sets.get(key);
    if (!old) return;
    for (const c of old) this.world.removeCollider(c, false);
    this.sets.delete(key);
  }

  /** The keys of the sets in place. */
  keys(): IterableIterator<string> { return this.sets.keys(); }

  /**
   * How far (m) a ray from (x, y, z) along the unit direction (dx, dy, dz) gets before it meets a solid, up to
   * `max` (`skip`: a collider to see through, e.g. the player's own body).
   */
  clear(x: number, y: number, z: number, dx: number, dy: number, dz: number, max: number, skip?: RAPIER.Collider): number {
    const hit = this.world.castRay(new this.R.Ray({ x, y, z }, { x: dx, y: dy, z: dz }), max, true, undefined, undefined, skip);
    return hit ? hit.timeOfImpact : max;
  }
}
