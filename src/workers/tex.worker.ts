/**
 * A texture worker: generates one material texture layer per job (src/workers/texProtocol.ts)
 * with src/build/texgen and transfers its two RGBA8 buffers back. Started by the worker pool
 * only. Ported from Scale (src/render/tex.worker.ts).
 */
import { generateFacadeLayer, generateGroundLayer } from '../build/texgen';
import type { FromTex, ToTex } from './texProtocol';

function handle(m: ToTex): FromTex {
  if (m.type === 'init') return { type: 'ready' };
  const t0 = performance.now();
  const layer = m.family === 'facade' ? generateFacadeLayer(m.index, m.size) : generateGroundLayer(m.index, m.size);
  return { type: 'layer', family: m.family, index: m.index, albedo: layer.albedo, normal: layer.normal, ms: Math.round(performance.now() - t0) };
}

self.onmessage = (ev: MessageEvent<ToTex & { job?: number }>) => {
  const job = ev.data.job;
  try {
    const r = handle(ev.data);
    (self as unknown as Worker).postMessage({ ...r, job }, r.type === 'layer' ? [r.albedo.buffer, r.normal.buffer] : []);
  } catch (err) {
    (self as unknown as Worker).postMessage({ type: 'error', job, message: err instanceof Error ? `${err.message}\n${err.stack}` : String(err) });
  }
};
