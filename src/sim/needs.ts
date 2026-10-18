/**
 * Needs and mood (plan §1.3, R3). Every actor decays the needs its species has; the current activity restores some.
 * Mood is recomputed hourly from needs and emotions; emotions fade toward calm (slower for neurotic people).
 */
import { clamp } from '@futuremagic/core';
import { A, ACTIVITIES, EMOTION_COUNT } from './actors';
import { T_NEURO } from './people';
import { NEED_COUNT, N_FOOD, N_FUN, N_HYGIENE, N_REST, N_SOCIAL, SPECIES } from './species';
import type { World } from './world';

/** Need gains per game hour while doing an activity, indexed by activity id then need. */
const GAIN: number[][] = ACTIVITIES.map(() => [0, 0, 0, 0, 0]);
const g = (activity: number, need: number, perHour: number) => { GAIN[activity][need] = perHour; };
g(A.sleep, N_REST, 0.17);
g(A.eat, N_FOOD, 2.5); g(A.eat, N_SOCIAL, 0.05);
g(A.socialize, N_SOCIAL, 0.3); g(A.socialize, N_FUN, 0.2);
g(A.leisure, N_FUN, 0.35); g(A.leisure, N_REST, 0.03);
g(A.exercise, N_FUN, 0.3); g(A.exercise, N_REST, -0.06); g(A.exercise, N_HYGIENE, -0.15);
g(A.walkDog, N_FUN, 0.25);
g(A.visit, N_SOCIAL, 0.35); g(A.visit, N_FUN, 0.1);
g(A.worship, N_SOCIAL, 0.2); g(A.worship, N_FUN, 0.05);
g(A.wash, N_HYGIENE, 4);
g(A.idle, N_REST, 0.04); g(A.idle, N_FUN, 0.08);
g(A.work, N_SOCIAL, 0.04);
g(A.school, N_SOCIAL, 0.1); g(A.school, N_FUN, 0.04);
g(A.graze, N_FOOD, 0.35);
g(A.roam, N_FOOD, 0.15); g(A.roam, N_FUN, 0.2);
g(A.shop, N_FUN, 0.02);

/** Flat tables for the hot loop: decay per species × need, gain per activity × need (per hour). */
const DECAY = new Float32Array(SPECIES.length * NEED_COUNT);
SPECIES.forEach((sp, i) => sp.decay.forEach((d, n) => { DECAY[i * NEED_COUNT + n] = d; }));
const GAINS = new Float32Array(ACTIVITIES.length * NEED_COUNT);
GAIN.forEach((row, i) => row.forEach((v, n) => { GAINS[i * NEED_COUNT + n] = v; }));

/** Advance needs by `minutes` for every living actor. */
export function updateNeeds(world: World, minutes: number): void {
  const a = world.actors.cols;
  const needs = a.needs, alive = a.alive, species = a.species, activity = a.activity;
  const h = minutes / 60;
  // Imported constants as locals: module bindings are getters under some loaders (tsx), too slow for this loop.
  const W = NEED_COUNT, REST = N_REST, SLEEP = A.sleep, count = world.actors.count;
  for (let id = 0; id < count; id++) {
    if (!alive[id]) continue;
    const sp = species[id] * W;
    const act = activity[id];
    const g = act * W;
    const asleep = act === SLEEP;
    const base = id * W;
    for (let n = 0; n < W; n++) {
      const d = DECAY[sp + n];
      if (d === 0) continue;
      // Asleep: rest recovers, the rest of the body slows down.
      const loss = n === REST ? (asleep ? 0 : d) : asleep ? d * 0.35 : d;
      const v = needs[base + n] + (GAINS[g + n] - loss) * h;
      needs[base + n] = v < 0 ? 0 : v > 1 ? 1 : v;
    }
  }
}

/** Hourly: emotions fade, mood and stress follow needs and emotions. */
export function updateMoods(world: World): void {
  const a = world.actors.cols;
  const pc = world.people.cols;
  for (let id = 0; id < world.actors.count; id++) {
    if (!a.alive[id]) continue;
    const sp = SPECIES[a.species[id]];
    const neuro = a.kind[id] === 0 ? pc.traits[a.row[id] * 5 + T_NEURO] : 0.5;
    const fade = 0.78 + 0.15 * neuro;
    const e = id * EMOTION_COUNT;
    for (let k = 0; k < EMOTION_COUNT; k++) a.emotions[e + k] *= fade;
    let sum = 0, cnt = 0, min = 1;
    for (let n = 0; n < NEED_COUNT; n++) {
      if (sp.decay[n] === 0) continue;
      const v = a.needs[id * NEED_COUNT + n];
      sum += v; cnt++; if (v < min) min = v;
    }
    const needs = cnt ? sum / cnt : 1;
    // joy, sadness, anger, fear, surprise, disgust
    const em = a.emotions[e] - a.emotions[e + 1] - 0.6 * a.emotions[e + 2] - 0.6 * a.emotions[e + 3] - 0.3 * a.emotions[e + 5];
    a.mood[id] = clamp((needs - 0.55) * 1.6 + em - (neuro - 0.5) * 0.2, -1, 1);
    a.stress[id] = clamp(a.stress[id] * 0.8 + 0.2 * clamp((0.45 - min) * 2.5 + a.emotions[e + 3], 0, 1), 0, 1);
  }
}

/** Food or rest is critical: the schedule lets this interrupt the routine. */
export const urgentNeed = (world: World, id: number): number => {
  const a = world.actors.cols.needs, b = id * NEED_COUNT;
  if (a[b + N_FOOD] < 0.15) return N_FOOD;
  if (a[b + N_REST] < 0.08) return N_REST;
  if (a[b + N_HYGIENE] < 0.1) return N_HYGIENE;
  return -1;
};
export { N_SOCIAL, N_FUN };
