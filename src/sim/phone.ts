/**
 * Phones (town-realism Q6, track E): calls and messages between close ties. Family living elsewhere and good friends
 * keep in touch, mostly in the evening, and news travels down the line. It travels more slowly than face to face,
 * because a call carries fewer stories and only to people one is close to. Strangers and acquaintances never phone.
 *
 * Hourly in the live tick. The chronicle's contact pools already let people talk to those they know, so the coarse
 * model needs nothing extra.
 */
import type { Rng } from '@futuremagic/core';
import { A, ACTOR_PERSON, type ActorId } from './actors';
import { exchange } from './knowledge';
import { T_EXTRA } from './people';
import { bondBit, FAMILY_MASK, meet } from './relations';
import { minuteOfDay } from './time';
import { ageOf, tickRng, traitOf, type World } from './world';

/** Share of the day's calls made in each hour (evenings most, nobody after 22:00 or before 8:00). */
const BY_HOUR = [0, 0, 0, 0, 0, 0, 0, 0, 0.03, 0.04, 0.05, 0.05, 0.08, 0.06, 0.05, 0.05, 0.06, 0.08, 0.1, 0.12, 0.13, 0.1, 0.05, 0];
/** How readily a story passes in a call, against about 1 for a chat at the café: a call is brief and on purpose. */
const PHONE_HUB = 0.45;
const FRIEND = bondBit('friend');

/** Is this tie close enough to phone: family, a friend, or someone they are fond of and know well? */
function close(world: World, r: number): boolean {
  const c = world.relations.t.cols;
  return (c.bonds[r] & (FAMILY_MASK | FRIEND)) !== 0 || (c.affection[r] > 0.5 && c.familiarity[r] > 0.6);
}

/** Calls made in the hour now starting. Returns the number of calls (for tests and the debug overlay). */
export function phoneCalls(world: World): number {
  const share = BY_HOUR[Math.floor(minuteOfDay(world.clock) / 60)];
  if (share === 0) return 0;
  const a = world.actors.cols;
  const rng = tickRng(world, 'phone');
  let calls = 0;
  for (let x = 0; x < world.actors.count; x++) {
    if (!a.alive[x] || a.kind[x] !== ACTOR_PERSON || a.activity[x] === A.sleep || a.activity[x] === A.work || a.activity[x] === A.school) continue;
    const age = ageOf(world, x);
    if (age < 11) continue;
    // About 0.4 to 1.6 calls and messages a day by temperament, more for teenagers and young adults.
    const perDay = (0.4 + 1.2 * traitOf(world, x, T_EXTRA)) * (age < 26 ? 1.5 : 1);
    if (rng.float() >= perDay * share) continue;
    const y = pickTie(world, x, rng);
    if (y < 0) continue;
    call(world, x, y, rng);
    calls++;
  }
  return calls;
}

/** Someone close to `x`, elsewhere and awake, the fonder the likelier (best of three). -1 if nobody. */
function pickTie(world: World, x: ActorId, rng: Rng): ActorId {
  const c = world.relations.t.cols, a = world.actors.cols;
  let best = -1, bs = -Infinity;
  for (let t = 0; t < 3; t++) {
    const r = world.relations.anyKnown(x, rng);
    if (r < 0) return -1;
    const y = c.to[r];
    if (!close(world, r) || !a.alive[y] || a.kind[y] !== ACTOR_PERSON || a.activity[y] === A.sleep) continue;
    if (a.place[y] === a.place[x] || a.home[y] === a.home[x]) continue; // they would just talk
    const s = c.affection[r] + rng.float() * 0.3;
    if (s > bs) { bs = s; best = y; }
  }
  return best;
}

/** One call: they catch up (the tie is kept warm) and each may pass on a story. */
export function call(world: World, x: ActorId, y: ActorId, rng: Rng): void {
  meet(world.relations, x, y, world.clock, rng.int(3, 12), 0.3);
  exchange(world, x, y, PHONE_HUB, rng);
  exchange(world, y, x, PHONE_HUB, rng);
}
