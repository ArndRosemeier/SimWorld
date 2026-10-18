/**
 * Growable struct-of-arrays storage. Component tables (actors, people, animals, relations, beliefs) are typed
 * arrays indexed by a row number, so 2,000 people plus animals tick without per-agent objects.
 */

type Typed = Float32Array | Float64Array | Int32Array | Uint8Array | Uint16Array | Uint32Array;
type TypedCtor = { new (n: number): Typed };

/**
 * A set of typed-array columns sharing one row count. Columns are declared as `{ name: [Ctor, width, fill] }`;
 * width > 1 gives `width` values per row (needs, Big Five) laid out row-major.
 */
export class Columns<S extends Record<string, readonly [TypedCtor, number, number]>> {
  count = 0;
  capacity: number;
  readonly cols: { [K in keyof S]: InstanceType<S[K][0]> };
  private readonly spec: S;

  constructor(spec: S, capacity = 64) {
    this.spec = spec;
    this.capacity = Math.max(1, capacity);
    const cols = {} as Record<string, Typed>;
    for (const k of Object.keys(spec)) cols[k] = this.alloc(k, this.capacity);
    this.cols = cols as { [K in keyof S]: InstanceType<S[K][0]> };
  }

  private alloc(k: string, rows: number): Typed {
    const [Ctor, width, fill] = this.spec[k];
    const a = new Ctor(rows * width);
    if (fill !== 0) a.fill(fill);
    return a;
  }

  /** Append one row (filled with each column's default) and return its index. */
  add(): number {
    if (this.count === this.capacity) {
      const next = this.capacity * 2;
      const cols = this.cols as Record<string, Typed>;
      for (const k of Object.keys(this.spec)) {
        const a = this.alloc(k, next);
        a.set(cols[k] as never);
        cols[k] = a;
      }
      this.capacity = next;
    }
    return this.count++;
  }

  /** Reset row `r` to the column defaults (for free-list reuse). */
  clear(r: number): void {
    const cols = this.cols as Record<string, Typed>;
    for (const k of Object.keys(this.spec)) {
      const [, width, fill] = this.spec[k];
      cols[k].fill(fill, r * width, r * width + width);
    }
  }
}

/**
 * A derived component table (people, animals): typed columns plus per-row strings, each row pointing back at its
 * actor. One shape for both so systems treat them alike.
 */
export class DerivedTable<S extends Record<string, readonly [TypedCtor, number, number]>> {
  readonly t: Columns<S>;
  constructor(spec: S, capacity: number) { this.t = new Columns(spec, capacity); }
  get count(): number { return this.t.count; }
  get cols(): Columns<S>['cols'] { return this.t.cols; }

  /** Append a row that belongs to `actor` (needs an `actor` column). */
  protected rowFor(actor: number): number {
    const r = this.t.add();
    (this.t.cols as unknown as { actor: Int32Array }).actor[r] = actor;
    return r;
  }
}

/** Column spec helper so call sites read `f32()`, `i32(-1)`, `f32(5)` (width 5). */
export const f32 = (width = 1, fill = 0) => [Float32Array, width, fill] as const;
export const f64 = (width = 1, fill = 0) => [Float64Array, width, fill] as const;
export const i32 = (fill = 0, width = 1) => [Int32Array, width, fill] as const;
export const u8 = (fill = 0, width = 1) => [Uint8Array, width, fill] as const;
export const u16 = (fill = 0, width = 1) => [Uint16Array, width, fill] as const;
