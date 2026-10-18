/**
 * Takeover against the sim (Arnd 21:01: "the school girl was in the fields instead of school, and also the
 * commuter"): for everyone in a town at many times, where the game would put the body (src/street/takeover.ts)
 * against what the sim says they are doing, sorted by case. `old` is the rule before (the destination's spot for
 * anyone in a vehicle, the town gate for anyone out of town, outdoors for someone who has arrived), to show what
 * was wrong. For test/slow/takeover.slow.test.ts.
 */
import { planTown } from '../../src/plan/town';
import { FARM, SITE, placeGraphOf } from '../../src/plan/placeGraph';
import { landmarkBody } from '../../src/interior/landmark';
import { regionOf } from '../../src/plan/region';
import { createWorld } from '../../src/sim/synth';
import { isPerson, jobOf, tick, tripOf, type World } from '../../src/sim/world';
import { KINDS } from '../../src/sim/placeKinds';
import { placeNow } from '../../src/sim/schedule';
import type { Takeover } from '../../src/sim/player';
import { StreetMap, OUTDOOR } from '../../src/street/streetMap';
import { sample, trackOf, type Track } from '../../src/street/tracks';
import { takeoverOf } from '../../src/street/takeover';

/** `atDoor`: taken over at the door of a building with no inside to walk in yet (the town hall, farm buildings). */
export interface CaseCount { n: number; oldWrong: number; newWrong: number; atDoor: number; examples: string[] }
export type Audit = Record<string, CaseCount>;

/** How far from every place in town a spot counts as out in the fields (m). */
const FIELDS = 150;

/** What the sim says `id` is doing: the case, and the place they are at (or -1 on the way). */
function caseOf(w: World, id: number): { name: string; at: number } {
  const a = w.actors.cols, places = w.graph.places, isAway = (p: number) => p >= 0 && places[p].kind === 'away';
  if (isAway(a.dest[id]) || isAway(a.place[id])) return { name: 'out of town (city work, next town school)', at: -1 };
  if (a.dest[id] >= 0 && w.clock < a.arrive[id]) {
    const mode = tripOf(w, id)?.mode ?? 'foot';
    return { name: mode === 'foot' ? 'walking somewhere' : mode === 'car' ? 'in a car' : mode === 'bike' ? 'cycling' : 'on a bus or train', at: -1 };
  }
  const at = a.dest[id] >= 0 ? a.dest[id] : a.place[id];
  if (at < 0) return { name: 'nowhere', at };
  const k = places[at].kind, job = jobOf(w, id);
  if (at === a.home[id]) return { name: 'at home', at };
  if (k === 'farm' || k === 'field' || k === 'woods') return { name: 'farm, fields, woods', at };
  if (OUTDOOR.has(k)) return { name: 'park, square, sports, street', at };
  if (k === 'school' || k === 'kindergarten') return { name: 'school in town', at };
  if (k === 'church') return { name: 'church', at };
  if (k === 'pub' || k === 'cafe' || k === 'restaurant') return { name: 'pub, cafe, restaurant', at };
  if (job && job.place === at) return { name: 'at work in town', at };
  if (KINDS[k].category === 'home') return { name: 'visiting a home', at };
  return { name: 'shop or errand', at };
}

/** The rule before this fix (the player's status and src/game/playing.ts `takeWheel`), for the "before" counts. */
function oldTakeover(w: World, map: StreetMap, id: number, t: Track | null): Takeover {
  const a = w.actors.cols, places = w.graph.places;
  if (t && w.clock <= t.hideAfter) { const p = sample(t.keys, w.clock); return { kind: 'street', x: p[0], z: p[2], yaw: 0 }; }
  const place = a.dest[id] >= 0 ? a.dest[id] : placeNow(w, id), pl = places[Math.max(0, place)];
  if (pl.building >= 0 && a.dest[id] < 0 && !OUTDOOR.has(pl.kind)) return { kind: 'inside', building: pl.building, x: pl.x, z: pl.z, yaw: 0 };
  const here = a.place[id];
  if (a.dest[id] < 0 && here >= 0 && !OUTDOOR.has(places[here].kind) && places[here].kind !== 'away') { const [x, z] = map.doorStep(here); return { kind: 'street', x, z, yaw: 0 }; }
  return { kind: 'street', x: pl.x, z: pl.z, yaw: 0 };
}

/** What is wrong with putting `id` at `take`, as the sim has them ('' when it is right). */
function wrong(w: World, take: Takeover, c: { name: string; at: number }, track: Track | null, inTown: (x: number, z: number) => boolean, walkIn: (take: Takeover & { kind: 'inside' }) => boolean | 'door'): string {
  const places = w.graph.places;
  const mustWait = c.name.startsWith('out of town') || c.name === 'in a car' || c.name === 'cycling' || c.name === 'on a bus or train';
  if (mustWait) return take.kind === 'wait' ? '' : `put ${take.kind === 'inside' ? 'in a building' : inTown(take.x, take.z) ? 'at where they are going, before they get there' : 'out in the fields'}`;
  if (take.kind === 'wait') return 'not offered, though they are in town';
  // Drawn on the street (walking, or about an outdoor place): right where their figure is.
  if (track && w.clock <= track.hideAfter) {
    const p = sample(track.keys, w.clock);
    return take.kind !== 'street' || Math.hypot(p[0] - take.x, p[2] - take.z) > 2 ? 'not where their figure is' : '';
  }
  if (c.name === 'walking somewhere') return 'walking, but not on the street';
  if (!inTown(take.x, take.z)) return 'out in the fields';
  const pl = places[c.at];
  if (pl.building >= 0 && !OUTDOOR.has(pl.kind)) {
    if (take.kind !== 'inside') return 'outdoors, not in the building they are in';
    if (take.building !== pl.building) return 'in another building';
    // The game must find the building at its door to stand them up in it (else it drops its inside at once).
    const f = walkIn(take);
    return f === 'door' ? 'door' : f ? '' : 'in a building the game cannot find at its door';
  }
  return take.kind === 'street' && Math.hypot(take.x - pl.x, take.z - pl.z) < 80 ? '' : 'not at the place they are at';
}

/** For each town `seeds` (size `size`), at each `times` (clock minutes from day 0, a Monday, rising): everyone. */
export function auditTakeovers(seeds: number[], times: number[], size = 0): Audit {
  const audit: Audit = {};
  for (const seed of seeds) {
    const town = planTown({ seed, size }), w = createWorld(placeGraphOf(town), seed, { region: regionOf(town) });
    const map = new StreetMap(town, w.graph);
    // In town: within FIELDS of some place in it (out-of-town places stand at the town gate: not those).
    const spots = w.graph.places.filter((p) => p.kind !== 'away');
    const found = new Map<number, boolean | 'door'>();
    const walkIn = (k: Takeover & { kind: 'inside' }): boolean | 'door' => {
      let f = found.get(k.building);
      if (f === undefined) {
        const lm = k.building >= SITE && k.building < FARM ? town.macro.landmarks.find((l) => l.id === k.building - SITE) : undefined;
        f = k.building >= FARM || (lm && !landmarkBody(lm, town.terrain)) ? 'door' : map.solidsNear(k.x, k.z, 30).buildings.some((b) => b.code === k.building && b.doors.length > 0);
        found.set(k.building, f);
      }
      return f;
    };
    const inTown = (x: number, z: number) => spots.some((p) => Math.abs(p.x - x) < FIELDS && Math.abs(p.z - z) < FIELDS && Math.hypot(p.x - x, p.z - z) < FIELDS);
    for (const at of times) {
      tick(w, at - w.clock);
      for (let id = 0; id < w.actors.count; id++) {
        if (!isPerson(w, id)) continue;
        const c = caseOf(w, id), t = trackOf(w, map, id, w.clock);
        const row = (audit[c.name] ??= { n: 0, oldWrong: 0, newWrong: 0, atDoor: 0, examples: [] });
        row.n++;
        const was = wrong(w, oldTakeover(w, map, id, t), c, t, inTown, walkIn);
        if (was && was !== 'door') row.oldWrong++;
        const bad = wrong(w, takeoverOf(w, map, id, w.clock, t), c, t, inTown, walkIn);
        if (bad === 'door') row.atDoor++;
        else if (bad) { row.newWrong++; if (row.examples.length < 5) row.examples.push(`seed ${seed} clock ${w.clock} #${id}: ${bad}`); }
      }
    }
  }
  return audit;
}
