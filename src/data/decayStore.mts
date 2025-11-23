import fs from "fs";
import path from "path";

/**
 * Interface for decay timestamp data
 */
export interface DecayData {
  lastDecayDate: string; // ISO date string (YYYY-MM-DD)
}

/**
 * Store for tracking the last decay timestamp
 */
export class DecayStore {
  private filePath: string;

  /**
   * Create a new DecayStore instance
   * @param dataFilePath - Path to the main data JSON file (used to derive decay file path)
   */
  constructor(dataFilePath: string) {
    const dir = path.dirname(dataFilePath);
    const basename = path.basename(dataFilePath, path.extname(dataFilePath));
    this.filePath = path.join(dir, `${basename}.decay.json`);
  }

  /**
   * Get the last decay date
   * @returns Last decay date as ISO string, or null if never decayed
   */
  getLastDecayDate(): string | null {
    try {
      if (!fs.existsSync(this.filePath)) {
        return null;
      }
      const data = fs.readFileSync(this.filePath, "utf8");
      const parsed: DecayData = JSON.parse(data);
      return parsed.lastDecayDate;
    } catch (error) {
      console.error("Error loading decay data:", (error as Error).message);
      return null;
    }
  }

  /**
   * Update the last decay date to today
   * @returns True if save was successful, false otherwise
   */
  updateLastDecayDate(): boolean {
    try {
      const today = new Date().toISOString().split("T")[0]; // YYYY-MM-DD
      const data: DecayData = {
        lastDecayDate: today,
      };
      fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2), "utf8");
      return true;
    } catch (error) {
      console.error("Error saving decay data:", (error as Error).message);
      return false;
    }
  }

  /**
   * Calculate how many days have passed since last decay
   * @returns Number of days, or null if never decayed
   */
  getDaysSinceLastDecay(): number | null {
    const lastDecay = this.getLastDecayDate();
    if (!lastDecay) {
      return null;
    }

    const lastDecayDate = new Date(lastDecay);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    lastDecayDate.setHours(0, 0, 0, 0);

    const diffTime = today.getTime() - lastDecayDate.getTime();
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

    return diffDays;
  }
}
