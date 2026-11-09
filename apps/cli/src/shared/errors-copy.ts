export const errorCopy = {
  listPage: (page: number, pages: number, total: number, limit: number) =>
    `Page ${page} is out of range. Valid pages: 1-${pages} (total terms: ${total}, page size: ${limit}). Use "-p <page>".`,
  searchPage: (page: number, pages: number, total: number, limit: number) =>
    `Page ${page} is out of range for search results. Valid pages: 1-${pages} (total matches: ${total}, page size: ${limit}). Use "-p <page>".`,
  missingWord: "Please enter a term.",
  duplicate: (term: string) => `Already exists. to edit > e ${term}`,
  duplicateGeneric: "Term already exists.",
  missingId: (id: number) => `No term found with id ${id}.`,
  missingIdGeneric: "No term found with the provided id.",
  ambiguous: (term: string) => `Multiple entries match "${term}". Use an id to target one entry.`,
  ambiguousGeneric: "Multiple entries match this term. Use an id to target one entry.",
  missingCue: (term: string) =>
    `Term "${term}" already exists. Add a 1-2 word meaning label to create another meaning.`,
  missingCueGeneric: "This term already exists. Add a 1-2 word meaning label.",
  invalidCue: "Meaning label must be one or two words.",
  duplicateCue: (cue: string, term: string) =>
    `Meaning label "${cue}" already exists for "${term}".`,
  duplicateCueGeneric: "Meaning label already exists for this term.",
  invalidRelation:
    "Invalid related term token. Use +term, -term, ~term, ^term, term, or id:<number> (optionally prefixed, e.g. ^id:12).",
  missingRelation: "No relation target found with the provided id.",
  ambiguousRelation: "Related term is ambiguous. Use an explicit id token (e.g. +id:12).",
  missingTerm: (term: string) => `Term "${term}" not found in the database.`,
  missingTermGeneric: "Term not found in the database.",
  emptyDelete: "No terms in the database to delete.",
  emptyEdit: "No terms in the database to edit.",
  emptyStudy: "No terms available to study. Add some terms first!",
  empty: "No terms in the database.",
  noFilter: (filter: string) => `No terms found with type filter "${filter}".`,
  noFilterGeneric: "No terms matched the selected filter.",
  noChanges: "No changes made.",
  pageRange: 'Page is out of range. Use "-p <page>".',
  emptySearch: "Please enter a search term.",
  invalidRange: "Invalid id range.",
  saveFailed: "Failed to save changes. Please try again.",
  revision: (id?: number) =>
    `${id !== undefined ? `Entry ${id}` : "This entry"} changed since it was loaded. Run the command again to use the current version.`,
  validation: (message: string, issues: string) => `${message}: ${issues}`,
} as const;
