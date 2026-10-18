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
 * on the spot; someone indoors steps out of their door.
 */
import { Picker } from '../app/picker';
import { PlayPanel } from '../app/playPanel';
import type { InhabitantCard } from '../sim/profile';
import type { NearSolids } from '../workers/simProtocol';
import type { Physics } from '../physics/physics';
import { wallBoxes, type SolidPost } from '../physics/solids';
import { Avatar } from './avatar';
import type { CameraControl, PlayTarget } from './camera';
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
  private told = { x: 0, z: 0, t: 0, busy: false };

  constructor(private readonly sim: SimClient, private readonly cam: CameraControl, private readonly street: Street, private readonly seed: number) {}

  /** Who the player is, null while choosing. */
  get playing(): boolean { return this.panel !== null; }

  /**
   * Once the town shows: play as `be` (an inhabitant's id, from `?be=`), else as whoever the loaded save was being
   * played as, else bring up the picker.
   */
  async takeOver(be: number | null): Promise<void> {
    const r = await this.sim.ask({ op: 'cards' });
    const was = r.status?.alive ? r.status : null;
    const card = r.cards.find((c) => c.id === (be ?? was?.id ?? -1));
    if (card) return this.become(card, be === null && was ? was.autopilot : false);
    return this.choose(r.cards);
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
    await this.sim.ask({ op: 'become', id: card.id, autopilot });
    this.closePicker();
    this.panel?.close();
    const panel = new PlayPanel(card, {
      autopilot: (on) => { if (on) { this.dropAvatar(); void this.sim.ask({ op: 'autopilot', on }); } else void this.takeWheel(); },
      actions: async () => (await this.sim.ask({ op: 'actions' })).actions,
      // Sent somewhere: the sim walks them there (a walking key takes over again on the way).
      go: (a) => { this.dropAvatar(); void this.sim.ask({ op: 'go', place: a.place, activity: a.activity }); },
      skipDays: async (days) => {
        const since = Math.floor(this.sim.clock), steering = this.avatar !== null;
        // Your life goes on without you watching: their routine runs the skipped days.
        this.dropAvatar();
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
   * Take the wheel: the body appears where the person is (their figure on the street, else the doorstep of the
   * place they are in) and the sim hands them to you.
   */
  async takeWheel(): Promise<void> {
    if (this.taking || this.avatar) return;
    const s = this.sim.player;
    if (!s || !s.alive) return;
    this.taking = true;
    try {
      const f = this.street.where(s.id);
      const at = f ? { x: f.x, z: f.z, yaw: Math.atan2(-f.vx, -f.vz) || (f.face ?? 0) } : s.exit ?? { x: s.x, z: s.z, yaw: 0 };
      const phys = await this.physics();
      await this.fetchSolids(phys, at.x, at.z);
      if (this.sim.player?.id !== s.id) return;
      this.avatar = new Avatar(phys, at.x, this.sim.standHeight(at.x, at.z), at.z, at.yaw);
      this.street.setSelf(s.id, this.avatar);
      this.told.t = 0;
      await this.tell(at.x, at.z);
    } finally {
      this.taking = false;
    }
  }

  /** The physics world, loaded once (its module is big: fetched while the picker is up, before anyone needs it). */
  private physics(): Promise<Physics> {
    this.phys ??= import('../physics/physics').then((m) => m.Physics.create(this.sim.ground));
    return this.phys;
  }

  private dropAvatar(): void {
    if (!this.avatar) return;
    this.avatar.dispose();
    this.avatar = null;
    if (this.sim.player) this.street.setSelf(this.sim.player.id, null);
  }

  /** Tell the sim where you are. */
  private async tell(x: number, z: number): Promise<void> {
    this.told.busy = true;
    Object.assign(this.told, { x, z, t: performance.now() });
    try { await this.sim.ask({ op: 'steer', x, z }); } finally { this.told.busy = false; }
  }

  /** The buildings and street things around (x, z), into the physics world (far ones dropped). */
  private async fetchSolids(phys: Physics, x: number, z: number): Promise<void> {
    this.fetching = true;
    this.solidsAt = { x, z };
    try {
      const r = await this.sim.ask({ op: 'near', x, z, r: SOLIDS_R });
      if (r.near) placeSolids(phys, r.near);
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
    const f = this.street.where(s.id);
    const tg = this.target;
    if (f) Object.assign(tg, { x: f.x, y: f.y, z: f.z, vx: f.vx, vz: f.vz, outside: true });
    // Indoors: their building. Out of doors but not near the camera yet: where the worker says they are on the street.
    else Object.assign(tg, { x: s.x, y: this.sim.standHeight(s.x, s.z), z: s.z, vx: 0, vz: 0, outside: false });
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
    this.cam.updateSteer(dt, head, compiling, (dx, dy, dz, max) => phys.clear(head.x, head.y, head.z, dx, dy, dz, max, av.body));
    const now = performance.now();
    if (!this.told.busy && (now - this.told.t > TELL_MS || Math.hypot(av.x - this.told.x, av.z - this.told.z) > 6)) void this.tell(av.x, av.z);
    return { x: av.x, z: av.z };
  }
}

/** How far around the body the solids are fetched (m); fetched again after walking a third of it. */
const SOLIDS_R = 75;
/** Real milliseconds between telling the sim where you are (sooner after a few metres). */
const TELL_MS = 2000;
/** Height of the street's posts, trees and parked cars as the body meets them (m). */
const POST_H = 2.2;

/** Put `near` in the physics world: each building's walls (kept while it stays near), the street's posts afresh. */
function placeSolids(phys: Physics, near: NearSolids): void {
  const keep = new Set<string>();
  for (const b of near.buildings) {
    const key = `b:${b.code}`;
    keep.add(key);
    if (!phys.hasSolids(key)) phys.setSolids(key, wallBoxes(b.poly, b.y0, b.y1));
  }
  for (const key of [...phys.keys()]) if (key.startsWith('b:') && !keep.has(key)) phys.dropSolids(key);
  const posts: SolidPost[] = [];
  const c = near.circles;
  for (let i = 0; i < c.length; i += 4) posts.push({ x: c[i], z: c[i + 1], r: c[i + 2], y: c[i + 3] - 0.5, h: POST_H + 0.5 });
  phys.setSolids('posts', [], posts);
}
