import { view, s } from "../ui/terminal.mjs";
import { displayWords } from "../ui/wordViewer.mjs";
import { VocabRepository } from "../data/repository.mjs";

// Handle list mode - lists words with pagination
export function handleList(args: string, repo: VocabRepository): void {
  // Parse arguments
  let cursor: number | undefined = undefined;
  let limit: number = 50;

  const argParts = args.trim().split(/\s+/);

  for (let i = 0; i < argParts.length; i++) {
    if (argParts[i] === "-c" && i + 1 < argParts.length) {
      const parsedCursor = parseInt(argParts[i + 1]);
      if (!isNaN(parsedCursor) && parsedCursor > 0) {
        cursor = parsedCursor;
      }
      i++; // Skip the next argument as it's the value
    } else if (argParts[i] === "-l" && i + 1 < argParts.length) {
      const parsedLimit = parseInt(argParts[i + 1]);
      if (!isNaN(parsedLimit) && parsedLimit > 0) {
        limit = parsedLimit;
      }
      i++; // Skip the next argument as it's the value
    }
  }

  // Get paginated results from repository
  const result = repo.paginate({ cursor, limit });

  if (result.total === 0) {
    view("No words in the database.");
    return;
  }

  // Check if cursor is out of range
  if (result.entries.length === 0 && cursor !== undefined) {
    view(`Cursor ${cursor} is out of range. Total words: ${result.total}`);
    return;
  }

  view(s.aH(`\n=== Word List (${result.cursor}-${result.endIndex} of ${result.total}) ===`));
  view("");

  // Display words
  displayWords(result.entries, {
    startIndex: result.startIndex,
    spacing: true,
    showDates: false,
  });

  view("");
  view(`Showing ${result.cursor}-${result.endIndex} of ${result.total} words`);
}
