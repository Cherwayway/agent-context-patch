import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { join, relative, resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dirname, "..");
const sourceRoot = join(repositoryRoot, "skills", "source-snapshot");
const pluginRoot = join(
  repositoryRoot,
  "plugins",
  "agent-context-patch",
  "skills",
  "source-snapshot",
);
const checkOnly = process.argv.slice(2).includes("--check");

if (process.argv.length > (checkOnly ? 3 : 2)) {
  throw new Error("usage: node scripts/sync-source-snapshot-plugin.mjs [--check]");
}
validateTree(sourceRoot, "canonical source-snapshot skill");

if (checkOnly) {
  validateTree(pluginRoot, "generated plugin source-snapshot skill");
  const source = treeFingerprint(sourceRoot);
  const plugin = treeFingerprint(pluginRoot);
  if (source !== plugin) {
    throw new Error(
      "Plugin source-snapshot skill differs from skills/source-snapshot. Run npm run plugin:sync.",
    );
  }
  console.log(`Source Snapshot plugin tree is synchronized: ${source}`);
} else {
  const expectedTarget = join(
    repositoryRoot,
    "plugins",
    "agent-context-patch",
    "skills",
    "source-snapshot",
  );
  if (pluginRoot !== expectedTarget) throw new Error("refusing to synchronize an unexpected target");
  rmSync(pluginRoot, { recursive: true, force: true });
  mkdirSync(pluginRoot, { recursive: true });
  cpSync(sourceRoot, pluginRoot, { recursive: true, errorOnExist: true });
  validateTree(pluginRoot, "generated plugin source-snapshot skill");
  console.log(`Synchronized Source Snapshot plugin tree: ${treeFingerprint(pluginRoot)}`);
}

function validateTree(root, label) {
  if (!existsSync(root) || lstatSync(root).isSymbolicLink() || !lstatSync(root).isDirectory()) {
    throw new Error(`${label} is missing or unsafe: ${relative(repositoryRoot, root)}`);
  }
  for (const path of walk(root)) {
    if (lstatSync(path).isSymbolicLink()) {
      throw new Error(`${label} contains a symlink: ${relative(repositoryRoot, path)}`);
    }
  }
}

function treeFingerprint(root) {
  const hash = createHash("sha256");
  for (const path of walk(root).filter((entry) => lstatSync(entry).isFile())) {
    const name = relative(root, path).split("\\").join("/");
    const content = readFileSync(path);
    hash.update(`${Buffer.byteLength(name)}:${name}${content.length}:`);
    hash.update(content);
  }
  return hash.digest("hex");
}

function walk(root) {
  const paths = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).toSorted((a, b) =>
      a.name.localeCompare(b.name, "en"),
    )) {
      const path = join(directory, entry.name);
      paths.push(path);
      if (entry.isDirectory()) visit(path);
    }
  };
  visit(root);
  return paths;
}
