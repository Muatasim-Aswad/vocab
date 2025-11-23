import { view, s } from "../ui/terminal.mjs";
import { displayWords } from "../ui/wordViewer.mjs";
import { VocabRepository } from "../data/repository.mjs";

// Handle search mode
export function handleSearch(input: string, repo: VocabRepository): void {
  const trimmedInput = input.trim();

  if (!trimmedInput) {
    view("Please enter a search term.");
    return;
  }

  // Parse arguments
  let startsWithMode = false;
  let exactMode = false;
  let query = trimmedInput.toLowerCase();

  const argParts = trimmedInput.split(/\s+/);

  // Check for -s flag
  const flagIndex = argParts.indexOf("-s");
  if (flagIndex !== -1) {
    startsWithMode = true;
    // Remove the -s flag from the query
    argParts.splice(flagIndex, 1);
    query = argParts.join(" ").toLowerCase();
  }

  // Check for -e flag (exact - preserves space after word)
  const exactFlagIndex = argParts.indexOf("-e");
  if (exactFlagIndex !== -1) {
    exactMode = true;
    // Remove the -e flag from the query
    argParts.splice(exactFlagIndex, 1);
    query = argParts.join(" ").toLowerCase();
    // Add trailing space for exact matching
    query += " ";
  }

  if (!query) {
    view("Please enter a search term.");
    return;
  }

  const results = repo.search(query, { startsWith: startsWithMode });

  if (results.length === 0) {
    const searchType = startsWithMode
      ? "starting with"
      : exactMode
      ? "exactly matching"
      : "containing";
    const displayQuery = exactMode ? query.trimEnd() : query;
    view(`No words found ${searchType} "${displayQuery}".`);
    return;
  }

  const searchType = startsWithMode
    ? "starting with"
    : exactMode
    ? "exactly matching"
    : "containing";
  const displayQuery = exactMode ? query.trimEnd() : query;
  view(s.aH(`\n=== Words ${searchType} "${displayQuery}" (${results.length} found) ===`));

  displayWords(results);

  view("");
}
