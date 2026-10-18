/**
 * Being inside a building (Arnd: "if the person is in a house, bring me into the house"): its interior drawn
 * (src/render/interiorView.ts), the people in it at their beds, seats and desks (src/street/inside.ts, asked of
 * the sim worker every few seconds while you are in), and the rooms lit like its windows: the lamps on when it is
 * dark (or gloomy) and someone in is awake. The player's controls call `enter` with the building their person
 * is in (`PlayerStatus.building`) and `leave` when they step out; `update` runs each frame.
 *
 * Its doors (src/interior/doors.ts) swing open for whoever walks into them (the player, people coming in from the
 * street) or when the player presses E, and shut behind them; the shut ones are solid (`onDoors`). A street door
 * is locked from outside when the sim says so (a shop out of hours, a home that is not the player's).
 */
import { buildingRef } from '../plan/placeGraph';
import { A } from '../sim/actors';
import { PLACE_KINDS } from '../sim/places';
import { roomKindOf, type Room, type RoomPerson } from '../audio/room';
import { spotsFor } from '../street/inside';
import { seatFront } from '../street/seats';
import type { Inside, InteriorView } from '../render/interiorView';
import { LIGHT } from '../render/tsl/common';
import { WINDOW_LIGHT } from '../render/windowLight';
import type { SimClient, Walker } from './SimClient';
import type { Held, Street } from './street';
import type { Box, IndoorSpot } from '../interior/indoors';
import { leafBox, shutDoors, stepDoors, useDoor, type DoorLeaf, type DoorState, type Mover } from '../interior/doors';

/** Real milliseconds between asking the sim who is in. */
const ASK_EVERY = 3000;

export class GoingInside {
  private building = -1;
  private asked = -Infinity;
  private asking = false;
  private awake = 0;
  /** The doors of the building shown: where each leaf is. */
  private doors: DoorState[] = [];
  /** Whether its street doors open from outside (asked of the sim with who is in; open until it says). */
  private access = { open: true, resident: true };
  private lastT = -1;
  /** Real ms until which the hint says the door is locked. */
  private lockedUntil = 0;
  private solidsTo: ((building: number, shut: Box[]) => void) | null = null;
  /** The spot each person in was given (bed, seat, desk), by actor id. */
  private readonly spots = new Map<number, IndoorSpot>();
  /** Who is in (at their spots) for the room's sound: where, which place, awake or not. */
  private present: (RoomPerson & { place: number })[] = [];

  /** `outside`: shows or hides a building's own outer shell (a public building's, which stands in front of its walk-in rooms). */
  constructor(private readonly sim: SimClient, private readonly street: Street, private readonly view: InteriorView, private readonly outside: (building: number, shown: boolean) => void = () => {}) {
    addEventListener('keydown', (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (e.code !== 'KeyE' || e.repeat || el?.closest?.('input, textarea, [contenteditable]')) return;
      this.useNearest();
    });
  }

  /** `to` hears the shut door leaves of the building shown as boxes, whenever they change (the physics world's). */
  onDoors(to: (building: number, shut: Box[]) => void): void {
    this.solidsTo = to;
  }

  /** The shut door leaves of the building shown, as boxes to bump into. */
  shutBoxes(): Box[] {
    const ins = this.view.current;
    return ins ? ins.indoors.leaves.filter((_, i) => this.doors[i]?.a === 0).map(leafBox) : [];
  }

  /** One HUD line about the door in reach ('' when none). */
  hint(): string {
    if (performance.now() < this.lockedUntil) return 'Locked';
    const ins = this.view.current, me = this.me();
    if (!ins || !me) return '';
    let best = -1, bd = 1.6;
    ins.indoors.leaves.forEach((l, i) => {
      const d = Math.hypot(me.x - (l.x + l.dx * l.w / 2), me.z - (l.z + l.dz * l.w / 2));
      if (Math.abs(me.y - l.y) < 1.2 && d < bd) { bd = d; best = i; }
    });
    return best < 0 ? '' : this.doors[best].to ? 'E: shut the door' : 'E: open the door';
  }

  /** The building shown now (its interior, walls and spots), null out of doors. */
  get inside(): Inside | null { return this.view.current; }

  /** Go into building `building` (a `Place.building` code); null when it has no interior to walk in (the sports ground). */
  async enter(building: number): Promise<Inside | null> {
    if (!buildingRef(building)) return null;
    if (this.building !== building) this.outside(this.building, true);
    this.building = building;
    this.asked = -Infinity;
    this.spots.clear();
    const r = await this.view.enter(building).catch(() => null);
    if (r && this.building === building) {
      this.outside(building, false);
      this.doors = shutDoors(r.indoors.leaves);
      this.access = { open: true, resident: true };
      await this.refresh();
    }
    return r;
  }

  /** The spot `id` was given in the building shown (their bed, seat or desk), null if they are not in it. */
  spotOf(id: number): IndoorSpot | null {
    return this.spots.get(id) ?? null;
  }

  /** Back out of doors. */
  leave(): void {
    this.outside(this.building, true);
    this.building = -1;
    this.view.leave();
    this.street.setIndoors([]);
    this.present = [];
  }

  /**
   * The room around the player (or the camera at x, y, z) for the sound (src/audio/room.ts), null out of doors: the people on this floor
   * within earshot, and the character of the place the player is in (else of the place most of them are in).
   */
  room(x: number, y: number, z: number): Room | null {
    if (this.building < 0 || !this.view.current) return null;
    // Where the player's body stands (feet, like the spots), else the camera.
    const me = this.me();
    if (me) ({ x, y, z } = me);
    const people = this.present.filter((p) => Math.abs(p.y - y) < 2.6 && Math.hypot(p.x - x, p.z - z) < 16);
    const kinds = this.sim.town?.kind;
    const placeKind = (place: number) => (kinds && place >= 0 && place < kinds.length ? PLACE_KINDS[kinds[place]] : undefined);
    let place = this.sim.player?.place ?? -1;
    if (placeKind(place) === undefined || (people.length && !people.some((p) => p.place === place))) {
      const count = new Map<number, number>();
      for (const p of people) count.set(p.place, (count.get(p.place) ?? 0) + 1);
      place = [...count].sort((a, b) => b[1] - a[1])[0]?.[0] ?? place;
    }
    return { kind: roomKindOf(placeKind(place)), people };
  }

  /** Each frame (`t` real ms): who is in now, the room light, the doors. */
  update(t: number): void {
    const dt = this.lastT < 0 ? 0 : Math.min(0.1, (t - this.lastT) / 1000);
    this.lastT = t;
    if (this.building < 0) return;
    if (t - this.asked > ASK_EVERY && !this.asking) { this.asked = t; void this.refresh(); }
    this.view.setRoomLight(this.awake > 0 ? Math.max(LIGHT.night.value, WINDOW_LIGHT.gloom.value) : 0);
    const ins = this.view.current;
    if (!ins || ins.building !== this.building || this.doors.length !== ins.indoors.leaves.length) return;
    // Whoever is out of doors near the camera (the player's own body among them) can walk into a door; the others
    // are going where the sim sends them, so they have the keys.
    const me = this.sim.player?.id;
    // (Not the people at their beds, seats and desks in here: they stay put.)
    const movers: Mover[] = this.street.figuresNow().filter((f) => f.id === me || !this.spots.has(f.id)).map((f) => ({ x: f.x, y: f.y, z: f.z, keys: f.id !== me }));
    if (stepDoors(ins.indoors.leaves, this.doors, movers, dt, this.locked)) this.solidsTo?.(this.building, this.shutBoxes());
    this.doors.forEach((d, i) => this.view.swing(i, d.a));
  }

  /** Is street door leaf `l` locked from outside now? */
  private readonly locked = (l: DoorLeaf): boolean => (l.homes ? !this.access.resident : !this.access.open);

  /** The player's body (their figure where the street draws it), null when they are not walking it. */
  private me(): Mover | null {
    const id = this.sim.player?.id;
    return id === undefined ? null : this.street.where(id);
  }

  /** E: the player opens or shuts the door in reach. */
  private useNearest(): void {
    const ins = this.view.current, me = this.me();
    if (!ins || !me || this.doors.length !== ins.indoors.leaves.length) return;
    const k = useDoor(ins.indoors.leaves, this.doors, me, this.locked);
    if (k === -2) this.lockedUntil = performance.now() + 2000;
    else if (k >= 0) this.solidsTo?.(this.building, this.shutBoxes());
  }

  private async refresh(): Promise<void> {
    const building = this.building;
    this.asking = true;
    try {
      const { people, access } = await this.sim.inside(building);
      const inside = this.view.current;
      if (building !== this.building || !inside) return;
      this.access = access;
      const spots = inside.indoors.spots, units = Math.max(1, new Set(spots.filter((s) => s.unit >= 0).map((s) => s.unit)).size);
      // The sim numbers a building's households 0, 1, …; the interior has as many homes (more only if the sim moved people in since).
      const ps = people.map((p) => ({ ...p, unit: p.unit < 0 ? -1 : p.unit % units }));
      const given = spotsFor(ps, spots);
      const held: Held[] = [];
      this.spots.clear();
      ps.forEach((p, i) => {
        const s = spots[given[i]];
        if (!s) return;
        this.spots.set(p.id, s);
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
      this.present = ps.flatMap((p) => { const s = this.spots.get(p.id); return s ? [{ x: s.x, y: s.y, z: s.z, awake: p.activity !== A.sleep, place: p.place }] : []; });
      this.street.setIndoors(held);
    } finally {
      this.asking = false;
    }
  }
}
