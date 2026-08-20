import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));
const script = join(repositoryRoot, "scripts", "prepare-release.mjs");

test("release preparation builds a digest-bound archive from one exact commit", () => {
  const sandbox = createReleaseRepository();
  const output = join(sandbox.root, "output");

  try {
    const version = "0.5.4";
    const commit = git(["rev-parse", "HEAD"], sandbox.root).stdout.trim();
    const result = runPackageScript(sandbox.root, [version, commit, output]);

    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    const archiveName = `agent-context-patch-v${version}.zip`;
    const archivePath = join(output, archiveName);
    const checksumPath = join(output, `${archiveName}.sha256`);
    const digest = createHash("sha256").update(readFileSync(archivePath)).digest("hex");

    assert.deepEqual(report, {
      version,
      commit,
      archive: archiveName,
      sha256: digest,
      checksum: `${archiveName}.sha256`,
      supportedWorkspaceSchema: { minimum: 1, maximum: 1 },
    });
    assert.equal(readFileSync(checksumPath, "utf8"), `${digest}  ${archiveName}\n`);
  } finally {
    rmSync(sandbox.root, { recursive: true, force: true });
  }
});

test("release preparation rejects a version that is not bound to the commit", () => {
  const sandbox = createReleaseRepository();
  const output = join(sandbox.root, "output");

  try {
    const commit = git(["rev-parse", "HEAD"], sandbox.root).stdout.trim();
    const result = run(sandbox.script, sandbox.root, ["9.9.9", commit, output]);

    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout}\n${result.stderr}`, /package\.json version 0\.5\.4 does not match 9\.9\.9/u);
  } finally {
    rmSync(sandbox.root, { recursive: true, force: true });
  }
});

function createReleaseRepository() {
  const root = mkdtempSync(join(tmpdir(), "agent-context-patch-release-repository-"));
  const paths = [
    "scripts",
    "skills/evolve",
    "skills/source-snapshot",
    ".claude-plugin",
    "plugins/agent-context-patch/.claude-plugin",
    "plugins/agent-context-patch/skills/source-snapshot",
  ];
  for (const path of paths) mkdirSync(join(root, path), { recursive: true });
  cpSync(script, join(root, "scripts", "prepare-release.mjs"));
  writeJson(join(root, "package.json"), {
    version: "0.5.4",
    private: true,
    scripts: { "release:prepare": "node scripts/prepare-release.mjs" },
  });
  writeJson(join(root, "skills/evolve/manifest.json"), {
    kit: "agent-context-patch",
    version: "0.5.4",
    schemaVersion: 1,
  });
  writeJson(join(root, "skills/source-snapshot/manifest.json"), {
    kit: "agent-context-patch",
    skill: "source-snapshot",
    version: "0.5.4",
    schemaVersion: 1,
  });
  writeJson(join(root, "plugins/agent-context-patch/skills/source-snapshot/manifest.json"), {
    kit: "agent-context-patch",
    skill: "source-snapshot",
    version: "0.5.4",
    schemaVersion: 1,
  });
  writeJson(join(root, ".claude-plugin/marketplace.json"), {
    metadata: { version: "0.5.4" },
    plugins: [{ name: "agent-context-patch", version: "0.5.4" }],
  });
  writeJson(join(root, "plugins/agent-context-patch/.claude-plugin/plugin.json"), {
    version: "0.5.4",
  });
  writeFileSync(join(root, "CHANGELOG.md"), "# Changelog\n\n## [0.5.4] - 2026-07-29\n", "utf8");

  git(["init"], root);
  git(["config", "user.name", "Release Test"], root);
  git(["config", "user.email", "release-test@example.invalid"], root);
  git(["add", "."], root);
  git(["commit", "-m", "release fixture"], root);

  return { root, script: join(root, "scripts", "prepare-release.mjs") };
}

function writeJson(path, document) {
  writeFileSync(path, `${JSON.stringify(document, null, 2)}\n`, "utf8");
}

function run(scriptPath, cwd, arguments_) {
  return spawnSync(process.execPath, [scriptPath, ...arguments_], {
    cwd,
    encoding: "utf8",
  });
}

function runPackageScript(cwd, arguments_) {
  const npmCli =
    process.env.npm_execpath ??
    (process.platform === "win32"
      ? join(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js")
      : undefined);
  const executable = npmCli ? process.execPath : "npm";
  const prefix = npmCli ? [npmCli] : [];
  return spawnSync(executable, [...prefix, "--silent", "run", "release:prepare", "--", ...arguments_], {
    cwd,
    encoding: "utf8",
  });
}

function git(arguments_, cwd) {
  const result = spawnSync("git", arguments_, {
    cwd,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  return result;
}
