/**
 * The words that would place the town in a real region (D27: an invented, western-adjacent world; Arnd,
 * 2026-10-18: "nothing identifying a region"). The vocabulary itself is in `words.ts`; this is the check every
 * phrase bank, story phrasing and sample of generated talk runs against (test/talk.test.ts, the chatter slow test).
 * A pure leaf: no imports.
 */

/**
 * Words that mark a region's English ("mom", "mum", "vacation", "fall", "Alright?", "y'all"): none of them may be
 * said in town. The tests run every bank, every story phrasing and a day of talk against it.
 */
export const DIALECT_MARKED: readonly RegExp[] = [
  /\b(mom|moms|mommy|momma|mum|mums|mummy)\b/i, /\bvacation\b/i, /\bholiday\b/, /\b(the|this|in|last|next) fall\b/i, /\bautumn\b/,
  /\by'all\b/i, /\beh\?/i, /^Alright\?/, /\b(mate|buddy|bloody|blimey|knackered|cheers|ta|innit|reckon|gotten|y'know)\b/, // (lower case: "Buddy" is a dog's name)
  /\b(queue|fortnight|poorly|gran|grandad|flatmate|the flats|apartments?|sidewalk|pavement|petrol|candy|sweets|rubbish|garbage|trash)\b/i,
  /\b(courting|fella|lads|folks|awesome|brilliant|proper|sorted|cuppa|hiya|oi|cosy|cozy|realise|realize)\b/i,
];

/** The first word or phrase of `text` that marks a region's English, or null. */
export function dialectMarked(text: string): string | null {
  for (const re of DIALECT_MARKED) { const m = re.exec(text); if (m) return m[0]; }
  return null;
}
