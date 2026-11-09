export const targetCopy = {
  noTerms: (operation: "delete" | "edit") => `No terms in the database to ${operation}.`,
  noId: (id: number) => `No term found with id ${id}.`,
  noTerm: (term: string) => `Term "${term}" not found in the database.`,
  ambiguous: (term: string) => `Multiple entries match "${term}". Use an id to target one entry.`,
} as const;
