/**
 * Species data for every actor type (plan R3, D9). People are a species too, so one needs model covers everyone;
 * animals use a subset of the needs (a cow has no `fun` worth simulating) and never get belief storage.
 */

/** The needs every actor may have, 1 = satisfied, 0 = desperate. Indices into `actors.cols.needs` (row-major). */
export const NEEDS = ['food', 'rest', 'social', 'hygiene', 'fun'] as const;
export type Need = (typeof NEEDS)[number];
export const NEED_COUNT = NEEDS.length;
export const N_FOOD = 0, N_REST = 1, N_SOCIAL = 2, N_HYGIENE = 3, N_FUN = 4;

export type AnimalClass = 'pet' | 'livestock' | 'wildlife';

export interface SpeciesInfo {
  name: string;
  /** 'person' for humans. */
  class: 'person' | AnimalClass;
  /** Typical lifespan in years (life events use it later). */
  lifespan: number;
  /** Loss per game hour while awake, per need (0 = the species does not have this need). */
  decay: readonly [number, number, number, number, number];
  /** How far the actor notices others (metres), for the street layer and encounters. */
  perception: number;
  /** Awake window as [wake, sleep] minutes from midnight; nocturnal species have wake > sleep. */
  awake: readonly [number, number];
}

export const SPECIES: readonly SpeciesInfo[] = [
  { name: 'human', class: 'person', lifespan: 81, decay: [0.07, 0.055, 0.03, 0.035, 0.04], perception: 30, awake: [420, 1380] },
  { name: 'dog', class: 'pet', lifespan: 12, decay: [0.06, 0.05, 0.05, 0, 0.08], perception: 40, awake: [390, 1380] },
  { name: 'cat', class: 'pet', lifespan: 15, decay: [0.05, 0.03, 0.01, 0, 0.04], perception: 25, awake: [0, 1440] },
  { name: 'horse', class: 'livestock', lifespan: 28, decay: [0.05, 0.04, 0.02, 0, 0.02], perception: 50, awake: [300, 1290] },
  { name: 'cow', class: 'livestock', lifespan: 20, decay: [0.06, 0.04, 0.01, 0, 0], perception: 30, awake: [300, 1260] },
  { name: 'sheep', class: 'livestock', lifespan: 12, decay: [0.06, 0.04, 0.02, 0, 0], perception: 30, awake: [330, 1230] },
  { name: 'chicken', class: 'livestock', lifespan: 8, decay: [0.07, 0.05, 0.01, 0, 0], perception: 15, awake: [360, 1200] },
  { name: 'fox', class: 'wildlife', lifespan: 4, decay: [0.05, 0.04, 0, 0, 0], perception: 60, awake: [1140, 420] },
  { name: 'deer', class: 'wildlife', lifespan: 12, decay: [0.05, 0.04, 0.01, 0, 0], perception: 80, awake: [1080, 600] },
  { name: 'hedgehog', class: 'wildlife', lifespan: 4, decay: [0.05, 0.04, 0, 0, 0], perception: 10, awake: [1200, 360] },
  { name: 'owl', class: 'wildlife', lifespan: 10, decay: [0.05, 0.04, 0, 0, 0], perception: 100, awake: [1140, 360] },
];

export const HUMAN = 0;
export const speciesId = (name: string): number => {
  const i = SPECIES.findIndex((s) => s.name === name);
  if (i < 0) throw new Error(`unknown species ${name}`);
  return i;
};

/** Is minute-of-day `m` inside the species' awake window? */
export function awakeAt(s: SpeciesInfo, m: number): boolean {
  const [w, z] = s.awake;
  return w <= z ? m >= w && m < z : m >= w || m < z;
}
