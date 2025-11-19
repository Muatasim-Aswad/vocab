import { view, s } from "../ui/terminal.mjs";
import { displayWord } from "../ui/wordViewer.mjs";
import { VocabRepository } from "../data/repository.mjs";
import { promptWordFields } from "../ui/wordPrompter.mjs";

// Handle edit mode
export async function handleEditInput(
  input: string,
  repo: VocabRepository,
  mode: "fast" | "normal" | "detail" = "normal",
): Promise<boolean> {
  let word = input;

  if (!word) {
    const last = repo.findLast();
    if (!last) {
      view("No words in the database to edit.");
      return false;
    }
    word = last.word;
  }

  // Find the word in data
  const entry = repo.findByWord(word);

  if (!entry) {
    view(`Word "${word}" not found in the database.`);
    return false;
  }

  view(`\nEditing word: "${word}"\n`);

  // Fast mode: only edit the word itself
  if (mode === "fast") {
    const promptedData = await promptWordFields(
      word,
      {
        include: {
          word: true,
        },
        existingEntry: entry,
        mode: "edit",
      },
      (input, existing) => repo.processArrayInput(input, existing),
    );

    if (promptedData.word) {
      const result = repo.update(word, promptedData);

      if (result.success && result.entry) {
        const index = repo.findIndexByWord(promptedData.word);
        view("\n✓ Updated successfully!");
        displayWord(result.entry, index + 1, { showDates: false });
      }
    } else {
      view("No changes made.");
    }

    return true;
  }

  // Normal mode: edit word, related, and example
  if (mode === "normal") {
    const promptedData = await promptWordFields(
      word,
      {
        include: {
          word: true,
          example: true,
          related: true,
        },
        existingEntry: entry,
        mode: "edit",
      },
      (input, existing) => repo.processArrayInput(input, existing),
    );

    // Only update if there are changes
    if (Object.keys(promptedData).length > 0) {
      const result = repo.update(word, promptedData);

      if (result.success && result.entry) {
        const index = repo.findIndexByWord(promptedData.word || word);
        view("\n✓ Updated successfully!");
        displayWord(result.entry, index + 1, { showDates: false });
      }
    } else {
      view("No changes made.");
    }

    return true;
  }

  // Detail mode: edit all fields
  if (mode === "detail") {
    const promptedData = await promptWordFields(
      word,
      {
        include: {
          word: true,
          form: true,
          types: true,
          forms: true,
          irregular: true,
          related: true,
          example: true,
        },
        existingEntry: entry,
        mode: "edit",
      },
      (input, existing) => repo.processArrayInput(input, existing),
    );

    // Only update if there are changes
    if (Object.keys(promptedData).length > 0) {
      const result = repo.update(word, promptedData);

      if (result.success && result.entry) {
        const index = repo.findIndexByWord(promptedData.word || word);
        view("\n✓ Updated successfully!");
        displayWord(result.entry, index + 1, { showDates: false });
      }
    } else {
      view("No changes made.");
    }

    return true;
  }

  return false;
}
