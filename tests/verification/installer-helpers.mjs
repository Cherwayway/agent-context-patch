import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

export function assertInstallerContract({ repositoryRoot, runDryRun, runApply }) {
  const workspace = mkdtempSync(join(tmpdir(), "agent-context-patch-install-"));
  const targetRoot = join(workspace, ".agent-context");
  const existingProfile = join(targetRoot, "PROJECT_PROFILE.md");
  const existingConfig = join(targetRoot, "config.yml");
  const existingInstructions = join(workspace, "AGENTS.md");
  const profileSentinel = "# Existing project profile\n\nKeep this user-owned content.\n";
  const instructionsSentinel = "# Existing instructions\n\nDo not replace this file.\n";

  try {
    mkdirSync(targetRoot, { recursive: true });
    writeFileSync(existingProfile, profileSentinel, "utf8");
    writeFileSync(
      existingConfig,
      readFileSync(join(repositoryRoot, "templates", ".agent-context", "config.yml")),
    );
    writeFileSync(existingInstructions, instructionsSentinel, "utf8");

    const beforeDryRun = snapshotTree(workspace);
    const dryRun = runDryRun(workspace);
    assertCommandSucceeded(dryRun, "installer dry-run");
    assert.deepEqual(snapshotTree(workspace), beforeDryRun, "dry-run wrote workspace files");

    const firstPlanHash = extractPlanHash(dryRun.stdout);
    assert.match(
      dryRun.stdout,
      /(?:skip|preserve)[^\r\n]*PROJECT_PROFILE\.md/iu,
      "dry-run did not report that the existing profile would be preserved",
    );
    assert.match(
      dryRun.stdout,
      /create[^\r\n]*PROJECT_CONTEXT_INDEX\.md[^\r\n]*source-sha256=[a-f0-9]{64}/iu,
      "dry-run did not bind a create action to its source content",
    );

    const staleTarget = join(targetRoot, "PROJECT_CONTEXT_INDEX.md");
    writeFileSync(
      staleTarget,
      readFileSync(
        join(repositoryRoot, "templates", ".agent-context", "PROJECT_CONTEXT_INDEX.md"),
      ),
    );
    const staleApply = runApply(workspace, firstPlanHash);
    assertCommandFailed(staleApply, "apply with a stale approved plan");
    assert.deepEqual(
      Object.keys(snapshotTree(workspace)).sort(),
      [
        ".agent-context/PROJECT_CONTEXT_INDEX.md",
        ".agent-context/PROJECT_PROFILE.md",
        ".agent-context/config.yml",
        "AGENTS.md",
      ],
      "stale-plan rejection wrote unrelated workspace files",
    );
    rmSync(staleTarget, { force: true });
    assert.deepEqual(snapshotTree(workspace), beforeDryRun);

    const refreshedDryRun = runDryRun(workspace);
    assertCommandSucceeded(refreshedDryRun, "refreshed installer dry-run");
    const refreshedPlanHash = extractPlanHash(refreshedDryRun.stdout);
    assert.equal(refreshedPlanHash, firstPlanHash, "restored workspace produced a different plan");

    const firstApply = runApply(workspace, refreshedPlanHash);
    assertCommandSucceeded(firstApply, "installer apply");
    assert.equal(readFileSync(existingProfile, "utf8"), profileSentinel);
    assert.equal(readFileSync(existingInstructions, "utf8"), instructionsSentinel);
    assertTemplateInventoryInstalled(repositoryRoot, workspace, new Set(["PROJECT_PROFILE.md"]));

    const afterFirstApply = snapshotTree(workspace);
    const secondDryRun = runDryRun(workspace);
    assertCommandSucceeded(secondDryRun, "second installer dry-run");
    assert.deepEqual(snapshotTree(workspace), afterFirstApply, "second dry-run wrote files");

    const secondPlanHash = extractPlanHash(secondDryRun.stdout);
    const secondApply = runApply(workspace, secondPlanHash);
    assertCommandSucceeded(secondApply, "second installer apply");
    assert.deepEqual(
      snapshotTree(workspace),
      afterFirstApply,
      "reapplying the installer changed an initialized workspace",
    );
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
}

export function assertLegacyWorkspaceIsReadOnly({ runDryRun, runApply }) {
  for (const scenario of [
    {
      name: "unversioned config",
      expectedAction: "MigrationRequired",
      expectedReason: /legacy-v0|legacy[^\r\n]*read-only/iu,
      arrange(contextRoot) {
        writeFileSync(join(contextRoot, "config.yml"), "context_write_policy: propose\n", "utf8");
      },
    },
    {
      name: "non-empty context without config",
      expectedAction: "MigrationRequired",
      expectedReason: /legacy-v0|legacy[^\r\n]*read-only/iu,
      arrange(contextRoot) {
        writeFileSync(join(contextRoot, "PROJECT_PROFILE.md"), "# Legacy profile\n", "utf8");
      },
    },
    {
      name: "newer schema config",
      expectedAction: "UpgradeRequired",
      expectedReason: /newer|unsupported|upgrade/iu,
      arrange(contextRoot) {
        writeFileSync(join(contextRoot, "config.yml"), "schema_version: 2\n", "utf8");
      },
    },
  ]) {
    const workspace = mkdtempSync(join(tmpdir(), "agent-context-patch-legacy-"));
    try {
      const contextRoot = join(workspace, ".agent-context");
      mkdirSync(contextRoot, { recursive: true });
      scenario.arrange(contextRoot);
      const before = snapshotTree(workspace);

      const dryRun = runDryRun(workspace);
      assertCommandFailed(dryRun, `${scenario.name} dry-run`);
      assert.match(dryRun.stdout, new RegExp(scenario.expectedAction, "iu"));
      assert.match(dryRun.stdout, scenario.expectedReason);
      assert.deepEqual(snapshotTree(workspace), before, `${scenario.name} dry-run wrote files`);

      const apply = runApply(workspace, extractPlanHash(dryRun.stdout));
      assertCommandFailed(apply, `${scenario.name} apply`);
      assert.deepEqual(snapshotTree(workspace), before, `${scenario.name} apply wrote files`);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  }
}

export function assertV1ConfigBootstrapContract({ repositoryRoot, runDryRun, runApply }) {
  const templateConfig = readFileSync(
    join(repositoryRoot, "templates", ".agent-context", "config.yml"),
    "utf8",
  );
  const invalidScenarios = [
    {
      name: "incomplete v1 config",
      config: "schema_version: 1\ncontext_write_policy: propose\nenabled_domains: []\n",
    },
    {
      name: "unsafe privacy config",
      config: templateConfig.replace("raw_conversation_stored: false", "raw_conversation_stored: true"),
    },
    {
      name: "unknown top-level config key",
      config: `${templateConfig}unexpected_setting: true\n`,
    },
    {
      name: "duplicate config key",
      config: templateConfig.replace(
        "context_write_policy: propose",
        "context_write_policy: propose\ncontext_write_policy: auto",
      ),
    },
    {
      name: "dangerous config key",
      config: `${templateConfig}__proto__: unsafe\n`,
    },
    {
      name: "duplicate inline domain",
      config: templateConfig.replace("enabled_domains: []", "enabled_domains: [coding, 'coding']"),
    },
  ];

  for (const scenario of invalidScenarios) {
    const workspace = mkdtempSync(join(tmpdir(), "agent-context-patch-v1-config-invalid-"));
    try {
      const contextRoot = join(workspace, ".agent-context");
      const configPath = join(contextRoot, "config.yml");
      mkdirSync(contextRoot);
      writeFileSync(configPath, scenario.config, "utf8");
      const before = snapshotTree(workspace);

      const dryRun = runDryRun(workspace);
      assertCommandFailed(dryRun, `${scenario.name} dry-run`);
      assert.match(
        dryRun.stdout,
        /(?:InvalidConfig|Conflict)[^\r\n]*config\.yml/iu,
        `${scenario.name} did not produce a clear invalid-config plan action`,
      );
      assert.deepEqual(snapshotTree(workspace), before, `${scenario.name} dry-run wrote files`);

      const apply = runApply(workspace, extractPlanHash(dryRun.stdout));
      assertCommandFailed(apply, `${scenario.name} apply`);
      assert.deepEqual(snapshotTree(workspace), before, `${scenario.name} apply wrote files`);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  }

  const workspace = mkdtempSync(join(tmpdir(), "agent-context-patch-v1-config-valid-"));
  try {
    const contextRoot = join(workspace, ".agent-context");
    const configPath = join(contextRoot, "config.yml");
    const validQuotedInlineConfig = [
      "schema_version: 1",
      "created_with_kit_version: '0.2.0'",
      'last_migrated_with_kit_version: "0.2.0" # current migration writer',
      'context_write_policy: "propose"',
      'enabled_domains: ["coding", \'prd\']',
      "budgets:",
      "  active_context:",
      '    unit: "lines"',
      "    warn: 500",
      "    block_auto: 800",
      "  single_proposal:",
      "    unit: 'lines'",
      "    warn: 220",
      "  pending_proposals:",
      "    unit: count",
      "    warn: 8",
      "    block_auto: 12",
      "privacy:",
      "  raw_conversation_stored: false",
      "  full_logs_stored: false",
      "  secrets_stored: false",
      "  customer_data_stored: false",
      "  absolute_user_paths_stored: false",
      "",
    ].join("\n");
    mkdirSync(contextRoot);
    writeFileSync(configPath, validQuotedInlineConfig, "utf8");
    const before = snapshotTree(workspace);

    const dryRun = runDryRun(workspace);
    assertCommandSucceeded(dryRun, "valid quoted/inline v1 config dry-run");
    assert.deepEqual(snapshotTree(workspace), before, "valid v1 config dry-run wrote files");

    const apply = runApply(workspace, extractPlanHash(dryRun.stdout));
    assertCommandSucceeded(apply, "valid quoted/inline v1 config apply");
    assert.equal(
      readFileSync(configPath, "utf8"),
      validQuotedInlineConfig,
      "valid custom v1 config was overwritten",
    );
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
}

export function assertSkillAndGuidanceContract({ repositoryRoot, runDryRun, runApply }) {
  const sandbox = mkdtempSync(join(tmpdir(), "agent-context-patch-skill-install-"));
  const workspace = join(sandbox, "workspace");
  const skillTarget = join(sandbox, "user-skills", "evolve");
  const instructionTarget = join(workspace, "AGENTS.md");
  const instructionSentinel = "# Existing instructions\n\nAgent-owned semantic merge only.\n";
  const sourceSkill = join(repositoryRoot, "skills", "evolve");

  try {
    mkdirSync(workspace, { recursive: true });
    writeFileSync(instructionTarget, instructionSentinel, "utf8");
    const options = { workspace, skillTarget, instructionTarget };

    const initialDryRun = runDryRun(options);
    assertCommandSucceeded(initialDryRun, "skill install dry-run");
    assert.match(initialDryRun.stdout, /Create[^\r\n]*manifest\.json/iu);
    assert.match(initialDryRun.stdout, /GuidancePatchRequired[^\r\n]*AGENTS\.md/iu);
    assert.equal(readFileSync(instructionTarget, "utf8"), instructionSentinel);

    const initialApply = runApply(options, extractPlanHash(initialDryRun.stdout));
    assertCommandSucceeded(initialApply, "skill install apply");
    assertTreesEqual(sourceSkill, skillTarget, "installed skill differs from source");
    assert.equal(readFileSync(instructionTarget, "utf8"), instructionSentinel);

    const identicalBefore = snapshotTree(skillTarget);
    const identicalDryRun = runDryRun(options);
    assertCommandSucceeded(identicalDryRun, "identical skill dry-run");
    assert.match(identicalDryRun.stdout, /Skip[^\r\n]*manifest\.json/iu);
    const identicalApply = runApply(options, extractPlanHash(identicalDryRun.stdout));
    assertCommandSucceeded(identicalApply, "identical skill apply");
    assert.deepEqual(snapshotTree(skillTarget), identicalBefore, "identical skill install wrote files");
    assert.equal(readFileSync(instructionTarget, "utf8"), instructionSentinel);

    const driftedSkill = join(skillTarget, "SKILL.md");
    writeFileSync(driftedSkill, `${readFileSync(driftedSkill, "utf8")}\nlocal drift\n`, "utf8");
    const driftedBefore = snapshotTree(skillTarget);
    const driftDryRun = runDryRun(options);
    assertCommandFailed(driftDryRun, "same-version drift dry-run");
    assert.match(driftDryRun.stdout, /Conflict[^\r\n]*SKILL\.md/iu);
    const driftApply = runApply(options, extractPlanHash(driftDryRun.stdout));
    assertCommandFailed(driftApply, "same-version drift apply");
    assert.deepEqual(snapshotTree(skillTarget), driftedBefore, "skill drift was overwritten");
    assert.equal(readFileSync(instructionTarget, "utf8"), instructionSentinel);

    rmSync(skillTarget, { recursive: true, force: true });
    cpSync(sourceSkill, skillTarget, { recursive: true });
    const targetManifest = join(skillTarget, "manifest.json");
    const manifest = JSON.parse(readFileSync(targetManifest, "utf8"));
    manifest.version = "0.1.0";
    writeFileSync(targetManifest, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    const oldVersionBefore = snapshotTree(skillTarget);

    const upgradeDryRun = runDryRun(options);
    assertCommandFailed(upgradeDryRun, "old skill version dry-run");
    assert.match(upgradeDryRun.stdout, /UpgradeRequired[^\r\n]*manifest\.json/iu);
    const upgradeApply = runApply(options, extractPlanHash(upgradeDryRun.stdout));
    assertCommandFailed(upgradeApply, "old skill version apply");
    assert.deepEqual(snapshotTree(skillTarget), oldVersionBefore, "old skill version was overwritten");
    assert.equal(readFileSync(instructionTarget, "utf8"), instructionSentinel);
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
}

export function assertBootstrapRejectsDirectoryRedirects({
  repositoryRoot,
  runDryRun,
  runApply,
}) {
  for (const scenario of [
    {
      name: "workspace context root redirect",
      arrange({ workspace, outside }) {
        createDirectoryLink(outside, join(workspace, ".agent-context"));
        return { workspace };
      },
    },
    {
      name: "workspace context child redirect",
      arrange({ workspace, outside }) {
        const contextRoot = join(workspace, ".agent-context");
        mkdirSync(contextRoot);
        writeFileSync(
          join(contextRoot, "config.yml"),
          readFileSync(join(repositoryRoot, "templates", ".agent-context", "config.yml")),
        );
        createDirectoryLink(outside, join(contextRoot, "checklists"));
        return { workspace };
      },
    },
    {
      name: "skill child redirect",
      arrange({ workspace, outside, root }) {
        const skillTarget = join(root, "user-skills", "evolve");
        mkdirSync(skillTarget, { recursive: true });
        writeFileSync(
          join(skillTarget, "manifest.json"),
          readFileSync(join(repositoryRoot, "skills", "evolve", "manifest.json")),
        );
        createDirectoryLink(outside, join(skillTarget, "references"));
        return { workspace, skillTarget };
      },
    },
  ]) {
    const root = mkdtempSync(join(tmpdir(), "agent-context-patch-redirect-"));
    const workspace = join(root, "workspace");
    const outside = join(root, "outside");
    try {
      mkdirSync(workspace);
      mkdirSync(outside);
      const options = scenario.arrange({ root, workspace, outside });
      const outsideBefore = snapshotTree(outside);

      const dryRun = runDryRun(options);
      assertCommandFailed(dryRun, `${scenario.name} dry-run`);
      assert.match(dryRun.stdout, /Conflict/iu);
      assert.match(dryRun.stdout, /link|junction|reparse|redirect/iu);
      assert.deepEqual(snapshotTree(outside), outsideBefore, `${scenario.name} dry-run escaped`);

      const apply = runApply(options, extractPlanHash(dryRun.stdout));
      assertCommandFailed(apply, `${scenario.name} apply`);
      assert.deepEqual(snapshotTree(outside), outsideBefore, `${scenario.name} apply escaped`);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
}

export function supportsDirectoryLinks() {
  const root = mkdtempSync(join(tmpdir(), "agent-context-patch-link-check-"));
  try {
    const target = join(root, "target");
    const link = join(root, "link");
    mkdirSync(target);
    createDirectoryLink(target, link);
    return lstatSync(link).isSymbolicLink();
  } catch (error) {
    if (["EACCES", "EPERM", "UNKNOWN"].includes(error?.code)) return false;
    throw error;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

export function commandAvailable(command, args = ["--version"]) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    shell: process.platform === "win32" && /\.(?:bat|cmd)$/iu.test(command),
    timeout: 10_000,
  });
  return !result.error && result.status === 0;
}

export function run(command, args, options = {}) {
  return spawnSync(command, args, {
    encoding: "utf8",
    timeout: 30_000,
    ...options,
  });
}

function assertCommandSucceeded(result, label) {
  assert.ifError(result.error);
  assert.equal(
    result.status,
    0,
    [
      `${label} exited with ${result.status}.`,
      "stdout:",
      result.stdout ?? "",
      "stderr:",
      result.stderr ?? "",
    ].join("\n"),
  );
}

function assertCommandFailed(result, label) {
  assert.ifError(result.error);
  assert.notEqual(
    result.status,
    0,
    `${label} unexpectedly succeeded:\n${result.stdout ?? ""}\n${result.stderr ?? ""}`,
  );
}

function assertTemplateInventoryInstalled(repositoryRoot, workspace, preserved) {
  const templateRoot = join(repositoryRoot, "templates", ".agent-context");
  for (const templateFile of listFiles(templateRoot)) {
    const relativePath = relative(templateRoot, templateFile);
    const installedPath = join(workspace, ".agent-context", relativePath);
    assert.ok(existsSync(installedPath), `installer omitted ${relativePath}`);
    if (!preserved.has(relativePath.replaceAll("\\", "/"))) {
      assert.deepEqual(
        readFileSync(installedPath),
        readFileSync(templateFile),
        `installed content differs from template: ${relativePath}`,
      );
    }
  }
}

function assertTreesEqual(expectedRoot, actualRoot, message) {
  assert.ok(existsSync(actualRoot), `${message}: target directory is missing`);
  assert.deepEqual(snapshotTree(actualRoot), snapshotTree(expectedRoot), message);
}

export function extractPlanHash(output) {
  const match = output.match(/plan(?:\s+|_)hash\s*:\s*([a-f0-9]{64})/iu);
  assert.ok(match, `dry-run did not emit a 64-character Plan hash:\n${output}`);
  return match[1].toLowerCase();
}

function listFiles(root) {
  const files = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...listFiles(path));
    } else if (entry.isFile()) {
      files.push(path);
    }
  }
  return files;
}

function snapshotTree(root) {
  const snapshot = {};
  for (const path of listFiles(root)) {
    snapshot[relative(root, path).replaceAll("\\", "/")] = readFileSync(path).toString("base64");
  }
  return snapshot;
}

function createDirectoryLink(target, link) {
  symlinkSync(target, link, process.platform === "win32" ? "junction" : "dir");
}
