/**
 * Shader monitor (docs/SHADERS.md): records every shader build and how long it blocked the main
 * thread, and checks the policy: never over 100 ms (hard), about 10 ms for a normal shader (target:
 * slower ones are listed as warnings), and after warm-up one build at a time, the next starting at
 * least 200 ms after the previous one finished, at most 5 starts per second.
 * `window.shaders.report()` in the console; the HUD shows a summary.
 */
export type Phase = 'warmup' | 'run';
export type BuildKind = 'node-sync' | 'node-async' | 'gpu-module' | 'gpu-pipeline-sync' | 'gpu-pipeline-async' | 'gl-link';

export interface ShaderEvent { t: number; kind: BuildKind; ms: number; what: string; phase: Phase }

/** Which kinds stall the main thread while they run (the async ones yield or run off-thread). */
const BLOCKING: ReadonlySet<BuildKind> = new Set(['node-sync', 'gpu-module', 'gpu-pipeline-sync', 'gl-link']);
/** Which kinds start a new shader (counted against the cap). */
const STARTS: ReadonlySet<BuildKind> = new Set(['node-sync', 'node-async']);

export class ShaderMonitor {
  /** Hard upper bound for one build (Arnd's rule). */
  readonly budgetMs = 100;
  /** What a normal shader should take; slower ones are warnings, not violations. */
  readonly targetMs = 10;
  /** Minimum pause between the end of one build and the start of the next, after warm-up. */
  readonly gapMs = 200;
  readonly maxPerSecond = 5;
  phase: Phase = 'warmup';
  /** Why the render path builds right now, if on purpose (appended to what synchronous builds record), e.g. the Stage's shadow warm-up. */
  note = '';
  readonly events: ShaderEvent[] = [];

  constructor(private readonly now: () => number = () => performance.now()) {}

  record(kind: BuildKind, ms: number, what: string, t = this.now() - ms): void {
    // The note says why the render path builds: it marks synchronous builds only.
    this.events.push({ t, kind, ms, what: this.note && kind === 'node-sync' ? `${what} (${this.note})` : what, phase: this.phase });
  }

  /** Time a synchronous piece of work as one event. */
  time<T>(kind: BuildKind, what: string, fn: () => T): T {
    const t0 = this.now();
    try { return fn(); } finally { this.record(kind, this.now() - t0, what, t0); }
  }

  /** Policy breaches, one line each (empty: the policy holds). */
  violations(): string[] {
    const out: string[] = [];
    for (const e of this.events) {
      if (BLOCKING.has(e.kind) && e.ms > this.budgetMs) out.push(`${e.phase}: ${e.kind} "${e.what}" blocked ${e.ms.toFixed(0)} ms (budget ${this.budgetMs} ms)`);
    }
    const runs = this.events.filter((e) => e.phase === 'run' && STARTS.has(e.kind)).sort((a, b) => a.t - b.t);
    for (let i = 0; i < runs.length; i++) {
      const prevEnd = i > 0 ? runs[i - 1].t + runs[i - 1].ms : -Infinity;
      if (runs[i].t - prevEnd < this.gapMs - 1) out.push(`run: "${runs[i].what}" started ${(runs[i].t - prevEnd).toFixed(0)} ms after the previous build ended (minimum ${this.gapMs} ms)`);
      const inSecond = runs.filter((s) => s.t > runs[i].t - 1000 && s.t <= runs[i].t).length;
      if (inSecond > this.maxPerSecond) out.push(`run: ${inSecond} shader builds within one second (maximum ${this.maxPerSecond})`);
    }
    return out;
  }

  /** Builds over the ~10 ms target (but within the hard budget): worth making cheaper. */
  warnings(): string[] {
    return this.events.filter((e) => BLOCKING.has(e.kind) && e.ms > this.targetMs && e.ms <= this.budgetMs)
      .map((e) => `${e.phase}: ${e.kind} "${e.what}" took ${e.ms.toFixed(0)} ms (target ${this.targetMs} ms)`);
  }

  summary(): { warmup: number; run: number; worstMs: number; violations: number; warnings: number } {
    const blocking = this.events.filter((e) => BLOCKING.has(e.kind));
    return {
      warmup: this.events.filter((e) => e.phase === 'warmup' && STARTS.has(e.kind)).length,
      run: this.events.filter((e) => e.phase === 'run' && STARTS.has(e.kind)).length,
      worstMs: blocking.reduce((m, e) => Math.max(m, e.ms), 0),
      violations: this.violations().length,
      warnings: this.warnings().length,
    };
  }

  report(): string {
    const s = this.summary();
    return [`shaders: ${s.warmup} built in warm-up, ${s.run} after, worst block ${s.worstMs.toFixed(0)} ms, ${s.violations} violations, ${s.warnings} over the ${this.targetMs} ms target`, ...this.violations(), ...this.warnings()].join('\n');
  }
}
