/**
 * The building someone is inside, drawn: one building at a time is fetched from a town worker (the
 * `indoors` op: every storey furnished, plus its walls, furniture, floors, stairs, doors and spots as
 * plain data, src/interior/indoors.ts) and added through the Stage with the `INTERIOR` kind (warmed
 * at start, so going in compiles nothing). The game puts physics bodies on `current.indoors` and
 * sets the room light (`setRoomLight`) from who is home and awake.
 *
 * New in SimWorld (Scale's interior designer streamed a storey's walls when the player walked in,
 * src/interior/Interiors.ts).
 */
import type { Mesh } from 'three/webgpu';
import type { Indoors } from '../interior/indoors';
import type { WorkerPool } from '../workers/pool';
import type { FromTown, ToTown } from '../workers/townProtocol';
import { INTERIOR } from './materials';
import { meshFromData } from './meshes';
import type { Stage } from './stage';
import { INTERIOR_LIGHT } from './tsl/interior';

/** A building in a cell: as `buildingRef` decodes `Place.building`. */
export interface BuildingKey { cell: number; index: number }

export interface Inside {
  key: BuildingKey;
  /** Walls, furniture, floors, stairs, street doors and spots, in world coordinates. */
  indoors: Indoors;
  /** What the building is, for the HUD. */
  about: string;
}

export class InteriorView {
  private mesh: Mesh | null = null;
  private inside: Inside | null = null;
  /** The building being fetched (a later `enter` wins). */
  private wanted: BuildingKey | null = null;

  constructor(private readonly pool: WorkerPool<ToTown, FromTown>, private readonly stage: Stage) {}

  /** The building shown now, null when out of doors. */
  get current(): Inside | null { return this.inside; }

  /** Show building `key` (the one shown before goes); resolves with it once it is in the scene, null if another `enter` or `leave` came first. */
  async enter(key: BuildingKey): Promise<Inside | null> {
    if (this.inside && same(this.inside.key, key)) return this.inside;
    this.wanted = key;
    const r = await this.pool.run<Extract<FromTown, { type: 'indoors' }>>({ type: 'indoors', cell: key.cell, index: key.index }, 0);
    if (!this.wanted || !same(this.wanted, key)) return null;
    const mesh = r.mesh ? meshFromData(r.mesh, INTERIOR) : null;
    if (mesh) await this.stage.add(mesh);
    if (!this.wanted || !same(this.wanted, key)) { if (mesh) this.unload(mesh); return null; }
    this.clear();
    this.mesh = mesh;
    this.inside = { key, indoors: r.indoors, about: r.about };
    return this.inside;
  }

  /** Back out of doors: the building's interior goes. */
  leave(): void {
    this.wanted = null;
    this.clear();
  }

  /** How lit the rooms are, 0 (lamps off, daylight only) … 1 (every lamp on). */
  setRoomLight(level: number): void {
    INTERIOR_LIGHT.room.value = Math.max(0, Math.min(1, level));
  }

  private clear(): void {
    if (this.mesh) this.unload(this.mesh);
    this.mesh = null;
    this.inside = null;
  }

  private unload(m: Mesh): void {
    this.stage.remove(m);
    m.geometry.dispose();
  }
}

const same = (a: BuildingKey, b: BuildingKey) => a.cell === b.cell && a.index === b.index;
