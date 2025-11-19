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

  if (!query) {
    view("Please enter a search term.");
    return;
  }

  const results = repo.search(query, { startsWith: startsWithMode });

  if (results.length === 0) {
    const searchType = startsWithMode ? "starting with" : "containing";
    view(`No words found ${searchType} "${query}".`);
    return;
  }

  const searchType = startsWithMode ? "starting with" : "containing";
  view(s.aH(`\n=== Words ${searchType} "${query}" (${results.length} found) ===`));

  displayWords(results);

  view("");
}
