/**
 * The town's audio, wired: the engine, the soundscape and the music, driven once a frame from the
 * camera and the game's time and weather. The one object the game talks to for sound: other systems
 * play their own sounds through `play` (a car passing, a train horn at the crossing, a door) and
 * thunder through `thunder`, so every sound shares one mix, one voice limit and the player's volume.
 */
import { deriveSeed } from '@futuremagic/core';
import { AudioEngine, type LoopHandle } from './engine';
import { MusicPlayer } from './music';
import { ROOM_SLOT, reverbOf, roomMix, roomShots, type Room } from './room';
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
  /** 0 out of doors … 1 inside, eased so stepping through a door takes a moment. */
  private indoor = 0;
  private roomLoops = new Map<string, LoopHandle>();
  /** Real seconds in rooms (the small sounds' slots run on it, not on game time). */
  private roomT = 0;
  private lastRoom: Room | null = null;

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
   * game's time and weather, and the room the listener is in (null out of doors).
   */
  frame(dt: number, cam: { x: number; y: number; z: number; fx: number; fy: number; fz: number; ux?: number; uy?: number; uz?: number }, env: SoundEnv, room: Room | null = null): void {
    const e = this.engine;
    e.setListener(cam.x, cam.y, cam.z, cam.fx, cam.fy, cam.fz, cam.ux ?? 0, cam.uy ?? 1, cam.uz ?? 0);
    this.music.tick(dt, env);
    if (!this.scape || !this.playing || !e.ctx) return;
    this.indoor += ((room ? 1 : 0) - this.indoor) * Math.min(1, dt * 2.5);
    if (room) this.lastRoom = room;
    this.roomSound(dt, cam, room);
    const l = { x: cam.x, y: cam.y, z: cam.z, ground: groundAt(this.scape.map, cam.x, cam.z), indoor: this.indoor };
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

  /** The room's loops and small sounds; the walls between the listener and the street. */
  private roomSound(dt: number, l: { x: number; y: number; z: number }, room: Room | null): void {
    const e = this.engine, kind = (room ?? this.lastRoom)?.kind ?? 'home';
    e.setIndoors(this.indoor, reverbOf(kind));
    const want = new Set<string>();
    if (room) {
      for (const c of roomMix(room, l)) {
        if (c.gain <= 0.001 && !this.roomLoops.has(c.id)) continue;
        want.add(c.id);
        let h = this.roomLoops.get(c.id);
        if (!h) {
          const made = e.loop(c.id, c.refDist, 1.2, true);
          if (!made) continue;
          h = made;
          this.roomLoops.set(c.id, h);
        }
        h.set(c.x, c.y, c.z, c.gain);
      }
      const before = Math.floor(this.roomT / ROOM_SLOT);
      this.roomT += dt;
      const slot = Math.floor(this.roomT / ROOM_SLOT);
      if (slot !== before) {
        for (const s of roomShots(room, deriveSeed(this.seed, 'room'), slot)) {
          if (s.id) e.play(s.id, s.x, s.y, s.z, s.gain, s.pitch, 2, s.delay, true);
          else e.clink(s.x, s.y, s.z, s.clink, s.gain, s.delay);
        }
      }
    }
    for (const [k, h] of this.roomLoops) {
      if (want.has(k)) continue;
      // Out through the door: the room fades with the walls, then its loops stop.
      if (!room && this.indoor > 0.05) { h.set(l.x, l.y, l.z, 0); continue; }
      h.stop(); this.roomLoops.delete(k);
    }
  }

  /**
   * A looping sound of another system (a level crossing's bells while it is closed): null until the clip is decoded
   * (try again next frame); move it with `set`, end it with `stop`. Shares the mix like `play`.
   */
  loop(id: string, refDist = 6): LoopHandle | null {
    return this.playing ? this.engine.loop(id, refDist) : null;
  }

  /**
   * A sound of another system (traffic, trains, people, doors) at a point; see the manifest for ids. `room`: it is
   * in the room the listener is in (a door in here), so the walls do not muffle it.
   */
  play(id: string, x: number, y: number, z: number, gain = 1, pitch = 1, refDist = 6, room = false): void {
    this.engine.play(id, x, y, z, gain, pitch, refDist, 0, room);
  }
}
