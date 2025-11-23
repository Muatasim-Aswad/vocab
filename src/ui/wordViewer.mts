import { view, s } from "./terminal.mjs";
import { Vocab } from "../data/repository.mjs";
import { wordTypes } from "../data/nl/utils/deduceDutchWordInfo.mjs";
import { setEngine } from "crypto";

export interface DisplayWordOptions {
  showPosition?: boolean;
  showRelated?: boolean;
  showExample?: boolean;
  showPhrases?: boolean;
  showDates?: boolean;
}

export interface DisplayWordsOptions extends DisplayWordOptions {
  startIndex?: number;
  spacing?: boolean;
}

export function displayWord(
  entry: Vocab,
  index: number | null = null,
  options: DisplayWordOptions = {},
): void {
  const {
    showPosition = true,
    showRelated = true,
    showExample = true,
    showPhrases = true,
    showDates = false,
  } = options;

  const position = showPosition && index !== null ? `${index}. ` : "";
  const indent = " ".repeat(position.length);

  const codes = entry.form ? entry.form.map((f) => wordTypes[f].code).join(", ") : ""; // word form codes
  const types =
    entry.types && entry.types.length > 0
      ? `[${entry.types.reduce((acc, t) => (acc += " ," + t), "")}]`
      : "";

  // Display the main word
  view(`${position}${s.w(entry.word)} ${codes} ${types} ${entry.irregular ? "irregular" : ""}`);

  // Display forms if available
  if (entry.forms && entry.forms.length > 0) {
    const formsText = entry.forms.join(", ");
    view(`${indent}${formsText} (forms)`);
  }

  // Display related word if available
  if (showRelated && entry.related && entry.related.length > 0) {
    const relatedText = entry.related.join(", ");
    view(`${indent}${s.r(relatedText)} (r)`);
  }

  // Display example if available
  if (showExample && entry.example) view(`${indent}${s.e(entry.example)} (e)`);

  // Display phrases if available
  if (showPhrases && entry.phrases && entry.phrases.length > 0) {
    entry.phrases.forEach((phrase) => {
      view(`${indent}${s.e(phrase)} (p)`);
    });
  }

  // Display dates if requested
  if (showDates) {
    if (entry.addedAt) view(`${indent}${new Date(entry.addedAt).toLocaleString()}`);
    if (entry.modifiedAt) view(`${indent}${new Date(entry.modifiedAt).toLocaleString()}`);
  }
}

export function displayWords(entries: Vocab[], options: DisplayWordsOptions = {}): void {
  const { startIndex = 0, spacing = true } = options;

  entries.forEach((entry, i) => {
    const position = startIndex + i + 1;
    displayWord(entry, position, options);

    // Add spacing between entries if requested
    if (spacing && i < entries.length - 1) {
      view("");
    }
  });
}
