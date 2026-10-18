/**
 * The Web Audio engine: spatial one-shots with variations, positioned loops, an ambience mixer whose
 * beds crossfade with the context around the listener, a music bus, and the player's mix (master
 * volume, mute, a level per category). Audio starts on the first user gesture (browser autoplay).
 *
 * Ported from Scale's src/audio/Audio.ts (commit eee2b85): same graph (sources → category gains →
 * sfx / ambience bus → master → limiter), same lazy decode and idle drop. Adapted for SimWorld: no
 * three.js (the listener is plain numbers), variation and pitch from a seeded Rng, categories from
 * the manifest instead of name rules, preferences through src/persist, an ambience low-pass
 * (`setMuffle`: the town heard from high up or through a wall), no superhero channels. Indoors, a room bus
 * with a reverb carries the room's own sounds while the street and the weather go dull (`setIndoors`).
 */
import { Rng, clamp } from '@futuremagic/core';
import { readJsonPref, readNumPref, writePref } from '../persist/prefs';

/** Volume categories of the sound mix: every clip names one in the manifest. */
export type SoundCategory = 'music' | 'ambience' | 'bells' | 'animals' | 'traffic' | 'people' | 'steps' | 'weather';
export const SOUND_CATEGORIES: { id: SoundCategory; name: string }[] = [
  { id: 'music', name: 'Music' },
  { id: 'ambience', name: 'Town ambience' },
  { id: 'weather', name: 'Rain, wind and thunder' },
  { id: 'bells', name: 'Bells' },
  { id: 'animals', name: 'Animals' },
  { id: 'traffic', name: 'Traffic and trains' },
  { id: 'people', name: 'People and machines' },
  { id: 'steps', name: 'Footsteps and doors' },
];

/** One sound of the manifest (public/sounds/manifest.json). */
export interface ManifestEntry { files: string[]; loop: boolean; gain: number; cat: SoundCategory; description?: string }
export type Manifest = Record<string, ManifestEntry>;

/** A positioned loop its owner moves and sets every frame. */
export interface LoopHandle { set(x: number, y: number, z: number, gain: number, rate?: number): void; stop(): void }

/** A streamed piece (music): an audio element through the music bus, nothing decoded up front. */
export interface StreamHandle { set(gain: number): void; ended(): boolean; fade(sec: number): void; stop(): void }

/** Seconds a decoded clip may go unwanted before it is dropped (`dropIdle`). */
const IDLE_S = 90;
/** At most this many one-shots at once (the rest are skipped, not queued). */
const MAX_VOICES = 40;
const SPEED_OF_SOUND = 343;

export class AudioEngine {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfxBus!: GainNode;
  private ambBus!: GainNode;
  private ambLow!: BiquadFilterNode;
  /** The sounds of the street through the walls: a low-pass and a cut on the sfx bus. */
  private outLow!: BiquadFilterNode;
  private outGain!: GainNode;
  /** The room's own sounds (`room` voices): dry, and through a reverb of the room's size. */
  private roomBus!: GainNode;
  private roomVerb!: ConvolverNode;
  private roomWet!: GainNode;
  private verbSeconds = 0;
  private cats = new Map<SoundCategory, GainNode>();
  private roomCats = new Map<SoundCategory, GainNode>();
  private manifest: Manifest = {};
  private buffers = new Map<string, AudioBuffer[]>();
  private loading = new Map<string, Promise<AudioBuffer[]>>();
  private amb = new Map<string, { src: AudioBufferSourceNode; gain: GainNode }>();
  private used = new Map<string, number>();
  private sweptAt = 0;
  private voices = 0;
  private lx = 0; private ly = 0; private lz = 0;
  private readonly rng: Rng;
  private readonly base: string;
  /** Category levels 0 … 1.5 (1 = as designed), remembered. */
  readonly mix: Record<SoundCategory, number> = readMix();
  /** Master volume 0 … 1 and mute, remembered; `?mute` in the URL forces silence (tests, screenshots). */
  volume = readNumPref('volume', 0.8);
  muted = readNumPref('muted', 0) > 0 || (typeof location !== 'undefined' && new URLSearchParams(location.search).has('mute'));
  /** Called once the context runs (the first gesture). */
  onStart: (() => void) | null = null;

  constructor(seed: number, base = import.meta.env?.BASE_URL ?? '/') {
    this.rng = new Rng(seed);
    this.base = base;
  }

  /** Load the manifest and arm the first-gesture start. */
  async init(): Promise<void> {
    try { this.manifest = await (await fetch(`${this.base}sounds/manifest.json`)).json(); } catch { this.manifest = {}; }
    const startContext = (): void => {
      if (this.ctx) { if (this.ctx.state === 'suspended') void this.ctx.resume().catch(() => {}); return; }
      const ctx = new AudioContext();
      this.ctx = ctx;
      this.master = ctx.createGain();
      this.master.gain.value = this.gain;
      // A gentle limiter so a bell next to a passing train does not clip.
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -10; comp.ratio.value = 6; comp.attack.value = 0.003; comp.release.value = 0.25;
      this.master.connect(comp).connect(ctx.destination);
      this.sfxBus = ctx.createGain();
      this.ambBus = ctx.createGain();
      this.ambLow = ctx.createBiquadFilter();
      this.ambLow.type = 'lowpass';
      this.ambLow.frequency.value = 20000;
      this.ambLow.Q.value = 0.5;
      this.outLow = ctx.createBiquadFilter();
      this.outLow.type = 'lowpass';
      this.outLow.frequency.value = 20000;
      this.outLow.Q.value = 0.5;
      this.outGain = ctx.createGain();
      this.sfxBus.connect(this.outLow).connect(this.outGain).connect(this.master);
      this.ambBus.connect(this.ambLow).connect(this.master);
      this.roomBus = ctx.createGain();
      this.roomVerb = ctx.createConvolver();
      this.roomWet = ctx.createGain();
      this.roomWet.gain.value = 0;
      this.roomBus.connect(this.master);
      this.roomBus.connect(this.roomVerb).connect(this.roomWet).connect(this.master);
      for (const c of SOUND_CATEGORIES) {
        const g = ctx.createGain();
        g.gain.value = this.mix[c.id];
        g.connect(c.id === 'ambience' || c.id === 'weather' ? this.ambBus : c.id === 'music' ? this.master : this.sfxBus);
        this.cats.set(c.id, g);
        const r = ctx.createGain();
        r.gain.value = this.mix[c.id];
        r.connect(this.roomBus);
        this.roomCats.set(c.id, r);
      }
      this.onStart?.();
    };
    // (iPad Safari only lets a touch's end start audio: pointerdown is not a gesture there.)
    for (const ev of ['pointerdown', 'pointerup', 'touchend', 'keydown']) addEventListener(ev, startContext, { passive: true });
    this.wake = startContext;
    if ((navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation?.hasBeenActive) startContext();
  }

  /** Start (or resume) the audio context now: allowed once the page has had a user gesture. */
  wake: () => void = () => {};

  private load(id: string): Promise<AudioBuffer[]> {
    this.used.set(id, performance.now() / 1000);
    const m = this.manifest[id];
    if (!m || !this.ctx) return Promise.resolve([]);
    let p = this.loading.get(id);
    if (p) return p;
    const ctx = this.ctx;
    p = Promise.all(m.files.map(async (f) => ctx.decodeAudioData(await (await fetch(`${this.base}sounds/${f}`)).arrayBuffer()))).then((bufs) => {
      this.buffers.set(id, bufs);
      return bufs;
    }).catch(() => []);
    this.loading.set(id, p);
    return p;
  }

  /** The listener: position and the forward and up directions (unit vectors). */
  setListener(x: number, y: number, z: number, fx: number, fy: number, fz: number, ux = 0, uy = 1, uz = 0): void {
    this.lx = x; this.ly = y; this.lz = z;
    if (!this.ctx) return;
    const l = this.ctx.listener, t = this.ctx.currentTime;
    if (l.positionX) {
      l.positionX.setValueAtTime(x, t); l.positionY.setValueAtTime(y, t); l.positionZ.setValueAtTime(z, t);
      l.forwardX.setValueAtTime(fx, t); l.forwardY.setValueAtTime(fy, t); l.forwardZ.setValueAtTime(fz, t);
      l.upX.setValueAtTime(ux, t); l.upY.setValueAtTime(uy, t); l.upZ.setValueAtTime(uz, t);
    } else {
      l.setPosition(x, y, z);
      l.setOrientation(fx, fy, fz, ux, uy, uz);
    }
  }

  private panner(x: number, y: number, z: number, refDist: number, rolloff: number): PannerNode {
    const pan = this.ctx!.createPanner();
    pan.panningModel = 'HRTF';
    pan.distanceModel = 'inverse';
    pan.refDistance = refDist;
    pan.rolloffFactor = rolloff;
    pan.maxDistance = 20000;
    pan.positionX.value = x; pan.positionY.value = y; pan.positionZ.value = z;
    return pan;
  }

  /**
   * A spatial one-shot. `refDist` is the distance at which it plays at full gain (a church bell
   * carries: 60 m and more). Sound travels: it starts distance / 343 m/s late, plus `delay` (s).
   */
  play(id: string, x: number, y: number, z: number, gain = 1, pitch = 1, refDist = 4, delay = 0, room = false): void {
    if (!this.ctx || this.voices >= MAX_VOICES) return;
    const m = this.manifest[id];
    if (!m) return;
    const ctx = this.ctx;
    const variant = this.rng.float(), jitter = 0.96 + this.rng.float() * 0.08;
    const late = delay + Math.min(4, Math.hypot(x - this.lx, y - this.ly, z - this.lz) / SPEED_OF_SOUND);
    const voice = (bufs: AudioBuffer[]): void => {
      if (!bufs.length) return;
      const src = ctx.createBufferSource();
      src.buffer = bufs[Math.floor(variant * bufs.length)];
      src.playbackRate.value = pitch * jitter;
      const g = ctx.createGain();
      g.gain.value = gain * m.gain;
      const pan = this.panner(x, y, z, refDist, 1);
      src.connect(g).connect(pan).connect(this.bus(m, room));
      src.start(ctx.currentTime + late);
      this.voices++;
      src.onended = () => { this.voices--; g.disconnect(); pan.disconnect(); };
    };
    this.withBuffers(id, voice);
  }

  /** A non-spatial one-shot (the interface, the player's own body). */
  play2d(id: string, gain = 1, pitch = 1): void {
    if (!this.ctx) return;
    const m = this.manifest[id];
    if (!m) return;
    const ctx = this.ctx, variant = this.rng.float();
    this.withBuffers(id, (bufs) => {
      if (!bufs.length) return;
      const src = ctx.createBufferSource();
      src.buffer = bufs[Math.floor(variant * bufs.length)];
      src.playbackRate.value = pitch;
      const g = ctx.createGain();
      g.gain.value = gain * m.gain;
      src.connect(g).connect(this.bus(m));
      src.start();
      src.onended = () => g.disconnect();
    });
  }

  private withBuffers(id: string, use: (b: AudioBuffer[]) => void): void {
    const b = this.buffers.get(id);
    if (b) { this.used.set(id, performance.now() / 1000); use(b); } else void this.load(id).then(use);
  }

  /**
   * A positioned loop (a lawnmower, the peal from the tower, an idling car) that its owner moves and
   * sets every frame. Null until audio runs and the clip is decoded: call again later.
   */
  loop(id: string, refDist = 5, rolloff = 1.2, room = false): LoopHandle | null {
    if (!this.ctx) return null;
    const m = this.manifest[id];
    const bufs = this.buffers.get(id);
    if (!m || !bufs?.length) { if (m) void this.load(id); return null; }
    this.used.set(id, performance.now() / 1000);
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = bufs[Math.floor(this.rng.float() * bufs.length)];
    src.loop = true;
    const g = ctx.createGain();
    g.gain.value = 0;
    const pan = this.panner(this.lx, this.ly, this.lz, refDist, rolloff);
    src.connect(g).connect(pan).connect(this.bus(m, room));
    src.start(0, this.rng.float() * src.buffer.duration);
    let stopped = false;
    return {
      set: (x, y, z, gain, rate = 1) => {
        if (stopped) return;
        this.used.set(id, performance.now() / 1000);
        const t = ctx.currentTime;
        pan.positionX.setTargetAtTime(x, t, 0.05); pan.positionY.setTargetAtTime(y, t, 0.05); pan.positionZ.setTargetAtTime(z, t, 0.05);
        g.gain.setTargetAtTime(gain * m.gain, t, 0.15);
        src.playbackRate.setTargetAtTime(rate, t, 0.2);
      },
      stop: () => {
        if (stopped) return;
        stopped = true;
        try { src.stop(); } catch { /* not started */ }
        g.disconnect(); pan.disconnect();
      },
    };
  }

  /** Target levels for ambience beds (0 … 1); they crossfade smoothly. A bed is decoded when first heard. */
  setAmbience(levels: Record<string, number>): void {
    if (!this.ctx) return;
    const ctx = this.ctx, now = performance.now() / 1000;
    for (const [id, lvl] of Object.entries(levels)) {
      const m = this.manifest[id];
      if (!m) continue;
      let a = this.amb.get(id);
      const bufs = this.buffers.get(id);
      if (lvl > 0.001) { if (bufs?.length) this.used.set(id, now); else void this.load(id); }
      if (!a) {
        if (!bufs?.length || lvl <= 0.001) continue;
        const src = ctx.createBufferSource();
        src.buffer = bufs[0];
        src.loop = true;
        const gain = ctx.createGain();
        gain.gain.value = 0;
        src.connect(gain).connect(this.bus(m));
        src.start(0, this.rng.float() * bufs[0].duration);
        a = { src, gain };
        this.amb.set(id, a);
      }
      a.gain.gain.setTargetAtTime(lvl * m.gain, ctx.currentTime, 0.8);
    }
    if (now - this.sweptAt > 10) { this.sweptAt = now; this.dropIdle(now); }
  }

  /** Low-pass the ambience (Hz): the town heard from high above or through a wall. */
  setMuffle(cutoff: number): void {
    if (this.ctx) this.ambLow.frequency.setTargetAtTime(clamp(cutoff, 200, 20000), this.ctx.currentTime, 0.4);
  }

  /**
   * A glass clink (or a cup on a saucer) at a point in the room, `delay` s from now: made here, from a few
   * inharmonic partials that ring and die away, so it costs no clip.
   */
  clink(x: number, y: number, z: number, freq: number, gain = 0.3, delay = 0): void {
    if (!this.ctx || this.voices >= MAX_VOICES) return;
    const ctx = this.ctx, t = ctx.currentTime + delay;
    const out = ctx.createGain();
    out.gain.value = gain;
    const pan = this.panner(x, y, z, 1.5, 1);
    out.connect(pan).connect(this.bus({ cat: 'people' } as ManifestEntry, true));
    const parts: [number, number, number][] = [[1, 1, 0.45], [2.32, 0.5, 0.3], [4.25, 0.25, 0.18], [6.8, 0.12, 0.1]];
    let left = parts.length;
    this.voices++;
    for (const [mul, amp, decay] of parts) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = freq * mul;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(amp, t + 0.002);
      g.gain.exponentialRampToValueAtTime(0.0005, t + decay);
      o.connect(g).connect(out);
      o.start(t);
      o.stop(t + decay + 0.05);
      o.onended = () => { g.disconnect(); if (--left === 0) { this.voices--; out.disconnect(); pan.disconnect(); } };
    }
  }

  /**
   * Indoors (0 out of doors … 1 inside): the street and the weather through the walls (dull and quieter), and the
   * room's reverb (its tail in s and how much of it is heard).
   */
  setIndoors(amount: number, reverb: { seconds: number; wet: number }): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, a = clamp(amount, 0, 1);
    this.outLow.frequency.setTargetAtTime(20000 - 19300 * a, t, 0.3);
    this.outGain.gain.setTargetAtTime(1 - 0.55 * a, t, 0.3);
    if (Math.abs(reverb.seconds - this.verbSeconds) > 0.05) {
      this.verbSeconds = reverb.seconds;
      this.roomVerb.buffer = impulse(this.ctx, reverb.seconds, this.rng);
    }
    this.roomWet.gain.setTargetAtTime(reverb.wet * a, t, 0.3);
  }

  /** Decoded audio is float PCM (an ambience bed ≈ 8 MB): what nobody wanted for IDLE_S is dropped. */
  private dropIdle(now: number): void {
    for (const id of [...this.buffers.keys()]) {
      if (now - (this.used.get(id) ?? 0) < IDLE_S) continue;
      const a = this.amb.get(id);
      if (a) { try { a.src.stop(); } catch { /* not started */ } a.src.disconnect(); a.gain.disconnect(); this.amb.delete(id); }
      this.buffers.delete(id);
      this.loading.delete(id);
    }
  }

  /** A music piece streamed through the music bus (an MP3: nothing decoded up front). Null until audio runs. */
  streamMusic(url: string): StreamHandle | null {
    if (!this.ctx) return null;
    const ctx = this.ctx;
    const el = new Audio();
    el.src = url.startsWith('http') || url.startsWith('/') ? url : `${this.base}${url}`;
    el.preload = 'auto';
    const node = ctx.createMediaElementSource(el);
    const g = ctx.createGain();
    g.gain.value = 0;
    node.connect(g).connect(this.cats.get('music')!);
    let stopped = false, started = false;
    const tryPlay = (): void => {
      if (started || stopped) return;
      started = true;
      el.play().catch(() => { started = false; });
    };
    tryPlay();
    return {
      set: (gain) => { if (stopped) return; tryPlay(); g.gain.setTargetAtTime(gain, ctx.currentTime, 0.4); },
      ended: () => stopped || el.ended,
      fade: (sec) => { if (!stopped) g.gain.setTargetAtTime(0, ctx.currentTime, Math.max(0.05, sec / 3)); },
      stop: () => {
        if (stopped) return;
        stopped = true;
        el.pause(); el.removeAttribute('src'); el.load();
        node.disconnect(); g.disconnect();
      },
    };
  }

  private bus(m: ManifestEntry, room = false): AudioNode {
    return (room ? this.roomCats.get(m.cat) ?? this.roomBus : this.cats.get(m.cat)) ?? this.sfxBus;
  }

  /** One category's level (0 … 1.5); remembered. */
  setMix(cat: SoundCategory, v: number): void {
    this.mix[cat] = clamp(v, 0, 1.5);
    for (const g of [this.cats.get(cat), this.roomCats.get(cat)]) if (g && this.ctx) g.gain.setTargetAtTime(this.mix[cat], this.ctx.currentTime, 0.05);
    writePref('soundMix', JSON.stringify(this.mix));
  }

  private get gain(): number { return this.muted ? 0 : this.volume; }

  setVolume(v: number): void {
    this.volume = clamp(v, 0, 1);
    if (v > 0) this.muted = false;
    this.apply();
  }

  setMuted(m: boolean): void {
    this.muted = m;
    this.apply();
  }

  private apply(): void {
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(this.gain, this.ctx.currentTime, 0.05);
    writePref('volume', String(this.volume));
    writePref('muted', this.muted ? '1' : '0');
  }
}

function readMix(): Record<SoundCategory, number> {
  const mix = Object.fromEntries(SOUND_CATEGORIES.map((c) => [c.id, c.id === 'music' ? 0.7 : 1])) as Record<SoundCategory, number>;
  const o = readJsonPref<Record<string, unknown>>('soundMix', {});
  for (const c of SOUND_CATEGORIES) { const v = Number(o?.[c.id]); if (Number.isFinite(v)) mix[c.id] = clamp(v, 0, 1.5); }
  return mix;
}

/** A room's echo: two channels of seeded noise dying away over `seconds` (60 dB), a little darker as it fades. */
function impulse(ctx: BaseAudioContext, seconds: number, rng: Rng): AudioBuffer {
  const rate = ctx.sampleRate, n = Math.max(1, Math.floor(seconds * rate));
  const buf = ctx.createBuffer(2, n, rate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    let lp = 0;
    for (let i = 0; i < n; i++) {
      const t = i / n, k = 0.35 + 0.6 * t;
      lp += (rng.range(-1, 1) - lp) * (1 - k);
      d[i] = lp * Math.pow(0.001, t);
    }
  }
  return buf;
}
