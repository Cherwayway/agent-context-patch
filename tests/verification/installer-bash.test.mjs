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
  assertFreshInstallerDefaultsToAuto,
  assertInstallerContract,
  assertLegacyWorkspaceIsReadOnly,
  assertSkillAndGuidanceContract,
  assertV1ConfigBootstrapContract,
  commandAvailable,
  extractPlanHash,
  run,
  supportsDirectoryLinks,
} from "./installer-helpers.mjs";

const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));
const installer = join(repositoryRoot, "install", "install.sh");
const bashAvailable = commandAvailable("bash");
const directoryLinksAvailable = supportsDirectoryLinks();

test(
  "Bash gives a fresh workspace the auto-first config",
  {
    skip:
      process.platform === "win32" || !bashAvailable
        ? "Bash apply behavior runs on the Ubuntu CI job"
        : false,
  },
  () => {
    assertFreshInstallerDefaultsToAuto({
      runDryRun(workspace) {
        return invokeAt(installer, ["--mode", "dry-run", "--workspace", workspace]);
      },
      runApply(workspace, planHash) {
        return invokeAt(installer, [
          "--mode",
          "apply",
          "--workspace",
          workspace,
          "--approved-plan-hash",
          planHash,
        ]);
      },
    });
  },
);

test("shell scripts are LF-normalized and Bash syntax is valid", (context) => {
  const attributes = readFileSync(join(repositoryRoot, ".gitattributes"), "utf8");
  const source = readFileSync(installer, "utf8");

  assert.match(attributes, /^\*\.sh\s+text\s+eol=lf\s*$/mu);
  assert.match(attributes, /^\*\*\/\.agent-context\/\*\*\s+text\s+eol=lf\s*$/mu);
  assert.equal(source.includes("\r"), false, "install/install.sh contains CRLF line endings");

  if (!bashAvailable) {
    context.diagnostic("Bash is unavailable; syntax execution is covered by the Ubuntu CI job.");
    return;
  }

  // Supplying source on stdin works for native Bash, Git Bash, and WSL Bash;
  // no platform-specific path translation is required for a syntax check.
  const result = run("bash", ["-n"], { cwd: repositoryRoot, input: source });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
});

test(
  "Bash installer dry-runs and applies one approved idempotent plan",
  {
    skip:
      process.platform === "win32" || !bashAvailable
        ? "Bash apply behavior runs on the Ubuntu CI job"
        : false,
  },
  () => {
    assertInstallerContract({
      repositoryRoot,
      runDryRun(workspace) {
        return run("bash", [installer, "--mode", "dry-run", "--workspace", workspace], {
          cwd: repositoryRoot,
        });
      },
      runApply(workspace, planHash) {
        return run(
          "bash",
          [
            installer,
            "--mode",
            "apply",
            "--workspace",
            workspace,
            "--approved-plan-hash",
            planHash,
          ],
          { cwd: repositoryRoot },
        );
      },
    });
  },
);

test(
  "Bash keeps an unversioned legacy workspace read-only",
  {
    skip:
      process.platform === "win32" || !bashAvailable
        ? "Bash apply behavior runs on the Ubuntu CI job"
        : false,
  },
  () => {
    assertLegacyWorkspaceIsReadOnly({
      runDryRun(workspace) {
        return invokeAt(installer, ["--mode", "dry-run", "--workspace", workspace]);
      },
      runApply(workspace, planHash) {
        return invokeAt(installer, [
          "--mode",
          "apply",
          "--workspace",
          workspace,
          "--approved-plan-hash",
          planHash,
        ]);
      },
    });
  },
);

test(
  "Bash validates the complete v1 config envelope before planning writes",
  {
    skip:
      process.platform === "win32" || !bashAvailable
        ? "Bash apply behavior runs on the Ubuntu CI job"
        : false,
  },
  () => {
    assertV1ConfigBootstrapContract({
      repositoryRoot,
      runDryRun(workspace) {
        return invokeAt(installer, ["--mode", "dry-run", "--workspace", workspace]);
      },
      runApply(workspace, planHash) {
        return invokeAt(installer, [
          "--mode",
          "apply",
          "--workspace",
          workspace,
          "--approved-plan-hash",
          planHash,
        ]);
      },
    });
  },
);

test(
  "Bash installs only identical skill content and leaves instructions to the agent",
  {
    skip:
      process.platform === "win32" || !bashAvailable
        ? "Bash apply behavior runs on the Ubuntu CI job"
        : false,
  },
  () => {
    assertSkillAndGuidanceContract({
      repositoryRoot,
      runDryRun(options) {
        return invokeAt(installer, skillArguments("dry-run", options));
      },
      runApply(options, planHash) {
        return invokeAt(installer, skillArguments("apply", options, planHash));
      },
    });
  },
);

test(
  "Bash rejects an approved plan when template source content changes",
  {
    skip:
      process.platform === "win32" || !bashAvailable
        ? "Bash apply behavior runs on the Ubuntu CI job"
        : false,
  },
  () => {
    const sandbox = createBootstrapSandbox();
    try {
      const copiedInstaller = join(sandbox.root, "install", "install.sh");
      const dryRun = invokeAt(copiedInstaller, [
        "--mode",
        "dry-run",
        "--workspace",
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
        "--mode",
        "apply",
        "--workspace",
        sandbox.workspace,
        "--approved-plan-hash",
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
  "Bash rejects workspace and skill directory redirects",
  {
    skip:
      process.platform === "win32" || !bashAvailable || !directoryLinksAvailable
        ? "Bash apply behavior runs on Ubuntu with directory-link permission"
        : false,
  },
  () => {
    assertBootstrapRejectsDirectoryRedirects({
      repositoryRoot,
      runDryRun(options) {
        return invokeAt(installer, bootstrapArguments("dry-run", options));
      },
      runApply(options, planHash) {
        return invokeAt(installer, bootstrapArguments("apply", options, planHash));
      },
    });
  },
);

test(
  "Bash plans and installs hidden context and skill source files",
  {
    skip:
      process.platform === "win32" || !bashAvailable
        ? "Bash apply behavior runs on the Ubuntu CI job"
        : false,
  },
  () => {
    const sandbox = createBootstrapSandbox();
    try {
      const copiedInstaller = join(sandbox.root, "install", "install.sh");
      const skillTarget = join(sandbox.root, "user-skills", "evolve");
      writeFileSync(
        join(sandbox.root, "templates", ".agent-context", ".hidden-context-contract"),
        "hidden context\n",
        "utf8",
      );
      writeFileSync(
        join(sandbox.root, "skills", "evolve", ".hidden-skill-contract"),
        "hidden skill\n",
        "utf8",
      );
      const options = { workspace: sandbox.workspace, skillTarget };

      const dryRun = invokeAt(copiedInstaller, bootstrapArguments("dry-run", options));
      assert.equal(dryRun.status, 0, `${dryRun.stdout}\n${dryRun.stderr}`);
      assert.match(dryRun.stdout, /Create[^\r\n]*\.hidden-context-contract/iu);
      assert.match(dryRun.stdout, /Create[^\r\n]*\.hidden-skill-contract/iu);
      const apply = invokeAt(
        copiedInstaller,
        bootstrapArguments("apply", options, extractPlanHash(dryRun.stdout)),
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

function invokeAt(installerPath, arguments_) {
  return run("bash", [installerPath, ...arguments_], { cwd: repositoryRoot });
}

function skillArguments(mode, options, planHash) {
  return bootstrapArguments(mode, options, planHash, true);
}

function bootstrapArguments(mode, options, planHash, includeInstruction = false) {
  const arguments_ = [
    "--mode",
    mode,
    "--workspace",
    options.workspace,
    "--agent",
    "Codex",
  ];
  if (options.skillTarget) arguments_.push("--skill-target", options.skillTarget);
  if (includeInstruction && options.instructionTarget) {
    arguments_.push("--instruction-file", options.instructionTarget);
  }
  if (planHash) arguments_.push("--approved-plan-hash", planHash);
  return arguments_;
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
