import assert from "node:assert";
import fs from "fs";
import path from "path";
import { DecayStore } from "./decayStore.mjs";

/**
 * Test suite for DecayStore class
 *
 * This class manages decay timestamp data for vocabulary learning.
 */

const TEST_DATA_DIR = path.join(process.cwd(), "test-temp");
const TEST_DATA_FILE = path.join(TEST_DATA_DIR, "test-data.json");
const TEST_DECAY_FILE = path.join(TEST_DATA_DIR, "test-data.decay.json");

// Test helper
function testCase(description: string, testFn: () => void) {
  try {
    testFn();
    console.log(`✓ ${description}`);
  } catch (error) {
    console.error(`✗ ${description}`);
    throw error;
  }
}

// Setup: Create test directory
function setup() {
  if (!fs.existsSync(TEST_DATA_DIR)) {
    fs.mkdirSync(TEST_DATA_DIR, { recursive: true });
  }
  // Clean up any existing test files
  if (fs.existsSync(TEST_DECAY_FILE)) {
    fs.unlinkSync(TEST_DECAY_FILE);
  }
}

// Cleanup: Remove test files
function cleanup() {
  if (fs.existsSync(TEST_DECAY_FILE)) {
    fs.unlinkSync(TEST_DECAY_FILE);
  }
  if (fs.existsSync(TEST_DATA_DIR)) {
    fs.rmdirSync(TEST_DATA_DIR);
  }
}

console.log("Testing DecayStore\n");

// Setup
setup();

console.log("=== INITIALIZATION ===");

testCase("Constructor creates DecayStore instance", () => {
  const store = new DecayStore(TEST_DATA_FILE);
  assert.ok(store instanceof DecayStore);
});

testCase("Decay file path is correctly derived from data file path", () => {
  const store = new DecayStore(TEST_DATA_FILE);
  // We can't directly access filePath (it's private), but we can verify it works
  const lastDecay = store.getLastDecayDate();
  assert.strictEqual(lastDecay, null); // Should be null initially
});

console.log("\n=== GET LAST DECAY DATE ===");

testCase("getLastDecayDate returns null when file doesn't exist", () => {
  const store = new DecayStore(TEST_DATA_FILE);
  const result = store.getLastDecayDate();
  assert.strictEqual(result, null);
});

testCase("getLastDecayDate returns null when file is corrupted", () => {
  // Create a corrupted decay file
  fs.writeFileSync(TEST_DECAY_FILE, "invalid json", "utf8");
  const store = new DecayStore(TEST_DATA_FILE);
  const result = store.getLastDecayDate();
  assert.strictEqual(result, null);
  // Clean up
  fs.unlinkSync(TEST_DECAY_FILE);
});

console.log("\n=== UPDATE LAST DECAY DATE ===");

testCase("updateLastDecayDate creates decay file with today's date", () => {
  const store = new DecayStore(TEST_DATA_FILE);
  const success = store.updateLastDecayDate();
  assert.strictEqual(success, true);
  assert.ok(fs.existsSync(TEST_DECAY_FILE));
});

testCase("updateLastDecayDate saves correct ISO date format", () => {
  const store = new DecayStore(TEST_DATA_FILE);
  store.updateLastDecayDate();

  const data = fs.readFileSync(TEST_DECAY_FILE, "utf8");
  const parsed = JSON.parse(data);

  assert.ok(parsed.lastDecayDate);
  // Check ISO date format (YYYY-MM-DD)
  assert.match(parsed.lastDecayDate, /^\d{4}-\d{2}-\d{2}$/);
});

testCase("getLastDecayDate retrieves the saved date", () => {
  const store = new DecayStore(TEST_DATA_FILE);
  store.updateLastDecayDate();

  const today = new Date().toISOString().split("T")[0];
  const lastDecay = store.getLastDecayDate();

  assert.strictEqual(lastDecay, today);
});

console.log("\n=== DAYS SINCE LAST DECAY ===");

testCase("getDaysSinceLastDecay returns null when never decayed", () => {
  // Clean up any existing decay file
  if (fs.existsSync(TEST_DECAY_FILE)) {
    fs.unlinkSync(TEST_DECAY_FILE);
  }

  const store = new DecayStore(TEST_DATA_FILE);
  const days = store.getDaysSinceLastDecay();
  assert.strictEqual(days, null);
});

testCase("getDaysSinceLastDecay returns 0 for today", () => {
  const store = new DecayStore(TEST_DATA_FILE);
  store.updateLastDecayDate();

  const days = store.getDaysSinceLastDecay();
  assert.strictEqual(days, 0);
});

testCase("getDaysSinceLastDecay calculates days correctly", () => {
  const store = new DecayStore(TEST_DATA_FILE);

  // Manually create a decay file with a date 5 days ago
  const fiveDaysAgo = new Date();
  fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5);
  const dateString = fiveDaysAgo.toISOString().split("T")[0];

  fs.writeFileSync(
    TEST_DECAY_FILE,
    JSON.stringify({ lastDecayDate: dateString }, null, 2),
    "utf8",
  );

  const days = store.getDaysSinceLastDecay();
  assert.strictEqual(days, 5);
});

testCase("getDaysSinceLastDecay handles multiple updates", () => {
  const store = new DecayStore(TEST_DATA_FILE);

  // First update (3 days ago)
  const threeDaysAgo = new Date();
  threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
  const dateString = threeDaysAgo.toISOString().split("T")[0];

  fs.writeFileSync(
    TEST_DECAY_FILE,
    JSON.stringify({ lastDecayDate: dateString }, null, 2),
    "utf8",
  );

  let days = store.getDaysSinceLastDecay();
  assert.strictEqual(days, 3);

  // Update to today
  store.updateLastDecayDate();
  days = store.getDaysSinceLastDecay();
  assert.strictEqual(days, 0);
});

console.log("\n=== EDGE CASES ===");

testCase("Works with different file paths", () => {
  const differentPath = path.join(TEST_DATA_DIR, "different.json");
  const differentDecayPath = path.join(TEST_DATA_DIR, "different.decay.json");

  const store = new DecayStore(differentPath);
  store.updateLastDecayDate();

  assert.ok(fs.existsSync(differentDecayPath));
  assert.strictEqual(store.getDaysSinceLastDecay(), 0);

  // Clean up
  fs.unlinkSync(differentDecayPath);
});

testCase("Handles nested directory paths", () => {
  const nestedDir = path.join(TEST_DATA_DIR, "nested", "deep");
  fs.mkdirSync(nestedDir, { recursive: true });

  const nestedPath = path.join(nestedDir, "nested-data.json");
  const nestedDecayPath = path.join(nestedDir, "nested-data.decay.json");

  const store = new DecayStore(nestedPath);
  store.updateLastDecayDate();

  assert.ok(fs.existsSync(nestedDecayPath));

  // Clean up
  fs.unlinkSync(nestedDecayPath);
  fs.rmSync(path.join(TEST_DATA_DIR, "nested"), { recursive: true });
});

testCase("File persists across multiple DecayStore instances", () => {
  const store1 = new DecayStore(TEST_DATA_FILE);
  store1.updateLastDecayDate();

  const store2 = new DecayStore(TEST_DATA_FILE);
  const lastDecay = store2.getLastDecayDate();

  const today = new Date().toISOString().split("T")[0];
  assert.strictEqual(lastDecay, today);
});

console.log("\n=== REAL-WORLD SCENARIO ===");

testCase("Running decay twice on same day - second run returns 0 days", () => {
  const store = new DecayStore(TEST_DATA_FILE);

  // First run (simulate first decay of the day)
  const firstRunDays = store.getDaysSinceLastDecay();
  // Could be null (first ever) or a number (days since last)

  // Apply decay - update the timestamp
  store.updateLastDecayDate();

  // Second run (immediately after)
  const secondRunDays = store.getDaysSinceLastDecay();
  assert.strictEqual(secondRunDays, 0, "Second run should return 0 days");

  // Third run (still same day)
  const thirdRunDays = store.getDaysSinceLastDecay();
  assert.strictEqual(thirdRunDays, 0, "Third run should also return 0 days");
});

testCase("Decay logic: should only apply if days > 0", () => {
  const store = new DecayStore(TEST_DATA_FILE);

  // First decay
  store.updateLastDecayDate();

  // Check immediately - should be 0
  let days = store.getDaysSinceLastDecay();
  assert.strictEqual(days, 0);

  // Simulate the check that prevents double decay
  const shouldApplyDecay = days !== null && days > 0;
  assert.strictEqual(
    shouldApplyDecay,
    false,
    "Should NOT apply decay on same day",
  );

  // Manually set to yesterday
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const dateString = yesterday.toISOString().split("T")[0];
  fs.writeFileSync(
    TEST_DECAY_FILE,
    JSON.stringify({ lastDecayDate: dateString }, null, 2),
    "utf8",
  );

  // Check again - should be 1
  days = store.getDaysSinceLastDecay();
  assert.strictEqual(days, 1);

  const shouldApplyDecayNow = days !== null && days > 0;
  assert.strictEqual(
    shouldApplyDecayNow,
    true,
    "SHOULD apply decay after 1 day",
  );
});

console.log("\n=== ALL TESTS PASSED ===\n");

// Cleanup
cleanup();
