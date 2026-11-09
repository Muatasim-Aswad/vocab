export const addCopy = {
  normalMissing: "Please enter a term or -d to delete the last entry.",
  detailMissing: "Please enter a term or -d to delete the last entry.",
  normalAnnouncement: (term: string) => `\nAdding term: "${term}"`,
  detailAnnouncement: (term: string) => `\nAdding term: "${term}" in DETAIL mode`,
  cancelled: "Add cancelled.",
  existingCount: (term: string, count: number) =>
    count > 1
      ? `The term "${term}" already exists in ${count} entries.`
      : `The term "${term}" already exists in ${count} entry.`,
  chooseExisting: "Do you want to edit one of them or add a new meaning for the same term?",
  chooseAction: "Choose what to do",
  addMeaning: {
    label: "Add a new meaning",
    description: "Create another entry for the same lemma.",
  },
  editEntry: {
    label: "Edit an existing entry",
    description: "Open one of the current entries in edit mode.",
  },
  cancel: { label: "Cancel", description: "Stop this add operation." },
  selectEntry: "Select an entry to edit",
  entryOption: (id: number, lemma: string, senseCue?: string | null) =>
    `#${id} ${lemma}${senseCue ? ` [${senseCue}]` : ""}`,
  openEntry: "Open this entry in edit mode.",
  back: { label: "Back", description: "Return to the previous choice." },
  existingNeedsLabel: "Before adding a new meaning, this existing entry needs a meaning label.",
  labelPrompt: 'Meaning label ( one-word, "q" to cancel): ',
  labelRequired: "Meaning label is required.",
  addingMeaning: (term: string) => `Adding a new meaning for "${term}".`,
  meaningInstructions: 'Add a new meaning by providing "Meaning label (one-word)".',
  partOfSpeechHint: "Use part of speech as a meaning label if that is the discriminator.",
} as const;
