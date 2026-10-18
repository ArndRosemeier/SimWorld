/**
 * A body worker: builds humans (morph, skeleton, sockets, hair and parts) off the main thread, from
 * their appearance (src/workers/bodyProtocol.ts). Started by the worker pool only.
 * Ported from Scale (src/humanoid/body.worker.ts).
 */
import { buildCharacter, buildTransfers, loadHumanAssets, setHumanAssetBase } from '@futuremagic/humanoid';
import type { FromBody, ToBody } from './bodyProtocol';
import { serve } from './serve';

async function handle(m: ToBody): Promise<FromBody> {
  if (m.type === 'init') {
    setHumanAssetBase(m.assetBase);
    await loadHumanAssets();
    return { type: 'ready' };
  }
  const build = buildCharacter(await loadHumanAssets(), m.app);
  // The morph-space arrays are not needed on the main thread.
  build.body.pos = new Float32Array(0);
  build.body.normal = new Float32Array(0);
  return { type: 'build', build };
}

serve<ToBody, FromBody>(handle, (r) => (r.type === 'build' ? buildTransfers(r.build) : []));
