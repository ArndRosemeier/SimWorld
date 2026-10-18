/**
 * Doors that open and shut: a leaf on a hinge in every doorway of a building's interior (the room doors in its inner
 * walls, its street doors), and how they move. A leaf swings open when someone walks into it or the player uses
 * it, stays open while someone is in the doorway, and swings shut behind them a moment later. A street door that is
 * locked (a shop out of hours, a home that is not yours) opens only from inside.
 *
 * Pure: the leaves are a function of the interior; `stepDoors` moves them for the people around. The game draws
 * each leaf (src/render/interiorView.ts) and puts the shut ones in the physics world (src/game/inside.ts).
 *
 * New in SimWorld.
 */
import { pointInPoly, polyArea } from '../geom/geom2';
import type { Interior } from './building';
import type { Box } from './indoors';
import type { RoomType } from './types';

/**
 * A door leaf: hinged at (x, z) on floor `floor` (world y `y`), `w` wide and `h` high. Shut, it runs from the hinge
 * along (dx, dz); open, it has swung a quarter turn towards (nx, nz), the side it opens into. `street`: the index of
 * its street door in `Indoors.doors` (-1 for a room door); `homes` a street door to homes (else to a workplace).
 */
export interface DoorLeaf {
  floor: number;
  x: number; y: number; z: number;
  dx: number; dz: number;
  nx: number; nz: number;
  w: number; h: number;
  street: number;
  homes: boolean;
}

/** A leaf's height (the doorways are 2.15 m) and thickness. */
export const LEAF_H = 2.08, LEAF_T = 0.045;
/** Openings wider than this are archways: no leaf (a street door this wide gets two). */
const WIDEST = 1.35;
/** Rooms one passes through: a door opens away from them, into the room behind. */
const PASSAGE = new Set<RoomType>(['hall', 'corridor', 'stairs', 'lobby']);

/** Every door leaf of interior `I` whose ground floor stands at world y `base`. */
export function doorLeavesOf(I: Interior, base: number): DoorLeaf[] {
  const out: DoorLeaf[] = [];
  I.storeys.forEach((s, f) => {
    const y = base + s.y;
    for (const w of s.walls) {
      if (w.solid) continue;
      const L = Math.hypot(w.bx - w.ax, w.bz - w.az);
      if (L < 0.2) continue;
      const dx = (w.bx - w.ax) / L, dz = (w.bz - w.az) / L;
      for (const [t0, t1] of w.doors) {
        const s0 = t0 * L, width = (t1 - t0) * L;
        if (width < 0.55 || width > WIDEST) continue;
        // Open into the room behind the doorway, not into the hall or corridor (the bigger room when both are rooms).
        const mx = w.ax + dx * (s0 + width / 2), mz = w.az + dz * (s0 + width / 2);
        const side = (k: number) => {
          const r = s.rooms.find((q) => pointInPoly(q.poly, mx - dz * 0.6 * k, mz + dx * 0.6 * k));
          return r ? (PASSAGE.has(r.type) ? 0 : 1000) + Math.abs(polyArea(r.poly)) : -1;
        };
        const k = side(1) >= side(-1) ? 1 : -1;
        out.push({ floor: f, x: w.ax + dx * s0, y, z: w.az + dz * s0, dx, dz, nx: -dz * k, nz: dx * k, w: width, h: LEAF_H, street: -1, homes: false });
      }
    }
  });
  // The street doors open inwards; a wide one has two leaves.
  I.doors.forEach((d, i) => {
    const dx = -d.nz, dz = d.nx, two = d.w > WIDEST, w = two ? d.w / 2 : d.w;
    const at = (s: number) => ({ x: d.x + dx * s, z: d.z + dz * s });
    const half = (s: number, sg: number): DoorLeaf => ({ floor: 0, ...at(s), y: base, dx: dx * sg, dz: dz * sg, nx: -d.nx, nz: -d.nz, w, h: LEAF_H, street: i, homes: d.homes });
    out.push(half(-d.w / 2, 1));
    if (two) out.push(half(d.w / 2, -1));
  });
  return out;
}

/** The way a leaf runs from its hinge when open by `a` (0 shut … 1 a quarter turn). */
export function leafWay(l: DoorLeaf, a: number): [number, number] {
  const c = Math.cos((a * Math.PI) / 2), s = Math.sin((a * Math.PI) / 2);
  return [l.dx * c + l.nx * s, l.dz * c + l.nz * s];
}

/** A shut leaf as a box to bump into (src/interior/indoors.ts Box: z along the leaf). */
export function leafBox(l: DoorLeaf): Box {
  return { x: l.x + l.dx * l.w / 2, y: l.y + l.h / 2, z: l.z + l.dz * l.w / 2, hx: LEAF_T, hy: l.h / 2, hz: l.w / 2, yaw: Math.atan2(l.dx, l.dz) };
}

/**
 * Where each leaf is: open by `a` (0 … 1), heading for `to`, `idle` real seconds with nobody in its doorway, `quiet`
 * real seconds left in which walking into it does not open it (the player has just shut it).
 */
export interface DoorState { a: number; to: number; idle: number; quiet: number }

/** Someone who can open a door: where they stand (feet); `keys`: they open locked doors too (the people who live or work there). */
export interface Mover { x: number; y: number; z: number; keys?: boolean }

/** Real seconds a leaf takes to swing; seconds it stays open with nobody near. */
const SWING = 0.55, STAYS = 2.5;
/** Walking into a leaf: this close to it (m, across), within its width. Near the doorway: this close to its middle. */
const PUSH = 0.75, NEAR = 1.4;

/** The leaves all shut. */
export function shutDoors(leaves: readonly DoorLeaf[]): DoorState[] {
  return leaves.map(() => ({ a: 0, to: 0, idle: 0, quiet: 0 }));
}

/**
 * Move the leaves on by `dt` real seconds for the people around (`movers`): a shut leaf someone walks into swings
 * open (unless it is `locked` and they are outside it without `keys`), an open one swings shut after a while with nobody in the
 * doorway. Returns whether any leaf came to be shut or began to open (the solids change).
 */
export function stepDoors(leaves: readonly DoorLeaf[], st: DoorState[], movers: readonly Mover[], dt: number, locked: (l: DoorLeaf) => boolean): boolean {
  let changed = false;
  leaves.forEach((l, i) => {
    const s = st[i];
    const mx = l.x + l.dx * l.w / 2, mz = l.z + l.dz * l.w / 2;
    let near = false, push = false, outside = false;
    for (const m of movers) {
      if (Math.abs(m.y - l.y) > 1.2) continue;
      const rx = m.x - l.x, rz = m.z - l.z, along = rx * l.dx + rz * l.dz, across = rx * l.nx + rz * l.nz;
      if (Math.hypot(m.x - mx, m.z - mz) < NEAR) near = true;
      if (along > -0.1 && along < l.w + 0.1 && Math.abs(across) < PUSH) { push = true; if (across < 0 && !m.keys) outside = true; }
    }
    s.quiet = Math.max(0, s.quiet - dt);
    if (s.to === 0 && push && s.quiet === 0 && !(outside && l.street >= 0 && locked(l))) { s.to = 1; changed = true; }
    s.idle = near ? 0 : s.idle + dt;
    if (s.to === 1 && s.idle > STAYS) s.to = 0;
    const was = s.a;
    s.a = s.to > s.a ? Math.min(1, s.a + dt / SWING) : Math.max(0, s.a - dt / SWING);
    if (was > 0 && s.a === 0) changed = true;
  });
  return changed;
}

/**
 * The player uses the door nearest (x, z) on their floor (within reach): a shut one opens (unless `locked` and they
 * are outside), an open one shuts. Returns the leaf's index, -1 if none is in reach, or -2 if it is locked.
 */
export function useDoor(leaves: readonly DoorLeaf[], st: DoorState[], me: Mover, locked: (l: DoorLeaf) => boolean): number {
  let best = -1, bd = 1.6;
  leaves.forEach((l, i) => {
    if (Math.abs(me.y - l.y) > 1.2) return;
    const d = Math.hypot(me.x - (l.x + l.dx * l.w / 2), me.z - (l.z + l.dz * l.w / 2));
    if (d < bd) { bd = d; best = i; }
  });
  if (best < 0) return -1;
  const l = leaves[best], s = st[best];
  if (s.to === 0) {
    const across = (me.x - l.x) * l.nx + (me.z - l.z) * l.nz;
    if (l.street >= 0 && across < 0 && locked(l)) return -2;
    s.to = 1;
  } else {
    s.to = 0;
    s.quiet = 1.5;
  }
  s.idle = 0;
  return best;
}
