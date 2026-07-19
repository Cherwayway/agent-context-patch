const MACHINE_REASON_PATTERN = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/u;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const TERMINAL_PROPOSAL_STATUSES = new Set([
  "applied",
  "rejected",
  "superseded",
  "archived",
]);
const APPLIED_ACTIONS = new Set([
  "resume_exact_auto",
  "resume_exact_authorized",
]);
const SETTLED_LIFECYCLE_ACTIONS = new Set(["settled", "approval_required"]);

export function deriveLifecycleReconciliationStatus(outcomes) {
  if (!Array.isArray(outcomes) || !outcomes.every(isLifecycleOutcome)) {
    return undefined;
  }
  return outcomes.every(isSettledLifecycleOutcome) ? "settled" : "blocked";
}

export function isAppliedLifecycleOutcome(outcome) {
  return (
    isLifecycleOutcome(outcome) &&
    APPLIED_ACTIONS.has(outcome.action) &&
    outcome.afterStatus === "applied" &&
    outcome.reason === "applied"
  );
}

export function isApprovalRequiredLifecycleOutcome(outcome) {
  return isLifecycleOutcome(outcome) && outcome.action === "approval_required";
}

export function isLifecycleIdentifier(value) {
  return typeof value === "string" && IDENTIFIER_PATTERN.test(value);
}

export function isLifecycleOutcome(outcome) {
  return (
    outcome !== null &&
    typeof outcome === "object" &&
    isLifecycleIdentifier(outcome.proposalId) &&
    typeof outcome.reason === "string" &&
    outcome.reason.length <= 96 &&
    MACHINE_REASON_PATTERN.test(outcome.reason) &&
    Array.isArray(outcome.targets) &&
    outcome.targets.every((target) => typeof target === "string") &&
    new Set(outcome.targets).size === outcome.targets.length &&
    validLifecycleTransition(outcome)
  );
}

export function isTerminalProposalStatus(status) {
  return TERMINAL_PROPOSAL_STATUSES.has(status);
}

function isSettledLifecycleOutcome(outcome) {
  return (
    SETTLED_LIFECYCLE_ACTIONS.has(outcome.action) ||
    TERMINAL_PROPOSAL_STATUSES.has(outcome.afterStatus)
  );
}

function validLifecycleTransition({
  beforeStatus,
  afterStatus,
  action,
  reason,
}) {
  if (action === "settled") {
    return (
      (beforeStatus === "pending_current_fix" &&
        afterStatus === "pending_current_fix" &&
        reason === "current_fix_pending") ||
      (beforeStatus === "approved" &&
        afterStatus === "superseded" &&
        reason === "superseded_by_replacement")
    );
  }
  if (action === "approval_required") {
    return (
      beforeStatus === afterStatus &&
      ((beforeStatus === "proposed" &&
        reason === "policy_requires_approval") ||
        (["proposed", "approved"].includes(beforeStatus) &&
          reason === "user_global_adapter_required"))
    );
  }
  if (action === "manual_recovery_required") {
    return (
      beforeStatus === afterStatus &&
      ["pending_current_fix", "proposed", "approved", "unknown"].includes(
        beforeStatus,
      )
    );
  }
  if (action === "audit_recovery_required") {
    return reason === "audit_write_pending"
      ? ["proposed", "approved"].includes(beforeStatus) &&
          afterStatus === "approved"
      : reason === "target_matches_after_hash_without_applied_audit" &&
          ["proposed", "approved"].includes(beforeStatus) &&
          afterStatus === beforeStatus;
  }
  if (action === "superseding_proposal_required") {
    return (
      beforeStatus === "approved" &&
      afterStatus === "approved" &&
      [
        "replacement_proposal_not_found",
        "replacement_proposal_not_eligible",
        "target_state_changed_after_audit",
      ].includes(reason)
    );
  }
  if (action === "regenerate_required") {
    return (
      beforeStatus === "proposed" &&
      afterStatus === "proposed" &&
      reason === "target_state_changed"
    );
  }
  if (APPLIED_ACTIONS.has(action)) {
    const beforeAllowed =
      beforeStatus === "approved" ||
      (action === "resume_exact_auto" && beforeStatus === "proposed");
    return (
      beforeAllowed &&
      ((afterStatus === "applied" && reason === "applied") ||
        (["proposed", "approved"].includes(afterStatus) &&
          reason !== "applied"))
    );
  }
  return false;
}
