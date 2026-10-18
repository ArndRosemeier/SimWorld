/**
 * The worker side of the worker pool (src/workers/pool.ts): answer each message with `handle`'s reply,
 * tagged with the message's job id, its buffers transferred (`transfer`); a throw (or a rejection) is
 * answered with `{ type: 'error', message }`, which rejects the job on the pool's side. Every worker
 * serves through this.
 */
export function serve<In, Out extends object>(handle: (m: In) => Out | Promise<Out>, transfer: (r: Out) => Transferable[] = () => []): void {
  const post = (msg: unknown, list: Transferable[] = []) => (self as unknown as Worker).postMessage(msg, list);
  self.onmessage = (ev: MessageEvent<In & { job?: number }>) => {
    const job = ev.data.job;
    const fail = (err: unknown) => post({ type: 'error', job, message: err instanceof Error ? `${err.message}\n${err.stack}` : String(err) });
    try {
      Promise.resolve(handle(ev.data)).then((r) => post({ ...r, job }, transfer(r)), fail);
    } catch (err) {
      fail(err);
    }
  };
}
