/**
 * The game's side of being an inhabitant (D4, plan R2 and R5): the picker over the town from above once it is up,
 * then playing as whoever was picked. Picking someone tells the sim (`become`), flies the camera down to them and
 * keeps it with them (src/game/camera.ts `play`), and opens the play panel (src/app/playPanel.ts) whose controls go
 * to the sim worker through `SimClient.ask`. The time skip runs `sim.skip` and then shows that person's digest.
 *
 * With autopilot off you steer them yourself (plan R5): a body in the physics world (src/game/avatar.ts) walks
 * where the keys say, against the buildings and the street's posts and parked cars around it (fetched from the
 * sim worker as you go, `near`), the camera stays behind it (`updateSteer`), the street draws your person there
 * (`Street.setSelf`), and the sim is told where you are (`steer`). Pressing a walking key on autopilot takes over
 * on the spot.
 *
 * Someone in a building is played in it (Arnd: "if the person is in a house, bring me into the house"): its
 * interior comes up (src/game/inside.ts), its walls, furniture, floors and stairs replace the closed box the
 * building is out of doors, and you stand up by the bed, seat or desk they were at. Walking up to a street door
 * brings the interior up the same way, so you walk in and out; the sim hears which building you are in.
 */
import { Picker } from '../app/picker';
import { PlayPanel } from '../app/playPanel';
import type { InhabitantCard } from '../sim/profile';
import type { NearSolids } from '../workers/simProtocol';
import type { Physics } from '../physics/physics';
import { rampBox, wallBoxes, type SolidBox, type SolidPost } from '../physics/solids';
import { pointInPoly } from '../geom/geom2';
import type { Indoors } from '../interior/indoors';
import { reachOf } from '../interior/reach';
import type { GoingInside } from './inside';
import { Avatar } from './avatar';
import { EYE_BALL, type CameraControl, type PlayTarget } from './camera';
import type { SimClient } from './SimClient';
import type { Street } from './street';

export class Playing {
  private cards: InhabitantCard[] = [];
  private picker: Picker | null = null;
  private panel: PlayPanel | null = null;
  private readonly target: PlayTarget = { x: 0, y: 0, z: 0, vx: 0, vz: 0, outside: false };
  private phys: Promise<Physics> | null = null;
  /** The body you steer (null on autopilot, or while the sim walks you somewhere you picked). */
  private avatar: Avatar | null = null;
  /** Taking over is under way (the physics loading, the first solids coming). */
  private taking = false;
  /** Where the solids around were last fetched for, and whether a fetch is out. */
  private solidsAt: { x: number; z: number } | null = null;
  private fetching = false;
  /** When and where the sim was last told where you are, and whether that message is out. */
  private told = { x: 0, z: 0, t: 0, busy: false, building: -1 };
  /** The physics world once loaded (the frame needs it at once). */
  private physNow: Physics | null = null;
  /** The buildings and street things last fetched (a building's closed walls come back from here after its interior goes). */
  private lastNear: NearSolids | null = null;
  /** The building whose interior stands in the physics world (-1: none), and the one coming up. */
  private interior = -1;
  private entering: { code: number; done: Promise<boolean> } | null = null;
  /** Where the next take-over stands the body (a report's repro link: `?stand=`, `?look=`), used once. */
  private placeAt: { id: number; stand: Stand; look: { orbit: number; pitch: number } | null } | null = null;

  constructor(private readonly sim: SimClient, private readonly cam: CameraControl, private readonly street: Street, private readonly seed: number, private readonly goingIn: GoingInside) {
    // The interior's shut doors are solid (src/interior/doors.ts): a set of their own, renewed as they open and shut.
    goingIn.onDoors((code, shut) => { if (code === this.interior) this.physNow?.setSolids(`d:${code}`, shut); });
  }

  /** Who the player is, null while choosing. */
  get playing(): boolean { return this.panel !== null; }

  /** The building the player's person is in now (`Place.building` code), -1 out of doors or while nobody is played. */
  get building(): number {
    const s = this.sim.player;
    if (!this.panel || !s) return -1;
    if (this.avatar) return this.told.building;
    return indoorsNow(s, this.sim) ? s.building : -1;
  }

  /**
   * Once the town shows: play as `be` (an inhabitant's id, from `?be=`), else as whoever the loaded save was being
   * played as, else bring up the picker. `at` (a report's repro link) stands them there, in building
   * `at.stand.building` (-1 out of doors), the camera turned `at.look`; `at.autopilot` leaves their routine running them.
   */
  async takeOver(be: number | null, at: { stand: Stand | null; look: { orbit: number; pitch: number } | null; autopilot: boolean } | null = null): Promise<void> {
    const r = await this.sim.ask({ op: 'cards' });
    const was = r.status?.alive ? r.status : null;
    const card = r.cards.find((c) => c.id === (be ?? was?.id ?? -1));
    if (card && at?.stand) this.placeAt = { id: card.id, stand: at.stand, look: at.look };
    if (card) return this.become(card, at?.autopilot || (be === null && was ? was.autopilot : false));
    return this.choose(r.cards);
  }

  /** Autopilot on (their routine runs them) or off (you steer them from where they are). */
  setAutopilot(on: boolean): void {
    if (on) { this.dropAvatar(); void this.sim.ask({ op: 'autopilot', on }); } else void this.takeWheel();
  }

  /** The body you steer now (null on autopilot, or while the sim walks them). */
  get body(): { x: number; y: number; z: number; yaw: number } | null {
    const a = this.avatar;
    return a ? { x: a.x, y: a.y, z: a.z, yaw: a.yaw } : null;
  }

  /** The physics world once loaded (null before anyone took the wheel): the debug menu's Show colliders. */
  get physicsNow(): Physics | null { return this.physNow; }

  /** The street doors of the buildings near, as x, z pairs: walking within `DOOR_NEAR` of one brings its interior up. */
  doorPoints(): number[] {
    return this.lastNear?.buildings.flatMap((b) => b.doors) ?? [];
  }

  /**
   * Move the body (taking the wheel first if needed) to (x, z) out of doors, or into building `building` just inside
   * its first street door. For the debug menu's Go tools. Resolves to whether it moved.
   */
  async teleport(x: number, z: number, building = -1): Promise<boolean> {
    if (!this.avatar) await this.takeWheel();
    const av = this.avatar;
    if (!av) return false;
    const phys = av.phys;
    let at = { x, y: this.sim.standHeight(x, z), z, yaw: av.yaw }, inside = -1;
    if (building >= 0 && (await this.goIn(phys, building)) && this.goingIn.inside) {
      const d = this.goingIn.inside.indoors.doors[0];
      if (d) { at = { x: d.x - d.nx * 1.0, y: d.y, z: d.z - d.nz * 1.0, yaw: Math.atan2(d.nx, d.nz) }; inside = building; }
    }
    if (inside < 0) this.goOut();
    await this.fetchSolids(phys, at.x, at.z);
    if (this.avatar !== av) return false;
    av.putAt(at.x, at.y, at.z, at.yaw);
    this.cam.behind(at.yaw);
    await this.tell(at.x, at.z, inside);
    return true;
  }

  /** The building whose interior is up (its `Place.building` code, what it is), and the floor height `y` stands on (0 ground; null out of doors). */
  where(y: number): { building: number; about: string; floor: number | null } {
    const ins = this.goingIn.inside;
    if (!ins || this.interior !== ins.building) return { building: -1, about: '', floor: null };
    let floor = 0;
    ins.indoors.storeys.forEach((st, f) => { if (y >= st.y - 0.3) floor = f; });
    return { building: ins.building, about: ins.about, floor };
  }

  /** Show the picker (the cards are fetched fresh unless given: lives move on while you play). */
  async choose(cards?: InhabitantCard[]): Promise<void> {
    void this.physics();
    this.cards = cards ?? (await this.sim.ask({ op: 'cards' })).cards;
    this.picker?.root.remove();
    const current = this.panel ? this.cards.find((c) => c.id === this.panel!.card.id) ?? null : null;
    this.picker = new Picker(this.cards, {
      seed: this.seed, current,
      onPick: (c) => void this.become(c),
      onClose: current ? () => this.closePicker() : undefined,
    });
    document.body.append(this.picker.root);
    this.panel?.root.classList.add('pl-hidden');
  }

  private closePicker(): void {
    this.picker?.root.remove();
    this.picker = null;
    this.panel?.root.classList.remove('pl-hidden');
  }

  /** Become `card`'s person: on autopilot at first, so they carry on with their day while the camera arrives. */
  async become(card: InhabitantCard, autopilot = false): Promise<void> {
    this.dropAvatar();
    this.goOut();
    await this.sim.ask({ op: 'become', id: card.id, autopilot });
    this.closePicker();
    this.panel?.close();
    const panel = new PlayPanel(card, {
      autopilot: (on) => this.setAutopilot(on),
      actions: async () => (await this.sim.ask({ op: 'actions' })).actions,
      // Sent somewhere: the sim walks them there (a walking key takes over again on the way).
      go: (a) => { this.dropAvatar(); void this.sim.ask({ op: 'go', place: a.place, activity: a.activity }); },
      skipDays: async (days) => {
        const since = Math.floor(this.sim.clock), steering = this.avatar !== null;
        // Your life goes on without you watching: their routine runs the skipped days.
        this.dropAvatar();
        this.goOut();
        await this.sim.ask({ op: 'autopilot', on: true });
        await this.sim.skip(days);
        if (steering) void this.takeWheel();
        const r = await this.sim.ask({ op: 'digest', since });
        if (this.panel === panel) panel.showDigest(days, r.digest);
      },
      switchPerson: () => void this.choose(),
    });
    this.panel = panel;
    document.body.append(panel.root);
    this.cam.play();
    if (!autopilot) void this.takeWheel();
  }

  /**
   * Take the wheel: the body appears where the person is: in their building by the bed, seat or desk they were at
   * (whatever they were doing: asleep, they get up), else their figure on the street, else the doorstep of the
   * place they are in; and the sim hands them to you.
   */
  async takeWheel(): Promise<void> {
    if (this.taking || this.avatar) return;
    const s = this.sim.player;
    if (!s || !s.alive) return;
    this.taking = true;
    try {
      const phys = await this.physics();
      let at: { x: number; y: number; z: number; yaw: number } | null = null, building = -1;
      const want = this.placeAt?.id === s.id ? this.placeAt : null;
      this.placeAt = null;
      if (want) {
        // Stand where the report says, in its building when it was indoors (out of doors if that has no interior now).
        const st = want.stand;
        if (st.building >= 0 && !(await this.goIn(phys, st.building))) console.warn(`repro: building ${st.building} has no interior to stand in`);
        else building = st.building;
        at = { x: st.x, y: st.y, z: st.z, yaw: st.yaw };
      } else if (indoorsNow(s, this.sim) && (await this.goIn(phys, s.building)) && this.sim.player?.id === s.id) {
        at = this.standUp(phys, s.id);
        if (at) building = s.building;
      }
      if (!at) {
        const f = this.sim.walkers.has(s.id) ? this.street.where(s.id) : null;
        const p = f ? { x: f.x, z: f.z, yaw: Math.atan2(-f.vx, -f.vz) || (f.face ?? 0) } : s.exit ?? { x: s.x, z: s.z, yaw: 0 };
        at = { ...p, y: this.sim.standHeight(p.x, p.z) };
      }
      await this.fetchSolids(phys, at.x, at.z);
      if (this.sim.player?.id !== s.id) return;
      this.avatar = new Avatar(phys, at.x, at.y, at.z, at.yaw);
      this.street.setSelf(s.id, this.avatar);
      this.cam.behind(want?.look?.orbit ?? at.yaw, want?.look?.pitch);
      this.told.t = 0;
      await this.tell(at.x, at.z, building);
    } finally {
      this.taking = false;
    }
  }

  /**
   * Where `id` stands up in the building shown: beside the spot they were given (out of the bed, up from the
   * chair), at the nearest place with room for a person and a floor under it and a way out to the street
   * (src/interior/reach.ts; else any such place); else just inside a street door.
   */
  private standUp(phys: Physics, id: number): { x: number; y: number; z: number; yaw: number } | null {
    const ins = this.goingIn.inside;
    if (!ins) return null;
    const I = ins.indoors, spot = this.goingIn.spotOf(id) ?? I.spots.find((p) => p.use === 'sleep') ?? I.spots[0];
    const fits = (x: number, y: number, z: number, r: number) => phys.roomAt(x, y, z, r, BODY_H) && phys.clear(x, y + 0.5, z, 0, -1, 0, 1) < 0.8;
    if (spot) {
      // Facing away from what they were at (its front is along the spot's yaw); somewhere roomy first, else
      // anywhere a body fits.
      const yaw = spot.yaw + Math.PI, R = reachOf(I);
      for (const out of [true, false]) for (const roomy of [ROOMY, BODY_R]) for (const r of [0.6, 0.9, 1.3, 1.8]) for (let k = 0; k < 12; k++) {
        const a = spot.yaw + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * (Math.PI / 6);
        const x = spot.x + Math.sin(a) * r, z = spot.z + Math.cos(a) * r;
        if ((!out || R.out(spot.floor, x, z)) && fits(x, spot.y, z, roomy)) return { x, y: spot.y, z, yaw: openWay(phys, x, spot.y, z, yaw) };
      }
    }
    const d = I.doors[0];
    return d ? { x: d.x - d.nx * 1.0, y: I.base, z: d.z - d.nz * 1.0, yaw: Math.atan2(d.nx, d.nz) } : null;
  }

  /**
   * Bring building `code`'s interior up and put it in the physics world in place of its closed walls (the one
   * up before goes). Resolves to whether it stands (false: no interior to walk in, or another came first).
   */
  private goIn(phys: Physics, code: number): Promise<boolean> {
    if (this.interior === code && this.goingIn.inside) return Promise.resolve(true);
    if (this.entering?.code === code) return this.entering.done;
    const done = this.goingIn.enter(code).then((ins) => {
      if (this.entering?.code !== code) return false;
      this.entering = null;
      if (!ins) return false;
      if (this.interior >= 0 && this.interior !== code) this.closeUp(phys, this.interior);
      this.interior = code;
      phys.setSolids(`b:${code}`, interiorBoxes(ins.indoors, (x, z) => this.sim.standHeight(x, z)), [], ins.indoors.slabs);
      phys.setSolids(`d:${code}`, this.goingIn.shutBoxes());
      return true;
    });
    this.entering = { code, done };
    return done;
  }

  /** Back out of doors: the interior goes and its building is a closed box again. */
  private goOut(): void {
    this.entering = null;
    if (this.interior < 0 && !this.goingIn.inside) return;
    this.goingIn.leave();
    if (this.physNow && this.interior >= 0) this.closeUp(this.physNow, this.interior);
    this.interior = -1;
  }

  /** Building `code`'s closed walls again (or none, if it is no longer near). */
  private closeUp(phys: Physics, code: number): void {
    phys.dropSolids(`d:${code}`);
    const b = this.lastNear?.buildings.find((n) => n.code === code);
    if (b) phys.setSolids(`b:${code}`, wallBoxes(b.poly, b.y0, b.y1)); else phys.dropSolids(`b:${code}`);
  }

  /** The physics world, loaded once (its module is big: fetched while the picker is up, before anyone needs it). */
  private physics(): Promise<Physics> {
    this.phys ??= import('../physics/physics').then((m) => m.Physics.create(this.sim.ground)).then((p) => (this.physNow = p));
    return this.phys;
  }

  private dropAvatar(): void {
    if (!this.avatar) return;
    this.avatar.dispose();
    this.avatar = null;
    if (this.sim.player) this.street.setSelf(this.sim.player.id, null);
  }

  /** Tell the sim where you are (in building `building`, -1 out of doors). */
  private async tell(x: number, z: number, building: number): Promise<void> {
    this.told.busy = true;
    Object.assign(this.told, { x, z, building, t: performance.now() });
    try { await this.sim.ask({ op: 'steer', x, z, building }); } finally { this.told.busy = false; }
  }

  /** The buildings and street things around (x, z), into the physics world (far ones dropped). */
  private async fetchSolids(phys: Physics, x: number, z: number): Promise<void> {
    this.fetching = true;
    this.solidsAt = { x, z };
    try {
      const r = await this.sim.ask({ op: 'near', x, z, r: SOLIDS_R });
      if (r.near) { this.lastNear = r.near; placeSolids(phys, r.near, this.interior); }
    } finally {
      this.fetching = false;
    }
  }

  /**
   * Each frame while playing: where the player's person is (out of doors near the camera: their figure; else
   * their building), for the camera; the panel's status. Returns the point the street should be reported around.
   */
  track(dt: number, t: number, compiling: boolean): { x: number; z: number } | null {
    const s = this.sim.player;
    if (!this.panel || !s || s.id !== this.panel.card.id) return null;
    this.panel.show(s);
    if (!s.alive) {
      const panel = this.panel;
      this.panel = null;
      this.dropAvatar();
      this.goOut();
      this.cam.stopPlay();
      panel.gone(() => { panel.close(); void this.choose(); });
      return null;
    }
    const w = this.cam.wish(), keys = Math.hypot(w.x, w.z) > 0;
    // The sim walks them somewhere picked from What now? (or Autopilot came back on elsewhere): it has them.
    if (this.avatar && !s.steered && !this.told.busy && !this.taking && performance.now() - this.told.t > 1500) this.dropAvatar();
    if (!this.avatar && keys) void this.takeWheel();
    const av = this.avatar;
    if (av) return this.steer(av, dt, w, compiling);
    // On autopilot in a building: its interior, the camera in there with them (asleep: by their bed).
    if (indoorsNow(s, this.sim) && this.physNow) {
      const phys = this.physNow;
      void this.goIn(phys, s.building);
      const ins = this.goingIn.inside;
      if (this.interior === s.building && ins) {
        const f = this.street.where(s.id), spot = this.goingIn.spotOf(s.id);
        const p = f ?? spot ?? { x: ins.indoors.doors[0]?.x ?? s.x, y: ins.indoors.base, z: ins.indoors.doors[0]?.z ?? s.z };
        const head = { x: p.x, y: p.y + (f || !spot || spot.use !== 'sleep' ? 1.55 : 0.6), z: p.z };
        this.cam.updateSteer(dt, head, compiling, (dx, dy, dz, max) => phys.clear(head.x, head.y, head.z, dx, dy, dz, max, undefined, EYE_BALL), (x, y, z) => phys.roomAround(x, y, z));
        this.street.hide(this.cam.tooClose ? s.id : -1);
        return { x: p.x, z: p.z };
      }
    } else if (this.interior >= 0 || this.goingIn.inside) this.goOut();
    const f = this.street.where(s.id);
    const tg = this.target;
    if (f) Object.assign(tg, { x: f.x, y: f.y, z: f.z, vx: f.vx, vz: f.vz, outside: true });
    // Indoors: their building. Out of doors but not near the camera yet: where the worker says they are on the street.
    else Object.assign(tg, { x: s.x, y: this.sim.standHeight(s.x, s.z), z: s.z, vx: 0, vz: 0, outside: false });
    this.street.hide(-1);
    this.cam.updatePlay(dt, t, tg, compiling);
    return { x: tg.x, z: tg.z };
  }

  /** A frame of steering: the body moves, the camera follows, the sim hears where you are and the solids keep up. */
  private steer(av: Avatar, dt: number, w: { x: number; z: number; hurry: boolean }, compiling: boolean): { x: number; z: number } {
    const phys = av.phys;
    av.step(dt, w.x, w.z, w.hurry);
    phys.world.step();
    if (!this.fetching && this.solidsAt && Math.hypot(av.x - this.solidsAt.x, av.z - this.solidsAt.z) > SOLIDS_R / 3) void this.fetchSolids(phys, av.x, av.z);
    const head = { x: av.x, y: av.y + 1.55, z: av.z };
    this.cam.updateSteer(dt, head, compiling, (dx, dy, dz, max) => phys.clear(head.x, head.y, head.z, dx, dy, dz, max, av.body, EYE_BALL), (x, y, z) => phys.roomAround(x, y, z, av.body));
    this.street.hide(this.cam.tooClose && this.sim.player ? this.sim.player.id : -1);
    const building = this.doorsAround(phys, av);
    const now = performance.now();
    if (!this.told.busy && (building !== this.told.building || now - this.told.t > TELL_MS || Math.hypot(av.x - this.told.x, av.z - this.told.z) > 6)) void this.tell(av.x, av.z, building);
    return { x: av.x, z: av.z };
  }

  /**
   * The doors around the body: walking up to a building's door brings its interior up (in place of its closed
   * walls); walking away from it puts it back. Returns the building the body stands in (-1: out of doors).
   */
  private doorsAround(phys: Physics, av: Avatar): number {
    const near = this.lastNear;
    if (!near) return -1;
    let inside = -1, door = -1, dd = DOOR_NEAR;
    for (const b of near.buildings) {
      if (b.code === this.interior && pointInPoly(b.poly, av.x, av.z)) inside = b.code;
      for (let i = 0; i < b.doors.length; i += 2) {
        const d = Math.hypot(b.doors[i] - av.x, b.doors[i + 1] - av.z);
        if (d < dd) { dd = d; door = b.code; }
      }
    }
    if (inside < 0 && door >= 0 && door !== this.interior) void this.goIn(phys, door);
    else if (inside < 0 && door < 0 && this.interior >= 0) {
      const b = near.buildings.find((n) => n.code === this.interior);
      if (!b || !nearPoly(b.poly, av.x, av.z, LEAVE_AT)) this.goOut();
    }
    return inside;
  }
}

/** Where to stand the body: feet at (x, y, z), facing `yaw`, in building `building` (-1 out of doors). */
export interface Stand { x: number; y: number; z: number; yaw: number; building: number }

/** How far around the body the solids are fetched (m); fetched again after walking a third of it. */
const SOLIDS_R = 75;
/** Real milliseconds between telling the sim where you are (sooner after a few metres). */
const TELL_MS = 2000;
/** Height of the street's posts, trees and parked cars as the body meets them (m). */
const POST_H = 2.2;
/** How close to a street door its building's interior comes up, and how far from its walls it goes again (m). */
const DOOR_NEAR = 4, LEAVE_AT = 8;
/** The body as the room it needs: radius and height (src/game/avatar.ts). */
const BODY_R = 0.3, BODY_H = 1.8;
/** Room to stand up in when there is a choice: free all round to this radius (m). */
const ROOMY = 0.6;
/** Enough room ahead to walk off into (m). */
const OPEN_AHEAD = 2.5;

/** The way to face from feet (x, y, z) with the most room ahead (not a table in your face), `prefer` when it is as open. */
function openWay(phys: Physics, x: number, y: number, z: number, prefer: number): number {
  let best = prefer, room = phys.clear(x, y + 0.9, z, -Math.sin(prefer), 0, -Math.cos(prefer), OPEN_AHEAD);
  for (let k = 1; k < 16 && room < OPEN_AHEAD; k++) {
    const yaw = prefer + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * (Math.PI / 8);
    const d = phys.clear(x, y + 0.9, z, -Math.sin(yaw), 0, -Math.cos(yaw), OPEN_AHEAD);
    if (d > room + 0.3) { room = d; best = yaw; }
  }
  return best;
}

/** In a building as the sim has it (not walking anywhere, not out of doors): their interior is where they are. */
function indoorsNow(s: NonNullable<SimClient['player']>, sim: SimClient): boolean {
  return s.building >= 0 && !s.outdoors && !s.travelling && !sim.walkers.has(s.id);
}

/** Is (x, z) inside `poly` or within `r` of it (its bounds, grown)? */
function nearPoly(poly: readonly number[], x: number, z: number, r: number): boolean {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (let i = 0; i < poly.length; i += 2) { x0 = Math.min(x0, poly[i]); x1 = Math.max(x1, poly[i]); z0 = Math.min(z0, poly[i + 1]); z1 = Math.max(z1, poly[i + 1]); }
  return x > x0 - r && x < x1 + r && z > z0 - r && z < z1 + r;
}

/**
 * A building's interior as boxes: its walls and furniture, each flight of stairs as a ramp, and a ramp up to
 * each street door whose floor stands higher than the street in front (a building on a slope).
 */
function interiorBoxes(I: Indoors, ground: (x: number, z: number) => number): SolidBox[] {
  const out: SolidBox[] = [...I.colliders, ...I.ramps.map(rampBox)];
  for (const d of I.doors) {
    const ox = d.x + d.nx * 1.4, oz = d.z + d.nz * 1.4, g = ground(ox, oz);
    if (d.y - g > 0.15) out.push(rampBox({ x0: ox, y0: g, z0: oz, x1: d.x, y1: d.y, z1: d.z, width: d.w }));
  }
  return out;
}

/** Put `near` in the physics world: each building's walls (kept while it stays near; not `interior`'s, whose inside stands), the street's posts afresh. */
function placeSolids(phys: Physics, near: NearSolids, interior: number): void {
  const keep = new Set<string>();
  for (const b of near.buildings) {
    const key = `b:${b.code}`;
    keep.add(key);
    if (b.code !== interior && !phys.hasSolids(key)) phys.setSolids(key, wallBoxes(b.poly, b.y0, b.y1));
  }
  for (const key of [...phys.keys()]) if (key.startsWith('b:') && !keep.has(key)) phys.dropSolids(key);
  const posts: SolidPost[] = [];
  const c = near.circles;
  for (let i = 0; i < c.length; i += 4) posts.push({ x: c[i], z: c[i + 1], r: c[i + 2], y: c[i + 3] - 0.5, h: POST_H + 0.5 });
  phys.setSolids('posts', [], posts);
}
