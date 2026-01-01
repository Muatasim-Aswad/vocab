import { view, s } from "../ui/terminal.mjs";
import { displayWord } from "../ui/wordViewer.mjs";
import { VocabRepository } from "../data/repository.mjs";
import { promptWordFields, PromptAbortedError } from "../ui/wordPrompter.mjs";

// Handle detail input mode with all fields
export async function handleDetailInput(word: string, repo: VocabRepository): Promise<boolean> {
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

  view(`\nAdding word: "${word}" in DETAIL mode`);

  // Use unified prompter with all fields
  let promptedData;
  try {
    promptedData = await promptWordFields(
      word,
      {
        include: {
          example: true,
          form: true,
          types: true,
          forms: true,
          irregular: true,
          related: true,
          phrases: true,
        },
        mode: "create",
      },
      (input, existing) => repo.processArrayInput(input, existing),
    );
  } catch (error) {
    if (error instanceof PromptAbortedError) {
      view("Add cancelled.");
      return false;
    }
    throw error;
  }

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
