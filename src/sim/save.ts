/**
 * Saves (plan §1.2): the whole society as one byte array, and back. The sim worker calls `saveWorld` and hands the
 * bytes to `src/persist`; on load the worker plans the town again from its seed (the plan is deterministic) and calls
 * `loadWorld` with that plan.
 *
 * What is saved is every field of `World` except what is derived from the place graph (travel, kindOf, streetOf). The
 * places themselves are saved, because the town changes them (a closed shop becomes a vacant unit, `setPlaceKind`).
 * Random numbers come from `tickRng(world, …)` (seed, clock, purpose), so there is no generator state to save, and a
 * loaded world goes on exactly as the saved one would have.
 *
 * Format: "SWS" + version byte, a JSON header (the object tree), then the typed arrays it points at, each aligned to
 * 8 bytes. The encoder is generic, so new fields need no save code; an object it cannot restore (a class it does not
 * know, a function) fails the save loudly and the save test catches it.
 */
import { Columns } from './table';
import { PersonTable } from './people';
import { AnimalTable } from './animals';
import { Relations } from './relations';
import type { PlaceGraph } from './places';
import { placeIndex, type World } from './world';

const VERSION = 1;
const MAGIC = [0x53, 0x57, 0x53]; // "SWS"

/** Classes a save may hold, restored by prototype (their constructors are not run). */
const CLASSES: Record<string, object> = {
  Columns: Columns.prototype, PersonTable: PersonTable.prototype, AnimalTable: AnimalTable.prototype, Relations: Relations.prototype,
};
const CLASS_OF = new Map<object, string>(Object.entries(CLASSES).map(([k, v]) => [v, k]));
const TYPED = { Float32Array, Float64Array, Int32Array, Uint8Array, Uint16Array, Uint32Array, Int8Array, Int16Array } as const;
type TypedName = keyof typeof TYPED;
type Typed = InstanceType<(typeof TYPED)[TypedName]>;
const TYPED_NAME = new Map<unknown, TypedName>(Object.entries(TYPED).map(([k, v]) => [v, k as TypedName]));
/** Fields of `World` rebuilt from the graph on load. */
const DERIVED = new Set(['graph', 'travel', 'kindOf', 'streetOf']);

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

/** Is `v` an object that may be shared or cyclic (encoded once, then referred to)? */
const isRef = (v: unknown): v is object => typeof v === 'object' && v !== null;

class Encoder {
  readonly buffers: Typed[] = [];
  private readonly seen = new Map<object, number>();
  private readonly ids = new Map<object, number>();
  private nextId = 0;

  /** First pass: count how often each object is reached, so only shared ones carry an id. */
  count(v: unknown): void {
    if (!isRef(v)) return;
    const n = this.seen.get(v) ?? 0;
    this.seen.set(v, n + 1);
    if (n > 0) return;
    if (ArrayBuffer.isView(v)) return;
    if (Array.isArray(v)) { for (const x of v) this.count(x); return; }
    if (v instanceof Map) { for (const [k, x] of v) { this.count(k); this.count(x); } return; }
    if (v instanceof Set) { for (const x of v) this.count(x); return; }
    for (const k of Object.keys(v)) this.count((v as Record<string, unknown>)[k]);
  }

  encode(v: unknown, path: string): Json {
    switch (typeof v) {
      case 'number': return Number.isFinite(v) ? v : { $n: String(v) };
      case 'string': case 'boolean': return v;
      case 'undefined': return { $u: 1 };
      case 'function': {
        const t = TYPED_NAME.get(v);
        if (t) return { $f: t };
        throw new Error(`save: a function at ${path} cannot be saved`);
      }
      case 'object': break;
      default: throw new Error(`save: a ${typeof v} at ${path} cannot be saved`);
    }
    if (v === null) return null;
    const known = this.ids.get(v);
    if (known !== undefined) return { $ref: known };
    if ((this.seen.get(v) ?? 0) > 1) {
      const id = this.nextId++;
      this.ids.set(v, id);
      return { $id: id, v: this.body(v, path) };
    }
    return this.body(v, path);
  }

  private body(v: object, path: string): Json {
    if (ArrayBuffer.isView(v)) {
      const t = TYPED_NAME.get(v.constructor);
      if (!t) throw new Error(`save: a ${v.constructor.name} at ${path} cannot be saved`);
      this.buffers.push(v as Typed);
      return { $t: t, i: this.buffers.length - 1 };
    }
    if (Array.isArray(v)) return v.map((x, i) => this.encode(x, `${path}[${i}]`));
    if (v instanceof Map) return { $m: [...v].map(([k, x]) => [this.encode(k, `${path}.key`), this.encode(x, `${path}.get(${String(k)})`)]) };
    if (v instanceof Set) return { $s: [...v].map((x) => this.encode(x, `${path}.item`)) };
    const proto = Object.getPrototypeOf(v);
    const cls = proto === Object.prototype || proto === null ? null : CLASS_OF.get(proto);
    if (cls === undefined) throw new Error(`save: a ${proto?.constructor?.name ?? 'object'} at ${path} cannot be saved (add its class to CLASSES in src/sim/save.ts)`);
    const out: Record<string, Json> = {};
    for (const k of Object.keys(v)) {
      if (k.startsWith('$')) throw new Error(`save: the key ${k} at ${path} clashes with the save format`);
      out[k] = this.encode((v as Record<string, unknown>)[k], `${path}.${k}`);
    }
    return cls ? { $c: cls, f: out } : out;
  }
}

class Decoder {
  private readonly refs = new Map<number, unknown>();
  constructor(private readonly buffers: Typed[]) {}

  decode(j: Json): unknown {
    if (j === null || typeof j !== 'object') return j;
    if (Array.isArray(j)) return this.fill([], j);
    if ('$n' in j) return Number(j.$n);
    if ('$u' in j) return undefined;
    if ('$f' in j) return TYPED[j.$f as TypedName];
    if ('$ref' in j) return this.refs.get(j.$ref as number);
    if ('$id' in j) return this.decodeShared(j.$id as number, j.v);
    return this.fill(this.shell(j), j);
  }

  /** A shared object: its shell is registered before its contents, so cycles resolve. */
  private decodeShared(id: number, j: Json): unknown {
    if (j === null || typeof j !== 'object' || '$t' in (j as object)) { const v = this.decode(j); this.refs.set(id, v); return v; }
    const shell = Array.isArray(j) ? [] : this.shell(j as { [k: string]: Json });
    this.refs.set(id, shell);
    return this.fill(shell, j);
  }

  private shell(j: { [k: string]: Json }): object {
    if ('$t' in j) return this.buffers[j.i as number];
    if ('$m' in j) return new Map();
    if ('$s' in j) return new Set();
    if ('$c' in j) {
      const proto = CLASSES[j.$c as string];
      if (!proto) throw new Error(`load: unknown class ${String(j.$c)}`);
      return Object.create(proto);
    }
    return {};
  }

  private fill(shell: object, j: Json): unknown {
    if (Array.isArray(j)) { for (const x of j) (shell as unknown[]).push(this.decode(x)); return shell; }
    const o = j as { [k: string]: Json };
    if ('$t' in o) return shell;
    if ('$m' in o) { for (const [k, x] of o.$m as Json[][]) (shell as Map<unknown, unknown>).set(this.decode(k), this.decode(x)); return shell; }
    if ('$s' in o) { for (const x of o.$s as Json[]) (shell as Set<unknown>).add(this.decode(x)); return shell; }
    const fields = '$c' in o ? (o.f as { [k: string]: Json }) : o;
    for (const k of Object.keys(fields)) (shell as Record<string, unknown>)[k] = this.decode(fields[k]);
    return shell;
  }
}

/** The world as bytes. The planned graph it was made from is not in them: `loadWorld` takes it again. */
export function saveWorld(world: World): Uint8Array {
  const state: Record<string, unknown> = { version: VERSION, places: world.graph.places };
  for (const k of Object.keys(world)) if (!DERIVED.has(k)) state[k] = (world as unknown as Record<string, unknown>)[k];
  const enc = new Encoder();
  enc.count(state);
  const header = new TextEncoder().encode(JSON.stringify(enc.encode(state, 'world')));
  const align = (n: number) => (n + 7) & ~7;
  let size = align(8 + header.length);
  const offsets = enc.buffers.map((b) => { const at = size; size = align(size + b.byteLength); return at; });
  const out = new Uint8Array(size);
  out.set(MAGIC, 0);
  out[3] = VERSION;
  new DataView(out.buffer).setUint32(4, header.length, true);
  out.set(header, 8);
  enc.buffers.forEach((b, i) => out.set(new Uint8Array(b.buffer, b.byteOffset, b.byteLength), offsets[i]));
  // The buffer table (type is in the header; offsets and lengths go last so the header stays one JSON value).
  const table = JSON.stringify(enc.buffers.map((b, i) => [offsets[i], b.length]));
  const tail = new TextEncoder().encode(table);
  const all = new Uint8Array(size + tail.length + 4);
  all.set(out, 0);
  all.set(tail, size);
  new DataView(all.buffer).setUint32(size + tail.length, tail.length, true);
  return all;
}

/**
 * The world from bytes, on the town planned again from its seed (`planned` must be that plan: the same town).
 * Throws on bytes that are not a SimWorld save or come from another save version.
 */
export function loadWorld(planned: PlaceGraph, bytes: Uint8Array): World {
  if (bytes.length < 12 || MAGIC.some((m, i) => bytes[i] !== m)) throw new Error('load: not a SimWorld save');
  if (bytes[3] !== VERSION) throw new Error(`load: save version ${bytes[3]}, this build reads ${VERSION}`);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const headerLen = dv.getUint32(4, true);
  const tailLen = dv.getUint32(bytes.length - 4, true);
  const td = new TextDecoder();
  const table = JSON.parse(td.decode(bytes.subarray(bytes.length - 4 - tailLen, bytes.length - 4))) as [number, number][];
  const header = JSON.parse(td.decode(bytes.subarray(8, 8 + headerLen))) as Json;
  // Copy each array out (aligned, and independent of the save's buffer).
  const types = typesOf(header);
  const buffers = table.map(([at, n], i) => {
    const C = TYPED[types[i]];
    const copy = new C(n);
    new Uint8Array(copy.buffer).set(bytes.subarray(at, at + copy.byteLength));
    return copy;
  });
  const state = new Decoder(buffers).decode(header) as Record<string, unknown>;
  const places = state.places as PlaceGraph['places'];
  if (places.length < planned.places.length || places.slice(0, planned.places.length).some((p, i) => p.id !== planned.places[i].id || p.street !== planned.places[i].street)) {
    throw new Error('load: the save belongs to another town');
  }
  const graph: PlaceGraph = { ...planned, places };
  delete state.version;
  delete state.places;
  return { ...(state as unknown as World), graph, ...placeIndex(graph) };
}

/** Typed-array kind per buffer index, from the header. */
function typesOf(j: Json, out: TypedName[] = []): TypedName[] {
  if (j === null || typeof j !== 'object') return out;
  if (Array.isArray(j)) { for (const x of j) typesOf(x, out); return out; }
  if ('$t' in j) { out[j.i as number] = j.$t as TypedName; return out; }
  for (const k of Object.keys(j)) typesOf(j[k], out);
  return out;
}
