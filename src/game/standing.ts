/**
 * Where the player's body stands out of doors (plan R5): the solids around it in the physics world, and the one
 * rule for putting it down anywhere: on the ground as the physics world has it, with room for the body, not inside
 * a closed building, a parked car or a post, and never beyond the drawn world (nobody out of town is taken over:
 * src/street/takeover.ts). The ground comes with the solids round the body (`NearSolids.ground`), so it walks
 * anywhere the world is drawn. Indoors, Playing stands them up on their floor (`standUp`).
 */
import type { Physics } from '../physics/physics';
import { heightOnGrid, wallBoxes, type SolidPost } from '../physics/solids';
import { distPointPolyEdge, pointInPoly } from '../geom/geom2';
import type { NearSolids } from '../workers/simProtocol';

/** The body as the room it needs: radius and height (src/game/avatar.ts). */
export const BODY_R = 0.3, BODY_H = 1.8;
/** Height of the street's posts, trees and parked cars as the body meets them (m). */
const POST_H = 2.2;
/** How far from (x, z) a spot with room is looked for (m), ring by ring. */
const RINGS = [0, 0.5, 1, 1.6, 2.4, 3.5, 5, 7, 10];

/** Put `near` in the physics world: the ground round it, each building's walls (kept while it stays near; not `interior`'s, whose inside stands), the street's posts afresh. */
export function placeSolids(phys: Physics, near: NearSolids, interior: number): void {
  phys.setGround(near.ground);
  const keep = new Set<string>();
  for (const b of near.buildings) {
    const key = `b:${b.code}`;
    keep.add(key);
    if (b.code !== interior && !phys.hasSolids(key)) phys.setSolids(key, wallBoxes(b.poly, b.y0, b.y1));
  }
  for (const key of [...phys.keys()]) if (key.startsWith('b:') && !keep.has(key)) phys.dropSolids(key);
  const posts: SolidPost[] = [];
  const c = near.circles;
  for (let i = 0; i < c.length; i += 4) posts.push({ x: c[i], z: c[i + 1], r: c[i + 2], y: c[i + 3] - 0.5, h: POST_H + 0.5 });
  phys.setSolids('posts', [], posts);
}

/**
 * Feet for a body put down at (x, z) out of doors: there on the ground if it has room, else the nearest spot round
 * it that has (outside every closed building of `near`, clear of posts and parked cars), never further out than
 * `world` metres from the centre either way (the walkable world). The ground and solids round (x, z) should be
 * placed (`placeSolids`).
 */
export function landOutdoors(phys: Physics, near: NearSolids | null, x: number, z: number, world: number): { x: number; y: number; z: number } {
  x = Math.max(-world, Math.min(world, x)); z = Math.max(-world, Math.min(world, z));
  const ground = phys.ground;
  const inBuilding = (px: number, pz: number) => near?.buildings.some((b) => pointInPoly(b.poly, px, pz) || distPointPolyEdge(b.poly, px, pz) < BODY_R + 0.2) ?? false;
  for (const r of RINGS) for (let k = 0; k < (r ? 12 : 1); k++) {
    const px = x + Math.sin((k * Math.PI) / 6) * r, pz = z + Math.cos((k * Math.PI) / 6) * r, py = heightOnGrid(ground, px, pz);
    if (!inBuilding(px, pz) && phys.roomAt(px, py, pz, BODY_R, BODY_H)) return { x: px, y: py, z: pz };
  }
  return { x, y: heightOnGrid(ground, x, z), z };
}
