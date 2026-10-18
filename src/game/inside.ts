/**
 * Being inside a building (Arnd: "if the person is in a house, bring me into the house"): its interior drawn
 * (src/render/interiorView.ts), the people in it at their beds, seats and desks (src/street/inside.ts, asked of
 * the sim worker every few seconds while you are in), and the rooms lit like its windows: the lamps on when it is
 * dark (or gloomy) and someone in is awake. The player's controls call `enter` with the building their person
 * is in (`PlayerStatus.building`) and `leave` when they step out; `update` runs each frame.
 */
import { buildingRef } from '../plan/placeGraph';
import { A } from '../sim/actors';
import { spotsFor } from '../street/inside';
import { seatFront } from '../street/seats';
import type { Inside, InteriorView } from '../render/interiorView';
import { LIGHT } from '../render/tsl/common';
import { WINDOW_LIGHT } from '../render/windowLight';
import type { SimClient, Walker } from './SimClient';
import type { Held, Street } from './street';

/** Real milliseconds between asking the sim who is in. */
const ASK_EVERY = 3000;

export class GoingInside {
  private building = -1;
  private asked = -Infinity;
  private asking = false;
  private awake = 0;

  /** `outside`: shows or hides a building's own outer shell (a public building's, which stands in front of its walk-in rooms). */
  constructor(private readonly sim: SimClient, private readonly street: Street, private readonly view: InteriorView, private readonly outside: (building: number, shown: boolean) => void = () => {}) {}

  /** The building shown now (its interior, walls and spots), null out of doors. */
  get inside(): Inside | null { return this.view.current; }

  /** Go into building `building` (a `Place.building` code); null when it has no interior to walk in (a farm, the town hall, the sports ground). */
  async enter(building: number): Promise<Inside | null> {
    const ref = buildingRef(building);
    if (!ref || 'farm' in ref) return null;
    if (this.building !== building) this.outside(this.building, true);
    this.building = building;
    this.asked = -Infinity;
    const r = await this.view.enter(building).catch(() => null);
    if (r && this.building === building) {
      this.outside(building, false);
      await this.refresh();
    }
    return r;
  }

  /** Back out of doors. */
  leave(): void {
    this.outside(this.building, true);
    this.building = -1;
    this.view.leave();
    this.street.setIndoors([]);
  }

  /** Each frame (`t` real ms): who is in now, and the room light. */
  update(t: number): void {
    if (this.building < 0) return;
    if (t - this.asked > ASK_EVERY && !this.asking) { this.asked = t; void this.refresh(); }
    this.view.setRoomLight(this.awake > 0 ? Math.max(LIGHT.night.value, WINDOW_LIGHT.gloom.value) : 0);
  }

  private async refresh(): Promise<void> {
    const building = this.building;
    this.asking = true;
    try {
      const people = await this.sim.inside(building);
      const inside = this.view.current;
      if (building !== this.building || !inside) return;
      const spots = inside.indoors.spots, units = Math.max(1, new Set(spots.filter((s) => s.unit >= 0).map((s) => s.unit)).size);
      // The sim numbers a building's households 0, 1, …; the interior has as many homes (more only if the sim moved people in since).
      const ps = people.map((p) => ({ ...p, unit: p.unit < 0 ? -1 : p.unit % units }));
      const given = spotsFor(ps, spots);
      const held: Held[] = [];
      ps.forEach((p, i) => {
        const s = spots[given[i]];
        if (!s) return;
        const w: Walker = { id: p.id, info: p.info, keys: new Float64Array(0), rests: new Float64Array(0), hideAfter: Infinity, activity: p.activity, doing: p.doing };
        // The spot faces (sin yaw, cos yaw); a figure's face 0 looks to -z. In bed: on the mattress, head to foot.
        // On a seat: standing in front of it (seatFront), from where they sit down.
        const face = s.yaw + Math.PI;
        if (s.use === 'sleep') held.push({ x: s.x, y: s.y, z: s.z, face, w, rest: { kind: 'lie', seat: s.seat } });
        else if (s.seat > 0) {
          const [x, z] = seatFront(s);
          held.push({ x, y: s.y, z, face, w, rest: { kind: 'sit', seat: s.seat } });
        }
        else held.push({ x: s.x, y: s.y, z: s.z, face, w });
      });
      this.awake = ps.filter((p) => p.activity !== A.sleep).length;
      this.street.setIndoors(held);
    } finally {
      this.asking = false;
    }
  }
}
