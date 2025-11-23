import { s, view } from "../ui/terminal.mjs";
import { VocabRepository, Vocab } from "../data/repository.mjs";
import { displayWords } from "../ui/wordViewer.mjs";

export interface SearchOptions {
  startsWith?: boolean;
  exact?: boolean;
}

/**
 * Parse search query and extract flags
 */
function parseSearchQuery(input: string): { query: string; options: SearchOptions } {
  const trimmedInput = input.trim();
  const argParts = trimmedInput.split(/\s+/);

  let startsWithMode = false;
  let exactMode = false;

  // Check for -s flag
  const flagIndex = argParts.indexOf("-s");
  if (flagIndex !== -1) {
    startsWithMode = true;
    argParts.splice(flagIndex, 1);
  }

  // Check for -e flag
  const exactFlagIndex = argParts.indexOf("-e");
  if (exactFlagIndex !== -1) {
    exactMode = true;
    argParts.splice(exactFlagIndex, 1);
  }

  let query = argParts.join(" ").toLowerCase();

  // Add trailing space for exact matching
  if (exactMode) {
    query += " ";
  }

  return {
    query,
    options: {
      startsWith: startsWithMode,
      exact: exactMode,
    },
  };
}

/**
 * Handle search mode input
 */
export function handleSearchInput(input: string, repo: VocabRepository): void {
  if (!input) {
    view("Please enter a search term.");
    view("Use -s for starts with, -e for exact match.");
    view(`Examples: ${s.w("water")}, ${s.w("water -s")}, ${s.w("water -e")}`);
    return;
  }

  // Parse query and perform search
  const { query, options } = parseSearchQuery(input);

  if (!query.trim()) {
    view("Please enter a search term.");
    return;
  }

  const results = repo.search(query, options);

  const searchType = options.startsWith
    ? "starting with"
    : options.exact
    ? "exactly matching"
    : "containing";
  const displayQuery = options.exact ? query.trimEnd() : query;

  if (results.length === 0) {
    view(s.e(`No words found ${searchType} "${displayQuery}".`));
    return;
  }

  view(s.aH(`\n=== Words ${searchType} "${displayQuery}" (${results.length} found) ===`));
  displayWords(results);
}
