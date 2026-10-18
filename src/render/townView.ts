/**
 * The town from above (docs/design/simworld-plan.md R2): the town workers build the mesh data
 * (src/workers/town.worker.ts), this turns each piece into a mesh of its material kind and puts
 * it on the stage, nearest the centre first, so the view fills in from the middle. New in
 * SimWorld (Scale streams cells around the player instead; a town fits whole).
 */
import { Group, type Mesh } from 'three/webgpu';
import type { MeshData } from '../build/meshBuilder';
import type { WorkerPool } from '../workers/pool';
import type { FromTown, ToTown, TownSummary } from '../workers/townProtocol';
import { FACADE, GROUND, TERRAIN, WATER, type MaterialKind } from './materials';
import { meshFromData } from './meshes';
import type { Stage } from './stage';
import { showProps, type PropsShown } from './propsView';
import { showVegetation, type VegetationShown } from './vegetationView';
import { showSigns, type SignsShown } from './signsView';

export interface TownView {
  root: Group;
  /** Pieces placed / all pieces. */
  done: number;
  total: number;
  /** Resolves when every piece is in. */
  ready: Promise<void>;
  /** The street props (src/render/propsView.ts), once placed. */
  props?: PropsShown;
  /** The trees and shrubs of the town and the countryside (src/render/vegetationView.ts), once placed. */
  vegetation?: VegetationShown;
  /** The signs: shop names and hours, estate boards, street names, town signs (src/render/signsView.ts), once placed. */
  signs?: SignsShown;
  /** Each public building's mesh by its index in `macro.landmarks` (= its id), once placed: hidden while you are inside it. */
  landmarks: (Mesh | undefined)[];
}

/** `onChimneys`: the chimney tops (x, y, z each) of each piece's buildings, as they come in. */
export function showTown(stage: Stage, pool: WorkerPool<ToTown, FromTown>, town: TownSummary, onProgress: (done: number, total: number) => void = () => {}, onChimneys: (tops: number[]) => void = () => {}): TownView {
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

  const view: TownView = { root, done: 0, total: jobs.length, ready: Promise.resolve(), landmarks: [] };
  const place = async (d: MeshData | null, kind: MaterialKind): Promise<Mesh | undefined> => {
    if (!d || !d.index.length) return;
    const m = meshFromData(d, kind);
    await stage.prepare(m);
    root.add(m);
    return m;
  };
  // The street props after the cells: their instance lists, then a model each.
  view.total++;
  const props = showProps(stage, pool, root, 40 + town.cells).then((p) => { view.props = p; onProgress(++view.done, view.total); });
  // The trees after the cells too: the town's, then the countryside's.
  view.total++;
  const trees = showVegetation(stage, pool, root, town, 60 + town.cells).then((v) => { view.vegetation = v; onProgress(++view.done, view.total); });
  // The signs after the props.
  view.total++;
  const signs = showSigns(stage, pool, root, 50 + town.cells).then((s) => { view.signs = s; onProgress(++view.done, view.total); });
  view.ready = Promise.all([props, trees, signs, ...jobs.map(async ({ msg, priority }) => {
    const r = await pool.run(msg, priority);
    switch (r.type) {
      case 'terrain': await place(r.mesh, TERRAIN); break;
      case 'water': await place(r.mesh, WATER); break;
      case 'cell': case 'country': if (r.chimneys.length) onChimneys(r.chimneys); await place(r.ground, GROUND); await place(r.buildings, FACADE); break;
      case 'bridges': await place(r.ground, GROUND); await place(r.buildings, FACADE); break;
      case 'landmark': { const m = await place(r.mesh, FACADE); if (msg.type === 'landmark') view.landmarks[msg.index] = m; break; }
    }
    onProgress(++view.done, view.total);
  })]).then(() => undefined);
  return view;
}
