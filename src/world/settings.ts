/**
 * Generation settings and the seed-derived world profile.
 *
 * Ported from Scale (src/world/settings.ts). Scale scales from a small town to a megacity;
 * SimWorld is always a town (Scale's size 0 … ~0.1: a radius of about 0.9–1.2 km, room for
 * 1,000–2,000 inhabitants), so the city classes, the metro and the skyline are gone.
 */
import { Rng, deriveSeed } from '@futuremagic/core';

export interface TownSettings {
  /** 32-bit seed. */
  seed: number;
  /** 0 = the smallest town (~1,000 inhabitants) … 1 = the largest (~2,000). */
  size: number;
}

export const DEFAULT_SETTINGS: TownSettings = { seed: 1, size: 0.3 };

/** Town radius in metres for a size setting (about 480 m … 620 m: 1,000 … 2,000 inhabitants). */
export function townRadius(size: number): number {
  return 480 + 140 * Math.min(1, Math.max(0, size));
}

/**
 * Seed-derived character of the place. Everything here is decided once and read by every
 * generator so the town feels consistent.
 */
export interface WorldProfile {
  seed: number;
  size: number;
  radius: number;
  /** 0 flat … 1 very hilly. */
  hilliness: number;
  /** Characteristic hill wavelength (m). */
  hillScale: number;
  coastal: boolean;
  /** Unit vector pointing from land towards the sea. */
  seaDir: [number, number];
  /** Distance of the coastline from the centre along seaDir (m). */
  coastOffset: number;
  /** River count (always 1 for a town). */
  rivers: number;
  /** Base river width at the town centre (m). */
  riverWidth: number;
  /** Ground height of the town centre above sea level. */
  baseElevation: number;
  /** Architectural flavour weights (0..1), normalised by consumers. */
  arch: {
    oldWorld: number;   // european stone / timber
    american: number;   // brick, clapboard, porches
    modern: number;     // glass, concrete
    warm: number;       // stucco, terracotta roofs (mediterranean)
  };
  /** Climate influences vegetation and roofs: 0 cold … 1 warm. */
  warmth: number;
  /** Fraction of streets laid out as grids (vs organic). */
  gridness: number;
  /** Tall-building intensity 0..1 (a town: low). */
  skyline: number;
  /** Right-hand traffic. */
  rightHand: boolean;
}

export function makeProfile(s: TownSettings): WorldProfile {
  const rng = new Rng(deriveSeed(s.seed, 'profile'));
  // Scale's size scale, kept so the same draws give the same towns as Scale's size 0 … 0.1.
  const scaleSize = 0.1 * Math.min(1, Math.max(0, s.size));
  const radius = townRadius(s.size);
  const coastal = rng.chance(0.45);
  const a = rng.range(0, Math.PI * 2);
  const hilliness = Math.pow(rng.float(), 1.6);
  const arch = {
    oldWorld: rng.float(),
    american: rng.float(),
    modern: rng.range(0.2, 1) * (0.4 + scaleSize * 0.6),
    warm: rng.float() * rng.float(),
  };
  const hillScale = rng.range(900, 2200);
  const seaDir: [number, number] = [Math.cos(a), Math.sin(a)];
  const coastOffset = radius * rng.range(0.55, 0.85);
  const riverWidth = Math.min(380, rng.range(28, 55) * Math.pow(radius / 900, 0.45));
  const baseElevation = coastal ? rng.range(4, 14) : rng.range(25, 160);
  const warmth = rng.float();
  const gridness = rng.chance(0.35) ? rng.range(0.7, 1) : rng.range(0.15, 0.7);
  const skyline = Math.min(1, scaleSize * 1.2 + rng.range(-0.15, 0.25));
  return {
    seed: s.seed, size: s.size, radius, hilliness, hillScale, coastal, seaDir, coastOffset,
    rivers: 1, riverWidth, baseElevation, arch, warmth, gridness, skyline,
    rightHand: rng.chance(0.8),
  };
}
