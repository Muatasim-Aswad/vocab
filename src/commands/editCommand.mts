import { view, s } from "../ui/terminal.mjs";
import { displayWord } from "../ui/wordViewer.mjs";
import { VocabRepository } from "../data/repository.mjs";
import { promptWordFields } from "../ui/wordPrompter.mjs";

// Handle edit mode
export async function handleEditInput(
  input: string,
  repo: VocabRepository,
  mode: "fast" | "normal" | "detail" | "search" = "normal",
): Promise<boolean> {
  let word = input;
  let entry = null;

  if (!word) {
    const last = repo.findLast();
    if (!last) {
      view("No words in the database to edit.");
      return false;
    }
    word = last.word;
    entry = last;
  } else {
    // Check if input is a number (index)
    const indexMatch = input.match(/^(-?\d+)$/);
    if (indexMatch) {
      const index = parseInt(indexMatch[1], 10);
      entry = repo.findByIndex(index);

      if (!entry) {
        view(`No word found at index ${index}.`);
        return false;
      }

      word = entry.word;
      view(`Found word at index ${index}: "${word}"`);
    } else {
      // Find the word in data by word string
      entry = repo.findByWord(word);
    }
  }

  // Check if entry was found
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
          phrases: true,
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

  // Normal mode: edit word, related, and example
  else if (mode === "normal") {
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
  else {
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
          phrases: true,
        },
        existingEntry: entry,
        mode: "edit",
      },
      (input, existing) => repo.processArrayInput(input, existing),
    );

    console.clear();
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
}
