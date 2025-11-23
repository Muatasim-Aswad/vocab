import { ask, s, view } from "./terminal.mjs";
import {
  deduceWordForm,
  deduceNounTypes,
  deduceVerbTypes,
  checkVerbSeparability,
  isVerbIrregular,
  generateVerifiedNounForms,
  generateVerifiedVerbForms,
  generateVerifiedAdjectiveForms,
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
 * NEW: Step-by-step verification workflow
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

  // ============================================================
  // STEP 1: Deduce and verify word form (noun/verb/adjective)
  // ============================================================
  let verifiedForm: (keyof typeof wordTypes)[] | undefined;

  if (fields.form) {
    const deducedForm =
      existingEntry?.form || (deduceWordForm(word) ? [deduceWordForm(word)!] : undefined);
    const input = await promptArrayField(
      "Word Type",
      deducedForm,
      processArrayInput,
      resolveFormInputs,
    );

    if (input !== undefined) {
      verifiedForm = input;
      result.form = input;
    } else if (!existingEntry && deducedForm) {
      // Use deduced form for new entries if no input
      verifiedForm = deducedForm;
      result.form = deducedForm;
    } else if (existingEntry?.form) {
      verifiedForm = existingEntry.form;
      result.form = existingEntry.form;
    }
  } else if (mode === "create") {
    // Auto-set deduced form if not explicitly asking
    const deducedForm = deduceWordForm(word);
    if (deducedForm) {
      verifiedForm = [deducedForm];
      result.form = [deducedForm];
    }
  } else if (existingEntry?.form) {
    verifiedForm = existingEntry.form;
  }

  // ============================================================
  // STEP 2: Based on verified form, deduce and verify types
  // ============================================================
  let verifiedTypes: string[] | undefined;
  let isReflexive = false;
  let cleanWord = word;
  let separabilityInfo: ReturnType<typeof checkVerbSeparability> | undefined;

  if (fields.types) {
    let deducedTypes: string[] | undefined;

    // Deduce types based on verified form
    if (verifiedForm?.includes("noun")) {
      deducedTypes = existingEntry?.types || deduceNounTypes(word);
    } else if (verifiedForm?.includes("verb")) {
      const verbTypeInfo = deduceVerbTypes(word);
      isReflexive = verbTypeInfo.isReflexive;
      cleanWord = verbTypeInfo.cleanWord;

      // Check separability
      separabilityInfo = checkVerbSeparability(cleanWord);

      deducedTypes = existingEntry?.types || [
        ...verbTypeInfo.types,
        ...(separabilityInfo.isSeparable ? ["separable"] : []),
      ];
    } else {
      deducedTypes = existingEntry?.types;
    }

    const input = await promptArrayField(
      "Other Categories/Types",
      deducedTypes,
      processArrayInput,
      resolveTypeInputs,
    );

    if (input !== undefined) {
      verifiedTypes = input;
      result.types = input;
    } else if (mode === "edit" && deducedTypes) {
      verifiedTypes = deducedTypes;
      result.types = deducedTypes;
    } else if (!existingEntry && deducedTypes) {
      verifiedTypes = deducedTypes;
      result.types = deducedTypes;
    }
  } else if (mode === "create") {
    // Auto-set deduced types if not explicitly asking
    if (verifiedForm?.includes("noun")) {
      verifiedTypes = deduceNounTypes(word);
      result.types = verifiedTypes;
    } else if (verifiedForm?.includes("verb")) {
      const verbTypeInfo = deduceVerbTypes(word);
      isReflexive = verbTypeInfo.isReflexive;
      cleanWord = verbTypeInfo.cleanWord;

      separabilityInfo = checkVerbSeparability(cleanWord);

      verifiedTypes = [
        ...verbTypeInfo.types,
        ...(separabilityInfo.isSeparable ? ["separable"] : []),
      ];
      result.types = verifiedTypes;
    }
  }

  // ============================================================
  // STEP 3: If verb, verify irregularity (only if not certain)
  // ============================================================
  let verifiedIrregular: boolean | undefined;
  let baseVerb: string | undefined;

  if (verifiedForm?.includes("verb")) {
    // Get separability info if not already obtained
    if (!separabilityInfo) {
      const verbTypeInfo = deduceVerbTypes(word);
      cleanWord = verbTypeInfo.cleanWord;
      separabilityInfo = checkVerbSeparability(cleanWord);
    }

    baseVerb = separabilityInfo.baseVerb;

    if (fields.irregular) {
      // Deduce irregularity
      const deducedIrregular = isVerbIrregular(cleanWord, baseVerb);

      const currentIrregular = existingEntry?.irregular ?? deducedIrregular ?? false;
      const currentValue = currentIrregular ? "y" : "n";
      const irregularInput = await ask(`Irregular? (${s.alert(currentValue)}) [y/N]: `);

      if (irregularInput.trim()) {
        verifiedIrregular = irregularInput.toLowerCase() === "y";
        result.irregular = verifiedIrregular;
      } else if (mode === "edit") {
        verifiedIrregular = currentIrregular;
        result.irregular = currentIrregular;
      } else if (deducedIrregular !== undefined) {
        verifiedIrregular = deducedIrregular;
        result.irregular = deducedIrregular;
      }
    } else {
      // Auto-deduce irregularity
      verifiedIrregular = existingEntry?.irregular ?? isVerbIrregular(cleanWord, baseVerb);
      result.irregular = verifiedIrregular;
    }
  }

  // ============================================================
  // STEP 4: Based on verified info, generate forms with reliable input
  // ============================================================
  if (fields.forms) {
    let generatedForms: string[] | undefined;
    let formLabel = "Forms";

    if (verifiedForm?.includes("verb")) {
      formLabel = "Verb forms";

      // Generate verb forms based on verified irregularity and separability
      generatedForms = generateVerifiedVerbForms(
        cleanWord,
        verifiedIrregular || false,
        separabilityInfo,
      );
    } else if (verifiedForm?.includes("noun")) {
      formLabel = "Noun forms (singular, plural)";
      generatedForms = generateVerifiedNounForms(word);
    } else if (verifiedForm?.includes("adjective")) {
      formLabel = "Adjective forms (base, inflected, comparative, superlative)";
      generatedForms = generateVerifiedAdjectiveForms(word);
    }

    const defaultForms = existingEntry?.forms || generatedForms;

    if (verifiedForm?.some((f) => f === "verb" || f === "noun" || f === "adjective")) {
      const input = await promptArrayField(formLabel, defaultForms, processArrayInput);
      if (input !== undefined) {
        result.forms = input;
      } else if (mode === "edit" && defaultForms) {
        result.forms = defaultForms;
      } else if (!existingEntry && generatedForms) {
        result.forms = generatedForms;
      }
    }
  }

  // ============================================================
  // STEP 5: Prompt for related words
  // ============================================================
  if (fields.related) {
    // Add base verb as first related word if it's a separable verb
    const deducedRelated =
      verifiedForm?.includes("verb") && separabilityInfo?.isSeparable && baseVerb
        ? [baseVerb]
        : undefined;

    const defaultRelated = existingEntry?.related || deducedRelated;

    const input = await promptArrayField("Related words", defaultRelated, processArrayInput);
    if (input !== undefined) {
      result.related = input;
    } else if (mode === "edit" && defaultRelated) {
      result.related = defaultRelated;
    } else if (!existingEntry && deducedRelated) {
      result.related = deducedRelated;
    }
  }

  // ============================================================
  // STEP 6: Prompt for phrases
  // ============================================================
  if (fields.phrases) {
    const input = await promptArrayField("Phrases", existingEntry?.phrases, processArrayInput);
    if (input !== undefined) {
      result.phrases = input;
    }
  }

  return result;
}
