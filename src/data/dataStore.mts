import fs from "fs";
import { Vocab } from "./repository.mjs";

/**
 * Interface for data storage operations
 */
export interface IDataStore {
  /**
   * Get all vocabulary entries from storage
   * @returns Array of vocabulary entries
   */
  get(): Vocab[];

  /**
   * Save vocabulary entries to storage
   * @param data - Array of vocabulary entries to save
   * @returns True if save was successful, false otherwise
   */
  save(data: Vocab[]): boolean;
}

/**
 * JSON file-based data store implementation
 */
export class JsonDataStore implements IDataStore {
  private filePath: string;

  /**
   * Create a new JsonDataStore instance
   * @param filePath - Path to the JSON file
   */
  constructor(filePath: string) {
    this.filePath = filePath;
  }

  /**
   * Get all vocabulary entries from JSON file
   * @returns Array of vocabulary entries
   * @throws Error if file reading or parsing fails
   */
  get(): Vocab[] {
    try {
      const data = fs.readFileSync(this.filePath, "utf8");
      return JSON.parse(data);
    } catch (error) {
      console.error("Error loading data:", (error as Error).message);
      return [];
    }
  }

  /**
   * Save vocabulary entries to JSON file
   * @param data - Array of vocabulary entries to save
   * @returns True if save was successful, false otherwise
   */
  save(data: Vocab[]): boolean {
    try {
      fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2), "utf8");
      return true;
    } catch (error) {
      console.error("Error saving data:", (error as Error).message);
      return false;
    }
  }
}
