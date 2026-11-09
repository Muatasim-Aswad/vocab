export const captureCopy = {
  enterTerm: "Please enter a term to capture.",
  saved: (check: string, term: string) => `${check} Captured "${term}" for later review.`,
  review: (command: string) => `Review captured terms with ${command}.`,
  ignoredFlags: 'Flags "-ft" and "-se" do not apply to captures and were ignored.',
  empty: 'No captured terms. Switch to FAST mode ("f") to capture terms for later.',
  heading: (page: number, from: number, to: number) =>
    `\n=== Captured Terms (Page ${page}: ${from}-${to}) ===\n`,
  row: (index: number, term: string, date: string) => `${index}. ${term}  ${date}`,
  more: (page: number, limit: number) =>
    `\nMore captured terms: captures -p ${page + 1}${limit === 10 ? "" : ` -l ${limit}`}`,
  end: (from: number, to: number) => `\nShowing ${from}-${to}; no more captured terms.`,
} as const;
