/**
 * Messages between the main thread (src/game/SimClient.ts) and the sim worker (src/workers/sim.worker.ts).
 * The worker owns the society (L0) and the street layer (L1); the main thread asks it, a few times a second,
 * to run up to a clock and to say who is out of doors near the camera, and where they walk (tracks). With
 * each new game minute it also sends the sim's view snapshot (`SimView`), which every view reads.
 */
import type { CivilDate } from '../sim/calendar';
import type { DigestItem } from '../sim/chronicle';
import type { PlayerAction, PlayerStatus } from '../sim/player';
import type { InhabitantCard } from '../sim/profile';
import type { SimView } from '../sim/view';
import type { TownSettings } from '../world/settings';

export type ToSim =
  /**
   * Plan the town, make the world (play starting on the real date `start`, game day `startDay`: its weekday) and
   * run it to `clock` (game minutes since day 0, 00:00). With `save` (bytes of `saveWorld`), the world is that save
   * instead, on the same town planned again, and play resumes at its clock (`start`, `startDay`, `clock` are unused).
   */
  | { type: 'init'; settings: TownSettings; start: CivilDate; startDay: number; clock: number; save?: Uint8Array | null }
  /**
   * Run the world up to `clock` (whole minutes are ticked; the fraction only places the tracks), then report
   * the street around (x, z): tracks that are new or changed within `r` metres, and who went out of it.
   */
  | { type: 'update'; clock: number; x: number; z: number; r: number }
  /** The world as save bytes (`saveWorld`), at its clock now. */
  | { type: 'save' }
  /**
   * Skip `days` whole days (the time skip, `chronicle`), to the same time of day; the street starts afresh, so
   * the main thread drops everyone it has.
   */
  | { type: 'skip'; days: number }
  /** Who the player is and what they do (src/sim/player.ts); answered with `player`. */
  | { type: 'player'; op: PlayerOp };

/**
 * The player's requests (plan R2, R5): every inhabitant's card for the picker; become someone (autopilot on or
 * off); hand them to their routine or take over; what they could do now; send them somewhere; what they know
 * of the time since `since` (the digest after a skip).
 */
export type PlayerOp =
  | { op: 'cards' }
  | { op: 'become'; id: number; autopilot: boolean }
  | { op: 'autopilot'; on: boolean }
  | { op: 'actions' }
  | { op: 'go'; place: number; activity: number }
  | { op: 'digest'; since: number };

/** The answer to a `PlayerOp` (empty lists where the op asks for nothing), with the player's status after it. */
export interface PlayerReply {
  type: 'player';
  cards: InhabitantCard[];
  actions: PlayerAction[];
  digest: DigestItem[];
  status: PlayerStatus | null;
  ms: number;
}

/** What the view needs to know about an actor once (looks, names). */
export interface ActorInfo {
  id: number;
  /** ACTOR_PERSON or ACTOR_ANIMAL. */
  kind: number;
  species: number;
  sex: number;
  /** Game day of birth. */
  birth: number;
  name: string;
  /** Job role ('baker', 'teacher', …), '' when none. */
  role: string;
  /** Household id, -1 for none (its look runs in the family). */
  household: number;
}

/** A street track (src/street/tracks.ts) as sent: keys as (t, x, y, z) quadruples. */
export interface TrackMsg {
  id: number;
  keys: Float64Array;
  hideAfter: number;
  activity: number;
  /** What they are up to, in words ("walking to Elm Street Bakery to shop"). */
  doing: string;
}

/** Ground heights for the camera: `n` × `n` samples `step` metres apart, from (x0, z0). */
export interface HeightGrid {
  x0: number;
  z0: number;
  step: number;
  n: number;
  h: Float32Array;
}

export type FromSim =
  /** `resumed`: the world is the save sent with init (false when there was none or it no longer fits). */
  | { type: 'ready'; resumed: boolean; clock: number; people: number; ground: HeightGrid; view: SimView; ms: number }
  /** `view`: the snapshot, when the game minute has moved on since the last one sent (else null). */
  | { type: 'street'; clock: number; view: SimView | null; tracks: TrackMsg[]; gone: number[]; info: ActorInfo[]; player: PlayerStatus | null; ms: number }
  | PlayerReply
  | { type: 'saved'; clock: number; bytes: Uint8Array; ms: number }
  | { type: 'skipped'; clock: number; view: SimView; ms: number }
  | { type: 'error'; message: string };
