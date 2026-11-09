interface SenseHint {
  senseCue?: string;
  example?: string;
}

/** Versioned description of the conditional input layout used by promptInput. */
export const promptInputTemplate =
  "Input term: {term}; optional excluded senses as bullet lines; optional requested sense as one bullet line; sections separated by two newlines; each sense uses senseCue then example separated by a semicolon";

const describeSense = ({ senseCue, example }: SenseHint) =>
  [senseCue && `senseCue: ${senseCue}`, example && `example: ${example}`]
    .filter(Boolean)
    .join("; ");

export function promptInput(input: {
  term: string;
  excludeSenses?: SenseHint[];
  requestedSense?: SenseHint;
}): string {
  const sections = [`Input term: ${input.term}`];
  if (input.excludeSenses?.length)
    sections.push(
      [
        "Senses to exclude (do not return these senses):",
        ...input.excludeSenses.map((sense) => `- ${describeSense(sense)}`),
      ].join("\n"),
    );
  if (input.requestedSense)
    sections.push(
      `Requested sense (return only this sense):\n- ${describeSense(input.requestedSense)}`,
    );
  return sections.join("\n\n");
}
