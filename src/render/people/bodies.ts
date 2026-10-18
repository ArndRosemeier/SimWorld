/**
 * Bodies for the humans on screen: the human assets loaded once, each appearance built in the body workers
 * (src/workers/body.worker.ts) and turned into shared geometry here, cached by appearance so a person seen
 * again is not built again. Ported from Scale (src/humanoid/client/BodyService.ts) onto the one worker pool.
 */
import { loadHumanAssets, setHumanAssetBase, type HumanAssets, type HumanoidAppearance } from '@futuremagic/humanoid';
import { CharacterGeometry, getHumanStatic, type HumanStatic } from '@futuremagic/humanoid/three';
import { WorkerPool } from '../../workers/pool';
import bodyWorkerUrl from '../../workers/body.worker.ts?worker&url';
import type { FromBody, ToBody } from '../../workers/bodyProtocol';

/** Where Vite serves the humanoid package's assets (vite.config.ts). */
export const HUMAN_ASSETS = `${import.meta.env.BASE_URL}humanoid/`;
setHumanAssetBase(HUMAN_ASSETS);

/** Unused geometries kept for people who may come back into view. */
const KEEP = 32;

export class Bodies {
  private readonly geos = new Map<string, { geo: Promise<CharacterGeometry>; used: number }>();

  private constructor(private readonly pool: WorkerPool<ToBody, FromBody>, readonly assets: HumanAssets, readonly st: HumanStatic) {}

  /** Load the assets here and in `workers` body workers. */
  static async launch(workers: number): Promise<Bodies> {
    const pool = new WorkerPool<ToBody, FromBody>(bodyWorkerUrl, workers);
    const base = new URL(HUMAN_ASSETS, location.href).href;
    const [assets] = await Promise.all([loadHumanAssets(), pool.start(() => ({ type: 'init', assetBase: base }))]);
    return new Bodies(pool, assets, getHumanStatic(assets));
  }

  /** Bodies being built now. */
  get pending(): number { return this.pool.queued + this.pool.inFlight; }

  /** The geometry of a body (`key` names it: a person at an age); lower `priority` builds sooner. */
  geometry(key: string, app: HumanoidAppearance, priority: number): Promise<CharacterGeometry> {
    const had = this.geos.get(key);
    if (had) { had.used = performance.now(); return had.geo; }
    const geo = this.pool.run<Extract<FromBody, { type: 'build' }>>({ type: 'build', app }, priority).then((m) => new CharacterGeometry(this.st, m.build));
    this.geos.set(key, { geo, used: performance.now() });
    geo.catch(() => this.geos.delete(key));
    this.collect();
    return geo;
  }

  /** Drop the least recently used geometries nobody holds, beyond KEEP. */
  private collect(): void {
    if (this.geos.size <= KEEP * 1.5) return;
    const old = [...this.geos.entries()].sort((a, b) => a[1].used - b[1].used);
    for (const [key, e] of old.slice(0, this.geos.size - KEEP)) {
      void e.geo.then((g) => { if (g.refs <= 0 && this.geos.get(key) === e) { g.dispose(); this.geos.delete(key); } });
    }
  }
}
