/**
 * The building someone is inside, drawn: one building at a time is fetched from a town worker (the
 * `indoors` op: every storey furnished, plus its walls, furniture, floors, stairs, doors and spots as
 * plain data, src/interior/indoors.ts) and added through the Stage with the `INTERIOR` kind (warmed
 * at start, so going in compiles nothing). The game puts physics bodies on `current.indoors` and
 * sets the room light (`setRoomLight`) from who is home and awake. While a building is shown, its painted street
 * doors are cut out of its shell (`setDoorHoles`), so the real leaves are its only doors.
 *
 * New in SimWorld (Scale's interior designer streamed a storey's walls when the player walked in,
 * src/interior/Interiors.ts).
 */
import { Group, type Mesh } from 'three/webgpu';
import { leafWay } from '../interior/doors';
import type { Indoors } from '../interior/indoors';
import type { WorkerPool } from '../workers/pool';
import type { FromTown, ToTown } from '../workers/townProtocol';
import { INTERIOR } from './materials';
import { meshFromData } from './meshes';
import type { Stage } from './stage';
import { INTERIOR_LIGHT } from './tsl/interior';
import { setDoorHoles } from './tsl/facade';
import { STREET_DOOR_H } from '../interior/indoors';

/** The view whose building's doorways are cut out of the shells now (one at a time). */
let holesOf: InteriorView | null = null;

export interface Inside {
  /** Its `Place.building` code. */
  building: number;
  /** Walls, furniture, floors, stairs, street doors and spots, in world coordinates. */
  indoors: Indoors;
  /** What the building is, for the HUD. */
  about: string;
}

export class InteriorView {
  private mesh: Mesh | null = null;
  /** The door leaves (one mesh each, in `inside.indoors.leaves` order), turned about their hinges by `swing`. */
  private leaves: Group | null = null;
  private inside: Inside | null = null;
  /** The building being fetched (a later `enter` wins). */
  private wanted = -1;

  constructor(private readonly pool: WorkerPool<ToTown, FromTown>, private readonly stage: Stage) {}

  /** The building shown now, null when out of doors. */
  get current(): Inside | null { return this.inside; }

  /**
   * Show the building whose `Place.building` code is `building` (the one shown before goes); resolves with it once it
   * is in the scene, null if another `enter` or `leave` came first.
   */
  async enter(building: number): Promise<Inside | null> {
    if (this.inside?.building === building) return this.inside;
    this.wanted = building;
    const r = await this.pool.run<Extract<FromTown, { type: 'indoors' }>>({ type: 'indoors', building }, 0);
    if (this.wanted !== building) return null;
    const mesh = r.mesh ? meshFromData(r.mesh, INTERIOR) : null;
    const leaves = new Group();
    r.leaves.forEach((d, i) => {
      const m = meshFromData(d, INTERIOR), l = r.indoors.leaves[i];
      m.position.set(l.x, l.y, l.z);
      leaves.add(m);
    });
    await Promise.all([mesh && this.stage.add(mesh), this.stage.add(leaves)]);
    if (this.wanted !== building) { if (mesh) this.unload(mesh); this.unload(leaves); return null; }
    this.clear();
    this.mesh = mesh;
    this.leaves = leaves;
    this.inside = { building, indoors: r.indoors, about: r.about };
    r.indoors.leaves.forEach((_, i) => this.swing(i, 0));
    // Its street doors are real now: no painted door in the shell over them (src/render/tsl/facade.ts).
    setDoorHoles(r.indoors.doors.map((d) => ({ ...d, h: STREET_DOOR_H })));
    holesOf = this;
    return this.inside;
  }

  /** Back out of doors: the building's interior goes. */
  leave(): void {
    this.wanted = -1;
    this.clear();
  }

  /** Turn door leaf `i` of the building shown open by `a` (0 shut … 1 a quarter turn). */
  swing(i: number, a: number): void {
    const m = this.leaves?.children[i], l = this.inside?.indoors.leaves[i];
    if (!m || !l) return;
    const [x, z] = leafWay(l, a);
    m.rotation.y = Math.atan2(-z, x);
    m.updateMatrix();
  }

  /** How lit the rooms are, 0 (lamps off, daylight only) … 1 (every lamp on). */
  setRoomLight(level: number): void {
    INTERIOR_LIGHT.room.value = Math.max(0, Math.min(1, level));
  }

  private clear(): void {
    if (holesOf === this) { setDoorHoles([]); holesOf = null; }
    if (this.mesh) this.unload(this.mesh);
    if (this.leaves) this.unload(this.leaves);
    this.mesh = null;
    this.leaves = null;
    this.inside = null;
  }

  private unload(m: Mesh | Group): void {
    this.stage.remove(m);
    m.traverse((o) => (o as Mesh).geometry?.dispose());
  }
}
