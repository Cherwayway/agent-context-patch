import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  cpSync,
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

import {
  inspectConfig,
  loadWorkspace,
  parseFrontmatter,
  parseYaml,
  renderCatalog,
  SCHEMA_VERSION,
} from "../../skills/evolve/runtime/index.mjs";

const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));
const TEMPLATE_FILES = ["config.yml", "README.md", "STATE.yml", "PROFILE.md"];
const TEMPLATE_DIRECTORIES = ["rules", "proposals", "reports", "archive"];
const FIXTURE_WORKSPACES = [".", "demos/fake-js-repo", "demos/markdown-smoke"];

test("package, skill manifest, and workspace schema versions agree", () => {
  const packageJson = readJson("package.json");
  const manifest = readJson("skills/evolve/manifest.json");
  const sourceSnapshotManifest = readJson("skills/source-snapshot/manifest.json");
  const pluginSourceSnapshotManifest = readJson(
    "plugins/agent-context-patch/skills/source-snapshot/manifest.json",
  );
  const config = parseYaml(read("templates/.agent-context/config.yml"), "template config");

  execFileSync(process.execPath, ["scripts/sync-kit-version.mjs", "--check"], {
    cwd: repositoryRoot,
    stdio: "pipe",
  });
  assert.equal(packageJson.engines?.node, ">=20");
  assert.equal(manifest.kit, "agent-context-patch");
  assert.equal(manifest.version, packageJson.version);
  assert.equal(manifest.schemaVersion, SCHEMA_VERSION);
  assert.equal(SCHEMA_VERSION, 2);
  assert.deepEqual(sourceSnapshotManifest, {
    kit: "agent-context-patch",
    skill: "source-snapshot",
    version: packageJson.version,
    schemaVersion: 1,
  });
  assert.deepEqual(pluginSourceSnapshotManifest, sourceSnapshotManifest);
  assert.equal(config.schema_version, manifest.schemaVersion);
  assert.equal(config.kit_version, packageJson.version);
  assert.equal(config.write_policy, "auto");
  assert.equal(config.agents_file, "AGENTS.md");
});

test("the workspace template is a complete, valid Schema 2 scaffold", async () => {
  for (const path of TEMPLATE_FILES) {
    assert.ok(existsSync(resolveTemplate(path)), `missing template file: ${path}`);
  }
  for (const directory of TEMPLATE_DIRECTORIES) {
    assert.ok(statSync(resolveTemplate(directory)).isDirectory(), `missing template directory: ${directory}`);
    assert.deepEqual(
      readdirSync(resolveTemplate(directory)).filter((entry) => entry !== ".gitkeep"),
      [],
      `template directory ${directory} must ship empty`,
    );
  }
  for (const obsoletePath of ["PROJECT_CONTEXT_INDEX.md", "PROJECT_PROFILE.md", "checklists", "mistakes", "receipts"]) {
    assert.equal(existsSync(resolveTemplate(obsoletePath)), false, `template still ships Schema 1 path: ${obsoletePath}`);
  }
  assert.deepEqual(inspectConfig(parseYaml(read("templates/.agent-context/config.yml"))).failures, []);
  assert.equal(read("templates/.agent-context/STATE.yml"), "[]\n");

  const sandbox = mkdtempSync(join(tmpdir(), "agent-context-template-"));
  try {
    cpSync(join(repositoryRoot, "templates", ".agent-context"), join(sandbox, ".agent-context"), { recursive: true });
    const workspace = await loadWorkspace(sandbox);
    assert.equal(workspace.status, "ok", JSON.stringify(workspace.failures));
    assert.deepEqual(workspace.rules, []);
    assert.deepEqual(workspace.state, []);
    assert.match(workspace.profile, /^# Profile/u);
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});

test("demo and dogfood workspaces are Schema 2 and their catalog blocks match a fresh render", async () => {
  const packageJson = readJson("package.json");
  for (const relativeRoot of FIXTURE_WORKSPACES) {
    const workspaceRoot = join(repositoryRoot, relativeRoot);
    const workspace = await loadWorkspace(workspaceRoot);
    assert.equal(workspace.status, "ok", `${relativeRoot}: ${JSON.stringify(workspace.failures)}`);
    assert.ok(workspace.rules.length > 0, `${relativeRoot} should carry at least one rule`);
    assert.equal(workspace.config.kit_version, packageJson.version, `${relativeRoot} config.kit_version is stale`);
    for (const obsoletePath of ["PROJECT_CONTEXT_INDEX.md", "PROJECT_PROFILE.md", "checklists", "mistakes"]) {
      assert.equal(existsSync(join(workspace.contextRoot, obsoletePath)), false, `${relativeRoot} still has ${obsoletePath}`);
    }

    const agentsSource = read(join(relativeRoot, workspace.config.agents_file));
    const header = /<!-- acp-catalog: kit=(\S+) schema=2 rendered=(\S+) rules=\d+ state=\d+ -->/u.exec(agentsSource);
    assert.ok(header, `${relativeRoot}: instruction file has no acp-catalog block`);
    assert.equal(header[1], packageJson.version, `${relativeRoot}: catalog was rendered by a stale kit`);
    const fresh = renderCatalog(workspace, { renderedAt: header[2], kitVersion: header[1] });
    assert.ok(agentsSource.replaceAll("\r\n", "\n").includes(fresh.text), `${relativeRoot}: catalog block is stale; re-render with evolve catalog --write`);
    assert.ok(fresh.bytes <= workspace.config.budgets.catalog_bytes, `${relativeRoot}: catalog exceeds its budget`);

    for (const proposal of readdirSync(join(workspace.contextRoot, "proposals")).filter((entry) => entry.endsWith(".md"))) {
      const { data, body } = parseFrontmatter(read(join(relativeRoot, ".agent-context", "proposals", proposal)), proposal);
      assert.equal(data.decision, "auto_applied", `${proposal} must document an applied audit`);
      assert.equal(data.kit_version, packageJson.version);
      assert.match(body, /## Diff\n\n```diff\n/u, `${proposal} must carry a unified diff, not a full file copy`);
      for (const target of data.targets) {
        assert.ok(data.after_hashes[target], `${proposal} lacks an after hash for ${target}`);
      }
    }
  }
});

test("the fake JavaScript demo rule points at the behavior its test protects", async () => {
  const workspace = await loadWorkspace(join(repositoryRoot, "demos", "fake-js-repo"));
  const rule = workspace.rules.find((entry) => entry.id === "greeting-preserve-caller-name");
  assert.ok(rule, "demo rule greeting-preserve-caller-name is missing");
  assert.equal(rule.kind, "gate");
  assert.deepEqual(rule.applies_to.paths, ["src/greeting.js"]);
  assert.match(read("demos/fake-js-repo/test/greeting.test.js"), /greeting must preserve caller-provided names/u);
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
  assert.match(bashInstaller, /migrate-v1/u, "bash installer must tell Schema 1 users to run migrate-v1");
  assert.match(powershellInstaller, /migrate-v1/u, "PowerShell installer must tell Schema 1 users to run migrate-v1");
  assert.match(skill, /acp-catalog/u);
  assert.match(skill, /migrate-v1/u);
  assert.match(skill, /select/u);
  assert.match(updatePolicy, /GitHub-enforced immutable Release/iu);
  assert.match(updatePolicy, /Create a draft/iu);
});

test("Kit Version check treats CRLF JSON as semantically synchronized", () => {
  const temporaryRoot = mkdtempSync(join(tmpdir(), "agent-context-version-sync-"));
  const versionSurfaces = [
    "package.json",
    "skills/evolve/manifest.json",
    "skills/source-snapshot/manifest.json",
    "plugins/agent-context-patch/skills/source-snapshot/manifest.json",
    ".claude-plugin/marketplace.json",
    "plugins/agent-context-patch/.claude-plugin/plugin.json",
    "docs/launch/experiment.json",
    "templates/.agent-context/config.yml",
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

test("the Claude marketplace resolves install and synchronized source snapshot skills", () => {
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
  assert.deepEqual(skillEntries.map((entry) => entry.name).toSorted(), [
    "install",
    "source-snapshot",
  ]);
  const skillPath = join(skillsRoot, "install", "SKILL.md");
  const { data } = parseFrontmatter(readFileSync(skillPath, "utf8"), skillPath);
  assert.deepEqual({ ...data }, {
    name: "install",
    description:
      "Safely install or inspect Agent Context Patch when the user asks for durable, reviewable workspace memory for Claude Code or Codex.",
    "disable-model-invocation": true,
  });
  execFileSync(process.execPath, ["scripts/sync-source-snapshot-plugin.mjs", "--check"], {
    cwd: repositoryRoot,
    stdio: "pipe",
  });
  const sourceSnapshotSkillPath = join(skillsRoot, "source-snapshot", "SKILL.md");
  const sourceSnapshotFrontmatter = parseFrontmatter(
    readFileSync(sourceSnapshotSkillPath, "utf8"),
    sourceSnapshotSkillPath,
  );
  assert.deepEqual({ ...sourceSnapshotFrontmatter.data }, {
    name: "source-snapshot",
    description:
      "Pin and inspect fresh, exact Git source snapshots for read-only code analysis without touching the user's working tree.",
  });
});

test("the discoverability clock is bound to the first external distribution event", () => {
  const experiment = readJson("docs/launch/experiment.json");
  const records = read("docs/launch/distribution-log.jsonl")
    .trim()
    .split(/\r?\n/u)
    .map((line) => JSON.parse(line));
  const channelById = new Map(
    experiment.channels.map((channel) => [channel.id, channel]),
  );

  assert.ok(records.length > 0);
  assert.equal(records[0].occurredAt, experiment.startsAt);
  assert.equal(records[0].externalPublication, true);
  assert.equal(
    records[0].landingPath,
    channelById.get(records[0].channel)?.landingPath,
  );
  assert.match(records[0].destination, /^https:\/\/github\.com\/openai\/codex\/discussions\//u);
  assert.equal(new Set(records.map((record) => record.eventId)).size, records.length);
  assert.deepEqual(
    records.map((record) => record.occurredAt),
    records.map((record) => record.occurredAt).toSorted(),
  );
});

test("the Schema 1 runtime surface is gone", () => {
  for (const stalePath of [
    "skills/evolve/runtime/lifecycle.mjs",
    "skills/evolve/runtime/outcome.mjs",
    "skills/evolve/runtime/context-compiler.mjs",
    "skills/evolve/runtime/proposal-store.mjs",
    "skills/evolve/references/protocol-v1.md",
    "skills/evolve/references/config-schema.md",
    "tests/kernel",
    "tests/lifecycle",
  ]) {
    assert.equal(existsSync(join(repositoryRoot, stalePath)), false, `Schema 1 surface still present: ${stalePath}`);
  }
  for (const runtimeFile of ["cli.mjs", "index.mjs", "apply.mjs", "select.mjs", "catalog.mjs", "workspace.mjs", "migrate-v1.mjs"]) {
    assert.ok(existsSync(join(repositoryRoot, "skills", "evolve", "runtime", runtimeFile)), `runtime file missing: ${runtimeFile}`);
  }
});

function read(relativePath) {
  return readFileSync(join(repositoryRoot, relativePath), "utf8");
}

function readJson(relativePath) {
  return JSON.parse(read(relativePath));
}

function resolveTemplate(relativePath) {
  return join(repositoryRoot, "templates", ".agent-context", relativePath);
}
