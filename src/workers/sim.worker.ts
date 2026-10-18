/**
 * The sim worker: the society (L0, src/sim) and the street layer (L1, src/street) off the main thread. It
 * plans the town from the settings (deterministic, like the town workers), makes the world and runs it to
 * the clock the main thread asks for; for the camera's surroundings it says who is out of doors and the
 * track each of them walks. Started by the worker pool only; talked to through src/game/SimClient.ts.
 */
import { planTown, type Town } from '../plan/town';
import { placeGraphOf } from '../plan/placeGraph';
import { regionOf } from '../plan/region';
import { createWorld } from '../sim/synth';
import { chronicle, digest, historyDays } from '../sim/chronicle';
import { loadWorld, saveWorld } from '../sim/save';
import { dayOf, MINUTES_PER_DAY } from '../sim/time';
import { tick, nameOf, jobOf, householdOf, type World } from '../sim/world';
import { becomePlayer, doingOf, playerActions, playerGo, playerStatus, setAutopilot } from '../sim/player';
import { cardsOf } from '../sim/profile';
import { ACTOR_PERSON } from '../sim/actors';
import { viewOf, viewTransfers } from '../sim/view';
import { StreetMap } from '../street/streetMap';
import { windowSlots } from '../street/windows';
import { sample, trackOf, signature, type Track } from '../street/tracks';
import type { ActorInfo, FromSim, HeightGrid, PlayerOp, PlayerReply, ToSim, TrackMsg } from './simProtocol';
import { serve } from './serve';
import { chatOp } from '../chat/ops';
import { TrafficFeed, trafficTransfers } from '../traffic/feed';

let world: World | null = null;
let map: StreetMap | null = null;
/** The town's traffic, driven by the world's car trips and rounds, and the town it drives in. */
let traffic: TrafficFeed | null = null;
let roads: Town | null = null;
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
/**
 * Years of town history lived before play (the chronicle, about 1.5 s for 1,500 people): enough past for the
 * inhabitant cards to have stories (widowed in June, new in town, not speaking to a brother).
 */
const HISTORY_YEARS = 1;

function simJob(m: ToSim): FromSim {
  const t0 = performance.now();
  const took = () => Math.round(performance.now() - t0);
  if (m.type === 'init') {
    const town = planTown(m.settings);
    const graph = placeGraphOf(town);
    // A save that no longer fits (another save version, another town) is set aside: play starts afresh.
    let resumed: World | null = null;
    if (m.save) try { resumed = loadWorld(graph, m.save); } catch (e) { console.warn('save not loaded', e); }
    world = resumed ?? createWorld(graph, m.settings.seed, { region: regionOf(town), start: m.start, startDay: m.startDay, history: HISTORY_YEARS });
    map = new StreetMap(town, world.graph);
    forget();
    // With a history the world's day 0 lies that many weeks back (the same weekday): play starts after it.
    if (!resumed) runTo(Math.max(m.clock + historyDays(HISTORY_YEARS) * MINUTES_PER_DAY, world.clock));
    traffic = new TrafficFeed((roads = town), world);
    sentAt = world.clock;
    return { type: 'ready', resumed: resumed !== null, clock: world.clock, people: world.people.count, ground: heightGrid(map, town.terrain.profile.radius * 1.4, 4), view: viewOf(world, true), windows: windowSlots(town, graph), ms: took() };
  }
  if (!world || !map || !traffic) throw new Error('sim worker: not initialised');
  if (m.type === 'save') return { type: 'saved', clock: world.clock, bytes: saveWorld(world), ms: took() };
  if (m.type === 'skip') {
    skip(world, m.days);
    forget();
    // The days skipped: the cars stand where the world now says, the traffic starts afresh.
    traffic = new TrafficFeed(roads!, world);
    sentAt = world.clock;
    return { type: 'skipped', clock: world.clock, view: viewOf(world, true), ms: took() };
  }
  if (m.type === 'player') return playerJob(world, m.op, took);
  if (m.type === 'chat') return { type: 'chat', res: chatOp(world, m.req) };
  runTo(m.clock);
  traffic.run(m.clock);
  const view = world.clock !== sentAt ? viewOf(world, dayOf(world.clock) !== dayOf(sentAt)) : null;
  sentAt = world.clock;
  // Walks keep clear of the cars standing at the kerb as well as of what the plan put on the street.
  map.fp.also = traffic.standing;
  return { type: 'street', clock: world.clock, view, ...street(world, map, m.clock, m.x, m.z, m.r), player: playerOut(world, map, m.clock), traffic: traffic.message(), ms: took() };
}

/** A player request (src/sim/player.ts), answered with their status after it. */
function playerJob(w: World, op: PlayerOp, took: () => number): PlayerReply {
  const out: PlayerReply = { type: 'player', cards: [], actions: [], digest: [], status: null, ms: 0 };
  if (op.op === 'cards') out.cards = cardsOf(w);
  else if (op.op === 'become') becomePlayer(w, op.id, op.autopilot);
  else if (op.op === 'autopilot') setAutopilot(w, op.on);
  else if (op.op === 'go') playerGo(w, op.place, op.activity);
  else if (op.op === 'digest' && w.player) out.digest = digest(w, w.player.id, op.since);
  // The menu is wanted after a move too (what is there to do where they are going).
  if (op.op === 'actions' || op.op === 'go' || op.op === 'become') out.actions = playerActions(w);
  // Their track changes at once: drop it, so the next street update makes and sends the new one.
  if (op.op !== 'cards' && op.op !== 'digest' && w.player) tracks.delete(w.player.id);
  out.status = playerOut(w, map!, w.clock);
  out.ms = took();
  return out;
}

/** The player's status, placed on the street when they are out of doors (wherever the camera is). */
function playerOut(w: World, map: StreetMap, clock: number): ReturnType<typeof playerStatus> {
  const s = playerStatus(w);
  if (!s || !s.alive) return s;
  let t = tracks.get(s.id);
  if (!t || t.sig !== signature(w, s.id) || clock >= t.validUntil) {
    const fresh = trackOf(w, map, s.id, clock);
    if (fresh) tracks.set(s.id, (t = fresh)); else { tracks.delete(s.id); t = undefined; }
  }
  if (t && clock <= t.hideAfter) {
    const p: [number, number, number] = [0, 0, 0];
    sample(t.keys, clock, p);
    s.x = p[0]; s.z = p[2]; s.outdoors = true;
  }
  return s;
}

/** Tick the world up to the whole minute of `clock`. */
function runTo(clock: number): void {
  const w = world!;
  const target = Math.floor(clock);
  if (target > w.clock) tick(w, target - w.clock);
}

/**
 * Skip `days` whole days to the same time of day: the chronicle runs to midnight `days` days on (the rest of
 * today counts as the first), and the live tick runs the morning up to the hour it was.
 */
function skip(w: World, days: number): void {
  const n = Math.max(1, Math.floor(days));
  const at = w.clock % MINUTES_PER_DAY;
  chronicle(w, n);
  runTo(w.clock + at);
}

/** Drop the street state: after a load or a skip nobody is where the main thread last saw them. */
function forget(): void {
  tracks.clear();
  shown.clear();
  known.clear();
  map?.seatBook.forget();
}

/** The street around (x, z) as a change to what the main thread has. */
function street(w: World, map: StreetMap, clock: number, x: number, z: number, r: number): { tracks: TrackMsg[]; gone: number[]; info: ActorInfo[] } {
  const out: TrackMsg[] = [], info: ActorInfo[] = [], gone: number[] = [];
  // Seats booked for strolls long over are free for good.
  map.seatBook.forget(clock - 60);
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
    out.push({ id, keys: Float64Array.from(t!.keys), hideAfter: t!.hideAfter, activity: t!.activity, rests: Float64Array.from(t!.rests), doing: doingOf(w, id) });
    if (!known.has(id)) { known.add(id); info.push(infoOf(w, id)); }
  }
  return { tracks: out, gone, info };
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
  if (r.type === 'street') return [...r.tracks.flatMap((t) => [t.keys.buffer, t.rests.buffer]), ...(r.view ? viewTransfers(r.view) : []), ...trafficTransfers(r.traffic)];
  if (r.type === 'saved') return [r.bytes.buffer];
  if (r.type === 'skipped') return viewTransfers(r.view);
  return [];
});
