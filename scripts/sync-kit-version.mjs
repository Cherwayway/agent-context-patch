import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const options = parseArguments(process.argv.slice(2));
const repositoryRoot = resolve(options.root ?? resolve(import.meta.dirname, ".."));
const checkOnly = options.check;

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
    /^created_with_kit_version: "[^"\r\n]*"(?=\r?$)/mu,
    `created_with_kit_version: "${kitVersion}"`,
  ),
);
updateText("skills/evolve/references/config-schema.md", (source) =>
  source.replace(
    /^created_with_kit_version: "[^"\r\n]*"(?=\r?$)/mu,
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
  const path = resolve(repositoryRoot, relativePath);
  const before = readFileSync(path, "utf8");
  const document = JSON.parse(before);
  const beforeSemantic = JSON.stringify(document);
  update(document);
  if (JSON.stringify(document) === beforeSemantic) return;
  changes.push(relativePath);
  if (checkOnly) return;
  const newline = before.includes("\r\n") ? "\r\n" : "\n";
  const serialized = JSON.stringify(document, null, 2).replaceAll("\n", newline);
  writeFileSync(path, `${serialized}${newline}`, "utf8");
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

function parseArguments(arguments_) {
  const parsed = { check: false };
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === "--check") {
      parsed.check = true;
      continue;
    }
    if (argument === "--root") {
      const value = arguments_[index + 1];
      if (!value || value.startsWith("--")) throw new Error("--root requires a value");
      parsed.root = value;
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }
  return parsed;
}
