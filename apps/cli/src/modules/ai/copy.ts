export const aiCopy = {
  existingHeading: "Existing entries:",
  enterTerm: "Please enter a term.",
  cancelled: "Add cancelled.",
  existingCount: (term: string, count: number) =>
    count > 1
      ? `The term "${term}" already exists in ${count} entries.`
      : `The term "${term}" already exists in ${count} entry.`,
  chooseBeforeCall: "Choose what to do before calling AI",
  useExisting: {
    label: "Use existing",
    description: "Skip the AI call and keep the current entries.",
  },
  editExisting: {
    label: "Edit existing entry",
    description: "Open one of the current entries in the full edit flow.",
  },
  addWithAi: {
    label: "Add new sense with AI",
    description: "Call AI and treat the result as a new incoming draft.",
  },
  cancel: { label: "Cancel", description: "Stop this add operation." },
  usingExisting: "Using existing entries. AI was not called.",
  selectExisting: "Select an existing entry",
  entryOption: (id: number, lemma: string, senseCue?: string | null) =>
    `#${id} ${lemma}${senseCue ? ` [${senseCue}]` : ""}`,
  openEntry: "Open this entry in the full edit flow.",
  generating: "AI: generating suggestions...",
  working: (seconds: number) => `AI: still working (${seconds}s)...`,
  failed: (message: string) => `AI request failed: ${message}`,
  warning: (message: string) => `Warning: ${message}`,
  missingTerm: 'AI response must include a non-empty "term" field.',
  parseFailed: "Failed to parse AI JSON response.",
} as const;

export const jsonAddCopy = {
  paste: 'Paste a JSON object or array of objects with at least a "term" field.',
  parseFailed: "Failed to parse JSON defaults.",
  warning: (message: string) => `Warning: ${message}`,
  missingTerm: 'JSON must include a non-empty "term" field.',
} as const;
