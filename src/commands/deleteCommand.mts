import { ask, view, s } from "../ui/terminal.mjs";
import { VocabRepository } from "../data/repository.mjs";
import { displayWord } from "../ui/wordViewer.mjs";

// Handle delete mode - deletes a specific word or the last word saved
export async function handleDelete(input: string, repo: VocabRepository): Promise<void> {
  let word = input ? input.trim().toLowerCase() : null;
  let result;

  if (word) {
    // Delete specific word
    result = repo.delete(word);

    if (!result.found) {
      view(`Word "${word}" not found in the database.`);

      return;
    }
  } else {
    const last = repo.findLast();
    if (!last) {
      view("No words in the database to delete.");
      return;
    }

    word = last.word;
  }

  const confirmation = await ask(
    s.alert(`Are you sure you want to delete the word "${word}"? (n): `),
  );
  if (confirmation.toLowerCase() === "n") {
    view("Delete operation cancelled.");
    return;
  }

  // Delete last word
  result = repo.delete(word);

  if (result.success && result.entry) {
    view(`✗ Deleted successfully`);
    displayWord(result.entry, null, { showPosition: false, showDates: false });
  }
}
