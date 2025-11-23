import { ask, s, view } from "./terminal.mjs";
import {
  deduceDutchWordInfo,
  wordTypes,
  specialTypes,
} from "../data/nl/utils/deduceDutchWordInfo.mjs";
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
    phrases?: boolean;
  };
  existingEntry?: Vocab;
  mode?: "create" | "edit";
}

export interface PromptResult {
  word?: string;
  form?: (keyof typeof wordTypes)[];
  types?: string[];
  forms?: string[];
  irregular?: boolean;
  related?: string[];
  example?: string;
  phrases?: string[];
}

/**
 * Resolve form inputs to full form names (handles shortcuts and multiple values)
 */
function resolveFormInputs(inputs: string[]): (keyof typeof wordTypes)[] {
  return inputs
    .map((input) => {
      const trimmed = input.trim().toLowerCase();

      // Check if it's a shortcut
      if (trimmed in FORM_SHORTCUTS) {
        return FORM_SHORTCUTS[trimmed];
      }

      // Check if it's a full form name
      if (trimmed in wordTypes) {
        return trimmed as keyof typeof wordTypes;
      }

      return null;
    })
    .filter((f): f is keyof typeof wordTypes => f !== null);
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
 * Check if input is a clear command
 */
function isClearCommand(input: string): boolean {
  const trimmed = input.trim();
  return trimmed === "-" || trimmed.toLowerCase() === "clear";
}

/**
 * Build a prompt string with optional current value highlighted
 */
function buildPrompt(label: string, currentValue?: string): string {
  return currentValue ? `${label} (${s.alert(currentValue)}): ` : `${label}: `;
}

/**
 * Prompt for a simple string field with clear support
 */
async function promptStringField(
  label: string,
  currentValue?: string,
): Promise<string | undefined> {
  const prompt = buildPrompt(label, currentValue);
  const input = await ask(prompt);

  if (isClearCommand(input)) {
    return "";
  } else if (input.trim()) {
    return input.trim();
  }
  return undefined;
}

/**
 * Prompt for an array field with clear and add support (without resolver)
 */
async function promptArrayField(
  label: string,
  currentValue: string[] | undefined,
  processArrayInput: (input: string, existing?: string[]) => string[],
): Promise<string[] | undefined>;

/**
 * Prompt for an array field with clear and add support (with resolver)
 */
async function promptArrayField<T>(
  label: string,
  currentValue: T[] | undefined,
  processArrayInput: (input: string, existing?: string[]) => string[],
  resolver: (items: string[]) => T[],
): Promise<T[] | undefined>;

/**
 * Prompt for an array field with clear and add support (implementation)
 */
async function promptArrayField<T = string>(
  label: string,
  currentValue: (string | T)[] | undefined,
  processArrayInput: (input: string, existing?: string[]) => string[],
  resolver?: (items: string[]) => T[],
): Promise<T[] | string[] | undefined> {
  const currentDisplay = Array.isArray(currentValue)
    ? currentValue.map((v) => String(v)).join(", ")
    : "";
  const prompt = buildPrompt(label, currentDisplay);
  const input = await ask(prompt);

  if (isClearCommand(input)) {
    return [];
  } else if (input.trim()) {
    const processed = processArrayInput(input, currentValue as string[] | undefined);
    return resolver ? resolver(processed) : (processed as any);
  }
  return undefined;
}

/**
 * Display instructions at the beginning
 */
function displayInstructions(word: string): void {
  view(s.a("\n📝 Input Instructions:"));
  view("  • Press Enter to skip or keep the current/default value");
  view("  • Type '-' or 'clear' to remove the current/default value");
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
  view(`  • Current word: ${s.alert(word)}`);
  view("");
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
    phrases: include.phrases ?? false,
  };

  // Deduce word info for defaults
  const deduced = deduceDutchWordInfo(word);

  // Display instructions once at the beginning
  displayInstructions(word);

  // Prompt for word (usually only in edit mode)
  if (fields.word) {
    const input = await promptStringField("Word", existingEntry?.word || word);
    if (input !== undefined) {
      result.word = input;
    }
  }

  // Prompt for example
  if (fields.example) {
    const input = await promptStringField("Example", existingEntry?.example);
    if (input !== undefined) {
      // Empty string means cleared
      result.example = input === "" ? "" : input;
    }
  }

  // Prompt for form
  if (fields.form) {
    const defaultForm = existingEntry?.form || (deduced.form ? [deduced.form] : undefined);
    const input = await promptArrayField(
      "Word Type:",
      defaultForm,
      processArrayInput,
      resolveFormInputs,
    );

    if (input !== undefined) {
      result.form = input;
    } else if (!existingEntry && defaultForm) {
      // Use deduced form for new entries if no input
      result.form = defaultForm;
    }
  } else if (mode === "create") {
    // Auto-set deduced form if not explicitly asking
    if (deduced.form) {
      result.form = [deduced.form];
    }
  }

  // Prompt for irregular flag (ONLY for verbs)
  if (
    fields.irregular &&
    (result.form?.includes("verb") || existingEntry?.form?.includes("verb"))
  ) {
    // Use deduced irregular status if verb form was agreed upon
    const deducedIrregular =
      (result.form?.includes("verb") || existingEntry?.form?.includes("verb")) &&
      deduced.verbInfo?.irregular !== undefined
        ? deduced.verbInfo.irregular
        : undefined;

    const currentIrregular = existingEntry?.irregular ?? deducedIrregular ?? false;
    const currentValue = currentIrregular ? "y" : "n";
    const irregularInput = await ask(`Irregular? (${s.alert(currentValue)}) [y/N]: `);

    if (irregularInput.trim()) {
      result.irregular = irregularInput.toLowerCase() === "y";
    } else if (mode === "edit") {
      result.irregular = currentIrregular;
    } else if (deducedIrregular !== undefined) {
      result.irregular = deducedIrregular;
    }
  }

  // Prompt for forms (conjugations/declensions) - ONLY for verbs, nouns, and adjectives
  if (fields.forms) {
    const wordForms = result.form || existingEntry?.form || (deduced.form ? [deduced.form] : []);

    // Only show forms for verbs, nouns, and adjectives
    const hasApplicableForm = wordForms.some(
      (f) => f === "verb" || f === "noun" || f === "adjective",
    );

    if (hasApplicableForm) {
      let label: string;
      let deducedForms: string[] | undefined = undefined;

      if (wordForms.includes("verb")) {
        label = "Verb forms";
        // Use deduced verb forms if it's a regular verb and form was agreed upon
        deducedForms =
          !result.irregular && !existingEntry?.irregular && deduced.verbInfo?.forms
            ? deduced.verbInfo.forms
            : undefined;
      } else if (wordForms.includes("noun")) {
        label = "Noun forms (singular, plural)";
        // Use deduced noun forms
        deducedForms = deduced.nounInfo?.forms;
      } else if (wordForms.includes("adjective")) {
        label = "Adjective forms (base, inflected, comparative, superlative)";
        // Use deduced adjective forms
        deducedForms = deduced.adjectiveInfo?.forms;
      } else {
        label = "Forms";
      }

      const defaultForms = existingEntry?.forms || deducedForms;

      const input = await promptArrayField(label, defaultForms, processArrayInput);
      if (input !== undefined) {
        result.forms = input;
      } else if (mode === "edit" && defaultForms) {
        // In edit mode, keep the default value shown to the user
        result.forms = defaultForms;
      } else if (!existingEntry && deducedForms) {
        result.forms = deducedForms;
      }
    }
  }

  // Prompt for related words
  if (fields.related) {
    // Add base verb as first related word if it's a separable verb
    const deducedRelated =
      (result.form?.includes("verb") || existingEntry?.form?.includes("verb")) &&
      deduced.verbInfo?.isSeparable &&
      deduced.verbInfo.prefix
        ? [deduced.verbInfo.baseVerb]
        : undefined;

    const defaultRelated = existingEntry?.related || deducedRelated;

    const input = await promptArrayField("Related words", defaultRelated, processArrayInput);
    if (input !== undefined) {
      result.related = input;
    } else if (mode === "edit" && defaultRelated) {
      // In edit mode, keep the default value shown to the user
      result.related = defaultRelated;
    } else if (!existingEntry && deducedRelated) {
      result.related = deducedRelated;
    }
  }

  // Prompt for phrases
  if (fields.phrases) {
    const input = await promptArrayField("Phrases", existingEntry?.phrases, processArrayInput);
    if (input !== undefined) {
      result.phrases = input;
    }
  }

  // Prompt for types
  if (fields.types) {
    const defaultTypes = existingEntry?.types || deduced.types;
    const input = await promptArrayField(
      "Other Categories/Types",
      defaultTypes,
      processArrayInput,
      resolveTypeInputs,
    );

    if (input !== undefined) {
      result.types = input;
    } else if (mode === "edit" && defaultTypes) {
      // In edit mode, keep the default value shown to the user
      result.types = defaultTypes;
    } else if (!existingEntry && defaultTypes) {
      // Use deduced types for new entries if no input
      result.types = defaultTypes;
    }
  } else if (mode === "create") {
    // Auto-set deduced types if not explicitly asking
    if (deduced.types) {
      result.types = deduced.types;
    }
  }

  return result;
}
