/**
 * The town's audio, wired: the engine, the soundscape and the music, driven once a frame from the
 * camera and the game's time and weather. The one object the game talks to for sound: other systems
 * play their own sounds through `play` (a car passing, a train horn at the crossing, a door) and
 * thunder through `thunder`, so every sound shares one mix, one voice limit and the player's volume.
 */
import { deriveSeed } from '@futuremagic/core';
import { AudioEngine, type LoopHandle } from './engine';
import { MusicPlayer } from './music';
import { groundAt, type SoundMap } from './soundMap';
import { Soundscape, type SoundEnv } from './soundscape';

/** How often the ambience mix is recomputed (s): beds crossfade over about a second anyway. */
const MIX_EVERY = 0.25;

export class TownAudio {
  readonly engine: AudioEngine;
  readonly music: MusicPlayer;
  private scape: Soundscape | null = null;
  private loops = new Map<string, LoopHandle>();
  private mixIn = 0;
  private playing = false;

  constructor(readonly seed: number) {
    this.engine = new AudioEngine(deriveSeed(seed, 'audio'));
    this.music = new MusicPlayer(this.engine, deriveSeed(seed, 'music'));
  }

  /** Load the manifest and the music list, arm the first-gesture start (the title piece plays then). */
  async init(): Promise<void> {
    await Promise.all([this.engine.init(), this.music.init()]);
  }

  /** What the town sounds like where (from a town worker). */
  setTown(map: SoundMap): void {
    this.scape = new Soundscape(map, deriveSeed(this.seed, 'soundscape'), this.seed);
  }

  /** The start screen is gone: the town's sounds start and the title music gives way. */
  startTown(): void {
    this.playing = true;
    this.music.startGame();
  }

  /** While the start screen is up (no camera yet): only the music runs. */
  tickMusic(dt: number, env: SoundEnv): void {
    this.music.tick(dt, env);
  }

  /**
   * Once a frame: the listener at the camera (position, forward and up), the frame time (s), the
   * game's time and weather.
   */
  frame(dt: number, cam: { x: number; y: number; z: number; fx: number; fy: number; fz: number; ux?: number; uy?: number; uz?: number }, env: SoundEnv): void {
    const e = this.engine;
    e.setListener(cam.x, cam.y, cam.z, cam.fx, cam.fy, cam.fz, cam.ux ?? 0, cam.uy ?? 1, cam.uz ?? 0);
    this.music.tick(dt, env);
    if (!this.scape || !this.playing || !e.ctx) return;
    const l = { x: cam.x, y: cam.y, z: cam.z, ground: groundAt(this.scape.map, cam.x, cam.z) };
    this.mixIn -= dt;
    if (this.mixIn <= 0) {
      this.mixIn = MIX_EVERY;
      const mix = this.scape.ambience(l, env);
      e.setAmbience(mix.levels);
      e.setMuffle(mix.muffle);
    }
    for (const s of this.scape.shots(l, env)) e.play(s.id, s.x, s.y, s.z, s.gain, s.pitch, s.refDist, s.delay);
    // Loops: start the new ones (null until decoded: tried again next frame), move the running
    // ones, stop the ones no longer wanted.
    const want = new Set<string>();
    for (const c of this.scape.loops(l, env)) {
      want.add(c.key);
      let h = this.loops.get(c.key);
      if (!h) {
        const made = e.loop(c.id, c.refDist);
        if (!made) continue;
        h = made;
        this.loops.set(c.key, h);
      }
      h.set(c.x, c.y, c.z, c.gain, c.rate);
    }
    for (const [k, h] of this.loops) if (!want.has(k)) { h.stop(); this.loops.delete(k); }
  }

  /** A sound of another system (traffic, trains, people, doors) at a point; see the manifest for ids. */
  play(id: string, x: number, y: number, z: number, gain = 1, pitch = 1, refDist = 6): void {
    this.engine.play(id, x, y, z, gain, pitch, refDist);
  }
}
