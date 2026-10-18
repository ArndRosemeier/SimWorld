/**
 * The street: the sim worker's walkers (src/game/SimClient.ts) drawn as people (src/render/people), each
 * with their own body and today's clothes (src/street/looks.ts), placed on their track every frame.
 */
import type { EquipmentVisuals } from '@futuremagic/humanoid';
import { appearanceOf, bodyKey, coldOf, outfitOf } from '../street/looks';
import { ACTOR_PERSON } from '../sim/actors';
import { isWetOut } from '../sim/weather';
import type { Figure, Look, PeopleView } from '../render/people/peopleView';
import type { SimClient, Walker } from './SimClient';

/** Game minutes ahead a walker's velocity is measured over. */
const DT = 0.02;

class WalkerFigure implements Figure {
  x = 0; y = 0; z = 0; vx = 0; vz = 0;
  face: number | undefined = undefined;
  private cached: { key: string; look: Look } | null = null;
  private outfit: { key: string; eq: EquipmentVisuals } | null = null;
  constructor(readonly w: Walker, private readonly street: Street) {}
  get id(): number { return this.w.id; }
  look(): Look {
    const s = this.street, clock = s.sim.clock, info = this.w.info;
    const key = bodyKey(info, clock);
    if (this.cached?.key !== key) this.cached = { key, look: { bodyKey: key, app: appearanceOf(s.seed, info, clock), outfitKey: '', outfit: {} } };
    // Dressed in the morning for the day's weather: a new outfit each day.
    const day = `${Math.floor(clock / 1440)}`;
    if (this.outfit?.key !== day) {
      const w = s.sim.view.morning;
      this.outfit = { key: day, eq: outfitOf(s.seed, info, clock, coldOf(w.tempC), isWetOut(w)) };
    }
    return { ...this.cached.look, outfitKey: this.outfit.key, outfit: this.outfit.eq };
  }
}

export class Street {
  private readonly figures = new Map<number, WalkerFigure>();
  private readonly p0: [number, number, number] = [0, 0, 0];
  private readonly p1: [number, number, number] = [0, 0, 0];
  /** People held in place (someone stopped to talk to you): where they stand and which way they face. */
  private readonly pins = new Map<number, { x: number; y: number; z: number; face: number; w: Walker }>();

  constructor(readonly sim: SimClient, readonly people: PeopleView, readonly seed: number) {}

  /** People out of doors around the camera this frame, placed on their tracks. */
  figuresNow(): Figure[] {
    const clock = this.sim.clock, out: Figure[] = [];
    // Real seconds per game minute: velocities in m/s for the animator.
    const secPerMin = 60 / this.sim.rate;
    // Pinned people stay where they stopped, even if the sim moves their track elsewhere meanwhile.
    for (const [id, pin] of this.pins) {
      let f = this.figures.get(id);
      if (!f) this.figures.set(id, (f = new WalkerFigure(pin.w, this)));
      f.x = pin.x; f.y = pin.y; f.z = pin.z; f.vx = 0; f.vz = 0; f.face = pin.face;
      out.push(f);
    }
    for (const w of this.sim.walkers.values()) {
      if (w.info.kind !== ACTOR_PERSON || clock > w.hideAfter || this.pins.has(w.id)) continue;
      let f = this.figures.get(w.id);
      if (!f || f.w !== w) this.figures.set(w.id, (f = new WalkerFigure(w, this)));
      this.sim.where(w, clock, this.p0);
      this.sim.where(w, clock + DT, this.p1);
      f.x = this.p0[0]; f.y = this.p0[1]; f.z = this.p0[2];
      f.vx = (this.p1[0] - this.p0[0]) / (DT * secPerMin);
      f.vz = (this.p1[2] - this.p0[2]) / (DT * secPerMin);
      f.face = undefined;
      out.push(f);
    }
    for (const id of this.figures.keys()) if (!this.sim.walkers.has(id) && !this.pins.has(id)) this.figures.delete(id);
    return out;
  }

  /** Hold `id` where they stand now, turned toward (tx, tz) (they stopped to talk); false if they are not in view. */
  pin(id: number, tx: number, tz: number): boolean {
    const f = this.where(id), w = this.sim.walkers.get(id);
    if (!f || !w) return false;
    this.pins.set(id, { x: f.x, y: f.y, z: f.z, face: Math.atan2(-(tx - f.x), -(tz - f.z)), w });
    return true;
  }

  /** Let them walk on (their track again). */
  unpin(id: number): void {
    this.pins.delete(id);
  }

  /** The people out of doors within `r` metres of (x, z), nearest first. */
  peopleNear(x: number, z: number, r: number): { id: number; d: number; x: number; z: number }[] {
    return this.figuresNow().map((f) => ({ id: f.id, d: Math.hypot(f.x - x, f.z - z), x: f.x, z: f.z })).filter((n) => n.d <= r).sort((a, b) => a.d - b.d);
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
