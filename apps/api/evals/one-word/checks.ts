import type { Case, Lemma } from "./cases.ts";

/** Only facts a program can decide; meaning is left to the grader. */
interface SenseCheck {
  index: number;
  term: string;
  termKnown: boolean;
  correctedOk: boolean;
  partOfSpeechOk: boolean;
  /** The reference lemma whose forms fit best, with what differs; null when the sense has no forms. */
  forms: { lemma: string; missing: string[]; unexpected: string[] } | null;
  flagIssues: string[];
  exampleUsesWord: boolean;
}

export interface RunCheck {
  parsed: boolean;
  senseCount: number;
  essentialCount: number;
  senses: SenseCheck[];
  issues: string[];
}

interface DraftSense {
  term?: unknown;
  corrected?: unknown;
  senseCue?: unknown;
  examples?: unknown;
  partOfSpeech?: unknown;
  forms?: unknown;
  separable?: unknown;
  irregular?: unknown;
  relations?: unknown;
}

function isDraftSense(value: unknown): value is DraftSense {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const normalize = (value: string) => value.trim().toLowerCase().replace(/\s+/g, " ");
const bare = (term: string) => normalize(term).replace(/^(de|het|zich) /, "");

function formsAgainst(lemma: Lemma, forms: string[]) {
  const given = new Set(forms.map(normalize));
  const allowed = new Set([...lemma.forms.required, ...lemma.forms.optional].map(normalize));
  return {
    lemma: lemma.id,
    missing: lemma.forms.required.filter((form) => !given.has(normalize(form))),
    unexpected: [...given].filter((form) => !allowed.has(form)),
  };
}

function bestForms(candidates: Lemma[], forms: string[]) {
  const scored = candidates.map((lemma) => formsAgainst(lemma, forms));
  scored.sort(
    (a, b) => a.missing.length + a.unexpected.length - (b.missing.length + b.unexpected.length),
  );
  return scored[0] ?? null;
}

/** An example shows the word when every part of the term or of one of its forms appears in it. */
function usesWord(example: string, words: string[]): boolean {
  const tokens = new Set(
    normalize(example)
      .replaceAll(/[^\p{L}\s-]/gu, " ")
      .split(" "),
  );
  return words.some((word) =>
    normalize(word)
      .split(" ")
      .every((part) => tokens.has(part)),
  );
}

/** A separable verb's split te-infinitive ("bij te houden"), taken from a split form's particle. */
function teInfinitive(lemma: Lemma): string[] {
  const particle = lemma.forms.required.find((form) => form.includes(" "))?.split(" ")[1];
  const infinitive = bare(lemma.terms[0] ?? "");
  if (!lemma.separable || !particle || !infinitive.startsWith(particle)) return [];
  return [`${particle} te ${infinitive.slice(particle.length)}`];
}

function checkSense(item: Case, sense: DraftSense, index: number): SenseCheck {
  const term = typeof sense.term === "string" ? sense.term : "";
  const lemmas = item.lemmas.filter((lemma) =>
    lemma.terms.some((known) => normalize(known) === normalize(term)),
  );
  const pos = typeof sense.partOfSpeech === "string" ? sense.partOfSpeech : "";
  const samePos = lemmas.filter((lemma) => lemma.partOfSpeech === pos);
  const forms = Array.isArray(sense.forms) ? sense.forms.filter((f) => typeof f === "string") : [];
  const fit = forms.length ? bestForms(samePos.length ? samePos : lemmas, forms) : null;
  const matched = item.lemmas.find((lemma) => lemma.id === fit?.lemma);
  const flagIssues: string[] = [];
  for (const flag of ["separable", "irregular"] as const) {
    const expected = matched?.[flag];
    if (expected !== undefined && sense[flag] !== undefined && sense[flag] !== expected)
      flagIssues.push(`${flag}: ${JSON.stringify(sense[flag])}, expected ${String(expected)}`);
  }
  const examples = Array.isArray(sense.examples)
    ? sense.examples.filter((example) => typeof example === "string")
    : [];
  const words = [
    bare(term),
    ...item.lemmas.flatMap((l) => [...l.forms.required, ...l.forms.optional, ...teInfinitive(l)]),
  ];
  return {
    index,
    term,
    termKnown: lemmas.length > 0,
    correctedOk: sense.corrected === (normalize(term) !== normalize(item.input)),
    partOfSpeechOk: samePos.length > 0,
    forms: fit,
    flagIssues,
    exampleUsesWord: examples.length > 0 && examples.every((example) => usesWord(example, words)),
  };
}

export function checkRun(item: Case, text: string): RunCheck {
  const essentialCount = item.senses.filter((sense) => sense.tier === "essential").length;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { parsed: false, senseCount: 0, essentialCount, senses: [], issues: ["invalid JSON"] };
  }
  if (!Array.isArray(value))
    return { parsed: false, senseCount: 0, essentialCount, senses: [], issues: ["not an array"] };
  if (!value.every(isDraftSense))
    return { parsed: false, senseCount: 0, essentialCount, senses: [], issues: ["not an object"] };

  const senses = value.map((sense, index) => checkSense(item, sense, index));
  const cues = value.map((sense) =>
    typeof sense.senseCue === "string" ? normalize(sense.senseCue) : "",
  );
  const issues: string[] = [];
  if (senses.length > 1 && cues.some((cue) => !cue)) issues.push("missing senseCue");
  if (new Set(cues.filter(Boolean)).size !== cues.filter(Boolean).length)
    issues.push("duplicate senseCue");
  if (cues.some((cue, index) => cue && cue === bare(senses[index]?.term ?? "")))
    issues.push("senseCue is the term");
  const listed = cues.filter((cue, index) => {
    const relations = value[index]?.relations;
    return (
      cue &&
      Array.isArray(relations) &&
      relations.some(
        (relation: { type?: unknown; term?: unknown }) =>
          relation.type === "synonym" &&
          typeof relation.term === "string" &&
          normalize(relation.term) === cue,
      )
    );
  });
  if (listed.length) issues.push(`senseCue is a listed synonym: ${listed.join(", ")}`);
  return { parsed: true, senseCount: senses.length, essentialCount, senses, issues };
}
