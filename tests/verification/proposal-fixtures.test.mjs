import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { validateProposalDocument } from "./proposal-contract.mjs";

const fixtureRoot = fileURLToPath(new URL("fixtures/proposals", import.meta.url));

test("valid proposal fixture satisfies the v1 envelope", () => {
  assert.deepEqual(validateProposalDocument(read("valid.md"), "valid.md"), []);
});

test("valid policy_auto proposal completes the exact auto lifecycle", () => {
  assert.deepEqual(validateProposalDocument(read("valid-auto.md"), "valid-auto.md"), []);
});

test("policy_auto Decision is rejected when any auto gate is false", () => {
  const source = read("valid-auto.md");
  const mutations = [
    source.replace('"requestedPolicy": "auto"', '"requestedPolicy": "propose"'),
    source.replace('"policy": "auto"', '"policy": "propose"'),
    source.replace('"semanticOperation": "add"', '"semanticOperation": "update"'),
    source.replace('"risk": "low"', '"risk": "high"'),
    source.replaceAll("verified", "in_progress"),
    source.replace('"privacy": {\n    "safe": true', '"privacy": {\n    "safe": false'),
    source.replace('"autoAllowed": true', '"autoAllowed": false'),
    source.replaceAll(
      ".agent-context/PROJECT_PROFILE.md",
      ".agent-context/reports/auto-report.md",
    ),
  ];
  for (const mutated of mutations) assertRejected(mutated, "policy_auto");
});

test("applied proposal rejects a Decision hash from a different plan", () => {
  const mutated = replaceInSection(
    read("valid.md"),
    "Decision Log",
    "95065339e93055d01831861860854f67dbc21a7b69d81d66f0c26fc11e1ee5bd",
    "2".repeat(64),
  );
  assertRejected(mutated, "Decision");
});

test("Decision records require a valid enum, timestamp, actor, and reason", () => {
  const source = read("valid.md");
  for (const [search, replacement, expected] of [
    ["decision: approved", "decision: maybe", "decision is invalid"],
    ["decided_at: 2026-07-10T00:00:00Z", "decided_at: yesterday", "decided_at"],
    ["decided_at: 2026-07-10T00:00:00Z", "decided_at: 2026-07-10", "decided_at"],
    ["decided_by: fixture_user", "decided_by:", "decided_by"],
    ["reason: Exact fixture plan approved.", "reason:", "reason"],
  ]) {
    assertRejected(replaceInSection(source, "Decision Log", search, replacement), expected);
  }
});

test("applied proposal rejects an Apply Attempt hash from a different plan", () => {
  const mutated = replaceInSection(
    read("valid.md"),
    "Apply Attempts",
    "95065339e93055d01831861860854f67dbc21a7b69d81d66f0c26fc11e1ee5bd",
    "3".repeat(64),
  );
  assertRejected(mutated, "Apply Attempt");
});

test("Apply Attempt requires positive unique sequential attempt numbers", () => {
  const source = read("valid.md");
  assertRejected(
    replaceInSection(source, "Apply Attempts", "attempt: 1", "attempt: 0"),
    "attempt must be a positive integer",
  );
  assertRejected(appendAttempt(source, 1), "attempt numbers must not repeat");
  assertRejected(appendAttempt(source, 3), "attempt numbers must be sequential");
});

test("Apply Attempt validates result and timestamp lifecycle", () => {
  const source = read("valid.md");
  assertRejected(
    replaceInSection(source, "Apply Attempts", "result: applied", "result: maybe"),
    "result is invalid",
  );
  assertRejected(
    replaceInSection(
      source,
      "Apply Attempts",
      "attempted_at: 2026-07-10T00:00:01Z",
      "attempted_at: yesterday",
    ),
    "attempted_at",
  );
  assertRejected(
    replaceInSection(source, "Apply Attempts", "  applied_at: 2026-07-10T00:00:01Z\n", ""),
    "applied_at",
  );

  const conflict = asConflict(source);
  assert.deepEqual(validateProposalDocument(conflict, "valid conflict attempt"), []);
  assertRejected(
    replaceInSection(
      conflict,
      "Apply Attempts",
      "attempted_at: 2026-07-10T00:00:01Z",
      "attempted_at: 2026-07-10T00:00:01Z\n  applied_at: 2026-07-10T00:00:01Z",
    ),
    "applied_at",
  );
  assertRejected(
    replaceInSection(conflict, "Apply Attempts", "error_summary: before_hash_mismatch", "error_summary: null"),
    "error_summary",
  );
});

test("Apply Attempt hash maps and error_summary follow the audit schema", () => {
  const source = read("valid.md");
  assertRejected(
    replaceInSection(source, "Apply Attempts", "1".repeat(64), "not-a-hash"),
    "before_hashes",
  );
  assertRejected(
    replaceInSection(
      source,
      "Apply Attempts",
      "78c30b878e02b328c81cb90ca9d4ff41223d22c63dd1a09c51192a8d7ea6a5e0",
      "not-a-hash",
    ),
    "after_hashes",
  );
  assertRejected(
    replaceInSection(source, "Apply Attempts", "error_summary: null", "error_summary: unexpected_error"),
    "error_summary",
  );
});

test("proposal rejects changed operation content under an unchanged plan_hash", () => {
  const mutated = read("valid.md").replace("Fixture rule.\\n", "Changed fixture rule.\\n");
  assertRejected(mutated, "plan_hash");
});

test("proposal rejects target_files that differ from PatchPlan operations", () => {
  const mutated = read("valid.md").replace(
    "  - .agent-context/PROJECT_PROFILE.md",
    "  - .agent-context/checklists/coding.md",
  );
  assertRejected(mutated, "target_files");
});

test("PatchPlan semanticOperation must match frontmatter operation", () => {
  const source = read("valid.md");
  assertRejected(source.replace("operation: update", "operation: merge"), "semanticOperation");
  assertRejected(
    source.replace('"semanticOperation": "update"', '"semanticOperation": "merge"'),
    "semanticOperation",
  );
});

test("PatchPlan targets must be supported by the v1 runtime topology", () => {
  const source = read("valid.md");
  for (const target of [
    ".agent-context/random.md",
    ".agent-context/.commit-lock",
    ".agent-context/proposals/other-proposal.md",
  ]) {
    assertRejected(
      source.replaceAll(".agent-context/PROJECT_PROFILE.md", target),
      "target is unsupported",
    );
  }
});

test("PatchPlan requires policy, context delta, and complete operation content", () => {
  const source = read("valid.md");
  const cases = [
    [source.replace('  "requestedPolicy": "propose",\n', ""), "requestedPolicy"],
    [source.replace('  "policyReason": "workspace_policy_propose",', '  "policyReason": "human approval required",'), "policyReason"],
    [
      source.replace(
        /  "contextDelta": \{\n    "activeLinesBefore": 2,\n    "activeLinesAfter": 4\n  \},\n/u,
        "",
      ),
      "contextDelta",
    ],
    [
      source.replace(
        `      "beforeHash": "${"1".repeat(64)}",\n      "content": "# Project Profile\\n\\nFixture rule.\\n"`,
        `      "beforeHash": "${"1".repeat(64)}"`,
      ),
      "complete content",
    ],
  ];
  for (const [mutated, expected] of cases) assertRejected(mutated, expected);
});

test("PatchPlan enforces create and update beforeHash rules", () => {
  const source = read("valid.md");
  assertRejected(
    source.replace('"beforeHash": "' + "1".repeat(64) + '"', '"beforeHash": null'),
    "update operation",
  );
  assertRejected(source.replace('"type": "update"', '"type": "create"'), "create operation");
});

test("persisted PatchPlan excludes runtime-only and self-hash fields", () => {
  const source = read("valid.md");
  assertRejected(
    source.replace('  "proposalId": "fixture-valid-proposal",', '  "proposalId": "fixture-valid-proposal",\n  "workspaceRoot": "C:/workspace",'),
    "workspaceRoot",
  );
  assertRejected(
    source.replace('  "proposalId": "fixture-valid-proposal",', '  "proposalId": "fixture-valid-proposal",\n  "planHash": "' + "6".repeat(64) + '",'),
    "planHash",
  );
});

test("proposal rejects extra privacy declaration keys", () => {
  const mutated = read("valid.md").replace(
    "  redactions: [workspace user path removed]",
    "  redactions: [workspace user path removed]\n  unexpected_policy: false",
  );
  assertRejected(mutated, "privacy");
});

test("proposal rejects empty or placeholder Evidence", () => {
  const source = read("valid.md");
  assertRejected(replaceSectionContent(source, "Evidence", ""), "Evidence");
  assertRejected(replaceSectionContent(source, "Evidence", "TODO: add evidence."), "Evidence");
});

test("applied proposal hashes describe operation before and after content", () => {
  const source = read("valid.md");
  assertRejected(
    replaceInSection(source, "Apply Attempts", "1".repeat(64), "4".repeat(64)),
    "before_hashes",
  );
  assertRejected(
    replaceInSection(
      source,
      "Apply Attempts",
      "78c30b878e02b328c81cb90ca9d4ff41223d22c63dd1a09c51192a8d7ea6a5e0",
      "5".repeat(64),
    ),
    "after_hashes",
  );
});

test("approved proposal also binds every Decision and failed Attempt to the exact plan", () => {
  const approved = read("valid.md")
    .replace("status: applied", "status: approved")
    .replace("result: applied", "result: conflict");
  assertRejected(
    replaceInSection(
      approved,
      "Decision Log",
      "95065339e93055d01831861860854f67dbc21a7b69d81d66f0c26fc11e1ee5bd",
      "7".repeat(64),
    ),
    "Decision",
  );
  assertRejected(
    replaceInSection(
      approved,
      "Apply Attempts",
      "95065339e93055d01831861860854f67dbc21a7b69d81d66f0c26fc11e1ee5bd",
      "8".repeat(64),
    ),
    "Apply Attempt",
  );
});

test("proposal status agrees with Decision and Apply Attempt history", () => {
  const source = read("valid.md");
  assertRejected(source.replace("status: applied", "status: approved"), "approved status");
  assertRejected(
    asConflict(source).replace("status: approved", "status: applied"),
    "applied status",
  );
  assertRejected(source.replace("status: applied", "status: proposed"), "proposed status");
  assertRejected(
    source.replace(
      "- decision: approved",
      [
        "- decision: rejected",
        "  decided_at: 2026-07-09T23:59:59Z",
        "  decided_by: fixture_user",
        "  plan_hash: 95065339e93055d01831861860854f67dbc21a7b69d81d66f0c26fc11e1ee5bd",
        "  reason: Rejected decisions are terminal for this proposal.",
        "- decision: approved",
      ].join("\n"),
    ),
    "cannot contain a rejected Decision",
  );

  const rejected = asRejected(source);
  assert.deepEqual(validateProposalDocument(rejected, "valid rejected proposal"), []);
  assertRejected(
    replaceSectionContent(
      rejected,
      "Apply Attempts",
      extractSectionContent(source, "Apply Attempts"),
    ),
    "rejected status",
  );
});

test("superseded and archived statuses require one valid terminal transition", () => {
  const applied = read("valid.md");
  const superseded = replaceSectionContent(
    applied.replace("status: applied", "status: superseded"),
    "Supersession",
    "fixture-replacement-proposal",
  );
  assert.deepEqual(validateProposalDocument(superseded, "valid superseded proposal"), []);
  assert.deepEqual(
    validateProposalDocument(
      replaceSectionContent(
        applied.replace("status: applied", "status: superseded"),
        "Supersession",
        "Replaced by fixture-replacement-proposal after the original apply.",
      ),
      "historical applied supersession prose",
    ),
    [],
  );

  const archivedSuperseded = superseded.replace("status: superseded", "status: archived");
  assert.deepEqual(
    validateProposalDocument(archivedSuperseded, "valid archived superseded proposal"),
    [],
  );

  const archivedRejected = asRejected(applied).replace("status: rejected", "status: archived");
  assert.deepEqual(
    validateProposalDocument(archivedRejected, "valid archived rejected proposal"),
    [],
  );

  assertRejected(applied.replace("status: applied", "status: superseded"), "Supersession");
  assertRejected(
    replaceSectionContent(applied, "Supersession", "fixture-replacement-proposal"),
    "applied status",
  );
  assertRejected(
    replaceSectionContent(asRejected(applied), "Rejection Notes", "Not rejected."),
    "Rejection Notes",
  );
  assertRejected(
    replaceSectionContent(asRejected(applied), "Rejection Notes", "None."),
    "Rejection Notes",
  );

  let emptyArchived = applied.replace("status: applied", "status: archived");
  emptyArchived = replaceSectionContent(emptyArchived, "Decision Log", "None.");
  emptyArchived = replaceSectionContent(emptyArchived, "Apply Attempts", "None.");
  assertRejected(emptyArchived, "archived status");
});

test("an approved stale conflict may name a replacement and terminate without a false applied history", () => {
  const conflicted = asConflict(read("valid.md"));
  const replacementNamed = replaceSectionContent(
    conflicted,
    "Supersession",
    "fixture-replacement-proposal",
  );
  assert.deepEqual(
    validateProposalDocument(replacementNamed, "stale replacement pending"),
    [],
  );

  const superseded = replacementNamed.replace("status: approved", "status: superseded");
  assert.deepEqual(
    validateProposalDocument(superseded, "superseded stale proposal"),
    [],
  );

  const failed = replacementNamed
    .replace("result: conflict", "result: failed")
    .replace("error_summary: before_hash_mismatch", "error_summary: filesystem_error");
  assertRejected(
    failed.replace("status: approved", "status: superseded"),
    "stale conflict",
  );
});

test("cleanup operation vocabulary is accepted", () => {
  const source = asPending(read("valid.md"));
  for (const operation of [
    "tighten",
    "merge",
    "rewrite",
    "supersede",
    "demote_to_checklist",
    "archive_example",
    "archive_rule",
  ]) {
    assert.deepEqual(
      validateProposalDocument(source.replace("operation: update", `operation: ${operation}`)),
      [],
      `operation should be valid: ${operation}`,
    );
  }
});

test("user-global promotion leaves target resolution to its approved adapter", () => {
  assert.deepEqual(
    validateProposalDocument(read("valid-user-global.md"), "user-global promotion"),
    [],
  );
});

test("user-global promotion candidate content is bound to candidate_hash", () => {
  const mutated = read("valid-user-global.md").replace(
    "Prefer pointer-first evidence across workspaces.",
    "Persist every raw log across workspaces.",
  );
  assertRejected(mutated, "candidate_hash");
});

test("user-global promotion rejects quoted authorization decisions", () => {
  for (const decision of ['"approved"', "'policy_auto'"]) {
    const mutated = replaceSectionContent(
      read("valid-user-global.md"),
      "Decision Log",
      `~~~yaml\n- decision: ${decision}\n~~~`,
    );
    assertRejected(mutated, "approved or policy_auto Decision");
  }
});

test("plan_hash is required after pending_current_fix", () => {
  const source = read("valid.md");
  for (const [label, proposal] of [
    ["missing", source.replace(/^plan_hash:.*\n/mu, "")],
    ["malformed", source.replace(/^plan_hash:.*$/mu, "plan_hash: not-a-hash")],
  ]) {
    const failures = validateProposalDocument(proposal, `${label} plan hash`);
    assert.ok(failures.some((failure) => failure.includes("plan_hash")), failures.join("\n"));
  }
});

test("pending_current_fix proposal may have a null plan_hash", () => {
  const source = asPending(read("valid.md"));
  assert.deepEqual(validateProposalDocument(source, "pending proposal"), []);
});

for (const [fixture, expectedFailure] of [
  ["invalid-status.md", "status"],
  ["invalid-unsafe-target.md", "target_files"],
  ["invalid-missing-evidence.md", "Evidence"],
]) {
  test(`${fixture} is rejected`, () => {
    const failures = validateProposalDocument(read(fixture), fixture);
    assert.ok(
      failures.some((failure) => failure.includes(expectedFailure)),
      `expected a ${expectedFailure} failure, received:\n${failures.join("\n")}`,
    );
  });
}

function read(name) {
  return readFileSync(join(fixtureRoot, name), "utf8").replaceAll("\r\n", "\n");
}

function assertRejected(source, expectedFailure) {
  const failures = validateProposalDocument(source, "mutated proposal");
  assert.ok(
    failures.some((failure) => failure.includes(expectedFailure)),
    `expected ${expectedFailure} rejection, received:\n${failures.join("\n")}`,
  );
}

function replaceInSection(source, heading, search, replacement) {
  const headingMarker = `## ${heading}`;
  const start = source.indexOf(headingMarker);
  assert.notEqual(start, -1, `fixture is missing ${headingMarker}`);
  const next = source.indexOf("\n## ", start + headingMarker.length);
  const end = next === -1 ? source.length : next;
  const section = source.slice(start, end);
  assert.ok(section.includes(search), `${heading} is missing mutation input`);
  return `${source.slice(0, start)}${section.replace(search, replacement)}${source.slice(end)}`;
}

function replaceSectionContent(source, heading, content) {
  const headingMarker = `## ${heading}`;
  const start = source.indexOf(headingMarker);
  assert.notEqual(start, -1, `fixture is missing ${headingMarker}`);
  const next = source.indexOf("\n## ", start + headingMarker.length);
  const end = next === -1 ? source.length : next;
  return `${source.slice(0, start + headingMarker.length)}\n\n${content}\n${source.slice(end)}`;
}

function asPending(source) {
  let pending = source
    .replace("status: applied", "status: pending_current_fix")
    .replace(/^plan_hash:.*$/mu, "plan_hash: null");
  pending = replaceSectionContent(pending, "Proposed Patch", "Draft pending current fix.");
  pending = replaceSectionContent(pending, "Decision Log", "None.");
  return replaceSectionContent(pending, "Apply Attempts", "None.");
}

function asConflict(source) {
  return source
    .replace("status: applied", "status: approved")
    .replace("result: applied", "result: conflict")
    .replace("  applied_at: 2026-07-10T00:00:01Z\n", "")
    .replace("error_summary: null", "error_summary: before_hash_mismatch");
}

function asRejected(source) {
  let rejected = source
    .replace("status: applied", "status: rejected")
    .replace("decision: approved", "decision: rejected")
    .replace("reason: Exact fixture plan approved.", "reason: Exact fixture plan rejected.");
  rejected = replaceSectionContent(rejected, "Apply Attempts", "None.");
  return replaceSectionContent(rejected, "Rejection Notes", "The exact plan was rejected.");
}

function extractSectionContent(source, heading) {
  const headingMarker = `## ${heading}`;
  const start = source.indexOf(headingMarker);
  const next = source.indexOf("\n## ", start + headingMarker.length);
  const end = next === -1 ? source.length : next;
  return source.slice(start + headingMarker.length, end).trim();
}

function appendAttempt(source, attemptNumber) {
  const heading = "Apply Attempts";
  const headingMarker = `## ${heading}`;
  const start = source.indexOf(headingMarker);
  const next = source.indexOf("\n## ", start + headingMarker.length);
  const end = next === -1 ? source.length : next;
  const section = source.slice(start, end);
  const recordStart = section.indexOf("- attempt: 1");
  const recordEnd = section.lastIndexOf("\n~~~~");
  assert.notEqual(recordStart, -1);
  assert.notEqual(recordEnd, -1);
  const record = section.slice(recordStart, recordEnd).replace("- attempt: 1", `- attempt: ${attemptNumber}`);
  const expanded = `${section.slice(0, recordEnd)}\n${record}${section.slice(recordEnd)}`;
  return `${source.slice(0, start)}${expanded}${source.slice(end)}`;
}
