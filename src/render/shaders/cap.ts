/**
 * The shader cap (docs/SHADERS.md): after the warm-up, one shader build at a time, and the next one
 * starts only after a pause of at least `gapMs` after the previous build *finished*, at most
 * `maxPerSecond` starts per second and one per frame. During warm-up (`active = false`) builds run
 * at full speed.
 *
 * Ported from Dunfinity (src/render/shaders/cap.ts), itself from Scale (src/render/shaderCap.ts).
 * Change for SimWorld (Arnd, 2026-10-18): the 200 ms pause is counted from the end of the previous
 * build, and only one build is in flight, so driver work never overlaps.
 */
export class ShaderCap {
  maxPerSecond = 5;
  /** Minimum pause between the end of one build and the start of the next. */
  gapMs = 200;
  /** Off during warm-up. */
  active = false;
  /** Builds waiting for room right now. */
  waiting = 0;
  /** A build that took a slot and has not released it yet. */
  private busy = false;
  private spent: number[] = [];
  private lastEnd = -1e9;
  private frameTaken = false;

  constructor(private readonly now: () => number = () => performance.now(), private readonly nextFrame: (fn: () => void) => void = (fn) => requestAnimationFrame(fn)) {}

  /** Once per frame, before anything starts a build. */
  newFrame(): void { this.frameTaken = false; }

  private lastSecond(t: number): number {
    while (this.spent.length && this.spent[0] <= t - 1000) this.spent.shift();
    return this.spent.length;
  }

  room(): boolean {
    if (!this.active || this.maxPerSecond <= 0) return true;
    const t = this.now();
    return !this.busy && !this.frameTaken && t - this.lastEnd >= this.gapMs && this.lastSecond(t) < this.maxPerSecond;
  }

  /** Book one build starting now; the returned function must be called when it has finished. */
  take(): () => void {
    const t = this.now();
    this.frameTaken = true;
    this.spent.push(t);
    if (!this.active) return () => undefined;
    this.busy = true;
    let done = false;
    return () => {
      if (done) return;
      done = true;
      this.busy = false;
      this.lastEnd = this.now();
    };
  }

  /** Resolves on a frame with room, takes it, and hands back the release for when the build is done. */
  slot(): Promise<() => void> {
    if (this.room()) return Promise.resolve(this.take());
    this.waiting++;
    return new Promise((res) => {
      const again = (): void => {
        if (!this.room()) { this.nextFrame(again); return; }
        this.waiting--;
        res(this.take());
      };
      this.nextFrame(again);
    });
  }
}
