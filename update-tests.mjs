import { readFileSync, writeFileSync } from "fs";
import { deduceDutchWordInfo } from "./dist/data/nl/utils/deduceDutchWordInfo.mjs";

const testFile = "./src/data/nl/utils/deduceDutchWordInfo.spec.mts";
let content = readFileSync(testFile, "utf-8");

// Find all testWordInfo calls and extract the word
const testPattern = /testWordInfo\(\s*"([^"]+)",\s*\{([^}]+(?:\{[^}]+\}[^}]+)*)\},/g;

let match;
const updates = [];

while ((match = testPattern.exec(content)) !== null) {
  const word = match[1];
  const result = deduceDutchWordInfo(word);

  console.log(`Processing: ${word}`);
  console.log(`Result:`, JSON.stringify(result, null, 2));

  updates.push({
    word,
    result,
  });
}

console.log(`\nFound ${updates.length} test cases to potentially update`);
console.log("Note: Manual verification recommended due to test file complexity");
