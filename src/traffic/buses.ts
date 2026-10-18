/**
 * The buses of the timetable (src/sim/transit.ts) on the town's roads: each run comes in from the
 * region on the country road towards its first stop's town (or from the depot in the nearby town),
 * pulls up at every stop in town and waits there until its departure time, then leaves the map
 * towards where it is going. A bus is on the road exactly when the timetable says it is.
 *
 * New in SimWorld. Pure (no three.js).
 */
import { MINUTES_PER_DAY, dayOf } from '../sim/time';
import { runsOnDay, transitOf, type Run } from '../sim/transit';
import type { World } from '../sim/world';
import type { RoadNet } from './roadNet';
import { exitTowardRegion, type Round } from './rounds';

/** Keys of buses start here (household cars are below, through traffic at 1 << 24). */
export const BUS_KEY = 1 << 26;
/** Seconds a bus stands at a stop at least (doors, a passenger or two). */
const STOP_DWELL = 15;
/** Seconds a bus loses per km of route against the limit (corners, junctions, the odd queue). */
const SLOW_S_PER_KM = 20;

interface RunPlan { enter: number; leaveBy: number; halts: { x: number; z: number; k: number; stop: number }[]; lead: number }

/** Plans the timetable's bus runs on a road network (once per run) and says which set off when. */
export class Buses {
  private readonly plans = new Map<number, RunPlan | null>();
  constructor(private readonly world: World, private readonly net: RoadNet) {}

  /** Bus runs that come on to the map in the game minutes (since, clock]. */
  due(since: number, clock: number): Round[] {
    const T = transitOf(this.world), out: Round[] = [];
    for (let day = dayOf(since) - 1; day <= dayOf(clock) + 1; day++) {
      const d0 = day * MINUTES_PER_DAY;
      for (const run of T.runs) {
        if (T.lines[run.line].mode !== 'bus') continue;
        const plan = this.plan(run);
        if (!plan) continue;
        const spawn = d0 + run.times[plan.halts[0].k] - plan.lead;
        if (spawn <= since || spawn > clock || !runsOnDay(this.world, run, d0)) continue;
        out.push({
          car: { key: BUS_KEY + ((day * 4096 + run.id) % (1 << 26)), kind: 'bus', variant: T.lines[run.line].code === 'S' ? 1 : 0 },
          run, spawn, enter: plan.enter, leaveBy: plan.leaveBy,
          stops: plan.halts.map((h) => ({ x: h.x, z: h.z, tag: h.stop, dwell: STOP_DWELL, bay: true, leave: d0 + run.times[h.k] + (h.k === 0 ? 0 : 1) })),
        });
      }
    }
    return out.sort((a, b) => a.spawn - b.spawn);
  }

  private plan(run: Run): RunPlan | null {
    if (this.plans.has(run.id)) return this.plans.get(run.id)!;
    const T = transitOf(this.world), places = this.world.graph.places;
    const halts: RunPlan['halts'] = [];
    run.stops.forEach((sid, k) => {
      const st = T.stops[sid];
      if (st.place >= 0) halts.push({ x: places[st.place].x, z: places[st.place].z, k, stop: sid });
    });
    const first = T.stops[run.stops[0]], last = T.stops[run.stops[run.stops.length - 1]];
    // Into town from where the run starts (the depot is in the nearby town), out towards where it ends.
    const enter = exitTowardRegion(this.world, this.net, first.region), leaveBy = exitTowardRegion(this.world, this.net, last.region);
    let plan: RunPlan | null = null;
    if (halts.length && enter >= 0 && leaveBy >= 0) {
      const ne = this.net.nearestEdge(halts[0].x, halts[0].z, 400);
      const r = ne && this.net.carRoute(enter, this.net.edges[ne.e].a);
      if (r) {
        let s = 0;
        for (const e of r.edges) s += this.net.edges[e].len / this.net.limit(this.net.edges[e]) + (this.net.edges[e].len / 1000) * SLOW_S_PER_KM;
        plan = { enter, leaveBy, halts, lead: Math.ceil(s / 60) + 1 };
      }
    }
    this.plans.set(run.id, plan);
    return plan;
  }
}
