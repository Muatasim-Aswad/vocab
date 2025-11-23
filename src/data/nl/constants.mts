// ’t kofschip list of word engding characters
export const TKOFSHIP_ENDINGS = ["t", "k", "f", "s", "ch", "p", "x"];

// verb prefixes that doesn't take 'ge-' in past participle
export const INSEPARABLE_PREFIXES = ["be", "ge", "er", "her", "ont", "ver"];

// separable verb prefixes
export const SEPARABLE_PREFIXES = [
  "aan",
  "af",
  "bij",
  "binnen",
  "dicht",
  "in",
  "los",
  "mee",
  "na",
  "neer",
  "op",
  "samen",
  "terug",
  "toe",
  "uit",
  "vast",
  "weg",
  "tegen",
];

// ambiguous separable/inseparable prefixes
export const AMBIGUOUS_SEPARATION_PREFIXES = [
  "achter",
  "door",
  "om",
  "onder",
  "over",
  "voor",
  "weer",
];

// vowels
export const VOWELS = ["a", "e", "i", "o", "u"];

// diagraphs
export const DIGRAPHS = ["aa", "ee", "oo", "uu", "oe", "ie", "ei", "ij", "ui", "ou", "au", "eu"];

// Common plural noun patterns (loan words and foreign words typically end in plain -s)
// These words ending in -s are typically plural (not exhaustive, but covers common cases)
export const PLURAL_S_PATTERNS = [
  "auto's", // cars (with apostrophe, but we also catch without)
  "foto's", // photos
  "taxi's", // taxis
  "baby's", // babies
  "hobby's", // hobbies
];

// Common words ending in -s that are typically plural (loan words)
export const COMMON_PLURAL_S_ENDINGS = [
  "autos", // cars
  "fotos", // photos
  "taxis", // taxis
  "hotels", // hotels
  "films", // films
  "computers", // computers
  "robots", // robots
  "bananas", // bananas
  "sofa's",
  "cafés",
  "baby's",
  "hobby's",
];
