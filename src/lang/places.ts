/**
 * Real places a generated name must not be (plan R7: every place name is invented). Well-known towns and cities
 * of the English-speaking world, and the real places our name generators can produce from their roots and endings
 * (the town, the region's villages and towns, the river). Lower case, no spaces folded: `isRealPlace` compares
 * case-insensitively and ignores spaces and "St"/"Saint". Add a name here when a generator turns out to make it.
 */
const REAL = [
  // Generated from plan/names.ts roots + endings (checked 2026-10-18).
  'ashford', 'ashton', 'ashfield', 'ashtead', 'ashdale', 'ashbridge', 'elmbridge', 'elmstead', 'elmfield', 'elmdale',
  'hazelton', 'haslemere', 'hazelmere', 'mapleton', 'mapledale', 'oakford', 'oakfield', 'oakdale', 'oakham', 'oakton',
  'pinedale', 'pinehaven', 'willowdale', 'willowfield', 'alderton', 'alderford', 'hollyford', 'ferndale', 'fernhill',
  'heatherton', 'thistleton', 'brackenfield', 'milford', 'millford', 'millbridge', 'millgate', 'bridgeton', 'bridgeford',
  'churchgate', 'castleford', 'castleton', 'castlegate', 'castlehaven', 'abbeydale', 'abbeystead', 'chapelton',
  'hillsdale', 'brookhaven', 'brookfield', 'brookdale', 'brookton', 'riverton', 'riverdale', 'riverhead', 'lakefield',
  'laketon', 'springfield', 'springdale', 'springton', 'stonehaven', 'stonebridge', 'stonegate', 'stonefield',
  'silverdale', 'silverton', 'slateford', 'ambergate', 'larkfield', 'otterton', 'otterford', 'swallowfield',
  'cloverdale', 'copperfield', 'meadowdale', 'masonfield', 'potterton', 'fairfield', 'fairhaven', 'summitville',
  'newhaven', 'new haven', 'newbridge', 'newmarket', 'newton', 'newport', 'portland', 'northfield', 'eastfield',
  'northwick', 'eastgate', 'northgate', 'westgate',
  // The region's villages and towns (plan/region.ts stems and endings; the design audit of 2026-10-18).
  'salford', 'kingston', 'whitby', 'tilbury', 'stourbridge', 'sandhurst', 'everton', 'salcombe', 'ashby', 'thornton',
  'stanford', 'walton', 'norton', 'clayton', 'harwell', 'halstead', 'thornbury', 'princeton', 'ironbridge', 'ironton',
  'carrollton', 'warrenton', 'lincolnton', 'franklinton', 'kington', 'kingsbury', 'kingsbridge', 'kingswood',
  // Well-known towns and cities.
  'london', 'manchester', 'birmingham', 'liverpool', 'leeds', 'bristol', 'oxford', 'cambridge', 'york', 'bath',
  'brighton', 'chester', 'winchester', 'canterbury', 'dover', 'reading', 'plymouth', 'exeter', 'durham', 'lancaster',
  'edinburgh', 'glasgow', 'aberdeen', 'dundee', 'cardiff', 'swansea', 'belfast', 'dublin', 'cork', 'galway',
  'boston', 'chicago', 'denver', 'dallas', 'houston', 'phoenix', 'seattle', 'portsmouth', 'salem', 'dayton',
  'arlington', 'lexington', 'madison', 'franklin', 'clinton', 'jackson', 'lincoln', 'columbia', 'georgetown',
  'hamilton', 'burlington', 'richmond', 'greenville', 'fairview', 'riverside', 'oakland', 'lakewood', 'brentwood',
  'toronto', 'ottawa', 'montreal', 'vancouver', 'calgary', 'halifax', 'victoria', 'kelowna', 'oakville', 'guelph',
  'sydney', 'melbourne', 'perth', 'adelaide', 'brisbane', 'hobart', 'darwin', 'auckland', 'wellington', 'christchurch',
];

const SET = new Set(REAL.map(fold));

function fold(name: string): string {
  return name.toLowerCase().replace(/\b(st|saint)\.?\s+/g, '').replace(/[^a-z]/g, '');
}

/** Is this name (a town, a village, a river's name) a real place? */
export function isRealPlace(name: string): boolean {
  const f = fold(name);
  if (SET.has(f)) return true;
  // "North Ashford", "Port Riverton", "Ashford Junction": a real place inside the name.
  const words = name.toLowerCase().split(/\s+/).map(fold);
  return words.some((w) => SET.has(w));
}
