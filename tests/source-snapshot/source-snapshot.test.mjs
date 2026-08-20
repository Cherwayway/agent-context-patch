import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import {
  chmodSync,
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
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  closeSourceSnapshot,
  createSourceSnapshot,
  resolveRemoteSource,
} from "../../skills/source-snapshot/runtime/index.mjs";

const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));
const cliPath = join(
  repositoryRoot,
  "skills",
  "source-snapshot",
  "scripts",
  "agent-source.mjs",
);

test("pins a newer remote ref without touching a dirty primary checkout", async () => {
  const sandbox = createRepositoryFixture();
  try {
    const localOriginBefore = git(sandbox.primary, ["rev-parse", "refs/remotes/origin/main"]);
    assert.equal(localOriginBefore, sandbox.firstCommit);
    assert.equal(readFileSync(join(sandbox.primary, "message.txt"), "utf8"), "dirty local\n");

    const source = await resolveRemoteSource({
      repository: sandbox.primary,
      ref: "refs/heads/main",
      cacheRoot: sandbox.cacheRoot,
      sessionRoot: sandbox.sessionRoot,
    });
    assert.equal(source.commitSha, sandbox.secondCommit);
    assert.equal(source.freshnessVerified, true);
    assert.equal(source.localPrimaryIgnored, true);
    assert.equal(git(sandbox.primary, ["rev-parse", "refs/remotes/origin/main"]), sandbox.firstCommit);
    assert.equal(readFileSync(join(sandbox.primary, "message.txt"), "utf8"), "dirty local\n");

    const snapshot = await createSourceSnapshot({
      receiptPath: source.receiptPath,
      cacheRoot: sandbox.cacheRoot,
      sessionRoot: sandbox.sessionRoot,
    });
    const snapshotFile = join(snapshot.snapshotPath, "message.txt");
    assert.equal(
      readFileSync(snapshotFile, "utf8"),
      gitBareContent(sandbox.remote, ["show", `${sandbox.secondCommit}:message.txt`]),
    );
    assert.equal(lstatSync(snapshotFile).mode & 0o222, 0);

    const close = await closeSourceSnapshot({
      receiptPath: snapshot.receiptPath,
      cacheRoot: sandbox.cacheRoot,
      sessionRoot: sandbox.sessionRoot,
    });
    assert.equal(close.status, "closed");
    assert.equal(close.integrity, "unchanged");
    assert.equal(existsSync(snapshot.snapshotPath), false);
    assert.ok(readdirSync(join(sandbox.cacheRoot, "git")).some((name) => name.endsWith(".git")));
  } finally {
    sandbox.cleanup();
  }
});

test("CLI emits machine-readable receipts for an exact remote ref", () => {
  const sandbox = createRepositoryFixture();
  try {
    const resolved = runCli([
      "resolve",
      "--repo",
      sandbox.primary,
      "--ref",
      "refs/heads/main",
      "--cache-root",
      sandbox.cacheRoot,
      "--session-root",
      sandbox.sessionRoot,
    ]);
    assert.equal(resolved.commitSha, sandbox.secondCommit);
    const snapshot = runCli([
      "snapshot",
      "--receipt",
      resolved.receiptPath,
      "--cache-root",
      sandbox.cacheRoot,
      "--session-root",
      sandbox.sessionRoot,
    ]);
    assert.equal(snapshot.commitSha, sandbox.secondCommit);
    assert.equal(snapshot.snapshotMethod, "git-archive");
    const close = runCli([
      "close",
      "--receipt",
      snapshot.receiptPath,
      "--cache-root",
      sandbox.cacheRoot,
      "--session-root",
      sandbox.sessionRoot,
    ]);
    assert.equal(close.status, "closed");
  } finally {
    sandbox.cleanup();
  }
});

test("a remote failure fails closed and leaves the primary checkout unchanged", async () => {
  const sandbox = createRepositoryFixture();
  try {
    git(sandbox.primary, ["remote", "set-url", "origin", join(sandbox.root, "missing.git")]);
    await assert.rejects(
      resolveRemoteSource({
        repository: sandbox.primary,
        ref: "refs/heads/main",
        cacheRoot: sandbox.cacheRoot,
        sessionRoot: sandbox.sessionRoot,
      }),
      (error) => error.code === "remote_ref_unavailable",
    );
    assert.equal(readFileSync(join(sandbox.primary, "message.txt"), "utf8"), "dirty local\n");
    assert.deepEqual(existingSessionNames(sandbox.sessionRoot), []);
  } finally {
    sandbox.cleanup();
  }
});

test("full PR-like refs are resolved without a provider-specific adapter", async () => {
  const sandbox = createRepositoryFixture();
  try {
    gitBare(sandbox.remote, ["update-ref", "refs/pull/7/head", sandbox.secondCommit]);
    const source = await resolveRemoteSource({
      repository: sandbox.primary,
      ref: "refs/pull/7/head",
      cacheRoot: sandbox.cacheRoot,
      sessionRoot: sandbox.sessionRoot,
    });
    assert.equal(source.commitSha, sandbox.secondCommit);
    const close = await closeSourceSnapshot({
      receiptPath: source.receiptPath,
      cacheRoot: sandbox.cacheRoot,
      sessionRoot: sandbox.sessionRoot,
    });
    assert.equal(close.integrity, "not_materialized");
  } finally {
    sandbox.cleanup();
  }
});

test("changed snapshots are retained instead of silently deleted", async () => {
  const sandbox = createRepositoryFixture();
  try {
    const source = await resolveRemoteSource({
      repository: sandbox.primary,
      ref: "refs/heads/main",
      cacheRoot: sandbox.cacheRoot,
      sessionRoot: sandbox.sessionRoot,
    });
    const snapshot = await createSourceSnapshot({
      receiptPath: source.receiptPath,
      cacheRoot: sandbox.cacheRoot,
      sessionRoot: sandbox.sessionRoot,
    });
    const path = join(snapshot.snapshotPath, "message.txt");
    chmodSync(path, 0o644);
    writeFileSync(path, "unexpected mutation\n", "utf8");

    const close = await closeSourceSnapshot({
      receiptPath: snapshot.receiptPath,
      cacheRoot: sandbox.cacheRoot,
      sessionRoot: sandbox.sessionRoot,
    });
    assert.equal(close.status, "retained");
    assert.equal(close.integrity, "changed");
    assert.equal(existsSync(snapshot.snapshotPath), true);
  } finally {
    sandbox.cleanup();
  }
});

test("an escaping symlink is rejected and cannot affect its target", async () => {
  const sandbox = createRepositoryFixture({ escapingSymlink: true });
  try {
    const outside = join(sandbox.root, "outside.txt");
    writeFileSync(outside, "outside stays\n", "utf8");
    const source = await resolveRemoteSource({
      repository: sandbox.primary,
      ref: "refs/heads/main",
      cacheRoot: sandbox.cacheRoot,
      sessionRoot: sandbox.sessionRoot,
    });
    await assert.rejects(
      createSourceSnapshot({
        receiptPath: source.receiptPath,
        cacheRoot: sandbox.cacheRoot,
        sessionRoot: sandbox.sessionRoot,
      }),
      (error) => error.code === "escaping_symlink_unsupported",
    );
    assert.equal(readFileSync(outside, "utf8"), "outside stays\n");
    const close = await closeSourceSnapshot({
      receiptPath: source.receiptPath,
      cacheRoot: sandbox.cacheRoot,
      sessionRoot: sandbox.sessionRoot,
    });
    assert.equal(close.status, "closed");
  } finally {
    sandbox.cleanup();
  }
});

test("credential-bearing HTTPS remotes are rejected before network access", async () => {
  const sandbox = createRepositoryFixture();
  try {
    git(sandbox.primary, [
      "remote",
      "set-url",
      "origin",
      "https://example-user:example-password@example.invalid/repository.git",
    ]);
    await assert.rejects(
      resolveRemoteSource({
        repository: sandbox.primary,
        ref: "refs/heads/main",
        cacheRoot: sandbox.cacheRoot,
        sessionRoot: sandbox.sessionRoot,
      }),
      (error) => {
        assert.equal(error.code, "credential_bearing_remote_unsupported");
        assert.doesNotMatch(error.message, /example-password/u);
        return true;
      },
    );
    assert.deepEqual(existingSessionNames(sandbox.sessionRoot), []);
  } finally {
    sandbox.cleanup();
  }
});

test("close rejects receipts outside the managed session root", async () => {
  const sandbox = createRepositoryFixture();
  try {
    const outsideReceipt = join(sandbox.root, "snapshot.json");
    writeFileSync(outsideReceipt, "{}\n", "utf8");
    await assert.rejects(
      closeSourceSnapshot({
        receiptPath: outsideReceipt,
        cacheRoot: sandbox.cacheRoot,
        sessionRoot: sandbox.sessionRoot,
      }),
      (error) => error.code === "receipt_outside_managed_root",
    );
    assert.equal(existsSync(outsideReceipt), true);
  } finally {
    sandbox.cleanup();
  }
});

test("a symlinked Git cache directory cannot redirect writes outside the cache root", async () => {
  const sandbox = createRepositoryFixture();
  try {
    const outsideCache = join(sandbox.root, "outside-cache");
    mkdirSync(outsideCache);
    mkdirSync(sandbox.cacheRoot);
    symlinkSync(outsideCache, join(sandbox.cacheRoot, "git"));
    await assert.rejects(
      resolveRemoteSource({
        repository: sandbox.primary,
        ref: "refs/heads/main",
        cacheRoot: sandbox.cacheRoot,
        sessionRoot: sandbox.sessionRoot,
      }),
      (error) => error.code === "cache_root_invalid",
    );
    assert.deepEqual(readdirSync(outsideCache), []);
  } finally {
    sandbox.cleanup();
  }
});

test("concurrent resolutions share one cache without ref-lock failures", async () => {
  const sandbox = createRepositoryFixture();
  try {
    const arguments_ = [
      "resolve",
      "--repo",
      sandbox.primary,
      "--ref",
      "refs/heads/main",
      "--cache-root",
      sandbox.cacheRoot,
      "--session-root",
      sandbox.sessionRoot,
    ];
    const [left, right] = await Promise.all([runCliAsync(arguments_), runCliAsync(arguments_)]);
    assert.equal(left.commitSha, sandbox.secondCommit);
    assert.equal(right.commitSha, sandbox.secondCommit);
    assert.notEqual(left.receiptPath, right.receiptPath);
    for (const source of [left, right]) {
      const close = await closeSourceSnapshot({
        receiptPath: source.receiptPath,
        cacheRoot: sandbox.cacheRoot,
        sessionRoot: sandbox.sessionRoot,
      });
      assert.equal(close.status, "closed");
    }
  } finally {
    sandbox.cleanup();
  }
});

test("submodules fail closed instead of producing an incomplete snapshot", async () => {
  const sandbox = createRepositoryFixture();
  try {
    git(sandbox.producer, [
      "update-index",
      "--add",
      "--cacheinfo",
      "160000",
      sandbox.firstCommit,
      "nested-module",
    ]);
    git(sandbox.producer, ["commit", "--quiet", "-m", "add gitlink"]);
    git(sandbox.producer, ["push", "--quiet", "origin", "main"]);
    const gitlinkCommit = git(sandbox.producer, ["rev-parse", "HEAD"]);
    const source = await resolveRemoteSource({
      repository: sandbox.primary,
      ref: "refs/heads/main",
      cacheRoot: sandbox.cacheRoot,
      sessionRoot: sandbox.sessionRoot,
    });
    assert.equal(source.commitSha, gitlinkCommit);
    await assert.rejects(
      createSourceSnapshot({
        receiptPath: source.receiptPath,
        cacheRoot: sandbox.cacheRoot,
        sessionRoot: sandbox.sessionRoot,
      }),
      (error) => error.code === "submodules_unsupported",
    );
    const close = await closeSourceSnapshot({
      receiptPath: source.receiptPath,
      cacheRoot: sandbox.cacheRoot,
      sessionRoot: sandbox.sessionRoot,
    });
    assert.equal(close.status, "closed");
  } finally {
    sandbox.cleanup();
  }
});

function createRepositoryFixture({ escapingSymlink = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), "source-snapshot-test-"));
  const remote = join(root, "remote.git");
  const producer = join(root, "producer");
  const primary = join(root, "primary");
  const cacheRoot = join(root, "cache");
  const sessionRoot = join(root, "sessions");

  execFileSync("git", ["init", "--bare", "--quiet", remote]);
  execFileSync("git", ["init", "--quiet", "--initial-branch=main", producer]);
  git(producer, ["config", "user.name", "Source Snapshot Test"]);
  git(producer, ["config", "user.email", "source-snapshot@example.invalid"]);
  writeFileSync(join(producer, "message.txt"), "first remote\n", "utf8");
  git(producer, ["add", "message.txt"]);
  git(producer, ["commit", "--quiet", "-m", "first"]);
  const firstCommit = git(producer, ["rev-parse", "HEAD"]);
  git(producer, ["remote", "add", "origin", remote]);
  git(producer, ["push", "--quiet", "-u", "origin", "main"]);

  execFileSync("git", ["clone", "--quiet", remote, primary]);
  writeFileSync(join(primary, "message.txt"), "dirty local\n", "utf8");

  writeFileSync(join(producer, "message.txt"), "remote current\n", "utf8");
  if (escapingSymlink) symlinkSync("../../outside.txt", join(producer, "escape-link"));
  git(producer, ["add", "message.txt", ...(escapingSymlink ? ["escape-link"] : [])]);
  git(producer, ["commit", "--quiet", "-m", "second"]);
  const secondCommit = git(producer, ["rev-parse", "HEAD"]);
  git(producer, ["push", "--quiet", "origin", "main"]);

  return {
    root,
    remote,
    producer,
    primary,
    cacheRoot,
    sessionRoot,
    firstCommit,
    secondCommit,
    cleanup() {
      makeRemovable(root);
      rmSync(root, { recursive: true, force: true });
    },
  };
}

function runCli(arguments_) {
  const result = spawnSync(process.execPath, [cliPath, ...arguments_], {
    cwd: repositoryRoot,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

function runCliAsync(arguments_) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, [cliPath, ...arguments_], {
      cwd: repositoryRoot,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", rejectPromise);
    child.on("close", (status) => {
      if (status !== 0) {
        rejectPromise(new Error(stderr || stdout || `CLI exited with ${status}`));
        return;
      }
      try {
        resolvePromise(JSON.parse(stdout));
      } catch (error) {
        rejectPromise(error);
      }
    });
  });
}

function git(cwd, arguments_) {
  return execFileSync("git", ["-C", cwd, ...arguments_], { encoding: "utf8" }).trim();
}

function gitBare(repository, arguments_) {
  return execFileSync("git", ["--git-dir", repository, ...arguments_], {
    encoding: "utf8",
  }).trim();
}

function gitBareContent(repository, arguments_) {
  return execFileSync("git", ["--git-dir", repository, ...arguments_], {
    encoding: "utf8",
  });
}

function existingSessionNames(sessionRoot) {
  return existsSync(sessionRoot) ? readdirSync(sessionRoot) : [];
}

function makeRemovable(root) {
  if (!existsSync(root)) return;
  const visit = (path) => {
    const entry = lstatSync(path);
    if (entry.isSymbolicLink()) return;
    if (entry.isDirectory()) {
      chmodSync(path, 0o700);
      for (const name of readdirSync(path)) visit(join(path, name));
    } else {
      chmodSync(path, 0o600);
    }
  };
  visit(root);
}
