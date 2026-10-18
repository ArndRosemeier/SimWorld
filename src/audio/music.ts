/**
 * The music: the title piece on the start screen, then now and then a quiet piece that fits the hour
 * and the weather, with long silences in between so the town itself stays in front (the way
 * neighbourhood games do it). Pieces are listed in public/music/tracks.json (docs/MUSIC.md).
 * Which piece and how long the silence is are decided by `nextPiece` (pure, seeded, tested); the
 * player streams through the engine's music bus.
 */
import { Rng, deriveSeed } from '@futuremagic/core';
import { minuteOfDay, weekdayOf } from '../sim/time';
import type { AudioEngine, StreamHandle } from './engine';
import type { SoundEnv } from './soundscape';

export type Mood = 'title' | 'day' | 'evening' | 'night' | 'rain' | 'sunday';
export interface TrackInfo { file: string; seconds: number; mood: Mood }

/** Parse public/music/tracks.json (empty when malformed). */
export function parseTracks(o: unknown): Record<string, TrackInfo> {
  const t = (o as { tracks?: Record<string, Partial<TrackInfo>> } | null)?.tracks;
  const out: Record<string, TrackInfo> = {};
  if (!t || typeof t !== 'object') return out;
  for (const [id, v] of Object.entries(t)) {
    if (typeof v?.file === 'string' && Number(v.seconds) > 0 && typeof v.mood === 'string') out[id] = { file: v.file, seconds: Number(v.seconds), mood: v.mood as Mood };
  }
  return out;
}

/** The mood of the hour and the weather. */
export function moodOf(env: SoundEnv): Mood {
  const h = minuteOfDay(env.clock) / 60;
  if (env.rain > 0.25) return 'rain';
  if (env.night > 0.6 || h < 5) return 'night';
  if ((weekdayOf(env.clock) === 6 || env.feast) && h >= 7 && h < 12) return 'sunday';
  if (h >= 18) return 'evening';
  return 'day';
}

/** Minutes of silence between pieces (real minutes). */
export const GAP: readonly [number, number] = [4, 10];

/**
 * The piece to play after the `n`-th silence, and how long that silence lasts (s). Falls back to a
 * day piece when the mood has none; never the same piece twice in a row when there is a choice.
 */
export function nextPiece(tracks: Record<string, TrackInfo>, env: SoundEnv, seed: number, n: number, last: string | null): { id: string | null; gap: number } {
  const r = new Rng(deriveSeed(seed, 'music', n));
  const gap = r.range(GAP[0], GAP[1]) * 60;
  const mood = moodOf(env);
  const of = (m: Mood): string[] => Object.keys(tracks).filter((id) => tracks[id].mood === m).sort();
  let pool = of(mood);
  if (!pool.length) pool = of('day');
  if (pool.length > 1 && last) pool = pool.filter((id) => id !== last);
  return { id: pool.length ? r.pick(pool) : null, gap };
}

/** The music player: the title piece until `startGame`, then pieces and silences. */
export class MusicPlayer {
  private tracks: Record<string, TrackInfo> = {};
  private cur: StreamHandle | null = null;
  private curId: string | null = null;
  private inGame = false;
  private wait = 0.5;
  private n = 0;

  constructor(private readonly engine: AudioEngine, private readonly seed: number, private readonly base = import.meta.env?.BASE_URL ?? '/') {}

  async init(): Promise<void> {
    try { this.tracks = parseTracks(await (await fetch(`${this.base}music/tracks.json`)).json()); } catch { this.tracks = {}; }
  }

  /** The start screen is over: let the title fade and begin the in-game rhythm with a silence. */
  startGame(): void {
    if (this.inGame) return;
    this.inGame = true;
    this.cur?.fade(6);
    this.wait = 90;
  }

  /** Call every frame with the frame time (s). */
  tick(dt: number, env: SoundEnv): void {
    if (!this.engine.ctx) return;
    if (!this.inGame) {
      // The title piece, again after a short pause if the start screen stays up.
      if (!this.cur || this.cur.ended()) {
        if (this.cur) { this.cur.stop(); this.cur = null; this.wait = 8; }
        this.wait -= dt;
        const id = Object.keys(this.tracks).find((k) => this.tracks[k].mood === 'title');
        if (id && this.wait <= 0) this.play(id, 0.9);
      }
      return;
    }
    if (this.cur && !this.cur.ended()) return;
    if (this.cur) { this.cur.stop(); this.cur = null; }
    this.wait -= dt;
    if (this.wait > 0) return;
    const next = nextPiece(this.tracks, env, this.seed, this.n++, this.curId);
    this.wait = next.gap;
    if (next.id) this.play(next.id, 0.75);
  }

  private play(id: string, gain: number): void {
    this.cur = this.engine.streamMusic(`music/${this.tracks[id].file}`);
    this.cur?.set(gain);
    this.curId = id;
  }
}
