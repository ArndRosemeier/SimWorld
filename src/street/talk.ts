/**
 * Talk you can hear (plan §4, speech bubbles): the conversations the sim starts (its encounters, voiced by the
 * chatter engine, src/talk/chatter.ts), and the ones still going: two people who got talking at a table, at the
 * bar, at home over dinner or at the counter carry on with another topic every minute or two until one of them
 * leaves or their talk has run its course (longer in a pub or a cafe, shorter at a shop counter). In the rooms
 * the player is in, people also strike up talk with whoever is there (family over dinner, the regulars at the
 * bar): the sim's encounters are the conversations that matter to it (news, getting to know someone), these are
 * the rest of the evening's talk, voiced but changing nothing. Only the talk the player can hear is voiced
 * (`hears`: near the camera out of doors, in the building the player is in).
 *
 * The sim worker runs `afterTick` after each live minute and sends `take()` with the street update; the game shows
 * the lines as speech bubbles. Pure (sim worker, headless tests). New in SimWorld.
 */
import { clamp } from '@futuremagic/core';
import { A, type ActorId } from '../sim/actors';
import { KINDS } from '../sim/placeKinds';
import { PLACE_KINDS, type PlaceId } from '../sim/places';
import { presentAt, type Encounter } from '../sim/encounters';
import { tickRng, type World } from '../sim/world';
import { overhear } from '../talk/chatter';
import { TalkMemory } from '../talk/grammar';
import { familiarity } from '../talk/refer';

/** What two people said at one go (game minute `time`), for the speech bubbles. */
export interface Said {
  a: ActorId;
  b: ActorId;
  place: PlaceId;
  time: number;
  lines: { speaker: ActorId; text: string }[];
}

/** Talk struck up in a room the player is in, per awake person there and minute, on top of the sim's encounters. */
const STRIKE_UP = 0.06;
/** Most talk sent at once (a burst after a pause: only the latest). */
const MOST = 60;

interface Going { a: ActorId; b: ActorId; place: PlaceId; until: number; next: number }

export class TalkFeed {
  private readonly memory = new TalkMemory();
  private readonly going = new Map<number, Going>();
  private out: Said[] = [];

  /**
   * After a live minute: voice that minute's encounters that `hears` lets through, and carry on the talks still
   * going (a new topic now and then while both are still there and awake).
   */
  afterTick(world: World, hears: (a: ActorId, b: ActorId, place: PlaceId) => boolean, rooms: Iterable<PlaceId> = []): void {
    const clock = world.clock, cols = world.actors.cols;
    for (const e of world.encounters) {
      if (!hears(e.a, e.b, e.place)) continue;
      this.talkOf(world, e);
    }
    // In the rooms the player is in: whoever is there and awake strikes up talk now and then, with someone they know if they can.
    for (const place of rooms) {
      const here = presentAt(world, place).filter((id) => cols.dest[id] < 0 && cols.activity[id] !== A.sleep && cols.kind[id] === 0);
      if (here.length < 2) continue;
      const rng = tickRng(world, 'strike up', place);
      const expected = here.length * STRIKE_UP;
      const n = Math.floor(expected) + (rng.float() < expected % 1 ? 1 : 0);
      for (let k = 0; k < n; k++) {
        const a = here[rng.int(0, here.length - 1)];
        let b = -1, best = -Infinity;
        for (let t = 0; t < 3; t++) {
          const c = here[rng.int(0, here.length - 1)];
          if (c === a || this.going.has(pairKey(a, c))) continue;
          const sc = familiarity(world, a, c) + rng.float() * 0.3;
          if (sc > best) { best = sc; b = c; }
        }
        if (b >= 0 && hears(a, b, place)) this.talkOf(world, { place, a, b, kind: 'talk', told: -1, toldBack: -1 });
      }
    }
    for (const [k, g] of this.going) {
      const still = clock < g.until && cols.place[g.a] === g.place && cols.place[g.b] === g.place && cols.dest[g.a] < 0 && cols.dest[g.b] < 0
        && cols.activity[g.a] !== A.sleep && cols.activity[g.b] !== A.sleep && hears(g.a, g.b, g.place);
      if (!still) { this.going.delete(k); continue; }
      if (clock < g.next) continue;
      g.next = clock + 1 + tickRng(world, 'talking', g.a, g.b).int(0, 2);
      const x = overhear(world, { place: g.place, a: g.a, b: g.b, kind: 'talk', told: -1, toldBack: -1 }, this.memory, true);
      if (x) this.keepSaid(g.a, g.b, g.place, clock, x.lines);
    }
  }

  /** Voice encounter `e` and keep the two talking for a while (as long as the place invites: a pub's evening, a word at a counter). */
  private talkOf(world: World, e: Encounter): void {
    const clock = world.clock;
    const x = overhear(world, e, this.memory);
    if (x) this.keepSaid(x.a, x.b, x.place, clock, x.lines);
    if (e.kind !== 'talk') return;
    const rng = tickRng(world, 'talking', e.a, e.b);
    const chat = KINDS[PLACE_KINDS[world.kindOf[e.place]]].chat;
    const minutes = clamp(chat * 400, 2, 35) * (0.6 + 0.8 * rng.float());
    this.going.set(pairKey(e.a, e.b), { a: e.a, b: e.b, place: e.place, until: clock + minutes, next: clock + 1 + rng.int(0, 2) });
  }

  /** The talk since the last take. */
  take(): Said[] {
    const out = this.out;
    this.out = [];
    return out.length > MOST ? out.slice(-MOST) : out;
  }

  /** Forget the talks going (after a skip or a load: everyone is somewhere else). */
  clear(): void {
    this.going.clear();
    this.out = [];
  }

  private keepSaid(a: ActorId, b: ActorId, place: PlaceId, time: number, lines: { speaker: ActorId; text: string }[]): void {
    this.out.push({ a, b, place, time, lines: lines.map((l) => ({ speaker: l.speaker, text: l.text })) });
  }
}

const pairKey = (a: ActorId, b: ActorId): number => (a < b ? a * 65536 + b : b * 65536 + a);
