/**
 * The one worker pool: every worker of the game is made here (guarded), with a priority queue,
 * so off-main-thread work has one way in. Jobs go to the least busy worker, at most two in
 * flight per worker. Ported from Scale (src/stream/WorkerPool.ts), made generic over the
 * worker's messages: each message has a `type`; a job's reply carries its `job` number back, an
 * `{ type: 'error', message }` reply rejects it.
 */
export interface PoolMessage { type: string }
export type Reply<T> = T & { job?: number };

type Job<In, Out> = { msg: In & { job?: number }; priority: number; resolve: (r: Out) => void; reject: (e: Error) => void };

export class WorkerPool<In extends PoolMessage, Out extends PoolMessage> {
  private workers: Worker[] = [];
  private busy: number[] = [];
  private queue: Job<In, Out>[] = [];
  private pending = new Map<number, Job<In, Out>>();
  private nextJob = 1;

  /** `url`: the worker module, imported as `import url from './x.worker.ts?worker&url'` so Vite bundles it. */
  constructor(private readonly url: string, readonly size: number) {}

  /** Start the workers and send each `init(i)`; resolves with their first replies. */
  async start(init: (i: number) => In): Promise<Out[]> {
    const ready: Promise<Out>[] = [];
    for (let i = 0; i < this.size; i++) {
      const w = new Worker(this.url, { type: 'module' });
      this.workers.push(w);
      this.busy.push(0);
      ready.push(new Promise((res, rej) => {
        w.onmessage = (ev: MessageEvent<Out>) => (ev.data.type === 'error' ? rej(new Error((ev.data as unknown as { message: string }).message)) : res(ev.data));
        w.onerror = (e) => rej(new Error(e.message));
      }));
      w.postMessage(init(i));
    }
    const replies = await Promise.all(ready);
    this.workers.forEach((w, i) => {
      w.onmessage = (ev: MessageEvent<Reply<Out>>) => this.onMessage(i, ev.data);
      w.onerror = (e) => console.error('worker error', e.message);
    });
    return replies;
  }

  /** Queue a job; a lower priority value runs first. */
  run<T extends Out>(msg: In, priority: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const job: Job<In, Out> = { msg: { ...msg, job: this.nextJob++ }, priority, resolve: resolve as (r: Out) => void, reject };
      this.queue.push(job);
      this.pump();
    });
  }

  get queued(): number { return this.queue.length; }
  get inFlight(): number { return this.pending.size; }

  private pump(): void {
    while (this.queue.length) {
      let wi = -1, best = Infinity;
      for (let i = 0; i < this.workers.length; i++) if (this.busy[i] < best) { best = this.busy[i]; wi = i; }
      if (best >= 2) return;
      let ji = 0;
      for (let i = 1; i < this.queue.length; i++) if (this.queue[i].priority < this.queue[ji].priority) ji = i;
      const job = this.queue.splice(ji, 1)[0];
      this.pending.set(job.msg.job!, job);
      this.busy[wi]++;
      this.workers[wi].postMessage(job.msg);
    }
  }

  private onMessage(wi: number, m: Reply<Out>): void {
    const job = this.pending.get(m.job ?? -1);
    this.busy[wi] = Math.max(0, this.busy[wi] - 1);
    if (job) {
      this.pending.delete(m.job!);
      if (m.type === 'error') job.reject(new Error((m as unknown as { message: string }).message));
      else job.resolve(m);
    } else if (m.type === 'error') console.error((m as unknown as { message: string }).message);
    this.pump();
  }

  dispose(): void {
    for (const w of this.workers) w.terminate();
    this.workers = [];
  }
}
