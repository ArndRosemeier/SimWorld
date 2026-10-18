/**
 * The street: the sim worker's walkers (src/game/SimClient.ts) drawn as people (src/render/people), each
 * with their own body and today's clothes (src/street/looks.ts), placed on their track every frame.
 */
import type { EquipmentVisuals } from '@futuremagic/humanoid';
import { appearanceOf, bodyKey, coldOf, outfitOf } from '../street/looks';
import { ACTOR_PERSON } from '../sim/actors';
import type { Figure, Look, PeopleView } from '../render/people/peopleView';
import type { SimClient, Walker } from './SimClient';

/** Game minutes ahead a walker's velocity is measured over. */
const DT = 0.02;

class WalkerFigure implements Figure {
  x = 0; y = 0; z = 0; vx = 0; vz = 0;
  private cached: { key: string; look: Look } | null = null;
  private outfit: { key: string; eq: EquipmentVisuals } | null = null;
  constructor(readonly w: Walker, private readonly street: Street) {}
  get id(): number { return this.w.id; }
  look(): Look {
    const s = this.street, clock = s.sim.clock, info = this.w.info;
    const key = bodyKey(info, clock);
    if (this.cached?.key !== key) this.cached = { key, look: { bodyKey: key, app: appearanceOf(s.seed, info, clock), outfitKey: '', outfit: {} } };
    const day = `${Math.floor(clock / 1440)}`;
    if (this.outfit?.key !== day) this.outfit = { key: day, eq: outfitOf(s.seed, info, clock, coldOf(clock, s.startDayOfYear)) };
    return { ...this.cached.look, outfitKey: this.outfit.key, outfit: this.outfit.eq };
  }
}

export class Street {
  private readonly figures = new Map<number, WalkerFigure>();
  private readonly p0: [number, number, number] = [0, 0, 0];
  private readonly p1: [number, number, number] = [0, 0, 0];

  /** `startDayOfYear`: the calendar day game day 0 falls on (the season until the weather says more). */
  constructor(readonly sim: SimClient, readonly people: PeopleView, readonly seed: number, readonly startDayOfYear: number) {}

  /** People out of doors around the camera this frame, placed on their tracks. */
  figuresNow(): Figure[] {
    const clock = this.sim.clock, out: Figure[] = [];
    // Real seconds per game minute: velocities in m/s for the animator.
    const secPerMin = 60 / this.sim.rate;
    for (const w of this.sim.walkers.values()) {
      if (w.info.kind !== ACTOR_PERSON || clock > w.hideAfter) continue;
      let f = this.figures.get(w.id);
      if (!f || f.w !== w) this.figures.set(w.id, (f = new WalkerFigure(w, this)));
      this.sim.where(w, clock, this.p0);
      this.sim.where(w, clock + DT, this.p1);
      f.x = this.p0[0]; f.y = this.p0[1]; f.z = this.p0[2];
      f.vx = (this.p1[0] - this.p0[0]) / (DT * secPerMin);
      f.vz = (this.p1[2] - this.p0[2]) / (DT * secPerMin);
      out.push(f);
    }
    for (const id of this.figures.keys()) if (!this.sim.walkers.has(id)) this.figures.delete(id);
    return out;
  }

  /** Who was picked lately (`next`), so that asking again goes on to someone else. */
  private picked: number[] = [];

  /** The person out of doors nearest (x, z) not picked lately; -1 if nobody is near. Each call picks the next. */
  next(x: number, z: number): number {
    let best = -1, bd = Infinity, any = -1, ad = Infinity;
    for (const f of this.figuresNow()) {
      const d = Math.hypot(f.x - x, f.z - z);
      if (d < ad) { ad = d; any = f.id; }
      if (d < bd && !this.picked.includes(f.id)) { bd = d; best = f.id; }
    }
    if (best < 0) { this.picked = []; best = any; }
    if (best >= 0) this.picked = [...this.picked.slice(-7), best];
    return best;
  }

  /** Where the person `id` is now, or null if they are not out of doors near the camera. */
  where(id: number): Figure | null {
    return this.figuresNow().find((f) => f.id === id) ?? null;
  }

  /** One HUD line about the person followed. */
  describe(id: number): string {
    const w = this.sim.walkers.get(id);
    if (!w) return '';
    const age = Math.floor((this.sim.clock / 1440 - w.info.birth) / 365);
    return `${w.info.name}, ${age}${w.info.role ? `, ${w.info.role}` : ''}: ${w.doing}`;
  }
}
