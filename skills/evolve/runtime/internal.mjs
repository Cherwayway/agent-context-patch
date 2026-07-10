import { createHash, randomUUID } from "node:crypto";
import {
  copyFile,
  lstat,
  mkdir,
  open,
  readFile,
  rename,
  rm,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

const SCHEMA_VERSION = 1;
const HASH_PATTERN = /^[a-f0-9]{64}$/;
const MACHINE_STRING_PATTERN = /^[a-z][a-z0-9_-]{0,127}$/;
const SEMANTIC_OPERATIONS = new Set([
  "add",
  "update",
  "tighten",
  "merge",
  "rewrite",
  "supersede",
  "demote_to_checklist",
  "archive_example",
  "archive_rule",
  "domain_enable",
  "domain_disable",
  "migration",
  "user_global_promotion",
]);
const PRIVATE_KEY_MARKER = /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----/i;
const CREDENTIAL_ASSIGNMENT =
  /\b(?:[A-Z0-9]+[_-])*(?:api[_-]?key|access[_-]?token|auth[_-]?token|token|client[_-]?secret|password|passwd|secret)\b\s*[:=]\s*(?!["'`]?(?:false|true|null|none|redacted)\b)["'`]?[A-Za-z0-9_./+=:@-]{8,}/i;
const WELL_KNOWN_CREDENTIAL =
  /\b(?:AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{20,}|Bearer\s+[A-Za-z0-9._~+/=-]{10,})\b/i;
const USER_HOME_ABSOLUTE_PATH =
  /(?:^|[\s"'`(])(?:[A-Za-z]:[\\/]+Users[\\/]+[^\\/\s]+(?:[\\/]|$)|\/(?:home|Users)\/[^/\s]+(?:\/|$))/m;

export function computePlanHash(plan) {
  const hashable = { ...plan };
  delete hashable.planHash;
  delete hashable.workspaceRoot;
  return sha256Text(canonicalJson(hashable));
}

/**
 * Create the PatchPlan -> ApplyAttempt commit seam.
 *
 * Proposal Decision Log and Apply Attempts are outside planHash. The kernel
 * commits only the plan's context targets, then the caller must immediately
 * append the returned ApplyAttempt to the same proposal and explicitly report
 * if that record fails. The kernel never creates a separate receipt store.
 *
 * A crashed process can leave `.agent-context/.commit-kernel.lock`. The kernel
 * never deletes that lock based on age. After verifying no kernel process is
 * active for the workspace, remove that exact workspace-relative file manually.
 */
export function createCommitKernel({ replaceFile = rename, afterLockAcquired = async () => {} } = {}) {
  if (typeof replaceFile !== "function" || typeof afterLockAcquired !== "function") {
    throw new TypeError("commit-kernel test adapters must be functions");
  }
  return {
    applyPatchPlan: (plan, authorization) =>
      commitPatchPlan(plan, authorization, { replaceFile, afterLockAcquired }),
  };
}

export const applyPatchPlan = createCommitKernel().applyPatchPlan;

async function commitPatchPlan(plan, authorization, { replaceFile, afterLockAcquired }) {
  const receivedPlan = plan;
  try {
    plan = JSON.parse(JSON.stringify(plan));
    authorization =
      authorization === undefined
        ? undefined
        : { approvedPlanHash: authorization?.approvedPlanHash };
  } catch {
    return makeApplyAttempt(receivedPlan, "failed", "invalid_plan", []);
  }
  const problem = validatePlanShape(plan);
  if (problem) {
    return makeApplyAttempt(plan, "failed", problem, []);
  }

  if (plan.planHash !== computePlanHash(plan)) {
    return makeApplyAttempt(plan, "conflict", "plan_hash_mismatch", []);
  }
  const approved = authorization !== undefined;
  if (approved && authorization?.approvedPlanHash !== plan.planHash) {
    return makeApplyAttempt(plan, "conflict", "approval_hash_mismatch", []);
  }
  if (plan.currentFixStatus !== "verified") {
    return makeApplyAttempt(plan, "failed", "current_fix_not_verified", []);
  }
  if (plan.privacy?.safe !== true) {
    return makeApplyAttempt(plan, "failed", "privacy_not_safe", []);
  }
  if (plan.operations.some(({ content }) => containsPrivacyHazard(content))) {
    return makeApplyAttempt(plan, "failed", "privacy_hazard", []);
  }
  if (!approved && plan.policy === "propose") {
    return makeApplyAttempt(plan, "conflict", "policy_requires_approval", []);
  }
  if (!approved && plan.semanticOperation !== "add") {
    return makeApplyAttempt(plan, "failed", "auto_operation_forbidden", []);
  }
  if (
    !approved &&
    (plan.risk !== "low" ||
      plan.contextHealth?.autoAllowed !== true)
  ) {
    return makeApplyAttempt(plan, "failed", "auto_guard_failed", []);
  }

  let workspaceStat;
  try {
    workspaceStat = await followStatMaybe(plan.workspaceRoot);
  } catch {
    return makeApplyAttempt(plan, "failed", "filesystem_error", []);
  }
  if (!workspaceStat?.isDirectory()) {
    return makeApplyAttempt(plan, "failed", "invalid_workspace_root", []);
  }

  const contextRoot = resolve(plan.workspaceRoot, ".agent-context");
  let autoConfig;
  if (!approved) {
    autoConfig = await readAutoWorkspaceConfig(contextRoot);
    if (!autoConfig) {
      return makeApplyAttempt(plan, "conflict", "auto_not_enabled", []);
    }
  }
  let preflight;
  try {
    preflight = await preflightOperations(plan, contextRoot, { approved, autoConfig });
  } catch {
    return makeApplyAttempt(plan, "failed", "filesystem_error", []);
  }
  if (preflight.problem) {
    return makeApplyAttempt(plan, preflight.problem.status, preflight.problem.reason, []);
  }

  const lock = await acquireCommitLock(contextRoot, plan.planId);
  if (lock.problem) {
    return makeApplyAttempt(plan, lock.problem.status, lock.problem.reason, []);
  }

  let attempt;
  try {
    await afterLockAcquired();
    attempt = await commitWhileLocked(plan, contextRoot, { approved, replaceFile });
  } catch {
    attempt = makeApplyAttempt(plan, "failed", "filesystem_error", []);
  }

  const released = await releaseCommitLock(lock);
  if (!released) {
    const result = { ...attempt, reason: "lock_release_failed", lockRelease: "failed" };
    if (attempt.reason) result.priorReason = attempt.reason;
    return result;
  }
  return attempt;
}

async function commitWhileLocked(plan, contextRoot, { approved, replaceFile }) {
  let autoConfig;
  if (!approved) {
    autoConfig = await readAutoWorkspaceConfig(contextRoot);
    if (!autoConfig) return makeApplyAttempt(plan, "conflict", "auto_not_enabled", []);
  }
  const preflight = await preflightOperations(plan, contextRoot, { approved, autoConfig });
  if (preflight.problem) {
    return makeApplyAttempt(plan, preflight.problem.status, preflight.problem.reason, []);
  }

  const stagingRoot = join(contextRoot, `.commit-${randomUUID()}`);
  const applied = [];
  try {
    await mkdir(stagingRoot, { recursive: true });
    for (const [index, prepared] of preflight.operations.entries()) {
      prepared.staged = join(stagingRoot, `${index}.stage`);
      prepared.backup = join(stagingRoot, `${index}.backup`);
      await writeFile(prepared.staged, prepared.operation.content, "utf8");
      if (prepared.operation.type === "update") {
        await copyFile(prepared.absoluteTarget, prepared.backup);
      }
      await mkdir(dirname(prepared.absoluteTarget), { recursive: true });
    }
    if (!approved) {
      const commitConfig = await readAutoWorkspaceConfig(contextRoot);
      if (!commitConfig || commitConfig.contentHash !== autoConfig.contentHash) {
        await rm(stagingRoot, { recursive: true, force: true });
        return makeApplyAttempt(
          plan,
          "conflict",
          "auto_not_enabled",
          attemptOperations(preflight.operations),
        );
      }
      autoConfig = commitConfig;
    }
    const commitPreflight = await preflightOperations(plan, contextRoot, {
      approved,
      autoConfig,
    });
    if (commitPreflight.problem) {
      await rm(stagingRoot, { recursive: true, force: true });
      return makeApplyAttempt(
        plan,
        commitPreflight.problem.status,
        commitPreflight.problem.reason,
        attemptOperations(preflight.operations),
      );
    }
    for (const prepared of preflight.operations) {
      await replaceFile(prepared.staged, prepared.absoluteTarget);
      applied.push(prepared);
    }
  } catch {
    const rolledBack = await rollback(applied, replaceFile);
    await rm(stagingRoot, { recursive: true, force: true }).catch(() => {});
    if (applied.length > 0 && rolledBack) {
      return makeApplyAttempt(
        plan,
        "rolled_back",
        "commit_failed",
        attemptOperations(preflight.operations),
      );
    }
    return makeApplyAttempt(
      plan,
      "failed",
      applied.length > 0 ? "rollback_failed" : "filesystem_error",
      attemptOperations(preflight.operations),
    );
  }

  await rm(stagingRoot, { recursive: true, force: true }).catch(() => {});
  return makeApplyAttempt(plan, "applied", undefined, attemptOperations(preflight.operations));
}

async function acquireCommitLock(contextRoot, planId) {
  try {
    let contextStat = await statMaybe(contextRoot);
    if (!contextStat) {
      try {
        await mkdir(contextRoot);
      } catch (error) {
        if (error?.code !== "EEXIST") throw error;
      }
      contextStat = await statMaybe(contextRoot);
    }
    if (!contextStat?.isDirectory() || contextStat.isSymbolicLink()) {
      return { problem: { status: "failed", reason: "unsafe_target" } };
    }

    const path = join(contextRoot, ".commit-kernel.lock");
    let handle;
    try {
      handle = await open(path, "wx");
    } catch (error) {
      if (error?.code === "EEXIST") {
        return { problem: { status: "conflict", reason: "commit_locked" } };
      }
      throw error;
    }

    const token = randomUUID();
    try {
      await handle.writeFile(
        JSON.stringify({ schemaVersion: SCHEMA_VERSION, token, pid: process.pid, planId }),
        "utf8",
      );
    } catch {
      await handle.close().catch(() => {});
      await unlink(path).catch(() => {});
      return { problem: { status: "failed", reason: "lock_acquire_failed" } };
    }
    return { handle, path, token };
  } catch {
    return { problem: { status: "failed", reason: "lock_acquire_failed" } };
  }
}

async function releaseCommitLock(lock) {
  try {
    await lock.handle.close();
    const owner = JSON.parse(await readFile(lock.path, "utf8"));
    if (owner?.token !== lock.token) return false;
    await unlink(lock.path);
    return true;
  } catch {
    return false;
  }
}

export function sha256Text(value) {
  return sha256(Buffer.from(value, "utf8"));
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function validatePlanShape(plan) {
  if (!plan || typeof plan !== "object" || Array.isArray(plan)) return "invalid_plan";
  if (plan.schemaVersion !== SCHEMA_VERSION) return "unsupported_schema_version";
  if (!isIdentifier(plan.planId) || !isIdentifier(plan.proposalId)) return "invalid_identifier";
  if (typeof plan.workspaceRoot !== "string" || !isAbsolute(plan.workspaceRoot)) {
    return "invalid_workspace_root";
  }
  if (!["propose", "auto"].includes(plan.policy)) return "invalid_policy";
  if (!["propose", "auto"].includes(plan.requestedPolicy)) {
    return "invalid_requested_policy";
  }
  if (plan.policy === "auto" && plan.requestedPolicy !== "auto") {
    return "invalid_policy_transition";
  }
  if (typeof plan.policyReason !== "string" || !MACHINE_STRING_PATTERN.test(plan.policyReason)) {
    return "invalid_policy_reason";
  }
  if (!["low", "high"].includes(plan.risk)) return "invalid_risk";
  if (!SEMANTIC_OPERATIONS.has(plan.semanticOperation)) {
    return "invalid_semantic_operation";
  }
  if (plan.semanticOperation === "user_global_promotion") {
    return "semantic_operation_not_supported";
  }
  if (typeof plan.contextHealth?.autoAllowed !== "boolean") {
    return "invalid_context_health";
  }
  if (
    !Number.isInteger(plan.contextDelta?.activeLinesBefore) ||
    plan.contextDelta.activeLinesBefore < 0 ||
    !Number.isInteger(plan.contextDelta?.activeLinesAfter) ||
    plan.contextDelta.activeLinesAfter < 0
  ) {
    return "invalid_context_delta";
  }
  if (!Array.isArray(plan.operations) || plan.operations.length === 0) {
    return "invalid_operations";
  }
  for (const operation of plan.operations) {
    if (
      !operation ||
      !["create", "update"].includes(operation.type) ||
      typeof operation.target !== "string" ||
      (operation.type === "create"
        ? operation.beforeHash !== null
        : typeof operation.beforeHash !== "string" || !HASH_PATTERN.test(operation.beforeHash)) ||
      typeof operation.content !== "string"
    ) {
      return "invalid_operation";
    }
  }
  if (typeof plan.planHash !== "string" || !HASH_PATTERN.test(plan.planHash)) {
    return "invalid_plan_hash";
  }
  return undefined;
}

function containsPrivacyHazard(content) {
  return (
    PRIVATE_KEY_MARKER.test(content) ||
    CREDENTIAL_ASSIGNMENT.test(content) ||
    WELL_KNOWN_CREDENTIAL.test(content) ||
    USER_HOME_ABSOLUTE_PATH.test(content)
  );
}

async function readAutoWorkspaceConfig(contextRoot) {
  try {
    const content = await readFile(join(contextRoot, "config.yml"), "utf8");
    const parsed = parseWorkspaceConfig(content);
    if (parsed?.schemaVersion !== SCHEMA_VERSION || parsed.contextWritePolicy !== "auto") {
      return undefined;
    }
    return {
      contentHash: sha256Text(content),
      enabledDomains: parsed.enabledDomains,
    };
  } catch {
    return undefined;
  }
}

function parseWorkspaceConfig(content) {
  content = content.replace(/^\uFEFF/, "");
  let schemaVersion;
  let contextWritePolicy;
  let sawSchemaVersion = false;
  let sawContextWritePolicy = false;
  let sawEnabledDomains = false;
  let activeSection;
  const enabledDomains = new Set();

  for (const rawLine of content.split(/\r?\n/)) {
    if (rawLine.includes("\t")) return undefined;
    const line = rawLine.trimEnd();
    if (!line.trim() || line.trimStart().startsWith("#")) continue;

    if (!/^\s/.test(line)) {
      activeSection = "other";
      if (line.startsWith("schema_version:")) {
        if (sawSchemaVersion) return undefined;
        const match = /^schema_version:\s*(\d+)\s*$/.exec(line);
        if (!match) return undefined;
        sawSchemaVersion = true;
        schemaVersion = Number(match[1]);
      } else if (line.startsWith("context_write_policy:")) {
        if (sawContextWritePolicy) return undefined;
        const match = /^context_write_policy:\s*(auto|propose)\s*$/.exec(line);
        if (!match) return undefined;
        sawContextWritePolicy = true;
        contextWritePolicy = match[1];
      } else if (line.startsWith("enabled_domains:")) {
        if (sawEnabledDomains) return undefined;
        const emptyList = /^enabled_domains:\s*\[\s*\]\s*$/.test(line);
        if (!emptyList && !/^enabled_domains:\s*$/.test(line)) return undefined;
        sawEnabledDomains = true;
        activeSection = emptyList ? "other" : "enabled_domains";
      }
      continue;
    }

    if (activeSection === "enabled_domains") {
      const match = /^\s+-\s+([a-z0-9][a-z0-9-]*)\s*$/.exec(line);
      if (!match) return undefined;
      if (enabledDomains.has(match[1])) return undefined;
      enabledDomains.add(match[1]);
    }
  }

  if (!sawSchemaVersion || !sawContextWritePolicy || !sawEnabledDomains) return undefined;
  return { schemaVersion, contextWritePolicy, enabledDomains };
}

async function preflightOperations(plan, contextRoot, { approved, autoConfig }) {
  const operations = [];
  const seenTargets = new Set();
  for (const operation of plan.operations) {
    const target = normalizeTarget(operation.target);
    if (!target || seenTargets.has(targetKey(target))) {
      return { problem: { status: "failed", reason: target ? "duplicate_target" : "unsafe_target" } };
    }
    if (isKernelReservedTarget(target)) {
      return { problem: { status: "failed", reason: "kernel_reserved_target" } };
    }
    seenTargets.add(targetKey(target));

    const absoluteTarget = resolve(plan.workspaceRoot, ...target.split("/"));
    if (!isInside(contextRoot, absoluteTarget)) {
      return { problem: { status: "failed", reason: "unsafe_target" } };
    }
    if (!(await isSymlinkFreeFilePath(contextRoot, absoluteTarget))) {
      return { problem: { status: "failed", reason: "unsafe_target" } };
    }
    if (!isSupportedTarget(target)) {
      return { problem: { status: "failed", reason: "target_not_supported" } };
    }
    if (!approved && !isAutoEligibleTarget(target)) {
      return { problem: { status: "failed", reason: "auto_target_forbidden" } };
    }
    if (!approved && isChecklistTarget(target)) {
      const domain = target.slice(target.lastIndexOf("/") + 1, -".md".length);
      if (!autoConfig?.enabledDomains.has(domain)) {
        return { problem: { status: "conflict", reason: "domain_not_enabled" } };
      }
    }
    const targetStat = await statMaybe(absoluteTarget);
    if (operation.type === "create" && targetStat) {
      return { problem: { status: "conflict", reason: "target_exists" } };
    }
    if (operation.type === "update" && !targetStat) {
      return { problem: { status: "conflict", reason: "target_missing" } };
    }

    let beforeHash = null;
    if (operation.type === "update") {
      beforeHash = sha256(await readFile(absoluteTarget));
      if (beforeHash !== operation.beforeHash) {
        return { problem: { status: "conflict", reason: "before_hash_mismatch" } };
      }
    }
    operations.push({
      operation,
      target,
      absoluteTarget,
      beforeHash,
      afterHash: sha256Text(operation.content),
    });
  }
  return { operations };
}

async function rollback(applied, replaceFile) {
  try {
    for (const prepared of [...applied].reverse()) {
      if (prepared.operation.type === "create") {
        await rm(prepared.absoluteTarget, { force: true });
      } else {
        await rm(prepared.absoluteTarget, { force: true });
        await replaceFile(prepared.backup, prepared.absoluteTarget);
      }
    }
    return true;
  } catch {
    return false;
  }
}

function attemptOperations(operations) {
  return operations.map(({ operation, target, beforeHash, afterHash }) => ({
    type: operation.type,
    target,
    beforeHash,
    afterHash,
  }));
}

async function isSymlinkFreeFilePath(contextRoot, absoluteTarget) {
  const segments = relative(contextRoot, absoluteTarget).split(sep);
  let current = contextRoot;
  for (let index = 0; index <= segments.length; index += 1) {
    const currentStat = await statMaybe(current);
    if (!currentStat) return true;
    if (currentStat.isSymbolicLink()) return false;
    const isTarget = index === segments.length;
    if (isTarget ? !currentStat.isFile() : !currentStat.isDirectory()) return false;
    if (!isTarget) current = join(current, segments[index]);
  }
  return true;
}

function normalizeTarget(target) {
  const portable = target.replaceAll("\\", "/");
  if (portable.startsWith("/") || /^[a-zA-Z]:/.test(portable)) return undefined;
  const segments = portable.split("/");
  if (
    segments.length < 2 ||
    segments[0] !== ".agent-context" ||
    segments.some((segment) => !segment || segment === "." || segment === "..")
  ) {
    return undefined;
  }
  return segments.join("/");
}

function isInside(root, target) {
  const pathFromRoot = relative(root, target);
  return pathFromRoot !== "" && pathFromRoot !== ".." && !pathFromRoot.startsWith(`..${sep}`) && !isAbsolute(pathFromRoot);
}

function targetKey(target) {
  return process.platform === "win32" ? target.toLowerCase() : target;
}

function isAutoEligibleTarget(target) {
  return (
    target === ".agent-context/PROJECT_CONTEXT_INDEX.md" ||
    target === ".agent-context/PROJECT_PROFILE.md" ||
    isChecklistTarget(target)
  );
}

function isSupportedTarget(target) {
  return (
    target === ".agent-context/config.yml" ||
    target === ".agent-context/PROJECT_CONTEXT_INDEX.md" ||
    target === ".agent-context/PROJECT_PROFILE.md" ||
    isChecklistTarget(target) ||
    /^\.agent-context\/proposals\/[^/]+\.md$/.test(target) ||
    /^\.agent-context\/reports\/[^/]+\.md$/.test(target) ||
    target.startsWith(".agent-context/archive/")
  );
}

function isChecklistTarget(target) {
  return /^\.agent-context\/checklists\/[^/]+\.md$/.test(target);
}

function isKernelReservedTarget(target) {
  return target.startsWith(".agent-context/.commit-");
}

function isIdentifier(value) {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value);
}

async function statMaybe(path) {
  try {
    return await lstat(path);
  } catch (error) {
    if (error?.code === "ENOENT") return undefined;
    throw error;
  }
}

async function followStatMaybe(path) {
  try {
    return await stat(path);
  } catch (error) {
    if (error?.code === "ENOENT") return undefined;
    throw error;
  }
}

function makeApplyAttempt(plan, status, reason, operations) {
  const result = {
    schemaVersion: SCHEMA_VERSION,
    status,
    planId: typeof plan?.planId === "string" ? plan.planId : undefined,
    proposalId: typeof plan?.proposalId === "string" ? plan.proposalId : undefined,
    planHash: typeof plan?.planHash === "string" ? plan.planHash : undefined,
    operations,
  };
  if (reason) result.reason = reason;
  return result;
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}
