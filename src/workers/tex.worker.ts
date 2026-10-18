/**
 * A texture worker: generates one material texture layer per job (src/workers/texProtocol.ts)
 * with src/build/texgen and transfers its two RGBA8 buffers back. Started by the worker pool
 * only. Ported from Scale (src/render/tex.worker.ts).
 */
import { generateFacadeLayer, generateGroundLayer, generateInteriorLayer } from '../build/texgen';
import type { FromTex, ToTex } from './texProtocol';
import { serve } from './serve';

function handle(m: ToTex): FromTex {
  if (m.type === 'init') return { type: 'ready' };
  const t0 = performance.now();
  const gen = m.family === 'facade' ? generateFacadeLayer : m.family === 'interior' ? generateInteriorLayer : generateGroundLayer;
  const layer = gen(m.index, m.size);
  return { type: 'layer', family: m.family, index: m.index, albedo: layer.albedo, normal: layer.normal, ms: Math.round(performance.now() - t0) };
}

serve<ToTex, FromTex>(handle, (r) => (r.type === 'layer' ? [r.albedo.buffer, r.normal.buffer] : []));
