/**
 * Messages between the main thread (src/render/people/bodies.ts) and the body workers
 * (src/workers/body.worker.ts): a human's appearance in, its built body (morphed mesh, skeleton,
 * sockets, hair and parts) out.
 */
import type { CharacterBuild, HumanoidAppearance } from '@futuremagic/humanoid';

export type ToBody =
  | { type: 'init'; assetBase: string }
  | { type: 'build'; app: HumanoidAppearance };

export type FromBody =
  | { type: 'ready' }
  | { type: 'build'; build: CharacterBuild }
  | { type: 'error'; message: string };
