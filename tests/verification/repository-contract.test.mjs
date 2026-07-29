import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { validateConfigDocument } from "./config-contract.mjs";
import { validateProposalDocument } from "./proposal-contract.mjs";
import { parseMarkdownFrontmatter, parseYamlSubset } from "./yaml-subset.mjs";

const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));

test("package, skill manifest, and context schema versions agree", () => {
  const packageJson = readJson("package.json");
  const manifest = readJson("skills/evolve/manifest.json");
  const config = parseYamlSubset(read("templates/.agent-context/config.yml"), "template config");

  execFileSync(process.execPath, ["scripts/sync-kit-version.mjs", "--check"], {
    cwd: repositoryRoot,
    stdio: "pipe",
  });
  assert.equal(packageJson.engines?.node, ">=20");
  assert.equal(manifest.kit, "agent-context-patch");
  assert.equal(manifest.version, packageJson.version);
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(config.schema_version, manifest.schemaVersion);
  assert.equal(config.created_with_kit_version, packageJson.version);
  assert.equal(config.last_migrated_with_kit_version, null);
});

test("workspace template has one active topology and no pre-enabled domain materialization", () => {
  for (const path of [
    "PROJECT_CONTEXT_INDEX.md",
    "PROJECT_PROFILE.md",
    "config.yml",
    "checklists/README.md",
    "proposals/README.md",
    "reports/README.md",
    "archive/README.md",
  ]) {
    assert.ok(existsSync(resolveTemplate(path)), `missing template path: ${path}`);
  }

  for (const obsoletePath of ["mistakes", "receipts"]) {
    assert.equal(
      containsFiles(resolveTemplate(obsoletePath)),
      false,
      `template contains obsolete files under: ${obsoletePath}`,
    );
  }
  for (const domainFile of ["coding.md", "prd.md", "seo.md"]) {
    assert.equal(
      existsSync(resolveTemplate(`checklists/${domainFile}`)),
      false,
      `template prematurely materializes domain checklist: ${domainFile}`,
    );
  }
});

test("the public update surface is release-based, explicit, and workspace-independent", () => {
  const readme = read("README.md");
  const chineseReadme = read("README.zh-CN.md");
  const installGuide = read("AGENT_INSTALL.md");
  const skill = read("skills/evolve/SKILL.md");
  const updatePolicy = read("docs/update-policy.md");
  const powershellInstaller = read("install/install.ps1");
  const bashInstaller = read("install/install.sh");

  for (const document of [readme, chineseReadme, installGuide, skill]) {
    assert.match(document, /releases\/latest/iu);
    assert.match(document, /\$evolve update/iu);
  }
  assert.doesNotMatch(
    readme,
    /Install Agent Context Patch from https:\/\/github\.com\/Cherwayway\/agent-context-patch\.(?:\r?\n|\s)/u,
    "stable install instructions still point at the moving repository root",
  );
  assert.match(powershellInstaller, /UpdateDryRun/iu);
  assert.match(powershellInstaller, /UpdateApply/iu);
  assert.match(bashInstaller, /update-dry-run/iu);
  assert.match(bashInstaller, /update-apply/iu);
  assert.match(skill, /never poll in\s+the background/iu);
  assert.match(skill, /never.*workspace-schema migration/isu);
  assert.match(updatePolicy, /GitHub-enforced immutable Release/iu);
  assert.match(updatePolicy, /Create a draft/iu);
  assert.match(installGuide, /One-time handoff from v0\.2\.0/iu);
  assert.match(readme, /v0\.2\.0 skill predates `\$evolve update`/iu);
});

test("Kit Version check treats CRLF JSON as semantically synchronized", () => {
  const temporaryRoot = mkdtempSync(join(tmpdir(), "agent-context-version-sync-"));
  const versionSurfaces = [
    "package.json",
    "skills/evolve/manifest.json",
    ".claude-plugin/marketplace.json",
    "plugins/agent-context-patch/.claude-plugin/plugin.json",
    "docs/launch/experiment.json",
    "templates/.agent-context/config.yml",
    "skills/evolve/references/config-schema.md",
  ];

  try {
    for (const relativePath of versionSurfaces) {
      const target = join(temporaryRoot, relativePath);
      mkdirSync(dirname(target), { recursive: true });
      const crlfSource = read(relativePath).replaceAll("\r\n", "\n").replaceAll("\n", "\r\n");
      writeFileSync(target, crlfSource, "utf8");
    }
    execFileSync(
      process.execPath,
      ["scripts/sync-kit-version.mjs", "--check", "--root", temporaryRoot],
      { cwd: repositoryRoot, stdio: "pipe" },
    );
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test("the Claude marketplace resolves one invocable install skill", () => {
  const packageJson = readJson("package.json");
  const marketplace = readJson(".claude-plugin/marketplace.json");
  const marketplaceEntry = marketplace.plugins[0];
  const pluginRoot = join(repositoryRoot, marketplaceEntry.source);
  const plugin = JSON.parse(
    readFileSync(join(pluginRoot, ".claude-plugin", "plugin.json"), "utf8"),
  );
  const skillsRoot = join(pluginRoot, plugin.skills);
  const skillEntries = readdirSync(skillsRoot, { withFileTypes: true }).filter(
    (entry) => entry.isDirectory(),
  );

  assert.equal(marketplace.name, "agent-context-patch");
  assert.deepEqual(
    marketplace.plugins.map(({ name, source, version }) => ({ name, source, version })),
    [
      {
        name: "agent-context-patch",
        source: "./plugins/agent-context-patch",
        version: packageJson.version,
      },
    ],
  );
  assert.equal(plugin.name, "agent-context-patch");
  assert.equal(plugin.version, packageJson.version);
  assert.equal(plugin.skills, "./skills/");
  assert.equal(
    plugin.homepage,
    "https://github.com/Cherwayway/agent-context-patch/blob/main/docs/why-agent-context-patch.md",
  );
  assert.deepEqual(skillEntries.map((entry) => entry.name), ["install"]);
  const skillPath = join(skillsRoot, "install", "SKILL.md");
  const { data } = parseMarkdownFrontmatter(readFileSync(skillPath, "utf8"), skillPath);
  assert.deepEqual({ ...data }, {
    name: "install",
    description:
      "Safely install or inspect Agent Context Patch when the user asks for durable, reviewable workspace memory for Claude Code or Codex.",
    "disable-model-invocation": true,
  });
});

test("template config expresses the v1 policy and health thresholds", () => {
  const path = "templates/.agent-context/config.yml";
  assert.deepEqual(validateConfigDocument(read(path), path), []);
});

test("personal dogfooding is an installed reference and this repository follows Schema 1", () => {
  const playbookPath = "skills/evolve/references/personal-dogfooding.zh-CN.md";
  const playbook = read(playbookPath);
  const skill = read("skills/evolve/SKILL.md");
  const profile = read(".agent-context/PROJECT_PROFILE.md");

  assert.match(skill, /references\/personal-dogfooding\.zh-CN\.md/u);
  for (const token of [
    "Default Personal Loop",
    "$evolve after-failure",
    "Weekly Review",
    "Promotion Gate",
    "Success Check",
  ]) {
    assert.ok(playbook.includes(token), `${playbookPath} is missing: ${token}`);
  }

  assert.deepEqual(
    validateConfigDocument(read(".agent-context/config.yml"), ".agent-context/config.yml"),
    [],
  );
  assert.match(profile, /0\.5\.1 observable-delivery/u);
  assert.match(profile, /personal-dogfooding\.zh-CN\.md/u);
  assert.equal(
    containsFiles(join(repositoryRoot, ".agent-context", "mistakes")),
    false,
    "dogfood context revived the obsolete mistakes store",
  );
});

test("the auto-first fresh-Agent acceptance evidence is retained", () => {
  const acceptance = read("docs/acceptance/2026-07-12-auto-first-fresh-context.md");

  assert.match(acceptance, /^- Result: PASS$/mu);
  assert.match(acceptance, /No approval turn\s+occurred/u);
  assert.match(acceptance, /production proposal validator returned no failures/u);
  assert.match(acceptance, /Proposal count remained zero/u);
  assert.match(acceptance, /no raw conversation/u);
});

test("the observable delivery fresh-Agent acceptance evidence is retained", () => {
  const acceptance = read(
    "docs/acceptance/2026-07-19-observable-delivery-checkpoint.md",
  );

  assert.match(acceptance, /^- Result: PASS$/mu);
  assert.match(acceptance, /without naming `?\$?evolve`?/iu);
  assert.match(acceptance, /detect=candidate/u);
  assert.match(acceptance, /propose=created/u);
  assert.match(acceptance, /apply=applied/u);
  assert.match(acceptance, /production proposal validator returned no failures/iu);
  assert.match(acceptance, /Proposal count remained zero/u);
  assert.match(acceptance, /no durable context write/iu);
  assert.match(acceptance, /no evolution receipt/iu);
  assert.match(acceptance, /no raw conversation/iu);
  assert.match(acceptance, /no private absolute workspace path/iu);
});

test("lifecycle transitions have one Coordinator-owned runtime contract", () => {
  const contract = read("skills/evolve/runtime/lifecycle-contract.mjs");
  const coordinator = read("skills/evolve/runtime/lifecycle.mjs");
  const outcome = read("skills/evolve/runtime/outcome.mjs");

  assert.match(contract, /function isLifecycleOutcome/u);
  assert.match(contract, /function deriveLifecycleReconciliationStatus/u);
  assert.match(coordinator, /from "\.\/lifecycle-contract\.mjs"/u);
  assert.match(coordinator, /deriveLifecycleReconciliationStatus/u);
  assert.match(outcome, /from "\.\/lifecycle-contract\.mjs"/u);
  assert.match(outcome, /isLifecycleOutcome/u);
  assert.doesNotMatch(outcome, /function validCoordinatorTransition/u);
});

test("the applied demo proposal is a valid v1 evolution aggregate", () => {
  const proposalPath =
    "demos/fake-js-repo/.agent-context/proposals/2026-07-09-greeting-contract.md";
  const source = read(proposalPath);
  const { data } = parseMarkdownFrontmatter(source, proposalPath);

  assert.equal(data.status, "applied", "demo must exercise the applied audit path");
  assert.match(source, /"requestedPolicy": "auto"/u);
  assert.match(source, /"policy": "auto"/u);
  assert.match(source, /^- decision: policy_auto$/mu);
  assert.match(source, /^  result: applied$/mu);
  assert.deepEqual(validateProposalDocument(source, proposalPath), []);
});

test("the demo Apply Attempt hashes describe its actual two-file transition", () => {
  const proposal = read(
    "demos/fake-js-repo/.agent-context/proposals/2026-07-09-greeting-contract.md",
  );
  const transitions = [
    {
      target: ".agent-context/PROJECT_PROFILE.md",
      repositoryPath: "demos/fake-js-repo/.agent-context/PROJECT_PROFILE.md",
      addedLine: "- Greeting output must preserve caller-provided names.\n",
    },
    {
      target: ".agent-context/checklists/coding.md",
      repositoryPath: "demos/fake-js-repo/.agent-context/checklists/coding.md",
      addedLine: "- Preserve caller-provided names in greeting output.\n",
    },
  ];

  for (const { target, repositoryPath, addedLine } of transitions) {
    const after = readFileSync(join(repositoryRoot, repositoryPath));
    const addition = Buffer.from(addedLine, "utf8");
    const additionAt = after.indexOf(addition);
    assert.notEqual(additionAt, -1, `${repositoryPath} is missing its demonstrated addition`);
    const before = Buffer.concat([
      after.subarray(0, additionAt),
      after.subarray(additionAt + addition.length),
    ]);
    assert.match(
      proposal,
      new RegExp(`${escapeRegExp(target)}:\\s+${sha256(before)}`, "u"),
      `proposal before_hash does not reconstruct ${target}`,
    );
    assert.match(
      proposal,
      new RegExp(`${escapeRegExp(target)}:\\s+${sha256(after)}`, "u"),
      `proposal after_hash does not match ${target}`,
    );
  }
});

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function read(relativePath) {
  return readFileSync(join(repositoryRoot, relativePath), "utf8");
}

function readJson(relativePath) {
  return JSON.parse(read(relativePath));
}

function resolveTemplate(relativePath) {
  return join(repositoryRoot, "templates", ".agent-context", relativePath);
}

function containsFiles(path) {
  if (!existsSync(path)) return false;
  if (statSync(path).isFile()) return true;
  return readdirSync(path).some((entry) => containsFiles(join(path, entry)));
}
