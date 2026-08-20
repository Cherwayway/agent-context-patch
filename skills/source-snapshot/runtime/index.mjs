import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  chmodSync,
  createReadStream,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { TextDecoder } from "node:util";

const SCHEMA_VERSION = 1;
const SESSION_PREFIX = "session-";
const SESSION_PATTERN = /^session-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SHA_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });

export function defaultCacheRoot() {
  const base = process.env.XDG_CACHE_HOME || join(homedir(), ".cache");
  return join(base, "agent-context-patch", "source-snapshot");
}

export function defaultSessionRoot() {
  return join(tmpdir(), "agent-context-patch-source-snapshot");
}

export async function resolveRemoteSource({
  repository,
  remote = "origin",
  ref,
  cacheRoot = defaultCacheRoot(),
  sessionRoot = defaultSessionRoot(),
} = {}) {
  const repositoryRoot = resolveRepository(repository);
  requireSafeToken(remote, "remote", /^[A-Za-z0-9._-]+$/u);
  requireFullRef(ref);

  const remoteUrl = runGit(
    ["-C", repositoryRoot, "remote", "get-url", remote],
    "remote_not_found",
  ).trim();
  const fetchLocator = normalizeFetchLocator(repositoryRoot, remoteUrl);
  rejectCredentialBearingUrl(fetchLocator);

  const safeCacheRoot = ensureRoot(cacheRoot, "cache_root_invalid");
  const safeSessionRoot = ensureRoot(sessionRoot, "session_root_invalid");
  const remoteFingerprint = sha256(fetchLocator);
  const repositoryFingerprint = sha256(repositoryRoot);
  const gitCacheRoot = ensureCacheGitRoot(safeCacheRoot);
  const cacheRepository = join(gitCacheRoot, `${remoteFingerprint}.git`);

  const sessionId = `${SESSION_PREFIX}${randomUUID()}`;
  const sessionDirectory = join(safeSessionRoot, sessionId);
  mkdirSync(sessionDirectory, { mode: 0o700 });
  const sourceId = `src-${randomUUID()}`;
  const sessionRef = `refs/agent-source/sessions/${sessionId.slice(SESSION_PREFIX.length).replaceAll("-", "")}`;

  let commitSha;
  try {
    commitSha = await withCacheLock(cacheRepository, async () => {
      ensureBareCache(cacheRepository);
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const observedSha = resolveRemoteRef(repositoryRoot, remote, ref);
        runGit(
          [
            "--git-dir",
            cacheRepository,
            "fetch",
            "--no-tags",
            "--force",
            "--no-write-fetch-head",
            fetchLocator,
            `+${ref}:${sessionRef}`,
          ],
          "remote_fetch_failed",
        );
        const fetchedSha = runGit(
          ["--git-dir", cacheRepository, "rev-parse", "--verify", `${sessionRef}^{commit}`],
          "fetched_commit_invalid",
        ).trim();
        if (observedSha === fetchedSha) return fetchedSha;
      }
      throw sourceError(
        "remote_ref_unstable",
        "The remote ref changed while it was being pinned; freshness was not established.",
      );
    });

    const resolvedAt = new Date().toISOString();
    const receiptPath = join(sessionDirectory, "source.json");
    const receipt = {
      schemaVersion: SCHEMA_VERSION,
      kind: "source-resolution",
      sourceId,
      sessionId,
      mode: "remote-ref",
      repository: basename(repositoryRoot),
      repositoryFingerprint,
      remote,
      remoteFingerprint,
      remoteRef: ref,
      commitSha,
      freshnessVerified: true,
      freshnessProof: "ls-remote-fetch-sha-match",
      resolvedAt,
      localPrimaryIgnored: true,
      cacheRepository,
      sessionRef,
      receiptPath,
    };
    writeJsonExclusive(receiptPath, receipt);
    return publicSourceReceipt(receipt);
  } catch (error) {
    tryDeleteCacheRef(cacheRepository, sessionRef);
    rmSync(sessionDirectory, { recursive: true, force: true });
    throw error;
  }
}

export async function createSourceSnapshot({
  receiptPath,
  cacheRoot = defaultCacheRoot(),
  sessionRoot = defaultSessionRoot(),
} = {}) {
  const safeCacheRoot = ensureRoot(cacheRoot, "cache_root_invalid");
  const safeSessionRoot = ensureRoot(sessionRoot, "session_root_invalid");
  const { receipt: source, sessionDirectory } = readManagedReceipt(
    receiptPath,
    safeSessionRoot,
    "source.json",
  );
  validateSourceReceipt(source, sessionDirectory, safeCacheRoot);
  if (existsSync(join(sessionDirectory, "snapshot.json"))) {
    throw sourceError("snapshot_already_exists", "This source receipt already owns a snapshot.");
  }

  const archivePath = join(sessionDirectory, "source.tar");
  const snapshotPath = join(sessionDirectory, "tree");
  try {
    runGit(
      ["--git-dir", source.cacheRepository, "cat-file", "-e", `${source.commitSha}^{commit}`],
      "cached_commit_missing",
    );
    validateGitTree(source.cacheRepository, source.commitSha);
    mkdirSync(snapshotPath, { mode: 0o700 });
    runGit(
      [
        "--git-dir",
        source.cacheRepository,
        "archive",
        "--format=tar",
        `--output=${archivePath}`,
        source.commitSha,
      ],
      "archive_creation_failed",
    );
    extractGitArchive(archivePath, snapshotPath);
    validateExtractedTree(snapshotPath);
    makeTreeReadOnly(snapshotPath);
    const integrity = await treeIntegrity(snapshotPath);
    rmSync(archivePath, { force: true });

    const snapshotId = `snap-${randomUUID()}`;
    const snapshotReceiptPath = join(sessionDirectory, "snapshot.json");
    const snapshot = {
      schemaVersion: SCHEMA_VERSION,
      kind: "source-snapshot",
      snapshotId,
      sourceId: source.sourceId,
      sessionId: source.sessionId,
      mode: source.mode,
      repository: source.repository,
      remote: source.remote,
      remoteRef: source.remoteRef,
      commitSha: source.commitSha,
      freshnessVerified: true,
      resolvedAt: source.resolvedAt,
      snapshotMethod: "git-archive",
      snapshotPath,
      readOnly: true,
      integrity,
      createdAt: new Date().toISOString(),
      receiptPath: snapshotReceiptPath,
    };
    writeJsonExclusive(snapshotReceiptPath, snapshot);
    return publicSnapshotReceipt(snapshot);
  } catch (error) {
    rmSync(archivePath, { force: true });
    if (existsSync(snapshotPath)) {
      makeTreeRemovable(snapshotPath);
      rmSync(snapshotPath, { recursive: true, force: true });
    }
    throw error;
  }
}

export async function closeSourceSnapshot({
  receiptPath,
  cacheRoot = defaultCacheRoot(),
  sessionRoot = defaultSessionRoot(),
} = {}) {
  const safeCacheRoot = ensureRoot(cacheRoot, "cache_root_invalid");
  const safeSessionRoot = ensureRoot(sessionRoot, "session_root_invalid");
  const receiptName = basename(resolve(String(receiptPath ?? "")));
  if (!new Set(["source.json", "snapshot.json"]).has(receiptName)) {
    throw sourceError("receipt_invalid", "Close requires a managed source or snapshot receipt.");
  }
  const { receipt, sessionDirectory } = readManagedReceipt(
    receiptPath,
    safeSessionRoot,
    receiptName,
  );
  const source = readSourceForSession(sessionDirectory, safeCacheRoot);

  if (receiptName === "snapshot.json") {
    validateSnapshotReceipt(receipt, source, sessionDirectory);
    const currentIntegrity = await treeIntegrity(receipt.snapshotPath);
    if (currentIntegrity.digest !== receipt.integrity?.digest) {
      return {
        schemaVersion: SCHEMA_VERSION,
        kind: "source-close",
        status: "retained",
        integrity: "changed",
        snapshotId: receipt.snapshotId,
        snapshotPath: receipt.snapshotPath,
        temporaryFilesRemoved: false,
        sharedCacheRetained: true,
        closedAt: new Date().toISOString(),
      };
    }
  } else {
    validateSourceReceipt(receipt, sessionDirectory, safeCacheRoot);
    if (existsSync(join(sessionDirectory, "snapshot.json"))) {
      throw sourceError(
        "snapshot_receipt_required",
        "This session has a snapshot; close it with snapshot.json so integrity is checked.",
      );
    }
  }

  const snapshotPath = join(sessionDirectory, "tree");
  if (existsSync(snapshotPath)) makeTreeRemovable(snapshotPath);
  await withCacheLock(source.cacheRepository, async () => {
    tryDeleteCacheRef(source.cacheRepository, source.sessionRef);
  });
  rmSync(sessionDirectory, { recursive: true, force: true });
  return {
    schemaVersion: SCHEMA_VERSION,
    kind: "source-close",
    status: "closed",
    integrity: receiptName === "snapshot.json" ? "unchanged" : "not_materialized",
    sourceId: source.sourceId,
    snapshotId: receiptName === "snapshot.json" ? receipt.snapshotId : undefined,
    temporaryFilesRemoved: true,
    sharedCacheRetained: true,
    closedAt: new Date().toISOString(),
  };
}

function resolveRepository(repository) {
  if (typeof repository !== "string" || repository.length === 0) {
    throw sourceError("repository_required", "A repository path is required.");
  }
  const candidate = resolve(repository);
  const root = runGit(
    ["-C", candidate, "rev-parse", "--show-toplevel"],
    "repository_invalid",
  ).trim();
  return realpathSync(root);
}

function normalizeFetchLocator(repositoryRoot, remoteUrl) {
  if (!remoteUrl) throw sourceError("remote_not_found", "The configured remote has no URL.");
  if (remoteUrl.startsWith("file://") || /^[A-Za-z][A-Za-z0-9+.-]*:\/\//u.test(remoteUrl)) {
    return remoteUrl;
  }
  if (/^[^/]+@[^:]+:.+/u.test(remoteUrl)) return remoteUrl;
  return isAbsolute(remoteUrl) ? resolve(remoteUrl) : resolve(repositoryRoot, remoteUrl);
}

function rejectCredentialBearingUrl(locator) {
  if (!/^https?:\/\//iu.test(locator)) return;
  let parsed;
  try {
    parsed = new URL(locator);
  } catch {
    throw sourceError("remote_url_invalid", "The remote URL is invalid.");
  }
  if (parsed.username || parsed.password) {
    throw sourceError(
      "credential_bearing_remote_unsupported",
      "Credential-bearing remote URLs are not copied into the source cache. Use a credential helper or SSH remote.",
    );
  }
}

function resolveRemoteRef(repositoryRoot, remote, ref) {
  const output = runGit(
    ["-C", repositoryRoot, "ls-remote", "--refs", "--exit-code", remote, ref],
    "remote_ref_unavailable",
  );
  const matches = output
    .trim()
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((line) => line.split(/\s+/u))
    .filter(([, returnedRef]) => returnedRef === ref);
  if (matches.length !== 1 || !SHA_PATTERN.test(matches[0][0])) {
    throw sourceError("remote_ref_ambiguous", "The remote ref did not resolve to exactly one commit.");
  }
  return matches[0][0];
}

function ensureBareCache(cacheRepository) {
  const parent = dirname(cacheRepository);
  mkdirSync(parent, { recursive: true, mode: 0o700 });
  if (existsSync(cacheRepository)) {
    if (lstatSync(cacheRepository).isSymbolicLink() || !lstatSync(cacheRepository).isDirectory()) {
      throw sourceError("cache_repository_invalid", "The source cache repository is not a safe directory.");
    }
    runGit(["--git-dir", cacheRepository, "rev-parse", "--is-bare-repository"], "cache_repository_invalid");
    return;
  }
  runGit(["init", "--bare", "--quiet", cacheRepository], "cache_initialization_failed");
}

function ensureCacheGitRoot(cacheRoot) {
  const gitRoot = join(cacheRoot, "git");
  mkdirSync(gitRoot, { recursive: true, mode: 0o700 });
  if (lstatSync(gitRoot).isSymbolicLink() || !lstatSync(gitRoot).isDirectory()) {
    throw sourceError("cache_root_invalid", "The Git cache root is not a safe directory.");
  }
  const realGitRoot = realpathSync(gitRoot);
  if (!isPathWithin(cacheRoot, realGitRoot)) {
    throw sourceError("cache_root_invalid", "The Git cache root escapes its managed root.");
  }
  return realGitRoot;
}

async function withCacheLock(cacheRepository, operation) {
  const lockDirectory = `${cacheRepository}.agent-source-lock`;
  const deadline = Date.now() + 10_000;
  while (true) {
    try {
      mkdirSync(lockDirectory, { mode: 0o700 });
      writeFileSync(
        join(lockDirectory, "owner.json"),
        `${JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() })}\n`,
        { encoding: "utf8", flag: "wx", mode: 0o600 },
      );
      break;
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      if (lockIsStale(lockDirectory)) {
        rmSync(lockDirectory, { recursive: true, force: true });
        continue;
      }
      if (Date.now() >= deadline) {
        throw sourceError("cache_lock_timeout", "Another source resolution still owns the cache lock.");
      }
      await delay(50);
    }
  }
  try {
    return await operation();
  } finally {
    rmSync(lockDirectory, { recursive: true, force: true });
  }
}

function lockIsStale(lockDirectory) {
  try {
    return Date.now() - statSync(lockDirectory).mtimeMs > 120_000;
  } catch {
    return false;
  }
}

function validateGitTree(cacheRepository, commitSha) {
  const result = spawnSync(
    "git",
    ["--git-dir", cacheRepository, "ls-tree", "-rz", "--full-tree", "-r", commitSha],
    { encoding: null, maxBuffer: 256 * 1024 * 1024 },
  );
  if (result.error || result.status !== 0) {
    throw sourceError("git_tree_invalid", "The pinned commit tree could not be inspected.");
  }
  for (const record of splitNullRecords(result.stdout)) {
    const tab = record.indexOf(0x09);
    if (tab < 0) throw sourceError("git_tree_invalid", "The pinned commit tree is malformed.");
    const header = record.subarray(0, tab).toString("ascii");
    const [mode, type] = header.split(" ");
    if (mode === "160000" || type === "commit") {
      throw sourceError(
        "submodules_unsupported",
        "The pinned source contains submodules and cannot be represented as a complete archive snapshot.",
      );
    }
    let path;
    try {
      path = UTF8_DECODER.decode(record.subarray(tab + 1));
    } catch {
      throw sourceError("non_utf8_paths_unsupported", "The pinned source contains a non-UTF-8 path.");
    }
    validateGitPath(path);
  }
}

function splitNullRecords(buffer) {
  const records = [];
  let start = 0;
  for (let index = 0; index < buffer.length; index += 1) {
    if (buffer[index] !== 0) continue;
    if (index > start) records.push(buffer.subarray(start, index));
    start = index + 1;
  }
  if (start !== buffer.length) {
    throw sourceError("git_tree_invalid", "The pinned commit tree is not NUL terminated.");
  }
  return records;
}

function validateGitPath(path) {
  const components = path.split("/");
  if (
    path.length === 0 ||
    path.startsWith("/") ||
    path.includes("\\") ||
    components.some((component) => !component || component === "." || component === "..")
  ) {
    throw sourceError("unsafe_archive_path", "The pinned source contains an unsafe archive path.");
  }
}

function extractGitArchive(archivePath, root) {
  const archiveSize = statSync(archivePath).size;
  if (archiveSize > 1024 * 1024 * 1024) {
    throw sourceError(
      "archive_too_large",
      "The pinned source archive exceeds the one-gigabyte extraction limit.",
    );
  }
  const archive = readFileSync(archivePath);
  const seenPaths = new Set();
  let offset = 0;
  let zeroBlocks = 0;
  let localPax = {};
  let globalPax = {};
  let longPath;
  let longLinkPath;

  while (offset + 512 <= archive.length) {
    const header = archive.subarray(offset, offset + 512);
    offset += 512;
    if (header.every((byte) => byte === 0)) {
      zeroBlocks += 1;
      if (zeroBlocks === 2) break;
      continue;
    }
    zeroBlocks = 0;
    validateTarChecksum(header);
    const size = parseTarNumber(header.subarray(124, 136), "size");
    const mode = parseTarNumber(header.subarray(100, 108), "mode");
    if (!Number.isSafeInteger(size) || size < 0 || offset + size > archive.length) {
      throw sourceError("archive_invalid", "The Git archive contains an invalid entry size.");
    }
    const data = archive.subarray(offset, offset + size);
    offset += Math.ceil(size / 512) * 512;
    if (offset > archive.length) {
      throw sourceError("archive_invalid", "The Git archive entry exceeds the archive boundary.");
    }

    const type = String.fromCharCode(header[156] || 0);
    if (type === "x" || type === "g") {
      const attributes = parsePaxAttributes(data);
      if (type === "g") globalPax = { ...globalPax, ...attributes };
      else localPax = attributes;
      continue;
    }
    if (type === "L" || type === "K") {
      const value = decodeArchiveText(trimArchiveTerminator(data));
      if (type === "L") longPath = value;
      else longLinkPath = value;
      continue;
    }

    const attributes = { ...globalPax, ...localPax };
    const headerName = decodeTarPath(header);
    const archivedPath = attributes.path ?? longPath ?? headerName;
    const path = type === "5" ? archivedPath.replace(/\/+$/u, "") : archivedPath;
    const linkPath =
      attributes.linkpath ??
      longLinkPath ??
      decodeArchiveText(trimNulls(header.subarray(157, 257)));
    localPax = {};
    longPath = undefined;
    longLinkPath = undefined;
    validateGitPath(path);
    if (seenPaths.has(path)) {
      throw sourceError("archive_invalid", "The Git archive contains a duplicate path.");
    }
    seenPaths.add(path);
    const destination = join(root, ...path.split("/"));
    if (!isPathWithin(root, destination)) {
      throw sourceError("unsafe_archive_path", "The Git archive path escapes the snapshot root.");
    }

    if (type === "5") {
      mkdirSync(destination, { recursive: true, mode: normalizedArchiveMode(mode, true) });
      continue;
    }
    mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });
    if (type === "0" || type === "\0") {
      writeFileSync(destination, data, {
        flag: "wx",
        mode: normalizedArchiveMode(mode, false),
      });
      continue;
    }
    if (type === "2") {
      validateArchiveSymlink(path, linkPath);
      try {
        symlinkSync(linkPath, destination);
      } catch {
        throw sourceError(
          "symlink_materialization_failed",
          "A safe Git symlink could not be materialized on this platform.",
        );
      }
      continue;
    }
    throw sourceError("archive_entry_unsupported", "The Git archive contains an unsupported entry type.");
  }
  if (zeroBlocks < 2) {
    throw sourceError("archive_invalid", "The Git archive is missing its end marker.");
  }
}

function validateTarChecksum(header) {
  const expected = parseTarNumber(header.subarray(148, 156), "checksum");
  let actual = 0;
  for (let index = 0; index < header.length; index += 1) {
    actual += index >= 148 && index < 156 ? 0x20 : header[index];
  }
  if (actual !== expected) {
    throw sourceError("archive_invalid", "The Git archive header checksum is invalid.");
  }
}

function parseTarNumber(field, label) {
  if ((field[0] & 0x80) !== 0) {
    throw sourceError("archive_invalid", `The Git archive ${label} uses an unsupported numeric encoding.`);
  }
  const value = trimNulls(field).toString("ascii").trim();
  if (value === "") return 0;
  if (!/^[0-7]+$/u.test(value)) {
    throw sourceError("archive_invalid", `The Git archive ${label} is not octal.`);
  }
  return Number.parseInt(value, 8);
}

function decodeTarPath(header) {
  const name = decodeArchiveText(trimNulls(header.subarray(0, 100)));
  const prefix = decodeArchiveText(trimNulls(header.subarray(345, 500)));
  return prefix ? `${prefix}/${name}` : name;
}

function parsePaxAttributes(data) {
  const attributes = {};
  let offset = 0;
  while (offset < data.length) {
    const space = data.indexOf(0x20, offset);
    if (space < 0) throw sourceError("archive_invalid", "The Git archive PAX record is malformed.");
    const lengthText = data.subarray(offset, space).toString("ascii");
    if (!/^[1-9][0-9]*$/u.test(lengthText)) {
      throw sourceError("archive_invalid", "The Git archive PAX length is invalid.");
    }
    const length = Number.parseInt(lengthText, 10);
    const end = offset + length;
    if (!Number.isSafeInteger(length) || end > data.length || data[end - 1] !== 0x0a) {
      throw sourceError("archive_invalid", "The Git archive PAX record exceeds its boundary.");
    }
    const record = decodeArchiveText(data.subarray(space + 1, end - 1));
    const equals = record.indexOf("=");
    if (equals <= 0) throw sourceError("archive_invalid", "The Git archive PAX attribute is invalid.");
    const key = record.slice(0, equals);
    if (key === "path" || key === "linkpath") attributes[key] = record.slice(equals + 1);
    offset = end;
  }
  return attributes;
}

function validateArchiveSymlink(path, target) {
  if (!target || target.startsWith("/") || target.includes("\\")) {
    throw sourceError(
      "escaping_symlink_unsupported",
      "The pinned source contains a symlink that escapes the snapshot root.",
    );
  }
  const pathComponents = path.split("/");
  pathComponents.pop();
  for (const component of target.split("/")) {
    if (!component || component === ".") continue;
    if (component === "..") {
      if (pathComponents.length === 0) {
        throw sourceError(
          "escaping_symlink_unsupported",
          "The pinned source contains a symlink that escapes the snapshot root.",
        );
      }
      pathComponents.pop();
    } else {
      pathComponents.push(component);
    }
  }
}

function decodeArchiveText(buffer) {
  try {
    return UTF8_DECODER.decode(buffer);
  } catch {
    throw sourceError("non_utf8_paths_unsupported", "The Git archive contains non-UTF-8 text.");
  }
}

function trimNulls(buffer) {
  const nul = buffer.indexOf(0);
  return nul < 0 ? buffer : buffer.subarray(0, nul);
}

function trimArchiveTerminator(buffer) {
  let end = buffer.length;
  while (end > 0 && (buffer[end - 1] === 0 || buffer[end - 1] === 0x0a)) end -= 1;
  return buffer.subarray(0, end);
}

function normalizedArchiveMode(mode, directory) {
  const executable = (mode & 0o111) !== 0;
  return directory ? 0o700 : executable ? 0o700 : 0o600;
}

function validateExtractedTree(root) {
  walkTree(root, (path, entry) => {
    if (!entry.isSymbolicLink()) return;
    const target = readlinkSync(path);
    const resolvedTarget = resolve(dirname(path), target);
    if (!isPathWithin(root, resolvedTarget)) {
      throw sourceError(
        "escaping_symlink_unsupported",
        "The pinned source contains a symlink that escapes the snapshot root.",
      );
    }
  });
}

function makeTreeReadOnly(root) {
  const entries = [];
  walkTree(root, (path, entry) => entries.push({ path, entry }));
  for (const { path, entry } of entries) {
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) continue;
    const executable = (entry.mode & 0o111) !== 0;
    chmodSync(path, executable ? 0o555 : 0o444);
  }
  for (const { path, entry } of entries.toReversed()) {
    if (entry.isDirectory()) chmodSync(path, 0o555);
  }
  chmodSync(root, 0o555);
}

function makeTreeRemovable(root) {
  if (!existsSync(root)) return;
  chmodSync(root, 0o700);
  walkTree(root, (path, entry) => {
    if (entry.isDirectory()) chmodSync(path, 0o700);
    else if (!entry.isSymbolicLink()) chmodSync(path, 0o600);
  });
}

async function treeIntegrity(root) {
  if (!existsSync(root) || lstatSync(root).isSymbolicLink() || !lstatSync(root).isDirectory()) {
    throw sourceError("snapshot_tree_missing", "The managed snapshot tree is missing or unsafe.");
  }
  const hash = createHash("sha256");
  let entryCount = 0;
  const entries = [];
  walkTree(root, (path, entry) => entries.push({ path, entry }));
  for (const { path, entry } of entries) {
    const relativePath = relative(root, path).split(sep).join("/");
    entryCount += 1;
    if (entry.isDirectory()) {
      updateHashField(hash, "D");
      updateHashField(hash, relativePath);
      updateHashField(hash, String(entry.mode & 0o777));
    } else if (entry.isSymbolicLink()) {
      updateHashField(hash, "L");
      updateHashField(hash, relativePath);
      updateHashField(hash, readlinkSync(path));
    } else if (entry.isFile()) {
      const contentHash = createHash("sha256");
      for await (const chunk of createReadStream(path)) contentHash.update(chunk);
      updateHashField(hash, "F");
      updateHashField(hash, relativePath);
      updateHashField(hash, String(entry.mode & 0o777));
      updateHashField(hash, String(entry.size));
      updateHashField(hash, contentHash.digest("hex"));
    } else {
      throw sourceError("snapshot_entry_unsupported", "The snapshot contains an unsupported file type.");
    }
  }
  return { algorithm: "sha256", digest: hash.digest("hex"), entryCount };
}

function walkTree(root, visit) {
  const recurse = (directory) => {
    const names = readdirSync(directory).toSorted((left, right) => left.localeCompare(right, "en"));
    for (const name of names) {
      const path = join(directory, name);
      const entry = lstatSync(path);
      visit(path, entry);
      if (entry.isDirectory()) recurse(path);
    }
  };
  recurse(root);
}

function updateHashField(hash, value) {
  const bytes = Buffer.from(String(value), "utf8");
  hash.update(String(bytes.length));
  hash.update(":");
  hash.update(bytes);
}

function readManagedReceipt(receiptPath, sessionRoot, expectedName) {
  if (typeof receiptPath !== "string" || !receiptPath) {
    throw sourceError("receipt_required", "A receipt path is required.");
  }
  const absolutePath = resolve(receiptPath);
  const sessionDirectory = dirname(absolutePath);
  if (
    basename(absolutePath) !== expectedName ||
    dirname(sessionDirectory) !== sessionRoot ||
    !SESSION_PATTERN.test(basename(sessionDirectory)) ||
    !isPathWithin(sessionRoot, absolutePath)
  ) {
    throw sourceError("receipt_outside_managed_root", "The receipt is outside the managed session root.");
  }
  if (
    !existsSync(sessionDirectory) ||
    lstatSync(sessionDirectory).isSymbolicLink() ||
    !lstatSync(sessionDirectory).isDirectory() ||
    !existsSync(absolutePath) ||
    lstatSync(absolutePath).isSymbolicLink() ||
    !lstatSync(absolutePath).isFile()
  ) {
    throw sourceError("receipt_invalid", "The managed receipt is missing or unsafe.");
  }
  let receipt;
  try {
    receipt = JSON.parse(readFileSync(absolutePath, "utf8"));
  } catch {
    throw sourceError("receipt_invalid", "The managed receipt is not valid JSON.");
  }
  return { receipt, sessionDirectory, absolutePath };
}

function readSourceForSession(sessionDirectory, cacheRoot) {
  const path = join(sessionDirectory, "source.json");
  let source;
  try {
    source = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw sourceError("source_receipt_invalid", "The source receipt for this session is invalid.");
  }
  validateSourceReceipt(source, sessionDirectory, cacheRoot);
  return source;
}

function validateSourceReceipt(source, sessionDirectory, cacheRoot) {
  const realCacheRepository =
    typeof source?.cacheRepository === "string"
      ? realpathSafe(source.cacheRepository)
      : undefined;
  if (
    source?.schemaVersion !== SCHEMA_VERSION ||
    source.kind !== "source-resolution" ||
    source.mode !== "remote-ref" ||
    source.freshnessVerified !== true ||
    !SHA_PATTERN.test(source.commitSha ?? "") ||
    source.sessionId !== basename(sessionDirectory) ||
    source.receiptPath !== join(sessionDirectory, "source.json") ||
    typeof source.cacheRepository !== "string" ||
    !isPathWithin(cacheRoot, source.cacheRepository) ||
    lstatSafe(source.cacheRepository)?.isSymbolicLink() ||
    !lstatSafe(source.cacheRepository)?.isDirectory() ||
    !realCacheRepository ||
    !isPathWithin(cacheRoot, realCacheRepository) ||
    typeof source.sessionRef !== "string" ||
    !source.sessionRef.startsWith("refs/agent-source/sessions/")
  ) {
    throw sourceError("source_receipt_invalid", "The source receipt failed validation.");
  }
}

function validateSnapshotReceipt(snapshot, source, sessionDirectory) {
  if (
    snapshot?.schemaVersion !== SCHEMA_VERSION ||
    snapshot.kind !== "source-snapshot" ||
    snapshot.sourceId !== source.sourceId ||
    snapshot.sessionId !== source.sessionId ||
    snapshot.commitSha !== source.commitSha ||
    snapshot.receiptPath !== join(sessionDirectory, "snapshot.json") ||
    snapshot.snapshotPath !== join(sessionDirectory, "tree") ||
    snapshot.snapshotMethod !== "git-archive" ||
    snapshot.readOnly !== true ||
    !SHA_PATTERN.test(snapshot.integrity?.digest ?? "")
  ) {
    throw sourceError("snapshot_receipt_invalid", "The snapshot receipt failed validation.");
  }
}

function ensureRoot(path, code) {
  if (typeof path !== "string" || !path) throw sourceError(code, "A managed root path is required.");
  const absolutePath = resolve(path);
  mkdirSync(absolutePath, { recursive: true, mode: 0o700 });
  if (lstatSync(absolutePath).isSymbolicLink() || !lstatSync(absolutePath).isDirectory()) {
    throw sourceError(code, "The managed root is not a safe directory.");
  }
  return realpathSync(absolutePath);
}

function isPathWithin(root, candidate) {
  const pathFromRoot = relative(resolve(root), resolve(candidate));
  return pathFromRoot === "" || (!pathFromRoot.startsWith(`..${sep}`) && pathFromRoot !== "..");
}

function requireFullRef(ref) {
  if (typeof ref !== "string" || !ref.startsWith("refs/") || ref.length > 512) {
    throw sourceError("remote_ref_invalid", "A full Git ref beginning with refs/ is required.");
  }
  runGit(["check-ref-format", ref], "remote_ref_invalid");
}

function requireSafeToken(value, label, pattern) {
  if (typeof value !== "string" || !pattern.test(value)) {
    throw sourceError(`${label}_invalid`, `The ${label} is invalid.`);
  }
}

function runGit(arguments_, code) {
  return runCommand("git", arguments_, code);
}

function runCommand(command, arguments_, code) {
  const result = spawnSync(command, arguments_, {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    throw sourceError(code, safeErrorMessage(code));
  }
  return result.stdout;
}

function safeErrorMessage(code) {
  const messages = {
    repository_invalid: "The repository could not be resolved.",
    remote_not_found: "The configured Git remote could not be resolved.",
    remote_ref_invalid: "The requested Git ref is invalid.",
    remote_ref_unavailable: "The requested remote ref is unavailable; freshness was not established.",
    remote_fetch_failed: "The requested remote ref could not be fetched into the isolated cache.",
    fetched_commit_invalid: "The fetched remote ref did not resolve to a commit.",
    cache_repository_invalid: "The source cache repository is invalid.",
    cache_initialization_failed: "The source cache repository could not be initialized.",
    cached_commit_missing: "The pinned commit is missing from the source cache.",
    archive_creation_failed: "The pinned commit could not be archived.",
    archive_extraction_failed: "The pinned commit archive could not be extracted safely.",
  };
  return messages[code] ?? "The source snapshot operation failed.";
}

function writeJsonExclusive(path, value) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    if (existsSync(path)) throw sourceError("receipt_exists", "The managed receipt already exists.");
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
}

function tryDeleteCacheRef(cacheRepository, sessionRef) {
  if (!cacheRepository || !sessionRef || !existsSync(cacheRepository)) return;
  const result = spawnSync(
    "git",
    ["--git-dir", cacheRepository, "update-ref", "-d", sessionRef],
    { encoding: "utf8" },
  );
  if (result.error || result.status !== 0) {
    throw sourceError("cache_ref_cleanup_failed", "The task-owned cache ref could not be removed.");
  }
}

function publicSourceReceipt(receipt) {
  return {
    schemaVersion: receipt.schemaVersion,
    kind: receipt.kind,
    sourceId: receipt.sourceId,
    mode: receipt.mode,
    repository: receipt.repository,
    remote: receipt.remote,
    remoteRef: receipt.remoteRef,
    commitSha: receipt.commitSha,
    freshnessVerified: receipt.freshnessVerified,
    freshnessProof: receipt.freshnessProof,
    resolvedAt: receipt.resolvedAt,
    localPrimaryIgnored: receipt.localPrimaryIgnored,
    receiptPath: receipt.receiptPath,
  };
}

function publicSnapshotReceipt(snapshot) {
  return {
    schemaVersion: snapshot.schemaVersion,
    kind: snapshot.kind,
    snapshotId: snapshot.snapshotId,
    sourceId: snapshot.sourceId,
    mode: snapshot.mode,
    repository: snapshot.repository,
    remote: snapshot.remote,
    remoteRef: snapshot.remoteRef,
    commitSha: snapshot.commitSha,
    freshnessVerified: snapshot.freshnessVerified,
    resolvedAt: snapshot.resolvedAt,
    snapshotMethod: snapshot.snapshotMethod,
    snapshotPath: snapshot.snapshotPath,
    readOnly: snapshot.readOnly,
    integrity: snapshot.integrity,
    createdAt: snapshot.createdAt,
    receiptPath: snapshot.receiptPath,
  };
}

function lstatSafe(path) {
  try {
    return lstatSync(path);
  } catch {
    return undefined;
  }
}

function realpathSafe(path) {
  try {
    return realpathSync(path);
  } catch {
    return undefined;
  }
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function sourceError(code, message) {
  return Object.assign(new Error(message), { code });
}
