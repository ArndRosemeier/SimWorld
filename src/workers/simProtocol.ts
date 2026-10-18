/**
 * Messages between the main thread (src/game/SimClient.ts) and the sim worker (src/workers/sim.worker.ts).
 * The worker owns the society (L0) and the street layer (L1); the main thread asks it, a few times a second,
 * to run up to a clock and to say who is out of doors near the camera, and where they walk (tracks). With
 * each new game minute it also sends the sim's view snapshot (`SimView`), which every view reads, and with every
 * update the town's traffic (run here, beside the world it is driven by).
 */
import type { CivilDate } from '../sim/calendar';
import type { SimView } from '../sim/view';
import type { TownSettings } from '../world/settings';
import type { TrafficMsg } from '../traffic/feed';

export type ToSim =
  /**
   * Plan the town, make the world (play starting on the real date `start`, game day `startDay`: its weekday) and
   * run it to `clock` (game minutes since day 0, 00:00).
   */
  | { type: 'init'; settings: TownSettings; start: CivilDate; startDay: number; clock: number }
  /**
   * Run the world up to `clock` (whole minutes are ticked; the fraction only places the tracks), then report
   * the street around (x, z): tracks that are new or changed within `r` metres, and who went out of it.
   */
  | { type: 'update'; clock: number; x: number; z: number; r: number };

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
  | { type: 'ready'; clock: number; people: number; ground: HeightGrid; view: SimView; ms: number }
  /**
   * `view`: the snapshot, when the game minute has moved on since the last one sent (else null). `traffic`: the
   * vehicles on the roads and in the kerbside bays (src/traffic/feed.ts), the town's traffic running in this worker.
   */
  | { type: 'street'; clock: number; view: SimView | null; tracks: TrackMsg[]; gone: number[]; info: ActorInfo[]; traffic: TrafficMsg; ms: number }
  | { type: 'error'; message: string };
