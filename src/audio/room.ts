/**
 * The sound of the room you are in: a murmur that grows with the people talking in it, and each kind of place
 * its own character. A pub has chatter, cutlery and glasses that clink. A café is softer, with more cups and
 * plates. A shop has a quiet hum and a few steps and doors. A home is near silent, with a few small sounds while
 * someone is awake. A church has a hush and a long echo. Pure and seeded like the soundscape: `roomMix` says what
 * plays how loud, and `roomShots` the small sounds of one two-second slot. `src/audio/townAudio.ts` plays them
 * through the room bus, which is not muffled. The street and the weather outside are muffled (`setIndoors`).
 */
import { Rng, clamp, deriveSeed } from '@futuremagic/core';
import type { PlaceKind } from '../sim/places';

/** The character of a room. */
export type RoomKind = 'bar' | 'cafe' | 'shop' | 'home' | 'church' | 'work';

/** Someone in the room: where they are, and whether they are awake (the sleeping make no sound). */
export interface RoomPerson { x: number; y: number; z: number; awake: boolean }

/** The room the listener is in. */
export interface Room { kind: RoomKind; people: readonly RoomPerson[] }

/** A room's loop: its clip, where it sits, how loud, and the distance it is heard fully within. */
export interface RoomLoop { id: string; gain: number; x: number; y: number; z: number; refDist: number }

/** The reverb of a room: its tail (s) and how much of it is heard (0 … 1). */
export interface Reverb { seconds: number; wet: number }

/** A small sound in the room, `delay` seconds into the slot: a clip, or a glass clink when `clink` is set (Hz). */
export interface RoomShot { id: string | null; clink: number; x: number; y: number; z: number; gain: number; pitch: number; delay: number }

/** Seconds per slot of small sounds. */
export const ROOM_SLOT = 2;

/** The character of a kind of place. */
export function roomKindOf(kind: PlaceKind | undefined): RoomKind {
  switch (kind) {
    case 'pub': case 'hotel': return 'bar';
    case 'cafe': case 'restaurant': case 'takeaway': case 'bakery': return 'cafe';
    case 'church': case 'funeral': return 'church';
    case 'house': case 'apartments': case 'farmhouse': case 'carehome': case undefined: return 'home';
    case 'school': case 'kindergarten': case 'townhall': case 'police': case 'fire': case 'library': case 'station':
    case 'office': case 'workshop': case 'factory': case 'doctor': case 'dentist': case 'vet': case 'physio': case 'gym': return 'work';
    default: return 'shop';
  }
}

interface Character {
  /** The murmur of voices at most, and how many talkers make it full. */
  murmur: number; full: number;
  /** Cutlery and crockery under the voices, per talker share. */
  clatter: number;
  /** The room's own hum (fridges, lights, ventilation). */
  hum: number;
  reverb: Reverb;
  /** Per slot and per awake person: a clink, a step, a door. */
  clink: number; step: number; door: number;
}

const CHARACTER: Record<RoomKind, Character> = {
  bar: { murmur: 1, full: 14, clatter: 0.45, hum: 0.12, reverb: { seconds: 0.9, wet: 0.18 }, clink: 0.035, step: 0.01, door: 0.004 },
  cafe: { murmur: 0.7, full: 12, clatter: 0.6, hum: 0.15, reverb: { seconds: 0.7, wet: 0.15 }, clink: 0.03, step: 0.01, door: 0.004 },
  shop: { murmur: 0.35, full: 10, clatter: 0, hum: 0.35, reverb: { seconds: 0.6, wet: 0.14 }, clink: 0, step: 0.04, door: 0.008 },
  work: { murmur: 0.4, full: 16, clatter: 0, hum: 0.3, reverb: { seconds: 0.8, wet: 0.16 }, clink: 0, step: 0.025, door: 0.006 },
  home: { murmur: 0.18, full: 4, clatter: 0, hum: 0.12, reverb: { seconds: 0.35, wet: 0.08 }, clink: 0.006, step: 0.012, door: 0.004 },
  church: { murmur: 0.12, full: 30, clatter: 0, hum: 0.05, reverb: { seconds: 3.2, wet: 0.45 }, clink: 0, step: 0.008, door: 0.002 },
};

/** The reverb of a kind of room. */
export const reverbOf = (kind: RoomKind): Reverb => CHARACTER[kind].reverb;

/** How full the murmur is with `talkers` awake people: nobody talks alone, and a few fill a small room. */
export function murmurLevel(kind: RoomKind, talkers: number): number {
  const c = CHARACTER[kind];
  return c.murmur * clamp(Math.sqrt(Math.max(0, talkers - 1) / (c.full - 1)), 0, 1);
}

/** The middle of the awake people (the murmur comes from there), else the listener. */
function centre(people: readonly RoomPerson[], l: { x: number; y: number; z: number }): { x: number; y: number; z: number } {
  let x = 0, y = 0, z = 0, n = 0;
  for (const p of people) if (p.awake) { x += p.x; y += p.y; z += p.z; n++; }
  return n ? { x: x / n, y: y / n + 1.3, z: z / n } : { x: l.x, y: l.y, z: l.z };
}

/** The loops of the room now: the murmur among the people, the clatter, the hum around the listener. */
export function roomMix(room: Room, l: { x: number; y: number; z: number }): RoomLoop[] {
  const c = CHARACTER[room.kind];
  const talkers = room.people.filter((p) => p.awake).length;
  const m = centre(room.people, l), murmur = murmurLevel(room.kind, talkers);
  // The murmur spreads over the room: a wide source, heard fully within a few metres of the crowd.
  const spread = 4 + Math.sqrt(talkers);
  return [
    { id: 'amb_crowd', gain: murmur, x: m.x, y: m.y, z: m.z, refDist: spread },
    { id: 'terrace_clatter', gain: c.clatter * clamp(talkers / c.full, 0, 1) * (talkers > 0 ? 1 : 0), x: m.x, y: m.y - 0.5, z: m.z, refDist: spread },
    // The hum sits just above the listener: everywhere in the room at once. Quieter at home when all are asleep.
    { id: 'amb_interior', gain: c.hum * (room.kind === 'home' && talkers === 0 ? 0.6 : 1), x: l.x, y: l.y + 1, z: l.z, refDist: 3 },
  ];
}

/** The small sounds of slot `slot` (ROOM_SLOT seconds): glasses, steps, doors near the people awake. */
export function roomShots(room: Room, seed: number, slot: number): RoomShot[] {
  const c = CHARACTER[room.kind], out: RoomShot[] = [];
  room.people.forEach((p, i) => {
    if (!p.awake) return;
    const r = new Rng(deriveSeed(seed, 'room', slot, i));
    const at = (): Pick<RoomShot, 'x' | 'y' | 'z'> => ({ x: p.x + r.range(-0.4, 0.4), y: p.y + 1, z: p.z + r.range(-0.4, 0.4) });
    if (r.chance(c.clink)) {
      // Two glasses (or a cup on its saucer): a bright partial, a second one a little after.
      const f = room.kind === 'bar' ? r.range(2600, 3600) : r.range(1800, 2800), t = r.float() * ROOM_SLOT, a = at();
      out.push({ id: null, clink: f, ...a, gain: 0.35, pitch: 1, delay: t });
      if (r.chance(0.6)) out.push({ id: null, clink: f * r.range(1.03, 1.12), ...a, gain: 0.25, pitch: 1, delay: t + r.range(0.04, 0.12) });
    }
    if (r.chance(c.step)) {
      const t = r.float() * ROOM_SLOT, a = at();
      for (let k = 0; k < r.int(2, 4); k++) out.push({ id: 'step_concrete', clink: 0, ...a, y: p.y, gain: 0.35, pitch: r.range(0.95, 1.08), delay: t + k * r.range(0.45, 0.6) });
    }
    if (r.chance(c.door)) out.push({ id: r.chance(0.5) ? 'door_open' : 'door_close', clink: 0, ...at(), gain: 0.4, pitch: r.range(0.95, 1.05), delay: r.float() * ROOM_SLOT });
  });
  return out;
}

/** The ids the room may ask for (the manifest must have each one). */
export const ROOM_IDS = ['amb_crowd', 'terrace_clatter', 'amb_interior', 'step_concrete', 'door_open', 'door_close'] as const;
