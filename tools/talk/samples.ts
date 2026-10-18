/**
 * Sample conversations from a whole simulated day, for reading (the dump for Arnd) and for the LLM judge
 * (test/slow/chatter.slow.test.ts). Headless: the game's own town (planned from the settings, as the game builds it),
 * a day of history, then a day of talk.
 *
 * Run: `node --import tsx tools/talk/samples.ts [out.md] [perTown]` writes samples from two town seeds as Markdown,
 * with the repetition figures at the top.
 */
import fs from 'node:fs';
import { Rng } from '@futuremagic/core';
import { placeGraphOf } from '../../src/plan/placeGraph';
import { regionOf } from '../../src/plan/region';
import { planTown } from '../../src/plan/town';
import { dateOf, weekdayName } from '../../src/sim/calendar';
import { createWorld } from '../../src/sim/synth';
import { DEFAULT_SETTINGS } from '../../src/world/settings';
import { tick, ageOf, jobOf, nameOf, type World } from '../../src/sim/world';
import { overheard, type Exchange } from '../../src/talk/chatter';
import { TalkMemory } from '../../src/talk/grammar';

export interface Sample { town: string; clock: number; place: string; kind: Exchange['kind']; lines: { who: string; about: string; text: string }[]; fact: string | null; distorted: boolean }

/** The town the game builds from this seed (the default settings otherwise), with a day of history. */
export function sampleTown(seed = DEFAULT_SETTINGS.seed): World {
  const town = planTown({ ...DEFAULT_SETTINGS, seed });
  return createWorld(placeGraphOf(town), seed, { region: regionOf(town), history: 1 });
}

/**
 * How much the samples repeat themselves: the share of sentences of `minWords` or more said more than once across
 * all of them, and the most repeated ones (a mechanical check beside the judges; "Hi." and "See you." may recur).
 */
export function repetition(samples: readonly Sample[], top = 15, minWords = 4): { sentences: number; repeated: number; worst: [string, number][] } {
  const n = new Map<string, number>();
  let sentences = 0;
  for (const s of samples) for (const l of s.lines) for (const t of l.text.split(/(?<=[.?!…])\s+/)) {
    if (t.split(' ').length < minWords) continue;
    sentences++;
    n.set(t, (n.get(t) ?? 0) + 1);
  }
  let repeated = 0;
  for (const c of n.values()) if (c > 1) repeated += c;
  return { sentences, repeated: repeated / Math.max(1, sentences), worst: [...n].filter(([, c]) => c > 1).sort((a, b) => b[1] - a[1]).slice(0, top) };
}

/**
 * `n` exchanges from one day (6:00 to 23:00) of `world`: every one where news passes, topped up with a seeded
 * selection of the small talk, in time order.
 */
export function sampleDay(world: World, n: number, seed = 1): Sample[] {
  const w = world, rng = new Rng(seed);
  tick(w, 6 * 60 - (w.clock % 1440 + 1440) % 1440);
  const memory = new TalkMemory();
  const news: Sample[] = [], small: Sample[] = [];
  for (let m = 0; m < 17 * 60; m++) {
    tick(w, 1);
    for (const x of overheard(w, memory)) (x.lines.some((l) => l.fact >= 0) ? news : small).push(toSample(w, x));
  }
  const keep = Math.max(0, n - news.length);
  const picked = small.filter(() => rng.float() < keep / Math.max(1, small.length));
  return [...news.slice(0, n), ...picked].sort((a, b) => a.clock - b.clock).slice(0, n);
}

function toSample(w: World, x: Exchange): Sample {
  const f = x.lines.find((l) => l.fact >= 0);
  const fact = f ? w.knowledge.facts[f.fact] : null;
  return {
    town: w.region?.region.town ?? 'town', clock: x.time, place: w.graph.places[x.place]?.name ?? '?', kind: x.kind,
    lines: x.lines.map((l) => {
      const job = jobOf(w, l.speaker);
      return { who: nameOf(w, l.speaker), about: `${ageOf(w, l.speaker)}${job ? `, ${job.role}` : ''}`, text: l.text };
    }),
    fact: fact ? fact.text : null,
    distorted: !!fact && fact.parent >= 0 && !fact.truth,
  };
}

const hhmm = (clock: number) => { const m = ((clock % 1440) + 1440) % 1440; return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };

/** One exchange as plain lines ("Name: text"), as the judge reads it. */
export function asText(s: Sample): string {
  // First names, unless the two share one (then full names, so the reader can tell them apart).
  const firsts = new Set(s.lines.map((l) => l.who.split(' ')[0]));
  const names = new Set(s.lines.map((l) => l.who));
  const label = (who: string) => (firsts.size < names.size ? who : who.split(' ')[0]);
  // The age on a speaker's first line, so a reader can tell a child from a grandmother.
  const seen = new Set<string>();
  return s.lines.map((l) => {
    const first = !seen.has(l.who);
    seen.add(l.who);
    return `${label(l.who)}${first ? ` (${l.about.split(',')[0]})` : ''}: ${l.text}`;
  }).join('\n');
}

/** Samples as Markdown for reading. */
export function asMarkdown(title: string, world: World, samples: Sample[]): string {
  const d = dateOf(world, samples[0]?.clock ?? world.clock);
  const out = [`## ${title}: ${weekdayName(d.weekday)} ${d.day}.${d.month}.${d.year}`, ''];
  for (const s of samples) {
    out.push(`**${hhmm(s.clock)} at ${s.place}**${s.kind !== 'talk' ? ` (${s.kind})` : ''}${s.fact ? ` · passing on: _${s.fact}_${s.distorted ? ' (a distorted retelling)' : ''}` : ''}`, '');
    for (const l of s.lines) out.push(`- **${l.who}** (${l.about}): ${l.text}`);
    out.push('');
  }
  return out.join('\n');
}

if (process.argv[1]?.endsWith('samples.ts')) {
  const out = process.argv[2] ?? 'chatter-samples.md';
  const per = Number(process.argv[3] ?? 150);
  const parts = ['# Overheard in town', '', 'Generated by the background chatter engine (src/talk), no LLM at runtime. One simulated day in the town of two seeds; every exchange where news passed, plus a random selection of the small talk. Regenerate with `node --import tsx tools/talk/samples.ts <out.md>`.', ''];
  const all: Sample[] = [], sections: string[] = [];
  for (const seed of [1, 2]) {
    const w = sampleTown(seed);
    const s = sampleDay(w, per, seed);
    all.push(...s);
    sections.push(asMarkdown(`${w.region?.region.town} (seed ${seed})`, w, s));
  }
  const rep = repetition(all);
  parts.push(`Sentences: ${rep.sentences}, said more than once: ${(rep.repeated * 100).toFixed(0)}%. Most repeated: ${rep.worst.map(([t, c]) => `"${t}" ×${c}`).join(', ')}.`, '', ...sections);
  fs.writeFileSync(out, parts.join('\n'));
  console.log(`wrote ${out}`);
}
