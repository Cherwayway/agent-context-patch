import assert from "node:assert/strict";
import {
  appendFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  assertBootstrapRejectsDirectoryRedirects,
  assertInstallerContract,
  assertLegacyWorkspaceIsReadOnly,
  assertSkillAndGuidanceContract,
  commandAvailable,
  extractPlanHash,
  run,
  supportsDirectoryLinks,
} from "./installer-helpers.mjs";

const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));
const installer = join(repositoryRoot, "install", "install.ps1");
const powershell = findPowerShell();
const directoryLinksAvailable = supportsDirectoryLinks();

test(
  "PowerShell installer dry-runs and applies one approved idempotent plan",
  { skip: powershell === undefined ? "PowerShell is not available on this platform" : false },
  () => {
    assertInstallerContract({
      repositoryRoot,
      runDryRun(workspace) {
        return invoke(["-Mode", "DryRun", "-WorkspacePath", workspace]);
      },
      runApply(workspace, planHash) {
        return invoke([
          "-Mode",
          "Apply",
          "-WorkspacePath",
          workspace,
          "-ApprovedPlanHash",
          planHash,
        ]);
      },
    });
  },
);

test(
  "PowerShell keeps an unversioned legacy workspace read-only",
  { skip: powershell === undefined ? "PowerShell is not available on this platform" : false },
  () => {
    assertLegacyWorkspaceIsReadOnly({
      runDryRun(workspace) {
        return invoke(["-Mode", "DryRun", "-WorkspacePath", workspace]);
      },
      runApply(workspace, planHash) {
        return invoke([
          "-Mode",
          "Apply",
          "-WorkspacePath",
          workspace,
          "-ApprovedPlanHash",
          planHash,
        ]);
      },
    });
  },
);

test(
  "PowerShell installs only identical skill content and leaves instructions to the agent",
  { skip: powershell === undefined ? "PowerShell is not available on this platform" : false },
  () => {
    assertSkillAndGuidanceContract({
      repositoryRoot,
      runDryRun(options) {
        return invoke(skillArguments("DryRun", options));
      },
      runApply(options, planHash) {
        return invoke(skillArguments("Apply", options, planHash));
      },
    });
  },
);

test(
  "PowerShell rejects an approved plan when template source content changes",
  { skip: powershell === undefined ? "PowerShell is not available on this platform" : false },
  () => {
    const sandbox = createBootstrapSandbox();
    try {
      const copiedInstaller = join(sandbox.root, "install", "install.ps1");
      const dryRun = invokeAt(copiedInstaller, [
        "-Mode",
        "DryRun",
        "-WorkspacePath",
        sandbox.workspace,
      ]);
      assert.equal(dryRun.status, 0, `${dryRun.stdout}\n${dryRun.stderr}`);
      const approvedHash = extractPlanHash(dryRun.stdout);

      appendFileSync(
        join(sandbox.root, "templates", ".agent-context", "PROJECT_PROFILE.md"),
        "\n<!-- source changed after approval -->\n",
        "utf8",
      );
      const apply = invokeAt(copiedInstaller, [
        "-Mode",
        "Apply",
        "-WorkspacePath",
        sandbox.workspace,
        "-ApprovedPlanHash",
        approvedHash,
      ]);

      assert.notEqual(apply.status, 0, "stale approved plan unexpectedly applied");
      assert.equal(existsSync(join(sandbox.workspace, ".agent-context")), false);
    } finally {
      rmSync(sandbox.root, { recursive: true, force: true });
    }
  },
);

test(
  "PowerShell rejects workspace and skill directory redirects",
  {
    skip:
      powershell === undefined || !directoryLinksAvailable
        ? "PowerShell or directory-link permission is unavailable"
        : false,
  },
  () => {
    assertBootstrapRejectsDirectoryRedirects({
      repositoryRoot,
      runDryRun(options) {
        return invoke(bootstrapArguments("DryRun", options));
      },
      runApply(options, planHash) {
        return invoke(bootstrapArguments("Apply", options, planHash));
      },
    });
  },
);

test(
  "PowerShell plans and installs hidden context and skill source files",
  { skip: powershell === undefined ? "PowerShell is not available on this platform" : false },
  () => {
    const sandbox = createBootstrapSandbox();
    try {
      const copiedInstaller = join(sandbox.root, "install", "install.ps1");
      const skillTarget = join(sandbox.root, "user-skills", "evolve");
      const hiddenContext = join(
        sandbox.root,
        "templates",
        ".agent-context",
        ".hidden-context-contract",
      );
      const hiddenSkill = join(sandbox.root, "skills", "evolve", ".hidden-skill-contract");
      writeFileSync(hiddenContext, "hidden context\n", "utf8");
      writeFileSync(hiddenSkill, "hidden skill\n", "utf8");
      const options = { workspace: sandbox.workspace, skillTarget };

      const dryRun = invokeAt(copiedInstaller, bootstrapArguments("DryRun", options));
      assert.equal(dryRun.status, 0, `${dryRun.stdout}\n${dryRun.stderr}`);
      assert.match(dryRun.stdout, /Create[^\r\n]*\.hidden-context-contract/iu);
      assert.match(dryRun.stdout, /Create[^\r\n]*\.hidden-skill-contract/iu);
      const apply = invokeAt(
        copiedInstaller,
        bootstrapArguments("Apply", options, extractPlanHash(dryRun.stdout)),
      );
      assert.equal(apply.status, 0, `${apply.stdout}\n${apply.stderr}`);
      assert.equal(
        readFileSync(join(sandbox.workspace, ".agent-context", ".hidden-context-contract"), "utf8"),
        "hidden context\n",
      );
      assert.equal(readFileSync(join(skillTarget, ".hidden-skill-contract"), "utf8"), "hidden skill\n");
    } finally {
      rmSync(sandbox.root, { recursive: true, force: true });
    }
  },
);

function invoke(arguments_) {
  return invokeAt(installer, arguments_);
}

function invokeAt(installerPath, arguments_) {
  return run(
    powershell,
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", installerPath, ...arguments_],
    { cwd: repositoryRoot },
  );
}

function skillArguments(mode, options, planHash) {
  return bootstrapArguments(mode, options, planHash, true);
}

function bootstrapArguments(mode, options, planHash, includeInstruction = false) {
  const arguments_ = [
    "-Mode",
    mode,
    "-WorkspacePath",
    options.workspace,
    "-Agent",
    "Codex",
  ];
  if (options.skillTarget) arguments_.push("-SkillTargetPath", options.skillTarget);
  if (includeInstruction && options.instructionTarget) {
    arguments_.push("-InstructionFilePath", options.instructionTarget);
  }
  if (planHash) arguments_.push("-ApprovedPlanHash", planHash);
  return arguments_;
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

function createBootstrapSandbox() {
  const root = mkdtempSync(join(tmpdir(), "agent-context-patch-bootstrap-source-"));
  const workspace = join(root, "workspace");
  mkdirSync(workspace);
  cpSync(join(repositoryRoot, "install"), join(root, "install"), { recursive: true });
  cpSync(join(repositoryRoot, "templates"), join(root, "templates"), { recursive: true });
  cpSync(join(repositoryRoot, "skills"), join(root, "skills"), { recursive: true });
  return { root, workspace };
}
