import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { extname, join, relative } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));
const textExtensions = new Set([".json", ".js", ".md", ".mjs", ".ps1", ".sh", ".txt", ".yaml", ".yml"]);
const forbidden = [
  { label: "placeholder organization URL", value: "<" + "org>" },
  { label: "obsolete product name", value: "Agent " + "Loop Kit" },
];

test("publishable text contains no placeholder URL or obsolete product name", () => {
  const matches = [];

  for (const path of listTextFiles(repositoryRoot)) {
    const source = readFileSync(path, "utf8");
    for (const pattern of forbidden) {
      if (source.toLowerCase().includes(pattern.value.toLowerCase())) {
        matches.push(`${relative(repositoryRoot, path).replaceAll("\\", "/")}: ${pattern.label}`);
      }
    }
  }

  assert.deepEqual(matches, [], `repository hygiene failures:\n${matches.join("\n")}`);
});

function listTextFiles(root) {
  const files = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if ([".git", "node_modules"].includes(entry.name)) continue;
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...listTextFiles(path));
    } else if (entry.isFile() && textExtensions.has(extname(entry.name))) {
      files.push(path);
    }
  }
  return files;
}
