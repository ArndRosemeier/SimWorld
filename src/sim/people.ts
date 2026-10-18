/**
 * What a person adds to the actor contract (plan R3, §3.1): identity, personality, household, job or school,
 * habits, money. Beliefs (knowledge.ts), memories (memory.ts) and relationships (relations.ts) are their own tables.
 */
import type { ActorId } from './actors';
import type { PlaceId, DayMask } from './places';
import { DerivedTable, f32, i32 } from './table';

/** Big Five, each 0..1. */
export const TRAITS = ['openness', 'conscientiousness', 'extraversion', 'agreeableness', 'neuroticism'] as const;
export const T_OPEN = 0, T_CONSC = 1, T_EXTRA = 2, T_AGREE = 3, T_NEURO = 4;
/** Values, each 0..1 (plan §3.1). */
export const VALUES = ['honesty', 'loyalty', 'ambition', 'faith'] as const;
export const V_HONEST = 0, V_LOYAL = 1, V_AMBITION = 2, V_FAITH = 3;

/** Favourite places a person returns to. Habits make the same people meet again, which is how a town knows itself. */
export const HABITS = ['cafe', 'pub', 'park', 'sports', 'church', 'library', 'shop'] as const;
export type Habit = (typeof HABITS)[number];
export const HABIT_COUNT = HABITS.length;

export const PERSON_COLUMNS = {
  actor: i32(-1),
  traits: f32(5, 0.5),
  values: f32(4, 0.5),
  household: i32(-1),
  /** Index into `world.jobs`, -1 when not employed. */
  job: i32(-1),
  /** School or kindergarten place, -1 if none. */
  school: i32(-1),
  money: f32(),
  /** Favourite place per habit (-1 = none), row-major HABIT_COUNT wide. */
  habits: i32(-1, HABIT_COUNT),
  /** Chronotype: usual wake and sleep minutes. */
  wake: i32(420),
  sleep: i32(1380),
  /** Clock minute until which the person skips work (leave, illness). */
  leaveUntil: i32(),
} as const;

export class PersonTable extends DerivedTable<typeof PERSON_COLUMNS> {
  readonly first: string[] = [];
  readonly last: string[] = [];

  constructor() { super(PERSON_COLUMNS, 256); }

  addPerson(actor: ActorId, first: string, last: string): number {
    const r = this.t.add();
    this.t.cols.actor[r] = actor;
    this.first[r] = first;
    this.last[r] = last;
    return r;
  }
}

export interface Household {
  id: number;
  home: PlaceId;
  surname: string;
  members: ActorId[];
  animals: ActorId[];
  car: boolean;
}

/** One real position at one real place (plan §6: "every job is a real position at a real place"). */
export interface Job {
  id: number;
  place: PlaceId;
  role: string;
  days: DayMask;
  start: number;
  end: number;
  minAge: number;
  holder: ActorId; // -1 = vacant
}
