/**
 * The one renderer (guarded: nothing else may construct one). three.js WebGPURenderer on its WebGL 2
 * backend (Arnd, 2026-10-18: SimWorld runs on WebGL 2). Materials are written once in TSL, so WebGPU
 * stays a switch (`?gpu=webgpu`), not a rewrite.
 */
import { ACESFilmicToneMapping, WebGPURenderer } from 'three/webgpu';

export interface RendererInfo {
  renderer: WebGPURenderer;
  /** Which backend three.js picked. */
  backend: 'webgpu' | 'webgl2';
}

/**
 * Thrown by `createRenderer` when the browser can draw neither with WebGPU nor with WebGL 2 (or the
 * one it offers will not start): the page shows a plain message instead of a black screen.
 */
export class GraphicsUnavailable extends Error {
  constructor(readonly why: string) {
    super(`No 3D graphics: ${why}`);
  }
}

/** Which of the two backends this browser offers, before trying either (WebGPU's adapter is asked for later). */
export function graphicsSupport(): { webgpu: boolean; webgl2: boolean } {
  const webgpu = typeof navigator !== 'undefined' && 'gpu' in navigator && !!(navigator as { gpu?: unknown }).gpu;
  let webgl2 = false;
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    webgl2 = !!gl;
    gl?.getExtension('WEBGL_lose_context')?.loseContext(); // a browser keeps only so many contexts
  } catch { /* none */ }
  return { webgpu, webgl2 };
}

export async function createRenderer(canvas: HTMLCanvasElement, opts: { forceWebGL?: boolean } = {}): Promise<RendererInfo> {
  const support = graphicsSupport();
  const forceWebGL = opts.forceWebGL ?? true;
  if (!support.webgl2 && (!support.webgpu || forceWebGL)) throw new GraphicsUnavailable('this browser offers neither WebGPU nor WebGL 2');
  const renderer = new WebGPURenderer({ canvas, antialias: true, forceWebGL });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  // Filmic tone mapping (applied in the output pass, so no material shader changes with it).
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = EXPOSURE;
  // three.js falls back to WebGL 2 by itself when WebGPU has no adapter; only both failing ends here.
  try { await renderer.init(); } catch (err) {
    throw new GraphicsUnavailable(err instanceof Error ? err.message : String(err));
  }
  const backend = (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend ? 'webgpu' : 'webgl2';
  return { renderer, backend };
}

/** Exposure for the tone mapping. */
export const EXPOSURE = 1.0;
