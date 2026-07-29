import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

try {
  const options = parseArguments(process.argv.slice(2));
  const repositoryRoot = resolve(import.meta.dirname, "..");
  const version = requireSemver(options.releaseVersion);
  const commit = requireCommit(options.commit);
  const output = resolve(options.output);

  verifyExactCommit(repositoryRoot, commit);
  const supportedWorkspaceSchema = verifyReleaseSurfaces(repositoryRoot, commit, version);

  mkdirSync(output, { recursive: true });
  const archive = `agent-context-patch-v${version}.zip`;
  const checksum = `${archive}.sha256`;
  const archivePath = join(output, archive);
  const checksumPath = join(output, checksum);
  refuseOverwrite(archivePath);
  refuseOverwrite(checksumPath);

  runGit(
    repositoryRoot,
    [
      "archive",
      "--format=zip",
      `--prefix=agent-context-patch-v${version}/`,
      `--output=${archivePath}`,
      commit,
    ],
    "create release archive",
  );

  const sha256 = createHash("sha256").update(readFileSync(archivePath)).digest("hex");
  writeFileSync(checksumPath, `${sha256}  ${archive}\n`, { encoding: "utf8", flag: "wx" });

  process.stdout.write(
    `${JSON.stringify(
      {
        version,
        commit,
        archive,
        sha256,
        checksum,
        supportedWorkspaceSchema,
      },
      null,
      2,
    )}\n`,
  );
} catch (error) {
  process.stderr.write(`Release preparation failed: ${error.message}\n`);
  process.exitCode = 1;
}

function verifyExactCommit(repositoryRoot, commit) {
  const resolved = runGit(
    repositoryRoot,
    ["rev-parse", "--verify", `${commit}^{commit}`],
    "resolve release commit",
  ).trim();
  if (resolved !== commit) {
    throw new Error(`release commit resolved to ${resolved}, expected ${commit}`);
  }
}

function verifyReleaseSurfaces(repositoryRoot, commit, version) {
  const packageDocument = readJsonAtCommit(repositoryRoot, commit, "package.json");
  expectVersion("package.json", packageDocument.version, version);

  const manifest = readJsonAtCommit(repositoryRoot, commit, "skills/evolve/manifest.json");
  expectVersion("skills/evolve/manifest.json", manifest.version, version);
  if (!Number.isInteger(manifest.schemaVersion) || manifest.schemaVersion < 1) {
    throw new Error("skills/evolve/manifest.json schemaVersion must be a positive integer");
  }

  const marketplace = readJsonAtCommit(repositoryRoot, commit, ".claude-plugin/marketplace.json");
  expectVersion(".claude-plugin/marketplace.json metadata", marketplace.metadata?.version, version);
  for (const plugin of marketplace.plugins ?? []) {
    expectVersion(`.claude-plugin/marketplace.json plugin ${plugin.name ?? "<unnamed>"}`, plugin.version, version);
  }

  const plugin = readJsonAtCommit(
    repositoryRoot,
    commit,
    "plugins/agent-context-patch/.claude-plugin/plugin.json",
  );
  expectVersion("plugins/agent-context-patch/.claude-plugin/plugin.json", plugin.version, version);

  const changelog = readAtCommit(repositoryRoot, commit, "CHANGELOG.md");
  const escapedVersion = escapeRegularExpression(version);
  if (!new RegExp(`^## \\[${escapedVersion}\\] - \\d{4}-\\d{2}-\\d{2}$`, "mu").test(changelog)) {
    throw new Error(`CHANGELOG.md has no dated [${version}] release section`);
  }

  return { minimum: manifest.schemaVersion, maximum: manifest.schemaVersion };
}

function expectVersion(surface, actual, expected) {
  if (actual !== expected) {
    throw new Error(`${surface} version ${String(actual)} does not match ${expected}`);
  }
}

function readJsonAtCommit(repositoryRoot, commit, path) {
  try {
    return JSON.parse(readAtCommit(repositoryRoot, commit, path));
  } catch (error) {
    throw new Error(`${path} is not valid JSON: ${error.message}`);
  }
}

function readAtCommit(repositoryRoot, commit, path) {
  return runGit(repositoryRoot, ["show", `${commit}:${path}`], `read ${path}`);
}

function runGit(repositoryRoot, arguments_, action) {
  const result = spawnSync("git", arguments_, {
    cwd: repositoryRoot,
    encoding: "utf8",
  });
  if (result.error) throw new Error(`${action}: ${result.error.message}`);
  if (result.status !== 0) {
    throw new Error(`${action}: ${(result.stderr || result.stdout).trim()}`);
  }
  return result.stdout;
}

function refuseOverwrite(path) {
  if (existsSync(path)) throw new Error(`refusing to overwrite ${basename(path)}`);
}

function escapeRegularExpression(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function requireSemver(value) {
  if (!value || !/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u.test(value)) {
    throw new Error("version requires a semantic version without a v prefix");
  }
  return value;
}

function requireCommit(value) {
  if (!value || !/^[0-9a-f]{40}$/u.test(value)) {
    throw new Error("--commit requires a lowercase 40-character SHA-1");
  }
  return value;
}

function parseArguments(arguments_) {
  if (arguments_.length !== 3 || arguments_.some((argument) => argument.length === 0)) {
    throw new Error(
      "usage: npm run release:prepare -- <version> <40-character-sha> <output-directory>",
    );
  }
  return {
    releaseVersion: arguments_[0],
    commit: arguments_[1],
    output: arguments_[2],
  };
}
