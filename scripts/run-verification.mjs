import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const testsRoot = join(repositoryRoot, "tests");
const testFiles = findTests(testsRoot).sort();

if (testFiles.length === 0) {
  console.error("Verification failed: no test files were discovered under tests/.");
  process.exit(1);
}

console.log(`Running ${testFiles.length} verification test file(s):`);
for (const file of testFiles) {
  console.log(`- ${relative(repositoryRoot, file).replaceAll("\\", "/")}`);
}

const result = spawnSync(process.execPath, ["--test", ...testFiles], {
  cwd: repositoryRoot,
  env: verificationEnvironment(),
  stdio: "inherit",
});

if (result.error) {
  console.error(`Verification runner failed to start: ${result.error.message}`);
  process.exit(1);
}

process.exit(result.status ?? 1);

function findTests(directory) {
  const matches = [];

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      matches.push(...findTests(path));
    } else if (/\.test\.(?:c|m)?js$/u.test(entry.name)) {
      matches.push(path);
    }
  }

  return matches;
}

function verificationEnvironment() {
  const environment = { ...process.env };
  // A verification process can itself be launched by a node:test regression test.
  // Do not let Node treat the new runner as a recursively embedded test harness.
  delete environment.NODE_TEST_CONTEXT;
  return environment;
}
