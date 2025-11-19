import { ask, s, view } from "./terminal.mjs";
import { deduceDutchWordInfo, wordTypes, specialTypes } from "../data/nl.mjs";
import { Vocab } from "../data/repository.mjs";

// Form shortcuts mapping
const FORM_SHORTCUTS: Record<string, keyof typeof wordTypes> = {
  n: "noun",
  v: "verb",
  adj: "adjective",
  adv: "adverb",
  pron: "pronoun",
  det: "determiner",
  prep: "preposition",
  conj: "conjunction",
  int: "interjection",
};

// Type shortcuts mapping
const TYPE_SHORTCUTS: Record<string, string> = {
  refl: "reflexive",
  sep: "separable",
  sing: "singular",
  pl: "plural",
  dim: "diminutive",
  comp: "comparative",
  sup: "superlative",
  infl: "inflected",
};

export interface PromptOptions {
  include?: {
    word?: boolean;
    form?: boolean;
    types?: boolean;
    forms?: boolean;
    irregular?: boolean;
    related?: boolean;
    example?: boolean;
  };
  existingEntry?: Vocab;
  mode?: "create" | "edit";
}

export interface PromptResult {
  word?: string;
  form?: keyof typeof wordTypes;
  types?: string[];
  forms?: string[];
  irregular?: boolean;
  related?: string[];
  example?: string;
}

/**
 * Resolve form input to full form name (handles shortcuts)
 */
function resolveFormInput(input: string): keyof typeof wordTypes | undefined {
  const trimmed = input.trim().toLowerCase();
  if (!trimmed) return undefined;

  // Check if it's a shortcut
  if (trimmed in FORM_SHORTCUTS) {
    return FORM_SHORTCUTS[trimmed];
  }

  // Check if it's a full form name
  if (trimmed in wordTypes) {
    return trimmed as keyof typeof wordTypes;
  }

  return undefined;
}

/**
 * Resolve type inputs to full type names (handles shortcuts)
 */
function resolveTypeInputs(inputs: string[]): string[] {
  return inputs.map((input) => {
    const trimmed = input.trim().toLowerCase();

    // Check if it's a shortcut
    if (trimmed in TYPE_SHORTCUTS) {
      return TYPE_SHORTCUTS[trimmed];
    }

    // Return as-is if it's a special type or custom
    return trimmed;
  });
}

/**
 * Unified word prompter for creating and editing vocabulary entries
 * Handles prompts, validations, and building the result object
 */
export async function promptWordFields(
  word: string,
  options: PromptOptions,
  processArrayInput: (input: string, existingArray?: string[]) => string[],
): Promise<PromptResult> {
  const { include = {}, existingEntry, mode = "create" } = options;
  const result: PromptResult = {};

  // Set defaults from include if not specified
  const fields = {
    word: include.word ?? false,
    form: include.form ?? false,
    types: include.types ?? false,
    forms: include.forms ?? false,
    irregular: include.irregular ?? false,
    related: include.related ?? false,
    example: include.example ?? false,
  };

  // Deduce word info for defaults
  const deduced = deduceDutchWordInfo(word);

  // Display instructions once at the beginning
  view(s.a("\n📝 Input Instructions:"));
  view("  • Press Enter to skip or keep the current/default value");
  view("  • For arrays: use comma-separated values, or prefix with 'add ' to append");
  view("  • Use [n/N] to explicitly negate boolean fields");
  view("");
  view(s.a("  Word Forms:"));
  view("    noun (n), verb (v), adjective (adj), adverb (adv), pronoun (pron),");
  view("    determiner (det), preposition (prep), conjunction (conj), interjection (int)");
  view("");
  view(s.a("  Special Types:"));
  view("    reflexive (refl), separable (sep), singular (sing), plural (pl),");
  view("    diminutive (dim), comparative (comp), superlative (sup), inflected (infl)");
  view("");

  // Prompt for word (usually only in edit mode)
  if (fields.word) {
    const currentWord = existingEntry?.word || word;
    const newWord = await ask(`Word (${s.alert(currentWord)}): `);
    if (newWord.trim()) {
      result.word = newWord.trim();
    }
  }

  // Prompt for example
  if (fields.example) {
    const currentExample = existingEntry?.example || "";
    const prompt = currentExample ? `Example (${s.alert(currentExample)}): ` : `Example: `;
    const exampleInput = await ask(prompt);
    if (exampleInput.trim()) {
      result.example = exampleInput.trim();
    }
  }

  // Prompt for form
  if (fields.form) {
    const defaultForm = existingEntry?.form || deduced.form;
    const prompt = defaultForm ? `Form (${s.alert(defaultForm)}): ` : `Form: `;
    const formInput = await ask(prompt);
    const resolvedForm = resolveFormInput(formInput) || defaultForm;
    if (resolvedForm) {
      result.form = resolvedForm;
    }
  } else if (mode === "create") {
    // Auto-set deduced form if not explicitly asking
    if (deduced.form) {
      result.form = deduced.form;
    }
  }

  // Prompt for types
  if (fields.types) {
    const defaultTypes = existingEntry?.types?.join(", ") || deduced.types?.join(", ") || "";
    const prompt = defaultTypes ? `Types (${s.alert(defaultTypes)}): ` : `Types: `;
    const typesInput = await ask(prompt);

    if (typesInput.trim()) {
      const rawTypes = processArrayInput(typesInput, existingEntry?.types);
      result.types = resolveTypeInputs(rawTypes);
    } else if (!existingEntry && defaultTypes) {
      // Use deduced types for new entries if no input
      result.types = deduced.types;
    }
  } else if (mode === "create") {
    // Auto-set deduced types if not explicitly asking
    if (deduced.types) {
      result.types = deduced.types;
    }
  }

  // Prompt for forms (conjugations/declensions)
  if (fields.forms) {
    const wordForm = result.form || existingEntry?.form || deduced.form;
    const currentForms = existingEntry?.forms?.join(", ") || "";

    let formsPrompt: string;
    if (wordForm === "verb") {
      formsPrompt = currentForms ? `Verb forms (${s.alert(currentForms)}): ` : `Verb forms: `;
    } else if (wordForm === "noun") {
      formsPrompt = currentForms ? `Noun forms (${s.alert(currentForms)}): ` : `Noun forms: `;
    } else {
      formsPrompt = currentForms ? `Forms (${s.alert(currentForms)}): ` : `Forms: `;
    }

    const formsInput = await ask(formsPrompt);
    if (formsInput.trim()) {
      result.forms = processArrayInput(formsInput, existingEntry?.forms);
    }
  }

  // Prompt for irregular flag
  if (fields.irregular) {
    const currentIrregular = existingEntry?.irregular ?? false;
    const currentValue = currentIrregular ? "y" : "n";
    const irregularInput = await ask(`Irregular? (${s.alert(currentValue)}) [y/N]: `);

    if (irregularInput.trim()) {
      result.irregular = irregularInput.toLowerCase() === "y";
    } else if (mode === "edit") {
      result.irregular = currentIrregular;
    }
  }

  // Prompt for related words
  if (fields.related) {
    const currentRelated = existingEntry?.related?.join(", ") || "";
    const prompt = currentRelated
      ? `Related words (${s.alert(currentRelated)}): `
      : `Related words: `;
    const relatedInput = await ask(prompt);

    if (relatedInput.trim()) {
      result.related = processArrayInput(relatedInput, existingEntry?.related);
    }
  }

  return result;
}
