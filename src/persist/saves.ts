/**
 * Saves of the world in the browser (plan §1.2). A save is about 10 MB (`saveWorld`), too big for localStorage, so
 * it goes to IndexedDB, gzipped on the way in where the browser has CompressionStream. The one place that touches
 * IndexedDB (guarded). Every call survives storage being blocked (private windows): a read finds nothing, a write
 * is dropped and says so.
 */
const DB = 'simworld';
const STORE = 'saves';

/** A stored save: its bytes (as `saveWorld` made them) and when it was made. */
export interface StoredSave {
  bytes: Uint8Array;
  /** Game clock of the save. */
  clock: number;
  /** Real time it was stored (ms since 1970). */
  storedAt: number;
}

interface Row { packed: Uint8Array; gzip: boolean; clock: number; storedAt: number }

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function request<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  return open().then((db) => new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = run(tx.objectStore(STORE));
    tx.oncomplete = () => { db.close(); resolve(req.result as T); };
    tx.onerror = tx.onabort = () => { db.close(); reject(tx.error); };
  }));
}

/** Bytes through a gzip (de)compression stream. */
async function through(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Response(new Blob([bytes as Uint8Array<ArrayBuffer>]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}

/** Store `bytes` under `key` (one save per key; a new one replaces it). False when storage is unavailable. */
export async function storeSave(key: string, bytes: Uint8Array, clock: number): Promise<boolean> {
  try {
    const gzip = typeof CompressionStream === 'function';
    const row: Row = { packed: gzip ? await through(bytes, new CompressionStream('gzip')) : bytes, gzip, clock, storedAt: Date.now() };
    await request('readwrite', (s) => s.put(row, key));
    return true;
  } catch (e) {
    console.warn('save not stored', e);
    return false;
  }
}

/** The save under `key`, or null when there is none (or storage is unavailable). */
export async function readSave(key: string): Promise<StoredSave | null> {
  try {
    const row = await request<Row | undefined>('readonly', (s) => s.get(key));
    if (!row) return null;
    const bytes = row.gzip ? await through(row.packed, new DecompressionStream('gzip')) : row.packed;
    return { bytes, clock: row.clock, storedAt: row.storedAt };
  } catch (e) {
    console.warn('save not read', e);
    return null;
  }
}

/** Forget the save under `key`. */
export async function dropSave(key: string): Promise<void> {
  try { await request('readwrite', (s) => s.delete(key)); } catch { /* storage unavailable */ }
}
