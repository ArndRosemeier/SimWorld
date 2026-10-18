/**
 * Procedural answers in a chat (plan §3.2 "Fallback", §4): what an inhabitant says when no language model answers
 * (no key, an outage, a timeout). The game must be fully playable without an LLM, so this reads the very same
 * prompt input the LLM gets (`NpcPromptInput`: only what this person believes) and answers from it: greetings by how
 * well they know you, how they are, what they are up to, their work, the news they carry (hedged by how sure they
 * are and who told them), what they think of someone you name, the weather, goodbyes.
 *
 * Deterministic per conversation and turn (seeded), shaped by personality and feelings: the shy answer short, the
 * disagreeable curtly, a friend warmly. It is the first piece of the procedural text engine; the chatter grammar of
 * plan §4 grows here and will replace the phrase lists.
 */
import { Rng, deriveSeed, hashString } from '@futuremagic/core';
import type { Belief, NpcPromptInput, PersonRef } from '../llm/prompt';
import { capitalize } from '../sim/profile';

/** "the bakery" → "The bakery". */
const lowFirst = (s: string) => (/^[A-Z][a-z]/.test(s) && !/^[A-Z][a-z]+ [A-Z]/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s);
const first = (name: string) => name.split(/\s+/)[0];

/** What the partner's line is after, roughly. */
export type Intent = 'greet' | 'bye' | 'thanks' | 'howAreYou' | 'doing' | 'work' | 'news' | 'person' | 'place' | 'weather' | 'yes' | 'no' | 'question' | 'statement';

const RE: [Intent, RegExp][] = [
  ['bye', /\b(bye|goodbye|see you|see ya|take care|cheerio|good night|gotta go|have to go|must go|later)\b/i],
  ['thanks', /\b(thanks|thank you|cheers|appreciate it)\b/i],
  ['howAreYou', /\bhow (are|r) (you|u)\b|\bhow('s| is) it going\b|\bhow have you been\b|\byou (ok|okay|alright)\b|\bhow are things\b/i],
  ['news', /\b(news|gossip|heard|hear anything|what's new|whats new|anything new|happening|going on|rumou?r)\b/i],
  ['weather', /\b(weather|rain|raining|sunny|snow|cold|hot|warm|freezing|wind|windy|fog)\b/i],
  ['work', /\b(work|job|working|do for a living|shift|boss|business)\b/i],
  ['doing', /\bwhat are you (doing|up to)\b|\bwhere are you (going|off to|headed)\b|\bwhat brings you\b/i],
  ['greet', /^\s*(hi|hello|hey|hiya|morning|good (morning|afternoon|evening)|evening|afternoon|howdy|yo)\b/i],
  ['yes', /^\s*(yes|yeah|yep|sure|ok|okay|of course|right)\b/i],
  ['no', /^\s*(no|nope|nah|not really)\b/i],
];

/** The intents of a line (several can apply: "Hi Ruth, any news?"), the strongest first. */
export function intentsOf(line: string, input: NpcPromptInput): Intent[] {
  const out: Intent[] = [];
  for (const [k, re] of RE) if (re.test(line)) out.push(k);
  // A greeting answers first ("Hello there. Oh, getting by.").
  if (out.includes('greet')) out.sort((a, b) => (b === 'greet' ? 1 : 0) - (a === 'greet' ? 1 : 0));
  if (namedPerson(line, input)) out.splice(out[0] === 'greet' ? 1 : 0, 0, 'person');
  else if (namedPlace(line, input)) out.push('place');
  if (!out.length || (out.length === 1 && out[0] === 'greet' && /\?\s*$/.test(line) && line.length > 25)) out.push(/\?\s*$/.test(line) ? 'question' : 'statement');
  return out;
}

/** Someone the NPC knows, named in the line (not the NPC or the partner themselves). */
function namedPerson(line: string, input: NpcPromptInput): PersonRef | undefined {
  const low = line.toLowerCase();
  const all = [...input.people, ...input.scene.present.filter((p) => p.id !== input.partner.id)];
  return all.find((p) => {
    const f = first(p.name).toLowerCase();
    return (f.length >= 3 && new RegExp(`\\b${f.replace(/[^a-z]/g, '')}\\b`).test(low)) || low.includes(p.name.toLowerCase());
  });
}

function namedPlace(line: string, input: NpcPromptInput) {
  const low = line.toLowerCase();
  return input.places.find((p) => low.includes(p.name.toLowerCase()) || (p.name.length > 6 && low.includes(p.name.toLowerCase().replace(/^the /, ''))));
}

interface Voice {
  r: Rng;
  /** 0..1 */
  talkative: number;
  warm: number;
  /** How the NPC feels about the partner: -1..1. */
  liking: number;
  familiar: number;
  partner: string;
}

/** A line already said in this conversation by the NPC (no news twice). */
const said = (input: NpcPromptInput, text: string) => input.turns.some((t) => t.speaker === 'npc' && t.text.toLowerCase().includes(text.toLowerCase().slice(0, 40)));

function hedge(v: Voice, b: Belief, input: NpcPromptInput): string {
  const text = lowFirst(b.text);
  if (b.source === 'saw') return v.r.pick([`I saw it myself: ${text}.`, `${capitalize(text)}. Saw it with my own eyes.`]);
  if (b.source === 'common' || !b.source) return `${capitalize(text)}.`;
  const src = b.source.person === input.partner.id ? 'you' : [...input.people, ...input.scene.present].find((p) => p.id === (b.source as { person: number }).person)?.name;
  const who = src ? (src === 'you' ? 'you' : first(src)) : 'someone';
  if (who === 'you') return `You told me ${text}, didn't you?`;
  if (b.confidence > 0.75) return v.r.pick([`${capitalize(text)}. ${who} told me.`, `${who} says ${text}.`]);
  if (b.confidence > 0.4) return v.r.pick([`Apparently ${text}. At least that's what ${who} said.`, `I heard from ${who} that ${text}.`]);
  return v.r.pick([`${who} reckons ${text}, but I don't know if I believe it.`, `There's talk that ${text}. Could be nonsense.`]);
}

function greet(v: Voice, input: NpcPromptInput): string {
  const name = v.familiar > 0.35 ? first(v.partner) : '';
  if (v.liking < -0.45) return v.r.pick(['Oh. It\'s you.', `${name || 'Yes'}?`, 'What do you want?']);
  const h = parseInt(/(\d\d):/.exec(input.scene.clock)?.[1] ?? '12', 10);
  const tod = h < 12 ? 'Morning' : h < 18 ? 'Afternoon' : 'Evening';
  if (v.familiar < 0.15) return v.warm > 0.5 ? v.r.pick([`${tod}. Can I help you?`, 'Hello there.', `Good ${tod.toLowerCase()}.`]) : v.r.pick(['Hello.', `${tod}.`, 'Yes?']);
  const base = v.r.pick(name ? [`Hello, ${name}!`, `${tod}, ${name}.`, `Hiya ${name}.`, `Oh, hi ${name}.`] : ['Hello!', `${tod}!`]);
  return v.talkative > 0.6 ? `${base} ${v.r.pick(['Good to see you.', 'Long time no see.', 'How are you keeping?', 'Fancy meeting you here.'])}` : base;
}

function howAreYou(v: Voice, input: NpcPromptInput): string {
  const mood = input.state.mood, needs = input.state.needs ?? '';
  const curt = v.liking < -0.3 || v.talkative < 0.3;
  const core = /good|pleased|delighted/.test(mood) ? v.r.pick(['Not bad at all, thanks.', 'Good, actually.', 'Can\'t complain.'])
    : /low|miserable|sad|down/.test(mood) ? v.r.pick(['Honestly? Not great.', 'Been better.', 'Bit of a rough patch.'])
      : /angry|irritated/.test(mood) ? v.r.pick(['Don\'t ask.', 'Fed up, if you must know.'])
        : v.r.pick(['Fine, thanks.', 'Oh, you know. Getting by.', 'Same as ever.']);
  if (curt) return core;
  const extra = /exhausted|tired/.test(needs) ? ' Shattered, mind you.' : /hungry/.test(needs) ? ' Starving, though.' : '';
  return `${core}${extra} ${v.warm > 0.5 ? 'And you?' : ''}`.trim();
}

function doing(v: Voice, input: NpcPromptInput): string {
  const act = input.state.activity;
  if (v.liking < -0.4) return v.r.pick(['That\'s my business.', 'Nothing that concerns you.']);
  return capitalize(`${act.startsWith('on the way') ? 'I\'m ' : 'Just '}${act.replace(/^on the way/, 'on my way')}.`);
}

function work(v: Voice, input: NpcPromptInput): string {
  const occ = input.npc.occupation;
  if (!occ) return v.r.pick(['I\'m between jobs at the moment.', 'Nothing much, these days.']);
  if (occ === 'retired') return v.r.pick(['I\'m retired, thank goodness.', 'Retired. Best job I ever had.']);
  if (occ.startsWith('pupil') || occ.startsWith('goes to')) return `School. ${v.r.pick(['It\'s fine.', 'Boring.', 'It\'s alright, I suppose.'])}`;
  if (occ === 'out of work') return v.r.pick(['I\'m out of work at the moment.', 'Looking for something. Times are hard.']);
  const [role, where] = occ.split(' at ');
  return v.talkative < 0.35 ? `${capitalize(role)}${where ? `, at ${where}` : ''}.` : `I'm ${/^[aeiou]/i.test(role) ? 'an' : 'a'} ${role}${where ? ` at ${where}` : ''}. ${v.r.pick(['Keeps me busy.', 'It pays the bills.', 'I like it, mostly.', 'Long hours, but there you go.'])}`;
}

function news(v: Voice, input: NpcPromptInput): string {
  if (v.liking < -0.4 || (v.familiar < 0.1 && v.talkative < 0.4)) return v.r.pick(['Nothing I\'d tell you.', 'Not that I know of.']);
  const b = input.beliefs.find((x) => x.source !== 'common' && !said(input, x.text) && !(typeof x.source === 'object' && x.source.person === input.partner.id));
  if (!b) return v.r.pick(['Nothing much, really. Quiet as ever.', 'Not that I\'ve heard.', 'All quiet, as far as I know.']);
  return hedge(v, b, input);
}

function aboutPerson(v: Voice, input: NpcPromptInput, p: PersonRef): string {
  const name = first(p.name);
  const b = input.beliefs.find((x) => x.about?.people?.includes(p.id) && !said(input, x.text));
  const bond = p.bonds?.[0];
  const f = p.feelings;
  const feel = !f ? `${name}? Don't really know them.`
    : f.affection > 0.5 ? `${name}? ${bond ? `My ${bond}. ` : ''}${v.r.pick(['Lovely person.', 'I\'m very fond of them.', 'Salt of the earth.'])}`
      : f.affection < -0.4 ? `${name}? ${v.r.pick(['Don\'t get me started.', 'I\'d rather not talk about them.', 'We don\'t get on.'])}`
        : `${name}? ${bond ? `My ${bond}. ` : ''}${v.r.pick(['Nice enough.', 'I know them a bit.', 'Seems alright.'])}`;
  return b && v.liking > -0.3 ? `${feel} ${hedge(v, b, input)}` : feel;
}

function weather(v: Voice, input: NpcPromptInput): string {
  const w = input.scene.weather;
  if (!w) return 'Can\'t complain about the weather.';
  const wet = /rain|drizzle|pour|storm|sleet|snow/.test(w);
  const nice = /sunny|clear|bright/.test(w);
  return wet ? v.r.pick([`Miserable, isn't it? ${capitalize(w.split(',')[0])}.`, 'Wet again. Typical.']) : nice ? v.r.pick(['Lovely day for it.', 'Makes a change, this sunshine.']) : v.r.pick([`${capitalize(w.split(',')[0])}. Could be worse.`, 'Grey old day.']);
}

/**
 * The NPC's answer to the partner's newest line, without an LLM. Same input as `npc.speech`, so it can never say
 * more than the NPC believes.
 */
export function proceduralReply(input: NpcPromptInput): string {
  const line = [...input.turns].reverse().find((t) => t.speaker === 'partner')?.text ?? '';
  const t = input.npc.traits;
  const f = input.partner.feelings;
  const v: Voice = {
    r: new Rng(deriveSeed(hashString(input.conversation), input.turns.length, hashString(line))),
    talkative: t.extraversion, warm: (t.agreeableness + (f ? (f.affection + 1) / 2 : 0.5)) / 2, liking: f?.affection ?? 0, familiar: f?.familiarity ?? 0,
    partner: input.partner.name,
  };
  // The taciturn answer only the point, skipping the hello.
  const all = intentsOf(line, input);
  const intents = v.talkative < 0.35 && all.length > 1 ? all.filter((i) => i !== 'greet') : all;
  const parts: string[] = [];
  for (const k of intents.slice(0, 2)) {
    let s = '';
    switch (k) {
      case 'greet': s = greet(v, input); break;
      case 'bye': s = v.liking < -0.3 ? 'Right. Bye.' : v.r.pick(['Bye then, take care.', 'See you around.', `Mind how you go${v.familiar > 0.35 ? `, ${first(v.partner)}` : ''}.`]); break;
      case 'thanks': s = v.r.pick(['You\'re welcome.', 'No trouble.', 'Any time.']); break;
      case 'howAreYou': s = howAreYou(v, input); break;
      case 'doing': s = doing(v, input); break;
      case 'work': s = work(v, input); break;
      case 'news': s = news(v, input); break;
      case 'person': { const p = namedPerson(line, input); s = p ? aboutPerson(v, input, p) : ''; break; }
      case 'place': { const p = namedPlace(line, input); s = p ? v.r.pick([`${capitalize(p.name)}? I know it.`, `${capitalize(p.name)}, yes. What about it?`]) : ''; break; }
      case 'weather': s = weather(v, input); break;
      case 'yes': s = v.r.pick(['Good.', 'Right you are.', 'Glad to hear it.']); break;
      case 'no': s = v.r.pick(['Fair enough.', 'Oh well.', 'Suit yourself.']); break;
      case 'question': s = v.liking < -0.4 ? 'Why would I tell you?' : v.r.pick(['I couldn\'t tell you, sorry.', 'No idea, honestly.', 'Hm. Not sure. Why do you ask?', 'You\'d have to ask someone else about that.']); break;
      case 'statement': s = v.talkative < 0.35 ? v.r.pick(['Hm.', 'Right.', 'I see.']) : v.r.pick(['Is that so?', 'Really? Well I never.', 'Fair enough.', 'Hm, you don\'t say.', 'Funny you should say that.']); break;
    }
    if (s && !parts.includes(s)) parts.push(s);
    if (v.talkative < 0.35) break;
  }
  return parts.join(' ') || '...';
}
