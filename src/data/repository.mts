import { IDataStore } from "./dataStore.mjs";
import { deduceDutchWordInfo, wordTypes } from "./nl.mjs";

export interface Vocab {
  word: string;
  related?: string[];
  example?: string;

  form?: keyof typeof wordTypes;
  types?: string[];
  forms?: string[];
  irregular?: boolean;

  addedAt: string;
  modifiedAt: string;
}

export type CreateVocab = Pick<
  Vocab,
  "word" | "related" | "example" | "form" | "types" | "forms" | "irregular"
>;

export type UpdateVocab = Partial<CreateVocab>;

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

  constructor(dataStore: IDataStore) {
    this.dataStore = dataStore;
    this.cache = this.dataStore.get();
  }

  save(data: Vocab[]): boolean {
    const success = this.dataStore.save(data);
    if (success) {
      this.cache = data;
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
    const { word, related, example, forms, irregular, form, types } = data;
    const processed = this.processWord(word);

    // Check if word already exists
    const exists = this.cache.find((entry) => entry.word === processed.word);
    if (exists) {
      return { success: false, found: true, entry: exists };
    }

    const entry: Vocab = {
      word: processed.word,
      form: form || processed.form,
      types: types || processed.types,
      forms,
      irregular: irregular ?? false,
      addedAt: new Date().toISOString(),
      modifiedAt: new Date().toISOString(),
      ...(related && related.length > 0 ? { related } : {}),
      ...(example ? { example: this.processExample(example) } : {}),
    };

    this.cache.push(entry);
    const saved = this.save(this.cache);

    return { success: saved, entry };
  }

  update(word: string, updateData: UpdateVocab): Result {
    const { word: newWord, related, example, forms, irregular, form, types } = updateData;
    const index = this.findIndexByWord(word);

    if (index === -1) {
      return { success: false, found: false };
    }

    const entry = this.cache[index];

    // Update fields
    if (newWord !== undefined) {
      const processed = this.processWord(newWord);
      entry.word = processed.word;
      entry.form = form || processed.form;
      entry.types = types || processed.types;
    }

    if (related && related.length > 0) entry.related = related;
    if (example) entry.example = this.processExample(example);
    if (forms !== undefined) entry.forms = forms;
    if (irregular !== undefined) entry.irregular = irregular;

    entry.modifiedAt = new Date().toISOString();

    const saved = this.save(this.cache);

    return { success: saved, entry, found: true };
  }

  delete(word: string): Result {
    const normalizedWord = word.toLowerCase();
    const index = this.cache.findIndex((entry) => entry.word === normalizedWord);

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
        return order === "asc" ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      }

      return 0;
    });

    return sorted;
  }

  private processWord(input: string) {
    const word = input.trim().toLowerCase();

    const deduced = deduceDutchWordInfo(word);

    return {
      word,
      form: deduced.form,
      types: deduced.types,
    };
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
    console.log(`Requested pagination with options: ${JSON.stringify(options)}`);

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
