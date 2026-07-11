import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  assertSkillUpgradeHappyPath,
  assertSkillUpgradePreservesUnexpectedTarget,
  assertSkillUpgradeReportsRollbackFailure,
  assertSkillUpgradeRollback,
  assertSkillUpdateBlocksSameVersionDrift,
  assertSkillUpdateBlocksUnsafeBackupRoot,
  assertSkillUpdateEnforcesManifestContract,
  assertSkillUpdateRejectsDowngrade,
  assertSkillUpdateRejectsMalformedManifest,
  assertSkillUpdateRejectsStaleApproval,
  assertSkillUpdateRejectsStaleEmptyDirectory,
  assertSkillUpdateUsesCaseSensitiveSemver,
} from "./installer-upgrade-helpers.mjs";
import { commandAvailable, run } from "./installer-helpers.mjs";

const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));
const bashAvailable = commandAvailable("bash");
const skip =
  process.platform === "win32" || !bashAvailable
    ? "Bash upgrade behavior runs on the Ubuntu CI job"
    : false;

test(
  "Bash upgrades one approved local skill release without touching the workspace",
  { skip },
  () => {
    assertSkillUpgradeHappyPath({
      repositoryRoot,
      runDryRun(sandbox) {
        return invoke(sandbox, "update-dry-run");
      },
      runApply(sandbox, planHash, environment) {
        return invoke(sandbox, "update-apply", planHash, environment);
      },
    });
  },
);

test("Bash refuses to replace an installed skill with an older release", { skip }, () => {
  assertSkillUpdateRejectsDowngrade({
    repositoryRoot,
    runDryRun(sandbox) {
      return invoke(sandbox, "update-dry-run");
    },
  });
});

test("Bash invalidates approval when the installed skill changes", { skip }, () => {
  assertSkillUpdateRejectsStaleApproval({
    repositoryRoot,
    runDryRun(sandbox) {
      return invoke(sandbox, "update-dry-run");
    },
    runApply(sandbox, planHash) {
      return invoke(sandbox, "update-apply", planHash);
    },
  });
});

test("Bash blocks local drift at the installed version", { skip }, () => {
  assertSkillUpdateBlocksSameVersionDrift({
    repositoryRoot,
    runDryRun(sandbox) {
      return invoke(sandbox, "update-dry-run");
    },
  });
});

test("Bash refuses a symlink backup root", { skip }, () => {
  assertSkillUpdateBlocksUnsafeBackupRoot({
    repositoryRoot,
    runDryRun(sandbox) {
      return invoke(sandbox, "update-dry-run");
    },
  });
});

test("Bash compares semantic-version identifiers case-sensitively", { skip }, () => {
  assertSkillUpdateUsesCaseSensitiveSemver({
    repositoryRoot,
    runDryRun(sandbox) {
      return invoke(sandbox, "update-dry-run");
    },
  });
});

test("Bash rejects malformed skill manifests", { skip }, () => {
  assertSkillUpdateRejectsMalformedManifest({
    repositoryRoot,
    runDryRun(sandbox) {
      return invoke(sandbox, "update-dry-run");
    },
  });
});

test("Bash enforces the exact update manifest version contract", { skip }, () => {
  assertSkillUpdateEnforcesManifestContract({
    repositoryRoot,
    runDryRun(sandbox) {
      return invoke(sandbox, "update-dry-run");
    },
  });
});

test("Bash invalidates approval when an empty skill directory appears", { skip }, () => {
  assertSkillUpdateRejectsStaleEmptyDirectory({
    repositoryRoot,
    runDryRun(sandbox) {
      return invoke(sandbox, "update-dry-run");
    },
    runApply(sandbox, planHash) {
      return invoke(sandbox, "update-apply", planHash);
    },
  });
});

test("Bash restores the prior skill when activation fails after backup", { skip }, () => {
  assertSkillUpgradeRollback({
    repositoryRoot,
    runDryRun(sandbox) {
      return invoke(sandbox, "update-dry-run");
    },
    runApply(sandbox, planHash, environment) {
      return invoke(sandbox, "update-apply", planHash, environment);
    },
  });
});

test("Bash preserves and reports the recovery copy when automatic restore fails", { skip }, () => {
  assertSkillUpgradeReportsRollbackFailure({
    repositoryRoot,
    runDryRun(sandbox) {
      return invoke(sandbox, "update-dry-run");
    },
    runApply(sandbox, planHash, environment) {
      return invoke(sandbox, "update-apply", planHash, environment);
    },
  });
});

test("Bash preserves an unexpected target that appears before activation", { skip }, () => {
  assertSkillUpgradePreservesUnexpectedTarget({
    repositoryRoot,
    runDryRun(sandbox) {
      return invoke(sandbox, "update-dry-run");
    },
    runApply(sandbox, planHash, environment) {
      return invoke(sandbox, "update-apply", planHash, environment);
    },
  });
});

function invoke(sandbox, mode, planHash, environment = {}) {
  const arguments_ = [
    sandbox.installer.replace(/install\.ps1$/u, "install.sh"),
    "--mode",
    mode,
    "--workspace",
    sandbox.workspace,
    "--skill-target",
    sandbox.skillTarget,
  ];
  if (planHash) arguments_.push("--approved-plan-hash", planHash);
  return run("bash", arguments_, {
    cwd: repositoryRoot,
    env: { ...process.env, ...environment },
  });
}
