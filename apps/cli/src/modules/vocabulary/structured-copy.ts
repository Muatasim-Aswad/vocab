export const structuredCopy = {
  verbForms: "Verb forms",
  nounForms: "Noun forms",
  adjectiveForms: "Adjective forms",
  forms: "Forms",
  none: "(none)",
  prompt: (label: string, current?: string) => (current ? `${label} (${current}): ` : `${label}: `),
  labelRequired: "Meaning label is required.",
  labelLength: "Meaning label must be one or two words.",
  suggestedLabel: "Use this suggested meaning label from another incoming draft.",
  customLabel: {
    label: "Write custom label",
    description: "Type a different one- or two-word meaning label.",
  },
  cancel: { label: "Cancel", description: "Stop this add operation." },
  formsMismatch: (term: string) => `Forms mismatch for "${term}".`,
  provided: (forms: string) => `Provided: ${forms}`,
  inferred: (forms: string) => `Inferred: ${forms}`,
  configuredForms: (mode: string) => `Using configured forms conflict resolution: ${mode}.`,
  chooseForms: "Choose which forms to keep",
  keepProvided: {
    label: "Keep provided forms",
    description: "Keep the input forms exactly as provided.",
  },
  useInferred: {
    label: "Use inferred forms",
    description: "Use the locally inferred canonical form order.",
  },
  manualForms: {
    label: "Edit manually",
    description: "Enter a custom comma-separated forms list.",
  },
  formsPrompt: (label: string, forms: string) => `${label} (${forms}): `,
  ambiguousRelation: (term: string) =>
    `Related term "${term}" matches multiple entries. Choose the intended target.`,
  selectRelation: "Select relation target",
  relationEntry: (id: number, term: string, cue?: string | null) =>
    `#${id} ${term}${cue ? ` [${cue}]` : ""}`,
  relationDescription: "Use this entry as the relation target.",
  noEntry: (id: number) => `No term found with id ${id}.`,
  unsensedConflict: (term: string) => `"${term}" already exists without a meaning label`,
  updateIncoming: {
    label: "Update existing with incoming data",
    description: "Keep one entry and apply the incoming fields to it.",
  },
  splitSenses: {
    label: "Split into two senses",
    description: "Keep both entries and add meaning labels for each one.",
  },
  editExisting: {
    label: "Edit existing entry",
    description: "Open the existing entry in the full edit flow.",
  },
  skipIncoming: {
    label: "Skip incoming draft",
    description: "Leave the existing entry as-is and ignore this draft.",
  },
  cancelled: "Add cancelled.",
  existingFor: (term: string) => `Existing entries for "${term}":`,
  resolveLabels: (term: string) => `Resolve meaning labels for "${term}".`,
  existingLabel: (id: number) => `Meaning label for existing #${id}`,
  draftLabel: (index: number) => `Meaning label for draft ${index}`,
  duplicateExisting: (id: number) =>
    `Meaning label for existing #${id} duplicates another existing sense.`,
  matchingDraft: (index: number, term: string, cue?: string) =>
    `Draft ${index}: ${term}${cue ? ` [${cue}]` : ""} matches an existing sense`,
  updateExisting: (id: number) => `Update existing #${id}`,
  updateDescription: "Apply the incoming fields to the matching entry.",
  separate: {
    label: "Keep as separate new sense",
    description: "Assign a different meaning label and create a new entry.",
  },
  editMatch: {
    label: "Edit existing entry",
    description: "Open the matching entry in the full edit flow.",
  },
  skipMatch: {
    label: "Skip incoming draft",
    description: "Ignore this draft and keep the current entry unchanged.",
  },
  newDraftLabel: (index: number) => `New meaning label for draft ${index}`,
  duplicateIncoming: (index: number) =>
    `Draft ${index} already matches another incoming meaning label.`,
  sharedLabel: (index: number, previous: number) =>
    `Draft ${index} and draft ${previous} cannot share the same meaning label.`,
} as const;
