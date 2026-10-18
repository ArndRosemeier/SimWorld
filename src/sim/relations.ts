/**
 * Relationships (plan §3.1, R3): sparse and directed. A row exists only for pairs who know of each other; how A feels
 * about B is A's row, how B feels about A is B's. Animals use the same table for familiarity and fear (the dog that
 * barks at the postman), so there is one answer to "how do these two feel about each other".
 */
import type { ActorId } from './actors';
import { Columns, f32, i32, u16 } from './table';

/** Labelled bonds (bit flags). A's row about B carries what B is to A. Reciprocal pairs are set together by `bond`. */
export const BONDS = [
  'partner', 'spouse', 'parent', 'child', 'sibling', 'grandparent', 'grandchild', 'relative',
  'colleague', 'classmate', 'neighbour', 'friend', 'ex', 'owner', 'pet', 'housemate',
] as const;
export type Bond = (typeof BONDS)[number];
/** Bit of a bond in `bonds`. */
export const bondBit = (b: Bond): number => 1 << BONDS.indexOf(b);
const bit = bondBit;
const RECIPROCAL: Partial<Record<Bond, Bond>> = { parent: 'child', child: 'parent', grandparent: 'grandchild', grandchild: 'grandparent', owner: 'pet', pet: 'owner' };
/** Bonds that count as family (loyalty gates, household news). */
export const FAMILY_MASK = bit('partner') | bit('spouse') | bit('parent') | bit('child') | bit('sibling') | bit('grandparent') | bit('grandchild') | bit('relative');

const RELATION_COLUMNS = {
  from: i32(-1),
  to: i32(-1),
  /** How well A knows B, 0..1 (0 = a face, 1 = family). */
  familiarity: f32(),
  /** Liking, -1..1. */
  affection: f32(),
  /** 0..1; strangers start at 0.3. */
  trust: f32(1, 0.3),
  respect: f32(1, 0.5),
  fear: f32(),
  /** Clock minute A last met B, -1 never. */
  lastMet: i32(-1),
  bonds: u16(),
} as const;

/** Actor ids must stay below this (4M) for the pair key; far beyond any town. */
const KEY = 1 << 22;

export class Relations {
  readonly t = new Columns(RELATION_COLUMNS, 1024);
  private readonly index = new Map<number, number>();
  /** Rows owned by each actor (their outgoing feelings). */
  readonly out: number[][] = [];

  /** Row of A's feelings about B, or -1. */
  row(a: ActorId, b: ActorId): number {
    return this.index.get(a * KEY + b) ?? -1;
  }

  /** Rows freed by `prune`, reused before the table grows. */
  private readonly free: number[] = [];

  /** Row of A's feelings about B, created with stranger defaults if missing. */
  ensure(a: ActorId, b: ActorId): number {
    const k = a * KEY + b;
    let r = this.index.get(k);
    if (r !== undefined) return r;
    if (this.free.length > 0) { r = this.free.pop()!; this.t.clear(r); } else r = this.t.add();
    this.t.cols.from[r] = a;
    this.t.cols.to[r] = b;
    this.index.set(k, r);
    (this.out[a] ??= []).push(r);
    return r;
  }

  /** Live rows (the table may hold freed ones). */
  get liveRows(): number { return this.t.count - this.free.length; }

  /**
   * Forget faces: rows with no bond and no feeling, unmet for `days`, are freed. Keeps the table from growing with
   * every stranger someone once chatted to at the pub.
   */
  prune(clock: number, days = 14): number {
    const c = this.t.cols;
    let n = 0;
    for (let r = 0; r < this.t.count; r++) {
      if (c.from[r] < 0 || c.bonds[r] !== 0 || c.familiarity[r] >= 0.04 || Math.abs(c.affection[r]) >= 0.05 || c.fear[r] >= 0.05) continue;
      if (c.lastMet[r] >= 0 && clock - c.lastMet[r] < days * 1440) continue;
      const a = c.from[r], b = c.to[r];
      this.index.delete(a * KEY + b);
      const list = this.out[a];
      const i = list.indexOf(r);
      if (i >= 0) { list[i] = list[list.length - 1]; list.pop(); }
      c.from[r] = -1;
      this.free.push(r);
      n++;
    }
    return n;
  }

  /** Everyone A has feelings about. */
  known(a: ActorId): readonly number[] {
    return this.out[a] ?? [];
  }

  has(a: ActorId, b: ActorId, bond: Bond): boolean {
    const r = this.row(a, b);
    return r >= 0 && (this.t.cols.bonds[r] & bit(bond)) !== 0;
  }

  isFamily(a: ActorId, b: ActorId): boolean {
    const r = this.row(a, b);
    return r >= 0 && (this.t.cols.bonds[r] & FAMILY_MASK) !== 0;
  }
}

export interface RelationView {
  familiarity: number;
  affection: number;
  trust: number;
  respect: number;
  fear: number;
  lastMet: number;
  bonds: Bond[];
}

/** How A feels about B (null if A has never heard of B). */
export function relation(world: { relations: Relations }, a: ActorId, b: ActorId): RelationView | null {
  const rel = world.relations;
  const r = rel.row(a, b);
  if (r < 0) return null;
  const c = rel.t.cols;
  return {
    familiarity: c.familiarity[r], affection: c.affection[r], trust: c.trust[r], respect: c.respect[r], fear: c.fear[r],
    lastMet: c.lastMet[r], bonds: BONDS.filter((b) => (c.bonds[r] & bit(b)) !== 0),
  };
}

/**
 * Record that B is A's `ab` (B is A's child: `bond(rel, a, b, 'child')`) and give B→A the reciprocal
 * (A is B's parent); symmetric bonds mirror. (parent ↔ child, owner ↔ pet; symmetric bonds mirror).
 * Family bonds start known and warm; others only make sure the pair exists.
 */
export function bond(rel: Relations, a: ActorId, b: ActorId, ab: Bond, init?: { familiarity?: number; affection?: number; trust?: number }): void {
  const ba = RECIPROCAL[ab] ?? ab;
  const c = rel.t.cols;
  for (const [x, y, bd] of [[a, b, ab], [b, a, ba]] as const) {
    const r = rel.ensure(x, y);
    c.bonds[r] |= bit(bd);
    if (init?.familiarity !== undefined) c.familiarity[r] = Math.max(c.familiarity[r], init.familiarity);
    if (init?.affection !== undefined) c.affection[r] = init.affection;
    if (init?.trust !== undefined) c.trust[r] = Math.max(c.trust[r], init.trust);
  }
}

/** Remove a bond both ways (a break-up turns partner into ex via `bond` afterwards). */
export function unbond(rel: Relations, a: ActorId, b: ActorId, ab: Bond): void {
  const ba = RECIPROCAL[ab] ?? ab;
  const c = rel.t.cols;
  const r1 = rel.row(a, b), r2 = rel.row(b, a);
  if (r1 >= 0) c.bonds[r1] &= ~bit(ab);
  if (r2 >= 0) c.bonds[r2] &= ~bit(ba);
}

/**
 * Two actors spent time together (a conversation, a walk). Familiarity grows with diminishing returns; liking drifts
 * by `warmth` (-1..1: a pleasant chat, an argument). Both directions.
 */
export function meet(rel: Relations, a: ActorId, b: ActorId, clock: number, minutes: number, warmth = 0.2): void {
  const c = rel.t.cols;
  for (const [x, y] of [[a, b], [b, a]] as const) {
    const r = rel.ensure(x, y);
    const f = c.familiarity[r];
    c.familiarity[r] = f + (1 - f) * Math.min(0.2, 0.004 * minutes);
    c.affection[r] = Math.max(-1, Math.min(1, c.affection[r] + warmth * 0.02 * (1 - Math.abs(c.affection[r]))));
    // Trust follows familiarity and liking slowly.
    c.trust[r] = Math.max(0, Math.min(1, c.trust[r] + 0.003 * (0.3 + c.familiarity[r] * 0.5 + c.affection[r] * 0.3 - c.trust[r])));
    c.lastMet[r] = clock;
  }
}

/** A saw B (no talk): enough to put a face to a name, nothing more. */
export function notice(rel: Relations, a: ActorId, b: ActorId, clock: number): void {
  const r = rel.ensure(a, b);
  const c = rel.t.cols;
  c.familiarity[r] = Math.max(c.familiarity[r], Math.min(0.15, c.familiarity[r] + 0.005));
  c.lastMet[r] = clock;
}

/** Daily drift: acquaintances fade when unmet; family and strong ties barely do. */
export function fadeRelations(rel: Relations, clock: number): void {
  const c = rel.t.cols;
  for (let r = 0; r < rel.t.count; r++) {
    if (c.from[r] < 0 || c.bonds[r] & FAMILY_MASK) continue;
    const since = c.lastMet[r] < 0 ? Infinity : clock - c.lastMet[r];
    if (since > 7 * 1440) c.familiarity[r] *= 0.995;
  }
}
