import { randomUUID } from "node:crypto";
import {
  lstat,
  open,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  unlink,
} from "node:fs/promises";
import { basename, join, resolve } from "node:path";

import { applyPatchPlan, sha256Text } from "./index.mjs";
import { inspectPatchPlanTargets } from "./internal.mjs";
import {
  inspectProposalDocument,
  validateProposalDocument,
} from "./proposal.mjs";

const TERMINAL_STATUSES = new Set([
  "applied",
  "rejected",
  "superseded",
  "archived",
]);
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;

export async function reconcileWorkspaceProposalLifecycles({ workspaceRoot } = {}) {
  let workspace;
  try {
    workspace = await inspectWorkspace(workspaceRoot);
  } catch {
    return blockedResult("filesystem_error");
  }
  if (workspace.problem) return blockedResult(workspace.problem);

  const lock = await acquireLifecycleLock(workspace.contextRoot);
  if (lock.problem) return blockedResult(lock.problem);

  let result;
  try {
    result = await reconcileWhileLocked(workspace);
  } catch {
    result = blockedResult("filesystem_error");
  }

  const released = await releaseLifecycleLock(lock);
  if (!released) {
    return {
      ...result,
      status: "blocked",
      blockingReason: "lifecycle_lock_release_failed",
    };
  }
  return result;
}

async function reconcileWhileLocked({ workspaceRoot, proposalsRoot, missing }) {
  if (missing) return { status: "settled", inspectedCount: 0, outcomes: [] };
  const entries = await readdir(proposalsRoot, { withFileTypes: true });
  const outcomes = [];
  const records = [];
  const proposalsById = new Map();
  const duplicateIds = new Set();
  let inspectedCount = 0;

  for (const entry of entries.sort((left, right) => compareNames(left.name, right.name))) {
    if (!isProposalCandidate(entry.name)) continue;
    const proposalPath = join(proposalsRoot, entry.name);
    if (!entry.isFile() || entry.isSymbolicLink()) {
      inspectedCount += 1;
      outcomes.push(unsafeProposalOutcome(entry.name));
      continue;
    }

    const sourceRead = await readUtf8File(proposalPath);
    if (sourceRead.problem) {
      inspectedCount += 1;
      outcomes.push(invalidProposalOutcome(entry.name, sourceRead.problem));
      continue;
    }
    const inspected = inspectProposalDocument(sourceRead.source, entry.name);
    if (inspected.failures.length > 0) {
      inspectedCount += 1;
      outcomes.push(invalidProposalOutcome(entry.name, "invalid_proposal"));
      continue;
    }
    const record = {
      name: entry.name,
      proposalPath,
      source: sourceRead.source,
      proposal: inspected.value,
    };
    records.push(record);
    if (proposalsById.has(inspected.value.data.id)) {
      duplicateIds.add(inspected.value.data.id);
    } else {
      proposalsById.set(inspected.value.data.id, record);
    }
  }
  for (const duplicateId of duplicateIds) proposalsById.delete(duplicateId);

  for (const record of records) {
    const { data } = record.proposal;
    if (TERMINAL_STATUSES.has(data.status)) continue;

    inspectedCount += 1;
    if (duplicateIds.has(data.id)) {
      outcomes.push(invalidProposalOutcome(record.name, "duplicate_proposal_id"));
      continue;
    }
    outcomes.push(
      await reconcileProposal({
        workspaceRoot,
        proposalPath: record.proposalPath,
        source: record.source,
        proposal: record.proposal,
        proposalsById,
      }),
    );
  }

  return {
    status: outcomes.every(
      ({ action, afterStatus }) =>
        action === "settled" || TERMINAL_STATUSES.has(afterStatus),
    )
      ? "settled"
      : "blocked",
    inspectedCount,
    outcomes,
  };
}

async function reconcileProposal({
  workspaceRoot,
  proposalPath,
  source,
  proposal,
  proposalsById,
}) {
  const { data, plan } = proposal;
  const targets = Array.isArray(data.target_files) ? [...data.target_files] : [];
  const base = {
    proposalId: data.id,
    beforeStatus: data.status,
    afterStatus: data.status,
    targets,
  };

  if (data.status === "pending_current_fix") {
    return {
      ...base,
      action: "settled",
      reason: "current_fix_pending",
    };
  }
  if (data.scope !== "workspace" || !plan) {
    return {
      ...base,
      action: "approval_required",
      reason: "user_global_adapter_required",
    };
  }

  const runtimePlan = {
    ...plan,
    workspaceRoot,
    planHash: data.plan_hash,
  };
  const targetInspection = await inspectPatchPlanTargets(runtimePlan);
  if (targetInspection.status !== "ready") {
    return {
      ...base,
      action: "manual_recovery_required",
      reason: targetInspection.reason,
    };
  }
  if (targetInspection.relation === "after") {
    return {
      ...base,
      action: "audit_recovery_required",
      reason: "target_matches_after_hash_without_applied_audit",
    };
  }
  if (targetInspection.relation === "mixed") {
    return {
      ...base,
      action: "manual_recovery_required",
      reason: "mixed_target_state",
    };
  }
  if (
    data.status === "approved" &&
    hasUnappliedStaleConflict(proposal.attempts)
  ) {
    const replacementId = namedReplacement(proposal.sections);
    if (replacementId) {
      const replacement = proposalsById.get(replacementId)?.proposal;
      if (!replacement) {
        return {
          ...base,
          action: "superseding_proposal_required",
          reason: "replacement_proposal_not_found",
        };
      }
      if (
        replacementId === data.id ||
        ["rejected", "archived", "superseded"].includes(replacement.data.status)
      ) {
        return {
          ...base,
          action: "superseding_proposal_required",
          reason: "replacement_proposal_not_eligible",
        };
      }
      const timestamp = new Date().toISOString();
      let supersededSource = setFrontmatterField(source, "status", "superseded");
      supersededSource = setFrontmatterField(
        supersededSource,
        "updated_at",
        timestamp,
      );
      const write = await writeProposalCas({
        proposalPath,
        expectedHash: proposal.sourceHash,
        source: supersededSource,
      });
      if (write.problem) {
        return {
          ...base,
          action: "manual_recovery_required",
          reason: write.problem,
        };
      }
      return {
        ...base,
        afterStatus: "superseded",
        action: "settled",
        reason: "superseded_by_replacement",
      };
    }
  }
  if (targetInspection.relation === "changed") {
    return {
      ...base,
      action:
        data.status === "approved"
          ? "superseding_proposal_required"
          : "regenerate_required",
      reason:
        data.status === "approved"
          ? "target_state_changed_after_audit"
          : "target_state_changed",
    };
  }

  if (data.status === "proposed") {
    if (!isExactAutoPlan(plan)) {
      return {
        ...base,
        action: "approval_required",
        reason: "policy_requires_approval",
      };
    }
    return resumeProposal({
      proposalPath,
      source,
      proposal,
      runtimePlan,
      decision: "policy_auto",
      action: "resume_exact_auto",
      authorization: undefined,
    });
  }

  if (data.status === "approved") {
    const humanApproved = proposal.decisions.some(
      ({ decision }) => decision === "approved",
    );
    return resumeProposal({
      proposalPath,
      source,
      proposal,
      runtimePlan,
      decision: humanApproved ? "approved" : "policy_auto",
      action: humanApproved ? "resume_exact_authorized" : "resume_exact_auto",
      authorization: humanApproved
        ? { approvedPlanHash: data.plan_hash }
        : undefined,
    });
  }

  return {
    ...base,
    action: "manual_recovery_required",
    reason: "unsupported_lifecycle_state",
  };
}

function namedReplacement(sections) {
  const value = sections.get("Supersession")?.trim();
  return typeof value === "string" && IDENTIFIER_PATTERN.test(value)
    ? value
    : undefined;
}

function hasUnappliedStaleConflict(attempts) {
  const staleReasons = new Set([
    "before_hash_mismatch",
    "target_exists",
    "target_missing",
  ]);
  const finalAttempt = attempts.at(-1);
  return (
    finalAttempt?.result === "conflict" &&
    staleReasons.has(finalAttempt.errorSummary) &&
    !attempts.some(({ result }) => result === "applied")
  );
}

async function resumeProposal({
  proposalPath,
  source,
  proposal,
  runtimePlan,
  decision,
  action,
  authorization,
}) {
  const timestamp = new Date().toISOString();
  let approvedSource = source;
  if (proposal.data.status === "proposed") {
    approvedSource = setFrontmatterField(approvedSource, "status", "approved");
    approvedSource = setFrontmatterField(approvedSource, "updated_at", timestamp);
    approvedSource = appendAuditRecord(
      approvedSource,
      "Decision Log",
      serializeDecision({
        decision,
        decidedAt: timestamp,
        planHash: proposal.data.plan_hash,
      }),
    );
    const decisionWrite = await writeProposalCas({
      proposalPath,
      expectedHash: proposal.sourceHash,
      source: approvedSource,
    });
    if (decisionWrite.problem) {
      return {
        proposalId: proposal.data.id,
        beforeStatus: proposal.data.status,
        afterStatus: proposal.data.status,
        action,
        reason: decisionWrite.problem,
        targets: [...proposal.data.target_files],
      };
    }
  }

  const attempt = await applyPatchPlan(runtimePlan, authorization);
  const attemptedAt = new Date().toISOString();
  let attemptedSource = setFrontmatterField(
    approvedSource,
    "status",
    attempt.status === "applied" ? "applied" : "approved",
  );
  attemptedSource = setFrontmatterField(
    attemptedSource,
    "updated_at",
    attemptedAt,
  );
  attemptedSource = appendAuditRecord(
    attemptedSource,
    "Apply Attempts",
    serializeAttempt({
      attempt,
      attemptNumber: proposal.attempts.length + 1,
      attemptedAt,
    }),
  );
  const attemptWrite = await writeProposalCas({
    proposalPath,
    expectedHash: sha256Text(approvedSource),
    source: attemptedSource,
  });
  if (attemptWrite.problem) {
    return {
      proposalId: proposal.data.id,
      beforeStatus: proposal.data.status,
      afterStatus: "approved",
      action: "audit_recovery_required",
      reason: "audit_write_pending",
      targets: [...proposal.data.target_files],
    };
  }

  return {
    proposalId: proposal.data.id,
    beforeStatus: proposal.data.status,
    afterStatus: attempt.status === "applied" ? "applied" : "approved",
    action,
    reason: attempt.status === "applied" ? "applied" : attempt.reason ?? "unknown_error",
    targets: [...proposal.data.target_files],
  };
}

function isExactAutoPlan(plan) {
  return (
    plan.requestedPolicy === "auto" &&
    plan.policy === "auto" &&
    plan.semanticOperation === "add" &&
    plan.risk === "low" &&
    plan.currentFixStatus === "verified" &&
    plan.privacy?.safe === true &&
    plan.contextHealth?.autoAllowed === true
  );
}

async function inspectWorkspace(workspaceRoot) {
  if (typeof workspaceRoot !== "string" || workspaceRoot.trim() === "") {
    return { problem: "invalid_workspace_root" };
  }
  const resolvedRoot = resolve(workspaceRoot);
  const rootStat = await statMaybe(resolvedRoot);
  if (!rootStat?.isDirectory()) return { problem: "invalid_workspace_root" };

  const contextRoot = join(resolvedRoot, ".agent-context");
  const contextStat = await lstatMaybe(contextRoot);
  if (!contextStat?.isDirectory() || contextStat.isSymbolicLink()) {
    return { problem: "invalid_context_root" };
  }
  const proposalsRoot = join(contextRoot, "proposals");
  const proposalsStat = await lstatMaybe(proposalsRoot);
  if (!proposalsStat) {
    return { workspaceRoot: resolvedRoot, contextRoot, proposalsRoot, missing: true };
  }
  if (!proposalsStat.isDirectory() || proposalsStat.isSymbolicLink()) {
    return { problem: "invalid_proposals_root" };
  }
  return { workspaceRoot: resolvedRoot, contextRoot, proposalsRoot };
}

async function acquireLifecycleLock(contextRoot) {
  const path = join(contextRoot, ".lifecycle-coordinator.lock");
  const token = randomUUID();
  let handle;
  let created = false;
  try {
    handle = await open(path, "wx", 0o600);
    created = true;
    await handle.writeFile(
      JSON.stringify({ schemaVersion: 1, token, pid: process.pid }),
      "utf8",
    );
    await handle.sync();
    await handle.close();
    return { path, token };
  } catch (error) {
    await handle?.close().catch(() => {});
    if (created) await unlink(path).catch(() => {});
    return {
      problem: error?.code === "EEXIST" ? "lifecycle_locked" : "filesystem_error",
    };
  }
}

async function releaseLifecycleLock(lock) {
  try {
    const record = JSON.parse(await readFile(lock.path, "utf8"));
    if (record?.token !== lock.token) return false;
    await unlink(lock.path);
    return true;
  } catch {
    return false;
  }
}

async function writeProposalCas({ proposalPath, expectedHash, source }) {
  if (validateProposalDocument(source, basename(proposalPath)).length > 0) {
    return { problem: "invalid_audit_write" };
  }
  const current = await readUtf8File(proposalPath);
  if (current.problem) return current;
  if (sha256Text(current.source) !== expectedHash) {
    return { problem: "proposal_source_changed" };
  }

  const temporaryPath = `${proposalPath}.${randomUUID()}.tmp`;
  let handle;
  try {
    handle = await open(temporaryPath, "wx", 0o600);
    await handle.writeFile(source, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;

    const latest = await readUtf8File(proposalPath);
    if (latest.problem || sha256Text(latest.source) !== expectedHash) {
      await rm(temporaryPath, { force: true });
      return { problem: latest.problem ?? "proposal_source_changed" };
    }
    await rename(temporaryPath, proposalPath);
    return {};
  } catch {
    await handle?.close().catch(() => {});
    await rm(temporaryPath, { force: true }).catch(() => {});
    return { problem: "audit_write_failed" };
  }
}

async function readUtf8File(path) {
  try {
    const fileStat = await lstat(path);
    if (!fileStat.isFile() || fileStat.isSymbolicLink()) {
      return { problem: "unsafe_proposal_path" };
    }
    const bytes = await readFile(path);
    const source = bytes.toString("utf8");
    if (!Buffer.from(source, "utf8").equals(bytes)) {
      return { problem: "invalid_proposal_encoding" };
    }
    return { source };
  } catch {
    return { problem: "filesystem_error" };
  }
}

function setFrontmatterField(source, field, value) {
  const end = source.indexOf("\n---", 3);
  if (end === -1) return source;
  const frontmatter = source.slice(0, end);
  const pattern = new RegExp(`^${escapeRegExp(field)}:[^\\r\\n]*$`, "mu");
  if (!pattern.test(frontmatter)) return source;
  return `${frontmatter.replace(pattern, `${field}: ${value}`)}${source.slice(end)}`;
}

function appendAuditRecord(source, heading, record) {
  const bounds = sectionBounds(source, heading);
  if (!bounds) return source;
  const newline = source.includes("\r\n") ? "\r\n" : "\n";
  const normalizedRecord = record.replaceAll("\n", newline);
  const content = source.slice(bounds.contentStart, bounds.contentEnd).trim();
  let nextContent;
  if (/^(?:none|not rejected)\.?$/iu.test(content)) {
    nextContent = `~~~~yaml${newline}${normalizedRecord}${newline}~~~~`;
  } else {
    const opening = /^(?<fence>`{3,}|~{3,})yaml\s*$/mu.exec(content);
    if (!opening?.groups?.fence) {
      nextContent = `${content}${newline}${normalizedRecord}`;
    } else {
      const closingPattern = new RegExp(
        `^${escapeRegExp(opening.groups.fence)}\\s*$`,
        "gmu",
      );
      const closings = [...content.matchAll(closingPattern)];
      const closing = closings.at(-1);
      if (!closing) return source;
      nextContent = `${content.slice(0, closing.index).trimEnd()}${newline}${normalizedRecord}${newline}${content.slice(closing.index)}`;
    }
  }
  return replaceSectionContent(source, bounds, nextContent);
}

function replaceSectionContent(source, bounds, content) {
  const newline = source.includes("\r\n") ? "\r\n" : "\n";
  return `${source.slice(0, bounds.headingEnd)}${newline}${newline}${content}${newline}${newline}${source.slice(bounds.nextHeadingStart)}`;
}

function sectionBounds(source, heading) {
  const pattern = new RegExp(`^## ${escapeRegExp(heading)}[ \\t]*$`, "mu");
  const marker = pattern.exec(source);
  if (!marker) return undefined;
  const headingEnd = marker.index + marker[0].length;
  const lineBreak = /\r?\n/gu;
  lineBreak.lastIndex = headingEnd;
  const afterHeading = lineBreak.exec(source);
  const contentStart = afterHeading ? afterHeading.index + afterHeading[0].length : headingEnd;
  const nextPattern = /^## [^\r\n]+[ \\t]*$/gmu;
  nextPattern.lastIndex = contentStart;
  const next = nextPattern.exec(source);
  return {
    headingEnd,
    contentStart,
    contentEnd: next?.index ?? source.length,
    nextHeadingStart: next?.index ?? source.length,
  };
}

function serializeDecision({ decision, decidedAt, planHash }) {
  return [
    `- decision: ${decision}`,
    `  decided_at: ${decidedAt}`,
    "  decided_by: lifecycle_coordinator",
    `  plan_hash: ${planHash}`,
    `  reason: ${decision === "policy_auto" ? "interrupted_auto_resume" : "exact_approval_resume"}`,
  ].join("\n");
}

function serializeAttempt({ attempt, attemptNumber, attemptedAt }) {
  const result = [
    `- attempt: ${attemptNumber}`,
    `  plan_hash: ${attempt.planHash}`,
    ...serializeHashMap(
      "before_hashes",
      attempt.operations,
      ({ beforeHash }) => beforeHash,
    ),
    `  result: ${attempt.status}`,
    `  attempted_at: ${attemptedAt}`,
  ];
  if (attempt.status === "applied") result.push(`  applied_at: ${attemptedAt}`);
  result.push(
    ...serializeHashMap(
      "after_hashes",
      attempt.operations,
      ({ afterHash }) => afterHash,
    ),
    `  error_summary: ${attempt.status === "applied" ? "null" : attempt.reason ?? "unknown_error"}`,
  );
  return result.join("\n");
}

function serializeHashMap(label, operations, selectHash) {
  if (operations.length === 0) return [`  ${label}: {}`];
  return [
    `  ${label}:`,
    ...operations.map(
      (operation) =>
        `    ${operation.target}: ${selectHash(operation) ?? "null"}`,
    ),
  ];
}

function isProposalCandidate(name) {
  const lower = name.toLowerCase();
  return lower.endsWith(".md") && lower !== "readme.md" && !lower.endsWith(".tmp.md");
}

function compareNames(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function unsafeProposalOutcome(name) {
  return invalidProposalOutcome(name, "unsafe_proposal_path");
}

function invalidProposalOutcome(name, reason) {
  const proposalId = name.slice(0, -".md".length);
  return {
    proposalId: IDENTIFIER_PATTERN.test(proposalId) ? proposalId : "unknown",
    beforeStatus: "unknown",
    afterStatus: "unknown",
    action: "manual_recovery_required",
    reason,
    targets: [],
  };
}

function blockedResult(blockingReason) {
  return {
    status: "blocked",
    inspectedCount: 0,
    outcomes: [],
    blockingReason,
  };
}

async function statMaybe(path) {
  try {
    return await stat(path);
  } catch (error) {
    if (error?.code === "ENOENT") return undefined;
    throw error;
  }
}

async function lstatMaybe(path) {
  try {
    return await lstat(path);
  } catch (error) {
    if (error?.code === "ENOENT") return undefined;
    throw error;
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
