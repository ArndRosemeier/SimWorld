/**
 * The town from above (docs/design/simworld-plan.md R2): the town workers build the mesh data
 * (src/workers/town.worker.ts), this turns each piece into a mesh of its material kind and puts
 * it on the stage, nearest the centre first, so the view fills in from the middle. New in
 * SimWorld (Scale streams cells around the player instead; a town fits whole).
 */
import { Group } from 'three/webgpu';
import type { MeshData } from '../build/meshBuilder';
import type { WorkerPool } from '../workers/pool';
import type { FromTown, ToTown, TownSummary } from '../workers/townProtocol';
import { FACADE, GROUND, TERRAIN, WATER, type MaterialKind } from './materials';
import { meshFromData } from './meshes';
import type { Stage } from './stage';

export interface TownView {
  root: Group;
  /** Pieces placed / all pieces. */
  done: number;
  total: number;
  /** Resolves when every piece is in. */
  ready: Promise<void>;
}

export function showTown(stage: Stage, pool: WorkerPool<ToTown, FromTown>, town: TownSummary, onProgress: (done: number, total: number) => void = () => {}): TownView {
  const root = new Group();
  root.name = 'town';
  stage.scene.add(root);
  const near = (x: number, z: number) => Math.hypot(x - town.x, z - town.z);
  const jobs: { msg: ToTown; priority: number }[] = [];
  for (const t of town.tiles) {
    const d = near(t.x0 + t.size / 2, t.z0 + t.size / 2);
    jobs.push({ msg: { type: 'terrain', tile: t }, priority: d }, { msg: { type: 'water', tile: t }, priority: d + 50 });
  }
  for (let c = 0; c < town.cells; c++) jobs.push({ msg: { type: 'cell', cell: c }, priority: 10 + c });
  for (let i = 0; i < town.landmarks; i++) jobs.push({ msg: { type: 'landmark', index: i }, priority: 20 + i });
  jobs.push({ msg: { type: 'bridges' }, priority: 30 }, { msg: { type: 'country' }, priority: 400 });

  const view: TownView = { root, done: 0, total: jobs.length, ready: Promise.resolve() };
  const place = async (d: MeshData | null, kind: MaterialKind) => {
    if (!d || !d.index.length) return;
    const m = meshFromData(d, kind);
    await stage.prepare(m);
    root.add(m);
  };
  view.ready = Promise.all(jobs.map(async ({ msg, priority }) => {
    const r = await pool.run(msg, priority);
    switch (r.type) {
      case 'terrain': await place(r.mesh, TERRAIN); break;
      case 'water': await place(r.mesh, WATER); break;
      case 'cell': case 'country': case 'bridges': await place(r.ground, GROUND); await place(r.buildings, FACADE); break;
      case 'landmark': await place(r.mesh, FACADE); break;
    }
    onProgress(++view.done, view.total);
  })).then(() => undefined);
  return view;
}
