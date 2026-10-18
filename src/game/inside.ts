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

  constructor(private readonly sim: SimClient, private readonly street: Street, private readonly view: InteriorView) {}

  /** The building shown now (its interior, walls and spots), null out of doors. */
  get inside(): Inside | null { return this.view.current; }

  /** Go into building `building` (a `Place.building` code); null when it has no interior to walk in (a landmark, a farm). */
  async enter(building: number): Promise<Inside | null> {
    const ref = buildingRef(building);
    if (!ref || !('cell' in ref)) return null;
    this.building = building;
    this.asked = -Infinity;
    const r = await this.view.enter(ref);
    if (r && this.building === building) await this.refresh();
    return r;
  }

  /** Back out of doors. */
  leave(): void {
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
        // In bed they lie down once the people can (src/render/people): until then the sleepers are not drawn.
        if (!s || s.use === 'sleep') return;
        const w: Walker = { id: p.id, info: p.info, keys: new Float64Array(0), hideAfter: Infinity, activity: p.activity, doing: p.doing };
        // A seat's person stands just in front of it until they can sit.
        const ahead = s.use === 'sit' ? 0.45 : 0;
        held.push({ x: s.x + Math.sin(s.yaw) * ahead, y: s.y, z: s.z + Math.cos(s.yaw) * ahead, face: s.yaw + Math.PI, w });
      });
      this.awake = ps.filter((p) => p.activity !== A.sleep).length;
      this.street.setIndoors(held);
    } finally {
      this.asking = false;
    }
  }
}
