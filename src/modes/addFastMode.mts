import { view, s } from "../ui/terminal.mjs";
import { displayWord } from "../ui/wordViewer.mjs";
import { VocabRepository } from "../data/repository.mjs";

// Handle fast input mode
export function handleFastInput(word: string, repo: VocabRepository): void {
  if (!word) {
    view("Please enter a word or -d to delete the last word.");
    return;
  }

  // Check if word already exists
  const result = repo.create({ word });

  if (!result.success && result.found) {
    view(`Already exists. to edit > e ${word}`);
    const index = repo.findIndexByWord(word);
    if (result.entry) {
      displayWord(result.entry, index + 1, { showDates: false });
    }
    return;
  }

  if (result.success && result.entry) {
    console.clear();
    displayWord(result.entry, repo.count(), {
      showDates: false,
    });
  }
}
