/**
 * The actor contract (plan R3, D9): what every actor has, person or animal.
 *
 * Every actor is a row in `ActorTable`. Person-only state lives in `PersonTable` (src/sim/people.ts) and animal-only
 * state in `AnimalTable` (src/sim/animals.ts); `actors.cols.row` points into the right one. Systems read only the
 * tables they need, so animals never pay for beliefs, memories or speech.
 */
import { Columns, f32, i32, u8 } from './table';
import { NEED_COUNT } from './species';

/** Index into the actor table. Stable for the life of a world; dead actors keep their row (alive = 0). */
export type ActorId = number;

export const ACTOR_PERSON = 0;
export const ACTOR_ANIMAL = 1;

export const FEMALE = 0;
export const MALE = 1;

/** What an actor is doing. Persons and animals share one list so views and encounters need no special cases. */
export const ACTIVITIES = [
  'idle', 'sleep', 'work', 'school', 'eat', 'shop', 'socialize', 'leisure', 'travel', 'errand',
  'worship', 'exercise', 'walkDog', 'visit', 'wash', 'graze', 'roam', 'doctor',
] as const;
export type Activity = (typeof ACTIVITIES)[number];
export const activityId = (a: Activity): number => ACTIVITIES.indexOf(a);
export const A = Object.fromEntries(ACTIVITIES.map((a, i) => [a, i])) as { [K in Activity]: number };

/** Basic emotions (plan §3.1), each 0..1, decaying toward 0. Same order as `EMOTIONS` in mind/proposal.ts. */
export const EMOTION_COUNT = 6;

export const ACTOR_COLUMNS = {
  kind: u8(),
  species: u8(),
  sex: u8(),
  alive: u8(1),
  /** Game day of birth (negative: before the game started). */
  birth: i32(),
  /** Home place (dwelling, farm, den), -1 if none. */
  home: i32(-1),
  /** Place the actor is at, or -1 while travelling between places without a street place. */
  place: i32(-1),
  /** Where the actor is heading while travelling (-1 when not travelling). */
  dest: i32(-1),
  /** Clock minute of arrival at `dest`. */
  arrive: i32(),
  activity: u8(),
  /** Activity to start on arrival while travelling. */
  planned: u8(),
  /** Clock minute the current activity ends; the actor decides again then (or earlier if a need or intention fires). */
  until: i32(),
  /** Person or animal row in the derived table. */
  row: i32(-1),
  /** Actor this one goes along with (a dog on its walk, a toddler with a parent), -1 if none. */
  with: i32(-1),
  needs: f32(NEED_COUNT, 1),
  health: f32(1, 1),
  /** Valence -1..1, derived from needs and emotions every hour. */
  mood: f32(),
  stress: f32(),
  emotions: f32(EMOTION_COUNT),
  perception: f32(1, 30),
} as const;

export type ActorTable = Columns<typeof ACTOR_COLUMNS>;
export const newActorTable = (capacity?: number): ActorTable => new Columns(ACTOR_COLUMNS, capacity);
