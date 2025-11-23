import { readdirSync, statSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Recursively find all .spec.mts files
function findTestFiles(dir: string, fileList: string[] = []): string[] {
  const files = readdirSync(dir);

  files.forEach((file) => {
    const filePath = join(dir, file);
    const stat = statSync(filePath);

    if (stat.isDirectory()) {
      findTestFiles(filePath, fileList);
    } else if (file.endsWith(".spec.mjs")) {
      fileList.push(filePath);
    }
  });

  return fileList;
}

// Run all test files
async function runTests() {
  const distDir = join(__dirname, "..");
  const testFiles = findTestFiles(distDir);

  if (testFiles.length === 0) {
    console.log("No test files found.");
    process.exit(0);
  }

  console.log(`Found ${testFiles.length} test file(s)\n`);

  let failedTests = 0;
  let passedTests = 0;

  for (const testFile of testFiles) {
    const relativePath = testFile.replace(distDir + "/", "");
    console.log(`\n${"=".repeat(60)}`);
    console.log(`Running: ${relativePath}`);
    console.log("=".repeat(60));

    try {
      execSync(`node ${testFile}`, { stdio: "inherit" });
      passedTests++;
    } catch (error) {
      failedTests++;
      console.error(`\n❌ Test failed: ${relativePath}\n`);
    }
  }

  console.log(`\n${"=".repeat(60)}`);
  console.log("Test Summary");
  console.log("=".repeat(60));
  console.log(`✓ Passed: ${passedTests}`);
  console.log(`✗ Failed: ${failedTests}`);
  console.log(`Total: ${testFiles.length}`);

  if (failedTests > 0) {
    process.exit(1);
  }
}

runTests().catch((error) => {
  console.error("Error running tests:", error);
  process.exit(1);
});
