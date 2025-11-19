import { view, s } from "../ui/terminal.mjs";
import { displayWord } from "../ui/wordViewer.mjs";
import { VocabRepository } from "../data/repository.mjs";
import { promptWordFields } from "../ui/wordPrompter.mjs";

// Handle normal input mode
export async function handleNormalInput(word: string, repo: VocabRepository): Promise<boolean> {
  if (!word) {
    view("Please enter a word or -d to delete the last word.");
    return false;
  }

  // Check if word already exists
  if (repo.exists(word)) {
    const entry = repo.findByWord(word);
    const index = repo.findIndexByWord(word);
    view(`Already exists. to edit > e ${word}`);
    if (entry) {
      displayWord(entry, index + 1, { showDates: false });
    }
    return false;
  }

  view(`\nAdding word: "${word}"`);

  // Use unified prompter
  const promptedData = await promptWordFields(
    word,
    {
      include: {
        example: true,
        forms: true,
        related: true,
      },
      mode: "create",
    },
    (input, existing) => repo.processArrayInput(input, existing),
  );

  const entryData = {
    word,
    ...promptedData,
  };

  const result = repo.create(entryData);

  if (result.success && result.entry) {
    console.clear();
    displayWord(result.entry, repo.count(), {
      showDates: false,
    });
  }

  return true;
}
