import { parseMarkdownFrontmatter } from "./config.mjs";
import { computePlanHash, sha256Text } from "./index.mjs";

const HASH_PATTERN = /^[a-f0-9]{64}$/u;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const POLICY_REASON_PATTERN = /^[a-z][a-z0-9_-]{0,127}$/u;
const statuses = new Set([
  "pending_current_fix",
  "proposed",
  "approved",
  "rejected",
  "applied",
  "superseded",
  "archived",
]);
const operations = new Set([
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
const workspaceSemanticOperations = new Set(
  [...operations].filter((operation) => operation !== "user_global_promotion"),
);
const fixStatuses = new Set(["not_started", "in_progress", "fixed", "verified"]);
const priorities = new Set(["low", "medium", "high"]);
const planRisks = new Set(["low", "high"]);
const decisionKinds = new Set(["approved", "rejected", "policy_auto"]);
const attemptResults = new Set(["applied", "conflict", "failed", "rolled_back"]);
const staleConflictReasons = new Set([
  "before_hash_mismatch",
  "target_exists",
  "target_missing",
]);
const authorities = new Set([
  "user_decision",
  "current_source",
  "verified_context",
  "repeated_observation",
  "heuristic",
]);
const requiredSections = [
  "Observed Failure",
  "Evidence",
  "Root Cause",
  "Future Risk",
  "Proposed Patch",
  "Why This Scope",
  "Why Not Broader",
  "Context Priority",
  "Privacy Check",
  "Decision Log",
  "Apply Attempts",
  "Supersession",
  "Rejection Notes",
];
const privacyKeys = [
  "raw_conversation_stored",
  "full_logs_stored",
  "secrets_stored",
  "customer_data_stored",
  "absolute_user_paths_stored",
  "redactions",
];

export function validateProposalDocument(source, label = "proposal") {
  let document;
  try {
    document = parseMarkdownFrontmatter(source, label);
  } catch (error) {
    return [`${label}: ${error.message}`];
  }

  const { data, body } = document;
  const failures = [];
  const promotion = data.scope === "user-global" && data.operation === "user_global_promotion";

  expect(data.schema_version === 1, "schema_version must be 1");
  expect(typeof data.id === "string" && IDENTIFIER_PATTERN.test(data.id), "id is invalid");
  expect(statuses.has(data.status), `status is invalid: ${String(data.status)}`);
  expect(operations.has(data.operation), `operation is invalid: ${String(data.operation)}`);
  expect(fixStatuses.has(data.current_fix_status), "current_fix_status is invalid");
  expect(priorities.has(data.confidence), "confidence is invalid");
  expect(priorities.has(data.retention_value), "retention_value is invalid");
  expect(authorities.has(data.authority), "authority is invalid");
  expect(nonEmptyString(data.trigger), "trigger must be a non-empty string");
  expect(nonEmptyString(data.created_by), "created_by must be a non-empty string");
  expect(validTimestamp(data.created_at), "created_at must be an ISO-compatible timestamp");
  expect(validTimestamp(data.updated_at), "updated_at must be an ISO-compatible timestamp");

  if (data.status === "pending_current_fix" || promotion) {
    expect(data.plan_hash === null, `${promotion ? "user-global promotion" : "pending_current_fix"} plan_hash must be null`);
  } else {
    expect(
      typeof data.plan_hash === "string" && HASH_PATTERN.test(data.plan_hash),
      "plan_hash must be 64 lowercase hexadecimal characters",
    );
  }

  if (data.scope === "workspace") {
    expect(
      Array.isArray(data.target_files) && data.target_files.length > 0,
      "target_files must be a non-empty list for workspace scope",
    );
    for (const target of Array.isArray(data.target_files) ? data.target_files : []) {
      expect(safeWorkspacePath(target), `target_files contains an unsafe workspace target: ${target}`);
    }
  } else if (data.scope === "user-global") {
    expect(
      data.operation === "user_global_promotion",
      "user-global scope is only valid for user_global_promotion",
    );
    expect(
      Array.isArray(data.target_files) && data.target_files.length === 0,
      "user-global promotion target_files must stay empty until adapter approval",
    );
    expect(data.status === "proposed", "user-global promotion must stay proposed until adapter approval");
  } else {
    expect(false, `scope is invalid: ${String(data.scope)}`);
  }

  validatePrivacy(data.privacy, expect);
  const sections = extractSections(body, expect);
  validateEvidence(sections.get("Evidence"), expect);

  let plan;
  if (data.scope === "workspace" && data.status !== "pending_current_fix") {
    plan = validateWorkspacePatchPlan(data, sections.get("Proposed Patch"), expect);
    if (plan) validateAuditHashes(data.status, data.plan_hash, plan, sections, expect);
  }
  if (promotion) {
    validatePromotionCandidate(data, sections, expect);
  }
  if (plan && hasAppliedAttempt(sections)) {
    expect(
      data.current_fix_status === "verified",
      "an applied history requires a verified current fix",
    );
    validateAppliedAudit(plan, sections, expect);
  }
  if (data.status === "pending_current_fix") {
    expect(
      yamlListRecords(sections.get("Decision Log"), "decision").length === 0,
      "pending_current_fix cannot contain a Decision",
    );
    expect(
      yamlListRecords(sections.get("Apply Attempts"), "attempt").length === 0,
      "pending_current_fix cannot contain an Apply Attempt",
    );
  }

  return failures;

  function expect(condition, message) {
    if (!condition) failures.push(`${label}: ${message}`);
  }
}

export function inspectProposalDocument(source, label = "proposal") {
  const failures = validateProposalDocument(source, label);
  if (failures.length > 0) return { failures };

  const { data, body } = parseMarkdownFrontmatter(source, label);
  const sections = extractSections(body, () => {});
  const plan =
    data.scope === "workspace" && data.status !== "pending_current_fix"
      ? parseLabeledJson(sections.get("Proposed Patch"), "PatchPlan JSON", () => {})
      : undefined;
  const decisions = yamlListRecords(sections.get("Decision Log"), "decision").map(
    (record) => ({
      decision: normalizeAuditToken(record.value),
      planHash: scalarField(record.text, "plan_hash"),
    }),
  );
  const attempts = yamlListRecords(sections.get("Apply Attempts"), "attempt").map(
    (record) => ({
      attempt: Number(record.value),
      planHash: scalarField(record.text, "plan_hash"),
      result: scalarField(record.text, "result"),
      errorSummary: scalarField(record.text, "error_summary"),
    }),
  );

  return {
    failures,
    value: {
      data,
      plan,
      decisions,
      attempts,
      sections,
      sourceHash: sha256Text(source),
    },
  };
}

function validatePrivacy(privacy, expect) {
  expect(isRecord(privacy), "privacy must be a mapping");
  if (!isRecord(privacy)) return;
  expect(sameStrings(Object.keys(privacy).sort(), [...privacyKeys].sort()), "privacy contains unsupported keys");
  expect(privacy.raw_conversation_stored === false, "privacy must reject raw conversations");
  expect(privacy.full_logs_stored === false, "privacy must reject full logs");
  expect(privacy.secrets_stored === false, "privacy must reject secrets");
  expect(privacy.customer_data_stored === false, "privacy must reject customer data");
  expect(privacy.absolute_user_paths_stored === false, "privacy must reject absolute user paths");
  expect(
    Array.isArray(privacy.redactions) && privacy.redactions.every(nonEmptyString),
    "privacy redactions must be a string list",
  );
}

function extractSections(body, expect) {
  const headings = [...body.matchAll(/^## ([^\r\n]+?)\s*$/gmu)];
  const sections = new Map();
  for (let index = 0; index < headings.length; index += 1) {
    const heading = headings[index][1].trim();
    const contentStart = headings[index].index + headings[index][0].length;
    const contentEnd = headings[index + 1]?.index ?? body.length;
    if (sections.has(heading)) {
      expect(false, `duplicate section: ${heading}`);
    } else {
      sections.set(heading, body.slice(contentStart, contentEnd).trim());
    }
  }
  for (const section of requiredSections) {
    expect(sections.has(section), `missing required section: ${section}`);
  }
  return sections;
}

function validateEvidence(evidence, expect) {
  if (!nonEmptyString(evidence)) {
    expect(false, "Evidence must not be empty");
    return;
  }
  expect(
    !/^(?:fixture(?: evidence)?|todo(?::.*)?|tbd|placeholder|none|n\/a)\.?$/iu.test(evidence.trim()),
    "Evidence must not be placeholder text",
  );
  expect(
    /(?:^|\n)\s*(?:[-*]\s*)?(?:kind|command|source|file|pointer|summary|exit_code)(?:[^:\r\n]*):\s*\S/imu.test(
      evidence,
    ),
    "Evidence needs a structured pointer, command, or result summary",
  );
}

function validateWorkspacePatchPlan(data, proposedPatch, expect) {
  const plan = parseLabeledJson(proposedPatch, "PatchPlan JSON", expect);
  if (!plan) return undefined;

  expect(isJsonValue(plan) && isRecord(plan), "PatchPlan must be a JSON-serializable object");
  if (!isRecord(plan)) return undefined;
  expect(!Object.hasOwn(plan, "workspaceRoot"), "persisted PatchPlan must not contain workspaceRoot");
  expect(!Object.hasOwn(plan, "planHash"), "persisted PatchPlan must not contain planHash");
  expect(plan.schemaVersion === data.schema_version, "PatchPlan schemaVersion must match proposal schema_version");
  expect(typeof plan.planId === "string" && IDENTIFIER_PATTERN.test(plan.planId), "PatchPlan planId is invalid");
  expect(plan.proposalId === data.id, "PatchPlan proposalId must match proposal id");
  expect(
    workspaceSemanticOperations.has(plan.semanticOperation),
    "PatchPlan semanticOperation is invalid for workspace scope",
  );
  expect(
    plan.semanticOperation === data.operation,
    "PatchPlan semanticOperation must match proposal operation",
  );
  expect(["propose", "auto"].includes(plan.requestedPolicy), "PatchPlan requestedPolicy is invalid");
  expect(["propose", "auto"].includes(plan.policy), "PatchPlan policy is invalid");
  expect(
    !(plan.requestedPolicy === "propose" && plan.policy === "auto"),
    "PatchPlan effective policy cannot exceed requestedPolicy",
  );
  expect(
    typeof plan.policyReason === "string" && POLICY_REASON_PATTERN.test(plan.policyReason),
    "PatchPlan policyReason must be a machine-readable token",
  );
  expect(planRisks.has(plan.risk), "PatchPlan risk is invalid");
  expect(
    plan.currentFixStatus === data.current_fix_status,
    "PatchPlan currentFixStatus must match current_fix_status",
  );
  expect(
    isRecord(plan.privacy) &&
      sameStrings(Object.keys(plan.privacy).sort(), ["safe"]) &&
      plan.privacy.safe === true,
    "PatchPlan privacy must be exactly {safe:true}",
  );
  expect(
    isRecord(plan.contextHealth) &&
      sameStrings(Object.keys(plan.contextHealth).sort(), ["autoAllowed"]) &&
      typeof plan.contextHealth.autoAllowed === "boolean",
    "PatchPlan contextHealth must declare autoAllowed",
  );
  expect(
    isRecord(plan.contextDelta) &&
      sameStrings(Object.keys(plan.contextDelta).sort(), ["activeLinesAfter", "activeLinesBefore"]) &&
      nonNegativeInteger(plan.contextDelta.activeLinesBefore) &&
      nonNegativeInteger(plan.contextDelta.activeLinesAfter),
    "PatchPlan contextDelta must contain non-negative active line counts",
  );
  expect(Array.isArray(plan.operations) && plan.operations.length > 0, "PatchPlan operations must be non-empty");

  const targets = [];
  for (const [index, operation] of (Array.isArray(plan.operations) ? plan.operations : []).entries()) {
    if (!isRecord(operation)) {
      expect(false, `PatchPlan operation ${index} must be an object`);
      continue;
    }
    expect(
      sameStrings(Object.keys(operation).sort(), ["beforeHash", "content", "target", "type"]),
      `PatchPlan operation ${index} has missing or unsupported fields`,
    );
    expect(["create", "update"].includes(operation.type), `PatchPlan operation ${index} type is invalid`);
    expect(safeWorkspacePath(operation.target), `PatchPlan operation ${index} target is unsafe`);
    expect(
      supportedWorkspaceTarget(operation.target),
      `PatchPlan operation ${index} target is unsupported by the v1 topology`,
    );
    expect(typeof operation.content === "string", `PatchPlan operation ${index} needs complete content`);
    if (operation.type === "create") {
      expect(operation.beforeHash === null, `PatchPlan create operation ${index} beforeHash must be null`);
    } else if (operation.type === "update") {
      expect(
        typeof operation.beforeHash === "string" && HASH_PATTERN.test(operation.beforeHash),
        `PatchPlan update operation ${index} beforeHash must be a hash`,
      );
    }
    targets.push(operation.target);
  }
  expect(new Set(targets).size === targets.length, "PatchPlan operations contain duplicate targets");
  expect(
    Array.isArray(data.target_files) && sameStrings(data.target_files, targets),
    "target_files must exactly match PatchPlan operation targets",
  );

  if (isJsonValue(plan)) {
    let computedHash;
    try {
      computedHash = computePlanHash(plan);
    } catch {
      expect(false, "PatchPlan is not hashable JSON");
    }
    if (computedHash) {
      expect(computedHash === data.plan_hash, "plan_hash does not match the complete PatchPlan");
    }
  }
  return plan;
}

function validatePromotionCandidate(data, sections, expect) {
  expect(typeof data.candidate_hash === "string" && HASH_PATTERN.test(data.candidate_hash), "candidate_hash is invalid");
  const candidate = parseLabeledJson(sections.get("Proposed Patch"), "Promotion Candidate JSON", expect);
  if (candidate && isRecord(candidate)) {
    expect(isJsonValue(candidate), "Promotion Candidate JSON must be JSON-serializable");
    expect(
      sameStrings(Object.keys(candidate).sort(), [
        "candidateContent",
        "operation",
        "proposalId",
        "schemaVersion",
        "scope",
      ]),
      "Promotion Candidate JSON has missing or unsupported fields",
    );
    expect(candidate.schemaVersion === data.schema_version, "promotion candidate schemaVersion mismatch");
    expect(candidate.proposalId === data.id, "promotion candidate proposalId mismatch");
    expect(candidate.scope === "user-global", "promotion candidate scope must be user-global");
    expect(
      candidate.operation === "user_global_promotion",
      "promotion candidate operation must be user_global_promotion",
    );
    expect(nonEmptyString(candidate.candidateContent), "promotion candidate content must not be empty");
    if (isJsonValue(candidate)) {
      expect(computePlanHash(candidate) === data.candidate_hash, "candidate_hash does not match sanitized candidate");
    }
  } else if (candidate !== undefined) {
    expect(false, "Promotion Candidate JSON must be an object");
  }

  const decision = sections.get("Decision Log") ?? "";
  const attempts = sections.get("Apply Attempts") ?? "";
  expect(
    !yamlListRecords(decision, "decision").some((record) =>
      ["approved", "policy_auto"].includes(normalizeAuditToken(record.value)),
    ),
    "user-global candidate cannot contain an approved or policy_auto Decision",
  );
  expect(!/^\s*-\s*attempt:/imu.test(attempts), "user-global candidate cannot contain an Apply Attempt");
}

function validateAppliedAudit(plan, sections, expect) {
  const attempts = yamlListRecords(sections.get("Apply Attempts"), "attempt");
  expect(attempts.length > 0, "applied proposal needs an Apply Attempt");
  const applied = attempts.filter((record) => scalarField(record.text, "result") === "applied");
  expect(applied.length > 0, "applied proposal needs an applied Apply Attempt");
  const expectedBefore = Object.fromEntries(
    plan.operations.map((operation) => [operation.target, operation.beforeHash]),
  );
  const expectedAfter = Object.fromEntries(
    plan.operations
      .filter((operation) => typeof operation.content === "string")
      .map((operation) => [operation.target, sha256Text(operation.content)]),
  );
  for (const record of applied) {
    expect(
      sameHashMap(yamlHashMap(record.text, "before_hashes"), expectedBefore),
      "Apply Attempt before_hashes must equal operation beforeHash values",
    );
    expect(
      sameHashMap(yamlHashMap(record.text, "after_hashes"), expectedAfter),
      "Apply Attempt after_hashes must equal operation content hashes",
    );
  }
}

function validateAuditHashes(status, planHash, plan, sections, expect) {
  const decisions = yamlListRecords(sections.get("Decision Log"), "decision");
  const attempts = yamlListRecords(sections.get("Apply Attempts"), "attempt");
  const allowedTargets = new Set(plan.operations.map((operation) => operation.target));
  for (const record of decisions) {
    expect(decisionKinds.has(record.value), `Decision decision is invalid: ${record.value}`);
    expect(validTimestamp(scalarField(record.text, "decided_at")), "Decision decided_at is invalid");
    expect(nonEmptyString(scalarField(record.text, "decided_by")), "Decision decided_by is required");
    expect(
      scalarField(record.text, "plan_hash") === planHash,
      "Decision plan_hash must equal the computed plan_hash",
    );
    expect(nonEmptyString(scalarField(record.text, "reason")), "Decision reason is required");
    if (record.value === "policy_auto") validatePolicyAutoPlan(plan, expect);
  }
  const attemptNumbers = new Set();
  for (const [index, record] of attempts.entries()) {
    const attemptNumber = /^[1-9][0-9]*$/u.test(record.value) ? Number(record.value) : undefined;
    expect(attemptNumber !== undefined, "Apply Attempt attempt must be a positive integer");
    if (attemptNumber !== undefined) {
      expect(!attemptNumbers.has(attemptNumber), "Apply Attempt attempt numbers must not repeat");
      attemptNumbers.add(attemptNumber);
      expect(attemptNumber === index + 1, "Apply Attempt attempt numbers must be sequential from 1");
    }
    expect(
      scalarField(record.text, "plan_hash") === planHash,
      "Apply Attempt plan_hash must equal the computed plan_hash",
    );
    const result = scalarField(record.text, "result");
    expect(attemptResults.has(result), `Apply Attempt result is invalid: ${String(result)}`);
    expect(
      validTimestamp(scalarField(record.text, "attempted_at")),
      "Apply Attempt attempted_at is invalid",
    );
    const appliedAt = scalarField(record.text, "applied_at");
    if (result === "applied") {
      expect(validTimestamp(appliedAt), "applied Apply Attempt requires a valid applied_at");
    } else {
      expect(appliedAt === undefined, "non-applied Apply Attempt must not contain applied_at");
    }
    const beforeHashes = yamlHashMap(record.text, "before_hashes");
    const afterHashes = yamlHashMap(record.text, "after_hashes");
    expect(
      validAuditHashMap(beforeHashes, { allowNull: true, allowedTargets }),
      "Apply Attempt before_hashes is invalid",
    );
    expect(
      validAuditHashMap(afterHashes, { allowNull: false, allowedTargets }),
      "Apply Attempt after_hashes is invalid",
    );
    const errorSummary = scalarField(record.text, "error_summary");
    if (result === "applied") {
      expect(errorSummary === "null", "applied Apply Attempt error_summary must be null");
    } else {
      expect(
        typeof errorSummary === "string" &&
          errorSummary !== "null" &&
          POLICY_REASON_PATTERN.test(errorSummary),
        "non-applied Apply Attempt error_summary must be a machine-readable reason",
      );
    }
  }
  const hasApproval = decisions.some(
    (record) => record.value === "approved" || record.value === "policy_auto",
  );
  const hasRejection = decisions.some((record) => record.value === "rejected");
  const results = attempts.map((record) => scalarField(record.text, "result"));
  const finalApplied = attempts.length > 0 && results.at(-1) === "applied";
  const finalAttempt = attempts.at(-1);
  const unappliedStaleConflict =
    finalAttempt !== undefined &&
    !results.includes("applied") &&
    scalarField(finalAttempt.text, "result") === "conflict" &&
    staleConflictReasons.has(scalarField(finalAttempt.text, "error_summary"));
  const supersession = sections.get("Supersession")?.trim();
  const hasSupersession = meaningfulSection(supersession, ["none"]);
  const exactSupersessionIdRequired =
    hasSupersession &&
    (status === "approved" ||
      (["superseded", "archived"].includes(status) && unappliedStaleConflict));
  if (exactSupersessionIdRequired) {
    expect(
      typeof supersession === "string" && IDENTIFIER_PATTERN.test(supersession),
      "unapplied stale Supersession must contain exactly one proposal ID",
    );
  }
  const hasRejectionNotes = meaningfulSection(sections.get("Rejection Notes"), [
    "not rejected",
    "none",
  ]);
  if (status === "proposed") {
    expect(decisions.length === 0 && attempts.length === 0, "proposed status cannot contain Decision or Apply Attempt history");
    expect(!hasSupersession, "proposed status cannot contain Supersession");
    expect(!hasRejectionNotes, "proposed status cannot contain Rejection Notes");
  } else if (status === "approved") {
    expect(hasApproval, "approved proposal needs an approved or policy_auto Decision");
    expect(!hasRejection, "approved proposal cannot contain a rejected Decision");
    expect(!results.includes("applied"), "approved status cannot contain an applied Apply Attempt");
    expect(
      !hasSupersession || unappliedStaleConflict,
      "approved Supersession requires an unapplied stale conflict",
    );
    expect(!hasRejectionNotes, "approved status cannot contain Rejection Notes");
  } else if (status === "applied") {
    expect(hasApproval, "applied proposal needs an approved or policy_auto Decision");
    expect(!hasRejection, "applied proposal cannot contain a rejected Decision");
    expect(
      finalApplied,
      "applied status requires the final Apply Attempt to be applied",
    );
    expect(!hasSupersession, "applied status cannot contain Supersession");
    expect(!hasRejectionNotes, "applied status cannot contain Rejection Notes");
  } else if (status === "rejected") {
    expect(
      hasRejection && !hasApproval,
      "rejected status requires only a rejected Decision",
    );
    expect(attempts.length === 0, "rejected status cannot contain an Apply Attempt");
    expect(!hasSupersession, "rejected status cannot contain Supersession");
    expect(hasRejectionNotes, "rejected status requires Rejection Notes");
  } else if (status === "superseded") {
    expect(
      hasApproval && !hasRejection && (finalApplied || unappliedStaleConflict),
      "superseded status requires a valid applied history or unapplied stale conflict",
    );
    expect(hasSupersession, "superseded status requires a non-empty Supersession");
    expect(!hasRejectionNotes, "superseded status cannot contain Rejection Notes");
  } else if (status === "archived") {
    const archivedRejected = hasRejection && !hasApproval && attempts.length === 0 && hasRejectionNotes && !hasSupersession;
    const archivedSuperseded =
      hasApproval &&
      !hasRejection &&
      (finalApplied || unappliedStaleConflict) &&
      hasSupersession &&
      !hasRejectionNotes;
    expect(
      archivedRejected || archivedSuperseded,
      "archived status requires a valid rejected or superseded history",
    );
  }
}

function hasAppliedAttempt(sections) {
  return yamlListRecords(sections.get("Apply Attempts"), "attempt").some(
    (record) => scalarField(record.text, "result") === "applied",
  );
}

function meaningfulSection(value, emptyLabels) {
  if (!nonEmptyString(value)) return false;
  const normalized = value.trim().replace(/[.]+$/u, "").trim().toLowerCase();
  return !emptyLabels.includes(normalized);
}

function normalizeAuditToken(value) {
  let token = value.trim().replace(/\s+#.*$/u, "").trim();
  if (token.startsWith('"') && token.endsWith('"')) {
    try {
      return JSON.parse(token);
    } catch {
      return token;
    }
  }
  if (token.startsWith("'") && token.endsWith("'")) {
    token = token.slice(1, -1).replaceAll("''", "'");
  }
  return token;
}

function validatePolicyAutoPlan(plan, expect) {
  const eligible =
    plan.requestedPolicy === "auto" &&
    plan.policy === "auto" &&
    plan.semanticOperation === "add" &&
    plan.risk === "low" &&
    plan.currentFixStatus === "verified" &&
    plan.privacy?.safe === true &&
    plan.contextHealth?.autoAllowed === true &&
    plan.operations.every((operation) => autoEligibleTarget(operation.target));
  expect(eligible, "policy_auto Decision requires every auto eligibility gate");
}

function autoEligibleTarget(target) {
  return (
    target === ".agent-context/PROJECT_CONTEXT_INDEX.md" ||
    target === ".agent-context/PROJECT_PROFILE.md" ||
    /^\.agent-context\/checklists\/[^/]+\.md$/u.test(target)
  );
}

function parseLabeledJson(section, subheading, expect) {
  if (!nonEmptyString(section)) {
    expect(false, `${subheading} is missing`);
    return undefined;
  }
  const marker = new RegExp(`^### ${escapeRegExp(subheading)}\\s*$`, "mu").exec(section);
  if (!marker) {
    expect(false, `${subheading} is missing`);
    return undefined;
  }
  const lines = section.slice(marker.index + marker[0].length).split(/\r?\n/u);
  const openingIndex = lines.findIndex((line) => /^\s*(?:`{3,}|~{3,})json\s*$/u.test(line));
  if (openingIndex === -1) {
    expect(false, `${subheading} needs a JSON code block`);
    return undefined;
  }
  const opening = lines[openingIndex].trim().match(/^(`{3,}|~{3,})json\s*$/u);
  const fence = opening?.[1];
  const closingIndex = lines.findIndex(
    (line, index) => index > openingIndex && line.trim() === fence,
  );
  if (closingIndex === -1) {
    expect(false, `${subheading} JSON code block is not closed`);
    return undefined;
  }
  const json = lines.slice(openingIndex + 1, closingIndex).join("\n");
  try {
    return JSON.parse(json);
  } catch {
    expect(false, `${subheading} contains invalid JSON`);
    return undefined;
  }
}

function yamlListRecords(section = "", key) {
  const records = [];
  const startPattern = new RegExp(`^\\s*-\\s*${escapeRegExp(key)}:\\s*(.+?)\\s*$`, "u");
  let current;
  for (const line of section.split(/\r?\n/u)) {
    const start = line.match(startPattern);
    if (start) {
      if (current) records.push({ ...current, text: current.lines.join("\n") });
      current = { value: start[1], lines: [line] };
    } else if (current) {
      current.lines.push(line);
    }
  }
  if (current) records.push({ ...current, text: current.lines.join("\n") });
  return records;
}

function scalarField(record, key) {
  return new RegExp(
    `^[ \\t]*${escapeRegExp(key)}:[ \\t]*([^\\r\\n]*?)[ \\t]*$`,
    "mu",
  ).exec(record)?.[1];
}

function yamlHashMap(record, key) {
  const lines = record.split(/\r?\n/u);
  const inlineEmpty = new RegExp(`^[ \\t]*${escapeRegExp(key)}:[ \\t]*\\{\\}[ \\t]*$`, "u");
  if (lines.some((line) => inlineEmpty.test(line))) return {};
  const startIndex = lines.findIndex((line) => new RegExp(`^[ \\t]*${escapeRegExp(key)}:[ \\t]*$`, "u").test(line));
  if (startIndex === -1) return undefined;
  const baseIndent = lines[startIndex].length - lines[startIndex].trimStart().length;
  const result = {};
  for (let index = startIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim() === "") continue;
    const indent = line.length - line.trimStart().length;
    if (indent <= baseIndent) break;
    const entry = line.trim().match(/^(.+?):\s*(null|[a-f0-9]{64})$/u);
    if (!entry || Object.hasOwn(result, entry[1])) return undefined;
    result[entry[1]] = entry[2] === "null" ? null : entry[2];
  }
  return result;
}

function validAuditHashMap(value, { allowNull, allowedTargets }) {
  return (
    isRecord(value) &&
    Object.entries(value).every(
      ([target, hash]) =>
        safeWorkspacePath(target) &&
        allowedTargets.has(target) &&
        ((allowNull && hash === null) || (typeof hash === "string" && HASH_PATTERN.test(hash))),
    )
  );
}

function sameHashMap(actual, expected) {
  if (!isRecord(actual)) return false;
  const keys = Object.keys(expected).sort();
  return sameStrings(Object.keys(actual).sort(), keys) && keys.every((key) => actual[key] === expected[key]);
}

function isJsonValue(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  return isRecord(value) && Object.values(value).every(isJsonValue);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

function nonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0;
}

function validTimestamp(value) {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u.test(value) &&
    !Number.isNaN(Date.parse(value))
  );
}

function safeWorkspacePath(target) {
  return (
    typeof target === "string" &&
    target.startsWith(".agent-context/") &&
    !target.includes("\\") &&
    !target.split("/").some((part) => part === "" || part === "." || part === "..")
  );
}

function supportedWorkspaceTarget(target) {
  return (
    target === ".agent-context/config.yml" ||
    target === ".agent-context/PROJECT_CONTEXT_INDEX.md" ||
    target === ".agent-context/PROJECT_PROFILE.md" ||
    /^\.agent-context\/checklists\/[^/]+\.md$/u.test(target) ||
    /^\.agent-context\/reports\/[^/]+\.md$/u.test(target) ||
    target.startsWith(".agent-context/archive/")
  );
}

function sameStrings(left, right) {
  return Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((value, index) => value === right[index]);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
