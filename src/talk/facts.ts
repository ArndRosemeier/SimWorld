/**
 * How people put a story into words (plan §4.2): paraphrases per kind of fact, keyed by the sim's fact templates
 * (src/sim: life, economy, groups, politics, encounters). A fact the bank does not know is said from its own
 * template with the grammar slots put in, so a new kind of news is never mute, only plainer.
 *
 * Each rule has a tone, which drives openers and reactions: tragic (a death), sad (illness, hard luck), bad (a job
 * lost, a shop closing), good (a wedding, a baby, a new job), scandal (an affair, a fight), crime (a break-in), news
 * (neutral comings and goings), politics, event (what is on).
 *
 * Slots: see src/talk/refer.ts (`{S}`, `{S:has}`, `{S&O}`, `{P}` …); `{1}`, `{2}` are the rule's captures.
 */
import type { Fact } from '../sim/knowledge';

export type Tone = 'tragic' | 'sad' | 'bad' | 'good' | 'scandal' | 'crime' | 'news' | 'politics' | 'event';

/** Whether someone could have seen it happen ("I saw it myself" fits a fight or a break-in, not someone's holiday). */
export const isSeeable = (t: Tone): boolean => t === 'crime' || t === 'scandal' || t === 'event' || t === 'politics';

interface Rule { re: RegExp; tone: Tone; lines: readonly string[] }

const RULES: readonly Rule[] = [
  { re: /^\{subject\} died$/, tone: 'tragic', lines: [
    '{S} {S:has} died', '{S} passed away', '{S} died[ last night| in the night|, did you know|]', '{S} {S:has} died, sadly',
    '{S} {S:has} passed[ on| away]', '{S} died[, God rest {S:poss} soul|, poor soul|]',
  ] },
  { re: /^\{object\}'s (\w+) \{subject\} died$/, tone: 'sad', lines: [
    '{O:poss} {1} {S} died', '{O:poss} {1} died[, poor thing|]', '{O} lost {O:poss} {1}', '{O:poss} old {1} passed away',
  ] },
  { re: /^\{subject\} is seriously ill$/, tone: 'sad', lines: [
    '{S} {S:is} [really|seriously|very] ill', '{S} {S:is} in a bad way', '{S} {S:has} been taken [badly|seriously] ill',
    '{S} {S:is} [not well at all|poorly, really poorly]', 'things look bad for {S:obj}[, health-wise|]', '{S} {S:is} quite ill',
  ] },
  { re: /^\{subject\} was taken to hospital$/, tone: 'sad', lines: [
    '{S} {S:was} taken to hospital', '{S} {S:is} in hospital', 'they took {S:obj} to hospital', 'an ambulance came for {S:obj}',
    '{S} ended up in hospital',
  ] },
  { re: /^\{subject\} lost their job at \{place\}$/, tone: 'bad', lines: [
    '{S} lost {S:poss} job at {P}', '{S} got [let go|laid off|the sack] from {P}', '{P} let {S:obj} go', '{S} {S:is} out of work[ now|] - {P} let {S:obj} go',
    '{S} {S:has} lost {S:poss} job[ at {P}|]', '{S} {S:was} laid off at {P}',
  ] },
  { re: /^\{subject\} quit their job at \{place\}$/, tone: 'news', lines: [
    '{S} quit {S:poss} job at {P}', '{S} walked out of {P}', '{S} handed in {S:poss} notice at {P}', '{S} {S:has} packed in {S:poss} job at {P}',
    '{S} {S:is} done with {P} - quit',
  ] },
  { re: /^\{subject\} got a job at \{place\}$/, tone: 'good', lines: [
    '{S} got a job at {P}', '{S} {S:is} starting at {P}', '{S} {S:has} [landed|found|got] a job at {P}', '{P} took {S:obj} on',
    '{S} {S:is} working at {P} now', '{S} start{S:s} at {P}[ next week| soon|]',
  ] },
  { re: /^\{subject\} retired from \{place\}$/, tone: 'news', lines: [
    '{S} retired from {P}', '{S} {S:has} finally retired', '{S} {S:is} done at {P} - retired', '{S} {S:has} left {P} for good - retired',
    '{S} {S:is} retired now[, lucky thing|]', '{S} {S:has} hung up {S:poss} apron at {P}',
  ] },
  { re: /^\{subject\} and \{object\} got engaged$/, tone: 'good', lines: [
    '{S&O} got engaged', '{S&O} {S&O:is} getting married', '{S} popped the question to {O}', '{S&O} {S&O:is} engaged[ now|]',
    'there\'s a wedding coming: {S&O}',
  ] },
  { re: /^\{subject\} and \{object\} got married$/, tone: 'good', lines: [
    '{S&O} got married', '{S&O} tied the knot', '{S&O} {S&O:is} married now', '{S} married {O}', '{S&O} finally did it - married',
  ] },
  { re: /^\{subject\} is going out with \{object\}$/, tone: 'good', lines: [
    '{S} {S:is} going out with {O}', '{S} {S:is} seeing {O}', '{S&O} {S&O:is} an item', '{S&O} {S&O:is} together now',
    '{S} and {O} {S&O:is} [courting|stepping out|dating]',
  ] },
  { re: /^\{subject\} has been seen with someone new$/, tone: 'scandal', lines: [
    '{S} {S:has} been seen with someone new', '{S} {S:has} got someone new', 'someone saw {S:obj} out with somebody new',
    '{S} {S:has} got a new [fella|girl|someone][ already|]',
  ] },
  { re: /^\{subject\} moved in with \{object\}$/, tone: 'news', lines: [
    '{S} moved in with {O}', '{S} {S:has} moved in with {O}', '{S} {S:is} living with {O} now', '{S&O} {S&O:is} living together[ now|]',
  ] },
  { re: /^\{subject\} and \{object\} split up$/, tone: 'bad', lines: [
    '{S&O} split up', '{S&O} broke up', '{S&O} {S&O:is} finished', '{S&O} {S&O:has} gone their separate ways', '{S&O} called it off',
  ] },
  { re: /^\{subject\} and \{object\} are getting divorced$/, tone: 'bad', lines: [
    '{S&O} {S&O:is} getting divorced', '{S&O} {S&O:is} splitting up', '{S&O} {S&O:is} divorcing', 'the marriage is over for {S&O:obj}',
  ] },
  { re: /^\{subject\} is having an affair with \{object\}$/, tone: 'scandal', lines: [
    '{S} {S:is} having an affair with {O}', '{S} {S:has} been carrying on with {O}', '{S} {S:is} seeing {O} behind [everyone\'s|{S:poss} partner\'s] back',
    '{S&O} {S&O:is} having an affair', '{S} and {O} - an affair[, can you believe it|]', '{S} {S:is} sneaking off with {O}',
  ] },
  { re: /^\{subject\} is (?:pregnant|expecting a baby)$/, tone: 'good', lines: [
    '{S} {S:is} pregnant', '{S} {S:is} expecting', '{S} {S:is} having a baby', 'there\'s a baby on the way for {S:obj}', '{S} {S:is} in the family way',
  ] },
  { re: /^\{subject\} had a baby$/, tone: 'good', lines: [
    '{S} had a baby', '{S} had {S:poss} baby[ - a little {O:kid}|]', '{S:poss} baby arrived', '{S} had a little {O:kid}', '{S} {S:is} a mum now',
  ] },
  { re: /^\{subject\} moved into \{place\}$/, tone: 'news', lines: [
    '{S} moved into {P}', '{S} {S:has} moved into {P}', '{S} {S:is} living at {P} now', '{S} {S:has} got {P} now',
  ] },
  { re: /^\{subject\} moved out of their parents' place$/, tone: 'news', lines: [
    '{S} moved out of {S:poss} parents\' place', '{S} {S:has} got a place of {S:poss} own', '{S} finally left home', '{S} {S:has} flown the nest',
  ] },
  { re: /^\{subject\} moved away to (.+)$/, tone: 'news', lines: [
    '{S} moved away to {1}', '{S} {S:has} gone off to {1}', '{S} {S:has} left for {1}', '{S} live{S:s} in {1} now', '{S} upped and moved to {1}',
  ] },
  { re: /^\{subject\} moved into a care home(.*)$/, tone: 'sad', lines: [
    '{S} went into a care home{1}', '{S} {S:has} moved into a home{1}', '{S} {S:is} in a care home now{1}', 'they put {S:obj} in a home{1}',
  ] },
  { re: /^\{subject\} and family are moving away(.*)$/, tone: 'news', lines: [
    '{S} and {S:poss} family are moving away{1}', '{S:family} are moving away{1}', '{S:family} are leaving town{1}', '{S:family} are off{1}',
  ] },
  { re: /^new people moved into \{place\}: \{subject\} and family(.*)$/, tone: 'news', lines: [
    'new people moved into {P}{1}', '{S:family} moved into {P}{1}', 'there\'s a new family at {P}: {S:family}{1}', 'someone\'s moved into {P} - {S:family}{1}',
  ] },
  { re: /^\{subject\}'s family are away (.+)$/, tone: 'news', lines: [
    '{S:family} are away {1}', '{S:poss} family are away {1}', '{S:family} are away {1} this week',
  ] },
  { re: /^\{subject\} got an? (\w+)$/, tone: 'good', lines: [
    '{S:family} got a {1}', '{S} got a {1}', '{S:family} have got a new {1}', 'there\'s a new {1} at {S:family}\'',
  ] },
  { re: /^someone broke into \{object\}'s house$/, tone: 'crime', lines: [
    'someone broke into {O:poss} house', '{O:poss} house got broken into', '{O} got burgled', '{O:poss} place was burgled',
    'there was a break-in at {O:poss} place', 'burglars got into {O:poss} house',
  ] },
  { re: /^\{subject\} broke into \{object\}'s house$/, tone: 'scandal', lines: [
    '{S} broke into {O:poss} house', '{S} {S:was} the one who broke into {O:poss} house', 'it was {S} who did the break-in at {O:poss} house',
    '{S} burgled {O:poss} place',
  ] },
  { re: /^\{subject\} got into a fight with \{object\} at \{place\}$/, tone: 'scandal', lines: [
    '{S} got into a fight with {O} at {P}', '{S&O} had a fight at {P}', '{S} and {O} came to blows at {P}', '{S} {S:was} fighting with {O} at {P}',
    '{S} went for {O} at {P}',
  ] },
  { re: /^there was a shouting match between \{subject\} and \{object\} at \{place\}$/, tone: 'scandal', lines: [
    'there was a shouting match between {S} and {O} at {P}', '{S&O} {S&O:was} shouting at each other at {P}', '{S} had a go at {O} at {P}',
    '{S&O} had a [row|blazing row|proper row] at {P}',
  ] },
  { re: /^\{subject\}'s dog bit \{object\} at \{place\}$/, tone: 'crime', lines: [
    '{S:poss} dog bit {O} at {P}', '{O} got bitten by {S:poss} dog at {P}', '{S:poss} dog went for {O} at {P}',
  ] },
  { re: /^\{subject\} called the police about \{object\}$/, tone: 'scandal', lines: [
    '{S} called the police about {O}', '{S} reported {O} to the police', '{S} {S:has} had the police round about {O}',
  ] },
  { re: /^\{subject\} called the police$/, tone: 'crime', lines: ['{S} called the police', '{S} rang the police', '{S} {S:has} been to the police'] },
  { re: /^\{subject\} sprayed graffiti at \{place\}$/, tone: 'scandal', lines: [
    '{S} sprayed graffiti at {P}', '{S} {S:was} the one tagging {P}', 'it was {S} who did the graffiti at {P}', '{S} {S:has} been spraying walls at {P}',
  ] },
  { re: /^\{subject\} stole from \{place\}$/, tone: 'scandal', lines: [
    '{S} stole from {P}', '{S} got caught nicking from {P}', '{S} {S:has} been shoplifting at {P}', '{S} {S:was} pinching things at {P}',
  ] },
  { re: /^\{subject\} had to give up their home at \{place\}: they could not keep up the payments$/, tone: 'bad', lines: [
    '{S} lost {S:poss} home - couldn\'t keep up the payments', '{S} had to give up {P}', 'the bank took {S:poss} house',
    '{S} couldn\'t pay the mortgage and lost {P}',
  ] },
  { re: /^\{subject\} won (.+)$/, tone: 'good', lines: ['{S} won {1}', '{S} only went and won {1}', '{S} {S:has} won {1}'] },
  { re: /^\{subject\} was elected to the town council$/, tone: 'politics', lines: [
    '{S} got elected to the council', '{S} {S:is} on the town council now', '{S} {S:has} got a seat on the council', '{S} won a seat on the council',
  ] },
  { re: /^\{subject\} is standing for mayor$/, tone: 'politics', lines: [
    '{S} {S:is} standing for mayor', '{S} {S:is} running for mayor', '{S} want{S:s} to be mayor', '{S:poss} name is down for mayor',
  ] },
  { re: /^\{subject\} was (re-)?elected mayor with (\d+)% of the vote$/, tone: 'politics', lines: [
    '{S} {S:was} {1}elected mayor[, {2} percent|]', '{S} won the mayor\'s race with {2} percent', '{S} {S:is} mayor [now|again]',
  ] },
  { re: /^\{subject\} beat \{object\} to become mayor, with (\d+)% of the vote$/, tone: 'politics', lines: [
    '{S} beat {O} for mayor', '{S} won against {O}, {1} percent', '{S} {S:is} mayor - beat {O}[ hands down|]',
  ] },
  { re: /^\{subject\} is the new (.+) of (.+)$/, tone: 'news', lines: [
    '{S} {S:is} the new {1} of {2}', '{2} made {S:obj} {1}', '{S} took over as {1} of {2}',
  ] },
  { re: /^\{subject\} is starting (.+)$/, tone: 'news', lines: ['{S} {S:is} starting {1}', '{S} {S:is} setting up {1}', '{S} want{S:s} to start {1}'] },
  { re: /^(.+) has closed down$/, tone: 'bad', lines: [
    '{1} has closed down', '{1} is shut for good', '{1} closed its doors', '{1} has gone under', '{1} is finished - closed',
  ] },
  { re: /^a new (.+) is opening on (.+): (.+)$/, tone: 'news', lines: [
    'a new {1} is opening on {2}', '{3} is opening on {2} - a new {1}', 'there\'s a new {1} coming on {2}, called {3}', 'someone\'s opening a {1} on {2}',
  ] },
  { re: /^the council is talking about (.+)$/, tone: 'politics', lines: [
    'the council is talking about {1}', 'the council want to discuss {1}', 'they\'re on about {1} at the council', '{1} is up at the council',
  ] },
  { re: /^(.+) is holding its (.+) on (.+)$/, tone: 'event', lines: ['{1} is holding its {2} on {3}', '{1}\'s {2} is on {3}', 'it\'s {1}\'s {2} on {3}'] },
  { re: /^(.+) has folded for lack of members$/, tone: 'bad', lines: ['{1} has folded', '{1} is finished - not enough members', '{1} packed up - nobody came'] },
];

const TOPIC_TONE: Record<Fact['topic'], Tone> = {
  job: 'news', romance: 'scandal', family: 'news', health: 'sad', crime: 'crime', politics: 'politics', business: 'news', place: 'news', opinion: 'news', event: 'event', other: 'news',
};

export interface FactPhrasing {
  tone: Tone;
  /** Phrasings with grammar slots, the rule's captures put in. */
  lines: string[];
}

const cache = new Map<string, FactPhrasing>();

/** The ways to say a fact (its template), and its tone. */
export function phrasings(fact: Fact): FactPhrasing {
  const hit = cache.get(fact.text);
  if (hit) return hit;
  let out: FactPhrasing | null = null;
  for (const r of RULES) {
    const m = r.re.exec(fact.text);
    if (!m) continue;
    out = { tone: r.tone, lines: r.lines.map((l) => l.replace(/\{(\d)\}/g, (_, i: string) => m[Number(i)] ?? '')) };
    break;
  }
  out ??= { tone: TOPIC_TONE[fact.topic], lines: [slotted(fact.text)] };
  if (cache.size > 2048) cache.clear();
  cache.set(fact.text, out);
  return out;
}

/** A sim template with the grammar slots put in: "{subject} is ill" → "{S} {S:is} ill", "their" → "{S:poss}". */
export function slotted(template: string): string {
  let s = template
    .replace(/\{subject\} and \{object\}/g, '{S&O}')
    .replace(/\{subject\}'s\b/g, '{S:poss}').replace(/\{object\}'s\b/g, '{O:poss}')
    .replace(/\{subject\} (is|was|has)\b/g, '{S} {S:$1}')
    .replace(/\{subject\}/g, '{S}').replace(/\{object\}/g, '{O}').replace(/\{place\}/g, '{P}');
  if (s.includes('{S&O}')) s = s.replace(/\{S&O\} (is|are)\b/g, '{S&O} {S&O:is}').replace(/\{S&O\} (was|were)\b/g, '{S&O} {S&O:was}');
  else if (s.startsWith('{S}')) s = s.replace(/\btheir\b/g, '{S:poss}');
  return s;
}
