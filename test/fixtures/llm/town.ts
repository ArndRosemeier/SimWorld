/**
 * A small, fixed conversation context for the LLM tests and the record script: Ruth, the baker,
 * talks with Tom, a regular, in her shop. Ids are arbitrary but stable.
 */
import type { NpcPromptInput } from '../../../src/llm';

export const RUTH = 11;
export const TOM = 22;
export const ANNA = 33; // Ruth's sister
export const BAKERY = 101;
export const FOUNTAIN = 102;

export function bakeryScene(lastLine = 'Morning, Ruth! Did you hear the mill is closing?'): NpcPromptInput {
  return {
    npc: {
      id: RUTH, name: 'Ruth Keller', age: 52, gender: 'woman', occupation: 'baker, owns the bakery on Mill Street',
      home: 'the flat above the bakery',
      traits: { openness: 0.4, conscientiousness: 0.85, extraversion: 0.6, agreeableness: 0.7, neuroticism: 0.35 },
      values: { honesty: 0.9, loyalty: 0.8, ambition: 0.3 },
      speechStyle: 'Warm but brisk, calls regulars "love", short sentences, hates gossip she cannot check.',
      biography: 'Took over the bakery from her father twenty years ago. Widowed, one grown son in the city. Up at four every day.',
    },
    partner: { id: TOM, name: 'Tom Brandt', bonds: ['customer'], feelings: { familiarity: 0.6, affection: 0.4, trust: 0.3, respect: 0.2 }, knownFacts: ['works at the mill', 'buys two rye loaves every Saturday'] },
    state: { mood: 'busy but cheerful', activity: 'serving the morning queue', needs: 'a bit tired' },
    scene: { place: { id: BAKERY, name: 'Keller\'s Bakery', kind: 'bakery' }, clock: 'Saturday 07:40', weather: 'drizzle', present: [{ id: TOM, name: 'Tom Brandt' }] },
    people: [{ id: ANNA, name: 'Anna Keller', bonds: ['sister'], feelings: { familiarity: 1, affection: 0.8, trust: 0.9, respect: 0.6 } }],
    places: [{ id: FOUNTAIN, name: 'the market fountain', kind: 'square' }],
    beliefs: [{ text: 'Anna Keller is looking for a new flat', source: { person: ANNA }, confidence: 0.9, about: { people: [ANNA] } }],
    memories: [{ when: 'last Saturday', summary: 'Tom complained the rye was too dark.' }],
    turns: [{ speaker: 'partner', text: lastLine }],
  };
}
