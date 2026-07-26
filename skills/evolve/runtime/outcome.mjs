import {
  deriveLifecycleReconciliationStatus,
  isAppliedLifecycleOutcome,
  isApprovalRequiredLifecycleOutcome,
  isLifecycleIdentifier,
  isLifecycleOutcome,
} from "./lifecycle-contract.mjs";

const MACHINE_REASON_PATTERN = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/u;
const UNSAFE_DETAIL_MARKERS = [
  "raw_conversation",
  "conversation_data",
  "conversation_content",
  "chat_log",
  "user_said",
  "assistant_said",
  "prompt_content",
  "message_content",
  "full_log",
];
const LIKELY_SECRET_TOKEN_PATTERNS = [
  /(?:^|[._-])(?:sk|pk)[._-](?:live|test)[._-][A-Za-z0-9]{8,}(?:$|[._-])/iu,
  /(?:^|[._-])(?:gh[pousr]|github_pat|xox[baprs])[_-][A-Za-z0-9_-]{8,}(?:$|[._-])/iu,
  /(?:^|[._-])akia[A-Za-z0-9]{12,}(?:$|[._-])/iu,
  /(?:^|[._-])eyj[A-Za-z0-9_-]{16,}(?:$|[._-])/iu,
  /(?:secret|token|password|passwd|credential|api_key|access_key|private_key)[._-][A-Za-z0-9]{12,}(?:$|[._-])/iu,
  /(?:^|[._-])(?=[A-Za-z0-9]{24,}(?:$|[._-]))(?=[A-Za-z0-9]*[A-Za-z])(?=[A-Za-z0-9]*[0-9])[A-Za-z0-9]{24,}(?:$|[._-])/u,
];
export function finalizeEvolutionOutcome({
  detect,
  propose,
  proposalId,
  reconciliation,
} = {}) {
  if (
    validStage(detect, "no_candidate") &&
    validStage(propose, "not_needed") &&
    proposalId === undefined &&
    reconciliation === undefined
  ) {
    const apply = { status: "not_attempted", reason: "no_proposal" };
    return {
      schemaVersion: 1,
      detect: { status: detect.status, reason: detect.reason },
      propose: { status: propose.status, reason: propose.reason },
      apply,
      receipt: {
        kind: "no_candidate",
        text: formatReceipt({ detect, propose, apply }),
      },
    };
  }

  if (
    ["skipped", "candidate"].some((status) => validStage(detect, status)) &&
    validStage(propose, "blocked") &&
    proposalId === undefined &&
    reconciliation === undefined
  ) {
    const apply = { status: "not_attempted", reason: "proposal_blocked" };
    return {
      schemaVersion: 1,
      detect: { status: detect.status, reason: detect.reason },
      propose: { status: propose.status, reason: propose.reason },
      apply,
      receipt: {
        kind: "blocked",
        text: formatReceipt({ detect, propose, apply }),
      },
    };
  }

  if (
    validProposalLifecycleFamily(detect, propose) &&
    validIdentifier(proposalId)
  ) {
    const lifecycle = inspectLifecycleEvidence(reconciliation, proposalId);
    if (lifecycle.problem) {
      return blockedProposalOutcome({
        detect,
        propose,
        proposalId,
        reason: lifecycle.problem,
      });
    }
    const { outcome: lifecycleOutcome, targets } = lifecycle;
    if (
      reconciliation?.status === "settled" &&
      isAppliedLifecycleOutcome(lifecycleOutcome) &&
      targets.length > 0
    ) {
      const apply = { status: "applied", reason: "applied" };
      return {
        schemaVersion: 1,
        detect: { status: detect.status, reason: detect.reason },
        propose: { status: propose.status, reason: propose.reason },
        apply,
        proposalId,
        targets,
        receipt: {
          kind: "applied",
          text: formatReceipt({
            detect,
            propose,
            apply,
            proposalId,
            targets,
          }),
        },
      };
    }
    if (
      reconciliation?.status === "settled" &&
      isApprovalRequiredLifecycleOutcome(lifecycleOutcome) &&
      targets
    ) {
      const apply = {
        status: "approval_required",
        reason: lifecycleOutcome.reason,
      };
      const result = {
        schemaVersion: 1,
        detect: { status: detect.status, reason: detect.reason },
        propose: { status: propose.status, reason: propose.reason },
        apply,
        proposalId,
        receipt: {
          kind: "approval_required",
          text: formatReceipt({
            detect,
            propose,
            apply,
            proposalId,
            targets,
          }),
        },
      };
      if (targets.length > 0) result.targets = targets;
      return result;
    }
    const blockedReason =
      reconciliation.status === "blocked"
        ? blockedReconciliationReason(reconciliation, lifecycleOutcome)
        : lifecycleOutcome.afterStatus === "applied" ||
            lifecycleOutcome.reason === "applied"
          ? "unverified_applied_state"
          : lifecycleOutcome.reason;
    return blockedProposalOutcome({
      detect,
      propose,
      proposalId,
      targets,
      reason: blockedReason,
    });
  }

  throw new TypeError("invalid_evolution_outcome");
}

function validStage(stage, expectedStatus) {
  return (
    stage?.status === expectedStatus &&
    validMachineReason(stage.reason)
  );
}

function validIdentifier(value) {
  return isLifecycleIdentifier(value) && contentSafeToken(value, 128);
}

function validProposalLifecycleFamily(detect, propose) {
  return (
    (validStage(detect, "candidate") && validStage(propose, "created")) ||
    (validStage(detect, "skipped") &&
      detect.reason === "existing_proposal" &&
      validStage(propose, "not_needed") &&
      propose.reason === "existing_proposal")
  );
}

function validMachineReason(value) {
  return (
    typeof value === "string" &&
    value.length <= 96 &&
    MACHINE_REASON_PATTERN.test(value) &&
    contentSafeToken(value, 96)
  );
}

function inspectLifecycleEvidence(reconciliation, proposalId) {
  if (reconciliation === undefined) {
    return { problem: "lifecycle_evidence_missing" };
  }
  if (
    !reconciliation ||
    !["settled", "blocked"].includes(reconciliation.status) ||
    !Array.isArray(reconciliation.outcomes) ||
    !Number.isInteger(reconciliation.inspectedCount) ||
    reconciliation.inspectedCount !== reconciliation.outcomes.length ||
    (reconciliation.blockingReason !== undefined &&
      !validMachineReason(reconciliation.blockingReason))
  ) {
    return { problem: "invalid_lifecycle_evidence" };
  }
  const inspectedOutcomes = reconciliation.outcomes.map(
    inspectCoordinatorOutcome,
  );
  const invalidOutcome = inspectedOutcomes.find(({ problem }) => problem);
  if (invalidOutcome) return { problem: invalidOutcome.problem };
  const derivedStatus = deriveLifecycleReconciliationStatus(
    reconciliation.outcomes,
  );
  if (
    (reconciliation.status === "settled" &&
      (derivedStatus !== "settled" ||
        reconciliation.blockingReason !== undefined)) ||
    (reconciliation.status === "blocked" &&
      derivedStatus === "settled" &&
      reconciliation.blockingReason === undefined)
  ) {
    return { problem: "invalid_lifecycle_evidence" };
  }
  if (
    reconciliation.outcomes.some((outcome) =>
      isAppliedLifecycleOutcome(outcome),
    ) &&
    reconciliation.postApplicationVerified !== true
  ) {
    return { problem: "invalid_lifecycle_evidence" };
  }
  const matches = inspectedOutcomes.filter(
    ({ outcome }) => outcome.proposalId === proposalId,
  );
  if (matches.length === 0) {
    return {
      problem:
        validMachineReason(reconciliation.blockingReason) &&
        reconciliation.status === "blocked"
          ? reconciliation.blockingReason
          : "proposal_outcome_missing",
    };
  }
  if (matches.length > 1) return { problem: "ambiguous_proposal_outcome" };
  return matches[0];
}

function inspectCoordinatorOutcome(outcome) {
  if (
    !isLifecycleOutcome(outcome) ||
    !validIdentifier(outcome.proposalId) ||
    !validMachineReason(outcome.reason)
  ) {
    return { problem: "invalid_lifecycle_evidence" };
  }
  const targets = normalizeTargets(outcome.targets);
  return targets
    ? { outcome, targets }
    : { problem: "unsafe_lifecycle_targets" };
}

function normalizeTargets(targets) {
  if (!Array.isArray(targets)) return undefined;
  const normalized = [];
  for (const target of targets) {
    if (!safeWorkspacePath(target)) return undefined;
    normalized.push(target);
  }
  return new Set(normalized).size === normalized.length
    ? [...normalized].sort()
    : undefined;
}

function safeWorkspacePath(target) {
  if (
    typeof target !== "string" ||
    target.length > 240 ||
    !target.startsWith(".agent-context/") ||
    !/^[\p{L}\p{N}._/-]+$/u.test(target) ||
    target.includes("\\") ||
    /[\u0000-\u001f\u007f]/u.test(target)
  ) {
    return false;
  }
  return target.split("/").every(
    (segment) =>
      segment !== "" &&
      segment !== "." &&
      segment !== ".." &&
      contentSafeToken(segment, 240),
  );
}

function contentSafeToken(value, maxLength) {
  if (value.length > maxLength) return false;
  const normalized = value.toLowerCase().replaceAll(/[.-]/gu, "_");
  if (UNSAFE_DETAIL_MARKERS.some((marker) => normalized.includes(marker))) {
    return false;
  }
  return !LIKELY_SECRET_TOKEN_PATTERNS.some((pattern) => pattern.test(value));
}

function blockedReconciliationReason(reconciliation, lifecycleOutcome) {
  if (validMachineReason(reconciliation.blockingReason)) {
    return reconciliation.blockingReason;
  }
  return lifecycleOutcome.reason === "applied"
    ? "workspace_reconciliation_blocked"
    : lifecycleOutcome.reason;
}

function blockedProposalOutcome({
  detect,
  propose,
  proposalId,
  targets = [],
  reason,
}) {
  const safeReason = validMachineReason(reason)
    ? reason
    : "invalid_lifecycle_evidence";
  const nextAction = nextActionFor(safeReason);
  const apply = { status: "blocked", reason: safeReason };
  const result = {
    schemaVersion: 1,
    detect: { status: detect.status, reason: detect.reason },
    propose: { status: propose.status, reason: propose.reason },
    apply,
    proposalId,
    receipt: {
      kind: "blocked",
      text: formatReceipt({
        detect,
        propose,
        apply,
        proposalId,
        targets,
        nextAction,
      }),
    },
  };
  if (targets.length > 0) result.targets = targets;
  return result;
}

function nextActionFor(reason) {
  if (reason === "target_state_changed") return "regenerate_proposal";
  if (
    reason === "target_state_changed_after_audit" ||
    reason === "replacement_proposal_not_found" ||
    reason === "replacement_proposal_not_eligible"
  ) {
    return "create_superseding_proposal";
  }
  if (
    reason === "target_matches_after_hash_without_applied_audit" ||
    reason === "audit_write_pending"
  ) {
    return "recover_proposal_audit";
  }
  if (
    reason === "lifecycle_evidence_missing" ||
    reason === "lifecycle_locked" ||
    reason === "workspace_reconciliation_blocked"
  ) {
    return "retry_reconciliation";
  }
  return undefined;
}

function formatReceipt({
  detect,
  propose,
  apply,
  proposalId,
  targets = [],
  nextAction,
}) {
  const fields = [
    formatStage("detect", detect, "candidate"),
    formatStage("propose", propose, "created"),
    formatStage("apply", apply, "applied"),
  ];
  if (proposalId) fields.push(`proposal=${proposalId}`);
  if (targets.length > 0) fields.push(`targets=${targets.join(",")}`);
  if (nextAction) fields.push(`next=${nextAction}`);
  return `Evolution outcome: ${fields.join("; ")}.`;
}

function formatStage(name, stage, successStatus) {
  return `${name}=${stage.status}${stage.status === successStatus ? "" : `(${stage.reason})`}`;
}
