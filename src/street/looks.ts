/**
 * How an inhabitant looks on the street: their body and face (the same every time you meet them, ageing
 * with them, the family's colouring shared in a household) and what they have on today (a new outfit every
 * day, warmer when it is cold, smarter for office work, by age). Pure: the views turn these into humans with
 * the humanoid package (src/render/people).
 *
 * The outfit rules are Scale's city wardrobe (src/humanoid/client/wardrobe.ts `cityOutfit`), with age and
 * the day added; the clothes themselves are Dunfinity's (src/render/humans/wardrobe.ts `everyday`).
 */
import { Rng, clamp, deriveSeed } from '@futuremagic/core';
import { randomAppearance, type EquipmentVisuals, type HumanoidAppearance, type ItemVisual } from '@futuremagic/humanoid';
import { FEMALE } from '../sim/actors';
import { DAYS_PER_YEAR, MINUTES_PER_DAY } from '../sim/time';

/** What looks need to know about a person (the sim worker's ActorInfo carries it). */
export interface LookInfo {
  id: number;
  sex: number;
  /** Game day of birth. */
  birth: number;
  household: number;
  /** Job role, '' when none. */
  role: string;
}

/** Age in years at `clock`. */
export const yearsAt = (p: LookInfo, clock: number): number => Math.max(0, (clock / MINUTES_PER_DAY - p.birth) / DAYS_PER_YEAR);

/** MakeHuman's age parameter for an age in years (0 = 1 year, 0.1875 = 11, 0.5 = 25, 1 = 90). */
export function makeHumanAge(years: number): number {
  const y = clamp(years, 1, 90);
  if (y <= 11) return ((y - 1) / 10) * 0.1875;
  if (y <= 25) return 0.1875 + ((y - 11) / 14) * 0.3125;
  return 0.5 + ((y - 25) / 65) * 0.5;
}

/**
 * The body and face of a person at `clock`. A whole year of age changes the body (so a child grows up over
 * the seasons); within a year it is the same, so a body built once can be kept.
 */
export function appearanceOf(seed: number, p: LookInfo, clock: number): HumanoidAppearance {
  const years = Math.floor(yearsAt(p, clock));
  const body = { gender: p.sex === FEMALE ? 0.04 : 0.96, age: makeHumanAge(years + 0.5) };
  const own = randomAppearance('human', deriveSeed(seed, 'look', p.id), body);
  if (p.household < 0) return own;
  // A family's colouring runs in it: three parts the household's, one part their own.
  const family = deriveSeed(seed, 'family', p.household);
  const fam = randomAppearance('human', family);
  const mix = (a: number, b: number) => a * 0.75 + b * 0.25;
  return { ...own, african: mix(fam.african, own.african), asian: mix(fam.asian, own.asian), caucasian: mix(fam.caucasian, own.caucasian) };
}

/** A key that changes exactly when the body must be rebuilt (another year of age). */
export const bodyKey = (p: LookInfo, clock: number): string => `${p.id}:${Math.floor(yearsAt(p, clock))}`;

type C3 = [number, number, number];
const FABRIC: C3[] = [
  [0.12, 0.13, 0.16], [0.2, 0.22, 0.3], [0.85, 0.85, 0.82], [0.55, 0.12, 0.12], [0.2, 0.35, 0.55], [0.35, 0.3, 0.25],
  [0.55, 0.5, 0.42], [0.15, 0.3, 0.2], [0.7, 0.6, 0.2], [0.45, 0.45, 0.48], [0.9, 0.55, 0.6], [0.3, 0.2, 0.35], [0.95, 0.92, 0.85],
];
const BRIGHT: C3[] = [[0.85, 0.2, 0.2], [0.2, 0.45, 0.85], [0.95, 0.75, 0.15], [0.25, 0.65, 0.3], [0.85, 0.45, 0.7], [0.5, 0.3, 0.75]];
const DENIM: C3[] = [[0.18, 0.25, 0.42], [0.12, 0.16, 0.28], [0.3, 0.38, 0.55], [0.08, 0.08, 0.1]];
const SHOE: C3[] = [[0.08, 0.08, 0.08], [0.25, 0.15, 0.08], [0.9, 0.9, 0.9], [0.4, 0.3, 0.2], [0.15, 0.18, 0.3]];
const SUIT: C3[] = [[0.12, 0.12, 0.14], [0.2, 0.22, 0.28], [0.3, 0.3, 0.32], [0.25, 0.2, 0.15]];

/** Roles that dress for the office (until uniforms come with their own clothes). */
const SMART = /clerk|bank|office|manager|accountant|lawyer|mayor|secretary|principal|doctor|dentist|pharmacist|estate/;

function vis(seed: number, primary: C3, secondary: C3, pattern = 'plain', wear = 0.15): ItemVisual {
  return { shape: 'cloth', seed, primary, secondary, accent: secondary, material: pattern, glow: 0, wear };
}

/**
 * What a person wears on the day of `clock`: a fresh choice every day from their own taste. `cold` 0 (a hot
 * summer day) to 1 (freezing) brings sweaters, coats, boots and hats; `wet` (it rains as they set out) raincoats.
 */
export function outfitOf(seed: number, p: LookInfo, clock: number, cold: number, wet = false): EquipmentVisuals {
  const day = Math.floor(clock / MINUTES_PER_DAY);
  const r = new Rng(deriveSeed(seed, 'outfit', p.id, day));
  const taste = new Rng(deriveSeed(seed, 'taste', p.id));
  const u = () => r.int(0, 0x7fffffff);
  const years = yearsAt(p, clock), female = p.sex === FEMALE, child = years < 13, old = years >= 68;
  // Everyone has a few colours they like: today's come mostly from those.
  const mine = taste.sample(FABRIC, 4);
  const colour = () => (r.chance(0.7) ? r.pick(mine) : r.pick(child ? BRIGHT : FABRIC));
  const pattern = () => r.weighted(['plain', 'stripes', 'checks'], (x) => (x === 'plain' ? 6 : 1));
  const eq: EquipmentVisuals = {};
  const formal = child ? 0 : SMART.test(p.role) ? 0.75 : 0.05;
  if (r.chance(formal * 0.8)) {
    const sc = r.pick(SUIT);
    eq.chest = { defId: 'shirt', visual: vis(u(), r.pick([[0.95, 0.95, 0.95], [0.75, 0.85, 0.95], [0.95, 0.9, 0.9]] as C3[]), [0.9, 0.9, 0.9]) };
    eq.back = { defId: cold > 0.55 ? 'coat' : 'blazer', visual: vis(u(), sc, sc) };
    eq.legs = { defId: female && r.chance(0.5) ? 'skirt' : 'chinos', visual: vis(u(), sc, sc) };
    eq.feet = { defId: 'shoes', visual: vis(u(), r.pick(SHOE.slice(0, 2)), [0, 0, 0]) };
  } else {
    const top = r.weighted(['tshirt', 'shirt', 'sweater', 'hoodie'], (t) =>
      t === 'tshirt' ? 3 * (1 - cold) + 0.3 : t === 'sweater' ? (old ? 2 : 1) + cold * 2 : t === 'hoodie' ? (years < 30 ? 1.2 : 0.2) + cold : old ? 2.5 : 2);
    if (female && !old && r.chance(0.22 * (1 - cold * 0.6))) {
      eq.chest = { defId: 'dress', visual: vis(u(), colour(), colour(), pattern()) };
    } else {
      eq.chest = { defId: top, visual: vis(u(), colour(), colour(), pattern()) };
      const legs = r.weighted(female ? ['jeans', 'chinos', 'skirt', 'shorts'] as const : ['jeans', 'chinos', 'shorts'] as const, (l) =>
        l === 'shorts' ? (1 - cold) ** 2 * (child ? 2.5 : 1.1) : l === 'skirt' ? (old ? 1.6 : 1.1) : l === 'chinos' ? (old ? 3 : 1.5) : old ? 0.4 : 2.5);
      eq.legs = { defId: legs, visual: vis(u(), legs === 'jeans' ? r.pick(DENIM) : colour(), colour(), legs === 'chinos' ? 'plain' : pattern(), legs === 'jeans' ? 0.35 : 0.15) };
    }
    if (r.chance(Math.min(1, 0.1 + cold * 0.75 + (wet ? 0.6 : 0)))) {
      const outer = r.weighted(['jacket', 'coat', 'raincoat'], (o) => (o === 'coat' ? cold * 2 + (old ? 1 : 0.2) : o === 'raincoat' ? (wet ? 4 : 0.4) : 1.2));
      eq.back = { defId: outer, visual: vis(u(), colour(), colour(), r.chance(0.15) && outer === 'jacket' ? 'leather' : 'plain') };
    }
    const feet = r.weighted(['sneakers', 'shoes', 'boots'], (s) => (s === 'sneakers' ? (old ? 0.8 : child ? 5 : 3) : s === 'boots' ? cold * 2 + 0.3 : old ? 3 : 1.5));
    eq.feet = { defId: feet, visual: vis(u(), r.pick(SHOE), [1, 1, 1]) };
  }
  if (r.chance(0.08 + cold * 0.35)) eq.head = { defId: cold > 0.45 ? 'beanie' : 'cap', visual: vis(u(), colour(), colour()) };
  return eq;
}

/** Children dress up on Halloween (31 October) from late afternoon, for trick-or-treating. */
export const dressUpDay = (month: number, day: number, clock: number): boolean =>
  month === 10 && day === 31 && clock % MINUTES_PER_DAY >= 16 * 60;

/** The Halloween costumes, made of the everyday wardrobe's pieces and a few of their own (src/render/people/wardrobe.ts). */
const COSTUMES = ['ghost', 'witch', 'cat', 'pumpkin', 'vampire'] as const;

/** A child's Halloween costume (the same all evening), over today's shoes; null for grown-ups. */
export function costumeOf(seed: number, p: LookInfo, clock: number, everyday: EquipmentVisuals): EquipmentVisuals | null {
  if (yearsAt(p, clock) >= 13) return null;
  const r = new Rng(deriveSeed(seed, 'costume', p.id, Math.floor(clock / MINUTES_PER_DAY)));
  const u = () => r.int(0, 0x7fffffff);
  const black: C3 = [0.06, 0.06, 0.07], white: C3 = [0.93, 0.93, 0.9], orange: C3 = [0.95, 0.45, 0.08], green: C3 = [0.2, 0.45, 0.15];
  const purple: C3 = [0.3, 0.12, 0.4], red: C3 = [0.6, 0.05, 0.08];
  const feet = everyday.feet;
  switch (r.pick(COSTUMES)) {
    case 'ghost': return { chest: { defId: 'robe', visual: vis(u(), white, white) }, head: { defId: 'beanie', visual: vis(u(), white, white) }, feet };
    case 'witch': {
      const c = r.chance(0.5) ? black : purple;
      return { chest: { defId: 'robe', visual: vis(u(), c, c) }, head: { defId: 'witchHat', visual: vis(u(), black, c) }, feet };
    }
    case 'cat': return { chest: { defId: 'hoodie', visual: vis(u(), black, black) }, legs: { defId: 'jeans', visual: vis(u(), black, black) }, head: { defId: 'ears', visual: vis(u(), black, black) }, feet };
    case 'pumpkin': return { chest: { defId: 'hoodie', visual: vis(u(), orange, orange) }, legs: { defId: 'chinos', visual: vis(u(), green, green) }, head: { defId: 'beanie', visual: vis(u(), green, green) }, feet };
    default: return { chest: { defId: 'shirt', visual: vis(u(), white, white) }, back: { defId: 'coat', visual: vis(u(), black, red) }, legs: { defId: 'chinos', visual: vis(u(), black, black) }, feet };
  }
}

/** How cold it feels, 0 (20 °C and warmer) … 1 (freezing, −2 °C and below), from the weather people dressed for. */
export const coldOf = (tempC: number): number => clamp((20 - tempC) / 22, 0, 1);
