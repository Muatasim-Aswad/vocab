import {
  checkVerbSeparability,
  deduceVerbTags,
  generateVerifiedAdjectiveForms,
  generateVerifiedNounForms,
  generateVerifiedVerbForms,
  isVerbIrregular,
} from "./nl/utils/deduceDutchWordInfo.js";
import { filterLemmaFromForms, parseTermInput } from "./word-normalization.js";

export function resolveForms(input: {
  term: string;
  partOfSpeech?: string;
  providedForms?: string[];
  irregular?: boolean;
  separable?: boolean;
}) {
  const normalized = (forms: string[] | undefined) => {
    const filtered = filterLemmaFromForms(forms, input.term);
    if (!filtered?.length) return undefined;
    const values = [
      ...new Set(filtered.map((value) => value.trim().toLowerCase()).filter(Boolean)),
    ];
    return values.length ? values : undefined;
  };
  const providedForms = normalized(input.providedForms);
  const parsed = parseTermInput(input.term);
  let inferredForms: string[] | undefined;
  if (!parsed.isMultiWord && input.partOfSpeech === "VERB") {
    const verb = deduceVerbTags(input.term);
    const separability = checkVerbSeparability(verb.cleanWord);
    if (input.separable !== undefined) separability.isSeparable = input.separable;
    const irregular = input.irregular ?? isVerbIrregular(verb.cleanWord, separability.baseVerb);
    inferredForms = normalized(generateVerifiedVerbForms(verb.cleanWord, irregular, separability));
  } else if (!parsed.isMultiWord && input.partOfSpeech === "NOUN") {
    inferredForms = normalized(generateVerifiedNounForms(input.term));
  } else if (!parsed.isMultiWord && input.partOfSpeech === "ADJ") {
    inferredForms = normalized(generateVerifiedAdjectiveForms(input.term));
  }
  const same = JSON.stringify(providedForms ?? []) === JSON.stringify(inferredForms ?? []);
  const sameSet =
    JSON.stringify([...(providedForms ?? [])].toSorted()) ===
    JSON.stringify([...(inferredForms ?? [])].toSorted());
  return {
    providedForms,
    inferredForms,
    conflict: !!providedForms && !!inferredForms && !same && !sameSet,
  };
}
