import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  computePlanHash,
  sha256Text,
} from "../../skills/evolve/runtime/index.mjs";
import { reconcileWorkspaceProposalLifecycles } from "../../skills/evolve/runtime/lifecycle.mjs";
import { finalizeEvolutionOutcome } from "../../skills/evolve/runtime/outcome.mjs";
import { inspectProposalDocument } from "../../skills/evolve/runtime/proposal.mjs";

const fixtureRoot = join(import.meta.dirname, "..", "verification", "fixtures");

test("the delivery checkpoint reports applied only after the real coordinator records the audit", async (t) => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "agent-context-outcome-"));
  t.after(() => rm(workspaceRoot, { recursive: true, force: true }));
  const contextRoot = join(workspaceRoot, ".agent-context");
  const proposalsRoot = join(contextRoot, "proposals");
  await mkdir(proposalsRoot, { recursive: true });
  await writeFile(
    join(contextRoot, "config.yml"),
    await readFile(
      join(fixtureRoot, "config", "valid-auto-inline.yml"),
      "utf8",
    ),
    "utf8",
  );

  const proposalPath = join(proposalsRoot, "2026-07-19-outcome.md");
  const appliedFixture = await readFile(
    join(fixtureRoot, "proposals", "valid-auto.md"),
    "utf8",
  );
  let interrupted = appliedFixture.replace("status: applied", "status: proposed");
  interrupted = replaceSectionContent(interrupted, "Decision Log", "None.");
  interrupted = replaceSectionContent(interrupted, "Apply Attempts", "None.");
  await writeFile(proposalPath, interrupted, "utf8");

  const reconciliation = await reconcileWorkspaceProposalLifecycles({
    workspaceRoot,
  });
  const result = finalizeEvolutionOutcome({
    detect: {
      status: "candidate",
      reason: "failed_verification_later_passed",
    },
    propose: { status: "created", reason: "proposal_created" },
    proposalId: "fixture-valid-auto",
    reconciliation,
  });

  assert.deepEqual(result.apply, { status: "applied", reason: "applied" });
  assert.deepEqual(result.targets, [".agent-context/PROJECT_PROFILE.md"]);
  assert.equal(result.receipt.kind, "applied");
  assert.equal(JSON.stringify(result).includes(workspaceRoot), false);
  assert.match(await readFile(proposalPath, "utf8"), /result: applied/u);
});

test("the delivery checkpoint blocks success when the same apply makes a sibling stale", async (t) => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "agent-context-outcome-"));
  t.after(() => rm(workspaceRoot, { recursive: true, force: true }));
  const contextRoot = join(workspaceRoot, ".agent-context");
  const proposalsRoot = join(contextRoot, "proposals");
  await mkdir(proposalsRoot, { recursive: true });
  await writeFile(
    join(contextRoot, "config.yml"),
    await readFile(
      join(fixtureRoot, "config", "valid-auto-inline.yml"),
      "utf8",
    ),
    "utf8",
  );
  const target = ".agent-context/PROJECT_PROFILE.md";
  const before = "# Project Profile\n\nShared baseline.\n";
  await writeFile(join(workspaceRoot, target), before, "utf8");

  const appliedFixture = await readFile(
    join(fixtureRoot, "proposals", "valid-auto.md"),
    "utf8",
  );
  const parsed = inspectProposalDocument(appliedFixture, "outcome fixture base");
  assert.deepEqual(parsed.failures, []);
  const approvalPlan = structuredClone(parsed.value.plan);
  Object.assign(approvalPlan, {
    planId: "plan-outcome-approval",
    proposalId: "outcome-approval",
    semanticOperation: "tighten",
    requestedPolicy: "auto",
    policy: "propose",
    policyReason: "semantic_overlap_requires_approval",
    risk: "high",
  });
  approvalPlan.contextHealth.autoAllowed = false;
  approvalPlan.operations = [
    {
      type: "update",
      target,
      beforeHash: sha256Text(before),
      content: "# Project Profile\n\nApproval-only change.\n",
    },
  ];
  const autoPlan = structuredClone(parsed.value.plan);
  Object.assign(autoPlan, {
    planId: "plan-outcome-auto",
    proposalId: "outcome-auto",
  });
  autoPlan.operations = [
    {
      type: "update",
      target,
      beforeHash: sha256Text(before),
      content: "# Project Profile\n\nShared baseline.\nAuto addition.\n",
    },
  ];
  await writeFile(
    join(proposalsRoot, "a-approval.md"),
    proposalFixture(appliedFixture, {
      id: "outcome-approval",
      operation: "tighten",
      plan: approvalPlan,
    }),
    "utf8",
  );
  await writeFile(
    join(proposalsRoot, "b-auto.md"),
    proposalFixture(appliedFixture, {
      id: "outcome-auto",
      operation: "add",
      plan: autoPlan,
    }),
    "utf8",
  );

  const reconciliation = await reconcileWorkspaceProposalLifecycles({
    workspaceRoot,
  });
  const result = finalizeEvolutionOutcome({
    detect: {
      status: "candidate",
      reason: "failed_verification_later_passed",
    },
    propose: { status: "created", reason: "proposal_created" },
    proposalId: "outcome-auto",
    reconciliation,
  });

  assert.equal(reconciliation.status, "blocked");
  assert.deepEqual(result.apply, {
    status: "blocked",
    reason: "workspace_reconciliation_blocked",
  });
  assert.equal(result.receipt.kind, "blocked");
  assert.doesNotMatch(result.receipt.text, /apply=applied/u);
});

function replaceSectionContent(source, heading, content) {
  const marker = `## ${heading}`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `fixture is missing ${marker}`);
  const next = source.indexOf("\n## ", start + marker.length);
  const end = next === -1 ? source.length : next;
  return `${source.slice(0, start + marker.length)}\n\n${content}\n${source.slice(end)}`;
}

function proposalFixture(source, { id, operation, plan }) {
  let proposal = source
    .replace("status: applied", "status: proposed")
    .replace("id: fixture-valid-auto", `id: ${id}`)
    .replace("operation: add", `operation: ${operation}`)
    .replace(
      /^plan_hash:[^\r\n]*$/mu,
      `plan_hash: ${computePlanHash(plan)}`,
    );
  proposal = replaceSectionContent(proposal, "Decision Log", "None.");
  proposal = replaceSectionContent(proposal, "Apply Attempts", "None.");
  return replacePatchPlan(proposal, plan);
}

function replacePatchPlan(source, plan) {
  const opening = source.indexOf("~~~~json");
  assert.notEqual(opening, -1);
  const jsonStart = source.indexOf("\n", opening) + 1;
  const closing = source.indexOf("\n~~~~", jsonStart);
  assert.notEqual(closing, -1);
  return `${source.slice(0, jsonStart)}${JSON.stringify(plan, null, 2)}${source.slice(closing)}`;
}
