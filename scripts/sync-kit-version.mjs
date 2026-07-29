import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dirname, "..");
const checkOnly = process.argv.slice(2).includes("--check");
const unknownArguments = process.argv.slice(2).filter((value) => value !== "--check");

if (unknownArguments.length > 0) {
  throw new Error(`Unknown argument: ${unknownArguments[0]}`);
}

const kitVersion = readJson("package.json").version;
const changes = [];

updateJson("skills/evolve/manifest.json", (document) => {
  document.version = kitVersion;
});
updateJson(".claude-plugin/marketplace.json", (document) => {
  document.metadata.version = kitVersion;
  for (const plugin of document.plugins) plugin.version = kitVersion;
});
updateJson("plugins/agent-context-patch/.claude-plugin/plugin.json", (document) => {
  document.version = kitVersion;
});
updateJson("docs/launch/experiment.json", (document) => {
  document.targetKitVersion = kitVersion;
});
updateText("templates/.agent-context/config.yml", (source) =>
  source.replace(
    /^created_with_kit_version: ".*"$/mu,
    `created_with_kit_version: "${kitVersion}"`,
  ),
);
updateText("skills/evolve/references/config-schema.md", (source) =>
  source.replace(
    /^created_with_kit_version: ".*"$/mu,
    `created_with_kit_version: "${kitVersion}"`,
  ),
);

if (checkOnly && changes.length > 0) {
  throw new Error(
    `Kit Version ${kitVersion} is not synchronized: ${changes.join(", ")}. Run npm run version:sync.`,
  );
}

console.log(
  changes.length === 0
    ? `Kit Version ${kitVersion} is synchronized.`
    : `Synchronized Kit Version ${kitVersion}: ${changes.join(", ")}`,
);

function updateJson(relativePath, update) {
  const document = readJson(relativePath);
  update(document);
  updateText(relativePath, () => `${JSON.stringify(document, null, 2)}\n`);
}

function updateText(relativePath, update) {
  const path = resolve(repositoryRoot, relativePath);
  const before = readFileSync(path, "utf8");
  const after = update(before);
  if (after === before) return;
  changes.push(relativePath);
  if (!checkOnly) writeFileSync(path, after, "utf8");
}

function readJson(relativePath) {
  return JSON.parse(readFileSync(resolve(repositoryRoot, relativePath), "utf8"));
}
