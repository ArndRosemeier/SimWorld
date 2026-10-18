/**
 * The game's side of being an inhabitant (D4, plan R2 and R5): the picker over the town from above once it is up,
 * then playing as whoever was picked. Picking someone tells the sim (`become`), flies the camera down to them and
 * keeps it with them (src/game/camera.ts `play`), and opens the play panel (src/app/playPanel.ts) whose controls go
 * to the sim worker through `SimClient.ask`. The time skip runs `sim.skip` and then shows that person's digest.
 */
import { Picker } from '../app/picker';
import { PlayPanel } from '../app/playPanel';
import type { InhabitantCard } from '../sim/profile';
import type { CameraControl, PlayTarget } from './camera';
import type { SimClient } from './SimClient';
import type { Street } from './street';

export class Playing {
  private cards: InhabitantCard[] = [];
  private picker: Picker | null = null;
  private panel: PlayPanel | null = null;
  private readonly target: PlayTarget = { x: 0, y: 0, z: 0, vx: 0, vz: 0, outside: false };

  constructor(private readonly sim: SimClient, private readonly cam: CameraControl, private readonly street: Street, private readonly seed: number) {}

  /** Who the player is, null while choosing. */
  get playing(): boolean { return this.panel !== null; }

  /** Show the picker (the cards are fetched fresh: lives move on while you play). */
  async choose(): Promise<void> {
    const r = await this.sim.ask({ op: 'cards' });
    this.cards = r.cards;
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
  async become(card: InhabitantCard): Promise<void> {
    await this.sim.ask({ op: 'become', id: card.id, autopilot: true });
    this.closePicker();
    this.panel?.close();
    const panel = new PlayPanel(card, {
      autopilot: (on) => void this.sim.ask({ op: 'autopilot', on }),
      actions: async () => (await this.sim.ask({ op: 'actions' })).actions,
      go: (a) => void this.sim.ask({ op: 'go', place: a.place, activity: a.activity }),
      skipDays: async (days) => {
        const since = Math.floor(this.sim.clock);
        await this.sim.skip(days);
        const r = await this.sim.ask({ op: 'digest', since });
        if (this.panel === panel) panel.showDigest(days, r.digest);
      },
      save: () => this.sim.saveNow(),
      switchPerson: () => void this.choose(),
    });
    this.panel = panel;
    document.body.append(panel.root);
    this.cam.play();
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
      this.cam.stopPlay();
      panel.gone(() => { panel.close(); void this.choose(); });
      return null;
    }
    const f = this.street.where(s.id);
    const tg = this.target;
    if (f) Object.assign(tg, { x: f.x, y: f.y, z: f.z, vx: f.vx, vz: f.vz, outside: true });
    // Indoors: their building. Out of doors but not near the camera yet: where the worker says they are on the street.
    else Object.assign(tg, { x: s.x, y: this.sim.standHeight(s.x, s.z), z: s.z, vx: 0, vz: 0, outside: false });
    this.cam.updatePlay(dt, t, tg, compiling);
    return { x: tg.x, z: tg.z };
  }
}
