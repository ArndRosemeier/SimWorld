/**
 * The sim worker: the society (L0, src/sim) and the street layer (L1, src/street) off the main thread. It
 * plans the town from the settings (deterministic, like the town workers), makes the world and runs it to
 * the clock the main thread asks for; for the camera's surroundings it says who is out of doors and the
 * track each of them walks. Started by the worker pool only; talked to through src/game/SimClient.ts.
 */
import { planTown } from '../plan/town';
import { placeGraphOf } from '../plan/placeGraph';
import { regionOf } from '../plan/region';
import { createWorld } from '../sim/synth';
import { tick, nameOf, jobOf, householdOf, type World } from '../sim/world';
import { ACTIVITIES, ACTOR_PERSON } from '../sim/actors';
import { viewOf, viewTransfers } from '../sim/view';
import { StreetMap } from '../street/streetMap';
import { windowSlots } from '../street/windows';
import { sample, trackOf, signature, type Track } from '../street/tracks';
import type { ActorInfo, FromSim, HeightGrid, ToSim, TrackMsg } from './simProtocol';
import { serve } from './serve';

let world: World | null = null;
let map: StreetMap | null = null;
/** The track each actor has now, while they are out of doors (made lazily, kept until L0 changes or it runs out). */
const tracks = new Map<number, Track>();
/** Actors the main thread has a track of (id → the signature it was made from, its validity). */
const shown = new Map<number, { sig: number; validUntil: number }>();
/** Actors the main thread has the info of. */
const known = new Set<number>();
/** The clock of the last view snapshot sent. */
let sentAt = -1;
/** Extra distance before someone shown counts as gone (no flicker at the edge). */
const KEEP = 40;

function simJob(m: ToSim): FromSim {
  const t0 = performance.now();
  const took = () => Math.round(performance.now() - t0);
  if (m.type === 'init') {
    const town = planTown(m.settings);
    const graph = placeGraphOf(town);
    world = createWorld(graph, m.settings.seed, { region: regionOf(town), start: m.start, startDay: m.startDay });
    map = new StreetMap(town, world.graph);
    runTo(Math.max(m.clock, world.clock));
    sentAt = world.clock;
    return { type: 'ready', clock: world.clock, people: world.people.count, ground: heightGrid(map, town.terrain.profile.radius * 1.4, 4), view: viewOf(world), windows: windowSlots(town, graph), ms: took() };
  }
  if (!world || !map) throw new Error('sim worker: not initialised');
  runTo(m.clock);
  const view = world.clock !== sentAt ? viewOf(world) : null;
  sentAt = world.clock;
  return { type: 'street', clock: world.clock, view, ...street(world, map, m.clock, m.x, m.z, m.r), ms: took() };
}

/** Tick the world up to the whole minute of `clock`. */
function runTo(clock: number): void {
  const w = world!;
  const target = Math.floor(clock);
  if (target > w.clock) tick(w, target - w.clock);
}

/** The street around (x, z) as a change to what the main thread has. */
function street(w: World, map: StreetMap, clock: number, x: number, z: number, r: number): { tracks: TrackMsg[]; gone: number[]; info: ActorInfo[] } {
  const out: TrackMsg[] = [], info: ActorInfo[] = [], gone: number[] = [];
  const p: [number, number, number] = [0, 0, 0];
  for (let id = 0; id < w.actors.count; id++) {
    let t = tracks.get(id);
    const sig = signature(w, id);
    if (!t || t.sig !== sig || clock >= t.validUntil) {
      const fresh = trackOf(w, map, id, clock);
      if (fresh) tracks.set(id, (t = fresh));
      else { tracks.delete(id); t = undefined; }
    }
    const had = shown.get(id);
    const hidden = !t || clock > t.hideAfter;
    let near = false;
    if (!hidden) {
      sample(t!.keys, clock, p);
      const d = Math.hypot(p[0] - x, p[2] - z);
      near = d < r || (had !== undefined && d < r + KEEP);
    }
    if (!near) {
      if (had) { shown.delete(id); gone.push(id); }
      continue;
    }
    if (had && had.sig === t!.sig && had.validUntil === t!.validUntil) continue;
    shown.set(id, { sig: t!.sig, validUntil: t!.validUntil });
    out.push({ id, keys: Float64Array.from(t!.keys), hideAfter: t!.hideAfter, activity: t!.activity, doing: doingOf(w, id) });
    if (!known.has(id)) { known.add(id); info.push(infoOf(w, id)); }
  }
  return { tracks: out, gone, info };
}

/** What someone out of doors is up to, in words. */
function doingOf(w: World, id: number): string {
  const a = w.actors.cols, places = w.graph.places;
  const act = ACTIVITIES[a.dest[id] >= 0 ? a.planned[id] : a.activity[id]];
  if (a.dest[id] >= 0) return `walking to ${places[a.dest[id]].name} (${act})`;
  return `${act} at ${places[a.place[id]].name}`;
}

function infoOf(w: World, id: number): ActorInfo {
  const a = w.actors.cols;
  const person = a.kind[id] === ACTOR_PERSON;
  return {
    id, kind: a.kind[id], species: a.species[id], sex: a.sex[id], birth: a.birth[id], name: nameOf(w, id),
    role: person ? jobOf(w, id)?.role ?? '' : '', household: householdOf(w, id)?.id ?? -1,
  };
}

/** Ground heights (sidewalk level) on a square grid around the town, for the camera. */
function heightGrid(map: StreetMap, half: number, step: number): HeightGrid {
  const n = Math.ceil((half * 2) / step) + 1, x0 = -half, z0 = -half;
  const h = new Float32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) h[j * n + i] = map.groundY(x0 + i * step, z0 + j * step);
  return { x0, z0, step, n, h };
}

serve<ToSim, FromSim>(simJob, (r) => {
  if (r.type === 'ready') return [r.ground.h.buffer, ...viewTransfers(r.view)];
  if (r.type === 'street') return [...r.tracks.map((t) => t.keys.buffer), ...(r.view ? viewTransfers(r.view) : [])];
  return [];
});
