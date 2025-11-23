#!/usr/bin/env node

/**
 * Daily Decay Scheduler
 *
 * This script checks for overdue decay and applies it to all vocabulary words.
 * The app automatically runs this on startup, but you can also run it manually
 * or via cron job if needed.
 *
 * Usage:
 *   node dailyDecay.mjs
 *
 * Setup with cron (run daily at 3 AM - optional):
 *   0 3 * * * cd /path/to/vocab && VOCAB_DATA_PATH=/path/to/data.json node dist/dailyDecay.mjs
 */

import { VocabRepository } from "./data/repository.mjs";
import { JsonDataStore } from "./data/dataStore.mjs";
import { DecayStore } from "./data/decayStore.mjs";
import { checkAndApplyOverdueDecay } from "./modes/studyMode.mjs";

const dataFilePath = process.env.VOCAB_DATA_PATH;

if (!dataFilePath) {
  console.error("Error: Environment variable VOCAB_DATA_PATH is not set.");
  process.exit(1);
}

try {
  // Initialize data store, repository, and decay store
  const dataStore = new JsonDataStore(dataFilePath);
  const repo = new VocabRepository(dataStore);
  const decayStore = new DecayStore(dataFilePath);

  console.log("Checking for overdue decay...");
  checkAndApplyOverdueDecay(repo, decayStore, false);
  console.log("Decay check completed successfully.");
} catch (error) {
  console.error("Error running decay check:", error);
  process.exit(1);
}
