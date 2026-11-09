export const listCopy = {
  heading: (page: number, pages: number, from: number, to: number, total: number) =>
    `\n=== Term List (Page ${page} of ${pages}: ${from}-${to} of ${total}) ===\n`,
  columns: ["Page", "Limit", "Type Filter", "Show Extra"],
  yes: "yes",
  no: "no",
  showing: (from: number, to: number, total: number, page: number, pages: number) =>
    `\nShowing ${from}-${to} of ${total} terms (page ${page} of ${pages})`,
} as const;
export const searchCopy = {
  enterTerm: "Please enter a search term.",
  noMatches: (query: string) => `No terms found matching "${query}".`,
  heading: (query: string, page: number, pages: number, total: number) =>
    `\n=== Terms matching "${query}" (Page ${page} of ${pages}: ${total} entries) ===\n`,
  columns: ["Query", "Page", "From", "To", "Total", "Fields"],
  allFields: "all",
  termField: "term",
  showing: (from: number, to: number, total: number, page: number, pages: number) =>
    `\nShowing ${from}-${to} of ${total} terms (page ${page} of ${pages}).\n`,
} as const;
export const showCopy = {
  missingId: "Please provide an entry id. Usage: show <id>.",
  numericId: "Please provide a numeric entry id. Usage: show <id>.",
  noEntry: (id: number) => `No term found with id ${id}.`,
} as const;
export const deleteCopy = {
  confirm: (id: number, term: string) =>
    `Are you sure you want to delete term ${id}. "${term}"? (y): `,
  cancelled: "Delete operation cancelled.",
  success: "✗ Deleted successfully",
} as const;
export const editCopy = {
  jsonPrompt: "JSON defaults (optional): ",
  jsonParseFailed: "Failed to parse JSON defaults.",
  singleObject: "JSON defaults must be a single object, not an array.",
  warning: (message: string) => `Warning: ${message}`,
  foundId: (id: number, term: string) => `Found term with id ${id}: "${term}"`,
  editing: (id: number, term: string) => `\nEditing term: ${id}. "${term}"\n`,
  cancelled: "Edit cancelled.",
  success: "\n✓ Updated successfully!",
} as const;
