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

test("applied proposal rejects a Decision hash from a different plan", () => {
  const mutated = replaceInSection(
    read("valid.md"),
    "Decision Log",
    "95065339e93055d01831861860854f67dbc21a7b69d81d66f0c26fc11e1ee5bd",
    "2".repeat(64),
  );
  assertRejected(mutated, "Decision");
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
  for (const target of [".agent-context/random.md", ".agent-context/.commit-lock"]) {
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
  return readFileSync(join(fixtureRoot, name), "utf8");
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
