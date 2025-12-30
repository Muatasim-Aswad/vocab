import { IDataStore } from "./dataStore.mjs";
import { DEFAULT_DIFFICULTY, DEFAULT_STRENGTH } from "./memory/memory.mjs";
import { wordTypes } from "./nl/utils/deduceDutchWordInfo.mjs";

export interface Vocab {
  word: string;
  related?: string[];
  example?: string;
  phrases?: string[];

  form?: (keyof typeof wordTypes)[];
  types?: string[];
  forms?: string[];
  irregular?: boolean;

  addedAt: string;
  modifiedAt: string;

  // Memory model fields
  memoryStrength: number; // strength in days
  memoryDifficulty: number; // 1-10
  memoryStreak: number; // consecutive correct recalls
  memoryLastReviewed: string; // ISO date string
}

export type CreateVocab = Pick<
  Vocab,
  | "word"
  | "related"
  | "example"
  | "phrases"
  | "form"
  | "types"
  | "forms"
  | "irregular"
>;

export type UpdateVocab = Partial<CreateVocab> & {
  memoryStrength?: number;
  memoryDifficulty?: number;
  memoryStreak?: number;
  memoryLastReviewed?: string;
};

export interface Result {
  success: boolean;
  entry?: Vocab;
  found?: boolean;
}

/**
 * Repository class for managing vocabulary data with CRUD operations
 */
export class VocabRepository {
  private dataStore: IDataStore;
  private cache: Vocab[];
  public words: string[];

  constructor(dataStore: IDataStore) {
    this.dataStore = dataStore;
    this.cache = this.dataStore.get();
    this.words = this.cache.map((entry) => entry.word);
  }

  save(data: Vocab[]): boolean {
    const success = this.dataStore.save(data);
    if (success) {
      this.cache = data;
      this.words = this.cache.map((entry) => entry.word);
    }
    return success;
  }

  getAll(): Vocab[] {
    return [...this.cache];
  }

  findByWord(word: string): Vocab | null {
    const normalizedWord = word.toLowerCase();
    return this.cache.find((entry) => entry.word === normalizedWord) || null;
  }

  findLast(): Vocab | null {
    if (this.cache.length === 0) {
      return null;
    }
    return this.cache[this.cache.length - 1];
  }

  findIndexByWord(word: string): number {
    const normalizedWord = word.toLowerCase();
    return this.cache.findIndex((entry) => entry.word === normalizedWord);
  }

  search(
    query: string,
    options: {
      startsWith?: boolean;
    } = {},
  ): Vocab[] {
    const normalizedQuery = query.toLowerCase();
    const { startsWith = false } = options;

    const results = this.cache.filter((entry) => {
      if (startsWith) {
        return entry.word.startsWith(normalizedQuery);
      } else {
        return (
          entry.word.includes(normalizedQuery) ||
          entry.forms?.some((f) => f.includes(normalizedQuery)) ||
          entry.related?.some((r) => r.includes(normalizedQuery)) ||
          entry.example?.includes(normalizedQuery)
        );
      }
    });

    return results.sort((a, b) => a.word.localeCompare(b.word));
  }

  create(data: CreateVocab): Result {
    const { word, related, example, phrases, forms, irregular, form, types } =
      data;
    const processedWord = word.trim().toLowerCase();

    // Check if word already exists
    const exists = this.cache.find((entry) => entry.word === processedWord);
    if (exists) {
      return { success: false, found: true, entry: exists };
    }

    const now = new Date().toISOString();
    const entry: Vocab = {
      word: processedWord,
      form: form,
      types: types,
      forms,
      irregular: irregular ?? false,
      addedAt: now,
      modifiedAt: now,
      memoryLastReviewed: now,
      memoryStrength: DEFAULT_STRENGTH,
      memoryDifficulty: DEFAULT_DIFFICULTY,
      memoryStreak: 0,
      ...(related && related.length > 0 ? { related } : {}),
      ...(example ? { example: this.processExample(example) } : {}),
      ...(phrases && phrases.length > 0 ? { phrases } : {}),
    };

    this.cache.push(entry);
    const saved = this.save(this.cache);

    return { success: saved, entry };
  }

  update(word: string, updateData: UpdateVocab): Result {
    const {
      word: newWord,
      related,
      example,
      phrases,
      forms,
      irregular,
      form,
      types,
      memoryStrength,
      memoryDifficulty,
      memoryStreak,
      memoryLastReviewed,
    } = updateData;
    const index = this.findIndexByWord(word);

    if (index === -1) {
      return { success: false, found: false };
    }

    const entry = this.cache[index];

    // Update fields
    if (newWord !== undefined) {
      const processedWord = newWord.trim().toLowerCase();
      entry.word = processedWord;
    }

    // Handle form: delete if empty array, set if has items, keep if undefined
    if (form !== undefined) {
      if (form && form.length > 0) {
        entry.form = form;
      } else {
        delete entry.form;
      }
    }

    // Handle types: delete if empty array, set if has items, keep if undefined
    if (types !== undefined) {
      if (types.length > 0) {
        entry.types = types;
      } else {
        delete entry.types;
      }
    }

    // Handle related: delete if empty array, set if has items, keep if undefined
    if (related !== undefined) {
      if (related.length > 0) {
        entry.related = related;
      } else {
        delete entry.related;
      }
    }

    // Handle example: delete if empty string, process if has content, keep if undefined
    if (example !== undefined) {
      if (example.trim()) {
        entry.example = this.processExample(example);
      } else {
        delete entry.example;
      }
    }

    // Handle forms: delete if empty array, set if has items, keep if undefined
    if (forms !== undefined) {
      if (forms.length > 0) {
        entry.forms = forms;
      } else {
        delete entry.forms;
      }
    }

    // Handle irregular: set if defined, keep if undefined
    if (irregular !== undefined) entry.irregular = irregular;

    // Handle phrases: delete if empty array, set if has items, keep if undefined
    if (phrases !== undefined) {
      if (phrases.length > 0) {
        entry.phrases = phrases;
      } else {
        delete entry.phrases;
      }
    }

    // Handle memory model fields
    if (memoryStrength !== undefined) entry.memoryStrength = memoryStrength;
    if (memoryDifficulty !== undefined)
      entry.memoryDifficulty = memoryDifficulty;
    if (memoryStreak !== undefined) entry.memoryStreak = memoryStreak;
    if (memoryLastReviewed !== undefined)
      entry.memoryLastReviewed = memoryLastReviewed;

    entry.modifiedAt = new Date().toISOString();

    const saved = this.save(this.cache);

    return { success: saved, entry, found: true };
  }

  delete(word: string): Result {
    const normalizedWord = word.toLowerCase();
    const index = this.cache.findIndex(
      (entry) => entry.word === normalizedWord,
    );

    if (index === -1) {
      return { success: false, found: false };
    }

    const deletedEntry = this.cache[index];
    this.cache.splice(index, 1);
    const saved = this.save(this.cache);

    return { success: saved, entry: deletedEntry, found: true };
  }

  count(): number {
    return this.cache.length;
  }

  findByIndex(index: number): Vocab | null {
    // Handle negative indices (from the end)
    if (index < 0) {
      const actualIndex = this.cache.length + index;
      if (actualIndex < 0 || actualIndex >= this.cache.length) {
        return null;
      }
      return this.cache[actualIndex];
    }

    // Handle positive indices (1-based)
    const actualIndex = index - 1;
    if (actualIndex < 0 || actualIndex >= this.cache.length) {
      return null;
    }
    return this.cache[actualIndex];
  }

  exists(word: string): boolean {
    return this.findByWord(word) !== null;
  }

  getSorted(field: keyof Vocab, order: "asc" | "desc" = "asc"): Vocab[] {
    const sorted = [...this.cache].sort((a, b) => {
      const aVal = a[field];
      const bVal = b[field];

      // Handle undefined values
      if (aVal === undefined && bVal === undefined) return 0;
      if (aVal === undefined) return 1;
      if (bVal === undefined) return -1;

      // Compare based on type
      if (typeof aVal === "string" && typeof bVal === "string") {
        return order === "asc"
          ? aVal.localeCompare(bVal)
          : bVal.localeCompare(aVal);
      }

      return 0;
    });

    return sorted;
  }

  private processExample(example: string): string {
    const trimmed = example.trim();
    if (!trimmed) return trimmed;

    // Capitalize first letter
    let formatted = trimmed.charAt(0).toUpperCase() + trimmed.slice(1);

    // Add period if no ending punctuation
    const lastChar = formatted.charAt(formatted.length - 1);
    if (lastChar !== "." && lastChar !== "?" && lastChar !== "!") {
      formatted += ".";
    }

    return formatted;
  }

  /**
   * Process array input with support for "add " prefix
   * @param input - The input string (may have "add " prefix)
   * @param existingArray - The existing array to add to (if using "add " prefix)
   * @returns Processed array of trimmed, lowercased strings
   */
  processArrayInput(input: string, existingArray?: string[]): string[] {
    const trimmed = input.trim();
    if (!trimmed) return existingArray || [];

    const isAddMode = trimmed.toLowerCase().startsWith("add ");
    const content = isAddMode ? trimmed.slice(4).trim() : trimmed;

    const newItems = content
      .split(",")
      .map((item) => item.trim().toLowerCase())
      .filter((item) => item.length > 0);

    if (isAddMode && existingArray) {
      // Add to existing array, avoiding duplicates
      const combined = [...existingArray];
      for (const item of newItems) {
        if (!combined.includes(item)) {
          combined.push(item);
        }
      }
      return combined;
    }

    return newItems;
  }

  /**
   * Get paginated vocabulary entries
   * @param options - Pagination options
   * @returns Object containing entries, pagination info
   */
  paginate(options?: { cursor?: number; limit?: number }): {
    entries: Vocab[];
    cursor: number;
    limit: number;
    total: number;
    startIndex: number;
    endIndex: number;
  } {
    const total = this.cache.length;
    console.log(
      `Requested pagination with options: ${JSON.stringify(options)}`,
    );

    // If no options provided, return all
    if (!options || (!options.cursor && !options.limit)) {
      return {
        entries: [...this.cache],
        cursor: 1,
        limit: total,
        total,
        startIndex: 0,
        endIndex: total,
      };
    }

    const limit = options.limit ?? total;

    // If no cursor specified, calculate from the end
    const cursor = options.cursor ?? (total > limit ? total - limit + 1 : 1);

    const startIndex = cursor - 1;
    const endIndex = Math.min(startIndex + limit, total);

    // Validate cursor
    if (startIndex >= total || startIndex < 0) {
      return {
        entries: [],
        cursor,
        limit,
        total,
        startIndex,
        endIndex: startIndex,
      };
    }

    const entries = this.cache.slice(startIndex, endIndex);

    return {
      entries,
      cursor,
      limit,
      total,
      startIndex,
      endIndex,
    };
  }
}
