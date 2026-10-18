/**
 * Where people sit out of doors: every seat place on the town's benches and café chairs, and who is
 * sitting where when. A seat is the same anchor as an interior's sitting spot (src/interior/types.ts
 * `Spot`): the middle of the seat, the way the sitter faces, the seat's height. People sit down from
 * SEAT_REACH in front of it (the humanoid animator's convention), so a walk ends there.
 *
 * Pure (sim worker, headless tests). New in SimWorld.
 */
import { SEAT_REACH } from '@futuremagic/humanoid/seating';
import { PropType, type CellPlan } from '../plan/cell';

export { SEAT_REACH };

/**
 * A seat place: its middle (x, z), the way the sitter faces (sin yaw, cos yaw), as an interior `Spot`; its height
 * above the ground (m). A figure on it faces yaw + PI (a figure's face 0 looks to -z).
 */
export interface Seat {
  readonly x: number;
  readonly z: number;
  readonly yaw: number;
  readonly top: number;
}

/**
 * Seat places of the props that can be sat on, in the model's frame (the sitter faces -z): along x, the
 * seat's middle z, the seat's height (m at scale 1; src/build/furniture.ts).
 */
const SITTABLE: Partial<Record<PropType, { along: number[]; z: number; top: number }>> = {
  [PropType.Bench]: { along: [-0.55, 0, 0.55], z: -0.02, top: 0.46 },
  [PropType.CafeChair]: { along: [0], z: 0, top: 0.45 },
};

/** Every seat place in the planned cells. */
export function seatsOf(cells: readonly CellPlan[]): Seat[] {
  const out: Seat[] = [];
  for (const plan of cells) {
    const P = plan.props;
    for (let i = 0; i < P.length; i += 6) {
      const s = SITTABLE[P[i] as PropType];
      if (!s) continue;
      const x = P[i + 1], z = P[i + 2], yaw = P[i + 3], k = P[i + 4] || 1;
      // The model's x axis and z axis in the world (rotated by yaw).
      const cx = Math.cos(yaw), sx = -Math.sin(yaw), czx = Math.sin(yaw), czz = Math.cos(yaw);
      for (const a of s.along) out.push({ x: x + (cx * a + czx * s.z) * k, z: z + (sx * a + czz * s.z) * k, yaw: yaw + Math.PI, top: s.top * k });
    }
  }
  return out;
}

/** Where someone stands to sit on `s` (a Seat, an interior Spot) and gets up: SEAT_REACH in front of it. */
export function seatFront(s: { x: number; z: number; yaw: number }, reach = SEAT_REACH): [number, number] {
  return [s.x + Math.sin(s.yaw) * reach, s.z + Math.cos(s.yaw) * reach];
}

/**
 * Who sits on which seat when (game minutes): a seat holds one person at a time. A booking is kept by
 * whoever made it, so laying out the same stretch again finds the same seat.
 */
export class SeatBook {
  private readonly held = new Map<number, { id: number; t0: number; t1: number }[]>();

  /** Book seat `i` for `id` from t0 to t1; true if it is free then (or already theirs). */
  book(i: number, id: number, t0: number, t1: number): boolean {
    let l = this.held.get(i);
    if (!l) this.held.set(i, (l = []));
    for (const b of l) {
      if (b.t1 <= t0 || b.t0 >= t1) continue;
      if (b.id === id) return b.t0 === t0 && b.t1 === t1;
      return false;
    }
    l.push({ id, t0, t1 });
    return true;
  }

  /** Forget the bookings that ended before `t` (and every booking, with no `t`). */
  forget(t = Infinity): void {
    for (const [i, l] of this.held) {
      const keep = l.filter((b) => b.t1 > t);
      if (keep.length) this.held.set(i, keep);
      else this.held.delete(i);
    }
  }
}
