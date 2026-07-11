import assert from "node:assert/strict";
import {
  appendFileSync,
  cpSync,
  existsSync,
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

import { extractPlanHash } from "./installer-helpers.mjs";

export function assertSkillUpgradeHappyPath({ repositoryRoot, runDryRun, runApply }) {
  const sandbox = createUpgradeSandbox(repositoryRoot);

  try {
    const targetBefore = snapshotTree(sandbox.skillTarget);
    const workspaceBefore = snapshotTree(sandbox.workspace);

    const dryRun = runDryRun(sandbox);
    assertCommandSucceeded(dryRun, "skill update dry-run");
    assert.match(dryRun.stdout, /UpgradeSkill/iu);
    assert.match(dryRun.stdout, /installed=0\.2\.0;source=0\.3\.0/iu);
    assert.match(dryRun.stdout, /Backup path:\s*.+/iu);
    assert.deepEqual(snapshotTree(sandbox.skillTarget), targetBefore, "dry-run wrote skill files");
    assert.deepEqual(snapshotTree(sandbox.workspace), workspaceBefore, "dry-run wrote workspace files");

    const apply = runApply(sandbox, extractPlanHash(dryRun.stdout));
    assertCommandSucceeded(apply, "skill update apply");
    assert.match(apply.stdout, /Update receipt:/iu);
    assert.match(apply.stdout, /Installed version:\s*0\.3\.0/iu);
    assert.match(apply.stdout, /Previous version:\s*0\.2\.0/iu);
    assert.match(apply.stdout, /Restart required:\s*true/iu);
    assertTreesEqual(sandbox.skillSource, sandbox.skillTarget, "updated skill differs from source");
    assertTreesEqual(sandbox.skillTargetBefore, sandbox.backupPath, "upgrade backup is incomplete");
    assert.deepEqual(snapshotTree(sandbox.workspace), workspaceBefore, "upgrade wrote workspace files");

    const secondDryRun = runDryRun(sandbox);
    assertCommandSucceeded(secondDryRun, "current skill update dry-run");
    assert.match(secondDryRun.stdout, /NoUpdate/iu);
    assert.doesNotMatch(secondDryRun.stdout, /UpgradeSkill/iu);
    assert.deepEqual(snapshotTree(sandbox.skillTarget), snapshotTree(sandbox.skillSource));
  } finally {
    rmSync(sandbox.root, { recursive: true, force: true });
  }
}

export function assertSkillUpgradeRollback({ repositoryRoot, runDryRun, runApply }) {
  const sandbox = createUpgradeSandbox(repositoryRoot);

  try {
    const targetBefore = snapshotTree(sandbox.skillTarget);
    const workspaceBefore = snapshotTree(sandbox.workspace);
    const dryRun = runDryRun(sandbox);
    assertCommandSucceeded(dryRun, "rollback update dry-run");
    const planHash = extractPlanHash(dryRun.stdout);

    const apply = runApply(sandbox, planHash, {
      ACP_BOOTSTRAP_TEST_FAULT: "after-skill-backup",
    });
    assertCommandFailed(apply, "fault-injected skill update");
    assert.match(`${apply.stdout}\n${apply.stderr}`, /previous installation was restored/iu);
    assert.deepEqual(snapshotTree(sandbox.skillTarget), targetBefore, "rollback changed the skill");
    assert.deepEqual(snapshotTree(sandbox.workspace), workspaceBefore, "rollback changed workspace");
    assert.equal(existsSync(sandbox.backupPath), false, "rollback left the old skill stranded");
    assert.equal(
      readdirSync(join(sandbox.root, "user-skills")).some((entry) =>
        entry.startsWith(".agent-context-patch-stage-"),
      ),
      false,
      "rollback left a staging tree",
    );

    const retry = runDryRun(sandbox);
    assertCommandSucceeded(retry, "post-rollback update dry-run");
    assert.equal(extractPlanHash(retry.stdout), planHash, "rollback changed the approved plan inputs");
  } finally {
    rmSync(sandbox.root, { recursive: true, force: true });
  }
}

export function assertSkillUpgradeReportsRollbackFailure({ repositoryRoot, runDryRun, runApply }) {
  const sandbox = createUpgradeSandbox(repositoryRoot);

  try {
    const workspaceBefore = snapshotTree(sandbox.workspace);
    const dryRun = runDryRun(sandbox);
    assertCommandSucceeded(dryRun, "rollback-failure update dry-run");

    const apply = runApply(sandbox, extractPlanHash(dryRun.stdout), {
      ACP_BOOTSTRAP_TEST_FAULT: "during-skill-restore",
    });
    assertCommandFailed(apply, "rollback-failure skill update");
    assert.match(`${apply.stdout}\n${apply.stderr}`, /automatic restore also failed/iu);
    assert.match(`${apply.stdout}\n${apply.stderr}`, /Recovery copy:/iu);
    assert.equal(existsSync(sandbox.skillTarget), false, "failed rollback claimed a live target");
    assertTreesEqual(sandbox.skillTargetBefore, sandbox.backupPath, "recovery copy is incomplete");
    assert.deepEqual(snapshotTree(sandbox.workspace), workspaceBefore, "failed rollback changed workspace");
  } finally {
    rmSync(sandbox.root, { recursive: true, force: true });
  }
}

export function assertSkillUpdateRejectsDowngrade({ repositoryRoot, runDryRun }) {
  const sandbox = createUpgradeSandbox(repositoryRoot);

  try {
    const manifestPath = join(sandbox.skillSource, "manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    manifest.version = "0.1.0";
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    const targetBefore = snapshotTree(sandbox.skillTarget);
    const workspaceBefore = snapshotTree(sandbox.workspace);

    const dryRun = runDryRun(sandbox);
    assertCommandFailed(dryRun, "skill downgrade dry-run");
    assert.match(dryRun.stdout, /DowngradeRequired/iu);
    assert.match(dryRun.stdout, /installed=0\.2\.0;source=0\.1\.0/iu);
    assert.deepEqual(snapshotTree(sandbox.skillTarget), targetBefore, "downgrade plan wrote skill");
    assert.deepEqual(snapshotTree(sandbox.workspace), workspaceBefore, "downgrade plan wrote workspace");
  } finally {
    rmSync(sandbox.root, { recursive: true, force: true });
  }
}

export function assertSkillUpdateRejectsStaleApproval({ repositoryRoot, runDryRun, runApply }) {
  const sandbox = createUpgradeSandbox(repositoryRoot);

  try {
    const workspaceBefore = snapshotTree(sandbox.workspace);
    const dryRun = runDryRun(sandbox);
    assertCommandSucceeded(dryRun, "stale approval update dry-run");
    const planHash = extractPlanHash(dryRun.stdout);
    appendFileSync(join(sandbox.skillTarget, "SKILL.md"), "\nlocal change after approval\n", "utf8");
    const changedTarget = snapshotTree(sandbox.skillTarget);

    const apply = runApply(sandbox, planHash);
    assertCommandFailed(apply, "stale approved skill update");
    assert.match(`${apply.stdout}\n${apply.stderr}`, /plan hash does not match/iu);
    assert.deepEqual(snapshotTree(sandbox.skillTarget), changedTarget, "stale apply changed skill");
    assert.deepEqual(snapshotTree(sandbox.workspace), workspaceBefore, "stale apply changed workspace");
    assert.equal(existsSync(sandbox.backupPath), false, "stale apply created a backup");
  } finally {
    rmSync(sandbox.root, { recursive: true, force: true });
  }
}

export function assertSkillUpdateBlocksSameVersionDrift({ repositoryRoot, runDryRun }) {
  const sandbox = createUpgradeSandbox(repositoryRoot);

  try {
    const targetManifestPath = join(sandbox.skillTarget, "manifest.json");
    const targetManifest = JSON.parse(readFileSync(targetManifestPath, "utf8"));
    targetManifest.version = "0.3.0";
    writeFileSync(targetManifestPath, `${JSON.stringify(targetManifest, null, 2)}\n`, "utf8");
    const targetBefore = snapshotTree(sandbox.skillTarget);

    const dryRun = runDryRun(sandbox);
    assertCommandFailed(dryRun, "same-version drift update dry-run");
    assert.match(dryRun.stdout, /Conflict/iu);
    assert.match(dryRun.stdout, /same-version-tree-differs/iu);
    assert.deepEqual(snapshotTree(sandbox.skillTarget), targetBefore, "drift check changed skill");
  } finally {
    rmSync(sandbox.root, { recursive: true, force: true });
  }
}

export function assertSkillUpdateBlocksUnsafeBackupRoot({ repositoryRoot, runDryRun }) {
  const sandbox = createUpgradeSandbox(repositoryRoot);

  try {
    const externalBackupRoot = join(sandbox.root, "external-backups");
    const backupRoot = join(sandbox.root, "user-skills", ".agent-context-patch-backups");
    mkdirSync(externalBackupRoot, { recursive: true });
    symlinkSync(externalBackupRoot, backupRoot, process.platform === "win32" ? "junction" : "dir");
    const targetBefore = snapshotTree(sandbox.skillTarget);
    const workspaceBefore = snapshotTree(sandbox.workspace);

    const dryRun = runDryRun(sandbox);
    assertCommandFailed(dryRun, "unsafe backup root update dry-run");
    assert.match(dryRun.stdout, /Conflict/iu);
    assert.match(dryRun.stdout, /backup-root-(?:reparse-point|symlink)-not-followed/iu);
    assert.deepEqual(snapshotTree(sandbox.skillTarget), targetBefore, "backup guard changed skill");
    assert.deepEqual(snapshotTree(sandbox.workspace), workspaceBefore, "backup guard changed workspace");
  } finally {
    rmSync(sandbox.root, { recursive: true, force: true });
  }
}

export function assertSkillUpdateUsesCaseSensitiveSemver({ repositoryRoot, runDryRun }) {
  const sandbox = createUpgradeSandbox(repositoryRoot);

  try {
    setManifestVersion(sandbox.skillSource, "0.3.0-alpha");
    setManifestVersion(sandbox.skillTarget, "0.3.0-ALPHA");

    const dryRun = runDryRun(sandbox);
    assertCommandSucceeded(dryRun, "case-sensitive SemVer update dry-run");
    assert.match(dryRun.stdout, /UpgradeSkill/iu);
    assert.match(dryRun.stdout, /installed=0\.3\.0-ALPHA;source=0\.3\.0-alpha/u);
  } finally {
    rmSync(sandbox.root, { recursive: true, force: true });
  }
}

export function assertSkillUpdateRejectsMalformedManifest({ repositoryRoot, runDryRun }) {
  const sandbox = createUpgradeSandbox(repositoryRoot);

  try {
    const manifestPath = join(sandbox.skillSource, "manifest.json");
    const validManifest = readFileSync(manifestPath, "utf8");
    writeFileSync(manifestPath, `not-json\n${validManifest}`, "utf8");

    const dryRun = runDryRun(sandbox);
    assertCommandFailed(dryRun, "malformed manifest update dry-run");
    assert.match(`${dryRun.stdout}\n${dryRun.stderr}`, /manifest is invalid JSON/iu);
  } finally {
    rmSync(sandbox.root, { recursive: true, force: true });
  }
}

export function assertSkillUpdateEnforcesManifestContract({ repositoryRoot, runDryRun }) {
  const invalidManifests = [
    '{"kit":"agent-context-patch","Version":"0.3.0","schemaVersion":1}\n',
    '{"kit":"agent-context-patch","version":"0.2.0","version":"0.3.0","schemaVersion":1}\n',
    '[{"version":"0.3.0"}]\n',
    '{"kit":"agent-context-patch","version":["0.3.0"],"schemaVersion":1}\n',
    '{"kit":"agent-context-patch","version":"0.3.0\\n","schemaVersion":1}\n',
    '{"kit":"agent-context-patch","version":"\\u0030.3.0","schemaVersion":1}\n',
  ];

  for (const source of invalidManifests) {
    const sandbox = createUpgradeSandbox(repositoryRoot);
    try {
      writeFileSync(join(sandbox.skillSource, "manifest.json"), source, "utf8");
      const dryRun = runDryRun(sandbox);
      assertCommandFailed(dryRun, `invalid manifest contract: ${source.trim()}`);
      assert.match(`${dryRun.stdout}\n${dryRun.stderr}`, /Skill manifest/iu);
    } finally {
      rmSync(sandbox.root, { recursive: true, force: true });
    }
  }
}

export function assertSkillUpdateRejectsStaleEmptyDirectory({
  repositoryRoot,
  runDryRun,
  runApply,
}) {
  const sandbox = createUpgradeSandbox(repositoryRoot);

  try {
    const workspaceBefore = snapshotTree(sandbox.workspace);
    const dryRun = runDryRun(sandbox);
    assertCommandSucceeded(dryRun, "empty-directory update dry-run");
    const planHash = extractPlanHash(dryRun.stdout);
    const addedDirectory = join(sandbox.skillTarget, "local-empty-after-approval");
    mkdirSync(addedDirectory);

    const apply = runApply(sandbox, planHash);
    assertCommandFailed(apply, "stale empty-directory skill update");
    assert.match(`${apply.stdout}\n${apply.stderr}`, /plan hash does not match/iu);
    assert.equal(existsSync(addedDirectory), true, "stale apply removed the local directory");
    assert.deepEqual(snapshotTree(sandbox.workspace), workspaceBefore, "stale apply changed workspace");
    assert.equal(existsSync(sandbox.backupPath), false, "stale apply created a backup");
  } finally {
    rmSync(sandbox.root, { recursive: true, force: true });
  }
}

export function assertSkillUpgradePreservesUnexpectedTarget({ repositoryRoot, runDryRun, runApply }) {
  const sandbox = createUpgradeSandbox(repositoryRoot);

  try {
    const workspaceBefore = snapshotTree(sandbox.workspace);
    const dryRun = runDryRun(sandbox);
    assertCommandSucceeded(dryRun, "unexpected-target update dry-run");

    const apply = runApply(sandbox, extractPlanHash(dryRun.stdout), {
      ACP_BOOTSTRAP_TEST_FAULT: "target-appeared-before-activation",
    });
    assertCommandFailed(apply, "unexpected-target skill update");
    assert.match(`${apply.stdout}\n${apply.stderr}`, /automatic restore also failed/iu);
    assert.match(`${apply.stdout}\n${apply.stderr}`, /unexpected skill target appeared/iu);
    assert.equal(
      readFileSync(join(sandbox.skillTarget, "foreign-target.txt"), "utf8"),
      "foreign target must survive\n",
    );
    assertTreesEqual(sandbox.skillTargetBefore, sandbox.backupPath, "recovery copy is incomplete");
    assert.deepEqual(snapshotTree(sandbox.workspace), workspaceBefore, "target conflict changed workspace");
  } finally {
    rmSync(sandbox.root, { recursive: true, force: true });
  }
}

function createUpgradeSandbox(repositoryRoot) {
  const root = mkdtempSync(join(tmpdir(), "agent-context-patch-skill-upgrade-"));
  const workspace = join(root, "workspace");
  const sourceRoot = join(root, "candidate");
  const skillSource = join(sourceRoot, "skills", "evolve");
  const skillTarget = join(root, "user-skills", "evolve");
  const skillTargetBefore = join(root, "expected-old-skill");
  const backupPath = join(
    root,
    "user-skills",
    ".agent-context-patch-backups",
    "evolve-0.2.0-before-0.3.0",
  );

  mkdirSync(workspace, { recursive: true });
  writeFileSync(join(workspace, "workspace-sentinel.txt"), "workspace must stay unchanged\n", "utf8");
  cpSync(join(repositoryRoot, "install"), join(sourceRoot, "install"), { recursive: true });
  cpSync(join(repositoryRoot, "templates"), join(sourceRoot, "templates"), { recursive: true });
  cpSync(join(repositoryRoot, "skills"), join(sourceRoot, "skills"), { recursive: true });
  cpSync(skillSource, skillTarget, { recursive: true });
  const targetManifestPath = join(skillTarget, "manifest.json");
  const targetManifest = JSON.parse(readFileSync(targetManifestPath, "utf8"));
  targetManifest.version = "0.2.0";
  writeFileSync(targetManifestPath, `${JSON.stringify(targetManifest, null, 2)}\n`, "utf8");
  writeFileSync(join(skillTarget, "removed-in-0.3.txt"), "old managed file\n", "utf8");
  cpSync(skillTarget, skillTargetBefore, { recursive: true });

  const sourceManifestPath = join(skillSource, "manifest.json");
  const sourceManifest = JSON.parse(readFileSync(sourceManifestPath, "utf8"));
  sourceManifest.version = "0.3.0";
  writeFileSync(sourceManifestPath, `${JSON.stringify(sourceManifest, null, 2)}\n`, "utf8");
  appendFileSync(join(skillSource, "SKILL.md"), "\n<!-- update contract candidate -->\n", "utf8");
  writeFileSync(join(skillSource, "added-in-0.3.txt"), "new managed file\n", "utf8");

  return {
    root,
    workspace,
    installer: join(sourceRoot, "install", "install.ps1"),
    skillSource,
    skillTarget,
    skillTargetBefore,
    backupPath,
  };
}

function setManifestVersion(skillRoot, version) {
  const manifestPath = join(skillRoot, "manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  manifest.version = version;
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

function assertCommandSucceeded(result, label) {
  assert.ifError(result.error);
  assert.equal(
    result.status,
    0,
    `${label} exited with ${result.status}.\nstdout:\n${result.stdout ?? ""}\nstderr:\n${result.stderr ?? ""}`,
  );
}

function assertCommandFailed(result, label) {
  assert.ifError(result.error);
  assert.notEqual(
    result.status,
    0,
    `${label} unexpectedly succeeded.\nstdout:\n${result.stdout ?? ""}\nstderr:\n${result.stderr ?? ""}`,
  );
}

function assertTreesEqual(expectedRoot, actualRoot, message) {
  assert.ok(existsSync(actualRoot), `${message}: target directory is missing`);
  assert.deepEqual(snapshotTree(actualRoot), snapshotTree(expectedRoot), message);
}

function snapshotTree(root) {
  const snapshot = {};
  for (const path of listFiles(root)) {
    snapshot[relative(root, path).replaceAll("\\", "/")] = readFileSync(path).toString("base64");
  }
  return snapshot;
}

function listFiles(root) {
  if (!existsSync(root)) return [];
  const files = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) files.push(...listFiles(path));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}
