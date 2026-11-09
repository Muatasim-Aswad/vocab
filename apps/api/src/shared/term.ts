/** Trimmed, single-spaced display form and its case-insensitive identity. */
export function normalizeTerm(input: string): { term: string; key: string } {
  const term = input.trim().replace(/\s+/g, " ");
  return { term, key: term.toLowerCase() };
}
