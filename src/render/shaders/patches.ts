/**
 * Renderer hooks that enforce the shader policy (docs/SHADERS.md). They reach into three.js r186
 * internals (`_nodes`, `_pipelines`), each guarded: if a three update renames them, the hook is
 * skipped and `installShaderPolicy` says which, so the monitor still shows what happens.
 * Adapted from Dunfinity, which adapted it from Scale (src/render/webgpu/index.ts).
 */
import { BufferAttribute, InterleavedBuffer, DynamicDrawUsage, StaticDrawUsage, type WebGPURenderer } from 'three/webgpu';
import type { ShaderCap } from './cap';
import type { ShaderMonitor } from './monitor';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

/** Every hook that could not be installed (empty: all in place). */
export function installShaderPolicy(renderer: WebGPURenderer, cap: ShaderCap, monitor: ShaderMonitor): string[] {
  const missing: string[] = [];
  if (!queueNodeBuilds(renderer, cap, monitor)) missing.push('node build queue');
  if (!asyncDrawPipelines(renderer)) missing.push('async draw pipelines');
  noPerFrameUploads();
  timeGpu(monitor);
  return missing;
}

/**
 * Node (TSL → WGSL/GLSL) builds: a build that really happens (not a cache hit) is timed and
 * recorded. Async builds (compileAsync, i.e. the Stage) run one at a time, and each waits for room
 * under the cap. A synchronous build means something was drawn that the Stage never compiled: it
 * cannot wait, but the monitor records it, so the steady-state check fails.
 */
function queueNodeBuilds(renderer: WebGPURenderer, cap: ShaderCap, monitor: ShaderMonitor): boolean {
  const nodes = (renderer as Any)._nodes;
  const getForRender = nodes?.getForRender;
  if (typeof getForRender !== 'function' || typeof nodes.getForRenderCacheKey !== 'function' || !nodes.nodeBuilderCache) return false;
  const needsBuild = (ro: Any): boolean => nodes.get(ro).nodeBuilderState === undefined && !nodes.nodeBuilderCache.has(nodes.getForRenderCacheKey(ro));
  /** The material, and for a pass's own material (a shadow's) the object drawn, by the names up its parents. */
  const label = (ro: Any): string => {
    const own = ro?.object?.material === ro?.material || (Array.isArray(ro?.object?.material) && ro.object.material.includes(ro.material));
    const names: string[] = [];
    for (let o = ro?.object; o && names.length < 3; o = o.parent) if (o.name) names.push(o.name);
    return `${ro?.material?.name || ro?.material?.type || '?'}${ro?.object?.isInstancedMesh ? ' (instanced)' : ''}${own ? '' : ` of ${ro?.object?.type ?? '?'}${names.length ? ` ${names.join('<')}` : ''}`}`;
  };
  let last: Promise<unknown> = Promise.resolve();
  nodes.getForRender = function (this: Any, ro: Any, useAsync = false) {
    if (!needsBuild(ro)) return getForRender.call(this, ro, useAsync);
    if (!useAsync) return monitor.time('node-sync', label(ro), () => getForRender.call(this, ro, false));
    const run = last.then(async () => {
      // An identical object queued earlier may have built this shader meanwhile: then it is a cache hit.
      if (!needsBuild(ro)) return getForRender.call(this, ro, true);
      const release = await cap.slot();
      const t0 = performance.now();
      return Promise.resolve(getForRender.call(this, ro, true)).finally(() => {
        monitor.record('node-async', performance.now() - t0, label(ro), t0);
        release();
      });
    });
    last = run.catch(() => undefined);
    return run;
  };
  return true;
}

/**
 * A pipeline nobody compiled ahead is created while drawing, blocking the frame (~0.1 s each).
 * Created async instead, the object is skipped until its pipeline is ready (three checks `isReady`
 * before every draw), so it shows up a few frames later instead of stalling.
 */
const MAX_DRAW_PIPES = 6;
function asyncDrawPipelines(renderer: WebGPURenderer): boolean {
  const pipelines = (renderer as Any)._pipelines;
  if (typeof pipelines?.updateForRender !== 'function' || typeof pipelines.getForRender !== 'function') return false;
  let inFlight = 0;
  const sink = { push(p: Promise<unknown>): void { inFlight++; void p.finally(() => inFlight--); } };
  pipelines.updateForRender = function (this: Any, ro: Any) {
    if (inFlight >= MAX_DRAW_PIPES && this.get(ro).pipeline === undefined) return;
    this.getForRender(ro, sink);
  };
  return true;
}

/** WebGPU uploads DynamicDrawUsage attributes whole on every frame; we mark changes with `needsUpdate`. */
let uploadsPatched = false;
function noPerFrameUploads(): void {
  if (uploadsPatched) return;
  uploadsPatched = true;
  for (const C of [BufferAttribute, InterleavedBuffer]) {
    const P = C.prototype as unknown as { setUsage(u: number): unknown };
    const set = P.setUsage;
    P.setUsage = function (this: unknown, u: number) { return set.call(this, u === DynamicDrawUsage ? StaticDrawUsage : u); };
  }
}

/** GPU-side costs: WebGPU shader modules and pipelines, WebGL program links. */
let gpuTimed = false;
function timeGpu(monitor: ShaderMonitor): void {
  if (gpuTimed) return;
  gpuTimed = true;
  const wrap = (proto: Any, name: string, kind: Parameters<ShaderMonitor['record']>[0]) => {
    const f = proto?.[name];
    if (typeof f !== 'function') return;
    proto[name] = function (this: unknown, ...a: unknown[]) { return monitor.time(kind, name, () => f.apply(this, a)); };
  };
  const D = (globalThis as Any).GPUDevice?.prototype;
  wrap(D, 'createShaderModule', 'gpu-module');
  wrap(D, 'createRenderPipeline', 'gpu-pipeline-sync');
  const fa = D?.createRenderPipelineAsync;
  if (typeof fa === 'function') {
    D.createRenderPipelineAsync = function (this: unknown, ...a: unknown[]) {
      const t0 = performance.now();
      const p = fa.apply(this, a) as Promise<unknown>;
      const end = () => monitor.record('gpu-pipeline-async', performance.now() - t0, 'pipeline', t0);
      p.then(end, end);
      return p;
    };
  }
  // WebGL 2 backend: linking is where a driver compiles (and getProgramParameter waits for it).
  const G = (globalThis as Any).WebGL2RenderingContext?.prototype;
  wrap(G, 'linkProgram', 'gl-link');
}
