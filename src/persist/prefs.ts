/**
 * The player's small preferences (volume, mute, the sound mix), kept in the browser between
 * sessions. The one place that touches localStorage (guarded); saves of the world come here too
 * when they exist. Every call survives storage being blocked (private windows): reads fall back to
 * the default, writes are dropped.
 */
const PREFIX = 'simworld.';

export function readPref(key: string): string | null {
  try { return localStorage.getItem(PREFIX + key); } catch { return null; }
}

export function writePref(key: string, value: string): void {
  try { localStorage.setItem(PREFIX + key, value); } catch { /* storage unavailable */ }
}

/** A stored number, or `def` when missing or not a number. */
export function readNumPref(key: string, def: number): number {
  const v = readPref(key);
  return v === null || v === '' || !Number.isFinite(Number(v)) ? def : Number(v);
}

/** A stored JSON value, or `def` when missing or malformed. */
export function readJsonPref<T>(key: string, def: T): T {
  const v = readPref(key);
  if (v === null) return def;
  try { return JSON.parse(v) as T; } catch { return def; }
}
