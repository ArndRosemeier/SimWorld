/**
 * Carrying out intentions: what `go`, `meet`, `tell`, `quitJob` ... actually do to the world. The schedule calls
 * `performIntention` when an intention is the most urgent thing; encounters call `fulfil` when an intention that
 * needs another person meets that person.
 */
import { A, type ActorId } from './actors';
import type { Encounter } from './encounters';
import { dropIntention, type Intention } from './intentions';
import { addFact, beliefAbout, factText, tell, witness } from './knowledge';
import { remember } from './memory';
import type { PlaceId } from './places';
import { go, nearestWith, placeNow } from './schedule';
import { atMinute, minuteOfDay } from './time';
import { firstName, jobOf, nameOf, type World } from './world';


/**
 * Act on an intention now. Returns true if the actor is now busy with it (moving or doing), false if it was
 * finished, dropped or cannot be acted on at the moment (the routine decides instead).
 */
export function performIntention(world: World, id: ActorId, i: Intention): boolean {
  const a = world.actors.cols, pc = world.people.cols, p = a.row[id];
  const now = world.clock;
  const here = placeNow(world, id);
  const stay = (place: PlaceId, activity: number, minutes: number) => {
    go(world, id, place, activity, now + world.travel.minutes(here, place) + minutes);
    return true;
  };
  switch (i.kind) {
    case 'go':
    case 'visit':
    case 'eat': {
      const place = i.place >= 0 ? i.place : i.person >= 0 ? a.home[i.person] : i.kind === 'eat' ? nearestWith(world, here, 'eat', id) : -1;
      if (place < 0 || here === place) { dropIntention(world, id, i); return false; }
      return stay(place, i.kind === 'eat' ? A.eat : i.kind === 'visit' ? A.visit : A.errand, Math.min(90, Math.max(20, i.until - now)));
    }
    case 'holiday': {
      // Off out of town until the day they come back.
      dropIntention(world, id, i);
      if (i.place < 0 || i.until <= now) return false;
      go(world, id, i.place, A.leisure, i.until);
      return true;
    }
    case 'attend': {
      // A wedding, a funeral, a meeting: be there until it ends, doing what it is for.
      const occ = world.agenda.once.find((o) => o.id === i.fact);
      if (!occ || i.place < 0) { dropIntention(world, id, i); return false; }
      dropIntention(world, id, i);
      go(world, id, i.place, occ.activity, i.until);
      return true;
    }
    case 'seeDoctor': {
      const place = i.place >= 0 ? i.place : nearestWith(world, here, 'doctor', id);
      if (place < 0) return false; // closed now; try again later
      if (here === place) { dropIntention(world, id, i); return false; }
      return stay(place, A.doctor, 40);
    }
    case 'buy': {
      const place = i.place >= 0 ? i.place : nearestWith(world, here, 'shop', id);
      if (place < 0) return false;
      if (here === place) {
        pc.money[p] = Math.max(0, pc.money[p] - 20);
        remember(world, id, { who: [], summary: `bought ${i.item || 'something'} at ${world.graph.places[place].name}`, importance: 0.2 });
        dropIntention(world, id, i);
        return false;
      }
      return stay(place, A.shop, 20);
    }
    case 'meet':
    case 'give': {
      const place = i.place >= 0 ? i.place : i.person >= 0 ? a.home[i.person] : -1;
      if (place < 0) { dropIntention(world, id, i); return false; }
      if (here === place && i.item === '\u0000waited') {
        // Waited and they never came.
        if (i.person >= 0) {
          remember(world, id, { who: [i.person], summary: `${firstName(world, i.person)} didn't show up`, importance: 0.5, emotion: 'sadness' });
          const r = world.relations.ensure(id, i.person);
          world.relations.t.cols.affection[r] = Math.max(-1, world.relations.t.cols.affection[r] - 0.08);
          world.relations.t.cols.trust[r] = Math.max(0, world.relations.t.cols.trust[r] - 0.05);
        }
        dropIntention(world, id, i);
        return false;
      }
      i.item = i.kind === 'meet' ? '\u0000waited' : i.item;
      return stay(place, A.socialize, 45);
    }
    case 'tell': {
      if (i.person < 0 || i.fact < 0 || beliefAbout(world, id, i.fact) < 0) { dropIntention(world, id, i); return false; }
      const m = minuteOfDay(now);
      // Seek them out at home in the evening; otherwise wait for a chance meeting.
      if (m >= 1020 && m < 1260 && here !== a.home[i.person]) return stay(a.home[i.person], A.visit, 40);
      return false;
    }
    case 'takeLeave':
      pc.leaveUntil[p] = Math.max(i.until, atMinute(now, 1440));
      dropIntention(world, id, i);
      return false;
    case 'quitJob': {
      const job = jobOf(world, id);
      if (job) {
        job.holder = -1;
        pc.job[p] = -1;
        const f = addFact(world, { topic: 'job', subject: id, place: job.place, magnitude: 0.6, text: '{subject} quit their job at {place}' });
        const hh = world.households[pc.household[p]];
        witness(world, f, [id, ...(hh ? hh.members : [])]);
        remember(world, id, { who: [], summary: `quit my job as ${job.role} at ${world.graph.places[job.place].name}${i.reason ? ' (' + i.reason + ')' : ''}`, importance: 0.85, fact: f });
      }
      dropIntention(world, id, i);
      return false;
    }
    case 'callPolice': {
      const f = addFact(world, { topic: 'crime', subject: id, object: i.person, magnitude: 0.6, text: i.person >= 0 ? '{subject} called the police about {object}' : '{subject} called the police', originator: id });
      // Whoever is on duty at a police station takes the call.
      const duty: ActorId[] = [id];
      for (let o = 0; o < world.actors.count; o++) {
        const pl = a.place[o];
        if (pl >= 0 && world.graph.places[pl].kind === 'police' && a.activity[o] === A.work) duty.push(o);
      }
      witness(world, f, duty);
      remember(world, id, { who: i.person >= 0 ? [i.person] : [], summary: `called the police${i.person >= 0 ? ' about ' + nameOf(world, i.person) : ''}${i.reason ? ': ' + i.reason : ''}`, importance: 0.8, emotion: 'fear', fact: f });
      dropIntention(world, id, i);
      return false;
    }
    case 'avoid':
      return false;
  }
}

/** An intention involving another person met that person (encounters). */
export function fulfil(world: World, id: ActorId, i: Intention, e: Encounter): void {
  const pc = world.people.cols, a = world.actors.cols;
  if (i.kind === 'tell' && i.fact >= 0) {
    const told = tell(world, id, i.person, i.fact);
    if (told >= 0) {
      e.told = told;
      remember(world, id, { who: [i.person], summary: `told ${firstName(world, i.person)} that ${factText(world, world.knowledge.facts[told])}`, importance: 0.4, fact: told });
    }
  } else if (i.kind === 'give') {
    const amount = Number.parseFloat(i.item);
    if (Number.isFinite(amount) && amount > 0 && a.kind[i.person] === 0) {
      const give = Math.min(amount, pc.money[a.row[id]]);
      pc.money[a.row[id]] -= give;
      pc.money[a.row[i.person]] += give;
    }
    remember(world, id, { who: [i.person], summary: `gave ${firstName(world, i.person)} ${i.item || 'something'}`, importance: 0.4 });
    remember(world, i.person, { who: [id], summary: `${firstName(world, id)} gave me ${i.item || 'something'}`, importance: 0.5, emotion: 'joy' });
  } else if (i.kind === 'meet') {
    remember(world, id, { who: [i.person], summary: `met ${firstName(world, i.person)} at ${world.graph.places[e.place].name}`, importance: 0.4 });
    a.until[id] = Math.max(a.until[id], world.clock + 30);
  }
  dropIntention(world, id, i);
}
