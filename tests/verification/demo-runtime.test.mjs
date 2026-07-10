import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));
const demoRoot = join(repositoryRoot, "demos", "fake-js-repo");

test("the fake JavaScript repository passes its real test command", () => {
  const result = spawnSync(npmCommand(), ["test", "--silent"], {
    cwd: demoRoot,
    encoding: "utf8",
    shell: process.platform === "win32",
    timeout: 30_000,
  });

  assert.ifError(result.error);
  assert.equal(
    result.status,
    0,
    ["The fake JavaScript demo failed its own npm test command.", result.stdout, result.stderr].join(
      "\n",
    ),
  );
});

function npmCommand() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}
