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
const powershell = findPowerShell();

test(
  "PowerShell upgrades one approved local skill release without touching the workspace",
  { skip: powershell === undefined ? "PowerShell is not available on this platform" : false },
  () => {
    assertSkillUpgradeHappyPath({
      repositoryRoot,
      runDryRun(sandbox) {
        return invoke(sandbox.installer, [
          "-Mode",
          "UpdateDryRun",
          "-WorkspacePath",
          sandbox.workspace,
          "-SkillTargetPath",
          sandbox.skillTarget,
        ]);
      },
      runApply(sandbox, planHash) {
        return invoke(sandbox.installer, [
          "-Mode",
          "UpdateApply",
          "-WorkspacePath",
          sandbox.workspace,
          "-SkillTargetPath",
          sandbox.skillTarget,
          "-ApprovedPlanHash",
          planHash,
        ]);
      },
    });
  },
);

test(
  "PowerShell refuses to replace an installed skill with an older release",
  { skip: powershell === undefined ? "PowerShell is not available on this platform" : false },
  () => {
    assertSkillUpdateRejectsDowngrade({
      repositoryRoot,
      runDryRun(sandbox) {
        return invoke(sandbox.installer, [
          "-Mode",
          "UpdateDryRun",
          "-WorkspacePath",
          sandbox.workspace,
          "-SkillTargetPath",
          sandbox.skillTarget,
        ]);
      },
    });
  },
);

test(
  "PowerShell invalidates approval when the installed skill changes",
  { skip: powershell === undefined ? "PowerShell is not available on this platform" : false },
  () => {
    assertSkillUpdateRejectsStaleApproval({
      repositoryRoot,
      runDryRun(sandbox) {
        return invoke(sandbox.installer, [
          "-Mode",
          "UpdateDryRun",
          "-WorkspacePath",
          sandbox.workspace,
          "-SkillTargetPath",
          sandbox.skillTarget,
        ]);
      },
      runApply(sandbox, planHash) {
        return invoke(sandbox.installer, [
          "-Mode",
          "UpdateApply",
          "-WorkspacePath",
          sandbox.workspace,
          "-SkillTargetPath",
          sandbox.skillTarget,
          "-ApprovedPlanHash",
          planHash,
        ]);
      },
    });
  },
);

test(
  "PowerShell blocks local drift at the installed version",
  { skip: powershell === undefined ? "PowerShell is not available on this platform" : false },
  () => {
    assertSkillUpdateBlocksSameVersionDrift({
      repositoryRoot,
      runDryRun(sandbox) {
        return invoke(sandbox.installer, [
          "-Mode",
          "UpdateDryRun",
          "-WorkspacePath",
          sandbox.workspace,
          "-SkillTargetPath",
          sandbox.skillTarget,
        ]);
      },
    });
  },
);

test(
  "PowerShell refuses a reparse-point backup root",
  { skip: powershell === undefined ? "PowerShell is not available on this platform" : false },
  () => {
    assertSkillUpdateBlocksUnsafeBackupRoot({
      repositoryRoot,
      runDryRun(sandbox) {
        return invoke(sandbox.installer, [
          "-Mode",
          "UpdateDryRun",
          "-WorkspacePath",
          sandbox.workspace,
          "-SkillTargetPath",
          sandbox.skillTarget,
        ]);
      },
    });
  },
);

test(
  "PowerShell compares semantic-version identifiers case-sensitively",
  { skip: powershell === undefined ? "PowerShell is not available on this platform" : false },
  () => {
    assertSkillUpdateUsesCaseSensitiveSemver({
      repositoryRoot,
      runDryRun(sandbox) {
        return invoke(sandbox.installer, [
          "-Mode",
          "UpdateDryRun",
          "-WorkspacePath",
          sandbox.workspace,
          "-SkillTargetPath",
          sandbox.skillTarget,
        ]);
      },
    });
  },
);

test(
  "PowerShell rejects malformed skill manifests",
  { skip: powershell === undefined ? "PowerShell is not available on this platform" : false },
  () => {
    assertSkillUpdateRejectsMalformedManifest({
      repositoryRoot,
      runDryRun(sandbox) {
        return invoke(sandbox.installer, [
          "-Mode",
          "UpdateDryRun",
          "-WorkspacePath",
          sandbox.workspace,
          "-SkillTargetPath",
          sandbox.skillTarget,
        ]);
      },
    });
  },
);

test(
  "PowerShell enforces the exact update manifest version contract",
  { skip: powershell === undefined ? "PowerShell is not available on this platform" : false },
  () => {
    assertSkillUpdateEnforcesManifestContract({
      repositoryRoot,
      runDryRun(sandbox) {
        return invoke(sandbox.installer, [
          "-Mode",
          "UpdateDryRun",
          "-WorkspacePath",
          sandbox.workspace,
          "-SkillTargetPath",
          sandbox.skillTarget,
        ]);
      },
    });
  },
);

test(
  "PowerShell invalidates approval when an empty skill directory appears",
  { skip: powershell === undefined ? "PowerShell is not available on this platform" : false },
  () => {
    assertSkillUpdateRejectsStaleEmptyDirectory({
      repositoryRoot,
      runDryRun(sandbox) {
        return invoke(sandbox.installer, [
          "-Mode",
          "UpdateDryRun",
          "-WorkspacePath",
          sandbox.workspace,
          "-SkillTargetPath",
          sandbox.skillTarget,
        ]);
      },
      runApply(sandbox, planHash) {
        return invoke(sandbox.installer, [
          "-Mode",
          "UpdateApply",
          "-WorkspacePath",
          sandbox.workspace,
          "-SkillTargetPath",
          sandbox.skillTarget,
          "-ApprovedPlanHash",
          planHash,
        ]);
      },
    });
  },
);

test(
  "PowerShell restores the prior skill when activation fails after backup",
  { skip: powershell === undefined ? "PowerShell is not available on this platform" : false },
  () => {
    assertSkillUpgradeRollback({
      repositoryRoot,
      runDryRun(sandbox) {
        return invoke(sandbox.installer, [
          "-Mode",
          "UpdateDryRun",
          "-WorkspacePath",
          sandbox.workspace,
          "-SkillTargetPath",
          sandbox.skillTarget,
        ]);
      },
      runApply(sandbox, planHash, environment) {
        return invoke(
          sandbox.installer,
          [
            "-Mode",
            "UpdateApply",
            "-WorkspacePath",
            sandbox.workspace,
            "-SkillTargetPath",
            sandbox.skillTarget,
            "-ApprovedPlanHash",
            planHash,
          ],
          environment,
        );
      },
    });
  },
);

test(
  "PowerShell preserves and reports the recovery copy when automatic restore fails",
  { skip: powershell === undefined ? "PowerShell is not available on this platform" : false },
  () => {
    assertSkillUpgradeReportsRollbackFailure({
      repositoryRoot,
      runDryRun(sandbox) {
        return invoke(sandbox.installer, [
          "-Mode",
          "UpdateDryRun",
          "-WorkspacePath",
          sandbox.workspace,
          "-SkillTargetPath",
          sandbox.skillTarget,
        ]);
      },
      runApply(sandbox, planHash, environment) {
        return invoke(
          sandbox.installer,
          [
            "-Mode",
            "UpdateApply",
            "-WorkspacePath",
            sandbox.workspace,
            "-SkillTargetPath",
            sandbox.skillTarget,
            "-ApprovedPlanHash",
            planHash,
          ],
          environment,
        );
      },
    });
  },
);

test(
  "PowerShell preserves an unexpected target that appears before activation",
  { skip: powershell === undefined ? "PowerShell is not available on this platform" : false },
  () => {
    assertSkillUpgradePreservesUnexpectedTarget({
      repositoryRoot,
      runDryRun(sandbox) {
        return invoke(sandbox.installer, [
          "-Mode",
          "UpdateDryRun",
          "-WorkspacePath",
          sandbox.workspace,
          "-SkillTargetPath",
          sandbox.skillTarget,
        ]);
      },
      runApply(sandbox, planHash, environment) {
        return invoke(
          sandbox.installer,
          [
            "-Mode",
            "UpdateApply",
            "-WorkspacePath",
            sandbox.workspace,
            "-SkillTargetPath",
            sandbox.skillTarget,
            "-ApprovedPlanHash",
            planHash,
          ],
          environment,
        );
      },
    });
  },
);

function invoke(installer, arguments_, environment = {}) {
  return run(
    powershell,
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", installer, ...arguments_],
    { cwd: repositoryRoot, env: { ...process.env, ...environment } },
  );
}

function findPowerShell() {
  for (const candidate of process.platform === "win32"
    ? ["powershell.exe", "pwsh.exe"]
    : ["pwsh"]) {
    if (
      commandAvailable(candidate, [
        "-NoProfile",
        "-Command",
        "$PSVersionTable.PSVersion.ToString()",
      ])
    ) {
      return candidate;
    }
  }
  return undefined;
}
